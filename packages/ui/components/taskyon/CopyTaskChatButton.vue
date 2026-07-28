<template>
  <q-btn
    v-bind="$attrs"
    :icon="matCopyAll"
    :disable="tasks.length === 0"
    aria-label="copy entire chat as markdown"
    @click="copyConversation"
  >
    <slot>
      <q-tooltip>Copy entire chat as markdown</q-tooltip>
    </slot>
  </q-btn>
</template>

<script setup lang="ts">
import { matCopyAll } from '@quasar/extras/material-icons'
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { chat2Md, type TaskNode } from '@taskyon/taskyon'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  tasks: TaskNode[]
}>()

const copyConversation = () => copyToClipboard(chat2Md(props.tasks))
</script>
