<template>
  <q-page class="bg-secondary">
    All Projects:
    <div v-for="p in Projects.all()" :key=p.uid>
    - {{ p.name }}
    </div>
  </q-page>
</template>

<script>

export default {
  name: 'ProjectsAdmin',
  components: {
  },
  data () {
    return {
      model: null,
      options: null
    }
  },
  mounted () {
    this.$store.dispatch('comcharax/downloadProjects')
  },
  computed: {
    Projects () {
      return this.$store.$db().model('projects')
    }
  }
}
</script>
