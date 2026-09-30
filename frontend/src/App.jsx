import { useEffect, useRef, useState } from 'react';
import { getElementDetails, getScreens } from './api.js';
import InspectorPanel from './InspectorPanel.jsx';
import './App.css';

const CHANNEL = 'figr-board';
const W = 1280;
const H = 800;
const GAP = 60;
const COLS = 4;
const MIN_Z = 0.25;
const MAX_Z = 4;

function walkRows(nodes, expanded, depth = 0) {
  return nodes.flatMap(item => [
    { item, depth },
    ...(expanded.has(item.ref) && Array.isArray(item.children) ? walkRows(item.children, expanded, depth + 1) : []),
  ]);
}

function filterTree(nodes, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;
  return nodes.reduce((result, item) => {
    const children = filterTree(item.children || [], needle);
    if (item.name.toLocaleLowerCase().includes(needle) || children.length) result.push({ ...item, children });
    return result;
  }, []);
}

function mergeChildList(previous, next) {
  const previousByRef = new Map((previous || []).map(item => [item.ref, item]));
  return next.map(item => {
    const existing = previousByRef.get(item.ref);
    if (!existing || !Array.isArray(existing.children)) return item;
    return { ...item, children: existing.children };
  });
}

function withChildren(nodes, parentRef, children) {
  if (!parentRef) return mergeChildList(nodes, children);
  let found = false;
  const update = items => items.map(item => {
    if (item.ref === parentRef) {
      found = true;
      return { ...item, children: mergeChildList(item.children, children) };
    }
    return Array.isArray(item.children) ? { ...item, children: update(item.children) } : item;
  });
  const result = update(nodes);
  return found ? result : nodes;
}

function findItem(nodes, ref) {
  for (const item of nodes) {
    if (item.ref === ref) return item;
    const nested = Array.isArray(item.children) ? findItem(item.children, ref) : null;
    if (nested) return nested;
  }
  return null;
}

function boxKey(item) {
  if (!item?.rect) return item?.ref || '';
  const { x, y, width, height } = item.rect;
  return `${item.ref}:${Math.round(x)}:${Math.round(y)}:${Math.round(width)}:${Math.round(height)}`;
}

function geometryKey(value = {}) {
  const hovered = value.hovered ? boxKey(value.hovered) : '';
  const selected = (value.selected || []).map(boxKey).join('|');
  return `${hovered}::${selected}`;
}

function liveKey(item) {
  const live = item?.live || {};
  return [item?.name, item?.tag, item?.id, (item?.classes || []).join('.'), boxKey(item), live.text, live.color, live.background, live.fontFamily, live.fontSize, live.fontWeight, live.pageX, live.pageY].join('|');
}

export default function App() {
  const [screens, setScreens] = useState([]);
  const [mode, setMode] = useState('select');
  const [transform, setTransform] = useState({ x: 24, y: 24, z: 0.45 });
  const [zoomLabel, setZoomLabel] = useState(45);
  const [activeScreen, setActiveScreen] = useState(null);
  const [selections, setSelections] = useState({});
  const [hovered, setHovered] = useState({});
  const [geometry, setGeometry] = useState({});
  const [trees, setTrees] = useState({});
  const [expandedByScreen, setExpandedByScreen] = useState({});
  const [rowStatus, setRowStatus] = useState({});
  const [search, setSearch] = useState('');
  const [searchTree, setSearchTree] = useState(null);
  const [removed, setRemoved] = useState({});
  const [pageErrors, setPageErrors] = useState({});
  const [panelScrollByScreen, setPanelScrollByScreen] = useState({});
  const [detailState, setDetailState] = useState({ loading: false, data: null });
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const iframeRefs = useRef(new Map());
  const rowRefs = useRef(new Map());
  const requestsRef = useRef(new Map());
  const childRequestsRef = useRef(new Map());
  const requestIdRef = useRef(0);
  const pageUrlRef = useRef(new Map());
  const layerTreeRef = useRef(null);
  const treesRef = useRef(trees);
  const selectionsRef = useRef(selections);
  const expandedRef = useRef(expandedByScreen);
  const treeSyncRef = useRef(new Map());
  const activeScreenRef = useRef(activeScreen);
  activeScreenRef.current = activeScreen;
  treesRef.current = trees;
  selectionsRef.current = selections;
  expandedRef.current = expandedByScreen;

  const loadScreens = () => {
    getScreens().then(setScreens).catch(error => console.error(error));
  };
  useEffect(() => { loadScreens(); }, []);

  const post = (screenId, message) => {
    iframeRefs.current.get(screenId)?.contentWindow?.postMessage({ channel: CHANNEL, ...message }, '*');
  };

  const request = (screenId, type, payload = {}) => new Promise((resolve, reject) => {
    if (!iframeRefs.current.get(screenId)?.contentWindow) {
      reject(new Error('Preview is not available'));
      return;
    }
    const requestId = ++requestIdRef.current;
    requestsRef.current.set(requestId, { resolve, reject, screenId, type });
    try {
      post(screenId, { type, requestId, ...payload });
    } catch (error) {
      requestsRef.current.delete(requestId);
      reject(error);
    }
  });

  const loadChildren = async (screenId, parentRef, refresh = false) => {
    const statusKey = `${screenId}:${parentRef || '@root'}`;
    const pending = childRequestsRef.current.get(statusKey);
    if (pending) return pending;
    if (!refresh && rowStatus[statusKey]?.loading) return [];
    const load = (async () => {
      const existingNodes = parentRef
        ? findItem(treesRef.current[screenId] || [], parentRef)?.children
        : treesRef.current[screenId];
      const hasExisting = Array.isArray(existingNodes);
      setRowStatus(previous => ({ ...previous, [statusKey]: { loading: !hasExisting } }));
      try {
        const result = await request(screenId, 'children', { ref: parentRef });
        if (activeScreenRef.current && activeScreenRef.current !== screenId) return [];
        setTrees(previous => {
          const next = { ...previous, [screenId]: withChildren(previous[screenId] || [], parentRef, result.nodes) };
          treesRef.current = next;
          return next;
        });
        setRowStatus(previous => ({ ...previous, [statusKey]: { loading: false } }));
        return result.nodes;
      } catch {
        setRowStatus(previous => ({ ...previous, [statusKey]: { loading: false } }));
        return [];
      } finally {
        if (childRequestsRef.current.get(statusKey) === load) childRequestsRef.current.delete(statusKey);
      }
    })();
    childRequestsRef.current.set(statusKey, load);
    return load;
  };

  const setSelection = (screenId, items) => {
    if (items.length) {
      setSelections(previous => ({ ...previous, [screenId]: items }));
      post(screenId, { type: 'selection', refs: items.map(item => item.ref) });
    } else {
      screens.forEach(screen => post(screen.id, { type: 'selection', refs: [] }));
      setSelections({});
    }
    setRemoved(previous => ({ ...previous, [screenId]: false }));
  };

  const revealSelection = async (screenId, item) => {
    const rowKey = `${screenId}:${item.ref}`;
    const visibleRow = rowRefs.current.get(rowKey);
    if (visibleRow) {
      visibleRow.scrollIntoView({ block: 'nearest' });
      return;
    }
    try {
      const result = await request(screenId, 'ancestors', { ref: item.ref });
      if (activeScreenRef.current !== screenId) return;
      if (!Array.isArray(treesRef.current[screenId])) await loadChildren(screenId, null);
      for (const ancestor of result.ancestors) {
        if (activeScreenRef.current !== screenId) return;
        setExpandedByScreen(previous => {
          const expanded = new Set(previous[screenId] || []);
          expanded.add(ancestor.ref);
          return { ...previous, [screenId]: expanded };
        });
        const ancestorNode = findItem(treesRef.current[screenId] || [], ancestor.ref);
        if (!Array.isArray(ancestorNode?.children)) await loadChildren(screenId, ancestor.ref);
      }
      window.setTimeout(() => rowRefs.current.get(rowKey)?.scrollIntoView({ block: 'nearest' }), 50);
    } catch { /* No matching layer can be revealed while its data is unavailable. */ }
  };

  const selectItem = (screenId, item, shift = false, fromPage = false) => {
    setActiveScreen(screenId);
    const current = selectionsRef.current[screenId] || [];
    let next = [item];
    if (shift && current.length) {
      next = current.some(selected => selected.ref === item.ref)
        ? current.filter(selected => selected.ref !== item.ref)
        : [...current, item];
    }
    const updated = { ...selectionsRef.current };
    Object.keys(updated).forEach(otherScreenId => {
      if (otherScreenId !== screenId && updated[otherScreenId]?.length) {
        updated[otherScreenId] = [];
        post(otherScreenId, { type: 'selection', refs: [] });
      }
    });
    updated[screenId] = next;
    selectionsRef.current = updated;
    setSelections(updated);
    setHovered(previous => (previous[screenId] ? { ...previous, [screenId]: null } : previous));
    if (fromPage && item.rect) {
      setGeometry(previous => ({
        ...previous,
        [screenId]: {
          hovered: null,
          selected: next.map(entry => entry.ref === item.ref ? item : (previous[screenId]?.selected || []).find(selected => selected.ref === entry.ref) || entry),
        },
      }));
    }
    setRemoved(previous => ({ ...previous, [screenId]: false }));
    post(screenId, { type: 'selection', refs: next.map(selected => selected.ref), scrollTo: item.ref });
    revealSelection(screenId, item);
  };

  const handleShortcut = (key, shift = false, screenId = activeScreen) => {
    if (key === 'v' || key === 'V') setMode('select');
    if (key === 'i' || key === 'I') setMode('interact');
    if (key === 'Escape') {
      if (screenId) setSelection(screenId, []);
      setSearch('');
      return;
    }
    if (!screenId) return;
    const current = (selections[screenId] || []).at(-1);
    if (!current) return;
    let action = null;
    if (key === 'Enter') action = shift ? 'parent' : 'first-child';
    if (key === 'Tab') action = shift ? 'previous-sibling' : 'next-sibling';
    if (key === 'ArrowRight') action = 'first-child';
    if (key === 'ArrowLeft') action = 'parent';
    if (action) post(screenId, { type: 'navigate-element', ref: current.ref, action });
  };

  useEffect(() => {
    const onKeyDown = event => {
      if (event.target.matches?.('input,textarea,[contenteditable="true"]')) return;
      if (['v', 'V', 'i', 'I', 'Escape', 'Enter', 'Tab'].includes(event.key)) {
        handleShortcut(event.key, event.shiftKey);
        if (mode === 'select' && ['Enter', 'Tab'].includes(event.key)) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeScreen, mode, selections]);

  useEffect(() => {
    screens.forEach(screen => post(screen.id, { type: 'mode', mode, zoom: transform.z }));
  }, [screens, mode, transform.z]);

  useEffect(() => {
    const onMessage = event => {
      const screen = screens.find(item => iframeRefs.current.get(item.id)?.contentWindow === event.source);
      if (!screen || event.data?.channel !== CHANNEL) return;
      const message = event.data;
      try {
      if (message.type === 'ready') {
        const oldUrl = pageUrlRef.current.get(screen.id);
        if (oldUrl && oldUrl !== message.url) {
          setSelection(screen.id, []);
          setTrees(previous => ({ ...previous, [screen.id]: [] }));
          setExpandedByScreen(previous => ({ ...previous, [screen.id]: new Set() }));
        }
        pageUrlRef.current.set(screen.id, message.url);
        if (!trees[screen.id]?.length) loadChildren(screen.id, null);
      } else if (message.type === 'children' || message.type === 'ancestors') {
        const pending = requestsRef.current.get(message.requestId);
        if (!pending) return;
        requestsRef.current.delete(message.requestId);
        if (message.type !== pending.type || (message.type === 'children' && !Array.isArray(message.nodes))
          || (message.type === 'ancestors' && !Array.isArray(message.ancestors))) {
          pending.reject(new Error(`Malformed ${message.type} response`));
        } else {
          pending.resolve(message.type === 'children' ? { nodes: message.nodes } : { ancestors: message.ancestors });
        }
      } else if (message.type === 'hover') {
        setHovered(previous => Object.fromEntries(Object.entries(previous).map(([id]) => [id, null]).concat([
          [screen.id, message.item ? { ...message.item, ancestors: message.ancestors || [] } : null],
        ])));
        setGeometry(previous => ({
          ...previous,
          [screen.id]: { ...previous[screen.id], hovered: message.item || null },
        }));
      } else if (message.type === 'geometry') {
        setGeometry(previous => geometryKey(previous[screen.id]) === geometryKey(message) ? previous : { ...previous, [screen.id]: message });
        setSelections(previous => {
          const current = previous[screen.id] || [];
          if (!current.length || !message.selected?.length) return previous;
          const incoming = new Map(message.selected.map(item => [item.ref, item]));
          let changed = false;
          const next = current.map(item => {
            const fresh = incoming.get(item.ref);
            if (!fresh || liveKey(item) === liveKey(fresh)) return item;
            changed = true;
            return fresh;
          });
          return changed ? { ...previous, [screen.id]: next } : previous;
        });
      } else if (message.type === 'select' || message.type === 'keyboard-select') {
        selectItem(screen.id, message.item, message.shift, true);
      } else if (message.type === 'background') {
        setActiveScreen(screen.id);
        setSelection(screen.id, []);
      } else if (message.type === 'zoom') {
        const frame = iframeRefs.current.get(screen.id);
        const viewport = viewportRef.current;
        if (frame && viewport) {
          const frameRect = frame.getBoundingClientRect();
          const viewportRect = viewport.getBoundingClientRect();
          zoomAt(message.deltaY, frameRect.left + message.x * transform.z - viewportRect.left, frameRect.top + message.y * transform.z - viewportRect.top);
        }
      } else if (message.type === 'shortcut') {
        handleShortcut(message.key, message.shift, screen.id);
      } else if (message.type === 'changed') {
        setSelections(previous => {
          const current = previous[screen.id] || [];
          const next = current.filter(item => message.selected.includes(item.ref));
          if (current.length && !next.length) setRemoved(state => ({ ...state, [screen.id]: true }));
          if (next.length === current.length && next.every((item, index) => item.ref === current[index].ref)) return previous;
          return { ...previous, [screen.id]: next };
        });
        setHovered(previous => previous[screen.id] && !message.selected.includes(previous[screen.id].ref)
          ? { ...previous, [screen.id]: null } : previous);
        window.clearTimeout(treeSyncRef.current.get(screen.id));
        treeSyncRef.current.set(screen.id, window.setTimeout(() => {
          try {
            loadChildren(screen.id, null, true);
            (expandedRef.current[screen.id] || new Set()).forEach(ref => loadChildren(screen.id, ref, true));
          } catch (error) { console.error(error); }
        }, 160));
      } else if (message.type === 'page-error') {
        const pageMessage = typeof message.message === 'string' && message.message.trim() ? message.message : 'Page error';
        setPageErrors(previous => ({ ...previous, [screen.id]: pageMessage }));
      }
      } catch (error) {
        console.error(error);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [screens, selections, expandedByScreen, trees]);

  useEffect(() => {
    if (activeScreen && !Array.isArray(treesRef.current[activeScreen])) loadChildren(activeScreen, null);
  }, [activeScreen]);

  const zoomAt = (deltaY, pointX, pointY) => {
    screens.forEach(screen => post(screen.id, { type: 'hover-ref', ref: null }));
    setHovered({});
    setGeometry(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { ...value, hovered: null }])));
    setTransform(previous => {
      const z = Math.min(MAX_Z, Math.max(MIN_Z, previous.z * Math.exp(-deltaY * 0.002)));
      const ratio = z / previous.z;
      setZoomLabel(Math.round(z * 100));
      return { x: pointX - (pointX - previous.x) * ratio, y: pointY - (pointY - previous.y) * ratio, z };
    });
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const onWheel = event => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        zoomAt(event.deltaY, event.clientX - rect.left, event.clientY - rect.top);
      } else if (!event.target.closest('[data-preview]')) {
        event.preventDefault();
        setTransform(previous => ({ ...previous, x: previous.x - event.deltaX, y: previous.y - event.deltaY }));
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [screens.length]);

  const startPan = event => {
    if (event.target.closest('[data-preview]') || event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    screens.forEach(screen => post(screen.id, { type: 'hover-ref', ref: null }));
    setHovered({});
    setGeometry(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { ...value, hovered: null }])));
  };

  useEffect(() => {
    const clearHover = () => {
      screens.forEach(screen => post(screen.id, { type: 'hover-ref', ref: null }));
      setHovered({});
      setGeometry(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { ...value, hovered: null }])));
    };
    window.addEventListener('blur', clearHover);
    return () => window.removeEventListener('blur', clearHover);
  }, [screens]);

  useEffect(() => {
    setHovered({});
    setGeometry(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { ...value, hovered: null }])));
  }, [mode]);
  const pan = event => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setTransform(previous => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
  };
  const stopPan = event => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const selectedForDetails = activeScreen ? selections[activeScreen] || [] : [];
  const selectedDataKey = selectedForDetails.length === 1 ? selectedForDetails[0].dataKey : null;

  useEffect(() => {
    if (selectedForDetails.length !== 1 || !selectedDataKey) {
      setDetailState({ loading: false, data: null });
      return undefined;
    }

    const controller = new AbortController();
    setDetailState({ loading: true, data: null });
    let current = true;
    getElementDetails(selectedDataKey, { signal: controller.signal }).then(data => {
      const selectedNow = selectionsRef.current[activeScreen] || [];
      if (!current || controller.signal.aborted || activeScreenRef.current !== activeScreen
        || selectedNow.length !== 1 || selectedNow[0].dataKey !== selectedDataKey) return;
      setDetailState({ loading: false, data });
    }).catch(error => {
      const selectedNow = selectionsRef.current[activeScreen] || [];
      if (!current || controller.signal.aborted || activeScreenRef.current !== activeScreen
        || selectedNow.length !== 1 || selectedNow[0].dataKey !== selectedDataKey) return;
      setDetailState({ loading: false, data: null });
    });
    return () => { current = false; controller.abort(); };
  }, [activeScreen, selectedForDetails.length, selectedDataKey]);

  useEffect(() => {
    if (!activeScreen || !search.trim()) { setSearchTree(null); return undefined; }
    let cancelled = false;
    setSearchTree(null);
    const timer = window.setTimeout(async () => {
      const loadTree = async parentRef => {
        const result = await request(activeScreen, 'children', { ref: parentRef });
        return Promise.all(result.nodes.map(async item => ({
          ...item,
          children: item.hasChildren ? await loadTree(item.ref) : [],
        })));
      };
      try {
        const results = await loadTree(null);
        if (!cancelled && activeScreenRef.current === activeScreen) setSearchTree(results);
      } catch { /* No search results are available until the preview responds. */ }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeScreen, search]);

  useEffect(() => {
    const tree = layerTreeRef.current;
    if (tree && activeScreen) tree.scrollTop = panelScrollByScreen[activeScreen] || 0;
  }, [activeScreen]);

  const activeSelection = activeScreen ? selections[activeScreen] || [] : [];
  const currentDetailState = detailState;
  const activeTree = activeScreen ? trees[activeScreen] || [] : [];
  const expanded = activeScreen ? expandedByScreen[activeScreen] || new Set() : new Set();
  const shownTree = search.trim() && searchTree ? filterTree(searchTree, search) : activeTree;
  const searchExpanded = new Set();
  if (search.trim()) {
    const collectExpanded = nodes => nodes.forEach(item => {
      if (item.children?.length) {
        searchExpanded.add(item.ref);
        collectExpanded(item.children);
      }
    });
    collectExpanded(shownTree);
  }
  const visibleRows = walkRows(shownTree, search.trim() ? searchExpanded : expanded);
  const visibleRefs = new Set(visibleRows.map(row => row.item.ref));
  const activeHover = activeScreen ? hovered[activeScreen] : null;
  const visibleHoverRef = activeHover && visibleRefs.has(activeHover.ref)
    ? activeHover.ref
    : [...(activeHover?.ancestors || [])].reverse().find(item => visibleRefs.has(item.ref))?.ref;

  const toggleExpanded = (screenId, item) => {
    setExpandedByScreen(previous => {
      const next = new Set(previous[screenId] || []);
      if (next.has(item.ref)) next.delete(item.ref);
      else next.add(item.ref);
      return { ...previous, [screenId]: next };
    });
    if (!expandedByScreen[screenId]?.has(item.ref) && item.children == null) loadChildren(screenId, item.ref);
  };

  const onLayersKeyDown = event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = visibleRows.findIndex(row => row.item.ref === activeSelection.at(-1)?.ref);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const row = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))];
      if (row) selectItem(activeScreen, row.item);
      return;
    }
    const item = visibleRows[index]?.item;
    if (!item) return;
    if (event.key === 'ArrowRight') {
      if (item.hasChildren && !expanded.has(item.ref)) toggleExpanded(activeScreen, item);
      else if (item.children?.[0]) selectItem(activeScreen, item.children[0]);
    } else if (expanded.has(item.ref)) toggleExpanded(activeScreen, item);
    else if (item.parentRef) {
      const parent = findItem(activeTree, item.parentRef);
      if (parent) selectItem(activeScreen, parent);
    }
  };

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand-mark" aria-label="Figr board">F</div>
        <div className="toolbar-divider" />
        <div className="mode-switch" role="group" aria-label="Board mode">
          <button className={`mode-button${mode === 'select' ? ' active' : ''}`} onClick={() => setMode('select')} aria-pressed={mode === 'select'} title="Select mode (V)"><span className="mode-glyph" aria-hidden="true">↖</span><span>Select</span><kbd>V</kbd></button>
          <button className={`mode-button${mode === 'interact' ? ' active' : ''}`} onClick={() => setMode('interact')} aria-pressed={mode === 'interact'} title="Interact mode (I)"><span className="mode-glyph" aria-hidden="true">⌁</span><span>Interact</span><kbd>I</kbd></button>
        </div>
        <div className="toolbar-spacer" />
        <div className="zoom-indicator">{zoomLabel}%</div>
        <div className="toolbar-context">{activeScreen ? screens.find(screen => screen.id === activeScreen)?.name : 'Board'}</div>
      </header>

      <main className="workspace">
        <section className="board-area" aria-label="Screen board">
          {!screens.length ? <div className="app-message">Loading screens...</div>
            : <div ref={viewportRef} className="board-viewport" onPointerDown={startPan} onPointerMove={pan} onPointerUp={stopPan} onPointerCancel={stopPan}
            onClick={event => { if (!event.target.closest('[data-preview]') && activeScreen) setSelection(activeScreen, []); }}>
            <div className="board" style={{ '--board-x': `${transform.x}px`, '--board-y': `${transform.y}px`, '--board-zoom': transform.z }}>
              {screens.map((screen, index) => {
                const activeRefs = new Set((selections[screen.id] || []).map(item => item.ref));
                const selectedItems = (geometry[screen.id]?.selected || []).filter(item => activeRefs.has(item.ref));
                const currentHover = hovered[screen.id];
                const hoveredItem = currentHover && currentHover.rect
                  ? currentHover
                  : geometry[screen.id]?.hovered;
                const overlays = mode === 'select'
                  ? [...selectedItems.map(item => ({ ...item, kind: 'selected' })), ...(hoveredItem && !selectedItems.some(item => item.ref === hoveredItem.ref) ? [{ ...hoveredItem, kind: 'hover' }] : [])]
                  : [];
                return <article key={screen.id} className={`screen-preview${activeScreen === screen.id ? ' is-active' : ''}`} data-preview data-screen-id={screen.id}
                  style={{ '--screen-left': `${(index % COLS) * (W + GAP)}px`, '--screen-top': `${Math.floor(index / COLS) * (H + GAP + 24)}px` }}
                  onPointerDown={() => setActiveScreen(screen.id)}>
                  <div className="screen-name"><span className="screen-dot" />{screen.name}<span className="screen-index">{String(index + 1).padStart(2, '0')}</span></div>
                  <div className="preview-frame-wrap">
                    <iframe ref={element => element ? iframeRefs.current.set(screen.id, element) : iframeRefs.current.delete(screen.id)} src={screen.url} title={screen.name} className="screen-frame"
                      onLoad={() => post(screen.id, { type: 'init', mode, selected: (selections[screen.id] || []).map(item => item.ref) })} />
                    <div className="selection-overlay" aria-hidden="true">
                      {overlays.map(item => {
                        const lineWidth = (item.kind === 'selected' ? 2 : 1) / transform.z;
                        return <div key={`${item.kind}:${item.ref}`} className={`outline ${item.kind}`} style={{ left: item.rect.x, top: item.rect.y, width: item.rect.width, height: item.rect.height, borderWidth: `${lineWidth}px` }}>
                          <span className="outline-label" style={{ top: item.rect.y >= 18 ? `${-18 / transform.z}px` : `${item.rect.height}px`, left: `${-lineWidth}px`, maxWidth: `${220 / transform.z}px`, padding: `${3 / transform.z}px ${5 / transform.z}px`, borderRadius: `${3 / transform.z}px`, fontSize: `${12 / transform.z}px` }}>{item.name}</span>
                        </div>;
                      })}
                    </div>
                    {pageErrors[screen.id] && <span className="page-error-badge" title={pageErrors[screen.id]}>Page error</span>}
                  </div>
                </article>;
              })}
            </div>
          </div>
          }
        </section>

        <aside className="side-panels">
          <section className="panel layers-panel">
            <header className="panel-header"><h2>Layers</h2><span className="panel-count">{activeTree.length || ''}</span></header>
            {activeScreen ? <>
              <label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search all layers" /></label>
              <div ref={layerTreeRef} className="layer-tree" tabIndex={0} onKeyDown={onLayersKeyDown}
                onScroll={event => {
                  const scrollTop = event.currentTarget.scrollTop;
                  setPanelScrollByScreen(previous => ({ ...previous, [activeScreen]: scrollTop }));
                }}>
                {rowStatus[`${activeScreen}:@root`]?.loading && !activeTree.length && <div className="panel-empty">Loading layers...</div>}
                {!activeTree.length && !rowStatus[`${activeScreen}:@root`]?.loading && <div className="panel-empty">No elements</div>}
                {visibleRows.map(({ item, depth }) => {
                  const isExpanded = search.trim() ? Boolean(item.children?.length) : expanded.has(item.ref);
                  const isSelected = activeSelection.some(selected => selected.ref === item.ref);
                  const isHovered = visibleHoverRef === item.ref;
                  const childState = rowStatus[`${activeScreen}:${item.ref}`];
                  return <div key={item.ref} ref={element => element ? rowRefs.current.set(`${activeScreen}:${item.ref}`, element) : rowRefs.current.delete(`${activeScreen}:${item.ref}`)}
                    className={`layer-row${isSelected ? ' selected' : ''}${isHovered ? ' hovered' : ''}`} style={{ '--layer-depth': depth }}
                    onMouseEnter={() => { setHovered(previous => ({ ...previous, [activeScreen]: { ...item, rect: null } })); post(activeScreen, { type: 'hover-ref', ref: item.ref }); }}
                    onMouseLeave={() => { setHovered(previous => ({ ...previous, [activeScreen]: null })); post(activeScreen, { type: 'hover-ref', ref: null }); }}
                    onClick={event => selectItem(activeScreen, item, event.shiftKey)}>
                    <button className="layer-chevron" aria-label={isExpanded ? 'Collapse layer' : 'Expand layer'} disabled={!item.hasChildren} onClick={event => { event.stopPropagation(); toggleExpanded(activeScreen, item); }}>{item.hasChildren ? (isExpanded ? '⌄' : '›') : ''}</button>
                    <span className="layer-type">{item.tag.slice(0, 1)}</span><span className="layer-name" title={item.name}>{item.name}</span>
                    {childState?.loading && <span className="layer-state">Loading</span>}
                  </div>;
                })}
              </div>
            </> : <div className="panel-empty">Click something in a preview</div>}
          </section>

          <InspectorPanel
            activeScreen={activeScreen}
            activeSelection={activeSelection}
            removed={removed[activeScreen]}
            detailState={currentDetailState}
          />
        </aside>
      </main>
    </div>
  );
}