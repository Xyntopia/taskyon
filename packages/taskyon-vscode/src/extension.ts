import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

const DEFAULT_URL = 'http://localhost:9000'
const THEME_QUERY_KEY = 'vscodeTheme'
const VSCODE_QUERY_KEY = 'vscode'
const IFRAME_QUERY_KEY = 'iframe'
const VSCODE_MESSAGE_SOURCE = 'taskyon-vscode'
const BASE_URL_STATE_KEY = 'taskyon.baseUrlOverride'

type ThemeMode = 'dark' | 'light'

function getConfiguredUrl(): string {
  const config = vscode.workspace.getConfiguration('taskyon')
  const url = config.get<string>('url', DEFAULT_URL).trim()
  return url.length ? url : DEFAULT_URL
}

function getStoredBaseUrl(context: vscode.ExtensionContext): string | undefined {
  const stored = (context.globalState.get<string>(BASE_URL_STATE_KEY) || '').trim()
  return stored.length ? stored : undefined
}

function getEffectiveBaseUrl(context: vscode.ExtensionContext): string {
  return getStoredBaseUrl(context) || getConfiguredUrl()
}

function getOpenMode(): 'webview' | 'external' {
  const config = vscode.workspace.getConfiguration('taskyon')
  return config.get<'webview' | 'external'>('openIn', 'webview')
}

function normalizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.toString()
  } catch {
    return undefined
  }
}

function getThemeMode(theme: vscode.ColorTheme): ThemeMode {
  switch (theme.kind) {
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return 'light'
    case vscode.ColorThemeKind.Dark:
    case vscode.ColorThemeKind.HighContrast:
    default:
      return 'dark'
  }
}

function appendThemeQuery(url: string, theme: ThemeMode): string {
  const parsed = new URL(url)
  parsed.searchParams.set(THEME_QUERY_KEY, theme)
  return parsed.toString()
}

function appendVscodeQuery(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set(VSCODE_QUERY_KEY, 'true')
  return parsed.toString()
}

function appendIframeQuery(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set(IFRAME_QUERY_KEY, 'true')
  return parsed.toString()
}

function buildWebviewHtmlForUrl(options: {
  context: vscode.ExtensionContext
  webview: vscode.Webview
  baseUrl: string
  theme: ThemeMode
}): string {
  const { context, webview, baseUrl, theme } = options
  const themedUrl = appendThemeQuery(baseUrl, theme)
  const vscodeUrl = appendVscodeQuery(themedUrl)
  const framedUrl = appendIframeQuery(vscodeUrl)
  const tyclientUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, '..', '..', 'packages', 'tyclient', 'dist', 'tyclient.mjs'),
  )
  const bundledTyclientPath = path.join(
    context.extensionUri.fsPath,
    '..',
    '..',
    'packages',
    'taskyon-vscode',
    'media',
    'tyclient.bundle.mjs',
  )
  const bundledTyclientUri = webview.asWebviewUri(vscode.Uri.file(bundledTyclientPath))
  const webviewScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, '..', '..', 'packages', 'taskyon-vscode', 'media', 'webview.js'),
  )
  const htmlPath = path.join(
    context.extensionUri.fsPath,
    '..',
    '..',
    'packages',
    'taskyon-vscode',
    'media',
    'index.html',
  )
  const nonce = Math.random().toString(36).slice(2)
  return buildWebviewHtml({
    webview,
    htmlPath,
    framedUrl,
    theme,
    nonce,
    tyclientUri: fs.existsSync(bundledTyclientPath) ? bundledTyclientUri : tyclientUri,
    webviewScriptUri,
  })
}

function buildWebviewHtml(options: {
  webview: vscode.Webview
  htmlPath: string
  framedUrl: string
  theme: ThemeMode
  nonce: string
  tyclientUri: vscode.Uri
  webviewScriptUri: vscode.Uri
}): string {
  const { webview, htmlPath, framedUrl, theme, nonce, tyclientUri, webviewScriptUri } = options
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    'img-src https: http: data:',
    'frame-src https: http:',
    'connect-src https: http:',
    'font-src https: http: data:',
    "base-uri 'none'",
  ].join('; ')

  const html = fs.readFileSync(htmlPath, 'utf8')
  const configSnippet = `<script nonce="${nonce}">window.__TASKYON__=${JSON.stringify({
    themeKey: THEME_QUERY_KEY,
    messageSource: VSCODE_MESSAGE_SOURCE,
    framedUrl,
    defaultUrl: getConfiguredUrl(),
    localUrl: DEFAULT_URL,
  })};</script>`

  const withConfig = html.includes('__TASKYON_CONFIG__')
    ? html.replace('__TASKYON_CONFIG__', configSnippet)
    : html.replace('</body>', `${configSnippet}</body>`)

  return withConfig
    .replace(/__TASKYON_CSP__/g, csp)
    .replace(/__TASKYON_THEME__/g, theme) // TODO: we are not using this currently in the index.html, I am not sure if we need it...
    .replace(/__TASKYON_NONCE__/g, nonce)
    .replace(/__TASKYON_IFRAME_SRC__/g, framedUrl)
    .replace(/__TASKYON_TYCLIENT_URI__/g, tyclientUri.toString())
    .replace(/__TASKYON_WEBVIEW_SCRIPT__/g, webviewScriptUri.toString())
}

async function openExternal(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url))
}

class TaskyonViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'taskyon.sidebar'
  private view?: vscode.WebviewView
  private readonly context: vscode.ExtensionContext
  private pendingMessage?: unknown
  private messageHandler?: (message: unknown) => void
  private lastWebviewUrl: string | undefined

  constructor(context: vscode.ExtensionContext) {
    this.context = context
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(
          this.context.extensionUri,
          '..',
          '..',
          'packages',
          'taskyon-vscode',
          'media',
        ),
        vscode.Uri.joinPath(this.context.extensionUri, '..', '..', 'packages', 'tyclient', 'dist'),
      ],
    }
    webviewView.webview.onDidReceiveMessage((message) => {
      this.messageHandler?.(message)
    })

    this.renderWebview()
  }

  refresh(): void {
    if (!this.view) return
    this.renderWebview(true)
  }

  async setBaseUrl(url: string): Promise<void> {
    await this.context.globalState.update(BASE_URL_STATE_KEY, url)
    this.refresh()
  }

  private renderWebview(force = false): void {
    if (!this.view) return
    const webviewView = this.view
    const rawUrl = getEffectiveBaseUrl(this.context)
    const url = normalizeUrl(rawUrl)
    const theme = getThemeMode(vscode.window.activeColorTheme)

    if (!url) {
      webviewView.webview.html = `<!doctype html>
<html lang="en">
  <body>
    <p>Invalid Taskyon URL: ${rawUrl}</p>
  </body>
</html>`
      this.lastWebviewUrl = undefined
      return
    }

    if (!force && webviewView.webview.html && this.lastWebviewUrl === url) {
      void webviewView.webview.postMessage({ type: 'theme', theme })
      if (this.pendingMessage) {
        void webviewView.webview.postMessage(this.pendingMessage)
        this.pendingMessage = undefined
      }
      return
    }

    console.log(`[Taskyon][Webview] resolved url: ${url}`)
    webviewView.webview.html = buildWebviewHtmlForUrl({
      context: this.context,
      webview: webviewView.webview,
      baseUrl: url,
      theme,
    })
    this.lastWebviewUrl = url
    if (this.pendingMessage) {
      void webviewView.webview.postMessage(this.pendingMessage)
      this.pendingMessage = undefined
    }
  }

  updateTheme(theme: ThemeMode): void {
    if (!this.view) return
    this.view.webview.postMessage({ type: 'theme', theme })
  }

  postMessage(message: unknown): void {
    if (this.view) {
      void this.view.webview.postMessage(message)
    } else {
      this.pendingMessage = message
    }
  }

  setMessageHandler(handler: (message: unknown) => void): void {
    this.messageHandler = handler
  }
}

async function revealSidebar(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.taskyon')
}

async function openTaskyon(): Promise<void> {
  const rawUrl = getConfiguredUrl()
  const url = normalizeUrl(rawUrl)

  if (!url) {
    vscode.window.showErrorMessage(`Invalid Taskyon URL: ${rawUrl}`)
    return
  }

  const openMode = getOpenMode()
  if (openMode === 'external') {
    const theme = getThemeMode(vscode.window.activeColorTheme)
    const externalUrl = appendVscodeQuery(appendThemeQuery(url, theme))
    console.log(`[Taskyon][External] resolved url: ${externalUrl}`)
    await openExternal(externalUrl)
    return
  }

  await revealSidebar()
}

export function activate(context: vscode.ExtensionContext): void {
  const viewProvider = new TaskyonViewProvider(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TaskyonViewProvider.viewId, viewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  )

  const openCommand = vscode.commands.registerCommand('taskyon.open', () => openTaskyon())
  const openExternalCommand = vscode.commands.registerCommand('taskyon.openExternal', async () => {
    const rawUrl = getConfiguredUrl()
    const url = normalizeUrl(rawUrl)

    if (!url) {
      vscode.window.showErrorMessage(`Invalid Taskyon URL: ${rawUrl}`)
      return
    }

    const theme = getThemeMode(vscode.window.activeColorTheme)
    const externalUrl = appendVscodeQuery(appendThemeQuery(url, theme))
    console.log(`[Taskyon][External] resolved url: ${externalUrl}`)
    await openExternal(externalUrl)
  })

  const themeListener = vscode.window.onDidChangeActiveColorTheme((theme) => {
    viewProvider.updateTheme(getThemeMode(theme))
  })

  context.subscriptions.push(openCommand, openExternalCommand, themeListener)

  const resolveFileUri = (pathOrUri: string): vscode.Uri | undefined => {
    if (!pathOrUri) return undefined
    try {
      const parsed = vscode.Uri.parse(pathOrUri)
      if (parsed.scheme) return parsed
    } catch {
      // ignore
    }
    if (path.isAbsolute(pathOrUri)) {
      return vscode.Uri.file(pathOrUri)
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (workspaceFolder) return vscode.Uri.joinPath(workspaceFolder.uri, pathOrUri)
    return undefined
  }

  const applyLinePatches = (
    text: string,
    patches: Array<{
      type: 'replace' | 'insert' | 'delete'
      lineStart: number
      lineEnd?: number
      text?: string
    }>,
  ): string => {
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

  const replaceDocumentContent = async (uri: vscode.Uri, content: string) => {
    try {
      const document = await vscode.workspace.openTextDocument(uri)
      const lastLine = Math.max(0, document.lineCount - 1)
      const fullRange = new vscode.Range(
        0,
        0,
        lastLine,
        document.lineAt(lastLine).range.end.character,
      )
      const edit = new vscode.WorkspaceEdit()
      edit.replace(uri, fullRange, content)
      await vscode.workspace.applyEdit(edit)
    } catch {
      const buffer = Buffer.from(content, 'utf8')
      await vscode.workspace.fs.writeFile(uri, buffer)
    }
  }

  const openFileInEditor = async (
    pathOrUri: string,
    line?: number,
    character?: number,
  ): Promise<void> => {
    const uri = resolveFileUri(pathOrUri)
    if (!uri) return
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document, { preview: false })
    const safeLine = typeof line === 'number' && Number.isFinite(line) ? line : undefined
    const safeCharacter =
      typeof character === 'number' && Number.isFinite(character) ? character : undefined
    if (safeLine !== undefined) {
      const lineIndex = Math.max(0, safeLine - 1)
      const charIndex = Math.max(0, (safeCharacter ?? 1) - 1)
      const position = new vscode.Position(lineIndex, charIndex)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
    }
  }

  const parseFileLink = (
    href: string,
  ): { path: string; line?: number; character?: number } | null => {
    if (!href) return null
    const [base = '', hash] = href.split('#', 2)
    if (!base) return null
    const hashMatch = hash?.match(/^L(\d+)(?:C(\d+))?$/i)
    const line = hashMatch ? Number(hashMatch[1]) : undefined
    const character = hashMatch && hashMatch[2] ? Number(hashMatch[2]) : undefined

    const stripLeadingSlashes = (value: string) => value.replace(/^\/+/, '')
    const buildResult = (filePath: string) => {
      const result: { path: string; line?: number; character?: number } = {
        path: stripLeadingSlashes(filePath),
      }
      if (line !== undefined) result.line = line
      if (character !== undefined) result.character = character
      return result
    }

    if (base.startsWith('file:')) {
      const path = base.slice('file:'.length)
      return buildResult(path)
    }
    if (base.startsWith('taskyon://') || base.startsWith('vscode://')) {
      try {
        const url = new URL(base)
        if (url.hostname === 'file') {
          return buildResult(url.pathname)
        }
      } catch {
        return null
      }
    }
    return null
  }

  const DEFAULT_FILE_EXCLUDE =
    '**/{node_modules,.git,.hg,.svn,.direnv,.idea,.vscode,.venv,.virtualenv,dist,build,out,coverage,target,bin,obj,logs,log,tmp,temp,.cache,.parcel-cache,.pytest_cache,.mypy_cache,.ruff_cache,.next,.turbo,.svelte-kit,.nuxt,.vercel,.angular,.gradle,.dart_tool}/**'

  const buildSearchGlob = (query?: string, include?: string): string => {
    if (include) return include
    if (!query) return '**/*'
    if (/[*?[\]{}]/.test(query)) return query
    return `**/*${query}*`
  }

  const postResponse = (requestId: string, payload: unknown, error?: string) => {
    viewProvider.postMessage({
      source: VSCODE_MESSAGE_SOURCE,
      type: 'vscodeResponse',
      payload: {
        requestId,
        error,
        data: payload,
      },
    })
  }

  viewProvider.setMessageHandler((message) => {
    void (async () => {
      const data = message as {
        source?: string
        type?: string
        payload?: {
          requestId?: string
          query?: string
          include?: string
          exclude?: string
          showAll?: boolean
          maxResults?: number
          paths?: string[]
          path?: string
          href?: string
          line?: number | string
          character?: number | string
          updates?: Array<{
            filePath: string
            patches?: Array<{
              type: 'replace' | 'insert' | 'delete'
              lineStart: number
              lineEnd?: number
              text?: string
            }>
            newContent?: string
          }>
          text?: string
          framedUrl?: string
          level?: 'log' | 'info' | 'warn' | 'error' | 'debug'
          args?: unknown[]
          url?: string
        }
      }

      if (!data || data.source !== VSCODE_MESSAGE_SOURCE) return

      if (data.type === 'vscodeWebviewUrl') {
        const framedUrl = data.payload?.framedUrl
        if (framedUrl) {
          console.log(`[Taskyon][Webview] iframe src: ${framedUrl}`)
        }
        return
      }
      if (data.type === 'vscodeIframeLog') {
        const level = data.payload?.level ?? 'log'
        const args = data.payload?.args ?? []
        const prefix = `[Taskyon][Iframe][${level}]`
        switch (level) {
          case 'error':
            console.error(prefix, ...args)
            break
          case 'warn':
            console.warn(prefix, ...args)
            break
          case 'info':
            console.info(prefix, ...args)
            break
          case 'debug':
            console.debug(prefix, ...args)
            break
          default:
            console.log(prefix, ...args)
        }
        return
      }
      if (data.type === 'vscodeWebviewLog') {
        const level = data.payload?.level ?? 'log'
        const args = data.payload?.args ?? []
        const prefix = `[Taskyon][Webview][${level}]`
        switch (level) {
          case 'error':
            console.error(prefix, ...args)
            break
          case 'warn':
            console.warn(prefix, ...args)
            break
          case 'info':
            console.info(prefix, ...args)
            break
          case 'debug':
            console.debug(prefix, ...args)
            break
          default:
            console.log(prefix, ...args)
        }
        return
      }
      if (data.type === 'vscodeListFiles') {
        const requestId = data.payload?.requestId
        if (!requestId) return
        const include = data.payload?.include ?? '**/*'
        const showAll = Boolean(data.payload?.showAll)
        const exclude = showAll
          ? data.payload?.exclude
          : (data.payload?.exclude ?? DEFAULT_FILE_EXCLUDE)
        const maxResults = data.payload?.maxResults ?? 5000
        try {
          const files = await vscode.workspace.findFiles(include, exclude, maxResults)
          const results = files.map((uri) => vscode.workspace.asRelativePath(uri, false))
          postResponse(requestId, { files: results })
        } catch (error) {
          postResponse(requestId, { files: [] }, (error as Error).message)
        }
        return
      }
      if (data.type === 'vscodeSearchFiles') {
        const requestId = data.payload?.requestId
        if (!requestId) return
        const include = buildSearchGlob(data.payload?.query, data.payload?.include)
        const exclude = data.payload?.exclude ?? DEFAULT_FILE_EXCLUDE
        const maxResults = data.payload?.maxResults ?? 2000
        try {
          const files = await vscode.workspace.findFiles(include, exclude, maxResults)
          const results = files.map((uri) => vscode.workspace.asRelativePath(uri, false))
          postResponse(requestId, { files: results })
        } catch (error) {
          postResponse(requestId, { files: [] }, (error as Error).message)
        }
        return
      }
      if (data.type === 'vscodeReadFiles') {
        const requestId = data.payload?.requestId
        if (!requestId) return
        const paths = data.payload?.paths ?? []
        const results: Array<{
          path: string
          uri?: string
          content?: string
          languageId?: string
          error?: string
        }> = []
        for (const filePath of paths) {
          const uri = resolveFileUri(filePath)
          if (!uri) {
            results.push({ path: filePath, error: 'Unable to resolve file path.' })
            continue
          }
          try {
            const doc = await vscode.workspace.openTextDocument(uri)
            results.push({
              path: vscode.workspace.asRelativePath(uri, false),
              uri: uri.toString(),
              content: doc.getText(),
              languageId: doc.languageId,
            })
          } catch (error) {
            try {
              const buffer = await vscode.workspace.fs.readFile(uri)
              results.push({
                path: vscode.workspace.asRelativePath(uri, false),
                uri: uri.toString(),
                content: Buffer.from(buffer).toString('utf8'),
              })
            } catch {
              results.push({
                path: vscode.workspace.asRelativePath(uri, false),
                uri: uri.toString(),
                error: (error as Error).message,
              })
            }
          }
        }
        postResponse(requestId, { files: results })
        return
      }
      if (data.type === 'vscodeClipboardWrite') {
        const requestId = data.payload?.requestId
        if (!requestId) return
        try {
          const text = data.payload?.text ?? ''
          await vscode.env.clipboard.writeText(text)
          postResponse(requestId, { ok: true })
        } catch (error) {
          postResponse(requestId, { ok: false }, (error as Error).message)
        }
        return
      }
      if (data.type === 'vscodeOpenLink') {
        const href = data.payload?.href
        if (!href) return
        const parsed = parseFileLink(href)
        if (!parsed) return
        await openFileInEditor(parsed.path, parsed.line, parsed.character)
        return
      }
      if (data.type === 'vscodeSetBaseUrl') {
        const url = data.payload?.url
        if (!url) return
        await viewProvider.setBaseUrl(url)
        return
      }
      if (data.type !== 'vscodeApplyEdits') return

      const updates = data.payload?.updates ?? []
      for (const update of updates) {
        const uri = resolveFileUri(update.filePath)
        if (!uri) continue
        if (typeof update.newContent === 'string' && update.newContent.length >= 0) {
          await replaceDocumentContent(uri, update.newContent)
          continue
        }
        if (update.patches?.length) {
          const doc = await vscode.workspace.openTextDocument(uri)
          const updated = applyLinePatches(doc.getText(), update.patches)
          await replaceDocumentContent(uri, updated)
        }
      }
    })()
  })

  const getActiveFilePayload = (): {
    uri: string
    path: string
    content: string
    languageId: string
    version: number
    selections: Array<{
      start: { line: number; character: number }
      end: { line: number; character: number }
      text: string
    }>
  } | null => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return null
    const doc = editor.document
    if (doc.uri.scheme !== 'file') return null
    const selections = editor.selections.map((selection) => ({
      start: { line: selection.start.line, character: selection.start.character },
      end: { line: selection.end.line, character: selection.end.character },
      text: doc.getText(selection),
    }))
    return {
      uri: doc.uri.toString(),
      path: doc.fileName,
      content: doc.getText(),
      languageId: doc.languageId,
      version: doc.version,
      selections,
    }
  }

  let lastSent: { uri: string; version: number; selectionHash: string } | null = null
  const sendActiveFile = () => {
    const payload = getActiveFilePayload()
    if (!payload) return
    const selectionHash = JSON.stringify(payload.selections)
    if (
      lastSent &&
      lastSent.uri === payload.uri &&
      lastSent.version === payload.version &&
      lastSent.selectionHash === selectionHash
    ) {
      return
    }
    lastSent = { uri: payload.uri, version: payload.version, selectionHash }
    viewProvider.postMessage({
      source: VSCODE_MESSAGE_SOURCE,
      type: 'vscodeActiveFile',
      payload,
    })
  }

  const editorListener = vscode.window.onDidChangeActiveTextEditor(() => sendActiveFile())
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(() => sendActiveFile())
  const documentListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor
    if (!editor || event.document !== editor.document) return
    sendActiveFile()
  })

  context.subscriptions.push(editorListener, selectionListener, documentListener)

  sendActiveFile()

  void revealSidebar()
}

export function deactivate(): void {
  // No-op.
}
