<template>
  <q-page
    class="fit column justify-start items-center bg-secondary"
    >
      <div class="col-1">
        <h1> COXACON </h1>
      </div>
      <div class="col-1" style="width: 70%">
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
  }
}
</script>
