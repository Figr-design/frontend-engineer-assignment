import { useEffect } from "react";
import { Board } from "./Board.jsx";
import { RegionBoundary } from "./boundaries.jsx";
import { loadScreens, syncMode } from "./bridgeHost.js";
import { DevMenu } from "./DevMenu.jsx";
import { Inspector } from "./Inspector.jsx";
import { Layers } from "./Layers.jsx";
import { setMode } from "./selection.js";
import { ui, useStore } from "./store.js";

export function App() {
  const mode = useStore(ui).mode;

  useEffect(() => {
    loadScreens();
    syncMode("select");
  }, []);

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Viewer</strong>
        <div className="modes" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "select"} onClick={() => setMode("select")}>
            Select
          </button>
          <button type="button" aria-pressed={mode === "interact"} onClick={() => setMode("interact")}>
            Interact
          </button>
        </div>
        <span className="hint">V select · I interact · drag to pan · ctrl wheel zooms</span>
      </header>
      <div className="workspace">
        <RegionBoundary region="board" className="region-error cover-center" message="Something went wrong on the board">
          <Board />
        </RegionBoundary>
        <Layers />
        <Inspector />
      </div>
      <DevMenu />
    </div>
  );
}
