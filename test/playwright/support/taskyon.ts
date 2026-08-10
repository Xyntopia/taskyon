import { expect, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { KeyString } from '@taskyon/taskyon'

export const testModelId = 'google/gemini-2.5-flash-lite'

const modelSelectLabel = 'Select LLM Model for answering/solving the task.'
const onlineEnvFileName = 'playwright.env.json'
const onlineEnvKeys = ['taskyon_key', 'openai_api_key', 'openrouter_api_key'] as const

type OnlineEnv = Record<(typeof onlineEnvKeys)[number], KeyString>

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const hasNonEmptyProperty = (value: object, key: string): boolean =>
  isNonEmptyString(Object.getOwnPropertyDescriptor(value, key)?.value)

const parseOnlineEnv = (value: unknown): OnlineEnv | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!onlineEnvKeys.every((key) => hasNonEmptyProperty(value, key))) return undefined

  return {
    taskyon_key: Object.getOwnPropertyDescriptor(value, 'taskyon_key')?.value as KeyString,
    openai_api_key: Object.getOwnPropertyDescriptor(value, 'openai_api_key')?.value as KeyString,
    openrouter_api_key: Object.getOwnPropertyDescriptor(value, 'openrouter_api_key')
      ?.value as KeyString,
  }
}

export const dataCy = (page: Page | Locator, value: string): Locator =>
  page.locator(`[data-cy="${value}"]`)

export const dataCyMenu = (page: Page | Locator, value: string): Locator =>
  page.locator(`[data-cy="${value}"], [data-cy-menu="${value}"]`)

export const expectTaskyonReady = async (page: Page) => {
  await expect(page.locator('.create-tasks textarea')).toBeVisible()
}

export const readOnlineEnv = (projectRoot: string): OnlineEnv | undefined => {
  const envFilePath = join(projectRoot, onlineEnvFileName)
  if (!existsSync(envFilePath)) {
    if (process.env.PLAYWRIGHT_REQUIRE_ONLINE === '1') {
      throw new Error(`${onlineEnvFileName} is required for online Playwright tests.`)
    }
    return undefined
  }

  const parsed = JSON.parse(readFileSync(envFilePath, 'utf8')) as unknown
  const onlineEnv = parseOnlineEnv(parsed)
  if (!onlineEnv) {
    throw new Error(
      `${onlineEnvFileName} must contain non-empty values for: ${onlineEnvKeys.join(', ')}.`,
    )
  }
  return onlineEnv
}

const isToggleOn = async (toggle: Locator): Promise<boolean> => {
  const [className, ariaChecked] = await Promise.all([
    toggle.getAttribute('class'),
    toggle.getAttribute('aria-checked'),
  ])
  return className?.includes('q-toggle--truthy') === true || ariaChecked === 'true'
}

const settingsToggle = (page: Page, label: string): Locator =>
  dataCyMenu(page, 'ai-settings').locator(`[data-cy="${label}"] .q-toggle`).first()

export const setSettingsToggle = async (page: Page, label: string, enabled: boolean) => {
  const toggle = settingsToggle(page, label)
  await expect(toggle).toBeVisible()

  if ((await isToggleOn(toggle)) !== enabled) {
    await toggle.click()
  }

  await expect.poll(() => isToggleOn(toggle), { message: `${label} toggle state` }).toBe(enabled)
}

export const expectSettingsToggle = async (page: Page, label: string, enabled: boolean) => {
  const toggle = settingsToggle(page, label)
  await expect(toggle).toBeVisible()
  await expect.poll(() => isToggleOn(toggle), { message: `${label} toggle state` }).toBe(enabled)
}

export const closeAiSettings = async (page: Page) => {
  await expect(dataCyMenu(page, 'ai-settings')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dataCyMenu(page, 'ai-settings')).toBeHidden()
}

export const waitForTaskyonSession = async (page: Page) => {
  const sidebarButton = page.getByRole('button', { name: 'Open Sidebar' })
  await sidebarButton.click()
  const sessionStatus = page.locator('.chat-sidebar__dev')
  await expect(sessionStatus).toBeVisible()
  await expect(sessionStatus).not.toContainText('session: N/A')
  await expect(sessionStatus).toContainText('status: ready')
  await page.locator('.q-drawer__backdrop').click()
  await expect(sessionStatus).toBeHidden()
}

const modelField = (page: Page): Locator =>
  dataCy(page, 'model-selection').locator('.q-field').filter({ hasText: modelSelectLabel })

const selectLlmProvider = async (page: Page, modelSelection: Locator, provider: string) => {
  const popup = page.locator('.provider-select-popup:visible')
  const option = popup.locator(`[data-cy="provider-option"][data-provider="${provider}"]`).first()
  const providerSelect = dataCy(modelSelection, 'provider-select')

  await expect(async () => {
    if (await popup.isVisible()) await page.keyboard.press('Escape')
    await providerSelect.click()
    await expect(option).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })

  await option.click()
  await expect(providerSelect).toContainText(provider)
}

export const selectLlmModel = async (page: Page, provider?: string, modelId = '') => {
  const modelSelection = dataCy(page, 'model-selection')
  await dataCy(page, 'model-id').click()
  await expect(modelSelection).toBeVisible()

  if (provider) {
    await selectLlmProvider(page, modelSelection, provider)
  }

  if (modelId) {
    const modelSelect = dataCy(page, 'model-select')
    const modelIds =
      provider && !modelId.includes('/') ? [modelId, `${provider}/${modelId}`] : [modelId]
    if (!modelIds.includes(await modelSelect.inputValue())) {
      const field = modelField(page)
      await field.click()
      await field.locator('input').fill(modelId)
      const modelIdSelectors = modelIds
        .map((id) => `[data-cy="model-option"][data-model-id="${id}"]`)
        .join(', ')
      await page.locator('.model-select-popup:visible').locator(modelIdSelectors).first().click()
    }
    await expect.poll(async () => modelIds.includes(await modelSelect.inputValue())).toBe(true)
  }

  await page.keyboard.press('Escape')
}

export const writeMessage = async (page: Page | Locator, message: string) => {
  const input = page.locator('.create-tasks textarea')
  await expect(input).toBeVisible()
  await input.fill(message)
  await page.locator('.create-tasks .msg-edit__send-button').first().click()
}

export const lastAssistantMessage = (page: Page, selector = '.assistant.message'): Locator =>
  page.locator(`${selector} .ty-markdown`).last()

export const checkLastMessage = async (
  page: Page,
  expectedText: string,
  selector = '.assistant.message',
) => {
  await expect(lastAssistantMessage(page, selector)).toContainText(new RegExp(expectedText, 'i'), {
    timeout: 100_000,
  })
}

export const startNewChat = async (page: Page) => {
  await page.getByLabel('start new chat').click()
}

export const addAiServices = async (page: Page, env: OnlineEnv) => {
  const providerKeys = {
    taskyon: env.taskyon_key,
    openai: env.openai_api_key,
    'openrouter.ai': env.openrouter_api_key,
  }

  await page.goto('/settings/aiserviceprovider')
  const providerPanel = page.locator('.llm-providers')
  await expect(providerPanel).toBeVisible()
  await expect(providerPanel.getByText(/currently using Taskyon’s free version/i)).toBeVisible()
  await dataCy(providerPanel, 'provider-api-keys').getByRole('button').first().click()

  for (const [provider, key] of Object.entries(providerKeys)) {
    await providerPanel.getByRole('button', { name: provider, exact: true }).click()
    const input = page.getByRole('textbox', { name: `${provider} key`, exact: true })
    await expect(input).toBeVisible()
    await input.fill(key)
    const dialog = page.getByRole('dialog').filter({ has: input })
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    if (provider === 'taskyon') {
      await expect(providerPanel.getByText(/currently using Taskyon’s free version/i)).toBeHidden()
    }
    await expect(input).toBeHidden()
  }

  const providerSelect = dataCy(providerPanel, 'settings-provider-select').getByRole('combobox', {
    name: 'Provider',
  })
  await providerSelect.click()
  for (const provider of Object.keys(providerKeys)) {
    await expect(
      page.locator(
        `.provider-select-popup:visible [data-cy="provider-option"][data-provider="${provider}"]`,
      ),
    ).toBeVisible()
  }
  await page.keyboard.press('Escape')
}

export const expectTaskResultMessage = (text: string, expectedText?: string) => {
  const jsonStart = text.indexOf('{')
  expect(jsonStart).toBeGreaterThanOrEqual(0)

  const parsed = JSON.parse(text.slice(jsonStart)) as unknown
  expect(parsed).toMatchObject({
    role: 'assistant',
    content: { type: 'message' },
  })
  if (expectedText) expect(text).toContain(expectedText)
}
