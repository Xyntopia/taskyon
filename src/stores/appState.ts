// this store simply defines the state of our app witout any logic or background tasks etc,,,
// this makes it easy to integrate it with SSR for example...

import axios from 'axios'
import { defineStore } from 'pinia'
import { LocalStorage, useQuasar } from 'quasar' // TODO: load dynamically! :)
import defaultSettings from 'src/assets/taskyon_settings.json?raw'
import { TyProfile } from 'src/modules/taskyon/types'
import { setPmtilesOpfsCacheGlobalConfig } from '@taskyon/common/modules/pmtilesOpfsCache'
import type { MergeOptions } from '@taskyon/common/modules/utils'
import {
  clearBrowserCaches,
  clearCookies,
  clearServiceWorkers,
  deepMerge,
  deepMergeReactive,
  reconcileWithDefaults,
} from '@taskyon/common/modules/utils'
import type { DeepReadonly } from 'vue'
import { computed, reactive, ref, toRaw, toRefs, unref, watch, type Reactive } from 'vue'
// TODO: remove, to make this file here faster...
import type { KeyString, Thunk, tyPublicKeyDraft } from '@taskyon/taskyon'
import {
  base64ToPublixX25519,
  cryptoKeyToBase64,
  generateAssymetricKeyDeriver,
  resolveToolchainConfig,
  sleep,
  type FunctionCall,
} from '@taskyon/taskyon'
import {
  getCurrentActiveProfileName,
  getMappedProfileForSessionId,
  getProfileStorageKey,
  getTaskyonUiProfile,
  mapSessionToProfile,
  setTaskyonUiProfile,
  switchCurrentActiveProfilePointer,
} from 'src/modules/ui/initialState'
import { buildTaskSelectionRoute } from 'src/modules/taskSelectionUrl'
import type { PartialDeep } from 'type-fest'
import { useRoute, useRouter } from 'vue-router'
import type { ZodError } from 'zod'

interface TaskWidgetStateType {
  markdownEnabled: boolean
}

export type TaskyonSessionStatus = 'checking-auth' | 'switching-session' | 'ready'

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
    const noBindingKeyParam =
      searchParams.get('nobindingkey') === '1' || searchParams.get('nobindingkey') === 'true'
    if (isVscodeParam) installVscodeConsoleBridge()
    console.log('we are in an iframe via param:', isIframeParam)
    const isInIframe = window.self !== window.top || isIframeParam
    console.log('we are in an iframe:', window.self !== window.top, isInIframe)
    return { isInIframe, isInVscode: isVscodeParam, profile, noBindingKeyParam }
  } else
    return {
      isInIframe: false,
      isInVscode: false,
      profile: null,
      noBindingKeyParam: false,
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
    selectedToolchainProfile: defaultStorableSettings.selectedToolchainProfile,
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
    initWSession: undefined as string | undefined,

    messageDebug: {} as Record<string, boolean | undefined>, // whether message with ID should be open or not...

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

const reconcileStoredTaskyonState = (
  stored: Partial<initialState>,
  defaults: initialState,
): initialState => {
  const reconciled = reconcileWithDefaults(stored, defaults)
  const toolchainProfiles = TyProfile.shape.toolchainProfiles.safeParse(stored.toolchainProfiles)
  if (toolchainProfiles.success) {
    reconciled.toolchainProfiles = toolchainProfiles.data
  }
  if (typeof stored.selectedToolchainProfile === 'string') {
    resolveToolchainConfig(reconciled.toolchainProfiles, stored.selectedToolchainProfile)
    reconciled.selectedToolchainProfile = stored.selectedToolchainProfile
  }
  return reconciled
}

export const taskyonProfileSections = [
  'appConfiguration',
  'llmSettings',
  'toolchainProfiles',
  'selectedToolchainProfile',
] as const
export type TaskyonProfileSection = (typeof taskyonProfileSections)[number]
export type TaskyonProfileSettings = Pick<TyProfile, TaskyonProfileSection>
export type TaskyonProfileSettingsInput = {
  appConfiguration?: Record<string, unknown>
  llmSettings?: Record<string, unknown>
  toolchainProfiles?: Record<string, unknown>
  selectedToolchainProfile?: string | null
}
export type TaskyonProfileSettingsPatch = Partial<TaskyonProfileSettings>

const cloneProfileValue = <T>(value: T): T => structuredClone(toRaw(value))

export function normalizeTaskyonProfileSections(
  sections: readonly TaskyonProfileSection[] = taskyonProfileSections,
): TaskyonProfileSection[] {
  return taskyonProfileSections.filter((section) => sections.includes(section))
}

export function createTaskyonProfileSettingsSnapshot(
  profile: TaskyonProfileSettings,
  sections: readonly TaskyonProfileSection[] = taskyonProfileSections,
): TaskyonProfileSettingsPatch {
  const snapshot: TaskyonProfileSettingsPatch = {}
  for (const section of normalizeTaskyonProfileSections(sections)) {
    if (section === 'appConfiguration') {
      snapshot.appConfiguration = cloneProfileValue(profile.appConfiguration)
    } else if (section === 'llmSettings') {
      snapshot.llmSettings = cloneProfileValue(profile.llmSettings)
    } else if (section === 'toolchainProfiles') {
      snapshot.toolchainProfiles = cloneProfileValue(profile.toolchainProfiles)
    } else {
      snapshot.selectedToolchainProfile = profile.selectedToolchainProfile
    }
  }
  return snapshot
}

const formatProfileValidationError = (section: TaskyonProfileSection, error: ZodError): string => {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length ? `.${issue.path.join('.')}` : ''
      return `${section}${path}: ${issue.message}`
    })
    .join('; ')
  return `Invalid ${section} profile settings: ${details}`
}

export function validateTaskyonProfileSettingsPatch(
  current: TaskyonProfileSettings,
  patch: TaskyonProfileSettingsInput,
): TaskyonProfileSettingsPatch {
  const next: TaskyonProfileSettingsPatch = {}

  if (patch.appConfiguration) {
    const merged = deepMerge(cloneProfileValue(current.appConfiguration), patch.appConfiguration)
    const parsed = TyProfile.shape.appConfiguration.safeParse(merged)
    if (!parsed.success) {
      throw new Error(formatProfileValidationError('appConfiguration', parsed.error))
    }
    next.appConfiguration = parsed.data
  }

  if (patch.llmSettings) {
    const merged = deepMerge(cloneProfileValue(current.llmSettings), patch.llmSettings)
    const parsed = TyProfile.shape.llmSettings.safeParse(merged)
    if (!parsed.success) {
      throw new Error(formatProfileValidationError('llmSettings', parsed.error))
    }
    next.llmSettings = parsed.data
  }

  if (patch.toolchainProfiles) {
    const merged = deepMerge(cloneProfileValue(current.toolchainProfiles), patch.toolchainProfiles)
    const parsed = TyProfile.shape.toolchainProfiles.safeParse(merged)
    if (!parsed.success) {
      throw new Error(formatProfileValidationError('toolchainProfiles', parsed.error))
    }
    next.toolchainProfiles = parsed.data
  }

  if ('selectedToolchainProfile' in patch) {
    const parsed = TyProfile.shape.selectedToolchainProfile.safeParse(
      patch.selectedToolchainProfile ?? undefined,
    )
    if (!parsed.success) {
      throw new Error(formatProfileValidationError('selectedToolchainProfile', parsed.error))
    }
    next.selectedToolchainProfile = parsed.data
  }

  resolveToolchainConfig(
    next.toolchainProfiles ?? current.toolchainProfiles,
    'selectedToolchainProfile' in next
      ? next.selectedToolchainProfile
      : current.selectedToolchainProfile,
  )

  return next
}

export function buildTaskyonProfileSectionResetPatch(
  defaults: TaskyonProfileSettings,
  sections: readonly TaskyonProfileSection[],
): TaskyonProfileSettingsPatch {
  return createTaskyonProfileSettingsSnapshot(defaults, sections)
}

function loadConfigurationFile(initialState: initialState, stateRefs: Reactive<initialState>) {
  void axios
    .get<
      | {
          version?: number
          llmSettings: typeof initialState.llmSettings
          appConfiguration: typeof initialState.appConfiguration
          toolchainProfiles: typeof initialState.toolchainProfiles
          selectedToolchainProfile?: string
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
          deepMergeReactive(stateRefs.toolchainProfiles, config.toolchainProfiles, mergeStrategy)
          if ('selectedToolchainProfile' in config) {
            resolveToolchainConfig(stateRefs.toolchainProfiles, config.selectedToolchainProfile)
            stateRefs.selectedToolchainProfile = config.selectedToolchainProfile
          }
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
  const bindingKeySource = ref<
    'none' | 'derived' | 'host' | 'unknown' | 'host-none' | 'unknown-none'
  >('none')

  return {
    bindingKey: computed(() => bindingKey.value),
    bindingKeySource: computed(() => bindingKeySource.value),
    setBindingKey: (k: CryptoKey | null, source: 'derived' | 'host' | 'unknown' = 'unknown') => {
      const explicitSources: Array<typeof bindingKeySource.value> = [
        'host',
        'unknown',
        'host-none',
        'unknown-none',
      ]
      if (source === 'derived' && explicitSources.includes(bindingKeySource.value)) {
        console.log(
          'ignore derived bindingKey because an explicit bindingKey source is already active',
        )
        return
      }
      console.log('set new session bindingKey!', k ? 'add new key...' : 'delete key...')
      bindingKey.value = k
      if (k) {
        bindingKeySource.value = source === 'unknown' ? 'unknown' : source
      } else if (source === 'host') {
        bindingKeySource.value = 'host-none'
      } else if (source === 'unknown') {
        bindingKeySource.value = 'unknown-none'
      } else {
        bindingKeySource.value = 'none'
      }
    },
  }
}

const getIframeProfileBindingKeyStorageKey = (profileName: string) =>
  `iframe_profile_binding_key:${profileName}`

async function getOrCreateIframeProfileBindingKey(profileName: string): Promise<CryptoKey> {
  const keyStorage = getIframeProfileBindingKeyStorageKey(profileName)
  const existingB64 = LocalStorage.getItem(keyStorage)
  if (typeof existingB64 === 'string' && existingB64.trim()) {
    return await base64ToPublixX25519(existingB64, false)
  }
  const kp = await generateAssymetricKeyDeriver()
  const pb64 = await cryptoKeyToBase64(kp.publicKey)
  LocalStorage.setItem(keyStorage, pb64)
  return kp.publicKey
}

const saveAndLoadState = (initialState: initialState, pname: Thunk<string | null>) => {
  const initialProfileName = pname()
  const initialStoredStateObjTyped = getTaskyonUiProfile(initialProfileName) as
    | Partial<initialState>
    | undefined
  console.log('[PERSIST] boot profile resolution', {
    initialProfileName,
    currentProfilePointer: getCurrentActiveProfileName(),
    hasStoredState: !!initialStoredStateObjTyped,
    version: initialStoredStateObjTyped?.version,
  })

  let stateRefs: Reactive<initialState>
  if (
    initialStoredStateObjTyped &&
    initialStoredStateObjTyped.version &&
    initialStoredStateObjTyped.version === initialState.version
  ) {
    console.log(`[PERSIST] load saved ui state from profile "${initialProfileName}"`)
    const storedInitialState = reconcileStoredTaskyonState(initialStoredStateObjTyped, initialState)
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
    if (pn) clearBrowserStorage([getProfileStorageKey(pn)])
    stateRefs = reactive(initialState)
  }

  // Flag that tells the persister to skip the next change
  let saveToLocalStorage = true

  // store the state on every change!! :)
  watch(stateRefs, (newState) => {
    const pn = pname()
    if (saveToLocalStorage && pn) {
      setTaskyonUiProfile(pn, {
        ...newState,
      })
      console.log('[PERSIST] saved ui profile', {
        profile: pn,
        selectedApi: newState.llmSettings.selectedApi,
        selectedModel:
          newState.llmSettings.selectedApi &&
          newState.llmSettings.llmApis[newState.llmSettings.selectedApi]?.selectedModel,
        chatHistoryLen: newState.chatHistory.length,
        modelHistoryLen: newState.modelHistory.length,
      })
    } else {
      console.log('[PERSIST] skipped ui profile save', {
        profile: pn,
        saveToLocalStorage,
      })
    }
  })

  if (stateRefs.initialLoad) {
    stateRefs.llmSettings.userId = 'unknown'
  }

  const beginSettingsChange = (persist: boolean) => {
    saveToLocalStorage = persist
  }

  const finishSettingsChange = (persist: boolean) => {
    if (!persist) {
      queueMicrotask(() => {
        saveToLocalStorage = true
        console.log('[PERSIST] re-enabled local persistence after transient override')
      })
    }
  }

  function overRideSettings(newConfig: PartialDeep<TyProfile>, persist: boolean = false) {
    // For non-persistent config overrides (common for embedded clients),
    // skip only the immediate merge write, then resume normal persistence.
    console.log('[PERSIST] overRideSettings', {
      persist,
      hasLlmSettings: !!newConfig.llmSettings,
      hasAppConfiguration: !!newConfig.appConfiguration,
      hasToolchainProfiles: !!newConfig.toolchainProfiles,
      incomingPrimaryColor: newConfig.appConfiguration?.primaryColor,
      incomingSecondaryColor: newConfig.appConfiguration?.secondaryColor,
    })
    beginSettingsChange(persist)
    const previousColors = {
      primaryColor: stateRefs.appConfiguration.primaryColor,
      secondaryColor: stateRefs.appConfiguration.secondaryColor,
    }
    if (newConfig.llmSettings) {
      // TODO: make sure, this function is only temporary and doesn't overwrite our actual llmSettings...
      deepMergeReactive(stateRefs.llmSettings, newConfig.llmSettings)
    }
    if (newConfig.appConfiguration) {
      deepMergeReactive(stateRefs.appConfiguration, newConfig.appConfiguration)
    }
    if (newConfig.toolchainProfiles) {
      deepMergeReactive(stateRefs.toolchainProfiles, newConfig.toolchainProfiles)
    }
    if ('selectedToolchainProfile' in newConfig) {
      resolveToolchainConfig(stateRefs.toolchainProfiles, newConfig.selectedToolchainProfile)
      stateRefs.selectedToolchainProfile = newConfig.selectedToolchainProfile
    }
    finishSettingsChange(persist)
    console.log('[PERSIST] overRideSettings colors merged', {
      before: previousColors,
      after: {
        primaryColor: stateRefs.appConfiguration.primaryColor,
        secondaryColor: stateRefs.appConfiguration.secondaryColor,
      },
    })
  }

  function replaceProfileSettings(
    newConfig: TaskyonProfileSettingsPatch,
    persist: boolean = false,
  ) {
    beginSettingsChange(persist)
    if (newConfig.appConfiguration) {
      stateRefs.appConfiguration = cloneProfileValue(newConfig.appConfiguration)
    }
    if (newConfig.llmSettings) {
      stateRefs.llmSettings = cloneProfileValue(newConfig.llmSettings)
    }
    if (newConfig.toolchainProfiles) {
      stateRefs.toolchainProfiles = cloneProfileValue(newConfig.toolchainProfiles)
    }
    if ('selectedToolchainProfile' in newConfig) {
      stateRefs.selectedToolchainProfile = newConfig.selectedToolchainProfile
    }
    finishSettingsChange(persist)
  }

  return { overRideSettings, replaceProfileSettings, stateRefs }
}

// this is where we save all of our app settings.
// its important to keep this simple and don't incude 3rd party libraries and other things
// because we want to this to also work on tyServer and in a "minimal gui" setting.
// So we only want data to be loaded & saved here, and not any taskyon logic or other fancy things...
export const useAppStateStore = defineStore('ui-state', () => {
  const defaultProfileName = 'defaultProfile'
  // configuration from the URL!
  const { initialState, defaultStorableSettings } = getInitialState()
  const urlConfig = getUrlConfig()
  const { bindingKey, bindingKeySource, setBindingKey } = useSessionKey()
  const iframeProfileName =
    urlConfig.isInIframe && typeof urlConfig.profile === 'string' && urlConfig.profile.length > 0
      ? urlConfig.profile
      : null
  if (iframeProfileName && !urlConfig.noBindingKeyParam) {
    // Set this immediately so taskyon startup can wait for the derived iframe binding key.
    initialState.initWBindingKey = true
    void getOrCreateIframeProfileBindingKey(iframeProfileName)
      .then((iframeBindingKey) => {
        if (bindingKey.value === null) {
          setBindingKey(iframeBindingKey, 'derived')
          console.log('[IFRAME] derived binding key from profile', {
            profile: iframeProfileName,
          })
        } else {
          console.log(
            '[IFRAME] skipped profile-derived binding key because host key is already set',
            {
              profile: iframeProfileName,
            },
          )
        }
      })
      .catch((error) => {
        console.error('[IFRAME] failed to derive binding key from profile', {
          profile: iframeProfileName,
          error,
        })
      })
  }
  if (iframeProfileName && urlConfig.noBindingKeyParam) {
    console.log('[IFRAME] noBindingKey URL flag detected; skip profile-derived binding key')
    setBindingKey(null, 'host')
    initialState.initWBindingKey = false
  }
  const hasExplicitUrlProfile =
    typeof urlConfig.profile === 'string' && urlConfig.profile.length > 0
  const profileMode = hasExplicitUrlProfile ? 'explicit' : 'session-driven'
  const activeProfileNameRef = ref<string>(
    hasExplicitUrlProfile
      ? (urlConfig.profile as string)
      : (getCurrentActiveProfileName() ?? defaultProfileName),
  )
  if (!hasExplicitUrlProfile && !getCurrentActiveProfileName()) {
    switchCurrentActiveProfilePointer(activeProfileNameRef.value)
  }
  const { overRideSettings, replaceProfileSettings, stateRefs } = saveAndLoadState(
    initialState,
    () => activeProfileNameRef.value,
  )
  const applyStoredProfile = (profileName: string) => {
    const storedProfile = getTaskyonUiProfile(profileName) as Partial<initialState> | undefined
    if (!storedProfile) return
    if (storedProfile.version !== initialState.version) {
      console.warn(
        `Stored settings version (${storedProfile.version || 'undefined'}) is not compatible with current version (${initialState.version}). Using default settings.`,
      )
      LocalStorage.removeItem(getProfileStorageKey(profileName))
      Object.assign(stateRefs, initialState)
      return
    }
    Object.assign(stateRefs, reconcileStoredTaskyonState(storedProfile, initialState))
  }
  const route = useRoute()
  const router = useRouter()
  const selectedTaskId = computed(() =>
    typeof route.query.t === 'string' && route.query.t.trim() ? route.query.t.trim() : undefined,
  )
  if (iframeProfileName && !urlConfig.noBindingKeyParam) {
    // Keep waiting behavior stable even if persisted state had `initWBindingKey: false`.
    stateRefs.initWBindingKey = true
  }

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
    stateRefs.toolchainProfiles = defaultStorableSettings.toolchainProfiles
    stateRefs.selectedToolchainProfile = defaultStorableSettings.selectedToolchainProfile
    stateRefs.version = 0 as typeof stateRefs.version // set the version to 0, hoping, that this will trigger a reset on page reload..
    clearBrowserStorage()
    console.log('done, resetting! reloading page now...')
    void sleep(1000).then(() => (window.location.href = '/'))
  }

  const $q = useQuasar()

  watch(() => stateRefs.appConfiguration.darkTheme, $q.dark.set, {
    immediate: true,
  })

  watch(
    () => stateRefs.appConfiguration.pmtilesCacheMaxSizeMb,
    (value) => {
      const maxMb = Number.isFinite(value) ? value : 1024
      setPmtilesOpfsCacheGlobalConfig({
        maxBytesPerArchive: Math.max(64, Math.floor(maxMb)) * 1024 * 1024,
      })
    },
    { immediate: true },
  )

  const minimalGui = computed<Exclude<typeof stateRefs.appConfiguration.guiMode, 'auto'>>(() => {
    if (stateRefs.appConfiguration.guiMode === 'auto') {
      return $q.platform.within.iframe ? 'iframe' : 'default'
    }
    return stateRefs.appConfiguration.guiMode
  })

  // these are refs that we don't save:
  const sessionId = ref<string | null>(null)
  const taskyonAuthLoading = ref(false)
  const taskyonSessionSwitching = ref(false)
  const taskyonSessionStatus = computed<TaskyonSessionStatus>(() => {
    if (taskyonAuthLoading.value) return 'checking-auth'
    if (taskyonSessionSwitching.value) return 'switching-session'
    return 'ready'
  })
  const draftPasteFiles = ref<File[]>([])
  let draftPasteHandler: ((files: File[]) => void) | null = null
  watch(
    bindingKey,
    () => {
      stateRefs.initWBindingKey = bindingKey.value !== null
    },
    { immediate: true },
  )

  const setActiveProfile = (profileName: string) => {
    if (!profileName || profileName === activeProfileNameRef.value) return
    activeProfileNameRef.value = profileName
    if (profileMode === 'session-driven') {
      switchCurrentActiveProfilePointer(profileName)
    }
    applyStoredProfile(profileName)
  }

  // our sessions only get saved once we have a legitimate session key!
  const setSessionId = (newId: string) => {
    if (newId === sessionId.value) return
    sessionId.value = newId
    const profileToLoad =
      profileMode === 'explicit'
        ? (urlConfig.profile as string)
        : newId
          ? getMappedProfileForSessionId(newId)
          : (getCurrentActiveProfileName() ?? defaultProfileName)
    if (profileMode === 'session-driven' && newId) {
      mapSessionToProfile(newId, profileToLoad)
      switchCurrentActiveProfilePointer(profileToLoad)
    }
    activeProfileNameRef.value = profileToLoad
    console.log('[PERSIST] resolve profile after session update', {
      sessionId: newId,
      profileMode,
      profileToLoad,
      currentProfilePointer: getCurrentActiveProfileName(),
      urlProfile: urlConfig.profile,
    })
    console.log('switch Profile to new sessionId:', newId)
    console.log('[PERSIST] setSessionId reloading profile', {
      sessionId: newId,
      profileToLoad,
      currentProfilePointer: getCurrentActiveProfileName(),
      urlProfile: urlConfig.profile,
    })
    // re-load state with new profile!
    applyStoredProfile(profileToLoad)
  }

  const setTaskyonAuthLoading = (loading: boolean) => {
    taskyonAuthLoading.value = loading
  }

  const setTaskyonSessionSwitching = (switching: boolean) => {
    taskyonSessionSwitching.value = switching
  }

  // we do this funny next line, because our store is currently "reactive" which means
  // all scalars like strings, numbers etc..  ar actually non-reactive (vue reactive only converts
  // nested objects into reactive as well). So by doing "toRefs" we ensure that all values are reactive
  // even after destructuring, which we do when returning values from this store.
  // The next issue is that typescript isn't able to recognize the type anymore when
  // we do the toRefs operation, so we simply reassign the same type "stateRefs" to it again which seems to work...
  const allRefs = toRefs(stateRefs) as unknown as typeof stateRefs
  const effectiveToolchainConfig = computed(() =>
    resolveToolchainConfig(stateRefs.toolchainProfiles, stateRefs.selectedToolchainProfile),
  )

  const authToken = ref<KeyString>()
  const iframeApiKey = ref<KeyString>() // used to pass api keys if we are running this as  an iframe

  // We are using a setter function here, because we want to make sure, we can trace changes
  // to the llmSettings explicitly.  This makes sure that any change to llmSettings
  // explicitly!

  const patchLLMSettings = (newSettings: PartialDeep<typeof stateRefs.llmSettings>) => {
    deepMergeReactive(stateRefs.llmSettings, newSettings)
  }

  const getProfileSettings = (): TaskyonProfileSettings => ({
    appConfiguration: cloneProfileValue(stateRefs.appConfiguration),
    llmSettings: cloneProfileValue(stateRefs.llmSettings),
    toolchainProfiles: cloneProfileValue(stateRefs.toolchainProfiles),
    selectedToolchainProfile: stateRefs.selectedToolchainProfile,
  })

  const getProfileSnapshot = (
    sections: readonly TaskyonProfileSection[] = taskyonProfileSections,
  ) => ({
    activeProfileName: activeProfileNameRef.value,
    profileMode,
    sections: createTaskyonProfileSettingsSnapshot(stateRefs, sections),
  })

  const patchProfileSettings = (
    patch: TaskyonProfileSettingsInput,
    options: { persist?: boolean } = {},
  ) => {
    const validatedPatch = validateTaskyonProfileSettingsPatch(getProfileSettings(), patch)
    const changedSections = taskyonProfileSections.filter((section) => !!validatedPatch[section])
    replaceProfileSettings(validatedPatch, options.persist ?? false)
    return getProfileSnapshot(changedSections)
  }

  const resetProfileSections = (
    sections: readonly TaskyonProfileSection[] = taskyonProfileSections,
    options: { persist?: boolean } = {},
  ) => {
    const normalizedSections = normalizeTaskyonProfileSections(sections)
    const resetPatch = buildTaskyonProfileSectionResetPatch(
      defaultStorableSettings,
      normalizedSections,
    )
    replaceProfileSettings(resetPatch, options.persist ?? false)
    return getProfileSnapshot(normalizedSections)
  }

  const navigateToTask = (
    taskId: string | null | undefined,
    options: {
      path?: string
      replace?: boolean
    } = {},
  ) => {
    if (!process.env.CLIENT) return
    const routeTarget = buildTaskSelectionRoute(window.location.href, taskId, options.path)
    if (routeTarget === route.fullPath) return
    if (options.replace) {
      void router.replace(routeTarget)
      return
    }
    void router.push(routeTarget)
  }

  const setReadOnlySettings =
    (obj: Thunk<Record<string, unknown>>) => (path: string | string[], value: unknown) => {
      const keys = Array.isArray(path) ? path : path.split('.')
      if (keys.join('.') === 'selectedTaskId') {
        throw new Error('selectedTaskId is URL-controlled. Use navigateToTask instead.')
      }
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
    taskyonSessionStatus,
    setTaskyonAuthLoading,
    setTaskyonSessionSwitching,
    activeProfileName: computed(() => activeProfileNameRef.value),
    profileMode: computed(() => profileMode),
    setActiveProfile,
    setSessionId,
    bindingKey,
    bindingKeySource,
    setBindingKey,
    queueDraftPasteFiles: (files: File[]) => {
      if (!files.length) return
      if (draftPasteHandler) {
        draftPasteHandler([...files])
        return
      }
      draftPasteFiles.value = [...draftPasteFiles.value, ...files]
    },
    takeQueuedDraftPasteFiles: () => {
      const files = [...draftPasteFiles.value]
      draftPasteFiles.value = []
      return files
    },
    setDraftPasteHandler: (handler: ((files: File[]) => void) | null) => {
      draftPasteHandler = handler
      if (draftPasteHandler && draftPasteFiles.value.length) {
        const files = [...draftPasteFiles.value]
        draftPasteFiles.value = []
        draftPasteHandler(files)
      }
    },
    isInIframe: urlConfig.isInIframe,
    isInVscode: urlConfig.isInVscode,
    ...allRefs,
    effectiveToolchainConfig,
    selectedTaskId,
    navigateToTask,
    llmSettings: computed(
      () => stateRefs.llmSettings as DeepReadonly<typeof stateRefs.llmSettings>,
    ), // make sure to write protect llmSettings in order to make changes explicit!
    patchLLMSettings,
    setLLMSettings: setReadOnlySettings(() => stateRefs.llmSettings),
    overRideSettings,
    getProfileSnapshot,
    patchProfileSettings,
    resetProfileSections,
    getStateValues: () => unref(allRefs),
    $reset,
    minimalGui,
    taskyonRunmode: ref<'waiting for connection' | 'standalone mode' | 'connected'>(
      'standalone mode',
    ),
  }
})
