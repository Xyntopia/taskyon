const TASK_QUERY_PARAM = 't'

const chatRoutePaths = new Set(['/chat', '/detailed'])

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

export const readCurrentTaskSelectionRoute = (href: string) => {
  const url = new URL(href)
  if (isHashRouterUrl(url)) {
    const route = parseHashRoute(url.hash)
    const queryString = route.query.toString()
    return `${route.path}${queryString ? `?${queryString}` : ''}`
  }
  return `${url.pathname}${url.search}`
}

const updateTaskQuery = (query: URLSearchParams, taskId: string | null | undefined) => {
  const normalizedTaskId = normalizeTaskId(taskId)
  if (normalizedTaskId) {
    query.set(TASK_QUERY_PARAM, normalizedTaskId)
    // Once a public chat has been imported, the local task ID owns the route.
    // Retaining the original URL would needlessly expose the source and
    // could trigger repeat-import logic on future navigation.
    query.delete('url')
  } else {
    query.delete(TASK_QUERY_PARAM)
  }
}

export const getTaskSelectionPath = (
  href: string,
  taskId: string | null | undefined,
  preferredPath?: string,
) => {
  if (preferredPath) return preferredPath
  const url = new URL(href)
  const currentPath = isHashRouterUrl(url) ? parseHashRoute(url.hash).path : url.pathname
  if (!normalizeTaskId(taskId) && currentPath === '/') {
    return '/'
  }
  return chatRoutePaths.has(currentPath) ? currentPath : '/chat'
}

export const buildTaskSelectionRoute = (
  href: string,
  taskId: string | null | undefined,
  preferredPath?: string,
) => {
  const url = new URL(href)
  const path = getTaskSelectionPath(href, taskId, preferredPath)
  if (isHashRouterUrl(url)) {
    const route = parseHashRoute(url.hash)
    updateTaskQuery(route.query, taskId)
    const queryString = route.query.toString()
    return `${path}${queryString ? `?${queryString}` : ''}`
  }
  updateTaskQuery(url.searchParams, taskId)
  const queryString = url.searchParams.toString()
  return `${path}${queryString ? `?${queryString}` : ''}`
}
