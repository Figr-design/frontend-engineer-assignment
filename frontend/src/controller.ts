import { ApiError, fetchElement, fetchScreens } from "./api";
import { camera } from "./camera";
import { overlay } from "./overlay";
import { CancelledError, isCancelled, reportFailure } from "./regions";
import { getApp, setApp } from "./store";
import {
  CHILDREN_MS,
  HANDSHAKE_MS,
  PAGES_ORIGIN,
  PREVIEW_H,
  PREVIEW_W,
  emptyLayers,
  emptyPreview,
  keyOfId,
  type LayersState,
  type Mode,
  type NodeInfo,
  type PackedNode,
  type PreviewState,
  type SearchHit,
} from "./types";

const iframes = new Map<string, HTMLIFrameElement>();
const handshake = new Map<string, number>();
const inflightChildren = new Map<string, Promise<NodeInfo[]>>();
let reqSeq = 0;
let detailsAbort: AbortController | null = null;
let searchTimer = 0;
let hitRaf = 0;
let hitPending: { screenId: string; x: number; y: number } | null = null;
let panning = false;
let overlayClickArmed = false;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: number;
  screenId: string;
  generation: number;
};

const pending = new Map<number, Pending>();

function patchPreview(id: string, patch: Partial<PreviewState>) {
  const cur = getApp().previews[id] ?? emptyPreview();
  setApp({ previews: { ...getApp().previews, [id]: { ...cur, ...patch } } });
}

function patchLayers(id: string, patch: Partial<LayersState> | ((l: LayersState) => LayersState)) {
  const cur = getApp().layers[id] ?? emptyLayers();
  const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
  setApp({ layers: { ...getApp().layers, [id]: next } });
}

function previewOf(id: string) {
  return getApp().previews[id];
}

export function registerIframe(screenId: string, el: HTMLIFrameElement | null) {
  if (!el) {
    iframes.delete(screenId);
    return;
  }
  iframes.set(screenId, el);
}

export function iframeEl(screenId: string) {
  return iframes.get(screenId) ?? null;
}

function post(screenId: string, msg: Record<string, unknown>) {
  const iframe = iframes.get(screenId);
  const sessionId = previewOf(screenId)?.sessionId;
  iframe?.contentWindow?.postMessage({ source: "figr-host", sessionId, ...msg }, "*");
}

function request<T>(screenId: string, msg: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const prev = previewOf(screenId);
  if (!prev?.sessionId || prev.status !== "ready") {
    return Promise.reject(new CancelledError("not connected"));
  }
  const requestId = ++reqSeq;
  const generation = prev.generation;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("timeout"));
    }, timeoutMs);
    pending.set(requestId, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
      screenId,
      generation,
    });
    post(screenId, { ...msg, requestId });
  });
}

function settle(requestId: number, data: unknown, err?: Error) {
  const p = pending.get(requestId);
  if (!p) return;
  const prev = previewOf(p.screenId);
  if (!prev || prev.generation !== p.generation) {
    pending.delete(requestId);
    clearTimeout(p.timer);
    p.reject(new CancelledError());
    return;
  }
  pending.delete(requestId);
  clearTimeout(p.timer);
  if (err) p.reject(err);
  else p.resolve(data);
}

function screenIdForSource(source: MessageEventSource | null) {
  if (!source) return null;
  for (const [id, el] of iframes) {
    if (el.contentWindow === source) return id;
  }
  return null;
}

function sendWatch(screenId: string) {
  const sel = getApp().selection;
  const hover = overlay.getHover();
  const selectedIds = sel && sel.screenId === screenId && !sel.gone ? sel.ids : [];
  const hoverId = hover && hover.screenId === screenId ? hover.id : null;
  post(screenId, { type: "watch", selectedIds, hoverId });
}

export function setMode(mode: Mode) {
  setApp({ mode });
  for (const s of getApp().screens) {
    if (previewOf(s.id)?.status === "ready") post(s.id, { type: "setMode", mode });
  }
  if (mode === "select") {
    const sel = getApp().selection;
    if (sel) sendWatch(sel.screenId);
  } else {
    overlay.clearHover();
    setApp({ layersHover: null });
  }
}

export function clearHover() {
  overlay.clearHover();
  setApp({ layersHover: null });
  const sel = getApp().selection;
  if (sel) sendWatch(sel.screenId);
}

export function beginPan() {
  if (panning) return;
  panning = true;
  clearHover();
}

export function endPan() {
  panning = false;
}

export function beginZoom(clientX: number, clientY: number, deltaY: number) {
  clearHover();
  camera.zoomAt(clientX, clientY, deltaY);
  setApp({ zoomLabel: camera.get().zoom });
}

function mergeChildren(screenId: string, parentId: string | null, nodes: NodeInfo[]) {
  const pid = parentId ?? "";
  patchLayers(screenId, (L) => {
    const nodesMap = { ...L.nodes };
    const parent = { ...L.parent };
    const ids: string[] = [];
    for (const n of nodes) {
      nodesMap[n.id] = n;
      parent[n.id] = parentId;
      ids.push(n.id);
    }
    return { ...L, nodes: nodesMap, parent, children: { ...L.children, [pid]: ids } };
  });
}

function applyPath(screenId: string, path: { node: NodeInfo; levels: { parentId: string | null; children: NodeInfo[] }[] }) {
  for (const level of path.levels) {
    mergeChildren(screenId, level.parentId, level.children);
  }
  patchLayers(screenId, (L) => {
    const expanded = { ...L.expanded };
    for (const level of path.levels) {
      if (level.parentId) expanded[level.parentId] = true;
    }
    return { ...L, expanded, nodes: { ...L.nodes, [path.node.id]: path.node } };
  });
}

async function expandTo(screenId: string, id: string) {
  if (getApp().layers[screenId]?.search) return;
  try {
    const path = await request<{ path: { node: NodeInfo; levels: { parentId: string | null; children: NodeInfo[] }[] } | null }>(
      screenId,
      { type: "getPath", id },
      CHILDREN_MS,
    );
    if (!path.path) return;
    applyPath(screenId, path.path);
    queueMicrotask(() => scrollRowIntoView(id));
  } catch (err) {
    if (!isCancelled(err)) {
      /* path load is best-effort; layers remain usable */
    }
  }
}

function scrollRowIntoView(id: string) {
  const el = document.querySelector(`[data-layer-id="${CSS.escape(id)}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });
}

export async function ensureRoot(screenId: string) {
  const L = getApp().layers[screenId] ?? emptyLayers();
  if (L.rootStatus === "loading" || L.rootStatus === "ready") return;
  if (getApp().dev.layersFail) {
    setApp({
      dev: { ...getApp().dev, layersFail: false },
    });
    patchLayers(screenId, { rootStatus: "error", rootError: "Couldn't load layers" });
    reportFailure(new Error("Dev: layers fail"), { region: "layers", screenId });
    return;
  }
  patchLayers(screenId, { rootStatus: "loading", rootError: null });
  const gen = previewOf(screenId)?.generation;
  try {
    const res = await request<{ nodes: NodeInfo[] }>(screenId, { type: "getChildren", parentId: null }, CHILDREN_MS);
    if (previewOf(screenId)?.generation !== gen) return;
    mergeChildren(screenId, null, res.nodes);
    patchLayers(screenId, { rootStatus: "ready", rootError: null });
  } catch (err) {
    if (isCancelled(err) || previewOf(screenId)?.generation !== gen) return;
    patchLayers(screenId, { rootStatus: "error", rootError: "Couldn't load layers" });
    reportFailure(err, { region: "layers", screenId });
  }
}

export async function expandRow(screenId: string, id: string) {
  patchLayers(screenId, (L) => ({ ...L, expanded: { ...L.expanded, [id]: true } }));
  const L = getApp().layers[screenId];
  if (L?.children[id]) return;
  const inflightKey = `${screenId}:${id}`;
  if (inflightChildren.has(inflightKey)) {
    try {
      await inflightChildren.get(inflightKey);
    } catch {
      /* row status already set */
    }
    return;
  }
  patchLayers(screenId, (L2) => ({
    ...L2,
    rowStatus: { ...L2.rowStatus, [id]: { state: "loading" } },
  }));
  const run = (async () => {
    if (getApp().dev.rowLoadFail) {
      setApp({ dev: { ...getApp().dev, rowLoadFail: false } });
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("timeout");
    }
    const res = await request<{ nodes: NodeInfo[] }>(
      screenId,
      { type: "getChildren", parentId: id },
      CHILDREN_MS,
    );
    return res.nodes;
  })();
  inflightChildren.set(inflightKey, run);
  const gen = previewOf(screenId)?.generation;
  try {
    const nodes = await run;
    if (previewOf(screenId)?.generation !== gen) return;
    mergeChildren(screenId, id, nodes);
    patchLayers(screenId, (L2) => ({
      ...L2,
      rowStatus: { ...L2.rowStatus, [id]: { state: "idle" } },
    }));
  } catch (err) {
    if (isCancelled(err) || previewOf(screenId)?.generation !== gen) return;
    patchLayers(screenId, (L2) => ({
      ...L2,
      rowStatus: { ...L2.rowStatus, [id]: { state: "error", error: "Couldn't load" } },
    }));
    const node = getApp().layers[screenId]?.nodes[id];
    reportFailure(err, { region: "layers-row", screenId, elementKey: node?.dataKey ?? undefined });
  } finally {
    inflightChildren.delete(inflightKey);
  }
}

export function collapseRow(screenId: string, id: string) {
  patchLayers(screenId, (L) => {
    const expanded = { ...L.expanded };
    delete expanded[id];
    return { ...L, expanded };
  });
}

export function toggleRow(screenId: string, id: string) {
  const L = getApp().layers[screenId];
  if (!L) return;
  if (L.expanded[id]) collapseRow(screenId, id);
  else void expandRow(screenId, id);
}

export function setActivePreview(screenId: string) {
  setApp({ activeScreenId: screenId });
  if (previewOf(screenId)?.status === "ready") void ensureRoot(screenId);
}

function ingestLive(nodes: PackedNode[]) {
  if (!nodes.length) return;
  const liveById = { ...getApp().liveById };
  for (const n of nodes) {
    if (n.live) liveById[n.id] = n.live;
  }
  setApp({ liveById });
}

export async function refreshDetails() {
  detailsAbort?.abort();
  const sel = getApp().selection;
  const gen = getApp().details.gen + 1;
  if (!sel || sel.gone || sel.ids.length !== 1) {
    setApp({ details: { status: "idle", data: null, error: null, gen } });
    return;
  }
  const id = sel.ids[sel.ids.length - 1];
  const key = keyOfId(id) ?? getApp().liveById[id]?.dataKey ?? null;
  if (!key) {
    setApp({ details: { status: "none", data: null, error: null, gen } });
    return;
  }
  const ac = new AbortController();
  detailsAbort = ac;
  setApp({ details: { status: "loading", data: null, error: null, gen } });
  try {
    const data = await fetchElement(key, { fail: getApp().dev.detailsFail, signal: ac.signal });
    if (getApp().details.gen !== gen) return;
    setApp({ details: { status: "ready", data, error: null, gen } });
  } catch (err) {
    if (isCancelled(err) || ac.signal.aborted || getApp().details.gen !== gen) return;
    if (err instanceof ApiError && err.notFound) {
      setApp({ details: { status: "none-404", data: null, error: null, gen } });
      return;
    }
    reportFailure(err, { region: "details", screenId: sel.screenId, elementKey: key });
    setApp({
      details: {
        status: "error",
        data: null,
        error: err instanceof Error ? err.message : "Couldn't load details",
        gen,
      },
    });
  }
}

export function setSelection(next: { screenId: string; ids: string[]; gone?: boolean } | null) {
  if (!next || next.ids.length === 0) {
    setApp({ selection: null });
    overlay.setSelected([]);
    overlay.clearHover();
    void refreshDetails();
    const active = getApp().activeScreenId;
    if (active) sendWatch(active);
    return;
  }
  overlay.clearHover();
  overlay.setSelected(
    overlay.getSelected().filter((b) => b.screenId === next.screenId && next.ids.includes(b.id)),
  );
  setApp({ selection: { screenId: next.screenId, ids: next.ids, gone: !!next.gone } });
  setActivePreview(next.screenId);
  sendWatch(next.screenId);
  const last = next.ids[next.ids.length - 1];
  if (!next.gone) void expandTo(next.screenId, last);
  void refreshDetails();
}

export function clearSelection() {
  const sel = getApp().selection;
  setSelection(null);
  if (sel) sendWatch(sel.screenId);
}

function applyClick(screenId: string, node: NodeInfo | null, shift: boolean, background: boolean, packed?: PackedNode | null) {
  setActivePreview(screenId);
  if (background || !node) {
    clearSelection();
    return;
  }
  const sel = getApp().selection;
  if (!shift || !sel || sel.screenId !== screenId || sel.gone) {
    setSelection({ screenId, ids: [node.id] });
    if (packed) ingestLive([packed]);
    return;
  }
  const ids = sel.ids.includes(node.id) ? sel.ids.filter((id) => id !== node.id) : [...sel.ids, node.id];
  if (!ids.length) clearSelection();
  else {
    setSelection({ screenId, ids });
    if (packed) ingestLive([packed]);
  }
}

export function clickRow(screenId: string, id: string, shift: boolean) {
  const node = getApp().layers[screenId]?.nodes[id];
  if (!node) return;
  applyClick(screenId, node, shift, false);
  post(screenId, { type: "scrollIntoView", id });
}

export function hoverRow(screenId: string, id: string | null) {
  setApp({ layersHover: id ? { screenId, id } : null });
  if (getApp().mode !== "select") return;
  if (!id) overlay.clearHover();
  sendWatch(screenId);
}

export function localCoords(e: { clientX: number; clientY: number }, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * PREVIEW_W) / r.width,
    y: ((e.clientY - r.top) * PREVIEW_H) / r.height,
  };
}

export function onOverlayMove(screenId: string, x: number, y: number) {
  if (getApp().mode !== "select" || panning) return;
  hitPending = { screenId, x, y };
  if (hitRaf) return;
  hitRaf = requestAnimationFrame(flushHit);
}

async function flushHit() {
  hitRaf = 0;
  const p = hitPending;
  hitPending = null;
  if (!p || getApp().mode !== "select" || panning) return;
  try {
    const res = await request<{ node: PackedNode | null }>(p.screenId, { type: "hitTest", x: p.x, y: p.y }, 800);
    if (getApp().mode !== "select") return;
    if (!res.node) {
      overlay.clearHover();
      setApp({ layersHover: null });
      sendWatch(p.screenId);
      return;
    }
    const prevHover = overlay.getHover();
    overlay.setHover({ ...res.node, screenId: p.screenId });
    setApp({ layersHover: { screenId: p.screenId, id: res.node.id } });
    ingestLive([res.node]);
    if (prevHover?.id !== res.node.id || prevHover?.screenId !== p.screenId) sendWatch(p.screenId);
  } catch (err) {
    if (!isCancelled(err)) {
      /* hover is best-effort */
    }
  }
}

export function onOverlayLeave(screenId: string) {
  const h = overlay.getHover();
  if (h?.screenId === screenId) overlay.clearHover();
  if (getApp().layersHover?.screenId === screenId) setApp({ layersHover: null });
  sendWatch(screenId);
}

export async function onOverlayClick(screenId: string, x: number, y: number, shift: boolean) {
  if (getApp().mode !== "select") return;
  if (!overlayClickArmed) return;
  overlayClickArmed = false;
  try {
    const res = await request<{ background: boolean; node: PackedNode | null; shift: boolean }>(
      screenId,
      { type: "click", x, y, shift },
      800,
    );
    applyClick(screenId, res.node, shift, res.background, res.node);
  } catch (err) {
    if (!isCancelled(err)) {
      /* a missed click is not a preview-region failure */
    }
  }
}

export function armOverlayClick() {
  overlayClickArmed = true;
}

export function onOverlayWheel(screenId: string, e: WheelEvent, overlayEl: HTMLElement) {
  overlayClickArmed = false;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    beginZoom(e.clientX, e.clientY, e.deltaY);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const { x, y } = localCoords(e, overlayEl);
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } else if (e.deltaMode === 2) {
    dx *= PREVIEW_W;
    dy *= PREVIEW_H;
  }
  post(screenId, { type: "scroll", x, y, dx, dy });
}

export function onBoardWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    beginZoom(e.clientX, e.clientY, e.deltaY);
    return;
  }
  if ((e.target as HTMLElement).closest?.(".hit-overlay")) return;
  e.preventDefault();
  camera.panBy(-e.deltaX, -e.deltaY);
}

async function nav(op: "parent" | "firstChild" | "nextSibling" | "prevSibling") {
  const sel = getApp().selection;
  if (!sel || sel.gone || !sel.ids.length || getApp().mode !== "select") return;
  const id = sel.ids[sel.ids.length - 1];
  try {
    const res = await request<{ node: PackedNode | null }>(sel.screenId, { type: "nav", op, id }, 800);
    if (res.node) {
      setSelection({ screenId: sel.screenId, ids: [res.node.id] });
      ingestLive([res.node]);
    }
  } catch (err) {
    if (!isCancelled(err)) {
      /* ignore */
    }
  }
}

function visibleRows(screenId: string): { id: string; depth: number }[] {
  const L = getApp().layers[screenId];
  if (!L) return [];
  if (L.search && L.searchHits) {
    const { children, expanded } = searchTree(L.searchHits);
    const out: { id: string; depth: number }[] = [];
    const walk = (pid: string, depth: number) => {
      for (const id of children[pid] || []) {
        out.push({ id, depth });
        if (expanded[id]) walk(id, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }
  const out: { id: string; depth: number }[] = [];
  const walk = (pid: string, depth: number) => {
    for (const id of L.children[pid] || []) {
      out.push({ id, depth });
      if (L.expanded[id] && L.nodes[id]?.hasChildren) walk(id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export function searchTree(hits: SearchHit[]) {
  const children: Record<string, string[]> = { "": [] };
  const expanded: Record<string, true> = {};
  const nodes: Record<string, NodeInfo> = {};
  const add = (pid: string, node: NodeInfo) => {
    nodes[node.id] = node;
    const list = children[pid] || (children[pid] = []);
    if (!list.includes(node.id)) list.push(node.id);
  };
  for (const hit of hits) {
    let pid = "";
    for (const a of hit.ancestors) {
      add(pid, a);
      expanded[a.id] = true;
      pid = a.id;
    }
    add(pid, hit.node);
  }
  return { children, expanded, nodes };
}

function handleLayersKey(e: { key: string; shift: boolean }) {
  const screenId = getApp().activeScreenId;
  if (!screenId) return false;
  const rows = visibleRows(screenId);
  if (!rows.length) return false;
  const sel = getApp().selection;
  const currentId = sel && sel.screenId === screenId ? sel.ids[sel.ids.length - 1] : rows[0].id;
  const idx = Math.max(0, rows.findIndex((r) => r.id === currentId));
  const L = getApp().layers[screenId];
  const node = L?.nodes[currentId];

  if (e.key === "ArrowDown") {
    const next = rows[Math.min(rows.length - 1, idx + 1)];
    if (next) clickRow(screenId, next.id, false);
    return true;
  }
  if (e.key === "ArrowUp") {
    const next = rows[Math.max(0, idx - 1)];
    if (next) clickRow(screenId, next.id, false);
    return true;
  }
  if (e.key === "ArrowRight") {
    if (node?.hasChildren && !L?.expanded[currentId] && !(L?.search && L.searchHits)) {
      void expandRow(screenId, currentId);
    } else if (node?.hasChildren) {
      const kids = L?.search && L.searchHits ? searchTree(L.searchHits).children[currentId] : L?.children[currentId];
      if (kids?.[0]) clickRow(screenId, kids[0], false);
    }
    return true;
  }
  if (e.key === "ArrowLeft") {
    if (L?.expanded[currentId] && !(L.search && L.searchHits)) {
      collapseRow(screenId, currentId);
    } else {
      const parent = L?.parent[currentId];
      if (parent) clickRow(screenId, parent, false);
    }
    return true;
  }
  return false;
}

export function handleKey(e: {
  key: string;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  typing?: boolean;
  fromPage?: boolean;
  preventDefault: () => void;
}) {
  const target = document.activeElement as HTMLElement | null;
  const inField =
    !!e.typing ||
    (!e.fromPage &&
      !!target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable));

  if (e.key === "Escape") {
    e.preventDefault();
    const active = getApp().activeScreenId;
    const L = active ? getApp().layers[active] : null;
    if (L?.search) {
      setSearch(active!, "");
      return;
    }
    clearSelection();
    return;
  }

  if (inField) return;

  const lower = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (lower === "v" && !e.meta && !e.ctrl && !e.alt) {
    e.preventDefault();
    setMode("select");
    return;
  }
  if (lower === "i" && !e.meta && !e.ctrl && !e.alt) {
    e.preventDefault();
    setMode("interact");
    return;
  }

  if (getApp().mode !== "select") return;

  if (getApp().layersPanelFocused && handleLayersKey(e)) {
    e.preventDefault();
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    void nav(e.shift ? "parent" : "firstChild");
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    void nav(e.shift ? "prevSibling" : "nextSibling");
  }
}

function startHandshakeTimer(screenId: string, generation: number) {
  const t = handshake.get(screenId);
  if (t) window.clearTimeout(t);
  handshake.set(
    screenId,
    window.setTimeout(() => {
      const now = previewOf(screenId);
      if (!now || now.generation !== generation || now.status === "ready") return;
      patchPreview(screenId, { status: "error", error: "Couldn't connect to this preview" });
      reportFailure(new Error("Preview handshake timeout"), { region: "preview", screenId });
    }, HANDSHAKE_MS),
  );
}

function dropPending(screenId: string) {
  for (const [id, p] of pending) {
    if (p.screenId === screenId) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(new CancelledError());
    }
  }
}

export function onIframeLoad(screenId: string) {
  const prev = previewOf(screenId) ?? emptyPreview();
  if (!prev.loadHasFired) {
    patchPreview(screenId, { loadHasFired: true });
    if (prev.status === "ready") return;
    startHandshakeTimer(screenId, prev.generation);
    return;
  }
  dropPending(screenId);
  const generation = prev.generation + 1;
  patchLayers(screenId, emptyLayers());
  const sel = getApp().selection;
  if (sel?.screenId === screenId) {
    setApp({ selection: null });
    overlay.setSelected([]);
    overlay.clearHover();
    void refreshDetails();
  }
  patchPreview(screenId, {
    generation,
    sessionId: null,
    status: "connecting",
    error: null,
    pageError: null,
    loadHasFired: true,
  });
  startHandshakeTimer(screenId, generation);
}

function onHello(screenId: string) {
  if (getApp().dev.ignoreHello[screenId]) return;
  const prev = previewOf(screenId);
  if (!prev || prev.status === "error") return;
  const t = handshake.get(screenId);
  if (t) {
    window.clearTimeout(t);
    handshake.delete(screenId);
  }
  const sessionId = "s" + Math.random().toString(36).slice(2, 10);
  patchPreview(screenId, { sessionId, status: "ready", error: null });
  post(screenId, { type: "hello-ok", sessionId, mode: getApp().mode });
  post(screenId, { type: "setMode", mode: getApp().mode });
  if (getApp().activeScreenId === screenId) void ensureRoot(screenId);
  sendWatch(screenId);
}

function onRects(screenId: string, hoverNode: PackedNode | null, selectedNodes: PackedNode[]) {
  const curHover = overlay.getHover();
  if (getApp().mode === "select") {
    if (hoverNode) overlay.setHover({ ...hoverNode, screenId });
    else if (curHover?.screenId === screenId) overlay.setHover(null);
  }
  const prev = overlay.getSelected();
  const others = prev.filter((s) => s.screenId !== screenId);
  if (selectedNodes.length) {
    overlay.setSelected(others.concat(selectedNodes.map((n) => ({ ...n, screenId }))));
  } else {
    const sel = getApp().selection;
    if (sel?.screenId === screenId && sel.ids.length && !sel.gone) {
      overlay.setSelected(others.concat(prev.filter((s) => s.screenId === screenId).map((s) => ({ ...s, visible: false }))));
    } else {
      overlay.setSelected(others);
    }
  }
  ingestLive(selectedNodes.concat(hoverNode ? [hoverNode] : []));
}

function onDomChanged(screenId: string, _present: string[], missing: string[]) {
  const sel = getApp().selection;
  if (missing.length && sel?.screenId === screenId) {
    const ids = sel.ids.filter((id) => !missing.includes(id));
    if (ids.length !== sel.ids.length) {
      if (!ids.length) {
        setApp({ selection: { ...sel, ids: [], gone: true } });
        overlay.setSelected(overlay.getSelected().filter((s) => s.screenId !== screenId));
        void refreshDetails();
      } else {
        setSelection({ screenId, ids });
      }
    }
  }
  const hover = overlay.getHover();
  if (hover && hover.screenId === screenId && missing.includes(hover.id)) {
    overlay.clearHover();
    setApp({ layersHover: null });
  }
  const L = getApp().layers[screenId];
  if (L && L.rootStatus === "ready") {
    const expandedIds = Object.keys(L.expanded);
    void (async () => {
      try {
        const root = await request<{ nodes: NodeInfo[] }>(screenId, { type: "getChildren", parentId: null }, CHILDREN_MS);
        mergeChildren(screenId, null, root.nodes);
        for (const id of expandedIds) {
          if (!getApp().layers[screenId]?.nodes[id] && !root.nodes.some((n) => n.id === id)) {
            patchLayers(screenId, (cur) => {
              const expanded = { ...cur.expanded };
              delete expanded[id];
              return { ...cur, expanded };
            });
            continue;
          }
          try {
            const res = await request<{ nodes: NodeInfo[] }>(screenId, { type: "getChildren", parentId: id }, CHILDREN_MS);
            mergeChildren(screenId, id, res.nodes);
          } catch (err) {
            if (!isCancelled(err)) {
              /* keep previous children */
            }
          }
        }
      } catch (err) {
        if (!isCancelled(err)) {
          /* keep tree */
        }
      }
    })();
  }
}

function onMessage(event: MessageEvent) {
  const data = event.data;
  if (!data || data.source !== "figr-bridge") return;
  if (event.origin !== PAGES_ORIGIN && event.origin !== "null") return;
  const screenId = screenIdForSource(event.source);
  if (!screenId) return;
  const prev = previewOf(screenId);
  try {
    if (data.type === "hello") {
      onHello(screenId);
      return;
    }
    if (!prev || (data.sessionId && prev.sessionId && data.sessionId !== prev.sessionId)) return;

    switch (data.type) {
      case "hit":
        settle(data.requestId, data);
        break;
      case "clickResult":
        settle(data.requestId, data);
        break;
      case "children":
        settle(data.requestId, data);
        break;
      case "path":
        settle(data.requestId, data);
        break;
      case "search":
        settle(data.requestId, data);
        break;
      case "live":
        settle(data.requestId, data);
        break;
      case "navResult":
        settle(data.requestId, data);
        break;
      case "pong":
        settle(data.requestId, data);
        break;
      case "rects":
        onRects(screenId, data.hover, data.selected || []);
        break;
      case "domChanged":
        onDomChanged(screenId, data.present || [], data.missing || []);
        break;
      case "pageError":
        patchPreview(screenId, { pageError: data.message || "Page error" });
        reportFailure(new Error(data.message || "Page error"), { region: "preview", screenId });
        break;
      case "keydown":
        handleKey({
          key: data.key,
          shift: !!data.shift,
          meta: !!data.meta,
          ctrl: !!data.ctrl,
          alt: !!data.alt,
          typing: !!data.typing,
          fromPage: true,
          preventDefault: () => undefined,
        });
        break;
      case "zoomWheel": {
        const iframe = iframes.get(screenId);
        if (!iframe) break;
        const ir = iframe.getBoundingClientRect();
        const x = ir.left + (data.clientX * ir.width) / PREVIEW_W;
        const y = ir.top + (data.clientY * ir.height) / PREVIEW_H;
        beginZoom(x, y, data.deltaY);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    reportFailure(err, { region: "preview", screenId });
    patchPreview(screenId, { status: "error", error: "Couldn't connect to this preview" });
  }
}

export async function loadScreens() {
  const gen = getApp().boardGen + 1;
  setApp({ boardGen: gen, boardStatus: "loading", boardError: null });
  try {
    const screens = await fetchScreens({ fail: getApp().dev.screensFail });
    if (getApp().boardGen !== gen) return;
    const previews: Record<string, PreviewState> = {};
    const layers: Record<string, LayersState> = {};
    for (const s of screens) {
      previews[s.id] = emptyPreview();
      layers[s.id] = emptyLayers();
    }
    setApp({
      screens,
      previews,
      layers,
      boardStatus: "ready",
      boardError: null,
      activeScreenId: null,
      selection: null,
    });
  } catch (err) {
    if (isCancelled(err) || getApp().boardGen !== gen) return;
    reportFailure(err, { region: "board", screenId: null });
    setApp({ boardStatus: "error", boardError: err instanceof Error ? err.message : "Couldn't load screens" });
  }
}

export function retryPreview(screenId: string, opts?: { keepIgnore?: boolean }) {
  if (!opts?.keepIgnore) {
    const ignore = { ...getApp().dev.ignoreHello };
    delete ignore[screenId];
    setApp({ dev: { ...getApp().dev, ignoreHello: ignore } });
  }
  const prev = previewOf(screenId) ?? emptyPreview();
  patchPreview(screenId, {
    iframeKey: prev.iframeKey + 1,
    generation: prev.generation + 1,
    sessionId: null,
    status: "connecting",
    error: null,
    pageError: null,
    loadHasFired: false,
  });
}

export function retryDetails() {
  void refreshDetails();
}

export function retryLayers(screenId: string) {
  patchLayers(screenId, { rootStatus: "idle", rootError: null });
  void ensureRoot(screenId);
}

export function retryRow(screenId: string, id: string) {
  patchLayers(screenId, (L) => ({
    ...L,
    rowStatus: { ...L.rowStatus, [id]: { state: "idle" } },
  }));
  void expandRow(screenId, id);
}

export function setSearch(screenId: string, query: string) {
  const L = getApp().layers[screenId] ?? emptyLayers();
  if (!L.search && query) {
    patchLayers(screenId, { search: query, expandedBeforeSearch: { ...L.expanded } });
  } else if (query === "") {
    patchLayers(screenId, {
      search: "",
      searchHits: null,
      expanded: L.expandedBeforeSearch ?? L.expanded,
      expandedBeforeSearch: null,
    });
    return;
  } else {
    patchLayers(screenId, { search: query });
  }
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(async () => {
    const q = getApp().layers[screenId]?.search ?? "";
    if (!q) return;
    try {
      const res = await request<{ hits: SearchHit[] }>(screenId, { type: "search", query: q }, 4000);
      if (getApp().layers[screenId]?.search !== q) return;
      const nodes = { ...getApp().layers[screenId].nodes };
      const parent = { ...getApp().layers[screenId].parent };
      for (const hit of res.hits) {
        nodes[hit.node.id] = hit.node;
        parent[hit.node.id] = hit.ancestors.length ? hit.ancestors[hit.ancestors.length - 1].id : null;
        for (let i = 0; i < hit.ancestors.length; i++) {
          const a = hit.ancestors[i];
          nodes[a.id] = a;
          parent[a.id] = i === 0 ? null : hit.ancestors[i - 1].id;
        }
      }
      patchLayers(screenId, { searchHits: res.hits, nodes, parent });
    } catch (err) {
      if (!isCancelled(err)) {
        /* search is not a failure region */
      }
    }
  }, 140);
}

export function setLayersScroll(screenId: string, scrollTop: number) {
  patchLayers(screenId, { scrollTop });
}

export function setLayersFocused(focused: boolean) {
  setApp({ layersPanelFocused: focused });
}

export function clickEmptyBoard() {
  clearSelection();
}

export function clickScreenName(screenId: string) {
  setActivePreview(screenId);
}

let inited = false;
export function initRuntime() {
  if (inited) return;
  inited = true;
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", (e) => {
    handleKey({
      key: e.key,
      shift: e.shiftKey,
      meta: e.metaKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      fromPage: false,
      preventDefault: () => e.preventDefault(),
    });
  });
  window.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) clearHover();
  });
  window.addEventListener("blur", () => clearHover());
  window.addEventListener("resize", () => overlay.setSelected(overlay.getSelected()));
  void loadScreens();
}

/* Dev menu */

export function devFailScreens() {
  setApp({ dev: { ...getApp().dev, screensFail: true } });
  void loadScreens().finally(() => {
    setApp({ dev: { ...getApp().dev, screensFail: false } });
  });
}

export function devFailHandshake() {
  const id = getApp().activeScreenId ?? getApp().screens[0]?.id;
  if (!id) return;
  setApp({
    dev: { ...getApp().dev, ignoreHello: { ...getApp().dev.ignoreHello, [id]: true } },
  });
  retryPreview(id, { keepIgnore: true });
}

export function devFailDetails() {
  setApp({ dev: { ...getApp().dev, detailsFail: true } });
  void refreshDetails().finally(() => {
    setApp({ dev: { ...getApp().dev, detailsFail: false } });
  });
}

export function devThrowInspector() {
  setApp({ dev: { ...getApp().dev, throwInspector: true } });
}

export function clearInspectorThrow() {
  setApp({ dev: { ...getApp().dev, throwInspector: false } });
}

export function devFailLayers() {
  const id = getApp().activeScreenId;
  if (!id) return;
  setApp({ dev: { ...getApp().dev, layersFail: true } });
  patchLayers(id, emptyLayers());
  void ensureRoot(id);
}

export function devFailRow() {
  setApp({ dev: { ...getApp().dev, rowLoadFail: true } });
}

export function devInjectPageError() {
  const id = getApp().activeScreenId;
  if (!id) return;
  post(id, { type: "injectError", message: "Dev: injected page error" });
}

export function nearestVisibleRow(screenId: string, id: string): string | null {
  const rows = visibleRows(screenId);
  const visible = new Set(rows.map((r) => r.id));
  if (visible.has(id)) return id;
  const L = getApp().layers[screenId];
  if (!L) return null;
  let cur: string | null = id;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    if (visible.has(cur)) return cur;
    cur = L.parent[cur] ?? null;
  }
  return rows[0]?.id ?? null;
}
