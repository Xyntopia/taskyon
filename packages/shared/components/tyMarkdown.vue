<!--tyMarkdown.vue-->
<!--
 we are disabling the no-v-html warning, because we take a lot of precautions
 against XSS attacks. we only render markdown html locally and only if it doesn't
 contain any html code. If it does, we render it in an iframe.
-->
<!-- eslint-disable vue/no-v-html -->
<!-- eslint-disable no-useless-escape -->
<template>
  <!--TODO: maybe also use "allow-presentation, allow-top-navigation-by-user-activation"
  or also allow="clipboard write"?-->
  <iframe
    v-if="useIframe && renderedHtml.iframe"
    :key="renderedHtml.html.slice(0, 10)"
    ref="iframeRef"
    class="markdown-iframe"
    sandbox="allow-scripts allow-modals allow-downloads allow-forms allow-popups"
    v-bind="$attrs"
  />
  <div
    v-else
    ref="htmlRef"
    v-bind="$attrs"
    class="ty-markdown"
    @click="handleMarkdownClick"
    v-html="renderedHtml.html"
  />
</template>

<script setup lang="ts">
import { getCssVar, useQuasar } from 'quasar'
import { containsHtmlTags, hasMarkdownElements } from '../modules/markdownDetection'
import {
  decodeInlineActionPayload,
  generateIframeSrc,
  initPrismTheme,
  md2Html,
  preprocessMarkdownSource,
  resolveMarkdownExtensions,
  tyMdCssUrls,
  type MarkdownExtension,
} from '../modules/markdownUtils '
import { asyncComputed } from '../modules/vueUtils'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const iframeRef = ref<HTMLIFrameElement | null>(null)
// inside your <script setup>
const emit = defineEmits<{
  (e: 'iframe-ready', el: HTMLIFrameElement): void
  (e: 'ifLongpress', pos: { x: number; y: number }): void
  (e: 'ifClick', pos: { x: number; y: number }): void
  (e: 'inlineAction', data: { action: string; payload: unknown }): void
}>()

const dispatchInlineAction = (action: string, payload: unknown) => {
  const handler = inlineActionHandlers.value[action]
  if (handler) {
    void handler(payload)
    return
  }
  emit('inlineAction', { action, payload })
}

function handleMarkdownClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const inlineAction = target?.closest('[data-inline-action]') as HTMLElement | null
  if (inlineAction) {
    event.preventDefault()
    const action = inlineAction.dataset.inlineAction
    if (!action) return
    dispatchInlineAction(action, decodeInlineActionPayload(inlineAction.dataset.inlinePayload))
    return
  }
  const link = target?.closest('a[href]') as HTMLAnchorElement | null
  if (!link) return
  const href = link.getAttribute('href') || ''
  if (!href) return
  if (href.startsWith('#')) return
  event.preventDefault()
  openMarkdownLink(href)
}

function openMarkdownLink(href: string) {
  if (!href) return
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return

  const isExternal = /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)
  if (!isExternal) {
    const resolved = resolveInternalPath(trimmed)
    if (resolved) {
      void router.push(resolved)
      return
    }
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'linkClick', href: trimmed }, '*')
    return
  }
  window.open(trimmed, '_blank', 'noopener')
}

function resolveInternalPath(href: string) {
  try {
    const base = new URL(route.fullPath, window.location.origin)
    const resolved = new URL(href, base)
    if (resolved.origin !== window.location.origin) return null
    let path = resolved.pathname
    if (path.endsWith('.md')) path = path.slice(0, -3)
    return `${path}${resolved.search}${resolved.hash}`
  } catch {
    return null
  }
}

watch(iframeRef, (el) => {
  if (el) emit('iframe-ready', el)
})

defineOptions({
  inheritAttrs: false,
})

const $q = useQuasar()
initPrismTheme($q.dark.isActive)
const router = useRouter()
const route = useRoute()

const {
  src = undefined,
  useIframe = false,
  extensions = [],
} = defineProps<{
  src?: string
  useIframe?: boolean
  extensions?: MarkdownExtension[]
}>()

const resolvedExtensions = computed(() => resolveMarkdownExtensions(extensions))
const inlineActionHandlers = computed(
  () =>
    Object.assign(
      {},
      ...resolvedExtensions.value.map((extension) => extension.actionHandlers ?? {}),
    ) as Record<string, (payload: unknown) => void | Promise<void>>,
)

const renderedHtml = asyncComputed(
  async () => {
    const raw = src ?? ''
    const prepared = await preprocessMarkdownSource(raw, extensions)
    if (!useIframe) {
      // No iframe: render as markdown with HTML disabled (extra safety)
      return {
        html: await md2Html(
          prepared.src,
          $q.dark.isActive,
          prepared.allowHtml,
          resolvedExtensions.value,
        ),
        iframe: false,
      }
    }
    const hasHtmlTags = prepared.allowHtml || containsHtmlTags(prepared.src)
    if (!hasHtmlTags)
      return {
        html: await md2Html(prepared.src, $q.dark.isActive, false, resolvedExtensions.value),
        iframe: false,
      }
    const hasMdElements = hasMarkdownElements(prepared.src)
    const isPureHtml = hasHtmlTags && !hasMdElements // 1) has real HTML (outside code)
    // useIframe = true:
    // pure HTML => don't run through markdown-it, just show raw HTML in iframe
    if (isPureHtml) return { html: prepared.src, iframe: true }

    // possibly with HTML outside code => markdown-it with html enabled
    return {
      html: await md2Html(prepared.src, $q.dark.isActive, true, resolvedExtensions.value),
      iframe: true,
    }
  },
  { html: 'rendering ...', iframe: false },
)

// Only produce iFrame HTML once real content is ready
const buildIframeHtml = (renderedHtmlString: string) => {
  const parentStyle = window.getComputedStyle(document.body)
  const fontFamily = parentStyle.fontFamily || 'Roboto, sans-serif'
  const fontSize = parentStyle.fontSize || '16px'
  // For dark mode, override parent's color to white.
  const textColor = $q.dark.isActive ? 'white' : parentStyle.color || 'inherit'

  const inlineStyle = `<style>body
  {
    font-family: ${fontFamily};
    color: ${textColor};
    font-size: ${fontSize};
  }</style>`

  const linkTags = ($q.dark.isActive ? tyMdCssUrls.dark : tyMdCssUrls.light)
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n')

  return generateIframeSrc(
    renderedHtmlString,
    `${linkTags}${inlineStyle}`,
    getCssVar('primary') ?? '#000000',
    getCssVar('secondary') ?? '#00ffff',
    'ty-markdown',
  )
}

watch(
  renderedHtml,
  async (renderResult) => {
    if (renderResult.iframe && iframeRef.value && useIframe) {
      await nextTick()
      const iframeSrc = buildIframeHtml(renderResult.html)
      iframeRef.value.srcdoc = iframeSrc
    }
  },
  { flush: 'post' },
)

interface ResizeIframeMessage {
  type: 'resizeIframe'
  width: number
  height: number
}

let resizeTimeout: ReturnType<typeof setTimeout> | null = null
let pendingResize: { width: number; height: number } | null = null
const lastWidth: number | null = null
let lastHeight: number | null = null
let resizeCount = 0
const MAX_RESIZE_ATTEMPTS = 10

function handleResize(data: ResizeIframeMessage) {
  pendingResize = {
    width: data.width,
    height: data.height,
  }

  if (resizeTimeout) clearTimeout(resizeTimeout)
  resizeTimeout = setTimeout(() => {
    if (!iframeRef.value || !pendingResize) return

    const { width: newWidth, height: newHeight } = pendingResize

    // Only update if width/height changed significantly
    const widthChanged = lastWidth === null || Math.abs(newWidth - lastWidth) > 1
    const heightChanged = lastHeight === null || Math.abs(newHeight - lastHeight) > 1

    if (widthChanged || heightChanged) {
      resizeCount++
      if (resizeCount > MAX_RESIZE_ATTEMPTS) {
        // Do one last resize: only update height, not width
        if (heightChanged) {
          iframeRef.value.style.height = `${newHeight}px`
          lastHeight = newHeight
        }
        console.warn(
          '[iframe] Resize loop detected, switching to height-only resizing to avoid scrollbars.',
        )
        pendingResize = null
        return
      }

      /*if (widthChanged) {
        iframeRef.value.style.width = `${newWidth}px`
        lastWidth = newWidth
      }*/
      if (heightChanged) {
        iframeRef.value.style.height = `${newHeight}px`
        lastHeight = newHeight
      }
    } else {
      // Reset counter if no significant change
      resizeCount = 0
    }

    pendingResize = null
  }, 100)
}

function handleMessage(event: MessageEvent) {
  if (!iframeRef.value || event.source !== iframeRef.value.contentWindow) return

  if (event.data?.type === 'resizeIframe') handleResize(event.data as ResizeIframeMessage)

  if (event.data?.type === 'longpress') {
    emit('ifLongpress', { x: event.data.x, y: event.data.y })
  }

  if (event.data?.type === 'iframeClick') {
    emit('ifClick', { x: event.data.x, y: event.data.y })
  }

  if (event.data?.type === 'linkClick') {
    const href = String(event.data?.href || '')
    if (href) openMarkdownLink(href)
  }

  if (event.data?.type === 'inlineAction') {
    const action = String(event.data?.action || '')
    if (!action) return
    dispatchInlineAction(action, decodeInlineActionPayload(event.data?.payload))
  }
}

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
})

onMounted(() => {
  window.addEventListener('message', handleMessage)
})
</script>

<style scoped lang="sass">
iframe.markdown-iframe
  display: block // so it behaves like a block-level box
  max-width: 100% // never exceed parent’s width, but allow smaller
  border: none
  min-width: 100px
  width: 100%
  min-height: 20px

.ty-markdown
  align-self: auto
</style>
