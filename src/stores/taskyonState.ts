import { defineStore } from 'pinia';
import axios from 'axios';
import { defaultChatState } from 'src/modules/chat';
import { run } from 'src/modules/taskWorker';

//TODO: convert store into composition api
export const useTaskyonStore = defineStore('taskyonState', {
  state: () => {
    console.log('initialize taskyon');
    const initialState = {
      chatState: defaultChatState(),
      userInput: '',
      selectedTools: [] as string[],
      expertMode: false,
      drawerOpen: false,
      drawerRight: false,
      debugMessageExpand: {},
      darkTheme: 'auto' as boolean | 'auto',
      messageVisualization: {} as Record<string, boolean>, // whether message with ID should be open or not...
    };
    return initialState;
  },
  getters: {
    /*apiUrl: (state) => {
      return process.env.DEV ? state.API_DEV_URL : state.API_PROD_URL;
    },*/
  },
  actions: {
    /*
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
    */
  },
});

const store = useTaskyonStore();
void run(store.chatState);

// this file can be replaced in kubernetes  using a configmap!
// that way we can configure our webapp even if its already compiled...
void axios.get('config.json').then((jsonconfig) => {
  // we only want to load the initial configuration the first time we are loading the page...
  /*if (store.initial) {
    console.log('load App Config', jsonconfig.data);
    store.$state = jsonconfig.data as typeof store.$state;
    store.initial = false;
  }
  store.updateApiUrl();*/
});
