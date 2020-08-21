<template>
  <q-page class="bg-secondary">
    <cytograph/>
  </q-page>
</template>

<script>
// import mxgraph from 'components/mxgraph.vue'
import cytograph from 'components/cytograph.vue'

export default {
  name: 'PageBasicSearch',
  components: {
    // mxgraph,
    cytograph
  }
}
</script>
