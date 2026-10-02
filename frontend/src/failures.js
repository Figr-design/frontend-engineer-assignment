import { report } from "../report.js";

export function reportFailure(error, { region, screenId = null, elementKey } = {}) {
  const err = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  const context = { region, screenId: screenId ?? null };
  if (elementKey) context.elementKey = elementKey;
  report(err, context);
}

export function isAbort(error) {
  return error?.name === "AbortError" || error?.code === "CANCELLED" || error?.code === "GONE";
}
