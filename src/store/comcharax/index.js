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
// import localForage from 'localforage'

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
    baseURL: initialURL,
    neo4jURI: 'neo4j:7687',
    neo4jPW: 'TODO',
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
      'Starred Components': {
        type: 'field_contains',
        target: 'User.name',
        method: 'OR',
        value: ['DefaultUser']
      },
      'Accessible Components': {
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
      state.baseURL = val
    },
    setToken (state, val) {
      state.token = val
    }
  },
  getters: {
    isLoggedIn ({ token }) {
      return token !== null
    },
    token ({ token }) {
      return token
    },
    getTokenInfo: state => {
      return jwt_decode(state.token)
    },
    baseURLFull: state => {
      // return 'http://' + state.baseURL
      return state.baseURL
    }
  },
  actions: {
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
