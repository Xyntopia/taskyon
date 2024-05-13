<template>
  <div>
    <UnderConstructionHint />
    <ObjectTreeView :model-value="state.chatState.taskChatTemplates" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ToolBase } from 'src/modules/taskyon/tools';
import { useTaskyonStore } from 'src/stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import ObjectTreeView from './ObjectTreeView.vue';
import { taskTemplateTypes } from 'src/modules/taskyon/types';
import UnderConstructionHint from './UnderConstructionHint.vue';

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
  return (await state.getTaskManager()).searchToolDefinitions();
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
    const jsonToolResult = ToolBase.strict().safeParse(
      JSON.parse(state.taskDraft.content?.message || '')
    );
    return jsonToolResult.success
      ? jsonToolResult.success
      : jsonToolResult.error;
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
  state.taskDraft.content = {
    ...state.taskDraft.content,
    message: tool,
  };
}
</script>
