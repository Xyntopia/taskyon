<template>
  <q-card>
    <q-card-section>
      <div class="text-h6">{{ componentData.name }}</div>
    </q-card-section>
    <q-separator dark inset />
    <q-card-section>
      {{ componentData.summary }}
    </q-card-section>
    <q-card-section>
      <q-list separator>
        <q-item v-for="(value, name) in componentData.characteristics" v-bind:key="name">
          <b>{{ name }}</b>: {{ value }}
        </q-item>
      </q-list>
    </q-card-section>
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
  created () {
    console.log('download component with ID')
    console.log(this.componentID)
    this.$store.$db().model('components').fetchById(this.componentID)
  },
  computed: {
    componentData () {
      return this.$store.$db().model('components').find(this.componentID)
      // return { name: 123 }
      // return this.$store.$db().model('components').fetchById(this.componentID)
    }
  }
}
</script>
