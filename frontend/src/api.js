const API = 'http://localhost:4000';

export async function getScreens({ signal } = {}) {
  const response = await fetch(`${API}/screens`, { signal });
  if (!response.ok) throw new Error(`GET /screens ${response.status}`);

  const screens = await response.json();
  if (!Array.isArray(screens) || screens.some(screen => !screen || typeof screen.id !== 'string'
    || typeof screen.name !== 'string' || typeof screen.url !== 'string')) {
    throw new Error('Malformed /screens body');
  }

  return screens;
}

export async function getElementDetails(key, { signal } = {}) {
  const response = await fetch(`${API}/elements/${encodeURIComponent(key)}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET /elements/${key} ${response.status}`);

  const details = await response.json();
  const fields = ['component', 'description', 'status', 'owner'];
  if (!details || typeof details !== 'object' || Array.isArray(details)
    || fields.some(field => typeof details[field] !== 'string')) {
    throw new Error('Malformed element details body');
  }
  return details;
}