import { access, readFile, stat } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const localExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs']

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isFilePath(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function tryResolveFile(basePath: string): Promise<string | null> {
  if ((await pathExists(basePath)) && (await isFilePath(basePath))) {
    return pathToFileURL(basePath).href
  }

  for (const ext of localExtensions) {
    if ((await pathExists(basePath + ext)) && (await isFilePath(basePath + ext))) {
      return pathToFileURL(basePath + ext).href
    }
  }

  for (const ext of localExtensions) {
    const indexPath = resolvePath(basePath, `index${ext}`)
    if ((await pathExists(indexPath)) && (await isFilePath(indexPath))) {
      return pathToFileURL(indexPath).href
    }
  }

  return null
}

async function tryResolveRelative(specifier: string, parentURL?: string): Promise<string | null> {
  if (!parentURL?.startsWith('file:')) return null
  const parentPath = dirname(fileURLToPath(parentURL))
  if (specifier.endsWith('?raw') || specifier.endsWith('?url')) {
    const query = specifier.endsWith('?raw') ? '?raw' : '?url'
    const rawPath = specifier.slice(0, -query.length)
    const resolved = await tryResolveFile(resolvePath(parentPath, rawPath))
    return resolved ? `${resolved}${query}` : null
  }
  return tryResolveFile(resolvePath(parentPath, specifier))
}

async function tryResolvePackageAsset(specifier: string): Promise<string | null> {
  if (!specifier.endsWith('?url')) return null

  const assetPath = specifier.slice(0, -'?url'.length)
  const parts = assetPath.split('/')
  const packageName = assetPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const subpath = assetPath.startsWith('@') ? parts.slice(2) : parts.slice(1)
  if (!packageName || subpath.length === 0) return null

  return tryResolveFile(resolvePath(repoRoot, 'node_modules', packageName, ...subpath))
}

async function tryResolveWorkspaceAlias(specifier: string): Promise<string | null> {
  if (specifier === '@taskyon/taskyon') {
    return pathToFileURL(resolvePath(repoRoot, 'packages/taskyon/src/tycli.ts')).href
  }

  if (specifier === '@taskyon/p2p-core') {
    return pathToFileURL(resolvePath(repoRoot, 'packages/p2p-core/src/index.ts')).href
  }

  if (specifier === '@taskyon/taskyon/api') {
    return pathToFileURL(resolvePath(repoRoot, 'packages/taskyon/src/api/index.ts')).href
  }

  if (specifier.startsWith('@taskyon/taskyon/')) {
    const rest = specifier.slice('@taskyon/taskyon/'.length)
    return tryResolveFile(resolvePath(repoRoot, 'packages/taskyon/src', rest))
  }

  const sourcePackagePrefixes = [
    ['@taskyon/common/', 'packages/common/'],
    ['@taskyon/comp-dag/', 'packages/comp-dag/'],
    ['@taskyon/modelica/', 'packages/modelica/'],
    ['@taskyon/spaceships/', 'packages/spaceships/'],
    ['@taskyon/surrogate/', 'packages/surrogate/'],
    ['@taskyon/ui/', 'packages/ui/'],
  ] as const

  for (const [prefix, packagePath] of sourcePackagePrefixes) {
    if (specifier.startsWith(prefix)) {
      const rest = specifier.slice(prefix.length)
      return tryResolveFile(resolvePath(repoRoot, packagePath, rest))
    }
  }

  if (specifier.startsWith('@taskyon/p2p-core/')) {
    const rest = specifier.slice('@taskyon/p2p-core/'.length)
    return tryResolveFile(resolvePath(repoRoot, 'packages/p2p-core/src', rest))
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

type DefaultResolve = (
  specifier: string,
  context: ResolveContext,
  nextResolve: DefaultResolve,
) => Promise<ResolveResult>

type LoadContext = {
  format?: string
}

type LoadResult = {
  format: 'module'
  shortCircuit?: boolean
  source: string
}

type DefaultLoad = (url: string, context: LoadContext, nextLoad: DefaultLoad) => Promise<LoadResult>

export async function resolve(
  specifier: string,
  context: ResolveContext,
  defaultResolve: DefaultResolve,
): Promise<ResolveResult> {
  const packageAsset = await tryResolvePackageAsset(specifier)
  if (packageAsset) {
    return {
      shortCircuit: true,
      url: `${packageAsset}?url`,
    }
  }

  const aliased = await tryResolveWorkspaceAlias(specifier)
  if (aliased) {
    return {
      shortCircuit: true,
      url: aliased,
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
  const parsed = new URL(url)
  if (parsed.protocol === 'file:' && parsed.search === '?raw') {
    parsed.search = ''
    const source = await readFile(fileURLToPath(parsed), 'utf8')
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};\n`,
    }
  }

  if (parsed.protocol === 'file:' && parsed.search === '?url') {
    parsed.search = ''
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(parsed.href)};\n`,
    }
  }

  return defaultLoad(url, context, defaultLoad)
}
