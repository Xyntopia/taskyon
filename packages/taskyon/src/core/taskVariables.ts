import type { ReadonlyDeep } from 'type-fest'
import type { TaskNode, TaskGetter } from '../types/taskNode'
import type { FunctionArguments } from '../types/tools'
import { safeYamlDump } from '../utils/yamlUtils'

export const TASK_REF_PREFIX = '_t:'
const PLACEHOLDER_REGEX = /{{\s*([^{}]+?)\s*}}/g

export type TaskVariableRef = `${typeof TASK_REF_PREFIX}${string}`
export type TaskVariableSurface = 'llm' | 'ui' | 'cli' | 'execution'

type TaskVariablePresentationService = ReturnType<typeof createTaskVariablePresentationService>

type MaterializeOptions = {
  surface: TaskVariableSurface
  getTaskById: TaskGetter
  variableService?: TaskVariablePresentationService
  tasksById?: Map<string, TaskNode>
  stringifyValue?: (value: unknown) => string
}

type UnknownMap = Record<string, unknown>

const SPECIAL_TOOL_PREFIXES: Record<string, string> = {
  chatCompletion: 'chat',
  executePythonScript: 'python',
}

const isObjectMap = (value: unknown): value is UnknownMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getUseMapping = (value: unknown): UnknownMap | undefined => {
  if (value === undefined) return undefined
  if (!isObjectMap(value)) {
    throw new Error('Taskyon $use must be an object mapping argument paths to variable names.')
  }
  return value
}

const normalizeVariablePrefix = (value: string) => {
  const special = SPECIAL_TOOL_PREFIXES[value]
  if (special) return special

  const stripped = value
    .replace(/^(execute|run|use)/i, '')
    .replace(/(script|tool)$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
  const normalized = stripped ? stripped[0]!.toLowerCase() + stripped.slice(1) : 'result'
  return normalized || 'result'
}

const inferVariablePrefix = (task: TaskNode, tasksById: Map<string, TaskNode>) => {
  if (task.content.type === 'message') return 'message'
  if (task.content.type === 'error') return 'error'
  if (task.content.type === 'functioncall') return normalizeVariablePrefix(task.content.data.name)
  if (task.content.type === 'toolresult' && task.parentID) {
    const parent = tasksById.get(task.parentID)
    if (parent?.content.type === 'functioncall') {
      return normalizeVariablePrefix(parent.content.data.name)
    }
  }
  return 'result'
}

const toTaskRef = (taskId: string): TaskVariableRef => `${TASK_REF_PREFIX}${taskId}`

export const isTaskVariableRef = (value: string): value is TaskVariableRef =>
  value.startsWith(TASK_REF_PREFIX) && value.length > TASK_REF_PREFIX.length

export const taskRefToTaskId = (value: string): string | undefined =>
  isTaskVariableRef(value) ? value.slice(TASK_REF_PREFIX.length) : undefined

export const createTaskVariablePresentationService = () => {
  const taskIdToVariableName = new Map<string, string>()
  const variableNameToTaskId = new Map<string, string>()
  const prefixCounters = new Map<string, number>()

  const reserve = (taskId: string, name: string) => {
    const existingTaskId = variableNameToTaskId.get(name)
    if (existingTaskId && existingTaskId !== taskId) {
      throw new Error(`Task variable collision for ${name}: ${existingTaskId} vs ${taskId}`)
    }
    taskIdToVariableName.set(taskId, name)
    variableNameToTaskId.set(name, taskId)
    return name
  }

  const getOrAssignVariableName = (task: TaskNode, tasksById: Map<string, TaskNode>) => {
    const existing = taskIdToVariableName.get(task.id)
    if (existing) return existing

    const prefix = inferVariablePrefix(task, tasksById)
    let counter = prefixCounters.get(prefix) ?? 0

    while (true) {
      counter += 1
      const candidate = `${prefix}${counter}`
      if (!variableNameToTaskId.has(candidate)) {
        prefixCounters.set(prefix, counter)
        return reserve(task.id, candidate)
      }
    }
  }

  const resolveVariableName = (name: string) => variableNameToTaskId.get(name)

  const variableNameForTaskId = (
    taskId: string,
    task?: TaskNode,
    tasksById?: Map<string, TaskNode>,
  ) => {
    const existing = taskIdToVariableName.get(taskId)
    if (existing) return existing
    if (!task || !tasksById) return undefined
    return getOrAssignVariableName(task, tasksById)
  }

  return {
    getOrAssignVariableName,
    resolveVariableName,
    variableNameForTaskId,
    taskIdToVariableName,
    variableNameToTaskId,
  }
}

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const hasOwnPath = (value: Record<string, unknown>, path: string) => {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = value
  for (const part of parts) {
    if (!isObjectMap(current) || !(part in current)) return false
    current = current[part]
  }
  return true
}

const setDeepPath = (value: Record<string, unknown>, path: string, nextValue: unknown) => {
  const parts = path.split('.').filter(Boolean)
  if (parts.length === 0) {
    throw new Error('Taskyon $use path must not be empty.')
  }
  let current: Record<string, unknown> = value
  for (const part of parts.slice(0, -1)) {
    const existing = current[part]
    if (existing === undefined) {
      current[part] = {}
    } else if (!isObjectMap(existing)) {
      throw new Error(`Taskyon $use path ${path} conflicts with a non-object parent at ${part}.`)
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts.at(-1)!] = nextValue
}

const stringifyExecutionValue = (value: unknown) => {
  if (typeof value === 'string') return value
  return safeYamlDump(value)
}

const replaceTemplateRefs = async (input: string, options: MaterializeOptions): Promise<string> => {
  const matches = Array.from(input.matchAll(PLACEHOLDER_REGEX))
  if (matches.length === 0) return input

  let output = input
  for (const match of matches) {
    const rawName = match[1]?.trim()
    if (!rawName) continue

    const taskId = isTaskVariableRef(rawName)
      ? taskRefToTaskId(rawName)
      : options.variableService?.resolveVariableName(rawName)
    if (!taskId) {
      throw new Error(`Unknown Taskyon variable placeholder: ${rawName}`)
    }

    const task = options.tasksById?.get(taskId) ?? (await options.getTaskById(taskId))
    if (!task) {
      throw new Error(`Taskyon variable placeholder points to missing task ${taskId}`)
    }
    options.tasksById?.set(taskId, task)

    let replacement = ''
    if (options.surface === 'llm') {
      const variableName = options.variableService?.variableNameForTaskId(
        task.id,
        task,
        options.tasksById,
      )
      if (!variableName) {
        throw new Error(`No LLM variable name could be resolved for task ${task.id}`)
      }
      replacement = `{{${variableName}}}`
    } else {
      const stringifyValue = options.stringifyValue ?? stringifyExecutionValue
      replacement = stringifyValue(task.content.data)
    }

    output = output.replace(match[0], replacement)
  }

  return output
}

export const compileTaskyonFunctionArguments = (
  args: FunctionArguments,
  variableService: TaskVariablePresentationService,
): FunctionArguments => {
  for (const key of Object.keys(args)) {
    if (key.startsWith('$') && key !== '$use') {
      throw new Error(
        `Illegal Taskyon argument key "arguments.${key}". Argument keys starting with "$" are reserved by Taskyon. Only "$use" is allowed.`,
      )
    }
  }

  const compiled = cloneValue(args)
  const useMapping = getUseMapping(compiled.$use)

  if (useMapping) {
    const nextUse = Object.fromEntries(
      Object.entries(useMapping).map(([targetPath, rawRef]) => {
        if (typeof rawRef !== 'string') {
          throw new Error(
            `Taskyon $use expects string values, got ${typeof rawRef} at ${targetPath}`,
          )
        }
        if (hasOwnPath(compiled, targetPath)) {
          throw new Error(
            `Taskyon $use target path conflicts with a literal argument: ${targetPath}`,
          )
        }
        if (isTaskVariableRef(rawRef)) return [targetPath, rawRef]
        const taskId = variableService.resolveVariableName(rawRef)
        if (!taskId) {
          throw new Error(`Unknown Taskyon variable name in $use: ${rawRef}`)
        }
        return [targetPath, toTaskRef(taskId)]
      }),
    )
    compiled.$use = nextUse
  }

  return compiled
}

export const compileTaskyonMessageString = (
  input: string,
  variableService: TaskVariablePresentationService,
): string =>
  input.replace(PLACEHOLDER_REGEX, (match, rawName: string) => {
    const trimmedName = rawName.trim()
    if (!trimmedName) return match

    if (isTaskVariableRef(trimmedName)) {
      return `{{${trimmedName}}}`
    }

    const taskId = variableService.resolveVariableName(trimmedName)
    if (!taskId) {
      throw new Error(`Unknown Taskyon variable placeholder: ${trimmedName}`)
    }

    return `{{${toTaskRef(taskId)}}}`
  })

export const materializeTaskyonFunctionArguments = async (
  args: ReadonlyDeep<FunctionArguments>,
  options: MaterializeOptions,
): Promise<FunctionArguments> => {
  const compiled = cloneValue(args)
  const useMapping = getUseMapping(compiled.$use)

  if (options.surface === 'llm') {
    if (useMapping) {
      compiled.$use = Object.fromEntries(
        await Promise.all(
          Object.entries(useMapping).map(async ([targetPath, rawRef]) => {
            if (typeof rawRef !== 'string') return [targetPath, rawRef]
            const taskId =
              taskRefToTaskId(rawRef) ?? options.variableService?.resolveVariableName(rawRef)
            if (!taskId) throw new Error(`Unknown Taskyon variable name in $use: ${rawRef}`)
            const task = options.tasksById?.get(taskId) ?? (await options.getTaskById(taskId))
            if (!task) throw new Error(`Taskyon $use points to missing task ${taskId}`)
            options.tasksById?.set(taskId, task)
            const variableName = options.variableService?.variableNameForTaskId(
              taskId,
              task,
              options.tasksById,
            )
            if (!variableName)
              throw new Error(`No LLM variable name could be resolved for task ${taskId}`)
            return [targetPath, variableName]
          }),
        ),
      )
    }
    return compiled
  }

  const literalArgs = Object.fromEntries(
    Object.entries(compiled).filter(([key]) => key !== '$use'),
  ) as FunctionArguments

  if (useMapping) {
    for (const [targetPath, rawRef] of Object.entries(useMapping)) {
      if (typeof rawRef !== 'string') {
        throw new Error(`Taskyon $use expects string refs, got ${typeof rawRef} at ${targetPath}`)
      }
      const taskId = taskRefToTaskId(rawRef) ?? options.variableService?.resolveVariableName(rawRef)
      if (!taskId) throw new Error(`Unknown Taskyon variable name in $use: ${rawRef}`)
      const task = options.tasksById?.get(taskId) ?? (await options.getTaskById(taskId))
      if (!task) throw new Error(`Taskyon $use points to missing task ${taskId}`)
      options.tasksById?.set(taskId, task)
      if (hasOwnPath(literalArgs, targetPath)) {
        throw new Error(`Taskyon $use target path conflicts with a literal argument: ${targetPath}`)
      }
      setDeepPath(literalArgs, targetPath, task.content.data)
    }
  }

  return literalArgs
}

export const extractTaskRefsFromValue = (value: unknown): string[] => {
  const refs = new Set<string>()

  const visit = (input: unknown) => {
    if (typeof input === 'string') {
      if (isTaskVariableRef(input)) {
        const taskId = taskRefToTaskId(input)
        if (taskId) refs.add(taskId)
      }
      return
    }
    if (Array.isArray(input)) {
      input.forEach(visit)
      return
    }
    if (isObjectMap(input)) {
      Object.values(input).forEach(visit)
    }
  }

  visit(value)
  return Array.from(refs)
}

export const materializeTaskyonMessageString = async (
  input: string,
  options: MaterializeOptions,
): Promise<string> => replaceTemplateRefs(input, options)

export const renderTaskyonVariableBlock = (variableName: string, content: string) =>
  `<!-- taskyon variable ${variableName} content start -->\n${content}`
