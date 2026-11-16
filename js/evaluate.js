// Turns a finished round into scores: executes the player's legs through the
// router and the travel model, builds the fastest-sensible reference journey,
// and compares the two.

import { haversine, nearestOf } from './geo.js';
import { STATIONS } from './data/stations.js';
import { journeyValue, legCost, legDistanceM, legMinutes } from './model.js';
import { profileForMode } from './routing.js';
import { MIN_LEG_M } from './plan.js';
import { orientationScore, planScore, predictionScore, relativeError } from './scoring.js';

/** A player who is further than this from their pin must first get back on track. */
export const RECOVERY_THRESHOLD_M = 120;
const RECOVERY_WALK_MAX_M = 1200;
const REFERENCE_STATION_REACH_M = 2000;

async function priceLeg({ mode, from, to, cost, ...rest }, scenario, router) {
  const straightM = haversine(from, to);
  const profile = profileForMode(mode);
  const routed = profile ? await router.route(profile, from, to) : null;
  const distanceM = legDistanceM(mode, straightM, routed?.distanceM);
  return {
    ...rest,
    mode,
    from,
    to,
    straightM,
    distanceM,
    minutes: legMinutes(mode, distanceM, scenario, straightM),
    cost: cost ?? legCost(mode, straightM, scenario),
    geometry: routed ? routed.geometry : [from, to],
    source: routed ? routed.source : 'model',
  };
}

const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);
const round2 = (x) => Math.round(x * 100) / 100;

function candidate(id, label, legs) {
  const minutes = sum(legs, 'minutes');
  const cost = round2(sum(legs, 'cost'));
  return { id, label, legs, minutes, cost, value: journeyValue(minutes, cost), distanceM: sum(legs, 'distanceM') };
}

/** The best-value journey (time plus money) the model can find within the budget. */
export async function computeReference({ start, destination, budget, scenario, router }) {
  const price = (leg) => priceLeg(leg, scenario, router);
  const direct = { from: start, to: destination };
  const candidates = [];

  candidates.push(candidate('walk', 'Walk all the way', [await price({ mode: 'walk', ...direct })]));
  candidates.push(candidate('taxi', 'Taxi door to door', [await price({ mode: 'taxi', ...direct })]));
  candidates.push(candidate('bus', 'Direct bus', [await price({ mode: 'bus', ...direct })]));

  const a = nearestOf(start, STATIONS);
  const b = nearestOf(destination, STATIONS);
  if (
    a && b && a.item !== b.item &&
    a.distance <= REFERENCE_STATION_REACH_M && b.distance <= REFERENCE_STATION_REACH_M
  ) {
    const legs = [];
    if (a.distance > MIN_LEG_M) legs.push(await price({ mode: 'walk', from: start, to: a.item }));
    legs.push(await price({ mode: 'rail', from: a.item, to: b.item, fromName: a.item.name, toName: b.item.name }));
    if (b.distance > MIN_LEG_M) legs.push(await price({ mode: 'walk', from: b.item, to: destination }));
    candidates.push(candidate('mrt', 'MRT with walks at each end', legs));
  }

  const feasible = candidates.filter((c) => c.cost <= budget + 1e-9);
  const best = feasible.reduce((x, y) => (y.value < x.value ? y : x), feasible[0]);
  return { best, candidates, feasible };
}

/**
 * Score a round.
 * trueStart: where the player really was; guess: where they said they were;
 * legs: the planned legs (from Plan.legs); predictionMin: their time guess.
 */
export async function evaluateRound({ round, trueStart, guess, legs, predictionMin, router }) {
  const scenario = round.scenario;

  const orientationDistance = haversine(trueStart, guess);
  const orientation = { distanceM: orientationDistance, score: orientationScore(orientationDistance) };

  const executed = [];
  for (const leg of legs) executed.push(await priceLeg(leg, scenario, router));
  const playerMinutes = sum(executed, 'minutes');

  let recovery = null;
  if (orientationDistance > RECOVERY_THRESHOLD_M) {
    const mode = orientationDistance <= RECOVERY_WALK_MAX_M ? 'walk' : 'taxi';
    recovery = await priceLeg({ mode, from: trueStart, to: guess, recovery: true }, scenario, router);
  }
  const recoveryMinutes = recovery ? recovery.minutes : 0;
  const journeyMinutes = playerMinutes + recoveryMinutes;

  const reference = await computeReference({
    start: trueStart,
    destination: round.destination,
    budget: round.budget,
    scenario,
    router,
  });

  const playerCost = round2(sum(executed, 'cost'));
  const journeyCost = round2(playerCost + (recovery ? recovery.cost : 0));
  const journeyScoreValue = journeyValue(journeyMinutes, journeyCost);
  const plan = {
    score: planScore(reference.best.value, journeyScoreValue),
    ratio: Math.min(1, reference.best.value / Math.max(journeyScoreValue, 0.01)),
    value: journeyScoreValue,
  };
  const prediction = {
    minutes: predictionMin,
    actualMinutes: playerMinutes,
    errorRatio: relativeError(predictionMin, playerMinutes),
    score: predictionScore(predictionMin, playerMinutes),
  };

  return {
    orientation,
    legs: executed,
    recovery,
    playerMinutes,
    recoveryMinutes,
    journeyMinutes,
    cost: playerCost,
    journeyCost,
    reference,
    plan,
    prediction,
    total: orientation.score + plan.score + prediction.score,
  };
}

/** Result for a round where time ran out before a complete plan was locked in. */
export async function evaluateIncomplete({ round, trueStart, guess, router }) {
  const reference = await computeReference({
    start: trueStart,
    destination: round.destination,
    budget: round.budget,
    scenario: round.scenario,
    router,
  });
  const d = guess ? haversine(trueStart, guess) : Infinity;
  const score = guess ? orientationScore(d) : 0;
  return {
    incomplete: true,
    orientation: { distanceM: d, score },
    legs: [],
    recovery: null,
    playerMinutes: 0,
    recoveryMinutes: 0,
    journeyMinutes: 0,
    cost: 0,
    journeyCost: 0,
    reference,
    plan: { score: 0, ratio: 0, value: 0 },
    prediction: { minutes: null, actualMinutes: 0, errorRatio: 0, score: 0 },
    total: score,
  };
}
