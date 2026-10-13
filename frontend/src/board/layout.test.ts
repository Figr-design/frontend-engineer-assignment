import { describe, expect, it } from "vitest";
import { COLUMNS, GAP_X, GAP_Y, PREVIEW_HEIGHT, PREVIEW_WIDTH, gridLayout } from "./layout";

describe("gridLayout", () => {
  it("places 24 previews at 1280×800 in rows of COLUMNS with constant gaps", () => {
    const { boxes, width, height } = gridLayout(24);

    expect(boxes).toHaveLength(24);
    for (const box of boxes) {
      expect(box.width).toBe(PREVIEW_WIDTH);
      expect(box.height).toBe(PREVIEW_HEIGHT);
    }
    expect(boxes[1].x - boxes[0].x).toBe(PREVIEW_WIDTH + GAP_X);
    expect(boxes[COLUMNS].x).toBe(0);
    expect(boxes[COLUMNS].y - boxes[0].y).toBe(PREVIEW_HEIGHT + GAP_Y);

    const rows = 24 / COLUMNS;
    expect(width).toBe(COLUMNS * PREVIEW_WIDTH + (COLUMNS - 1) * GAP_X);
    expect(height).toBe(rows * PREVIEW_HEIGHT + (rows - 1) * GAP_Y);
  });

  it("sizes a partial row by its actual column count and handles zero", () => {
    expect(gridLayout(2).width).toBe(2 * PREVIEW_WIDTH + GAP_X);
    expect(gridLayout(0)).toEqual({ boxes: [], width: 0, height: 0 });
  });
});
