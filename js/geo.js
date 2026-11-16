// Geometry and formatting helpers. Pure functions, no DOM.

const EARTH_R = 6371008.8; // metres
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Rough bounding box around Singapore's main island and Sentosa. */
export const SG_BOUNDS = { south: 1.15, north: 1.48, west: 103.6, east: 104.1 };
export const SG_CENTER = { lat: 1.3521, lng: 103.8198 };

export function inSingapore(p) {
  return (
    p.lat >= SG_BOUNDS.south &&
    p.lat <= SG_BOUNDS.north &&
    p.lng >= SG_BOUNDS.west &&
    p.lng <= SG_BOUNDS.east
  );
}

/** Great-circle distance in metres. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b in degrees, 0-360. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `meters` from p along `bearingDeg`. */
export function offsetPoint(p, bearingDeg, meters) {
  const d = meters / EARTH_R;
  const brg = rad(bearingDeg);
  const lat1 = rad(p.lat);
  const lng1 = rad(p.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: deg(lat2), lng: deg(lng2) };
}

/** Nearest item to p. `pick` maps an item to its {lat,lng}. */
export function nearestOf(p, items, pick = (x) => x) {
  let best = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = haversine(p, pick(item));
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best ? { item: best, distance: bestD } : null;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '–';
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatMinutes(min) {
  if (!Number.isFinite(min)) return '–';
  const total = Math.max(0, Math.round(min));
  if (total < 1) return 'under 1 min';
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

export function formatMoney(x) {
  return `S$${x.toFixed(2)}`;
}

/** Clock time after adding `addMinutes` to `startMinutes` (minutes since midnight). */
export function clockAfter(startMinutes, addMinutes) {
  const total = Math.round(startMinutes + addMinutes);
  const day = ((total % 1440) + 1440) % 1440;
  const h24 = Math.floor(day / 60);
  const m = day % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}
