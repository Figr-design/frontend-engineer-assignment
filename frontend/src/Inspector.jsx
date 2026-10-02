import { useEffect, useState } from "react";
import { fetchDetails } from "./api.js";
import { request } from "./bus.js";
import { RegionBoundary } from "./boundaries.jsx";
import { reportFailure } from "./failures.js";
import { dropMissing } from "./selection.js";
import { devFlags, devStore, inspectorStore, readMeta, rememberElement, ui, useStore } from "./store.js";

const FIELDS = [
  ["name", "Name"],
  ["tag", "Tag"],
  ["id", "Id"],
  ["classes", "Classes"],
  ["size", "Size"],
  ["position", "Position"],
  ["text", "Text"],
  ["color", "Text colour"],
  ["backgroundColor", "Background colour"],
  ["fontFamily", "Font family"],
  ["fontSize", "Font size"],
  ["fontWeight", "Font weight"],
];

export function Inspector() {
  const screenId = useStore(ui).activeScreenId;
  return (
    <aside className="panel inspector-panel">
      <header>
        <h2>Inspector</h2>
      </header>
      <RegionBoundary
        region="inspector"
        screenId={screenId}
        className="region-error panel-error"
        message="Something went wrong in the inspector"
      >
        <InspectorBody />
      </RegionBoundary>
    </aside>
  );
}

function InspectorBody() {
  useStore(devStore);
  const uiState = useStore(ui);
  const snap = useStore(inspectorStore);
  const { selection, missingNote, activeScreenId } = uiState;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const onFail = () => setAttempt((value) => value + 1);
    window.addEventListener("figr-fail-details", onFail);
    return () => window.removeEventListener("figr-fail-details", onFail);
  }, []);
  const selectionKey = `${selection.screenId || ""}:${selection.eids.join(",")}`;
  const single = selection.eids.length === 1 ? selection.eids[0] : null;
  const dataKey = single ? readMeta(selection.screenId, single)?.dataKey || snap.live.find((item) => item.eid === single)?.dataKey || null : null;

  useEffect(() => {
    const state = ui.get().selection;
    if (!state.eids.length || !state.screenId) {
      inspectorStore.set((current) => ({ ...current, live: [] }));
      return undefined;
    }
    let dead = false;
    const pull = async () => {
      const latest = ui.get().selection;
      if (dead || !latest.eids.length) return;
      try {
        const payload = await request(latest.screenId, "live", { eids: latest.eids }, 1000);
        if (dead || ui.get().selection.screenId !== latest.screenId) return;
        for (const item of payload?.items || []) rememberElement(latest.screenId, item);
        if (payload?.missing?.length) dropMissing(latest.screenId, payload.missing);
        inspectorStore.set((current) => ({ ...current, live: payload?.items || [] }));
      } catch (error) {
        if (error?.code === "TIMEOUT" || error?.code === "CANCELLED" || error?.code === "GONE" || error?.name === "AbortError") return;
        if (error?.code === "BRIDGE" && !inspectorStore.get().fault) {
          inspectorStore.set((current) => ({ ...current, fault: error.message }));
          reportFailure(error, { region: "inspector", screenId: latest.screenId });
        }
      }
    };
    pull();
    const timer = setInterval(pull, 300);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [selectionKey]);

  useEffect(() => {
    if (selection.eids.length !== 1 || !selection.screenId) {
      inspectorStore.set((current) => ({ ...current, details: { kind: "hidden" } }));
      return undefined;
    }
    if (!dataKey) {
      inspectorStore.set((current) => ({ ...current, details: { kind: "none" } }));
      return undefined;
    }
    const genScreen = selection.screenId;
    const genKey = dataKey;
    const controller = new AbortController();
    let ignore = false;
    inspectorStore.set((current) => ({ ...current, details: { kind: "loading" } }));
    const fail = devFlags.detailsFail ? 1 : 0;
    devFlags.detailsFail = false;
    fetchDetails(genKey, { fail, signal: controller.signal })
      .then((result) => {
        if (ignore) return;
        if (ui.get().selection.eids.length !== 1 || readMeta(genScreen, ui.get().selection.eids[0])?.dataKey !== genKey) return;
        inspectorStore.set((current) => ({ ...current, details: result }));
      })
      .catch((error) => {
        if (ignore || error?.name === "AbortError") return;
        if (ui.get().selection.screenId !== genScreen) return;
        inspectorStore.set((current) => ({ ...current, details: { kind: "error" } }));
        reportFailure(error, { region: "details", screenId: genScreen, elementKey: genKey });
      });
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [selectionKey, dataKey, attempt]);

  if (devFlags.throwInspector) {
    devFlags.throwInspector = false;
    throw new Error("Inspector render failed");
  }

  if (snap.fault) {
    return (
      <div className="region-error inline">
        <p>Something went wrong in the inspector</p>
        <button
          type="button"
          onClick={() => inspectorStore.set((current) => ({ ...current, fault: null }))}
        >
          Retry
        </button>
      </div>
    );
  }

  if (missingNote && missingNote.screenId === activeScreenId && selection.eids.length === 0) {
    return <p className="vanish">This element no longer exists</p>;
  }
  if (!selection.eids.length) return <p className="empty-copy">Nothing selected</p>;

  const live = snap.live.filter((item) => selection.eids.includes(item.eid));
  const several = selection.eids.length > 1;

  return (
    <div className="inspector-body">
      <h3>{several ? `${selection.eids.length} elements` : live[0]?.name || readMeta(selection.screenId, selection.eids[0])?.name || "Element"}</h3>
      <section>
        <h4>Live</h4>
        <dl>
          {FIELDS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{display(shared(live, key, selection.eids.length))}</dd>
            </div>
          ))}
        </dl>
      </section>
      {!several && (
        <section>
          <h4>Details</h4>
          {snap.details.kind === "loading" && <p className="empty-copy">Loading…</p>}
          {snap.details.kind === "none" && <p className="empty-copy">No details</p>}
          {snap.details.kind === "missing" && <p className="empty-copy">No details for this element</p>}
          {snap.details.kind === "error" && (
            <div className="region-error inline">
              <p>Couldn't load details</p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                Retry
              </button>
            </div>
          )}
          {snap.details.kind === "ready" && (
            <dl>
              <div>
                <dt>Component</dt>
                <dd>{snap.details.data.component}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{snap.details.data.description}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{snap.details.data.status}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{snap.details.data.owner}</dd>
              </div>
            </dl>
          )}
        </section>
      )}
    </div>
  );
}

function valueOf(item, key) {
  if (!item) return undefined;
  if (key === "size") return `${item.width} × ${item.height}`;
  if (key === "position") return `${item.x}, ${item.y}`;
  return item[key];
}

function shared(items, key, count) {
  if (items.length !== count) return null;
  const values = items.map((item) => valueOf(item, key));
  if (values.some((value) => value == null)) return null;
  return values.every((value) => value === values[0]) ? values[0] : "Mixed";
}

function display(value) {
  if (value == null) return "…";
  if (value === "") return "—";
  return value;
}
