//initialstate.ts
import { LocalStorage } from 'quasar'
import type { TyProfile } from 'src/modules/taskyon/types'
import type { PartialDeep } from 'type-fest'

// load our saved state as fast as possible to avoid "color-glitches" at the beginning.

export function getUrlConfig() {
  const searchParams = new URLSearchParams(window.location.search)
  const isIframeParam = searchParams.get('iframe') === 'true'
  const profile = searchParams.get('profile')
  console.log('we are in an iframe via param:', isIframeParam)
  const isInIframe = window.self !== window.top || isIframeParam
  console.log('we are in an iframe:', window.self !== window.top, isInIframe)
  return { isInIframe, profile }
}

export const urlConfig = getUrlConfig()

export const defaultProfileName = 'defaultProfile'
const profilePointerKey = 'currentProfile'
export const getCurrentProfileName = () =>
  urlConfig.profile ?? LocalStorage.getItem(profilePointerKey) ?? defaultProfileName

export const switchCurrentProfilePointer = (newProfileName: string) =>
  LocalStorage.setItem(profilePointerKey, newProfileName)

export const getStoredStateString = (name: string) => LocalStorage.getItem(name) as string

export const getTaskyonUiProfile = (name: string) => {
  const stateString = getStoredStateString(name)
  const stateObj = JSON.parse(stateString) as PartialDeep<TyProfile> | undefined
  return stateObj
}

export const initialStoredStateObj = getTaskyonUiProfile(getCurrentProfileName())
