// Entry point: owns the game loop and moves between screens.

import { $ } from './dom.js';
import { loadSettings } from './store.js';
import { createRouter } from './routing.js';
import { randomSeed } from './rng.js';
import { makeRounds } from './rounds.js';
import { DIFFICULTIES } from './model.js';
import { showTitle } from './ui-title.js';
import { playRound } from './ui-game.js';
import { showResult, showFinal } from './ui-result.js';

const ctx = {
  root: $('#app'),
  settings: loadSettings(),
  router: createRouter(),
  sharedGame: null,
  runId: 0,
};

/** Read a shared game from the URL hash: #seed=abc&d=standard&n=5 */
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const seed = params.get('seed');
  if (!seed) return null;
  const difficulty = DIFFICULTIES[params.get('d')] ? params.get('d') : 'standard';
  const count = Math.min(10, Math.max(1, Number(params.get('n')) || 5));
  return { seed: seed.slice(0, 40), difficulty, count, daily: seed.startsWith('daily-') };
}

ctx.goHome = () => {
  ctx.runId += 1; // abandons any game in progress
  showTitle(ctx);
};

ctx.startGame = async ({ seed, difficulty, count, label, daily = false }) => {
  const runId = ++ctx.runId;
  const gameSeed = seed ?? randomSeed();
  const game = {
    seed: gameSeed,
    difficulty,
    label: label ?? 'Free play',
    daily,
    rounds: makeRounds({ seed: gameSeed, difficulty, count }),
    results: [],
    total: 0,
  };

  for (const round of game.rounds) {
    const outcome = await playRound(ctx, game, round);
    if (runId !== ctx.runId || outcome === null) return ctx.goHome();
    const ev = await showResult(ctx, game, round, outcome);
    if (runId !== ctx.runId) return;
    game.results.push({ round, ev });
    game.total += ev.total;
  }
  showFinal(ctx, game);
};

ctx.sharedGame = readHash();
showTitle(ctx);
