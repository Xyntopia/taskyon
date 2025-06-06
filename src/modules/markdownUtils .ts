import MarkdownIt from 'markdown-it'

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

//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
//import katex from  '@mdit/plugin-katex-slim'
import type { MermaidConfig } from 'mermaid'
import mermaid from 'mermaid'

// we fist import "Prism" and then the languages we need
// the subsequent imports need Prism to be initialized, because
// they add the languages to the Prism instance
import Prism from 'prismjs'
// TODO: do this as a dynamic import :)
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-bash'

// we import the themes as URLs so that vite bundler
// creates static assets for them and we can use them
// dynamically
import lightHref from 'prismjs/themes/prism.css?url'
import darkHref from 'prismjs/themes/prism-tomorrow.css?url'
import tyMarkdownCss from 'src/css/markdown.sass?inline'

import { uid } from 'quasar'
import type { Token } from 'markdown-it'
import { svgStringToPngUint8 } from './svgUtils'
import { copyPngToClipboard, hexToRgb } from './utils'

export const tyMdCssUrls = {
  dark: [darkHref],
  light: [lightHref],
} as const

export const highlighter = (code: string, lang: string) => {
  // non-null assertion or coalesce to JS grammar
  const grammar = Prism.languages[lang]! ?? Prism.languages.javascript!
  const result = Prism.highlight(code, grammar, lang)
  return `<pre class="language-${lang}"><code>${result}</code></pre>`
}

// src/utils/prismTheme.ts
let linkEl: HTMLLinkElement | null = null
const prismId = 'prism-theme'

/**
 * Injects the <link> once and sets initial theme.
 * @param isDark  whether to load dark or light theme first
 * @param opts    override paths or link id
 */
export function initPrismTheme(isDark: boolean) {
  console.log('init prism theme')
  if (linkEl) return
  linkEl = document.createElement('link')
  linkEl.rel = 'stylesheet'
  linkEl.id = prismId
  document.head.appendChild(linkEl)
  setPrismTheme(isDark)
}

/**
 * Swaps the theme on the existing link.
 * @param isDark  dark=true → darkHref, false → lightHref
 */
export function setPrismTheme(isDark: boolean) {
  console.log('set prism theme to', isDark)
  if (!linkEl) return
  linkEl.href = isDark ? darkHref : lightHref
}

export const containsHtmlTags = (markdown: string) => {
  // Regex to match any HTML tag
  const tagPattern = /<\/?[a-z][a-z0-9]*\b[^>]*>/gi
  return tagPattern.test(markdown)
}

/**
 * Returns a markdown-it plugin that transforms matching code fences.
 */
export function createFenceTransformPlugin(
  langMatcher: RegExp, // regex or string to match
  // transform the content into something else..
  transformer: (token: Token, lang: string, content: string) => string,
) {
  return function wrapPlugin(md: MarkdownIt) {
    const defaultFence = md.renderer.rules.fence!
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      const info = (token?.info || '').trim().split(/\s+/)[0]
      const content = defaultFence(tokens, idx, options, env, self)
      if (token && langMatcher.test(info ?? '')) {
        return transformer(token, info ?? '', content)
      }
      return content
    }
  }
}

/**
 * Wraps code fences matching `langMatcher`, injecting a lang label + buttons.
 */
export function createMultiButtonPlugin(
  langMatcher: RegExp,
  buttons: {
    label: string // button text
    languages: RegExp // which langs to show on
    callback: (code: string, lang: string, containerId: string) => void | Promise<void>
  }[],
) {
  // Store event listeners for cleanup
  const listeners = buttons.map((b) => ({
    label: b.label,
    handler: (ev: Event) => {
      const ce = ev as CustomEvent<{ code: string; lang: string; containerId: string }>
      void b.callback(ce.detail.code, ce.detail.lang, ce.detail.containerId)
    },
  }))

  // 1) wire up your handlers to listen for events named === label
  listeners.forEach(({ label, handler }) => {
    document.addEventListener(label, handler)
  })

  // 2) return cleanup function along with the plugin
  const cleanup = () => {
    listeners.forEach(({ label, handler }) => {
      document.removeEventListener(label, handler)
    })
  }

  // 3) return a wrap-plugin that injects buttons which dispatch those events
  const plugin = createFenceTransformPlugin(langMatcher, (_token: Token, lang, content) => {
    const uid = `code-${Math.random().toString(36).slice(2)}`
    const blockId = `block-${Math.random().toString(36).slice(2)}`

    // inject that ID into the <pre> tag
    const contentWithId = content.replace('<pre', `<pre id="${uid}"`)

    const btnsHtml = buttons
      .filter((b) => b.languages.test(lang))
      .map((b) => {
        return `
          <button
            class="btn-${b.label.replace(/\s+/g, '-').toLowerCase()}"
            onclick="
              const code = document.getElementById('${uid}').innerText;
              document.dispatchEvent(
                new CustomEvent('${b.label}', {
                  detail: { code, lang: '${lang}', containerId: '${blockId}' }
                })
              );
            "
          >${b.label}</button>
        `
      })
      .join('')

    return `
      <div class="code-block-with-btns" id="${blockId}">
        ${contentWithId}
        <div class="code-buttons">
          ${btnsHtml}
          <span class="langlabel">${lang}</span>
        </div>
      </div>
    `
  })

  return {
    plugin,
    cleanup,
  }
}

/**
 * A plugin that transforms ```mermaid``` fences into live-rendered SVGs.
 */
export const createMermaidRenderer = (mermaidConfig: MermaidConfig) => {
  /*
  not sure, if we will need this...
  sometimes good for sanitizing the input
  const htmlEntities = (str: unknown) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');*/

  // 1) initialize mermaid once
  mermaid.initialize(mermaidConfig)

  // Example of using the render function
  const drawDiagram = async function (code: string, selector: string, img_id: string) {
    const graphDefinition = code
    const velement = document.createElement('div')
    const fragment = document.createDocumentFragment()
    fragment.appendChild(velement)
    document.body.appendChild(velement)
    let innerHTML: string

    try {
      const { svg } = await mermaid.render(`mg${selector}`, graphDefinition, velement)
      const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
      const imgUrl = URL.createObjectURL(svgBlob)
      innerHTML = `<img src="${imgUrl}" alt="Mermaid diagram" />`
    } catch (err) {
      console.log('error rendering mermaid!!', err)
      innerHTML = `${code}\n<div>${JSON.stringify(err)}</div>`
    } finally {
      velement.remove()
    }

    const element = document.querySelector(`#${img_id}`)
    if (element) {
      element.innerHTML = innerHTML
    }
  }

  // 2) return a fence-transformer scoped to mermaid
  return createFenceTransformPlugin(/^mermaid$/, (token, _, content) => {
    const mid = uid()
    const img_id = `d${mid}`
    const mm_code = token.content.trim()

    void drawDiagram(mm_code, mid, img_id)

    return `<div id="${img_id}" class="mermaid">${mm_code}</div>
<div style="display: none">${content}</div>`
  })
}

const createMermaidSettings = (darkMode: boolean): MermaidConfig => ({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: darkMode ? 'dark' : 'default',
  flowchart: {
    htmlLabels: false,
    useMaxWidth: true,
  },
})
const { plugin: codeButtons } = createMultiButtonPlugin(/.*/, [
  {
    label: 'Copy',
    languages: /^(?!mermaid$).*/, // Exclude mermaid
    callback: (code, lang) => {
      console.log(`copy ${lang}:`, code)
      void navigator.clipboard.writeText(code)
    },
  },
  // TODO: Run code for js/python
  /*{
    label: 'Run Code',
    languages: /^(js)$/,
    callback: (code, lang) => {
      // your runner here…
      console.log(`Running ${lang}:`, code)
    },
  },*/
  // Copy SVG
  // TODO: enable this with some workaround
  // e.g. https://github.com/mermaid-js/mermaid/issues/2102 but search for more
  // we currently don't do this, because exported svg looks "funny"
  /*{
    label: 'Copy SVG',
    languages: /^mermaid$/,
    callback: (code, lang, blockId) => {
      const block = document.getElementById(blockId)
      if (!block) return
      const img = block.querySelector('img')
      if (!img) return
      void fetch(img.src)
        .then((res) => res.text())
        .then((svg) => {
          void navigator.clipboard.writeText(svg)
        })
    },
  },*/
  // Copy as PNG
  {
    label: 'Copy as PNG',
    languages: /^mermaid$/,
    callback: async (code, lang, blockId) => {
      const block = document.getElementById(blockId)
      if (!block) return

      const img = block.querySelector('img') as HTMLImageElement
      if (!img || !img.src.startsWith('blob:')) return

      try {
        const response = await fetch(img.src)
        const svgString = await response.text()
        const res = await svgStringToPngUint8(svgString, 1024)
        if (res) {
          await copyPngToClipboard(res)
          console.log('copied png to clipboard')
        }
      } catch (err) {
        console.error('Error converting blob to PNG:', err)
      }
    },
  },
  // Mermaid: Copy Source
  {
    label: 'Copy Source',
    languages: /^mermaid$/,
    callback: (code) => {
      console.log('copy mermaid source:', code)
      void navigator.clipboard.writeText(code)
    },
  },
])

// TODO: make this more efficient...
export const md2Html = (src: string, darkMode = false) => {
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
  const renderMermaid = createMermaidRenderer(createMermaidSettings(darkMode))
  const plugins = [
    emoji,
    sub,
    sup,
    ins,
    mark,
    footnote,
    deflist,
    mathjax3,
    renderMermaid,
    codeButtons,
  ]

  plugins.forEach((plugin) => {
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

export const generateIframeSrc = (
  renderedHtml: string,
  linkTags: string,
  primaryColorHex: string,
  secondaryColorHex: string,
) => {
  const primary = hexToRgb(primaryColorHex)
  const secondary = hexToRgb(secondaryColorHex)
  return `<html>
    <head>
      ${linkTags}
      <style>
        :root {
          --q-primary-rgb: ${primary};
          --q-secondary-rgb: ${secondary};
        }

        ${tyMarkdownCss}

        html, body {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        .content {
          width: 100%;
          box-sizing: border-box;
        }
        img, svg {
          max-width: 100%;
          height: auto;
        }
      </style>
    </head>
    <body>
      <div class="content">
        ${renderedHtml}
      </div>
      <script>
        const contentEl = document.querySelector('.content');
        function sendSize() {
          if (!contentEl) return;

          // 1) get the raw box
          const rect = contentEl.getBoundingClientRect();

          // 2) detect any bottom margin on the last child
          const last = contentEl.lastElementChild;
          const mb = last
            ? parseFloat(getComputedStyle(last).marginBottom) || 0
            : 0;

          // 3) compute height = box height + margin, then ceil to avoid fractions
          // we add 5 px on top, because for some reason the value we are calculating here is just
          // a little bit too low for the scrollbars to disappear in the parent..
          const height = Math.ceil(rect.height + mb) + 20;

          // 4) width in the same way (optional)
          const width = Math.ceil(rect.width);
          console.log('Iframe content size:', width, height);
          window.parent.postMessage({ type: 'resizeIframe', width, height }, '*');
        }

        window.addEventListener('load', sendSize);
        new ResizeObserver(sendSize).observe(contentEl);
      </script>
    </body>
  </html>
  `
}
