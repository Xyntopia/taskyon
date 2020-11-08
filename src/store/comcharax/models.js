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
  DataSheets
}
