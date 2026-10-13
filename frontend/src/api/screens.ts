// Access to the mock API (backend/server.js). Everything that crosses the
// network boundary is validated here before the rest of the app sees it.

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type Screen = { id: string; name: string; url: string };

/** The backend's fault-injection knobs, accepted by every route. */
export type Faults = { latency?: number; fail?: number };

export type ApiErrorKind = "network" | "http" | "malformed";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status;
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Validates a `GET /screens` body. Throws `ApiError("malformed")` on any deviation. */
export function parseScreens(data: unknown): Screen[] {
  if (!Array.isArray(data)) throw new ApiError("malformed", "GET /screens: expected an array");

  const seen = new Set<string>();
  return data.map((item: unknown, index) => {
    const { id, name, url } = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (!isNonEmptyString(id) || typeof name !== "string" || !isNonEmptyString(url) || !isHttpUrl(url)) {
      throw new ApiError("malformed", `GET /screens: invalid screen at index ${index}`);
    }
    if (seen.has(id)) throw new ApiError("malformed", `GET /screens: duplicate screen id "${id}"`);
    seen.add(id);
    return { id, name, url };
  });
}

export async function fetchScreens(options: Faults & { signal?: AbortSignal } = {}): Promise<Screen[]> {
  const url = new URL("/screens", API_URL);
  if (options.latency) url.searchParams.set("latency", String(options.latency));
  if (options.fail) url.searchParams.set("fail", String(options.fail));

  let body: unknown;
  try {
    const res = await fetch(url, { signal: options.signal });
    if (!res.ok) throw new ApiError("http", `GET /screens failed with status ${res.status}`, { status: res.status });
    try {
      body = await res.json();
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new ApiError("malformed", "GET /screens returned invalid JSON", { cause });
    }
  } catch (error) {
    if (error instanceof ApiError || isAbortError(error)) throw error;
    throw new ApiError("network", "Couldn't reach the API", { cause: error });
  }
  return parseScreens(body);
}

/** Reads `?latency=&fail=` from the app's own URL so failures can be forced by hand. */
export function faultsFromSearch(search: string): Faults {
  const params = new URLSearchParams(search);
  const faults: Faults = {};
  const latency = Number(params.get("latency"));
  const fail = Number(params.get("fail"));
  if (latency > 0) faults.latency = latency;
  if (fail > 0) faults.fail = Math.min(1, fail);
  return faults;
}
