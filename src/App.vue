<template>
  <router-view />
</template>

<script setup lang="ts">
// we are using lang=js here in order to integrate g analytics
import { useRoute } from 'vue-router'
import { generateTaskyonMeta } from './modules/meta'
import { useMeta } from 'quasar'
import { enableTauriStdoutBridge } from './modules/tauriStdoutBridge'

type LogMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
type TaskyonLogsSource = 'url' | 'storage' | 'none'
type TaskyonLogsApi = {
  enable: (group: string) => ReturnType<TaskyonLogsApi['list']>
  disable: (group: string) => ReturnType<TaskyonLogsApi['list']>
  set: (csv: string) => ReturnType<TaskyonLogsApi['list']>
  list: () => {
    source: TaskyonLogsSource
    enabled: string[]
    wildcard: boolean
    storageKey: string
    urlParam: string
    filteringActive: boolean
  }
  clear: () => ReturnType<TaskyonLogsApi['list']>
}

declare global {
  interface Window {
    __taskyonLogs?: TaskyonLogsApi
    __taskyonConsolePatch?: {
      originals: Record<LogMethod, (...args: unknown[]) => void>
    }
  }
}

if (process.env.CLIENT) {
  const route = useRoute()
  useMeta(() => generateTaskyonMeta(route))

  if (process.env.DEV) {
    const params = new URLSearchParams(window.location.search)
    const enableChii =
      params.get('chii') === '1' || window.localStorage.getItem('taskyon.enableChii') === '1'

    if (!enableChii) {
      console.log('Skipping chii/eruda devtools. Enable with ?chii=1 or localStorage taskyon.enableChii=1')
    } else {
    const CHII_PORT = 8090 // or 8090, but must match how you run `chii`

    console.warn(
      `Loading chii devtools. Make sure "chii -P ${CHII_PORT}" is running on your dev machine.`,
    )

    const devScript = document.createElement('script')

    const host = window.location.hostname
    const protocol = 'https' // "http" or "https", depending on your setup

    // This matches the official snippet from chii:
    // "<script src="//host-machine-ip:8080/target.js" ...
    devScript.src = `${protocol}://${host}:${CHII_PORT}/target.js`
    devScript.async = true

    devScript.onload = () => console.log('Chii devtools script loaded successfully')
    devScript.onerror = () => console.error('Failed to load chii devtools script')

      document.head.appendChild(devScript)

    // ---- Eruda dev console (only if NOT on localhost) ----
      const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host)

      if (!isLocalhost) {
        const erudaScript = document.createElement('script')
        erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda'
        erudaScript.async = true

        erudaScript.onload = () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const eruda = (window as any).eruda
            if (eruda && typeof eruda.init === 'function') {
              eruda.init()
              console.log('Eruda dev console initialized')
            } else {
              console.error('Eruda loaded but not available on window.eruda')
            }
          } catch (e) {
            console.error('Error while initializing Eruda', e)
          }
        }

        erudaScript.onerror = () => {
          console.error('Failed to load Eruda dev console script')
        }

        document.head.appendChild(erudaScript)
      } else {
        console.log('Skipping Eruda: running on localhost')
      }
    }

    // better logging for dev
    ;(() => {
      const LOG_STORAGE_KEY = 'debugLogs'
      const LOG_QUERY_PARAM = 'logs'
      const TAG_RE = /^\s*\[([^\]]+)\]\s*/
      const methods = ['log', 'info', 'warn', 'error', 'debug'] as const

      const isTop = window === window.top
      const frameLabel =
        new URLSearchParams(window.location.search).get('taskyonFrameLabel')?.trim() || ''
      const prefix = isTop
        ? '[TOP]'
        : frameLabel
          ? `[IFRAME ${frameLabel}]`
          : '[IFRAME]'
      const style = isTop ? 'color:#2e8b57;font-weight:bold' : 'color:#1e90ff;font-weight:bold'
      const normalizeGroup = (value: string) => value.trim().toLowerCase()

      const parseGroups = (value: string | null | undefined) => {
        const groups = new Set<string>()
        if (!value) return groups

        value
          .split(',')
          .map((token) => normalizeGroup(token))
          .filter((token) => token.length > 0)
          .forEach((token) => groups.add(token))

        return groups
      }

      let enabledGroups = new Set<string>()
      let wildcardEnabled = false
      let source: TaskyonLogsSource = 'none'

      const refreshFilters = () => {
        const urlValue = new URLSearchParams(window.location.search).get(LOG_QUERY_PARAM)?.trim()
        const storageValue = window.localStorage.getItem(LOG_STORAGE_KEY)?.trim()
        const isUrlActive = Boolean(urlValue)

        source = isUrlActive ? 'url' : storageValue ? 'storage' : 'none'
        enabledGroups = parseGroups(isUrlActive ? urlValue : storageValue)
        wildcardEnabled = enabledGroups.has('*')
      }

      const persistGroups = (groups: Set<string>) => {
        const serialized = [...groups].sort().join(',')
        if (serialized.length === 0) window.localStorage.removeItem(LOG_STORAGE_KEY)
        else window.localStorage.setItem(LOG_STORAGE_KEY, serialized)
      }

      const currentState = () => ({
        source,
        enabled: [...enabledGroups].sort(),
        wildcard: wildcardEnabled,
        storageKey: LOG_STORAGE_KEY,
        urlParam: LOG_QUERY_PARAM,
        filteringActive: source !== 'none' && enabledGroups.size > 0,
      })

      refreshFilters()

      const consolePatch =
        window.__taskyonConsolePatch ??
        ({
          originals: methods.reduce(
            (acc, method) => {
              acc[method] = console[method].bind(console)
              return acc
            },
            {} as Record<LogMethod, (...args: unknown[]) => void>,
          ),
        } satisfies Window['__taskyonConsolePatch'])

      window.__taskyonConsolePatch = consolePatch
      const { originals } = consolePatch

      const applyConsolePatch = () => {
        const filteringActive = source !== 'none' && enabledGroups.size > 0

        methods.forEach((method) => {
          if (!filteringActive) {
            // Preserve native callsite behavior when no tag filtering is active.
            console[method] = originals[method].bind(console, `%c${prefix}`, style) as (typeof console)[LogMethod]
            return
          }

          console[method] = ((...args: unknown[]) => {
            if (typeof args[0] === 'string') {
              const match = args[0].match(TAG_RE)
              if (match) {
                const group = normalizeGroup(match[1] ?? '')
                const canLog = wildcardEnabled || enabledGroups.has(group)
                if (!canLog) return
              }
            }

            originals[method](`%c${prefix}`, style, ...args)
          }) as (typeof console)[LogMethod]
        })
      }

      applyConsolePatch()

      window.__taskyonLogs = {
        enable(group: string) {
          const normalized = normalizeGroup(group)
          if (!normalized) return currentState()
          const next = new Set(enabledGroups)
          next.add(normalized)
          persistGroups(next)
          refreshFilters()
          applyConsolePatch()
          return currentState()
        },
        disable(group: string) {
          const normalized = normalizeGroup(group)
          if (!normalized) return currentState()
          const next = new Set(enabledGroups)
          next.delete(normalized)
          persistGroups(next)
          refreshFilters()
          applyConsolePatch()
          return currentState()
        },
        set(csv: string) {
          persistGroups(parseGroups(csv))
          refreshFilters()
          applyConsolePatch()
          return currentState()
        },
        list() {
          return currentState()
        },
        clear() {
          window.localStorage.removeItem(LOG_STORAGE_KEY)
          refreshFilters()
          applyConsolePatch()
          return currentState()
        },
      }
    })()
  }

  // Conditionally bridge console.* to Rust stdout in Tauri (headless or ?stdout=1).
  void enableTauriStdoutBridge()
}

defineOptions({
  name: 'App',
})
</script>
