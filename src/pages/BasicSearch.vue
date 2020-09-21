<template>
  <q-page
    class="fit column justify-start items-center bg-secondary"
    >
      <div v-if="initiallayout" class="col-1">
        <h1> Componardo </h1>
      </div>
      <div class="col-1" v-bind:style="searchbarWidth">
        <ComponentSearch
          ref="componentSearch"
          :componentList="componentList"
          :searchState="searchingState"
          @searchrequest="onSearchRequest"
          />
      </div>
  </q-page>
</template>

<script>
import ComponentSearch from 'components/ComponentSearch.vue'
import { mapGetters, mapState } from 'vuex'

function isEmptyOrSpaces (str) {
  return str === null || str.match(/^ *$/) !== null
}

export default {
  name: 'PageBasicSearch',
  components: {
    ComponentSearch
  },
  props: {
    searchProps: Object // this comes from vue router
  },
  mounted () {
    this.$refs.componentSearch.searchProps = this.searchProps
    this.$store.dispatch('search', this.searchProps)
  },
  watch: {
    $route (to, from) {
      this.$refs.componentSearch.searchProps = this.searchProps
      this.$store.dispatch('search', this.searchProps)
    }
  },
  computed: {
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
    ...mapState([
      'searchingState'
    ])
  },
  methods: {
    onSearchRequest (searchProps) {
      console.log('new basic search')
      console.log(searchProps)
      if (!isEmptyOrSpaces(searchProps.q)) {
        this.$router.push({ path: '/', query: searchProps })
      } else {
        this.$router.push({ path: '/' })
      }
      this.$store.dispatch('search', searchProps)
    }
  }
}
</script>
