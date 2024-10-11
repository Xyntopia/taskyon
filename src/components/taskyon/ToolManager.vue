<template>
  <div class="column q-pa-md q-gutter-sm">
    <UnderConstructionHint />
    <q-select
      v-model="selectedToolName"
      filled
      dense
      label="Select Tool"
      :options="Object.keys(toolCollection)"
      input-debounce="100"
    />
    <!--<q-input
      v-model="state.toolDraft.name"
      label="Specify the Name of the new Tool"
    />-->
    <q-expansion-item
      label="Currently defined custom tools:"
      :icon="mdiToolbox"
    >
      <q-list dense bordered separator>
        <q-expansion-item
          v-for="f in toolCollection"
          :key="f.name"
          :label="f.name"
        >
          <ObjectTreeView :model-value="f"></ObjectTreeView>
        </q-expansion-item>
      </q-list>
    </q-expansion-item>
    <div>
      You can find a openapi spec of the taskyon iframe API here:
      <a href="https://rest.wiki/https://taskyon.space/docs/openapi-docs.yml"
        >In a viewer</a
      >
      or here:
      <a href="/docs/openapi-docs.yml" target="_blank">openapi-docs.yaml</a>
    </div>
    <CreateNewTask
      coding-mode
      :force-task-props="functionTemplate"
      :send-allowed="taskParser === true ? true : false"
    />
    {{ taskParser }}
    <q-btn label="new tool" @click="newToolStructure()"></q-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ToolBase } from 'src/modules/taskyon/types';
import { useTaskyonStore } from 'src/stores/taskyonState';
import CreateNewTask from './CreateNewTask.vue';
import ObjectTreeView from '../ObjectTreeView.vue';
import { taskTemplateTypes } from 'src/modules/taskyon/types';
import UnderConstructionHint from '../UnderConstructionHint.vue';
import { mdiToolbox } from '@quasar/extras/mdi-v6';

const functionTemplate = taskTemplateTypes.toolDescription.parse(undefined);

const state = useTaskyonStore();

/*//this is only needed if we need direct access to the codemirror element
//  add this to the <codemirror ...       @ready="handleReady" />
const view = shallowRef()
const handleReady = (payload) => {
  view.value = payload.view;
};
*/

async function getAllTools() {
  return (await state.getTaskManager()).updateToolDefinitions();
}

const toolCollection = ref<Awaited<ReturnType<typeof getAllTools>>>({});
void getAllTools().then((tools) => {
  console.log('tools:', tools);
  toolCollection.value = tools;
});

//void getAllTools().then((tools) => (toolCollection.value = tools));

const selectedToolName = ref<string>('');

const taskParser = computed(() => {
  if ('message' in state.llmSettings.taskDraft.content) {
    try {
      const jsonToolResult = ToolBase.strict().safeParse(
        JSON.parse(state.llmSettings.taskDraft.content.message),
      );
      return jsonToolResult.success
        ? jsonToolResult.success
        : jsonToolResult.error;
    } catch (error) {
      return error;
    }
  }
  return 'task is not a message task!';
});

function newToolStructure() {
  const tool = `
{
  "name": "myExampleStringAdderAlone",
  "description": "provide a short description which an AI can understand",
  "longDescription": "provide a long description if the AI/Human needs more details",
  "parameters": {
    "type": "object",
    "properties": {
      "parameter1": {
        "type": "string",
        "description": "This is an example parameter!"
      },
      "parameter2": {
        "type": "string",
        "description": "This is another example parameter, but not required!"
      }
    },
    "required": ["parameter1"]
  },
  "code": "(parameter1, parameter2 = 'default parameter :)') => {return parameter1 + ' ' + parameter2;}"
}`;
  state.llmSettings.taskDraft.content = {
    ...state.llmSettings.taskDraft.content,
    message: tool,
  };
}
</script>
