<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs row">
    <div class="col-auto">
     <q-uploader
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
        <q-btn
          color="tools" text-color="primary" label="clear" @click="jobData={}"/>
      </div>
      <div v-for="(value, job) in jobData" v-bind:key="job">
        <q-card>
        {{ job }}: {{ value }}
        </q-card>
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
      jobData: {},
      es: null
    }
  },
  /* created () {
    // this.setupJobStream()
    console.log('connection to job-stream is ready')
  }, */
  beforeDestroy () {
    console.log('disconnect from Server!')
    this.es.close()
    this.es = null
  },
  methods: {
    onUploadFiles (info) {
      // start listening to server for finished file processing
      if (this.es === null) {
        this.setupJobStream()
      }
    },
    setupJobStream () {
      // Not a real URL, just using for demo purposes
      this.es = new EventSource(this.baseURL + '/jobstream')

      this.es.addEventListener('jobstatus', event => {
        console.log(event)
        const data = JSON.parse(event.data)
        console.log(data)
        this.jobData = { ...this.jobData, ...data }
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
