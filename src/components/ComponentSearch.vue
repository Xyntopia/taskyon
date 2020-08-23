<template>
  <div>
      <q-select
          rounded filled
          input-class="text-light"
          :value="model"
          bg-color="white"
          hide-selected
          v-model="model"
          fill-input
          use-input
          hide-dropdown-icon
          autofocus
          input-debounce="200"
          :options="options"
          @filter="filterFn"
          @input-value="setModel"
          label="Search for a component!"
        >
          <template v-slot:no-option>
            <q-item>
              <q-item-section class="text-grey">
                No results
              </q-item-section>
            </q-item>
          </template>
          <!--
          <template v-slot:option>
            <q-item>
              <q-item-section class="text-grey">
                No results
              </q-item-section>
            </q-item>
          </template>-->
        </q-select>
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

const stringOptions = [
  'Component'
].reduce((acc, opt) => {
  for (let i = 1; i <= 5; i++) {
    acc.push(opt + ' ' + i)
  }
  return acc
}, [])

export default {
  name: 'ComponentSearch',
  data () {
    return {
      model: null,
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
    filterFn (val, update, abort) {
      update(() => {
        const needle = val.toLocaleLowerCase()
        this.options = stringOptions.filter(v => v.toLocaleLowerCase().indexOf(needle) > -1)
      })

      setTimeout(() => {
        update(() => {
          this.options = stringOptions
        })
      }, 2000)
    },

    abortFilterFn () {
      // console.log('delayed filter aborted')
    },

    setModel (val) {
      this.model = val
    }
  }
}
</script>
