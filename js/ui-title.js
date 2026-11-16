// Title screen: the line diagram, game options and the Street View key.

import { h, clear, icon, toast } from './dom.js';
import { DIFFICULTIES } from './model.js';
import { saveSettings } from './store.js';
import { loadGoogleMaps, testKey } from './streetview.js';
import { bestScore } from './store.js';
import { dailySeed } from './rng.js';

function segmented({ label, options, value, onChange }) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((opt) =>
    h(
      'button',
      {
        type: 'button',
        class: 'seg',
        role: 'radio',
        'aria-checked': String(opt.value === value),
        onclick: () => {
          buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].value === opt.value)));
          onChange(opt.value);
        },
      },
      h('span', { class: 'seg-title' }, opt.label),
      opt.hint ? h('span', { class: 'seg-hint' }, opt.hint) : null
    )
  );
  group.append(...buttons);
  return group;
}

function lineDiagram() {
  const ns = 'http://www.w3.org/2000/svg';
  const wrap = h('div', { class: 'line-diagram', 'aria-hidden': 'true' });
  wrap.innerHTML = `
    <svg viewBox="0 0 540 620" role="img" focusable="false">
      <g fill="none" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
        <path class="ln ln-1" pathLength="1" stroke="var(--nsl)" d="M470 70 H318 L196 192 V304"/>
        <path class="ln ln-2" pathLength="1" stroke="var(--ewl)" d="M196 304 V330 L288 422 H470"/>
        <path class="ln ln-3" pathLength="1" stroke="var(--dtl)" d="M470 422 V520 L430 560"/>
      </g>
      <g class="stn stn-1"><circle cx="318" cy="70" r="15"/><text x="292" y="22" class="stn-name">Locate</text><text x="292" y="46" class="stn-sub">Where are you?</text></g>
      <g class="stn stn-2"><circle cx="196" cy="248" r="15"/><text x="222" y="240" class="stn-name">Plan</text><text x="222" y="266" class="stn-sub">How do you get there?</text></g>
      <g class="stn stn-3"><circle cx="288" cy="422" r="15"/><text x="130" y="470" class="stn-name">Predict</text><text x="130" y="496" class="stn-sub">How long will it take?</text></g>
      <g class="stn stn-4"><circle cx="470" cy="422" r="15"/></g>
    </svg>`;
  wrap.querySelector('svg').setAttribute('xmlns', ns);
  return wrap;
}

function howToModal() {
  const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': 'how-title' });
  const close = () => dialog.close();
  dialog.append(
    h('div', { class: 'sheet-head' }, h('h2', { id: 'how-title' }, 'How a round works'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('ol', { class: 'how-list' },
      h('li', {}, h('strong', {}, 'Locate. '),
        'You land somewhere in Singapore with no address. Look around, then drop a pin on the map where you think you are. Up to 1,000 points for being close.'),
      h('li', {}, h('strong', {}, 'Plan. '),
        'You get a well-known destination, a time of day and a budget. Build your route leg by leg: walk, MRT, bus or taxi. The game shows distances and fares but never times. Up to 1,000 points for a route close to the best value, where each S$1 counts as 1.5 minutes.'),
      h('li', {}, h('strong', {}, 'Predict. '),
        'Say how long your route will take, waiting included. Up to 1,000 points for landing close to the model time.')),
    h('p', { class: 'fine' },
      'Pin the wrong spot and you start the journey from the real one, so the walk back is added to your plan. Times come from a simple travel model (walking pace, average bus and train speeds, waiting, rush hour) over real street distances. They are estimates, not a live timetable.'),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Got it'))
  );
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  return dialog;
}

function keyBox(ctx) {
  const input = h('input', {
    class: 'text-input', type: 'text', id: 'maps-key', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Paste a Google Maps API key', value: ctx.settings.mapsKey,
  });
  const status = h('p', { class: 'status', role: 'status' });
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };
  const refreshStatus = () =>
    ctx.settings.mapsKey
      ? setStatus('A key is saved. Rounds will use real Street View.', 'ok')
      : setStatus('No key yet, so rounds use an aerial clue. It is fully playable.', '');
  refreshStatus();

  const save = h('button', {
    class: 'btn btn-quiet', type: 'button',
    onclick: async () => {
      const key = input.value.trim();
      if (!key) {
        ctx.settings = saveSettings({ mapsKey: '' });
        refreshStatus();
        return;
      }
      save.disabled = true;
      setStatus('Testing the key…');
      try {
        await testKey(key);
        ctx.settings = saveSettings({ mapsKey: key });
        setStatus('Street View is on. The key is kept in this browser only.', 'ok');
      } catch (err) {
        ctx.settings = saveSettings({ mapsKey: '' });
        setStatus(err.message, 'bad');
      } finally {
        save.disabled = false;
      }
    },
  }, 'Save and test');

  const remove = h('button', {
    class: 'btn btn-quiet', type: 'button',
    onclick: () => {
      input.value = '';
      ctx.settings = saveSettings({ mapsKey: '' });
      refreshStatus();
    },
  }, 'Remove');

  return h('details', { class: 'drawer' },
    h('summary', {}, icon('key', 18), h('span', {}, 'Real Street View')),
    h('div', { class: 'drawer-body' },
      h('p', { class: 'fine' },
        'Street View needs your own Google Maps key (in Google Cloud: create a key, enable the Maps JavaScript API, and restrict it to this site). The key stays in this browser and goes only to Google.'),
      h('label', { class: 'field-label', for: 'maps-key' }, 'API key'),
      h('div', { class: 'key-row' }, input, save, remove),
      status));
}

export function showTitle(ctx) {
  const root = clear(ctx.root);
  const s = ctx.settings;
  const how = howToModal();
  const today = dailySeed();

  const bestFor = () => bestScore(`${today}|${ctx.settings.difficulty}`);
  const dailyBest = h('span', { class: 'btn-note' });
  const refreshBest = () => {
    const b = bestFor();
    dailyBest.textContent = b ? `Your best today: ${b.toLocaleString()}` : 'Same five trips for everyone, all day';
  };
  refreshBest();

  const diff = segmented({
    label: 'Difficulty',
    value: s.difficulty,
    options: Object.values(DIFFICULTIES).map((d) => ({ value: d.id, label: d.label, hint: d.blurb })),
    onChange: (v) => {
      ctx.settings = saveSettings({ difficulty: v });
      refreshBest();
    },
  });
  const rounds = segmented({
    label: 'Rounds', value: s.rounds,
    options: [3, 5, 10].map((n) => ({ value: n, label: String(n) })),
    onChange: (v) => (ctx.settings = saveSettings({ rounds: v })),
  });
  const timer = segmented({
    label: 'Round timer', value: s.timer,
    options: [
      { value: 0, label: 'Off' },
      { value: 240, label: '4 min' },
      { value: 120, label: '2 min' },
    ],
    onChange: (v) => (ctx.settings = saveSettings({ timer: v })),
  });

  const actions = h('div', { class: 'actions' });
  if (ctx.sharedGame) {
    const g = ctx.sharedGame;
    actions.append(
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.startGame({ ...g, label: 'Shared game' }) },
        'Play the shared game'),
      h('span', { class: 'btn-note' }, `${g.count} rounds on ${DIFFICULTIES[g.difficulty].label}`)
    );
  }
  actions.append(
    h('button', {
      class: ctx.sharedGame ? 'btn btn-secondary' : 'btn btn-primary', type: 'button',
      onclick: () => ctx.startGame({ seed: today, difficulty: ctx.settings.difficulty, count: 5, label: `Daily ${today.slice(6)}`, daily: true }),
    }, "Play today's challenge"),
    dailyBest,
    h('button', {
      class: 'btn btn-secondary', type: 'button',
      onclick: () => ctx.startGame({ seed: null, difficulty: ctx.settings.difficulty, count: ctx.settings.rounds, label: 'Free play' }),
    }, 'Free play')
  );

  root.append(
    h('main', { class: 'screen title-screen' },
      h('div', { class: 'title-grid' },
        h('div', { class: 'title-copy' },
          h('h1', { class: 'wordmark' }, 'SG Wayfinder'),
          h('p', { class: 'lede' },
            'You are dropped somewhere in Singapore, no address given. Work out where you are, plan the way to a landmark on a budget, and say how long it will take.'),
          actions,
          h('div', { class: 'options' },
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Difficulty'), diff),
            h('div', { class: 'field-row' },
              h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Free play rounds'), rounds),
              h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Round timer'), timer))),
          keyBox(ctx),
          h('button', { class: 'link-btn', type: 'button', onclick: () => how.showModal() }, 'How scoring works')),
        lineDiagram()),
      h('footer', { class: 'foot' },
        'Map data © OpenStreetMap contributors, tiles © CARTO. Travel times are model estimates. Not affiliated with any transport operator.')),
    how
  );

  // Preload the Maps script in the background if a key exists, so round 1 is quick.
  if (ctx.settings.mapsKey) loadGoogleMaps(ctx.settings.mapsKey).catch(() => toast('The saved Google Maps key did not load. Rounds will use aerial clues.', { kind: 'warn', ms: 5000 }));
}
