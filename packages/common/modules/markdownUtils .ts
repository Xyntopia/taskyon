// markdownUtils.ts
import MarkdownIt from 'markdown-it'

//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
import { katex } from '@mdit/plugin-katex'
import 'katex/dist/katex.min.css'
// The following doesn't work in our iframe, as the iframes are sandboxed and
// we get CORS issues, if we use the URL.
//import katexCssHref from 'katex/dist/katex.min.css?url' // we need this for the iframe..
//import mathjax from  '@mdit/plugin-mathjax-slim'
//import mathjax3 from 'markdown-it-mathjax3'
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
import type { Mermaid, MermaidConfig } from 'mermaid'
import mermaid from 'mermaid'
// we fist import "Prism" and then the languages we need
// the subsequent imports need Prism to be initialized, because
// they add the languages to the Prism instance
import PrismThemes from 'prismjs'
// TODO: do this as a dynamic import :)
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-typescript'

// we import the themes as URLs so that vite bundler
// creates static assets for them and we can use them
// dynamically
import darkHref from 'prismjs/themes/prism-tomorrow.css?url'
import lightHref from 'prismjs/themes/prism.css?url'
import tyMarkdownCss from 'src/css/markdown.sass?inline'

import { uid } from 'quasar'
import { generateKaTeXIframeCss } from './katexFonts'
import { stripHtmlCommentsOutsideMarkdownCode } from './markdownText'
import { svgStringToPngUint8 } from './svgUtils'
import { copyPngToClipboard, copyToClipboard, hexToRgb } from './utils'

type MditToken = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number]
type MarkdownPlugin = (md: MarkdownIt) => void
type MaybePromise<T> = T | Promise<T>

export type MarkdownPreprocessResult =
  | string
  | {
      src: string
      allowHtml?: boolean
    }

export type MarkdownActionHandler = (payload: unknown) => void | Promise<void>

export type MarkdownExtension = {
  name?: string
  preprocess?: (src: string) => MaybePromise<MarkdownPreprocessResult>
  plugins?: MarkdownPlugin[]
  actionHandlers?: Record<string, MarkdownActionHandler>
}

export type MarkdownInlineAction = {
  action: string
  payload?: unknown
}

export const tyMdCssUrls = {
  dark: [darkHref],
  light: [lightHref],
} as const

export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const encodeInlineActionPayload = (payload: unknown) =>
  encodeURIComponent(JSON.stringify(payload))

export const decodeInlineActionPayload = (payload: string | undefined): unknown => {
  if (!payload) return undefined
  try {
    return JSON.parse(decodeURIComponent(payload))
  } catch {
    return undefined
  }
}

export const renderInlineActionButton = (args: {
  label: string
  action: string
  payload?: unknown
  className?: string
  title?: string
}) => {
  const payloadAttr =
    args.payload === undefined
      ? ''
      : ` data-inline-payload="${escapeHtml(encodeInlineActionPayload(args.payload))}"`
  const titleAttr = args.title ? ` title="${escapeHtml(args.title)}"` : ''
  const classAttr = args.className ? ` ${args.className}` : ''
  return `<button type="button" class="inline-action-button${classAttr}" data-inline-action="${escapeHtml(args.action)}"${payloadAttr}${titleAttr}>${escapeHtml(args.label)}</button>`
}

const resolveExtensionPlugins = (extensions: MarkdownExtension[]) =>
  extensions.flatMap((extension) => extension.plugins ?? [])

export const resolveMarkdownExtensions = (extensions: MarkdownExtension[] = []) => [
  ...defaultMarkdownExtensions,
  ...extensions,
]

export const preprocessMarkdownSource = async (
  src: string,
  extensions: MarkdownExtension[] = [],
): Promise<{ src: string; allowHtml: boolean }> => {
  let current = src
  let allowHtml = false

  for (const extension of resolveMarkdownExtensions(extensions)) {
    if (!extension.preprocess) continue
    const result = await extension.preprocess(current)
    if (typeof result === 'string') {
      current = result
      continue
    }
    current = result.src
    allowHtml ||= result.allowHtml ?? false
  }

  return { src: current, allowHtml }
}

export const highlighter = (code: string, lang: string) => {
  // non-null assertion or coalesce to JS grammar
  const grammar = PrismThemes.languages[lang]! ?? PrismThemes.languages.javascript!
  const result = PrismThemes.highlight(code, grammar, lang)
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
  if (linkEl) return
  console.log('init prism theme')
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

/**
 * Returns a markdown-it plugin that transforms matching code fences.
 */
export function createFenceTransformPlugin(
  langMatcher: RegExp, // regex or string to match
  // transform the content into something else..
  transformer: (token: MditToken, lang: string, content: string) => string,
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
    label: string
    action: string
    languages: RegExp
    payload: (args: { lang: string; code: string; containerId: string }) => unknown
    callback: (payload: unknown) => void | Promise<void>
    feedback?: {
      successLabel: string
      durationMs: number
      failureLabel?: string
    }
  }[],
): MarkdownExtension {
  const plugin = createFenceTransformPlugin(langMatcher, (_token: MditToken, lang, content) => {
    const uid = `code-${Math.random().toString(36).slice(2)}`
    const blockId = `block-${Math.random().toString(36).slice(2)}`
    const htmlWithId = content.replace('<pre', `<pre id="${uid}"`)

    const btnsHtml = buttons
      .filter((b) => b.languages.test(lang))
      .map((b) => {
        // pull feedback values or defaults
        const success = b.feedback?.successLabel ?? '✓'
        const dur = b.feedback?.durationMs ?? 2000
        return renderInlineActionButton({
          label: b.label,
          action: b.action,
          payload: b.payload({ lang, code: _token.content, containerId: blockId }),
          className: `btn-${b.label.replace(/\s+/g, '-').toLowerCase()}`,
          title: `${b.label} ${lang}`.trim(),
        }).replace(
          '>',
          ` onclick="
              const orig = this.textContent;
              this.textContent = orig+' ${success}';
              setTimeout(() => { this.textContent = orig }, ${dur});
            ">`,
        )
      })
      .join('')

    return `
      <div class="code-block-with-btns" id="${blockId}">
        <div class="code-buttons">
          <span class="langlabel">${lang}</span>
          ${btnsHtml}
        </div>
        ${htmlWithId}
      </div>
    `
  })

  const actionHandlers = Object.fromEntries(
    buttons.map((button) => [button.action, button.callback] as const),
  )

  return { plugins: [plugin], actionHandlers }
}

const codeButtonsExtension = createMultiButtonPlugin(/.*/, [
  {
    label: 'Copy',
    action: 'copy-code',
    languages: /^(?!mermaid$).*/, // Exclude mermaid
    payload: ({ code, lang }) => ({ code, lang }),
    callback: (payload) => {
      const input = payload as { code?: string; lang?: string }
      console.log(`copy ${input.lang ?? ''}:`, input.code ?? '')
      void copyToClipboard(input.code ?? '')
    },
  },
  // Mermaid: Copy Source
  {
    label: 'Copy Source',
    action: 'copy-mermaid-source',
    languages: /^mermaid$/,
    payload: ({ code, lang }) => ({ code, lang }),
    callback: (payload) => {
      const input = payload as { code?: string; lang?: string }
      console.log(`copy ${input.lang ?? ''}:`, input.code ?? '')
      void copyToClipboard(input.code ?? '')
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
          void copyToClipboard(svg)
        })
    },
  },*/
  // Copy as PNG
  {
    label: 'Copy as PNG',
    action: 'copy-mermaid-png',
    languages: /^mermaid$/,
    payload: ({ code }) => ({ code }),
    callback: async (payload) => {
      const input = payload as { code?: string }
      const source = input.code ?? ''
      if (!source) return
      try {
        mermaid.initialize(createMermaidSettings(document.body.classList.contains('body--dark')))
        const svgString = await drawDiagram(mermaid)(source, uid())
        if (!svgString.startsWith('<svg')) {
          console.error('SVG string is invalid:', svgString.slice(0, 100))
          return
        }
        const res = await svgStringToPngUint8(svgString, 1024)
        if (res) await copyPngToClipboard(res)
      } catch (err) {
        console.error('Error converting/copying PNG:', err)
      }
    },
  },
])

// Example of using the render function
export const drawDiagram =
  (mermaid: Mermaid) =>
  async (code: string, selector: string, objecturl = false) => {
    const graphDefinition = code
    const velement = document.createElement('div')
    const fragment = document.createDocumentFragment()
    fragment.appendChild(velement)
    document.body.appendChild(velement)
    let innerHTML: string

    try {
      const { svg } = await mermaid.render(`mg${selector}`, graphDefinition, velement)
      if (objecturl) {
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
        const imgUrl = URL.createObjectURL(svgBlob)
        innerHTML = `<img src="${imgUrl}" alt="Mermaid diagram" />`
      } else {
        innerHTML = svg
      }
    } catch (err) {
      console.log('error rendering mermaid!!', err)
      innerHTML = `${code}\n<div>${JSON.stringify(err)}</div>`
    } finally {
      velement.remove()
    }

    return innerHTML
  }

export const renderMermaidPlaceholders =
  (mermaid: Mermaid) =>
  async (html: string): Promise<string> => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html

    const placeholders = wrapper.querySelectorAll('.mermaid-placeholder')

    for (const el of placeholders) {
      const code = el.textContent?.trim() || ''
      const id = el.id || uid()
      try {
        const { svg } = await mermaid.render(`mid-${id}`, code)
        el.outerHTML = svg
      } catch (err) {
        el.outerHTML = `
          <div class="mermaid-error-container" style="border:2px solid #e53935;padding:1em;margin:0.5em 0;border-radius:6px;">
            <div style="color:#b71c1c;font-weight:bold;font-size:1.1em;margin-bottom:0.5em;">
              Mermaid Diagram Error
            </div>
            <pre class="mermaid-error" style="background:rgba(255,240,240,0.5);color:#b71c1c;padding:0.5em;border-radius:4px;overflow-x:auto;">${code}</pre>
            <div style="color:#b71c1c;margin-top:0.5em;">${String(err)}</div>
          </div>
        `
      }
    }

    return wrapper.innerHTML
  }

/**
 * A plugin that transforms ```mermaid``` fences into live-rendered SVGs.
 */
export const createMermaidPlaceholders = createFenceTransformPlugin(
  /^mermaid$/,
  (token, _, content) => {
    const mid = uid()
    const img_id = `d${mid}`
    const mm_code = token.content.trim()

    return `<div id="${img_id}" class="mermaid-placeholder">
    ${mm_code}
    </div>
    <div style="display: none">${content}</div>`
  },
)

const createMermaidSettings = (darkMode: boolean): MermaidConfig => ({
  startOnLoad: false,
  // TODO: allow "loose" if we render in iframe, in order to
  //       allow interactivity with diagram
  securityLevel: 'strict',
  theme: darkMode ? 'dark' : 'default',
  flowchart: {
    htmlLabels: false,
    useMaxWidth: true,
  },
  // we have our oown error handling :)
  suppressErrorRendering: true,
})

const defaultMarkdownExtensions: MarkdownExtension[] = [
  {
    name: 'shared-default-markdown-plugins',
    plugins: [emoji, sub, sup, ins, mark, footnote, deflist, createMermaidPlaceholders],
  },
  {
    name: 'shared-code-buttons',
    ...codeButtonsExtension,
  },
]

export const md2Html = async (
  src: string,
  darkMode = false,
  allowHtml = false,
  extensions: MarkdownExtension[] = [],
) => {
  const renderSource = allowHtml ? src : stripHtmlCommentsOutsideMarkdownCode(src)
  // 0) make a one-off random marker for this invocation
  const rand = Math.random().toString(36).slice(2, 20) // e.g. "x9fj3k2a"
  const wrap = `${rand}` // e.g. "HTMLBLOCK_x9fj3k2a..."
  const placeholder = (i: number) => `${wrap}${i}${wrap}`

  // 1) Set up markdown-it
  const md = new MarkdownIt({
    // Convert '\n' in paragraphs into <br>
    breaks: false,
    // CSS language prefix for fenced blocks. Can be
    // useful for external highlighters.
    langPrefix: 'language-',
    //allow html
    html: allowHtml,
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

  resolveExtensionPlugins(resolveMarkdownExtensions(extensions)).forEach((plugin) => {
    md.use(plugin)
  })
  md.use(katex, {
    delimiters: 'all', // or 'brackets' | 'dollars',
    throwOnError: false, // don’t explode rendering
  })
  md.use(abbr)
  md.use(container, 'dynamic', {
    validate: function () {
      return true
    },
    render: function (tokens: MditToken[], idx: number) {
      const token = tokens[idx]
      if (!token) return
      return token.nesting === 1
        ? `<div class="container"><div class="${token.info.trim()}">`
        : '</div></div>'
    },
  })

  // make links work a certain way...
  // Remember the old renderer if overridden, or proxy to the default renderer.
  const defaultRender =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options)
    }
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    // Get the href attribute
    const href = tokens[idx]?.attrs?.find(([name]) => name === 'href')?.[1]

    // If it's an external link (starts with http:// or https:// or //), add target="_blank"
    if (
      href &&
      (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//'))
    ) {
      tokens[idx]!.attrSet('target', '_blank')
    }

    // Pass the token to the default renderer.
    return defaultRender(tokens, idx, options, env, self)
  }

  // 2) Parse tokens and replace html_block tokens with placeholders
  const env = {}
  const tokens = md.parse(renderSource, env)
  const htmlBlocks: string[] = []

  if (allowHtml) {
    tokens.forEach((token) => {
      if (token.type === 'html_block') {
        // push ⟶ same content but with leading spaces removed on every line
        const dedented = token.content.replace(/^[ \t]+/gm, '') // ← one‑liner
        const i = htmlBlocks.push(dedented) - 1
        token.content = placeholder(i)
      }
    })
  }

  // 3) Render tokens back to HTML
  const interim = md.renderer.render(tokens, md.options, env)

  // 4) Restore HTML blocks
  const phRe = new RegExp(wrap + '(\\d+)' + wrap, 'g')
  const finalHtml = interim.replace(phRe, (_, idx) => htmlBlocks[+idx] ?? '')

  // 5) Mermaid, iframe, etc.
  mermaid.initialize(createMermaidSettings(darkMode))
  return await renderMermaidPlaceholders(mermaid)(finalHtml)
}

//TODO: we don't entirely manage to calculate the correct size of iframes yet.
//      maybe we should use "marginheight" or somthing like that?
export const generateIframeSrc = (
  renderedHtml: string,
  linkTags: string,
  primaryColorHex: string,
  secondaryColorHex: string,
  mdContentClass: string,
  theme: 'light' | 'dark' = 'light',
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

        // katex declarations
        ${generateKaTeXIframeCss()}

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
        .inline-action-button {
          border: 1px solid rgba(var(--q-secondary-rgb), 0.35);
          background: rgba(var(--q-secondary-rgb), 0.08);
          color: inherit;
          border-radius: 999px;
          font-size: 0.75rem;
          line-height: 1.1;
          padding: 0.1rem 0.45rem;
          cursor: pointer;
        }
        img, svg {
          max-width: 100%;
          height: auto;
        }
      </style>
    </head>
    <body class="body--${theme}" data-taskyon-theme="${theme}">
      <div class="content ${mdContentClass} in-iframe">
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
          // console.log('Iframe content size:', width, height);
          window.parent.postMessage({ type: 'resizeIframe', width, height }, '*');
        }

        window.addEventListener('load', sendSize);
        new ResizeObserver(sendSize).observe(contentEl);

        // --- minimal long-press detection ---
        let pressTimer;
        contentEl.addEventListener('touchstart', () => {
          pressTimer = setTimeout(() => {
            window.parent.postMessage({ type: 'longpress' }, '*');
          }, 600); // ms threshold for long press
        });
        contentEl.addEventListener('touchend', () => clearTimeout(pressTimer));
        contentEl.addEventListener('touchmove', () => clearTimeout(pressTimer));

        document.addEventListener('click', function(event) {
          const target = event.target;
          const inlineAction = target && target.closest ? target.closest('[data-inline-action]') : null;
          if (inlineAction) {
            event.preventDefault();
            window.parent.postMessage(
              {
                type: 'inlineAction',
                action: inlineAction.getAttribute('data-inline-action') || '',
                payload: inlineAction.getAttribute('data-inline-payload') || ''
              },
              '*'
            );
            return;
          }
          const link = target && target.closest ? target.closest('a[href]') : null;
          if (link) {
            event.preventDefault();
            window.parent.postMessage(
              { type: 'linkClick', href: link.getAttribute('href') || '' },
              '*'
            );
            return;
          }
          window.parent.postMessage({ type: 'iframeClick', x: event.clientX, y: event.clientY }, '*');
        });

      </script>
    </body>
  </html>
  `
}
