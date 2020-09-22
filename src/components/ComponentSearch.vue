<template>
    <div class="row rounded-borders">
      <div class="column col">
        <div class="col row componentSearchBar rounded-borders">
          <div class="col-auto q-mx-xs" >
            <q-select
              v-if="false"
              borderless
              style="min-width: 120px"
              v-model="value.qmode" :options="searchModeOptions"
              label="mode">
              <template v-slot:append>
                <q-icon name="search" />
              </template>
            </q-select>
          </div>
          <div class="col">
            <q-input
              square filled
              :value="value.q"
              bg-color="white"
              :loading="searchState"
              type="search"
              autofocus
              clearable
              debounce="1000"
              :label="searchHint"
              :prefix="prefix"
              @input="onQChange"
              >
              <template v-slot:append>
                <q-btn round dense flat @click="requestSearch" icon="search"/>
              </template>
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
        <div style="min-width: 100px;">
          <q-btn-toggle
            :value="value.qmode"
            @input="onQModeChange"
            class="my-custom-toggle"
            no-caps
            dense
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
    searchState: { type: Boolean, default: false },
    value: {
      type: Object,
      default: function () {
        return {
          q: '',
          qmode: 'text',
          start: 0,
          end: 10,
          order: 'score',
          filters: [1, 2, 3]
        }
      }
    }
  },
  data () {
    return {
      showFilter: false,
      searchHint: 'Search for a Component!',
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
    requestSearch   (newProps) {
      var newSearchProps = {
        ...cloneDeep(this.value),
        ...newProps
      }
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
    },
    searchCompatible (component) {
      console.log('searchCompatible')
      console.log(component)
    },
    toggleFilter () { this.showFilter = !this.showFilter }
  },
  computed: {
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
