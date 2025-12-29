<template>
  <router-view />
</template>

<script setup lang="ts">
// we are using lang=js here in order to integrate g analytics
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { generateTaskyonMeta } from './modules/meta'
import { useMeta } from 'quasar'

const route = useRoute()

if (process.env.DEV) {
  // Dynamically inject script src="http://localhost:8098" in DEV mode
  // this can be used to debug for example remote taskyon isntances (e.g. in phone browser)
  console.log('loading vue devtools!')
  onMounted(() => {
    const devScript = document.createElement('script')
    devScript.async = true
    devScript.src = `${window.location.origin}:8098` // Adjust the URL if needed
    document.head.appendChild(devScript)
  })
  ;(() => {
    const isTop = window === window.top
    const prefix = isTop ? '[TOP]' : '[IFRAME]'
    const style = isTop ? 'color:#2e8b57;font-weight:bold' : 'color:#1e90ff;font-weight:bold'

    type LogMethod = 'log' | 'info' | 'warn' | 'error'
    ;(['log', 'info', 'warn', 'error'] as LogMethod[]).forEach((k) => {
      const orig = console[k].bind(console)
      console[k] = ((...args: unknown[]) => {
        orig(`%c${prefix}`, style, ...args)
      }) as (typeof console)[LogMethod]
    })
  })()
}

watch(
  () => route.fullPath,
  () => {
    const meta = generateTaskyonMeta(route)
    useMeta(meta)
  },
  {
    immediate: true,
  },
)

defineOptions({
  name: 'App',
})
</script>
