import { defineRouter } from '#q-app/wrappers'
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
  type Router,
} from 'vue-router'
import { routes, tyServerRoutes } from './routes_taskyon'

let taskyonRouter: Router | undefined

export const getTaskyonRouter = (): Router => {
  if (!taskyonRouter) throw new Error('Taskyon router has not been initialized')
  return taskyonRouter
}

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory

  console.log('creating router... in mode:', process.env.MODE)
  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    // this needs to be 'MODE" and not 'SERVER', because we need this to be the same
    // whether we are in the browser or on ther server
    routes: process.env.MODE === 'ssr' ? tyServerRoutes : routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(process.env.VUE_ROUTER_BASE),
  })

  taskyonRouter = Router

  return Router
})
