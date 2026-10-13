import type { CSSProperties } from "react";
import type { Faults } from "../api/screens";
import { gridLayout } from "./layout";
import { Preview } from "./Preview";
import { useScreens } from "./useScreens";

// Fixed for now. Pan/zoom will own this value and drive the same transform.
const VIEWPORT = { x: 48, y: 72, zoom: 0.25 };

export function Board({ faults }: { faults?: Faults }) {
  const { state, retry } = useScreens(faults);

  if (state.status === "loading") {
    return (
      <div className="board-message" role="status">
        Loading screens…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="board-message board-error" role="alert">
        <p>Couldn't load screens.</p>
        <p className="board-error-detail">{state.error.message}</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  if (state.screens.length === 0) {
    return <div className="board-message">No screens to show.</div>;
  }

  const { boxes, width, height } = gridLayout(state.screens.length);
  const { x, y, zoom } = VIEWPORT;

  return (
    <div className="board" data-testid="board">
      <div className="board-sizer" style={{ width: width * zoom + 2 * x, height: height * zoom + 2 * y }}>
        <div
          className="board-world"
          style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, "--zoom": zoom } as CSSProperties}
        >
          {state.screens.map((screen, i) => (
            <Preview key={screen.id} screen={screen} box={boxes[i]} />
          ))}
        </div>
      </div>
    </div>
  );
}
