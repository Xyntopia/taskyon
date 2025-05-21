<!-- eslint-disable no-useless-escape -->
<template>
  <q-markdown
    v-if="useQMarkdown"
    :id="id"
    :no-html="false"
    :plugins="plugins"
    :src="src"
    v-bind="$attrs"
    @click="handleMarkdownClick"
  />
  <div v-else-if="useIframe && iframeHtml" class="responsive-iframe row" v-bind="$attrs">
    <iframe
      ref="iframeRef"
      class="col"
      sandbox="allow-scripts allow-modals allow-downloads allow-forms allow-popups"
      :srcdoc="iframeHtml"
      style="width: 600px"
    />
  </div>
  <div v-else v-html="renderedHtml" v-bind="$attrs" />
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
import {
  addCopyButtons,
  containsHtmlTags,
  createMermaidRenderer,
  generateIframeSrc,
} from 'src/modules/markdownUtils '
import { useQuasar } from 'quasar'
import type { MermaidConfig } from 'mermaid'
import { svgToPng } from 'src/modules/svgUtils'
import { copyToClipboard, copyPngToClipboard } from 'src/modules/utils'
import { ref } from 'vue'
import MarkdownIt from 'markdown-it'
import { onUnmounted } from 'vue'
import { watch } from 'vue'

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const id = getCurrentInstance()?.uid || ''

const iframeRef = ref<HTMLIFrameElement | null>(null)

defineOptions({
  inheritAttrs: false,
})

const {
  cssUrl,
  useQMarkdown = false,
  noMermaid = false,
  src,
  useIframe = false,
} = defineProps<{
  src?: string
  useQMarkdown?: boolean
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
        let getSvgPromise: Promise<string>
        const parts = svgUrl.split(',')
        if (parts.length < 2) {
          getSvgPromise = Promise.reject(new Error('Invalid data URI'))
        } else {
          const data = parts[1]!
          if (svgUrl.includes(';base64')) {
            getSvgPromise = Promise.resolve(atob(data))
          } else {
            getSvgPromise = Promise.resolve(decodeURIComponent(data))
          }
        }
        getSvgPromise
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
          .catch((err) => console.error('Error processing SVG: ', err))
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

watch(
  () => $q.dark.isActive,
  (isDark: boolean) => {
    mermaidSettings.theme = isDark ? 'dark' : 'default'
    mermaid.initialize(mermaidSettings)
    // Optionally, if you need to re-run Mermaid on existing diagrams:
    // void mermaid.run();
  },
)

const renderMermaid = createMermaidRenderer(mermaidSettings)

const plugins = computed(() => {
  if (noMermaid) {
    return [addCopyButtons, mathjax3]
  }
  return [renderMermaid, addCopyButtons, mathjax3]
})

const md2Html = (src: string) => {
  const md = new MarkdownIt({ html: true })
  plugins.value.forEach((plugin) => {
    md.use(plugin)
  })
  const renderedHtml = md.render(src)
  return renderedHtml
}

const renderedHtml = computed(() => {
  return md2Html(src ?? '')
})

const iframeHtml = computed(() => {
  const danger = containsHtmlTags(src ?? '')
  if (useIframe && danger) {
    // Detect parent's computed style from document.body.
    // (Alternatively, you could target a more specific element if needed.)
    const parentStyle = window.getComputedStyle(document.body)
    const fontFamily = parentStyle.fontFamily || 'Roboto, sans-serif'
    const parentColor = parentStyle.color || 'inherit'
    // For dark mode, override parent's color to white.
    const textColor = $q.dark.isActive ? 'white' : parentColor
    // Create a style block to inject into the iframe.
    const styleBlock = `<style>
      body {
        font-family: ${fontFamily};
        color: ${textColor};
      }
    </style>`
    // Prepend the style block to the rendered HTML.
    return generateIframeSrc(styleBlock + renderedHtml.value, cssUrl ?? '')
  }
  return ''
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

function handleMessage(event: MessageEvent) {
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

.responsive-iframe
  position: relative
  //width: 100%

.responsive-iframe iframe
  position: relative
  display: block
  //width: auto
  border: none
  //height: auto
  //min-width: 800px  // or whatever minimum you require

/*.responsive-iframe iframe
  //border: 0
  position: absolute
  //padding: -0%
  top: -2%
  left: -1%
  width: 102% !important
  height: 100% !important
  //max-width: 854px
  //max-height: 400px*/

// this is in order to make mermaid sequence diagrams work on dark backgrounds
/*.mermaid svg
  .messageLine0
    stroke: $secondary !important
  .messageText
    stroke: $secondary !important
    fill: $secondary !important
</style>
