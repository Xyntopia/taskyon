import { TaskyonGuiMessage as TaskyonGuiMessageSchema } from '@taskyon/taskyon/api'
import type {
  guiMessageTypes as messageTypes,
  partialTyConfiguration,
  TaskyonGuiMessage as TaskyonGuiMessageType,
} from '@taskyon/taskyon/api'

export const TaskyonGuiMessage = TaskyonGuiMessageSchema
export type TaskyonGuiMessage = TaskyonGuiMessageType
export type { messageTypes, partialTyConfiguration }
