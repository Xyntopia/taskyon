import { createInterface } from 'node:readline/promises'
import process from 'node:process'
import type { Taskyon } from '../../taskyon/src/core/init'
import type { ProviderEndpointConfig } from '../../taskyon/src/types/chatCompletion'
import {
  CODEX_PROVIDER_NAME,
  getCodexAccountIdFromCredentials,
  getCodexAuthClaims,
  resolveCodexOauthSession,
  type CodexOauthSession,
} from '../../taskyon/src/utils/codexAuth'
import { getProviderOauthConfig } from '../../taskyon/src/utils/providerAuth'
import {
  loginWithProviderOauthCli,
  readPersistedAuthState,
  resolveCachedProviderOauthCredentials,
  type CliOauthStorage,
  writePersistedAuthState,
} from './oauthLogin'

const CODEX_DEFAULT_ORIGINATOR = 'codex_cli'
const workspacePreferenceSecretName = `oauth:workspace:preference:${CODEX_PROVIDER_NAME}`
const accountIdSecretName = `oauth:account-id:${CODEX_PROVIDER_NAME}`

type WorkspaceCandidate = {
  id: string
  label: string
  metadata: string[]
}

const readStoredValue = async (
  taskyon: Taskyon,
  storage: CliOauthStorage,
  secretName: string,
  stateKey: string,
): Promise<string | undefined> => {
  const raw = await taskyon.getSecret(storage.secretId, secretName, false, false)
  const secretValue = raw?.trim()
  if (secretValue) return secretValue

  const state = await readPersistedAuthState(storage, CODEX_PROVIDER_NAME)
  const fileValue = state[stateKey]
  return typeof fileValue === 'string' && fileValue.trim() ? fileValue.trim() : undefined
}

const writeStoredValue = async (
  taskyon: Taskyon,
  storage: CliOauthStorage,
  secretName: string,
  stateKey: string,
  value: string,
) => {
  await taskyon.setSecret(storage.secretId, secretName, value)
  await writePersistedAuthState(storage, CODEX_PROVIDER_NAME, { [stateKey]: value })
}

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const getWorkspaceCandidates = (claims: Record<string, unknown>): WorkspaceCandidate[] => {
  const candidates: WorkspaceCandidate[] = []
  const add = (idValue: unknown, record?: Record<string, unknown>) => {
    const id = asNonEmptyString(idValue)
    if (!id) return

    const name =
      asNonEmptyString(record?.name) ??
      asNonEmptyString(record?.display_name) ??
      asNonEmptyString(record?.title)
    const slug = asNonEmptyString(record?.slug)
    const role = asNonEmptyString(record?.role)
    const type =
      asNonEmptyString(record?.type) ??
      (id.startsWith('org-') ? 'organization' : id.includes('-') ? 'workspace' : undefined)
    const metadata = [
      type ? `type:${type}` : '',
      slug ? `slug:${slug}` : '',
      role ? `role:${role}` : '',
      record?.is_org_owner === true ? 'owner' : '',
    ].filter(Boolean)
    const labelBase = name ?? id
    const label = labelBase === id ? id : `${labelBase} (${id})`
    const existing = candidates.find((candidate) => candidate.id === id)
    if (existing) {
      existing.metadata = [...new Set([...existing.metadata, ...metadata])]
      if (existing.label === existing.id && label !== id) existing.label = label
      return
    }
    candidates.push({ id, label, metadata })
  }

  add(claims.organization_id, claims)
  if (Array.isArray(claims.organizations)) {
    for (const entry of claims.organizations) {
      if (typeof entry === 'string') add(entry, { type: 'organization' })
      else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        add(
          record.organization_id ?? record.id ?? record.workspace_id ?? record.chatgpt_account_id,
          record,
        )
      }
    }
  }
  add(claims.chatgpt_account_id, {
    name: claims.chatgpt_account_name,
    type: 'workspace',
  })
  const score = (candidate: WorkspaceCandidate) => {
    const type = candidate.metadata.find((item) => item.startsWith('type:'))
    return type === 'type:workspace' ? 0 : type === 'type:organization' ? 1 : 2
  }
  return [...candidates].sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label))
}

const chooseWorkspaceInteractive = async (
  candidates: WorkspaceCandidate[],
): Promise<string | undefined> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]?.id

  process.stdout.write('Select ChatGPT workspace for Codex login:\n')
  candidates.forEach((candidate, index) => {
    const metadata = candidate.metadata.length > 0 ? ` [${candidate.metadata.join(', ')}]` : ''
    process.stdout.write(`  ${index + 1}. ${candidate.label}${metadata}\n`)
  })
  process.stdout.write('  0. cancel\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const workspaceIds = candidates
      .filter((candidate) => candidate.metadata.includes('type:workspace'))
      .map((candidate) => candidate.id)
    while (true) {
      const answer = (await rl.question('Workspace number: ')).trim()
      if (answer === '0') return undefined
      const selected = Number.parseInt(answer, 10)
      if (!Number.isInteger(selected) || selected < 1 || selected > candidates.length) {
        process.stdout.write('Invalid selection. Please enter a listed number.\n')
        continue
      }
      const candidate = candidates[selected - 1]
      if (!candidate) continue
      if (
        candidate.metadata.includes('type:organization') &&
        workspaceIds.length === 1 &&
        workspaceIds[0]
      ) {
        process.stdout.write(
          `Organization selected; using workspace ${workspaceIds[0]} for OAuth.\n`,
        )
        return workspaceIds[0]
      }
      return candidate.id
    }
  } finally {
    rl.close()
  }
}

const hasOrganizationIdClaim = (claims: Record<string, unknown>): boolean =>
  typeof claims.organization_id === 'string' && claims.organization_id.trim().length > 0

const enrichCodexSession = async (
  credentials: Parameters<typeof resolveCodexOauthSession>[0],
  taskyon: Taskyon,
  storage: CliOauthStorage,
): Promise<CodexOauthSession> => {
  const session = resolveCodexOauthSession(credentials)
  const storedAccountId = await readStoredValue(taskyon, storage, accountIdSecretName, 'accountId')
  const accountId = session.accountId ?? storedAccountId
  if (accountId) {
    await writeStoredValue(taskyon, storage, accountIdSecretName, 'accountId', accountId)
  }
  return { accessToken: session.accessToken, ...(accountId ? { accountId } : {}) }
}

export const resolveCachedCodexOauthSession = async ({
  api,
  taskyon,
  storage,
}: {
  api: ProviderEndpointConfig
  taskyon: Taskyon
  storage: CliOauthStorage
}): Promise<CodexOauthSession | null> => {
  const credentials = await resolveCachedProviderOauthCredentials({
    providerName: CODEX_PROVIDER_NAME,
    api,
    taskyon,
    storage,
  })
  if (!credentials) return null
  return await enrichCodexSession(credentials, taskyon, storage)
}

export const loginWithCodexOauthCli = async ({
  api,
  taskyon,
  storage,
  forceReauth = false,
  timeoutMs = 5 * 60 * 1000,
}: {
  api: ProviderEndpointConfig
  taskyon: Taskyon
  storage: CliOauthStorage
  forceReauth?: boolean
  timeoutMs?: number
}): Promise<CodexOauthSession> => {
  const oauth = getProviderOauthConfig(api)
  if (!oauth) throw new Error('OAuth is not configured for the Codex provider.')
  if (!oauth.tokenUrl) throw new Error('The Codex provider is missing auth.oauth.tokenUrl.')

  if (!forceReauth) {
    const cached = await resolveCachedCodexOauthSession({ api, taskyon, storage })
    if (cached) return cached
  }

  const environmentWorkspaceId = process.env.TASKYON_CHATGPT_WORKSPACE_ID
  const preferredWorkspaceId = await readStoredValue(
    taskyon,
    storage,
    workspacePreferenceSecretName,
    'preferredWorkspaceId',
  )
  const workspaceId = environmentWorkspaceId || preferredWorkspaceId
  const credentials = await loginWithProviderOauthCli({
    providerName: CODEX_PROVIDER_NAME,
    api,
    taskyon,
    storage,
    forceReauth: true,
    timeoutMs,
    authorizeQuery: {
      originator: CODEX_DEFAULT_ORIGINATOR,
      ...(workspaceId ? { allowed_workspace_id: workspaceId } : {}),
    },
  })

  const claims = getCodexAuthClaims(credentials.id_token ?? credentials.access_token)
  const accountId = getCodexAccountIdFromCredentials(credentials)
  if (accountId) {
    await writeStoredValue(taskyon, storage, accountIdSecretName, 'accountId', accountId)
  }
  if (typeof claims.chatgpt_account_id === 'string' && claims.chatgpt_account_id.trim()) {
    await writeStoredValue(
      taskyon,
      storage,
      workspacePreferenceSecretName,
      'preferredWorkspaceId',
      claims.chatgpt_account_id.trim(),
    )
  }
  if (!hasOrganizationIdClaim(claims) && !workspaceId) {
    const selectedWorkspace = await chooseWorkspaceInteractive(getWorkspaceCandidates(claims))
    if (selectedWorkspace) {
      await writeStoredValue(
        taskyon,
        storage,
        workspacePreferenceSecretName,
        'preferredWorkspaceId',
        selectedWorkspace,
      )
      process.stdout.write(`Saved workspace preference: ${selectedWorkspace}\n`)
    }
  }
  return await enrichCodexSession(credentials, taskyon, storage)
}
