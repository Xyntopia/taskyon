<template>
  <q-card v-if="componentData">
    <q-card-section class="row">
      <div class="col">
        <div class="text-h6">{{ componentData.name }}</div>
        <div class="text-weight-light">ID: {{ componentData.uid }}</div>
      </div>
      <div class="col-auto">image</div>
    </q-card-section>
    <q-separator dark inset />
    <q-card-section>
      {{ componentData.summary }}
    </q-card-section>
    <q-card-section>
      <!--<q-scroll-area style="height: 200px;">-->
      <!--TODO: replace this with a table to align left side names-->
        <q-list separator>
          <q-item v-for="(value, name) in componentData.characteristics" v-bind:key="name">
            <q-item-section class="col-auto">
              <b>{{ name }}:</b>
            </q-item-section>
            <q-item-section top class="col">
              <ul v-if="name==='features'">
                  <li v-for="v in value" v-bind:key="v"> {{ v }} </li>
              </ul>
              <div v-else>
                <ValueCell :value="value" style="width: 100%"
                  @input="onCharacteristicChange(name, $event)"/>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      <!--/q-scroll-area-->
    </q-card-section>
    <q-card-section>
      <div class="row justify-between">
        <q-btn label="delete" text-color="primary" color="tools"/>
        <q-btn label="save" text-color="primary" color="tools"/>
      </div>
    </q-card-section>
  </q-card>
  <q-card v-else>
    Component with ID: {{ componentID }} does not exist in our database!
  </q-card>
</template>

<script>
import ValueCell from 'components/ValueCell.vue'

export default {
  name: 'ComponentInfo',
  props: {
    componentID: String
  },
  components: {
    ValueCell
  },
  data () {
    return {
      editState: []
    }
  },
  created () {
    console.log('download component with ID')
    console.log(this.componentID)
    this.Components.fetchById(this.componentID)
    console.log(this.componentData)
  },
  methods: {
    onCharacteristicChange (name, value) {
      console.log('changed to: ' + value)
      const chars = {
        ...this.componentData.characteristics,
        [name]: value
      }
      const newdata = { uid: this.componentData.uid, characteristics: chars }
      this.Components.insertOrUpdate({
        data: newdata
      })
      // TODO: move the following in its own function and introuce a "global" button
      // to sync local data with the server
      // this.Components.persistToServer([this.componentData.uid])
    }
  },
  computed: {
    Components () {
      return this.$store.$db().model('components')
    },
    componentData () {
      return this.Components.find(this.componentID)
      // return { name: 123 }
      // return this.$store.$db().model('components').fetchById(this.componentID)
    }
  }
}
</script>
