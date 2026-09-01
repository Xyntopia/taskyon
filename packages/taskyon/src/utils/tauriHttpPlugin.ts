import { isTauri } from '@tauri-apps/api/core'
import { fetch as pluginHttpFetch } from '@tauri-apps/plugin-http'
import { parseHttpUrl, type PoliteHttpPolicy, waitForPoliteHttpTurn } from './politeHttp'

type TauriHttpHeader = [string, string]

function formatInvokeError(error: unknown): string {
  if (error instanceof Error) {
    const causeText =
      typeof error.cause === 'string' ? error.cause : error.cause ? JSON.stringify(error.cause) : ''
    return [error.name, error.message, causeText].filter(Boolean).join(': ')
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isTauriIpcAvailable(): boolean {
  if (!isTauri()) return false
  if (typeof window === 'undefined') return false
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__
  return typeof internals?.invoke === 'function'
}

export function canUseTauriHttpPlugin(): boolean {
  return isTauriIpcAvailable()
}

export async function tauriHttpFetch(
  input: Parameters<typeof pluginHttpFetch>[0],
  init?: Parameters<typeof pluginHttpFetch>[1],
): Promise<Response> {
  if (!canUseTauriHttpPlugin()) {
    throw new Error('Tauri HTTP plugin is not available in this runtime')
  }

  try {
    return await pluginHttpFetch(input, init)
  } catch (error) {
    const url = input instanceof Request ? input.url : String(input)
    throw new Error(`Tauri HTTP fetch failed for ${url}: ${formatInvokeError(error)}`)
  }
}

export async function tauriHttpRequestText(
  url: string,
  opts?: {
    method?: string
    headers?: Record<string, string>
    insecureTls?: boolean
    httpPolicy?: PoliteHttpPolicy
  },
): Promise<{ status: number; statusText: string; headers: TauriHttpHeader[]; body: string }> {
  if (!canUseTauriHttpPlugin()) {
    throw new Error('Tauri HTTP plugin is not available in this runtime')
  }

  const parsedUrl = parseHttpUrl(url)
  await waitForPoliteHttpTurn(parsedUrl, opts?.httpPolicy)
  const response = await tauriHttpFetch(url, {
    method: opts?.method ?? 'GET',
    ...(opts?.headers ? { headers: opts.headers } : {}),
    ...(opts?.insecureTls
      ? {
          danger: {
            acceptInvalidCerts: true,
            acceptInvalidHostnames: false,
          },
        }
      : {}),
  })

  const body = await response.text()
  const headers = Array.from(response.headers.entries())
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  }
}

export async function tauriHttpGetText(
  url: string,
  opts?: {
    insecureTls?: boolean
    httpPolicy?: PoliteHttpPolicy
  },
) {
  return await tauriHttpRequestText(url, opts)
}
