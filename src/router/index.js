import Vue from 'vue'
import VueRouter from 'vue-router'
// https://github.com/ljharb/qs
import qs from 'qs'
import routes from './routes'

Vue.use(VueRouter)

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default function ({ store }/* , ssrContext } */) {
  const Router = new VueRouter({
    scrollBehavior: () => ({ x: 0, y: 0 }),
    routes,

    // set custom query resolver in order to process nested filter queries
    parseQuery (query) {
      return qs.parse(query, { depth: 4 })
    },
    stringifyQuery (query) {
      var result = qs.stringify(query)

      return result ? ('?' + result) : ''
    },

    // Leave these as they are and change in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    mode: process.env.VUE_ROUTER_MODE,
    base: process.env.VUE_ROUTER_BASE
  })

  Router.beforeEach((to, from, next) => {
    console.log(to)
    if (to.matched.some(record => record.meta.access === 'public')) {
      console.log('is public!')
      next()
    } else {
      if (store.getters['comcharax/isLoggedIn']) {
        next()
      } else {
        next({ name: 'login', query: { next: to.fullPath } })
      }
    }
  })

  return Router
}
