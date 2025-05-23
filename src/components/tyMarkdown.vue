<!-- eslint-disable no-useless-escape -->
<template>
  <div v-if="useIframe && iframeHtml" class="responsive-iframe row" v-bind="$attrs">
    <iframe
      ref="iframeRef"
      class="col"
      sandbox="allow-scripts allow-modals allow-downloads allow-forms allow-popups"
      :srcdoc="iframeHtml"
      style="width: 600px"
    />
  </div>
  <div v-else v-html="renderedHtml" v-bind="$attrs" class="tyMarkdown" />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  containsHtmlTags,
  generateIframeSrc,
  initPrismTheme,
  md2Html,
} from '../modules/markdownUtils '
import { useQuasar } from 'quasar'
import { ref } from 'vue'
import { onUnmounted } from 'vue'

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const iframeRef = ref<HTMLIFrameElement | null>(null)

defineOptions({
  inheritAttrs: false,
})

const $q = useQuasar()
initPrismTheme($q.dark.isActive)

const {
  cssUrl,
  src,
  useIframe = false,
} = defineProps<{
  src?: string
  useIframe?: boolean
  cssUrl?: string // optional external CSS URL for iframe content
}>()

/*function handleMarkdownClick(event: MouseEvent) {
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
}*/

const renderedHtml = computed(() => {
  return md2Html(src ?? '', $q.dark.isActive)
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
})
</script>

<style lang="sass">
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
</style>
