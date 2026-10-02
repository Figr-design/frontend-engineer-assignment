const iframes = new Map();
const pending = new Map();
let nextId = 1;

export function registerIframe(screenId, iframe) {
  iframes.set(screenId, iframe);
}

export function unregisterIframe(screenId) {
  iframes.delete(screenId);
  cancelScreen(screenId);
}

export function iframeFor(screenId) {
  return iframes.get(screenId) || null;
}

export function screenIdForSource(source) {
  for (const [id, iframe] of iframes) {
    if (iframe.contentWindow === source) return id;
  }
  return null;
}

export function send(screenId, message) {
  const win = iframes.get(screenId)?.contentWindow;
  if (!win) return false;
  win.postMessage({ source: "figr-host", ...message }, "*");
  return true;
}

export function request(screenId, type, payload = {}, timeoutMs = 3000) {
  const requestId = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      const error = new Error("The preview did not answer in time");
      error.code = "TIMEOUT";
      reject(error);
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer, screenId, type });
    if (!send(screenId, { type, requestId, ...payload })) {
      clearTimeout(timer);
      pending.delete(requestId);
      const error = new Error("Preview is gone");
      error.code = "GONE";
      reject(error);
    }
  });
}

export function settleResult(requestId, data) {
  const job = pending.get(requestId);
  if (!job) return false;
  clearTimeout(job.timer);
  pending.delete(requestId);
  if (data.ok) job.resolve(data.payload);
  else {
    const error = new Error(data.error || "Preview failed");
    error.code = "BRIDGE";
    job.reject(error);
  }
  return true;
}

export function cancelScreen(screenId) {
  for (const [requestId, job] of pending) {
    if (job.screenId !== screenId) continue;
    clearTimeout(job.timer);
    pending.delete(requestId);
    const error = new Error("cancelled");
    error.code = "CANCELLED";
    job.reject(error);
  }
}

export function broadcast(message) {
  for (const screenId of iframes.keys()) send(screenId, message);
}

export function localPoint(event, el) {
  const rect = el.getBoundingClientRect();
  const width = el.offsetWidth || rect.width || 1;
  const height = el.offsetHeight || rect.height || 1;
  return {
    x: ((event.clientX - rect.left) * width) / (rect.width || 1),
    y: ((event.clientY - rect.top) * height) / (rect.height || 1),
  };
}

export function wheelPixels(event) {
  let dx = event.deltaX;
  let dy = event.deltaY;
  if (event.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } else if (event.deltaMode === 2) {
    dx *= window.innerHeight;
    dy *= window.innerHeight;
  }
  return { dx, dy };
}
