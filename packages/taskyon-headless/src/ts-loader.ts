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

  // Resolve extensionless `@taskyon/shared/*` imports under Node ESM
  // (which does not auto-resolve `.ts`). Try `<subpath>.ts` first,
  // then `<subpath>/index.ts` for directory imports. This is a
  // harness-only shim; the Quasar / tsup / Vite builds use their own
  // resolvers.
  //
  // `import.meta.url` is the URL of THIS file
  // (`packages/taskyon-headless/src/ts-loader.ts`). The relative
  // path from it to the shared package is `../../shared/...`
  // (src/ → taskyon-headless/ → packages/ → shared/).
  if (specifier.startsWith('@taskyon/shared/')) {
    const subpath = specifier.slice('@taskyon/shared/'.length)
    const directTs = new URL(`../../shared/${subpath}.ts`, import.meta.url)
    if (await fileExists(fileURLToPath(directTs))) {
      return { shortCircuit: true, url: directTs.href }
    }
    const indexTs = new URL(`../../shared/${subpath}/index.ts`, import.meta.url)
    if (await fileExists(fileURLToPath(indexTs))) {
      return { shortCircuit: true, url: indexTs.href }
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
    if (message.includes('EISDIR')) {
      console.error('[ts-loader] EISDIR while loading url:', url)
    }
    throw error
  }
}
