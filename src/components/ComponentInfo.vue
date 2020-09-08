<template>
  <q-card>
    {{ componentData }}
  </q-card>
</template>

<script>
// import { mapGetters, mapActions } from 'vuex'
// import { mapState, mapGetters } from 'vuex'

export default {
  name: 'ComponentInfo',
  props: {
    componentID: String
  },
  computed: {
    componentData () {
      return this.$store.$db().model('components').find(this.componentID)
      // return { name: 123 }
    }
  }
}
</script>
