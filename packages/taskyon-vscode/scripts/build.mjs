import path from 'path'
import { fileURLToPath } from 'url'
import { build, context } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const watchMode = process.argv.includes('--watch')

const aliasPlugin = {
  name: 'taskyon-workspace-alias',
  setup(buildApi) {
    const aliasEntries = new Map([
      ['@taskyon/tyclient', path.resolve(repoRoot, 'packages/tyclient/src/index.ts')],
      ['@taskyon/taskyon/api', path.resolve(repoRoot, 'packages/taskyon/src/api/index.ts')],
    ])

    buildApi.onResolve({ filter: /^@taskyon\/(tyclient|taskyon\/api)$/ }, (args) => {
      const resolved = aliasEntries.get(args.path)
      if (!resolved) return null
      return { path: resolved }
    })
  },
}

const extensionConfig = {
  absWorkingDir: packageDir,
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  logLevel: 'info',
}

const webviewConfig = {
  absWorkingDir: packageDir,
  entryPoints: ['src/webview.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: 'media/webview.bundle.js',
  plugins: [aliasPlugin],
  logLevel: 'info',
}

if (watchMode) {
  const extensionContext = await context(extensionConfig)
  const webviewContext = await context(webviewConfig)
  await Promise.all([extensionContext.watch(), webviewContext.watch()])
  console.log('[taskyon-vscode] watching extension and webview bundles')
} else {
  await build(extensionConfig)
  await build(webviewConfig)
}
