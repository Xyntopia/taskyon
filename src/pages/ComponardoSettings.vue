<template>
  <q-page class="bg-secondary q-pa-lg componardo-settings">
  <div class="q-col-gutter-lg row">
    <div class="col-auto">
      <q-card>
        <q-card-section>
          Initialize underlying Graph DB with all required options:<br>
          - reset indices <br>
          - set default users <br>
          - initialize datascheme
        </q-card-section>
        <q-card-actions>
          <q-btn label="Initialize DB"  @click="onInitDB(false)"/>
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-auto">
      <q-card>
        <q-card-section>
          Delete all Data from DB.<br>
        </q-card-section>
        <q-card-actions>
          <q-btn label="Reset DB" @click="onInitDB(true)"/>
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-auto">
      <q-card>
        <q-card-section>
          Set Relevant URLs
        </q-card-section>
        <q-card-actions>
          <q-input
          outlined
          label="Comcharax API URL" v-model="baseURL"
          type="url" debounce="500"
          disable readonly
          />
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-auto">
      <q-card style="max-width: 300px;">
        <q-card-section>
          Tokens:
          <q-item-section>
            <q-item-label style="overflow-wrap: break-word;">{{ token }}</q-item-label>
          </q-item-section>
        </q-card-section>
      </q-card>
    </div>
    <div class="col-auto">
      <q-card>
        <q-card-section>
          <q-list dense>
            <q-item v-for="(val, key) in backendSettings" :key="key">
              <q-item-section>
                <q-item-label class="text-weight-bold">{{ key }}</q-item-label>
              </q-item-section>
              <q-item-section>
                <q-item-label style="overflow-wrap: break-word;">{{ val }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-card-actions>
          <q-btn label="update" @click="onUpdateSettings"/>
        </q-card-actions>
      </q-card>
    </div>
  </div>
  </q-page>
</template>

<style lang="sass">
.componardo-settings .q-btn
  color: black
  background-color: $tools
</style>

<script>

import { mapState } from 'vuex'

export default {
  name: 'ComcharaxControlPanel',
  components: {
  },
  data () {
    return {
      password: null,
      username: null,
      isPwd: 'visibility_off'
    }
  },
  computed: {
    ...mapState('comcharax', [
      'token', 'baseURL', 'backendSettings'
    ])
  },
  methods: {
    onInitDB (reset) {
      console.log('reset db !!! ' + reset)
      this.$store.dispatch('comcharax/initDB', reset)
    },
    onUpdateSettings () {
      this.$store.dispatch('comcharax/getSettings')
    }
  }
}
</script>
