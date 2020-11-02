<template>
  <q-page class="bg-secondary">
      <div class="column">
        <!--<div class="fit column justify-start items-center">-->
          <div class="q-col-gutter-xs">
            <div class="col-1">
              <div class="row q-col-gutter-xs">
               <div class="col-8">
                <q-card>
                  <!--<mxgraph/>-->
                  <q-card-actions align="between">
                    <div>
                      <q-btn-group push>
                        <q-btn size='sm' padding="sm">Clear</q-btn>
                        <q-btn size='sm' padding="sm">Layout</q-btn>
                        <q-btn size='sm' padding="sm">Fit</q-btn>
                        <q-btn size='sm' padding="sm">New</q-btn>
                      </q-btn-group>
                    </div>
                    <q-input hide-bottom-space filled dense v-model="componentSystem.name" label="System Name"/>
                  </q-card-actions>
                  <q-card-section style="min-height: 200px; min_width: 200px;">
                    <cytograph
                      v-bind:elementlist="componentSystem"
                      v-on:link-add="addlink2system"
                      />
                  </q-card-section>
                </q-card>
               </div>
               <div class="col-4">
                <q-card class="fit">
                  <div class="column justify-start">
                    <div class="col"><b>Component Description</b></div>
                    <div>description</div>
                    <div class="col">
                      add/remove
                    </div>
                  </div>
                </q-card>
               </div>
              </div>
            </div>
            <div class='col-1'>
              <ComponentSearch
                :componentList="componentList"
                :searchState="searchingState"
                :totalResultNum="resultnum"
                showAddButton
                v-on:component-add="addcomponent2system"
                class="bg-white"
                @input="onSearchRequest"
                v-model="searchProps"
                />
            </div>
            <div class="col-1">
              <q-card>
                BoM
              </q-card>
            </div>
          </div>
      </div>
  </q-page>
</template>

<script>
// import mxgraph from 'components/mxgraph.vue'
import cytograph from 'components/cytograph.vue'
import ComponentSearch from 'components/ComponentSearch.vue'
import { mapGetters, mapState } from 'vuex'
var cloneDeep = require('lodash.clonedeep')

export default {
  name: 'PageConfigurator',
  components: {
    cytograph,
    ComponentSearch
  },
  data () {
    return {
      searchProps: {},
      model: null,
      options: null,
      componentSystem: {
        counter: 0,
        name: 'new system',
        uid: '00000000',
        components: [],
        links: []
      }
    }
  },
  computed: {
    ...mapGetters('comcharax', [
      'componentList',
      'resultnum'
    ]),
    ...mapState('comcharax', [
      'searchingState'
    ]),
    components: function () {
      return this.$store.$db().model('components')
    }
  },
  methods: {
    onSearchRequest (searchProps) {
      console.log('new configuration search')
      var newSearchProps = cloneDeep(searchProps)
      console.log(newSearchProps)
      this.$store.dispatch('comcharax/search', newSearchProps)
    },
    setModel (val) {
      console.log('new input text: ' + val)
      this.model = val
    },
    // adds a component with new id to the active system
    addcomponent2system (row) {
      console.log('add component to system: ' + row.uid)
      var component = this.components.find(row.uid)
      // var component = this.Component().find(row.uid)
      console.log(component)
      this.componentSystem.counter += 1
      this.componentSystem.components.push({
        id: this.componentSystem.counter.toString(),
        name: component.name,
        source: component.uid
      })
    },
    addlink2system (source, target) {
      console.log('adding link')
      console.log([source, target])
      this.componentSystem.counter += 1
      this.componentSystem.links.push({
        id: this.componentSystem.counter.toString(),
        source: source.id,
        target: target.id
      })
    }
  }
}
</script>
