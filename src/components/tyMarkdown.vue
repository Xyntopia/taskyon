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
//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
//import katex from  '@mdit/plugin-katex-slim'
import mathjax3 from 'markdown-it-mathjax3'
//@ts-expect-error no types for this package
import sub from 'markdown-it-sub'
//@ts-expect-error no types for this package
import sup from 'markdown-it-sup'
//@ts-expect-error no types for this package
import ins from 'markdown-it-ins'
//@ts-expect-error no types for this package
import mark from 'markdown-it-mark'
//@ts-expect-error no types for this package
import footnote from 'markdown-it-footnote'
//@ts-expect-error no types for this package
import deflist from 'markdown-it-deflist'
//@ts-expect-error no types for this package
import abbr from 'markdown-it-abbr'
//@ts-expect-error no types for this package
import container from 'markdown-it-container'
//@ts-expect-error no types for this package
import { full as emoji } from 'markdown-it-emoji'
import mermaid from 'mermaid'
import { computed, onMounted } from 'vue'
import {
  containsHtmlTags,
  createMermaidRenderer,
  generateIframeSrc,
  highlighter,
  initPrismTheme,
  codeButtons,
} from '../modules/markdownUtils '
import { useQuasar } from 'quasar'
import type { MermaidConfig } from 'mermaid'
import { ref } from 'vue'
import MarkdownIt from 'markdown-it'
import { onUnmounted } from 'vue'
import { watch } from 'vue'
import type Token from 'markdown-it/lib/token'

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
  noMermaid = false,
  src,
  useIframe = false,
} = defineProps<{
  src?: string
  noMermaid?: boolean
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
  const defaultPlugins = [emoji, sub, sup, ins, mark, footnote, deflist, mathjax3, codeButtons]
  if (noMermaid) {
    return [...defaultPlugins]
  }
  return [...defaultPlugins, renderMermaid]
})

const md2Html = (src: string) => {
  // for options check this link:
  // https://github.com/markdown-it/markdown-it?tab=readme-ov-file#simple
  const md = new MarkdownIt({
    // Convert '\n' in paragraphs into <br>
    breaks: false,
    // CSS language prefix for fenced blocks. Can be
    // useful for external highlighters.
    langPrefix: 'language-',
    //allow html
    html: true,
    // Autoconvert URL-like text to links
    linkify: true,
    // Enable some language-neutral replacement + quotes beautification
    // For the full list of replacements, see https://github.com/markdown-it/markdown-it/blob/master/lib/rules_core/replacements.mjs
    typographer: true,
    // Double + single quotes replacement pairs, when typographer enabled,
    // and smartquotes on. Could be either a String or an Array.
    //
    // For example, you can use '«»„“' for Russian, '„“‚‘' for German,
    // and ['«\xA0', '\xA0»', '‹\xA0', '\xA0›'] for French (including nbsp).
    quotes: '“”‘’',
    // Highlighter function. Should return escaped HTML,
    // or '' if the source string is not changed and should be escaped externally.
    // If result starts with <pre... internal wrapper is skipped.
    highlight: highlighter,
  })
  plugins.value.forEach((plugin) => {
    md.use(plugin)
  })
  md.use(abbr)
  md.use(container, 'dynamic', {
    validate: function () {
      return true
    },
    render: function (tokens: Token[], idx: number) {
      const token = tokens[idx]
      if (!token) return
      return token.nesting === 1
        ? `<div class="container"><div class="${token.info.trim()}">`
        : '</div></div>'
    },
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
