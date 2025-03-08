import type MarkdownIt from 'markdown-it'
//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
//import katex from  '@mdit/plugin-katex-slim'
import type { MermaidConfig } from 'mermaid'
import mermaid from 'mermaid'
import '@quasar/quasar-ui-qmarkdown/dist/index.css'
// !!!!!!!!!!! it is superimportant, that our "prismjs" imports come AFTER the QMarkdown import !!!!!
// otherwise this will result in errors for some reason...
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import { uid } from 'quasar'
import type Renderer from 'markdown-it/lib/renderer'

export const containsHtmlTags = (markdown: string) => {
  // Regex to match any HTML tag
  const tagPattern = /<\/?[a-z][a-z0-9]*\b[^>]*>/gi
  return tagPattern.test(markdown)
}

export function addCopyButtons(md: MarkdownIt) {
  const defaultFenceRenderer =
    md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => {
      return self.renderToken(tokens, idx, options)
    })

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    // console.log('render code fence blocks...');
    // Original rendered HTML of the code block
    const originalRenderedHtml = defaultFenceRenderer(tokens, idx, options, env, self)

    // Custom HTML for the button
    const customHtml = `
        <div class="code-block-with-overlay q-ma-xs">
          ${originalRenderedHtml}
          <button class="copy-button q-btn q-btn-item non-selectable transparent q-btn--flat q-btn--rectangle
            q-btn--actionable q-focusable q-hoverable q-btn--dense copy-button print-hide">
            <span class="q-focus-helper"></span>
            <span class="q-btn__content text-center col items-center q-anchor--skip justify-center row">
              <i class="q-icon" aria-hidden="true" role="img">
                <svg viewBox="0 0 24 24">
                  <path d="M0 0h24v24H0z" style="fill: none;">
                  </path>
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0
                  1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z">
                  </path>
                </svg>
              </i>
            </span>
          </button>
        </div>
      `

    //const customHtml = originalRenderedHtml;

    //const customHtml = tokens[idx].content;

    return customHtml
  }
}

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
