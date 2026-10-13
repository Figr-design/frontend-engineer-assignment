import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, faultsFromSearch, fetchScreens, parseScreens } from "./screens";
import { jsonResponse, screens24 } from "../test/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseScreens", () => {
  it("accepts a valid list and keeps only id, name and url", () => {
    const parsed = parseScreens([{ id: "scr-01", name: "Landing", url: "http://localhost:4001/page-1.html", extra: 1 }]);
    expect(parsed).toEqual([{ id: "scr-01", name: "Landing", url: "http://localhost:4001/page-1.html" }]);
  });

  it("accepts an empty list", () => {
    expect(parseScreens([])).toEqual([]);
  });

  it.each([
    ["a non-array body", { screens: [] }],
    ["null", null],
    ["a null item", [null]],
    ["a missing id", [{ name: "A", url: "http://x.test/a" }]],
    ["an empty id", [{ id: "", name: "A", url: "http://x.test/a" }]],
    ["a numeric name", [{ id: "a", name: 1, url: "http://x.test/a" }]],
    ["a missing url", [{ id: "a", name: "A" }]],
    ["an unparseable url", [{ id: "a", name: "A", url: "not a url" }]],
    ["a non-http url", [{ id: "a", name: "A", url: "javascript:alert(1)" }]],
    [
      "duplicate ids",
      [
        { id: "a", name: "A", url: "http://x.test/a" },
        { id: "a", name: "B", url: "http://x.test/b" },
      ],
    ],
  ])("rejects %s as malformed", (_, body) => {
    expect(() => parseScreens(body)).toThrow(expect.objectContaining({ name: "ApiError", kind: "malformed" }));
  });
});

describe("fetchScreens", () => {
  it("returns validated screens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(screens24)));
    await expect(fetchScreens()).resolves.toEqual(screens24);
  });

  it("forwards latency and fail to the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await fetchScreens({ latency: 500, fail: 0.5 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/screens");
    expect(url.searchParams.get("latency")).toBe("500");
    expect(url.searchParams.get("fail")).toBe("0.5");
  });

  it.each([500, 503])("maps a %i to an http ApiError", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "x" }, status)));
    await expect(fetchScreens()).rejects.toMatchObject({ kind: "http", status });
  });

  it("maps the backend's truncated 200 body to a malformed ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse('{"component": "Butt')));
    await expect(fetchScreens()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("maps a 200 with the wrong shape to a malformed ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ component: "Button" })));
    await expect(fetchScreens()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("maps a network failure to a network ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await fetchScreens().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "network" });
  });

  it("rethrows an abort as-is instead of wrapping it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    const error = await fetchScreens().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});

describe("faultsFromSearch", () => {
  it("reads positive latency and fail, clamping fail to 1", () => {
    expect(faultsFromSearch("?latency=2000&fail=3")).toEqual({ latency: 2000, fail: 1 });
  });

  it("ignores missing, zero and invalid values", () => {
    expect(faultsFromSearch("")).toEqual({});
    expect(faultsFromSearch("?latency=abc&fail=0")).toEqual({});
  });
});
