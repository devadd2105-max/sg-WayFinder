// Scoring. Three parts per round, 1,000 points each.

export const MAX_PER_PART = 1000;
export const MAX_PER_ROUND = MAX_PER_PART * 3;

/** Location: full marks within 75 m, fading with distance (1 km off is about 730). */
export function orientationScore(distanceM) {
  const d = Math.max(0, distanceM - 75);
  return Math.round(MAX_PER_PART * Math.exp(-d / 3000));
}

/** Prediction: relative error against the model time for the player's own route. */
export function predictionScore(predictedMin, actualMin) {
  if (!Number.isFinite(predictedMin) || predictedMin <= 0) return 0;
  const err = Math.abs(predictedMin - actualMin) / Math.max(actualMin, 5);
  return Math.round(MAX_PER_PART * Math.exp(-3.2 * err));
}

/** Plan: how close the whole journey (time plus money) is to the best-value option. */
export function planScore(referenceValue, actualValue) {
  if (!(actualValue > 0)) return 0;
  const ratio = Math.min(1, referenceValue / actualValue);
  return Math.round(MAX_PER_PART * ratio ** 2);
}

export function relativeError(predictedMin, actualMin) {
  return (predictedMin - actualMin) / Math.max(actualMin, 1);
}

const RANKS = [
  { min: 0.8, title: 'Wayfinding legend', line: 'You could do this blindfolded on the 7 am bus.' },
  { min: 0.6, title: 'Seasoned commuter', line: 'You know the island and you know the clock.' },
  { min: 0.4, title: 'Weekend wanderer', line: 'Good instincts. Sharpen the timing.' },
  { min: 0.2, title: 'Tourist with a map', line: 'You got there in the end. Probably.' },
  { min: 0, title: 'Fresh off the plane', line: 'Singapore is smaller than it looks. Try again.' },
];

export function rankFor(totalScore, rounds) {
  const frac = totalScore / (rounds * MAX_PER_ROUND);
  return { fraction: frac, ...RANKS.find((r) => frac >= r.min) };
}
