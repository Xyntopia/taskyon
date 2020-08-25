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
          debounce="500"
          label="Search for a component!"
        >
          <template v-slot:no-option>
            <q-item>
              <q-item-section class="text-grey">
                No results
              </q-item-section>
            </q-item>
          </template>
          <template v-slot:append>
            <q-icon name="search" />
          </template>
          <!--
          <template v-slot:option>
            <q-item>
              <q-item-section class="text-grey">
                No results
              </q-item-section>
            </q-item>
          </template>-->
        </q-input>
        <q-table
            v-if="true"
            :dense="false"
            title="Components"
            :data="result.data"
            row-key="id"
            :columns="columns"
            :visible-columns="['name','keywords']"
        />
        <div v-if="false">
          {{ result.data }}
        </div>
  </div>
</template>

<script>
// import { mapGetters, mapActions } from 'vuex'
import { mapState } from 'vuex'

export default {
  name: 'ComponentSearch',
  data () {
    return {
      options: null,
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
        return this.$store.state.searchstring
      },
      set (val) {
        this.$store.dispatch('search', val)
      }
    },
    ...mapState([
      'result',
      'searchingState'
    ])
  }
}
</script>
