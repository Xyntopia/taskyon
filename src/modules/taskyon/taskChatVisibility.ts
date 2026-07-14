import type { TaskNode, ToolBase } from '@taskyon/taskyon'

export const isTaskVisibleInChat = (
  task: TaskNode,
  tools: Readonly<Record<string, ToolBase>>,
  expertMode: boolean,
) => {
  if (task.content.type === 'return') return false
  if (task.content.type === 'structured') return expertMode
  if (task.content.type !== 'functioncall') return true
  return tools[task.content.data.name]?.renderOptions?.hideChat !== true
}
