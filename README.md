# SG Wayfinder

A Singapore navigation game. You are dropped into Street View somewhere in Singapore with no address and no labels. Then:

1. **Locate** – work out where you are and drop a pin on the map.
2. **Plan** – build a route to a well-known destination using walking, MRT, bus and taxi legs, within a budget.
3. **Predict** – guess how many minutes the journey will take.

Each round is scored on how close your pin is, how efficient your plan is (time and fare), and how accurate your time prediction is. Ranks run from *Fresh off the plane* to *Wayfinding legend*.

No build step, no dependencies. It is a static site (ES modules).

## Run it

```bash
npm run serve      # python3 -m http.server 8080
# open http://localhost:8080
```

Serve it over `http://`; opening `index.html` as a `file://` URL will not work with ES modules.

### Street View (optional Google Maps key)

Without a key the game runs in **practice mode**, using a label-free aerial crop of the start area.
For real Street View:

1. In Google Cloud Console, create an API key and enable the **Maps JavaScript API**.
2. Restrict the key by **HTTP referrer** (e.g. `http://localhost:8080/*` and your Pages URL).
3. Paste it in the key box on the title screen. It is stored only in your browser's localStorage.

## Daily and shared games

Games are seeded. The daily seed uses the Singapore date. Share a game with a URL hash such as `#seed=abc&d=standard&n=3`.

## Tests

```bash
npm test                      # 19 unit tests (node:test): geo, rng, model, scoring, rounds, plan rules, anti-cheat
```

`docs/DESIGN.md` explains the travel model and scoring.

## Honest caveats

- **Travel times are model estimates**, not live data. Public OSRM supplies path distance and geometry only; times come from the game's own model (walk 5 km/h, MRT, bus and taxi speeds, waits, time-of-day scenarios). Fares are rough.
- **Station and destination coordinates are approximate** (~110 stations, 37 landmarks, ~55 start zones).
- If the routing service is unreachable the game falls back to straight-line distance with a detour factor.

## Attribution

Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors © [CARTO](https://carto.com/attributions). Routing by the OSRM demo servers at routing.openstreetmap.de. Fonts from Google Fonts. Street View © Google.

## Licence

MIT
