import { expect, test } from '@playwright/test'

for (const [name, route] of [
  ['coding', '/editor'],
  ['SQL', '/sql'],
  ['design', '/design/ai-workstation/main'],
  ['documentation', '/docs/taskyon'],
  ['Modelica', '/modelica'],
] as const) {
  test(`${name} app renders its assistant directly`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(route)
    if (name === 'Modelica') await page.getByText('assistant', { exact: true }).first().click()
    await expect(page.locator('.task-chat-window').first()).toHaveAttribute(
      'data-runtime-status',
      'ready',
    )
    await expect(page.locator('iframe[title="Taskyon agent"]')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })
}
