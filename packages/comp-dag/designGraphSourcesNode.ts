import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  compileDesignGraphSourcesWithCache,
  updateDesignGraphSourceLock,
} from './designGraphSources.ts'
import type { DagProjectedFile } from './dagGitProjection.ts'
import { parseGraphSourceLock } from './designGraphSourceLock.ts'
import type { DagRuntimePackageManifest } from './dagPackageArtifact.ts'

export const readDesignGraphSourceDirectory = async (
  directory: string,
): Promise<DagProjectedFile[]> => {
  const paths = (await readdir(directory, { recursive: true }))
    .filter(
      (path) =>
        path === 'graph.lock.json' ||
        (/^(nodes|modules|imports|projects|assets)\//.test(path) && /\.(ts|json|md)$/.test(path)),
    )
    .sort()
  return await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(resolve(directory, path), 'utf8'),
    })),
  )
}

/** This cache contains only an offline compilation of checked-in source, never saved user data. */
export const loadCachedDesignGraphSources = async (
  files: readonly DagProjectedFile[],
  cacheDirectory: string,
): Promise<DagProjectedFile[]> => {
  const directory = join(cacheDirectory, 'graph-bundles')
  return await compileDesignGraphSourcesWithCache(files, {
    get: async (sourceHash) => {
      const path = join(directory, `${sourceHash.replace(':', '_')}.json`)
      try {
        return JSON.parse(await readFile(path, 'utf8')) as unknown
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        )
          return undefined
        throw error
      }
    },
    set: async (sourceHash, entry) => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const path = join(directory, `${sourceHash.replace(':', '_')}.json`)
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(entry), { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
    },
  })
}

export const updateDesignGraphSourceDirectoryLock = async (
  directory: string,
  packages: DagRuntimePackageManifest['packages'] = {},
) => {
  const sources = await readDesignGraphSourceDirectory(directory)
  const files = await updateDesignGraphSourceLock(sources, packages)
  const lock = files.find((file) => file.path === 'graph.lock.json')!
  const previous = sources.find((file) => file.path === lock.path)
  if (previous) {
    try {
      if (
        parseGraphSourceLock(JSON.parse(previous.content)).id ===
        parseGraphSourceLock(JSON.parse(lock.content)).id
      )
        return false
    } catch {
      // An explicit update may repair a malformed or unsupported lock.
    }
  }
  await writeFile(join(directory, lock.path), lock.content, 'utf8')
  return true
}
