# Design-tool viewer

Host app for the Figr frontend-engineer assignment. The board shows 24 cross-origin page previews. The host draws hover and selection outlines, and keeps a layers panel and inspector in sync with the active preview.

Brief: [doc.figr.design/frontend-engineer](https://doc.figr.design/frontend-engineer)

## Run

Node 18+.

```
npm install
npm start
```

- App: http://localhost:5173
- API: http://localhost:4000
- Pages: http://localhost:4001

`npm start` runs the mock backend and Vite together. Ports 4000, 4001, and 5173 must be free. A dev menu in the bottom-right corner can trigger each failure region.

## Decisions

These are the places the brief leaves room, and what this build does.

- Clicking empty board space clears the selection and leaves the active preview as it was. Clicking a page background (`html` / `body`) makes that preview active and clears the selection.
- The vanished note ("This element no longer exists") stays until the next selection. Escape, or another clear, does not dismiss a note that is already showing. Clearing a live selection does not set the note.
- Enter on an element with no children does nothing. Shift+Enter at the top level does nothing.
- Shortcuts are ignored while the focus is in an input, textarea, or contentEditable. In Interact mode, Enter and Tab reach the page. V, I, and Escape still switch modes or clear the selection when the user is not typing.
- The chevron on a layers row only expands or collapses. It does not change the selection.
- Page JavaScript errors are a badge on that preview. They are not sent to `report()`.
- Position in the inspector is the element's layout position: viewport box plus window scroll plus scroll inside overflow ancestors. It stays put while the page scrolls.
- Search matches the computed name, case-insensitive, not the visible text. During a search, expanding a row does not change the expansion set that will be restored when the search is cleared.
- Keyboard selection in the layers panel scrolls the panel to the row. It scrolls the page only when a row is clicked.
- Dragging the board pans it, including a drag that starts on a preview. A click that does not move still selects. The wheel over a preview scrolls that page. The wheel over the screen title or empty board pans.
- Script elements appear in the tree. The brief treats every element except `html` and `body` as selectable.

## State

React renders. It does not own the model. Small stores (`useSyncExternalStore`) do.

| Store | Holds | Who writes it |
| --- | --- | --- |
| `ui` | mode, active preview, selection, vanished note, hover | `selection.js` |
| `screensStore` | screen list, board load error | `bridgeHost.js` |
| `previewStore` | per preview: connecting / ready / error, page-error badge, session nonce | `connections.js` |
| `rect` store per screen | hover and selection boxes | rect pump in `bridgeHost.js` |
| layers model per screen | tree, expanded set, scroll, search, search snapshot | `layersModel.js` |
| `inspectorStore` | live values, details, inspector fault | `Inspector.jsx` |
| `devStore` | one-shot throw flags | `DevMenu.jsx` |

The page owns element identity. The host only stores opaque ids (`e1`, `e2`, …) plus a small cache of name, tag, and `data-key` so the layers panel can label a row before the next round trip.

Camera pan is written on the board DOM during a drag so the iframes do not re-render. Zoom is stored, because outline thickness is divided by zoom. Iframes are memoized by screen id.

## Host and page

Each page has one added tag, `<script src="bridge.js"></script>`. The host is Vite on port 5173. Pages are on port 4001. They talk only with `postMessage`.

Every message is `{ source, session, href, type, ... }`. The host accepts a message only when `event.source` is that preview's `contentWindow` and `source` is `figr-page`. The page accepts a message only from `window.parent` with `source` `figr-host`.

Requests (`hit`, `children`, `ancestry`, `live`, `rects`, `reveal`, `relative`, `search`, `audit`, `scroll`) carry a `requestId`. The page answers with `result`. The host treats a missing iframe as `GONE`, a superseded request as `CANCELLED`, and a timeout as `TIMEOUT`. `GONE` and `CANCELLED` are not failures: nothing is shown and nothing is reported. `TIMEOUT` is a failure for the layers root (3s) and for a row's children (3s). A preview that never sends `ready` within 10 seconds is "Couldn't connect to this preview" on that card only.

The page also pushes `ready`, `dom-changed` (debounced 60ms), `scrolled`, `page-error`, `zoom-wheel`, and `shortcut`.

A new `session` or `href` means that preview navigated. In-flight requests for it are cancelled, its layers and selection are reset, and Select mode works on the new document without reloading the board.

Identity lives in the page. A connected node keeps its id. After a rebuild, a disconnected id is reused only when exactly one unclaimed node has the same fingerprint. The fingerprint is `data-key`, else `id`, else `data-name` plus tag and class, else tag, class, and text with times like "6s ago" stripped. Anything ambiguous is dropped, so the selection is removed instead of moving to a different element. The activity feed rebuilds every 2 seconds; a selected row whose text is unique survives that rebuild.

Select mode puts a transparent layer over the iframe, so clicks never reach the page. The wheel on that layer is forwarded as a scroll inside the page, including nested scroll areas. Ctrl/Cmd + wheel zooms the board from 25% to 400% around the pointer, including over a preview. Interact mode lets the page receive clicks. Outlines are hidden. The selection is kept and drawn again in Select mode if those ids still resolve.

Outlines are drawn in the scaled board and clipped to the preview. Border and label sizes are divided by the zoom so they stay 1px or 2px on screen. A box that is fully scrolled out, or covered by a sticky header, is not drawn. The element stays selected.

## Failures

Each region fails on its own: board, one preview, the layers panel, one row's children, and the inspector Details section. `report(error, { region, screenId, elementKey? })` runs once per failure. A retry that fails again is a new report. A response that arrives after the region is gone is ignored. A 404 from `GET /elements/:key` is "No details for this element" and is not reported. Live inspector values stay up when Details fails.

The dev menu can fail the screens request, a preview connection, the layers root, the next row load, Details, and throws while rendering, drawing, clicking, handling a key, handling a message, in a timer, or when a response arrives. It can also raise a page-error badge.

## Where this breaks

- Two elements with the same fingerprint, both destroyed, and only one replacement left: the first lost id claims that node. A selection on the other id can move. Unique `data-key`, `id`, `data-name`, or stripped text avoids this. Identical siblings with none of those are dropped on rebuild, not rematched.
- Text that changes for a reason other than "Ns ago", on a node that was also recreated, looks like a new element. The old selection is removed.
- Closed shadow DOM is invisible.
- Searching or fully expanding the settings page (30 levels) can render on the order of a thousand rows. The panel is not virtualized.
- Ctrl/Cmd + wheel over a preview in Interact mode depends on the injected script. A page that never loads the script cannot forward that gesture.
- Subpixel borders at some zoom levels look slightly soft. The thickness is still one or two CSS pixels divided by the zoom.
- Four copies of the settings page are heavy. Each copy has its own bridge and mutation observer.

## Layout

```
backend/pages/bridge.js    page script (the one allowed tag)
frontend/src               host: board, layers, inspector, protocol, failures
frontend/report.js         error reporter stub
scripts/start.js           backend + Vite
```
