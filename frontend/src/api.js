import { API } from "./store.js";

export async function fetchScreens({ fail = 0, signal } = {}) {
  const response = await fetch(`${API}/screens?fail=${fail}`, { signal, cache: "no-store" });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Malformed screens response");
  }
  if (!response.ok) throw new Error(data?.error || `Screens request failed (${response.status})`);
  if (!Array.isArray(data) || data.some((screen) => !screen?.id || !screen?.name || !screen?.url)) {
    throw new Error("Malformed screens response");
  }
  return data;
}

export async function fetchDetails(key, { fail = 0, signal } = {}) {
  const response = await fetch(`${API}/elements/${encodeURIComponent(key)}?fail=${fail}`, {
    signal,
    cache: "no-store",
  });
  if (response.status === 404) return { kind: "missing" };
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Malformed details response");
  }
  if (!response.ok) throw new Error(data?.error || `Details request failed (${response.status})`);
  if (
    !data ||
    typeof data.component !== "string" ||
    typeof data.description !== "string" ||
    typeof data.status !== "string" ||
    typeof data.owner !== "string"
  ) {
    throw new Error("Malformed details response");
  }
  return { kind: "ready", data };
}
