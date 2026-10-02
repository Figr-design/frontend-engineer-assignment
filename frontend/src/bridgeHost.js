import { fetchScreens } from "./api.js";
import { broadcast, iframeFor, request, screenIdForSource, send, settleResult } from "./bus.js";
import { arm, failConnect, markReady, notePageError, onNewSession, raisePreview } from "./connections.js";
import { reportFailure } from "./failures.js";
import { failLayers, getLayers, loadChildren, refreshOpenTree } from "./layersModel.js";
import {
  activateScreen,
  clearHover,
  dropMissing,
  moveLayers,
  replaceWith,
  setHover,
  setMode,
  userClearSelection,
} from "./selection.js";
import {
  devFlags,
  devStore,
  inspectorStore,
  pokeDev,
  previewStore,
  rectStoreFor,
  rememberElement,
  screensStore,
  ui,
  zoomAtClient,
} from "./store.js";

let screenGen = 0;
let installed = false;
const rectFlight = new Set();

export async function loadScreens({ fail = 0 } = {}) {
  const gen = ++screenGen;
  screensStore.set((state) => ({ ...state, status: "loading", error: null, fault: null }));
  try {
    const screens = await fetchScreens({ fail });
    if (gen !== screenGen) return;
    if (devFlags.throwResponse) {
      devFlags.throwResponse = false;
      throw new Error("Response handler failed");
    }
    screensStore.set({ status: "ready", error: null, fault: null, screens });
  } catch (error) {
    if (gen !== screenGen || error?.code === "CANCELLED" || error?.name === "AbortError") return;
    screensStore.set((state) => ({
      ...state,
      status: "error",
      error,
      screens: [],
      fault: null,
    }));
    reportFailure(error, { region: "board", screenId: null });
  }
}

export function raiseBoard(error) {
  const state = screensStore.get();
  if (state.fault) return;
  screensStore.set((current) => ({ ...current, fault: error.message || "Something went wrong on the board" }));
  reportFailure(error, { region: "board", screenId: null });
}

export function clearBoardFault() {
  screensStore.set((state) => ({ ...state, fault: null }));
}

function rectsClose(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const key of keys) {
    const a = prev?.[key];
    const b = next?.[key];
    if (!a && !b) continue;
    if (!a || !b) return false;
    if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.w - b.w) > 0.5 || Math.abs(a.h - b.h) > 0.5) {
      return false;
    }
  }
  return true;
}

async function pumpRects(screenId, eids) {
  if (!eids.length || rectFlight.has(screenId)) return;
  if (previewStore.get()[screenId]?.state !== "ready") return;
  rectFlight.add(screenId);
  try {
    const payload = await request(screenId, "rects", { eids }, 1000);
    const store = rectStoreFor(screenId);
    const next = payload?.rects || {};
    if (!rectsClose(store.get(), next)) store.set(next);
    if (payload?.missing?.length) dropMissing(screenId, payload.missing);
  } catch (error) {
    if (error?.code === "BRIDGE") raisePreview(screenId, error);
  } finally {
    rectFlight.delete(screenId);
  }
}

function scheduleGeometry() {
  const state = ui.get();
  if (state.mode !== "select") return;
  const groups = new Map();
  const add = (screenId, eid) => {
    if (!screenId || !eid) return;
    const list = groups.get(screenId) || [];
    if (!list.includes(eid)) list.push(eid);
    groups.set(screenId, list);
  };
  if (state.hover) add(state.hover.screenId, state.hover.eid);
  for (const eid of state.selection.eids) add(state.selection.screenId, eid);
  for (const [screenId, eids] of groups) pumpRects(screenId, eids);
}

function onShortcut(key, shiftKey) {
  if (key === "v" || key === "V") setMode("select");
  else if (key === "i" || key === "I") setMode("interact");
  else if (key === "Escape") {
    userClearSelection();
    clearHover();
  } else if (key === "Enter" || key === "Tab") {
    const state = ui.get();
    if (!state.selection.eids.length || !state.selection.screenId) return;
    const op = key === "Enter" ? (shiftKey ? "parent" : "child") : shiftKey ? "prev" : "next";
    const screenId = state.selection.screenId;
    const eid = state.selection.eids[state.selection.eids.length - 1];
    request(screenId, "relative", { eid, op }, 1000)
      .then((info) => {
        if (!info?.eid) return;
        if (ui.get().selection.screenId !== screenId) return;
        replaceWith(screenId, info);
      })
      .catch((error) => {
        if (error?.code === "BRIDGE") raisePreview(screenId, error);
      });
  }
}

function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

function onKeyDown(event) {
  if (isTypingTarget(event.target)) return;
  if (devFlags.throwKey) {
    devFlags.throwKey = false;
    event.preventDefault();
    const error = new Error("Key handler failed");
    if (event.target.closest?.("[data-layers-tree]")) failLayers(ui.get().activeScreenId, error);
    else raiseBoard(error);
    return;
  }
  const key = event.key;
  const mode = ui.get().mode;
  if (mode === "interact" && (key === "Enter" || key === "Tab")) return;
  if ((key === "v" || key === "V" || key === "i" || key === "I" || key === "Escape" || key === "Enter" || key === "Tab") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.target.closest?.("[data-layers-tree]") && key.startsWith("Arrow")) return;
    event.preventDefault();
    onShortcut(key, event.shiftKey);
  }
}

function onKeyDownArrows(event) {
  if (isTypingTarget(event.target)) return;
  if (!event.target.closest?.("[data-layers-tree]")) return;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  moveLayers(event.key);
}

async function onDomChanged(screenId) {
  const model = getLayers(screenId);
  const state = ui.get();
  const watched = new Set();
  if (model.root.state !== "idle") {
    refreshOpenTree(screenId).catch(() => {});
    for (const eid of model.expanded) watched.add(eid);
    for (const eid of model.rootIds || []) watched.add(eid);
  }
  if (state.selection.screenId === screenId) state.selection.eids.forEach((eid) => watched.add(eid));
  if (state.hover?.screenId === screenId) watched.add(state.hover.eid);
  if (!watched.size) return;
  try {
    const payload = await request(screenId, "audit", { eids: [...watched] }, 1000);
    if (payload?.missing?.length) dropMissing(screenId, payload.missing);
  } catch (error) {
    if (error?.code === "BRIDGE") raisePreview(screenId, error);
  }
}

function onMessage(event) {
  const data = event.data;
  if (!data || data.source !== "figr-page") return;
  const screenId = screenIdForSource(event.source);
  if (!screenId) return;
  if (!screensStore.get().screens.some((screen) => screen.id === screenId) && screensStore.get().status === "ready") {
    return;
  }
  try {
    if (devFlags.throwMessage) {
      devFlags.throwMessage = false;
      throw new Error("Message handler failed");
    }
    if (data.type === "result") {
      settleResult(data.requestId, data);
      return;
    }
    if (data.type === "ready") {
      markReady(screenId, data.session, data.href);
      return;
    }
    if (data.type === "page-error") {
      notePageError(screenId, data.message || "Page error");
      return;
    }
    if (data.type === "bridge-error") {
      raisePreview(screenId, new Error(data.message || "Preview failed"));
      return;
    }
    if (data.type === "scrolled") {
      scheduleGeometry();
      return;
    }
    if (data.type === "dom-changed") {
      onDomChanged(screenId);
      return;
    }
    if (data.type === "zoom-wheel") {
      const iframe = iframeFor(screenId);
      if (!iframe) return;
      const rect = iframe.getBoundingClientRect();
      const sx = rect.width / (iframe.offsetWidth || rect.width || 1);
      const sy = rect.height / (iframe.offsetHeight || rect.height || 1);
      clearHover();
      zoomAtClient(rect.left + data.x * sx, rect.top + data.y * sy, data.deltaY);
      return;
    }
    if (data.type === "shortcut") {
      onShortcut(data.key, data.shiftKey);
    }
  } catch (error) {
    if (screenId) raisePreview(screenId, error);
    else raiseBoard(error);
  }
}

export function installBridge() {
  if (installed) return;
  installed = true;
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keydown", onKeyDownArrows, true);
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener("blur", () => clearHover());
  document.addEventListener("mouseout", (event) => {
    if (!event.relatedTarget) clearHover();
  });
  onNewSession(() => {});
  const tick = () => {
    scheduleGeometry();
    if (devFlags.throwTimer) {
      devFlags.throwTimer = false;
      try {
        throw new Error("Timer failed");
      } catch (error) {
        raiseBoard(error);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function syncMode(mode) {
  broadcast({ type: "mode", mode });
}

export function devCommand(screenId, op) {
  if (!screenId) return;
  send(screenId, { type: "dev", op });
  if (op === "hang-root") loadChildren(screenId, null, { force: true });
  if (op === "mute") {
    previewStore.set((state) => ({
      ...state,
      [screenId]: { ...(state[screenId] || {}), state: "connecting", kind: null, message: null },
    }));
    arm(screenId, { fromLoad: true });
  }
}

export function activeOrFirst() {
  return ui.get().activeScreenId || screensStore.get().screens[0]?.id || null;
}

export function triggerInspectorThrow() {
  devFlags.throwInspector = true;
  pokeDev();
}

export function triggerLayersThrow() {
  devFlags.throwLayers = true;
  pokeDev();
}

export function triggerBoardThrow() {
  devFlags.throwBoard = true;
  pokeDev();
}

export function triggerDrawThrow() {
  devFlags.throwDraw = true;
  pokeDev();
}

export { activateScreen, clearHover, devStore, failConnect, inspectorStore, setHover };
