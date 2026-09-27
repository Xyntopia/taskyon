import type { JSONSchema } from 'json-schema-to-ts'
import { createClientTool } from '@taskyon/tyclient'

type PageIOBaseAction =
  | 'where'
  | 'navigate'
  | 'replace'
  | 'back'
  | 'reload'
  | 'list'
  | 'mark'
  | 'clearMark'
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
  mode?: 'interact' | 'inspect' | 'guide'
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
  'mark',
  'clearMark',
  'click',
  'fill',
]
const allActions: PageIOAction[] = [...baseActions, 'screenshot']
const inspectActions: PageIOAction[] = ['where', 'list']
const guideActions: PageIOAction[] = [...inspectActions, 'mark', 'clearMark']

const interactiveSelector = [
  '[data-testid]',
  'button',
  '[role=button]',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

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

const readInspectionLocation = () => ({
  pathname: window.location.pathname,
  title: document.title,
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

const elementLabel = (el: HTMLElement): string | undefined => {
  const label =
    el.getAttribute('aria-label') ??
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.placeholder || undefined
      : undefined) ??
    el.textContent
  return label?.trim().slice(0, 160) || undefined
}

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
  const all = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((el) =>
    isVisibleInteractive(el, includeHidden),
  )

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

const createParameters = (
  includeScreenshot: boolean,
  mode: 'interact' | 'inspect' | 'guide',
): Readonly<JSONSchema> => {
  const restricted = mode !== 'interact'
  const actionEnum: PageIOAction[] =
    mode === 'inspect'
      ? inspectActions
      : mode === 'guide'
        ? guideActions
        : includeScreenshot
          ? [...baseActions, 'screenshot']
          : baseActions
  const oneOf: Readonly<JSONSchema>[] = restricted
    ? [
        { properties: { action: { const: 'where' } } },
        { properties: { action: { const: 'list' } } },
        ...(mode === 'guide'
          ? [
              { properties: { action: { const: 'mark' }, selector: {} }, required: ['selector'] },
              { properties: { action: { const: 'clearMark' } } },
            ]
          : []),
      ]
    : [
        { properties: { action: { const: 'where' } } },
        { properties: { action: { const: 'navigate' }, url: {} }, required: ['url'] },
        { properties: { action: { const: 'replace' }, url: {} }, required: ['url'] },
        { properties: { action: { const: 'back' } } },
        { properties: { action: { const: 'reload' } } },
        { properties: { action: { const: 'list' } } },
        { properties: { action: { const: 'mark' }, selector: {} }, required: ['selector'] },
        { properties: { action: { const: 'clearMark' } } },
        { properties: { action: { const: 'click' }, selector: {} }, required: ['selector'] },
        {
          properties: { action: { const: 'fill' }, selector: {}, value: {} },
          required: ['selector', 'value'],
        },
      ]
  if (includeScreenshot && !restricted)
    oneOf.push({ properties: { action: { const: 'screenshot' } } })

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: restricted
      ? {
          action: {
            type: 'string',
            enum: actionEnum,
            description: 'Inspect or mark the current page.',
          },
          ...(mode === 'guide'
            ? {
                selector: {
                  type: 'string',
                  description: 'CSS selector from list for a visible control to mark.',
                },
              }
            : {}),
          limit: { type: 'integer', minimum: 1, maximum: 32, description: 'Max visible controls.' },
          preferTestId: { type: 'boolean', description: 'Prefer data-testid selectors in list.' },
        }
      : {
          action: {
            type: 'string',
            enum: actionEnum,
            description: 'Browser page interaction action.',
          },
          url: { type: 'string', description: 'Target URL for navigate or replace.' },
          selector: { type: 'string', description: 'CSS selector for mark, click, or fill.' },
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

export const makePageIOTool = (options: PageIOToolOptions = {}) => {
  const mode = options.mode ?? 'interact'
  let marked:
    | {
        element: HTMLElement
        outline: string
        outlinePriority: string
        outlineOffset: string
        outlineOffsetPriority: string
      }
    | undefined

  const clearMark = () => {
    if (!marked) return false
    const { element, outline, outlinePriority, outlineOffset, outlineOffsetPriority } = marked
    if (outline) element.style.setProperty('outline', outline, outlinePriority)
    else element.style.removeProperty('outline')
    if (outlineOffset)
      element.style.setProperty('outline-offset', outlineOffset, outlineOffsetPriority)
    else element.style.removeProperty('outline-offset')
    marked = undefined
    return true
  }

  return createClientTool({
    name: 'pageIO',
    description:
      mode === 'inspect'
        ? 'Inspect the current browser page and visible controls to guide the user where to click.'
        : mode === 'guide'
          ? 'Inspect the current browser page and temporarily mark a visible control to guide the user.'
          : 'Inspect the current browser page, mark controls, navigate with browser APIs, click selectors, fill fields, and optionally capture screenshots.',
    longDescription:
      mode === 'inspect'
        ? 'Read the current page location and visible controls only when useful for answering a browser-navigation question. This tool does not click, fill, navigate, read field values, or capture screenshots.'
        : mode === 'guide'
          ? 'Read the current page and visible controls on demand. Mark places a temporary outline on one listed control and scrolls it into view; clearMark removes the outline. This tool does not click, fill, navigate, read field values, or capture screenshots.'
          : 'This host capability acts on the current Taskyon browser page rather than an arbitrary remote browser. Navigation and DOM actions use browser APIs directly; screenshots require explicit host consent and are retained only in the current in-memory page session.',
    renderOptions: { hideChat: false, hideLlm: false, hideVector: true, hideToolSearch: false },
    parameters: createParameters(options.screenshot !== undefined, mode),
    async function(rawArgs) {
      const args = parsePageIOArgs(rawArgs)
      if (mode === 'inspect' && !inspectActions.includes(args.action)) {
        throw new Error(`pageIO.${args.action} is not available in inspection mode`)
      }
      if (mode === 'guide' && !guideActions.includes(args.action)) {
        throw new Error(`pageIO.${args.action} is not available in guidance mode`)
      }
      switch (args.action) {
        case 'where':
          return mode === 'interact' ? readLocation() : readInspectionLocation()
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
            limit: Math.max(
              1,
              Math.min(
                mode === 'interact' ? Infinity : 32,
                Math.trunc(optionalNumber(args.limit, 32)),
              ),
            ),
            includeHidden: mode !== 'interact' ? false : optionalBoolean(args.includeHidden, false),
            preferTestId: optionalBoolean(args.preferTestId, true),
          })
        case 'mark': {
          const selector = requireString(args.selector, 'pageIO.selector')
          if (!selector || selector.length > 256) {
            throw new Error('pageIO.mark: selector must be between 1 and 256 characters')
          }
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) throw new Error(`pageIO.mark: not found: ${selector}`)
          if (!element.matches(interactiveSelector) || !isVisibleInteractive(element, false)) {
            throw new Error('pageIO.mark: selected control is not visible')
          }
          clearMark()
          marked = {
            element,
            outline: element.style.getPropertyValue('outline'),
            outlinePriority: element.style.getPropertyPriority('outline'),
            outlineOffset: element.style.getPropertyValue('outline-offset'),
            outlineOffsetPriority: element.style.getPropertyPriority('outline-offset'),
          }
          element.style.setProperty('outline', '3px solid Highlight', 'important')
          element.style.setProperty('outline-offset', '3px', 'important')
          element.scrollIntoView({ block: 'center', inline: 'nearest' })
          return { marked: selector, label: elementLabel(element) }
        }
        case 'clearMark':
          return { cleared: clearMark() }
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
}
