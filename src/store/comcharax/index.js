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

  static primaryKey = 'uid'

  static fields () {
    return {
      uid: this.string(),
      name: this.attr(''),
      summary: this.attr(String),
      image: this.attr(String),
      characteristics: this.attr({})
    }
  }

  static fetchById (uid) {
    var data = this.api().get(`/components/${uid}`)
    return data
  }
}

class Tasks extends Model {
  static entity = 'tasks'

  static primaryKey = 'uid'

  static fields () {
    return {
      uid: this.string(),
      status: this.string(),
      exception: this.string(),
      result: this.attr(null)
    }
  }
}

class DataSheets extends Model {
  static entity = 'datasheets'

  static primaryKey = 'uid'

  static fields () {
    return {
      uid: this.string(),
      origin: this.string(),
      original_filename: this.string(),
      location: this.string(),
      data: this.attr(null)

      // references
      // Component: this.hasOne(Component, 'user_id')
    }
  }
}

/* class Search extends Model {
  static entity = 'searches'

  static fields () {
    return {
      id: this.increment(),
      q: this.string(''),
      qmode: this.string(''),
      filters: this.attr({})
    }
  }

  static
} */

/*
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
*/

var vuexModule = {
  state: {
    result: null,
    baseURL: 'http://localhost:5000',
    searchingState: false,
    dbState: {}
  },
  mutations: {
    setSearchError (state, error) {
      state.result = {}
    },
    setSearchState (state, val) {
      state.searchingState = val
    },
    updateSearchResult (state, val) {
      // TODO: what if data is none?
      if (val.data.data) {
        Component.insertOrUpdate({
          data: val.data.data
        })
      }
      state.result = val
    }
  },
  getters: {
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
    async search (context, searchProps) {
      context.commit('setSearchState', true)
      // await sleep(0) // uncomment to simulate a search
      await axios
        .get('/components', { params: searchProps })
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
    async initDB (context) {
      console.log('initialize database')
      await axios
        .post('/operations/init_db', { delete_nodes: false })
        .then(r => {
          console.log(r)
          // context.commit('initialized!', r)
        })
      console.log('initialize database done')
    }
  }
}

export default {
  vuexModule,
  Component,
  Tasks,
  DataSheets
}

/* export default {
  namespaced: true,
  getters,
  mutations,
  actions,
  state
} */
