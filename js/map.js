// A small slippy map: raster tiles, pan, zoom, markers, lines and circles.
// No dependencies. Labelled maps use OpenStreetMap tiles; label-free maps use Esri World Imagery. Neither needs a key.

import { SG_BOUNDS, SG_CENTER, clamp } from './geo.js';

const TILE = 256;

const TILE_URLS = {
  labels: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  plain: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};

export const TILE_STYLES = { labels: 'labels', plain: 'plain' };

export const ATTRIBUTION = {
  labels: '© OpenStreetMap contributors',
  plain: 'Imagery © Esri, Maxar, Earthstar Geographics',
};

const worldSize = (z) => TILE * 2 ** z;

function project({ lat, lng }, z) {
  const s = worldSize(z);
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * s,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s,
  };
}

function unproject({ x, y }, z) {
  const s = worldSize(z);
  const n = Math.PI - (2 * Math.PI * y) / s;
  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lng: (x / s) * 360 - 180,
  };
}

export const metersPerPixel = (lat, z) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

export class SlippyMap {
  constructor(container, opts = {}) {
    const {
      center = SG_CENTER, zoom = 11, minZoom = 10, maxZoom = 19,
      style = 'labels', interactive = true, controls = true, attribution = true,
    } = opts;
    this.container = container;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.style = style;
    this.interactive = interactive;
    this.center = { ...center };
    this.zoom = zoom;
    this.size = { w: 0, h: 0 };
    this.tiles = new Map();
    this.markers = new Set();
    this.shapes = new Set();
    this.listeners = { click: [], hover: [], view: [] };
    this.pointers = new Map();
    this.lastWheel = 0;

    container.classList.add('slippy');
    this.tilesEl = document.createElement('div');
    this.tilesEl.className = 'slippy-tiles';
    this.svg = svgEl('svg', { class: 'slippy-svg' });
    this.markersEl = document.createElement('div');
    this.markersEl.className = 'slippy-markers';
    container.append(this.tilesEl, this.svg, this.markersEl);

    if (attribution) {
      const a = document.createElement('div');
      a.className = 'slippy-attribution';
      this.attributionEl = a;
      a.textContent = ATTRIBUTION[this.style] ?? ATTRIBUTION.labels;
      container.append(a);
    }
    if (interactive && controls) this.#buildControls();
    if (interactive) this.#bindInput();
    else container.classList.add('is-static');

    this.resizeObserver = new ResizeObserver(() => this.invalidateSize());
    this.resizeObserver.observe(container);
    this.invalidateSize();
  }

  // ---- coordinates -------------------------------------------------------

  #topLeft() {
    const c = project(this.center, this.zoom);
    return { x: c.x - this.size.w / 2, y: c.y - this.size.h / 2 };
  }

  latLngToPoint(ll) {
    const p = project(ll, this.zoom);
    const tl = this.#topLeft();
    return { x: p.x - tl.x, y: p.y - tl.y };
  }

  pointToLatLng(pt) {
    const tl = this.#topLeft();
    return unproject({ x: pt.x + tl.x, y: pt.y + tl.y }, this.zoom);
  }

  // ---- view --------------------------------------------------------------

  #clampCenter(c) {
    const pad = 0.04;
    return {
      lat: clamp(c.lat, SG_BOUNDS.south - pad, SG_BOUNDS.north + pad),
      lng: clamp(c.lng, SG_BOUNDS.west - pad, SG_BOUNDS.east + pad),
    };
  }

  setView(center, zoom = this.zoom) {
    this.zoom = clamp(Math.round(zoom), this.minZoom, this.maxZoom);
    this.center = this.#clampCenter(center);
    this.render();
  }

  setStyle(style) {
    if (style === this.style) return;
    this.style = style;
    if (this.attributionEl) this.attributionEl.textContent = ATTRIBUTION[style] ?? ATTRIBUTION.labels;
    for (const t of this.tiles.values()) t.remove();
    this.tiles.clear();
    this.render();
  }

  fitBounds(points, padding = 48, maxZoom = 17) {
    if (!points.length) return;
    const { w, h } = this.size;
    let z = Math.min(maxZoom, this.maxZoom);
    for (; z > this.minZoom; z--) {
      const ps = points.map((p) => project(p, z));
      const dx = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
      const dy = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
      if (dx <= w - 2 * padding && dy <= h - 2 * padding) break;
    }
    const ps = points.map((p) => project(p, z));
    const mid = {
      x: (Math.max(...ps.map((p) => p.x)) + Math.min(...ps.map((p) => p.x))) / 2,
      y: (Math.max(...ps.map((p) => p.y)) + Math.min(...ps.map((p) => p.y))) / 2,
    };
    this.setView(unproject(mid, z), z);
  }

  zoomBy(delta, aroundPoint) {
    const next = clamp(this.zoom + delta, this.minZoom, this.maxZoom);
    if (next === this.zoom) return;
    const anchor = aroundPoint ?? { x: this.size.w / 2, y: this.size.h / 2 };
    const anchorLL = this.pointToLatLng(anchor);
    this.zoom = next;
    // Keep the geographic point under the anchor fixed on screen.
    const a = project(anchorLL, next);
    const c = { x: a.x - (anchor.x - this.size.w / 2), y: a.y - (anchor.y - this.size.h / 2) };
    this.center = this.#clampCenter(unproject(c, next));
    this.render();
  }

  panBy(dx, dy) {
    const c = project(this.center, this.zoom);
    this.center = this.#clampCenter(unproject({ x: c.x - dx, y: c.y - dy }, this.zoom));
    this.render();
  }

  invalidateSize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.render();
  }

  // ---- events ------------------------------------------------------------

  on(type, fn) {
    this.listeners[type].push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  #emit(type, payload) {
    for (const fn of this.listeners[type]) fn(payload);
  }

  #bindInput() {
    const c = this.container;
    c.tabIndex = 0;
    let down = null;

    const local = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.slippy-controls')) return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      down = { ...local(e), t: performance.now(), moved: 0, pinch: this.pointers.size > 1 };
      if (this.pointers.size === 2) this.pinchBase = this.#pinchDistance();
    });

    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') this.#queueHover(p);
        return;
      }
      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const d = this.#pinchDistance();
        const ratio = d / (this.pinchBase || d);
        if (ratio > 1.6 || ratio < 0.62) {
          const mid = this.#pinchMid();
          this.zoomBy(ratio > 1 ? 1 : -1, mid);
          this.pinchBase = d;
        }
        if (down) down.pinch = true;
        return;
      }
      if (down) down.moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      if (down && down.moved > 4) {
        c.classList.add('is-dragging');
        this.panBy(p.x - prev.x, p.y - prev.y);
      }
    });

    const end = (e) => {
      const p = local(e);
      this.pointers.delete(e.pointerId);
      c.classList.remove('is-dragging');
      if (down && !down.pinch && this.pointers.size === 0 && e.type === 'pointerup') {
        const quick = performance.now() - down.t < 700;
        if (down.moved <= 4 && quick) this.#emit('click', { latlng: this.pointToLatLng(p), point: p });
      }
      if (this.pointers.size === 0) down = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.#emit('hover', null);
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastWheel < 160) return;
        this.lastWheel = now;
        this.zoomBy(e.deltaY < 0 ? 1 : -1, local(e));
      },
      { passive: false }
    );

    c.addEventListener('dblclick', (e) => {
      if (e.target.closest('.slippy-controls')) return;
      this.zoomBy(1, local(e));
    });

    c.addEventListener('keydown', (e) => {
      const step = 90;
      const keys = {
        ArrowLeft: () => this.panBy(step, 0), ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step), ArrowDown: () => this.panBy(0, -step),
        '+': () => this.zoomBy(1), '=': () => this.zoomBy(1), '-': () => this.zoomBy(-1),
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
    });
  }

  #pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  #pinchMid() {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  #queueHover(p) {
    this.hoverPoint = p;
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      this.#emit('hover', this.pointToLatLng(this.hoverPoint));
    });
  }

  #buildControls() {
    const mk = (label, text, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slippy-btn';
      b.setAttribute('aria-label', label);
      b.textContent = text;
      b.addEventListener('click', fn);
      return b;
    };
    const wrap = document.createElement('div');
    wrap.className = 'slippy-controls';
    wrap.append(mk('Zoom in', '+', () => this.zoomBy(1)), mk('Zoom out', '–', () => this.zoomBy(-1)));
    this.container.append(wrap);
  }

  // ---- layers ------------------------------------------------------------

  /**
   * Add a marker. `content` is an element or HTML string placed inside a
   * wrapper; CSS decides where the anchor sits (see .map-marker rules).
   */
  addMarker({ position, content, className = '', zIndex = 1 }) {
    const el = document.createElement('div');
    el.className = `map-marker ${className}`.trim();
    el.style.zIndex = zIndex;
    if (typeof content === 'string') el.innerHTML = content;
    else if (content) el.append(content);
    this.markersEl.append(el);
    const marker = {
      el,
      position,
      setPosition: (p) => {
        marker.position = p;
        this.#placeMarker(marker);
      },
      setVisible: (v) => el.classList.toggle('is-hidden', !v),
      remove: () => {
        el.remove();
        this.markers.delete(marker);
      },
    };
    this.markers.add(marker);
    this.#placeMarker(marker);
    return marker;
  }

  #placeMarker(m) {
    const p = this.latLngToPoint(m.position);
    m.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }

  /** Polyline with a light casing underneath so it reads on any map. */
  addPolyline({ points, color = '#d5382e', width = 5, dash = null, opacity = 1, casing = true }) {
    const g = svgEl('g');
    const casingPath = casing
      ? svgEl('path', { class: 'casing', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      : null;
    const line = svgEl('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    if (casingPath) g.append(casingPath);
    g.append(line);
    this.svg.append(g);
    const shape = {
      type: 'line', points, color, width, dash, opacity, g, line, casingPath,
      setPoints: (pts) => {
        shape.points = pts;
        this.#drawShape(shape);
      },
      remove: () => {
        g.remove();
        this.shapes.delete(shape);
      },
    };
    this.shapes.add(shape);
    this.#drawShape(shape);
    return shape;
  }

  addCircle({ center, radiusM, color = '#009645', fill = 'rgba(0,150,69,.14)', width = 2.5, dash = '6 5' }) {
    const c = svgEl('circle', { fill, stroke: color, 'stroke-width': width });
    if (dash) c.setAttribute('stroke-dasharray', dash);
    this.svg.append(c);
    const shape = {
      type: 'circle', center, radiusM, el: c,
      remove: () => {
        c.remove();
        this.shapes.delete(shape);
      },
    };
    this.shapes.add(shape);
    this.#drawShape(shape);
    return shape;
  }

  #drawShape(s) {
    if (s.type === 'circle') {
      const p = this.latLngToPoint(s.center);
      const r = s.radiusM / metersPerPixel(s.center.lat, this.zoom);
      s.el.setAttribute('cx', p.x.toFixed(1));
      s.el.setAttribute('cy', p.y.toFixed(1));
      s.el.setAttribute('r', Math.max(2, r).toFixed(1));
      return;
    }
    const d = s.points
      .map((pt, i) => {
        const p = this.latLngToPoint(pt);
        return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join('');
    s.line.setAttribute('d', d);
    s.line.setAttribute('stroke', s.color);
    s.line.setAttribute('stroke-width', s.width);
    s.line.setAttribute('stroke-opacity', s.opacity);
    if (s.dash) s.line.setAttribute('stroke-dasharray', s.dash);
    else s.line.removeAttribute('stroke-dasharray');
    if (s.casingPath) {
      s.casingPath.setAttribute('d', d);
      s.casingPath.setAttribute('stroke-width', s.width + 3);
    }
  }

  clearLayers() {
    for (const m of [...this.markers]) m.remove();
    for (const s of [...this.shapes]) s.remove();
  }

  // ---- rendering ---------------------------------------------------------

  render() {
    const { w, h } = this.size;
    if (!w || !h) return;
    this.#renderTiles();
    for (const s of this.shapes) this.#drawShape(s);
    for (const m of this.markers) this.#placeMarker(m);
    this.#emit('view', { zoom: this.zoom, center: this.center });
  }

  #renderTiles() {
    const tl = this.#topLeft();
    const { w, h } = this.size;
    const z = this.zoom;
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor(tl.x / TILE));
    const x1 = Math.min(n - 1, Math.floor((tl.x + w) / TILE));
    const y0 = Math.max(0, Math.floor(tl.y / TILE));
    const y1 = Math.min(n - 1, Math.floor((tl.y + h) / TILE));
    const wanted = new Set();

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${this.style}/${z}/${x}/${y}`;
        wanted.add(key);
        let img = this.tiles.get(key);
        if (!img) {
          img = document.createElement('img');
          img.className = 'slippy-tile';
          img.alt = '';
          img.draggable = false;
          img.decoding = 'async';
          img.addEventListener('load', () => img.classList.add('ready'));
          img.src = TILE_URLS[this.style](z, x, y);
          this.tilesEl.append(img);
          this.tiles.set(key, img);
        }
        img.style.transform = `translate(${(x * TILE - tl.x).toFixed(1)}px, ${(y * TILE - tl.y).toFixed(1)}px)`;
      }
    }
    for (const [key, img] of this.tiles) {
      if (!wanted.has(key)) {
        img.remove();
        this.tiles.delete(key);
      }
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.container.replaceChildren();
    this.container.classList.remove('slippy', 'is-static', 'is-dragging');
    this.listeners = { click: [], hover: [], view: [] };
  }
}
