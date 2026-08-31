import z from 'zod'
import type { OAuthCredentials } from './oauth'

export const CODEX_PROVIDER_NAME = 'chatgpt-codex'

const jwtPayloadSchema = z.record(z.string(), z.unknown())

const parseJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
    const decoded = globalThis.atob(padded)
    const parsed = jwtPayloadSchema.safeParse(JSON.parse(decoded))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const getCodexAuthClaims = (token: string): Record<string, unknown> => {
  const payload = parseJwtPayload(token)
  if (!payload) return {}
  const nestedClaims = jwtPayloadSchema.safeParse(payload['https://api.openai.com/auth'])
  return nestedClaims.success ? nestedClaims.data : payload
}

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const getCodexAccountIdFromClaims = (claims: Record<string, unknown>): string | undefined => {
  const nestedClaims = jwtPayloadSchema.safeParse(claims['https://api.openai.com/auth'])
  const directAccountId = asNonEmptyString(claims.chatgpt_account_id)
  if (directAccountId) return directAccountId
  if (nestedClaims.success) {
    const nestedAccountId = asNonEmptyString(nestedClaims.data.chatgpt_account_id)
    if (nestedAccountId) return nestedAccountId
  }

  if (!Array.isArray(claims.organizations)) return undefined
  for (const organization of claims.organizations) {
    if (typeof organization === 'string' && organization.trim()) return organization.trim()
    const record = jwtPayloadSchema.safeParse(organization)
    if (!record.success) continue
    const organizationId =
      asNonEmptyString(record.data.id) ??
      asNonEmptyString(record.data.organization_id) ??
      asNonEmptyString(record.data.workspace_id) ??
      asNonEmptyString(record.data.chatgpt_account_id)
    if (organizationId) return organizationId
  }
  return undefined
}

export const getCodexAccountIdFromCredentials = (
  credentials: OAuthCredentials,
): string | undefined => {
  for (const token of [credentials.id_token, credentials.access_token]) {
    if (!token) continue
    const payload = parseJwtPayload(token)
    if (!payload) continue
    const accountId = getCodexAccountIdFromClaims(payload)
    if (accountId) return accountId
  }
  return undefined
}

export type CodexOauthSession = {
  accessToken: string
  accountId?: string
}

export const resolveCodexOauthSession = (credentials: OAuthCredentials): CodexOauthSession => {
  const accountId = getCodexAccountIdFromCredentials(credentials)
  return {
    accessToken: credentials.access_token,
    ...(accountId ? { accountId } : {}),
  }
}
