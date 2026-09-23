import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const readWorkspaceFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

void test('the open-source container builds the SPA and desktop targets without SSR', async () => {
  const dockerfile = await readWorkspaceFile('Dockerfile')
  const caching = await readWorkspaceFile('packages/taskyon/src/utils/caching.ts')
  const router = await readWorkspaceFile('src/router/index.ts')

  assert.match(dockerfile, / AS production\b/)
  assert.match(dockerfile, / AS tauri-builder\b/)
  assert.match(dockerfile, / AS tauri-headless-runtime\b/)
  assert.match(dockerfile, / AS export\b/)
  assert.doesNotMatch(dockerfile, / AS ssr-server\b/)
  assert.doesNotMatch(dockerfile, /quasar build -m ssr/)

  const productionBuilder = dockerfile.match(
    /FROM prepare AS production-builder([\s\S]*?)FROM prepare AS debug-builder/,
  )?.[1]
  assert.ok(productionBuilder)
  assert.match(productionBuilder, /yarn docs:check/)
  assert.match(productionBuilder, /yarn links:check/)
  assert.match(productionBuilder, /yarn build:app-dependencies[\s\S]*yarn pack:tyclient/)
  assert.match(productionBuilder, /yarn pack:tyclient/)
  assert.match(
    productionBuilder,
    /yarn lint[\s\S]*TASKYON_BUILD_CHECKS_COMPLETED=1 yarn quasar build/,
  )
  assert.doesNotMatch(productionBuilder, /\byarn build(?:\s|$)/)
  const debugBuilder = dockerfile.match(
    /FROM prepare AS debug-builder([\s\S]*?)FROM docker.io\/library\/nginx/,
  )?.[1]
  assert.ok(debugBuilder)
  assert.match(debugBuilder, /yarn build:app-dependencies[\s\S]*yarn lint/)
  assert.match(
    debugBuilder,
    /yarn lint[\s\S]*TASKYON_BUILD_CHECKS_COMPLETED=1 yarn quasar build --debug/,
  )
  assert.doesNotMatch(router, /createMemoryHistory|tyServerRoutes|MODE === 'ssr'/)
  assert.doesNotMatch(caching, /MODE === 'ssr'/)

  await assert.rejects(access(new URL('../src-ssr', import.meta.url)))
})

void test('public container commands consistently use Podman and the SPA target', async () => {
  const buildScript = await readWorkspaceFile('buildcontainer.sh')
  const relayScript = await readWorkspaceFile('buildrelaycontainer.sh')
  const packageJson = JSON.parse(await readWorkspaceFile('package.json'))
  const compose = await readWorkspaceFile('docker-compose.yml')

  assert.match(buildScript, /IMAGE_NAME="xyntopia\/taskyon"/)
  assert.match(buildScript, /BUILD_STAGE="production"/)
  assert.match(buildScript, /podman build/)
  assert.doesNotMatch(buildScript, /podman (?:login|push)/)
  assert.match(buildScript, /podman save .*GIT_HASH/)
  assert.doesNotMatch(buildScript, /\bdocker (?:build|tag|push)\b/)
  assert.match(relayScript, /podman build/)
  assert.doesNotMatch(relayScript, /\bdocker (?:build|tag|push)\b/)
  assert.match(packageJson.scripts['build:desktop'], /^podman build /)
  assert.match(packageJson.scripts['build:tauri:headless'], /^podman build /)
  assert.match(
    packageJson.scripts['build:app'],
    /yarn build:app-dependencies[\s\S]*yarn lint && TASKYON_BUILD_CHECKS_COMPLETED=1 yarn run quasar build/,
  )
  assert.match(
    packageJson.scripts.build,
    /yarn build:app-dependencies[\s\S]*yarn pack:tyclient[\s\S]*yarn lint && TASKYON_BUILD_CHECKS_COMPLETED=1 yarn run quasar build/,
  )
  assert.doesNotMatch(compose, /taskyon-server|target:\s*ssr-server/)
})
