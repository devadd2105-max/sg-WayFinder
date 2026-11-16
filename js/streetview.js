// The "where am I?" view. With a Google Maps key it is real Street View, with the
// address and road labels switched off. Without one (or where Street View has
// no imagery) it falls back to an aerial clue: a label-free map crop.

import { SlippyMap } from './map.js';
import { offsetPoint } from './geo.js';

let mapsPromise = null;
let authFailed = false;

/** Load the Maps JavaScript API once. Rejects on a bad key, timeout or network error. */
export function loadGoogleMaps(key) {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Google Maps took too long to load.')), 15000);
    window.gm_authFailure = () => {
      authFailed = true;
      clearTimeout(timer);
      reject(new Error('Google rejected the API key.'));
    };
    window.__sgwMapsReady = () => {
      clearTimeout(timer);
      resolve(window.google.maps);
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__sgwMapsReady`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Could not reach Google Maps.'));
    };
    document.head.append(s);
  }).catch((err) => {
    mapsPromise = null; // allow a retry after the key is fixed
    throw err;
  });
  return mapsPromise;
}

export const hasAuthFailed = () => authFailed;

/** Check a key by loading the API and asking for one known panorama. */
export async function testKey(key) {
  const maps = await loadGoogleMaps(key);
  const svc = new maps.StreetViewService();
  await new Promise((resolve, reject) => {
    svc.getPanorama({ location: { lat: 1.2834, lng: 103.8607 }, radius: 500 }, (_data, status) => {
      if (status === 'OK') resolve();
      else reject(new Error(`Street View answered "${status}". Is the Maps JavaScript API enabled for this key?`));
    });
  });
  return true;
}

/**
 * Create the view inside `container`.
 * Returns { show(round, opts) -> { mode, position }, backToStart(), destroy() }.
 */
export function createView(container, { mapsKey = '' } = {}) {
  let panorama = null;
  let practiceMap = null;
  let startPano = null;
  let mapsApi = null;

  // Drop the previous panorama or practice map but leave the container's current
  // children (such as a loading message) in place until new content replaces them.
  const dispose = () => {
    if (panorama) panorama.setVisible(false);
    panorama = null;
    practiceMap?.destroy();
    practiceMap = null;
    container.classList.remove('is-practice', 'is-streetview');
  };
  const reset = () => {
    dispose();
    container.replaceChildren();
  };

  async function showStreetView(round, { canMove }) {
    mapsApi ??= await loadGoogleMaps(mapsKey);
    const svc = new mapsApi.StreetViewService();
    const data = await new Promise((resolve, reject) => {
      svc.getPanorama(
        {
          location: round.start,
          radius: 400,
          preference: mapsApi.StreetViewPreference.NEAREST,
          source: mapsApi.StreetViewSource.OUTDOOR,
        },
        (d, status) => (status === 'OK' && d ? resolve(d) : reject(new Error(status)))
      );
    });
    if (authFailed) throw new Error('Google rejected the API key.');

    const holder = document.createElement('div');
    holder.className = 'sv-holder';
    container.replaceChildren(holder);
    container.classList.add('is-streetview');

    panorama = new mapsApi.StreetViewPanorama(holder, {
      pano: data.location.pano,
      pov: { heading: round.heading, pitch: 0 },
      zoom: 1,
      visible: true,
      addressControl: false,
      showRoadLabels: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      enableCloseButton: false,
      panControl: false,
      zoomControl: true,
      linksControl: canMove,
      clickToGo: canMove,
    });
    startPano = data.location.pano;
    const ll = data.location.latLng;
    return { mode: 'streetview', position: { lat: ll.lat(), lng: ll.lng() } };
  }

  function showPractice(round) {
    const holder = document.createElement('div');
    holder.className = 'practice-holder';
    container.replaceChildren(holder);
    container.classList.add('is-practice');
    // Show the area around the start with no labels, nudged so the true spot is
    // not dead centre.
    const centre = offsetPoint(round.start, round.heading, 140);
    practiceMap = new SlippyMap(holder, {
      center: centre, zoom: 17, minZoom: 17, maxZoom: 17, style: 'plain',
      interactive: false, attribution: true,
    });
    return { mode: 'practice', position: { ...round.start } };
  }

  return {
    /** Returns { mode, position, note? }. Never throws: it falls back to practice. */
    async show(round, { canMove = true } = {}) {
      dispose();
      if (mapsKey) {
        try {
          return await showStreetView(round, { canMove });
        } catch (err) {
          dispose();
          const result = showPractice(round);
          result.note =
            err.message === 'ZERO_RESULTS'
              ? 'No Street View here, so this round uses an aerial clue.'
              : `Street View unavailable (${err.message}). Using an aerial clue.`;
          return result;
        }
      }
      return showPractice(round);
    },
    backToStart() {
      if (panorama && startPano) panorama.setPano(startPano);
    },
    destroy: reset,
  };
}
