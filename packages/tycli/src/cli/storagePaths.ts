import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export type CliStoragePaths = {
  configDir: string
  dataDir: string
  cacheDir: string
  stateDir: string
  authDir: string
  logDir: string
  fallbackConfigDir: string
  fallbackDataDir: string
}

type CliStoragePathOptions = {
  applicationName: string
  environmentPrefix: string
  environment?: Readonly<Record<string, string | undefined>>
  homeDir?: string
  tempDir?: string
}

const configuredPath = (environment: Readonly<Record<string, string | undefined>>, name: string) =>
  environment[name]?.trim() || undefined

export function resolveCliStoragePaths(options: CliStoragePathOptions): CliStoragePaths {
  const environment = options.environment ?? process.env
  const home = options.homeDir ?? homedir()
  const temporary = options.tempDir ?? tmpdir()
  const prefix = options.environmentPrefix
  const applicationHome = configuredPath(environment, `${prefix}_HOME`)
  const categoryRoot = (category: string, fallback: string) =>
    configuredPath(environment, `${prefix}_${category}_DIR`) ??
    (applicationHome ? join(applicationHome, category.toLowerCase()) : fallback)

  const configDir = categoryRoot(
    'CONFIG',
    join(
      configuredPath(environment, 'XDG_CONFIG_HOME') ?? join(home, '.config'),
      options.applicationName,
    ),
  )
  const dataDir = categoryRoot(
    'DATA',
    join(
      configuredPath(environment, 'XDG_DATA_HOME') ?? join(home, '.local', 'share'),
      options.applicationName,
    ),
  )
  const cacheDir = categoryRoot(
    'CACHE',
    join(
      configuredPath(environment, 'XDG_CACHE_HOME') ?? join(home, '.cache'),
      options.applicationName,
    ),
  )
  const stateDir = categoryRoot(
    'STATE',
    join(
      configuredPath(environment, 'XDG_STATE_HOME') ?? join(home, '.local', 'state'),
      options.applicationName,
    ),
  )
  const fallbackRoot = join(temporary, options.applicationName)

  return {
    configDir,
    dataDir,
    cacheDir,
    stateDir,
    authDir: join(configDir, 'auth'),
    logDir: join(stateDir, 'logs'),
    fallbackConfigDir: fallbackRoot,
    fallbackDataDir: join(fallbackRoot, 'data'),
  }
}

export function resolveTaskyonCliStoragePaths(): CliStoragePaths {
  const paths = resolveCliStoragePaths({
    applicationName: 'tycli',
    environmentPrefix: 'TYCLI',
  })
  const home = homedir()
  const configDir = join(home, '.config', 'tycli')

  return {
    ...paths,
    configDir,
    authDir: join(home, '.taskyon-cli', 'auth'),
    logDir: process.env.TYCLI_LOG_DIR?.trim() || join('/tmp', 'tycli'),
  }
}
