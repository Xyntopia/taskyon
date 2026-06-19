import { useRouter } from 'vue-router'
import {
  buildTaskSelectionRoute,
  readCurrentTaskSelectionRoute,
} from 'src/modules/taskSelectionUrl'

export function useTaskNavigation() {
  const router = useRouter()

  const navigateToTask = (
    taskId: string | null | undefined,
    options: {
      path?: string
      replace?: boolean
    } = {},
  ) => {
    const routeTarget = buildTaskSelectionRoute(window.location.href, taskId, options.path)
    if (routeTarget === readCurrentTaskSelectionRoute(window.location.href)) return
    if (options.replace) {
      void router.replace(routeTarget)
      return
    }
    void router.push(routeTarget)
  }

  return {
    navigateToTask,
  }
}
