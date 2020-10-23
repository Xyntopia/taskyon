<template>
  <q-page class="bg-secondary q-pa-xl">
  <div class="q-col-gutter-xl row">
    <div class="col-3">
      <q-card>
        <q-card-section>
          Initialize underlying Graph DB with all required options:<br>
          - reset indices <br>
          - set default users <br>
          - initialize datascheme
        </q-card-section>
        <q-card-actions>
          <q-btn color="primary" label="Initialize DB"  @click="onInitDB"/>
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-3">
      <q-card>
        <q-card-section>
          Delete all Data from DB.<br>
        </q-card-section>
        <q-card-actions>
          <q-btn color="primary" label="Reset DB"/>
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-3">
      <q-card>
        <q-card-section>
          Set Relevant URLs
        </q-card-section>
        <q-card-actions>
          <q-input
          outlined bg-color="white"
          label="Comcharax API URL" v-model="urlGraphengine"
          type="url" debounce="500" prefix="http://"
          disable readonly
          />
          <q-input
          outlined bg-color="white"
          label="Database URL" v-model="urlDatabase"
          type="url" debounce="500"
          disable readonly
          />
        </q-card-actions>
      </q-card>
    </div>
  </div>
  </q-page>
</template>

<script>

export default {
  name: 'ComcharaxControlPanel',
  components: {
  },
  data () {
    return {
      urlGraphengine: '127.0.0.1:5000',
      urlDatabase: 'bolt+',
      searchDir: ''
    }
  },
  methods: {
    onInitDB () {
      console.log('reset db !!!')
      this.$store.dispatch('initDB')
    }
  }
}
</script>
