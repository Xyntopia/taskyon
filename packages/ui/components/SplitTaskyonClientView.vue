<template>
  <SplitTaskyonLayout
    :name="props.name"
    :persist="props.persist"
    storage-key-prefix="SplitTaskyonClientView"
    :chat-initially-collapsed="false"
    class="col"
  >
    <slot />
    <template #chat>
      <TaskyonClientPane
        v-bind="clientPaneAttrs"
        v-model:selected-task-id="selectedTaskId"
        v-model:recent-task-ids="recentTaskIds"
      />
    </template>
  </SplitTaskyonLayout>
</template>

<script setup lang="ts">
import TaskyonClientPane from './TaskyonClientPane.vue'
import SplitTaskyonLayout from './SplitTaskyonLayout.vue'
import type { AllowedComponentProps, VNodeProps } from 'vue'
import { computed } from 'vue'

type TaskyonClientPaneProps = Omit<
  InstanceType<typeof TaskyonClientPane>['$props'],
  | keyof VNodeProps
  | keyof AllowedComponentProps
  | 'selectedTaskId'
  | 'recentTaskIds'
  | 'onUpdate:selectedTaskId'
  | 'onUpdate:recentTaskIds'
>

const props = withDefaults(
  defineProps<
    TaskyonClientPaneProps & {
      name: string
      persist?: boolean
    }
  >(),
  { persist: false },
)

const clientPaneAttrs = computed(() => {
  const { name, persist, ...paneProps } = props
  void name
  void persist
  return paneProps
})

const selectedTaskId = defineModel<string | undefined>('selectedTaskId', {
  default: undefined,
})
const recentTaskIds = defineModel<string[]>('recentTaskIds', { default: () => [] })
</script>
