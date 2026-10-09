import { useEffect, useRef } from "react";
import {
  clickRow,
  hoverRow,
  nearestVisibleRow,
  retryLayers,
  retryRow,
  searchTree,
  setLayersFocused,
  setLayersScroll,
  setSearch,
  toggleRow,
} from "../controller";
import { RegionError } from "../RegionError";
import { useApp } from "../store";
import type { LayersState, NodeInfo } from "../types";

function rowsOf(L: LayersState): { id: string; depth: number; node: NodeInfo }[] {
  if (L.search && L.searchHits) {
    const tree = searchTree(L.searchHits);
    const out: { id: string; depth: number; node: NodeInfo }[] = [];
    const walk = (pid: string, depth: number) => {
      for (const id of tree.children[pid] || []) {
        const node = tree.nodes[id] || L.nodes[id];
        if (!node) continue;
        out.push({ id, depth, node });
        if (tree.expanded[id]) walk(id, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }
  const out: { id: string; depth: number; node: NodeInfo }[] = [];
  const walk = (pid: string, depth: number) => {
    for (const id of L.children[pid] || []) {
      const node = L.nodes[id];
      if (!node) continue;
      out.push({ id, depth, node });
      if (L.expanded[id] && node.hasChildren) walk(id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export function LayersPanel() {
  const activeScreenId = useApp((s) => s.activeScreenId);
  const layers = useApp((s) => (activeScreenId ? s.layers[activeScreenId] : null));
  const selection = useApp((s) => s.selection);
  const layersHover = useApp((s) => s.layersHover);
  const preview = useApp((s) => (activeScreenId ? s.previews[activeScreenId] : null));
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (treeRef.current && layers) treeRef.current.scrollTop = layers.scrollTop;
  }, [activeScreenId]);

  if (!activeScreenId) {
    return (
      <aside className="panel">
        <h2>Layers</h2>
        <p className="empty">Click something in a preview</p>
      </aside>
    );
  }

  if (preview?.status === "error") {
    return (
      <aside className="panel">
        <h2>Layers</h2>
        <p className="empty">Preview is disconnected</p>
      </aside>
    );
  }

  if (!layers || layers.rootStatus === "idle" || layers.rootStatus === "loading") {
    return (
      <aside className="panel">
        <h2>Layers</h2>
        <p className="empty connecting">Loading…</p>
      </aside>
    );
  }

  if (layers.rootStatus === "error") {
    return (
      <aside className="panel">
        <h2>Layers</h2>
        <RegionError message={layers.rootError || "Couldn't load layers"} onRetry={() => retryLayers(activeScreenId)} />
      </aside>
    );
  }

  const rows = rowsOf(layers);
  const selected = new Set(selection?.screenId === activeScreenId ? selection.ids : []);
  const hoverId =
    layersHover?.screenId === activeScreenId && layersHover.id
      ? nearestVisibleRow(activeScreenId, layersHover.id)
      : null;
  const searching = !!layers.search;

  return (
    <aside className="panel">
      <h2>Layers</h2>
      <input
        className="layers-search"
        placeholder="Search layers"
        value={layers.search}
        onChange={(e) => setSearch(activeScreenId, e.target.value)}
      />
      <div
        className="layers-tree"
        ref={treeRef}
        tabIndex={0}
        onFocus={() => setLayersFocused(true)}
        onBlur={() => setLayersFocused(false)}
        onScroll={(e) => setLayersScroll(activeScreenId, e.currentTarget.scrollTop)}
      >
        {rows.map(({ id, depth, node }) => {
          const status = layers.rowStatus[id];
          const expanded = searching ? true : !!layers.expanded[id];
          return (
            <div
              key={id}
              data-layer-id={id}
              className={`layer-row${selected.has(id) ? " selected" : ""}${hoverId === id ? " hovered" : ""}`}
              onMouseEnter={() => hoverRow(activeScreenId, id)}
              onMouseLeave={() => hoverRow(activeScreenId, null)}
              onClick={(e) => clickRow(activeScreenId, id, e.shiftKey)}
            >
              <span className="layer-indent" style={{ width: 4 + depth * 14 }} aria-hidden />
              <button
                type="button"
                className={`chevron${node.hasChildren ? "" : " hidden"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (searching) return;
                  toggleRow(activeScreenId, id);
                }}
              >
                {node.hasChildren ? (expanded ? "▾" : "▸") : "·"}
              </button>
              <span className="layer-name">{node.name}</span>
              {status?.state === "loading" && <span className="row-status">Loading…</span>}
              {status?.state === "error" && (
                <>
                  <span className="row-status error">Couldn't load</span>
                  <button
                    type="button"
                    className="retry-inline"
                    onClick={(e) => {
                      e.stopPropagation();
                      retryRow(activeScreenId, id);
                    }}
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
