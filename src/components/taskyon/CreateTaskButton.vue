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
  const tm = await tystate.getTaskManager()
  const newTaskId = await tm.addMdTaskChain(props.markdown)
  state.setSelectedTask(newTaskId)
  state.lockBottomScroll = props.scrollToBottom
}
</script>
