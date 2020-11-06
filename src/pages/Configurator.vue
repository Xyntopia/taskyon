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
                        <q-btn size='sm' padding="sm" @click="onClearProject">Clear</q-btn>
                        <q-btn size='sm' padding="sm" @click="onSaveProject">Save</q-btn>
                        <q-btn size='sm' padding="sm" @click="onNewProject">New</q-btn>
                      </q-btn-group>
                    </div>
                    <q-input v-if="editName"
                      dense hide-bottom-space filled label="Edit Project Name"
                      v-model="projectName"
                      @keydown.enter.prevent="editName = !editName">
                      <template v-slot:before>
                        <q-btn icon="edit" round dense @click="editName = !editName"/>
                      </template>
                    </q-input>
                    <q-select v-else
                      hide-bottom-space filled dense
                      v-model="selectedProject" :options="ProjectNamesAndUIDs"
                      label="Select Project">
                      <template v-slot:before>
                        <q-btn icon="edit" round dense @click="editName = !editName"/>
                      </template>
                    </q-select>
                  </q-card-actions>
                  <q-card-section style="min-height: 200px; min_width: 200px;">
                    <cytograph
                      :elementlist="activeProject"
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
                    <div v-if="ComponentInfoIDs">
                      {{ selectedNode.name }}
                      <div v-for="uid in ComponentInfoIDs" :key="uid">
                        <router-link :to="{ name: 'component', params: { uid: uid }}" >{{ uid }}</router-link>
                      </div>
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
      selectedNode: null,
      editName: false
    }
  },
  mounted () {
    this.$store.dispatch('comcharax/downloadProjects')
  },
  computed: {
    projectName: {
      set (val) {
        this.$store.commit('comcharax/setProjectName', val)
      },
      get () {
        return this.activeProject.name
      }
    },
    selectedProject: {
      set (val) {
        console.log('load new project ...')
        // var name = val.name
        var uid = val.value
        this.$store.dispatch('comcharax/selectActiveProject', uid)
      },
      get () {
        return this.activeProject.name
      }
    },
    Projects () {
      return this.$store.$db().model('projects')
    },
    ProjectNamesAndUIDs () {
      return this.Projects.all().map(x => {
        return { label: x.name, value: x.uid }
      })
    },
    ComponentInfoIDs () {
      return this.selectedNode?.componentIDs
    },
    Components () {
      return this.$store.$db().model('components')
    },
    ...mapGetters('comcharax', [
      'componentList',
      'resultnum'
    ]),
    ...mapState('comcharax', [
      'searchingState',
      'activeProject'
    ])
  },
  methods: {
    onCytoDelete () {
      console.log('delete')
    },
    onSaveProject () {
      console.log('save project')
      this.$store.dispatch('comcharax/saveProject')
    },
    onNewProject () {
      console.log('new project!')
      this.$store.commit('comcharax/createNewProject')
    },
    onClearProject () {
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
      var component = this.Components.find(row.uid)
      // var component = this.Component().find(row.uid)
      console.log(component)
      var newProject = cloneDeep(this.activeProject)
      newProject.counter += 1
      newProject.componentcontainers.push({
        id: newProject.counter.toString(),
        name: component.name,
        componentIDs: [component.uid],
        type: 'component'
      })
      this.$store.commit('comcharax/setActiveProject', newProject)
    },
    addlink2system (source, target) {
      // TODO: make interface selectable or choose default interface
      console.log('adding link')
      console.log([source, target])
      var newProject = cloneDeep(this.activeProject)
      newProject.counter += 1
      newProject.links.push({
        id: newProject.counter.toString(),
        source: source.id,
        target: target.id,
        type: 'some_interface'
      })
      this.$store.commit('comcharax/setActiveProject', newProject)
    }
  }
}
</script>
