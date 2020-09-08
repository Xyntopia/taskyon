<template>
    <div class="row rounded-borders">
      <div class="column col">
        <div class="col row componentSearchBar rounded-borders">
          <div class="col-auto q-mx-xs" >
            <q-select
              borderless
              style="min-width: 120px"
              v-model="searchMode" :options="searchModeOptions"
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
              :loading="searchingState"
              v-model="searchstring"
              type="search"
              autofocus
              clearable
              debounce="500"
              :label="searchHint"
              :prefix="prefix"
              @clear="onClear"
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
            :data="componentlist"
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
                    <q-btn flat dense size='sm' @click="componentInfo(props.row)" icon="info"></q-btn>
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
import { mapState, mapGetters } from 'vuex'

export default {
  name: 'ComponentSearch',
  props: {
    showAddButton: { type: Boolean, default: false }
  },
  data () {
    return {
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
    onClear (event) {
      console.log(event)
      this.searchMode = 'text'
      this.searchstring = ''
    },
    searchSimilar (component) {
      console.log('searchSimilar')
      console.log(component)
      this.searchMode = 'similar'
      this.searchstring = component.id
    },
    searchCompatible (component) {
      console.log('searchCompatible')
      console.log(component)
      this.searchMode = 'compatible'
      this.searchstring = component.id
    },
    componentInfo (component) {
      console.log('ShowInfo')
      console.log(component)
    },
    toggleFilter () { this.showFilter = !this.showFilter }
  },
  computed: {
    prefix () {
      switch (this.searchMode) {
        case 'similar':
          return 'Component ID: '
        case 'compatible':
          return 'Component ID: '
        default:
          return undefined
      }
    },
    searchstring: {
      get () {
        return this.$store.state.comcharax.searchString
      },
      set (val) {
        this.$store.dispatch('search', val)
      }
    },
    searchMode: {
      get () {
        return this.$store.state.comcharax.searchMode
      },
      set (val) {
        this.$store.commit('setSearchMode', val)
      }
    },
    ...mapState({
      // TODO: we are doing it like this because of this: https://github.com/vuejs/vuex/issues/1592
      // once that is resolved, make sure to revert this to a list of strings
      searchingState: state => state.comcharax.searchingState
    }),
    ...mapGetters([
      'componentlist'
    ])
  }
}
</script>
