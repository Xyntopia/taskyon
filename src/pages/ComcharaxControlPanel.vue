<template>
  <q-page class="bg-secondary q-pa-md q-col-gutter-xs">
    <q-input
    outlined bg-color="white" dense
    label="Comcharax API URL" v-model="url_graphengine"
    type="url" debounce="500"
    />
    <q-input
    outlined bg-color="white" dense
    label="filter webpages" v-model="page_filter"
    type="url" debounce="500"
    />
  </q-page>
</template>

<script>

export default {
  name: 'Comacharax Control Panel',
  components: {
  },
  data () {
    return {
      url_graphengine: 'http://localhost:5000',
      page_filter: '*'
    }
  }
}
</script>
