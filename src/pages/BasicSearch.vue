<template>
  <q-page
    class="fit column justify-evenly items-center bg-secondary"
    >
      <div v-if="initiallayout" class="gt-xs q-pa-xl text-h2 bg-red">!!!Prototype!!!</div>
      <div v-if="initiallayout" class="lt-sm q-pa-xl text-h5 bg-red">!!!Prototype!!!</div>
      <div v-if="initiallayout" class="row col items-center justify-center">
        <img
            class="gt-xs q-pa-md"
            alt="Componardo Logo"
            src="icons/favicon-128x128.png"
        >
        <img
            class="xs"
            alt="Componardo Logo"
            src="icons/favicon-96x96.png"
        >
        <div class="text-h1 gt-xs">Componardo</div>
      </div>
      <div class="col" v-bind:style="searchbarWidth">
        <ComponentSearch
          :value="searchPropsFromURL"
          :componentList="componentList"
          :totalResultNum="resultnum"
          :searchState="searchingState"
          @input="onSearchRequest"
          />
      </div>
  </q-page>
</template>

<script>
import ComponentSearch from 'components/ComponentSearch.vue'
import { mapGetters, mapState } from 'vuex'
var cloneDeep = require('lodash.clonedeep')

function isBlank (str) {
  return (!str || /^\s*$/.test(str))
}

export default {
  name: 'PageBasicSearch',
  components: {
    ComponentSearch
  },
  props: {
    searchPropsFromURL: Object // this comes from vue router
  },
  mounted () {
    var newSearchProps = cloneDeep(this.searchProps)
    this.$store.dispatch('comcharax/search', newSearchProps)
  },
  watch: {
    $route (to, from) {
      var newSearchProps = cloneDeep(this.searchProps)
      this.$store.dispatch('comcharax/search', newSearchProps)
    }
  },
  computed: {
    searchProps () {
      /* var searchProps = {
        q: '',
        qmode: 'text',
        start: 0,
        end: 10,
        order: 'score',
        filters: [1, 2, 3],
        ...cloneDeep(this.searchPropsFromURL)
      } */
      return this.searchPropsFromURL
    },
    initiallayout () {
      return !this.searchProps.q && !this.resultnum
    },
    searchbarWidth () {
      // if we just entered the webpage there shouldn't be a query-string
      if (this.initiallayout) {
        return 'width: 70%;'
      } else {
        return 'width: 100%;'
      }
    },
    ...mapGetters('comcharax', [
      'componentList',
      'resultnum'
    ]),
    ...mapState('comcharax', [
      'searchingState'
    ])
  },
  methods: {
    onSearchRequest (searchProps) {
      console.log('new basic search')
      var newSearchProps = cloneDeep(searchProps)
      console.log(newSearchProps)
      if (!isBlank(newSearchProps.q) ||
           newSearchProps.qmode) {
        this.$router.push({ path: '/', query: newSearchProps })
      } else {
        this.$router.push({ path: '/' })
      }
    }
  }
}
</script>
