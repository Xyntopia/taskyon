<!-- eslint-disable no-useless-escape -->
<template>
  <iframe
    v-if="useIframe && iframeHtml"
    class="markdown-iframe"
    ref="iframeRef"
    sandbox="allow-scripts allow-modals allow-downloads allow-forms allow-popups"
    :srcdoc="`<div class=tyMarkdown>${iframeHtml}<div>`"
    v-bind="$attrs"
  />
  <div v-else v-html="renderedHtml" v-bind="$attrs" class="tyMarkdown" />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import {
  containsHtmlTags,
  generateIframeSrc,
  initPrismTheme,
  md2Html,
  tyMdCssUrls,
} from '../modules/markdownUtils '
import { getCssVar, useQuasar } from 'quasar'
import { ref } from 'vue'

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const iframeRef = ref<HTMLIFrameElement | null>(null)

defineOptions({
  inheritAttrs: false,
})

const $q = useQuasar()
initPrismTheme($q.dark.isActive)

const { src, useIframe = false } = defineProps<{
  src?: string
  useIframe?: boolean
}>()

const renderedHtml = computed(() => {
  const raw = src ?? ''
  const isPureHtml =
    containsHtmlTags(raw) &&
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

  return isPureHtml ? raw : md2Html(raw, $q.dark.isActive)
})

const iframeHtml = computed(() => {
  // check if we realy need to use an iframe...
  // this is only necessary, if we render html & scripts
  if (!useIframe || !containsHtmlTags(src ?? '')) return ''

  // Detect parent's computed style from document.body.
  // (Alternatively, you could target a more specific element if needed.)
  const parentStyle = window.getComputedStyle(document.body)
  const fontFamily = parentStyle.fontFamily || 'Roboto, sans-serif'
  // For dark mode, override parent's color to white.
  const textColor = $q.dark.isActive ? 'white' : parentStyle.color || 'inherit'

  const inlineStyle = `<style>body { font-family: ${fontFamily}; color: ${textColor}; }</style>`

  const linkTags = ($q.dark.isActive ? tyMdCssUrls.dark : tyMdCssUrls.light)
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n')

  return generateIframeSrc(
    renderedHtml.value,
    `${linkTags}${inlineStyle}`,
    getCssVar('--q-primary') || '#000000',
    getCssVar('--q-secondary') || '#00ffff',
  )
})

interface ResizeIframeMessage {
  type: 'resizeIframe'
  width: number
  height: number
}

let resizeTimeout: ReturnType<typeof setTimeout> | null = null
let pendingResize: { width: number; height: number } | null = null
let lastWidth: number | null = null
let lastHeight: number | null = null
let resizeCount = 0
const MAX_RESIZE_ATTEMPTS = 3
let resizeLoopDetected = false

function handleMessage(event: MessageEvent) {
  const data = event.data as ResizeIframeMessage
  if (
    !iframeRef.value ||
    event.source !== iframeRef.value.contentWindow ||
    data?.type !== 'resizeIframe'
  ) {
    return
  }

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

    console.log(widthChanged, resizeCount, MAX_RESIZE_ATTEMPTS)

    if (resizeLoopDetected) {
      // Only update height, never width again
      if (heightChanged) {
        iframeRef.value.style.height = `${newHeight}px`
        lastHeight = newHeight
        console.info(
          '[iframe] Resize loop detected previously, now only updating height to avoid scrollbars.',
        )
      }
      pendingResize = null
      return
    }

    if (widthChanged || heightChanged) {
      resizeCount++
      if (resizeCount > MAX_RESIZE_ATTEMPTS) {
        resizeLoopDetected = true
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

      if (widthChanged) {
        iframeRef.value.style.width = `${newWidth}px`
        lastWidth = newWidth
      }
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

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
})

onMounted(() => {
  window.addEventListener('message', handleMessage)
})
</script>
