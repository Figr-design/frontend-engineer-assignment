import { useEffect, useState } from "react";
import type { Screen } from "../api/screens";
import { report } from "../../report.js";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, type Box } from "./layout";

export const CONNECT_TIMEOUT_MS = 10_000;

type Status = "loading" | "loaded" | "error";

/**
 * One preview with its own loading and connection-error state.
 *
 * Until the page agent exists, "connected" means the iframe fired `load`. A
 * cross-origin `load` also fires for a 404 page, so this only catches pages that
 * never finish loading; the agent handshake will replace it.
 */
export function Preview({ screen, box }: { screen: Screen; box: Box }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => {
      report(new Error(`Preview "${screen.name}" didn't load within ${CONNECT_TIMEOUT_MS / 1000}s`), {
        region: "preview",
        screenId: screen.id,
      });
      setStatus("error");
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, attempt, screen.id, screen.name]);

  const retry = () => {
    setAttempt((n) => n + 1);
    setStatus("loading");
  };

  return (
    <section
      className="preview"
      aria-label={screen.name}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <h2 className="preview-label">{screen.name}</h2>
      <iframe
        key={attempt}
        className="preview-frame"
        title={screen.name}
        src={screen.url}
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        onLoad={() => setStatus((s) => (s === "loading" ? "loaded" : s))}
      />
      {status === "loading" && (
        <div className="preview-status" role="status">
          Loading…
        </div>
      )}
      {status === "error" && (
        <div className="preview-status preview-error" role="alert">
          <p>Couldn't connect to this preview</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
