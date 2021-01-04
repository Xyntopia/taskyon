/* Here we define all models which correspond to the data provideded
 * by Componardo API
 */

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
      uid: this.string(null).nullable(),
      name: this.string(null).nullable(),
      created: this.string(null).nullable(),
      modified: this.string(null).nullable(),
      summary: this.string(null).nullable(),
      image: this.string(null).nullable(),
      characteristics: this.attr({})
    }
  }

  static state () {
    return {
      searchingState: false, // TODO: use this instead of the state variable in index.js
      componentList: [],
      resultnum: 0
    }
  }

  static async search (searchProps) {
    // TODO: move this function to models.js we might have a little problem here as we want to set the "loading" state
    this.commit((state) => {
      state.searchingState = true
    })
    var self = this
    // await sleep(0) // uncomment to simulate a search
    await this.api().post(
      '/components/search',
      searchProps,
      { dataKey: 'data' })
      .then(r => {
        console.log(r)
        self.commit((state) => {
          if (r?.response?.data?.data) {
            state.componentList = r.response.data.data
            state.resultnum = r.response.data.total
          } else {
            state.componentList = []
            state.resultnum = 0
          }
        })
      })
      .catch(function (error) {
        // handle error
        console.log(error)
      })
      .then(function () {
        // always executed
        // console.log('error occured!')
        self.commit((state) => {
          state.searchingState = false
        })
      })
    console.log('finished searching')
  }

  static async fetchById (uid, allowcache = false) {
    /* if used, this request config makes sure we have
    don't get the cached result... */
    console.log('get component, allow cache=' + allowcache)
    const requestconfig = {
      headers: {
        'Cache-Control': 'max-age=0'
      }
    }

    var data = await this.api().get(
      `/components/${uid}`,
      allowcache ? {} : requestconfig
    )

    return data
  }

  static async deleteById (uid) {
    const result = await this.api().delete(`/components/${uid}`)
    return result
  }

  static async deleteByIds (uids) {
    const responses = await uids.map(uid => {
      return this.api().delete(`/components/${uid}`)
    })
    // TODO: check if all results are successfull and
    //       return all deleted IDs
    return responses
  }

  static async persistToServer (uids) {
    console.log('persist to server:' + uids)
    const components = this.findIn(uids)
    /* const responses = await components.map(co => {
      return this.api().post('/components', co)
    }) */
    const response = await this.api().post('/components', components)
    // TODO: check if all results are successfull and
    //       return all deleted IDs
    return response
  }
  // TODO: fetch multiple by ID
}

class Tasks extends Model {
  static entity = 'tasks'

  static primaryKey = 'uid'

  static fields () {
    return {
      uid: this.string(),
      status: this.string(),
      exception: this.string(),
      args: this.attr(null),
      result: this.attr(null)
    }
  }
}

class ExtractedData extends Model {
  static entity = 'ExtractedData'

  static primaryKey = 'uid'

  static fields () {
    return {
      uid: this.string(),
      source: this.string(),
      location: this.string(),
      data: this.attr(null)

      // references
      // Component: this.hasOne(Component, 'user_id')
    }
  }
}

class Projects extends Model {
  static entity = 'projects'

  static primaryKey = 'uid'

  static fields () {
    return {
      uid: this.string(),
      name: this.string(),
      componentcontainers: this.attr([]),
      links: this.attr([])
      // references
      // Component: this.hasOne(Component, 'user_id')
    }
  }

  static async fetchById (uid) {
    var data = await this.api().get(`/projects/${uid}`)
    return data.entities.projects[0]
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

export default {
  Projects,
  Component,
  Tasks,
  ExtractedData
}
