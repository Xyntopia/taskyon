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
  try {
    const newTaskId = await tm.addMdTaskChain(props.markdown)
    state.setSelectedTask(newTaskId)
  } catch (error) {
    console.log('could not create taskchain from markdown!', error)
    tystate.api.send({
      type: 'task',
      task: {
        role: 'system',
        content: {
          type: 'message',
          data: 'testestest  haha!!',
        },
      },
      execute: false,
      show: true,
      origin: window.location.origin,
    })
  }
  state.lockBottomScroll = props.scrollToBottom
}
</script>
