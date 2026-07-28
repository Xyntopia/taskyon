// src/services/http.ts
//
// Unified HTTP helper for all runtimes (SPA, PWA, BEX, Electron, Tauri, etc.).
//
// Plugins and app code should ONLY import and use:
//
//   import { httpRequest } from "src/services/http";
//
// This function automatically:
//   - Uses a proxy when running as a browser client (SPA/PWA/BEX) to bypass CORS.
//   - Uses direct HTTP when running in Electron/Tauri/Node/etc. where CORS is not an issue.
//
// Quasar/Vite will tree‑shake away the unused branch based on process.env.* at build time.
//
// TODO: After wiring this in, build each target (SPA, Electron/Tauri, etc.)
//       and inspect the bundle to confirm that the unused branch & function
//       are actually removed by tree‑shaking / dead‑code elimination.

import type { AxiosRequestConfig, AxiosResponse, Method } from 'axios'
import axios from 'axios'

export type HttpMethod = Method

export interface HttpRequestOptions<TBody = unknown> {
  method: HttpMethod
  url: string // final target URL (3rd-party API, your backend, etc.)
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  body?: TBody
  /**
   * Intended for future E2E-encrypted payloads with cooperating targets.
   * For now the proxy just forwards body as-is; you can hook WebCrypto in later.
   */
  e2eEncrypted?: boolean
  /**
   * Optional metadata for billing / logging on your proxy/backend.
   */
  pluginId?: string
  userId?: string
  proxyBaseUrl?: string
}

export interface HttpResponse<T = unknown> {
  status: number
  headers: Record<string, string>
  data: T
}

// ----------------------
// Shared small helpers
// ----------------------

function buildUrlWithQuery(baseUrl: string, query?: HttpRequestOptions['query']): string {
  if (!query) return baseUrl

  // If baseUrl is absolute, URL will just use it; if not, window.location.origin is required.
  const url = new URL(
    baseUrl,
    baseUrl.startsWith('http') && typeof window === 'undefined'
      ? undefined
      : typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost',
  )

  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined) return
    url.searchParams.append(k, String(v))
  })

  return url.toString()
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  const res: Record<string, string> = {}
  if (!raw) return res

  Object.entries(raw).forEach(([k, v]) => {
    res[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
  })

  return res
}

// --------------------------------------
// Browser SPA/PWA/BEX: go via proxy
// --------------------------------------
// This is used in modes where CORS applies and we must hit our own domain.

async function browserViaProxy<TResp = unknown, TBody = unknown>(
  options: HttpRequestOptions<TBody>,
): Promise<HttpResponse<TResp>> {
  const { method, url, headers = {}, query, body, e2eEncrypted, pluginId, userId } = options

  const proxyBaseUrl =
    options.proxyBaseUrl ??
    (typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_SHARED_HTTP_PROXY_BASE_URL
      : undefined) ??
    '/proxy'
  const proxyUrl = buildUrlWithQuery(proxyBaseUrl, query)

  // This payload shape should match your proxy server's expectations.
  const payload = {
    target: url,
    method,
    headers,
    body,
    e2eEncrypted: !!e2eEncrypted,
    pluginId,
    userId,
  }

  const config: AxiosRequestConfig = {
    method: 'POST',
    url: proxyUrl,
    data: payload,
    headers: {
      'Content-Type': 'application/json',
      // If your proxy requires auth, set it here, e.g.:
      // Authorization: `Bearer ${getAuthToken()}`,
    },
    withCredentials: false,
  }

  const resp: AxiosResponse<TResp> = await axios(config)

  return {
    status: resp.status,
    headers: normalizeHeaders(resp.headers),
    data: resp.data,
  }
}

// ------------------------------------------
// Electron/Tauri/Node: direct HTTP requests
// ------------------------------------------
// Used where we are not constrained by browser CORS.

async function directHttp<TResp = unknown, TBody = unknown>(
  options: HttpRequestOptions<TBody>,
): Promise<HttpResponse<TResp>> {
  const { method, url, headers = {}, query, body } = options

  const fullUrl = buildUrlWithQuery(url, query)

  const config: AxiosRequestConfig = {
    method,
    url: fullUrl,
    headers,
    data: body,
    withCredentials: false,
  }

  const resp: AxiosResponse<TResp> = await axios(config)

  return {
    status: resp.status,
    headers: normalizeHeaders(resp.headers),
    data: resp.data,
  }
}

// ------------------------------------------
// Env-based selection (tree-shakable)
// ------------------------------------------
//
// Quasar injects process.env.MODE, process.env.CLIENT, etc. as compile-time constants.
// The bundler/minifier can evaluate this if/else and drop the dead branch entirely.
//
// Typical mapping:
//   - MODE = "spa" | "pwa" | "bex", CLIENT = true  → browserViaProxy
//   - MODE = "electron" | "tauri" | "capacitor"   → directHttp
//   - SSR builds: you can choose based on SERVER/CLIENT if needed.

let realRequest: <TResp = unknown, TBody = unknown>(
  o: HttpRequestOptions<TBody>,
) => Promise<HttpResponse<TResp>>

// You can adjust these conditions based on which modes you're actually using.
if (
  process.env.CLIENT &&
  (process.env.MODE === 'spa' || process.env.MODE === 'pwa' || process.env.MODE === 'bex')
) {
  // Browser-like frontends → must respect CORS → go via proxy.
  realRequest = browserViaProxy
} else {
  // Everything else (Electron/Tauri/Node/SSR/etc.) → can call directly.
  realRequest = directHttp
}

// ------------------------------------------
// Public API for plugins & app code
// ------------------------------------------

export function tyFetch<TResp = unknown, TBody = unknown>(
  options: HttpRequestOptions<TBody>,
): Promise<HttpResponse<TResp>> {
  return realRequest<TResp, TBody>(options)
}

/*
Example usage from a plugin:

import { httpRequest } from "src/services/http";

export async function fetchUser(userId: string) {
  const resp = await httpRequest<{ name: string }>({
    method: "GET",
    url: `https://api.thirdparty.com/v1/users/${encodeURIComponent(userId)}`,
    query: { locale: "en-US" },
    pluginId: "some-plugin-id",
  });

  if (resp.status !== 200) {
    throw new Error(`Request failed: ${resp.status}`);
  }

  return resp.data;
}
*/
