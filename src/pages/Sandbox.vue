<template>
  <q-page class="bg-secondary">
    <q-btn color="white" text-color="black" label="vuex-test" @click="increment"/>
    <q-card>{{ count }}</q-card>
  </q-page>
</template>

<script>
// import mxgraph from 'components/mxgraph.vue'

// import { mapState } from 'vuex'

export default {
  name: 'PageBasicSearch',
  methods: {
    increment () {
      console.log('pressed button....')
      this.$store.commit('increment')
      console.log(this.$store.state.count)
    }
  }
}
</script>
