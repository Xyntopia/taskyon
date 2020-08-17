<template>
  <q-page
    class="fit column justify-start items-center"
    >
      <q-select
          class="col-4"
          rounded standout
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
          style="width: 500px"
          hint="Search for a component!"
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
  </q-page>
</template>

<script>
const stringOptions = [
  'Component'
].reduce((acc, opt) => {
  for (let i = 1; i <= 5; i++) {
    acc.push(opt + ' ' + i)
  }
  return acc
}, [])

export default {
  name: 'PageBasicSearch',
  data () {
    return {
      model: null,
      options: null
    }
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
