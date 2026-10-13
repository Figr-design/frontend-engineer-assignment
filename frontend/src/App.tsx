import { faultsFromSearch } from "./api/screens";
import { Board } from "./board/Board";

// e.g. http://localhost:5173/?latency=2000&fail=0.5 forwards the backend's fault knobs.
const faults = faultsFromSearch(window.location.search);

export function App() {
  return (
    <div className="app">
      <header className="toolbar">
        <span className="toolbar-title">Figr Viewer</span>
      </header>
      <main className="board-region">
        <Board faults={faults} />
      </main>
    </div>
  );
}
