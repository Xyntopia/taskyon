import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const outputArgument = process.argv[2]

if (!outputArgument) {
  throw new Error('Usage: yarn pack:integrations <output-directory>')
}

const outputDirectory = resolve(process.cwd(), outputArgument)
const stagingRoot = resolve(repositoryRoot, '.tmp/integration-packages')

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...(options.environment ?? {}) },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

const readPackage = async (path) => JSON.parse(await readFile(path, 'utf8'))

const writePackage = async (directory, manifest) => {
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`)
}

const stagePackage = async ({ name, manifest, sourceDirectory }) => {
  const directory = `${stagingRoot}/${name}`
  await writePackage(directory, manifest)
  await cp(sourceDirectory, `${directory}/dist`, { recursive: true })
  return directory
}

const listFiles = async (directory) =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = `${directory}/${entry.name}`
        return entry.isDirectory() ? await listFiles(path) : [path]
      }),
    )
  ).flat()

const finalizeWorkerAssets = async (directory) => {
  const workerNames = ['nlp.worker', 'pglite.worker']
  const javascriptFiles = (await listFiles(directory)).filter((path) => path.endsWith('.js'))
  const sources = await Promise.all(
    javascriptFiles.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
  )

  await Promise.all(
    sources.map(async ({ path, source }) => {
      const output = workerNames.reduce(
        (contents, name) => contents.replaceAll(`./${name}.ts`, `./${name}.js`),
        source,
      )
      if (output !== source) await writeFile(path, output)
    }),
  )

  await Promise.all(
    workerNames.map(async (name) => {
      if (!sources.some(({ source }) => source.includes(`./${name}.ts`))) {
        throw new Error(`Taskyon build did not reference ${name}.ts`)
      }
      await access(`${directory}/${name}.js`)
    }),
  )
}

const pack = async (directory, filename) => {
  const before = new Set(await readdir(outputDirectory))
  run('npm', ['pack', directory, '--pack-destination', outputDirectory])
  const after = await readdir(outputDirectory)
  const generated = after.find((candidate) => !before.has(candidate))
  if (!generated) throw new Error(`npm pack did not create an archive for ${directory}`)
  await rename(`${outputDirectory}/${generated}`, `${outputDirectory}/${filename}`)
}

const gitSha = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).stdout.trim()
const dirty = spawnSync('git', ['status', '--porcelain'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).stdout.trim()
const version = `0.6.0-dev.${gitSha}`

await rm(stagingRoot, { recursive: true, force: true })
await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

run('yarn', ['workspace', '@taskyon/p2p-core', 'build'])
run('yarn', ['exec', 'tsup', '--config', 'tsup.integration.config.ts'], {
  cwd: `${repositoryRoot}/packages/taskyon`,
  environment: { TASKYON_PACKAGE_OUT_DIR: `${stagingRoot}/taskyon-build` },
})
await finalizeWorkerAssets(`${stagingRoot}/taskyon-build`)
run('yarn', ['exec', 'tsup', '--config', 'tsup.integration.config.ts'], {
  cwd: `${repositoryRoot}/packages/runtime-browser`,
  environment: {
    TASKYON_RUNTIME_BROWSER_OUT_DIR: `${stagingRoot}/runtime-browser-build`,
  },
})
run('yarn', ['exec', 'tsup', '--config', 'tsup.config.ts'], {
  cwd: `${repositoryRoot}/packages/sdk`,
  environment: { TASKYON_SDK_OUT_DIR: `${stagingRoot}/sdk-build` },
})

const p2pSource = await readPackage(`${repositoryRoot}/packages/p2p-core/package.json`)
const taskyonSource = await readPackage(`${repositoryRoot}/packages/taskyon/package.json`)

const p2p = await stagePackage({
  name: 'p2p-core',
  sourceDirectory: `${repositoryRoot}/packages/p2p-core/dist`,
  manifest: {
    name: '@taskyon/p2p-core',
    version,
    type: 'module',
    sideEffects: false,
    main: './dist/index.cjs',
    module: './dist/index.js',
    exports: p2pSource.exports,
    dependencies: Object.fromEntries(
      Object.entries(p2pSource.dependencies).filter(([name]) => name !== '@taskyon/common'),
    ),
  },
})

const taskyon = await stagePackage({
  name: 'taskyon',
  sourceDirectory: `${stagingRoot}/taskyon-build`,
  manifest: {
    name: '@taskyon/taskyon',
    version,
    type: 'module',
    sideEffects: false,
    exports: {
      './api': { types: './dist/api.d.ts', import: './dist/api.js' },
      './chat': { types: './dist/chat.d.ts', import: './dist/chat.js' },
      './chat-ui': { types: './dist/chat-ui.d.ts', import: './dist/chat-ui.js' },
      './db': { types: './dist/db.d.ts', import: './dist/db.js' },
      './runtime-core': {
        types: './dist/runtimeCore.d.ts',
        import: './dist/runtimeCore.js',
      },
      './tools/entryNode': {
        types: './dist/entryNode.d.ts',
        import: './dist/entryNode.js',
      },
    },
    dependencies: {
      ...Object.fromEntries(
        Object.entries(taskyonSource.dependencies).filter(
          ([name]) =>
            name !== '@taskyon/common' &&
            name !== '@taskyon/comp-dag' &&
            name !== '@taskyon/p2p-core',
        ),
      ),
      '@taskyon/p2p-core': version,
    },
  },
})

const runtimeBrowser = await stagePackage({
  name: 'runtime-browser',
  sourceDirectory: `${stagingRoot}/runtime-browser-build`,
  manifest: {
    name: '@taskyon/runtime-browser',
    version,
    type: 'module',
    sideEffects: false,
    exports: {
      './core': { types: './dist/core.d.ts', import: './dist/core.js' },
      './crypto-session': {
        types: './dist/cryptoSession.d.ts',
        import: './dist/cryptoSession.js',
      },
    },
    dependencies: { '@taskyon/taskyon': version },
  },
})

const sdk = await stagePackage({
  name: 'sdk',
  sourceDirectory: `${stagingRoot}/sdk-build`,
  manifest: {
    name: '@taskyon/sdk',
    version,
    type: 'module',
    sideEffects: false,
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    dependencies: {
      '@taskyon/runtime-browser': version,
      '@taskyon/taskyon': version,
    },
  },
})

await pack(p2p, 'taskyon-p2p-core.tgz')
await pack(taskyon, 'taskyon-taskyon.tgz')
await pack(runtimeBrowser, 'taskyon-runtime-browser.tgz')
await pack(sdk, 'taskyon-sdk.tgz')

await writeFile(
  `${outputDirectory}/manifest.json`,
  `${JSON.stringify({ taskyonCommit: gitSha, version, dirty: Boolean(dirty) }, null, 2)}\n`,
)
