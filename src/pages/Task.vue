<template>
  <q-page class="bg-secondary">
    <div class="text-subtitle1">{{ $route.params.id }} </div>
    <q-card>
      {{ Tasks.find($route.params.id) }}
    </q-card>
  </q-page>
</template>

<script>
export default {
  name: 'DebugInfoPage',
  computed: {
    Tasks () {
      return this.$store.$db().model('tasks')
    }
  }
}
</script>
