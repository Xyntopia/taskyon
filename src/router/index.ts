import { defineRouter } from '#q-app/wrappers'
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
    process.env.VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory

  console.log('creating router... in mode:', process.env.MODE)
  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(process.env.VUE_ROUTER_BASE),
  })

  taskyonRouter = Router

  return Router
})
