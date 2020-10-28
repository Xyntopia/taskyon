<template>
  <q-page class="bg-secondary row justify-center items-center">
    <div class="row">
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
            <q-input filled disable prefix="https://" v-model="server" type="url" label="Componardo Server" />
            <div>
              <q-btn size="lg" class="fit" color="primary" label="Login" type="submit"/>
            </div>
          </q-form>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script>
export default {
  name: 'Login',
  data () {
    return {
      isPwd: true,
      server: 'localhost',
      username: 'DefaultUser@Componardo.com',
      password: ''
    }
  },
  methods: {
    onSubmit (event) {
      console.log('authenticate user!')
      this.$store.dispatch('authenticate', {
        username: this.username,
        password: this.password
      })
    }
  }
}
</script>
