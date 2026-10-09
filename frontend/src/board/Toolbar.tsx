import { useEffect, useState } from "react";
import { camera } from "../camera";
import {
  devFailDetails,
  devFailHandshake,
  devFailLayers,
  devFailRow,
  devFailScreens,
  devInjectPageError,
  devThrowInspector,
  setMode,
} from "../controller";
import { useApp } from "../store";

export function Toolbar() {
  const mode = useApp((s) => s.mode);
  const zoomLabel = useApp((s) => s.zoomLabel);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(zoomLabel);

  useEffect(() => {
    return camera.subscribe(() => setZoom(camera.get().zoom));
  }, []);

  return (
    <div className="toolbar">
      <div className="brand">Figr viewer</div>
      <button type="button" className={mode === "select" ? "active" : ""} onClick={() => setMode("select")}>
        Select (V)
      </button>
      <button type="button" className={mode === "interact" ? "active" : ""} onClick={() => setMode("interact")}>
        Interact (I)
      </button>
      <span className="zoom">{Math.round(zoom * 100)}%</span>
      <div className="spacer" />
      <div className="dev">
        <button type="button" onClick={() => setOpen((v) => !v)}>
          Dev
        </button>
        {open && (
          <div className="dev-menu">
            <button type="button" onClick={() => { devFailScreens(); setOpen(false); }}>
              Fail GET /screens
            </button>
            <button type="button" onClick={() => { devFailHandshake(); setOpen(false); }}>
              Fail preview handshake
            </button>
            <button type="button" onClick={() => { devFailDetails(); setOpen(false); }}>
              Fail details fetch
            </button>
            <button type="button" onClick={() => { devThrowInspector(); setOpen(false); }}>
              Throw inspector render
            </button>
            <button type="button" onClick={() => { devFailLayers(); setOpen(false); }}>
              Fail layers root load
            </button>
            <button type="button" onClick={() => { devFailRow(); setOpen(false); }}>
              Fail next row expand
            </button>
            <button type="button" onClick={() => { devInjectPageError(); setOpen(false); }}>
              Inject page error
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
