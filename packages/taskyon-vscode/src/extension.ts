import * as vscode from 'vscode';
import * as path from 'path';

const DEFAULT_URL = 'https://taskyon.space';
const EXTENSION_TITLE = 'Taskyon';
const THEME_QUERY_KEY = 'vscodeTheme';
const VSCODE_QUERY_KEY = 'vscode';
const VSCODE_MESSAGE_SOURCE = 'taskyon-vscode';

type ThemeMode = 'dark' | 'light';

function getConfiguredUrl(): string {
  const config = vscode.workspace.getConfiguration('taskyon');
  const url = config.get<string>('url', DEFAULT_URL).trim();
  return url.length ? url : DEFAULT_URL;
}

function getOpenMode(): 'webview' | 'external' {
  const config = vscode.workspace.getConfiguration('taskyon');
  return config.get<'webview' | 'external'>('openIn', 'webview');
}

function normalizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function getThemeMode(theme: vscode.ColorTheme): ThemeMode {
  switch (theme.kind) {
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return 'light';
    case vscode.ColorThemeKind.Dark:
    case vscode.ColorThemeKind.HighContrast:
    default:
      return 'dark';
  }
}

function appendThemeQuery(url: string, theme: ThemeMode): string {
  const parsed = new URL(url);
  parsed.searchParams.set(THEME_QUERY_KEY, theme);
  return parsed.toString();
}

function appendVscodeQuery(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(VSCODE_QUERY_KEY, 'true');
  return parsed.toString();
}

function buildWebviewHtml(webview: vscode.Webview, targetUrl: string, theme: ThemeMode): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline'`,
    "img-src https: http: data:",
    "frame-src https: http:",
    "connect-src https: http:",
    "font-src https: http: data:",
    "base-uri 'none'",
  ].join('; ');

  const themedUrl = appendThemeQuery(targetUrl, theme);
  const framedUrl = appendVscodeQuery(themedUrl);

  return `<!doctype html>
<html lang="en" data-vscode-theme="${theme}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${EXTENSION_TITLE}</title>
    <style>
      :root {
        color-scheme: ${theme};
      }
      body, html {
        padding: 0;
        margin: 0;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: var(--vscode-sideBar-background, #0b0f14);
      }
      #frame {
        border: none;
        height: 100%;
        width: 100%;
        background: var(--vscode-sideBar-background, #0b0f14);
      }
    </style>
  </head>
  <body>
    <iframe
      id="frame"
      src="${framedUrl}"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      allow="clipboard-read; clipboard-write; fullscreen"
    ></iframe>
    <script>
      const vscode = acquireVsCodeApi();
      const vscodeThemeKey = ${JSON.stringify(THEME_QUERY_KEY)};
      const vscodeMessageSource = ${JSON.stringify(VSCODE_MESSAGE_SOURCE)};
      const frame = document.getElementById('frame');
      const queuedMessages = [];

      const postToFrame = (message) => {
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage(message, '*');
        } else {
          queuedMessages.push(message);
        }
      };

      const initTaskyonPort = () => {
        if (!frame || !frame.contentWindow) return;
        const channel = new MessageChannel();
        frame.contentWindow.postMessage({ type: 'initPort' }, '*', [channel.port1]);
      };

      frame.addEventListener('load', () => {
        initTaskyonPort();
        while (queuedMessages.length && frame.contentWindow) {
          frame.contentWindow.postMessage(queuedMessages.shift(), '*');
        }
      });
      const setTheme = (theme) => {
        if (!theme) return;
        const current = document.documentElement.getAttribute('data-vscode-theme');
        if (current === theme) return;
        document.documentElement.setAttribute('data-vscode-theme', theme);
        document.documentElement.style.colorScheme = theme;
        try {
          const url = new URL(frame.src);
          url.searchParams.set(vscodeThemeKey, theme);
          frame.src = url.toString();
        } catch {
          // Ignore malformed URLs.
        }
      };
      window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'theme') {
          setTheme(data.theme);
          return;
        }
        if (data.source === vscodeMessageSource && data.type === 'vscodeActiveFile') {
          postToFrame(data);
        }
      });

      window.addEventListener('message', (event) => {
        if (!frame || event.source !== frame.contentWindow) return;
        const data = event.data || {};
        if (data.source === vscodeMessageSource && data.type === 'vscodeApplyEdits') {
          vscode.postMessage(data);
        }
      });
    </script>
  </body>
</html>`;
}

async function openExternal(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

class TaskyonViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'taskyon.sidebar';
  private view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;
  private pendingMessage?: unknown;
  private messageHandler?: (message: unknown) => void;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
    };
    webviewView.webview.onDidReceiveMessage(message => {
      this.messageHandler?.(message);
    });

    const rawUrl = getConfiguredUrl();
    const url = normalizeUrl(rawUrl);
    const theme = getThemeMode(vscode.window.activeColorTheme);

    if (!url) {
      webviewView.webview.html = `<!doctype html>
<html lang="en">
  <body>
    <p>Invalid Taskyon URL: ${rawUrl}</p>
  </body>
</html>`;
      return;
    }

    webviewView.webview.html = buildWebviewHtml(webviewView.webview, url, theme);
    if (this.pendingMessage) {
      void webviewView.webview.postMessage(this.pendingMessage);
      this.pendingMessage = undefined;
    }
  }

  updateTheme(theme: ThemeMode): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'theme', theme });
  }

  postMessage(message: unknown): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    } else {
      this.pendingMessage = message;
    }
  }

  setMessageHandler(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }
}

async function revealSidebar(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.taskyon');
}

async function openTaskyon(): Promise<void> {
  const rawUrl = getConfiguredUrl();
  const url = normalizeUrl(rawUrl);

  if (!url) {
    vscode.window.showErrorMessage(`Invalid Taskyon URL: ${rawUrl}`);
    return;
  }

  const openMode = getOpenMode();
  if (openMode === 'external') {
    await openExternal(url);
    return;
  }

  await revealSidebar();
}

export function activate(context: vscode.ExtensionContext): void {
  const viewProvider = new TaskyonViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TaskyonViewProvider.viewId, viewProvider)
  );

  const openCommand = vscode.commands.registerCommand('taskyon.open', () => openTaskyon());
  const openExternalCommand = vscode.commands.registerCommand('taskyon.openExternal', async () => {
    const rawUrl = getConfiguredUrl();
    const url = normalizeUrl(rawUrl);

    if (!url) {
      vscode.window.showErrorMessage(`Invalid Taskyon URL: ${rawUrl}`);
      return;
    }

    await openExternal(url);
  });

  const themeListener = vscode.window.onDidChangeActiveColorTheme(theme => {
    viewProvider.updateTheme(getThemeMode(theme));
  });

  context.subscriptions.push(openCommand, openExternalCommand, themeListener);

  const resolveFileUri = (pathOrUri: string): vscode.Uri | undefined => {
    if (!pathOrUri) return undefined;
    try {
      const parsed = vscode.Uri.parse(pathOrUri);
      if (parsed.scheme) return parsed;
    } catch {
      // ignore
    }
    if (path.isAbsolute(pathOrUri)) {
      return vscode.Uri.file(pathOrUri);
    }
    if (vscode.workspace.workspaceFolders?.length) {
      return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, pathOrUri);
    }
    return undefined;
  };

  const applyLinePatches = (
    text: string,
    patches: Array<{
      type: 'replace' | 'insert' | 'delete';
      lineStart: number;
      lineEnd?: number;
      text?: string;
    }>
  ): string => {
    const lines = text.split('\n');
    const sorted = [...patches].sort((a, b) => b.lineStart - a.lineStart);
    for (const patch of sorted) {
      const startIdx = Math.max(0, patch.lineStart - 1);
      if (patch.type === 'insert') {
        const newLines = (patch.text || '').split('\n');
        lines.splice(startIdx, 0, ...newLines);
        continue;
      }
      const endLine = patch.lineEnd ?? patch.lineStart;
      const deleteCount = Math.max(0, endLine - patch.lineStart + 1);
      if (patch.type === 'delete') {
        lines.splice(startIdx, deleteCount);
      } else {
        const newLines = (patch.text || '').split('\n');
        lines.splice(startIdx, deleteCount, ...newLines);
      }
    }
    return lines.join('\n');
  };

  const replaceDocumentContent = async (uri: vscode.Uri, content: string) => {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const lastLine = Math.max(0, document.lineCount - 1);
      const fullRange = new vscode.Range(
        0,
        0,
        lastLine,
        document.lineAt(lastLine).range.end.character
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, content);
      await vscode.workspace.applyEdit(edit);
    } catch {
      const buffer = Buffer.from(content, 'utf8');
      await vscode.workspace.fs.writeFile(uri, buffer);
    }
  };

  viewProvider.setMessageHandler(async message => {
    const data = message as {
      source?: string;
      type?: string;
      payload?: {
        updates?: Array<{
          filePath: string;
          patches?: Array<{
            type: 'replace' | 'insert' | 'delete';
            lineStart: number;
            lineEnd?: number;
            text?: string;
          }>;
          newContent?: string;
        }>;
      };
    };

    if (!data || data.source !== VSCODE_MESSAGE_SOURCE || data.type !== 'vscodeApplyEdits') return;
    const updates = data.payload?.updates ?? [];
    for (const update of updates) {
      const uri = resolveFileUri(update.filePath);
      if (!uri) continue;
      if (typeof update.newContent === 'string' && update.newContent.length >= 0) {
        await replaceDocumentContent(uri, update.newContent);
        continue;
      }
      if (update.patches?.length) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const updated = applyLinePatches(doc.getText(), update.patches);
        await replaceDocumentContent(uri, updated);
      }
    }
  });

  const getActiveFilePayload = (): {
    uri: string;
    path: string;
    content: string;
    languageId: string;
    version: number;
  } | null => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const doc = editor.document;
    if (doc.uri.scheme !== 'file') return null;
    return {
      uri: doc.uri.toString(),
      path: doc.fileName,
      content: doc.getText(),
      languageId: doc.languageId,
      version: doc.version,
    };
  };

  let lastSent: { uri: string; version: number } | null = null;
  const sendActiveFile = () => {
    const payload = getActiveFilePayload();
    if (!payload) return;
    if (lastSent && lastSent.uri === payload.uri && lastSent.version === payload.version) return;
    lastSent = { uri: payload.uri, version: payload.version };
    viewProvider.postMessage({
      source: VSCODE_MESSAGE_SOURCE,
      type: 'vscodeActiveFile',
      payload,
    });
  };

  const editorListener = vscode.window.onDidChangeActiveTextEditor(() => sendActiveFile());
  const documentListener = vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) return;
    sendActiveFile();
  });

  context.subscriptions.push(editorListener, documentListener);

  sendActiveFile();

  void revealSidebar();
}

export function deactivate(): void {
  // No-op.
}
