import type { Page } from '@playwright/test'

export type ClipboardProbe = {
  read: () => Promise<string>
}

export const createClipboardProbe = async (page: Page): Promise<ClipboardProbe> => {
  // Firefox supports clipboard read/write without a permission grant, but Playwright's
  // Firefox BrowserContext does not implement clipboard-read or clipboard-write permissions.
  const browserName = page.context().browser()?.browserType().name()
  if (browserName !== 'firefox') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  }

  return {
    read: () => page.evaluate(() => navigator.clipboard.readText()),
  }
}
