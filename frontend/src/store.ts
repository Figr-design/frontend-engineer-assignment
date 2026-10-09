import { create } from "zustand";
import type { AppState } from "./types";

export const useApp = create<AppState>(() => ({
  mode: "select",
  screens: [],
  boardStatus: "loading",
  boardError: null,
  boardGen: 0,
  previews: {},
  activeScreenId: null,
  selection: null,
  layersHover: null,
  layers: {},
  liveById: {},
  details: { status: "idle", data: null, error: null, gen: 0 },
  layersPanelFocused: false,
  zoomLabel: 0.35,
  dev: {
    screensFail: false,
    ignoreHello: {},
    detailsFail: false,
    layersFail: false,
    rowLoadFail: false,
    throwInspector: false,
  },
}));

export const getApp = () => useApp.getState();
export const setApp = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) =>
  useApp.setState(partial);
