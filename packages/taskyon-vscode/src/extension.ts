// extension.js
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { applyFileUpdateToContent, normalizeFileUpdate, type FileUpdate } from './patching'

const DEFAULT_URL = 'http://localhost:9000'
const THEME_QUERY_KEY = 'vscodeTheme'
const VSCODE_QUERY_KEY = 'vscode'
const IFRAME_QUERY_KEY = 'iframe'
const VSCODE_MESSAGE_SOURCE = 'taskyon-vscode'
const BASE_URL_STATE_KEY = 'taskyon.baseUrlOverride'

type ThemeMode = 'dark' | 'light'
const CONTENT_SEARCH_CONCURRENCY = 24
const SUPPORTED_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'])
const SEARCH_SAFE_REGEX_FLAGS = new Set(['i', 'm', 's', 'u', 'v'])

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
  const webviewScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      context.extensionUri,
      '..',
      '..',
      'packages',
      'taskyon-vscode',
      'media',
      'webview.bundle.js',
    ),
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
    webviewScriptUri,
  })
}

function buildWebviewHtml(options: {
  webview: vscode.Webview
  htmlPath: string
  framedUrl: string
  theme: ThemeMode
  nonce: string
  webviewScriptUri: vscode.Uri
}): string {
  const { webview, htmlPath, framedUrl, theme, nonce, webviewScriptUri } = options
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
    .replace(/__TASKYON_WEBVIEW_SCRIPT__/g, webviewScriptUri.toString())
}

async function openExternal(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url))
}

class TaskyonViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'taskyon.sidebar'
  private view?: vscode.WebviewView
  private readonly context: vscode.ExtensionContext
  private pendingMessages: unknown[] = []
  private messageHandler?: (message: unknown) => void
  private lastWebviewUrl: string | undefined
  private webviewReady = false

  constructor(context: vscode.ExtensionContext) {
    this.context = context
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    this.webviewReady = false
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
      this.webviewReady = false
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
      void this.postMessage({ type: 'theme', theme })
      return
    }

    console.log(`[Taskyon][Webview] resolved url: ${url}`)
    this.webviewReady = false
    webviewView.webview.html = buildWebviewHtmlForUrl({
      context: this.context,
      webview: webviewView.webview,
      baseUrl: url,
      theme,
    })
    this.lastWebviewUrl = url
  }

  private flushPendingMessages(): void {
    if (!this.view || !this.webviewReady || !this.pendingMessages.length) return
    for (const message of this.pendingMessages) {
      void this.view.webview.postMessage(message)
    }
    this.pendingMessages = []
  }

  markReady(): void {
    this.webviewReady = true
    this.flushPendingMessages()
  }

  updateTheme(theme: ThemeMode): void {
    void this.postMessage({ type: 'theme', theme })
  }

  postMessage(message: unknown): boolean {
    if (!this.view || !this.webviewReady) {
      this.pendingMessages.push(message)
      return false
    }
    void this.view.webview.postMessage(message)
    return true
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
    if (path.isAbsolute(pathOrUri)) {
      return vscode.Uri.file(pathOrUri)
    }
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(pathOrUri)) {
      try {
        const parsed = vscode.Uri.parse(pathOrUri)
        if (parsed.scheme) return parsed
      } catch {
        // ignore malformed URIs and fall back to workspace-relative resolution
      }
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (workspaceFolder) return vscode.Uri.joinPath(workspaceFolder.uri, pathOrUri)
    return undefined
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

  const saveDocumentIfDirty = async (uri: vscode.Uri) => {
    try {
      const document = await vscode.workspace.openTextDocument(uri)
      if (document.isDirty) {
        await document.save()
      }
    } catch {
      // Ignore save failures for non-text documents or missing files.
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
  type SearchMode = 'pathRegex' | 'contentRegex'

  const mergeExcludeGlob = (exclude?: string) => {
    const extraExclude = exclude?.trim()
    if (!extraExclude) return DEFAULT_FILE_EXCLUDE
    if (extraExclude === DEFAULT_FILE_EXCLUDE) return DEFAULT_FILE_EXCLUDE
    return `{${DEFAULT_FILE_EXCLUDE},${extraExclude}}`
  }

  const readFileText = async (uri: vscode.Uri): Promise<string | undefined> => {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri)
      return Buffer.from(buffer).toString('utf8')
    } catch {
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        return doc.getText()
      } catch {
        return undefined
      }
    }
  }

  const compileSearchPattern = (query: string): RegExp => {
    let source = query
    const flags = new Set<string>()

    while (source.startsWith('(?')) {
      const inlineFlagMatch = source.match(/^\(\?([A-Za-z]+)\)/)
      if (!inlineFlagMatch) break

      const inlineFlags = inlineFlagMatch[1] || ''
      for (const flag of inlineFlags) {
        if (!SUPPORTED_REGEX_FLAGS.has(flag)) {
          throw new Error(
            `Unsupported inline regex flag "${flag}" in ${inlineFlagMatch[0]}. Use JavaScript-compatible flags only.`,
          )
        }
        if (SEARCH_SAFE_REGEX_FLAGS.has(flag)) {
          flags.add(flag)
        }
      }

      source = source.slice(inlineFlagMatch[0].length)
    }

    return new RegExp(source, Array.from(flags).join(''))
  }

  const testSearchPattern = (pattern: RegExp, value: string) =>
    new RegExp(pattern.source, pattern.flags).test(value)

  const searchWorkspaceFiles = async ({
    query,
    exclude,
    maxResults,
    searchLimit,
    mode,
  }: {
    query: string
    exclude?: string
    maxResults: number
    searchLimit: number
    mode: SearchMode
  }) => {
    const startedAt = Date.now()
    const pattern = compileSearchPattern(query)
    const effectiveExclude = mergeExcludeGlob(exclude)
    console.debug('[Taskyon][VSCode] search start', {
      mode,
      queryLength: query.length,
      maxResults,
      searchLimit,
    })

    try {
      if (mode === 'pathRegex') {
        const files = await vscode.workspace.findFiles('**/*', effectiveExclude, searchLimit)
        const results: string[] = []
        let hitCap = false

        for (const uri of files) {
          const relativePath = vscode.workspace.asRelativePath(uri, false)
          if (!testSearchPattern(pattern, relativePath)) continue
          results.push(relativePath)
          if (results.length >= maxResults) {
            hitCap = true
            break
          }
        }

        console.debug('[Taskyon][VSCode] search complete', {
          mode,
          queryLength: query.length,
          elapsedMs: Date.now() - startedAt,
          resultCount: results.length,
          hitCap,
        })
        return { files: results, hitCap, mode, exclude: effectiveExclude }
      }

      const files = await vscode.workspace.findFiles('**/*', effectiveExclude, searchLimit)
      const results: string[] = []
      let hitCap = false

      for (
        let index = 0;
        index < files.length && results.length < maxResults;
        index += CONTENT_SEARCH_CONCURRENCY
      ) {
        const batch = files.slice(index, index + CONTENT_SEARCH_CONCURRENCY)
        const batchMatches = await Promise.all(
          batch.map(async (uri) => {
            const content = await readFileText(uri)
            if (content === undefined) return undefined
            if (!testSearchPattern(pattern, content)) return undefined
            return vscode.workspace.asRelativePath(uri, false)
          }),
        )

        for (const relativePath of batchMatches) {
          if (!relativePath || results.includes(relativePath)) continue
          results.push(relativePath)
          if (results.length >= maxResults) {
            hitCap = true
            break
          }
        }
      }

      console.debug('[Taskyon][VSCode] search complete', {
        mode,
        queryLength: query.length,
        elapsedMs: Date.now() - startedAt,
        resultCount: results.length,
        hitCap,
      })
      return { files: results, hitCap, mode, exclude: effectiveExclude }
    } catch (error) {
      console.warn('[Taskyon][VSCode] search failed', {
        mode,
        queryLength: query.length,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
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
          mode?: SearchMode
          query?: string
          exclude?: string
          maxResults?: number
          searchLimit?: number
          paths?: string[]
          path?: string
          href?: string
          line?: number | string
          character?: number | string
          updates?: FileUpdate[]
          text?: string
          framedUrl?: string
          level?: 'log' | 'info' | 'warn' | 'error' | 'debug'
          args?: unknown[]
          url?: string
        }
      }

      if (!data || data.source !== VSCODE_MESSAGE_SOURCE) return

      if (data.type === 'vscodeWebviewReady') {
        viewProvider.markReady()
        sendActiveFile()
        return
      }
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
      if (data.type === 'vscodeSearchFiles') {
        const requestId = data.payload?.requestId
        if (!requestId) return
        const mode = data.payload?.mode ?? 'pathRegex'
        const query = data.payload?.query ?? ''
        const exclude = data.payload?.exclude
        const maxResults = data.payload?.maxResults ?? 50
        const searchLimit = data.payload?.searchLimit ?? 5000
        try {
          const result = await searchWorkspaceFiles({
            query,
            exclude,
            maxResults,
            searchLimit,
            mode,
          })
          postResponse(requestId, result)
        } catch (error) {
          postResponse(
            requestId,
            { files: [], hitCap: false, mode, exclude: mergeExcludeGlob(exclude) },
            (error as Error).message,
          )
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

      const requestId = data.payload?.requestId
      const updates = (data.payload?.updates ?? []).map(normalizeFileUpdate)
      const appliedFiles: string[] = []
      const failedFiles: string[] = []
      const errorMessages: string[] = []

      for (const update of updates) {
        try {
          const uri = resolveFileUri(update.filePath)
          if (!uri) {
            throw new Error(`Unable to resolve workspace file path "${update.filePath}"`)
          }
          if (typeof update.newContent === 'string') {
            await replaceDocumentContent(uri, update.newContent)
          } else {
            const doc = await vscode.workspace.openTextDocument(uri)
            const updated = applyFileUpdateToContent(doc.getText(), update)
            await replaceDocumentContent(uri, updated)
          }
          await saveDocumentIfDirty(uri)
          appliedFiles.push(update.filePath)
        } catch (error) {
          failedFiles.push(update.filePath)
          errorMessages.push(
            `${update.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      if (!requestId) {
        if (errorMessages.length) {
          console.error('[Taskyon][VSCode] apply edits failed', errorMessages)
        }
        return
      }

      if (errorMessages.length) {
        postResponse(
          requestId,
          { ok: false, files: appliedFiles, failedFiles, errors: errorMessages },
          `Failed to apply VS Code edits.\n${errorMessages.join('\n')}`,
        )
        return
      }

      postResponse(requestId, { ok: true, files: appliedFiles })
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
      path: vscode.workspace.asRelativePath(doc.uri, false),
      content: doc.getText(),
      languageId: doc.languageId,
      version: doc.version,
      selections,
    }
  }

  let lastSent: { uri: string; version: number; selectionHash: string } | null = null
  function sendActiveFile(): void {
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
    viewProvider.postMessage({
      source: VSCODE_MESSAGE_SOURCE,
      type: 'vscodeActiveFile',
      payload,
    })
    lastSent = { uri: payload.uri, version: payload.version, selectionHash }
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
