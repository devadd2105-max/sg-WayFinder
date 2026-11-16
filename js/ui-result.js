// Round results and the final summary.

import { h, clear, icon, countUp, copyText, toast } from './dom.js';
import { SlippyMap } from './map.js';
import { FINISH_RADIUS_M } from './plan.js';
import { MODES, DIFFICULTIES } from './model.js';
import { evaluateRound, evaluateIncomplete } from './evaluate.js';
import { MAX_PER_PART, MAX_PER_ROUND, rankFor } from './scoring.js';
import { formatDistance, formatMinutes, formatMoney } from './geo.js';
import { recordScore } from './store.js';

const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;

function scoreRow({ title, score, line }) {
  const value = h('span', { class: 'score-num' }, '0');
  countUp(value, score, 900);
  return h('div', { class: 'score-row' },
    h('div', { class: 'score-head' },
      h('h3', { class: 'score-title' }, title),
      h('p', { class: 'score-value' }, value, h('span', { class: 'score-max' }, ` / ${MAX_PER_PART.toLocaleString()}`))),
    h('div', { class: 'meter', role: 'img', 'aria-label': `${score} out of ${MAX_PER_PART}` },
      h('span', { class: 'meter-fill', style: `width:${(score / MAX_PER_PART) * 100}%` })),
    h('p', { class: 'score-line' }, line));
}

function legLabel(leg) {
  if (leg.recovery) return leg.mode === 'walk' ? 'Walk back from where you really were' : 'Taxi back from where you really were';
  if (leg.mode === 'rail') return `MRT from ${leg.fromName} to ${leg.toName}`;
  if (leg.mode === 'walk' && leg.toName) return `Walk to ${leg.toName} station`;
  return MODES[leg.mode].label;
}

function legRow(leg) {
  return h('li', { class: 'leg', 'data-mode': leg.mode },
    h('span', { class: 'leg-badge' }, icon(leg.mode, 16)),
    h('span', { class: 'leg-text' }, legLabel(leg), h('span', { class: 'leg-sub' }, formatDistance(leg.distanceM))),
    h('span', { class: 'leg-cost' }, formatMinutes(leg.minutes)));
}

function describe(ev) {
  const o = ev.orientation;
  const location = o.distanceM === Infinity ? 'You did not place a pin.' : `${formatDistance(o.distanceM)} from where you really were.`;

  let plan;
  if (ev.incomplete) {
    plan = 'You did not lock in a complete route in time.';
  } else {
    const best = ev.reference.best;
    plan = `Your journey takes ${formatMinutes(ev.journeyMinutes)} and costs ${formatMoney(ev.journeyCost)}. Best value was ${best.label.toLowerCase()}: ${formatMinutes(best.minutes)} for ${formatMoney(best.cost)}.`;
  }

  let prediction;
  if (ev.prediction.minutes == null) {
    prediction = 'No prediction was locked in.';
  } else {
    const err = ev.prediction.errorRatio;
    const how = Math.abs(err) < 0.03 ? 'almost exactly right' : `${pct(err)} ${err < 0 ? 'too short' : 'too long'}`;
    prediction = `You said ${formatMinutes(ev.prediction.minutes)}. Your route takes about ${formatMinutes(ev.prediction.actualMinutes)}, so your guess was ${how}.`;
  }
  return { location, plan, prediction };
}

function drawResultMap(host, round, outcome, ev) {
  const map = new SlippyMap(host, { style: 'labels' });
  const pts = [outcome.trueStart, round.destination];
  if (outcome.guess) pts.push(outcome.guess);

  map.addCircle({ center: round.destination, radiusM: FINISH_RADIUS_M });
  map.addMarker({ position: round.destination, className: 'marker-flag', zIndex: 6,
    content: h('div', { class: 'flag' }, h('span', { class: 'flag-pole' }), h('span', { class: 'flag-label' }, round.destination.name)) });

  // Best-value journey: thin dark dotted line, underneath the player's route.
  for (const leg of ev.reference.best.legs) {
    map.addPolyline({ points: leg.geometry, color: '#151a21', width: 3, dash: '2 8', opacity: 0.85, casing: false });
  }
  if (ev.recovery) map.addPolyline({ points: ev.recovery.geometry, color: '#7a8696', width: 4, dash: '8 8', casing: false });
  for (const leg of ev.legs) {
    map.addPolyline({ points: leg.geometry, color: MODES[leg.mode].color, width: leg.mode === 'walk' ? 6 : 7, dash: leg.mode === 'walk' ? '0.1 11' : null });
    pts.push(leg.from, leg.to);
  }
  if (outcome.guess) {
    map.addPolyline({ points: [outcome.trueStart, outcome.guess], color: '#151a21', width: 2, dash: '4 6', casing: false });
    map.addMarker({ position: outcome.guess, className: 'marker-pin', zIndex: 7,
      content: h('div', { class: 'pin pin-you' }, h('span', { class: 'pin-body' }), h('span', { class: 'pin-label' }, 'Your pin')) });
  }
  map.addMarker({ position: outcome.trueStart, className: 'marker-pin', zIndex: 8,
    content: h('div', { class: 'pin pin-start' }, h('span', { class: 'pin-body' }), h('span', { class: 'pin-label' }, 'Where you landed')) });

  map.fitBounds(pts, 70, 16);
  return map;
}

/** Score one round and show it. Resolves with the evaluation when the player continues. */
export async function showResult(ctx, game, round, outcome) {
  const root = clear(ctx.root);
  root.append(h('main', { class: 'screen center-screen' }, h('span', { class: 'spinner big' }), h('p', { class: 'panel-text' }, 'Scoring your trip')));

  let ev;
  try {
    ev =
      outcome.complete && outcome.guess
        ? await evaluateRound({ round, trueStart: outcome.trueStart, guess: outcome.guess, legs: outcome.legs, predictionMin: outcome.predictionMin, router: ctx.router })
        : await evaluateIncomplete({ round, trueStart: outcome.trueStart, guess: outcome.guess, router: ctx.router });
  } catch (err) {
    console.error(err);
    toast('Something went wrong while scoring this round.', { kind: 'bad' });
    ev = await evaluateIncomplete({ round, trueStart: outcome.trueStart, guess: outcome.guess, router: ctx.router });
  }

  return new Promise((resolve) => {
    const isLast = round.index === game.rounds.length - 1;
    const lines = describe(ev);
    const mapHost = h('div', { class: 'map-host result-map' });
    const estimated = ev.legs.some((l) => l.source === 'estimate') || ev.reference.candidates.some((c) => c.legs.some((l) => l.source === 'estimate'));

    const total = h('span', { class: 'round-total-num' }, '0');
    countUp(total, ev.total, 1100, (n) => Math.round(n).toLocaleString());

    const candidates = ev.reference.candidates.map((c) => {
      const over = c.cost > round.budget + 1e-9;
      const best = c.id === ev.reference.best.id;
      return h('li', { class: `cand${best ? ' is-best' : ''}${over ? ' is-over' : ''}` },
        h('span', { class: 'cand-name' }, c.label, best ? h('span', { class: 'tag' }, 'Best value') : null, over ? h('span', { class: 'tag tag-muted' }, 'Over budget') : null),
        h('span', { class: 'cand-figs' }, `${formatMinutes(c.minutes)}, ${formatMoney(c.cost)}`));
    });

    const journeyRows = [];
    if (ev.recovery) journeyRows.push(legRow(ev.recovery));
    journeyRows.push(...ev.legs.map(legRow));

    const nextBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => resolve(ev) }, isLast ? 'See final score' : 'Next round');

    const panel = h('aside', { class: 'result-panel' },
      h('div', { class: 'result-head' },
        h('div', {},
          h('h2', { class: 'result-title' }, round.destination.name),
          h('p', { class: 'result-sub' }, `Round ${round.index + 1}, ${round.zone.area}, ${round.scenario.label.toLowerCase()}`)),
        h('p', { class: 'round-total' }, total, h('span', { class: 'score-max' }, ` / ${MAX_PER_ROUND.toLocaleString()}`))),
      scoreRow({ title: 'Location', score: ev.orientation.score, line: lines.location }),
      scoreRow({ title: 'Plan', score: ev.plan.score, line: lines.plan }),
      scoreRow({ title: 'Prediction', score: ev.prediction.score, line: lines.prediction }),
      journeyRows.length
        ? h('section', { class: 'detail' }, h('h3', {}, 'Your journey, step by step'), h('ol', { class: 'legs legs-result' }, ...journeyRows))
        : null,
      h('section', { class: 'detail' },
        h('h3', {}, 'What the model found'),
        h('ul', { class: 'cands' }, ...candidates),
        h('p', { class: 'fine' }, 'Value counts each S$1 as 1.5 minutes. Fares and times are rough model estimates, not a timetable.' +
          (estimated ? ' The street-routing service could not be reached, so some distances are straight-line estimates.' : ''))),
      h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch swatch-route' }), 'Your route'),
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch swatch-best' }), 'Best value'),
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch swatch-pin' }), 'Pin to start')),
      h('div', { class: 'panel-actions sticky' }, nextBtn));

    clear(root).append(
      h('main', { class: 'screen result-screen' },
        h('header', { class: 'topbar' },
          h('div', { class: 'topbar-left' }, h('span', { class: 'brand-small' }, 'SG Wayfinder'), h('span', { class: 'round-count' }, `Round ${round.index + 1} of ${game.rounds.length}`)),
          h('div', { class: 'topbar-right' }, h('span', { class: 'score-so-far' }, `${(game.total + ev.total).toLocaleString()} points`))),
        h('div', { class: 'stage result-stage' }, h('section', { class: 'result-map-pane' }, mapHost), panel)));

    drawResultMap(mapHost, round, outcome, ev);
  });
}

// ---- final ---------------------------------------------------------------

function squares(score) {
  return score >= 700 ? '🟩' : score >= 350 ? '🟨' : '🟥';
}

export function shareUrl(game) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#seed=${encodeURIComponent(game.seed)}&d=${game.difficulty}&n=${game.rounds.length}`;
}

export function shareText(game, rank) {
  const rows = game.results.map((r, i) => `R${i + 1} ${squares(r.ev.orientation.score)}${squares(r.ev.plan.score)}${squares(r.ev.prediction.score)}`);
  return [
    `SG Wayfinder, ${game.label} (${DIFFICULTIES[game.difficulty].label})`,
    `${game.total.toLocaleString()} of ${(game.rounds.length * MAX_PER_ROUND).toLocaleString()}, ${rank.title}`,
    '(location, plan, prediction)',
    ...rows,
    shareUrl(game),
  ].join('\n');
}

export function showFinal(ctx, game) {
  const root = clear(ctx.root);
  const max = game.rounds.length * MAX_PER_ROUND;
  const rank = rankFor(game.total, game.rounds.length);
  const boardId = game.daily ? `${game.seed}|${game.difficulty}` : `free|${game.difficulty}|${game.rounds.length}`;
  const record = recordScore(boardId, game.total);

  const totalNum = h('span', { class: 'final-num' }, '0');
  countUp(totalNum, game.total, 1400, (n) => Math.round(n).toLocaleString());

  const rows = game.results.map(({ round, ev }) =>
    h('li', { class: 'final-row' },
      h('div', { class: 'final-row-main' },
        h('span', { class: 'final-dest' }, round.destination.name),
        h('span', { class: 'final-from' }, `from ${round.zone.area}`)),
      h('div', { class: 'mini-bars', role: 'img', 'aria-label': `Location ${ev.orientation.score}, plan ${ev.plan.score}, prediction ${ev.prediction.score}` },
        ...[ev.orientation.score, ev.plan.score, ev.prediction.score].map((s) =>
          h('span', { class: 'mini' }, h('span', { class: 'mini-fill', style: `height:${(s / MAX_PER_PART) * 100}%` })))),
      h('span', { class: 'final-score' }, ev.total.toLocaleString())));

  const actions = h('div', { class: 'actions' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.startGame({ seed: game.daily ? game.seed : null, difficulty: game.difficulty, count: game.rounds.length, label: game.label, daily: game.daily }) },
      game.daily ? 'Play today again' : 'Play again'),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => toast((await copyText(shareText(game, rank))) ? 'Result copied.' : 'Could not copy. Select the text manually.') },
      icon('copy', 18), 'Copy my result'),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => toast((await copyText(shareUrl(game))) ? 'Challenge link copied.' : 'Could not copy the link.') },
      icon('copy', 18), 'Copy challenge link'),
    h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => ctx.goHome() }, icon('home', 18), 'Back to start'));

  root.append(
    h('main', { class: 'screen final-screen' },
      h('div', { class: 'final-grid' },
        h('section', { class: 'final-hero' },
          h('p', { class: 'final-label' }, game.label),
          h('h1', { class: 'final-total' }, totalNum, h('span', { class: 'score-max' }, ` / ${max.toLocaleString()}`)),
          h('h2', { class: 'final-rank' }, rank.title),
          h('p', { class: 'lede' }, rank.line),
          record.isNew && record.previous > 0 ? h('p', { class: 'final-best' }, `New best on this board, up from ${record.previous.toLocaleString()}.`)
            : record.isNew ? h('p', { class: 'final-best' }, 'First score on this board.')
            : h('p', { class: 'final-best' }, `Your best here is ${record.best.toLocaleString()}.`),
          actions),
        h('section', { class: 'final-rounds' },
          h('h3', { class: 'final-rounds-title' }, 'Round by round'),
          h('p', { class: 'fine' }, 'Bars are location, plan and prediction.'),
          h('ol', { class: 'final-list' }, ...rows)))));
}
