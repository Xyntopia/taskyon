<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          @click="leftDrawerOpen = !leftDrawerOpen"
          icon="menu"
          aria-label="Menu"
        />

        <q-toolbar-title>
          Coxacon
        </q-toolbar-title>

        <div>DEMO</div>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      content-class="bg-primary text-white"
    >
      <q-list>
        <q-item to="/" active-class="q-item-no-link-highlighting">
          <q-item-section avatar>
            <q-icon name="search"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>Search</q-item-label>
          </q-item-section>
        </q-item>
        <q-item to="/configurator" active-class="q-item-no-link-highlighting">
          <q-item-section avatar>
            <q-icon name="device_hub"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>Configurator</q-item-label>
          </q-item-section>
        </q-item>
        <q-expansion-item
          icon="settings"
          label="Administration"
        >
          <q-list class="q-pl-lg">
            <q-item to="/Configuration" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon name="design_services"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>Configurator Templates</q-item-label>
              </q-item-section>
            </q-item>
            <q-item to="/ComcharaxControlPanel" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon name="api"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>Comcharax Control Panel</q-item-label>
                <q-item-label>Scraper Control Panel</q-item-label>
              </q-item-section>
            </q-item>
            <q-item to="/Profile" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon name="person"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>User Profile</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>
      </q-list>
    </q-drawer>

    <q-page-container class="bg-secondary">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script>

export default {
  name: 'MainLayout',
  data () {
    return {
      leftDrawerOpen: false
    }
  }
}
</script>
