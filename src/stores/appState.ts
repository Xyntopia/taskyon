// this store simply defines the state of our app witout any logic or background tasks etc,,,
// this makes it easy to integrate it with SSR for example...

import { defineStore } from 'pinia'
import { computed, reactive, toRefs, type Reactive, watch } from 'vue'
import { type tyPublicKeyDraft, TyProfile } from 'src/modules/taskyon/types'
import axios from 'axios'
import { LocalStorage, useQuasar } from 'quasar' // TODO: load dynamically! :)
import type { MergeOptions } from 'src/modules/utils'
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
import type { PartialDeep } from 'type-fest'
import { initialStoredStateObj, storeName } from 'src/modules/ui/initialState'
import type { FunctionCall } from '@taskyon/taskyon'

interface TaskWidgetStateType {
  markdownEnabled: boolean
}

function clearBrowserStorage() {
  LocalStorage.clear()
  sessionStorage.clear()
  clearBrowserCaches()
  clearServiceWorkers()
  clearCookies()
}

// this is where we save all of our app settings.
// its important to keep this simple and don't incude 3rd party libraries and other things
// because we want to this to also work on tyServer and in a "minimal gui" setting.
// So we only want data to be loaded & saved here, and not any taskyon logic or other fancy things...
export const useAppStateStore = defineStore(storeName, () => {
  const res = TyProfile.safeParse(defaultSettings)
  if (!res.success) {
    throw new Error('The default settings provided do not work!', { cause: res.error.message })
  }
  const defaultStorableSettings = res.data
  // llmSettings & appConfiguration define the state of our app!
  // the rest of the state is eithr secret (keys) or temporary states which don't need to be saved
  const initialState = {
    ...defaultStorableSettings,
    keys: {} as Record<string, string>,
    // app State which should be part of the configuration
    // the things below should only represent transitional states
    // which have no relevance in the actual configuration of the app.
    initialLoad: true, // if the app was loaded for the first time and needs to be initialized
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
    taskWidgetState: {} as Record<string, TaskWidgetStateType>,
    createTaskType: {
      type: 'message',
    } as { type: 'message' } | { type: 'functioncall'; name: FunctionCall['name'] }, // the type of task we are currently working on
    messageDraft: '' as string | undefined,
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

  const initialStoredStateObjTyped = initialStoredStateObj as
    | Partial<typeof initialState>
    | undefined

  let stateRefs: Reactive<typeof initialState>
  if (
    initialStoredStateObjTyped &&
    initialStoredStateObjTyped.version &&
    initialStoredStateObjTyped.version === initialState.version
  ) {
    console.log(`load saved ${storeName} state!`)
    const storedInitialState = deepMerge(initialState, initialStoredStateObjTyped, 'overwrite')
    stateRefs = reactive(storedInitialState)
  } else {
    // TODO: pop up a dialog where we inform the user about this!!
    console.warn(
      `Stored settings version (${
        initialStoredStateObjTyped?.version || 'undefined'
      }) is not compatible with current version (${initialState.version}). Using default settings.`,
    )
    clearBrowserStorage()
    stateRefs = reactive(initialState)
  }

  // Flag that tells the persister to skip the next change
  let saveToLocalStorage = true

  // store the state on every change!! :)
  watch(stateRefs, (newState) => {
    //console.log('saved store!!');
    if (saveToLocalStorage) {
      LocalStorage.set(storeName, JSON.stringify(newState))
    }
  })

  if (stateRefs.initialLoad) {
    void generateAssymetricRandomNewKey().then((r) => (stateRefs.llmSettings.userId = r.publicKey))
  }

  function overrideSettings(newConfig: PartialDeep<TyProfile>, persist: boolean = false) {
    saveToLocalStorage = persist
    if (newConfig.llmSettings) {
      // TODO: make sure, this function is only temporary and doesn't overwrite our actual llmSettings...
      deepMergeReactive(stateRefs.llmSettings, newConfig.llmSettings)
    }
    if (newConfig.appConfiguration) {
      deepMergeReactive(stateRefs.appConfiguration, newConfig.appConfiguration)
    }
    if (newConfig.toolchainConfig) {
      deepMergeReactive(stateRefs.toolchainConfig, newConfig.toolchainConfig)
    }
    // and also set a possible signature as the api key!
    if (stateRefs.llmSettings.selectedApi && newConfig.signatureOrKey) {
      // we only set the API key, if it was provided by the
      // parent app.
      const newKey = newConfig.signatureOrKey
      if (typeof newKey === 'string') {
        stateRefs.keys[stateRefs.llmSettings.selectedApi] = newKey
      } else {
        console.warn('Provided signatureOrKey is not a string:', newKey)
      }
    }
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
          const mergeStrategy: MergeOptions = stateRefs.initialLoad
            ? {
                arrays: 'overwrite',
                objects: 'overwrite',
                primitives: 'preserve',
              }
            : { arrays: 'concat', objects: 'merge', typeMismatch: 'target', primitives: 'preserve' }
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

  watch(() => stateRefs.appConfiguration.darkTheme, $q.dark.set, {
    immediate: true,
  })

  const minimalGui = computed<Exclude<typeof stateRefs.appConfiguration.guiMode, 'auto'>>(() => {
    if (stateRefs.appConfiguration.guiMode === 'auto') {
      return $q.platform.within.iframe ? 'iframe' : 'default'
    }
    return stateRefs.appConfiguration.guiMode
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
    overRideSettings: overrideSettings,
    getStateValues: () => unref(allRefs),
    $reset,
    minimalGui,
    tyPublicKey: computed(() => {
      return isTaskyonKey(stateRefs.keys.taskyon || '', false)
    }),
  }
})
