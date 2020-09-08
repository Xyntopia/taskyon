<template>
  <q-page
    class="fit column justify-start items-center bg-secondary"
    >
      <div v-if="initiallayout" class="col-1">
        <h1> Componardo </h1>
      </div>
      <div class="col-1" v-bind:style="searchbarWidth">
        <ComponentSearch/>
      </div>
  </q-page>
</template>

<script>
import ComponentSearch from 'components/ComponentSearch.vue'
import { mapState } from 'vuex'

function isEmptyOrSpaces (str) {
  return str === null || str.match(/^ *$/) !== null
}

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
    },
    searchString (newq, oldq) {
      // watches the mapState "searchstring"
      console.log('from basicsearch: searchstring changed!!')
      console.log(newq)
      if (oldq !== newq) {
        if (!isEmptyOrSpaces(newq)) {
          // thisgives us an infinite loop!
          this.$router.push({ path: '/', query: { q: newq } })
        } else {
          this.$router.push({ path: '/' })
        }
      }
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
    },
    ...mapState({
      searchString: state => state.comcharax.searchString
    })
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
