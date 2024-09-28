<template>
  <q-page class="q-pa-md q-gutter-md">
    <div v-for="(e, idx) of state.getErrors()" :key="idx">
      <p class="text-bold">{{ idx }}:</p>
      <pre>{{ e }}</pre>
    </div>
    <q-expansion-item label="state" style="white-space: pre-wrap">
      {{ JSON.stringify(completeChat, null, 2) }}
    </q-expansion-item>
    <q-expansion-item label="state">
      <object-tree-view :model-value="appConfiguration" />
    </q-expansion-item>
    <q-expansion-item label="router">{{ $router }}</q-expansion-item>
    <q-expansion-item label="route">{{ $route }}</q-expansion-item>
  </q-page>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import { storeToRefs } from 'pinia';
import { generateCompleteChat } from 'src/modules/taskyon/promptCreation';
import { ref } from 'vue';
const state = useTaskyonStore();

const completeChat = ref<Record<string, unknown>>({});

async function completionMessage() {
  const tm = await state.getTaskManager();
  if (state.llmSettings.selectedTaskId) {
    const task = await (
      await state.getTaskManager()
    ).getTask(state.llmSettings.selectedTaskId);
    if (task) {
      const res = await generateCompleteChat(task, state.llmSettings, tm);
      completeChat.value = res;
    }
  }
}

void completionMessage();

const { appConfiguration } = storeToRefs(state);
//const stateView = {...state}
</script>
