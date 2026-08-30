import type { TaskNode, ToolBase } from '@taskyon/taskyon/api'
import { isEntryNodeInternalToolName } from '@taskyon/taskyon/tools/entryNode'

export const isTaskVisibleInChat = (
  task: TaskNode,
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
  scopedToolDefinitions?: ReadonlyMap<string, TaskNode>,
) => {
  if (task.content.type === 'return') return false
  if (task.content.type === 'tooldefinition') return false
  if (task.content.type === 'functioncall') {
    if (isEntryNodeInternalToolName(task.content.data.name)) return false
    const scopedDefinition = scopedToolDefinitions?.get(task.content.data.name)
    const renderOptions =
      scopedDefinition?.content.type === 'tooldefinition'
        ? scopedDefinition.content.data.renderOptions
        : tools[task.content.data.name]?.renderOptions
    return renderOptions?.hideChat !== true
  }
  if (task.content.type === 'toolresult' || task.content.type === 'structured') return expertMode
  if (task.role === 'system' && task.content.type === 'message') return expertMode
  return true
}

export const selectTasksVisibleInChat = (
  tasks: readonly TaskNode[],
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
) => {
  const scopedToolDefinitions = new Map<string, TaskNode>()
  return tasks.filter((task) => {
    const visible = isTaskVisibleInChat(task, tools, expertMode, scopedToolDefinitions)
    if (task.content.type === 'tooldefinition') {
      scopedToolDefinitions.set(task.content.data.name, task)
    }
    return visible
  })
}

export const selectTasksForChatCopy = (
  tasks: readonly TaskNode[],
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
) =>
  selectTasksVisibleInChat(tasks, tools, expertMode).filter(
    (task) => task.content.type !== 'functioncall',
  )
