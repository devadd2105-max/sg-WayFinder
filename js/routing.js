// Street-network routing through the public OpenStreetMap-based OSRM servers.
// Only the path (distance and geometry) is used; time comes from our own model.
// If the service is slow or unreachable we fall back to straight-line distance
// times a detour factor, and say so (source: 'estimate').

import { haversine } from './geo.js';

const PROFILES = {
  foot: { url: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot', detour: 1.3 },
  car: { url: 'https://routing.openstreetmap.de/routed-car/route/v1/driving', detour: 1.35 },
};

export function createRouter({ fetchImpl, timeoutMs = 6000, enabled = true } = {}) {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const cache = new Map();
  let failures = 0;
  let pausedUntil = 0;

  const estimate = (profile, a, b) => ({
    distanceM: haversine(a, b) * PROFILES[profile].detour,
    geometry: [a, b],
    source: 'estimate',
  });

  async function route(profile, a, b) {
    if (!PROFILES[profile]) throw new Error(`Unknown routing profile: ${profile}`);
    const key = `${profile}:${a.lat.toFixed(5)},${a.lng.toFixed(5)}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
    if (cache.has(key)) return cache.get(key);

    const usable = enabled && doFetch && Date.now() >= pausedUntil;
    if (!usable || haversine(a, b) < 20) {
      const result = estimate(profile, a, b);
      return result;
    }

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const url =
        `${PROFILES[profile].url}/${a.lng},${a.lat};${b.lng},${b.lat}` +
        `?overview=full&geometries=geojson`;
      const res = await doFetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const r = data?.routes?.[0];
      if (data?.code !== 'Ok' || !r) throw new Error('No route');
      const result = {
        distanceM: r.distance,
        geometry: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        source: 'osrm',
      };
      failures = 0;
      cache.set(key, result);
      return result;
    } catch {
      failures += 1;
      // After repeated failures stop waiting on a service that is not there.
      if (failures >= 3) pausedUntil = Date.now() + 60_000;
      return estimate(profile, a, b);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { route };
}

/** A router that never touches the network. Used in tests and offline. */
export function createOfflineRouter() {
  return createRouter({ enabled: false });
}

export const profileForMode = (mode) => (mode === 'walk' ? 'foot' : mode === 'bus' || mode === 'taxi' ? 'car' : null);
