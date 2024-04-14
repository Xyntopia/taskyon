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
        <div v-if="task.role == 'function'" class="col q-pb-md">
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
          <tyMarkdown
            style="min-width: 50px"
            v-if="state.taskState[task.id]?.markdownEnabled != false"
            :src="task.content"
          />
          <div v-else class="raw-markdown q-mb-md">{{ task.content }}</div>
        </div>
        <!--task costs-->
        <div
          v-if="state.appConfiguration.showCosts"
          style="font-size: xx-small"
          class="col-auto column items-center"
        >
          <div v-if="task.debugging.taskCosts">
            {{ humanReadableTaskCosts }}
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
        class="row justify-start items-stretch message-buttons absolute-bottom-left print-hide rounded-borders"
      >
        <q-btn
          class="col-auto"
          :icon="
            state.taskState[task.id]?.markdownEnabled != false
              ? 'mdi-language-markdown'
              : 'raw_on'
          "
          dense
          flat
          size="sm"
          @click="toggleMarkdown(task.id)"
        >
          <q-tooltip :delay="0">Toggle Markdown</q-tooltip>
        </q-btn>
        <q-separator vertical class="q-mx-sm" />
        <q-btn
          class="col-auto"
          size="sm"
          dense
          flat
          @click="createNewConversation(task.id)"
        >
          <q-icon name="mdi-star-four-points" size="xs"></q-icon>
          <q-tooltip :delay="0">
            Start a new thread with this message!
          </q-tooltip>
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
            >Start alternative conversation branch from here</q-tooltip
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
        <q-separator
          v-if="state.appConfiguration.expertMode"
          vertical
          class="q-mx-sm"
        />
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
.message-container
    .message-buttons
        position: absolute
        bottom: -2px  // To move up by 6px
        left: -2px   // To move left by 6px
        opacity: 0
        transition: opacity 0.3s
        background-color: rgba($secondary, .2)

    &:hover
        .message-buttons
            opacity: 1

.raw-markdown
  white-space: pre-wrap // This will display newlines and wrap text
</style>

<script setup lang="ts">
import ToolResultWidget from 'components/ToolResultWidget.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import TokenUsage from 'components/TokenUsage.vue';
import type { LLMTask } from 'src/modules/taskyon/types';
import { getTaskManager } from 'src/boot/taskyon';
import tyMarkdown from './tyMarkdown.vue';
import { computed } from 'vue';

const props = defineProps<{
  task: LLMTask;
}>();

const state = useTaskyonStore();
const taskManagerPromise = getTaskManager();

async function taskDraftFromTask(taskId: string) {
  // we are copying the current task with json stringify
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
  return task;
}

const humanReadableTaskCosts = computed(() => {
  if (props.task.debugging.taskCosts) {
    if (props.task.debugging.taskCosts > 1.0) {
      return `${(props.task.debugging.taskCosts).toFixed(1)} $`;
    } else if (props.task.debugging.taskCosts > 0.001) {
      return `${(props.task.debugging.taskCosts * 1e2).toFixed(1)} ¢`;
    }
    return `${Math.round(props.task.debugging.taskCosts * 1e6).toLocaleString()} μ$`;
  }
  return '';
});

async function editTask(taskId: string) {
  const task = await taskDraftFromTask(taskId);
  state.chatState.selectedTaskId = task.parentID;
}

async function createNewConversation(taskId: string) {
  await taskDraftFromTask(taskId);

  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.chatState.selectedTaskId = undefined;
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

function toggleMarkdown(id: string) {
  if (state.taskState[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.taskState[id] = {
      markdownEnabled: true,
    };
  }
  // If it does exist, toggle the boolean.
  state.taskState[id].markdownEnabled = !state.taskState[id].markdownEnabled;
  console.log(`markdown for ${id}`, state.taskState[id].markdownEnabled);
}
</script>
