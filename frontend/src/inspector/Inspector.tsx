import { Component, type ReactNode } from "react";
import { clearInspectorThrow, retryDetails } from "../controller";
import { RegionError } from "../RegionError";
import { reportFailure } from "../regions";
import { getApp, useApp } from "../store";
import type { LiveProps } from "../types";

function mix(values: Array<string | number>) {
  if (!values.length) return "";
  const first = String(values[0]);
  return values.every((v) => String(v) === first) ? first : "Mixed";
}

function Field({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="field">
      <div className="k">{k}</div>
      <div className="v" title={v}>
        {color ? <span className="swatch" style={{ background: color }} /> : null}
        {v || "—"}
      </div>
    </div>
  );
}

function liveFields(items: LiveProps[]) {
  return [
    ["Name", mix(items.map((i) => i.name))],
    ["Tag", mix(items.map((i) => i.tag))],
    ["Id", mix(items.map((i) => i.domId))],
    ["Classes", mix(items.map((i) => i.classes))],
    ["Size", mix(items.map((i) => `${i.width} × ${i.height}`))],
    ["Position", mix(items.map((i) => `${i.x}, ${i.y}`))],
    ["Text", mix(items.map((i) => i.text))],
    ["Color", mix(items.map((i) => i.color)), items.length === 1 ? items[0].color : undefined],
    ["Background", mix(items.map((i) => i.background)), items.length === 1 ? items[0].background : undefined],
    ["Font", mix(items.map((i) => i.fontFamily))],
    ["Size / weight", mix(items.map((i) => `${i.fontSize} / ${i.fontWeight}`))],
  ] as Array<[string, string, string?]>;
}

function InspectorBody() {
  const throwInspector = useApp((s) => s.dev.throwInspector);
  if (throwInspector) throw new Error("Dev: inspector render failure");

  const selection = useApp((s) => s.selection);
  const liveById = useApp((s) => s.liveById);
  const details = useApp((s) => s.details);

  if (!selection) {
    return <p className="empty">Select an element</p>;
  }
  if (selection.gone || selection.ids.length === 0) {
    return <p className="empty">This element no longer exists</p>;
  }

  const lives = selection.ids.map((id) => liveById[id]).filter(Boolean);
  const multi = selection.ids.length > 1;

  return (
    <div className="inspector">
      {multi ? <p className="empty" style={{ paddingLeft: 0 }}>{selection.ids.length} elements</p> : null}
      <h3>Live</h3>
      {lives.length
        ? liveFields(lives).map(([k, v, color]) => <Field key={k} k={k} v={v} color={color} />)
        : <p className="empty" style={{ paddingLeft: 0 }}>Waiting for live values…</p>}
      {!multi && (
        <>
          <h3>Details</h3>
          {details.status === "loading" && <p className="connecting">Loading…</p>}
          {details.status === "none" && <p className="empty" style={{ paddingLeft: 0 }}>No details</p>}
          {details.status === "none-404" && (
            <p className="empty" style={{ paddingLeft: 0 }}>No details for this element</p>
          )}
          {details.status === "error" && (
            <RegionError message={details.error || "Couldn't load details"} onRetry={() => retryDetails()} />
          )}
          {details.status === "ready" && details.data && (
            <>
              <Field k="Component" v={details.data.component} />
              <Field k="Description" v={details.data.description} />
              <Field k="Status" v={details.data.status} />
              <Field k="Owner" v={details.data.owner} />
            </>
          )}
        </>
      )}
    </div>
  );
}

class InspectorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportFailure(error, { region: "inspector", screenId: getApp().activeScreenId });
  }

  render() {
    if (this.state.error) {
      return (
        <RegionError
          message={this.state.error.message || "Inspector failed"}
          onRetry={() => {
            clearInspectorThrow();
            this.setState({ error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}

export function Inspector() {
  return (
    <aside className="panel right">
      <h2>Inspector</h2>
      <InspectorBoundary>
        <InspectorBody />
      </InspectorBoundary>
    </aside>
  );
}
