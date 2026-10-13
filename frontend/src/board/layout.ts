// Board geometry in world units (1 unit = 1 CSS px of a preview at 100% zoom).
// Kept pure so pan/zoom and the overlay can reuse the same preview positions.

export const PREVIEW_WIDTH = 1280;
export const PREVIEW_HEIGHT = 800;

// Six columns: /screens repeats the six pages in order, so each column is one page
// and each row is one variant (A–D).
export const COLUMNS = 6;
export const GAP_X = 160;
export const GAP_Y = 240; // leaves room for the name label above each preview

export type Box = { x: number; y: number; width: number; height: number };

export function gridLayout(count: number, columns = COLUMNS): { boxes: Box[]; width: number; height: number } {
  const boxes = Array.from({ length: count }, (_, i) => ({
    x: (i % columns) * (PREVIEW_WIDTH + GAP_X),
    y: Math.floor(i / columns) * (PREVIEW_HEIGHT + GAP_Y),
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
  }));
  const cols = Math.min(count, columns);
  const rows = Math.ceil(count / columns);
  return {
    boxes,
    width: cols === 0 ? 0 : cols * PREVIEW_WIDTH + (cols - 1) * GAP_X,
    height: rows === 0 ? 0 : rows * PREVIEW_HEIGHT + (rows - 1) * GAP_Y,
  };
}
