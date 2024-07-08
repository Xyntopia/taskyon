<template>
  <!--Create new task area-->
  <div>
    <!--Task Creation-->
    <div>
      <div>
        <taskContentEdit
          class="text-body1"
          v-if="
            !selectedTaskType &&
            !codingMode &&
            'message' in state.llmSettings.taskDraft.content
          "
          :model-value="state.llmSettings.taskDraft.content.message"
          @update:modelValue="updateContent"
          :execute-task="addNewTask"
          :attach-file-to-chat="attachFileToDraft"
          :use-enter-to-send="state.appConfiguration.useEnterToSend"
        />
        <div
          v-else-if="
            !selectedTaskType &&
            codingMode &&
            'message' in state.llmSettings.taskDraft.content
          "
        >
          <CodeEditor
            :model-value="state.llmSettings.taskDraft.content.message"
            @update:modelValue="updateContent"
          />
          <taskSettingsButton
            v-model="expandedTaskCreation"
            aria-label="task settings"
          />
          <q-btn
            :disable="!sendAllowed"
            :color="sendAllowed ? 'positive' : 'negative'"
            :icon="matSave"
            label="save task"
            @click="addNewTask(false)"
            ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
          >
        </div>
        <div
          v-else-if="
            selectedTaskType &&
            'functionCall' in state.llmSettings.taskDraft.content
          "
          class="row"
        >
          <ObjectTreeView
            class="col"
            :model-value="
              state.llmSettings.taskDraft.content.functionCall.arguments
            "
            input-field-behavior="auto"
            :separate-labels="false"
          />
        </div>
      </div>
      <!--Task Creation State-->
      <div class="q-px-sm q-pt-xs text-caption">
        <div class="row items-center">
          <div class="row">
            <info-dialog
              v-if="
                currentModel && state.modelLookUp[currentModel]?.description
              "
              size="xs"
              :info-text="state.modelLookUp[currentModel]?.description"
            />
            <q-btn flat dense size="sm" no-caps>
              <div class="ellipsis">
                {{ `${currentModel}` }}
              </div>
              <q-tooltip>Select AI Model</q-tooltip>
              <q-menu color="secondary">
                <q-list style="min-width: 100px">
                  <q-item-label header>Select previous AI model!</q-item-label>
                  <q-item v-if="state.modelHistory.length === 0" v-close-popup>
                    No other models were selected yet!
                  </q-item>
                  <q-item
                    v-for="(m, idx) in state.modelHistory"
                    :key="m"
                    clickable
                    v-close-popup
                    @click="handleBotNameUpdate({ newName: m })"
                  >
                    <q-item-section
                      >{{ state.modelHistory.length - idx }}:
                      {{ m }}</q-item-section
                    >
                  </q-item>
                  <q-item
                    clickable
                    v-close-popup
                    @click="expandedTaskCreation = !expandedTaskCreation"
                  >
                    <q-item-section avatar>
                      <q-icon :name="matSmartToy"></q-icon>
                    </q-item-section>
                    <q-item-section> More AI Settings </q-item-section>
                    <q-item-section side>
                      <q-icon :name="matNavigateNext"></q-icon>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
          <q-space></q-space>
          <div class="gt-xs" v-if="currentModel">
            {{
              `approx. new token count: ${estimatedTokens}/${state.modelLookUp[currentModel]?.context_length}`
            }}
            <q-tooltip :delay="1000" class="q-gutter-sm">
              <div>
                [token number of prompt] / [max number of tokens which AI can
                understand]
              </div>
              <div>Tokens are roughly similar to syllables.</div>
            </q-tooltip>
          </div>
          <div class="lt-sm">{{ `t/c: ${estimatedTokens}` }}</div>
          <q-space></q-space>
          <div>
            <q-btn
              flat
              size="sm"
              @click="expandedTaskCreation = !expandedTaskCreation"
              aria-label="toggle task settings"
            >
              <q-icon size="xs" :name="matTune" class="q-pl-sm"></q-icon>
              <q-icon
                size="xs"
                :name="
                  expandedTaskCreation
                    ? matKeyboardArrowUp
                    : matKeyboardArrowDown
                "
              ></q-icon>
              <q-tooltip>Chat Settings</q-tooltip>
            </q-btn>
          </div>
        </div>
        <div v-if="fileAttachments.length">
          <div>Attached files:</div>
          <q-chip
            v-for="file in fileAttachments"
            :key="file.name"
            removable
            @remove="
              fileAttachments = fileAttachments.filter((f) => f !== file)
            "
            :icon="matUploadFile"
          >
            <div class="ellipsis" style="max-width: 100px">
              {{ `${file.name}` }}
            </div>
            <q-tooltip :delay="0.5">{{ `${file.name}` }}</q-tooltip>
          </q-chip>
        </div>
      </div>
      <!--Task type selection and execution-->
      <div
        class="row items-center"
        v-if="selectedTaskType || expandedTaskCreation"
      >
        <q-btn
          v-if="selectedTaskType"
          class="q-ma-md"
          label="Execute Task"
          @click="addNewTask()"
        />
        <q-btn
          v-if="selectedTaskType"
          flat
          dense
          :icon="matChat"
          @click="setTaskType(undefined)"
          ><q-tooltip>Select Simple Chat</q-tooltip>
        </q-btn>

        <q-select
          v-if="expertMode"
          style="min-width: 200px"
          class="q-pt-xs q-px-md"
          dense
          outlined
          color="secondary"
          clearable
          :bg-color="selectedTaskType ? 'secondary' : ''"
          :model-value="selectedTaskType"
          @update:modelValue="setTaskType"
          :options="Object.keys(toolCollection)"
          :label="selectedTaskType ? 'selected Tool' : 'Select Tool'"
        />
        <ToggleButton
          v-if="expertMode"
          v-model="state.llmSettings.useBasePrompt"
          outline
          dense
          :on-icon="mdiAutoFix"
          :off-icon="mdiAlphabeticalVariant"
          size="md"
        >
          <div class="q-pl-sm gt-xs">Fancy AI</div>
          <q-tooltip :delay="200">
            {{ llmSettings.shape.useBasePrompt.description }}
          </q-tooltip>
        </ToggleButton>
        <ToggleButton
          v-if="expertMode"
          v-model="state.llmSettings.tryUsingVisionModels"
          outline
          dense
          :on-icon="matVisibility"
          :off-icon="matVisibilityOff"
        >
          <div class="q-pl-sm gt-xs">Vision</div>
          <q-tooltip :delay="200">
            {{ llmSettings.shape.tryUsingVisionModels.description }}
          </q-tooltip>
        </ToggleButton>
        <!--
        <q-toggle
          v-if="expertMode"
          :icon="matHandyman"
          left-label
          color="secondary"
          dense
          size="xl"
          v-model="state.llmSettings.enableOpenAiTools"
          ><q-tooltip
            >Enable OpenAI Functions (use built-in function selection mode for
            OpenAI)</q-tooltip
          ></q-toggle
        >-->
        <q-btn
          v-if="expertMode"
          class="q-ma-md"
          dense
          flat
          :icon="matCode"
          @click="state.showTaskData = !state.showTaskData"
          ><q-tooltip>Show Draft Task Data</q-tooltip></q-btn
        >
      </div>
    </div>
    <q-slide-transition>
      <q-list dense v-show="expandedTaskCreation">
        <div v-if="showTaskData && expertMode">
          {{ currentnewTask }}
        </div>
        <q-separator class="q-my-sm" />
        <!--Model Selection-->
        <q-item class="row items-center">
          <q-icon :name="matSmartToy" size="sm" class="q-pr-md"></q-icon>
          <ModelSelection
            class="col"
            @updateBotName="handleBotNameUpdate"
            :bot-name="currentModel || currentDefaultBotName || ''"
            v-model:selectedApi="selectedApi"
            v-model:useOpenAIAssistants="useOpenAIAssistants"
            v-model:open-a-i-assistant-id="openAIAssistantId"
          ></ModelSelection>
        </q-item>
        <!--Allowed Tools Selection-->
        <q-separator class="q-my-sm" />
        <q-item class="row items-center">
          <q-icon :name="mdiTools" size="sm" />
          <q-expansion-item
            class="col"
            dense
            :icon="matHandyman"
            expand-icon-toggle
            label="Tools"
            v-model="state.allowedToolsExpand"
          >
            <template v-slot:header>
              <div class="row items-center q-gutter-sm">
                <q-btn
                  dense
                  :icon="matChecklist"
                  label="toggle tools"
                  @click="toggleSelectedTools"
                />
                <q-btn
                  v-if="state.appConfiguration.expertMode"
                  dense
                  flat
                  :icon="matEdit"
                  label="> manage tools"
                  to="tools"
                />
              </div>
            </template>
            <q-item-section>
              <q-option-group
                class="q-ma-md"
                v-model="allowedTools"
                :options="
                  Object.keys(toolCollection).map((name) => ({
                    label: name,
                    value: name,
                    description: toolCollection[name].description,
                  }))
                "
                color="secondary"
                type="checkbox"
                inline
                dense
              >
                <template v-slot:label="opt">
                  <div>
                    {{ opt.label }}
                  </div>
                  <q-tooltip anchor="bottom middle" style="max-width: 500px">{{
                    opt.description
                  }}</q-tooltip>
                </template></q-option-group
              >
            </q-item-section>
          </q-expansion-item>
          <q-space />
          <taskSettingsButton v-model="expandedTaskCreation" />
        </q-item>
      </q-list>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, toRefs } from 'vue';
import { countStringTokens } from 'src/modules/taskyon/chat';
import { getDefaultParametersForTool } from 'src/modules/taskyon/tools';
import {
  FunctionArguments,
  llmSettings,
  ToolBase,
} from 'src/modules/taskyon/types';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import { LLMTask } from 'src/modules/taskyon/types';
import ModelSelection from 'components/ModelSelection.vue';
import { writeFilesToOpfs } from 'src/modules/taskyon/OPFS';
import { addTask2Tree } from 'src/modules/taskyon/taskManager';
import ObjectTreeView from './ObjectTreeView.vue';
import taskSettingsButton from './taskSettingsButton.vue';
import taskContentEdit from './taskContentEdit.vue';
//import CodeEditor from './CodeEditor.vue';
import { defineAsyncComponent } from 'vue';
import { watchDebounced } from '@vueuse/core';
import InfoDialog from './InfoDialog.vue';
import ToggleButton from './ToggleButton.vue';
import {
  matSave,
  matUploadFile,
  matChat,
  matHandyman,
  matCode,
  matEdit,
  matChecklist,
  matSmartToy,
  matNavigateNext,
  matKeyboardArrowUp,
  matKeyboardArrowDown,
  matTune,
  matVisibility,
  matVisibilityOff,
} from '@quasar/extras/material-icons';
import {
  mdiAlphabeticalVariant,
  mdiAutoFix,
  mdiTools,
} from '@quasar/extras/mdi-v6';
import { deepMerge } from 'src/modules/taskyon/utils';
import { getApiConfig } from 'src/modules/taskyon/taskWorker';

const CodeEditor = defineAsyncComponent(
  /* webpackPrefetch: true */
  /* webpackChunkName: "codemirror" */
  /* webpackMode: "lazy" */
  /* webpackFetchPriority: "low" */
  () => import('./CodeEditor.vue'),
);

const props = defineProps<{
  codingMode?: boolean;
  forceTaskProps?: llmSettings['taskTemplate'];
  sendAllowed?: boolean;
}>();

function updateContent(value: string | null | undefined) {
  state.llmSettings.taskDraft.content = {
    message: value || '',
  };
}

const state = useTaskyonStore();
const { showTaskData, expandedTaskCreation } = toRefs(state);
const { expertMode } = toRefs(state.appConfiguration);
const { selectedApi, useOpenAIAssistants, openAIAssistantId } = toRefs(
  state.llmSettings,
);
const fileAttachments = ref<File[]>([]); // holds all attached files as a "tasklist"

// we initialize our taskDraft with the state of this window!

//const funcArgs = computed(() => );

async function getAllTools() {
  const foundTools = await (
    await state.getTaskManager()
  ).searchToolDefinitions();
  return foundTools;
}

const toolCollection = ref<Record<string, ToolBase>>({});
void getAllTools().then((tools) => (toolCollection.value = tools));

// Computed property to determine the currently selected bot name
const currentDefaultBotName = computed(() => {
  if (state.llmSettings.selectedApi === 'openai') {
    if (state.llmSettings.useOpenAIAssistants) {
      return state.llmSettings.openAIAssistantId;
    }
  }
  const modelName =
    state.llmSettings.taskDraft.configuration?.model ||
    getApiConfig(state.llmSettings)?.defaultModel;
  return modelName;
});

const currentModel = ref(toRaw(currentDefaultBotName.value));
const currentChatApi = ref<string>(toRaw(state.llmSettings.selectedApi) || '');

const allowedTools = computed({
  get() {
    return state.llmSettings.taskDraft.allowedTools || [];
  },
  set(newValue) {
    state.llmSettings.taskDraft.allowedTools = newValue;
  },
});

// Method to handle the updateBotName event
const handleBotNameUpdate = ({
  newName,
  newService,
}: {
  newName: string;
  newService?: string;
}) => {
  console.log('getting an api & bot update :)', newName, newService);
  currentModel.value = newName;
  if (newService) {
    currentChatApi.value = newService;
    state.llmSettings.selectedApi = newService;
  }
  const api = getApiConfig(state.llmSettings);
  if (api) {
    api.defaultModel = newName;
  }
  state.addModelToHistory(newName);
};

const selectedTaskType = computed(() => {
  const task = state.llmSettings.taskDraft;
  if (task.content && 'functionCall' in task.content) {
    return task.content.functionCall.name;
  }
  return undefined;
});

async function setTaskType(tasktype: string | undefined | null) {
  console.log('change tasktype to:', tasktype);
  if (tasktype) {
    state.llmSettings.taskDraft.role = 'function';
    const toolName = tasktype;
    const tool = (await getAllTools())[tasktype];
    if (!tool) {
      console.log(`Tool ${toolName} not found.`);
      return null;
    }
    const defaultParams = getDefaultParametersForTool(tool);
    const savedParams = state.draftParameters[tasktype];
    const funcArguments: FunctionArguments = {
      ...(defaultParams || {}),
      ...(savedParams || {}),
    };
    state.llmSettings.taskDraft.content = {
      ...state.llmSettings.taskDraft.content,
      functionCall: {
        name: tasktype,
        arguments: funcArguments,
      },
    };
  } else {
    state.llmSettings.taskDraft.role = 'user';
    state.llmSettings.taskDraft.content = {
      message: '',
    };
  }
}

const estimatedTokens = ref<number>(0);
watchDebounced(
  () => state.llmSettings.taskDraft.content,
  () => {
    void (async () => {
      // Tokenize the message
      estimatedTokens.value = await countStringTokens(
        JSON.stringify(state.llmSettings.taskDraft.content) || '',
      );
    })();
  },
  { debounce: 500, maxWait: 1000 },
);

async function toggleSelectedTools() {
  if (state.llmSettings.taskDraft.allowedTools) {
    if (state.llmSettings.taskDraft.allowedTools.length > 0) {
      state.llmSettings.taskDraft.allowedTools = [];
      return;
    }
  }
  state.llmSettings.taskDraft.allowedTools = Object.keys(await getAllTools());
}

const currentnewTask = computed(() => {
  let task = deepMerge(state.llmSettings.taskDraft, props.forceTaskProps || {});
  if (currentModel.value) {
    task.configuration = {
      model: currentModel.value,
      chatApi: currentChatApi.value,
    };
    task.name = undefined;
    task.debugging = {};
    if (selectedTaskType.value) {
      // here we have a function task ;)
      task.role = 'function';
    } else if (
      state.llmSettings.taskDraft.content &&
      'message' in state.llmSettings.taskDraft.content
    ) {
      task.role = 'user';
      task.content = {
        message: state.llmSettings.taskDraft.content.message.trim(),
      };
    }
  }
  return task as LLMTask; // we can do this, because we defined the "role"
});

async function addFiles2Taskyon(newFiles: File[]) {
  console.log('add files to our chat!');
  //first, upload file into our OPFS file system:
  const opfsMapping = await writeFilesToOpfs(newFiles);

  // Collect UUIDs from added files
  const uuids = [];
  const tm = await state.getTaskManager();
  for (const [fileIdx, file] of newFiles.entries()) {
    const uuid = await tm.addFile({
      opfs: opfsMapping[fileIdx],
      name: file.name,
      fileType: file.type,
    });
    if (uuid) {
      uuids.push(uuid);
    }
  }
  return uuids;
}

// all our files are added to a "file task"
async function createFileTask(files: File[]) {
  // first add files to our DB & save them, then get uuids for each file.
  const fileUuids = await addFiles2Taskyon(files);

  if (fileUuids.length) {
    const task: Parameters<typeof addTask2Tree>[0] = {
      role: 'system',
      configuration: currentModel.value
        ? {
            model: currentModel.value,
            chatApi: currentChatApi.value,
          }
        : undefined,
      content: {
        uploadedFiles: fileUuids,
      },
    };
    return task;
  }
  return undefined;
}

async function addNewTask(execute = true) {
  state.taskWorkerController.reset(); // make sure we reset our execution context interrupt, so that we can interrupt in the next loop again :)
  const fileTaskObj = await createFileTask(fileAttachments.value);
  let fileTaskId = undefined;
  if (fileTaskObj) {
    console.log('add files to chat:', fileTaskObj);
    fileTaskId = await addTask2Tree(
      fileTaskObj,
      state.llmSettings.selectedTaskId, // parent
      await state.getTaskManager(),
      false, // we do not want to execute the file object, we want to use the users prompt...
    );
    state.llmSettings.selectedTaskId = fileTaskId;
    fileAttachments.value = [];
  }

  // execute: if true, we immediatly queue the task for execution in the taskManager
  //          otherwise, it won't get executed but simply saved into the tree
  console.log('adding new task, execute?', execute);
  const newTask = { ...currentnewTask.value };
  const newTaskId = await addTask2Tree(
    newTask,
    fileTaskId || state.llmSettings.selectedTaskId, //parent
    await state.getTaskManager(),
    execute, // execute right away...
  );
  state.llmSettings.selectedTaskId = newTaskId;

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    state.llmSettings.taskDraft.content = { message: '' };
    await setTaskType(undefined);
  }
}

function attachFileToDraft(newFiles: File[]) {
  console.log('attach file to chat');
  fileAttachments.value.push(...newFiles);
}
</script>
