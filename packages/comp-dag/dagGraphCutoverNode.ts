import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { convertDesignGraphProjection } from './dagGraphCutover.ts'
import { DESIGN_GRAPH_GIT_DIRECTORIES } from './dagGitProjection.ts'

/** Explicit command IO; normal browser loading never imports this module. */
export const convertGraphDirectory = async (args: {
  directory: string
  backupDirectory: string
  sourceDirectory?: string
}) => {
  const sourceDirectory = args.sourceDirectory ?? args.directory
  const files = await Promise.all(
    (await readdir(sourceDirectory, { recursive: true }))
      .filter(
        (path) =>
          /\.(ts|json)$/.test(path) &&
          DESIGN_GRAPH_GIT_DIRECTORIES.some((directory) => path.startsWith(`${directory}/`)),
      )
      .map(async (path) => ({
        path,
        content: await readFile(resolve(sourceDirectory, path), 'utf8'),
      })),
  )
  const converted = await convertDesignGraphProjection(files)
  for (const file of files) {
    const path = resolve(args.backupDirectory, file.path)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    try {
      await writeFile(path, file.content, { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
        (await readFile(path, 'utf8')) !== file.content
      )
        throw error
    }
  }
  for (const file of converted) {
    const path = resolve(args.directory, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.content)
  }
  const retained = new Set(converted.map((file) => file.path))
  for (const file of files)
    if (!retained.has(file.path)) await rm(resolve(args.directory, file.path), { force: true })
  await writeFile(
    resolve(args.directory, 'repository-index.json'),
    `${JSON.stringify([...retained].sort(), null, 2)}\n`,
  )
  return converted.length
}
