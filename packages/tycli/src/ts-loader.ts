import { access, stat } from 'node:fs/promises'
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
  return tryResolveFile(resolvePath(parentPath, specifier))
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

export async function resolve(
  specifier: string,
  context: ResolveContext,
  defaultResolve: DefaultResolve,
): Promise<ResolveResult> {
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
