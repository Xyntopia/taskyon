<template>
  <q-page
    class="fit column justify-start items-center bg-secondary"
    >
      <div v-if="initiallayout" class="col-1">
        <h1> COXACON </h1>
      </div>
      <div class="col-1" v-bind:style="searchbarWidth">
        <ComponentSearch/>
      </div>
  </q-page>
</template>

<script>
import ComponentSearch from 'components/ComponentSearch.vue'

export default {
  name: 'PageBasicSearch',
  components: {
    ComponentSearch
  },
  mounted () {
    console.log('mounted search string')
    this.updateSearchString(this.$route.query.q)
  },
  watch: {
    $route (to, from) {
      this.updateSearchString(to.query.q)
    }
  },
  computed: {
    initiallayout () {
      return !this.$route.query.q
    },
    searchbarWidth () {
      // if we just entered the webpage there shouldn't be a query-string
      if (this.initiallayout) {
        return 'width: 70%;'
      } else {
        return 'width: 100%;'
      }
    }
  },
  methods: {
    updateSearchString (val) {
      if (val) {
        console.log('updated search string')
        this.$store.dispatch('search', val)
      }
    }
  }
}
</script>
