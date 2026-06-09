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
          <div class="q-gutter-sm">
            <div v-for="(message, index) in conversationMessages" :key="`${message.role}-${index}`">
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
import { serializeObject } from '@taskyon/shared/modules/serializeObject'
import type { TaskNode } from '@taskyon/taskyon'
import ObjectView from '@taskyon/shared/components/varViews/ObjectView.vue'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, ref, watchEffect } from 'vue'

type ConversationEntry = {
  role: string
  text: string
}

type RawOutputChoice = {
  messageContent: unknown
  reasoning?: string
}

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

const stringifyDebugValue = (value: unknown) =>
  serializeObject(value, {
    maxDepth: 3,
    maxArrayLength: 12,
    maxObjectKeys: 20,
    maxStringLength: 1200,
    format: 'yaml',
  })

const renderMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    return content.map(renderMessageContent).filter(Boolean).join('\n\n')
  }
  if (typeof content === 'object') {
    const maybeText = 'text' in content ? content.text : undefined
    if (typeof maybeText === 'string') return maybeText
  }
  return stringifyDebugValue(content)
}

const parseConversationMessages = (value: unknown): ConversationEntry[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !('role' in entry)) return []
    const role = typeof entry.role === 'string' ? entry.role : 'unknown'
    const text = renderMessageContent('content' in entry ? entry.content : undefined).trim()
    return [{ role, text: text || '<empty message>' }]
  })
}

const parseRawOutputChoice = (value: unknown): RawOutputChoice | undefined => {
  if (!value || typeof value !== 'object' || !('choice' in value)) return undefined
  const choice = value.choice
  if (!choice || typeof choice !== 'object' || !('message' in choice)) return undefined
  const message = choice.message
  if (!message || typeof message !== 'object' || !('content' in message)) return undefined
  const reasoning =
    'reasoning' in choice && typeof choice.reasoning === 'string' ? choice.reasoning : undefined
  return {
    messageContent: message.content,
    reasoning,
  }
}

const conversationMessages = computed(() => parseConversationMessages(taskMeta.value?.taskPrompt))
const rawOutputChoice = computed(() => parseRawOutputChoice(taskMeta.value?.rawOutput))
const reasoningText = computed(
  () => rawOutputChoice.value?.reasoning?.trim() || taskMeta.value?.reasoning?.trim() || '',
)
const completionText = computed(() => {
  const rendered = renderMessageContent(rawOutputChoice.value?.messageContent).trim()
  return rendered || ''
})
const hasConversationDebug = computed(
  () =>
    conversationMessages.value.length > 0 ||
    reasoningText.value.length > 0 ||
    completionText.value.length > 0,
)

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

.debug-message-card--reasoning
  background: rgba(255, 255, 255, .02)

.debug-message-text
  margin: 0
  white-space: pre-wrap
  word-break: break-word
  font-family: inherit
</style>
