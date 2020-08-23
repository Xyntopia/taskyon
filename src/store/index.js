import Vue from 'vue'
import Vuex from 'vuex'

// TODO: currently vue modules are not in use... we might need this later though
// import example from './module-example'

Vue.use(Vuex)

/*
 * If not building with SSR mode, you can
 * directly export the Store instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Store instance.
 */

export default function (/* { ssrContext } */) {
  const Store = new Vuex.Store({
    modules: {
      // example
    },

    state: {
      count: 0,
      result: ['r12', 'r23', 'r34'],
      searchstring: ''
    },
    mutations: {
      increment (state) {
        state.count++
      }
    },

    // enable strict mode (adds overhead!)
    // for dev mode only
    strict: process.env.DEV
  })

  return Store
}
