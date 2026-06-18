import { injectQuasarDevServerConfig } from '@quasar/quasar-app-extension-testing-e2e-cypress/cct-dev-server'
import { defineConfig } from 'cypress'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const requiredCypressEnvKeys = ['openai_api_key', 'openrouter_api_key'] as const

type RequiredCypressEnvKey = (typeof requiredCypressEnvKeys)[number]

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const getMissingEnvKeys = (
  envValues: Record<string, unknown>,
  keys: readonly RequiredCypressEnvKey[],
): RequiredCypressEnvKey[] => keys.filter((key) => !isNonEmptyString(envValues[key]))

const readCypressEnvFile = (projectRoot: string): Record<string, unknown> => {
  const envFilePath = join(projectRoot, 'cypress.env.json')
  if (!existsSync(envFilePath)) {
    throw new Error(
      `Missing required Cypress env file: ${envFilePath}. Create it before running e2e tests.`,
    )
  }

  const raw = readFileSync(envFilePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid Cypress env file: ${envFilePath} must contain a JSON object.`)
  }

  return parsed as Record<string, unknown>
}

const assertCypressEnvJsonLoaded = (projectRoot: string, env: Record<string, unknown>) => {
  const fileEnv = readCypressEnvFile(projectRoot)
  const missingFileKeys = getMissingEnvKeys(fileEnv, requiredCypressEnvKeys)
  if (missingFileKeys.length > 0) {
    throw new Error(`cypress.env.json is missing required keys: ${missingFileKeys.join(', ')}.`)
  }

  const unloadedKeys = requiredCypressEnvKeys.filter((key) => env[key] !== fileEnv[key])
  if (unloadedKeys.length > 0) {
    throw new Error(
      `cypress.env.json was not loaded correctly. Missing loaded values for: ${unloadedKeys.join(', ')}.`,
    )
  }
}

export default defineConfig({
  fixturesFolder: 'test/cypress/fixtures',
  screenshotsFolder: 'test/cypress/screenshots',
  videosFolder: 'test/cypress/videos',
  video: true,
  chromeWebSecurity: false,
  e2e: {
    setupNodeEvents(_on, config) {
      assertCypressEnvJsonLoaded(config.projectRoot, config.env)
      return config
    },
    baseUrl: 'https://localhost:9000',
    //baseUrl: 'http://localhost:4000',
    //baseUrl: 'https://taskyon.space',
    supportFile: 'test/cypress/support/e2e.ts',
    specPattern: 'test/cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    //experimentalStudio: true,
    experimentalRunAllSpecs: true, // so that we can run all specs in the gui!
  },
  component: {
    // setupNodeEvents(on, config) {},
    supportFile: 'test/cypress/support/component.ts',
    specPattern: 'src/**/*.cy.{js,jsx,ts,tsx}',
    indexHtmlFile: 'test/cypress/support/component-index.html',
    devServer: injectQuasarDevServerConfig(),
  },
})
