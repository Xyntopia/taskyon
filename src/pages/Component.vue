<template>
  <q-page class="bg-secondary">
    <ComponentInfo :componentID="$route.params.uid"/>
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
