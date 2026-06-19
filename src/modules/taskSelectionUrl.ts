const TASK_QUERY_PARAM = 't'
export const TASKYON_URL_CHANGE_EVENT = 'taskyon:urlchange'

const chatRoutePaths = new Set(['/', '/chat', '/detailed'])

const normalizeTaskId = (value: string | null | undefined) => value?.trim() || undefined

const isHashRouterUrl = (url: URL) => url.hash.startsWith('#/')

const parseHashRoute = (hash: string) => {
  const route = hash.startsWith('#') ? hash.slice(1) : hash
  const [path = '/', query = ''] = route.split('?')
  return {
    path: path || '/',
    query: new URLSearchParams(query),
  }
}

const stringifyHashRoute = (path: string, query: URLSearchParams) => {
  const queryString = query.toString()
  return `#${path}${queryString ? `?${queryString}` : ''}`
}

const updateTaskQuery = (query: URLSearchParams, taskId: string | null | undefined) => {
  const normalizedTaskId = normalizeTaskId(taskId)
  if (normalizedTaskId) query.set(TASK_QUERY_PARAM, normalizedTaskId)
  else query.delete(TASK_QUERY_PARAM)
}

export const readSelectedTaskIdFromHref = (href: string) => {
  const url = new URL(href)
  if (isHashRouterUrl(url)) {
    return normalizeTaskId(parseHashRoute(url.hash).query.get(TASK_QUERY_PARAM))
  }
  return normalizeTaskId(url.searchParams.get(TASK_QUERY_PARAM))
}

export const getTaskSelectionPath = (href: string, preferredPath?: string) => {
  if (preferredPath) return preferredPath
  const url = new URL(href)
  const currentPath = isHashRouterUrl(url) ? parseHashRoute(url.hash).path : url.pathname
  return chatRoutePaths.has(currentPath) ? currentPath : '/chat'
}

export const buildHrefWithSelectedTask = (
  href: string,
  taskId: string | null | undefined,
  preferredPath?: string,
) => {
  const url = new URL(href)
  const path = getTaskSelectionPath(href, preferredPath)
  if (isHashRouterUrl(url)) {
    const route = parseHashRoute(url.hash)
    updateTaskQuery(route.query, taskId)
    url.hash = stringifyHashRoute(path, route.query)
    return url.toString()
  }
  url.pathname = path
  updateTaskQuery(url.searchParams, taskId)
  return url.toString()
}

const dispatchTaskyonUrlChangeEvent = () => {
  window.dispatchEvent(new Event(TASKYON_URL_CHANGE_EVENT))
}

const patchHistoryMethod = (method: 'pushState' | 'replaceState') => {
  const original = window.history[method].bind(window.history)
  return (...args: [unknown, string, string | URL | null | undefined]) => {
    const result = original(...args)
    dispatchTaskyonUrlChangeEvent()
    return result
  }
}

export const installTaskyonUrlChangeEvents = (() => {
  let installed = false
  return () => {
    if (installed || typeof window === 'undefined') return
    installed = true
    window.history.pushState = patchHistoryMethod('pushState')
    window.history.replaceState = patchHistoryMethod('replaceState')
    window.addEventListener('hashchange', dispatchTaskyonUrlChangeEvent)
    window.addEventListener('popstate', dispatchTaskyonUrlChangeEvent)
  }
})()
