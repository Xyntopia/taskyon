//initialstate.ts
import { LocalStorage } from 'quasar'
import type { TyProfile } from 'src/modules/taskyon/types'
import type { PartialDeep } from 'type-fest'

const profilePointerKey = 'currentProfile'
export const getProfileStorageKey = (name: string) => `session_${name}`

export const getCurrentActiveProfileName = (): string | null =>
  LocalStorage.getItem(profilePointerKey)

export const switchCurrentActiveProfilePointer = (newProfileId: string) =>
  LocalStorage.setItem(profilePointerKey, newProfileId)

export const setTaskyonUiProfile = (name: string, newState: PartialDeep<TyProfile>) =>
  LocalStorage.set(getProfileStorageKey(name), JSON.stringify(newState))

export const getStoredStateString = (name: string) =>
  LocalStorage.getItem(getProfileStorageKey(name)) as string

export const getTaskyonUiProfile = (name: string | null) => {
  if (!name) return
  const stateString = getStoredStateString(name)
  if (typeof stateString !== 'string' || !stateString.trim()) return undefined
  try {
    const stateObj = JSON.parse(stateString) as PartialDeep<TyProfile> | undefined
    return stateObj
  } catch (err) {
    console.warn(`[PERSIST] failed to parse stored profile "${name}"`, err)
    return undefined
  }
}

export const initialStoredStateObj = getTaskyonUiProfile(getCurrentActiveProfileName())
