import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  DagProjectedFile,
  DesignGraphGitSynchronizer,
  DesignGraphGitSyncResult,
} from '@taskyon/comp-dag/dagGitProjection'
import { DESIGN_GRAPH_GIT_DIRECTORIES } from '@taskyon/comp-dag/dagGitProjection'

const execute = promisify(execFile)

const safeProjectedPath = (path: string) => {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid design graph projected path: ${path}`)
  }
  return path
}

export const createNodeDesignGraphGitSynchronizer = async (args: {
  directory: string
  remoteUrl?: string
  gitEnvironment?: NodeJS.ProcessEnv
}): Promise<DesignGraphGitSynchronizer> => {
  const directory = resolve(args.directory)
  const git = async (...command: string[]) =>
    (
      await execute('git', ['-C', directory, ...command], { env: args.gitEnvironment })
    ).stdout.trim()
  await mkdir(directory, { recursive: true })
  await git('init', '-b', 'main').catch(async () => await git('init'))
  if (args.remoteUrl) {
    const remotes = await git('remote')
    await git(
      'remote',
      remotes.split('\n').includes('origin') ? 'set-url' : 'add',
      'origin',
      args.remoteUrl,
    )
  }

  const writeProjection = async (files: readonly DagProjectedFile[], branch = 'main') => {
    const currentBranch = await git('symbolic-ref', '--short', 'HEAD').catch(() => '')
    if (currentBranch !== branch) {
      const branchExists = await git('show-ref', '--verify', `refs/heads/${branch}`).then(
        () => true,
        () => false,
      )
      if (branchExists) await git('checkout', branch)
      else await git('checkout', '-b', branch)
    }
    const expected = new Set(files.map(({ path }) => safeProjectedPath(path)))
    for (const file of files) {
      const path = resolve(directory, safeProjectedPath(file.path))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, file.content, 'utf8')
    }
    for (const managed of DESIGN_GRAPH_GIT_DIRECTORIES) {
      const root = resolve(directory, managed)
      const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const path = resolve(entry.parentPath, entry.name)
        const projectedPath = relative(directory, path).replace(/\\/g, '/')
        if (!expected.has(projectedPath)) await unlink(path)
      }
    }
  }

  const synchronize = async (branch = 'main'): Promise<DesignGraphGitSyncResult> => {
    if (!args.remoteUrl) throw new Error('Node Git remote URL is not configured.')
    const remoteExists = Boolean(await git('ls-remote', '--heads', 'origin', branch))
    if (!remoteExists) {
      await git('push', '--set-upstream', 'origin', `${branch}:${branch}`)
      return { status: 'pushed', oid: await git('rev-parse', `refs/heads/${branch}`) }
    }
    await git('fetch', 'origin', branch)
    const local = await git('rev-parse', `refs/heads/${branch}`).catch(() => '')
    const remote = await git('rev-parse', `refs/remotes/origin/${branch}`)
    if (!local) {
      await git('checkout', '-B', branch, remote)
      return { status: 'pulled', oid: remote }
    }
    if (local === remote) return { status: 'unchanged', oid: local }
    const isAncestor = async (ancestor: string, child: string) =>
      await execute('git', ['-C', directory, 'merge-base', '--is-ancestor', ancestor, child], {
        env: args.gitEnvironment,
      }).then(
        () => true,
        () => false,
      )
    if (await isAncestor(local, remote)) {
      await git('checkout', '-B', branch, remote)
      return { status: 'pulled', oid: remote }
    }
    if (await isAncestor(remote, local)) {
      await git('push', 'origin', `${branch}:${branch}`)
      return { status: 'pushed', oid: local }
    }
    return { status: 'conflict', local, remote }
  }

  return {
    writeProjection,
    commit: async ({ message, author }) => {
      await git('add', '--all')
      const hasChanges = await execute('git', ['-C', directory, 'diff', '--cached', '--quiet'], {
        env: args.gitEnvironment,
      }).then(
        () => false,
        () => true,
      )
      if (!hasChanges) return await git('rev-parse', 'HEAD')
      return await git(
        '-c',
        `user.name=${author.name}`,
        '-c',
        `user.email=${author.email}`,
        'commit',
        '-m',
        message,
      ).then(async () => await git('rev-parse', 'HEAD'))
    },
    synchronize,
    readProjection: async () => {
      const paths = (
        await Promise.all(
          DESIGN_GRAPH_GIT_DIRECTORIES.map(async (managed) => {
            const root = resolve(directory, managed)
            const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(
              () => [],
            )
            return entries
              .filter((entry) => entry.isFile())
              .map((entry) =>
                relative(directory, resolve(entry.parentPath, entry.name)).replace(/\\/g, '/'),
              )
          }),
        )
      ).flat()
      const runtimeRequirements = resolve(directory, 'runtime-requirements.json')
      await readFile(runtimeRequirements, 'utf8').then(
        () => paths.push('runtime-requirements.json'),
        () => undefined,
      )
      paths.sort()
      return await Promise.all(
        paths.map(async (path) => ({
          path,
          content: await readFile(resolve(directory, path), 'utf8'),
        })),
      )
    },
  }
}
