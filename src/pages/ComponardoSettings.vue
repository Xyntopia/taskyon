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
          <q-input
          outlined
          label="Database URL" v-model="urlDatabase"
          type="url" debounce="500"
          disable readonly
          />
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-auto">
      <q-card>
        <q-card-section>
          Username & Password
        </q-card-section>
        <q-card-actions>
          <q-btn label="Logout"/>
          <q-input  v-if="false"
          outlined
          label="Username" v-model="username"
          type="url" debounce="500"
          disable readonly password
          />
          <q-input  v-if="false"
            v-model="password" outlined
            :type="isPwd ? 'password' : 'text'"
            label="Password"
            disable readonly>
            <template v-slot:append>
              <q-icon
                :name="isPwd ? 'visibility_off' : 'visibility'"
                class="cursor-pointer"
                @click="isPwd = !isPwd"
              />
            </template>
          </q-input>
        </q-card-actions>
      </q-card>
    </div>
    <div class="col-auto">
      <q-card>
        <q-card-section>
          Status
        </q-card-section>
        <q-card-actions>
          <q-btn label="refresh"/>
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
    ...mapState({
      token: state => state.comcharax.token,
      baseURL: state => state.comcharax.baseURL
    })
  },
  methods: {
    onInitDB (reset) {
      console.log('reset db !!! ' + reset)
      this.$store.dispatch('initDB', reset)
    }
  }
}
</script>
