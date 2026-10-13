import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CONNECT_TIMEOUT_MS, Preview } from "./Preview";
import { gridLayout } from "./layout";
import { screens24 } from "../test/fixtures";
import { report } from "../../report.js";

vi.mock("../../report.js", () => ({ report: vi.fn() }));

const target = screens24[2];
const box = gridLayout(1).boxes[0];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(report).mockClear();
});

describe("Preview", () => {
  it("shows its own loading state until the frame loads", () => {
    render(<Preview screen={target} box={box} />);
    expect(screen.getByRole("status").textContent).toBe("Loading…");

    fireEvent.load(screen.getByTitle(target.name));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT_MS));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("shows a connection error after 10s, reports once, and retries with a fresh frame", () => {
    render(<Preview screen={target} box={box} />);
    const firstFrame = screen.getByTitle(target.name);

    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1));
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't connect to this preview");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(Error), { region: "preview", screenId: target.id });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByTitle(target.name)).not.toBe(firstFrame);

    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT_MS));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("reports nothing when unmounted before the timeout", () => {
    const { unmount } = render(<Preview screen={target} box={box} />);
    unmount();
    act(() => vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2));
    expect(report).not.toHaveBeenCalled();
  });
});
