<template>
  <q-markdown
    no-line-numbers
    :plugins="[switchThemeMermaid, addCopyButtons, mathjax3]"
    :src="src"
    @click="handleMarkdownClick"
  />
</template>

<style lang="sass" scoped>
::v-deep(.code-block-with-overlay)
  position: relative

  .copy-button
    position: absolute
    top: 0
    right: 0

// this is in order to make mermaid sequence diagrams work on dark backgrounds
::v-deep(.mermaid svg)
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
        <div class="code-block-with-overlay">
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
