import test from 'node:test';
import assert from 'node:assert/strict';

import { haversine, offsetPoint, bearing, formatDistance, formatMinutes, clockAfter, inSingapore } from '../js/geo.js';
import { createRng, dailySeed } from '../js/rng.js';
import { MODES, SCENARIOS, DIFFICULTIES, legMinutes, legCost, legDistanceM } from '../js/model.js';
import { orientationScore, predictionScore, planScore, rankFor } from '../js/scoring.js';
import { Plan, FINISH_RADIUS_M, snapStation } from '../js/plan.js';
import { makeRounds } from '../js/rounds.js';
import { createOfflineRouter, createRouter } from '../js/routing.js';
import { computeReference, evaluateRound } from '../js/evaluate.js';
import { DESTINATIONS } from '../js/data/destinations.js';
import { STARTS } from '../js/data/starts.js';
import { STATIONS } from '../js/data/stations.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('haversine is about right for a known pair', () => {
  // Raffles Place to Orchard is roughly 3.4 km as the crow flies.
  const d = haversine({ lat: 1.2839, lng: 103.8515 }, { lat: 1.3043, lng: 103.8322 });
  near(d, 3100, 400);
  assert.equal(haversine({ lat: 1, lng: 103 }, { lat: 1, lng: 103 }), 0);
});

test('offsetPoint round-trips with haversine and bearing', () => {
  const p = { lat: 1.35, lng: 103.82 };
  const q = offsetPoint(p, 90, 1000);
  near(haversine(p, q), 1000, 1);
  near(bearing(p, q), 90, 0.5);
});

test('formatters', () => {
  assert.equal(formatDistance(640), '640 m');
  assert.equal(formatDistance(3400), '3.4 km');
  assert.equal(formatDistance(12400), '12 km');
  assert.equal(formatMinutes(42.4), '42 min');
  assert.equal(formatMinutes(65), '1 h 05 min');
  assert.equal(formatMinutes(120), '2 h');
  assert.equal(clockAfter(18 * 60 + 10, 37), '6:47 pm');
  assert.equal(clockAfter(23 * 60 + 30, 45), '12:15 am');
});

test('seeded rng is deterministic', () => {
  const a = createRng('abc');
  const b = createRng('abc');
  assert.deepEqual([a.next(), a.next(), a.int(1, 10)], [b.next(), b.next(), b.int(1, 10)]);
  assert.notEqual(createRng('abc').next(), createRng('abd').next());
  const sh = createRng('x').shuffle([1, 2, 3, 4, 5]);
  assert.deepEqual([...sh].sort(), [1, 2, 3, 4, 5]);
});

test('daily seed uses the Singapore calendar day', () => {
  // 2026-11-15 17:00 UTC is already 16 Nov in Singapore.
  assert.equal(dailySeed(new Date('2026-11-15T17:00:00Z')), 'daily-2026-11-16');
  assert.equal(dailySeed(new Date('2026-11-15T15:00:00Z')), 'daily-2026-11-15');
});

test('travel model gives plausible numbers', () => {
  const mid = SCENARIOS.find((s) => s.id === 'midday');
  const rush = SCENARIOS.find((s) => s.id === 'pm-peak');
  // 1 km walk is about 12 minutes.
  near(legMinutes('walk', 1000, mid), 12, 0.01);
  // Taxi is slower in rush hour than midday.
  assert.ok(legMinutes('taxi', 10000, rush) > legMinutes('taxi', 10000, mid));
  // Rail adds a transfer allowance every 12 km of straight line.
  const short = legMinutes('rail', 10000 * 1.15, mid, 10000);
  const long = legMinutes('rail', 13000 * 1.15, mid, 13000);
  assert.ok(long - short > 4);
  // Fares: walking is free, taxi costs more than rail.
  assert.equal(legCost('walk', 5000, mid), 0);
  assert.ok(legCost('taxi', 8000, mid) > legCost('rail', 8000, mid));
  assert.ok(legCost('taxi', 8000, rush) > legCost('taxi', 8000, mid));
  // Rail ignores a routed distance.
  assert.equal(legDistanceM('rail', 1000, 99999), 1000 * MODES.rail.detour);
});

test('scoring curves', () => {
  assert.equal(orientationScore(0), 1000);
  assert.equal(orientationScore(75), 1000);
  assert.ok(orientationScore(1000) > 700 && orientationScore(1000) < 760);
  assert.ok(orientationScore(20000) < 5);
  assert.equal(predictionScore(30, 30), 1000);
  assert.ok(predictionScore(33, 30) > predictionScore(40, 30));
  assert.equal(predictionScore(0, 30), 0);
  assert.equal(predictionScore(NaN, 30), 0);
  assert.equal(planScore(20, 20), 1000);
  assert.equal(planScore(20, 10), 1000); // beating the reference is not punished
  assert.equal(planScore(20, 40), 250);
  assert.equal(rankFor(15000, 5).title, 'Wayfinding legend');
  assert.equal(rankFor(0, 5).title, 'Fresh off the plane');
});

test('data is clean', () => {
  for (const list of [DESTINATIONS, STARTS, STATIONS]) {
    for (const p of list) assert.ok(inSingapore(p), `${p.name ?? p.area} is outside Singapore`);
  }
  for (const list of [DESTINATIONS, STARTS]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
    for (const id of ids) assert.match(id, /^[a-z0-9]+$/);
  }
  const names = STATIONS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'duplicate station names');
  assert.ok(STARTS.length >= 50 && DESTINATIONS.length >= 30 && STATIONS.length >= 100);
});

test('rounds are deterministic, valid and varied', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    for (const seed of ['a', 'b', 'daily-2026-11-16']) {
      const r1 = makeRounds({ seed, difficulty, count: 10 });
      const r2 = makeRounds({ seed, difficulty, count: 10 });
      assert.deepEqual(r1, r2);
      assert.equal(new Set(r1.map((r) => r.destination.id)).size, 10, 'destinations repeat');
      assert.equal(new Set(r1.map((r) => r.zone.id)).size, 10, 'start zones repeat');
      for (const r of r1) {
        const d = haversine(r.zone, r.destination);
        assert.ok(d >= 900, `${difficulty}: start too close (${Math.round(d)} m)`);
        assert.ok(inSingapore(r.start));
        assert.equal(r.budget, DIFFICULTIES[difficulty].budget);
      }
    }
  }
  assert.notDeepEqual(makeRounds({ seed: 'a' }), makeRounds({ seed: 'b' }));
});

function newPlan(overrides = {}) {
  const dest = DESTINATIONS.find((d) => d.id === 'mbs');
  const start = { lat: 1.3333, lng: 103.743 }; // Jurong East
  return new Plan({
    start,
    destination: dest,
    budget: 10,
    scenario: SCENARIOS.find((s) => s.id === 'midday'),
    ...overrides,
  });
}

test('plan: MRT step adds the walk to the station automatically', () => {
  const plan = newPlan({ start: { lat: 1.3345, lng: 103.7445 } });
  const res = plan.addStep('rail', { lat: 1.2824, lng: 103.859 }); // Bayfront
  assert.ok(res.ok, res.reason);
  assert.equal(res.legs.length, 2);
  assert.equal(res.legs[0].mode, 'walk');
  assert.equal(res.legs[0].auto, true);
  assert.equal(res.legs[1].mode, 'rail');
  assert.equal(res.legs[1].fromName, 'Jurong East');
  assert.equal(res.legs[1].toName, 'Bayfront');
  assert.equal(plan.legs.length, 2);
  assert.ok(plan.cost > 0 && plan.cost < 3);
});

test('plan: rejects bad steps with a reason', () => {
  const plan = newPlan();
  assert.equal(plan.addStep('rail', { lat: 1.4, lng: 103.65 }).ok, false); // no station near target
  assert.equal(plan.addStep('walk', plan.start).ok, false); // too short
  assert.equal(plan.addStep('hover', { lat: 1.33, lng: 103.75 }).ok, false); // unknown mode
  // Taxi across the island busts a S$10 budget.
  const res = plan.addStep('taxi', { lat: 1.2834, lng: 103.8607 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /over budget/);
  assert.equal(plan.legs.length, 0);
});

test('plan: undo, completion and finish ring', () => {
  const plan = newPlan({ start: { lat: 1.2845, lng: 103.8545 }, budget: 14 });
  assert.equal(plan.complete, false);
  const res = plan.addStep('walk', { lat: 1.2836, lng: 103.8606 });
  assert.ok(res.ok);
  assert.ok(plan.distanceToFinish <= FINISH_RADIUS_M);
  assert.equal(plan.complete, true);
  assert.equal(plan.addStep('walk', { lat: 1.28, lng: 103.86 }).ok, false); // already arrived
  assert.ok(plan.undo());
  assert.equal(plan.legs.length, 0);
  assert.equal(plan.undo(), null);
});

test('snapStation', () => {
  assert.equal(snapStation({ lat: 1.3333, lng: 103.743 }, 700).item.name, 'Jurong East');
  assert.equal(snapStation({ lat: 1.5, lng: 103.9 }, 700), null);
});

test('offline router estimates distance and never throws', async () => {
  const router = createOfflineRouter();
  const a = { lat: 1.3, lng: 103.8 };
  const b = { lat: 1.31, lng: 103.81 };
  const r = await router.route('foot', a, b);
  assert.equal(r.source, 'estimate');
  near(r.distanceM, haversine(a, b) * 1.3, 0.001);
  await assert.rejects(() => router.route('rocket', a, b));
});

test('router parses an OSRM reply and caches it', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1234, geometry: { coordinates: [[103.8, 1.3], [103.81, 1.31]] } }],
      }),
    };
  };
  const router = createRouter({ fetchImpl });
  const a = { lat: 1.3, lng: 103.8 };
  const b = { lat: 1.31, lng: 103.81 };
  const r = await router.route('car', a, b);
  assert.equal(r.source, 'osrm');
  assert.equal(r.distanceM, 1234);
  assert.deepEqual(r.geometry[0], { lat: 1.3, lng: 103.8 });
  await router.route('car', a, b);
  assert.equal(calls, 1);
});

test('router falls back and pauses after repeated failures', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error('offline');
  };
  const router = createRouter({ fetchImpl });
  const a = { lat: 1.3, lng: 103.8 };
  for (let i = 0; i < 6; i++) {
    const r = await router.route('foot', a, { lat: 1.31 + i * 0.001, lng: 103.81 });
    assert.equal(r.source, 'estimate');
  }
  assert.equal(calls, 3, 'should stop calling a dead service');
});

test('reference journey picks a sensible winner', async () => {
  const router = createOfflineRouter();
  const scenario = SCENARIOS.find((s) => s.id === 'midday');
  const dest = DESTINATIONS.find((d) => d.id === 'mbs');
  // Very short trip: walking should win.
  const short = await computeReference({
    start: { lat: 1.2845, lng: 103.8545 }, destination: dest, budget: 10, scenario, router,
  });
  assert.equal(short.best.id, 'walk');
  // Long cross-island trip on a small budget: walking is hopeless, taxi too dear.
  const long = await computeReference({
    start: { lat: 1.3333, lng: 103.743 }, destination: dest, budget: 5, scenario, router,
  });
  assert.ok(['mrt', 'bus'].includes(long.best.id), long.best.id);
  assert.ok(long.best.cost <= 5);
  assert.ok(!long.feasible.some((c) => c.id === 'taxi'));
});

test('a perfect round scores near the maximum', async () => {
  const router = createOfflineRouter();
  const round = {
    scenario: SCENARIOS.find((s) => s.id === 'midday'),
    destination: DESTINATIONS.find((d) => d.id === 'mbs'),
    budget: 10,
  };
  const start = { lat: 1.2845, lng: 103.8545 };
  const plan = new Plan({ start, destination: round.destination, budget: 10, scenario: round.scenario });
  assert.ok(plan.addStep('walk', { lat: 1.2836, lng: 103.8606 }).ok);
  // First pass to learn the model's time, then predict it exactly.
  const probe = await evaluateRound({ round, trueStart: start, guess: start, legs: plan.legs, predictionMin: 10, router });
  const res = await evaluateRound({
    round, trueStart: start, guess: start, legs: plan.legs, predictionMin: probe.playerMinutes, router,
  });
  assert.equal(res.orientation.score, 1000);
  assert.equal(res.prediction.score, 1000);
  assert.equal(res.plan.score, 1000);
  assert.equal(res.total, 3000);
  assert.equal(res.recovery, null);
});

test('a wrong pin costs recovery time and cannot be gamed', async () => {
  const router = createOfflineRouter();
  const round = {
    scenario: SCENARIOS.find((s) => s.id === 'midday'),
    destination: DESTINATIONS.find((d) => d.id === 'mbs'),
    budget: 10,
  };
  const trueStart = { lat: 1.3333, lng: 103.743 }; // Jurong East
  // Cheat: claim to be next to the destination and "walk" the last 100 m.
  const cheatGuess = { lat: 1.2845, lng: 103.8545 };
  const plan = new Plan({ start: cheatGuess, destination: round.destination, budget: 10, scenario: round.scenario });
  assert.ok(plan.addStep('walk', { lat: 1.2836, lng: 103.8606 }).ok);
  const probe = await evaluateRound({ round, trueStart, guess: cheatGuess, legs: plan.legs, predictionMin: 5, router });
  const res = await evaluateRound({
    round, trueStart, guess: cheatGuess, legs: plan.legs, predictionMin: probe.playerMinutes, router,
  });
  assert.ok(res.recovery, 'recovery leg expected');
  assert.equal(res.recovery.mode, 'taxi');
  assert.ok(res.orientation.score <= 15);
  assert.ok(res.plan.score < 700, `plan score ${res.plan.score}`);
  assert.ok(res.total < 1800, `cheat total ${res.total}`);
});
