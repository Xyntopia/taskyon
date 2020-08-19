<template>
  <q-page class="bg-secondary">
      <div class="column q-pa-xs items-center">
        <!--<div class="fit column justify-start items-center">-->
        <div>
          <div class="q-col-gutter-xs">
            <div class='col'>
              <q-select
                  class='col'
                  filled dense
                  input-class="text-light"
                  :value="model"
                  bg-color="white"
                  hide-selected
                  v-model="model"
                  hide-hint
                  fill-input
                  use-input
                  hide-dropdown-icon
                  autofocus
                  input-debounce="500"
                  :options="options"
                  @filter="filterFn"
                  @input-value="setModel"
                  style="width: 100%"
                  stack-label
                  label="test"
                  hide-bottom-space
                >
                  <template v-slot:append>
                    <q-icon name="search" @click.stop />
                  </template>
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
              </div>
            <div class="row q-gutter-xs">
              <q-card class="my-card">
                <mxgraph/>
              </q-card>
              <q-card class="my-card">
                <div class="column justify-between">
                  <b>Component Description</b>
                  <div>
                    add/remove
                  </div>
                </div>
              </q-card>
            </div>
            <div col>
              <q-card class="my-card">
                BoM
              </q-card>
            </div>
          </div>
        </div>
      </div>
  </q-page>
</template>

<script>
import mxgraph from 'components/mxgraph.vue'

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
  components: {
    mxgraph
  },
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
