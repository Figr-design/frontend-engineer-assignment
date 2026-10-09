/* Figr preview bridge. Loaded by one <script> tag in each page. */
(function () {
  "use strict";

  var SOURCE = "figr-bridge";
  var HOST = "figr-host";
  var sessionId = null;
  var seq = 0;
  var hoverId = null;
  var selectedIds = [];
  var ro = null;
  var mo = null;
  var moTimer = null;
  var helloTimer = null;
  var elById = new Map();
  var idByEl = new WeakMap();

  function send(msg) {
    try {
      window.parent.postMessage(Object.assign({ source: SOURCE, sessionId: sessionId }, msg), "*");
    } catch (err) {
      /* parent gone */
    }
  }

  function nameOf(el) {
    var dn = el.getAttribute("data-name");
    if (dn) return dn;
    var tag = el.tagName.toLowerCase();
    var cls = el.classList && el.classList.length ? el.classList[0] : "";
    if (cls) return tag + "." + cls;
    if (el.id) return tag + "#" + el.id;
    return tag;
  }

  function isBg(el) {
    return !el || el === document.documentElement || el === document.body;
  }

  function elementChildren(el) {
    var out = [];
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (!isBg(c)) out.push(c);
    }
    return out;
  }

  function idOf(el) {
    var existing = idByEl.get(el);
    if (existing) return existing;
    var key = el.getAttribute("data-key");
    var id = key ? "k:" + key : "f" + (++seq).toString(36);
    idByEl.set(el, id);
    elById.set(id, el);
    return id;
  }

  function lookup(id) {
    if (!id) return null;
    if (id.indexOf("k:") === 0) {
      var key = id.slice(2);
      var found = null;
      try {
        found = document.querySelector('[data-key="' + CSS.escape(key) + '"]');
      } catch (e) {
        found = document.querySelector('[data-key="' + key.replace(/"/g, '\\"') + '"]');
      }
      if (found) {
        elById.set(id, found);
        idByEl.set(found, id);
        return found;
      }
      return null;
    }
    var el = elById.get(id);
    if (el && document.contains(el) && !isBg(el)) return el;
    elById.delete(id);
    return null;
  }

  function nodeInfo(el) {
    if (!el || isBg(el)) return null;
    return {
      id: idOf(el),
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      hasChildren: elementChildren(el).length > 0,
      dataKey: el.getAttribute("data-key"),
    };
  }

  function clipsOverflow(value) {
    return value === "auto" || value === "scroll" || value === "hidden" || value === "clip" || value === "overlay";
  }

  function overflowClipOf(el) {
    var r = el.getBoundingClientRect();
    var top = r.top;
    var left = r.left;
    var right = r.right;
    var bottom = r.bottom;
    var node = el.parentElement;
    while (node && node !== document.documentElement) {
      var cs = window.getComputedStyle(node);
      var clipX = clipsOverflow(cs.overflowX);
      var clipY = clipsOverflow(cs.overflowY);
      if (clipX || clipY) {
        var cr = node.getBoundingClientRect();
        var cLeft = cr.left + node.clientLeft;
        var cTop = cr.top + node.clientTop;
        var cRight = cLeft + node.clientWidth;
        var cBottom = cTop + node.clientHeight;
        if (clipX) {
          if (left < cLeft) left = cLeft;
          if (right > cRight) right = cRight;
        }
        if (clipY) {
          if (top < cTop) top = cTop;
          if (bottom > cBottom) bottom = cBottom;
        }
      }
      node = node.parentElement;
    }
    var width = right - left;
    var height = bottom - top;
    if (width < 0) width = 0;
    if (height < 0) height = 0;
    return { top: top, left: left, width: width, height: height };
  }

  function rectOf(el) {
    return overflowClipOf(el);
  }

  function visibleOf(el) {
    var r = overflowClipOf(el);
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    if (r.width < 0.5 || r.height < 0.5) return false;
    return r.top < vh && r.left < vw && r.top + r.height > 0 && r.left + r.width > 0;
  }

  function liveOf(el) {
    var cs = window.getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var sx = window.scrollX || document.documentElement.scrollLeft || 0;
    var sy = window.scrollY || document.documentElement.scrollTop || 0;
    var text = ((el.innerText || el.textContent || "") + "").replace(/\s+/g, " ").trim().slice(0, 120);
    var classes = "";
    if (el.classList && el.classList.length) classes = Array.prototype.join.call(el.classList, " ");
    return {
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      domId: el.id || "",
      classes: classes,
      width: Math.round(r.width),
      height: Math.round(r.height),
      x: Math.round(r.left + sx),
      y: Math.round(r.top + sy),
      text: text,
      color: cs.color,
      background: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      dataKey: el.getAttribute("data-key"),
    };
  }

  function pack(id) {
    var el = lookup(id);
    if (!el) return null;
    var info = nodeInfo(el);
    return {
      id: info.id,
      name: info.name,
      tag: info.tag,
      hasChildren: info.hasChildren,
      dataKey: info.dataKey,
      rect: rectOf(el),
      visible: visibleOf(el),
      live: liveOf(el),
    };
  }

  function pickAt(x, y) {
    var stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (e) {
      var one = document.elementFromPoint(x, y);
      stack = one ? [one] : [];
    }
    for (var i = 0; i < stack.length; i++) {
      if (!isBg(stack[i])) return stack[i];
    }
    return null;
  }

  function overflowCanScroll(el, dx, dy) {
    if (!el) return false;
    var style = el === document.scrollingElement || el === document.documentElement || el === document.body
      ? { overflowX: "auto", overflowY: "auto" }
      : window.getComputedStyle(el);
    var oy = style.overflowY;
    var ox = style.overflowX;
    var yOk = oy === "auto" || oy === "scroll" || oy === "overlay" || el === document.scrollingElement || el === document.documentElement;
    var xOk = ox === "auto" || ox === "scroll" || ox === "overlay" || el === document.scrollingElement || el === document.documentElement;
    if (dy && yOk) {
      var maxY = el.scrollHeight - el.clientHeight;
      if (maxY > 1) {
        if (dy < 0 && el.scrollTop > 0) return true;
        if (dy > 0 && el.scrollTop < maxY - 0.5) return true;
      }
    }
    if (dx && xOk) {
      var maxX = el.scrollWidth - el.clientWidth;
      if (maxX > 1) {
        if (dx < 0 && el.scrollLeft > 0) return true;
        if (dx > 0 && el.scrollLeft < maxX - 0.5) return true;
      }
    }
    return false;
  }

  function scrollAt(x, y, dx, dy) {
    var stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (e) {
      stack = [];
    }
    var seen = [];
    function consider(el) {
      var n = el;
      while (n && n !== document.documentElement) {
        if (seen.indexOf(n) === -1) {
          seen.push(n);
          if (overflowCanScroll(n, dx, dy)) {
            n.scrollBy(dx, dy);
            return true;
          }
        }
        n = n.parentElement;
      }
      return false;
    }
    for (var i = 0; i < stack.length; i++) {
      if (consider(stack[i])) {
        emitRectsSoon();
        return;
      }
    }
    var root = document.scrollingElement || document.documentElement;
    root.scrollBy(dx, dy);
    emitRectsSoon();
  }

  function ancestorsOf(el) {
    var chain = [];
    var n = el.parentElement;
    while (n && !isBg(n)) {
      chain.push(nodeInfo(n));
      n = n.parentElement;
    }
    chain.reverse();
    return chain;
  }

  function getPath(id) {
    var el = lookup(id);
    if (!el) return null;
    var levels = [];
    levels.push({ parentId: null, children: elementChildren(document.body).map(nodeInfo) });
    var chain = [];
    var n = el;
    while (n && !isBg(n)) {
      chain.push(n);
      n = n.parentElement;
    }
    chain.reverse();
    for (var i = 0; i < chain.length; i++) {
      var node = chain[i];
      levels.push({ parentId: idOf(node), children: elementChildren(node).map(nodeInfo) });
    }
    return { node: nodeInfo(el), levels: levels };
  }

  var rectsRaf = 0;
  function emitRects() {
    if (!sessionId) return;
    var hover = hoverId ? pack(hoverId) : null;
    var selected = [];
    for (var i = 0; i < selectedIds.length; i++) {
      var p = pack(selectedIds[i]);
      if (p) selected.push(p);
    }
    send({ type: "rects", hover: hover, selected: selected });
  }

  function emitRectsSoon() {
    if (rectsRaf) return;
    rectsRaf = requestAnimationFrame(function () {
      rectsRaf = 0;
      emitRects();
    });
  }

  function retargetObservers() {
    if (!ro) {
      ro = new ResizeObserver(function () {
        emitRectsSoon();
      });
    }
    try {
      ro.disconnect();
    } catch (e) {}
    function observe(id) {
      var el = lookup(id);
      if (el) {
        try {
          ro.observe(el);
        } catch (e) {}
      }
    }
    if (hoverId) observe(hoverId);
    for (var i = 0; i < selectedIds.length; i++) observe(selectedIds[i]);
  }

  function presence() {
    var present = [];
    var missing = [];
    var ids = selectedIds.slice();
    if (hoverId && ids.indexOf(hoverId) === -1) ids.push(hoverId);
    for (var i = 0; i < ids.length; i++) {
      if (lookup(ids[i])) present.push(ids[i]);
      else missing.push(ids[i]);
    }
    return { present: present, missing: missing };
  }

  function onDomChanged() {
    var p = presence();
    if (p.missing.length) {
      selectedIds = selectedIds.filter(function (id) {
        return p.missing.indexOf(id) === -1;
      });
      if (hoverId && p.missing.indexOf(hoverId) !== -1) hoverId = null;
    }
    retargetObservers();
    emitRects();
    send({ type: "domChanged", present: p.present, missing: p.missing });
  }

  function startMutationObserver() {
    if (mo) return;
    mo = new MutationObserver(function () {
      if (moTimer) clearTimeout(moTimer);
      moTimer = setTimeout(onDomChanged, 60);
    });
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  function handleHost(msg) {
    if (!msg || msg.source !== HOST) return;

    if (msg.type === "hello-ok") {
      sessionId = msg.sessionId;
      if (helloTimer) {
        clearInterval(helloTimer);
        helloTimer = null;
      }
      startMutationObserver();
      emitRects();
      return;
    }

    if (!sessionId || msg.sessionId !== sessionId) return;

    switch (msg.type) {
      case "setMode":
        break;
      case "hitTest": {
        var el = pickAt(msg.x, msg.y);
        var packed = el ? pack(idOf(el)) : null;
        send({ type: "hit", requestId: msg.requestId, node: packed });
        break;
      }
      case "click": {
        var clicked = pickAt(msg.x, msg.y);
        send({
          type: "clickResult",
          requestId: msg.requestId,
          background: !clicked,
          node: clicked ? pack(idOf(clicked)) : null,
          shift: !!msg.shift,
        });
        break;
      }
      case "scroll":
        scrollAt(msg.x, msg.y, msg.dx || 0, msg.dy || 0);
        break;
      case "watch":
        hoverId = msg.hoverId || null;
        selectedIds = Array.isArray(msg.selectedIds) ? msg.selectedIds.slice() : [];
        retargetObservers();
        emitRects();
        break;
      case "getChildren": {
        var parent = msg.parentId ? lookup(msg.parentId) : document.body;
        var nodes = parent ? elementChildren(parent).map(nodeInfo) : [];
        send({ type: "children", requestId: msg.requestId, nodes: nodes });
        break;
      }
      case "getPath": {
        send({ type: "path", requestId: msg.requestId, path: getPath(msg.id) });
        break;
      }
      case "search": {
        var q = (msg.query || "").toLowerCase();
        var hits = [];
        if (q) {
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
          var cur = walker.nextNode();
          while (cur) {
            if (!isBg(cur)) {
              var nm = nameOf(cur);
              if (nm.toLowerCase().indexOf(q) !== -1) {
                hits.push({ node: nodeInfo(cur), ancestors: ancestorsOf(cur) });
              }
            }
            cur = walker.nextNode();
          }
        }
        send({ type: "search", requestId: msg.requestId, hits: hits });
        break;
      }
      case "getLive": {
        var lives = [];
        var ids = Array.isArray(msg.ids) ? msg.ids : [];
        for (var i = 0; i < ids.length; i++) {
          var packedLive = pack(ids[i]);
          if (packedLive) lives.push(packedLive);
        }
        send({ type: "live", requestId: msg.requestId, nodes: lives });
        break;
      }
      case "nav": {
        var from = lookup(msg.id);
        var target = null;
        if (from) {
          if (msg.op === "parent") {
            var p = from.parentElement;
            if (p && !isBg(p)) target = p;
          } else if (msg.op === "firstChild") {
            var kids = elementChildren(from);
            if (kids.length) target = kids[0];
          } else if (msg.op === "nextSibling" || msg.op === "prevSibling") {
            var parentEl = from.parentElement || document.body;
            var sibs = elementChildren(parentEl);
            var idx = sibs.indexOf(from);
            if (idx !== -1 && sibs.length) {
              var nidx =
                msg.op === "nextSibling"
                  ? (idx + 1) % sibs.length
                  : (idx - 1 + sibs.length) % sibs.length;
              target = sibs[nidx];
            }
          }
        }
        send({ type: "navResult", requestId: msg.requestId, node: target ? pack(idOf(target)) : null });
        break;
      }
      case "scrollIntoView": {
        var targetEl = lookup(msg.id);
        if (targetEl && !visibleOf(targetEl)) {
          try {
            targetEl.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          } catch (e) {
            targetEl.scrollIntoView(true);
          }
          emitRects();
        }
        break;
      }
      case "injectError":
        send({ type: "pageError", message: msg.message || "Dev: injected page error" });
        break;
      case "ping":
        send({ type: "pong", requestId: msg.requestId });
        break;
      default:
        break;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    try {
      handleHost(event.data);
    } catch (err) {
      send({
        type: "pageError",
        message: err && err.message ? err.message : String(err),
      });
    }
  });

  window.addEventListener(
    "keydown",
    function (e) {
      if (!sessionId) return;
      var ae = document.activeElement;
      var typing =
        !!ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          ae.isContentEditable);
      send({
        type: "keydown",
        key: e.key,
        shift: e.shiftKey,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        repeat: e.repeat,
        typing: typing,
      });
    },
    true
  );

  window.addEventListener(
    "wheel",
    function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      send({
        type: "zoomWheel",
        deltaY: e.deltaY,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    { passive: false, capture: true }
  );

  window.addEventListener(
    "scroll",
    function () {
      emitRectsSoon();
    },
    true
  );
  document.addEventListener(
    "scroll",
    function () {
      emitRectsSoon();
    },
    true
  );
  if (window.visualViewport) {
    window.visualViewport.addEventListener("scroll", emitRectsSoon);
    window.visualViewport.addEventListener("resize", emitRectsSoon);
  }

  window.addEventListener("resize", function () {
    emitRectsSoon();
  });

  window.addEventListener("error", function (e) {
    send({ type: "pageError", message: e.message || "Page error" });
  });

  window.addEventListener("unhandledrejection", function (e) {
    var reason = e.reason;
    var message = reason && reason.message ? reason.message : String(reason || "Unhandled rejection");
    send({ type: "pageError", message: message });
  });

  function hello() {
    send({ type: "hello", href: location.href });
  }

  hello();
  helloTimer = setInterval(function () {
    if (sessionId) {
      clearInterval(helloTimer);
      helloTimer = null;
      return;
    }
    hello();
  }, 400);
})();
