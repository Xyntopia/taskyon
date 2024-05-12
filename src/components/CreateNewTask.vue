<template>
  <!--Create new task area-->
  <div>
    <!--Task Creation-->
    <div>
      <taskContentEdit
        v-if="!selectedTaskType && !codingMode"
        :model-value="state.taskDraft.content?.message"
        @update:modelValue="
          (value) => {
            state.taskDraft.content = value;
          }
        "
        v-model:expandedTaskCreation="expandedTaskCreation"
        :expert-mode="expertMode"
        :execute-task="addNewTask"
        :attach-file-to-chat="attachFileToChat"
        :estimated-tokens="estimatedTokens"
        :current-model="currentModel"
        :use-enter-to-send="state.appConfiguration.useEnterToSend"
        :bottom-slots="!state.minimalGui"
      />
      <div v-else-if="!selectedTaskType && codingMode">
        <CodeEditor
          :model-value="state.taskDraft.content?.message"
          @update:modelValue="
            (value) => {
              state.taskDraft.content = value;
            }
          "
        />
        <taskSettingsButton v-model="expandedTaskCreation" />
        <q-btn
          :disable="!sendAllowed"
          :color="sendAllowed ? 'positive' : 'negative'"
          icon="save"
          label="save task"
          @click="addNewTask(false)"
          ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
        >
      </div>
      <div v-else-if="selectedTaskType" class="row">
        <ObjectTreeView
          class="col"
          :model-value="state.taskDraft.content?.functionCall?.arguments"
          input-field-behavior="auto"
          :separate-labels="false"
        />
        <taskSettingsButton v-model="expandedTaskCreation" />
      </div>
      <div v-if="fileAttachments.length">
        <div>Attached files:</div>
        <q-chip
          v-for="file in fileAttachments"
          :key="file.name"
          removable
          @remove="fileAttachments = fileAttachments.filter((f) => f !== file)"
          icon="upload_file"
        >
          <div class="ellipsis" style="max-width: 100px">
            {{ `${file.name}` }}
          </div>
          <q-tooltip :delay="0.5">{{ `${file.name}` }}</q-tooltip>
        </q-chip>
      </div>
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
          icon="chat"
          @click="setTaskType(undefined)"
          ><q-tooltip>Select Simple Chat</q-tooltip>
        </q-btn>
        <q-select
          v-if="expertMode"
          style="min-width: 200px"
          class="q-pt-xs q-px-md"
          dense
          outlined
          clearable
          :bg-color="selectedTaskType ? 'secondary' : ''"
          :model-value="selectedTaskType"
          @update:modelValue="setTaskType"
          :options="Object.keys(toolCollection)"
          :label="selectedTaskType ? 'selected Tool' : 'Select Tool'"
        />
        <q-toggle
          v-if="expertMode"
          icon="handyman"
          left-label
          color="secondary"
          dense
          size="xl"
          v-model="state.chatState.enableOpenAiTools"
          ><q-tooltip
            >Enable OpenAI Functions (use built-in function selection mode for
            OpenAI)</q-tooltip
          ></q-toggle
        >
        <q-btn
          v-if="expertMode"
          class="q-ma-md"
          dense
          flat
          icon="code"
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
          <q-icon name="smart_toy" size="sm" class="q-pr-sm"></q-icon>
          <ModelSelection
            @updateBotName="handleBotNameUpdate"
            :bot-name="currentModel || currentDefaultBotName || ''"
            v-model:selected-api="selectedApi"
            v-model:enable-open-a-i-assistants="useOpenAIAssistants"
            v-model:open-a-i-assistant-id="openAIAssistantId"
          ></ModelSelection>
        </q-item>
        <!--Allowed Tools Selection-->
        <q-separator class="q-my-sm" />
        <q-item class="row items-center">
          <q-icon name="mdi-tools" size="sm" />
          <q-expansion-item
            class="col"
            dense
            icon="handyman"
            expand-icon-toggle
            label="Tools"
            v-model="state.allowedToolsExpand"
          >
            <template v-slot:header>
              <div class="row items-center q-gutter-sm">
                <q-btn dense icon="edit" label="manage tools" to="tools" />
                <q-btn
                  dense
                  icon="checklist"
                  label="toggle tools"
                  @click="toggleSelectedTools"
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
import { computed, ref, watch, toRaw, toRefs } from 'vue';
import { countStringTokens, getApiConfig } from 'src/modules/taskyon/chat';
import { getDefaultParametersForTool } from 'src/modules/taskyon/tools';
import { FunctionArguments } from 'src/modules/taskyon/types';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import {
  LLMTask,
  partialTaskDraft,
  taskTemplateTypes,
} from 'src/modules/taskyon/types';
import ModelSelection from 'components/ModelSelection.vue';
import { writeFiles } from 'src/modules/taskyon/OPFS';
import { addTask2Tree } from 'src/modules/taskyon/taskManager';
import ObjectTreeView from './ObjectTreeView.vue';
import type { ToolBase } from 'src/modules/taskyon/tools';
import taskSettingsButton from './taskSettingsButton.vue';
import taskContentEdit from './taskContentEdit.vue';
import CodeEditor from './CodeEditor.vue';

const props = defineProps<{
  codingMode?: boolean;
  forceTaskProps?: partialTaskDraft;
  sendAllowed?: boolean;
}>();

const state = useTaskyonStore();
const { showTaskData, expandedTaskCreation } = toRefs(state);
const { expertMode } = toRefs(state.appConfiguration);
const { selectedApi, useOpenAIAssistants, openAIAssistantId } = toRefs(
  state.chatState
);

//const funcArgs = computed(() => );

async function getAllTools() {
  return (await state.getTaskManager()).searchToolDefinitions();
}

const toolCollection = ref<Record<string, ToolBase>>({});
void getAllTools().then((tools) => (toolCollection.value = tools));

// Computed property to determine the currently selected bot name
const currentDefaultBotName = computed(() => {
  if (state.chatState.selectedApi === 'openai') {
    if (state.chatState.useOpenAIAssistants) {
      return state.chatState.openAIAssistantId;
    }
  }
  const modelName =
    state.taskDraft.configuration?.model ||
    getApiConfig(state.chatState)?.defaultModel;
  return modelName;
});

const currentModel = ref(toRaw(currentDefaultBotName.value));
const currentChatApi = ref(toRaw(state.chatState.selectedApi));

const allowedTools = computed({
  get() {
    return state.taskDraft.allowedTools || [];
  },
  set(newValue) {
    state.taskDraft.allowedTools = newValue;
  },
});

// Method to handle the updateBotName event
const handleBotNameUpdate = ({
  newName,
  newService,
}: {
  newName: string;
  newService: string;
}) => {
  console.log('getting an api & bot update :)', newName, newService);
  currentModel.value = newName;
  currentChatApi.value = newService;
  state.chatState.selectedApi = newService;
  const api = getApiConfig(state.chatState);
  if (api) {
    api.defaultModel = newName;
  }
};

const selectedTaskType = computed(() => {
  return state.taskDraft.content?.functionCall?.name;
});

async function setTaskType(tasktype: string | undefined) {
  console.log('change tasktype to:', tasktype);
  if (tasktype) {
    state.taskDraft.role = 'function';
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
    state.taskDraft.content = {
      ...state.taskDraft.content,
      functionCall: {
        name: tasktype,
        arguments: funcArguments,
      },
    };
  } else {
    state.taskDraft.role = 'user';
    delete state.taskDraft.configuration;
  }
}

const estimatedTokens = computed(() => {
  // Tokenize the message
  const tokens = countStringTokens(JSON.stringify(state.taskDraft.content));

  // Return the token count
  return tokens;
});

async function toggleSelectedTools() {
  if (state.taskDraft.allowedTools) {
    if (state.taskDraft.allowedTools.length > 0) {
      state.taskDraft.allowedTools = [];
      return;
    }
  }
  state.taskDraft.allowedTools = Object.keys(await getAllTools());
}

const currentnewTask = computed(() => {
  let task: Partial<LLMTask> = { ...state.taskDraft };
  if (currentModel.value) {
    if (selectedTaskType.value) {
      // here we have a function task ;)
      task.configuration = {
        model: currentModel.value,
        chatApi: currentChatApi.value,
      };
      task.role = 'function';
    } else if (state.taskDraft.content?.message) {
      // chat Task
      task.configuration = {
        model: currentModel.value,
        chatApi: currentChatApi.value,
      };
      task.role = 'user';
      task.debugging = {};
      task.content = { message: state.taskDraft.content.message.trim() };
    }
  }
  return task as LLMTask; // we can do this, because we defined the "role"
});

async function addNewTask(execute = true) {
  // execute: if true, we immediatly queue the task for execution in the taskManager
  //          otherwise, it won't get executed but simply saved into the tree
  console.log('adding new task, execute?', execute);
  const newTask = { ...currentnewTask.value, ...(props.forceTaskProps || {}) };
  void addTask2Tree(
    newTask,
    state.chatState.selectedTaskId, //parent
    state.chatState,
    await state.getTaskManager(),
    execute // execute right away...
  );
  if (currentnewTask.value.role === 'user') {
    state.taskDraft.content = undefined;
    await setTaskType(undefined);
  }
}

const fileAttachments = ref<File[]>([]); // holds all attached files as a "tasklist"

function attachFileToChat(newFiles: File[]) {
  console.log('attach file to chat');

  fileAttachments.value.push(...newFiles);
}

async function addFileTasks(newFiles: File[]) {
  console.log('add files to our chat!');
  //first, upload file into our OPFS file system:
  const opfsMapping = await writeFiles(newFiles);

  // Collect UUIDs from added files
  const uuids = [];
  const tm = await state.getTaskManager();
  for (const [, savedFilename] of Object.entries(opfsMapping)) {
    const uuid = await tm.addFile({ opfs: savedFilename });
    if (uuid) {
      uuids.push(uuid);
    }
  }

  const newFileObject = taskTemplateTypes.file.parse(undefined);
  // Ensure '.configuration' and 'uploadedFiles' are initialized in 'state.taskDraft'
  newFileObject.configuration = state.taskDraft.configuration;
  newFileObject.content = { uploadedFiles: uuids };
}

// Reactive property to store file mappings
const fileMappings = ref<
  {
    uuid: string;
    opfsName: string | undefined;
  }[]
>([]);

async function updateFileMappings(newUploadedFiles: string[] | undefined) {
  const newMappings = [];
  if (newUploadedFiles) {
    for (const uuid of newUploadedFiles) {
      try {
        const fileMapping = await (
          await state.getTaskManager()
        ).getFileMappingByUuid(uuid);
        if (fileMapping) {
          newMappings.push({
            uuid,
            opfsName: fileMapping.opfs, // Assuming 'opfs' holds the OPFS filename
          });
        }
      } catch (error) {
        console.error(`Error fetching file mapping for UUID: ${uuid}`, error);
      }
    }
  }

  fileMappings.value = newMappings;
}

//void updateFileMappings(state.taskDraft.configuration?.uploadedFiles);

// Watcher to update file mappings when uploaded files change
/*watch(
  () => state.taskDraft.configuration?.uploadedFiles, // reactive source
  (newUploadedFiles) => updateFileMappings(newUploadedFiles),
  {
    deep: true, // Use this if the watched source is an object/array
  }
);*/
</script>
