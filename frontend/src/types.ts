export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:4000";
export const PAGES_ORIGIN = import.meta.env.VITE_PAGES_ORIGIN ?? "http://localhost:4001";

export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const LABEL_H = 32;
export const GAP = 96;
export const COLS = 4;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const HANDSHAKE_MS = 10_000;
export const CHILDREN_MS = 3_000;

export type Mode = "select" | "interact";

export type Screen = { id: string; name: string; url: string };

export type NodeInfo = {
  id: string;
  name: string;
  tag: string;
  hasChildren: boolean;
  dataKey: string | null;
};

export type Rect = { top: number; left: number; width: number; height: number };

export type LiveProps = {
  name: string;
  tag: string;
  domId: string;
  classes: string;
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  dataKey: string | null;
};

export type PackedNode = NodeInfo & {
  rect: Rect;
  visible: boolean;
  live: LiveProps;
};

export type DetailsData = {
  component: string;
  description: string;
  status: string;
  owner: string;
};

export type PreviewState = {
  generation: number;
  iframeKey: number;
  sessionId: string | null;
  status: "connecting" | "ready" | "error";
  error: string | null;
  pageError: string | null;
  loadHasFired: boolean;
};

export type RowStatus = { state: "idle" | "loading" | "error"; error?: string };

export type SearchHit = { node: NodeInfo; ancestors: NodeInfo[] };

export type LayersState = {
  nodes: Record<string, NodeInfo>;
  children: Record<string, string[]>;
  parent: Record<string, string | null>;
  expanded: Record<string, true>;
  rowStatus: Record<string, RowStatus>;
  rootStatus: "idle" | "loading" | "ready" | "error";
  rootError: string | null;
  scrollTop: number;
  search: string;
  expandedBeforeSearch: Record<string, true> | null;
  searchHits: SearchHit[] | null;
};

export type Selection = {
  screenId: string;
  ids: string[];
  gone: boolean;
};

export type DetailsState = {
  status: "idle" | "loading" | "ready" | "none" | "none-404" | "error";
  data: DetailsData | null;
  error: string | null;
  gen: number;
};

export type DevState = {
  screensFail: boolean;
  ignoreHello: Record<string, true>;
  detailsFail: boolean;
  layersFail: boolean;
  rowLoadFail: boolean;
  throwInspector: boolean;
};

export type AppState = {
  mode: Mode;
  screens: Screen[];
  boardStatus: "loading" | "ready" | "error";
  boardError: string | null;
  boardGen: number;
  previews: Record<string, PreviewState>;
  activeScreenId: string | null;
  selection: Selection | null;
  layersHover: { screenId: string; id: string } | null;
  layers: Record<string, LayersState>;
  liveById: Record<string, LiveProps>;
  details: DetailsState;
  layersPanelFocused: boolean;
  zoomLabel: number;
  dev: DevState;
};

export function emptyLayers(): LayersState {
  return {
    nodes: {},
    children: {},
    parent: {},
    expanded: {},
    rowStatus: {},
    rootStatus: "idle",
    rootError: null,
    scrollTop: 0,
    search: "",
    expandedBeforeSearch: null,
    searchHits: null,
  };
}

export function emptyPreview(): PreviewState {
  return {
    generation: 1,
    iframeKey: 1,
    sessionId: null,
    status: "connecting",
    error: null,
    pageError: null,
    loadHasFired: false,
  };
}

export function screenPos(index: number) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: col * (PREVIEW_W + GAP),
    y: row * (PREVIEW_H + LABEL_H + GAP),
  };
}

export function keyOfId(id: string): string | null {
  return id.startsWith("k:") ? id.slice(2) : null;
}
