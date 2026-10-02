import { useState } from "react";
import {
  activeOrFirst,
  clearBoardFault,
  devCommand,
  failConnect,
  loadScreens,
  triggerBoardThrow,
  triggerDrawThrow,
  triggerInspectorThrow,
  triggerLayersThrow,
} from "./bridgeHost.js";
import { devFlags } from "./store.js";

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const screenId = () => activeOrFirst();

  return (
    <div className="dev-menu">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        Dev failures
      </button>
      {open && (
        <div className="dev-panel">
          <button type="button" onClick={() => loadScreens({ fail: 1 })}>
            Fail screens request
          </button>
          <button type="button" onClick={() => screenId() && failConnect(screenId())}>
            Fail preview connection
          </button>
          <button type="button" onClick={() => screenId() && devCommand(screenId(), "hang-root")}>
            Hang layers root (3s)
          </button>
          <button type="button" onClick={() => screenId() && devCommand(screenId(), "hang-children")}>
            Hang next row load (3s)
          </button>
          <button
            type="button"
            onClick={() => {
              devFlags.detailsFail = true;
              window.dispatchEvent(new Event("figr-fail-details"));
            }}
          >
            Fail details request
          </button>
          <button type="button" onClick={triggerInspectorThrow}>
            Throw in inspector
          </button>
          <button type="button" onClick={triggerLayersThrow}>
            Throw in layers
          </button>
          <button type="button" onClick={triggerBoardThrow}>
            Throw in board
          </button>
          <button type="button" onClick={triggerDrawThrow}>
            Throw while drawing
          </button>
          <button type="button" onClick={() => (devFlags.throwClick = true)}>
            Throw on next click
          </button>
          <button type="button" onClick={() => (devFlags.throwKey = true)}>
            Throw on next key
          </button>
          <button type="button" onClick={() => (devFlags.throwMessage = true)}>
            Throw on next message
          </button>
          <button type="button" onClick={() => (devFlags.throwTimer = true)}>
            Throw in timer
          </button>
          <button
            type="button"
            onClick={() => {
              devFlags.throwResponse = true;
              loadScreens();
            }}
          >
            Throw when screens arrive
          </button>
          <button type="button" onClick={() => screenId() && devCommand(screenId(), "page-error")}>
            Trigger page error
          </button>
          <button
            type="button"
            onClick={() => {
              const id = screenId();
              if (id) devCommand(id, "clear");
              clearBoardFault();
            }}
          >
            Clear dev hangs
          </button>
        </div>
      )}
    </div>
  );
}
