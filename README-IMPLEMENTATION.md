# Figr Viewer: Implementation Notes

This document describes the current implementation in this repository. It supplements the assignment brief; it does not claim that every requirement is complete.

## Decisions and Ambiguities

- **Zoom versus page scrolling:** Ctrl/Cmd + wheel is treated as board zoom, including over a preview. An unmodified wheel over a preview is left to the page; over empty board space it pans the board.
- **Selection across previews:** Shift-click toggles membership within the clicked preview. Selecting an element in another preview replaces the prior selection. Selection data is keyed by screen, and simply activating a different preview does not itself clear the previous preview's selection.

## State and Ownership

`frontend/src/App.jsx` is the host's state owner. It holds the screens, board transform and mode, active preview, selection and hover data, preview geometry, layer trees, per-preview expanded rows and panel scroll positions, search state, page error badges, and local region failure state. It also owns pending host-to-frame requests and connects iframe messages to UI updates. `frontend/report.js` is the reporter stub.

Each preview's `backend/pages/figr-bridge.js` owns only page-local data and behavior: DOM lookup and identity resolution, hit testing, current hover/selection references received from the host, live element descriptions, and observation of DOM changes. It does not decide the host's selection. The host sends selection references to the bridge; the bridge reports page events and geometry back.

`frontend/src/InspectorPanel.jsx` renders inspector state supplied by the host. `frontend/src/api.js` fetches the screens list and element details. Element details are fetched only for a single selected element with a `data-key`; a 404 is represented as no details. Failed or malformed detail responses leave Live values visible and show a Details-local Retry action.

## Host and Page Protocol

The host and each cross-origin preview communicate with `postMessage` using the `figr-board` channel. The bridge sends `ready`, `hover`, `select`, `keyboard-select`, `background`, `geometry`, `changed`, `zoom`, and `page-error` events. It also answers request/reply messages for `children` and `ancestors`. Host commands include `init`, `mode`, `selection`, `hover-ref`, and `navigate-element`. Requests carry incrementing request IDs; the host checks the response type and basic response shape before resolving them. Requests time out after three seconds; a preview that does not complete its handshake within ten seconds gets its own connection error. Requests from a preview being retried, a search being replaced, or a Details selection being abandoned are ignored without reporting.

The bridge observes DOM mutations and reports changed selections, then the host refreshes the root tree and currently expanded branches. Children are loaded when rows are expanded. Search builds a temporary recursive tree so it can search descendants that have not been expanded in the normal layer view. If a preview navigates, its iframe loads the new document; the host detects the URL change, clears that screen's selection and layer expansion, and repopulates its tree without reloading the board.

## Where This Breaks

Known gaps in the current build:

- **Anonymous element identity is temporary.** Anonymous elements use a token tied to the current DOM node, so selection clears if a page rebuilds that node. Unique `data-key` and ID values are re-resolved across rebuilds; duplicate keys or IDs are treated as ambiguous and are not re-resolved.
- **Async R6 failures have local retries and reporting.** Board, preview, layer-panel, row-child, and Details request failures stay in their respective UI regions. The dev-only toolbar menu exercises those five cases. Page runtime errors are shown on their preview. This simpler implementation has no React error boundary, so an actual render exception is not caught or region-contained.
- **Uncaught failures in browser-managed iframe internals have limited observability.** The host reports errors it receives through the bridge or its own request/render/event boundaries; a browser failure that produces no iframe load event and no bridge message is only detected by the ten-second handshake deadline.
- **Interaction and keyboard coverage is not exhaustive.** Native behavior in Interact mode is intended, but the bridge's keyboard forwarding and host shortcuts may conflict with page-level keyboard workflows. The host layer keyboard handler implements arrow navigation; its exact behavior does not cover every selection shortcut described in the brief.
- **Live layout data is approximate.** Geometry is rounded to integer CSS pixels and depends on browser layout and mutation/scroll notifications. Highly transient layout changes between updates may briefly render stale outlines or inspector values.

These are known limitations of the implementation as it stands, rather than guarantees that the assignment requirements are fully satisfied.
