import * as vscode from 'vscode';

const DEFAULT_URL = 'https://taskyon.space';
const EXTENSION_TITLE = 'Taskyon';
const THEME_QUERY_KEY = 'vscodeTheme';

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
      src="${themedUrl}"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      allow="clipboard-read; clipboard-write; fullscreen"
    ></iframe>
    <script>
      const vscodeThemeKey = ${JSON.stringify(THEME_QUERY_KEY)};
      const frame = document.getElementById('frame');
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

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
    };

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
  }

  updateTheme(theme: ThemeMode): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'theme', theme });
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

  void revealSidebar();
}

export function deactivate(): void {
  // No-op.
}
