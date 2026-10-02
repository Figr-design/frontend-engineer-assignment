import { broadcast } from "./bus.js";
import { aimScroll, dropEids, getLayers, revealEid, setExpanded, visibleRows } from "./layersModel.js";
import { readMeta, rememberElement, ui } from "./store.js";

export function setMode(mode) {
  const next = mode === "interact" ? "interact" : "select";
  ui.set((state) => ({ ...state, mode: next, hover: next === "interact" ? null : state.hover }));
  broadcast({ type: "mode", mode: next });
  if (next === "select") {
    const active = document.activeElement;
    if (active && active.tagName === "IFRAME") active.blur();
    window.focus();
  }
}

let hoverGen = 0;

export function bumpHoverGen() {
  hoverGen += 1;
  return hoverGen;
}

export function isHoverGen(gen) {
  return gen === hoverGen;
}

export function setHover(hover) {
  const current = ui.get().hover;
  if (
    current?.screenId === hover?.screenId &&
    current?.eid === hover?.eid &&
    current?.name === hover?.name
  ) {
    return;
  }
  ui.set((state) => ({ ...state, hover }));
}

let boardDragging = false;

export function setBoardDragging(value) {
  boardDragging = value;
}

export function isBoardDragging() {
  return boardDragging;
}

export function clearHover() {
  if (ui.get().hover) ui.set((state) => ({ ...state, hover: null }));
}

export function userClearSelection() {
  ui.set((state) => ({
    ...state,
    selection: { screenId: null, eids: [] },
    missingNote: state.selection.eids.length ? null : state.missingNote,
  }));
}

export function activateScreen(screenId) {
  if (ui.get().activeScreenId !== screenId) ui.set((state) => ({ ...state, activeScreenId: screenId }));
}

export function clickPreview(screenId, desc, shift) {
  if (!desc) {
    ui.set((state) => ({
      ...state,
      activeScreenId: screenId,
      selection: { screenId: null, eids: [] },
      missingNote: state.selection.eids.length ? null : state.missingNote,
    }));
    return;
  }
  rememberElement(screenId, desc);
  selectEid(screenId, desc.eid, { shift, fromLayers: false });
}

export function selectEid(screenId, eid, { shift = false, fromLayers = false } = {}) {
  const state = ui.get();
  const samePreview = state.selection.screenId === screenId && state.selection.eids.length > 0;
  let eids;
  if (shift && samePreview) {
    eids = state.selection.eids.includes(eid)
      ? state.selection.eids.filter((id) => id !== eid)
      : [...state.selection.eids, eid];
  } else if (shift && !samePreview) {
    eids = [eid];
  } else {
    eids = [eid];
  }
  ui.set((current) => ({
    ...current,
    activeScreenId: screenId,
    selection: { screenId: eids.length ? screenId : null, eids },
    missingNote: null,
  }));
  const added = eids.includes(eid) && !(shift && state.selection.eids.includes(eid) && !eids.includes(eid));
  if (!fromLayers && eids.includes(eid) && added) {
    const searching = Boolean(getLayers(screenId).search);
    if (!searching) revealEid(screenId, eid);
  }
}

export function replaceWith(screenId, info) {
  rememberElement(screenId, info);
  ui.set((state) => ({
    ...state,
    activeScreenId: screenId,
    selection: { screenId, eids: [info.eid] },
    missingNote: null,
  }));
  if (!getLayers(screenId).search) revealEid(screenId, info.eid);
}

export function dropMissing(screenId, missing) {
  if (!missing?.length) return;
  const gone = new Set(missing);
  dropEids(screenId, missing);
  ui.set((state) => {
    let hover = state.hover;
    if (hover?.screenId === screenId && gone.has(hover.eid)) hover = null;
    if (state.selection.screenId !== screenId) {
      return hover === state.hover ? state : { ...state, hover };
    }
    const eids = state.selection.eids.filter((eid) => !gone.has(eid));
    if (eids.length === state.selection.eids.length && hover === state.hover) return state;
    const emptied = state.selection.eids.length > 0 && eids.length === 0;
    return {
      ...state,
      hover,
      selection: { screenId: eids.length ? screenId : null, eids },
      missingNote: emptied ? { screenId } : state.missingNote,
    };
  });
}

export function clearPreviewSelection(screenId) {
  ui.set((state) => ({
    ...state,
    hover: state.hover?.screenId === screenId ? null : state.hover,
    selection:
      state.selection.screenId === screenId ? { screenId: null, eids: [] } : state.selection,
    missingNote: state.missingNote?.screenId === screenId ? null : state.missingNote,
  }));
}

export function moveLayers(key) {
  const screenId = ui.get().activeScreenId;
  if (!screenId) return;
  const rows = visibleRows(screenId);
  if (!rows.length) return;
  const selected = ui.get().selection;
  const primary = selected.screenId === screenId ? selected.eids[selected.eids.length - 1] : null;
  let index = rows.findIndex((row) => row.eid === primary);
  const searching = Boolean(getLayers(screenId).search);

  if (key === "ArrowDown") {
    index = Math.min(rows.length - 1, index < 0 ? 0 : index + 1);
    choose(screenId, rows[index]);
    return;
  }
  if (key === "ArrowUp") {
    index = Math.max(0, index < 0 ? 0 : index - 1);
    choose(screenId, rows[index]);
    return;
  }
  if (index < 0) return;
  const row = rows[index];
  if (key === "ArrowRight") {
    if (!searching && row.hasChildren && !row.expanded) {
      setExpanded(screenId, row.eid, true);
      return;
    }
    const next = rows[index + 1];
    if (next && next.depth > row.depth) choose(screenId, next);
    return;
  }
  if (key === "ArrowLeft") {
    if (!searching && row.expanded && row.hasChildren) {
      setExpanded(screenId, row.eid, false);
      return;
    }
    if (row.parentEid) {
      const parent = rows.find((item) => item.eid === row.parentEid) || {
        eid: row.parentEid,
        name: readMeta(screenId, row.parentEid)?.name,
      };
      choose(screenId, parent);
    }
  }
}

function choose(screenId, row) {
  if (!row?.eid) return;
  rememberElement(screenId, row);
  ui.set((state) => ({
    ...state,
    activeScreenId: screenId,
    selection: { screenId, eids: [row.eid] },
    missingNote: null,
  }));
  aimScroll(screenId, row.eid);
}
