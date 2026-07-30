import type { TaskNode, ToolBase } from '@taskyon/taskyon'

export const isTaskVisibleInChat = (
  task: TaskNode,
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
) => {
  if (task.content.type === 'return') return false
  if (task.content.type === 'functioncall') {
    return tools[task.content.data.name]?.renderOptions?.hideChat !== true
  }
  if (task.content.type === 'toolresult' || task.content.type === 'structured') return expertMode
  if (task.role === 'system' && task.content.type === 'message') return expertMode
  return true
}

export const selectTasksVisibleInChat = (
  tasks: readonly TaskNode[],
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
) => tasks.filter((task) => isTaskVisibleInChat(task, tools, expertMode))

export const selectTasksForChatCopy = (
  tasks: readonly TaskNode[],
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
) =>
  selectTasksVisibleInChat(tasks, tools, expertMode).filter(
    (task) => task.content.type !== 'functioncall',
  )
