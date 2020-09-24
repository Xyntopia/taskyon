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
            :prefix="prefix"
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
            row-key="id"
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
                    <q-btn :to="{ name: 'component', params: { id: props.row.id }}" flat dense size='sm' icon="info"></q-btn>
                    </div>
                    <div>
                    <q-btn flat dense size='sm' @click="searchCompatible(props.row)" icon="search">Compatible</q-btn>
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
      <div class="col-4 col-md-3 column items-left" v-if="showFilter">
        <div class="col-auto text-h6 text-primary self-center" >
            SELECTED FILTERS
        </div>
        <div class="col-auto self-center">
          <q-btn-toggle
            :value="value.qmode"
            @input="onQModeChange"
            class="my-custom-toggle"
            no-caps
            rounded
            unelevated
            toggle-color="primary"
            color="white"
            text-color="primary"
            :options="[
              {label: 'Text', value: 'text'},
              {label: 'AI', value: 'similar'}
            ]"
          />
        </div>
        <q-separator inset spaced/>
        <div
          v-for="filter in filters"
          v-bind:key="filter.field"
          class="col-auto">
          <q-select
            use-input
            multiple
            :value="filter.value"
            color="primary"
            dense
            label-color="primary"
            outlined
            :options="interfaceoptions"
            hide-dropdown-icon
            input-debounce="0"
            use-chips
            hide-bottom-space
            new-value-mode="add-unique"
            :label="filter.field + ' : ' + filter.method"
            @input="onFilterChange(filter,$event)">
            <template v-slot:selected-item="scope">
              <q-chip
                removable
                square
                dense
                @remove="scope.removeAtIndex(scope.index)"
                :tabindex="scope.tabindex"
                color="white"
                text-color="primary"
                class="q-mb-none q-ml-none"
              >
                {{ scope.opt }}
              </q-chip>
            </template>
          </q-select>
        </div>
      </div>
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

var cloneDeep = require('lodash.clonedeep')

export default {
  name: 'ComponentSearch',
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
      interfaceoptions: [],
      searchHint: 'Search for a Component!',
      columns: [
        { name: 'id', field: 'id', label: 'id' },
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
    onFilterChange (filter, value) {
      console.log(filter)
      console.log(value)
      var newSearchProps = cloneDeep(this.value)
      var newFilter = cloneDeep(filter)
      newFilter.value = value
      newSearchProps.filters = [newFilter]
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
    },
    async searchCompatible (component) {
      this.showFilter = true
      console.log('searchCompatible')
      console.log(component)
      var result = await this.$store.$db().model('components').fetchById(component.id)
      // get interfaces of the component
      var interfaces = result.entities.components[0].characteristics.interfaces
      if (interfaces && interfaces.length) {
        // set filter with interface list
        var newfilter = {
          field: 'interfaces',
          method: 'MATCH_OR',
          value: interfaces
        }
        // ad replace all previously defined filters with the new configuration
        this.requestSearch({ filters: [newfilter] })
      } else {
        this.requestSearch({ filters: [] })
      }
    },
    toggleFilter () { this.showFilter = !this.showFilter }
  },
  computed: {
    pagination () {
      var rowsnum = (this.value.end - this.value.start) || 10
      // var pagenum = Math.floor(this.totalResultNum / rowsnum)
      var page = (this.value.start / rowsnum) + 1
      return {
        sortBy: this.value.sort,
        descending: this.value.order,
        page: page,
        rowsPerPage: rowsnum,
        rowsNumber: this.totalResultNum
      }
    },
    filters () {
      if ('filters' in this.value) {
        return this.value.filters
      } else {
        return []
      }
    },
    prefix () {
      switch (this.value.qmode) {
        case 'similar':
          return 'Similar: '
        case 'compatible':
          return 'Filtered: '
        default:
          return undefined
      }
    }
  }
}
</script>
