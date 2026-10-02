import { useEffect, useRef } from "react";
import { clearBoardFault, loadScreens, raiseBoard } from "./bridgeHost.js";
import { clearHover, setBoardDragging, userClearSelection } from "./selection.js";
import {
  bindViewport,
  bindWorld,
  devFlags,
  devStore,
  fitCamera,
  gridSize,
  screensStore,
  setPan,
  usePan,
  useStore,
  useZoom,
  camera,
  zoomAtClient,
} from "./store.js";
import { wheelPixels } from "./bus.js";
import { Preview } from "./Preview.jsx";

export function Board() {
  const screensState = useStore(screensStore);
  const zoom = useZoom();
  const pan = usePan();
  useStore(devStore);
  const viewportRef = useRef(null);
  const worldRef = useRef(null);
  const drag = useRef(null);
  const space = useRef(false);

  useEffect(() => {
    const typing = (event) => {
      const tag = event.target?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable;
    };
    const onKeyDown = (event) => {
      if (event.code !== "Space" || typing(event) || event.repeat) return;
      space.current = true;
      event.preventDefault();
    };
    const onKeyUp = (event) => {
      if (event.code === "Space") space.current = false;
    };
    const onBlur = () => {
      space.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    bindViewport(viewportRef.current);
    bindWorld(worldRef.current);
    if (screensState.status === "ready" && screensState.screens.length) fitCamera(screensState.screens.length);
  }, [screensState.status, screensState.screens.length]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const onWheel = (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        clearHover();
        zoomAtClient(event.clientX, event.clientY, event.deltaY);
        return;
      }
      if (event.target.closest?.(".preview-frame")) return;
      event.preventDefault();
      clearHover();
      const { dx, dy } = wheelPixels(event);
      setPan(camera.panX - dx, camera.panY - dy);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [screensState.status]);

  if (devFlags.throwBoard) {
    devFlags.throwBoard = false;
    throw new Error("Board render failed");
  }

  const onPointerDown = (event) => {
    const anywhere = event.button === 1 || space.current;
    if (event.button !== 0 && !anywhere) return;
    const onCard = Boolean(event.target.closest?.(".preview-card"));
    if (!anywhere && onCard && devFlags.throwClick) return;
    if (anywhere) {
      event.preventDefault();
      event.stopPropagation();
    } else if (!onCard && devFlags.throwClick) {
      devFlags.throwClick = false;
      try {
        throw new Error("Click handler failed");
      } catch (error) {
        raiseBoard(error);
      }
      return;
    }
    setBoardDragging(false);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      panX: camera.panX,
      panY: camera.panY,
      moved: false,
      onCard,
      pointerId: event.pointerId,
    };
    if (anywhere) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) > 4) {
      current.moved = true;
      setBoardDragging(true);
      clearHover();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (current.moved) setPan(current.panX + dx, current.panY + dy);
  };

  const onPointerUp = (event) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.moved && !current.onCard) userClearSelection();
    setBoardDragging(false);
  };

  const size = gridSize(screensState.screens.length);

  return (
    <div className="board">
      {screensState.fault && (
        <div className="region-error banner">
          <p>{screensState.fault}</p>
          <button type="button" onClick={clearBoardFault}>
            Retry
          </button>
        </div>
      )}
      {screensState.status === "loading" && <div className="board-message">Loading screens…</div>}
      {screensState.status === "error" && (
        <div className="region-error cover-center">
          <p>Couldn't load screens</p>
          <button type="button" onClick={() => loadScreens()}>
            Retry
          </button>
        </div>
      )}
      {screensState.status === "ready" && (
        <div
          className="board-viewport"
          ref={viewportRef}
          onPointerDownCapture={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            className="world"
            ref={worldRef}
            style={{
              width: size.width,
              height: size.height,
              left: pan.x,
              top: pan.y,
              transform: `scale(${zoom})`,
            }}
          >
            {screensState.screens.map((screen, index) => (
              <Preview key={screen.id} screen={screen} index={index} />
            ))}
          </div>
        </div>
      )}
      <div className="zoom-readout">{Math.round(zoom * 100)}%</div>
    </div>
  );
}
