import { join } from 'node:path'
import { resolveKeyForProvider, resolveProviderSelection } from '../../cli/config'
import { resolveCliStoragePaths } from '../../cli/storagePaths'

const assertEqual = (actual: string, expected: string, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`)
  }
}

export const testCliStoragePathsUseApplicationNamespace = () => {
  const paths = resolveCliStoragePaths({
    applicationName: 'host-cli',
    environmentPrefix: 'HOST_CLI',
    homeDir: '/home/tester',
    tempDir: '/tmp',
    environment: {},
  })

  assertEqual(paths.configDir, '/home/tester/.config/host-cli', 'config directory')
  assertEqual(paths.dataDir, '/home/tester/.local/share/host-cli', 'data directory')
  assertEqual(paths.cacheDir, '/home/tester/.cache/host-cli', 'cache directory')
  assertEqual(paths.stateDir, '/home/tester/.local/state/host-cli', 'state directory')
  assertEqual(paths.authDir, '/home/tester/.config/host-cli/auth', 'auth directory')
  assertEqual(paths.logDir, '/home/tester/.local/state/host-cli/logs', 'log directory')
}

testCliStoragePathsUseApplicationNamespace.description =
  'Verifies interactive CLI storage defaults are isolated under the configured application namespace.'

export const testCliStoragePathsHonorRootAndCategoryOverrides = () => {
  const paths = resolveCliStoragePaths({
    applicationName: 'host-cli',
    environmentPrefix: 'HOST_CLI',
    homeDir: '/home/tester',
    tempDir: '/tmp',
    environment: {
      HOST_CLI_HOME: '/srv/host-cli',
      HOST_CLI_CACHE_DIR: '/var/cache/host-cli',
      HOST_CLI_STATE_DIR: '/var/lib/host-cli-state',
    },
  })

  assertEqual(paths.configDir, join('/srv/host-cli', 'config'), 'root config directory')
  assertEqual(paths.dataDir, join('/srv/host-cli', 'data'), 'root data directory')
  assertEqual(paths.cacheDir, '/var/cache/host-cli', 'overridden cache directory')
  assertEqual(paths.stateDir, '/var/lib/host-cli-state', 'overridden state directory')
  assertEqual(paths.authDir, join('/srv/host-cli', 'config', 'auth'), 'root auth directory')
  assertEqual(paths.logDir, '/var/lib/host-cli-state/logs', 'state-derived log directory')
}

testCliStoragePathsHonorRootAndCategoryOverrides.description =
  'Verifies application home and category-specific environment overrides resolve predictably.'

export const testCliProviderEnvironmentUsesHostPrefix = () => {
  const environment = {
    HOST_CLI_CHATGPT_CODEX_API_KEY: 'host-codex-key',
    CHATGPT_CODEX_API_KEY: 'shared-codex-key',
  }

  assertEqual(
    resolveProviderSelection({}, 'HOST_CLI', environment),
    'chatgpt-codex',
    'host provider selection',
  )
  assertEqual(
    resolveKeyForProvider('chatgpt-codex', 'HOST_CLI', environment) ?? '',
    'host-codex-key',
    'host provider key',
  )
  return { success: true }
}

testCliProviderEnvironmentUsesHostPrefix.description =
  'Selects providers and credentials from the configured host environment namespace.'
