<template>
  <!--Create new task area-->
  <div>
    <!--Task Creation-->
    <div>
      <q-input
        v-if="!selectedTaskType"
        autogrow
        filled
        color="secondary"
        v-model="state.taskDraft.content"
        label="Type your message or instruction..."
        :bottom-slots="state.appConfiguration.expertMode"
        :counter="state.appConfiguration.expertMode"
        clearable
        @keyup="checkForShiftEnter"
        input-style="max-height: 300px"
      >
        <template v-slot:append>
          <q-btn flat dense round icon="send" @click="executeTask">
            <q-tooltip>
              Press to send or alternatively send with &lt;shift&gt; +
              &lt;enter&gt;
            </q-tooltip>
          </q-btn>
        </template>
        <template v-slot:before>
          <FileDropzone
            class="row justify-center items-center"
            @update:model-value="attachFileToTask"
          >
            <q-btn dense class="fit" flat>
              <q-icon name="upload_file" />
              <q-icon name="attachment" />
              <q-tooltip>Attach file to message</q-tooltip>
            </q-btn>
          </FileDropzone>
        </template>
        <template v-slot:after>
          <q-btn
            flat
            dense
            icon="tune"
            @click="
              () => {
                state.expandedTaskCreation = !state.expandedTaskCreation;
              }
            "
            ><q-tooltip> Toggle Task Settings </q-tooltip>
          </q-btn>
        </template>
        <template v-slot:counter>
          <div>
            {{ `approx. token count: ${estimatedTokens}` }}
          </div>
        </template>
      </q-input>
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
      <div v-if="selectedTaskType">
        <ObjectTreeView
          :model-value="state.taskDraft.configuration?.function?.arguments"
          :on-update:model-value="(value) => state.setDraftFunctionArgs(value)"
          input-field-behavior="textarea"
          :separate-labels="false"
        />
        <q-btn class="q-ma-md" label="Execute Task" @click="executeTask" />
        <q-btn
          flat
          dense
          icon="tune"
          @click="
            () => {
              state.expandedTaskCreation = !state.expandedTaskCreation;
            }
          "
          ><q-tooltip> Toggle Task Settings </q-tooltip>
        </q-btn>
      </div>
    </div>
    <q-slide-transition>
      <div v-show="state.expandedTaskCreation">
        <div v-if="state.appConfiguration.expertMode" class="row items-center">
          <q-btn
            flat
            dense
            icon="chat"
            :color="selectedTaskType ? '' : 'secondary'"
            @click="setTaskType(undefined)"
            ><q-tooltip>Select Simple Chat</q-tooltip>
          </q-btn>
          <q-select
            style="min-width: 200px"
            class="q-pt-xs q-px-md"
            dense
            clearable
            standout="bg-secondary text-white"
            :bg-color="selectedTaskType ? 'secondary' : ''"
            :model-value="selectedTaskType"
            @update:modelValue="setTaskType"
            :options="Object.keys(tools)"
            :label="selectedTaskType ? 'selected Tool' : 'Select Tool'"
          />
          <q-toggle
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
            class="q-ma-md"
            dense
            flat
            icon="code"
            @click="state.showTaskData = !state.showTaskData"
            ><q-tooltip>Show Draft Task Data</q-tooltip></q-btn
          >
        </div>
        <div v-if="state.showTaskData && state.appConfiguration.expertMode">
          {{ currentnewTask }}
        </div>
        <!--Model Selection-->
        <q-expansion-item
          dense
          icon="smart_toy"
          :label="`Select Chatbot (right now: ${
            currentChatApi || state.chatState.selectedApi
          }/${currentModel || currentDefaultBotName})`"
          v-model="state.selectChatBotExpand"
        >
          <q-item-section>
            <ModelSelection
              @updateBotName="handleBotNameUpdate"
              :bot-name="currentModel || currentDefaultBotName || ''"
              v-model:selected-api="state.chatState.selectedApi"
              v-model:enable-open-a-i-assistants="
                state.chatState.useOpenAIAssistants
              "
              v-model:open-a-i-assistant-id="state.chatState.openAIAssistantId"
            ></ModelSelection>
          </q-item-section>
        </q-expansion-item>
        <!--Allowed Tools Selection-->
        <q-expansion-item
          dense
          icon="handyman"
          label="Allowed Tools"
          v-model="state.allowedToolsExpand"
        >
          <q-item-section>
            <div>
              <q-btn
                class="q-ma-md"
                dense
                label="toggle all allowed tools"
                color="primary"
                @click="toggleSelectedTools"
              />
              <q-option-group
                class="q-ma-md"
                v-model="allowedTools"
                :options="
                  Object.keys(tools).map((name) => ({
                    label: name,
                    value: name,
                    description: tools[name].description,
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
            </div>
          </q-item-section>
        </q-expansion-item>
      </div>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, toRaw } from 'vue';
import { countStringTokens, getApiConfig } from 'src/modules/chat';
import { tools, getDefaultParametersForTool } from 'src/modules/tools';
import { FunctionArguments } from 'src/modules/types';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import type { LLMTask } from 'src/modules/types';
import FileDropzone from './FileDropzone.vue';
import ModelSelection from 'components/ModelSelection.vue';
import { writeFiles } from 'src/modules/OPFS';
import {
  addTask2Tree,
  addFile,
  getFileMappingByUuid,
} from 'src/modules/taskManager';
import ObjectTreeView from './ObjectTreeView.vue';
import { getTaskManager } from 'boot/taskyon';

const state = useTaskyonStore();

//const funcArgs = computed(() => );

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

function setTaskType(tasktype: string | undefined) {
  console.log('change tasktype to:', tasktype);
  if (tasktype) {
    state.taskDraft.role = 'function';
    const defaultParams = getDefaultParametersForTool(tasktype);
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

function toggleSelectedTools() {
  if (state.taskDraft.allowedTools) {
    if (state.taskDraft.allowedTools.length > 0) {
      state.taskDraft.allowedTools = [];
      return;
    }
  }
  state.taskDraft.allowedTools = Object.keys(tools);
}

const currentnewTask = computed(() => {
  console.log('recalculate task');
  let task: Partial<LLMTask> = { ...state.taskDraft };
  if (selectedTaskType.value) {
    task.role = 'function';
    task.content = null;
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

async function executeTask() {
  console.log('executing task!');
  void addTask2Tree(
    currentnewTask.value,
    state.chatState.selectedTaskId, //parent
    state.chatState,
    await getTaskManager(),
    true // execute right away...
  );
  if (currentnewTask.value.role === 'user') {
    state.taskDraft.content = '';
    setTaskType(undefined);
  }
}

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void executeTask();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};

async function attachFileToTask(newFiles: File[]) {
  console.log('attach file to ask');
  //first, upload file into our OPFS file system:
  const opfsMapping = await writeFiles(newFiles);

  // Collect UUIDs from added files
  const uuids = [];

  for (const [, savedFilename] of Object.entries(opfsMapping)) {
    const uuid = await addFile(await getTaskManager(), savedFilename);
    uuids.push(uuid);
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
  const fileIndex = state.taskDraft.configuration?.uploadedFiles?.indexOf(fileName);
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
