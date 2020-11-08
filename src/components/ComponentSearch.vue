<template>
    <div class="row">
      <div class="column col-xs-auto col-sm">
        <q-toolbar
          class="col-auto q-px-none shadow-2 rounded-borders componentSearchBar"
          dense>
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
          <q-btn flat stretch icon="filter_list" @click="toggleFilter"/>
        </q-toolbar>
        <!--<q-separator inset spaced/>-->
        <div>
          <q-table
            v-if="true"
            :loading="searchState"
            :dense="false"
            :data="componentList"
            row-key="uid"
            :columns="columns"
            :visible-columns="['name','keywords']"
            :grid="true"
            :grid-header="false"
            :card-container-class="'q-col-gutter-xs'"
            :pagination.sync="pagination"
            :rows-per-page-options="[10,50,100]"
            @request="onTableChange"
            >
            <template v-slot:body-cell-name="props">
              <q-td :props="props.name">
                <div>
                  test
                  {{ props.row.name }}
                </div>
              </q-td>
            </template>
            <template v-slot:loading>
              <q-inner-loading showing color="primary" />
            </template>
            <template v-slot:item="props">
              <div class="col-xs-6 col-sm-4 col-md-3 col-lg-2 col-xl-auto">
                <q-card :props="props.name" bordered class="shadow-3">
                  <q-card-section>
                  {{ props.row.name }}
                  </q-card-section>
                  <!--<q-separator />-->
                  <q-card-actions align="between" class="componentActions">
                    <div>
                    <q-btn v-if="showAddButton" flat dense size='sm' @click="$emit('component-add', props.row)" icon="add"></q-btn>
                    <q-btn :to="{ name: 'component', params: { uid: props.row.uid }}" flat dense size='sm' icon="info"></q-btn>
                    </div>
                    <div>
                    <q-btn flat dense size='sm' @click="searchCompatible(props.row.uid)" icon="search">Compatible</q-btn>
                    <q-btn flat dense size='sm' @click="searchSimilar(props.row)" icon="search">Similar</q-btn>
                    </div>
                  </q-card-actions>
                </q-card>
              </div>
            </template>
          </q-table>
        </div>
      </div>
      <q-separator vertical inset spaced v-if="showFilter"/>
      <NodeFilter
        v-if="showFilter"
        :value="search_options"
        @input="onFilterChange"
        />
    </div>
</template>

<style lang="sass">
.componentActions
  background-color: scale-color($secondary, $lightness: 80%)
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
          desc: true,
          filters: []
        }
      }
    }
  },
  data () {
    return {
      showFilter: false,
      searchHint: 'Search for a Component!',
      columns: [
        { name: 'uid', field: 'uid', label: 'uid' },
        { name: 'name', field: 'name', label: 'name' },
        { name: 'score', field: 'score', label: 'score' },
        { name: 'keywords', field: 'keywords', label: 'keywords' }
      ]
    }
  },
  methods: {
    requestSearch   (newProps) {
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
    onTableChange (requestProp) {
      console.log(requestProp)
      var newSearchProps = cloneDeep(this.value)
      newSearchProps.start = (requestProp.pagination.page - 1) * requestProp.pagination.rowsPerPage
      newSearchProps.end = newSearchProps.start + requestProp.pagination.rowsPerPage
      this.$emit('input', newSearchProps)
      // requestProp.pagination.descending
      // requestProp.pagination.sortBy
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
          descending: this.value.order,
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
