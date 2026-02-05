import * as vscode from 'vscode';

const DEFAULT_URL = 'https://taskyon.space';
const EXTENSION_TITLE = 'Taskyon';

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

function buildWebviewHtml(webview: vscode.Webview, targetUrl: string): string {
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

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${EXTENSION_TITLE}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body, html {
        padding: 0;
        margin: 0;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: #0b0f14;
      }
      #frame {
        border: none;
        height: 100%;
        width: 100%;
        background: #0b0f14;
      }
    </style>
  </head>
  <body>
    <iframe
      id="frame"
      src="${targetUrl}"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      allow="clipboard-read; clipboard-write; fullscreen"
    ></iframe>
  </body>
</html>`;
}

async function openExternal(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

function openWebview(context: vscode.ExtensionContext, url: string): void {
  const panel = vscode.window.createWebviewPanel(
    'taskyon',
    EXTENSION_TITLE,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = buildWebviewHtml(panel.webview, url);

  const disposables: vscode.Disposable[] = [];
  disposables.push(panel.onDidDispose(() => {
    disposables.forEach(disposable => disposable.dispose());
  }));
}

async function openTaskyon(context: vscode.ExtensionContext): Promise<void> {
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

  openWebview(context, url);
}

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand('taskyon.open', () => openTaskyon(context));
  const openExternalCommand = vscode.commands.registerCommand('taskyon.openExternal', async () => {
    const rawUrl = getConfiguredUrl();
    const url = normalizeUrl(rawUrl);

    if (!url) {
      vscode.window.showErrorMessage(`Invalid Taskyon URL: ${rawUrl}`);
      return;
    }

    await openExternal(url);
  });

  context.subscriptions.push(openCommand, openExternalCommand);
}

export function deactivate(): void {
  // No-op.
}
