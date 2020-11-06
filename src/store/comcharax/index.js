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
    setToken (state, val) { state.token = val }
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
    async saveProject ({ commit, state }) {
      await componardoapi.post(
        '/projects',
        state.activeProject,
        { headers: { Authorization: `Bearer ${state.token}` } }
      ).then(r => {
        commit('setProjectID', r.data)
        models.Projects.insert({ data: state.activeProject })
        console.log(r)
      })
      // TODO: when pushing the project to the server return the newly
      // created UID on the server
    },
    async search (context, searchProps) {
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
      await componardoapi
        .get('/operations/init_db', {
          params: { delete_nodes: reset },
          headers: { Authorization: `Bearer ${state.token}` }
        })
        .then(r => { console.log(r) })
        .catch((error) => console.log(error))
      console.log('initialize database done')
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
      await componardoapi
        .post(`${baseURL}/auth/jwt/login`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          }
        )
        .then((response) => {
          console.log(response)
          context.commit('setToken', response.data.access_token)
          context.commit('setUserName', username)
          context.commit('setBaseURL', baseURL)
        })
        .catch((error) => console.log(error))
    },
    async getSettings (context) {
      console.log('get settings ...')
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
