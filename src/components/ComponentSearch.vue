<template>
  <div>
    <div class="row">
      <div class="column col">
        <div class="row rounded-borders shadow-1 bg-white">
          <q-btn-dropdown dense flat stretch icon="search" label="Textsearch">
            <q-list bordered separator class="searchModeList">
              <q-item clickable v-close-popup @click="onSearchModeClick('text')">Text Search</q-item>
              <q-item clickable v-close-popup @click="onSearchModeClick('similarity')">Similarity Search</q-item>
              <q-item clickable v-close-popup @click="onSearchModeClick('Compatibility')">Compatibility Search</q-item>
            </q-list>
          </q-btn-dropdown>
          <div class="col componentSearch">
            <q-input
              filled
              :loading="searchingState"
              v-model="searchstring"
              type="search"
              autofocus
              clearable
              debounce="500"
              label="Search for a component!"
              >
            </q-input>
          </div>
          <q-btn flat stretch icon="filter_list" @click="toggleFilter"/>
        </div>
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
              <div class="col-xs-6 col-sm-4 col-md-3">
              <q-card :props="props.name">
                  <q-card-section>
                  {{ props.row.name }}
                  </q-card-section>
                  <!--<q-separator />-->
                  <q-card-actions align="between" class="componentActions">
                    <div>
                    <q-btn flat dense size='sm' @click="$emit('component-add', props.row)" icon="add"></q-btn>
                    <q-btn flat dense size='sm' @click="$emit('component-info', props.row)" icon="info"></q-btn>
                    </div>
                    <div>
                    <q-btn flat dense size='sm' @click="$emit('search-compatible', props.row)" icon="search">Compatible</q-btn>
                    <q-btn flat dense size='sm' @click="$emit('search-similar', props.row)" icon="search">Similar</q-btn>
                    </div>
                  </q-card-actions>
              </q-card>
              </div>
            </template>
          </q-table>
        </div>
      </div>
      <div class="col-auto" v-if="showFilter">
        filter
      </div>
    </div>
  </div>
</template>

<style lang="sass">
.componentActions
  background-color: scale-color($secondary, $lightness: 80%)
  padding: 2px

.componentSearch
  background-color: scale-color($primary, $lightness: 90%)

.searchModeList
  background-color: $primary
  color: white
</style>

<script>
// import { mapGetters, mapActions } from 'vuex'
import { mapState, mapGetters } from 'vuex'

export default {
  name: 'ComponentSearch',
  data () {
    return {
      options: null,
      showFilter: false,
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
    toggleFilter () { this.showFilter = !this.showFilter },
    onSearchModeClick (evt) {
      console.log('clicked mode selection')
      console.log(evt)
    }
  },
  computed: {
    searchstring: {
      get () {
        return this.$store.state.comcharax.searchstring
      },
      set (val) {
        this.$store.dispatch('search', val)
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
