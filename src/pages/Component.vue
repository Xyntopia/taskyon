<template>
  <q-page class="bg-secondary">
    <ComponentInfo :componentID="$route.params.id"/>
  </q-page>
</template>

<script>
import ComponentInfo from 'components/ComponentInfo.vue'

export default {
  name: 'ComponentPage',
  components: {
    ComponentInfo
  }
}
</script>
