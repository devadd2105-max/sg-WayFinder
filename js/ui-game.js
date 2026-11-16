// One round of play: look around, drop a pin, build a route, predict the time.

import { h, clear, icon, toast } from './dom.js';
import { SlippyMap } from './map.js';
import { createView } from './streetview.js';
import { Plan, FINISH_RADIUS_M, STATION_SNAP_M, snapStation } from './plan.js';
import { MODES, MODE_ORDER, DIFFICULTIES } from './model.js';
import { STATIONS } from './data/stations.js';
import { CATEGORY_LABELS } from './data/destinations.js';
import { clockAfter, formatDistance, formatMoney } from './geo.js';

const MODE_HINT = { walk: 'Free', rail: 'S$1.10 to 2.40', bus: 'S$0.90 to 2.30', taxi: 'From about S$4' };
const MODE_HELP = {
  walk: 'Click where you want to walk to.',
  rail: 'Click near the station where you will get off (zoom in to see stations). The walk to your first station is added for you.',
  bus: 'Click where you will get off. Bus stops are not modelled, so assume one is close by.',
  taxi: 'Click where you want to be dropped off. Door to door, but you pay for it.',
};
const CATEGORY_ICON = {
  landmark: 'flag', mall: 'wallet', food: 'pin', nature: 'pin', culture: 'flag', transport: 'rail', campus: 'flag',
};
const STEP_DEFS = [
  { id: 'locate', label: 'Locate' },
  { id: 'plan', label: 'Plan' },
  { id: 'predict', label: 'Predict' },
];

const SG_VIEW = [
  { lat: 1.2, lng: 103.62 },
  { lat: 1.47, lng: 104.03 },
];

const pinMarker = (label, cls) =>
  h('div', { class: `pin ${cls}` }, h('span', { class: 'pin-body' }), h('span', { class: 'pin-label' }, label));

const flagMarker = (name) =>
  h('div', { class: 'flag' }, h('span', { class: 'flag-pole' }), h('span', { class: 'flag-label' }, name));

/**
 * Play one round. Resolves with what the player did, or null if they left.
 */
export function playRound(ctx, game, round) {
  return new Promise((resolve) => {
    const diff = DIFFICULTIES[round.difficulty];
    const scenario = round.scenario;
    const destination = round.destination;

    let stage = 'locate';
    let guess = null;
    let mode = 'walk';
    let prediction = 30;
    let plan = null;
    let trueStart = round.start;
    let viewInfo = null;
    let finished = false;
    let timerId = null;
    let guessMarker = null;
    let stationMarks = null;
    let hoverTarget = null;
    let routeLayers = [];
    const cleanups = [];

    // ---- layout ----------------------------------------------------------

    const stepEls = STEP_DEFS.map((s) => h('li', { class: 'step', 'data-state': 'todo' }, h('span', { class: 'step-dot' }), h('span', { class: 'step-name' }, s.label)));
    const timerEl = h('span', { class: 'timer', hidden: !ctx.settings.timer }, icon('clock', 16), h('span', { class: 'timer-text' }, ''));
    const leaveBtn = h('button', { class: 'btn btn-quiet btn-small', type: 'button' }, 'Leave game');

    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'topbar-left' },
        h('span', { class: 'brand-small' }, 'SG Wayfinder'),
        h('span', { class: 'round-count' }, `Round ${round.index + 1} of ${game.rounds.length}`)),
      h('ol', { class: 'steps', 'aria-label': 'Progress through this round' }, ...stepEls),
      h('div', { class: 'topbar-right' },
        h('span', { class: 'score-so-far' }, `${game.total.toLocaleString()} points`),
        timerEl, leaveBtn));

    const svHost = h('div', { class: 'sv-host' }, h('div', { class: 'view-loading' }, h('span', { class: 'spinner' }), 'Dropping you somewhere in Singapore'));
    const startBtn = h('button', { class: 'btn btn-glass btn-small', type: 'button', hidden: true, onclick: () => view.backToStart() }, icon('back', 16), 'Back to where I landed');

    const board = h('div', { class: 'board', role: 'group', 'aria-label': 'Your destination' },
      h('div', { class: 'board-main' },
        h('span', { class: 'board-icon' }, icon(CATEGORY_ICON[destination.category] ?? 'flag', 26)),
        h('div', { class: 'board-text' },
          h('h2', { class: 'board-name' }, destination.name),
          h('p', { class: 'board-sub' }, CATEGORY_LABELS[destination.category]))),
      h('ul', { class: 'board-meta' },
        h('li', {}, icon('clock', 16), `${scenario.label}, ${scenario.clock}`),
        h('li', {}, icon('wallet', 16), `${formatMoney(round.budget)} to spend`)),
      h('p', { class: 'board-note' }, scenario.note));

    const toMapBtn = h('button', { class: 'btn btn-primary pane-toggle', type: 'button', onclick: () => showPane('map') }, icon('pin', 18), 'Open map and plan');
    const toViewBtn = h('button', { class: 'btn btn-glass btn-small pane-toggle', type: 'button', onclick: () => showPane('view') }, icon('eye', 16), 'Back to the view');
    const viewPane = h('section', { class: 'view-pane', 'aria-label': 'Street view' }, svHost, board, startBtn, toMapBtn);
    const mapHost = h('div', { class: 'map-host' });

    // locate panel
    const confirmBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Confirm my location');
    const locatePanel = h('div', { class: 'panel-body' },
      h('p', { class: 'panel-lead' }, 'Where do you think you are?'),
      h('p', { class: 'panel-text' }, 'Look around, then click the map to drop your pin. Click again to move it.'),
      h('div', { class: 'panel-actions' }, confirmBtn));

    // plan panel
    const modeBtns = MODE_ORDER.map((id) =>
      h('button', {
        class: 'mode-btn', type: 'button', role: 'radio', 'data-mode': id, 'aria-checked': String(id === mode),
        onclick: () => setMode(id),
      }, icon(id === 'rail' ? 'rail' : id, 20), h('span', { class: 'mode-name' }, MODES[id].label), h('span', { class: 'mode-hint' }, MODE_HINT[id])));
    const helpEl = h('p', { class: 'panel-text' });
    const legsEl = h('ol', { class: 'legs', 'aria-label': 'Your route so far' });
    const budgetBar = h('span', { class: 'budget-fill' });
    const budgetText = h('span', { class: 'budget-text' });
    const goText = h('span', { class: 'go-text' });
    const undoBtn = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => undo() }, icon('undo', 18), 'Undo last step');
    const repinBtn = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => backToLocate() }, 'Move my pin');
    const continueBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => setStage('predict') }, 'Continue');
    const planPanel = h('div', { class: 'panel-body' },
      h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'How to travel' }, ...modeBtns),
      helpEl,
      legsEl,
      h('div', { class: 'budget' }, h('div', { class: 'budget-track' }, budgetBar), h('div', { class: 'budget-line' }, budgetText, goText)),
      h('div', { class: 'panel-actions' }, repinBtn, undoBtn, continueBtn));

    // predict panel
    const numInput = h('input', { class: 'num-input', type: 'number', min: '1', max: '600', inputmode: 'numeric', 'aria-label': 'Predicted minutes', value: String(prediction) });
    const slider = h('input', { class: 'slider', type: 'range', min: '1', max: '180', step: '1', 'aria-label': 'Predicted minutes slider', value: String(prediction) });
    const arriveEl = h('p', { class: 'arrive' });
    const sumEl = h('p', { class: 'panel-text' });
    const lockBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => finish({ locked: true }) }, 'Lock in my answer');
    const predictPanel = h('div', { class: 'panel-body' },
      h('p', { class: 'panel-lead' }, 'How long will your route take?'),
      sumEl,
      h('div', { class: 'stepper' },
        h('button', { class: 'round-btn', type: 'button', 'aria-label': 'One minute less', onclick: () => setPrediction(prediction - 1) }, icon('minus', 20)),
        h('label', { class: 'num-wrap' }, numInput, h('span', { class: 'num-unit' }, 'min')),
        h('button', { class: 'round-btn', type: 'button', 'aria-label': 'One minute more', onclick: () => setPrediction(prediction + 1) }, icon('plus', 20))),
      slider,
      arriveEl,
      h('p', { class: 'fine' }, 'Count the whole trip: walking to stops, waiting, riding and the last stretch on foot.'),
      h('div', { class: 'panel-actions' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => setStage('plan') }, 'Edit route'),
        lockBtn));

    const panel = h('div', { class: 'panel' }, locatePanel, planPanel, predictPanel);
    const sidePane = h('section', { class: 'side-pane' }, mapHost, panel, toViewBtn);

    const stageEl = h('div', { class: 'stage', 'data-pane': 'view' }, viewPane, sidePane);
    clear(ctx.root).append(h('main', { class: 'screen game-screen' }, topbar, stageEl));

    // ---- map -------------------------------------------------------------

    const map = new SlippyMap(mapHost, { style: diff.mapLabels ? 'labels' : 'plain' });
    cleanups.push(() => map.destroy());
    map.fitBounds(SG_VIEW, 8, 12);
    map.addMarker({ position: destination, content: flagMarker(destination.name), className: 'marker-flag', zIndex: 6 });
    map.addCircle({ center: destination, radiusM: FINISH_RADIUS_M });
    cleanups.push(map.on('view', ({ zoom }) => {
      mapHost.classList.toggle('show-stations', zoom >= 11);
      mapHost.classList.toggle('show-station-names', zoom >= 14);
    }));

    cleanups.push(map.on('click', ({ latlng }) => {
      if (finished) return;
      if (stage === 'locate') {
        placeGuess(latlng);
      } else if (stage === 'plan') {
        const res = plan.addStep(mode, latlng);
        if (!res.ok) {
          toast(res.reason, { kind: 'warn' });
          return;
        }
        if (mode === 'rail') setMode('walk');
        redrawRoute();
        updatePlanUI();
      }
    }));

    cleanups.push(map.on('hover', (ll) => {
      if (stage !== 'plan' || mode !== 'rail' || !stationMarks) return setHoverTarget(null);
      const snap = ll ? snapStation(ll, STATION_SNAP_M) : null;
      setHoverTarget(snap ? snap.item.name : null);
    }));

    function placeGuess(ll) {
      guess = { lat: ll.lat, lng: ll.lng };
      if (!guessMarker) guessMarker = map.addMarker({ position: guess, content: pinMarker('You', 'pin-you'), className: 'marker-pin', zIndex: 8 });
      else guessMarker.setPosition(guess);
      confirmBtn.disabled = false;
    }

    function ensureStations() {
      if (stationMarks) return;
      stationMarks = STATIONS.map((st) => ({
        name: st.name,
        marker: map.addMarker({
          position: st, className: 'station', zIndex: 3,
          content: h('span', { class: 'station-chip' }, h('span', { class: 'station-dot' }), h('span', { class: 'station-label' }, st.name)),
        }),
      }));
    }
    function showStations(on) {
      if (on) ensureStations();
      stationMarks?.forEach(({ marker }) => marker.setVisible(on));
      if (!on) setHoverTarget(null);
    }
    function setHoverTarget(name) {
      if (hoverTarget === name) return;
      hoverTarget = name;
      stationMarks?.forEach(({ name: n, marker }) => marker.el.classList.toggle('is-target', n === name));
    }

    function redrawRoute() {
      routeLayers.forEach((l) => l.remove());
      routeLayers = [];
      if (!plan) return;
      for (const leg of plan.legs) {
        routeLayers.push(map.addPolyline({
          points: [leg.from, leg.to], color: MODES[leg.mode].color,
          width: leg.mode === 'walk' ? 6 : 7, dash: leg.mode === 'walk' ? '0.1 11' : null,
        }));
        routeLayers.push(map.addMarker({ position: leg.to, content: h('span', { class: 'route-node' }), className: 'marker-node', zIndex: 5 }));
      }
    }

    // ---- stages ----------------------------------------------------------

    function setStage(next) {
      stage = next;
      locatePanel.hidden = next !== 'locate';
      planPanel.hidden = next !== 'plan';
      predictPanel.hidden = next !== 'predict';
      const order = STEP_DEFS.map((s) => s.id);
      stepEls.forEach((el, i) => {
        el.dataset.state = i < order.indexOf(next) ? 'done' : i === order.indexOf(next) ? 'current' : 'todo';
      });
      if (next === 'locate') {
        showStations(false);
        if (!guess) map.fitBounds(SG_VIEW, 8, 12);
      }
      if (next === 'plan') {
        if (!plan) plan = new Plan({ start: guess, destination, budget: round.budget, scenario });
        showStations(mode === 'rail');
        map.fitBounds([guess, destination], 70, 16);
        redrawRoute();
        updatePlanUI();
      }
      if (next === 'predict') {
        showStations(false);
        const legs = plan.legs;
        const dist = legs.reduce((s, l) => s + l.straightM * MODES[l.mode].detour, 0);
        sumEl.textContent = `Your route has ${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}, about ${formatDistance(dist)} and ${formatMoney(plan.cost)} in fares. Times are not shown.`;
        setPrediction(prediction);
      }
      sidePane.dataset.stage = next;
    }

    function showPane(which) {
      stageEl.dataset.pane = which;
      if (which === 'map') {
        map.invalidateSize();
        refit();
      }
    }

    /** Frame the map for the current stage. Needed after the map has been hidden. */
    function refit() {
      if (stage === 'plan' && guess) map.fitBounds([guess, destination], 70, 16);
      else if (stage === 'locate' && guess) map.fitBounds([guess, destination], 70, 16);
      else if (stage === 'locate') map.fitBounds(SG_VIEW, 8, 12);
    }

    function backToLocate() {
      if (plan?.legs.length && !confirmRepin()) return;
      plan = null;
      redrawRoute();
      setStage('locate');
    }
    let repinArmed = 0;
    function confirmRepin() {
      if (Date.now() - repinArmed < 3500) return true;
      repinArmed = Date.now();
      toast('Moving your pin clears your route. Press again to confirm.', { kind: 'warn' });
      return false;
    }

    function setMode(id) {
      mode = id;
      modeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === id)));
      showStations(stage === 'plan' && id === 'rail');
      helpEl.textContent = MODE_HELP[id];
    }

    function undo() {
      if (!plan?.undo()) return;
      redrawRoute();
      updatePlanUI();
    }

    function updatePlanUI() {
      helpEl.textContent = MODE_HELP[mode];
      clear(legsEl);
      for (const leg of plan.legs) {
        const km = formatDistance(leg.straightM * MODES[leg.mode].detour);
        const text =
          leg.mode === 'rail' ? `MRT from ${leg.fromName} to ${leg.toName}, about ${km}`
          : leg.mode === 'walk' && leg.toName ? `Walk to ${leg.toName} station, about ${km}`
          : `${MODES[leg.mode].label}, about ${km}`;
        legsEl.append(h('li', { class: 'leg', 'data-mode': leg.mode },
          h('span', { class: 'leg-badge' }, icon(leg.mode, 16)),
          h('span', { class: 'leg-text' }, text),
          h('span', { class: 'leg-cost' }, leg.cost ? formatMoney(leg.cost) : 'Free')));
      }
      if (!plan.legs.length) legsEl.append(h('li', { class: 'leg-empty' }, 'No legs yet. Pick a way to travel and click the map.'));
      legsEl.scrollTop = legsEl.scrollHeight;

      budgetBar.style.width = `${Math.min(100, (plan.cost / plan.budget) * 100)}%`;
      budgetText.textContent = `${formatMoney(plan.cost)} of ${formatMoney(plan.budget)} spent`;
      goText.textContent = plan.complete
        ? 'You have arrived'
        : `${formatDistance(plan.distanceToFinish)} from the destination`;
      undoBtn.disabled = plan.steps.length === 0;
      continueBtn.disabled = !plan.complete;
      continueBtn.textContent = plan.complete ? 'Continue to prediction' : `Get within ${FINISH_RADIUS_M} m to continue`;
      modeBtns.forEach((b) => (b.disabled = plan.complete));
    }

    function setPrediction(v) {
      prediction = Math.max(1, Math.min(600, Math.round(Number(v) || 1)));
      numInput.value = String(prediction);
      slider.value = String(Math.min(180, prediction));
      arriveEl.textContent = `You would arrive around ${clockAfter(scenario.startMinutes, prediction)}.`;
    }
    numInput.addEventListener('input', () => {
      const v = Number(numInput.value);
      if (v >= 1) {
        prediction = Math.min(600, Math.round(v));
        slider.value = String(Math.min(180, prediction));
        arriveEl.textContent = `You would arrive around ${clockAfter(scenario.startMinutes, prediction)}.`;
      }
    });
    numInput.addEventListener('change', () => setPrediction(numInput.value));
    slider.addEventListener('input', () => setPrediction(slider.value));

    confirmBtn.addEventListener('click', () => {
      if (guess) setStage('plan');
    });

    // ---- finishing -------------------------------------------------------

    let leaveArmed = 0;
    leaveBtn.addEventListener('click', () => {
      if (Date.now() - leaveArmed < 3500) return end(null);
      leaveArmed = Date.now();
      leaveBtn.textContent = 'Press again to leave';
    });

    function finish({ locked = false, timedOut = false } = {}) {
      const complete = !!plan?.complete;
      end({
        trueStart,
        guess,
        legs: plan?.legs ?? [],
        complete,
        predictionMin: complete && (locked || stage === 'predict') ? prediction : null,
        timedOut,
        viewMode: viewInfo?.mode ?? 'practice',
      });
    }

    function end(outcome) {
      if (finished) return;
      finished = true;
      clearInterval(timerId);
      cleanups.forEach((fn) => fn());
      view.destroy();
      resolve(outcome);
    }

    function startTimer() {
      if (!ctx.settings.timer) return;
      const deadline = Date.now() + ctx.settings.timer * 1000;
      const label = timerEl.querySelector('.timer-text');
      const tick = () => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        label.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        timerEl.classList.toggle('is-low', left <= 20);
        if (left <= 0) {
          toast('Time is up. Scoring what you have.', { kind: 'warn' });
          finish({ timedOut: true });
        }
      };
      tick();
      timerId = setInterval(tick, 500);
    }

    // ---- go --------------------------------------------------------------

    const view = createView(svHost, { mapsKey: ctx.settings.mapsKey });
    setStage('locate');
    setMode('walk');

    view.show(round, { canMove: diff.canMove }).then((info) => {
      if (finished) return;
      viewInfo = info;
      trueStart = info.position;
      startBtn.hidden = !(info.mode === 'streetview' && diff.canMove);
      svHost.querySelector('.view-loading')?.remove();
      if (info.note) toast(info.note, { kind: 'warn', ms: 5000 });
      startTimer();
    });
  });
}
