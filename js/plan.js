// The route the player is building. Pure logic, no DOM.
//
// A route is a list of "steps". A step is one click on the map and produces one
// or more legs: an MRT click, for example, adds the walk to the boarding
// station (marked auto) and the train leg itself.

import { haversine, nearestOf } from './geo.js';
import { STATIONS } from './data/stations.js';
import { MODES, legCost } from './model.js';

export const FINISH_RADIUS_M = 200;
export const MIN_LEG_M = 40;
export const MAX_LEGS = 14;
export const STATION_SNAP_M = 700;
export const STATION_ACCESS_M = 900;

const round2 = (x) => Math.round(x * 100) / 100;
const ll = (p) => ({ lat: p.lat, lng: p.lng });
const fail = (reason) => ({ ok: false, reason });

export function snapStation(p, maxM) {
  const n = nearestOf(p, STATIONS);
  return n && n.distance <= maxM ? n : null;
}

export class Plan {
  constructor({ start, destination, budget, scenario }) {
    this.start = ll(start);
    this.destination = ll(destination);
    this.budget = budget;
    this.scenario = scenario;
    this.steps = [];
  }

  get legs() {
    return this.steps.flat();
  }
  get position() {
    const legs = this.legs;
    return legs.length ? legs[legs.length - 1].to : this.start;
  }
  get cost() {
    return round2(this.legs.reduce((sum, l) => sum + l.cost, 0));
  }
  get remaining() {
    return round2(this.budget - this.cost);
  }
  get distanceToFinish() {
    return haversine(this.position, this.destination);
  }
  get complete() {
    return this.legs.length > 0 && this.distanceToFinish <= FINISH_RADIUS_M;
  }

  #leg(mode, from, to, extra = {}) {
    const straightM = haversine(from, to);
    return {
      mode,
      from: ll(from),
      to: ll(to),
      straightM,
      cost: legCost(mode, straightM, this.scenario),
      ...extra,
    };
  }

  /** Try to add a step. Returns { ok, legs } or { ok: false, reason }. */
  addStep(mode, target) {
    if (!MODES[mode]) return fail('Choose how you will travel first.');
    if (this.complete) return fail('You have arrived. Lock in your plan, or undo a step to change it.');

    const from = this.position;
    let legs;

    if (mode === 'rail') {
      const board = snapStation(from, STATION_ACCESS_M);
      if (!board) return fail('No MRT station within 900 m of your last point. Walk closer to one first.');
      const alight = snapStation(target, STATION_SNAP_M);
      if (!alight) return fail('Click within 700 m of an MRT station to get off there.');
      if (board.item === alight.item) return fail('Get off at a different station from where you board.');
      legs = [];
      if (haversine(from, board.item) > MIN_LEG_M) {
        legs.push(this.#leg('walk', from, board.item, { auto: true, toName: board.item.name }));
      }
      legs.push(
        this.#leg('rail', board.item, alight.item, {
          fromName: board.item.name,
          toName: alight.item.name,
        })
      );
    } else {
      if (haversine(from, target) < MIN_LEG_M) return fail('That point is too close to your last one.');
      legs = [this.#leg(mode, from, target)];
    }

    if (this.legs.length + legs.length > MAX_LEGS) return fail(`Routes are limited to ${MAX_LEGS} legs.`);
    const added = round2(legs.reduce((sum, l) => sum + l.cost, 0));
    if (this.cost + added > this.budget + 1e-9) {
      return fail(`That would put you S$${(this.cost + added - this.budget).toFixed(2)} over budget.`);
    }
    this.steps.push(legs);
    return { ok: true, legs };
  }

  undo() {
    return this.steps.pop() ?? null;
  }

  clear() {
    this.steps = [];
  }
}
