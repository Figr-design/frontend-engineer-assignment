import { useEffect, useReducer } from "react";
import { camera } from "../camera";
import { iframeEl } from "../controller";
import { overlay } from "../overlay";
import { useApp } from "../store";
import { PREVIEW_H, PREVIEW_W } from "../types";

export function OverlayLayer() {
  const mode = useApp((s) => s.mode);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => overlay.subscribe(() => tick()), []);
  useEffect(() => camera.subscribe(() => tick()), []);
  useEffect(() => {
    const onResize = () => tick();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const hover = mode === "select" ? overlay.getHover() : null;
  const selected = overlay.getSelected();
  if (!hover && !selected.length) return null;
  const byScreen = new Map<string, { hover?: typeof hover; selected: typeof selected }>();
  for (const box of selected) {
    const g = byScreen.get(box.screenId) ?? { selected: [] };
    g.selected = g.selected.concat(box);
    byScreen.set(box.screenId, g);
  }
  if (hover) {
    const g = byScreen.get(hover.screenId) ?? { selected: [] };
    g.hover = hover;
    byScreen.set(hover.screenId, g);
  }

  return (
    <div className="overlay-root">
      {[...byScreen.entries()].map(([screenId, group]) => {
        const iframe = iframeEl(screenId);
        if (!iframe) return null;
        const ir = iframe.getBoundingClientRect();
        const board = document.querySelector(".board")?.getBoundingClientRect();
        const clipLeft = board ? Math.max(ir.left, board.left) : ir.left;
        const clipTop = board ? Math.max(ir.top, board.top) : ir.top;
        const clipRight = board ? Math.min(ir.right, board.right) : ir.right;
        const clipBottom = board ? Math.min(ir.bottom, board.bottom) : ir.bottom;
        const clipW = clipRight - clipLeft;
        const clipH = clipBottom - clipTop;
        if (clipW < 0.5 || clipH < 0.5) return null;
        const sx = ir.width / PREVIEW_W;
        const sy = ir.height / PREVIEW_H;
        const boxes = [
          ...group.selected.filter((b) => b.visible).map((b) => ({ box: b, kind: "select" as const })),
          ...(group.hover && group.hover.visible && !group.selected.some((s) => s.id === group.hover!.id)
            ? [{ box: group.hover, kind: "hover" as const }]
            : []),
        ];
        return (
          <div
            key={screenId}
            className="clip"
            style={{ left: clipLeft, top: clipTop, width: clipW, height: clipH }}
          >
            {boxes.map(({ box, kind }) => {
              const left = box.rect.left * sx + (ir.left - clipLeft);
              const top = box.rect.top * sy + (ir.top - clipTop);
              const width = Math.max(0, box.rect.width * sx);
              const height = Math.max(0, box.rect.height * sy);
              if (width < 0.5 && height < 0.5) return null;
              const visTop = Math.max(0, top);
              const visBottom = Math.min(clipH, top + height);
              const visLeft = Math.max(0, left);
              const visRight = Math.min(clipW, left + width);
              if (visBottom - visTop < 0.5 || visRight - visLeft < 0.5) return null;
              const labelH = 16;
              const above = visTop >= labelH;
              return (
                <div
                  key={kind + box.id}
                  className={`box ${kind}`}
                  style={{ left, top, width, height }}
                >
                  <div className={`label ${above ? "above" : "below"}`}>{box.name}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
