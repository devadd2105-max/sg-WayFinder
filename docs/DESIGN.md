# Design notes

## Look
Singapore wayfinding signage: dark ink sign boards, MRT line-colour accents, a line-diagram hero on the title screen, transit-style route lines. Reduced motion is respected.

## Travel model (`js/model.js`)
- Walk 5 km/h. MRT 38 km/h on a 1.15 detour factor, plus a 6 min wait and a transfer allowance of 4 min per 12 km. Bus 17 km/h + 7 min wait. Taxi 34 km/h + 5 min.
- Five time-of-day scenarios scale road speeds, waits and the taxi surcharge.
- Journey value = minutes + 1.5 × S$ of fare. Budget by difficulty: relaxed S$14, standard S$10, expert S$8.

## Scoring (`js/scoring.js`)
- Location: `1000·exp(−max(0, d−75)/3000)` with d in metres.
- Prediction: `1000·exp(−3.2·|pred−actual| / max(actual, 5))`, judged against the model time of your own legs.
- Plan: `1000·min(1, refValue/playerValue)²`, where refValue is the best journey from the true start.

### Anti-cheat
If your pin is more than 120 m from the true start, your journey gains a *recovery leg* from the true start to your pin (walk if ≤1.2 km, otherwise a charged taxi). Pinning next to the destination therefore cannot win the plan score.

## Routing (`js/routing.js`)
OSRM is used for geometry and distance only. After 3 failures it pauses for 60 s and uses the offline fallback.
