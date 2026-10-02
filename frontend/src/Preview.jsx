import { memo, useEffect, useRef } from "react";
import { localPoint, registerIframe, request, send, unregisterIframe, wheelPixels } from "./bus.js";
import { arm, clearPreviewFault, disposeConnect, raisePreview } from "./connections.js";
import { RegionBoundary } from "./boundaries.jsx";
import {
  bumpHoverGen,
  clearHover,
  clickPreview,
  isBoardDragging,
  isHoverGen,
  setHover,
} from "./selection.js";
import {
  cardOrigin,
  devFlags,
  devStore,
  LABEL_H,
  PREVIEW_H,
  PREVIEW_W,
  previewStore,
  rectStoreFor,
  rememberElement,
  ui,
  useStore,
  useZoom,
} from "./store.js";

export const Preview = memo(function Preview({ screen, index }) {
  const origin = cardOrigin(index);
  return (
    <section className="preview-card" style={{ left: origin.x, top: origin.y, width: PREVIEW_W }}>
      <h3 className="preview-title">{screen.name}</h3>
      <div className="preview-frame" style={{ width: PREVIEW_W, height: PREVIEW_H }}>
        <Frame screen={screen} />
      </div>
    </section>
  );
});

function Frame({ screen }) {
  const status = useStore(previewStore)[screen.id];
  const iframeRef = useRef(null);
  const src = status?.src || screen.url;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    registerIframe(screen.id, iframe);
    arm(screen.id);
    const onLoad = () => arm(screen.id, { fromLoad: true });
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      disposeConnect(screen.id);
      unregisterIframe(screen.id);
    };
  }, [screen.id, src]);

  const retry = () => {
    previewStore.set((state) => ({
      ...state,
      [screen.id]: {
        ...(state[screen.id] || {}),
        state: "connecting",
        kind: null,
        message: null,
        src: `${screen.url}${screen.url.includes("?") ? "&" : "?"}reload=${Date.now()}`,
      },
    }));
  };

  return (
    <>
      <iframe ref={iframeRef} title={screen.name} src={src} />
      <RegionBoundary
        region="preview"
        screenId={screen.id}
        className="region-error cover"
        message="This preview hit an error"
      >
        <Outlines screenId={screen.id} />
        <HitLayer screenId={screen.id} />
      </RegionBoundary>
      {status?.pageError && (
        <div className="page-badge">
          Page error
          <span>{status.pageError}</span>
        </div>
      )}
      {status?.kind === "connect" && (
        <div className="region-error cover">
          <p>Couldn't connect to this preview</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {status?.kind === "runtime" && (
        <div className="region-error cover">
          <p>{status.message || "This preview hit an error"}</p>
          <button type="button" onClick={() => clearPreviewFault(screen.id)}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}

function Outlines({ screenId }) {
  const zoom = useZoom();
  const mode = useStore(ui).mode;
  const hover = useStore(ui).hover;
  const selection = useStore(ui).selection;
  const rects = useStore(rectStoreFor(screenId));
  useStore(devStore);

  if (devFlags.throwDraw && (hover?.screenId === screenId || selection.screenId === screenId)) {
    devFlags.throwDraw = false;
    throw new Error("Drawing failed");
  }

  if (mode !== "select") return null;
  const boxes = [];
  if (selection.screenId === screenId) {
    for (const eid of selection.eids) {
      const rect = rects[eid];
      if (rect) boxes.push({ eid, rect, kind: "select" });
    }
  }
  if (hover?.screenId === screenId && hover.eid && !selection.eids.includes(hover.eid)) {
    const rect = rects[hover.eid];
    if (rect) boxes.push({ eid: hover.eid, rect, kind: "hover" });
  }

  const labelH = 18 / zoom;
  return (
    <div className="outlines">
      {boxes.map((box) => {
        const above = box.rect.y >= labelH;
        const color = box.kind === "select" ? "#ff7a1a" : "#3b82f6";
        const thickness = (box.kind === "select" ? 2 : 1) / zoom;
        return (
          <div key={`${box.kind}-${box.eid}`}>
            <div
              className="outline-box"
              style={{
                left: box.rect.x,
                top: box.rect.y,
                width: Math.max(box.rect.w, 0),
                height: Math.max(box.rect.h, 0),
                border: `${thickness}px solid ${color}`,
              }}
            />
            <div
              className="outline-label"
              style={{
                left: box.rect.x,
                top: above ? box.rect.y - labelH : box.rect.y + box.rect.h,
                height: labelH,
                lineHeight: `${labelH}px`,
                fontSize: 11 / zoom,
                padding: `0 ${6 / zoom}px`,
                background: color,
              }}
            >
              {box.rect.name || "element"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HitLayer({ screenId }) {
  const mode = useStore(ui).mode;
  const ref = useRef(null);
  const flight = useRef(false);
  const latest = useRef(null);
  const down = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      if (ui.get().mode !== "select") return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const point = localPoint(event, el);
      const { dx, dy } = wheelPixels(event);
      send(screenId, { type: "scroll", x: point.x, y: point.y, dx, dy });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [screenId]);

  const pump = () => {
    if (flight.current || !latest.current) return;
    const point = latest.current;
    latest.current = null;
    const gen = bumpHoverGen();
    flight.current = true;
    request(screenId, "hit", point, 700)
      .then((desc) => {
        if (!isHoverGen(gen) || ui.get().mode !== "select") return;
        if (!desc) {
          if (ui.get().hover?.screenId === screenId) clearHover();
          return;
        }
        rememberElement(screenId, desc);
        setHover({ screenId, eid: desc.eid, name: desc.name, ancestors: desc.ancestors || [desc.eid] });
      })
      .catch((error) => {
        if (error?.code === "BRIDGE") raisePreview(screenId, error);
      })
      .finally(() => {
        flight.current = false;
        if (latest.current) pump();
      });
  };

  return (
    <div
      ref={ref}
      className="hit-layer"
      style={{ pointerEvents: mode === "select" ? "auto" : "none" }}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.button !== 0 || ui.get().mode !== "select") return;
        event.preventDefault();
        event.currentTarget.focus();
        down.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
      }}
      onPointerUp={(event) => {
        const start = down.current;
        down.current = null;
        if (!start || ui.get().mode !== "select" || isBoardDragging()) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
        if (devFlags.throwClick) {
          devFlags.throwClick = false;
          try {
            throw new Error("Click handler failed");
          } catch (error) {
            raisePreview(screenId, error);
          }
          return;
        }
        const point = localPoint(event, event.currentTarget);
        request(screenId, "hit", point, 1000)
          .then((desc) => clickPreview(screenId, desc, start.shift))
          .catch((error) => {
            if (error?.code === "TIMEOUT" || error?.code === "CANCELLED" || error?.code === "GONE") return;
            raisePreview(screenId, error);
          });
      }}
      onPointerMove={(event) => {
        if (ui.get().mode !== "select" || isBoardDragging()) return;
        latest.current = localPoint(event, event.currentTarget);
        pump();
      }}
      onPointerLeave={() => {
        latest.current = null;
        bumpHoverGen();
        if (ui.get().hover?.screenId === screenId) clearHover();
      }}
    />
  );
}
