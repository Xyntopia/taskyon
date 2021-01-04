<template>
  <q-layout view="lHh lpr lff">
    <q-header elevated class="bg-primary text-white">
      <div
        class="row bg-secondary text-primary"
        >
        <q-space/>
        <div class="text-bold bg-red">!! Prototype !!</div>
        <q-space/>
        <q-btn type="a" href="https://hq.componardo.com/"
          target="_blank"
          size="sm" flat dense stretch icon="business" label="About the Company"/>
        <q-btn type="a" :href="baseURL+`/docs`"
          target="_blank"
          size="sm" flat dense stretch icon="info" label="Api-Docs"/>
      </div>
      <q-toolbar>
        <div class="row">
          <q-btn
            flat
            dense
            round
            @click="leftDrawerOpen = !leftDrawerOpen"
            icon="menu"
            aria-label="Menu"
          />
          <div>
            <q-btn v-for="def in appLinks" v-bind:key="def[0]+def[1]"
              flat
              dense
              round
              :to="def[2]"
              :icon="def[1]"
              :aria-label="def[0]"
            />
          </div>
        </div>
        <q-space />
        <img
            class="xs"
            src="icons/favicon-32x32.png"
        >
        <q-space />
        <div>
          <div class="gt-xs">DEMO @ {{ baseURL }}</div>
          <div v-if='isLoggedIn' class="gt-xs text-bold">{{ userName }}</div>
        </div>
        <q-icon v-if='isLoggedIn' name="done"/>
        <q-btn
            flat dense round
            to="/login"
            icon="person" aria-label="Home"
        />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      content-class="bg-primary text-white"
    >
      <q-list>
        <q-item v-for="def in appLinks" v-bind:key="def[0]+def[1]"
          :to="def[2]" active-class="q-item-no-link-highlighting">
          <q-item-section avatar>
            <q-icon :name="def[1]"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ def[0] }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-expansion-item
          icon="settings"
          label="Administration"
          default-opened
        >
          <q-list class="q-pl-md">
            <q-item v-for="link in settingsLinks" v-bind:key="link[0]+link[1]"
              :to="link[2]" active-class="q-item-no-link-highlighting">
              <q-item-section avatar>
                <q-icon :name="link[1]"/>
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ link[0] }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>

        <q-item clickable @click.native="openLink('https://hq.componardo.com')">
          <q-item-section avatar>
            <q-icon name="business"/>
          </q-item-section>
          <q-item-section>
            <q-item-label>Get Componardo Solutions for your business!</q-item-label>
          </q-item-section>
        </q-item>

      </q-list>
    </q-drawer>

    <q-page-container>
      <keep-alive :max=5 :include="keepAlivePages">
        <router-view />
      </keep-alive>
      <!--<router-view/>-->
    </q-page-container>
  </q-layout>
</template>

<script>
import { mapState, mapGetters } from 'vuex'
import { openURL } from 'quasar'

export default {
  name: 'MainLayout',
  data () {
    return {
      leftDrawerOpen: false,
      keepAlivePages: [
        'ExtractComponentData',
        'PageConfigurator'
      ]
    }
  },
  created () {
    this.$q.addressbarColor.set('#F78F3B')
  },
  methods: {
    openLink (link) {
      openURL(link)
    }
  },
  computed: {
    appLinks () {
      //       <!-- other sybols that work for the "offer configurator" are:
      //       extension, mediation, redeem, shopping_cart, shopping_basket,
      //       smart_button, square_foot, save_alt, unarchive, monetization_on,
      //       assistant, local_offer, miscellaneous_services
      //       -->

      const links = []
      // format is:  [label, icon, link]
      if (process.env.SEARCH) { links.push(['Search', 'search', '/search']) }
      if (process.env.CONFIGURATOR) { links.push(['Configurator', 'engineering', '/configurator']) }
      if (process.env.OFFERS) { links.push(['Configurable Offers', 'mediation', '/offerconfigurator']) }
      if (process.env.EXTRACTOR) { links.push(['Extract Component Data', 'find_in_page', '/extractcomponentdata']) }
      return links
    },
    settingsLinks () {
      const links = []
      // format is:  [label, icon, link]
      if (process.env.SETTINGS) { links.push(['Componardo Settings', 'settings', '/ComponardoSettings']) }
      if (process.env.CONFIGURATOR) { links.push(['Projects Admin', 'design_services', '/ProjectsAdmin']) }
      if (process.env.SCRAPER) { links.push(['Scraper Control Panel', 'api', '/ScraperControlPanel']) }
      links.push(['User Profile', 'person', '/User'])
      return links
    },
    ...mapState('comcharax', [
      'userName',
      'baseURL'
    ]),
    ...mapGetters('comcharax', [
      'isLoggedIn'
    ])
  }
}
</script>
