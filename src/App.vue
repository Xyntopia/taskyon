<template>
  <router-view />
</template>

<script setup lang="ts">
// we are using lang=js here in order to integrate g analytics
import { useRoute } from 'vue-router'
import { generateTaskyonMeta } from './modules/meta'
import { useMeta } from 'quasar'

if (process.env.CLIENT) {
  const route = useRoute()
  useMeta(() => generateTaskyonMeta(route))

  if (process.env.DEV) {
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

    // better logging for dev
    ;(() => {
      const isTop = window === window.top
      const prefix = isTop ? '[TOP]' : '[IFRAME]'
      const style = isTop ? 'color:#2e8b57;font-weight:bold' : 'color:#1e90ff;font-weight:bold'

      type LogMethod = 'log' | 'info' | 'warn' | 'error'
      ;(['log', 'info', 'warn', 'error'] as const).forEach((k) => {
        const orig = console[k] // keep original

        // Prepend "%c[prefix]" + style without a JS wrapper
        console[k] = orig.bind(console, `%c${prefix}`, style) as (typeof console)[LogMethod]
      })
    })()
  }

}

defineOptions({
  name: 'App',
})
</script>
