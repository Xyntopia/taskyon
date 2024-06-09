<template>
  <q-markdown
    :plugins="[switchThemeMermaid, addCopyButtons, mathjax3]"
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
.mermaid svg
  .messageLine0
    stroke: $secondary !important
  .messageText
    stroke: $secondary !important
    fill: $secondary !important
</style>

<script setup lang="ts">
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
import markdownItMermaid from '@datatraccorporation/markdown-it-mermaid';
//import { createMathjaxInstance, mathjax } from '@mdit/plugin-mathjax';
//import katex from  '@mdit/plugin-katex-slim'
import mathjax3 from 'markdown-it-mathjax3';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import type MarkdownIt from 'markdown-it/lib';
// !!!!!!!!!!! it is superimportant, that our "prismjs" imports come AFTER the QMarkdown import !!!!!
// otherwise this will result in errors for some reason...
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import { useQuasar } from 'quasar';
const $q = useQuasar();

const switchThemeMermaid: MarkdownIt.PluginSimple = (md: MarkdownIt) => {
  (
    markdownItMermaid as (md: MarkdownIt, opts: Record<string, unknown>) => void
  )(md, {
    startOnLoad: false,
    securityLevel: 'true',
    theme: $q.dark.isActive ? 'dark' : 'default',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: true,
    },
  });
};

// https://mdit-plugins.github.io/mathjax.html#usage
//const mathjaxInstance = createMathjaxInstance();

defineProps<{
  src: string;
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

function handleMarkdownClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('.copy-button');
  if (target) {
    // Find the closest .code-block-with-overlay and then find the <code> element inside it
    const codeBlockContainer = target.closest('.code-block-with-overlay');
    if (codeBlockContainer) {
      const codeElement = codeBlockContainer.querySelector('code');
      if (codeElement) {
        const codeText = codeElement.textContent || ''; // Get the text content of the <code> element
        copyToClipboard(codeText);
      }
    }
  }
}
</script>
