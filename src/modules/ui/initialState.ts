import { LocalStorage } from 'quasar'
import type { TyProfile } from 'src/modules/taskyon/types'
import type { PartialDeep } from 'type-fest'

// load our saved state as fast as possible to avoid "color-glitches" at the beginning.

export const storeName = 'taskyonState'
console.log('load saved app state!')
export const getStoredStateString = () => LocalStorage.getItem(storeName) as string
const initialStoredStateString = getStoredStateString()
export const initialStoredStateObj = JSON.parse(initialStoredStateString) as
  | PartialDeep<TyProfile>
  | undefined
