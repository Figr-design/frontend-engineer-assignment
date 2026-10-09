import { useEffect, useRef } from "react";
import {
  localCoords,
  onIframeLoad,
  armOverlayClick,
  onOverlayClick,
  onOverlayLeave,
  onOverlayMove,
  onOverlayWheel,
  registerIframe,
  retryPreview,
} from "../controller";
import { RegionError } from "../RegionError";
import { useApp } from "../store";
import type { Screen } from "../types";

export function Preview({ screen }: { screen: Screen }) {
  const preview = useApp((s) => s.previews[screen.id]);
  const mode = useApp((s) => s.mode);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const status = preview?.status ?? "connecting";
  const select = mode === "select" && status === "ready";

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => onOverlayWheel(screen.id, e, el);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [screen.id, select]);

  return (
    <div className="preview">
      <iframe
        key={preview?.iframeKey ?? 1}
        ref={(el) => {
          iframeRef.current = el;
          registerIframe(screen.id, el);
        }}
        title={screen.name}
        src={screen.url}
        onLoad={() => onIframeLoad(screen.id)}
        style={{ pointerEvents: mode === "select" ? "none" : "auto" }}
      />
      {select && (
        <div
          ref={overlayRef}
          className="hit-overlay"
          onPointerMove={(e) => {
            const el = e.currentTarget;
            const { x, y } = localCoords(e, el);
            onOverlayMove(screen.id, x, y);
          }}
          onPointerLeave={() => onOverlayLeave(screen.id)}
          onPointerDown={(e) => {
            e.stopPropagation();
            armOverlayClick();
          }}
          onClick={(e) => {
            const { x, y } = localCoords(e, e.currentTarget);
            void onOverlayClick(screen.id, x, y, e.shiftKey);
          }}
        />
      )}
      {status === "error" && (
        <div className="preview-status" onPointerDown={(e) => e.stopPropagation()}>
          <RegionError
            message={preview?.error || "Couldn't connect to this preview"}
            onRetry={() => retryPreview(screen.id)}
          />
        </div>
      )}
      {preview?.pageError && (
        <div className="page-error" onPointerDown={(e) => e.stopPropagation()}>
          Page error
          <div className="tip">{preview.pageError}</div>
        </div>
      )}
    </div>
  );
}
