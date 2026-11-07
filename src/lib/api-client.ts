"use client";
/** Browser → API helper. All mutations are JSON + same-origin (the server checks Origin). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function apiFetch<T = unknown>(path: string, opts: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    // A request the caller cancelled is not a failure to report.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // The browser's own wording ("Failed to fetch", "Load failed") means nothing at a counter.
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check the internet connection and try again.", null);
  }
  let json: { ok?: boolean; data?: T; error?: { code: string; message: string; details: Record<string, unknown> | null } } = {};
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok || json.ok === false) {
    const err = json.error ?? { code: "INTERNAL", message: `Request failed (${res.status})`, details: null };
    // Session ended / password change required: full navigation so no stale client state remains.
    /* eslint-disable @next/next/no-location-assign-relative-destination */
    if (res.status === 401 && typeof window !== "undefined") {
      if (path.startsWith("/api/shop/")) {
        // A website customer: a wrong password is just an error on the form; an ended session goes back to the
        // customer sign-in (never to the staff login).
        if (!path.startsWith("/api/shop/auth/")) window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      } else if (!path.startsWith("/api/auth/login") && !path.startsWith("/api/public")) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    if (err.details?.mustChangePassword && typeof window !== "undefined") {
      window.location.href = "/account/password?required=1";
    }
    /* eslint-enable @next/next/no-location-assign-relative-destination */
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return json.data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
