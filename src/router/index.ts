import { defineRouter } from '#q-app'
import {
  createRouter,
  createWebHashHistory,
  createWebHistory,
  type Router,
} from 'vue-router'
import { routes } from './routes_taskyon'

let taskyonRouter: Router | undefined

export const getTaskyonRouter = (): Router => {
  if (!taskyonRouter) throw new Error('Taskyon router has not been initialized')
  return taskyonRouter
}

export default defineRouter(function () {
  const createHistory =
    import.meta.env.QUASAR_VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory

  console.log('creating router... in mode:', import.meta.env.QUASAR_MODE)
  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
  })

  taskyonRouter = Router

  return Router
})
