<template>
  <!--Task-->
  <div class="message-container">
    <div class="relative-position">
      <!--Message Display-->
      <div class="row items-end q-gutter-xs">
        <!--task icon-->
        <div
          v-if="task.state === 'Error' || task.result?.toolResult?.error"
          class="col-auto self-center"
        >
          <q-icon :name="matWarning" color="negative" size="sm"
            ><q-tooltip class="bg-warning">Error!</q-tooltip>
          </q-icon>
        </div>
        <div v-else-if="task.role === 'system'" class="col-auto self-center">
          <q-icon :name="mdiDesktopTower" color="info" size="sm"></q-icon>
        </div>
        <!--task content-->
        <div v-if="'functionCall' in task.content" class="col q-pb-md">
          <q-expansion-item
            dense
            :header-class="
              task.state === 'Error' || task.result?.toolResult?.error
                ? 'text-negative'
                : isWorking
                  ? 'text-info'
                  : 'text-green'
            "
          >
            <template #header>
              <div class="row q-gutter-sm items-center">
                <q-spinner-orbit v-if="isWorking" size="2em"></q-spinner-orbit>
                <q-icon :name="matCalculate" size="1.5em"></q-icon>
                <div>{{ task.content.functionCall.name }}</div>
              </div>
            </template>
            <ToolResultWidget :task="task" />
          </q-expansion-item>
        </div>
        <div v-if="'toolResult' in task.content" class="col q-pb-md">
          <q-expansion-item
            dense
            :icon="mdiHeadCog"
            label="Analyze the Result:"
          >
            <q-expansion-item dense label="Result:">
              <p style="white-space: pre-wrap">
                {{ dump(task.content) }}
              </p>
            </q-expansion-item>
            <q-separator />
            <p style="white-space: pre-wrap">
              {{ task.result?.chatResponse?.choices[0]?.message.content }}
            </p>
          </q-expansion-item>
        </div>
        <div v-else-if="'structuredResponse' in task.content" class="col">
          <div class="raw-markdown q-mb-md">
            {{ task.content.structuredResponse }}
          </div>
        </div>
        <div v-else-if="'message' in task.content" class="col">
          <q-expansion-item
            v-if="taskFunction"
            dense
            :icon="mdiTools"
            :label="`function: ${taskFunction.name}`"
          >
            <p style="white-space: pre-wrap">
              {{ task.content.message }}
            </p>
          </q-expansion-item>
          <ty-markdown
            v-else-if="
              state.taskState[task.id]?.markdownEnabled != false &&
              'message' in task.content
            "
            no-line-numbers
            style="min-width: 50px"
            :src="task.content.message"
          />
          <div v-else class="raw-markdown q-mb-md">
            {{ task.content.message }}
          </div>
        </div>
        <div v-else-if="'uploadedFiles' in task.content" class="col">
          <q-list>
            <q-item v-for="file in fileMappings" :key="file?.uuid">
              <q-item-section side>
                <q-icon :name="mdiFileDocument" size="sm"></q-icon>
              </q-item-section>
              <q-item-section class="ellipsis">{{
                file?.name || file?.opfs
              }}</q-item-section>
              <q-tooltip v-if="state.appConfiguration.expertMode" :delay="500">
                <p class="text-bold">uploaded file:</p>
                <p style="white-space: pre-wrap">
                  {{ dump(file) }}
                </p></q-tooltip
              >
            </q-item>
          </q-list>
        </div>
        <!--task costs-->
        <div
          v-if="state.appConfiguration.showCosts"
          style="font-size: xx-small"
          class="col-auto column items-center print-hide task-costs"
        >
          <div v-if="task.debugging.taskCosts">
            {{ humanReadableTaskCosts }}
          </div>
          <q-icon
            :name="matMonetizationOn"
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
      <TaskButtons
        class="message-buttons absolute-bottom-left print-hide rounded-borders"
        :task="task"
        :toggle-markdown="toggleMarkdown"
        :create-new-conversation="createNewConversation"
        :edit-task="editTask"
        :toggle-message-debug="toggleMessageDebug"
      />
    </div>
    <!--task debugging-->
    <q-slide-transition>
      <div v-show="state.messageDebug[task.id]">
        <q-separator spaced />
        <q-select
          class="fit q-pb-xs"
          dense
          label="Task Labels"
          filled
          :model-value="task.label || []"
          use-input
          use-chips
          multiple
          input-debounce="300"
          new-value-mode="add-unique"
          @update:model-value="updateLabels"
        >
          <template #prepend>
            <q-icon :name="matNewLabel" />
          </template>
        </q-select>
        <q-tabs v-model="state.messageDebug[task.id]" dense no-caps>
          <q-tab name="ERROR" label="Error" />
          <q-tab name="RAW" label="raw task data" />
          <q-tab
            v-if="task.debugging.taskPrompt"
            name="TASKPROMPT"
            label="task prompt"
          />
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
                task.result?.chatResponse?.choices[0]?.message.content || 'N/A'
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
          <q-tab-panel name="TASKPROMPT">
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

<script setup lang="ts">
import ToolResultWidget from 'components/ToolResultWidget.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import TokenUsage from 'components/TokenUsage.vue';
import { LLMTask, partialTaskDraft, ToolBase } from 'src/modules/taskyon/types';
import tyMarkdown from './tyMarkdown.vue';
import { computed, ref } from 'vue';
import { FileMappingDocType } from 'src/modules/taskyon/rxdb';
import { dump } from 'js-yaml';
import TaskButtons from './TaskButtons.vue';
import {
  mdiDesktopTower,
  mdiFileDocument,
  mdiHeadCog,
  mdiTools,
} from '@quasar/extras/mdi-v6';
import {
  matCalculate,
  matMonetizationOn,
  matNewLabel,
  matWarning,
} from '@quasar/extras/material-icons';
import { openrouterPricing } from 'src/modules/taskyon/utils';

const props = defineProps<{
  task: LLMTask;
  isWorking?: boolean;
}>();

const state = useTaskyonStore();
const fileMappings = ref<(FileMappingDocType | null)[]>([]);

if ('uploadedFiles' in props.task.content) {
  console.log('get uploaded files');
  void (async (fileUuids: string[]) => {
    const tm = await state.getTaskManager();
    const fm = await Promise.all(
      fileUuids.map((uuid) => tm.getFileMappingByUuid(uuid)),
    );
    fileMappings.value = fm;
  })(props.task.content.uploadedFiles);
}

const taskFunction = computed(() => {
  if (
    props.task.label?.includes('function') &&
    'message' in props.task.content
  ) {
    try {
      const res = ToolBase.safeParse(JSON.parse(props.task.content.message));
      return res.success ? res.data : undefined;
    } catch (err) {
      return undefined;
    }
  } else {
    return undefined;
  }
});

async function taskDraftFromTask(taskId: string) {
  // we are copying the current task with json stringify
  const jsonTask = JSON.stringify(
    await (await state.getTaskManager()).getTask(taskId),
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const task = LLMTask.partial().parse(JSON.parse(jsonTask));
  task.debugging = {};
  task.state = 'Open';
  state.llmSettings.taskDraft = partialTaskDraft.parse(task);
  return task;
}

const humanReadableTaskCosts = computed(() => {
  if (props.task.debugging.taskCosts) {
    return openrouterPricing(props.task.debugging.taskCosts);
  } else {
    return '';
  }
});

async function editTask(taskId: string) {
  const task = await taskDraftFromTask(taskId);
  state.llmSettings.selectedTaskId = task.parentID;
}

async function createNewConversation(taskId: string) {
  await taskDraftFromTask(taskId);

  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.llmSettings.selectedTaskId = undefined;
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
  state.taskState[id]!.markdownEnabled = !state.taskState[id]!.markdownEnabled;
  console.log(`markdown for ${id}`, state.taskState[id]!.markdownEnabled);
}

async function updateLabels(labels: string[]) {
  console.log(labels);
  const tm = await state.getTaskManager();
  await tm.updateTask(
    {
      id: props.task.id,
      label: labels,
    },
    true,
  );
}
</script>

<style lang="sass" scoped>
.message-container
    .message-buttons
        position: absolute
        bottom: -2px  // To move up by 6px
        left: 20px   // To move left by 6px
        opacity: 0
        transition: opacity 0.3s
        background-color: rgba($secondary, .2)

    &:hover
        .message-buttons
            opacity: 1

.raw-markdown
  white-space: pre-wrap // This will display newlines and wrap text
</style>
