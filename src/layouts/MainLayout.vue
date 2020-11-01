<template>
  <q-layout view="lHh lpr lff">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <div>
          <q-btn
            flat
            dense
            round
            @click="leftDrawerOpen = !leftDrawerOpen"
            icon="menu"
            aria-label="Menu"
          />
          <q-btn
            flat
            dense
            round
            to="/"
            icon="home"
            aria-label="Home"
          />
          <q-btn
            flat
            dense
            round
            to="/configurator"
            icon="engineering"
            aria-label="Home"
          />
          <!-- other sybols that work for the "offer configurator" are:
          extension, mediation, redeem, shopping_cart, shopping_basket,
          smart_button, square_foot, save_alt, unarchive, monetization_on,
          assistant, local_offer, miscellaneous_services
          -->
          <q-btn
            flat
            dense
            round
            to="/offers"
            icon="assistant"
            aria-label="Home"
          />
          <q-btn
            flat
            dense
            round
            to="/extractcomponentdata"
            icon="find_in_page"
            aria-label="Home"
          />
        </div>
        <q-space />
        <div>Componardo-DEMO
          <q-btn
            flat
            dense
            round
            to="/login"
            icon="person"
            aria-label="Home"
          />
        </div>
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
            <q-icon name="engineering"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>Configurator</q-item-label>
          </q-item-section>
        </q-item>
        <q-item to="/offers" active-class="q-item-no-link-highlighting">
          <q-item-section avatar>
            <q-icon name="extension"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>Dynamic Offers</q-item-label>
          </q-item-section>
        </q-item>
        <q-item to="/extractcomponentdata" active-class="q-item-no-link-highlighting">
          <q-item-section avatar>
            <q-icon name="find_in_page"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>Extract Component Data</q-item-label>
          </q-item-section>
        </q-item>
        <q-expansion-item
          icon="settings"
          label="Administration"
        >
          <q-list class="q-pl-md">
            <q-item to="/ComponardoSettings" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon name="settings"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>Componardo Settings</q-item-label>
              </q-item-section>
            </q-item>
            <q-item to="/ProjectsAdmin" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon name="design_services"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>Projects Admin</q-item-label>
              </q-item-section>
            </q-item>
            <q-item to="/ScraperControlPanel" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon name="api"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>Scraper Control Panel</q-item-label>
              </q-item-section>
            </q-item>
            <q-item to="/User" active-class="q-item-no-link-highlighting">
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

    <q-page-container>
      <keep-alive :max=5 include="ExtractComponentData">
        <router-view />
      </keep-alive>
      <!--<router-view/>-->
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
