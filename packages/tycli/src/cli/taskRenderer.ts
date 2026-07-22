import { serializeObject } from '@taskyon/common/modules/serializeObject'
import type { TaskNode, TyTaskStreamData } from '@taskyon/taskyon'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
  debugEnabled: () => boolean
  showRoleTag: () => boolean
  showFullFunctionResults: () => boolean
  isFunctionHiddenInChat: (name: string) => boolean
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

const MAX_RESULT_LINES = 3
const CONTENT_INDENT = '  '
const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i

const truncateToLines = (text: string, maxLines: number) => {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { text, truncated: false }
  return {
    text: [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines)`].join('\n'),
    truncated: true,
  }
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
  if (role === 'function') return supportsBrightColors() ? '94' : '34'
  if (role === 'system') return '90'
  return '37'
}

const functionCallColorCode = () => '34'

const toolResultColorCode = () => (supportsBrightColors() ? '94' : '34')

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

export const resolveWorkerStatusText = (
  event: WorkerEvent,
  isFunctionHiddenInChat: (name: string) => boolean,
): string | null => {
  const stage = event.stage ?? ''
  if (stage !== 'processing' && stage !== 'subtasks' && stage !== 'tool progress') return null
  const task = event.task
  const functionName = task?.content?.type === 'functioncall' ? task.content.data?.name : undefined
  const knownToolName = functionName ?? event.toolName
  if (knownToolName && isFunctionHiddenInChat(knownToolName)) return null
  const toolName = knownToolName ?? (event.taskId ? event.taskId.slice(0, 12) : 'task')
  if (stage === 'tool progress') {
    const message = event.progress?.message.replace(/\s+/g, ' ').trim().slice(-160)
    return message ? `${toolName}: ${message}` : null
  }
  const status = stage === 'subtasks' ? 'waiting for subtasks' : 'processing'
  return `${toolName}: ${status}`
}

const renderTaskSummary = (task: TaskNode, showRoleTag: boolean): string => {
  const role = task.role ?? 'unknown'
  if (task.content.type === 'message')
    return color(
      showRoleTag
        ? `[${role}|message]\n${indentMultiline(renderHtmlPreviewText(task, String(task.content.data)))}`
        : renderHtmlPreviewText(task, String(task.content.data)),
      roleColorCode(role),
    )
  if (task.content.type === 'functioncall')
    return color(
      showRoleTag
        ? `[${role}|functioncall]\n${indentMultiline(toYaml(task.content.data))}`
        : `functioncall\n${toYaml(task.content.data)}`,
      functionCallColorCode(),
    )
  if (task.content.type === 'toolresult') {
    const yaml = toYaml(task.content.data)
    return color(
      showRoleTag ? `[${role}|toolresult]\n${indentMultiline(yaml)}` : `toolresult\n${yaml}`,
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

const shouldRenderTask = (task: TaskNode, debugEnabled: boolean) => {
  if (debugEnabled) return true
  if (task.content.type === 'error') return true
  if (isVisibleMessageRole(task)) return true
  if (task.content.type === 'functioncall') return true
  if (task.content.type === 'toolresult') return true
  if (task.content.type === 'return') return false
  if (INTERNAL_TASK_TYPES.has(task.content.type)) return false
  return false
}

const shouldRenderWorker = (event: WorkerEvent, debugEnabled: boolean) =>
  debugEnabled || event.stage === 'error'

export const renderTaskProgress = (
  state: RendererState,
  task: TaskNode,
  previousSnapshotExists: boolean,
): void => {
  const debugEnabled = state.debugEnabled()
  const toolName = extractToolName(task)
  if (
    !debugEnabled &&
    task.content.type === 'functioncall' &&
    toolName &&
    state.isFunctionHiddenInChat(toolName)
  )
    return
  if (
    !debugEnabled &&
    task.content.type === 'toolresult' &&
    toolName &&
    state.isFunctionHiddenInChat(toolName)
  )
    return
  if (!shouldRenderTask(task, debugEnabled)) return
  state.clearThinkingPanel()
  state.writeLine('')
  const prefix = debugEnabled ? (previousSnapshotExists ? '[task updated] ' : '[task] ') : ''
  const summary = renderTaskSummary(task, state.showRoleTag())
  if (!debugEnabled && task.content.type === 'toolresult' && !state.showFullFunctionResults()) {
    const [header, ...body] = summary.split('\n')
    const compact = truncateToLines(body.join('\n'), MAX_RESULT_LINES)
    state.writeLine(`${prefix}${header}\n${compact.text}`)
    state.renderThinkingPanel()
    return
  }
  state.writeLine(`${prefix}${summary}`)
  state.renderThinkingPanel()
}

export const renderWorkerProgress = (state: RendererState, event: WorkerEvent): void => {
  const debugEnabled = state.debugEnabled()
  if (!shouldRenderWorker(event, debugEnabled)) return
  const toolName =
    event.task?.content?.type === 'functioncall' ? event.task.content.data?.name : undefined
  if (!debugEnabled && toolName && state.isFunctionHiddenInChat(toolName)) return
  state.clearThinkingPanel()
  state.writeLine(`[worker] ${summarizeWorkerEvent(event)}`)
  if (debugEnabled) state.writeLine(`[worker yaml]\n${toYaml(event)}`)
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
