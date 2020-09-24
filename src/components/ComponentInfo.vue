<template>
  <q-card>
    <q-card-section class="row">
      <div class="col">
        <div class="text-h6">{{ componentData.name }}</div>
        <div class="text-weight-light">ID: {{ componentData.id }}</div>
      </div>
      <div class="col-auto">image</div>
    </q-card-section>
    <q-separator dark inset />
    <q-card-section>
      {{ componentData.summary }}
    </q-card-section>
    <q-card-section>
      <q-list separator>
        <q-item v-for="(value, name) in componentData.characteristics" v-bind:key="name">
          <b>{{ name }}</b>:&nbsp;
            <ul v-if="name==='features'">
                <li v-for="v in value" v-bind:key="v"> {{ v }} </li>
            </ul>
          <div v-else>
            {{ value }}
          </div>
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
    console.log(this.componentData)
  },
  computed: {
    componentData () {
      var data = this.$store.$db().model('components').find(this.componentID)
      if (data == null) {
        return {
          name: '',
          summary: '',
          id: this.componentID
        }
      }
      return data
      // return { name: 123 }
      // return this.$store.$db().model('components').fetchById(this.componentID)
    }
  }
}
</script>
