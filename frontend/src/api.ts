import { API_ORIGIN } from "./types";
import type { DetailsData, Screen } from "./types";

export class ApiError extends Error {
  notFound: boolean;
  constructor(message: string, notFound = false) {
    super(message);
    this.name = "ApiError";
    this.notFound = notFound;
  }
}

function qs(opts: { fail?: boolean; latency?: number }) {
  const p = new URLSearchParams();
  if (opts.fail) p.set("fail", "1");
  if (opts.latency) p.set("latency", String(opts.latency));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Malformed response");
  }
}

export async function fetchScreens(opts: {
  fail?: boolean;
  signal?: AbortSignal;
}): Promise<Screen[]> {
  const res = await fetch(`${API_ORIGIN}/screens${qs(opts)}`, { signal: opts.signal });
  const data = await readJson(res);
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : res.statusText;
    throw new ApiError(msg || "Failed to load screens");
  }
  if (!Array.isArray(data)) throw new ApiError("Malformed response");
  return data as Screen[];
}

export async function fetchElement(
  key: string,
  opts: { fail?: boolean; signal?: AbortSignal },
): Promise<DetailsData> {
  const res = await fetch(`${API_ORIGIN}/elements/${encodeURIComponent(key)}${qs(opts)}`, {
    signal: opts.signal,
  });
  const data = await readJson(res);
  if (res.status === 404) throw new ApiError("Not found", true);
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : res.statusText;
    throw new ApiError(msg || "Failed to load details");
  }
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as DetailsData).component !== "string" ||
    typeof (data as DetailsData).description !== "string" ||
    typeof (data as DetailsData).status !== "string" ||
    typeof (data as DetailsData).owner !== "string"
  ) {
    throw new ApiError("Malformed response");
  }
  return data as DetailsData;
}
