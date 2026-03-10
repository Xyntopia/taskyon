import { isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

type TauriHttpHeader = [string, string]

function formatInvokeError(error: unknown): string {
  if (error instanceof Error) {
    const causeText =
      typeof error.cause === 'string'
        ? error.cause
        : error.cause
          ? JSON.stringify(error.cause)
          : ''
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

export async function tauriHttpGetText(
  url: string,
  opts?: {
    insecureTls?: boolean
  },
): Promise<{ status: number; statusText: string; headers: TauriHttpHeader[]; body: string }> {
  if (!canUseTauriHttpPlugin()) {
    throw new Error('Tauri HTTP plugin is not available in this runtime')
  }

  let response: Response
  try {
    response = await tauriFetch(url, {
      method: 'GET',
      ...(opts?.insecureTls
        ? {
            danger: {
              acceptInvalidCerts: true,
              acceptInvalidHostnames: false,
            },
          }
        : {}),
    })
  } catch (error) {
    throw new Error(`Tauri HTTP fetch failed for ${url}: ${formatInvokeError(error)}`)
  }

  const body = await response.text()
  const headers = Array.from(response.headers.entries())
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  }
}
