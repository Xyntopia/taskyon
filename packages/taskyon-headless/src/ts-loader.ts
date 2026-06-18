import { access, readFile, stat } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const localExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs']

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isFile()
  } catch {
    return false
  }
}

async function tryResolveRelative(specifier: string, parentURL?: string): Promise<string | null> {
  if (!parentURL?.startsWith('file:')) return null
  const parentPath = dirname(fileURLToPath(parentURL))
  const basePath = resolvePath(parentPath, specifier)

  if (await fileExists(basePath)) return pathToFileURL(basePath).href

  for (const ext of localExtensions) {
    if (await fileExists(basePath + ext)) return pathToFileURL(basePath + ext).href
  }

  for (const ext of localExtensions) {
    const indexPath = resolvePath(basePath, `index${ext}`)
    if (await pathExists(indexPath)) return pathToFileURL(indexPath).href
  }

  return null
}

async function tryResolveWorkspacePackageSource(
  specifier: string,
  packageName: string,
  packageRootRelativeToLoader: string,
  sourceRoot = '',
): Promise<string | null> {
  const specifierPath = specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier
  const normalizedSpecifier =
    specifier === packageName || specifier.startsWith(`${packageName}/`)
      ? specifier
      : specifierPath.includes(`/node_modules/${packageName}/`)
        ? specifierPath.slice(specifierPath.indexOf(packageName))
        : specifierPath.endsWith(`/node_modules/${packageName}`)
          ? packageName
          : null

  if (normalizedSpecifier === packageName) {
    const indexTs = new URL(
      `${packageRootRelativeToLoader}${sourceRoot}/index.ts`,
      import.meta.url,
    )
    if (await fileExists(fileURLToPath(indexTs))) return indexTs.href
    return null
  }

  if (!normalizedSpecifier?.startsWith(`${packageName}/`)) return null

  const subpath = normalizedSpecifier.slice(`${packageName}/`.length)
  const directTs = new URL(
    `${packageRootRelativeToLoader}${sourceRoot}/${subpath}.ts`,
    import.meta.url,
  )
  if (await fileExists(fileURLToPath(directTs))) return directTs.href

  const indexTs = new URL(
    `${packageRootRelativeToLoader}${sourceRoot}/${subpath}/index.ts`,
    import.meta.url,
  )
  if (await fileExists(fileURLToPath(indexTs))) return indexTs.href

  return null
}

type ResolveContext = {
  parentURL?: string
}

type ResolveResult = {
  shortCircuit?: boolean
  url: string
}

type LoadContext = {
  format?: string
}

type LoadResult = {
  format: string
  source: string | ArrayBuffer | Uint8Array
  shortCircuit?: boolean
}

type DefaultLoad = (url: string, context: LoadContext, nextLoad: DefaultLoad) => Promise<LoadResult>

type DefaultResolve = (
  specifier: string,
  context: ResolveContext,
  nextResolve: DefaultResolve,
) => Promise<ResolveResult>

async function transpileTypeScriptModule(url: string): Promise<LoadResult> {
  const [{ default: ts }, source] = await Promise.all([
    import('typescript'),
    readFile(fileURLToPath(url), 'utf8'),
  ])

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
      verbatimModuleSyntax: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: fileURLToPath(url),
    reportDiagnostics: false,
  })

  return {
    format: 'module',
    shortCircuit: true,
    source: transpiled.outputText,
  }
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  defaultResolve: DefaultResolve,
): Promise<ResolveResult> {
  if (specifier.endsWith('?raw')) {
    const bare = specifier.slice(0, -'?raw'.length)
    if (bare.startsWith('./') || bare.startsWith('../')) {
      const resolved = await tryResolveRelative(bare, context.parentURL)
      if (resolved) {
        return {
          shortCircuit: true,
          url: `${resolved}?raw`,
        }
      }
    }
  }

  if (specifier === '@taskyon/taskyon') {
    return {
      shortCircuit: true,
      url: new URL('./shims/taskyon.ts', import.meta.url).href,
    }
  }

  if (
    specifier === '../modules/graph' ||
    specifier === '../../shared/modules/graph' ||
    specifier.endsWith('/modules/graph')
  ) {
    return {
      shortCircuit: true,
      url: new URL('./shims/graph.ts', import.meta.url).href,
    }
  }

  if (specifier === './modelicaLibraryCatalog' || specifier.endsWith('/modelicaLibraryCatalog')) {
    return {
      shortCircuit: true,
      url: new URL('./shims/modelicaLibraryCatalog.ts', import.meta.url).href,
    }
  }

  // Resolve source-package imports for workspace packages that export built
  // `dist/*` files in normal app usage, but run directly from TypeScript source
  // in the headless strip-types harness.
  const workspaceSourceUrl =
    (await tryResolveWorkspacePackageSource(specifier, '@taskyon/shared', '../../shared')) ??
    (await tryResolveWorkspacePackageSource(
      specifier,
      '@taskyon/p2p-core',
      '../../p2p-core',
      '/src',
    ))
  if (workspaceSourceUrl) {
    return {
      shortCircuit: true,
      url: workspaceSourceUrl,
    }
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const resolved = await tryResolveRelative(specifier, context.parentURL)
    if (resolved) {
      return {
        shortCircuit: true,
        url: resolved,
      }
    }
  }

  return defaultResolve(specifier, context, defaultResolve)
}

export async function load(
  url: string,
  context: LoadContext,
  defaultLoad: DefaultLoad,
): Promise<LoadResult> {
  const shouldTranspileWithTypeScript =
    url.startsWith('file:') &&
    url.endsWith('.ts') &&
    url.includes('/packages/taskyon/src/p2p/protobuf/')

  if (shouldTranspileWithTypeScript) {
    return await transpileTypeScriptModule(url)
  }

  if (url.endsWith('?raw')) {
    const fileUrl = url.slice(0, -'?raw'.length)
    const filePath = fileURLToPath(fileUrl)
    const text = await readFile(filePath, 'utf8')
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(text)};`,
    }
  }
  try {
    return await defaultLoad(url, context, defaultLoad)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isUnsupportedTypeScriptSyntax =
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' &&
      url.startsWith('file:') &&
      url.endsWith('.ts')

    if (isUnsupportedTypeScriptSyntax) {
      return await transpileTypeScriptModule(url)
    }

    if (message.includes('EISDIR')) {
      console.error('[ts-loader] EISDIR while loading url:', url)
    }
    throw error
  }
}
