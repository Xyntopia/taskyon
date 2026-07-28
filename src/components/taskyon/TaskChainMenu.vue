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
import { matDelete, matDownloadForOffline, matMoreHoriz } from '@quasar/extras/material-icons'
import { chatToYaml } from '@taskyon/taskyon'
import { exportFile } from 'quasar'
import { useTaskNavigation } from 'src/composables/useTaskNavigation'
import { useTaskyonStore } from 'stores/taskyonState'

const tystate = useTaskyonStore()
const { navigateToTask } = useTaskNavigation()

defineProps<{
  conversationId: string
}>()

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId)
  const ty = await tystate.taskyon
  navigateToTask(undefined, { path: '/' })
  await ty.deleteTaskThread(conversationId)
  await tystate.conversationHistory.remove(conversationId)
}

async function onDownloadChat(conversationId: string) {
  console.log('download thread!!', conversationId)
  const task = await tystate.taskyonClient.task.get({ id: conversationId })
  if (task) {
    const taskList = await tystate.taskyonClient.task.getChain({ id: conversationId })
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
