import type { Screen } from "../api/screens";

/** Same shape the backend returns: 24 screens reusing 6 pages. */
export const screens24: Screen[] = Array.from({ length: 24 }, (_, i) => ({
  id: `scr-${String(i + 1).padStart(2, "0")}`,
  name: `Screen ${i + 1}`,
  url: `http://localhost:4001/page-${(i % 6) + 1}.html`,
}));

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
