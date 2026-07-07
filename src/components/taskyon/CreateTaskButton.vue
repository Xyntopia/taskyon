<template>
  <q-btn v-bind="$attrs" @click="onAddTasks"> </q-btn>
</template>

<script setup lang="ts">
import { useAppStateStore } from 'src/stores/appState'
import { useTaskNavigation } from 'src/composables/useTaskNavigation'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { createTaskChainFromMarkdown, createTaskyonClient } from '@taskyon/tyclient'

const tystate = useTaskyonStore()
const taskyonClient = createTaskyonClient(tystate.api)
const state = useAppStateStore()
const { navigateToTask } = useTaskNavigation()

const props = defineProps<{
  markdown?: string
  scrollToBottom?: boolean
}>()

const onAddTasks = async () => {
  try {
    const newTaskId = await createTaskChainFromMarkdown(taskyonClient, props.markdown)
    navigateToTask(newTaskId)
  } catch (error) {
    console.log('could not create taskchain from markdown!', error)
    await taskyonClient.task.create({
      task: {
        role: 'system',
        content: {
          type: 'message',
          data: 'testestest  haha!!',
        },
      },
      execute: false,
      show: true,
    })
  }
  state.lockBottomScroll = props.scrollToBottom
}
</script>
