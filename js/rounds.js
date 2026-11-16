// Builds the list of rounds for a game from a seed. Same seed, same game.

import { createRng } from './rng.js';
import { haversine, offsetPoint } from './geo.js';
import { STARTS } from './data/starts.js';
import { DESTINATIONS } from './data/destinations.js';
import { DIFFICULTIES, SCENARIOS } from './model.js';

export const JITTER_M = 150;

export function makeRounds({ seed, difficulty = 'standard', count = 5 }) {
  const diff = DIFFICULTIES[difficulty] ?? DIFFICULTIES.standard;
  const rng = createRng(`${seed}|${diff.id}`);
  const starts = rng.shuffle(STARTS);
  const usedDestinations = new Set();
  const rounds = [];

  for (let i = 0; i < count; i++) {
    const startZone = starts[i % starts.length];
    let lo = Math.max(1000, diff.minKm * 1000);
    let hi = diff.maxKm * 1000;
    let pool = [];
    for (let attempt = 0; attempt < 8 && pool.length === 0; attempt++) {
      pool = DESTINATIONS.filter((d) => {
        if (usedDestinations.has(d.id)) return false;
        const dist = haversine(startZone, d);
        return dist >= lo && dist <= hi;
      });
      lo = Math.max(900, lo * 0.85);
      hi *= 1.2;
    }
    if (pool.length === 0) {
      pool = DESTINATIONS.filter((d) => !usedDestinations.has(d.id) && haversine(startZone, d) >= 900);
    }
    const destination = rng.pick(pool);
    usedDestinations.add(destination.id);

    const point = offsetPoint(startZone, rng.float(0, 360), rng.float(0, JITTER_M));
    rounds.push({
      index: i,
      zone: startZone,
      start: point,
      heading: Math.round(rng.float(0, 360)),
      destination,
      scenario: rng.pick(SCENARIOS),
      budget: diff.budget,
      difficulty: diff.id,
    });
  }
  return rounds;
}
