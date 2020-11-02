<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs column">
    <div class="row">
    <div class="col-auto">
     <q-uploader
        ref="pdfUploader"
        :url="baseURLFull + '/componentfileupload/'"
        :headers="[{name: 'Authorization', value: `Bearer ${token}`}]"
        label="Upload pdf files of components!"
        field-name="file"
        multiple auto-upload
        hide-upload-btn
        @uploading="onUploadFiles"
      />
    </div>
    <div class="col column q-col-gutter-xs">
      <div>TASK LOG:
        <q-btn color="tools" text-color="primary" label="clear" @click="onClear()"/>
        <q-btn color="tools" text-color="primary" label="stop" @click="stopJobStream()"/>
      </div>
      <div class="q-col-gutter-xs">
        <div v-for="task in CurrentTasks" v-bind:key="task.uid">
          <q-card>
            <q-card-section>
              <div class="text-overline">
                <router-link :to="{ name: 'task', params: { uid: task.uid }}" ellipsis>{{ task.uid }}</router-link>
              </div>
              <div><b>status:</b>&nbsp;{{ task.status }}</div>
              <div v-if="task.status!='error'"><b>component-name:</b>&nbsp;
                <router-link :to="{ name: 'component', params: { uid: task.result.component.uid }}" >{{ task.result.component.name }}</router-link>
                <div><b>file:</b>&nbsp;{{ task.result.debug.datasheet.original_filename }}</div>
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div></div>
    <div class="col">
      TODO: only show the table, without search options
      <ComponentSearch
        :componentList="componentList"
        :totalResultNum="resultnum"
        :searchState="searchingState"
        @input="onSearchRequest"
        v-model="searchProps"
        />
    </div>
  </q-page>
</template>

<!--<style lang="sass">
</style>-->

<script>
import ComponentSearch from 'components/ComponentSearch.vue'
import { mapGetters, mapState } from 'vuex'
var cloneDeep = require('lodash.clonedeep')

// as we want the ability to use an authorization header, wee need to usr the polyfill
import { EventSourcePolyfill } from 'event-source-polyfill'

export default {
  name: 'ExtractComponentData',
  components: {
    ComponentSearch
  },
  data () {
    return {
      jobIDs: [],
      es: null, // server-side event stream
      searchProps: {
        q: '',
        uuid: '',
        qmode: 'filter',
        start: 0,
        end: 10,
        sort: 'id',
        desc: true,
        filters: [{
          type: 'field_contains',
          target: 'User.name',
          method: 'OR',
          value: ['DefaultUser', 'Scraper']
        }]
      }
    }
  },
  /*
  created () {
    this.updateSearch()
  },
  */
  activated () {
    // if the page was cached, we need to change the data inside vuex store...
    console.log('activating extract components..')
    this.updateSearch()
  },
  /* watch: {
    $route: function (to, from) {
      console.log({ to: to, from: from })
      console.log(to.path)
      if (to.path === '/extractcomponentdata') {
        console.log('watched route!!!')
      }
    }
  }, */
  /* mounted () {
    this.updateSearch()
  }, */
  beforeDestroy () {
    this.stopJobStream()
  },
  computed: {
    Tasks () {
      return this.$store.$db().model('tasks')
    },
    Components () {
      return this.$store.$db().model('components')
    },
    DataSheets () {
      return this.$store.$db().model('datasheets')
    },
    CurrentTasks () {
      return this.Tasks.findIn(this.jobIDs)
    },
    ...mapGetters('comcharax', [
      'componentList',
      'resultnum',
      'baseURLFull'
    ]),
    ...mapState('comcharax', [
      'searchingState',
      'token',
      'baseURL'
    ])
  },
  methods: {
    onSearchRequest (searchProps) {
      console.log('new configuration search')
      var newSearchProps = cloneDeep(searchProps)
      console.log(newSearchProps)
      this.$store.dispatch('comcharax/search', newSearchProps)
    },
    onUploadFiles (info) {
      // start listening to server for finished file processing
      if (this.es === null) {
        this.setupJobStream()
      }
    },
    onClear () {
      this.jobIDs = []
      // this.$refs.pdfUploader.removeUploadedFiles()
      this.$refs.pdfUploader.reset()
    },
    stopJobStream () {
      console.log('disconnect from Server!')
      if (this.es) {
        this.es.close()
      }
      this.es = null
    },
    updateSearch () {
      // update search results
      this.$store.dispatch('comcharax/search', this.searchProps)
    },
    setupJobStream () {
      // Not a real URL, just using for demo purposes
      this.es = new EventSourcePolyfill(this.baseURLFull + '/jobstream', {
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      })

      this.es.addEventListener('jobstatus', event => {
        console.log(event)
        const data = JSON.parse(event.data)
        console.log(data)
        this.jobIDs.push(...data.map(x => x.uid))
        this.Tasks.insert({ data: data })
        const components = data.map(x => x.result?.component)
        console.log(components)
        this.Components.insert({ data: components })

        // check if debugdata is included
        const componentsFull = data.map(x => x.result?.debug?.component)
        this.Components.insert({ data: componentsFull })
        const dataSheets = data.map(x => x.result?.debug?.datasheet)
        this.DataSheets.insert({ data: dataSheets })

        this.updateSearch()
      })

      this.es.addEventListener('open', event => {
        // Logic to handle status updates
        console.log(event)
      })

      this.es.addEventListener('error', event => {
        console.log(event)
        if (event.readyState === EventSource.CLOSED) {
          console.log('Event was closed')
          console.log(EventSource)
          this.es.close()
          this.es = null
        }
      })

      this.es.addEventListener('end', event => {
        console.log('Handling end....')
        this.es.close()
        this.es = null
      })
    }
  }
}
</script>
