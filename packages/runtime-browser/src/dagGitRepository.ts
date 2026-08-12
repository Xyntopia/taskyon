import {
  DESIGN_GRAPH_GIT_DIRECTORIES,
  synchronizeDesignGraphRepository,
  type DagProjectedFile,
  type DesignGraphSnapshotSelector,
} from '@taskyon/comp-dag/dagGitProjection'
import {
  createStorageDesignGraphObjectStore,
  type DesignGraphStorageClient,
} from '@taskyon/comp-dag/designGraphRepository'
import { Buffer } from 'buffer'

export type BrowserDagGitAuthor = {
  name: string
  email: string
}

export type BrowserDagGitCredentials = { username: string; password: string }

export type BrowserDesignGraphGitSettings = {
  remoteUrl: string
  branch: string
  authorName: string
  authorEmail: string
  commitMessage: string
  corsProxy: string
}

export const clearBrowserDesignGraphGitRepositories = async () => {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return 0
  const names = (await indexedDB.databases()).flatMap(({ name }) =>
    name?.startsWith('taskyon-design-git-') ? [name] : [],
  )
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error ?? new Error(`Could not delete ${name}.`))
          request.onblocked = () => resolve()
        }),
    ),
  )
  return names.length
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
  remoteUrl?: string
  corsProxy?: string
  credentials?: () => Promise<BrowserDagGitCredentials>
}) => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Browser Git requires IndexedDB.')
  }
  const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  browserGlobal.Buffer ??= Buffer
  const [{ default: LightningFS }, git, { default: http }] = await Promise.all([
    import('@isomorphic-git/lightning-fs'),
    import('isomorphic-git'),
    import('isomorphic-git/http/web'),
  ])
  const fs = new LightningFS(args.databaseName)
  const promises = fs.promises
  const dir = normalizeRepositoryPath(args.directory ?? 'taskyon-design')

  const listFiles = async (directory: string): Promise<string[]> => {
    const names = await promises.readdir(`${dir}/${directory}`).catch(() => [])
    const files: string[] = []
    for (const name of names) {
      const path = `${directory}/${name}`
      const stat = await promises.stat(`${dir}/${path}`)
      if (stat.isDirectory()) files.push(...(await listFiles(path)))
      else if (stat.isFile()) files.push(path)
    }
    return files
  }

  const listProjectionPaths = async () => {
    const nested = (
      await Promise.all(
        DESIGN_GRAPH_GIT_DIRECTORIES.map(async (directory) => await listFiles(directory)),
      )
    ).flat()
    try {
      await promises.stat(`${dir}/runtime-requirements.json`)
      nested.push('runtime-requirements.json')
    } catch {
      // Runtime requirements are optional.
    }
    return nested.sort()
  }

  const init = async (defaultBranch = 'main') => {
    await ensureDirectory(promises, dir)
    try {
      await promises.stat(`${dir}/.git`)
    } catch {
      await git.init({ fs, dir, defaultBranch })
    }
  }

  const writeProjection = async (files: readonly DagProjectedFile[], branch = 'main') => {
    await init(branch)
    const branchExists = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` }).then(
      () => true,
      () => false,
    )
    if (branchExists) await git.checkout({ fs, dir, ref: branch })
    else if (await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null)) {
      await git.branch({ fs, dir, ref: branch, checkout: true })
    }
    for (const file of files) {
      const path = normalizeProjectedPath(file.path)
      const separator = path.lastIndexOf('/')
      const directory = separator === -1 ? '' : path.slice(0, separator)
      await ensureDirectory(promises, `${dir}/${directory}`)
      await promises.writeFile(`${dir}/${path}`, file.content, 'utf8')
    }

    const expectedPaths = new Set(files.map(({ path }) => normalizeProjectedPath(path)))
    for (const path of await listProjectionPaths()) {
      if (!expectedPaths.has(path)) await promises.unlink(`${dir}/${path}`)
    }
    await promises.flush()
  }

  const commit = async (args: {
    message: string
    author: BrowserDagGitAuthor
  }): Promise<string> => {
    await init()
    const matrix = await git.statusMatrix({ fs, dir })
    const changed = matrix.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage)
    if (!changed) {
      return await git.resolveRef({ fs, dir, ref: 'HEAD' })
    }
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

  const readText = async (path: string) => {
    const normalized = normalizeProjectedPath(path)
    return await promises.readFile(`${dir}/${normalized}`, 'utf8')
  }

  const authentication = args.credentials ? { onAuth: async () => await args.credentials!() } : {}

  const configureRemote = async (url = args.remoteUrl) => {
    if (!url) throw new Error('Browser Git remote URL is not configured.')
    await init()
    await git.addRemote({ fs, dir, remote: 'origin', url, force: true })
    return url
  }

  const fetchRemote = async (branch = 'main') => {
    const url = await configureRemote()
    const refs = await git.listServerRefs({
      http,
      url,
      prefix: `refs/heads/${branch}`,
      ...(args.corsProxy ? { corsProxy: args.corsProxy } : {}),
      ...authentication,
    })
    if (!refs.some(({ ref }) => ref === `refs/heads/${branch}`)) return false
    await git.fetch({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: branch,
      singleBranch: true,
      ...(args.corsProxy ? { corsProxy: args.corsProxy } : {}),
      ...authentication,
    })
    return true
  }

  const resolveOptionalRef = async (ref: string) =>
    await git.resolveRef({ fs, dir, ref }).catch(() => null)

  const synchronize = async (branch = 'main') => {
    const remoteExists = await fetchRemote(branch)
    if (!remoteExists) {
      await git.push({
        fs,
        http,
        dir,
        remote: 'origin',
        ref: branch,
        ...(args.corsProxy ? { corsProxy: args.corsProxy } : {}),
        ...authentication,
      })
      const oid = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` })
      return { status: 'pushed' as const, oid }
    }
    const localRef = `refs/heads/${branch}`
    const remoteRef = `refs/remotes/origin/${branch}`
    const local = await resolveOptionalRef(localRef)
    const remote = await resolveOptionalRef(remoteRef)
    if (!remote) throw new Error(`Remote Git branch not found: ${branch}`)
    if (!local) {
      await git.writeRef({ fs, dir, ref: localRef, value: remote, force: true })
      await git.checkout({ fs, dir, ref: branch, force: true })
      return { status: 'pulled' as const, oid: remote }
    }
    if (local === remote) return { status: 'unchanged' as const, oid: local }
    if (await git.isDescendent({ fs, dir, oid: remote, ancestor: local })) {
      await git.writeRef({ fs, dir, ref: localRef, value: remote, force: true })
      await git.checkout({ fs, dir, ref: branch, force: true })
      return { status: 'pulled' as const, oid: remote }
    }
    if (await git.isDescendent({ fs, dir, oid: local, ancestor: remote })) {
      await configureRemote()
      await git.push({
        fs,
        http,
        dir,
        remote: 'origin',
        ref: branch,
        ...(args.corsProxy ? { corsProxy: args.corsProxy } : {}),
        ...authentication,
      })
      return { status: 'pushed' as const, oid: local }
    }
    return { status: 'conflict' as const, local, remote }
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
    readProjection: async () =>
      await Promise.all(
        (await listProjectionPaths()).map(async (path) => ({
          path,
          content: await promises.readFile(`${dir}/${path}`, 'utf8'),
        })),
      ),
    readText,
    configureRemote,
    fetchRemote,
    synchronize,
  }
}

export const synchronizeBrowserDesignGraph = async (args: {
  storageClient: DesignGraphStorageClient
  selector: DesignGraphSnapshotSelector
  settings: BrowserDesignGraphGitSettings
  credentials?: BrowserDagGitCredentials
}) => {
  const identity = JSON.stringify({ remoteUrl: args.settings.remoteUrl, selector: args.selector })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  const databaseName = `taskyon-design-git-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
  const credentials = args.credentials
  const synchronizer = await createBrowserDagGitRepository({
    databaseName,
    remoteUrl: args.settings.remoteUrl,
    ...(args.settings.corsProxy.trim() ? { corsProxy: args.settings.corsProxy.trim() } : {}),
    ...(credentials ? { credentials: () => Promise.resolve(credentials) } : {}),
  })
  return await synchronizeDesignGraphRepository({
    store: createStorageDesignGraphObjectStore(args.storageClient),
    selector: args.selector,
    synchronizer,
    branch: args.settings.branch,
    commit: {
      message: args.settings.commitMessage,
      author: { name: args.settings.authorName, email: args.settings.authorEmail },
    },
  })
}
