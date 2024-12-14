<template>
  <q-btn v-bind="$attrs" @click="onAddTasks"> </q-btn>
</template>

<script setup lang="ts">
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'

const tystate = useTaskyonStore()
const state = useAppStateStore()

const props = defineProps<{
  markdown?: string
  scrollToBottom?: boolean
}>()

const onAddTasks = async () => {
  const newTaskId = await tystate.addMdTasks(props.markdown)
  state.llmSettings.selectedTaskId = newTaskId
  state.lockBottomScroll = props.scrollToBottom
}
</script>
