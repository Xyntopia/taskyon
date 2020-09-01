<template>
  <q-page class="bg-secondary">
      <div class="column q-pa-xs">
        <!--<div class="fit column justify-start items-center">-->
          <div class="q-col-gutter-xs">
            <div class="col-1">
              <div class="row q-col-gutter-xs">
               <div class="col-8">
                <q-card>
                  <!--<mxgraph/>-->
                  <q-card-actions align="between">
                    <q-btn size='sm' padding="xs" outline>Clear</q-btn>
                    <q-btn size='sm' padding="xs" outline>New</q-btn>
                    <q-input hide-bottom-space filled dense v-model="test"/>
                  </q-card-actions>
                  <q-card-section style="min-height: 200px; min_width: 200px;">
                    <cytograph v-bind:elementlist="componentSystem"/>
                  </q-card-section>
                </q-card>
               </div>
               <div class="col-4">
                <q-card class="fit">
                  <div class="column justify-start">
                    <div class="col"><b>Component Description</b></div>
                    <div>description</div>
                    <div class="col">
                      add/remove
                    </div>
                  </div>
                </q-card>
               </div>
              </div>
            </div>
            <div class='col-1'>
              <ComponentSearch/>
            </div>
            <div class="col-1">
              <q-card>
                BoM
              </q-card>
            </div>
          </div>
      </div>
  </q-page>
</template>

<script>
// import mxgraph from 'components/mxgraph.vue'
import cytograph from 'components/cytograph.vue'
import ComponentSearch from 'components/ComponentSearch.vue'
import { mapGetters } from 'vuex'

const stringOptions = [
  'Component'
].reduce((acc, opt) => {
  for (let i = 1; i <= 5; i++) {
    acc.push(opt + ' ' + i)
  }
  return acc
}, [])

export default {
  name: 'PageConfigurator',
  components: {
    cytograph,
    ComponentSearch
  },
  data () {
    return {
      model: null,
      options: null
    }
  },
  computed: {
    ...mapGetters([
      'componentSystem',
      'componentlist'
    ])
  },
  methods: {
    filterFn (val, update, abort) {
      if (val.length < 2) {
        abort()
        return
      }

      update(() => {
        const needle = val.toLocaleLowerCase()
        this.options = stringOptions.filter(v => v.toLocaleLowerCase().indexOf(needle) > -1)
        // this.options = []
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

    newSearch (val) {
      console.log('the new search value is: ' + val)
    },

    setModel (val) {
      console.log('new input text: ' + val)
      this.model = val
    }
  }
}
</script>
