<template>
  <UnderConstructionHint />
  <div class="row">
    <q-tabs v-model="selectedTab" class="col-auto" dense no-caps vertical>
      <q-tab name="tools" :icon="mdiTools" label="tool editor" />
      <q-tab name="configure" :icon="matTune" label="configure" />
    </q-tabs>
    <q-tab-panels
      :model-value="selectedTab"
      animated
      swipeable
      infinite
      class="col"
    >
      <q-tab-panel name="tools">
        <div class="column q-pa-md q-gutter-sm">
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
            <a
              href="https://rest.wiki/https://taskyon.space/docs/openapi-docs.yml"
              >In a viewer</a
            >
            or here:
            <a href="/docs/openapi-docs.yml" target="_blank"
              >openapi-docs.yaml</a
            >
          </div>
          <CreateNewTask
            coding-mode
            :force-task-props="functionTemplate"
            :send-allowed="taskParser === true ? true : false"
          />
          {{ taskParser }}
          <q-btn label="new tool" @click="newToolStructure()"></q-btn>
        </div>
      </q-tab-panel>
      <q-tab-panel name="configure" class="column">
        <q-btn
          label="import current settings"
          @click="importCurrentSettings"
        ></q-btn>
        <div class="col">
          <CodeEditor v-model="state.configurationDraft" />
        </div>
        {{ configParser }}
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { partialTyConfiguration, ToolBase } from 'src/modules/taskyon/types';
import CodeEditor from '../CodeEditor.vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import CreateNewTask from './CreateNewTask.vue';
import ObjectTreeView from '../ObjectTreeView.vue';
import { taskTemplateTypes } from 'src/modules/taskyon/types';
import UnderConstructionHint from '../UnderConstructionHint.vue';
import { mdiToolbox, mdiTools } from '@quasar/extras/mdi-v6';
import { matTune } from '@quasar/extras/material-icons';

const functionTemplate = taskTemplateTypes.toolDescription.parse(undefined);

const state = useTaskyonStore();

const selectedTab = ref('tools');

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

function importCurrentSettings() {
  console.log('import current settings...');
  const newObj = (({ llmSettings, appConfiguration }) => ({
    llmSettings,
    appConfiguration,
  }))(state);
  state.configurationDraft = JSON.stringify(newObj, null, 2);
}

const configParser = computed(() => {
  try {
    const jsonConfigResult = partialTyConfiguration.safeParse(
      JSON.parse(state.configurationDraft),
    );
    return jsonConfigResult.success
      ? jsonConfigResult.success
      : jsonConfigResult.error;
  } catch (error) {
    console.log(error);
    return error;
  }
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
  "code": "({parameter1, parameter2 = 'default parameter :)'}) => {return parameter1 + ' ' + parameter2;}"
}`;
  state.llmSettings.taskDraft.content = {
    ...state.llmSettings.taskDraft.content,
    message: tool,
  };
}
</script>
