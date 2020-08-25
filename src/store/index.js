import Vue from 'vue'
import Vuex from 'vuex'
import axios from 'axios'

axios.defaults.headers.post['Access-Control-Allow-Origin'] = '*'
// axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded';
axios.defaults.baseURL = 'http://localhost:5000'
// axios.defaults.headers.common['Authorization'] = AUTH_TOKEN;
/*  baseURL: ,
  timeout: 1000,
  headers: {'X-Custom-Header': 'foobar'} */
// var graphengineApi = axios.create()

// TODO: currently vue modules are not in use... we might need this later though
// import example from './module-example'

// TODO: think abot employing the followin vuex plugins:
// - https://github.com/christianmalek/vuex-rest-api
// - https://github.com/vuex-orm/vuex-orm + https://github.com/vuex-orm/plugin-axios
// - https://github.com/imcvampire/vue-axios

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
      result: [],
      searchstring: '',
      searchingState: false
    },
    mutations: {
      increment (state) {
        state.count++
      },
      updateSearchString (state, searchstring) {
        state.searchstring = searchstring
        state.result = searchstring.split('')
      },
      setSearchState (state, val) {
        state.searchingState = val
      },
      updateSearchResult (state, val) {
        state.result = val
      }
    },
    getters: {
      componentlist: state => {
        return state.result
      }
    },
    actions: {
      async search (context, val) {
        context.commit('updateSearchString', val)
        context.commit('setSearchState', true)
        await axios
          .get(
            // '/components?_end=10&_order=ASC&_sort=id&_start=0&q=test',
            '/components',
            {
              params: {
                q: val,
                _end: '10',
                _start: '0',
                _sort: 'id'
              }
            })
          .then(r => {
            console.log(r)
            context.commit('updateSearchResult', r)
          })
          .catch(function (error) {
            // handle error
            console.log(error)
          })
          .then(function () {
            // always executed
            console.log('error occured!')
          })
        // await new Promise(resolve => setTimeout(resolve, 1000))
        console.log('finished searching')
        context.commit('setSearchState', false)
      }
    },
    // enable strict mode (adds overhead!)
    // for dev mode only
    strict: process.env.DEV
  })

  return Store
}
