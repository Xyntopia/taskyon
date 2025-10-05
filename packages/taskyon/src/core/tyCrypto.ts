import { z } from 'zod'
import { parseJwt } from '../utils/crypto'

export const tyPublicKeyDraft = z.object({
  name: z
    .string()
    .meta({
      description: 'Name of the key.',
    })
    .optional(),
  maxc: z
    .number()
    .meta({
      description: 'Maximum allowed credits in this key',
    })
    .optional(),
  cpi: z.number().meta({
    description: 'Credit refill per inteval',
  }),
  rti: z.number().meta({
    description: 'Refill time interval in minutes',
  }),
  model: z
    .string()
    .array()
    .meta({
      description: 'List of models which are allowed with this key.',
    })
    .optional(),
})

export type tyPublicKeyDraft = z.infer<typeof tyPublicKeyDraft>

export const tyPublicApiKeyObject = tyPublicKeyDraft.extend({
  iat: z.number().meta({
    description: 'Time at which the key was issued.',
    format: 'timestamp',
  }),
  auid: z.string().meta({
    description: 'anonymous User ID for billing purposes.',
  }),
  v: z.number().meta({
    description: 'Key version',
  }),
  iss: z.string().meta({
    description: 'The Issuer of the API key.',
  }),
})

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
