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
                      <q-btn-group push>
                        <q-btn size='sm' padding="sm" @click="onCalculateLayout">Layout</q-btn>
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
                      hide-bottom-space outlined dense
                      v-model="selectedProject" :options="ProjectNamesAndUIDs"
                      label="Select Project">
                      <template v-slot:before>
                        <q-btn icon="edit" round dense @click="editName = !editName"/>
                      </template>
                    </q-select>
                  </q-card-actions>
                  <q-card-section style="min-height: 200px; min_width: 200px;">
                    <cytograph
                      ref="CytoGraph"
                      :elementlist="activeProject"
                      @link-add="addlink2system"
                      @selected-node="onSelectNode"
                      @selected-edge="onSelectLink"
                      />
                  </q-card-section>
                </q-card>
               </div>
               <div class="col-4">
                <q-card class="fit">
                  <q-card-section v-if="ComponentInfoIDs" class="col"><b>Component Description</b><br>
                    {{ selectedNode.name }}
                    <div v-for="uid in ComponentInfoIDs" :key="uid">
                      <router-link :to="{ name: 'component', params: { uid: uid }}" >{{ uid }}</router-link>
                    </div>
                    <q-separator inset spaced/>
                    <q-btn dense class="bg-tools" label="Compatible Components" icon="search"
                      @click="$refs.ComponentSearch.searchCompatible(ComponentInfoID)"/>
                    <div class="text-info">search for interfaces:</div>
                    <div class="q-gutter-md">
                      <q-btn v-for="intf in possibleInterfaces" :key="intf" :label="intf"
                        dense
                        class="bg-tools"
                        @click="onInterfaceSearch(intf)"/>
                    </div>
                  </q-card-section>
                  <q-card-section v-else-if="selectedLink" class="col"><b>Link Description</b><br>
                    <q-select
                      class="bg-tools"
                      hide-bottom-space outlined dense
                      new-value-mode="add-unique"
                      use-input
                      @input="setNewLinkInterface"
                      v-model="selectedLinkInterface" :options="possibleInterfaces"
                      label="Selected Interface"/>
                  </q-card-section>
                </q-card>
               </div>
              </div>
            </div>
            <div class='col-1'>
              <ComponentSearch
                ref="ComponentSearch"
                :componentList="componentList"
                :searchState="searchingState"
                :totalResultNum="resultnum"
                showAddButton
                @component-add="addcomponent2system"
                class="bg-white"
                @input="onSearchRequest"
                :value="searchProps"
                />
            </div>
            <div class="col-1">
              <q-card>
                BoM TODO: as tabbed interface on one of the above windows
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
      searchProps: { qmode: 'filters', filters: [] },
      model: null,
      selectedNode: null,
      selectedLink: null,
      selectedLinkInterface: null,
      editName: false,
      editInterfaceName: false,
      lastInterfaceSearch: null
    }
  },
  mounted () {
    this.$store.dispatch('comcharax/downloadProjects')
  },
  computed: {
    possibleInterfaces () {
      if (this.selectedNode) {
        const intfs = this.selectedComponent?.characteristics?.interfaces
        return intfs
      } else if (this.selectedLink) {
        const n1 = this.selectedLink.sourceUID
        const n2 = this.selectedLink.targetUID
        const intf1 = this.Components.find(n1)?.characteristics?.interfaces
        const intf2 = this.Components.find(n2)?.characteristics?.interfaces

        return intf1.filter(x => intf2.includes(x))
      }
      return []
    },
    selectedComponent () {
      return this.Components.find(this.ComponentInfoID)
    },
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
    ComponentInfoID () {
      return this.selectedNode?.componentIDs[0]
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
    setNewLinkInterface (value) {
      console.log('set link type')
      // eslint-disable-next-line
      const idx = this.activeProject.links.findIndex(l => l.id == this.selectedLink.id)
      // this.activeProject.links[idx] = value
      this.$set(this.activeProject.links[idx], 'type', value)
    },
    onCalculateLayout (intf) {
      this.$refs.CytoGraph.updategraph()
    },
    onInterfaceSearch (intf) {
      this.searchProps.qmode = 'filter'
      this.lastInterfaceSearch = intf
      const newfilter = {
        type: 'field_contains',
        target: 'Interface.name',
        method: 'OR',
        value: [intf]
      }
      if (!this.searchProps) {
        this.searchProps = {}
      }
      if (this.searchProps.filters) {
        const index = this.searchProps.filters.findIndex(f =>
          f.type === 'field_contains' && f.target === 'Interface.name' && f.method === 'OR'
        )
        if (index === -1) {
          this.searchProps.filters.push(newfilter)
        } else {
          this.$set(this.searchProps.filters, index, newfilter)
        }
      } else {
        this.searchProps.filters = [newfilter]
      }
      this.$store.dispatch('comcharax/search', this.searchProps)
    },
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
      console.log('select node')
      this.selectedNode = node
      this.Components.fetchById(node.componentIDs[0])
      this.selectedLink = null
    },
    onSelectLink (link, c1, c2) {
      console.log('select link')
      this.selectedNode = null
      this.Components.fetchById(c1)
      this.Components.fetchById(c2)
      link.sourceUID = c1
      link.targetUID = c2
      this.selectedLinkInterface = link.type
      this.selectedLink = link
    },
    onSearchRequest (searchProps) {
      console.log('new configuration search')
      var newSearchProps = cloneDeep(searchProps)
      console.log(newSearchProps)
      this.$store.dispatch('comcharax/search', newSearchProps)
      this.searchProps = newSearchProps
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
      const newNodeID = newProject.counter.toString()
      newProject.componentcontainers.push({
        id: newNodeID,
        name: component.name,
        componentIDs: [component.uid],
        type: 'component'
      })
      if (this.lastInterfaceSearch) {
        newProject.counter += 1
        newProject.links.push({
          id: newProject.counter.toString(),
          source: this.selectedNode.id,
          target: newNodeID,
          type: this.lastInterfaceSearch
        })
      }
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
