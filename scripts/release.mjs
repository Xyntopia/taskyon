import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const releaseMetadataPaths = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
]

const absolutePath = (root, relativePath) => path.join(root, relativePath)

const readJson = (root, relativePath) =>
  JSON.parse(fs.readFileSync(absolutePath(root, relativePath), 'utf8'))

const readText = (root, relativePath) => fs.readFileSync(absolutePath(root, relativePath), 'utf8')

const writeText = (root, relativePath, value) =>
  fs.writeFileSync(absolutePath(root, relativePath), value, 'utf8')

const isValidIdentifierList = (value, rejectLeadingZeroNumbers = false) => {
  const identifiers = value.split('.')
  return identifiers.every(
    (identifier) =>
      /^[0-9A-Za-z-]+$/.test(identifier) &&
      (!rejectLeadingZeroNumbers ||
        !/^\d+$/.test(identifier) ||
        identifier === '0' ||
        !identifier.startsWith('0')),
  )
}

export const isValidVersion = (value) => {
  if (typeof value !== 'string') return false
  const [versionAndPrerelease, buildMetadata, ...extraParts] = value.split('+')
  if (extraParts.length || (buildMetadata !== undefined && !isValidIdentifierList(buildMetadata))) {
    return false
  }

  const prereleaseSeparator = versionAndPrerelease.indexOf('-')
  const coreVersion =
    prereleaseSeparator === -1
      ? versionAndPrerelease
      : versionAndPrerelease.slice(0, prereleaseSeparator)
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(coreVersion)) return false
  if (prereleaseSeparator === -1) return true

  return isValidIdentifierList(versionAndPrerelease.slice(prereleaseSeparator + 1), true)
}

const cargoPackageVersionPattern = (name) =>
  new RegExp(`^\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`, 'm')

export const collectConsistencyErrors = (root) => {
  const expected = readJson(root, 'package.json').version
  const tauriVersion = readJson(root, 'src-tauri/tauri.conf.json').version
  const cargoManifest = readText(root, 'src-tauri/Cargo.toml')
  const cargoLock = readText(root, 'src-tauri/Cargo.lock')
  const manifestVersion = cargoManifest.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]
  const lockedVersion = cargoLock.match(cargoPackageVersionPattern('app'))?.[1]
  const errors = []

  if (tauriVersion !== expected) {
    errors.push(`src-tauri/tauri.conf.json has version ${tauriVersion}, expected ${expected}`)
  }
  if (manifestVersion !== expected) {
    errors.push(
      `src-tauri/Cargo.toml has version ${manifestVersion ?? 'unknown'}, expected ${expected}`,
    )
  }
  if (lockedVersion !== expected) errors.push('src-tauri/Cargo.lock has a stale app version')
  return { expected, errors }
}

const replaceCargoPackageVersion = (source, expression, version, relativePath) => {
  const matches = [...source.matchAll(expression)]
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one app package version in ${relativePath}.`)
  }
  return source.replace(expression, `$1${version}$2`)
}

export const updateReleaseMetadata = (root, version) => {
  if (!isValidVersion(version)) throw new Error(`Invalid semantic version: ${version}`)

  const packageJson = { ...readJson(root, 'package.json'), version }
  const tauriConfig = { ...readJson(root, 'src-tauri/tauri.conf.json'), version }
  const cargoManifest = readText(root, 'src-tauri/Cargo.toml')
  const cargoLock = readText(root, 'src-tauri/Cargo.lock')

  const updatedCargoManifest = replaceCargoPackageVersion(
    cargoManifest,
    /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(".*)$/gm,
    version,
    'src-tauri/Cargo.toml',
  )
  const updatedCargoLock = replaceCargoPackageVersion(
    cargoLock,
    /(^\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]+(".*$)/gm,
    version,
    'src-tauri/Cargo.lock',
  )

  writeText(root, 'package.json', `${JSON.stringify(packageJson, null, 2)}\n`)
  writeText(root, 'src-tauri/tauri.conf.json', `${JSON.stringify(tauriConfig, null, 2)}\n`)
  writeText(root, 'src-tauri/Cargo.toml', updatedCargoManifest)
  writeText(root, 'src-tauri/Cargo.lock', updatedCargoLock)
}

const gitOutput = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`,
    )
  }
  return result.stdout.trim()
}

const assertTrackedWorktreeClean = (root) => {
  const changes = gitOutput(root, ['status', '--porcelain', '--untracked-files=no'])
  if (changes) throw new Error(`Commit tracked changes before preparing a release:\n${changes}`)
}

const assertTagAvailable = (root, version) => {
  const tag = `v${version}`
  if (gitOutput(root, ['tag', '--list', tag]) === tag)
    throw new Error(`Git tag ${tag} already exists.`)
}

const latestTag = (root) =>
  gitOutput(root, ['tag', '--list', '--sort=-creatordate'])
    .split('\n')
    .find((tag) => isValidVersion(tag.replace(/^v/, ''))) ?? 'none'

const promptForVersion = async (root) => {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(`Current application version: ${readJson(root, 'package.json').version}`)
    console.log(`Latest local version-like tag: ${latestTag(root)}`)
    return (await terminal.question('New version (for example 0.6.0-rc.1): ')).trim()
  } finally {
    terminal.close()
  }
}

const confirm = async (version) => {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (
      await terminal.question(
        `Prepare release ${version}, create a local commit, and tag it v${version}? [y/N] `,
      )
    )
      .trim()
      .toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    terminal.close()
  }
}

const parseArguments = (args) => {
  const flags = new Set(args.filter((arg) => arg.startsWith('--')))
  const versions = args.filter((arg) => !arg.startsWith('--'))
  if (versions.length > 1 || [...flags].some((flag) => !['--check', '--dry-run'].includes(flag))) {
    throw new Error('Usage: yarn release [version] [--dry-run | --check]')
  }
  if (flags.has('--check') && (flags.has('--dry-run') || versions.length > 0)) {
    throw new Error('--check cannot be combined with a version or --dry-run.')
  }
  return { check: flags.has('--check'), dryRun: flags.has('--dry-run'), version: versions[0] }
}

const commitRelease = (root, version) => {
  const tag = `v${version}`
  gitOutput(root, ['add', '--', ...releaseMetadataPaths])
  gitOutput(root, ['commit', '-m', `chore: prepare release ${tag}`])
  gitOutput(root, ['tag', '-a', tag, '-m', `Release ${tag}`])
  const branch = gitOutput(root, ['branch', '--show-current'])
  console.log(`Release commit and tag created locally: ${tag}`)
  console.log('Push the release commit and tag when ready:')
  console.log(`  git push origin${branch ? ` ${branch}` : ''} ${tag}`)
}

const main = async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const options = parseArguments(process.argv.slice(2))
  if (options.check) {
    const { expected, errors } = collectConsistencyErrors(root)
    if (errors.length)
      throw new Error(`Release metadata is inconsistent:\n- ${errors.join('\n- ')}`)
    console.log(`Release metadata is consistent at version ${expected}.`)
    return
  }

  const current = readJson(root, 'package.json').version
  const version = options.version ?? (await promptForVersion(root))
  if (!isValidVersion(version))
    throw new Error(`Invalid version: ${version}. Use semantic versioning.`)
  if (version === current) throw new Error(`Version ${version} is already current.`)
  assertTagAvailable(root, version)
  if (options.dryRun) {
    console.log(`Would update release metadata from ${current} to ${version}.`)
    return
  }

  assertTrackedWorktreeClean(root)
  if (!(await confirm(version))) {
    console.log('Release preparation cancelled.')
    return
  }
  updateReleaseMetadata(root, version)
  const consistency = collectConsistencyErrors(root)
  if (consistency.errors.length) {
    throw new Error(`Release metadata update failed:\n- ${consistency.errors.join('\n- ')}`)
  }
  commitRelease(root, version)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
