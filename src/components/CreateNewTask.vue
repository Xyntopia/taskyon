<template>
  <!--Create new task area-->
  <div>
    <!--Task Creation-->
    <div>
      <taskContentEdit
        v-if="!selectedTaskType && !codingMode"
        v-model="content"
        v-model:expandedTaskCreation="expandedTaskCreation"
        :expertMode="expertMode"
        :checkKeyboardEvents="checkKeyboardEvents"
        :executeTask="addNewTask"
        :attachFileToTask="attachFileToTask"
        :estimatedTokens="estimatedTokens"
        :currentModel="currentModel"
      />
      <div v-else-if="!selectedTaskType && codingMode">
        <CodeEditor v-model="content" />
        <taskSettingsButton v-model="expandedTaskCreation" />
        <q-btn icon="save" label="save task" @click="addNewTask(false)"
          ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
        >
      </div>
      <div v-else-if="selectedTaskType" class="row">
        <ObjectTreeView
          class="col"
          :model-value="state.taskDraft.configuration?.function?.arguments"
          input-field-behavior="textarea"
          :separate-labels="false"
        />
        <taskSettingsButton v-model="expandedTaskCreation" />
      </div>
      <div v-if="fileMappings.length">
        <div>Attached files:</div>
        <q-chip
          v-for="fileMapping in fileMappings"
          :key="fileMapping.uuid"
          removable
          @remove="removeFileFromTask(fileMapping.uuid)"
          icon="upload_file"
        >
          <div class="ellipsis" style="max-width: 100px">
            {{ `${fileMapping.opfsName} (${fileMapping.uuid})` }}
          </div>
          <q-tooltip :delay="0.5">{{
            `${fileMapping.opfsName} (taskyon-id: ${fileMapping.uuid})`
          }}</q-tooltip>
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
                <q-btn dense icon="edit" label="edit/create tools" to="tools" />
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
import type { LLMTask } from 'src/modules/taskyon/types';
import ModelSelection from 'components/ModelSelection.vue';
import { writeFiles } from 'src/modules/taskyon/OPFS';
import {
  addTask2Tree,
  getFileMappingByUuid,
} from 'src/modules/taskyon/taskManager';
import ObjectTreeView from './ObjectTreeView.vue';
import { getTaskManager } from 'boot/taskyon';
import type { Tool } from 'src/modules/taskyon/tools';
import taskSettingsButton from './taskSettingsButton.vue';
import taskContentEdit from './taskContentEdit.vue';
import CodeEditor from './CodeEditor.vue';

withDefaults(
  defineProps<{
    codingMode: boolean;
  }>(),
  { codingMode: false }
);

const state = useTaskyonStore();
const { showTaskData, expandedTaskCreation } = toRefs(state);
const { expertMode } = toRefs(state.appConfiguration);
const { selectedApi, useOpenAIAssistants, openAIAssistantId } = toRefs(
  state.chatState
);
const { content } = toRefs(state.taskDraft);

//const funcArgs = computed(() => );

async function getAllTools() {
  return (await getTaskManager()).getTools();
}

const toolCollection = ref<Record<string, Tool>>({});
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
  return state.taskDraft.configuration?.function?.name;
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
    state.taskDraft.configuration = {
      function: {
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
  const tokens = countStringTokens(state.taskDraft.content || '');

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
  if (selectedTaskType.value) {
    task.configuration = {
      ...task.configuration,
      model: currentModel.value,
      chatApi: currentChatApi.value,
    };
    task.role = 'function';
  } else {
    task.configuration = {
      ...task.configuration,
      model: currentModel.value,
      chatApi: currentChatApi.value,
    };
    task.role = 'user';
    task.debugging = {};
    task.content = state.taskDraft.content?.trim();
  }
  return task as LLMTask; // we can do this, because we defined the "role"
});

async function addNewTask(execute = true) {
  // execute: if true, we immediatly queue the task for execution in the taskManager
  //          otherwise, it won't get executed but simply saved into the tree
  console.log('adding new task, execute?', execute);
  const newTask = { ...currentnewTask.value };
  if (!execute) newTask.state = 'Completed';
  void addTask2Tree(
    newTask,
    state.chatState.selectedTaskId, //parent
    state.chatState,
    await getTaskManager(),
    execute // execute right away...
  );
  if (currentnewTask.value.role === 'user') {
    state.taskDraft.content = '';
    await setTaskType(undefined);
  }
}

const checkKeyboardEvents = (event: KeyboardEvent) => {
  if (state.appConfiguration.useEnterToSend) {
    if (!event.shiftKey && event.key === 'Enter') {
      void addNewTask();
      // Prevent a new line from being added to the input (optional)
      event.preventDefault();
    }
    // otherwise it'll simply be the default action and inserting a newline :)
  } else {
    if (event.shiftKey && event.key === 'Enter') {
      void addNewTask();
      // Prevent a new line from being added to the input (optional)
      event.preventDefault();
    }
    // otherwise it'll simply be the default action and inserting a newline :)
  }
};

async function attachFileToTask(newFiles: File[]) {
  console.log('attach file to ask');
  //first, upload file into our OPFS file system:
  const opfsMapping = await writeFiles(newFiles);

  // Collect UUIDs from added files
  const uuids = [];

  const tm = await getTaskManager();
  for (const [, savedFilename] of Object.entries(opfsMapping)) {
    const uuid = await tm.addFile({ opfs: savedFilename });
    if (uuid) {
      uuids.push(uuid);
    }
  }

  // Ensure '.configuration' and 'uploadedFiles' are initialized in 'state.taskDraft'
  state.taskDraft.configuration = state.taskDraft.configuration || {};
  state.taskDraft.configuration.uploadedFiles =
    state.taskDraft.configuration.uploadedFiles || [];

  // Append the UUIDs to 'uploadedFiles'
  state.taskDraft.configuration.uploadedFiles.push(...uuids);
}

function removeFileFromTask(fileName: string) {
  console.log('delete file from task:', fileName);
  const fileIndex =
    state.taskDraft.configuration?.uploadedFiles?.indexOf(fileName);
  if (fileIndex != undefined) {
    if (fileIndex > -1) {
      state.taskDraft.configuration?.uploadedFiles?.splice(fileIndex, 1);
    }
  }
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
        const fileMapping = await getFileMappingByUuid(
          uuid,
          await getTaskManager()
        );
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

void updateFileMappings(state.taskDraft.configuration?.uploadedFiles);

// Watcher to update file mappings when uploaded files change
watch(
  () => state.taskDraft.configuration?.uploadedFiles, // reactive source
  (newUploadedFiles) => updateFileMappings(newUploadedFiles),
  {
    deep: true, // Use this if the watched source is an object/array
  }
);
</script>
