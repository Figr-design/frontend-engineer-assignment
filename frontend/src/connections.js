import { cancelScreen, send } from "./bus.js";
import { isAbort, reportFailure } from "./failures.js";
import { resetLayers } from "./layersModel.js";
import { clearPreviewSelection } from "./selection.js";
import { previewStore, rectStoreFor, ui } from "./store.js";

const timers = new Map();
const readyAt = new Map();
const sessions = new Map();
const hrefs = new Map();
let sessionHook = () => {};

export function onNewSession(fn) {
  sessionHook = fn;
}

function writePreview(screenId, patch) {
  previewStore.set((state) => {
    const prev = state[screenId] || { state: "connecting", pageError: null, nonce: 0 };
    return { ...state, [screenId]: { ...prev, ...patch, nonce: (prev.nonce || 0) + 1 } };
  });
}

export function arm(screenId, { fromLoad = false } = {}) {
  const status = previewStore.get()[screenId];
  const age = Date.now() - (readyAt.get(screenId) || 0);
  if (!fromLoad && status?.state === "ready") return;
  if (fromLoad && status?.state === "ready" && age < 1500) return;
  clearTimeout(timers.get(screenId));
  const started = Date.now();
  if (status?.kind === "connect") writePreview(screenId, { state: "connecting", kind: null, message: null });
  timers.set(
    screenId,
    setTimeout(() => {
      if ((readyAt.get(screenId) || 0) >= started) return;
      if (previewStore.get()[screenId]?.state === "ready" && (readyAt.get(screenId) || 0) >= started) return;
      failConnect(screenId);
    }, 10000),
  );
  send(screenId, { type: "ping" });
}

export function markReady(screenId, session, href) {
  clearTimeout(timers.get(screenId));
  const previous = sessions.get(screenId);
  const previousHref = hrefs.get(screenId);
  const navigated = Boolean(previous) && (previous !== session || previousHref !== href);
  sessions.set(screenId, session);
  hrefs.set(screenId, href);
  readyAt.set(screenId, Date.now());
  if (navigated) {
    cancelScreen(screenId);
    resetLayers(screenId);
    rectStoreFor(screenId).set({});
    clearPreviewSelection(screenId);
    sessionHook(screenId);
  }
  const mode = ui.get().mode;
  writePreview(screenId, {
    state: "ready",
    kind: null,
    message: null,
    pageError: navigated ? null : previewStore.get()[screenId]?.pageError || null,
  });
  send(screenId, { type: "mode", mode });
}

export function failConnect(screenId, error = new Error("Couldn't connect to this preview")) {
  const status = previewStore.get()[screenId];
  if (status?.state === "error" && status.kind === "connect") return;
  clearTimeout(timers.get(screenId));
  cancelScreen(screenId);
  writePreview(screenId, {
    state: "error",
    kind: "connect",
    message: "Couldn't connect to this preview",
    pageError: status?.pageError || null,
  });
  reportFailure(error, { region: "preview", screenId });
}

export function raisePreview(screenId, error) {
  const status = previewStore.get()[screenId];
  if (status?.state === "error" && status.kind === "runtime") return;
  writePreview(screenId, {
    state: status?.state === "ready" ? "ready" : status?.state || "ready",
    kind: "runtime",
    message: "This preview hit an error",
  });
  reportFailure(error, { region: "preview", screenId });
}

export function clearPreviewFault(screenId) {
  const status = previewStore.get()[screenId];
  if (!status || status.kind !== "runtime") return;
  writePreview(screenId, { kind: null, message: null });
}

export function notePageError(screenId, message) {
  const status = previewStore.get()[screenId] || { state: "connecting", nonce: 0 };
  previewStore.set((state) => ({
    ...state,
    [screenId]: { ...status, ...state[screenId], pageError: message },
  }));
}

export function disposeConnect(screenId) {
  clearTimeout(timers.get(screenId));
  timers.delete(screenId);
}

export function ignoreLate(error) {
  return isAbort(error);
}
