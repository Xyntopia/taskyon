import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { updateDesignGraphSourceDirectoryLock } from '../packages/comp-dag/designGraphSourcesNode.ts'
import { parseDagRuntimePackageManifest } from '../packages/comp-dag/dagPackageArtifact.ts'

const args = process.argv.slice(2)
const packageIndex = args.indexOf('--packages')
const packagePath = packageIndex < 0 ? undefined : args[packageIndex + 1]
if (packageIndex >= 0 && !packagePath) throw new Error('--packages requires a manifest path.')
const packages = packagePath
  ? parseDagRuntimePackageManifest(JSON.parse(await readFile(packagePath, 'utf8'))).packages
  : {}
const directories =
  packageIndex < 0
    ? args
    : args.filter((_, index) => index !== packageIndex && index !== packageIndex + 1)
if (!directories.length) {
  const root = resolve('public/design-repositories')
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) directories.push(resolve(root, entry.name))
}
for (const directory of directories) {
  const changed = await updateDesignGraphSourceDirectoryLock(directory, packages)
  console.log(`${changed ? 'Updated' : 'Checked'} ${directory}/graph.lock.json`)
}
