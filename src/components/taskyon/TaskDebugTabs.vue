<template>
  <div>
    <q-tabs v-model="activeTab" dense no-caps>
      <q-tab v-if="taskMeta?.error" name="ERROR" label="Error" />
      <q-tab name="TASKNODE" label="raw task data" />
      <q-tab v-if="hasConversationDebug" name="TASKPROMPT" label="raw conversation" />
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
      <q-tab-panel v-if="hasConversationDebug" name="TASKPROMPT" class="q-gutter-md">
        <div v-if="conversationMessages.length" class="debug-section">
          <div class="debug-section-title">Conversation</div>
          <div>
            <div v-for="(message, index) in conversationMessages" :key="`${message.role}-${index}`">
              <q-separator v-if="index > 0" class="debug-message-separator" />
              <div class="debug-role-label">{{ message.role }}</div>
              <div class="debug-message-card">
                <pre class="debug-message-text">{{ message.text }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div v-if="reasoningText" class="debug-section">
          <div class="debug-section-title">Reasoning</div>
          <div class="debug-role-label">assistant</div>
          <div class="debug-message-card debug-message-card--reasoning">
            <pre class="debug-message-text">{{ reasoningText }}</pre>
          </div>
        </div>

        <div v-if="completionText" class="debug-section">
          <div class="debug-section-title">Finished completion</div>
          <div class="debug-role-label">assistant</div>
          <div class="debug-message-card">
            <pre class="debug-message-text">{{ completionText }}</pre>
          </div>
        </div>
      </q-tab-panel>
      <q-tab-panel name="DEBUGGING">
        <ObjectView :model-value="toObject(taskMeta)" read-only copy-object-btn copy-btn />
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script setup lang="ts">
import type { TaskNode } from '@taskyon/taskyon'
import ObjectView from '@taskyon/shared/components/varViews/ObjectView.vue'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, ref, watchEffect } from 'vue'
import {
  getRawConversationDebug,
  hasRawConversationDebug as hasRawConversationDebugData,
} from './taskDebugConversation'

const props = defineProps<{
  task: TaskNode
}>()

const { task } = props

const tystate = useTaskyonStore()
const activeTab = ref<'ERROR' | 'TASKNODE' | 'TASKPROMPT' | 'RAW_INPUT' | 'DEBUGGING'>('TASKNODE')

const taskMeta = tystate.getTaskMetaRef(task.id)
const taskMetaPrevious = tystate.getTaskMetaRef(task.priorID ?? task.parentID)

const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }

const rawConversationDebug = computed(() => getRawConversationDebug(taskMeta.value))
const conversationMessages = computed(() => rawConversationDebug.value.conversationMessages)
const reasoningText = computed(() => rawConversationDebug.value.reasoningText)
const completionText = computed(() => rawConversationDebug.value.completionText)
const hasConversationDebug = computed(() => hasRawConversationDebugData(rawConversationDebug.value))

watchEffect(() => {
  const available = new Set<string>(['TASKNODE', 'DEBUGGING'])
  if (taskMeta.value?.error) available.add('ERROR')
  if (hasConversationDebug.value) available.add('TASKPROMPT')
  if (taskMetaPrevious.value?.rawOutput) available.add('RAW_INPUT')

  if (!available.has(activeTab.value)) {
    activeTab.value = available.has('ERROR') ? 'ERROR' : 'TASKNODE'
  }
})
</script>

<style scoped lang="sass">
.debug-section-title
  font-size: .85rem
  font-weight: 600
  opacity: .8

.debug-role-label
  font-size: .75rem
  font-weight: 600
  letter-spacing: .04em
  text-transform: uppercase
  opacity: .65
  margin-bottom: .25rem

.debug-message-card
  border: 1px solid rgba(255, 255, 255, .12)
  border-radius: 10px
  padding: .75rem .875rem
  background: rgba(255, 255, 255, .03)

.debug-message-separator
  margin: .75rem 0
  opacity: .45

.debug-message-card--reasoning
  background: rgba(255, 255, 255, .02)

.debug-message-text
  margin: 0
  white-space: pre-wrap
  word-break: break-word
  font-family: inherit
</style>
