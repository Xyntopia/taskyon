import { mdiRobotOutline } from '@quasar/extras/mdi-v6'

export type TaskChatPresentation = {
  assistantLabel: string
  assistantIcon: string
  startingMessage: string
  composerPlaceholder: string
  newChatLabel: string
  recentChatsLabel: string
}

export const defaultTaskChatPresentation: TaskChatPresentation = {
  assistantLabel: 'Taskyon',
  assistantIcon: mdiRobotOutline,
  startingMessage: 'Starting Taskyon...',
  composerPlaceholder: 'Type your message...',
  newChatLabel: 'Create new chat',
  recentChatsLabel: 'Recent chats',
}

export const resolveTaskChatPresentation = (
  presentation: Partial<TaskChatPresentation> | undefined,
): TaskChatPresentation => ({
  ...defaultTaskChatPresentation,
  ...presentation,
})
