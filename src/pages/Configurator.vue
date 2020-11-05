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
                        <q-btn size='sm' padding="sm" @click="onClear">Clear</q-btn>
                        <q-btn size='sm' padding="sm">Save</q-btn>
                        <q-btn size='sm' padding="sm">New</q-btn>
                      </q-btn-group>
                    </div>
                    <q-input hide-bottom-space filled dense v-model="projectName" label="Project Name"/>
                  </q-card-actions>
                  <q-card-section style="min-height: 200px; min_width: 200px;">
                    <cytograph
                      :elementlist="componentSystem"
                      @link-add="addlink2system"
                      @selected-node="onSelectNode"
                      />
                  </q-card-section>
                </q-card>
               </div>
               <div class="col-4">
                <q-card class="fit">
                  <div class="column justify-start">
                    <div class="col"><b>Component Description</b></div>
                    <div v-if="ComponentInfoID">
                      <router-link :to="{ name: 'component', params: { uid: ComponentInfoID }}" >{{ selectedNode.name }}</router-link>
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
                @component-add="addcomponent2system"
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
      selectedNode: null
    }
  },
  computed: {
    projectName: {
      set (val) {
        this.$store.commit('comcharax/setProjectName', val)
      },
      get () {
        return this.componentSystem.name
      }
    },
    ComponentInfoID () {
      return this.selectedNode?.source
    },
    ...mapGetters('comcharax', [
      'componentList',
      'resultnum'
    ]),
    ...mapState('comcharax', [
      'searchingState',
      'componentSystem'
    ]),
    components: function () {
      return this.$store.$db().model('components')
    }
  },
  methods: {
    onCytoDelete () {
      console.log('delete')
    },
    onClear () {
      this.$store.commit('comcharax/clearNodes')
    },
    onSelectNode (node) {
      this.selectedNode = node
    },
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
      var newProject = cloneDeep(this.componentSystem)
      newProject.counter += 1
      newProject.components.push({
        id: newProject.counter.toString(),
        name: component.name,
        source: component.uid
      })
      this.$store.commit('comcharax/setComponentSystem', newProject)
    },
    addlink2system (source, target) {
      console.log('adding link')
      console.log([source, target])
      var newProject = cloneDeep(this.componentSystem)
      newProject.counter += 1
      newProject.links.push({
        id: newProject.counter.toString(),
        source: source.id,
        target: target.id
      })
      this.$store.commit('comcharax/setComponentSystem', newProject)
    }
  }
}
</script>
