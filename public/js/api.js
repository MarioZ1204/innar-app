// public/js/api.js
// Cliente HTTP centralizado. Inyecta CSRF, cookies y maneja errores comunes.

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Hace una petición a /api/... con cookies + CSRF + JSON automático.
 * @returns Promise<{ ok, status, data, error }>
 */
export async function apiFetch(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = new Headers(opts.headers || {});
  if (!headers.has('Content-Type') && (opts.body !== undefined) && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  const init = {
    method,
    headers,
    credentials: 'include',
    body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)
      ? JSON.stringify(opts.body)
      : opts.body
  };
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    return { ok: false, status: 0, data: null, error: 'Sin conexión al servidor' };
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.status === 401) {
    document.dispatchEvent(new CustomEvent('app:no-autenticado'));
  }
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: !res.ok && data?.error ? data.error : null
  };
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body }),
  del: (path) => apiFetch(path, { method: 'DELETE' })
};
