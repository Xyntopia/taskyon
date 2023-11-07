<template>
  <!--Create new task area-->
  <q-card-section>
    <q-list dense separator>
      <!--Task Creation-->
      <q-item>
        <q-item-section>
          <q-input
            autogrow
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
                v-if="!taskTypeSelection"
                flat
                dense
                stretch
                icon="send"
                @click="sendMessageWrapper"
              />
            </template>
          </q-input>
          <q-select
            v-if="state.expertMode"
            class="q-pt-xs q-px-md"
            dense
            filled
            v-model="taskTypeSelection"
            :options="Object.keys(tools)"
            :label="taskTypeSelection ? 'selected Task' : 'Or select task type'"
          >
            <template v-slot:before>
              <q-btn
                dense
                flat
                icon="chat"
                label="Use Chat"
                @click="taskTypeSelection = undefined"
                ><q-tooltip>Select Simple Chat</q-tooltip></q-btn
              >
            </template>
          </q-select>
          <div v-if="taskTypeSelection">
            <div
              v-for="(param, paramName) in parameters[taskTypeSelection]"
              :key="paramName"
            >
              <q-input
                v-model="parameters[taskTypeSelection][paramName]"
                :label="paramName"
                debounce="500"
                filled
                dense
                type="textarea"
              />
            </div>
            <q-btn class="q-ma-md" label="Execute Task" @click="executeTask" />
            <q-btn
              class="q-ma-md"
              icon="code"
              @click="state.showTaskData = !state.showTaskData"
            />
            <div v-if="state.showTaskData">{{ currentFunctionTask }}</div>
          </div>
        </q-item-section>
      </q-item>
      <!--Allowed Tools Selection-->
      <q-item>
        <q-item-section>
          <div>
            <q-btn
              class="q-ma-md"
              label="toggle allowed tools"
              @click="toggleSelectedTools"
            />
            <q-option-group
              class="q-ma-md"
              v-model="state.selectedTools"
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
      </q-item>
      <!--Model Selection-->
      <q-item>
        <q-item-section>
          <q-select
            v-if="state.chatState.baseURL == getBackendUrls('openai')"
            class="q-pt-xs"
            filled
            bottom-slots
            dense
            label="Select Openrouter.ai LLM"
            icon="smart_toy"
            :options="modelOptions.openrouter"
            emit-value
            v-model="state.chatState.openAIModel"
          >
            <template v-slot:hint>
              For a list of supported models go here:
              <a href="https://platform.openai.com/docs/models" target="_blank"
                >https://platform.openai.com/docs/models</a
              >
            </template>
          </q-select>
          <q-select
            v-else
            class="q-pt-xs"
            filled
            dense
            bottom-slots
            label="Select LLM Model for answering/solving the task."
            icon="smart_toy"
            :options="modelOptions.openai"
            emit-value
            v-model="state.chatState.openrouterAIModel"
          >
            <template v-slot:hint>
              For a list of supported models go here:
              <a href="https://openrouter.ai/docs#models" target="_blank"
                >https://openrouter.ai/docs#models</a
              >
            </template>
            <template v-slot:after>
              <div style="font-size: 0.5em">
                <div>
                  prompt:
                  {{
                    modelLookUp.openrouter[state.chatState.openrouterAIModel]
                      ?.pricing?.prompt
                  }}
                </div>
                <div>
                  completion:
                  {{
                    modelLookUp.openrouter[state.chatState.openrouterAIModel]
                      ?.pricing?.completion
                  }}
                </div>
              </div>
            </template>
          </q-select>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card-section>
</template>

<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';
import {
  sendMessage,
  availableModels,
  Model,
  getBackendUrls,
  countStringTokens,
  addTask2Tree,
} from 'src/modules/chat';
import {
  tools,
  FunctionArguments,
  FunctionCall,
  getDefaultParametersForTool,
} from 'src/modules/tools';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import openrouterModules from 'assets/openrouter_models.json';
import { useTaskyonStore } from 'stores/taskyonState';
import openaiModels from 'assets/openai_models.json';
import { LLMTask } from 'src/modules/types';

const openrouterModels: Model[] = openrouterModules.data;
const openAiModels: Model[] = openaiModels.data;
const state = useTaskyonStore();

const taskTypeSelection = ref<string | undefined>(undefined);
// Use the conversion function before defining parameters
const parameters = ref<Record<string, Record<string, string>>>({});

watchEffect(() => {
  console.log('update task!!');
  if (taskTypeSelection.value) {
    if (!parameters.value[taskTypeSelection.value]) {
      parameters.value[taskTypeSelection.value] =
        getDefaultParametersForTool(taskTypeSelection.value) || {};
    }
    state.taskDraft.role = 'function';
    state.taskDraft.content = null;
    state.taskDraft.context = {
      function: {
        name: taskTypeSelection.value || '',
        arguments: parameters.value[taskTypeSelection.value],
      },
    };
  } else {
    //  we are only using a chatmessage!
    state.taskDraft.role = 'user';
  }
});

const resOpenRouter = ref<Model[]>([]);
const resOpenAI = ref<Model[]>([]);
async function fetchModels(): Promise<void> {
  try {
    resOpenRouter.value = await availableModels(
      getBackendUrls('openrouter'),
      state.chatState.openRouterAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    console.log('using default list');
    resOpenRouter.value = openrouterModels;
  }
  try {
    resOpenAI.value = await availableModels(
      getBackendUrls('openai'),
      state.chatState.openAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    resOpenAI.value = openAiModels;
  }
}

const modelOptions = computed(() => ({
  openai: resOpenRouter.value
    .map((m) => {
      const p = parseFloat(m.pricing?.prompt || '');
      const c = parseFloat(m.pricing?.completion || '');
      return { m, p: p + c };
    })
    .sort(({ p: p1 }, { p: p2 }) => p1 - p2)
    .map(({ m }) => ({
      label: `${m.id}: ${m.pricing?.prompt || 'N/A'}/${
        m.pricing?.completion || 'N/A'
      }`,
      value: m.id,
    })),
  openrouter: [...resOpenAI.value]
    .sort((m1, m2) => m1.id.localeCompare(m2.id))
    .map((m) => ({
      label: `${m.id}`,
      value: m.id,
    })),
}));

const modelLookUp = computed(() => ({
  openai: resOpenAI.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
  openrouter: resOpenRouter.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
}));

void fetchModels();

const estimatedTokens = computed(() => {
  // Tokenize the message
  const tokens = countStringTokens(state.taskDraft.content || '');

  // Return the token count
  return tokens;
});

function toggleSelectedTools() {
  if (state.selectedTools?.length > 0) {
    state.selectedTools = [];
  } else {
    state.selectedTools = Object.keys(tools);
  }
}

//TODO: remove this funciton, put this into executeTask
function sendMessageWrapper() {
  if (state.taskDraft.content)
    void sendMessage(
      state.taskDraft.content.trim(),
      state.chatState,
      state.selectedTools
    );
  state.taskDraft.content = '';
}

const currentFunctionTask = computed(() => {
  const task = {
    ...state.taskDraft,
    role: 'function' as LLMTask['role'],
  };
  return task;
});

function executeTask() {
  console.log('executing task!');
  const funcTaskid = addTask2Tree(
    currentFunctionTask.value,
    state.chatState.Tasks[state.chatState.selectedTaskId || ''],
    state.chatState,
    true
  );
}

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void sendMessageWrapper();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};
</script>
