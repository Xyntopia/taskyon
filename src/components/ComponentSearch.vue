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
            :grid-header="false"
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
                <q-card-section>
                {{ props.row.name }}
                </q-card-section>
                <q-card-action>
                <q-btn-group flat>
                  <q-btn size='sm' @click="$emit('component-add', props.row)" icon="add"></q-btn>
                  <q-btn size='sm' @click="$emit('search-compatible', props.row)" icon="search">Compatible</q-btn>
                  <q-btn size='sm' @click="$emit('search-similar', props.row)" icon="search">Similar</q-btn>
                  <q-btn size='sm' @click="$emit('component-info', props.row)" icon="info"></q-btn>
                </q-btn-group>
                </q-card-action>
            </q-card>
          </template>
        </q-table>
  </div>
</template>

<style lang="sass">
.q-btn
  //background-color: scale-color($secondary, $lightness: 80%)
  background-color: $grey-2
</style>

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
