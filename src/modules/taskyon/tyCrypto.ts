import type { z } from 'zod'
import { tyPublicApiKeyObject } from './types'
import { parseJwt } from '../crypto'

// This doesn't verify the key, only looks if its contents are valid!
type tyPublicApiKeyObject = z.infer<typeof tyPublicApiKeyObject>
export function isTaskyonKey(key: string | undefined, boolean: true): boolean
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
