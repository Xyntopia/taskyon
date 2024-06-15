<template>
  <q-markdown
    :id="id"
    :plugins="plugins"
    :src="src"
    @click="handleMarkdownClick"
    v-bind="$attrs"
  />
</template>

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
  color: $primary

.q-markdown--note--info .q-markdown--note-title
  color: $accent

.q-markdown p
  text-align: justify

.q-markdown--note--info
  background-color: lighten($secondary, 35%)
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

<script setup lang="ts">
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
//import katex from  '@mdit/plugin-katex-slim'
import mathjax3 from 'markdown-it-mathjax3';
import mermaid from 'mermaid';
import type { MermaidConfig } from 'mermaid';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import type MarkdownIt from 'markdown-it/lib';
// !!!!!!!!!!! it is superimportant, that our "prismjs" imports come AFTER the QMarkdown import !!!!!
// otherwise this will result in errors for some reason...
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import { uid, useQuasar } from 'quasar';
import { computed, onMounted, getCurrentInstance } from 'vue';
import Renderer from 'markdown-it/lib/renderer';
import { svgToPng } from 'src/modules/svgUtils';
const $q = useQuasar();

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

const id = getCurrentInstance()?.uid || '';

const props = defineProps<{
  src: string;
  noMermaid?: boolean;
}>();

function addCopyButtons(md: MarkdownIt) {
  const defaultFenceRenderer =
    md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => {
      return self.renderToken(tokens, idx, options);
    });

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    console.log('render code fence blocks...');
    // Original rendered HTML of the code block
    const originalRenderedHtml = defaultFenceRenderer(
      tokens,
      idx,
      options,
      env,
      self
    );

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
      `;

    //const customHtml = originalRenderedHtml;

    //const customHtml = tokens[idx].content;

    return customHtml;
  };
}

function copyToClipboard(code: string) {
  navigator.clipboard
    .writeText(code)
    .then(() => {
      console.log('Copied to clipboard');
    })
    .catch((err) => {
      console.error('Error in copying text: ', err);
    });
}

async function copyPngToClipboard(pngBuffer: Uint8Array) {
  const blob = new Blob([pngBuffer], { type: 'image/png' });
  //const url = URL.createObjectURL(blob);

  if (typeof ClipboardItem !== 'undefined') {
    try {
      const clipboardItem = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([clipboardItem]);
      console.log('Image copied to clipboard successfully!');
      //URL.revokeObjectURL(url); // revoke the URL to free up memory
    } catch (err) {
      console.error('Failed to copy image to clipboard:', err);
    }
  } else {
    console.warn(
      'ClipboardItem is not supported in this browser. Using fallback method.'
    );

    alert(
      'Your browser is too old to support image copying with "ClipboardItem", please upgrade your browser!'
    );
  }
}

function handleMarkdownClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('.copy-button');
  if (target) {
    // Find the closest .code-block-with-overlay and then find the <code> element inside it
    const codeBlockContainer = target.closest('.code-block-with-overlay');
    if (codeBlockContainer) {
      const imgElement = codeBlockContainer.querySelector('.mermaid img');
      if (imgElement && imgElement instanceof HTMLImageElement) {
        const svgUrl = imgElement.src;
        fetch(svgUrl)
          .then((response) => response.text())
          .then((svgString) => {
            void svgToPng(svgString).then((res) => {
              if (res) {
                void copyPngToClipboard(res);
                $q.notify({
                  message: 'Copied image to clipboard as png!',
                  type: 'info',
                  position: 'right',
                  timeout: 500,
                  html: false,
                });
              }
            });
          })
          .catch((err) => console.error('Error fetching SVG: ', err));
      }
      const codeElement = codeBlockContainer.querySelector('code');
      if (codeElement) {
        const codeText = codeElement.textContent || ''; // Get the text content of the <code> element
        copyToClipboard(codeText);
        $q.notify({
          message: 'Copied text to clipboard!',
          type: 'info',
          position: 'right',
          timeout: 500,
          html: false,
        });
        return;
      }
    }
  }
}

const mermaidSettings: MermaidConfig = {
  startOnLoad: false, // if false: prevent mermaid.run  to start automatically after load...
  securityLevel: 'loose',
  theme: $q.dark.isActive ? 'dark' : 'default',
  flowchart: {
    htmlLabels: false,
    useMaxWidth: true,
  },
};

const renderMermaid = (md: MarkdownIt) => {
  /*
  not sure, if we will need this...
  const htmlEntities = (str: unknown) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');*/

  // if we are using the plugin, initialize mermaid as well :)
  mermaid.initialize(mermaidSettings);

  // Example of using the render function
  const drawDiagram = async function (
    code: string,
    selector: string,
    img_id: string
  ) {
    const graphDefinition = code;
    const velement = document.createElement('div');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(velement);
    document.body.appendChild(velement);
    let innerHTML: string;
    try {
      const { svg } = await mermaid.render(
        `mg${selector}`,
        graphDefinition,
        velement
      );
      const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(svgBlob);
      innerHTML = `<img src="${svgUrl}" alt="Mermaid diagram" />`;
    } catch (err) {
      console.log('error rendering mermaid!!', err);
      innerHTML = `${code}\n<div>${JSON.stringify(err)}</div>`;
    } finally {
      velement.remove();
    }

    const element = document.querySelector(`#${img_id}`);
    if (element) element.innerHTML = innerHTML;

    // Create a save as button
    // TODO: right now, the "svg"  includes the iframe with the svg...
    /*const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy SVG';
        element.appendChild(copyButton);

        // Add event listener to copy button
        copyButton.addEventListener('click', () => {
          void navigator.clipboard.writeText(svg);
        });*/
  };

  let defaultRenderer: Renderer.RenderRule;
  if (md.renderer.rules.fence) {
    defaultRenderer = md.renderer.rules.fence.bind(md.renderer.rules);
  }

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
      const mid = uid();
      const img_id = `d${mid}`;
      const mm_code = token.content.trim();
      void drawDiagram(mm_code, mid, img_id);

      return `<div id="${img_id}" class="mermaid">${mm_code}</div>`;
    }
    return defaultRenderer(tokens, idx, options, env, self);
  };
};

const plugins = computed(() => {
  if (props.noMermaid) {
    return [addCopyButtons, mathjax3];
  }
  return [renderMermaid, addCopyButtons, mathjax3];
});

onMounted(() => {
  // if we are using the plugin, initialize mermaid as well :)
  mermaid.initialize(mermaidSettings);
  let parentElement = document.getElementById('unique-id');
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
});
</script>
