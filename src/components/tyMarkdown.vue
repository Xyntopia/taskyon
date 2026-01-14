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
    v-if="useIframe && iframeHtml"
    :key="iframeHtml"
    ref="iframeRef"
    class="markdown-iframe"
    sandbox="allow-scripts allow-modals allow-downloads allow-forms allow-popups"
    v-bind="$attrs"
  />
  <div v-else v-bind="$attrs" class="ty-markdown" v-html="renderedHtml" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import {
  containsHtmlTags,
  generateIframeSrc,
  initPrismTheme,
  md2Html,
  tyMdCssUrls,
} from '../modules/markdownUtils '
import { getCssVar, useQuasar } from 'quasar'
import { ref } from 'vue'
import { asyncComputed } from 'src/modules/vueUtils'

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const iframeRef = ref<HTMLIFrameElement | null>(null)

// inside your <script setup>
const emit = defineEmits<{
  (e: 'iframe-ready', el: HTMLIFrameElement): void
  (e: 'ifLongpress', pos: { x: number; y: number }): void
  (e: 'ifClick', pos: { x: number; y: number }): void
}>()

watch(iframeRef, (el) => {
  if (el) emit('iframe-ready', el)
})

defineOptions({
  inheritAttrs: false,
})

const $q = useQuasar()
initPrismTheme($q.dark.isActive)

const { src = undefined, useIframe = false } = defineProps<{
  src?: string
  useIframe?: boolean
}>()

const renderedHtml = asyncComputed(async () => {
  const raw = src ?? ''
  const isPureHtml =
    containsHtmlTags(raw) && // 1) has real HTML (outside code)
    ![
      /(^|\n)\s*#{1,6}\s/, // headings: #, ##, ...
      /(^|\n)\s*>\s/, // blockquotes: >
      /(^|\n)\s*[-+*]\s/, // unordered lists
      /(^|\n)\s*\d+\.\s/, // ordered lists
      /\*\*(.*?)\*\*/, // bold: **bold**
      /_(.*?)_/, // italic: _italic_
      /`{1,3}[^`]+`{1,3}/, // inline or fenced code: `code`, ```block```
      /(?<!\\)\$\$[^$]+\$\$/, // mathjax: $$block$$
      /(?<!\\)\$[^$\n]+\$/, // mathjax: $inline$
      /!\[.*?\]\(.*?\)/, // image
      /\[.*?\]\(.*?\)/, // link
      /(^|\n)\s*---+/, // horizontal rule
      /(^|\n)\s*:::/, // custom containers (like :::note)
    ].some((pattern) => pattern.test(raw))

  if (!useIframe) {
    // No iframe: render as markdown with HTML disabled (extra safety)
    return await md2Html(raw, $q.dark.isActive, false)
  }

  // useIframe = true:
  // case 1: pure HTML => don't run through markdown-it, just show raw HTML in iframe
  if (isPureHtml) return raw

  // case 2 & 3: markdown, possibly with HTML outside code => markdown-it with html enabled
  return await md2Html(raw, $q.dark.isActive, true)
}, 'rendering ...')

// Only produce iFrame HTML once real content is ready
const iframeHtml = computed<string | undefined>(() => {
  if (!useIframe || !containsHtmlTags(src ?? '')) return undefined
  if (renderedHtml.value === 'rendering ...') return undefined

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
    renderedHtml.value,
    `${linkTags}${inlineStyle}`,
    getCssVar('primary') ?? '#000000',
    getCssVar('secondary') ?? '#00ffff',
    'ty-markdown',
  )
})

watch(
  iframeHtml,
  async (html) => {
    if (html && iframeRef.value) {
      await nextTick()
      iframeRef.value.srcdoc = html
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
