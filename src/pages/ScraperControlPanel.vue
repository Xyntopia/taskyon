<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs">
    <q-input
    outlined bg-color="white"
    label="Comcharax API URL" v-model="urlGraphengine"
    type="url" debounce="500" prefix="http://"
    />
    <q-input
    outlined bg-color="white"
    label="filter webpages" v-model="pageFilter"
    type="url" debounce="500"
    />

    <q-file outlined bg-color="white" v-model="searchDir" label="Select Directory for Searching" hidden webkitdirectory directory/>
    <q-btn color="primary" label="Search for Components"/>

  </q-page>
</template>

<script>

export default {
  name: 'ComcharaxControlPanel',
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
