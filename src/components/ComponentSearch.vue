<template>
    <div class="row">
      <div class="col-sm col-xs-auto column">
        <div class="col-auto">
          <q-toolbar
            class="q-px-none shadow-2 rounded-borders componentSearchBar">
            <q-input
              class="col"
              filled
              bg-color="white"
              :value="value.q"
              :loading="searchState"
              type="search"
              autofocus
              :dense="false"
              clearable
              debounce="1000"
              :label="searchHint"
              @input="onQChange"
              >
              <template v-slot:append>
                <q-btn round flat @click="requestSearch" icon="search"/>
              </template>
            </q-input>
            <q-btn
              flat stretch dense :icon="usegrid ? 'view_list': 'view_module'"
              @click="$emit('update:usegrid', !usegrid)" aria-label="Table"/>
            <q-btn flat stretch icon="filter_list" @click="toggleFilter"/>
          </q-toolbar>
        </div>
        <!--<q-separator inset spaced/>-->
        <div class="col q-py-xs full-width">
          <q-table
            :loading="searchState"
            :dense="denselayout"
            :wrap-cells="false"
            :data="componentList"
            row-key="uid"
            :columns="columns"
            :visible-columns="visible_columns"
            :grid="usegrid"
            :grid-header="false"
            :card-container-class="'q-col-gutter-xs'"
            :pagination.sync="pagination"
            :rows-per-page-options="[10,50,100]"
            binary-state-sort
            @request="onTableChange"
            :selection="enableSelection ? 'multiple': 'none'"
            :selected.sync="selection"
            :selected-rows-label="getSelectedString"
            >
            <!--<template v-slot:top="props">
              <q-btn
                flat round dense
                :icon="props.inFullscreen ? 'fullscreen_exit' : 'fullscreen'"
                @click="props.toggleFullscreen"
                class="q-ml-md"
              />
            </template>-->
            <template v-slot:header-cell="props">
              <q-th :props="props">
                <q-input
                  v-if="props.col.filter_active"
                  outlined
                  label-color="primary"
                  standout="bg-tools text-primary"
                  v-model="columnFilters"
                  dense clearable
                  >
                  <template v-slot:prepend>
                    <div class="row items-center all-pointer-events">
                      <q-icon color="primary" size="16px" name="filter_alt" />
                    </div>
                  </template>
                </q-input>
                <q-btn v-else color="tools" text-color="primary" size="xs"
                  round flat dense icon="filter_alt" @click.stop="onFilterClick(props.col.field)"/>
                {{ props.col.label }}
              </q-th>
            </template>
            <template v-slot:body-selection="scope">
                <q-checkbox v-model="scope.selected" dense/>
            </template>
            <template v-slot:header-cell-tools="props">
              <q-th :props="props">
              </q-th>
            </template>
            <template v-slot:body-cell-tools="props">
              <q-td :props="props.name" :to="props.row.uid">
                <div class="row bg-tools rounded-borders" style="min-width: 45px;">
                  <div class="col-auto">
                    <q-btn v-if="showAddButton" flat stretch dense size='sm' @click="$emit('component-add', props.row)" icon="add"/>
                  </div>
                  <div class="col-auto">
                    <q-btn size='10px'
                      :to="{ name: 'component', params: { uid: props.row.uid }}" flat dense icon="info"></q-btn>
                  </div>
                    <div class="col-auto">
                  <q-btn flat dense size='10px'
                    @click="searchCompatible(props.row.uid)" icon="device_hub"/>
                  </div>
                    <div class="col-auto">
                  <q-btn flat dense size='10px'
                  @click="searchSimilar(props.row)" icon="search"/>
                  </div>
                </div>
              </q-td>
            </template>
            <template v-slot:body-cell-name="props">
              <q-td :props="props.name" :to="props.row.uid">
                <router-link :to="{ name: 'component', params: { uid: props.row.uid }}">{{ props.row.name }}</router-link>
              </q-td>
            </template>
            <template v-slot:loading>
              <q-inner-loading showing color="primary" />
            </template>
            <template v-slot:item="props">
              <div class="col-xs-6 col-sm-4 col-md-3 col-lg-2 col-xl-auto">
                <q-card :props="props.name" bordered class="shadow-3">
                  <q-card-section>
                  <router-link :to="{ name: 'component', params: { uid: props.row.uid }}">{{ props.row.name }}</router-link>
                  </q-card-section>
                  <!--<q-separator />-->
                  <q-card-actions align="between" class="componentActions">
                    <div>
                    <q-btn v-if="showAddButton" flat dense size='sm' @click="$emit('component-add', props.row)" icon="add"></q-btn>
                    <q-btn :to="{ name: 'component', params: { uid: props.row.uid }}" flat dense size='sm' icon="info"></q-btn>
                    </div>
                    <div>
                    <q-btn flat dense size='sm' @click="searchCompatible(props.row.uid)" icon="device_hub">Compatible</q-btn>
                    <q-btn flat dense size='sm' @click="searchSimilar(props.row)" icon="search">Similar</q-btn>
                    </div>
                  </q-card-actions>
                </q-card>
              </div>
            </template>
          </q-table>
        </div>
      </div>
      <q-separator v-if="showFilter" vertical inset spaced/>
      <div class="col-4 col-md-3" v-if="showFilter">
        <NodeFilter
          :value="search_options"
          @input="onFilterChange"
          />
      </div>
    </div>
</template>

<style lang="sass">
.componentActions
  background-color: $tools
  padding: 2px

.componentSearchBar
  background-color: $tools

.searchModeList
  background-color: $primary
  color: white
</style>

<script>
// import { mapGetters, mapActions } from 'vuex'
// import { mapState, mapGetters } from 'vuex'
import NodeFilter from 'components/NodeFilter.vue'

var cloneDeep = require('lodash.clonedeep')

export default {
  name: 'ComponentSearch',
  components: {
    NodeFilter
  },
  props: {
    showAddButton: { type: Boolean, default: false },
    componentList: { type: Array, default: undefined },
    totalResultNum: { type: Number, default: 0 },
    searchState: { type: Boolean, default: false },
    usegrid: { type: Boolean, default: true },
    enableSelection: { type: Boolean, default: false },
    denselayout: { type: Boolean, default: true },
    value: {
      type: Object,
      default: function () {
        return {
          q: '',
          uuid: '',
          qmode: 'text',
          start: 0,
          end: 10,
          sort: 'score',
          descending: false,
          filters: []
        }
      }
    }
  },
  data () {
    return {
      showFilter: false,
      selection: [],
      searchHint: 'Search for a Component!',
      columnFilters: 'test',
      visible_columns: ['name', 'keywords', 'modified', 'score']
    }
  },
  methods: {
    getSelectedString () {
      return this.selection.length === 0 ? '' : `${this.selection.length} record${this.selection.length > 1 ? 's' : ''} selection of ${this.componentList.length}`
      // return this.selection
    },
    onFilterClick (field) {
      console.log('clicked column filter: ' + field)
    },
    requestSearch (newProps) {
      console.log('new search requested ')
      var newSearchProps = {
        ...cloneDeep(this.value),
        ...newProps
      }
      this.$emit('input', newSearchProps)
    },
    onFilterChange (value) {
      console.log('filter change detected!')
      console.log(value)
      var newSearchProps = cloneDeep(this.value)
      newSearchProps.filters = value.filters
      newSearchProps.qmode = value.qmode
      this.$emit('input', newSearchProps)
    },
    /*
    onUpdatePagination (props) {
      console.log(props)
    },
    */
    onTableChange (requestProp) {
      console.log('table change!')
      console.log(requestProp)
      const { page, rowsPerPage, sortBy, descending } = requestProp.pagination
      var newSearchProps = cloneDeep(this.value)
      newSearchProps.start = (page - 1) * rowsPerPage
      newSearchProps.end = newSearchProps.start + rowsPerPage
      if (sortBy) {
        newSearchProps.sort = sortBy
      }
      newSearchProps.descending = descending
      this.$emit('input', newSearchProps)
    },
    onQChange (value) {
      this.requestSearch({ q: value })
    },
    onQModeChange (value) {
      this.requestSearch({ qmode: value })
    },
    searchSimilar (component) {
      console.log('searchSimilar')
      console.log(component)
      var newSearchProps = cloneDeep(this.value)
      newSearchProps.qmode = 'similar'
      newSearchProps.q = 'ID: ' + component.uid
      this.$emit('input', newSearchProps)
    },
    async searchCompatible (componentID) {
      this.showFilter = true
      console.log('searchCompatible')
      console.log(componentID)
      var result = await this.$store.$db().model('components').fetchById(componentID)
      // get interfaces of the component
      var interfaces = result.entities.components[0].characteristics.interfaces
      if (interfaces && interfaces.length) {
        // set filter with interface list
        var newfilter = {
          type: 'field_contains',
          target: 'Interface.name',
          method: 'OR',
          value: interfaces
        }
        // ad replace all previously defined filters with the new configuration
        this.requestSearch({ filters: [newfilter], qmode: 'filter' })
      } else {
        this.requestSearch({ filters: [] })
      }
    },
    toggleFilter () { this.showFilter = !this.showFilter }
  },
  computed: {
    columnNames () {
      return ['uid', 'name', 'score', 'keywords', 'interfaces', 'modified']
    },
    columns () {
      const tablecols = this.columnNames.map(x => {
        return {
          name: x,
          required: x,
          field: x,
          label: x,
          sortable: true,
          filter_active: false,
          align: 'left'
        }
      })
      tablecols.unshift({
        name: 'tools',
        required: true,
        field: 'tools',
        label: 'tools',
        sortable: false,
        align: 'left'
      })
      return tablecols
    },
    possibleColumns () {
      return ['name', 'uid', 'interfaces']
    },
    search_options () {
      return {
        qmode: this.value.qmode,
        filters: this.value.filters
      }
    },
    pagination: {
      get: function () {
        var rowsnum = (this.value.end - this.value.start) || 10
        // var pagenum = Math.floor(this.totalResultNum / rowsnum)
        var page = ((this.value.start / rowsnum) + 1) || 1
        return {
          sortBy: this.value.sort,
          descending: this.value.descending,
          page: page,
          rowsPerPage: rowsnum,
          rowsNumber: this.totalResultNum
        }
      },
      set: function (newValue) {
        // this function does not get used the only time when this function gets called
        // is during the initialization of the page. Otherwise we set the pagination through
        // the "@request" event.
        console.log('set pagination: ' + newValue)
      }
    },
    filters () {
      if ('filters' in this.value) {
        return this.value.filters
      } else {
        return []
      }
    }
  }
}
</script>
