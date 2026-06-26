import {
  REMOTE_FUNCTION_TIMEOUT_MS,
  createChatCompletionTask,
  createTool,
  initializeTaskyon,
  toolCall,
  type TyClient,
} from '@taskyon/tyclient'
import {
  applyFileUpdateToContent,
  getFileUpdateMode,
  normalizeFileUpdate,
  type FileUpdate,
} from '@taskyon/taskyon/tools/filePatching'

type ThemeMode = 'dark' | 'light'
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'
type SearchMode = 'pathRegex' | 'contentRegex'
type SearchResultSummary = {
  mode: SearchMode
  query: string
  exclude?: string
  effectiveExclude?: string
  maxResults: number
  items: string[]
  hitCap: boolean
  error?: string
}
type UpdateResultSummary = {
  editedFiles: string[]
  changesLog: string[]
  description?: string
  error?: string
}
type ActiveSelection = {
  start: { line: number; character: number }
  end: { line: number; character: number }
  text: string
}
type ActiveFilePayload = {
  path: string
  content?: string
  languageId?: string
  selections?: ActiveSelection[]
}
type PastedFilePayload = {
  name: string
  type: string
  data: string
}
type RequestPayload<TData extends object = object> = VscodeResponseMessage['payload'] & {
  data?: TData
}
type PendingRequest = {
  resolve: (value: RequestPayload) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}
type VscodeApi = {
  postMessage: (message: unknown) => void
}
type VscodeResponseMessage = {
  source?: string
  type?: string
  payload?: {
    requestId?: string
    error?: string
    data?: {
      mode?: SearchMode
      exclude?: string
      files?:
        | Array<{
            path: string
            content?: string
            languageId?: string
            error?: string
          }>
        | string[]
      hitCap?: boolean
      ok?: boolean
    }
  }
}

declare global {
  interface Window {
    __TASKYON__: {
      themeKey: string
      messageSource: string
      framedUrl: string
      defaultUrl: string
      localUrl: string
    }
  }
}

declare function acquireVsCodeApi(): VscodeApi

const vscode = acquireVsCodeApi()
const vscodeThemeKey = window.__TASKYON__.themeKey
const vscodeMessageSource = window.__TASKYON__.messageSource
const framedUrl = window.__TASKYON__.framedUrl
const defaultUrl = window.__TASKYON__.defaultUrl
const localUrl = window.__TASKYON__.localUrl || 'http://localhost:9000'
const frame = document.getElementById('taskyon') as HTMLIFrameElement | null
const sourceToggle = document.getElementById('taskyon-source-toggle')
const sourceButtons = sourceToggle
  ? Array.from(sourceToggle.querySelectorAll('button[data-source]'))
  : []
const clearContextButton = document.getElementById('taskyon-clear-context')
const contextInfo = document.getElementById('taskyon-context-info')

const loadedFiles: Record<string, string> = {}
let activeFile: {
  path: string
  content: string
  languageId?: string
  selections: ActiveSelection[]
} = {
  path: '',
  content: '',
  languageId: undefined,
  selections: [],
}
const pendingRequests = new Map<string, PendingRequest>()
let requestCounter = 0
let lastSearchResult: SearchResultSummary | null = null
let lastUpdateResult: UpdateResultSummary | null = null
let entryPassCount = 0
let taskyonClient: TyClient | null = null

const HARD_RESULT_CAP = 50
const SEARCH_SCAN_LIMIT = 5000
const ENTRY_PASS_LIMIT = 7
const VSCODE_REQUEST_TIMEOUT_MS = REMOTE_FUNCTION_TIMEOUT_MS

const sendRequest = <TData extends object = object>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<RequestPayload<TData>> =>
  new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${requestCounter++}`
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      console.warn('[Taskyon][Webview] request timeout', { type, requestId })
      reject(
        new Error(
          `VS Code bridge timed out after ${VSCODE_REQUEST_TIMEOUT_MS}ms while waiting for ${type} (request ${requestId})`,
        ),
      )
    }, VSCODE_REQUEST_TIMEOUT_MS)
    pendingRequests.set(requestId, { resolve, reject, timeout })
    console.info('[Taskyon][Webview] request sent', { type, requestId })
    vscode.postMessage({
      source: vscodeMessageSource,
      type,
      payload: { ...payload, requestId },
    })
  })

const installWebviewConsoleBridge = (() => {
  let installed = false
  return () => {
    if (installed) return
    installed = true
    const consoleLevels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
    for (const level of consoleLevels) {
      const original = console[level].bind(console) as (...args: unknown[]) => void
      console[level] = (...args: unknown[]) => {
        try {
          vscode.postMessage({
            source: vscodeMessageSource,
            type: 'vscodeWebviewLog',
            payload: {
              level,
              args: args.map((arg) => {
                if (typeof arg === 'string') return arg
                if (arg instanceof Error) return arg.stack || arg.message
                try {
                  return JSON.stringify(arg)
                } catch {
                  // eslint-disable-next-line @typescript-eslint/no-base-to-string
                  return String(arg)
                }
              }),
            },
          })
        } catch {
          // ignore logging bridge failures
        }
        original(...args)
      }
    }
  }
})()

const formatContentForPrompt = (content: string, maxLines?: number) => {
  const lines = String(content || '').split('\n')
  const totalLines = lines.length
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines
  const text = displayLines.join('\n')
  return text + (maxLines && totalLines > maxLines ? `\n... (${totalLines - maxLines} more)` : '')
}

const formatListForPrompt = (items: string[], maxItems = HARD_RESULT_CAP) => {
  if (!items || !items.length) return '(none)'
  const clipped = items.slice(0, maxItems)
  const suffix = items.length > maxItems ? `\n... (${items.length - maxItems} more)` : ''
  return `${clipped.join('\n')}${suffix}`
}

const formatSelections = (selections: ActiveSelection[]) => {
  if (!selections || !selections.length) return '(none)'
  return selections
    .map((selection, index) => {
      const range = `${selection.start.line + 1}:${selection.start.character + 1}-${
        selection.end.line + 1
      }:${selection.end.character + 1}`
      const text = selection.text ? selection.text.trim() : ''
      return `#${index + 1} ${range}${text ? `\n${text}` : ''}`
    })
    .join('\n\n')
}

const getLoadedFileStats = () => {
  const paths = Object.keys(loadedFiles)
  const chars = paths.reduce((total, filePath) => total + (loadedFiles[filePath]?.length || 0), 0)
  return { files: paths.length, chars }
}

const renderContextInfo = () => {
  if (!contextInfo) return
  const stats = getLoadedFileStats()
  contextInfo.textContent = `${stats.files} files, ${stats.chars} chars`
}

const clearToolContext = () => {
  Object.keys(loadedFiles).forEach((filePath) => delete loadedFiles[filePath])
  lastSearchResult = null
  lastUpdateResult = null
  entryPassCount = 0
  renderContextInfo()
}

const formatSearchSummary = (result: SearchResultSummary | null) => {
  if (!result) return '(none)'
  const summary = [
    `Mode: ${result.mode}`,
    `Regex: ${result.query || '(none)'}`,
    `Exclude: ${result.effectiveExclude || result.exclude || '(none)'}`,
    `Max Results: ${result.maxResults || HARD_RESULT_CAP}`,
    formatListForPrompt(result.items || [], HARD_RESULT_CAP),
  ]
  if (result.error) {
    summary.push(`\nError: ${result.error}`)
  }
  if (result.hitCap) {
    summary.push(`\nHit cap of ${result.maxResults || HARD_RESULT_CAP}; refine the regex.`)
  }
  if (!result.error && !result.hitCap && !result.items.length && result.mode === 'pathRegex') {
    summary.push(
      '\nNo path matches. Try a filename/path regex with variants for the full path, basename, extension, and separator styles before switching to contentRegex.',
    )
  }
  return summary.filter(Boolean).join('\n')
}

const formatUpdateSummary = (result: UpdateResultSummary | null) => {
  if (!result) return '(none)'
  const summary = [
    `Edited: ${result.editedFiles?.length || 0}`,
    formatListForPrompt(result.editedFiles || [], HARD_RESULT_CAP),
  ]
  if (result.description) {
    summary.push(`\nDescription: ${result.description}`)
  }
  if (result.error) {
    summary.push(`\nError: ${result.error}`)
  }
  if (result.changesLog?.length) {
    summary.push(`\nNotes:`)
    summary.push(formatListForPrompt(result.changesLog, HARD_RESULT_CAP))
  }
  return summary.filter(Boolean).join('\n')
}

const buildLoadedFileContext = () => {
  const filePaths = Object.keys(loadedFiles)
  if (!filePaths.length) return '(none)'

  return filePaths
    .slice(0, HARD_RESULT_CAP)
    .map((filePath) => {
      const content = loadedFiles[filePath] || ''
      return `### ${filePath}\n\`\`\`\n${formatContentForPrompt(content)}\n\`\`\``
    })
    .join('\n\n')
}

const buildAssistantContext = ({
  toolResultSection = '(none)',
}: { toolResultSection?: string } = {}) => {
  const currentFile = activeFile.path
  const currentContent = activeFile.content || ''
  const currentSelections = activeFile.selections || []
  const activeSummary = currentFile
    ? `${currentFile} (${currentContent.split('\n').length} lines)`
    : '(none)'
  const stats = getLoadedFileStats()

  return [
    'You are the Taskyon VS Code assistant.',
    'Only `entryNode` receives accumulated context. Tools should return results and hand control back to `entryNode`.',
    '',
    '## Recent Tool Result',
    toolResultSection,
    '',
    '## Available Context',
    `Active File: ${activeSummary}`,
    `Selections: ${currentSelections.length}`,
    `Loaded File Memory: ${stats.files} files / ${stats.chars} chars`,
    '',
    '### Last Search Result',
    formatSearchSummary(lastSearchResult),
    '',
    '### Last Update Result',
    formatUpdateSummary(lastUpdateResult),
    '',
    '## Active Selections',
    '```',
    formatSelections(currentSelections),
    '```',
    '',
    '## Loaded File Memory (truncated)',
    buildLoadedFileContext(),
    '',
    '## Search and Workflow Rules',
    '1. Keep all reasoning with accumulated context inside `entryNode`.',
    '2. You may call multiple tools in a row, but start with one.',
    '3. If the needed file content is already in context, prefer editing immediately instead of searching or reading again.',
    '4. When the user gives a stack trace, file path, import path, or filename, call `searchWorkspaceFiles` with `mode: "pathRegex"` first.',
    '5. Build a path regex from filename variants, not arbitrary code symbols.',
    '6. Include multiple variations when useful: full relative path, basename with extension, basename without extension, and separator variants using `/`, `\\\\`, `-`, and `_`.',
    '7. Start with precise path fragments before broader fallbacks.',
    '8. Use `mode: "contentRegex"` only when the target is truly a symbol or string and there is no reliable filename/path clue.',
    '9. Regexes run in JavaScript. Avoid PCRE/Python-only inline groups unless they are simple leading flags like `(?m)` or `(?im)`.',
    '10. If search results hit the cap, refine the regex instead of broadening it.',
    '11. After a successful `updateFiles`, finish with a short final summary.',
    '12. If `updateFiles` reports ambiguous matches, read the file again if needed and submit a more specific patch with larger context.',
    '13. If you are unsure what to change, ask a concise clarification question instead of editing.',
    '',
    '## Editing Rules',
    '- Patches are context-based, not line-based.',
    '- Do not use `search` (exact mode is disabled).',
    '- For replacements up to 3 lines, use `searchStart` only.',
    '- For larger replacements, use both `searchStart` and `searchEnd`.',
    '- Range-mode context lines must be real file lines; matching is tolerant and only checks the first 50 characters of each line or the full line if it is shorter.',
    '- `replace` must be the full replacement for the matched region.',
    '- For inserts, include a nearby unique block in `searchStart` and repeat it inside `replace` with the new content added.',
    '- For deletes, set `replace` to an empty string.',
    '- Do not add editor line numbers like `123:` to `searchStart`, `searchEnd`, or `replace`.',
    '- `regexReplacements` is the third edit mode. Use JavaScript regex syntax, optional `flags`, and prefer it for repeated mechanical replacements.',
    '- Prefer patches over replacing full file content unless necessary.',
  ].join('\n')
}

const formatToolResultSection = (title: string, lines: string[]) =>
  [title, ...lines].filter(Boolean).join('\n')

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return Object.prototype.toString.call(error)
}

const throwToolError = (toolName: string, details: string[]) => {
  throw new Error(formatToolResultSection(`### ${toolName}`, details))
}

const encodeFileAsBase64 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

const createTools = () => {
  const buildEntryNodeContinuation = (toolResultSection: string) => [
    {
      role: 'system' as const,
      content: {
        type: 'message' as const,
        data: toolResultSection,
      },
    },
    toolCall({
      name: 'entryNode',
      arguments: { toolResultSection },
    }),
  ]

  const buildStopForUserResult = () => [
    {
      role: 'assistant' as const,
      content: {
        type: 'message' as const,
        data: `I have already gone through ${ENTRY_PASS_LIMIT} entry-node steps for this message. Please send a new message to continue or narrow the search.`,
      },
    },
  ]

  const buildFinalSummaryResult = (toolResultSection: string) => [
    {
      role: 'system' as const,
      content: {
        type: 'message' as const,
        data: toolResultSection,
      },
    },
    createChatCompletionTask({
      prompts: [
        [
          'Summarize the updates you just completed for the user.',
          'Keep the answer short and concrete.',
          'Mention the edited files and the effect of the changes.',
          '',
          toolResultSection,
        ].join('\n'),
      ],
    }),
  ]

  const tools = [
    createTool({
      name: 'entryNode',
      description: 'Main VS Code entry node that owns all accumulated context.',
      parameters: {
        type: 'object',
        properties: {
          toolResultSection: {
            type: 'string',
            description: 'Internal tool-result summary passed back into the entry node.',
          },
        },
        additionalProperties: false,
      },
      renderOptions: { hideChat: false, hideLlm: true },
      function: ({ toolResultSection }: { toolResultSection?: string } = {}, ctx) => {
        if (!toolResultSection) {
          entryPassCount = 0
        }
        entryPassCount += 1
        if (entryPassCount > ENTRY_PASS_LIMIT) {
          return ctx.createSubtasksResult(buildStopForUserResult())
        }

        return ctx.createSubtasksResult([
          createChatCompletionTask({
            prompts: [buildAssistantContext({ toolResultSection: toolResultSection || '(none)' })],
            allowedTools: ['searchWorkspaceFiles', 'readWorkspaceFiles', 'updateFiles'],
          }),
        ])
      },
    }),
    createTool({
      name: 'searchWorkspaceFiles',
      description:
        'Search workspace files with JavaScript `RegExp` syntax only. `pathRegex` matches workspace-relative file paths, and `contentRegex` matches file contents and returns file paths. Do not use PCRE/Python-only constructs.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['pathRegex', 'contentRegex'],
            description:
              'Search mode. Use `pathRegex` for filenames/paths first; use `contentRegex` only for symbol or text lookup.',
          },
          query: {
            type: 'string',
            description:
              'Regex string in JavaScript `RegExp` dialect. In `pathRegex`, target filename/path variants; in `contentRegex`, it matches file contents. Avoid PCRE/Python-only constructs such as scoped inline groups; simple leading flags like `(?m)` and `(?im)` are allowed.',
          },
          exclude: {
            type: 'string',
            description:
              'Optional additional glob exclude pattern. This is merged with the built-in default excludes.',
          },
          maxResults: {
            type: 'number',
            description: `Maximum matches to return. Defaults to ${HARD_RESULT_CAP}.`,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      renderOptions: { hideChat: false, hideLlm: true },
      function: async (
        {
          mode,
          query,
          exclude,
          maxResults,
        }: {
          mode?: SearchMode
          query: string
          exclude?: string
          maxResults?: number
        },
        ctx,
      ) => {
        const effectiveMode: SearchMode = mode || 'pathRegex'
        const requestedMax = Math.max(
          1,
          Math.min(
            Number.isFinite(maxResults) ? Number(maxResults) : HARD_RESULT_CAP,
            HARD_RESULT_CAP,
          ),
        )

        try {
          const response = await sendRequest<{
            mode?: SearchMode
            exclude?: string
            files?: string[]
            hitCap?: boolean
          }>('vscodeSearchFiles', {
            mode: effectiveMode,
            query,
            exclude,
            maxResults: requestedMax,
            searchLimit: SEARCH_SCAN_LIMIT,
          })
          const matches = response?.data?.files || []
          const hitCap = response?.data?.hitCap ?? matches.length >= requestedMax
          const responseMode = response?.data?.mode || effectiveMode
          const effectiveExclude = response?.data?.exclude || exclude
          lastSearchResult = {
            mode: responseMode,
            query,
            exclude,
            effectiveExclude,
            maxResults: requestedMax,
            items: matches,
            hitCap,
          }
          return ctx.createSubtasksResult(
            buildEntryNodeContinuation(
              formatToolResultSection('### searchWorkspaceFiles', [
                `Mode: ${responseMode}`,
                `Regex: ${query || '(none)'}`,
                `Exclude: ${effectiveExclude || '(none)'}`,
                `Max Results: ${requestedMax}`,
                formatListForPrompt(matches, requestedMax),
                hitCap ? `\nHit cap of ${requestedMax}; refine the regex.` : '',
                !hitCap && !matches.length && responseMode === 'pathRegex'
                  ? '\nNo path matches. Try filename/path variants before switching to contentRegex.'
                  : '',
              ]),
            ),
          )
        } catch (error) {
          const message = toErrorMessage(error)
          lastSearchResult = {
            mode: effectiveMode,
            query,
            exclude,
            maxResults: requestedMax,
            items: [],
            hitCap: false,
            error: message,
          }
          throwToolError('searchWorkspaceFiles', [
            `Mode: ${effectiveMode}`,
            `Regex: ${query || '(none)'}`,
            `Error: ${message}`,
          ])
        }
      },
    }),
    createTool({
      name: 'readWorkspaceFiles',
      description: 'Read one or more workspace files and store their content in tool memory.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: {
              type: 'string',
              description:
                'One workspace file path or absolute file path to load into tool memory.',
            },
            description: 'List of workspace file paths to read (relative or absolute).',
          },
        },
        required: ['paths'],
        additionalProperties: false,
      },
      renderOptions: { hideChat: false, hideLlm: true },
      function: async ({ paths }: { paths: string[] }, ctx) => {
        try {
          const response = await sendRequest<{
            files?: Array<{ path: string; content?: string; languageId?: string; error?: string }>
          }>('vscodeReadFiles', { paths })
          const loaded: string[] = []
          const failed: string[] = []
          const results = response?.data?.files || []
          for (const file of results) {
            if (file?.content !== undefined) {
              loadedFiles[file.path] = file.content
              loaded.push(file.path)
            } else if (file?.path) {
              failed.push(file.path)
            }
          }
          renderContextInfo()
          return ctx.createSubtasksResult(
            buildEntryNodeContinuation(
              formatToolResultSection('### readWorkspaceFiles', [
                `Requested: ${paths?.length || 0}`,
                `Loaded: ${loaded.length}`,
                formatListForPrompt(loaded, HARD_RESULT_CAP),
                failed.length ? `\nFailed: ${failed.length}` : '',
                failed.length ? formatListForPrompt(failed, HARD_RESULT_CAP) : '',
              ]),
            ),
          )
        } catch (error) {
          const message = toErrorMessage(error)
          renderContextInfo()
          throwToolError('readWorkspaceFiles', [
            `Requested: ${paths?.length || 0}`,
            `Error: ${message}`,
          ])
        }
      },
    }),
    createTool({
      name: 'updateFiles',
      description: 'Update one or more files in the VS Code workspace.',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description:
              'Ordered list of file updates to apply in VS Code. Each entry must use exactly one mode: compact patches, regex replacements, or full replacement content.',
            items: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description:
                    'Workspace-relative path, absolute path, or URI of the file to update.',
                },
                patches: {
                  type: 'array',
                  description:
                    'Compact context-based edits. Use `searchStart` for up to 3-line replacements, and add `searchEnd` for larger sections.',
                  items: {
                    type: 'object',
                    properties: {
                      searchStart: {
                        type: 'string',
                        description:
                          'Start context. Provide at least 3 real file lines. Matching is tolerant and only requires the first 50 characters of each line.',
                      },
                      searchEnd: {
                        type: 'string',
                        description:
                          'Optional end context for larger replacements. Provide at least 3 real file lines. Matching is tolerant and only requires the first 50 characters of each line.',
                      },
                      replace: {
                        type: 'string',
                        description:
                          'Full replacement text for the matched region. Use an empty string to delete. For inserts, repeat the `searchStart` block and add the new content around it.',
                      },
                    },
                    required: ['replace'],
                    additionalProperties: false,
                  },
                },

                regexReplacements: {
                  type: 'array',
                  description:
                    'Regex-based replacements using JavaScript regular expressions. Use this for repeated mechanical edits across the file.',
                  items: {
                    type: 'object',
                    properties: {
                      pattern: {
                        type: 'string',
                        description: 'JavaScript regex pattern to replace.',
                      },
                      flags: {
                        type: 'string',
                        description:
                          'Optional JavaScript regex flags such as `g`, `i`, or `m`. Defaults to `g`.',
                      },
                      replace: {
                        type: 'string',
                        description:
                          'Replacement text passed directly to JavaScript `String.prototype.replace`.',
                      },
                    },
                    required: ['pattern', 'replace'],
                    additionalProperties: false,
                  },
                },
                newContent: {
                  type: 'string',
                  description:
                    'Full replacement content for the file. Use this only when patching is impractical; prefer patches otherwise.',
                },
              },
              required: ['filePath'],
              additionalProperties: false,
            },
          },
          description: {
            type: 'string',
            description: 'Short human-readable summary of what the edit batch is intended to do.',
          },
        },
        required: ['updates'],
        additionalProperties: false,
      },
      renderOptions: { hideChat: false, hideLlm: true },
      function: async (
        {
          updates,
          description,
        }: {
          updates: FileUpdate[]
          description?: string
        },
        ctx,
      ) => {
        try {
          const normalizedUpdates = (updates || []).map(normalizeFileUpdate)
          const applyResponse = await sendRequest<{
            ok?: boolean
            files?: string[]
            failedFiles?: string[]
            errors?: string[]
          }>('vscodeApplyEdits', { updates: normalizedUpdates, description })

          if (applyResponse?.data?.ok === false) {
            throw new Error(
              [
                description || 'Failed to apply VS Code edits.',
                applyResponse?.error || 'Unknown VS Code edit failure.',
              ]
                .filter(Boolean)
                .join('\n'),
            )
          }

          const nextFiles = { ...loadedFiles }
          const changesLog: string[] = []
          const editedFiles = Array.from(
            new Set(normalizedUpdates.map((update) => update?.filePath).filter(Boolean)),
          )

          for (const update of normalizedUpdates) {
            const { filePath, newContent } = update || {}
            if (!filePath) continue

            let originalContent = nextFiles[filePath]
            let mode = ''

            try {
              mode = getFileUpdateMode(update)
            } catch (error) {
              changesLog.push(
                `${filePath}: ${error instanceof Error ? error.message : String(error)}`,
              )
              continue
            }

            if (originalContent === undefined && mode !== 'newContent') {
              try {
                const response = await sendRequest<{
                  files?: Array<{ path: string; content?: string }>
                }>('vscodeReadFiles', { paths: [filePath] })
                const match = response?.data?.files?.[0]
                if (match?.content !== undefined) {
                  originalContent = match.content
                  nextFiles[filePath] = match.content
                }
              } catch {
                // ignore read failures; still apply edits in VS Code
              }
            }

            if (originalContent === undefined) {
              if (typeof newContent === 'string') {
                nextFiles[filePath] = newContent
                changesLog.push(`Created file ${filePath}`)
              } else {
                changesLog.push(`${mode} applied to ${filePath} (not tracked in memory)`)
              }
              continue
            }

            let updatedContent = originalContent
            if (mode === 'newContent') {
              updatedContent = newContent || ''
              changesLog.push(`Replaced content of ${filePath}`)
            } else {
              updatedContent = applyFileUpdateToContent(originalContent, update)
              if (mode === 'patches') {
                changesLog.push(`Patched ${filePath} (${update.patches?.length || 0} ops)`)
              } else {
                changesLog.push(
                  `Regex-replaced ${filePath} (${update.regexReplacements?.length || 0} ops)`,
                )
              }
            }
            nextFiles[filePath] = updatedContent
          }

          Object.keys(loadedFiles).forEach((filePath) => delete loadedFiles[filePath])
          Object.assign(loadedFiles, nextFiles)
          if (activeFile.path && loadedFiles[activeFile.path] !== undefined) {
            activeFile = { ...activeFile, content: loadedFiles[activeFile.path] }
          }
          lastUpdateResult = { editedFiles, changesLog, description }
          renderContextInfo()

          return ctx.createSubtasksResult(
            buildFinalSummaryResult(
              formatToolResultSection('### updateFiles', [
                description ? `Description: ${description}` : '',
                `Edited: ${editedFiles.length}`,
                formatListForPrompt(editedFiles, HARD_RESULT_CAP),
                changesLog.length ? `\nNotes:` : '',
                changesLog.length ? formatListForPrompt(changesLog, HARD_RESULT_CAP) : '',
              ]),
            ),
          )
        } catch (error) {
          const message = toErrorMessage(error)
          lastUpdateResult = {
            editedFiles: [],
            changesLog: [],
            description,
            error: message,
          }
          renderContextInfo()
          return ctx.createSubtasksResult(
            buildEntryNodeContinuation(
              formatToolResultSection('### updateFiles', [
                description ? `Description: ${description}` : '',
                `Error: ${message}`,
                'The update did not apply.',
                'If there were multiple matches for a patch, increase the context and try again.',
                'For larger replacements, provide at least 3 lines in both `searchStart` and `searchEnd`.',
                'If a search block was not found, copy it exactly from the latest file contents.',
              ]),
            ),
          )
        }
      },
    }),
  ]

  return {
    tools,
    entryNode: toolCall({ name: 'entryNode', arguments: {} }),
  }
}

const applyWebviewBackground = (theme: ThemeMode | null) => {
  const styles = getComputedStyle(document.body)
  const cssBackground = styles.backgroundColor
  const fallback = theme === 'light' ? '#ffffff' : '#1e1e1e'
  const background =
    cssBackground && cssBackground !== 'rgba(0, 0, 0, 0)' && cssBackground !== 'transparent'
      ? cssBackground
      : fallback
  document.documentElement.style.backgroundColor = background
  document.body.style.backgroundColor = background
  if (frame) frame.style.backgroundColor = 'transparent'
}

const setTheme = (theme?: ThemeMode) => {
  if (!theme || !frame) return
  const current = document.documentElement.getAttribute('data-vscode-theme')
  if (current === theme) return
  document.documentElement.setAttribute('data-vscode-theme', theme)
  document.documentElement.style.colorScheme = theme
  applyWebviewBackground(theme)
  try {
    const url = new URL(frame.src)
    url.searchParams.set(vscodeThemeKey, theme)
    frame.src = url.toString()
  } catch {
    // ignore malformed urls
  }
}

const setActiveFile = (payload?: ActiveFilePayload) => {
  if (!payload || !payload.path) return
  activeFile = {
    path: payload.path,
    content: payload.content || '',
    languageId: payload.languageId,
    selections: payload.selections || [],
  }
}

const updateSourceToggle = () => {
  if (!sourceButtons.length || !frame) return
  let isLocal = false
  try {
    const currentSrc = frame.getAttribute('src') || framedUrl || ''
    const url = new URL(currentSrc)
    const localHost = new URL(localUrl).host || 'localhost:9000'
    isLocal = url.host === localHost
  } catch {
    // ignore invalid urls
  }
  for (const btn of sourceButtons) {
    const source = btn.getAttribute('data-source')
    const shouldBeActive = (source === 'local' && isLocal) || (source === 'prod' && !isLocal)
    btn.classList.toggle('active', shouldBeActive)
  }
}

if (sourceToggle) {
  sourceToggle.addEventListener('click', (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const source = target.getAttribute('data-source')
    if (!source) return
    const url = source === 'local' ? localUrl : defaultUrl || 'https://taskyon.space'
    vscode.postMessage({
      source: vscodeMessageSource,
      type: 'vscodeSetBaseUrl',
      payload: { url },
    })
  })
}

if (clearContextButton) {
  clearContextButton.addEventListener('click', () => {
    clearToolContext()
  })
}

const sendClipboardResult = (requestId: string | undefined, ok: boolean, error?: string) => {
  if (!frame?.contentWindow || !requestId) return
  frame.contentWindow.postMessage(
    {
      type: 'taskyonClipboardWriteResult',
      requestId,
      ok,
      error,
    },
    '*',
  )
}

const sendClipboardImageResult = (requestId: string | undefined, ok: boolean, error?: string) => {
  if (!frame?.contentWindow || !requestId) return
  frame.contentWindow.postMessage(
    {
      type: 'taskyonClipboardWriteImageResult',
      requestId,
      ok,
      error,
    },
    '*',
  )
}

const handleClipboardWrite = async (text: unknown, requestId?: string) => {
  if (typeof text !== 'string') {
    sendClipboardResult(requestId, false, 'Clipboard text missing')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    sendClipboardResult(requestId, true)
    return
  } catch (error) {
    console.warn('[Taskyon][Webview] clipboard write failed; retrying via extension', error)
  }
  try {
    await sendRequest('vscodeClipboardWrite', { text })
    sendClipboardResult(requestId, true)
  } catch (error) {
    sendClipboardResult(requestId, false, error instanceof Error ? error.message : String(error))
  }
}

const handleClipboardImageWrite = async (payload: {
  data?: string
  mime?: string
  requestId?: string
}) => {
  const { data, mime, requestId } = payload || {}
  if (!data || !mime) {
    sendClipboardImageResult(requestId, false, 'Clipboard image data missing')
    return
  }
  if (typeof ClipboardItem === 'undefined') {
    sendClipboardImageResult(requestId, false, 'ClipboardItem not supported')
    return
  }
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: mime })
    await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })])
    sendClipboardImageResult(requestId, true)
  } catch (error) {
    sendClipboardImageResult(
      requestId,
      false,
      error instanceof Error ? error.message : String(error),
    )
  }
}

const handleHostPaste = async (event: ClipboardEvent) => {
  if (!taskyonClient || !frame || document.activeElement !== frame) return

  const clipboard = event.clipboardData
  if (!clipboard) return

  const files: PastedFilePayload[] = []
  for (const item of Array.from(clipboard.items || [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    files.push({
      name: file.name || 'pasted-file',
      type: file.type || 'application/octet-stream',
      data: await encodeFileAsBase64(file),
    })
  }

  const text = clipboard.getData('text/plain') || undefined
  const html = clipboard.getData('text/html') || undefined
  if (!text && !html && files.length === 0) return

  event.preventDefault()
  taskyonClient.port.send({
    type: 'pasteMessage',
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
    ...(files.length ? { files } : {}),
  })
}

let initializing = false
let lastInitSrc = ''
const initTaskyon = async (reason: string) => {
  const src = frame?.getAttribute('src') || ''
  if (initializing || !src) return
  if (lastInitSrc === src) return
  initializing = true
  lastInitSrc = src
  try {
    const { tools, entryNode } = createTools()
    taskyonClient = await initializeTaskyon({
      tools,
      configuration: {
        llmSettings: {
          enableToolChooser: true,
          entryNode,
        },
        appConfiguration: {
          guiMode: 'minChat',
          expertMode: true,
          showLogo: false,
          chatSuggestions: [],
          welcomeMsg: 'Hello from Taskyon!',
        },
      },
      name: 'vscode',
      persist: true,
      iframeId: 'taskyon',
    })
  } catch (error) {
    console.error('[Taskyon][Webview] init failed', reason, error)
    taskyonClient = null
    lastInitSrc = ''
  } finally {
    initializing = false
  }
}

frame?.addEventListener('load', () => {
  console.log('[Taskyon][Webview] iframe src:', framedUrl)
  vscode.postMessage({
    source: vscodeMessageSource,
    type: 'vscodeWebviewUrl',
    payload: { framedUrl },
  })
  try {
    frame.contentWindow?.postMessage({ type: 'vscodeClipboardBridge', enabled: true }, '*')
  } catch {
    // ignore bridge notifications
  }
  updateSourceToggle()
  void initTaskyon('load')
})

installWebviewConsoleBridge()
applyWebviewBackground(
  document.documentElement.getAttribute('data-vscode-theme') as ThemeMode | null,
)
updateSourceToggle()
renderContextInfo()
void initTaskyon('startup')
vscode.postMessage({ source: vscodeMessageSource, type: 'vscodeWebviewReady' })
window.addEventListener('paste', (event) => {
  void handleHostPaste(event)
})

window.addEventListener('message', (event: MessageEvent) => {
  const data = (event.data || {}) as {
    source?: string
    type?: string
    theme?: ThemeMode
    href?: string
    text?: unknown
    requestId?: string
    payload?: {
      requestId?: string
      error?: string
      args?: unknown[]
      level?: ConsoleLevel
      href?: string
      framedUrl?: string
      data?: unknown
      ok?: boolean
    }
    mime?: string
  }
  if (event.source === frame?.contentWindow) {
    if (data.type === 'taskyonClipboardWrite' || data.type === 'clipboardWrite') {
      void handleClipboardWrite(data.text, data.requestId)
      return
    }
    if (data.type === 'taskyonClipboardWriteImage') {
      void handleClipboardImageWrite(data)
      return
    }
  }
  if (data.type === 'theme') {
    setTheme(data.theme)
    return
  }
  if (data.type === 'linkClick') {
    vscode.postMessage({
      source: vscodeMessageSource,
      type: 'vscodeOpenLink',
      payload: { href: data.href || '' },
    })
    return
  }
  if (data.source === vscodeMessageSource && data.type === 'vscodeResponse') {
    const requestId = data.payload?.requestId
    const pending = requestId ? pendingRequests.get(requestId) : undefined
    console.info('[Taskyon][Webview] response received', {
      requestId,
      hasPending: Boolean(pending),
      error: data.payload?.error,
    })
    if (pending) {
      pendingRequests.delete(requestId)
      clearTimeout(pending.timeout)
      if (data.payload?.error) {
        pending.reject(new Error(data.payload.error))
      } else {
        pending.resolve(data.payload)
      }
    }
    return
  }
  if (data.source === vscodeMessageSource && data.type === 'vscodeIframeLog') {
    vscode.postMessage({
      source: vscodeMessageSource,
      type: 'vscodeIframeLog',
      payload: data.payload || {},
    })
    return
  }
  if (data.source === vscodeMessageSource && data.type === 'vscodeActiveFile') {
    setActiveFile(data.payload as unknown as ActiveFilePayload)
  }
})
