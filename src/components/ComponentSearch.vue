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
            title="Components"
            :data="result.data"
            row-key="id"
        />
        <div v-if="true">
          {{ result.data }}
        </div>
        <div v-if="false">
          class="fit row justify-start items-left q-gutter-xs q-py-xs"
          style="height:50px;">
            <div  class="col"
                  v-for="item in result"
                  :key="item.id">
              <q-card> {{ item }} </q-card>
            </div>
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
      options: null
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
