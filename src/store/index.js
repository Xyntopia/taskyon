import Vue from 'vue'
import Vuex from 'vuex'
import VuexORM from '@vuex-orm/core'
import comcharax from './comcharax'

// TODO: think abot employing the followin vuex plugins:
// - https://github.com/christianmalek/vuex-rest-api
// - https://github.com/vuex-orm/vuex-orm + https://github.com/vuex-orm/plugin-axios
// - https://github.com/imcvampire/vue-axios

Vue.use(Vuex)

// Create new instance of Database.
const database = new VuexORM.Database()

// Register Models.
database.register(comcharax.Component)

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
      comcharax: comcharax.vuexModule
    },
    plugins: [VuexORM.install(database)],
    // enable strict mode (adds overhead!)
    // for dev mode only
    strict: process.env.DEV
  })
  return Store
}
