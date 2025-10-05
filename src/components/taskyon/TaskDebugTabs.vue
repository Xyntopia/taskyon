<template>
  <div>
    <q-tabs v-model="state.messageDebug[task.id]" dense no-caps>
      <q-tab v-if="taskMeta?.error" name="ERROR" label="Error" />
      <q-tab name="TASKNODE" label="raw task data" />
      <q-tab v-if="taskMeta?.taskPrompt" name="TASKPROMPT" label="raw conversation" />
      <q-tab v-if="taskMetaPrevious?.rawOutput" name="RAW_INPUT" label="raw input" />
      <q-tab name="DEBUGGING" label="debugging" />
    </q-tabs>
    <q-tab-panels
      v-model="state.messageDebug[task.id]"
      animated
      swipeable
      horizontal
      transition-prev="jump-right"
      transition-next="jump-left"
    >
      <q-tab-panel name="ERROR">
        <textarea
          :value="JSON.stringify(taskMeta?.error, null, 2)"
          readonly
          wrap="soft"
          style="width: 100%; height: 200px; background-color: inherit; color: inherit"
        >
        </textarea>
      </q-tab-panel>
      <q-tab-panel name="TASKNODE">
        <textarea
          :value="JSON.stringify(task, null, 2)"
          readonly
          wrap="soft"
          style="width: 100%; height: 200px; background-color: inherit; color: inherit"
        >
        </textarea>
      </q-tab-panel>
      <q-tab-panel v-if="taskMetaPrevious?.rawOutput" name="RAW_INPUT">
        <textarea
          :value="JSON.stringify(taskMetaPrevious.rawOutput, null, 2)"
          readonly
          wrap="soft"
          style="width: 100%; height: 200px; background-color: inherit; color: inherit"
        >
        </textarea>
      </q-tab-panel>
      <q-tab-panel v-if="taskMeta?.taskPrompt" name="TASKPROMPT">
        <template
          v-for="(tp, idx) in taskMeta.taskPrompt.openAIConversationThread as OpenAIMessage[]"
          :key="idx"
        >
          <div class="text-caption q-pt-sm">{{ tp.role }}</div>
          <textarea
            :value="typeof tp.content === 'string' ? tp.content : ''"
            readonly
            wrap="soft"
            style="width: 100%; height: 200px; background-color: inherit; color: inherit"
          >
          </textarea>
        </template>
        <div></div>
        <div class="text-caption">reasoning:</div>
        <textarea
          :value="taskReason"
          readonly
          wrap="soft"
          style="width: 100%; height: 200px; background-color: inherit; color: inherit"
        />
        <div class="text-caption">finished completion:</div>
        <textarea
          :value="taskChoice || null"
          readonly
          wrap="soft"
          style="width: 100%; height: 200px; background-color: inherit; color: inherit"
        >
        </textarea>
      </q-tab-panel>
      <q-tab-panel name="DEBUGGING">
        <textarea
          :value="JSON.stringify(taskMeta, null, 2)"
          readonly
          wrap="soft"
          style="width: 100%; height: 200px; background-color: inherit; color: inherit"
        >
        </textarea>
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script setup lang="ts">
import type { ChatResponseType, OpenAIMessage, TaskNode } from '@taskyon/taskyon'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, onUnmounted } from 'vue'

const props = defineProps<{
  task: TaskNode
}>()

const { task } = props

const tystate = useTaskyonStore()
const state = useAppStateStore()

const subscriptions: Array<() => void> = []
onUnmounted(() => subscriptions.forEach((unsub) => unsub()))

const taskMeta = tystate.getTaskMetaRef(task.id)
const taskMetaPrevious = tystate.getTaskMetaRef(task.priorID ?? task.parentID)

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
</script>
