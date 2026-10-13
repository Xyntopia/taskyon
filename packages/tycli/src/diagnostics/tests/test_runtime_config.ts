import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDiagnosticsRuntimeConfig } from '../runtimeConfig'

export const testDiagnosticsRuntimeConfigReplaysBrowserSettings = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostics-runtime-config-'))
  const path = join(dir, 'runtime-config.json')
  const config = {
    llmSettings: { entryFunction: 'browserFlow' },
    selectedToolchainProfile: 'browser',
    toolchainProfiles: {
      base: { browserFlow: { pinnedTools: ['storage'], reasoning_effort: 'low' } },
      profiles: {
        browser: {
          chatCompletion: {
            name: 'Synthetic provider',
            provider: 'openrouter.ai',
            model: 'synthetic/model',
            baseURL: 'https://example.invalid',
            routes: { chatCompletion: '/chat/completions', models: '/models' },
            streamSupport: true,
          },
        },
      },
    },
  }
  await writeFile(path, JSON.stringify(config))
  const loaded = await loadDiagnosticsRuntimeConfig(path)
  if (loaded.llmSettings.entryFunction !== 'browserFlow') throw new Error('Entry point changed')
  if (
    loaded.toolchainConfig.browserFlow?.reasoning_effort !== 'low' ||
    loaded.toolchainConfig.browserFlow?.pinnedTools?.[0] !== 'storage' ||
    loaded.provider !== 'openrouter.ai' ||
    loaded.model !== 'synthetic/model'
  ) {
    throw new Error('Browser toolchain settings were changed during replay')
  }
  for (const overrides of [{ provider: 'openai' }, { model: 'different/model' }]) {
    let rejected = false
    try {
      await loadDiagnosticsRuntimeConfig(path, overrides.provider, overrides.model)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Conflicting provider/model override was accepted')
  }
  await writeFile(path, JSON.stringify({ llmSettings: config.llmSettings }))
  let invalidRejected = false
  try {
    await loadDiagnosticsRuntimeConfig(path)
  } catch {
    invalidRejected = true
  }
  if (!invalidRejected) throw new Error('Incomplete runtime settings were accepted')
}

testDiagnosticsRuntimeConfigReplaysBrowserSettings.description =
  'Replays browser diagnostic settings without changing prompts or entry points and rejects conflicting overrides or incomplete configurations.'
