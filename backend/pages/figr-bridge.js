(() => {
  const CHANNEL = 'figr-board';
  const origin = document.referrer ? new URL(document.referrer).origin : '*';
  const cache = new Map();
  let session = null;
  let mode = 'select';
  let selected = [];
  let hovered = null;
  let mutateQueued = false;
  let geoQueued = false;
  let lastBoxes = '';

  const send = (type, data = {}) => parent.postMessage({ channel: CHANNEL, type, session, ...data }, origin);
  const skipNode = node => !node || node === document.documentElement || node === document.body
    || node.tagName === 'SCRIPT' || node.tagName === 'STYLE';
  const kids = node => [...node.children].filter(child => child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE');
  const textOf = node => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const nameOf = node => node.getAttribute('data-name')
    || `${node.tagName.toLowerCase()}${node.classList.length ? `.${node.classList[0]}` : node.id ? `#${node.id}` : ''}`;
  const mark = node => JSON.stringify({
    tag: node.tagName.toLowerCase(),
    id: node.id || '',
    key: node.getAttribute('data-key') || '',
    name: node.getAttribute('data-name') || '',
    classes: [...node.classList].sort(),
  });

  const pathOf = node => {
    const parts = [];
    for (let current = node; current && current !== document.body; current = current.parentElement) {
      const value = mark(current);
      const tagged = current.parentElement
        ? [...current.parentElement.children].filter(child => child.tagName === current.tagName)
        : [current];
      const twins = tagged.filter(child => mark(child) === value);
      parts.unshift({ ...JSON.parse(value), occurrence: twins.indexOf(current), matchingCount: twins.length });
    }
    return JSON.stringify(parts);
  };

  const refOf = node => {
    const key = node.getAttribute('data-key');
    if (key) return `key:${key}`;
    if (node.id) return `id:${node.id}`;
    return `path:${pathOf(node)}`;
  };

  const resolve = ref => {
    const cached = cache.get(ref);
    if (cached?.isConnected) return cached;
    if (ref.startsWith('key:')) {
      const key = ref.slice(4);
      return [...document.querySelectorAll('[data-key]')].find(node => node.getAttribute('data-key') === key) || null;
    }
    if (ref.startsWith('id:')) return document.getElementById(ref.slice(3));
    if (!ref.startsWith('path:')) return null;
    try {
      let nodes = [document.body];
      for (const part of JSON.parse(ref.slice(5))) {
        const next = [];
        for (const parentNode of nodes) {
          const tagged = [...parentNode.children].filter(child => child.tagName.toLowerCase() === part.tag);
          const twins = tagged.filter(child => mark(child) === JSON.stringify({
            tag: part.tag, id: part.id, key: part.key, name: part.name, classes: part.classes,
          }));
          if (twins.length !== part.matchingCount) continue;
          if (twins[part.occurrence]) next.push(twins[part.occurrence]);
        }
        nodes = next;
        if (!nodes.length) return null;
      }
      return nodes.length === 1 ? nodes[0] : null;
    } catch {
      return null;
    }
  };

  const describe = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const ref = refOf(node);
    cache.set(ref, node);
    return {
      ref,
      name: nameOf(node),
      tag: node.tagName.toLowerCase(),
      id: node.id,
      classes: [...node.classList],
      hasChildren: kids(node).length > 0,
      parentRef: node.parentElement && node.parentElement !== document.body ? refOf(node.parentElement) : null,
      dataKey: node.getAttribute('data-key') || null,
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      live: {
        text: textOf(node),
        color: style.color,
        background: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        pageX: Math.round(rect.left + scrollX),
        pageY: Math.round(rect.top + scrollY),
      },
    };
  };

  const nodeAt = (x, y) => document.elementsFromPoint(x, y).find(node => !skipNode(node)) || null;
  const visible = node => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  };
  const boxes = () => JSON.stringify({
    hovered,
    selected: selected.map(ref => {
      const node = resolve(ref);
      const box = node?.getBoundingClientRect();
      return box ? [ref, Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : [ref];
    }),
  });
  const sendBoxes = () => {
    const next = boxes();
    if (next === lastBoxes) return;
    lastBoxes = next;
    send('geometry', {
      hovered: hovered && resolve(hovered) ? describe(resolve(hovered)) : null,
      selected: selected.map(resolve).filter(Boolean).map(describe),
    });
  };
  const queueBoxes = () => {
    if (geoQueued) return;
    geoQueued = true;
    requestAnimationFrame(() => {
      geoQueued = false;
      sendBoxes();
    });
  };

  const ancestorsOf = node => {
    const list = [];
    for (let parentNode = node?.parentElement; parentNode && parentNode !== document.body; parentNode = parentNode.parentElement) {
      list.unshift(describe(parentNode));
    }
    return list;
  };

  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== CHANNEL) return;
    const message = event.data;
    if (message.type === 'init') {
      session = message.session;
      mode = message.mode || 'select';
      selected = message.selected || [];
      send('ready', { title: document.title, url: location.href });
      sendBoxes();
    } else if (message.type === 'mode') {
      mode = message.mode;
      queueBoxes();
    } else if (message.type === 'selection') {
      selected = message.refs || [];
      const target = message.scrollTo && resolve(message.scrollTo);
      if (target && !visible(target)) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      sendBoxes();
    } else if (message.type === 'children') {
      const parentNode = message.ref ? resolve(message.ref) : document.body;
      send('children', { requestId: message.requestId, nodes: parentNode ? kids(parentNode).map(describe) : [] });
    } else if (message.type === 'ancestors') {
      send('ancestors', { requestId: message.requestId, ancestors: ancestorsOf(resolve(message.ref)) });
    } else if (message.type === 'hover-ref') {
      hovered = message.ref || null;
      sendBoxes();
    } else if (message.type === 'navigate-element') {
      const node = resolve(message.ref);
      if (!node) return;
      const siblings = node.parentElement ? kids(node.parentElement) : [];
      const index = siblings.indexOf(node);
      let next = null;
      if (message.action === 'first-child') next = kids(node)[0] || null;
      if (message.action === 'parent') next = node.parentElement !== document.body ? node.parentElement : null;
      if (message.action === 'next-sibling' && siblings.length) next = siblings[(index + 1) % siblings.length];
      if (message.action === 'previous-sibling' && siblings.length) next = siblings[(index - 1 + siblings.length) % siblings.length];
      if (next) send('keyboard-select', { item: describe(next) });
    }
  });

  addEventListener('pointermove', event => {
    if (mode !== 'select') return;
    const node = nodeAt(event.clientX, event.clientY);
    const next = node ? refOf(node) : null;
    if (next === hovered) return;
    hovered = next;
    if (node) cache.set(next, node);
    send('hover', { item: node ? describe(node) : null, ancestors: ancestorsOf(node) });
  }, true);

  addEventListener('pointerout', event => {
    if (event.relatedTarget || mode !== 'select' || !hovered) return;
    hovered = null;
    send('hover', { item: null });
  }, true);

  addEventListener('pointerdown', event => {
    if (mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const node = nodeAt(event.clientX, event.clientY);
    if (node) send('select', { item: describe(node), shift: event.shiftKey });
    else send('background');
  }, true);

  addEventListener('click', event => {
    if (mode !== 'select') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  addEventListener('submit', event => {
    if (mode !== 'select') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    send('zoom', { deltaY: event.deltaY, x: event.clientX, y: event.clientY });
  }, { capture: true, passive: false });

  addEventListener('keydown', event => {
    const keys = ['v', 'V', 'i', 'I', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    const typing = event.target.matches?.('input,textarea,select,[contenteditable="true"]');
    if (typing && ['v', 'V', 'i', 'I'].includes(event.key)) return;
    if (mode === 'interact' && !['v', 'V', 'i', 'I', 'Escape'].includes(event.key)) return;
    send('shortcut', { key: event.key, shift: event.shiftKey });
    if (mode === 'select' || ['v', 'V', 'i', 'I', 'Escape'].includes(event.key)) event.preventDefault();
  }, true);

  addEventListener('scroll', queueBoxes, true);
  addEventListener('resize', queueBoxes);
  addEventListener('error', event => send('page-error', { message: event.message || 'Page error' }));
  addEventListener('unhandledrejection', event => send('page-error', { message: String(event.reason?.message || event.reason || 'Unhandled rejection') }));

  new MutationObserver(records => {
    const structureChanged = records.some(record => record.type === 'childList');
    if (!structureChanged) {
      if (selected.length || hovered) queueBoxes();
      return;
    }
    if (mutateQueued) return;
    mutateQueued = true;
    requestAnimationFrame(() => {
      mutateQueued = false;
      for (const [ref, node] of cache) if (!node.isConnected) cache.delete(ref);
      const previous = selected;
      selected = selected.filter(ref => resolve(ref));
      if (hovered && !resolve(hovered)) hovered = null;
      send('changed', { selected, removed: previous.filter(ref => !selected.includes(ref)) });
      sendBoxes();
    });
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'id', 'style', 'data-key', 'data-name'],
  });

  send('ready', { title: document.title, url: location.href });
})();
