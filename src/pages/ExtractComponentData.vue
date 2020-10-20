<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs row">
    <div class="col-auto">
     <q-uploader
        ref="pdfUploader"
        :url="baseURL + '/componentfileupload/'"
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
        <div v-for="task in CurrentTasks" v-bind:key="task.id">
          <q-card>
            <q-card-section>
              <div class="text-overline">
                <router-link :to="{ name: 'task', params: { id: task.id }}" ellipsis>{{ task.id }}</router-link>
              </div>
              <div><b>status:</b>&nbsp;{{ task.status }}</div>
              <div v-if="task.status!='error'"><b>component-name:</b>&nbsp;
                <router-link :to="{ name: 'component', params: { id: task.result.component.id }}" >{{ task.result.component.name }}</router-link>
              </div>
              <div><b>file:</b>&nbsp;{{ task.result.debug.datasheet.original_filename }}</div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<!--<style lang="sass">
</style>-->

<script>

export default {
  name: 'ExtractComponentData',
  components: {
  },
  data () {
    return {
      baseURL: 'http://localhost:5000',
      pageFilter: '*',
      searchDir: '',
      jobIDs: [],
      es: null
    }
  },
  /* created () {
    // this.setupJobStream()
    console.log('connection to job-stream is ready')
  },  */
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
    }
  },
  methods: {
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
    setupJobStream () {
      // Not a real URL, just using for demo purposes
      this.es = new EventSource(this.baseURL + '/jobstream')

      this.es.addEventListener('jobstatus', event => {
        console.log(event)
        const data = JSON.parse(event.data)
        console.log(data)
        this.jobIDs.push(...data.map(x => x.id))
        this.Tasks.insert({ data: data })
        const components = data.map(x => x.result?.component)
        console.log(components)
        this.Components.insert({ data: components })

        // check if debugdata is included
        const componentsFull = data.map(x => x.result?.debug?.component)
        this.Components.insert({ data: componentsFull })
        const dataSheets = data.map(x => x.result?.debug?.datasheet)
        this.DataSheets.insert({ data: dataSheets })
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
