<template>
    <div class="row rounded-borders">
      <div class="column col">
        <div class="col row componentSearchBar rounded-borders">
          <div class="col-auto q-mx-xs" >
            <q-select
              borderless
              style="min-width: 120px"
              v-model="searchProps.qmode" :options="searchModeOptions"
              label="mode">
              <template v-slot:append>
                <q-icon name="search" />
              </template>
            </q-select>
          </div>
          <div class="col">
            <q-input
              square filled
              bg-color="white"
              :loading="searchState"
              :value="searchProps.q"
              type="search"
              autofocus
              clearable
              debounce="500"
              :label="searchHint"
              :prefix="prefix"
              @input="onInput"
              >
            </q-input>
          </div>
          <q-btn flat stretch icon="filter_list" @click="toggleFilter"/>
        </div>
        <!--<q-separator inset spaced/>-->
        <div>
          <q-table
            v-if="true"
            :dense="false"
            :data="componentList"
            row-key="id"
            :columns="columns"
            :visible-columns="['name','keywords']"
            :grid="true"
            :grid-header="false"
            :card-container-class="'q-col-gutter-xs'"
            :pagination="pagination"
            >
            <template v-slot:body-cell-name="props">
              <q-td :props="props.name">
                <div>
                  test
                  {{ props.row.name }}
                </div>
              </q-td>
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
      <div class="col-auto" v-if="showFilter">
        <div style="width: 100px; height: 300px;">
          filter
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
    componentList: Array,
    searchState: { type: Boolean, default: false }
  },
  data () {
    return {
      searchProps: {
        q: '',
        qmode: 'text',
        start: 0,
        end: 10,
        order: 'score',
        filters: [1, 2, 3]
      },
      searchModeOptions: ['text', 'similar', 'compatible'],
      showFilter: false,
      searchHint: 'test',
      loading: false,
      pagination: {
        sortBy: 'score',
        descending: true,
        page: 1,
        rowsPerPage: 10
        // rowsNumber: 10
      },
      columns: [
        { name: 'id', field: 'id', label: 'id' },
        { name: 'name', field: 'name', label: 'name' },
        { name: 'score', field: 'score', label: 'score' },
        { name: 'keywords', field: 'keywords', label: 'keywords' }
      ]
    }
  },
  methods: {
    onInput (value) {
      this.searchProps.q = value
      this.$emit('searchrequest', cloneDeep(this.searchProps))
    },
    searchSimilar (component) {
      console.log('searchSimilar')
      console.log(component)
    },
    searchCompatible (component) {
      console.log('searchCompatible')
      console.log(component)
    },
    componentInfo (component) {
      console.log('ShowInfo')
      console.log(component)
    },
    toggleFilter () { this.showFilter = !this.showFilter }
  },
  computed: {
    prefix () {
      switch (this.searchProps.qmode) {
        case 'similar':
          return 'Component ID: '
        case 'compatible':
          return 'Component ID: '
        default:
          return undefined
      }
    }
  }
}
</script>
