import { useEffect, useLayoutEffect, useRef } from "react";
import { RegionBoundary } from "./boundaries.jsx";
import { request } from "./bus.js";
import {
  clearScrollTarget,
  getLayers,
  loadChildren,
  runSearch,
  saveScroll,
  setExpanded,
  setSearch,
  useLayers,
  visibleRows,
} from "./layersModel.js";
import { raisePreview } from "./connections.js";
import { selectEid, setHover } from "./selection.js";
import { devFlags, devStore, previewStore, rememberElement, ui, useStore } from "./store.js";

export function Layers() {
  const state = useStore(ui);
  return (
    <RegionBoundary region="layers" screenId={state.activeScreenId} className="region-error panel-error" message="Something went wrong in the layers panel">
      <LayersBody />
    </RegionBoundary>
  );
}

function LayersBody() {
  useStore(devStore);
  const uiState = useStore(ui);
  const layers = useLayers();
  const previews = useStore(previewStore);
  const screenId = uiState.activeScreenId;
  const model = screenId ? layers.screens[screenId] || getLayers(screenId) : null;
  const scroller = useRef(null);
  const ready = screenId && previews[screenId]?.state === "ready";

  useEffect(() => {
    if (!screenId || !ready) return undefined;
    const current = getLayers(screenId);
    if (current.root.state === "idle") loadChildren(screenId, null);
    return undefined;
  }, [screenId, ready, previews[screenId]?.nonce]);

  useLayoutEffect(() => {
    if (!scroller.current || !screenId || !model) return;
    scroller.current.scrollTop = model.scrollTop || 0;
  }, [screenId, model?.scrollEpoch]);

  useLayoutEffect(() => {
    if (!screenId || !model?.scrollTarget || !scroller.current) return;
    const row = scroller.current.querySelector(`[data-eid="${CSS.escape(model.scrollTarget)}"]`);
    if (row) {
      const box = scroller.current.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      if (rect.top < box.top) scroller.current.scrollTop -= box.top - rect.top + 8;
      else if (rect.bottom > box.bottom) scroller.current.scrollTop += rect.bottom - box.bottom + 8;
      saveScroll(screenId, scroller.current.scrollTop);
    }
    clearScrollTarget(screenId);
  }, [screenId, model?.scrollTarget]);

  const rows = screenId ? visibleRows(screenId) : [];
  const hoverEid = nearestVisible(uiState.hover?.screenId === screenId ? uiState.hover : null, rows);
  const selected = uiState.selection.screenId === screenId ? new Set(uiState.selection.eids) : new Set();

  if (devFlags.throwLayers) {
    devFlags.throwLayers = false;
    throw new Error("Layers render failed");
  }

  return (
    <aside className="panel layers-panel">
      <header>
        <h2>Layers</h2>
        {screenId && (
          <input
            value={model?.search || ""}
            placeholder="Search layers"
            onChange={(event) => setSearch(screenId, event.target.value)}
            aria-label="Search layers"
          />
        )}
      </header>
      <div
        className="panel-body"
        ref={scroller}
        onScroll={(event) => screenId && saveScroll(screenId, event.currentTarget.scrollTop)}
      >
        {!screenId && <p className="empty-copy">Click something in a preview</p>}
        {screenId && model?.searchState === "error" && (
          <div className="region-error inline">
            <p>Couldn't load</p>
            <button type="button" onClick={() => runSearch(screenId)}>
              Retry
            </button>
          </div>
        )}
        {screenId && model?.root.state === "error" && (
          <div className="region-error inline">
            <p>Couldn't load layers</p>
            <button type="button" onClick={() => loadChildren(screenId, null, { force: true })}>
              Retry
            </button>
          </div>
        )}
        {screenId && model?.root.state === "loading" && !model.rootIds && <p className="empty-copy">Loading…</p>}
        {screenId && model?.root.state !== "error" && (
          <div
            data-layers-tree
            tabIndex={0}
            className="layer-tree"
            onMouseLeave={() => {
              if (ui.get().hover?.screenId === screenId) setHover(null);
            }}
          >
            {model?.search && model.searchState === "ready" && rows.length === 0 && (
              <p className="empty-copy">No matches</p>
            )}
            {rows.map((row) => (
              <LayerRow
                key={row.eid}
                screenId={screenId}
                row={row}
                selected={selected.has(row.eid)}
                hovered={hoverEid === row.eid}
                searching={Boolean(model?.search)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function LayerRow({ screenId, row, selected, hovered, searching }) {
  const model = getLayers(screenId);
  const status = model.rows[row.eid]?.state;
  return (
    <>
      <div
        data-eid={row.eid}
        className={`layer-row${selected ? " selected" : ""}${hovered ? " hovered" : ""}`}
        style={{ paddingLeft: 8 + row.depth * 14 }}
        onMouseEnter={() => {
          rememberElement(screenId, row);
          setHover({
            screenId,
            eid: row.eid,
            name: row.name,
            ancestors: ancestorChain(screenId, row.eid),
          });
        }}
        onClick={(event) => {
          event.currentTarget.closest("[data-layers-tree]")?.focus();
          rememberElement(screenId, row);
          selectEid(screenId, row.eid, { shift: event.shiftKey, fromLayers: true });
          request(screenId, "reveal", { eid: row.eid }, 1000).catch((error) => {
            if (error?.code === "BRIDGE") raisePreview(screenId, error);
          });
        }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            className="chevron"
            aria-label={row.expanded ? "Collapse" : "Expand"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              if (searching) return;
              setExpanded(screenId, row.eid, !row.expanded);
            }}
          >
            {status === "loading" && !row.childEids ? "…" : row.expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="chevron spacer" />
        )}
        <span className="layer-name">{row.name}</span>
      </div>
      {!searching && row.expanded && status === "loading" && !row.childEids && (
        <div className="row-note" style={{ paddingLeft: 28 + row.depth * 14 }}>
          Loading…
        </div>
      )}
      {!searching && row.expanded && status === "error" && (
        <div className="row-note" style={{ paddingLeft: 28 + row.depth * 14 }}>
          Couldn't load
          <button type="button" onClick={() => loadChildren(screenId, row.eid, { force: true })}>
            Retry
          </button>
        </div>
      )}
      </>
  );
}

function ancestorChain(screenId, eid) {
  const chain = [];
  const guard = new Set();
  let current = eid;
  const model = getLayers(screenId);
  while (current && !guard.has(current)) {
    guard.add(current);
    chain.push(current);
    current = model.nodes[current]?.parentEid || null;
  }
  return chain.reverse();
}

function nearestVisible(hover, rows) {
  if (!hover) return null;
  const visible = new Set(rows.map((row) => row.eid));
  const chain = [...(hover.ancestors || [hover.eid])].reverse();
  for (const eid of chain) {
    if (visible.has(eid)) return eid;
  }
  return null;
}
