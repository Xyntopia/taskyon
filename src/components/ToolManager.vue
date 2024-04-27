<template>
  <div class="column q-pa-md q-gutter-sm">
    <div class="row q-gutter-sm items-center text-white bg-negative">
      <q-icon name="science" size="md" />
      <div>This page is under construction. And not fully functional</div>
      <q-icon size="md" name="engineering" />
    </div>
    <q-select
      filled
      dense
      label="Select Tool"
      :options="Object.keys(toolCollection)"
      v-model="selectedToolName"
      input-debounce="100"
    />
    <!--<q-input
      v-model="state.toolDraft.name"
      label="Specify the Name of the new Tool"
    />-->
    Currently defined custom tools:
    <q-list dense bordered separator>
      <q-expansion-item
        v-for="f in toolCollection"
        :key="f.name"
        :label="f.name"
      >
        <ObjectTreeView :model-value="f"></ObjectTreeView>
      </q-expansion-item>
    </q-list>
    <CreateNewTask coding-mode :labels="['function']" />
    {{ taskParser }}
    <q-btn label="new tool" @click="newToolStructure()"></q-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { getTaskManager } from 'src/boot/taskyon';
import { ToolBase } from 'src/modules/taskyon/tools';
import { useTaskyonStore } from 'src/stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import ObjectTreeView from './ObjectTreeView.vue';

const state = useTaskyonStore();

/*//this is only needed if we need direct access to the codemirror element
//  add this to the <codemirror ...       @ready="handleReady" />
const view = shallowRef()
const handleReady = (payload) => {
  view.value = payload.view;
};
*/

async function getAllTools() {
  return (await getTaskManager()).searchToolDefinitions();
}

const toolCollection = ref<Awaited<ReturnType<typeof getAllTools>>>({});
void getAllTools().then((tools) => {
  console.log('tools:', tools);
  toolCollection.value = tools;
});

//void getAllTools().then((tools) => (toolCollection.value = tools));

const selectedToolName = ref<string>('');

const taskParser = computed(() => {
  try {
    const jsonTool = ToolBase.strict().safeParse(
      JSON.parse(state.taskDraft.content || '')
    );
    return jsonTool.success ? jsonTool.success : jsonTool.error;
  } catch (error) {
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
  "code": "(parameter1, parameter2 = 'default parameter :)') => {return parameter1 + ' ' + parameter2;}"
}`;
  state.taskDraft.content = tool;
}
</script>
