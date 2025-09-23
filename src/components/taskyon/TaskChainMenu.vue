<template>
  <q-btn flat unelevated round dense :icon="matMoreHoriz" @click.prevent.stop>
    <q-menu auto-close>
      <q-list dense>
        <q-item clickable @click="onDownloadChat(conversationId)">
          <q-item-section> Download Chat </q-item-section>
          <q-item-section side>
            <q-icon :name="matDownloadForOffline"></q-icon>
          </q-item-section>
        </q-item>
        <q-item clickable @click="onDeleteThread(conversationId)">
          <q-item-section>
            <q-item-label> Delete Conversation </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-icon :name="matDelete"></q-icon>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup lang="ts">
import { matDownloadForOffline, matDelete, matMoreHoriz } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'stores/taskyonState'
import { exportFile } from 'quasar'
import { useAppStateStore } from 'src/stores/appState'
import { chatToYaml } from 'src/modules/taskyon/taskUtils'

const tystate = useTaskyonStore()
const state = useAppStateStore()

defineProps<{
  conversationId: string
}>()

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId)
  const ty = await tystate.taskyon
  state.setSelectedTask(undefined)
  await ty.deleteTaskThread(conversationId)
  state.chatHistory = state.chatHistory.filter((id) => id != conversationId)
}

async function onDownloadChat(conversationId: string) {
  console.log('download thread!!', conversationId)
  const ty = await tystate.taskyon
  const task = await ty.getTask(conversationId)
  if (task) {
    const taskList = await ty.getTaskChain(conversationId)
    const taskThreadYaml = chatToYaml(taskList)
    if (taskThreadYaml) {
      const fileName = `tyn-${task.name || ''}.yaml`
      const mimeType = 'text/yaml'

      // Use Quasar's exportFile function for download
      exportFile(fileName, taskThreadYaml, mimeType)
    }
  }
}
</script>
