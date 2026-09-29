'use client';

import { DEFAULT_TENANT } from './config';

/**
 * The single HTTP client.
 *
 * The access token lives in memory only — never in localStorage, where any XSS could
 * read it. It is refreshed from the HttpOnly cookie on page load and when a request
 * comes back 401, which also means a reload does not log the user out.
 */
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: { field: string; message: string }[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Send an Idempotency-Key. Always do this for POS writes. */
  idempotencyKey?: string;
  /** Skip the automatic refresh-and-retry (used by the refresh call itself). */
  noRetry?: boolean;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function refresh(): Promise<boolean> {
  // Collapse concurrent refreshes: a dashboard mounting six queries at once must not
  // fire six token rotations, which reuse-detection would treat as theft.
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': DEFAULT_TENANT },
        body: '{}',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) return false;
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see the result.
      setTimeout(() => (refreshPromise = null), 0);
    }
  })();
  return refreshPromise;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, noRetry, ...rest } = opts;

  const headers = new Headers(rest.headers);
  headers.set('X-Tenant', DEFAULT_TENANT);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  const res = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && !noRetry) {
    if (await refresh()) return api<T>(path, { ...opts, noRetry: true });
  }

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (payload?.['message'] as string) ?? `Request failed (${res.status})`,
      payload?.['errors'] as { field: string; message: string }[] | undefined,
      payload?.['requestId'] as string | undefined,
    );
  }

  return payload as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body, idempotencyKey });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });

/** Called once on load: turns the refresh cookie into an in-memory access token. */
export async function bootstrapSession(): Promise<boolean> {
  return refresh();
}
