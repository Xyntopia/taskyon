import { defineStore } from 'pinia';
import axios from 'axios';
import { api } from 'src/boot/axios';

//TODO: convert store into composition api
export const useAppSettingsStore = defineStore('appSettings', {
  state: () => {
    console.log('initialize app settings');
    return {
      API_DEV_URL: 'http://localhost:5111',
      API_PROD_URL: 'http://localhost',
      PAYMENT_URL: '',
      APPNAME: process.env.APPNAME,
      DESCRIPTION: process.env.DESCRIPTION,
      consent: {
        googleAnalytics: 'firstvisit',
      },
      initial: true, // flag which indicates whether this is the initial state
    };
  },
  getters: {
    apiUrl: (state) => {
      return process.env.DEV ? state.API_DEV_URL : state.API_PROD_URL;
    },
  },
  actions: {
    setApiUrl(newUrl: string) {
      if (process.env.DEV) {
        this.API_DEV_URL = newUrl;
      } else {
        this.API_PROD_URL = newUrl;
      }
      this.updateApiUrl();
    },
    updateApiUrl() {
      api.defaults.baseURL = process.env.DEV
        ? this.API_DEV_URL
        : this.API_PROD_URL;
      console.log('backend URL: ', api.defaults.baseURL);
    },
    setConsent(gaconsent: string) {
      this.consent.googleAnalytics = gaconsent;
    },
  },
});

const store = useAppSettingsStore();

// this file can be replaced in kubernetes  using a configmap!
// that way we can configure our webapp even if its already compiled...
void axios.get('config.json').then((jsonconfig) => {
  // we only want to load the initial configuration the first time we are loading the page...
  if (store.initial) {
    console.log('load App Config', jsonconfig.data);
    store.$state = jsonconfig.data as typeof store.$state;
    store.initial = false;
  }
  store.updateApiUrl();
});

