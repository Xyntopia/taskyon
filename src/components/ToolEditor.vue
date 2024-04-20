<template>
  <div class="column q-pa-md q-gutter-sm">
    <q-select
      filled
      dense
      label="Select Tool"
      :options="Object.keys(toolCollection)"
      v-model="selectedToolName"
      input-debounce="100"
    />
    <q-input
      v-model="state.toolDraft.name"
      label="Specify the Name of the new Tool"
    />
    <codemirror
      v-model="state.toolDraft.code"
      placeholder="Code goes here..."
      :style="{ height: '400px' }"
      :autofocus="true"
      :indent-with-tab="true"
      :tab-size="2"
      :extensions="extensions"
      @ready="handleReady"
      @change="console.log('change', $event)"
      @focus="console.log('focus', $event)"
      @blur="console.log('blur', $event)"
    />
    <q-btn
      label="new tool"
      @click="state.toolDraft.code = newToolStructure()"
    ></q-btn>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { getTaskManager } from 'src/boot/taskyon';
import type { Tool, ToolBase } from 'src/modules/taskyon/tools';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { Codemirror } from 'vue-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

const state = useTaskyonStore();

const extensions = [javascript(), oneDark]

async function getAllTools() {
  return (await getTaskManager()).getTools();
}

const toolCollection = ref<Record<string, Tool>>({});
//void getAllTools().then((tools) => (toolCollection.value = tools));

const selectedToolName = ref<string>('');

function newToolStructure(): string {
  const tool = `{
    name: 'myExampleStringAdder',
    description: 'provide a short description which an AI can understand',
    longDescription: 'provide a long description if the AI/Human needs more details',
    // this is the actual function code which gets executed by the AI.
    function: (parameter1, parameter2 = 'default parameter :)')=>{
      return parameter1 + ' ' + parameter2;
    },
    parameters: {
      type: 'object',
      properties: {
        parameter1: {
          type: 'string',
          description: 'This is an example parameter!',
        },
        parameter2: {
          type: 'string',
          description: 'This is another example parameter, but not required!',
        },
      },
      required: ['parameter1'],
    },
  };`;
  return tool;
}
</script>
