;(function () {
  const vscode = acquireVsCodeApi()
  const vscodeThemeKey = window.__TASKYON__.themeKey
  const vscodeMessageSource = window.__TASKYON__.messageSource
  const framedUrl = window.__TASKYON__.framedUrl
  const defaultUrl = window.__TASKYON__.defaultUrl
  const frame = document.getElementById('taskyon')
  const sourceToggle = document.getElementById('taskyon-source-toggle')
  const sourceButtons = sourceToggle ? sourceToggle.querySelectorAll('button[data-source]') : []

  const files = {}
  const fileMeta = {}
  let activeFileName = ''
  const pendingRequests = new Map()
  let requestCounter = 0
  let webSearchEnabled = false
  const maxFollowUps = 5
  let followUpCount = 0

  const getVscodeLink = (filePath) => `vscode://file/${encodeURI(filePath)}`

  const getFollowUpTask = () => {
    const toolCallFn = window.tyclient?.toolCall
    if (!toolCallFn) {
      return {
        role: 'assistant',
        content: {
          type: 'message',
          data: 'Taskyon tool client not ready. Reply "continue" to retry.',
        },
      }
    }
    if (followUpCount >= maxFollowUps) {
      followUpCount = 0
      return {
        role: 'assistant',
        content: {
          type: 'message',
          data: 'I can keep going if you want. Reply "continue" to proceed.',
        },
      }
    }
    followUpCount += 1
    return toolCallFn({
      name: 'vscodeAssistant',
      arguments: { webSearch: webSearchEnabled },
    })
  }

  const sendRequest = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${requestCounter++}`
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId)
        console.warn('[Taskyon][Webview] request timeout', { type, requestId })
        reject(new Error(`VS Code request timed out: ${type}`))
      }, 10000)
      pendingRequests.set(requestId, { resolve, reject, timeout })
      console.info('[Taskyon][Webview] request sent', { type, requestId })
      vscode.postMessage({
        source: vscodeMessageSource,
        type,
        payload: { ...payload, requestId },
      })
    })

  const waitForTyclient = () =>
    new Promise((resolve) => {
      if (window.tyclient?.initializeTaskyon) {
        resolve()
        return
      }
      const handler = () => {
        if (window.tyclient?.initializeTaskyon) {
          window.removeEventListener('taskyon:tyclient-ready', handler)
          resolve()
        }
      }
      window.addEventListener('taskyon:tyclient-ready', handler)
      setTimeout(() => {
        window.removeEventListener('taskyon:tyclient-ready', handler)
        resolve()
      }, 5000)
    })

  const installWebviewConsoleBridge = (() => {
    let installed = false
    return () => {
      if (installed) return
      installed = true
      const consoleLevels = ['log', 'info', 'warn', 'error', 'debug']
      for (const level of consoleLevels) {
        const original = console[level].bind(console)
        console[level] = (...args) => {
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

  const formatContentWithLineNumbers = (content, maxLines) => {
    const lines = content.split('\n')
    const totalLines = lines.length
    const displayLines = maxLines ? lines.slice(0, maxLines) : lines
    const withNums = displayLines
      .map((line, index) => String(index + 1).padStart(4, ' ') + ': ' + line)
      .join('\n')
    return (
      withNums + (maxLines && totalLines > maxLines ? `\n... (${totalLines - maxLines} more)` : '')
    )
  }

  const applyLinePatches = (text, patches) => {
    const lines = text.split('\n')
    const sorted = [...patches].sort((a, b) => b.lineStart - a.lineStart)
    for (const patch of sorted) {
      const startIdx = Math.max(0, patch.lineStart - 1)
      if (patch.type === 'insert') {
        const newLines = (patch.text || '').split('\n')
        lines.splice(startIdx, 0, ...newLines)
        continue
      }
      const endLine = patch.lineEnd ?? patch.lineStart
      const deleteCount = Math.max(0, endLine - patch.lineStart + 1)
      if (patch.type === 'delete') {
        lines.splice(startIdx, deleteCount)
      } else {
        const newLines = (patch.text || '').split('\n')
        lines.splice(startIdx, deleteCount, ...newLines)
      }
    }
    return lines.join('\n')
  }

  const formatSelections = (selections) => {
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

  const createTools = () => {
    const { createTool, createChatCompletionTask, makeTaskResult, toolCall } = window.tyclient || {}
    if (!createTool) return { tools: [], entryNode: undefined }

    const tools = [
      createTool({
        name: 'vscodeAssistant',
        description: 'Assistant for editing VS Code files via Taskyon tools.',
        parameters: {
          type: 'object',
          properties: {
            webSearch: {
              type: 'boolean',
              description: 'Whether web search is enabled for this session',
            },
          },
          additionalProperties: false,
        },
        function: (opts) => {
          webSearchEnabled = Boolean(opts?.webSearch)
          const currentFile = activeFileName
          const currentFileContent = files[currentFile] || ''
          const maxLines = 400
          const contentWithLines = formatContentWithLineNumbers(currentFileContent, maxLines)
          const knownFiles = Object.keys(files)
          const currentMeta = fileMeta[currentFile] || {}
          const selections = formatSelections(currentMeta.selections)
          const contextPrompt = [
            'You are the Taskyon VS Code assistant.',
            '',
            '## Active File',
            `**Path:** ${currentFile || '(none)'}`,
            `**Lines:** ${currentFileContent.split('\n').length}`,
            `**Selections:** ${currentMeta.selections?.length || 0}`,
            '',
            '## Content (truncated)',
            '```',
            contentWithLines,
            '```',
            '',
            '## Selections',
            '```',
            selections,
            '```',
            '',
            '## Known Files (in memory)',
            knownFiles.length ? knownFiles.join('\n') : '(none)',
            '',
            '## Capabilities',
            "- You can list, search, read, and edit files in the user's VS Code workspace.",
            '- Use `updateDocument` to apply changes. Prefer line-based patches.',
            '- Use `listWorkspaceFiles`, `searchWorkspaceFiles`, and `readWorkspaceFiles` to gather context.',
            '',
            '## Line-Based Editing',
            '- Lines are numbered starting from 1',
            '- `lineStart`: The line number where the operation begins (1-based)',
            '- `lineEnd`: (optional) The end line for replace/delete operations (inclusive)',
            '- `text`: The new text for replace/insert operations (can be multi-line)',
            '',
            '## CRITICAL RULES',
            '1. When a user wants changes, always call `updateDocument`.',
            '2. If you are unsure about intent, ask for clarification first.',
            '3. Prefer patches over replacing full content unless necessary.',
            '',
          ].join('\n')

          return makeTaskResult([
            ...(webSearchEnabled ? [createChatCompletionTask({ goal: 'WebSearch' })] : []),
            createChatCompletionTask({
              prompts: [contextPrompt],
              goal: 'ChooseTool',
              allowedTools: [
                'listWorkspaceFiles',
                'searchWorkspaceFiles',
                'readWorkspaceFiles',
                'updateDocument',
              ],
            }),
          ])
        },
      }),
      createTool({
        name: 'listWorkspaceFiles',
        description: 'List files in the current VS Code workspace.',
        parameters: {
          type: 'object',
          properties: {
            include: {
              type: 'string',
              description: 'Optional glob include pattern (defaults to **/*)',
            },
            exclude: {
              type: 'string',
              description: 'Optional glob exclude pattern',
            },
            showAll: {
              type: 'boolean',
              description: 'Include everything (ignore default excludes)',
            },
            maxResults: { type: 'number', description: 'Maximum number of files to return' },
          },
          additionalProperties: false,
        },
        function: async ({ include, exclude, showAll, maxResults } = {}) => {
          const response = await sendRequest('vscodeListFiles', {
            include,
            exclude,
            showAll,
            maxResults,
          })
          const files = response?.data?.files || []
          return makeTaskResult([
            [
              {
                role: 'system',
                content: {
                  type: 'message',
                  data: files.length ? `Workspace files:\n${files.join('\n')}` : 'No files found.',
                },
              },
              getFollowUpTask(),
            ],
          ])
        },
      }),
      createTool({
        name: 'searchWorkspaceFiles',
        description: 'Search for files in the workspace by name or glob pattern.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query or glob pattern' },
            include: { type: 'string', description: 'Optional glob include override' },
            exclude: { type: 'string', description: 'Optional glob exclude pattern' },
            maxResults: { type: 'number', description: 'Maximum number of files to return' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        function: async ({ query, include, exclude, maxResults }) => {
          const response = await sendRequest('vscodeSearchFiles', {
            query,
            include,
            exclude,
            maxResults,
          })
          const files = response?.data?.files || []
          return makeTaskResult([
            [
              {
                role: 'system',
                content: {
                  type: 'message',
                  data: files.length ? `Matched files:\n${files.join('\n')}` : 'No matches found.',
                },
              },
              getFollowUpTask(),
            ],
          ])
        },
      }),
      createTool({
        name: 'readWorkspaceFiles',
        description: 'Read one or more workspace files and store their content in memory.',
        parameters: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths to read (relative or absolute)',
            },
          },
          required: ['paths'],
          additionalProperties: false,
        },
        function: async ({ paths }) => {
          const response = await sendRequest('vscodeReadFiles', { paths })
          const loaded = []
          const results = response?.data?.files || []
          for (const file of results) {
            if (file?.content !== undefined) {
              files[file.path] = file.content
              fileMeta[file.path] = {
                languageId: file.languageId,
                selections: fileMeta[file.path]?.selections || [],
              }
              loaded.push(file.path)
            }
          }
          return makeTaskResult([
            [
              {
                role: 'system',
                content: {
                  type: 'message',
                  data: loaded.length
                    ? `Loaded files:\n${loaded.join('\n')}`
                    : 'No files were loaded.',
                },
              },
              getFollowUpTask(),
            ],
          ])
        },
      }),
      createTool({
        name: 'updateDocument',
        description: 'Update one or more files in the VS Code workspace.',
        parameters: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filePath: {
                    type: 'string',
                    description: 'The path/name of the file to update',
                  },
                  patches: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { enum: ['replace', 'insert', 'delete'], type: 'string' },
                        lineStart: { type: 'number' },
                        lineEnd: { type: 'number' },
                        text: { type: 'string' },
                      },
                      required: ['type', 'lineStart'],
                    },
                  },
                  newContent: {
                    type: 'string',
                    description:
                      'Full new content for the file. Only do this if necessary; prefer patches.',
                  },
                },
                required: ['filePath'],
              },
            },
            description: { type: 'string', description: 'Summary of changes' },
          },
          required: ['updates'],
        },
        function: async ({ updates, description }) => {
          vscode.postMessage({
            source: vscodeMessageSource,
            type: 'vscodeApplyEdits',
            payload: { updates, description },
          })

          const nextFiles = { ...files }
          const changesLog = []
          const editedFiles = Array.from(
            new Set((updates || []).map((update) => update?.filePath).filter(Boolean)),
          )
          for (const update of updates || []) {
            const { filePath, newContent, patches } = update || {}
            if (!filePath) continue
            let originalContent = nextFiles[filePath]
            if (originalContent === undefined && patches?.length) {
              try {
                const response = await sendRequest('vscodeReadFiles', { paths: [filePath] })
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
              } else if (patches && patches.length) {
                changesLog.push(`Patched ${filePath} (not tracked)`)
              } else {
                changesLog.push(`Skipped ${filePath}: File not found.`)
              }
              continue
            }
            let updatedContent = originalContent
            if (typeof newContent === 'string') {
              updatedContent = newContent
              changesLog.push(`Replaced content of ${filePath}`)
            } else if (patches && patches.length) {
              updatedContent = applyLinePatches(originalContent, patches)
              changesLog.push(`Patched ${filePath} (${patches.length} ops)`)
            }
            nextFiles[filePath] = updatedContent
          }
          Object.keys(files).forEach((key) => delete files[key])
          Object.assign(files, nextFiles)

          const editedFilesSummary = editedFiles.length
            ? `\n\nEdited files:\n${editedFiles
                .map((filePath) => `- [${filePath}](${getVscodeLink(filePath)})`)
                .join('\n')}`
            : ''

          return makeTaskResult([
            [
              {
                role: 'system',
                content: {
                  type: 'message',
                  data: `Updates applied:\n${changesLog.join('\n')}${editedFilesSummary}`,
                },
              },
              getFollowUpTask(),
            ],
          ])
        },
      }),
    ]

    const entryNode = toolCall({ name: 'vscodeAssistant', arguments: {} })
    return { tools, entryNode }
  }

  const applyWebviewBackground = (theme) => {
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

  const setTheme = (theme) => {
    if (!theme) return
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

  const setActiveFile = (payload) => {
    if (!payload || !payload.path) return
    files[payload.path] = payload.content || ''
    activeFileName = payload.path
    fileMeta[payload.path] = {
      languageId: payload.languageId,
      selections: payload.selections || [],
    }
  }

  const updateSourceToggle = () => {
    if (!sourceButtons.length) return
    let isLocal = false
    try {
      const url = new URL(frame?.getAttribute('src') || framedUrl || '')
      isLocal = url.host === 'localhost:9000'
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
    sourceToggle.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const source = target.getAttribute('data-source')
      if (!source) return
      const url =
        source === 'local' ? defaultUrl || 'http://localhost:9000' : 'https://taskyon.space'
      vscode.postMessage({
        source: vscodeMessageSource,
        type: 'vscodeSetBaseUrl',
        payload: { url },
      })
    })
  }

  const sendClipboardResult = (requestId, ok, error) => {
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

  const sendClipboardImageResult = (requestId, ok, error) => {
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

  const handleClipboardWrite = async (text, requestId) => {
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
      sendClipboardResult(
        requestId,
        false,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  const handleClipboardImageWrite = async (payload) => {
    const { data, mime, requestId } = payload || {}
    if (!data || !mime) {
      sendClipboardImageResult(requestId, false, 'Clipboard image data missing')
      return
    }
    if (!('ClipboardItem' in globalThis)) {
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

  let initializing = false
  let lastInitSrc = ''
  const initTaskyon = async (reason) => {
    const src = frame?.getAttribute('src') || ''
    if (initializing || !src) return
    if (lastInitSrc === src) return
    initializing = true
    lastInitSrc = src
    try {
      await waitForTyclient()
      const { tools, entryNode } = createTools()
      const { initializeTaskyon } = window.tyclient || {}
      if (!initializeTaskyon) {
        console.error('[Taskyon][Webview] tyclient missing; cannot initialize.')
        lastInitSrc = ''
        return
      }
      await initializeTaskyon({
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
      lastInitSrc = ''
    } finally {
      initializing = false
    }
  }

  frame.addEventListener('load', () => {
    console.log('[Taskyon][Webview] iframe src:', framedUrl)
    vscode.postMessage({
      source: vscodeMessageSource,
      type: 'vscodeWebviewUrl',
      payload: { framedUrl },
    })
    try {
      frame?.contentWindow?.postMessage({ type: 'vscodeClipboardBridge', enabled: true }, '*')
    } catch {
      // ignore bridge notifications
    }
    updateSourceToggle()
    void initTaskyon('load')
  })

  installWebviewConsoleBridge()
  applyWebviewBackground(document.documentElement.getAttribute('data-vscode-theme'))
  updateSourceToggle()
  void initTaskyon('startup')

  window.addEventListener('message', (event) => {
    const data = event.data || {}
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
      const pending = pendingRequests.get(requestId)
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
      setActiveFile(data.payload)
    }
  })
})()
