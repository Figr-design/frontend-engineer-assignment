import { useEffect, useState } from "react";
import { fetchScreens, isAbortError, type Faults, type Screen } from "../api/screens";
import { report } from "../../report.js";

export type ScreensState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; screens: Screen[] };

/**
 * Loads `GET /screens`. Each attempt owns an AbortController, so a superseded or
 * unmounted attempt is cancelled silently: no state change and no report.
 */
export function useScreens(faults: Faults = {}): { state: ScreensState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ScreensState>({ status: "loading" });
  const { latency, fail } = faults;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchScreens({ latency, fail, signal: controller.signal }).then(
      (screens) => {
        if (!controller.signal.aborted) setState({ status: "ready", screens });
      },
      (error: Error) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        report(error, { region: "board", screenId: null });
        setState({ status: "error", error });
      },
    );
    return () => controller.abort();
  }, [attempt, latency, fail]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
