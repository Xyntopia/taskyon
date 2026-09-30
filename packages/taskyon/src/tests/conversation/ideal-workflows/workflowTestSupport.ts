import type { TaskNode } from '../../../types/taskNode'

export const verifySearchedComputation = (
  tasks: readonly TaskNode[],
  completionMetas: readonly unknown[],
  sourceValue: string,
) => {
  const lastToolIndex = tasks.findLastIndex(
    (task) =>
      task.content.type === 'functioncall' &&
      ['executeJavaScript', 'bash'].includes(task.content.data.name),
  )
  const lastTool = tasks[lastToolIndex]
  if (lastTool?.content.type !== 'functioncall') throw new Error('Expected an execution tool')
  let completionIndex = 0
  const searchBeforeTool = tasks.slice(0, lastToolIndex).some((task) => {
    if (task.content.type === 'functioncall' && task.content.data.name === 'chatCompletion') {
      return hasRecordedProviderWebSearch(completionMetas[completionIndex++])
    }
    return hasSearchSource([task])
  })
  if (!searchBeforeTool) throw new Error('Expected search evidence before the final computation')
  const args = lastTool.content.data.arguments
  const code =
    typeof args.code === 'string' ? args.code : typeof args.command === 'string' ? args.command : ''
  const decodedCode = code.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
  if (!decodedCode.includes(sourceValue))
    throw new Error('Computation did not use the independently verified source value')
  const reversedValue = [...sourceValue].reverse().join('')
  const result = tasks.slice(lastToolIndex + 1).find((task) => task.content.type === 'toolresult')
  if (
    result?.content.type !== 'toolresult' ||
    !JSON.stringify(result.content.data).includes(reversedValue)
  )
    throw new Error('Expected the correctly reversed source value in the tool result')
  return reversedValue
}
verifySearchedComputation.helper = true

export const workflowSteps = (tasks: readonly TaskNode[]): string[] =>
  tasks.flatMap((task, index) => {
    if (task.content.type === 'functioncall') return [task.content.data.name]
    if (task.content.type === 'toolresult') return ['tool result']
    if (task.content.type === 'return') return ['return']
    if (task.content.type === 'error') return ['error']
    if (task.content.type === 'message' && task.role === 'user') return ['user']
    if (task.content.type === 'message' && task.role === 'assistant') {
      return tasks[index + 1]?.content.type === 'return' ? ['assistant'] : []
    }
    return []
  })
workflowSteps.helper = true

export const getWorkflowDeviation = (
  observed: readonly string[],
  expected: readonly (readonly string[])[],
  label: string,
  complete = false,
): string | undefined => {
  if (
    expected.some(
      (flow) =>
        (!complete || observed.length === flow.length) &&
        observed.every((step, index) => step === flow[index]),
    )
  ) {
    return undefined
  }
  return `Unexpected ${label} workflow: ${observed.join(' → ')}`
}
getWorkflowDeviation.helper = true

export const hasSearchSource = (tasks: readonly TaskNode[]) =>
  tasks.some(
    (task) =>
      task.content.type === 'message' &&
      task.content.ann?.some((annotation) => annotation.type === 'url'),
  )
hasSearchSource.helper = true

export const waitForTaskMeta = async (
  readMeta: (taskId: string) => Promise<unknown>,
  taskId: string,
  attempts = 20,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const meta = await readMeta(taskId)
    if (meta && typeof meta === 'object' && 'streamContent' in meta) return meta
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return await readMeta(taskId)
}
waitForTaskMeta.helper = true

export const hasRecordedProviderWebSearch = (meta: unknown) =>
  meta !== null &&
  typeof meta === 'object' &&
  'providerWebSearch' in meta &&
  meta.providerWebSearch !== null &&
  typeof meta.providerWebSearch === 'object' &&
  'performed' in meta.providerWebSearch &&
  meta.providerWebSearch.performed === true
hasRecordedProviderWebSearch.helper = true
