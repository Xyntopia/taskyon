<template>
  <iframe
    v-if="iframeHtml"
    ref="iframeRef"
    sandbox="allow-scripts allow-modals"
    style="width: 100%; height: 100%; border: none"
    :srcdoc="iframeHtml"
  />
  <q-markdown
    v-else
    :id="id"
    :plugins="plugins"
    :src="src"
    v-bind="$attrs"
    @click="handleMarkdownClick"
  />
</template>

<script setup lang="ts">
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown'
//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
//import katex from  '@mdit/plugin-katex-slim'
import mathjax3 from 'markdown-it-mathjax3'
import mermaid from 'mermaid'
import '@quasar/quasar-ui-qmarkdown/dist/index.css'
// !!!!!!!!!!! it is superimportant, that our "prismjs" imports come AFTER the QMarkdown import !!!!!
// otherwise this will result in errors for some reason...
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import { computed, onMounted, getCurrentInstance } from 'vue'
import { addCopyButtons, createMermaidRenderer } from 'src/modules/markdownUtils '
import { useQuasar } from 'quasar'
import type { MermaidConfig } from 'mermaid'
import { svgToPng } from 'src/modules/svgUtils'
import { copyToClipboard, copyPngToClipboard } from 'src/modules/utils'
import { ref } from 'vue'
import MarkdownIt from 'markdown-it'

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const id = getCurrentInstance()?.uid || ''

const iframeRef = ref<HTMLIFrameElement | null>(null)

const {
  cssUrl,
  noMermaid = false,
  src,
  useIframe = true,
} = defineProps<{
  src?: string
  noMermaid?: boolean
  useIframe?: boolean
  cssUrl?: string // optional external CSS URL for iframe content
}>()

function handleMarkdownClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('.copy-button')
  if (target) {
    // Find the closest .code-block-with-overlay and then find the <code> element inside it
    const codeBlockContainer = target.closest('.code-block-with-overlay')
    if (codeBlockContainer) {
      const imgElement = codeBlockContainer.querySelector('.mermaid img')
      if (imgElement && imgElement instanceof HTMLImageElement) {
        const svgUrl = imgElement.src
        fetch(svgUrl)
          .then((response) => response.text())
          .then((svgString) => {
            void svgToPng(svgString).then((res) => {
              if (res) {
                void copyPngToClipboard(res)
                $q.notify({
                  message: 'Copied image to clipboard as png!',
                  type: 'info',
                  position: 'right',
                  timeout: 500,
                  html: false,
                })
              }
            })
          })
          .catch((err) => console.error('Error fetching SVG: ', err))
      }
      const codeElement = codeBlockContainer.querySelector('code')
      if (codeElement) {
        const codeText = codeElement.textContent || '' // Get the text content of the <code> element
        copyToClipboard(codeText)
        $q.notify({
          message: 'Copied text to clipboard!',
          type: 'info',
          position: 'right',
          timeout: 500,
          html: false,
        })
        return
      }
    }
  }
}

const $q = useQuasar()

const mermaidSettings: MermaidConfig = {
  startOnLoad: false, // if false: prevent mermaid.run  to start automatically after load...
  securityLevel: 'loose',
  theme: $q.dark.isActive ? 'dark' : 'default',
  flowchart: {
    htmlLabels: false,
    useMaxWidth: true,
  },
}

const renderMermaid = createMermaidRenderer(mermaidSettings)

const plugins = computed(() => {
  if (noMermaid) {
    return [addCopyButtons, mathjax3]
  }
  return [renderMermaid, addCopyButtons, mathjax3]
})

const iframeHtml = computed(() => {
  if (useIframe) {
    const md = new MarkdownIt({ html: true })
    plugins.value.forEach((plugin) => {
      md.use(plugin)
    })
    const renderedHtml = md.render(src || '')
    return `
        <html>
          <head>
            ${cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : ''}
          </head>
          <body>${renderedHtml}</body>
        </html>
      `
  }
  return ''
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
})

onMounted(() => {
  // if we are using the plugin, initialize mermaid as well :)
  mermaid.initialize(mermaidSettings)
  const parentElement = document.getElementById('unique-id')
  if (parentElement) {
    //let mermaidElements = parentElement.querySelectorAll('.mermaid');
    /*mermaidElements.forEach(element => {
          // Do something with each .mermaid element
          console.log(element);
      });*/
    /*void mermaid.run({
      nodes: [...mermaidElements] as HTMLElement[],
      postRenderCallback: (id: string) => console.log('postRenderHook', id),
      //suppressErrors: true,
    });*/
  }
})
</script>

<style lang="sass">
/*.code-block-with-overlay
  pre.q-markdown--code__inner
    overflow: auto !important
    max-width: 100% !important
    white-space: pre !important
    word-wrap: normal !important
    max-height: 300px !important // adjust the height to your liking

.q-markdown pre,
.q-markdown code
  white-space: pre-wrap // Ensure that long lines of code wrap within the container
  word-break: break-word // Break long words to fit within the container


// we need this, because otherwise long words like links will
// completly mess up our scrolling and overflow etc...
.q-markdown
  word-break: break-word
  overflow-wrap: break-word

.q-markdown
  color: black

.q-markdown--note--info .q-markdown--note-title
  color: $accent

.q-markdown p
  text-align: justify

.q-markdown--note--info
  background-color: scale($secondary, 87.5%)
  border: 0
  border-radius: 10px 10px 10px 10px

.code-block-with-overlay
  position: relative

  .copy-button
    position: absolute
    top: 0
    right: 0

// this is in order to make mermaid sequence diagrams work on dark backgrounds
/*.mermaid svg
  .messageLine0
    stroke: $secondary !important
  .messageText
    stroke: $secondary !important
    fill: $secondary !important
</style>
