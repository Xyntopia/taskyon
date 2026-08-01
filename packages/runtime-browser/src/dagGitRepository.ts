import type { DagProjectedFile } from '@taskyon/comp-dag/dagGitProjection'
import { Buffer } from 'buffer'

export type BrowserDagGitAuthor = {
  name: string
  email: string
}

const normalizeRepositoryPath = (dir: string): string => {
  const normalized = `/${dir}`.replace(/\/+/g, '/').replace(/\/$/, '')
  if (
    normalized === '/' ||
    normalized.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Browser Git repository directory must be a safe non-root path.')
  }
  return normalized
}

const normalizeProjectedPath = (path: string): string => {
  const normalized = path.trim()
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('\\') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Browser Git projected file must use a safe relative path.')
  }
  return normalized
}

const ensureDirectory = async (
  fs: {
    mkdir: (path: string) => Promise<void>
  },
  path: string,
) => {
  const segments = path.split('/').filter(Boolean)
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    try {
      await fs.mkdir(current)
    } catch (error) {
      if (!(error instanceof Error) || !/exist/i.test(error.message)) throw error
    }
  }
}

export const createBrowserDagGitRepository = async (args: {
  databaseName: string
  directory?: string
}) => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Browser Git requires IndexedDB.')
  }
  const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  browserGlobal.Buffer ??= Buffer
  const [{ default: LightningFS }, git] = await Promise.all([
    import('@isomorphic-git/lightning-fs'),
    import('isomorphic-git'),
  ])
  const fs = new LightningFS(args.databaseName)
  const promises = fs.promises
  const dir = normalizeRepositoryPath(args.directory ?? 'taskyon-design')

  const init = async (defaultBranch = 'main') => {
    await ensureDirectory(promises, dir)
    try {
      await promises.stat(`${dir}/.git`)
    } catch {
      await git.init({ fs, dir, defaultBranch })
    }
  }

  const writeProjection = async (files: readonly DagProjectedFile[]) => {
    await init()
    const byDirectory = new Map<string, Set<string>>()
    for (const file of files) {
      const path = normalizeProjectedPath(file.path)
      const separator = path.lastIndexOf('/')
      const directory = separator === -1 ? '' : path.slice(0, separator)
      const name = separator === -1 ? path : path.slice(separator + 1)
      const names = byDirectory.get(directory) ?? new Set<string>()
      names.add(name)
      byDirectory.set(directory, names)
      await ensureDirectory(promises, `${dir}/${directory}`)
      await promises.writeFile(`${dir}/${path}`, file.content, 'utf8')
    }

    for (const directory of ['nodes', 'invocations', 'refs']) {
      const expected = byDirectory.get(directory) ?? new Set<string>()
      let existing: string[]
      try {
        existing = await promises.readdir(`${dir}/${directory}`)
      } catch {
        continue
      }
      for (const name of existing) {
        if (!expected.has(name)) await promises.unlink(`${dir}/${directory}/${name}`)
      }
    }
    await promises.flush()
  }

  const commit = async (args: {
    message: string
    author: BrowserDagGitAuthor
  }): Promise<string> => {
    await init()
    const matrix = await git.statusMatrix({ fs, dir })
    for (const [filepath, head, workdir, stage] of matrix) {
      if (head === workdir && workdir === stage) continue
      if (workdir === 0) await git.remove({ fs, dir, filepath })
      else await git.add({ fs, dir, filepath })
    }
    return await git.commit({
      fs,
      dir,
      message: args.message,
      author: args.author,
    })
  }

  return {
    init,
    writeProjection,
    commit,
    branch: async (name: string, checkout = false) => {
      await init()
      await git.branch({ fs, dir, ref: name, checkout })
    },
    checkout: async (ref: string) => {
      await init()
      await git.checkout({ fs, dir, ref })
    },
    recover: async (ref = 'HEAD') => {
      await init()
      await git.checkout({ fs, dir, ref, force: true })
    },
    status: async () => {
      await init()
      return await git.statusMatrix({ fs, dir })
    },
    readText: async (path: string) =>
      await promises.readFile(`${dir}/${normalizeProjectedPath(path)}`, 'utf8'),
  }
}
