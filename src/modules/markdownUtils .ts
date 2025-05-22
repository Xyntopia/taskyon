import type MarkdownIt from 'markdown-it'
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

import { uid } from 'quasar'
import type Renderer from 'markdown-it/lib/renderer'
import type { Token } from 'markdown-it'

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

export interface WrapPluginFactoryOptions {
  /** For code fences: one language or list of langs to match */
  codeLang?: string | string[]
  /** Your HTML wrapper for matching code blocks */
  wrapCodeBlock?: (token: Token, lang: string, content: string) => string

  /** For images: regex on src or alt to match */
  imageMatcher?: RegExp
  /** Your HTML wrapper for matching images */
  wrapImage?: (token: Token, rendered: string) => string
}

/**
 * Returns a markdown-it plugin that only wraps matching code fences/images.
 */
export function createWrapPlugin(
  langMatcher: RegExp, // regex or string to match
  htmlWrapper: (token: Token, lang: string, content: string) => string,
) {
  return function wrapPlugin(md: MarkdownIt) {
    const defaultFence = md.renderer.rules.fence!
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      const info = token?.info.trim().split(/\s+/)[0]
      const content = defaultFence(tokens, idx, options, env, self)
      if (info && langMatcher.test(info)) {
        return htmlWrapper(token, info, content)
      }
      return content
    }
  }
}

export const copyButton = createWrapPlugin(/.*/, (token: Token, lang: string, content: string) => {
  // give each block a unique ID so the button knows what to copy
  const uid = `code-${Math.random().toString(36).slice(2)}`

  // inject that ID into the <pre> tag
  const contentWithId = content.replace('<pre', `<pre id="${uid}"`)

  return `
    <div class="code-block-with-copy" style="position: relative;">
      ${contentWithId}
      <button
        class="copy-btn"
        style="position: absolute; top: 8px; right: 8px;"
        onclick="
          navigator.clipboard.writeText(
            document.getElementById('${uid}').innerText
          )
        "
      >Copy</button>
    </div>
  `
})

export const createMermaidRenderer = (mermaidSettings: MermaidConfig) => (md: MarkdownIt) => {
  /*
  not sure, if we will need this...
  const htmlEntities = (str: unknown) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');*/

  // if we are using the plugin, initialize mermaid as well :)
  mermaid.initialize(mermaidSettings)

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
      const svgUrl = URL.createObjectURL(svgBlob)
      innerHTML = `<img src="${svgUrl}" alt="Mermaid diagram" />`
    } catch (err) {
      console.log('error rendering mermaid!!', err)
      innerHTML = `${code}\n<div>${JSON.stringify(err)}</div>`
    } finally {
      velement.remove()
    }

    const element = document.querySelector(`#${img_id}`)
    if (element) element.innerHTML = innerHTML

    // Create a save as button
    // TODO: right now, the "svg"  includes the iframe with the svg...
    /*const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy SVG';
        element.appendChild(copyButton);

        // Add event listener to copy button
        copyButton.addEventListener('click', () => {
          void navigator.clipboard.writeText(svg);
        });*/
  }

  let defaultRenderer: Renderer.RenderRule
  if (md.renderer.rules.fence) {
    defaultRenderer = md.renderer.rules.fence.bind(md.renderer.rules)
  }

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token && token.info.trim() === 'mermaid') {
      const mid = uid()
      const img_id = `d${mid}`
      const mm_code = token.content.trim()
      void drawDiagram(mm_code, mid, img_id)

      return `<div id="${img_id}" class="mermaid">${mm_code}</div>`
    }
    return defaultRenderer(tokens, idx, options, env, self)
  }
}

export const generateIframeSrc = (renderedHtml: string, cssUrl: string) =>
  `
  <html>
    <head>
      ${cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : ''}
      <style>
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          /* Make the body a container for inline-size queries */
          container-type: inline-size;
        }
        /* Wrap content in a fluid container */
        .content {
          /* By default, use auto (shrink-wrapped) */
          width: auto;
          box-sizing: border-box;
        }
        img, svg {
          max-width: 100%;
          height: auto;
        }
        /* If the available width is 500px or more,
           force the content to stretch to 100% */
        @container (min-width: 500px) {
          .content {
            width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <div class="content">
        ${renderedHtml}
      </div>
      <script>
        function sendSize() {
          console.log('Iframe content size:', document.documentElement.scrollWidth, document.documentElement.scrollHeight);
          const height = document.documentElement.scrollHeight || document.body.scrollHeight;
          const width = document.documentElement.scrollWidth || document.body.scrollWidth;
          window.parent.postMessage({ type: 'resizeIframe', height, width }, '*');
        }
        window.addEventListener('load', sendSize);
        window.addEventListener('resize', sendSize);
      </script>
    </body>
  </html>
  `
