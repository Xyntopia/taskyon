/* This vuex store manages all interaction with the comcharax-graphengine api
 * this includes:
 * - sync data between rest api and frontend
 * - build new systems
 * - search for new components
 */
/* import state from './state'
import * as getters from './getters'
import * as mutations from './mutations'
import * as actions from './actions' */

import axios from 'axios'
// eslint-disable-next-line
import jwt_decode from "jwt-decode"
import models from './models'
// import { LocalStorage, SessionStorage } from 'quasar'
// import { LocalStorage } from 'quasar'

axios.defaults.headers.post['Access-Control-Allow-Origin'] = '*'
// axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded';
// axios.defaults.baseURL = 'http://localhost:5000'
// axios.defaults.headers.common['Authorization'] = AUTH_TOKEN;
/*  baseURL: ,
  timeout: 1000,
  headers: {'X-Custom-Header': 'foobar'} */
// var graphengineApi = axios.create()

// var initialURL = LocalStorage.getItem('vuex')
// console.log('initial URL:' + initialURL)
var initialURL = 'https://api.componardo.com'

var componardoapi = axios.create({
  // baseURL: 'https://api.componardo.com/'
  baseURL: initialURL,
  headers: { 'Access-Control-Allow-Origin': '*' }
})

// add interceptor to handle login failures
/*
componardoapi.interceptors.response.use(response => {
   return response;
}, error => {
  if (error.response.status === 401) {
   //place your reentry code
  }
  return error;
})
*/

/*
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
*/

var vuexModule = {
  namespaced: true,
  state: {
    result: null,
    baseURL: initialURL,
    neo4jURI: 'neo4j:7687',
    neo4jPW: 'TODO',
    searchingState: false,
    dbState: {},
    token: null,
    userName: '',
    backendSettings: {},
    activeProject: { // TODO: replace this with "ID" and a getter which gets the project from the orm module
      counter: 0,
      name: 'new system',
      uid: null,
      componentcontainers: [],
      links: []
    },
    filterPresets: {
      'User Components': {
        type: 'field_contains',
        target: 'User.name',
        method: 'OR',
        value: ['DefaultUser', 'Scraper']
      }
    }
  },
  mutations: {
    setBackendSettings (state, val) {
      state.backendSettings = val
    },
    createNewProject (state, val) {
      state.activeProject = {
        counter: 0,
        name: 'new system',
        uid: null,
        componentcontainers: [],
        links: []
      }
    },
    setProjectName (state, val) {
      state.activeProject.name = val
    },
    setProjectID (state, val) {
      state.activeProject.uid = val
    },
    clearNodes (state, val) {
      state.activeProject.componentcontainers = []
      state.activeProject.links = []
    },
    setActiveProject (state, val) {
      state.activeProject = val
    },
    setUserName (state, val) {
      state.userName = val
    },
    setBaseURL (state, val) {
      componardoapi.defaults.baseURL = val
      componardoapi.defaults.headers['Access-Control-Allow-Origin'] = '*'
      state.baseURL = val
    },
    setSearchError (state, error) {
      state.result = {}
    },
    setSearchState (state, val) {
      state.searchingState = val
    },
    updateSearchResult (state, val) {
      // TODO: what if data is none?
      if (val.data.data) {
        models.Component.insertOrUpdate({
          data: val.data.data
        })
      }
      state.result = val
    },
    setToken (state, val) {
      state.token = val
      componardoapi.defaults.headers.Authorization = `Bearer ${state.token}`
    }
  },
  getters: {
    isLoggedIn: state => {
      return state.token !== null
    },
    getTokenInfo: state => {
      return jwt_decode(state.token)
    },
    baseURLFull: state => {
      // return 'http://' + state.baseURL
      return state.baseURL
    },
    resultnum: state => {
      return (state.result?.data?.total) || 0
    },
    componentList: state => {
      if (state.result?.data?.data) {
        return state.result.data.data
      } else {
        return []
      }
    }
  },
  actions: {
    async selectActiveProject ({ commit, state }, uid) {
      var proj = await models.Projects.fetchById(uid)
      var maxnum1 = Math.max(...proj.componentcontainers.map(x => x.id))
      var maxnum2 = Math.max(...proj.links.map(x => x.id))
      proj.counter = Math.max(maxnum1, maxnum2)
      commit('setActiveProject', proj)
    },
    async downloadProjects ({ commit, state }) {
      await componardoapi.get(
        '/projects'
      ).then(r => {
        models.Projects.insertOrUpdate({ data: r.data })
        console.log(r)
      })
      // TODO: when pushing the project to the server return the newly
      // created UID on the server
    },
    async saveProject ({ commit, state }) {
      await componardoapi.post('/projects', state.activeProject
      ).then(r => {
        commit('setProjectID', r.data)
        models.Projects.insertOrUpdate({ data: state.activeProject })
        console.log(r)
      })
      // TODO: when pushing the project to the server return the newly
      // created UID on the server
    },
    async search (context, searchProps) {
      // TODO: move this function to models.js we might have a little problem here as we want to set the "loading" state
      context.commit('setSearchState', true)
      // await sleep(0) // uncomment to simulate a search
      await componardoapi
        .post('/components', searchProps)
        .then(r => {
          console.log(r)
          context.commit('updateSearchResult', r)
        })
        .catch(function (error) {
          // handle error
          console.log(error)
          context.commit('setSearchError', error)
        })
        .then(function () {
          // always executed
          // console.log('error occured!')
        })
      // await new Promise(resolve => setTimeout(resolve, 1000))
      console.log('finished searching')
      context.commit('setSearchState', false)
    },
    async initDB ({ commit, state }, reset) {
      console.log('initialize database')
      await componardoapi.get('/operations/init_db', {
        params: { delete_nodes: reset }
      }).then(r => { console.log(r) })
        .catch((error) => console.log(error))
      console.log('initialize database done')
    },
    async getSettings ({ commit, state }) {
      console.log('download settings')
      await componardoapi.get('/settings').then(r => {
        console.log(r)
        commit('setBackendSettings', r.data)
      }).catch((error) => console.log(error))
    },
    logOut (context) {
      console.log('log out!')
      context.commit('setToken', null)
    },
    async authenticate (context, { username, password, baseURL }) {
      console.log('authenticate with server!')
      console.log(username, password)
      const formData = new FormData()
      formData.set('username', username)
      formData.set('password', password)
      // console.log(FormData)

      // as we are potentially using a new URL, we should make
      // the URL explicit inside the request
      // if the request is successful, it will get updated
      await componardoapi.post(`${baseURL}/auth/jwt/login`,
        formData, { headers: { 'Content-Type': 'multipart/form-data' } }
      ).then((response) => {
        console.log(response)
        context.commit('setToken', response.data.access_token)
        context.commit('setUserName', username)
        context.commit('setBaseURL', baseURL)
      }).catch((error) => console.log(error))
    }
  }
}

export default {
  vuexModule,
  componardoapi
}

/* export default {
  namespaced: true,
  getters,
  mutations,
  actions,
  state
} */
