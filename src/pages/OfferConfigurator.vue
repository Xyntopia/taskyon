<template>
  <q-page class="bg-secondary q-pa-xl">
    <div class="column items-center q-gutter-lg">
      <div class="col-auto text-h4">Sell Configurable Offers!</div>
      <div class="col-auto row q-gutter-md">
        <div class="col-auto" v-for="p in Projects.all()" :key=p.uid>
          <q-card class="q-pa-md">
            <q-card-section class="text-h6">{{ p.name }}</q-card-section>
            <q-card-actions>
              <q-btn
                :to="{ name: 'productconfigurator', params: { uid: p.uid }}"
                class="fit" color="primary" label="configure"/>
            </q-card-actions>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script>

export default {
  name: 'Offers',
  components: {
  },
  data () {
    return {
    }
  },
  mounted () {
    this.Projects.downloadProjects()
  },
  computed: {
    Projects () {
      return this.$store.$db().model('projects')
    }
  }
}
</script>
