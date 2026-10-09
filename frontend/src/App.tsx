import { useEffect } from "react";
import { Board } from "./board/Board";
import { OverlayLayer } from "./board/OverlayLayer";
import { Toolbar } from "./board/Toolbar";
import { initRuntime } from "./controller";
import { Inspector } from "./inspector/Inspector";
import { LayersPanel } from "./layers/LayersPanel";

export function App() {
  useEffect(() => {
    initRuntime();
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <LayersPanel />
        <Board />
        <Inspector />
      </div>
      <OverlayLayer />
    </div>
  );
}
