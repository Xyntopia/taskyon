<template>
  <div>
      <q-input
          rounded filled
          input-class="text-light"
          bg-color="white"
          :loading="searchingState"
          v-model="searchstring"
          type="search"
          autofocus
          clearable
          debounce="500"
          label="Search for a component!"
        >
          <template v-slot:append>
            <q-icon name="search" />
          </template>
        </q-input>
        <div v-if="false">
          debug: {{ searchingState }}
        </div>
        <q-table
            v-if="true"
            :dense="false"
            :data="componentlist"
            row-key="id"
            :columns="columns"
            :visible-columns="['name','keywords']"
            :grid="true"
            :grid-header="true"
            :card-container-class="'q-gutter-xs'"
            :pagination="pagination">
          <template v-slot:body-cell-name="props">
            <q-td :props="props.name">
              <div>
                test
                {{ props.row.name }}
              </div>
            </q-td>
          </template>
          <template v-slot:item="props">
            <q-card :props="props.name" bordered>
              <div>
                <q-card-section>
                {{ props.row.name }}
                </q-card-section>
                <q-card-actions>
                  <q-btn size='sm' padding="xs" flat @click="onaddbuttonclick(props.row.id)">Add</q-btn>
                  <q-btn size='sm' padding="xs" flat>Info</q-btn>
                </q-card-actions>
              </div>
            </q-card>
          </template>
        </q-table>
  </div>
</template>

<script>
// import { mapGetters, mapActions } from 'vuex'
import { mapState, mapGetters } from 'vuex'

export default {
  name: 'ComponentSearch',
  data () {
    return {
      options: null,
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
    onaddbuttonclick (clickedId) {
      console.log(clickedId)
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
