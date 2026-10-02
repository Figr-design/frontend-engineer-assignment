import { request } from "./bus.js";
import { isAbort, reportFailure } from "./failures.js";
import { createStore, previewStore, rememberElement, screensStore, useStore } from "./store.js";

export const layersStore = createStore({ screens: {} });

export function useLayers() {
  return useStore(layersStore);
}

function blank() {
  return {
    nodes: {},
    rootIds: null,
    expanded: [],
    scrollTop: 0,
    scrollEpoch: 0,
    root: { state: "idle", error: null },
    rows: {},
    search: "",
    snapshot: null,
    searchTree: null,
    searchState: "idle",
    scrollTarget: null,
  };
}

export function getLayers(screenId) {
  return layersStore.get().screens[screenId] || blank();
}

function commit(screenId, recipe) {
  layersStore.set((state) => {
    const current = state.screens[screenId] || blank();
    const next = recipe(current);
    if (!next || next === current) return state;
    return { screens: { ...state.screens, [screenId]: next } };
  });
}

const tokens = new Map();
const flights = new Map();

function slot(screenId, parentEid) {
  return `${screenId}:${parentEid || "__root__"}`;
}

export function failLayers(screenId, error) {
  commit(screenId, (model) => ({ ...model, root: { state: "error", error: "Couldn't load layers" } }));
  reportFailure(error, { region: "layers", screenId: screenId ?? null });
}

export function resetLayers(screenId) {
  for (const key of tokens.keys()) {
    if (key.startsWith(`${screenId}:`)) tokens.set(key, (tokens.get(key) || 0) + 1);
  }
  layersStore.set((state) => ({ screens: { ...state.screens, [screenId]: blank() } }));
}

export function saveScroll(screenId, scrollTop) {
  commit(screenId, (model) => (model.scrollTop === scrollTop ? model : { ...model, scrollTop }));
}

export function clearScrollTarget(screenId) {
  commit(screenId, (model) => (model.scrollTarget ? { ...model, scrollTarget: null } : model));
}

export function aimScroll(screenId, eid) {
  commit(screenId, (model) => ({ ...model, scrollTarget: eid }));
}

function screenAlive(screenId) {
  return screensStore.get().screens.some((screen) => screen.id === screenId);
}

export function loadChildren(screenId, parentEid, { force = false } = {}) {
  const key = slot(screenId, parentEid);
  if (!force && flights.has(key)) return flights.get(key);
  const current = getLayers(screenId);
  if (!force) {
    if (parentEid == null && current.root.state === "ready" && current.rootIds) return Promise.resolve();
    if (parentEid && current.rows[parentEid]?.state === "ready" && current.nodes[parentEid]?.childEids) {
      return Promise.resolve();
    }
  }

  const token = (tokens.get(key) || 0) + 1;
  tokens.set(key, token);
  if (parentEid == null) commit(screenId, (model) => ({ ...model, root: { state: "loading", error: null } }));
  else {
    commit(screenId, (model) => ({
      ...model,
      rows: { ...model.rows, [parentEid]: { state: "loading", error: null } },
    }));
  }

  const promise = (async () => {
    try {
      const payload = await request(screenId, "children", { parentEid }, 3000);
      if (tokens.get(key) !== token || !screenAlive(screenId)) return;
      if (previewStore.get()[screenId]?.kind === "connect") return;
      if (!payload || payload.gone) {
        if (parentEid) dropEids(screenId, [parentEid]);
        return;
      }
      applyChildren(screenId, parentEid, payload.children || []);
    } catch (error) {
      if (tokens.get(key) !== token || !screenAlive(screenId)) return;
      if (isAbort(error) || previewStore.get()[screenId]?.kind === "connect") return;
      const elementKey = parentEid ? getLayers(screenId).nodes[parentEid]?.dataKey || undefined : undefined;
      if (parentEid == null) {
        commit(screenId, (model) => ({ ...model, root: { state: "error", error: "Couldn't load layers" } }));
        reportFailure(error, { region: "layers", screenId, elementKey });
      } else {
        commit(screenId, (model) => ({
          ...model,
          rows: { ...model.rows, [parentEid]: { state: "error", error: "Couldn't load" } },
        }));
        reportFailure(error, { region: "layers-row", screenId, elementKey });
      }
    }
  })();

  flights.set(key, promise);
  promise.finally(() => {
    if (flights.get(key) === promise) flights.delete(key);
  });
  return promise;
}

function applyChildren(screenId, parentEid, children) {
  commit(screenId, (model) => {
    const nodes = { ...model.nodes };
    const ids = [];
    const seen = new Set();
    for (const child of children) {
      if (!child?.eid || seen.has(child.eid)) continue;
      seen.add(child.eid);
      ids.push(child.eid);
      const prev = nodes[child.eid];
      nodes[child.eid] = {
        eid: child.eid,
        name: child.name,
        hasChildren: Boolean(child.hasChildren),
        dataKey: child.dataKey || null,
        parentEid,
        childEids: prev?.childEids ?? null,
      };
      rememberElement(screenId, child);
    }

    const previous = parentEid == null ? model.rootIds || [] : model.nodes[parentEid]?.childEids || [];
    const removed = previous.filter((id) => !seen.has(id));
    const drop = new Set(removed);
    const stack = [...removed];
    while (stack.length) {
      const id = stack.pop();
      const kids = nodes[id]?.childEids;
      if (!kids) continue;
      for (const kid of kids) {
        if (!drop.has(kid)) {
          drop.add(kid);
          stack.push(kid);
        }
      }
    }
    for (const id of drop) delete nodes[id];
    let rows = model.rows;
    if (drop.size) {
      rows = { ...rows };
      for (const id of drop) delete rows[id];
    }
    for (const [eid, node] of Object.entries(nodes)) {
      if (!node.childEids) continue;
      const nextKids = node.childEids.filter((id) => !drop.has(id));
      if (nextKids.length !== node.childEids.length) nodes[eid] = { ...node, childEids: nextKids };
    }

    const expanded = model.expanded.filter((id) => !drop.has(id));
    if (parentEid == null) {
      return { ...model, nodes, rows, expanded, rootIds: ids, root: { state: "ready", error: null } };
    }
    if (nodes[parentEid]) nodes[parentEid] = { ...nodes[parentEid], childEids: ids };
    return {
      ...model,
      nodes,
      rows: { ...rows, [parentEid]: { state: "ready", error: null } },
      expanded,
    };
  });
}

export function dropEids(screenId, missing) {
  if (!missing?.length) return;
  commit(screenId, (model) => {
    const drop = new Set(missing);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [eid, node] of Object.entries(model.nodes)) {
        if (node.parentEid && drop.has(node.parentEid) && !drop.has(eid)) {
          drop.add(eid);
          grew = true;
        }
      }
    }
    if (![...drop].some((eid) => model.nodes[eid] || model.expanded.includes(eid) || model.rootIds?.includes(eid))) {
      return model;
    }
    const nodes = { ...model.nodes };
    for (const eid of drop) delete nodes[eid];
    for (const [eid, node] of Object.entries(nodes)) {
      if (!node.childEids) continue;
      const nextKids = node.childEids.filter((id) => !drop.has(id));
      if (nextKids.length !== node.childEids.length) nodes[eid] = { ...node, childEids: nextKids };
    }
    const rows = { ...model.rows };
    for (const eid of drop) delete rows[eid];
    return {
      ...model,
      nodes,
      rows,
      expanded: model.expanded.filter((eid) => !drop.has(eid)),
      rootIds: model.rootIds ? model.rootIds.filter((eid) => !drop.has(eid)) : model.rootIds,
    };
  });
}

export function setExpanded(screenId, eid, open) {
  commit(screenId, (model) => {
    const has = model.expanded.includes(eid);
    if (open && has) return model;
    if (!open && !has) return model;
    return {
      ...model,
      expanded: open ? [...model.expanded, eid] : model.expanded.filter((id) => id !== eid),
    };
  });
  if (open) return loadChildren(screenId, eid);
  return Promise.resolve();
}

export async function revealEid(screenId, eid) {
  let chain;
  try {
    chain = await request(screenId, "ancestry", { eid }, 3000);
  } catch (error) {
    if (isAbort(error)) return;
    if (!screenAlive(screenId) || previewStore.get()[screenId]?.kind === "connect") return;
    reportFailure(error, { region: "layers", screenId });
    commit(screenId, (model) => ({ ...model, root: { state: "error", error: "Couldn't load layers" } }));
    return;
  }
  if (!chain?.length) return;
  await loadChildren(screenId, null);
  for (let i = 0; i < chain.length - 1; i += 1) {
    rememberElement(screenId, chain[i]);
    setExpanded(screenId, chain[i].eid, true);
    await loadChildren(screenId, chain[i].eid);
  }
  rememberElement(screenId, chain[chain.length - 1]);
  commit(screenId, (model) => ({ ...model, scrollTarget: eid }));
}

export async function refreshOpenTree(screenId) {
  const model = getLayers(screenId);
  const parents = [null, ...model.expanded];
  await Promise.all(parents.map((parentEid) => loadChildren(screenId, parentEid, { force: true })));
  const latest = getLayers(screenId);
  if (latest.search) return runSearch(screenId, latest.search);
  return undefined;
}

const searchTokens = new Map();

export function setSearch(screenId, query) {
  const current = getLayers(screenId);
  if (!query) {
    const snap = current.snapshot;
    commit(screenId, (model) => ({
      ...model,
      search: "",
      searchTree: null,
      searchState: "idle",
      snapshot: null,
      expanded: snap ? snap.expanded.slice() : model.expanded,
      scrollTop: snap ? snap.scrollTop : model.scrollTop,
      scrollEpoch: model.scrollEpoch + 1,
    }));
    searchTokens.set(screenId, (searchTokens.get(screenId) || 0) + 1);
    return;
  }
  if (!current.search) {
    commit(screenId, (model) => ({
      ...model,
      search: query,
      snapshot: { expanded: model.expanded.slice(), scrollTop: model.scrollTop },
    }));
  } else {
    commit(screenId, (model) => ({ ...model, search: query }));
  }
  runSearch(screenId, query);
}

export function runSearch(screenId, query = getLayers(screenId).search) {
  if (!query) return Promise.resolve();
  const token = (searchTokens.get(screenId) || 0) + 1;
  searchTokens.set(screenId, token);
  commit(screenId, (model) => ({ ...model, searchState: "loading" }));
  const promise = (async () => {
    try {
      const payload = await request(screenId, "search", { query }, 3000);
      if (searchTokens.get(screenId) !== token) return;
      if (getLayers(screenId).search !== query) return;
      const tree = payload?.tree || [];
      stampSearch(screenId, tree);
      commit(screenId, (model) => ({ ...model, searchTree: tree, searchState: "ready" }));
    } catch (error) {
      if (searchTokens.get(screenId) !== token || isAbort(error)) return;
      if (!screenAlive(screenId) || previewStore.get()[screenId]?.kind === "connect") return;
      commit(screenId, (model) => ({ ...model, searchState: "error" }));
      reportFailure(error, { region: "layers", screenId });
    }
  })();
  return promise;
}

function stampSearch(screenId, nodes, parentEid = null) {
  for (const node of nodes || []) {
    rememberElement(screenId, node);
    node.parentEid = parentEid;
    stampSearch(screenId, node.children, node.eid);
  }
}

export function visibleRows(screenId) {
  const model = getLayers(screenId);
  if (model.search && model.searchTree) return flattenSearch(model.searchTree, 0);
  return flattenModel(model);
}

function flattenModel(model) {
  const rows = [];
  const walk = (eid, depth) => {
    const node = model.nodes[eid];
    if (!node) return;
    const expanded = model.expanded.includes(eid);
    rows.push({ ...node, depth, expanded, status: model.rows[eid]?.state || "idle" });
    if (expanded && node.childEids) {
      for (const child of node.childEids) walk(child, depth + 1);
    }
  };
  for (const eid of model.rootIds || []) walk(eid, 0);
  return rows;
}

function flattenSearch(nodes, depth) {
  const rows = [];
  for (const node of nodes || []) {
    rows.push({
      eid: node.eid,
      name: node.name,
      hasChildren: (node.children || []).length > 0,
      dataKey: node.dataKey || null,
      parentEid: node.parentEid || null,
      depth,
      expanded: (node.children || []).length > 0,
      status: "ready",
      childEids: (node.children || []).map((child) => child.eid),
    });
    rows.push(...flattenSearch(node.children, depth + 1));
  }
  return rows;
}
