<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs">
    <div>
     <q-uploader
        url="http://localhost:5000/componentfileupload/"
        label="Upload pdf files of components!"
        field-name="file"
        multiple auto-upload
      />
    </div>
    <div>
      <q-btn label="Process Uploaded Components" color="tools" text-color="tools"/>
      <q-card>
      TODO:
      -> upload pdf
      -> process pdf
      -> inject into neo4j db
      -> get a list of uuids from injected components
      -> display components
      </q-card>
      <q-card>
      display: injected components, all components injected from this user, all injected components
      </q-card>
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
      urlGraphengine: 'localhost:5000',
      pageFilter: '*',
      searchDir: ''
    }
  }
}
</script>
