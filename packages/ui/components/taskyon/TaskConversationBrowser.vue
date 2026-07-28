<template>
  <section class="task-conversation-browser">
    <div class="chat-sidebar__header q-pa-xs text-caption row justify-center items-center">
      <q-icon :name="mdiForum" size="sm" />
      <div>{{ resolvedPresentation.recentChatsLabel }}</div>
    </div>
    <q-separator class="chat-sidebar__separator" spaced />
    <q-list dense class="chat-sidebar__conversation-list">
      <q-item
        v-for="conversationId in visibleConversationIds"
        :key="conversationId"
        v-close-popup
        :class="[
          'chat-sidebar__conversation',
          { 'chat-sidebar__conversation--active': selectedTaskId === conversationId },
        ]"
        clickable
        @click="emit('select', conversationId)"
      >
        <q-item-section
          :class="[
            'chat-sidebar__conversation-title',
            {
              'chat-sidebar__conversation-title--active': selectedTaskId === conversationId,
            },
          ]"
        >
          <template v-if="conversationTitle(conversationId)">
            {{ conversationTitle(conversationId) }}
          </template>
          <div v-else class="chat-sidebar__pending-name row no-wrap items-center">
            <q-icon :name="matAutorenew" class="q-mr-sm" />
            {{ `chat.${conversationId.slice(0, 3)}` }}
          </div>
          <q-tooltip>
            Select conversation {{ conversationTitle(conversationId) ?? conversationId }}
          </q-tooltip>
        </q-item-section>
        <q-item-section v-if="$slots['item-actions']" side class="chat-sidebar__conversation-menu">
          <slot name="item-actions" :conversation-id="conversationId" />
        </q-item-section>
      </q-item>
      <div
        v-if="visibleConversationIds.length === 0"
        class="task-conversation-browser__empty text-caption q-pa-sm text-center"
      >
        No recent chats
      </div>
    </q-list>
    <div class="chat-sidebar__actions row justify-around items-center">
      <slot name="actions-before" />
      <q-btn
        v-close-popup
        dense
        flat
        :icon="mdiForumPlus"
        class="chat-sidebar__action-button"
        aria-label="start new chat"
        @click="emit('new')"
      >
        <q-tooltip>{{ resolvedPresentation.newChatLabel }}</q-tooltip>
      </q-btn>
      <slot name="actions-after" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { matAutorenew } from '@quasar/extras/material-icons'
import { mdiForum, mdiForumPlus } from '@quasar/extras/mdi-v6'
import { resolveConversationTitle, type TaskyonClient } from '@taskyon/taskyon'
import {
  resolveTaskChatPresentation,
  type TaskChatPresentation,
} from '@taskyon/ui/modules/taskChatPresentation'
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    client: TaskyonClient
    conversationIds: readonly string[]
    selectedTaskId?: string | undefined
    titles?: Readonly<Record<string, string>>
    resolveTitle?: ((taskId: string) => Promise<string | undefined>) | undefined
    presentation?: Partial<TaskChatPresentation>
  }>(),
  {
    selectedTaskId: undefined,
    titles: () => ({}),
    resolveTitle: undefined,
    presentation: () => ({}),
  },
)

const emit = defineEmits<{
  (event: 'select', taskId: string): void
  (event: 'new'): void
}>()

const resolvedTitles = ref<Record<string, string>>({})
const visibleConversationIds = computed(() => props.conversationIds.slice(0, 10))
const resolvedPresentation = computed(() => resolveTaskChatPresentation(props.presentation))
const conversationTitle = (taskId: string) => props.titles[taskId] ?? resolvedTitles.value[taskId]

const loadMissingTitles = async () => {
  const resolveTitle =
    props.resolveTitle ?? ((taskId) => resolveConversationTitle(props.client.task, taskId))
  const entries = await Promise.all(
    visibleConversationIds.value.map(async (taskId) => {
      if (props.titles[taskId] || resolvedTitles.value[taskId]) return undefined
      try {
        const title = await resolveTitle(taskId)
        return title ? ([taskId, title] as const) : undefined
      } catch {
        return undefined
      }
    }),
  )
  const nextEntries = entries.filter((entry) => entry !== undefined)
  if (nextEntries.length) {
    resolvedTitles.value = { ...resolvedTitles.value, ...Object.fromEntries(nextEntries) }
  }
}

watch(
  () => visibleConversationIds.value.join('\0'),
  () => void loadMissingTitles(),
  { immediate: true },
)
</script>

<style scoped lang="sass">
.task-conversation-browser
  min-width: 14rem

.chat-sidebar__header,
.chat-sidebar__actions
  gap: 0.35rem

.chat-sidebar__conversation-list
  display: grid
  gap: 0.2rem

.chat-sidebar__conversation
  min-height: 2.25rem

.chat-sidebar__conversation-title
  min-width: 0

.chat-sidebar__actions
  padding: 0.4rem

.task-conversation-browser__empty
  min-height: 3rem
</style>
