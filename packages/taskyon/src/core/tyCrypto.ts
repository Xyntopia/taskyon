import { parseJwt } from '../utils/crypto'
import { tyPublicApiKeyObject } from '../types/tyKey'

export type KeyString = string & { __brand: 'KeyString' }

export function isTaskyonKey(key: string | undefined, boolean?: true): boolean
export function isTaskyonKey(
  key: string | undefined,
  boolean: false,
): tyPublicApiKeyObject | undefined

export function isTaskyonKey(
  key: string | undefined,
  boolean = true,
): boolean | tyPublicApiKeyObject | undefined {
  if (key) {
    let keyObj
    try {
      keyObj = parseJwt(key)
    } catch {
      console.log('could not parse key', key)
      return boolean ? false : undefined
    }
    const result = tyPublicApiKeyObject.safeParse(keyObj)
    if (result.success) {
      return boolean ? true : result.data
    }
  }
  return boolean ? false : undefined
}
