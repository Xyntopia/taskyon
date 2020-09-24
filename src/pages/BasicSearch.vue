<template>
  <q-page
    class="fit column justify-start items-center bg-secondary"
    >
      <div v-if="true">
        {{ searchProps }}
      </div>
      <div v-if="initiallayout" class="col-1">
        <h1> Componardo </h1>
      </div>
      <div class="col-1" v-bind:style="searchbarWidth">
        <ComponentSearch
          ref="componentSearch"
          :value="searchPropsFromURL"
          :componentList="componentList"
          :totalResultNum="result.data.total"
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

function isEmptyOrSpaces (str) {
  return str === null || str.match(/^ *$/) !== null
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
    console.log('mounted ' + this.name)
    var newSearchProps = cloneDeep(this.searchProps)
    this.$store.dispatch('search', newSearchProps)
  },
  watch: {
    $route (to, from) {
      var newSearchProps = cloneDeep(this.searchProps)
      this.$store.dispatch('search', newSearchProps)
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
      return !this.searchProps.q
    },
    searchbarWidth () {
      // if we just entered the webpage there shouldn't be a query-string
      if (this.initiallayout) {
        return 'width: 70%;'
      } else {
        return 'width: 100%;'
      }
    },
    ...mapGetters([
      'componentList'
    ]),
    ...mapState({
      result: state => state.comcharax.result,
      searchingState: state => state.comcharax.searchingState
    })
  },
  methods: {
    onSearchRequest (searchProps) {
      console.log('new basic search')
      var newSearchProps = cloneDeep(searchProps)
      console.log(newSearchProps)
      if (isEmptyOrSpaces(newSearchProps.q)) {
        this.$router.push({ path: '/' })
      } else {
        this.$router.push({ path: '/', query: newSearchProps })
      }
    }
  }
}
</script>
