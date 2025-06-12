// this store simply defines the state of our app witout any logic or background tasks etc,,,
// this makes it easy to integrate it with SSR for example...

import { defineStore } from 'pinia'
import { computed, reactive, toRefs, type Reactive, watch } from 'vue'
import type { FunctionCall } from 'src/modules/taskyon/types'
import { type tyPublicKeyDraft, storedSettings } from 'src/modules/taskyon/types'
import axios from 'axios'
import { LocalStorage, useQuasar } from 'quasar' // TODO: load dynamically! :)
import {
  clearBrowserCaches,
  clearCookies,
  clearServiceWorkers,
  deepMerge,
  deepMergeReactive,
  sleep,
} from 'src/modules/utils'
import { unref } from 'vue'
import defaultSettings from 'src/assets/taskyon_settings.json'
import { generateAssymetricRandomNewKey } from 'src/modules/crypto_js'
import { isTaskyonKey } from 'src/modules/taskyon/tyCrypto'

interface TaskStateType {
  markdownEnabled: boolean
}

function clearBrowserStorage() {
  LocalStorage.clear()
  sessionStorage.clear()
  clearBrowserCaches()
  clearServiceWorkers()
  clearCookies()
}

// TODO: make sure, we save/load our store state from inside the below store function!
//       and get rid of automatically saving it in our stores/index.ts
const storeName = 'taskyonState'

// this is where we save all of our app settings.
// its important to keep this simple and don't incude 3rd party libraries and othe things
// because we want to this to also work on tyServer and in a "minimal gui" setting.
// So we only want data to be loaded & saved here, and not any taskyon logic or other fancy things...
export const useAppStateStore = defineStore(storeName, () => {
  const defaultStorableSettings = storedSettings.parse(defaultSettings)
  // llmSettings & appConfiguration define the state of our app!
  // the rest of the state is eithr secret (keys) or temporary states which don't need to be saved
  const initialState = {
    ...defaultStorableSettings,
    keys: {} as Record<string, string>,
    // app State which should be part of the configuration
    // the things below should only represent transitional states
    // which have no relevance in the actual configuration of the app.
    initialLoad: true, // if the app was loaded for the first time and needs to be initialized
    expandedTaskCreation: false,
    selectChatBotExpand: true,
    allowedToolsExpand: true,
    drawerRight: false,
    // variable to track if the user is at the bottom of a task chat
    lockBottomScroll: true,
    modelHistory: [] as string[],
    // we save our last used leaf tasknodes here so
    // that we can show them on the left side...
    chatHistory: [] as string[],
    newToolDraftCode: '' as string,
    configurationDraft: '' as string,
    // remembers how tasks are display in the chatwindow in task widgets...
    // TODO: rename this to "taskWidgetState"
    taskState: {} as Record<string, TaskStateType>,
    darkTheme: 'auto' as boolean | 'auto',
    // this store everything relevant to iframes
    iframe: {
      accessGranted: false,
      accessWhiteList: [] as string[],
      parentUrl: '',
    },
    createTaskType: {
      type: 'message',
    } as { type: 'message' } | { type: 'functioncall'; name: FunctionCall['name'] }, // the type of task we are currently working on
    messageDraft: '' as string,
    // we use this here to store the different types of task drafts that we were working on.
    draftParameters: {} as Record<FunctionCall['name'], FunctionCall['arguments']>,
    // can be used to exchange certain keys and make taskyon
    // aware of different URLs etc...
    developerMode: false,
    useDevVersion: false,
    messageDebug: {} as Record<string, 'RAW' | 'MESSAGECONTENT' | 'RAWTASK' | 'ERROR' | undefined>, // whether message with ID should be open or not...
    // taskyon.space-specific section, TODO: move this somewhere else!
    keyDraft: {
      name: 'N/A',
      maxc: 5.0,
      cpi: 0.2, // USD6/month
      rti: 1440,
      model: [],
    } as tyPublicKeyDraft,
    // save our model search string on the pricing page...
    // this makes it easier to come back to a filtered list for model
    // selection
    modelFilter: '' as string | null,
  }

  // overwrite with saved configuration:
  console.log('load saved app state!')
  const getStoredStateString = () => LocalStorage.getItem(storeName) as string
  const initialStoredStateString = getStoredStateString()
  const initialStoredStateObj = JSON.parse(initialStoredStateString) as
    | Partial<typeof initialState>
    | undefined
  let stateRefs: Reactive<typeof initialState>
  if (
    initialStoredStateObj &&
    initialStoredStateObj.version &&
    initialStoredStateObj.version === initialState.version
  ) {
    console.log(`load saved ${storeName} state!`)
    const storedInitialState = deepMerge(initialState, initialStoredStateObj, 'overwrite')
    stateRefs = reactive(storedInitialState)
  } else {
    // TODO: pop up a dialog where we inform the user about this!!
    console.warn(
      `Stored settings version (${
        initialStoredStateObj?.version || 'undefined'
      }) is not compatible with current version (${initialState.version}). Using default settings.`,
    )
    clearBrowserStorage()
    stateRefs = reactive(initialState)
  }

  // store the state on every change!! :)
  watch(stateRefs, (newState) => {
    //console.log('saved store!!');
    LocalStorage.set(storeName, JSON.stringify(newState))
  })

  if (stateRefs.initialLoad) {
    void generateAssymetricRandomNewKey().then((r) => (stateRefs.llmSettings.userId = r.publicKey))
  }

  // this file could potentially be replaced in kubernetes or docker using a configmap!
  // that way we can configure our webapp even if its already compiled...
  // this is done asynchrounously, because we want to be able to dynamically
  // change our config without having to recompile taskyon.
  void axios
    .get<
      | {
          version?: number
          llmSettings: typeof initialState.llmSettings
          appConfiguration: typeof initialState.appConfiguration
        }
      | undefined
    >(stateRefs.appConfiguration.appConfigurationUrl)
    .then((jsonconfig) => {
      const config = jsonconfig.data
      // TODO: we need to do much better parsing here...  possibly with zod to make sure
      //       we get back correct configuration versions etc..
      if (config) {
        const isVersionCompatible = config.version && config.version === initialState.version

        if (isVersionCompatible) {
          // we only want to load the initial configuration the first time we are loading the page...
          console.log('merge dynamic app config', jsonconfig.data)

          // if this is *not* an initial load, we only add "new" values that can be found in the configuration.
          const mergeStrategy = stateRefs.initialLoad ? 'overwrite' : 'additive'
          deepMergeReactive(stateRefs.appConfiguration, config.appConfiguration, mergeStrategy)
          deepMergeReactive(stateRefs.llmSettings, config.llmSettings, mergeStrategy)
        } else {
          console.warn(
            `Config version (${
              config.version || 'undefined'
            }) is not compatible with current version (${initialState.version}). Skipping dynamic config merge.`,
          )
        }
        stateRefs.initialLoad = false
      }
    })
    .catch((error) => {
      console.error('Failed to load dynamic app config:', error)
    })

  // TODO: check if we can do this maybe a bit more elegant using pinia functions?  like using "clear" or something like that?
  function $reset() {
    // this function doesn't 100% work.  each of the following
    // sould theoretically be enough to do the reset. But somehow they are not.
    // I assume it is some synchronization issue with localstorage.
    // But this is why we are trying several methods of deletion..
    // TODO:  also add indexeddb valus to this.. (selectivly)
    console.log('Resetting Taskyon!!')
    stateRefs.appConfiguration = defaultStorableSettings.appConfiguration
    stateRefs.llmSettings = defaultStorableSettings.llmSettings
    stateRefs.version = 0 as typeof stateRefs.version // set the version to 0, hoping, that this will trigger a reset on page reload..
    clearBrowserStorage()
    console.log('done, resetting! reloading page now...')
    void sleep(1000).then(() => (window.location.href = '/'))
  }

  const $q = useQuasar()

  $q.dark.set(stateRefs.darkTheme)

  const minimalGui = computed(() => {
    let mode = false
    switch (stateRefs.appConfiguration.guiMode) {
      case 'default':
        mode = false
        break
      case 'iframe':
        mode = true
        break
      case 'auto':
        mode = $q.platform.within.iframe
        break
    }
    return mode
  })

  // we do this funny next line, because our store is currently "reactive" which means
  // all scalars like strings, numbers etc..  ar actually non-reactive (vue reactive only converts
  // nested objects into reactive as well). So by doing "toRefs" we ensure that all values are reactive
  // even after destructuring, which we do when returning values from this store.
  // The next issue is that typescript isn't able to recognize the type anymore when
  // we do the toRefs operation, so we simply reassign the same type "stateRefs" to it again which seems to work...
  const allRefs = toRefs(stateRefs) as unknown as typeof stateRefs

  // it is *SUPERIMPORTANT*  that we ONLY return computed refs & functions in the store EXCEPT
  // evrything in "stateRefs/allRefs". The reason for this is, that we have a store
  // hydration mechanism to automatically save & load the store from localStorage
  return {
    setSelectedTask: (taskId: string | null | undefined) => {
      console.log('set selected task:', taskId)
      stateRefs.llmSettings.selectedTaskId = taskId || undefined
    },
    ...allRefs, // we need to convert everything into refs, as we have a reactive object which only turns
    getStateValues: () => unref(allRefs),
    getStoredStateString,
    $reset,
    minimalGui,
    tyPublicKey: computed(() => {
      return isTaskyonKey(stateRefs.keys.taskyon || '', false)
    }),
  }
})
