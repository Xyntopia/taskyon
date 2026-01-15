// markdownUtils.ts
import MarkdownIt from 'markdown-it'

//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
import { katex } from '@mdit/plugin-katex'
import 'katex/dist/katex.min.css'
import katexCssHref from 'katex/dist/katex.min.css?url' // we need this for the iframe..
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
import { svgStringToPngUint8 } from './svgUtils'
import { copyPngToClipboard, hexToRgb } from './utils'

type MditToken = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number]

export const tyMdCssUrls = {
  dark: [darkHref],
  light: [lightHref],
} as const

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

// A lean markdown-it instance only for HTML detection
export const mdHtmlDetector = new MarkdownIt({
  html: true, // we want HTML tokens
  linkify: false,
  typographer: false,
  highlight: () => '',
})

// --- Helper: mask out HTML containers (including their inner content) ---

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const maskHtmlContainers = (src: string): string => {
  type Range = { start: number; end: number }
  const ranges: Range[] = []
  const stack: { tag: string; start: number }[] = []

  // Matches:
  // - HTML comments: <!-- ... -->
  // - Tags: <tag ...> or </tag ...>
  const tagRe = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9-]*)(\s[^>]*?)?>/g

  let m: RegExpExecArray | null
  while ((m = tagRe.exec(src)) !== null) {
    const full = m[0]
    const idx = m.index
    const end = idx + full.length

    // Comments: treat as small HTML regions (we'll just mask them)
    if (full.startsWith('<!--')) {
      ranges.push({ start: idx, end })
      continue
    }

    const tagName = m[1]
    if (!tagName) continue

    const lower = tagName.toLowerCase()
    const isClosing = full[1] === '/'
    const isSelfClosing = /\/>$/.test(full) || VOID_ELEMENTS.has(lower)

    if (isClosing) {
      // Find the last unmatched opening tag with same name
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === lower) {
          const open = stack[i]!
          stack.splice(i, 1)
          // Container range: from opening "<tag...>" to closing "</tag>"
          ranges.push({ start: open.start, end })
          break
        }
      }
    } else if (!isSelfClosing) {
      // Opening tag of a container
      stack.push({ tag: lower, start: idx })
    } else {
      // Self-closing tag: just mask the tag itself
      ranges.push({ start: idx, end })
    }
  }

  if (ranges.length === 0) return src

  // Merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  let cur = ranges[0]!
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i]!
    if (r.start <= cur.end) {
      cur.end = Math.max(cur.end, r.end)
    } else {
      merged.push(cur)
      cur = r
    }
  }
  merged.push(cur)

  // Build masked string: replace chars in HTML regions with spaces,
  // but keep newlines so line-based regexes still work.
  const chars = src.split('')
  for (const r of merged) {
    for (let i = r.start; i < r.end && i < chars.length; i++) {
      const ch = chars[i]
      if (ch !== '\n' && ch !== '\r') {
        chars[i] = ' '
      }
    }
  }

  return chars.join('')
}

// --- Markdown detection, using your original patterns on the masked string ---

export const hasMarkdownElements = (raw: string): boolean => {
  const masked = maskHtmlContainers(raw)

  return [
    /(^|\n)\s*#{1,6}\s/, // headings: #, ##, ...
    /(^|\n)\s*>\s/, // blockquotes: >
    /(^|\n)\s*[-+*]\s/, // unordered lists
    /(^|\n)\s*\d+\.\s/, // ordered lists
    /\*\*(.*?)\*\*/, // bold: **bold**
    /_(.*?)_/, // italic: _italic_
    /`{1,3}[^`]+`{1,3}/, // inline or fenced code: `code`, ```block```
    /(?<!\\)\$\$[^$]+\$\$/, // mathjax block: $$...$$ (multi-line OK)
    /(?<!\\)\$[^$\n]+\$/, // mathjax inline: $...$
    /!\[.*?\]\(.*?\)/, // image
    /\[.*?\]\(.*?\)/, // link
    /(^|\n)\s*---+/, // horizontal rule
    /(^|\n)\s*:::/, // custom containers (like :::note)
  ].some((pattern) => pattern.test(masked))
}

export const containsHtmlTags = (markdown: string) => {
  const tokens = mdHtmlDetector.parse(markdown, {})

  // Recursively search for real HTML tokens (block or inline)
  const hasHtml = (toks: typeof tokens): boolean => {
    for (const t of toks) {
      if (t.type === 'html_block' || t.type === 'html_inline') {
        const trimmed = t.content.trim()
        if (!trimmed) continue

        // Ignore *pure* HTML comments
        if (/^<!--[\s\S]*?-->$/.test(trimmed)) continue

        // Anything else counts as real HTML
        return true
      }

      // Inline tokens (including html_inline) live in .children
      if (t.children && t.children.length > 0 && hasHtml(t.children)) {
        return true
      }
    }
    return false
  }

  return hasHtml(tokens)
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
    languages: RegExp
    callback: (html: string, lang: string, containerId: string) => void | Promise<void>
    feedback?: {
      successLabel: string
      durationMs: number
      failureLabel?: string
    }
  }[],
) {
  // 1) Setup a single message listener
  let listener: ((event: MessageEvent) => void) | null = null

  function setupListener() {
    if (listener) return // Only once
    listener = (event: MessageEvent) => {
      const { type, html, lang, containerId } = event.data || {}
      if (!type) return
      const btn = buttons.find((b) => b.label === type && b.languages.test(lang))
      if (btn) {
        void btn.callback(html, lang, containerId)
      }
    }
    window.addEventListener('message', listener)
  }

  // 2) Return a plugin that injects buttons using postMessage
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
        return `
          <button
            id="btn-${uid}-${b.label.replace(/\s+/g, '-')}"
            class="btn-${b.label.replace(/\s+/g, '-').toLowerCase()}"
            onclick="
              // 1) immediate feedback
              const orig = this.textContent;
              this.textContent = orig+' ${success}';
              setTimeout(() => { this.textContent = orig }, ${dur});
              // 2) notify parent for the real work
              const msg = {
                type: '${b.label}',
                html: document.getElementById('${blockId}').innerHTML,
                lang: '${lang}',
                containerId: '${blockId}'
              };
              if(window.parent !== window) window.parent.postMessage(msg, '*');
              window.postMessage(msg, '*'); // also post to self for local handling
            "
          >${b.label}</button>
        `
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

  return {
    plugin,
    setupListener,
    cleanup: () => {
      if (listener) window.removeEventListener('message', listener)
      listener = null
    },
  }
}

const { plugin: codeButtons, setupListener } = createMultiButtonPlugin(/.*/, [
  {
    label: 'Copy',
    languages: /^(?!mermaid$).*/, // Exclude mermaid
    callback: (html, lang) => {
      // parse the HTML
      const doc = new DOMParser().parseFromString(html, 'text/html')
      // find the first <code>…</code>
      const codeEl = doc.querySelector('pre code')
      const code = codeEl?.textContent ?? ''
      console.log(`copy ${lang}:`, code)
      void navigator.clipboard.writeText(code)
    },
  },
  // Mermaid: Copy Source
  {
    label: 'Copy Source',
    languages: /^mermaid$/,
    callback: (html, lang) => {
      // parse the HTML
      const doc = new DOMParser().parseFromString(html, 'text/html')
      // find the first <code>…</code>
      const codeEl = doc.querySelector('pre code')
      const code = codeEl?.textContent ?? ''
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
    callback: async (html, lang, blockId) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      // look for inline <svg> or <img src="blob:…">

      // Try to find an <img> (blob) or <svg> (inline)
      let svgString = ''
      const img = doc.querySelector('img')
      const svg = doc.querySelector('svg')

      if (img && img.src.startsWith('blob:')) {
        try {
          const response = await fetch(img.src)
          svgString = await response.text()
        } catch (err) {
          console.error('Failed to fetch SVG from blob:', err)
          return
        }
      } else if (svg) {
        svgString = svg.outerHTML
      } else {
        console.error('No <img> or <svg> found in block:', blockId, doc.documentElement.innerHTML)
        return
      }

      if (!svgString.startsWith('<svg')) {
        console.error('SVG string is invalid:', svgString.slice(0, 100))
        return
      }

      try {
        const res = await svgStringToPngUint8(svgString, 1024)
        if (res) {
          await copyPngToClipboard(res)
          console.log('Copied PNG to clipboard')
        } else {
          console.error('SVG to PNG conversion failed')
        }
      } catch (err) {
        console.error('Error converting/copying PNG:', err)
      }
    },
  },
])
setupListener()

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

export const md2Html = async (src: string, darkMode = false, allowHtml = false) => {
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

  const plugins = [
    emoji,
    sub,
    sup,
    ins,
    mark,
    footnote,
    deflist,
    createMermaidPlaceholders,
    codeButtons,
  ]
  plugins.forEach((plugin) => {
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
  const tokens = md.parse(src, env)
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
) => {
  const primary = hexToRgb(primaryColorHex)
  const secondary = hexToRgb(secondaryColorHex)
  return `<html>
    <head>
      ${linkTags}
      <link rel="stylesheet" href="${katexCssHref}">
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
          console.log('Iframe content size:', width, height);
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

        // Inside your-iframe-content.html
        document.addEventListener('click', function(event) {
            window.parent.postMessage({ type: 'iframeClick', x: event.clientX, y: event.clientY }, '*');
        });

      </script>
    </body>
  </html>
  `
}
