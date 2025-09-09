import { LocalStorage } from 'quasar'
import type { TyProfile } from 'src/modules/taskyon/types'
import type { PartialDeep } from 'type-fest'

// load our saved state as fast as possible to avoid "color-glitches" at the beginning.

export const currentTyProfileName = 'currentState'
console.log('load saved app state!')
export const getStoredStateString = (name: string) => LocalStorage.getItem(name) as string

export const getTaskyonUiProfile = (name: string) => {
  const stateString = getStoredStateString(name)
  const stateObj = JSON.parse(stateString) as PartialDeep<TyProfile> | undefined
  return stateObj
}

export const initialStoredStateObj = getTaskyonUiProfile(currentTyProfileName)
