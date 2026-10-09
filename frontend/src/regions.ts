import { report } from "../report.js";

export type Region = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export class CancelledError extends Error {
  constructor(message = "cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function isCancelled(err: unknown) {
  return (
    err instanceof CancelledError ||
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && (err.name === "AbortError" || err.message === "cancelled"))
  );
}

export function reportFailure(
  error: unknown,
  context: { region: Region; screenId: string | null; elementKey?: string },
) {
  const err = error instanceof Error ? error : new Error(String(error));
  report(err, context);
}
