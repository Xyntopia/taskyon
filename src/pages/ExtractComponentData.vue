<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs column content-stretch">
    <div class="col row">
      <div class="col-auto">
      <q-uploader
          ref="pdfUploader"
          :url="baseURLFull + '/componentfileupload/'"
          :headers="[{name: 'Authorization', value: `Bearer ${token}`}]"
          label="Upload pdf files of components!"
          field-name="file"
          multiple auto-upload
          :max-file-size="30000000"
          hide-upload-btn
          @uploading="onUploadFiles"
        />
      </div>
      <div class="col">
        <q-scroll-area ref="taskScroll" class="inset-shadow bg-tools rounded-borders" style="height: 100%;">
          <q-list dense bordered separator class="q-pa-xs">
            <q-item clickable v-for="task in CurrentTasks" v-bind:key="task.uid">
              <q-item-section>
                <q-item-label><router-link :to="{ name: 'task', params: { uid: task.uid }}"
                  ellipsis style="font-size: 10px">{{ task.status }} | {{ task.uid }}</router-link>
                </q-item-label>
                <q-item-label v-if="task.status!='error'">
                    <b>component-name:</b>&nbsp;
                    <router-link :to="{ name: 'component', params: { uid: task.result.component.uid }}" >{{ task.result.component.name }}</router-link>
                    <div><b>file:</b>&nbsp;{{ task.result.debug.datasheet.source }}</div>
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-scroll-area>
      </div>
    </div>
    <div class="col">TASK LOG:
      <q-btn color="tools" text-color="primary" label="clear" @click="onClear()"/>
      <q-btn color="tools" text-color="primary" label="stop" @click="stopJobStream()"/>
    </div>
    <div class="col full-width">
      <ComponentSearch
        ref="ComponentSearch"
        :componentList="componentList"
        :totalResultNum="resultnum"
        :searchState="searchingState"
        @input="onSearchRequest"
        v-model="searchProps"
        :usegrid.sync="usegrid"
        enableSelection
        :initialColumns="['name','modified']"
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
      usegrid: false,
      es: null, // server-side event stream
      searchProps: {
        q: '',
        uuid: '',
        qmode: 'filter',
        start: 0,
        end: 10,
        sort: 'modified',
        descending: true,
        filters: [{
          type: 'field_contains',
          target: 'User.name',
          method: 'OR',
          value: ['DefaultUser']
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
        this.Tasks.insertOrUpdate({ data: data })
        const components = data.map(x => x.result?.component)
        console.log(components)
        this.Components.insertOrUpdate({ data: components })
        this.updateSearch()
        this.$refs.taskScroll.setScrollPercentage(1.0)
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
