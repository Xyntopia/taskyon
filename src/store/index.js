import Vue from 'vue'
import Vuex from 'vuex'
import VuexORM from '@vuex-orm/core'
// import axios from 'axios'
import VuexORMAxios from '@vuex-orm/plugin-axios'
import comcharax from './comcharax'
import VuexPersistence from 'vuex-persist'

// TODO: think abot employing the followin vuex plugins:
// - https://github.com/christianmalek/vuex-rest-api
// - https://github.com/vuex-orm/vuex-orm + https://github.com/vuex-orm/plugin-axios
// - https://github.com/imcvampire/vue-axios

Vue.use(Vuex)

// register axios-sync plugin for vuexORM
VuexORM.use(VuexORMAxios, { axios: comcharax.componardoapi })

// Create new instance of Database.
const database = new VuexORM.Database()

// Register Models.
database.register(comcharax.Component)
database.register(comcharax.Tasks)
database.register(comcharax.DataSheets)
// database.register(comcharax.Search)

// create persistant store
const vuexLocal = new VuexPersistence({
  strictMode: true, // This **MUST** be set to true
  storage: window.localStorage,
  reducer: (state) => ({
    comcharax: {
      baseURL: state.comcharax.baseURL,
      token: state.comcharax.token
    }
  }),
  filter: (mutation) => {
    return mutation.type === 'setToken' ||
      mutation.type === 'setBaseURL'
  }
})

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
    mutations: {
      RESTORE_MUTATION: vuexLocal.RESTORE_MUTATION // this mutation **MUST** be named "RESTORE_MUTATION"
    },
    actions: {
      async initialize ({ commit, state }) {
        console.log('initialize store!')
        comcharax.componardoapi.defaults.baseURL = state.comcharax.baseURL
      }
    },
    plugins: [
      VuexORM.install(database),
      vuexLocal.plugin
    ],
    // enable strict mode (adds overhead!)
    // for dev mode only
    strict: process.env.DEV
  })
  return Store
}
