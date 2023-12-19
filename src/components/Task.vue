<template>
  <!--Task-->
  <div class="message-container">
    <div class="relative-position">
      <!--Message Display-->
      <div class="row items-end q-gutter-xs">
        <!--task icon-->
        <div v-if="task.state == 'Error'" class="col-auto">
          <q-icon name="warning" color="warning" size="sm"
            ><q-tooltip class="bg-warning">Error!</q-tooltip>
          </q-icon>
        </div>
        <div v-if="task.role == 'function'" class="col">
          <q-expansion-item
            dense
            icon="calculate"
            :label="task.configuration?.function?.name"
            :header-class="task.state == 'Error' ? 'text-red' : 'text-green'"
          >
            <ToolResultWidget :task="task" />
          </q-expansion-item>
        </div>
        <div v-else-if="task.content" class="col">
          <q-markdown
            no-line-numbers
            :plugins="[markdownItMermaid, addCopyButtons]"
            :src="task.content"
            @click="handleMarkdownClick"
          />
        </div>
        <!--task costs-->
        <div
          v-if="state.appConfiguration.showCosts"
          style="font-size: xx-small"
          class="col-auto column items-center"
        >
          <div v-if="task.debugging.taskCosts">
            {{ Math.round(task.debugging.taskCosts * 1e6).toLocaleString() }}
            μ$
          </div>
          <q-icon
            name="monetization_on"
            size="xs"
            :color="
              task.debugging.taskCosts
                ? 'secondary'
                : task.debugging.promptTokens
                ? 'positive'
                : 'info'
            "
          ></q-icon>
          <div v-if="task.debugging.promptTokens">
            {{ task.debugging.promptTokens }}
          </div>
          <div v-else>
            {{
              (task.debugging.estimatedTokens?.promptTokens || 0) +
              (task.debugging.estimatedTokens?.resultTokens || 0)
            }}
          </div>
          <q-tooltip :delay="1000">
            <TokenUsage :task="task" />
          </q-tooltip>
        </div>
      </div>
      <!--buttons-->
      <div
        class="q-gutter-xs row justify-start items-stretch message-buttons absolute-bottom-left print-hide transparent"
      >
        <q-btn
          v-if="state.appConfiguration.expertMode"
          class="col-auto"
          icon="code"
          dense
          flat
          size="sm"
          @click="toggleMessageDebug(task.id)"
        >
          <q-tooltip :delay="0">Show message context</q-tooltip>
        </q-btn>
        <q-btn
          v-if="task.childrenIDs.length > 0"
          class="col-auto"
          size="sm"
          dense
          flat
          @click="state.chatState.selectedTaskId = task.id"
        >
          <q-icon class="rotate-180" name="alt_route"></q-icon>
          <q-tooltip :delay="0"
            >Start alternative conversation thread from here</q-tooltip
          >
        </q-btn>
        <q-btn
          class="col-auto"
          icon="edit"
          dense
          flat
          size="sm"
          @click="editTask(task.id)"
        >
          <q-tooltip :delay="0">Edit Task/Message</q-tooltip>
        </q-btn>
      </div>
    </div>
    <!--task debugging-->
    <q-slide-transition>
      <div v-show="state.messageDebug[task.id]">
        <q-separator spaced />
        <q-tabs dense v-model="state.messageDebug[task.id]" no-caps>
          <q-tab name="ERROR" label="Error" />
          <q-tab name="FOLLOWUPERROR" label="Follow-up task error" />
          <q-tab name="RAW" label="raw task data" />
          <q-tab name="RAWTASK" label="task prompt" />
          <q-tab name="MESSAGECONTENT" label="raw result" />
        </q-tabs>
        <q-tab-panels
          v-model="state.messageDebug[task.id]"
          animated
          swipeable
          horizontal
          transition-prev="jump-right"
          transition-next="jump-left"
        >
          <q-tab-panel name="ERROR">
            <textarea
              :value="JSON.stringify(task.debugging.error, null, 2)"
              readonly
              wrap="soft"
              style="
                width: 100%;
                height: 200px;
                background-color: inherit;
                color: inherit;
              "
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel name="FOLLOWUPERROR">
            <textarea
              :value="JSON.stringify(task.debugging.followUpError, null, 2)"
              readonly
              wrap="soft"
              style="
                width: 100%;
                height: 200px;
                background-color: inherit;
                color: inherit;
              "
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel name="RAW">
            <textarea
              :value="JSON.stringify(task, null, 2)"
              readonly
              wrap="soft"
              style="
                width: 100%;
                height: 200px;
                background-color: inherit;
                color: inherit;
              "
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel name="MESSAGECONTENT">
            <textarea
              :value="
                task.result?.chatResponse?.choices[0].message.content || 'ERROR'
              "
              readonly
              wrap="soft"
              style="
                width: 100%;
                height: 200px;
                background-color: inherit;
                color: inherit;
              "
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel name="RAWTASK">
            <textarea
              v-for="(tp, idx) in task.debugging.taskPrompt"
              :key="idx"
              :value="typeof tp.content === 'string' ? tp.content : ''"
              readonly
              wrap="soft"
              style="
                width: 100%;
                height: 200px;
                background-color: inherit;
                color: inherit;
              "
            >
            </textarea>
          </q-tab-panel>
        </q-tab-panels>
      </div>
    </q-slide-transition>
  </div>
</template>

<style lang="sass" scoped>
::v-deep(.code-block-with-overlay)
  position: relative

  .copy-button
    position: absolute
    top: 0
    right: 0

.message-container
    .message-buttons
        position: absolute
        bottom: -2px  // To move up by 6px
        left: -2px   // To move left by 6px
        opacity: 0
        transition: opacity 0.3s

    &:hover
        .message-buttons
            opacity: 1

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
import ToolResultWidget from 'components/ToolResultWidget.vue';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import TokenUsage from 'components/TokenUsage.vue';
import type { LLMTask } from 'src/modules/types';
import type MarkdownIt from 'markdown-it/lib';
import markdownItMermaid from '@datatraccorporation/markdown-it-mermaid';
import { getTaskManager } from 'src/boot/taskyon';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';

type markdownItMermaid = MarkdownIt.PluginSimple;

defineProps<{
  task: LLMTask;
}>();

const state = useTaskyonStore();
const taskManagerPromise = getTaskManager();

async function editTask(taskId: string) {
  const jsonTask = JSON.stringify(
    await (await taskManagerPromise).getTask(taskId)
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const task: Partial<LLMTask> = JSON.parse(jsonTask);
  task.id = 'draft';
  task.debugging = {};
  task.childrenIDs = [];
  task.state = 'Open';
  delete task.result;
  state.taskDraft = task;
  state.chatState.selectedTaskId = task.parentID;
}

function toggleMessageDebug(id: string) {
  if (state.messageDebug[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.messageDebug[id] = 'RAW';
  } else {
    // If it does exist, toggle the boolean.
    state.messageDebug[id] = undefined;
  }
}

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
              <i class="q-icon notranslate material-icons" aria-hidden="true" role="img">content_copy</i>
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
