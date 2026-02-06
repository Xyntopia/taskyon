// this store simply defines the state of our app witout any logic or background tasks etc,,,
// this makes it easy to integrate it with SSR for example...

import axios from 'axios'
import { defineStore } from 'pinia'
import { LocalStorage, useQuasar } from 'quasar' // TODO: load dynamically! :)
import defaultSettings from 'src/assets/taskyon_settings.json?raw'
import { TyProfile } from 'src/modules/taskyon/types'
import type { MergeOptions } from 'src/modules/utils'
import {
  clearBrowserCaches,
  clearCookies,
  clearServiceWorkers,
  deepMergeReactive,
} from 'src/modules/utils'
import type { DeepReadonly } from 'vue'
import { computed, reactive, ref, toRefs, unref, watch, type Reactive } from 'vue'
// TODO: remove, to make this file here faster...
import type { KeyString, Thunk, tyPublicKeyDraft } from '@taskyon/taskyon'
import { deepMerge, sleep, type FunctionCall } from '@taskyon/taskyon'
import {
  getCurrentActiveProfileName,
  getTaskyonUiProfile,
  initialStoredStateObj,
  setTaskyonUiProfile,
  switchCurrentActiveProfilePointer,
} from 'src/modules/ui/initialState'
import type { PartialDeep } from 'type-fest'

interface TaskWidgetStateType {
  markdownEnabled: boolean
}

const VSCODE_MESSAGE_SOURCE = 'taskyon-vscode'
const installVscodeConsoleBridge = (() => {
  let installed = false
  return () => {
    if (installed || typeof window === 'undefined') return
    installed = true
    const consoleLevels: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = [
      'log',
      'info',
      'warn',
      'error',
      'debug',
    ]
    const formatArg = (arg: unknown): string => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack || arg.message
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }
    for (const level of consoleLevels) {
      const original = console[level].bind(console)
      console[level] = (...args: unknown[]) => {
        try {
          window.parent?.postMessage(
            {
              source: VSCODE_MESSAGE_SOURCE,
              type: 'vscodeIframeLog',
              payload: {
                level,
                args: args.map(formatArg),
              },
            },
            '*',
          )
        } catch {
          // ignore logging bridge failures
        }
        original(...args)
      }
    }
  }
})()

function clearBrowserStorage(localStorageKeys?: string[]) {
  if (localStorageKeys) localStorageKeys.forEach((key) => LocalStorage.removeItem(key))
  else LocalStorage.clear()
  sessionStorage.clear()
  clearBrowserCaches()
  clearServiceWorkers()
  clearCookies()
}

export function getUrlConfig() {
  if (process.env.CLIENT) {
    const searchParams = new URLSearchParams(window.location.search)
    const isIframeParam = searchParams.get('iframe') === 'true'
    const isVscodeParam =
      searchParams.get('vscode') === 'true' || searchParams.get('vscode') === '1'
    const profile = searchParams.get('profile')
    if (isVscodeParam) installVscodeConsoleBridge()
    console.log('we are in an iframe via param:', isIframeParam)
    const isInIframe = window.self !== window.top || isIframeParam
    console.log('we are in an iframe:', window.self !== window.top, isInIframe)
    return { isInIframe, isInVscode: isVscodeParam, profile }
  } else
    return {
      isInIframe: false,
      isInVscode: false,
      profile: null,
    }
}

function getInitialState() {
  // load storable settings
  const res = TyProfile.safeParse(JSON.parse(defaultSettings))
  if (!res.success) {
    throw new Error('The default settings provided do not work!', { cause: res.error.message })
  }
  const defaultStorableSettings = res.data

  // llmSettings & appConfiguration define the state of our app!
  // the rest of the state is either secret (keys) or temporary states which don't need to be saved
  const initialState = {
    ...defaultStorableSettings,
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

    //////  the following speeds up initialization for taskyon :)
    // if true, taskyon store will wait until a binding key is provided
    // this is persisted in local storage, so that on the next page reload
    // taskyon will wait for the key before initializing taskyon code session
    initWBindingKey: false,
    // TODO:
    initWSession: undefined as string | undefined,

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
    noGuiTests: true,
    detailedTests: false,

    // persistentStorage (for some components which need to temporarily persist some informations...)
    store: {} as Record<string, unknown>,
  }
  return { initialState, defaultStorableSettings }
}

type initialState = ReturnType<typeof getInitialState>['initialState']

function loadConfigurationFile(initialState: initialState, stateRefs: Reactive<initialState>) {
  void axios
    .get<
      | {
          version?: number
          llmSettings: typeof initialState.llmSettings
          appConfiguration: typeof initialState.appConfiguration
          toolchainConfig: typeof initialState.toolchainConfig
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
          deepMergeReactive(stateRefs.toolchainConfig, config.toolchainConfig, mergeStrategy)
        } else {
          console.warn(
            `Config version (${config.version || 'undefined'}) is not compatible with current version (${initialState.version}). Skipping dynamic config merge.`,
          )
        }
        stateRefs.initialLoad = false
      }
    })
    .catch((error) => {
      console.error('Failed to load dynamic app config:', error)
    })
}

const useSessionKey = () => {
  const bindingKey = ref<CryptoKey | null>(null)

  return {
    bindingKey: computed(() => bindingKey.value),
    setBindingKey: (k: CryptoKey | null) => {
      console.log('set new session bindingKey!', k ? 'add new key...' : 'delete key...')
      bindingKey.value = k
    },
  }
}

const saveAndLoadState = (initialState: initialState, pname: Thunk<string | null>) => {
  const initialStoredStateObjTyped = initialStoredStateObj as Partial<initialState> | undefined

  let stateRefs: Reactive<initialState>
  if (
    initialStoredStateObjTyped &&
    initialStoredStateObjTyped.version &&
    initialStoredStateObjTyped.version === initialState.version
  ) {
    console.log(`load saved ui state!`)
    const storedInitialState = deepMerge(initialState, initialStoredStateObjTyped, 'overwrite')
    stateRefs = reactive(storedInitialState)
  } else {
    // TODO: pop up a dialog or a separate migration page where we
    //       inform the user about this and ask them what to do about it...
    console.warn(
      `Stored settings version (${
        initialStoredStateObjTyped?.version || 'undefined'
      }) is not compatible with current version (${initialState.version}). Using default settings.`,
    )
    const pn = pname()
    if (pn) clearBrowserStorage([pn])
    stateRefs = reactive(initialState)
  }

  // Flag that tells the persister to skip the next change
  let saveToLocalStorage = true

  // store the state on every change!! :)
  watch(stateRefs, (newState) => {
    //console.log('saved store!!');
    const pn = pname()
    if (saveToLocalStorage && pn) {
      setTaskyonUiProfile(pn, newState)
    }
  })

  if (stateRefs.initialLoad) {
    stateRefs.llmSettings.userId = 'unknown'
  }

  function overRideSettings(newConfig: PartialDeep<TyProfile>, persist: boolean = false) {
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
  }

  return { overRideSettings, stateRefs }
}

// this is where we save all of our app settings.
// its important to keep this simple and don't incude 3rd party libraries and other things
// because we want to this to also work on tyServer and in a "minimal gui" setting.
// So we only want data to be loaded & saved here, and not any taskyon logic or other fancy things...
export const useAppStateStore = defineStore('ui-state', () => {
  // configuration from the URL!
  const { initialState, defaultStorableSettings } = getInitialState()
  const urlConfig = getUrlConfig()
  const getCurrentActiveProfileNameOrUrlProfile = () =>
    urlConfig.profile ?? getCurrentActiveProfileName()
  const { overRideSettings, stateRefs } = saveAndLoadState(
    initialState,
    getCurrentActiveProfileNameOrUrlProfile,
  )

  // this file could potentially be replaced in kubernetes or docker using a configmap!
  // that way we can configure our webapp even if its already compiled...
  // this is done asynchrounously, because we want to be able to dynamically
  // change our config without having to recompile taskyon.
  loadConfigurationFile(initialState, stateRefs)

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

  // these are refs that we don't save:
  const sessionId = ref<string | null>(null)
  const { bindingKey, setBindingKey } = useSessionKey()
  watch(
    bindingKey,
    () => {
      stateRefs.initWBindingKey = bindingKey.value !== null
    },
    { immediate: true },
  )

  // our sessions only get saved once we have a legitimate session key!
  const setSessionId = (newId: string) => {
    if (newId === sessionId.value) return
    sessionId.value = newId
    console.log('switch Profile to new sessionId:', newId)
    if (newId) {
      // we don't need to save our old state, as it should have been persisted automatically
      switchCurrentActiveProfilePointer(newId)
    }
    // re-load state with new profile!
    Object.assign(stateRefs, getTaskyonUiProfile(getCurrentActiveProfileNameOrUrlProfile()))
  }

  // we do this funny next line, because our store is currently "reactive" which means
  // all scalars like strings, numbers etc..  ar actually non-reactive (vue reactive only converts
  // nested objects into reactive as well). So by doing "toRefs" we ensure that all values are reactive
  // even after destructuring, which we do when returning values from this store.
  // The next issue is that typescript isn't able to recognize the type anymore when
  // we do the toRefs operation, so we simply reassign the same type "stateRefs" to it again which seems to work...
  const allRefs = toRefs(stateRefs) as unknown as typeof stateRefs

  const authToken = ref<KeyString>()
  const iframeApiKey = ref<KeyString>() // used to pass api keys if we are running this as  an iframe

  // We are using a setter function here, because we want to make sure, we can trace changes
  // to the llmSettings explicitly.  This makes sure that any change to llmSettings
  // explicitly!

  const patchLLMSettings = (newSettings: PartialDeep<typeof stateRefs.llmSettings>) => {
    deepMergeReactive(stateRefs.llmSettings, newSettings)
  }

  const setReadOnlySettings =
    (obj: Thunk<Record<string, unknown>>) => (path: string | string[], value: unknown) => {
      const keys = Array.isArray(path) ? path : path.split('.')
      let target = obj()
      for (const key of keys.slice(0, -1)) {
        if (!(key in target)) {
          throw new Error(`Invalid llmSettings path: ${JSON.stringify(path)}`)
        }
        target = target[key] as Record<string, unknown>
      }
      target[keys[keys.length - 1]!] = value
    }

  // it is *SUPERIMPORTANT*  that we ONLY return computed refs & functions in the store EXCEPT
  // evrything in "stateRefs/allRefs". The reason for this is, that we have a store
  // hydration mechanism to automatically save & load the store from localStorage
  return {
    authToken,
    iframeApiKey,
    sessionId: computed(() => sessionId.value),
    setSessionId,
    bindingKey,
    setBindingKey,
    isInIframe: urlConfig.isInIframe,
    isInVscode: urlConfig.isInVscode,
    setSelectedTask: (taskId: string | null | undefined) => {
      console.log('set selected task:', taskId)
      stateRefs.llmSettings.selectedTaskId = taskId || undefined
    },
    ...allRefs,
    llmSettings: computed(
      () => stateRefs.llmSettings as DeepReadonly<typeof stateRefs.llmSettings>,
    ), // make sure to write protect llmSettings in order to make changes explicit!
    patchLLMSettings,
    setLLMSettings: setReadOnlySettings(() => stateRefs.llmSettings),
    overRideSettings,
    getStateValues: () => unref(allRefs),
    $reset,
    minimalGui,
    taskyonRunmode: ref<'waiting for connection' | 'standalone mode' | 'connected'>(
      'standalone mode',
    ),
  }
})
