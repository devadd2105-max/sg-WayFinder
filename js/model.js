// The travel model. Every number here is a rough, documented assumption, not
// live data. Change them in one place and the whole game follows.

import { clamp } from './geo.js';

/**
 * speedKmh: average moving speed along the path.
 * waitMin:  average minutes lost to waiting, boarding and walking to a stop.
 * detour:   multiplier from straight-line to path length when no street route
 *           is available (also used for fares and the planner's distances).
 */
export const MODES = {
  walk: { id: 'walk', label: 'Walk', speedKmh: 5, waitMin: 0, detour: 1.3, color: '#6b7a90' },
  rail: { id: 'rail', label: 'MRT', speedKmh: 38, waitMin: 6, detour: 1.15, color: '#d5382e' },
  bus: { id: 'bus', label: 'Bus', speedKmh: 17, waitMin: 7, detour: 1.4, color: '#0b63ce' },
  taxi: { id: 'taxi', label: 'Taxi', speedKmh: 34, waitMin: 5, detour: 1.35, color: '#e89a0c' },
};
export const MODE_ORDER = ['walk', 'rail', 'bus', 'taxi'];

/** Extra minutes added for each 12 km of straight-line MRT travel (interchanges). */
export const TRANSFER_MIN = 4;
export const TRANSFER_EVERY_KM = 12;

/**
 * Time-of-day scenarios.
 * road:  multiplier on bus and taxi speed (below 1 means slower).
 * wait:  multiplier on waiting time per mode.
 * taxiSurcharge: multiplier on the taxi fare.
 */
export const SCENARIOS = [
  {
    id: 'am-peak', label: 'Weekday morning rush', clock: '8:15 am', startMinutes: 8 * 60 + 15,
    note: 'Roads are slow and trains are packed.',
    road: 0.72, wait: { bus: 1.3, rail: 1.2, taxi: 1.6 }, taxiSurcharge: 1.25,
  },
  {
    id: 'midday', label: 'Weekday afternoon', clock: '1:30 pm', startMinutes: 13 * 60 + 30,
    note: 'Quiet roads and regular services.',
    road: 1, wait: { bus: 1, rail: 1, taxi: 1 }, taxiSurcharge: 1,
  },
  {
    id: 'pm-peak', label: 'Weekday evening rush', clock: '6:10 pm', startMinutes: 18 * 60 + 10,
    note: 'Heavy traffic and long queues for taxis.',
    road: 0.68, wait: { bus: 1.35, rail: 1.3, taxi: 1.8 }, taxiSurcharge: 1.25,
  },
  {
    id: 'sunday', label: 'Sunday morning', clock: '10:00 am', startMinutes: 10 * 60,
    note: 'Free-flowing roads, but buses and trains run less often.',
    road: 1.1, wait: { bus: 1.5, rail: 1.3, taxi: 0.8 }, taxiSurcharge: 1,
  },
  {
    id: 'late', label: 'Late night', clock: '11:30 pm', startMinutes: 23 * 60 + 30,
    note: 'Empty roads, thin services and a night taxi surcharge.',
    road: 1.2, wait: { bus: 2, rail: 1.8, taxi: 1 }, taxiSurcharge: 1.5,
  },
];

export const DIFFICULTIES = {
  relaxed: {
    id: 'relaxed', label: 'Relaxed', blurb: 'Shorter trips, bigger budget, labelled map.',
    minKm: 1.5, maxKm: 6, budget: 14, mapLabels: true, canMove: true,
  },
  standard: {
    id: 'standard', label: 'Standard', blurb: 'Cross-town trips and a tighter budget.',
    minKm: 3, maxKm: 13, budget: 10, mapLabels: true, canMove: true,
  },
  expert: {
    id: 'expert', label: 'Expert', blurb: 'Island-wide, label-free map, no walking around.',
    minKm: 7, maxKm: 26, budget: 8, mapLabels: false, canMove: false,
  },
};

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * How many minutes one Singapore dollar is worth when comparing journeys.
 * Without this a taxi would win every trip, even 700 m ones.
 */
export const MINUTES_PER_DOLLAR = 1.5;

/** Minutes plus the money you spent, expressed as minutes. */
export const journeyValue = (minutes, cost) => minutes + MINUTES_PER_DOLLAR * cost;

/** Path length in metres, using a routed distance when one is known. */
export function legDistanceM(mode, straightM, routedM) {
  if (mode === 'rail') return straightM * MODES.rail.detour;
  return Number.isFinite(routedM) ? routedM : straightM * MODES[mode].detour;
}

/** Minutes for one leg under a scenario. */
export function legMinutes(mode, distanceM, scenario, straightM = distanceM) {
  const m = MODES[mode];
  const roadMode = mode === 'bus' || mode === 'taxi';
  const speed = m.speedKmh * (roadMode ? scenario.road : 1);
  const wait = m.waitMin * (scenario.wait[mode] ?? 1);
  let minutes = (distanceM / 1000 / speed) * 60 + wait;
  if (mode === 'rail') {
    minutes += Math.floor(straightM / 1000 / TRANSFER_EVERY_KM) * TRANSFER_MIN;
  }
  return minutes;
}

/**
 * Rough fare in S$. Depends only on straight-line distance so the budget is
 * deterministic and never changes when a routing service answers late.
 */
export function legCost(mode, straightM, scenario) {
  const km = (straightM * MODES[mode].detour) / 1000;
  switch (mode) {
    case 'bus':
      return round2(clamp(0.9 + 0.1 * km, 0.9, 2.3));
    case 'rail':
      return round2(clamp(1.1 + 0.1 * km, 1.1, 2.4));
    case 'taxi':
      return round2((4 + 0.7 * km) * scenario.taxiSurcharge);
    default:
      return 0;
  }
}

export function scenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[1];
}
