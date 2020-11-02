<template>
  <q-page class="bg-secondary">
    <div class="text-subtitle1">
      Task-Object: {{ $route.params.uid }} </div>
    <q-card>
      <pre style="word-wrap: break-word; width: 100%">{{ TaskStr }}</pre>
    </q-card>
  </q-page>
</template>

<script>
export default {
  name: 'DebugInfoPage',
  computed: {
    Tasks () {
      return this.$store.$db().model('tasks')
    },
    TaskStr () {
      // return JSON.stringify(this.Tasks.find(this.$route.params.id), null, 2)
      return this.Tasks.find(this.$route.params.uid)
    }
  }
}
</script>
