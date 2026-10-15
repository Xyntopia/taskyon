import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { exportDesignGraphSources } from '../packages/comp-dag/designGraphSourceExport.ts'
import { compileDesignGraphSources } from '../packages/comp-dag/designGraphSources.ts'

const root = resolve('public/design-repositories')
const names = process.argv.length > 2 ? process.argv.slice(2) : await readdir(root)
for (const name of names) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid bundled repository name.')
  const directory = resolve(root, name)
  const files = await Promise.all(
    (await readdir(directory, { recursive: true }))
      .filter(
        (path) =>
          /\.(ts|json)$/.test(path) && !['repository-index.json', 'taskyon.json'].includes(path),
      )
      .map(async (path) => ({ path, content: await readFile(resolve(directory, path), 'utf8') })),
  )
  const sources = await exportDesignGraphSources(files)
  await compileDesignGraphSources(sources)
  const backup = resolve('.cache/graph-source-backups', name)
  await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
  await mkdir(backup, { mode: 0o700 })
  await cp(directory, backup, { recursive: true })
  for (const file of sources) {
    const path = resolve(directory, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.content)
  }
  const retained = new Set(sources.map((file) => file.path))
  for (const file of files) if (!retained.has(file.path)) await rm(resolve(directory, file.path))
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !['nodes', 'modules', 'imports', 'projects', 'assets'].includes(entry.name)
    )
      await rm(resolve(directory, entry.name), { recursive: true })
    else if (entry.name === 'repository-index.json') await rm(resolve(directory, entry.name))
  }
  console.log(
    `Converted ${name}: ${sources.length} source files; generated objects rebuild at boot.`,
  )
}
