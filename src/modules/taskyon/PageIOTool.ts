import type { JSONSchema } from 'json-schema-to-ts'
import { createClientTool } from '@taskyon/tyclient'

type PageIOBaseAction =
  | 'where'
  | 'navigate'
  | 'replace'
  | 'back'
  | 'reload'
  | 'list'
  | 'click'
  | 'fill'
type PageIOAction = PageIOBaseAction | 'screenshot'

type PageIOArgs = {
  action: PageIOAction
  url?: unknown
  selector?: unknown
  value?: unknown
  steps?: unknown
  limit?: unknown
  includeHidden?: unknown
  preferTestId?: unknown
}

type ScreenshotCapture = {
  bytes: string
  mediaType: string
  width?: number
  height?: number
}

type StoredScreenshot = ScreenshotCapture & {
  id: string
  createdAt: string
}

type PageIOScreenshotAdapter = () => Promise<ScreenshotCapture>
type PageIOScreenshotConsent = () => Promise<boolean>

type PageIOSessionStore = {
  save: (capture: ScreenshotCapture) => StoredScreenshot
  list: () => StoredScreenshot[]
  clear: () => void
}

export type PageIOToolOptions = {
  screenshot?: {
    capture: PageIOScreenshotAdapter
    requestConsent: PageIOScreenshotConsent
    store: PageIOSessionStore
  }
}

const baseActions: PageIOBaseAction[] = [
  'where',
  'navigate',
  'replace',
  'back',
  'reload',
  'list',
  'click',
  'fill',
]
const allActions: PageIOAction[] = [...baseActions, 'screenshot']

const isPageIOAction = (value: string): value is PageIOAction =>
  allActions.includes(value as PageIOAction)

const requireString = (value: unknown, name: string): string => {
  if (typeof value === 'string') return value
  throw new Error(`${name} must be a string`)
}

const propertyValue = (value: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(value, key)?.value

const parsePageIOArgs = (value: unknown): PageIOArgs => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('pageIO arguments must be an object')
  }
  const action = propertyValue(value, 'action')
  if (typeof action !== 'string' || !isPageIOAction(action)) {
    throw new Error('pageIO.action is required')
  }
  return {
    action,
    url: propertyValue(value, 'url'),
    selector: propertyValue(value, 'selector'),
    value: propertyValue(value, 'value'),
    steps: propertyValue(value, 'steps'),
    limit: propertyValue(value, 'limit'),
    includeHidden: propertyValue(value, 'includeHidden'),
    preferTestId: propertyValue(value, 'preferTestId'),
  }
}

const requireNumber = (value: unknown, name: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${name} must be a finite number`)
}

const optionalNumber = (value: unknown, fallback: number): number => {
  if (value === undefined) return fallback
  return requireNumber(value, 'pageIO number')
}

const optionalBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  throw new Error('pageIO boolean option must be a boolean')
}

const readLocation = () => ({
  href: window.location.href,
  origin: window.location.origin,
  protocol: window.location.protocol,
  host: window.location.host,
  hostname: window.location.hostname,
  port: window.location.port,
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
  title: document.title,
  historyLength: window.history.length,
})

const toElementSelector = (el: HTMLElement, preferTestId: boolean): string => {
  if (preferTestId) {
    const testId = el.getAttribute('data-testid')
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`
  }
  if (el.id) return `#${CSS.escape(el.id)}`
  if (el instanceof HTMLInputElement && el.name) {
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`
  }
  const classSelector = el.className
    .toString()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((className) => `.${CSS.escape(className)}`)
    .join('')
  return `${el.tagName.toLowerCase()}${classSelector}`
}

const elementLabel = (el: HTMLElement): string | undefined =>
  el.getAttribute('aria-label') ??
  (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.placeholder || undefined
    : undefined) ??
  el.textContent?.trim() ??
  undefined

const isVisibleInteractive = (el: HTMLElement, includeHidden: boolean): boolean => {
  if (el.hasAttribute('disabled')) return false
  if (includeHidden) return true
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const describeInteractives = ({
  limit,
  includeHidden,
  preferTestId,
}: {
  limit: number
  includeHidden: boolean
  preferTestId: boolean
}) => {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[data-testid]',
        'button',
        '[role=button]',
        'a[href]',
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(','),
    ),
  ).filter((el) => isVisibleInteractive(el, includeHidden))

  return {
    count: all.length,
    elements: all.slice(0, limit).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el instanceof HTMLInputElement ? el.type : undefined,
      id: el.id || undefined,
      name: el instanceof HTMLInputElement ? el.name || undefined : undefined,
      label: elementLabel(el),
      selector: toElementSelector(el, preferTestId),
    })),
  }
}

const clickSelector = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`pageIO.click: not found: ${selector}`)
  el.click()
  return { clicked: selector }
}

const fillSelector = (selector: string, value: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`pageIO.fill: not found: ${selector}`)
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    el.value = value
  } else {
    throw new Error(`pageIO.fill: element does not support value: ${selector}`)
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { filled: selector, value }
}

const createParameters = (includeScreenshot: boolean): Readonly<JSONSchema> => {
  const actionEnum: PageIOAction[] = includeScreenshot
    ? [...baseActions, 'screenshot']
    : baseActions
  const oneOf: Readonly<JSONSchema>[] = [
    { properties: { action: { const: 'where' } } },
    { properties: { action: { const: 'navigate' }, url: {} }, required: ['url'] },
    { properties: { action: { const: 'replace' }, url: {} }, required: ['url'] },
    { properties: { action: { const: 'back' } } },
    { properties: { action: { const: 'reload' } } },
    { properties: { action: { const: 'list' } } },
    { properties: { action: { const: 'click' }, selector: {} }, required: ['selector'] },
    {
      properties: { action: { const: 'fill' }, selector: {}, value: {} },
      required: ['selector', 'value'],
    },
  ]
  if (includeScreenshot) oneOf.push({ properties: { action: { const: 'screenshot' } } })

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: actionEnum,
        description: 'Browser page interaction action.',
      },
      url: { type: 'string', description: 'Target URL for navigate or replace.' },
      selector: { type: 'string', description: 'CSS selector for click or fill.' },
      value: { type: 'string', description: 'Value for fill.' },
      steps: { type: 'number', description: 'History steps for back. Defaults to 1.' },
      limit: { type: 'number', description: 'Max elements returned by list. Defaults to 32.' },
      includeHidden: { type: 'boolean', description: 'Include hidden elements in list.' },
      preferTestId: { type: 'boolean', description: 'Prefer data-testid selectors in list.' },
    },
    oneOf,
  } as const satisfies Readonly<JSONSchema>
  return schema
}

export const createPageIOSessionStore = (): PageIOSessionStore => {
  const screenshots = new Map<string, StoredScreenshot>()
  return {
    save: (capture) => {
      const id = crypto.randomUUID()
      const stored = {
        ...capture,
        id,
        createdAt: new Date().toISOString(),
      }
      screenshots.set(id, stored)
      return stored
    },
    list: () => [...screenshots.values()],
    clear: () => screenshots.clear(),
  }
}

export const makePageIOTool = (options: PageIOToolOptions = {}) =>
  createClientTool({
    name: 'pageIO',
    description:
      'Inspect the current browser page, navigate with browser APIs, list controls, click selectors, fill fields, and optionally capture screenshots.',
    renderOptions: { hideChat: false, hideLlm: false },
    parameters: createParameters(options.screenshot !== undefined),
    async function(rawArgs) {
      const args = parsePageIOArgs(rawArgs)
      switch (args.action) {
        case 'where':
          return readLocation()
        case 'navigate':
          window.location.assign(requireString(args.url, 'pageIO.url'))
          return { navigating: true, url: args.url }
        case 'replace':
          window.location.replace(requireString(args.url, 'pageIO.url'))
          return { replacing: true, url: args.url }
        case 'back':
          window.history.go(-Math.max(1, Math.trunc(optionalNumber(args.steps, 1))))
          return { goingBack: true, steps: args.steps ?? 1 }
        case 'reload':
          window.location.reload()
          return { reloading: true }
        case 'list':
          return describeInteractives({
            limit: Math.max(1, Math.trunc(optionalNumber(args.limit, 32))),
            includeHidden: optionalBoolean(args.includeHidden, false),
            preferTestId: optionalBoolean(args.preferTestId, true),
          })
        case 'click':
          return clickSelector(requireString(args.selector, 'pageIO.selector'))
        case 'fill':
          return fillSelector(
            requireString(args.selector, 'pageIO.selector'),
            requireString(args.value, 'pageIO.value'),
          )
        case 'screenshot': {
          if (!options.screenshot) throw new Error('pageIO.screenshot is not available')
          if (!(await options.screenshot.requestConsent())) return { cancelled: true }
          const stored = options.screenshot.store.save(await options.screenshot.capture())
          return {
            id: stored.id,
            createdAt: stored.createdAt,
            mediaType: stored.mediaType,
            width: stored.width,
            height: stored.height,
          }
        }
        default:
          throw new Error(`pageIO: unknown action '${String(args.action)}'`)
      }
    },
  })
