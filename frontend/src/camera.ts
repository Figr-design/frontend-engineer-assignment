import { MAX_ZOOM, MIN_ZOOM } from "./types";

export type Camera = { x: number; y: number; zoom: number };

let cam: Camera = { x: 48, y: 48, zoom: 0.35 };
let viewEl: HTMLElement | null = null;
let worldEl: HTMLElement | null = null;
const listeners = new Set<() => void>();
let raf = 0;

function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    apply();
    listeners.forEach((fn) => fn());
  });
}

function apply() {
  if (!worldEl) return;
  worldEl.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
}

export const camera = {
  get(): Camera {
    return cam;
  },
  setView(el: HTMLElement | null) {
    viewEl = el;
  },
  setWorld(el: HTMLElement | null) {
    worldEl = el;
    apply();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  panBy(dx: number, dy: number) {
    cam = { ...cam, x: cam.x + dx, y: cam.y + dy };
    emit();
  },
  zoomAt(clientX: number, clientY: number, deltaY: number) {
    if (!viewEl) return;
    const view = viewEl.getBoundingClientRect();
    const sx = clientX - view.left;
    const sy = clientY - view.top;
    const worldX = (sx - cam.x) / cam.zoom;
    const worldY = (sy - cam.y) / cam.zoom;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * Math.exp(-deltaY * 0.0016)));
    cam = { x: sx - worldX * next, y: sy - worldY * next, zoom: next };
    emit();
  },
  setZoom(zoom: number, clientX?: number, clientY?: number) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (clientX != null && clientY != null && viewEl) {
      const view = viewEl.getBoundingClientRect();
      const sx = clientX - view.left;
      const sy = clientY - view.top;
      const worldX = (sx - cam.x) / cam.zoom;
      const worldY = (sy - cam.y) / cam.zoom;
      cam = { x: sx - worldX * z, y: sy - worldY * z, zoom: z };
    } else {
      cam = { ...cam, zoom: z };
    }
    emit();
  },
};
