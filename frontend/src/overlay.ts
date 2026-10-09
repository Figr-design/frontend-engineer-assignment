import type { PackedNode } from "./types";

export type OverlayBox = PackedNode & { screenId: string };

let hover: OverlayBox | null = null;
let selected: OverlayBox[] = [];
const listeners = new Set<() => void>();
let raf = 0;

function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    listeners.forEach((fn) => fn());
  });
}

export const overlay = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getHover() {
    return hover;
  },
  getSelected() {
    return selected;
  },
  setHover(next: OverlayBox | null) {
    hover = next;
    emit();
  },
  setSelected(next: OverlayBox[]) {
    selected = next;
    emit();
  },
  clearHover() {
    if (!hover) return;
    hover = null;
    emit();
  },
  fromRects(screenId: string, hoverNode: PackedNode | null, selectedNodes: PackedNode[]) {
    hover = hoverNode ? { ...hoverNode, screenId } : hover && hover.screenId === screenId ? null : hover;
    if (hover && hover.screenId !== screenId) {
      /* keep other screen hover only if this message has no hover; host enforces one hover */
    }
    const others = selected.filter((s) => s.screenId !== screenId);
    selected = others.concat(selectedNodes.map((n) => ({ ...n, screenId })));
    emit();
  },
};
