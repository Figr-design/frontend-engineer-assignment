import { useEffect, useRef, useState } from "react";
import { camera } from "../camera";
import {
  beginPan,
  clickEmptyBoard,
  clickScreenName,
  endPan,
  loadScreens,
  onBoardWheel,
} from "../controller";
import { RegionError } from "../RegionError";
import { useApp } from "../store";
import { LABEL_H, PREVIEW_H, PREVIEW_W, screenPos } from "../types";
import { Preview } from "./Preview";

export function Board() {
  const boardStatus = useApp((s) => s.boardStatus);
  const boardError = useApp((s) => s.boardError);
  const screens = useApp((s) => s.screens);
  const activeScreenId = useApp((s) => s.activeScreenId);
  const viewRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const drag = useRef({ down: false, moved: false, x: 0, y: 0 });

  useEffect(() => {
    camera.setView(viewRef.current);
    camera.setWorld(worldRef.current);
    return () => {
      camera.setView(null);
      camera.setWorld(null);
    };
  }, [boardStatus]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => onBoardWheel(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [boardStatus]);

  if (boardStatus === "loading") {
    return (
      <div className="board">
        <p className="empty connecting">Loading screens…</p>
      </div>
    );
  }
  if (boardStatus === "error") {
    return (
      <div className="board">
        <RegionError message={boardError || "Couldn't load screens"} onRetry={() => void loadScreens()} />
      </div>
    );
  }

  return (
    <div
      className={`board${panning ? " panning" : ""}`}
      ref={viewRef}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const t = e.target as HTMLElement;
        if (t.closest(".hit-overlay") || t.closest(".screen-name") || t.closest(".page-error") || t.closest(".preview-status")) {
          return;
        }
        drag.current = { down: true, moved: false, x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current.down) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        if (!drag.current.moved && dx * dx + dy * dy > 16) {
          drag.current.moved = true;
          setPanning(true);
          beginPan();
        }
        if (drag.current.moved) {
          camera.panBy(dx, dy);
          drag.current.x = e.clientX;
          drag.current.y = e.clientY;
        }
      }}
      onPointerUp={(e) => {
        if (!drag.current.down) return;
        drag.current.down = false;
        if (drag.current.moved) {
          setPanning(false);
          endPan();
        } else {
          clickEmptyBoard();
        }
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }}
    >
      <div className="board-world" ref={worldRef}>
        {screens.map((screen, i) => {
          const pos = screenPos(i);
          return (
            <div
              key={screen.id}
              className="screen-wrap"
              style={{ left: pos.x, top: pos.y, width: PREVIEW_W, height: PREVIEW_H + LABEL_H }}
            >
              <div
                className={`screen-name${activeScreenId === screen.id ? " active" : ""}`}
                onClick={() => clickScreenName(screen.id)}
              >
                {screen.name}
              </div>
              <Preview screen={screen} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
