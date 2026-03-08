<template>
  <div>
    <q-tabs v-model="activeTab" dense no-caps>
      <q-tab v-if="taskMeta?.error" name="ERROR" label="Error" />
      <q-tab name="TASKNODE" label="raw task data" />
      <q-tab v-if="taskMeta?.taskPrompt" name="TASKPROMPT" label="raw conversation" />
      <q-tab v-if="taskMetaPrevious?.rawOutput" name="RAW_INPUT" label="raw input" />
      <q-tab name="DEBUGGING" label="debugging" />
    </q-tabs>
    <q-tab-panels
      v-model="activeTab"
      animated
      swipeable
      horizontal
      transition-prev="jump-right"
      transition-next="jump-left"
    >
      <q-tab-panel name="ERROR">
        <ObjectView :model-value="toObject(taskMeta?.error)" read-only copy-object-btn copy-btn />
      </q-tab-panel>
      <q-tab-panel name="TASKNODE">
        <ObjectView :model-value="toObject(task)" read-only copy-object-btn copy-btn />
      </q-tab-panel>
      <q-tab-panel v-if="taskMetaPrevious?.rawOutput" name="RAW_INPUT">
        <ObjectView
          :model-value="toObject(taskMetaPrevious.rawOutput)"
          read-only
          copy-object-btn
          copy-btn
        />
      </q-tab-panel>
      <q-tab-panel v-if="taskMeta?.taskPrompt" name="TASKPROMPT">
        <ObjectView :model-value="taskPromptDebug" read-only copy-object-btn copy-btn />
      </q-tab-panel>
      <q-tab-panel name="DEBUGGING">
        <ObjectView :model-value="toObject(taskMeta)" read-only copy-object-btn copy-btn />
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script setup lang="ts">
import type { ChatResponseType, TaskNode } from '@taskyon/taskyon'
import ObjectView from '@taskyon/shared/components/varViews/ObjectView.vue'
import type { ModelMessage } from 'ai'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, onUnmounted, ref, watchEffect } from 'vue'

const props = defineProps<{
  task: TaskNode
}>()

const { task } = props

const tystate = useTaskyonStore()
const activeTab = ref<'ERROR' | 'TASKNODE' | 'TASKPROMPT' | 'RAW_INPUT' | 'DEBUGGING'>('TASKNODE')

const subscriptions: Array<() => void> = []
onUnmounted(() => subscriptions.forEach((unsub) => unsub()))

const taskMeta = tystate.getTaskMetaRef(task.id)
const taskMetaPrevious = tystate.getTaskMetaRef(task.priorID ?? task.parentID)
const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }

const taskChoice = computed(() => {
  try {
    return (taskMeta.value?.rawOutput as { choice: ChatResponseType['choices'][0] }).choice?.message
      .content
  } catch {
    return '<no chatcompletion output avaailable>'
  }
})

const taskReason = computed(() => {
  try {
    return (
      (taskMeta.value?.rawOutput as { choice: ChatResponseType['choices'][0] }).choice?.reasoning ||
      '<no reasoning output available>'
    )
  } catch {
    return '<no reasoning output available>'
  }
})

const taskPromptDebug = computed<Record<string, unknown>>(() => ({
  taskPrompt: (taskMeta.value?.taskPrompt as ModelMessage[] | undefined) ?? [],
  reasoning: taskReason.value,
  finishedCompletion: taskChoice.value ?? null,
}))

watchEffect(() => {
  const available = new Set<string>(['TASKNODE', 'DEBUGGING'])
  if (taskMeta.value?.error) available.add('ERROR')
  if (taskMeta.value?.taskPrompt) available.add('TASKPROMPT')
  if (taskMetaPrevious.value?.rawOutput) available.add('RAW_INPUT')

  if (!available.has(activeTab.value)) {
    activeTab.value = available.has('ERROR') ? 'ERROR' : 'TASKNODE'
  }
})
</script>
