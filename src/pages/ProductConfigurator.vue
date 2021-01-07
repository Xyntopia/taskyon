<template>
  <q-page class="bg-secondary q-pa-xl q-gutter-xs column items-stretch justify-start">
    <div class="col">
      <q-table
        :title="Project.name"
        :data="data"
        :columns="columns"
        dense
        :pagination="pagination"
        separator="none"
        hide-bottom
      >
        <template v-slot:top="props">
            <div class="col-2 q-table__title">{{ Project.name }}</div>

            <q-space />

            <q-btn
            flat round dense
            :icon="props.inFullscreen ? 'fullscreen_exit' : 'fullscreen'"
            @click="props.toggleFullscreen"
            class="q-ml-md"
            />
        </template>
      </q-table>
    </div>
    <div class="col">
      <q-card>
        <q-card-section>
          <div class="text-h6">Configure product</div>
          <q-btn label="optimize"/>
        </q-card-section>
        <q-card-section>
          <q-list bordered separator>
            <q-item
              v-for="(req, index) in soft_requirements" :key="req">
              <q-item-section class="col-auto column">
                <q-btn dense flat size="sm" icon="keyboard_arrow_up"/>
                <q-btn dense flat size="sm" icon="keyboard_arrow_down"/>
              </q-item-section>
              <q-item-section class="col-auto q-mx-lg text-h6">{{index}}</q-item-section>
              <q-item-section>
                {{ req }}
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script>

export default {
  name: 'ProductConfigurator',
  components: {
  },
  data () {
    return {
      optimization: 'price',
      soft_requirements: [
        'price',
        'power consumption',
        'size'
      ]
    }
  },
  mounted () {
    this.Projects.fetchById(this.$route.params.uid)
  },
  computed: {
    pagination () {
      return {
        sortBy: 'name',
        descending: false,
        page: 2,
        rowsPerPage: 0
      }
    },
    data () {
      return this.Project.componentcontainers
    },
    columns () {
      return [
        { label: 'name', name: 'name', field: 'name', sortable: false },
        { label: 'type', name: 'type', field: 'type', sortable: false },
        { label: 'price', name: 'price', field: 'price', sortable: false }
      ]
    },
    Projects () {
      return this.$store.$db().model('projects')
    },
    Project () {
      return this.Projects.find(this.$route.params.uid)
    }
  }
}
</script>
