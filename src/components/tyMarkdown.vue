<!-- eslint-disable no-useless-escape -->
<template>
  <div v-if="useIframe && iframeHtml" class="responsive-iframe row ty-md-iframe" v-bind="$attrs">
    <iframe
      ref="iframeRef"
      class="col"
      sandbox="allow-scripts allow-modals allow-downloads allow-forms allow-popups"
      :srcdoc="`<div class=tyMarkdown>${iframeHtml}<div>`"
      style="width: 600px"
    />
  </div>
  <div v-else v-html="renderedHtml" v-bind="$attrs" class="tyMarkdown" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
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
    getCssVar('--q-primary-rgb') || '#000000',
    getCssVar('--q-secondary-rgb') || '#00ffff',
  )
})
/*const doc = iframeRef.value.contentDocument
      if (doc) {
        doc.open()
        doc.write()
        doc.close()
      }*/
/* else {
      // If not using iframe, initialize any necessary libraries
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'default',
        flowchart: { htmlLabels: false, useMaxWidth: true }
      })
    }*/

/*function handleMessage(event: MessageEvent) {
  if (!iframeRef.value || event.source !== iframeRef.value.contentWindow) return
  if (event.data?.type !== 'resizeIframe') return

  console.log('set iframe height', event.data, iframeRef.value.parentElement?.clientWidth)

  // Use parent's width as a maximum
  const parentWidth = iframeRef.value.parentElement?.clientWidth || event.data.width
  //const newWidth = Math.min(event.data.width, parentWidth)
  iframeRef.value.style.width = parentWidth + 'px'

  iframeRef.value.style.height = `${event.data.height}px`
  //iframeRef.value.style.width = `${newWidth}px`
}

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
})

onMounted(() => {
  window.addEventListener('message', handleMessage)
})*/
</script>

<style lang="sass">
/*.responsive-iframe
  position: relative
  //width: 100%

/*.responsive-iframe iframe
  position: relative
  display: block
  //width: auto
  border: none
  //height: auto
  //min-width: 800px  // or whatever minimum you require
</style>
