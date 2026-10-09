# Figr viewer

A board of live, cross-origin page previews with host-drawn hover/selection overlays, a lazy layers panel, and an inspector. Built for the [Figr frontend engineer assignment](https://doc.figr.design/frontend-engineer).

## Run

Node 18+. One command starts the API (`:4000`), the page server (`:4001`), and the app (`:5173`):

```bash
npm install
npm start
```

Open [http://localhost:5173](http://localhost:5173).

If `:4000` / `:4001` are already taken:

```bash
API_PORT=4010 PAGES_PORT=4011 PAGES_ORIGIN=http://localhost:4011 \
  VITE_API_ORIGIN=http://localhost:4010 VITE_PAGES_ORIGIN=http://localhost:4011 \
  npm start
```

| Process | URL |
|---|---|
| App (host) | http://localhost:5173 |
| API | http://localhost:4000 |
| Pages (iframe origin) | http://localhost:4001 |

`Dev` in the toolbar injects the R6 failures used in the walkthrough video.

## Design calls

**Host overlay in Select mode, not in-page click listeners.** Disabled buttons and inputs never fire `click`, but `document.elementFromPoint` still returns them. A transparent overlay on the host captures pointer/wheel in Select mode and `postMessage`s coordinates into the page. Interact mode sets `pointer-events: none` on that overlay so the page behaves normally.

**Outlines live in screen space.** The board camera is a CSS `translate + scale` on the world layer. Overlay boxes are drawn *outside* that transform from `iframe.getBoundingClientRect()` + the element's iframe-viewport rect, so 1px/2px strokes and labels stay the same size at every zoom. Each preview clips its overlays to the iframe box.

**Identity never guesses.** The guest maps elements with a `WeakMap`. If the node has `data-key`, the id is `k:<key>` and survives `innerHTML` rebuilds (page 4's odd items). Otherwise the id is an ephemeral `f<n>` tied to that DOM node. After a rebuild, unkeyed nodes are treated as gone rather than rematched by position — rematching would jump when page 4 unshifts a row, which R3.7 forbids.

**One `sessionId` per iframe document.** Navigation (docs → configuration) is a new session: that preview's selection and layers memory clear; the rest of the board does not reload.

Taken from browser inspect / Figma: V/I tools, layers ↔ canvas hover, overlays drawn by the host rather than outlines inside the page (so zoom cannot thicken them).

## State: what lives where

| Place | Data | Who writes |
|---|---|---|
| Zustand (`store.ts`) | screens, mode, active preview, selection ids, layers tree, details, region errors, dev flags | Host UI, `fetch`, guest messages (after `sessionId` check) |
| `camera.ts` | pan/zoom | Pointer/wheel on the board; Ctrl/Cmd+wheel forwarded from a preview |
| `overlay.ts` | hover + selected rects | Guest `rects` / `hit`; cleared on pan, zoom, pointer leave |
| Guest `bridge.js` | DOM identity maps, observers | The page; it never writes host state directly |
| Per-preview layers in Zustand | expanded set, child cache, row load status, search, `scrollTop` | Layers panel + `getChildren` / `getPath` / `domChanged` |

The layers panel and inspector follow **active preview**: the last preview clicked in Select mode, or whose name was clicked.

High-frequency data (camera during a drag, hover rects) does not go through React for the 24 iframes. React renders the shell, the tree, and the inspector; the world transform and overlay boxes update from subscriptions.

## Host ↔ page protocol

The only page change is one tag: `<script src="/bridge.js"></script>`, served from the pages origin.

Origin/source checks: guest accepts only `event.source === parent`. Host accepts `event.origin === http://localhost:4001` and `event.source === iframe.contentWindow`. Every request/response after handshake carries `sessionId`. Stale replies (wrong generation, unmounted iframe, superseded `requestId`) are dropped: no UI change, no `report()`.

**Guest → host:** `hello`, `hit`, `clickResult`, `rects`, `children`, `path`, `search`, `live`, `navResult`, `domChanged`, `pageError`, `keydown`, `zoomWheel`.

**Host → guest:** `hello-ok`, `setMode`, `hitTest`, `click`, `scroll` (delta on the scrollable under the point), `watch`, `getChildren`, `getPath` (ancestors + each level's children in one round-trip — needed for the 30-level settings tree), `search`, `nav`, `scrollIntoView`, `injectError`.

Timeouts: handshake 10s (that preview only), `getChildren` 3s (that row only). Collapse/re-expand while a load is in flight reuses the same promise and writes the child list once.

**Slow / gone / replaced**

- Guest retries `hello` until `hello-ok`, so a host that wasn't listening yet still connects.
- If the script never answers, that preview shows “Couldn't connect to this preview”.
- Navigation loads a new document; the new page's own `bridge.js` hellos; the host bumps `generation` and ignores the old session.
- A response after Retry remounted the iframe is ignored.

## Ambiguities and what we decided

- **Unkeyed nodes replaced via `innerHTML`:** dropped from the selection, never rematched by index or text. Inspector: “This element no longer exists” if nothing remains.
- **Interact mode keys:** V/I/Escape still switch/clear unless the user is typing in an input. Enter/Tab go to the page. Select-mode Tab/Enter navigate the selection.
- **Search box:** V/I are not stolen while it is focused, so you can type those letters. Escape clears the query first, then the selection.
- **Clicking a screen name** activates that preview and loads its layers; it does not clear the selection and is not a page hit.
- **`script` / `style` in `body`** are elements and appear in the tree (R2: every element except `html`/`body`).
- **Clearing search** restores the expanded set from before the search. A row selected during search may sit inside a collapsed ancestor afterwards; the preview selection stays. Hover/selection in the panel then highlight the nearest visible ancestor (same rule as R4.4).
- **Page errors** (unhandled exception / rejection) are a badge on that preview, not the “Couldn't connect” overlay. They still call `report()` once with `region: "preview"`.
- **Layers keyboard vs Tab:** with the layers tree focused, arrows/left/right move in the tree; Tab still does sibling selection (R3) rather than moving focus.

## Where this breaks

- **Unkeyed identity after a full DOM rebuild** (page 4 even-numbered rows): the selected node is gone; we will not jump to the new node in the same slot.
- **Duplicate `data-key` values** on one page would share one id; the fixtures don't do this.
- **Very deep expand + search on page 5** can produce a large DOM in the layers panel (the guest walk is fine; rendering every match is the cost).
- **24 live iframes** are heavy. First load can hitch; browsers may throttle background iframes so hover/rects on offscreen previews update less often.
- **Transformed/fixed elements and visual vs layout boxes:** we use `getBoundingClientRect`. Sticky headers are handled by `elementsFromPoint` (topmost pixel wins). We do not reconstruct CSS transform chains beyond that.
- **Ctrl+wheel over a preview in Interact mode** depends on the guest's non-passive listener. If a page called `stopPropagation` on `wheel` in capture before us, board zoom would not run. The fixtures don't.
- **Host overlay vs native hover inside the page:** `:hover` styles in Select mode won't apply, because the pointer never enters the iframe. Interact mode restores them.
- **Iframe `load` + `hello` race** is tolerated by retrying hello; a custom browser that dropped `postMessage` to a not-yet-listening parent for longer than 10s would show a connect error (Retry works).

## Layout of the code

```
frontend/src/
  controller.ts    protocol, selection, layers, failures
  store.ts         Zustand
  camera.ts / overlay.ts   high-frequency
  board/           pan/zoom, previews, screen-space outlines
  layers/          lazy tree, search, keyboard
  inspector/       live + details, error boundary
  regions.ts       report-once + cancellation
backend/pages/bridge.js   the one guest script
```
