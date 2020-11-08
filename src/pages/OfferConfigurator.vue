<template>
  <q-page class="bg-secondary q-pa-xl">
    <div class="column items-center q-gutter-lg">
      <div class="col-auto text-h4">Sell Configurable Offers!</div>
      <div class="col-auto row q-gutter-md">
        <div class="col-auto" v-for="p in Projects.all()" :key=p.uid>
          <q-card class="q-pa-md">
            <q-card-section class="text-h6">{{ p.name }}</q-card-section>
            <q-card-action>
              <q-btn class="fit" color="primary" label="configure"/>
            </q-card-action>
          </q-card>
        </div>
      </div>
      <div class="col">
        PUBLISHED CONFIGURATOR
      </div>
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
