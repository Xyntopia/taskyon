<template>
  <div>
      <q-input
          rounded filled
          input-class="text-light"
          bg-color="white"
          v-model="search"
          type="search"
          autofocus
          debounce="500"
          label="Search for a component!"
          @input="updateSearchString"
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
        <div
          class="fit row justify-start items-left q-gutter-xs q-py-xs"
          style="height:50px;">
            <div  class="col-1"
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
      search: null,
      options: null,
      searchresult: ['r1', 'r2', 'r3']
    }
  },
  computed: {
    ...mapState([
      'result'
    ])
  },
  methods: {
    updateSearchString (val) {
      console.log('updated searchstring: ' + val)
    }
  }
}
</script>
