<template>
  <!--Create new task area-->
  <q-card-section>
    <q-list dense separator>
      <!--Task Creation-->
      <q-item>
        <q-item-section>
          <q-input
            v-if="!selectedTaskType"
            autogrow
            :hide-hint="!state.expertMode"
            filled
            color="secondary"
            v-model="state.taskDraft.content"
            :hint="`Estimated number of tokens: ${estimatedTokens}`"
            label="Type your message..."
            @keyup="checkForShiftEnter"
          >
            <template v-slot:append>
              <q-icon
                v-if="state.taskDraft.content !== ''"
                name="close"
                @click="state.taskDraft.content = ''"
                class="cursor-pointer"
              />
              <q-btn
                v-if="!selectedTaskType"
                flat
                dense
                stretch
                icon="send"
                @click="executeTask"
              >
                <q-tooltip>
                  Alternativly send with &lt;shift&gt; + &lt;enter&gt;
                </q-tooltip>
              </q-btn>
            </template>
            <template v-slot:after>
              <FileDropzone
                class="row justify-center items-center"
                @update:model-value="writeFiles"
              >
                <q-btn dense stretch>
                  <q-icon name="upload_file" />
                  <q-icon name="attachment" />
                  <q-tooltip>"Attach file to message"</q-tooltip>
                </q-btn>
              </FileDropzone>
            </template>
          </q-input>
          <q-select
            v-if="state.expertMode"
            class="q-pt-xs q-px-md"
            dense
            filled
            :model-value="selectedTaskType"
            @update:modelValue="setTaskType"
            :options="Object.keys(tools)"
            :label="selectedTaskType ? 'selected Task' : 'Or select task type'"
          >
            <template v-slot:before>
              <q-btn
                dense
                icon="chat"
                label="Use Chat"
                @click="setTaskType(undefined)"
                ><q-tooltip>Select Simple Chat</q-tooltip></q-btn
              >
            </template>
            <template v-slot:after>
              <q-btn
                class="q-ma-md"
                dense
                flat
                icon="code"
                @click="state.showTaskData = !state.showTaskData"
                ><q-tooltip>Show Draft Task Data</q-tooltip></q-btn
              >
            </template>
          </q-select>
          <div v-if="selectedTaskType">
            <div
              v-for="(param, paramName) in state.taskDraft.context?.function
                ?.arguments"
              :key="paramName"
            >
              <q-input
                :model-value="param"
                @update:model-value="
                  (value) => setFunctionParameter(paramName, value)
                "
                :label="paramName"
                debounce="500"
                filled
                dense
                type="textarea"
              />
            </div>
            <q-btn class="q-ma-md" label="Execute Task" @click="executeTask" />
          </div>
          <div v-if="state.showTaskData && state.expertMode">
            {{ currentnewTask }}
          </div>
        </q-item-section>
      </q-item>
      <!--Model Selection-->
      <q-expansion-item
        dense
        icon="smart_toy"
        :label="`Select Chatbot (right now: ${currentlySelectedService}/${currentlySelectedBotName})`"
        v-model="state.selectChatBotExpand"
      >
        <q-item-section>
          <ModelSelection @updateBotName="handleBotNameUpdate"></ModelSelection>
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
              v-model="state.taskDraft.allowedTools"
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
    </q-list>
  </q-card-section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { countStringTokens } from 'src/modules/chat';
import { tools, getDefaultParametersForTool } from 'src/modules/tools';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import type { LLMTask } from 'src/modules/types';
import FileDropzone from './FileDropzone.vue';
import ModelSelection from 'components/ModelSelection.vue';
import { writeFiles } from 'src/modules/OPFS';
import { addTask2Tree } from 'src/modules/taskManager';

const state = useTaskyonStore();

const currentlySelectedBotName = ref('');
const currentlySelectedService = ref('');

// Method to handle the updateBotName event
const handleBotNameUpdate = ({
  newName,
  newService,
}: {
  newName: string;
  newService: string;
}) => {
  currentlySelectedBotName.value = newName;
  currentlySelectedService.value = newService;
};

function setFunctionParameter(
  paramName: string,
  value: string | number | null
) {
  if (state.taskDraft.context?.function?.arguments) {
    state.taskDraft.context.function.arguments[paramName] = value || '';
  }
  if (state.taskDraft.context?.function?.name) {
    state.draftParameters[state.taskDraft.context.function.name][paramName] =
      value || '';
  }
}

const selectedTaskType = computed(() => {
  return state.taskDraft.context?.function?.name;
});

function setTaskType(tasktype: string | undefined) {
  console.log('change tasktype to:', tasktype);
  if (tasktype) {
    state.taskDraft.role = 'function';
    const defaultParams = getDefaultParametersForTool(tasktype);
    const savedParams = state.draftParameters[tasktype];
    const funcArguments = {
      ...(defaultParams || {}),
      ...(savedParams || {}),
    };
    state.taskDraft.context = {
      function: {
        name: tasktype,
        arguments: funcArguments,
      },
    };
  } else {
    state.taskDraft.role = 'user';
    delete state.taskDraft.context;
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
  let task: Partial<LLMTask> = { ...state.taskDraft };
  if (selectedTaskType.value) {
    task.role = 'function';
    task.content = null;
  } else {
    task.role = 'user';
    task.debugging = {};
    task.content = state.taskDraft.content?.trim();
  }
  return task as LLMTask; // we can do this, because we defined the "role"
});

function executeTask() {
  console.log('executing task!');
  addTask2Tree(
    currentnewTask.value,
    state.chatState.Tasks[state.chatState.selectedTaskId || ''], //parent
    state.chatState, //task manager
    true // execute right away...
  );
  if (currentnewTask.value.role === 'user') {
    state.taskDraft.content = '';
  }
}

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void executeTask();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};
</script>
