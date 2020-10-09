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
      <q-btn
        v-if="false"
        label="Process Uploaded Components"
        color="tools"
        text-color="tools"
        @click="onProcessComponentClick"/>
      <!--<q-card>
      TODO:
      -> upload pdf
      -> process pdf
      -> inject into neo4j db
      -> get a list of uuids from injected components
      -> display components
      </q-card>
      <q-card>
      display: injected components, all components injected from this user, all injected components
      </q-card>-->
      <div>TASK LOG:
        <q-btn color="tools" text-color="primary" label="clear" @click="onClear()"/>
        <q-btn color="tools" text-color="primary" label="stop" @click="stopJobStream()"/>
      </div>
      <div class="q-col-gutter-xs">
        <div v-for="task in CurrentTasks" v-bind:key="task.id">
          <q-card>
            <q-card-section>
              <div ellipsis class="text-overline">{{ task.id }}</div>
              <div><b>status:</b> {{ task.status }}</div>
              <div v-if="task.status!='error'"><b>component-name:</b> {{ task.result.component.name }}</div>
            </q-card-section>
            <q-card-actions>
              <q-btn label="Details" unelevated
                  :to="{ name: 'task', params: { id: task.id }}"/>
            </q-card-actions>
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
