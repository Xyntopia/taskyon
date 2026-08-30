import { serializeObject } from '@taskyon/common/modules/serializeObject'
import type { TaskNode, TyTaskStreamData } from '@taskyon/taskyon'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

export type WorkerEvent = {
  stage?: TyTaskStreamData['stage']
  taskId?: string | null
  task?: TaskNode | null
  info?: string
  toolName?: string
  progress?: TyTaskStreamData['progress']
}

export type RendererWrite = (text: string) => void

export type RendererState = {
  detailedViewEnabled: () => boolean
  showRoleTag: () => boolean
  showFullFunctionResults: () => boolean
  isFunctionHiddenInChat: (name: string) => boolean
  getTaskById?: (id: string) => TaskNode | undefined
  writeDebugLine?: RendererWrite
  noteHiddenNode?: (toolName: string) => void
  flushHiddenNodeMarkers?: () => void
  clearThinkingPanel: () => void
  renderThinkingPanel: () => void
  writeLine: RendererWrite
}

const INTERNAL_TASK_TYPES = new Set(['functioncall', 'toolresult', 'structured', 'tooldefinition'])

const toYaml = (value: unknown) =>
  serializeObject(value, {
    format: 'yaml',
    maxDepth: 8,
    maxArrayLength: 12,
    maxObjectKeys: 30,
    maxStringLength: 300,
    includeTruncationMeta: true,
  }).trim()

const MAX_COMPACT_DISPLAY_CHARS = 180
const CONTENT_INDENT = '  '
const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i

const truncateToChars = (text: string, maxChars: number) => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

const compactValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return /^[\w./:@+-]+$/u.test(value) ? value : JSON.stringify(value)
  }
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n`
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? Object.prototype.toString.call(value) : serialized
  } catch {
    return Object.prototype.toString.call(value)
  }
}

const compactFunctionArguments = (argumentsValue: unknown) => {
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    return compactValue(argumentsValue)
  }
  return Object.entries(argumentsValue)
    .map(([key, value]) => `${key}=${compactValue(value)}`)
    .join(' ')
}

export const formatCompactFunctionCall = (task: TaskNode) => {
  if (task.content.type !== 'functioncall') throw new Error('Expected a function-call task.')
  return truncateToChars(
    `${task.content.data.name} ${compactFunctionArguments(task.content.data.arguments)}`.trim(),
    MAX_COMPACT_DISPLAY_CHARS,
  )
}

const compactToolResult = (value: unknown) =>
  truncateToChars(compactValue(value), MAX_COMPACT_DISPLAY_CHARS)

const removeTerminalControls = (text: string) =>
  Array.from(text)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1f && codePoint !== 0x7f
    })
    .join('')

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const terminalHyperlink = (label: string, target: string) => {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb') return label
  return `\u001b]8;;${target}\u001b\\${label}\u001b]8;;\u001b\\`
}

export const formatCliLocalFilePath = (filePath: string) => {
  const rawPath = filePath.trim()
  const displayPath = removeTerminalControls(rawPath)
  if (!displayPath) return ''
  return terminalHyperlink(displayPath, pathToFileURL(resolve(rawPath)).toString())
}

const renderFileOperationResult = (
  task: TaskNode,
  sourceTask: TaskNode | undefined,
): string | undefined => {
  if (task.content.type !== 'toolresult') return undefined
  const result = recordValue(task.content.data)
  if (!result) return undefined
  const sourceToolName =
    sourceTask?.content.type === 'functioncall' ? sourceTask.content.data.name : undefined
  const isDownload = sourceToolName === 'downloadFile'
  if (!isDownload && (result.ok === false || result.success === false)) return undefined
  const filePath =
    isDownload && typeof result.filePath === 'string'
      ? result.filePath
      : ['read', 'write', 'edit'].includes(sourceToolName ?? '') && typeof result.path === 'string'
        ? result.path
        : !sourceTask && typeof result.filePath === 'string'
          ? result.filePath
          : undefined
  if (!filePath) return undefined
  const localPath = formatCliLocalFilePath(filePath)
  if (!localPath) return undefined
  const remoteUrl =
    typeof result.url === 'string' ? removeTerminalControls(result.url).trim() : undefined
  const lines = remoteUrl
    ? [`remote  ${remoteUrl}`, `local   ${localPath}`]
    : [`local   ${localPath}`]
  if (isDownload && typeof result.error === 'string') {
    const error = removeTerminalControls(result.error).trim()
    if (error) lines.push(`error   ${error}`)
  }
  return lines.join('\n')
}

const indentMultiline = (text: string, indent: string = CONTENT_INDENT) =>
  text
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')

const hasHtmlMarkup = (text: string) => HTML_TAG_PATTERN.test(text)

const buildHtmlPreviewDocument = (html: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Taskyon HTML Preview</title>
  </head>
  <body>
${html}
  </body>
</html>
`

export const writeHtmlPreview = (task: Pick<TaskNode, 'id'>, html: string): string | null => {
  if (!hasHtmlMarkup(html)) return null

  const previewDir = join(tmpdir(), 'taskyon-tycli-html-previews')
  const hash = createHash('sha256')
    .update(task.id)
    .update('\0')
    .update(html)
    .digest('hex')
    .slice(0, 16)
  const previewPath = join(previewDir, `${hash}.html`)
  try {
    mkdirSync(previewDir, { recursive: true })
    writeFileSync(previewPath, buildHtmlPreviewDocument(html), 'utf8')
    return pathToFileURL(previewPath).toString()
  } catch {
    return null
  }
}

export const renderHtmlPreviewText = (task: Pick<TaskNode, 'id' | 'role'>, text: string) => {
  if (task.role !== 'assistant') return text
  const previewUrl = writeHtmlPreview(task, text)
  return previewUrl ? `HTML preview: ${previewUrl}` : text
}

const color = (text: string, code: string) =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text

const supportsBrightColors = () => process.stdout.isTTY && process.env.TERM !== 'dumb'

const roleColorCode = (role: string) => {
  if (role === 'user') return '39'
  if (role === 'assistant') return supportsBrightColors() ? '97' : '37'
  if (role === 'function') return supportsBrightColors() ? '96' : '36'
  if (role === 'system') return '90'
  return '37'
}

const functionCallColorCode = () => '36'

const toolResultColorCode = () => (supportsBrightColors() ? '96' : '36')

const errorColorCode = () => (supportsBrightColors() ? '91' : '31')

const extractToolName = (task: TaskNode): string | undefined => {
  if (task.content.type === 'functioncall') return task.content.data.name
  if (task.content.type !== 'toolresult') return undefined
  const data = task.content.data as { name?: unknown } | undefined
  return typeof data?.name === 'string' ? data.name : undefined
}

export const summarizeWorkerEvent = (event: WorkerEvent): string => {
  const taskId = event.task?.id ?? event.taskId ?? 'n/a'
  const toolName =
    event.task?.content?.type === 'functioncall' ? event.task.content?.data?.name : undefined
  const info = event.info ? ` info=${event.info}` : ''
  const tool = toolName ? ` tool=${toolName}` : ''
  return `stage=${event.stage ?? 'unknown'} task=${taskId}${tool}${info}`
}

export const countDelegatedSubtaskToolCalls = (
  rootTaskId: string,
  tasks: Iterable<TaskNode>,
): number | null => {
  const taskList = [...tasks]
  const rootTask = taskList.find((task) => task.id === rootTaskId)
  if (
    rootTask?.content.type !== 'functioncall' ||
    !Object.hasOwn(rootTask.content.data.arguments, 'taskContract')
  )
    return null

  const childrenByParentId = new Map<string, TaskNode[]>()
  for (const task of taskList) {
    if (!task.parentID) continue
    const children = childrenByParentId.get(task.parentID) ?? []
    children.push(task)
    childrenByParentId.set(task.parentID, children)
  }

  let toolCallCount = 0
  const pending = [rootTask]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const task = pending.pop()
    if (!task || visited.has(task.id)) continue
    visited.add(task.id)
    if (task.content.type === 'functioncall') toolCallCount += 1
    pending.push(...(childrenByParentId.get(task.id) ?? []))
  }
  return toolCallCount
}

export const resolveWorkerStatusText = (
  event: WorkerEvent,
  isFunctionHiddenInChat: (name: string) => boolean,
  showHiddenActiveTool = false,
): string | null => {
  const stage = event.stage ?? ''
  if (stage !== 'processing' && stage !== 'subtasks' && stage !== 'tool progress') return null
  const task = event.task
  const functionName = task?.content?.type === 'functioncall' ? task.content.data?.name : undefined
  const knownToolName = functionName ?? event.toolName
  const hiddenTool = knownToolName ? isFunctionHiddenInChat(knownToolName) : false
  if (hiddenTool && !showHiddenActiveTool) return null
  const toolName = knownToolName ?? (event.taskId ? event.taskId.slice(0, 12) : 'task')
  const compactCall =
    event.task?.content.type === 'functioncall' ? formatCompactFunctionCall(event.task) : toolName
  if (stage === 'tool progress') {
    if (hiddenTool) return `${toolName}: processing`
    const message = event.progress?.message.replace(/\s+/g, ' ').trim().slice(-160)
    return message ? `${toolName}: ${message}` : null
  }
  const status = stage === 'subtasks' ? 'waiting for subtasks' : 'processing'
  return `${status}: ${compactCall}`
}

const renderTaskSummary = (
  task: TaskNode,
  showRoleTag: boolean,
  compact = false,
  getTaskById?: (id: string) => TaskNode | undefined,
): string => {
  const role = task.role ?? 'unknown'
  if (task.content.type === 'message')
    return color(
      showRoleTag
        ? `[${role}|message]\n${indentMultiline(renderHtmlPreviewText(task, String(task.content.data)))}`
        : renderHtmlPreviewText(task, String(task.content.data)),
      roleColorCode(role),
    )
  if (task.content.type === 'functioncall') {
    const summary = compact ? formatCompactFunctionCall(task) : toYaml(task.content.data)
    return color(
      compact
        ? showRoleTag
          ? `[${role}|functioncall] ${summary}`
          : `functioncall ${summary}`
        : showRoleTag
          ? `[${role}|functioncall]\n${indentMultiline(summary)}`
          : `functioncall\n${summary}`,
      functionCallColorCode(),
    )
  }
  if (task.content.type === 'toolresult') {
    const sourceTask = task.parentID && getTaskById ? getTaskById(task.parentID) : undefined
    const fileSummary = renderFileOperationResult(task, sourceTask)
    if (fileSummary) {
      return color(
        showRoleTag ? `[${role}|toolresult]\n${indentMultiline(fileSummary)}` : fileSummary,
        toolResultColorCode(),
      )
    }
    const summary = compact ? compactToolResult(task.content.data) : toYaml(task.content.data)
    return color(
      compact
        ? showRoleTag
          ? `[${role}|toolresult] ${summary}`
          : `toolresult ${summary}`
        : showRoleTag
          ? `[${role}|toolresult]\n${indentMultiline(summary)}`
          : `toolresult\n${summary}`,
      toolResultColorCode(),
    )
  }
  if (task.content.type === 'error')
    return color(
      showRoleTag
        ? `[${role}|error]\n${indentMultiline(toYaml(task.content.data))}`
        : `error\n${toYaml(task.content.data)}`,
      errorColorCode(),
    )
  if (task.content.type === 'return')
    return color(
      showRoleTag
        ? `[${role}|return]\n${indentMultiline(String(task.content.data))}`
        : String(task.content.data),
      roleColorCode(role),
    )
  return color(
    showRoleTag ? `[${role}|${task.content.type}]` : task.content.type,
    roleColorCode(role),
  )
}

const isVisibleMessageRole = (task: TaskNode) =>
  task.content.type === 'message' && task.role === 'assistant'

const shouldRenderTask = (task: TaskNode, detailedViewEnabled: boolean) => {
  if (detailedViewEnabled) return true
  if (task.content.type === 'error') return true
  if (isVisibleMessageRole(task)) return true
  if (task.content.type === 'functioncall') return true
  if (task.content.type === 'toolresult') return true
  if (task.content.type === 'return') return false
  if (INTERNAL_TASK_TYPES.has(task.content.type)) return false
  return false
}

const shouldRenderWorker = (event: WorkerEvent, detailedViewEnabled: boolean) =>
  detailedViewEnabled || event.stage === 'error'

export const renderTaskProgress = (
  state: RendererState,
  task: TaskNode,
  previousSnapshotExists: boolean,
): void => {
  const detailedViewEnabled = state.detailedViewEnabled()
  const toolName = extractToolName(task)
  const debugPrefix = previousSnapshotExists ? '[task updated] ' : '[task] '
  const prefix = detailedViewEnabled ? debugPrefix : ''
  if (!detailedViewEnabled && state.writeDebugLine) {
    state.writeDebugLine(
      `${debugPrefix}${renderTaskSummary(task, state.showRoleTag(), false, state.getTaskById)}`,
    )
  }
  if (
    !detailedViewEnabled &&
    task.content.type === 'functioncall' &&
    toolName &&
    state.isFunctionHiddenInChat(toolName)
  ) {
    return
  }
  if (
    !detailedViewEnabled &&
    task.content.type === 'toolresult' &&
    toolName &&
    state.isFunctionHiddenInChat(toolName)
  )
    return
  if (!shouldRenderTask(task, detailedViewEnabled)) return
  state.clearThinkingPanel()
  state.flushHiddenNodeMarkers?.()
  const summary = renderTaskSummary(
    task,
    state.showRoleTag(),
    !detailedViewEnabled &&
      !state.showFullFunctionResults() &&
      (task.content.type === 'functioncall' || task.content.type === 'toolresult'),
    state.getTaskById,
  )
  state.writeLine(`${prefix}${summary}`)
  state.writeLine('')
  state.renderThinkingPanel()
}

export const renderWorkerProgress = (state: RendererState, event: WorkerEvent): void => {
  const detailedViewEnabled = state.detailedViewEnabled()
  if (!detailedViewEnabled && state.writeDebugLine) {
    state.writeDebugLine(`[worker] ${summarizeWorkerEvent(event)}\n[worker yaml]\n${toYaml(event)}`)
  }
  if (!shouldRenderWorker(event, detailedViewEnabled)) return
  const toolName =
    event.task?.content?.type === 'functioncall' ? event.task.content.data?.name : undefined
  if (!detailedViewEnabled && toolName && state.isFunctionHiddenInChat(toolName)) return
  state.clearThinkingPanel()
  state.writeLine(`[worker] ${summarizeWorkerEvent(event)}`)
  if (detailedViewEnabled) state.writeLine(`[worker yaml]\n${toYaml(event)}`)
  state.writeLine('')
  state.renderThinkingPanel()
}

export const renderFinalTask = (task: TaskNode): string => {
  const role = task.role ?? 'assistant'
  if (task.content.type === 'message') return `${role}: ${task.content.data}`
  if (task.content.type === 'return') return `${role}: ${task.content.data}`
  if (task.content.type === 'error')
    return `${role} error:\n${typeof task.content.data === 'string' ? task.content.data : JSON.stringify(task.content.data, null, 2)}`
  return `${role}:\n${JSON.stringify(task.content.data, null, 2)}`
}
