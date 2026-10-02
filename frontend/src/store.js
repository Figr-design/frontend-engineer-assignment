import { useSyncExternalStore } from "react";

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(update) {
      const next = typeof update === "function" ? update(state) : update;
      if (Object.is(next, state)) return;
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const GAP_X = 72;
export const GAP_Y = 80;
export const LABEL_H = 32;
export const COLS = 4;
export const API = "http://localhost:4000";

export function cardOrigin(index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: col * (PREVIEW_W + GAP_X),
    y: row * (LABEL_H + PREVIEW_H + GAP_Y),
  };
}

export function gridSize(count) {
  const n = Math.max(count, 1);
  const rows = Math.ceil(n / COLS);
  const cols = Math.min(COLS, n);
  return {
    width: cols * PREVIEW_W + Math.max(0, cols - 1) * GAP_X,
    height: rows * (LABEL_H + PREVIEW_H) + Math.max(0, rows - 1) * GAP_Y,
  };
}

export const camera = { panX: 36, panY: 28, zoom: 0.34 };
let worldEl = null;
let viewportEl = null;
const zoomListeners = new Set();
let zoomSnap = camera.zoom;

export function bindWorld(el) {
  worldEl = el;
  applyCamera();
}

export function bindViewport(el) {
  viewportEl = el;
}

export function getViewportEl() {
  return viewportEl;
}

export function applyCamera() {
  if (!worldEl) return;
  worldEl.style.left = `${camera.panX}px`;
  worldEl.style.top = `${camera.panY}px`;
  worldEl.style.transform = `scale(${camera.zoom})`;
  worldEl.style.setProperty("--zoom", String(camera.zoom));
}

function emitZoom() {
  applyCamera();
  zoomListeners.forEach((listener) => listener());
}

export function subscribeZoom(listener) {
  zoomListeners.add(listener);
  return () => zoomListeners.delete(listener);
}

export function getZoom() {
  return zoomSnap;
}

export function useZoom() {
  return useSyncExternalStore(subscribeZoom, getZoom, getZoom);
}

export function clampZoom(value) {
  return Math.min(4, Math.max(0.25, value));
}

let panSnap = { x: camera.panX, y: camera.panY };
const panListeners = new Set();

function emitPan() {
  panSnap = { x: camera.panX, y: camera.panY };
  panListeners.forEach((listener) => listener());
}

export function subscribePan(listener) {
  panListeners.add(listener);
  return () => panListeners.delete(listener);
}

export function getPan() {
  return panSnap;
}

export function usePan() {
  return useSyncExternalStore(subscribePan, getPan, getPan);
}

export function setPan(x, y) {
  if (camera.panX === x && camera.panY === y) return;
  camera.panX = x;
  camera.panY = y;
  applyCamera();
  emitPan();
}

export function setZoomAt(nextZoom, panX, panY) {
  camera.zoom = nextZoom;
  camera.panX = panX;
  camera.panY = panY;
  zoomSnap = nextZoom;
  emitZoom();
  emitPan();
}

export function zoomAtClient(clientX, clientY, deltaY) {
  if (!viewportEl) return;
  const vp = viewportEl.getBoundingClientRect();
  const cx = clientX - vp.left;
  const cy = clientY - vp.top;
  const worldX = (cx - camera.panX) / camera.zoom;
  const worldY = (cy - camera.panY) / camera.zoom;
  const next = clampZoom(camera.zoom * Math.exp(-deltaY * 0.0012));
  setZoomAt(next, cx - worldX * next, cy - worldY * next);
}

export function fitCamera(count = screensStore.get().screens.length) {
  if (!viewportEl) return;
  const vp = viewportEl.getBoundingClientRect();
  if (vp.width < 80 || vp.height < 80) return;
  const size = gridSize(count || 1);
  const pad = 32;
  const oneRow = LABEL_H + PREVIEW_H;
  const next = clampZoom(
    Math.min((vp.width - pad) / size.width, (vp.height - pad) / Math.min(size.height, oneRow * 2 + GAP_Y)),
  );
  setZoomAt(next, 16, 12);
}

export const ui = createStore({
  mode: "select",
  activeScreenId: null,
  selection: { screenId: null, eids: [] },
  missingNote: null,
  hover: null,
});

export const screensStore = createStore({
  status: "loading",
  error: null,
  screens: [],
});

export const previewStore = createStore({});

export const inspectorStore = createStore({
  live: [],
  details: { kind: "idle" },
  fault: null,
});

const rectStores = new Map();

export function rectStoreFor(screenId) {
  let store = rectStores.get(screenId);
  if (!store) {
    store = createStore({});
    rectStores.set(screenId, store);
  }
  return store;
}

export const elementMeta = new Map();

export function rememberElement(screenId, info) {
  if (!info?.eid) return;
  elementMeta.set(`${screenId}\0${info.eid}`, {
    name: info.name,
    dataKey: info.dataKey || null,
    hasChildren: Boolean(info.hasChildren),
    tag: info.tag || "",
  });
}

export function readMeta(screenId, eid) {
  return elementMeta.get(`${screenId}\0${eid}`);
}

export const devStore = createStore({ nonce: 0 });

export function pokeDev() {
  devStore.set((state) => ({ nonce: state.nonce + 1 }));
}

export const devFlags = {
  detailsFail: false,
  throwInspector: false,
  throwLayers: false,
  throwBoard: false,
  throwDraw: false,
  throwClick: false,
  throwKey: false,
  throwMessage: false,
  throwTimer: false,
  throwResponse: false,
};
