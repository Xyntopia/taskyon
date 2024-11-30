<template>
  <q-btn v-bind="$attrs" @click="onAddTasks"> </q-btn>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'src/stores/taskyonState';

const state = useTaskyonStore();

const props = defineProps<{
  markdown?: string;
  scrollToBottom?: boolean;
}>();

const onAddTasks = async () => {
  const newTaskId = await state.addMdTasks(props.markdown);
  state.llmSettings.selectedTaskId = newTaskId;
  state.lockBottomScroll = props.scrollToBottom;
};
</script>
