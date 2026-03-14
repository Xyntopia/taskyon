import { access } from 'node:fs/promises'
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

async function tryResolveRelative(
  specifier: string,
  parentURL?: string,
): Promise<string | null> {
  if (!parentURL?.startsWith('file:')) return null
  const parentPath = dirname(fileURLToPath(parentURL))
  const basePath = resolvePath(parentPath, specifier)

  if (await pathExists(basePath)) return pathToFileURL(basePath).href

  for (const ext of localExtensions) {
    if (await pathExists(basePath + ext)) return pathToFileURL(basePath + ext).href
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
  if (specifier === '@taskyon/taskyon') {
    return {
      shortCircuit: true,
      url: new URL('./shims/taskyon.ts', import.meta.url).href,
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
