import Vue from 'vue'
import Vuex from 'vuex'
import VuexORM from '@vuex-orm/core'
// import axios from 'axios'
import VuexORMAxios from '@vuex-orm/plugin-axios'
import VuexORMisDirtyPlugin from '@vuex-orm/plugin-change-flags'
import comcharax from './comcharax'
import models from './comcharax/models'
import VuexPersistence from 'vuex-persist'
// import localForage from 'localforage'

// TODO: think abot employing the followin vuex plugins:
// - https://github.com/christianmalek/vuex-rest-api
// - https://github.com/vuex-orm/vuex-orm + https://github.com/vuex-orm/plugin-axios
// - https://github.com/imcvampire/vue-axios

Vue.use(Vuex)

// register axios-sync plugin for vuexORM
VuexORM.use(VuexORMAxios, { axios: comcharax.componardoapi })
VuexORM.use(VuexORMisDirtyPlugin)

// Create new instance of Database.
const database = new VuexORM.Database()

// Register Models.
database.register(models.Component)
database.register(models.Tasks)
database.register(models.ExtractedData)
database.register(models.Projects)
// database.register(comcharax.Search)

/*
create persistant store for login information.
This saved in window.localStorage as
it is better to have a synchronous storage handling this
information. Otherwise initialization of the App
becomes pretty tedious...
*/
const vuexLocal = new VuexPersistence({
  key: 'componardo-vuex',
  strictMode: true, // This **MUST** be set to true
  storage: window.localStorage, // localForage, window.localStorage
  // asyncStorage: true,
  reducer: (state) => ({
    comcharax: {
      baseURL: state.comcharax.baseURL,
      token: state.comcharax.token,
      userName: state.comcharax.userName,
      activeProject: state.comcharax.activeProject
    }
  }),
  filter: (mutation) => {
    return mutation.type === 'comcharax/setToken' ||
      mutation.type === 'comcharax/setBaseURL' ||
      mutation.type === 'comcharax/setActiveProject' ||
      mutation.type === 'comcharax/clearNodes' ||
      mutation.type === 'comcharax/setProjectName' ||
      mutation.type === 'comcharax/setProjectID' ||
      mutation.type === 'comcharax/createNewProject'
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
        // signal service worker which base-url we want to use...
      }
    },
    plugins: [
      VuexORM.install(database),
      vuexLocal.plugin // it is important to include this after the ORM in order to be able to persist ORM data.
    ],
    // enable strict mode (adds overhead!)
    // for dev mode only
    strict: process.env.DEV
  })

  // link the token and baseURL to the axios instance we are using
  comcharax.componardoapi.interceptors.request.use((config) => {
    const token = Store.getters['comcharax/token']
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    config.baseURL = Store.getters['comcharax/baseURLFull']
    // TODO: change Access-Control to server value
    config.headers['Access-Control-Allow-Origin'] = '*'

    return config
  })

  return Store
}
