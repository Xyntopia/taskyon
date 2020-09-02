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

class Component extends Model {
  static entity = 'components'

  static fields () {
    return {
      id: this.attr(null),
      name: this.attr('')
    }
  }
}

var vuexModule = {
  state: {
    result: [],
    activeComponentSystem: {
      counter: 0,
      name: 'new system',
      id: '00000000',
      components: [],
      links: []
    },
    opensystem: {},
    searchstring: '',
    searchingState: false
  },
  mutations: {
    updateSearchString (state, searchstring) {
      state.searchstring = searchstring
    },
    setSearchState (state, val) {
      state.searchingState = val
    },
    updateSearchResult (state, val) {
      state.result = val
    },
    resetComponentSystem (state) {
      state.activeComponentSystem = {
        counter: 0,
        name: 'new system',
        id: '00000000',
        components: [],
        links: []
      }
    },
    // adds a component with new id to the active system
    addComponent2System (state, id) {
      // var component =
      state.activeComponentSystem.counter += 1
      state.activeComponentSystem.components.push({
        id: state.activeComponentSystem.counter,
        name: 'asdasdaTODO',
        source: id
      })
    }
  },
  getters: {
    componentSystem: state => {
      return state.activeComponentSystem
    },
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
