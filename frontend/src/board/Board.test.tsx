import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Board } from "./Board";
import { jsonResponse, screens24 } from "../test/fixtures";
import { report } from "../../report.js";

vi.mock("../../report.js", () => ({ report: vi.fn() }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.mocked(report).mockClear();
});

describe("Board", () => {
  it("shows a loading state, then all 24 previews with their names at 1280×800", async () => {
    fetchMock.mockResolvedValue(jsonResponse(screens24));
    render(<Board />);

    expect(screen.getByText("Loading screens…")).toBeTruthy();

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(screens24.map((s) => s.name));

    const frames = screens24.map((s) => screen.getByTitle(s.name) as HTMLIFrameElement);
    frames.forEach((frame, i) => {
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("src")).toBe(screens24[i].url);
      expect(frame.getAttribute("width")).toBe("1280");
      expect(frame.getAttribute("height")).toBe("800");
    });
    expect(screen.queryByText("Loading screens…")).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("shows an empty state when the API returns no screens", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    render(<Board />);
    expect(await screen.findByText("No screens to show.")).toBeTruthy();
  });

  it("shows the board error and reports it once on a 5xx, then recovers on Retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Service unavailable" }, 503));
    fetchMock.mockResolvedValueOnce(jsonResponse(screens24));
    render(<Board />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load screens.");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "http", status: 503 }), {
      region: "board",
      screenId: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByRole("heading", { level: 2 })).toHaveLength(24);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("treats a malformed 200 body as an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse('{"component": "Butt'));
    render(<Board />);
    expect((await screen.findByRole("alert")).textContent).toContain("invalid JSON");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "malformed" }), expect.anything());
  });

  it("treats a network failure as an error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<Board />);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach the API");
  });

  it("reports a retry that fails again as a new failure", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: "x" }, 500)));
    render(<Board />);
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Loading screens…");
    await screen.findByRole("alert");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("cancels silently when unmounted mid-request", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_, reject) => {
          signal = init.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const { unmount } = render(<Board />);
    unmount();

    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });
});
