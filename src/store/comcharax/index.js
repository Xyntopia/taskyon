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

axios.defaults.headers.post['Access-Control-Allow-Origin'] = '*'
// axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded';
axios.defaults.baseURL = 'http://localhost:5000'
// axios.defaults.headers.common['Authorization'] = AUTH_TOKEN;
/*  baseURL: ,
  timeout: 1000,
  headers: {'X-Custom-Header': 'foobar'} */
// var graphengineApi = axios.create()

import { Model } from '@vuex-orm/core'

// TODO:
// Component class gets added to the store in the index.js of
// the root vuex namespace. this can probably done in a better way.
// because of this we can still use "Component" here, but we
// don't have the registration in the VuexORM database here.
// For this look in the index.js file in the parent directory.
class Component extends Model {
  static entity = 'components'

  static fields () {
    return {
      id: this.attr(null),
      name: this.attr(''),
      keywords: this.attr([])
    }
  }
}

var vuexModule = {
  state: {
    result: [],
    searchString: '',
    searchMode: 'text',
    filters: [],
    searchingState: false
  },
  mutations: {
    updateSearchString (state, searchstring) {
      state.searchString = searchstring
    },
    setSearchState (state, val) {
      state.searchingState = val
    },
    updateSearchResult (state, val) {
      // TODO: what if data us none?
      Component.insert({
        data: val.data.data
      })
      state.result = val
    }
  },
  getters: {
    componentlist: state => {
      if (state.result.data) {
        if (state.result.data.data) {
          return state.result.data.data
        }
      } else {
        return []
      }
    }
  },
  actions: {
    async search (context, val) {
      context.commit('updateSearchString', val)
      context.commit('setSearchState', true)
      await axios
        .get(
          // '/components?_end=10&_order=ASC&_sort=id&_start=0&q=test',
          '/components', {
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
          // console.log('error occured!')
        })
      // await new Promise(resolve => setTimeout(resolve, 1000))
      console.log('finished searching')
      context.commit('setSearchState', false)
    }
  }
}

export default {
  vuexModule,
  Component
}

/* export default {
  namespaced: true,
  getters,
  mutations,
  actions,
  state
} */
