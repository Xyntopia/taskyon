//initialstate.ts
import { LocalStorage } from 'quasar'
import type { TyProfile } from 'src/modules/taskyon/types'
import type { PartialDeep } from 'type-fest'

const profilePointerKey = 'currentProfile'
const profileName = (name: string) => `session_${name}`

export const getCurrentActiveProfileName = (): string | null =>
  LocalStorage.getItem(profilePointerKey)

export const switchCurrentActiveProfilePointer = (newProfileId: string) =>
  LocalStorage.setItem(profilePointerKey, newProfileId)

export const setTaskyonUiProfile = (name: string, newState: PartialDeep<TyProfile>) =>
  LocalStorage.set(profileName(name), JSON.stringify(newState))

export const getStoredStateString = (name: string) =>
  LocalStorage.getItem(profileName(name)) as string

export const getTaskyonUiProfile = (name: string | null) => {
  if (!name) return
  const stateString = getStoredStateString(name)
  const stateObj = JSON.parse(stateString) as PartialDeep<TyProfile> | undefined
  return stateObj
}

export const initialStoredStateObj = getTaskyonUiProfile(getCurrentActiveProfileName())
