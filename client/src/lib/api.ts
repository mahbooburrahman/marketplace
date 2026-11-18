export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}

function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)mk_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let csrfReady: Promise<unknown> | null = null;
/** The server issues the CSRF cookie on any request; make sure we have it before the first write. */
async function ensureCsrf() {
  if (csrfToken()) return;
  csrfReady ??= fetch('/api/settings', { credentials: 'same-origin' });
  await csrfReady;
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    await ensureCsrf();
    headers['X-CSRF-Token'] = csrfToken();
  }
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.', 'network');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.message ?? `Request failed (${res.status})`, err.code, err.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, signal),
  post: <T = any>(url: string, body?: Body) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: Body) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: Body) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string, body?: Body) => request<T>('DELETE', url, body),
};

export function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
