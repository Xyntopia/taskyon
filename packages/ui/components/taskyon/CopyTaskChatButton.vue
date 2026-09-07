<template>
  <q-btn
    v-bind="$attrs"
    :icon="matCopyAll"
    :disable="tasks.length === 0"
    aria-label="copy entire chat as markdown"
    :loading="copying"
    @click="!client && copyConversation(false)"
  >
    <slot>
      <q-tooltip>Copy entire chat as markdown</q-tooltip>
    </slot>
    <q-menu v-if="client" auto-close>
      <q-list dense>
        <q-item clickable @click="copyConversation(false)"
          ><q-item-section>Copy conversation</q-item-section></q-item
        >
        <q-item clickable @click="copyConversation(true)"
          ><q-item-section>Copy everything</q-item-section></q-item
        >
      </q-list>
    </q-menu>
  </q-btn>
  <span v-if="copyError" role="status" class="text-caption text-negative">{{ copyError }}</span>
</template>

<script setup lang="ts">
import { matCopyAll } from '@quasar/extras/material-icons'
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { chat2Md } from '@taskyon/taskyon/chat-ui'
import type { TaskNode, TaskyonClient, ToolBase } from '@taskyon/taskyon/api'
import { ref } from 'vue'
import { selectTasksForChatCopy } from './taskChatVisibility'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  tasks: TaskNode[]
  client?: TaskyonClient | undefined
  selectedTaskId?: string | undefined
  tools?: Readonly<Record<string, ToolBase>> | undefined
}>()

const copying = ref(false)
const copyError = ref('')
const copyConversation = async (everything: boolean) => {
  if (copying.value) return
  copying.value = true
  copyError.value = ''
  try {
    const id = props.selectedTaskId
    const tasks =
      props.client && id ? await props.client.taskModel.exportSelection(id) : props.tasks
    const selected = everything ? tasks : selectTasksForChatCopy(tasks, props.tools ?? {}, false)
    await copyToClipboard(
      chat2Md(selected, everything, everything && id ? { leafID: id } : undefined),
    )
  } catch {
    copyError.value = 'Could not load and copy the complete conversation. Please retry.'
  } finally {
    copying.value = false
  }
}
</script>
