<template>
  <q-page class="bg-secondary row justify-center items-center">
    <div
      v-if="!isLoggedIn"
      class="row">
      <q-card class="q-pa-lg">
        <q-card-section class="text-center q-pa-none">
          <p class="text-red-6">Demo: only "<b>{{ username }}</b>" account works right now!!!</p>
        </q-card-section>
        <q-card-section>
          <q-form
            class="q-gutter-md"
            @submit="onSubmit">
            <q-input filled v-model="username" name="username" type="text" label="Email" />
            <q-input filled v-model="password" name="password" :type="isPwd ? 'password' : 'text'" label="Password">
              <template v-slot:append>
                <q-icon
                  :name="isPwd ? 'visibility_off' : 'visibility'"
                  class="cursor-pointer"
                  @click="isPwd = !isPwd"
                />
              </template>
            </q-input>
            <q-input filled v-model="componardoURL" type="url" label="Componardo Server" />
            <div>
              <q-btn size="lg" class="fit" color="primary" label="Login" type="submit"/>
            </div>
          </q-form>
        </q-card-section>
      </q-card>
    </div>
    <div
      v-else
      class="row">
      <q-card class="q-pa-lg">
        <q-card-section class="q-pa-none">
        Username: {{ userName }} <br>
        BaseURL: {{ baseURL }}
        </q-card-section>
        <q-card-actions>
          <q-btn class="fit" size="lg" label="Log Out" color="primary" @click="onLogOut"/>
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script>
import { mapGetters, mapState } from 'vuex'

export default {
  name: 'Login',
  data () {
    return {
      isPwd: true,
      username: 'DefaultUser@Componardo.com',
      password: '',
      componardoURL: ''
    }
  },
  mounted () {
    this.componardoURL = this.baseURL
  },
  computed: {
    ...mapGetters('comcharax', [
      'getTokenInfo',
      'isLoggedIn'
    ]),
    ...mapState('comcharax', [
      'userName',
      'baseURL'
    ])
  },
  methods: {
    onLogOut (event) {
      this.$store.dispatch('comcharax/logOut', null)
    },
    onSubmit (event) {
      console.log('authenticate user!')
      this.$store.dispatch('comcharax/authenticate', {
        username: this.username,
        password: this.password,
        baseURL: this.componardoURL
      })
    }
  }
}
</script>
