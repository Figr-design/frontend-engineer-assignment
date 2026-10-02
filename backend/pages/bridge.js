// Injected into each preview page (one script tag). Talks to the host only via postMessage.
// Element ids survive a DOM rebuild when a fingerprint is unique; ambiguous matches are dropped
// so the selection can never jump onto a different element.

(() => {
  const session = Math.random().toString(36).slice(2);
  let hostMode = "select";
  const dev = { hangRoot: false, hangChildren: false, mute: false };

  const eidToEl = new Map();
  const elToEid = new WeakMap();
  const eidToFp = new Map();
  let seq = 1;

  const TIME_AGO = /\b\d+\s*[smhd]\s*ago\b/gi;

  function post(message) {
    if (window.parent === window) return;
    window.parent.postMessage({ source: "figr-page", session, href: location.href, ...message }, "*");
  }

  function reply(requestId, payload) {
    post({ type: "result", requestId, ok: true, payload });
  }

  function classToken(el) {
    const raw = el.getAttribute && el.getAttribute("class");
    if (!raw) return "";
    return raw.trim().split(/\s+/).filter(Boolean)[0] || "";
  }

  function elementName(el) {
    const named = el.getAttribute("data-name");
    if (named) return named;
    const tag = el.tagName.toLowerCase();
    const cls = classToken(el);
    if (cls) return `${tag}.${cls}`;
    if (el.id) return `${tag}#${el.id}`;
    return tag;
  }

  function stripText(value) {
    return String(value || "")
      .replace(TIME_AGO, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function fingerprint(el) {
    const key = el.getAttribute("data-key");
    if (key) return `key:${key}`;
    if (el.id) return `id:${el.id}`;
    const name = el.getAttribute("data-name");
    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute("class") || "";
    if (name) return `name:${tag}|${name}|${cls}`;
    return `node:${tag}|${cls}|${stripText(el.innerText || el.textContent || "")}`;
  }

  function register(el) {
    const eid = `e${seq++}`;
    elToEid.set(el, eid);
    eidToEl.set(eid, el);
    eidToFp.set(eid, fingerprint(el));
    return eid;
  }

  function eidOf(el) {
    const existing = elToEid.get(el);
    if (existing) return existing;
    const fp = fingerprint(el);
    const candidates = [];
    for (const [eid, oldFp] of eidToFp) {
      if (oldFp !== fp) continue;
      const current = eidToEl.get(eid);
      if (current && current !== el && current.isConnected) continue;
      candidates.push(eid);
    }
    if (candidates.length === 1) {
      const eid = candidates[0];
      elToEid.set(el, eid);
      eidToEl.set(eid, el);
      eidToFp.set(eid, fp);
      return eid;
    }
    return register(el);
  }

  function resolve(eid) {
    const el = eidToEl.get(eid);
    if (!el || !el.isConnected) return null;
    return el;
  }

  function walkElements(root, visit) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node !== document.body && node !== document.documentElement) visit(node);
      node = walker.nextNode();
    }
  }

  function reindex() {
    const claimed = new Set();
    for (const [eid, el] of eidToEl) {
      if (el.isConnected) {
        eidToFp.set(eid, fingerprint(el));
        claimed.add(el);
      }
    }
    const lost = [];
    for (const [eid, el] of eidToEl) {
      if (!el.isConnected) lost.push(eid);
    }
    if (!lost.length) return;
    const buckets = new Map();
    walkElements(document.body, (el) => {
      if (claimed.has(el)) return;
      const fp = fingerprint(el);
      const list = buckets.get(fp);
      if (list) list.push(el);
      else buckets.set(fp, [el]);
    });
    for (const eid of lost) {
      const fp = eidToFp.get(eid);
      const list = buckets.get(fp) || [];
      if (list.length === 1) {
        const el = list.pop();
        buckets.set(fp, []);
        elToEid.set(el, eid);
        eidToEl.set(eid, el);
        eidToFp.set(eid, fp);
        claimed.add(el);
      } else {
        eidToEl.delete(eid);
        eidToFp.delete(eid);
      }
    }
  }

  function describe(el) {
    return {
      eid: eidOf(el),
      name: elementName(el),
      hasChildren: el.childElementCount > 0,
      dataKey: el.getAttribute("data-key"),
      tag: el.tagName.toLowerCase(),
    };
  }

  function ancestry(el) {
    const chain = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      chain.push(describe(node));
      node = node.parentElement;
    }
    return chain.reverse();
  }

  function ancestorEids(el) {
    const chain = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      chain.push(eidOf(node));
      node = node.parentElement;
    }
    return chain.reverse();
  }

  function hitIs(el, x, y) {
    const top = document.elementFromPoint(x, y);
    if (!top) return false;
    return top === el || el.contains(top);
  }

  function clipToFront(el, box) {
    let top = box.top;
    let left = box.left;
    let right = box.right;
    let bottom = box.bottom;
    const midX = (left + right) / 2;
    const yHit = (y) => hitIs(el, midX, Math.min(Math.max(y, top + 0.5), bottom - 0.5));
    const visibleY = yHit(top + 1) || yHit((top + bottom) / 2) || yHit(bottom - 1);
    if (!visibleY) {
      if (!hitIs(el, left + 1, top + 1) && !hitIs(el, right - 1, bottom - 1) && !hitIs(el, left + 1, bottom - 1)) {
        return null;
      }
    } else {
      if (!yHit(top + 1)) {
        let lo = top;
        let hi = bottom;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) / 2;
          if (yHit(mid)) hi = mid;
          else lo = mid;
        }
        top = hi;
      }
      if (!yHit(bottom - 1)) {
        let lo = top;
        let hi = bottom;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) / 2;
          if (yHit(mid)) lo = mid;
          else hi = mid;
        }
        bottom = lo;
      }
    }
    const cy = (top + bottom) / 2;
    const xHit = (x) => hitIs(el, Math.min(Math.max(x, left + 0.5), right - 0.5), cy);
    if (xHit(left + 1) || xHit((left + right) / 2) || xHit(right - 1)) {
      if (!xHit(left + 1)) {
        let lo = left;
        let hi = right;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) / 2;
          if (xHit(mid)) hi = mid;
          else lo = mid;
        }
        left = hi;
      }
      if (!xHit(right - 1)) {
        let lo = left;
        let hi = right;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) / 2;
          if (xHit(mid)) lo = mid;
          else hi = mid;
        }
        right = lo;
      }
    }
    if (right - left < 0.5 || bottom - top < 0.5) return null;
    return { top, left, right, bottom };
  }

  function visibleRect(el) {
    const base = el.getBoundingClientRect();
    let top = Math.max(base.top, 0);
    let left = Math.max(base.left, 0);
    let right = Math.min(base.right, window.innerWidth);
    let bottom = Math.min(base.bottom, window.innerHeight);
    for (let parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = /(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`);
      if (!clip) continue;
      const rect = parent.getBoundingClientRect();
      top = Math.max(top, rect.top);
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
      bottom = Math.min(bottom, rect.bottom);
    }
    if (right - left < 0.5 || bottom - top < 0.5) return null;
    const front = clipToFront(el, { top, left, right, bottom });
    if (!front) return null;
    return {
      x: front.left,
      y: front.top,
      w: front.right - front.left,
      h: front.bottom - front.top,
      name: elementName(el),
    };
  }

  function layoutPosition(el) {
    const rect = el.getBoundingClientRect();
    let x = rect.left + window.scrollX;
    let y = rect.top + window.scrollY;
    const scrolling = document.scrollingElement;
    for (let node = el.parentElement; node && node !== scrolling && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      x += node.scrollLeft || 0;
      y += node.scrollTop || 0;
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  function liveOf(el) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const pos = layoutPosition(el);
    const rawText = el.innerText || el.textContent || (typeof el.value === "string" ? el.value : "");
    return {
      eid: eidOf(el),
      name: elementName(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: el.getAttribute("class") || "",
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      x: pos.x,
      y: pos.y,
      text: rawText.replace(/\s+/g, " ").trim().slice(0, 120),
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      dataKey: el.getAttribute("data-key"),
    };
  }

  function canScroll(el) {
    if (el === document.body || el === document.documentElement || el === document.scrollingElement) {
      const scroller = document.scrollingElement;
      return scroller.scrollHeight > window.innerHeight + 1 || scroller.scrollWidth > window.innerWidth + 1;
    }
    const style = getComputedStyle(el);
    const y = (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    const x = (style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
    return x || y;
  }

  function nudge(scroller, el) {
    const isWindow = scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement;
    if (!isWindow && !canScroll(scroller)) return;
    const rect = el.getBoundingClientRect();
    if (isWindow) {
      let dx = 0;
      let dy = 0;
      if (rect.top < 8) dy = rect.top - 8;
      else if (rect.bottom > window.innerHeight - 8) dy = rect.bottom - (window.innerHeight - 8);
      if (rect.left < 8) dx = rect.left - 8;
      else if (rect.right > window.innerWidth - 8) dx = rect.right - (window.innerWidth - 8);
      if (dx || dy) window.scrollBy(dx, dy);
      return;
    }
    const bounds = scroller.getBoundingClientRect();
    if (rect.top < bounds.top + 4) scroller.scrollTop += rect.top - (bounds.top + 4);
    else if (rect.bottom > bounds.bottom - 4) scroller.scrollTop += rect.bottom - (bounds.bottom - 4);
    if (rect.left < bounds.left + 4) scroller.scrollLeft += rect.left - (bounds.left + 4);
    else if (rect.right > bounds.right - 4) scroller.scrollLeft += rect.right - (bounds.right - 4);
  }

  function reveal(el) {
    const chain = [];
    let node = el.parentElement;
    while (node) {
      chain.push(node);
      node = node.parentElement;
    }
    for (const scroller of chain) nudge(scroller, el);
  }

  function scrollAt(x, y, dx, dy) {
    let el = document.elementFromPoint(x, y);
    while (el) {
      if (el !== document.body && el !== document.documentElement && canScroll(el)) {
        const top = el.scrollTop;
        const left = el.scrollLeft;
        if (dy) el.scrollTop += dy;
        if (dx) el.scrollLeft += dx;
        if (el.scrollTop !== top || el.scrollLeft !== left) return;
      }
      el = el.parentElement;
    }
    window.scrollBy(dx, dy);
  }

  function siblings(el) {
    const parent = el.parentElement;
    if (!parent) return [el];
    return [...parent.children];
  }

  function relative(el, op) {
    if (op === "child") return el.firstElementChild;
    if (op === "parent") {
      const parent = el.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) return null;
      return parent;
    }
    const list = siblings(el);
    const index = list.indexOf(el);
    if (index < 0 || list.length === 0) return null;
    const dir = op === "prev" ? -1 : 1;
    return list[(index + dir + list.length) % list.length];
  }

  function searchTree(query) {
    const q = query.toLowerCase();
    function walk(el) {
      const children = [...el.children].map(walk).filter(Boolean);
      const selfMatch = elementName(el).toLowerCase().includes(q);
      if (!selfMatch && children.length === 0) return null;
      return { ...describe(el), children };
    }
    return [...document.body.children].map(walk).filter(Boolean);
  }

  function isTypingTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return el.isContentEditable;
  }

  let domTimer = 0;
  function scheduleDomChanged() {
    clearTimeout(domTimer);
    domTimer = setTimeout(() => post({ type: "dom-changed" }), 60);
  }

  const observer = new MutationObserver(() => {
    reindex();
    scheduleDomChanged();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "id", "data-name", "data-key"],
  });

  let scrollScheduled = false;
  function onScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      post({ type: "scrolled" });
    });
  }
  window.addEventListener("scroll", onScroll, true);

  window.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      post({ type: "zoom-wheel", deltaY: event.deltaY, x: event.clientX, y: event.clientY });
    },
    { passive: false, capture: true },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key;
      const interesting = key === "v" || key === "V" || key === "i" || key === "I" || key === "Escape" || key === "Enter" || key === "Tab";
      if (!interesting) return;
      if (isTypingTarget(event.target)) return;
      if (hostMode === "interact" && key !== "v" && key !== "V" && key !== "i" && key !== "I" && key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      post({ type: "shortcut", key, shiftKey: event.shiftKey });
    },
    true,
  );

  window.addEventListener(
    "focusin",
    (event) => {
      if (hostMode === "select" && isTypingTarget(event.target)) event.target.blur();
    },
    true,
  );

  function swallow(event) {
    if (hostMode !== "select") return;
    event.preventDefault();
    event.stopPropagation();
  }
  for (const type of ["click", "auxclick", "mousedown", "mouseup", "pointerdown", "submit"]) {
    window.addEventListener(type, swallow, true);
  }

  window.addEventListener("error", (event) => {
    post({ type: "page-error", message: event.message || "Page error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    post({ type: "page-error", message: (reason && reason.message) || String(reason) });
  });

  function handle(message) {
    if (dev.mute && message.type !== "dev" && message.type !== "ping") return;
    if (message.type === "ping") {
      post({ type: "ready" });
      return;
    }
    if (message.type === "mode") {
      hostMode = message.mode === "interact" ? "interact" : "select";
      return;
    }
    if (message.type === "dev") {
      if (message.op === "hang-root") dev.hangRoot = true;
      if (message.op === "hang-children") dev.hangChildren = true;
      if (message.op === "mute") dev.mute = true;
      if (message.op === "page-error") {
        setTimeout(() => {
          throw new Error("Dev triggered page error");
        }, 0);
      }
      if (message.op === "clear") {
        dev.hangRoot = false;
        dev.hangChildren = false;
        dev.mute = false;
      }
      return;
    }

    const { requestId } = message;
    if (message.type === "hit") {
      const el = document.elementFromPoint(message.x, message.y);
      if (!el || el === document.body || el === document.documentElement) {
        reply(requestId, null);
        return;
      }
      reply(requestId, { ...describe(el), ancestors: ancestorEids(el) });
      return;
    }
    if (message.type === "children") {
      const parentEid = message.parentEid || null;
      if (parentEid == null && dev.hangRoot) {
        dev.hangRoot = false;
        return;
      }
      if (parentEid && dev.hangChildren) {
        dev.hangChildren = false;
        return;
      }
      const parent = parentEid ? resolve(parentEid) : document.body;
      if (parentEid && !parent) {
        reply(requestId, { gone: true, children: [] });
        return;
      }
      const children = [...parent.children].map(describe);
      reply(requestId, { gone: false, children });
      return;
    }
    if (message.type === "ancestry") {
      const el = resolve(message.eid);
      reply(requestId, el ? ancestry(el) : null);
      return;
    }
    if (message.type === "live") {
      const items = [];
      const missing = [];
      for (const eid of message.eids || []) {
        const el = resolve(eid);
        if (!el) missing.push(eid);
        else items.push(liveOf(el));
      }
      reply(requestId, { items, missing });
      return;
    }
    if (message.type === "rects") {
      const rects = {};
      const missing = [];
      for (const eid of message.eids || []) {
        const el = resolve(eid);
        if (!el) missing.push(eid);
        else rects[eid] = visibleRect(el);
      }
      reply(requestId, { rects, missing });
      return;
    }
    if (message.type === "reveal") {
      const el = resolve(message.eid);
      if (el) reveal(el);
      reply(requestId, { ok: Boolean(el) });
      return;
    }
    if (message.type === "relative") {
      const el = resolve(message.eid);
      const next = el ? relative(el, message.op) : null;
      reply(requestId, next ? describe(next) : null);
      return;
    }
    if (message.type === "search") {
      reply(requestId, { tree: searchTree(message.query || "") });
      return;
    }
    if (message.type === "audit") {
      const missing = [];
      const present = [];
      for (const eid of message.eids || []) {
        if (resolve(eid)) present.push(eid);
        else missing.push(eid);
      }
      reply(requestId, { missing, present });
      return;
    }
    if (message.type === "scroll") {
      scrollAt(message.x, message.y, message.dx, message.dy);
      return;
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== "figr-host") return;
    try {
      handle(data);
    } catch (error) {
      if (data.requestId != null) {
        post({ type: "result", requestId: data.requestId, ok: false, error: error.message || String(error) });
      } else {
        post({ type: "bridge-error", message: error.message || String(error) });
      }
    }
  });

  post({ type: "ready" });
})();
