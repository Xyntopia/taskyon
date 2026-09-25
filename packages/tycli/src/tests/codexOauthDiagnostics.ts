import { createInterface } from 'node:readline/promises'
import { get } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loginWithCodexOauthCli, resolveCachedCodexOauthSession } from '../codexOauthLogin'
import { runCliE2eSession } from './cliE2eDiagnostics'
import type { ProviderEndpointConfig } from '../../../taskyon/src/types/chatCompletion'
import { getProviderOauthCredentialsSecretName } from '../../../taskyon/src/utils/providerAuth'

// Runs only in an isolated PTY child: no real provider, tokens, or app credential store.
export async function runCodexOauthTerminalFixture() {
  const authDir = await mkdtemp(join(tmpdir(), 'codex-oauth-fixture-'))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalFetch = globalThis.fetch
  const secrets = new Map<string, string>()
  const api = {
    name: 'chatgpt-codex',
    baseURL: 'https://provider.example',
    streamSupport: false,
    routes: { chatCompletion: '/chat', models: '/models' },
    auth: {
      type: 'oauth',
      oauth: {
        authorizationUrl: 'https://provider.example/authorize',
        tokenUrl: 'https://provider.example/token',
        clientId: 'synthetic',
      },
    },
  } satisfies ProviderEndpointConfig
  const claims = {
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'selected-workspace',
      organizations: [{ id: 'org-first' }, { id: 'org-second' }],
    },
  }
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  const args = {
    api,
    storage: { authDir, secretId: 'synthetic' },
    taskyon: {
      getSecret: (
        _id: string | number,
        name: string,
        _askNew: boolean | string,
        _saveNew?: boolean,
      ) => {
        void _askNew
        void _saveNew
        return Promise.resolve(secrets.get(name) ?? null)
      },
      setSecret: (_id: string | number, name: string, value: string) => {
        secrets.set(name, value)
        return Promise.resolve()
      },
    },
  }
  let pinnedWorkspace = false
  let callback: Promise<void> | undefined

  type StdoutWriteCallback = (error?: Error | null) => void
  function interceptStdoutWrite(chunk: string | Uint8Array, callback?: StdoutWriteCallback): boolean
  function interceptStdoutWrite(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding,
    callback?: StdoutWriteCallback,
  ): boolean
  function interceptStdoutWrite(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | StdoutWriteCallback,
    writeDone?: StdoutWriteCallback,
  ): boolean {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    const authorization = text.match(/https:\/\/provider\.example\/authorize\?\S+/)?.[0]
    if (!authorization) {
      if (typeof encodingOrCallback === 'function') {
        return originalWrite(chunk, encodingOrCallback)
      }
      if (encodingOrCallback) return originalWrite(chunk, encodingOrCallback, writeDone)
      return writeDone ? originalWrite(chunk, writeDone) : originalWrite(chunk)
    }
    const url = new URL(authorization)
    pinnedWorkspace ||= url.searchParams.has('allowed_workspace_id')
    const redirect = new URL(url.searchParams.get('redirect_uri')!)
    redirect.searchParams.set('state', url.searchParams.get('state')!)
    redirect.searchParams.set('code', 'synthetic-code')
    callback = new Promise<void>((resolve, reject) => {
      get(redirect, { agent: false }, (response) => {
        response.resume()
        response.on('end', () =>
          response.statusCode === 200
            ? resolve()
            : reject(new Error('Synthetic OAuth callback failed')),
        )
      }).on('error', reject)
    })
    const writeCallback = typeof encodingOrCallback === 'function' ? encodingOrCallback : writeDone
    writeCallback?.(undefined)
    return true
  }
  process.stdout.write = interceptStdoutWrite
  globalThis.fetch = (url) => {
    const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (requestUrl !== 'https://provider.example/token') {
      throw new Error('Unexpected network call')
    }
    originalWrite('TOKEN_EXCHANGED\n')
    return Promise.resolve(
      Response.json({ access_token: token, id_token: token, expires_in: 3600 }),
    )
  }
  try {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write('', (error) => (error ? reject(error) : resolve()))
    })
    const session = await loginWithCodexOauthCli({ ...args, forceReauth: true, timeoutMs: 5000 })
    await callback
    if (session.accountId !== 'selected-workspace') throw new Error('Wrong selected workspace')
    const answer = await rl.question('Next input: ')
    originalWrite(`NEXT=${answer}\n`)
    secrets.set('oauth:workspace:preference:chatgpt-codex', 'old-workspace')
    await loginWithCodexOauthCli({ ...args, forceReauth: true, timeoutMs: 5000 })
    await callback
    if (pinnedWorkspace) throw new Error('Saved workspace must not constrain a new browser login')
    secrets.set('oauth:account-id:chatgpt-codex', 'old-workspace')
    secrets.set(
      getProviderOauthCredentialsSecretName('chatgpt-codex'),
      JSON.stringify({
        type: 'oauth-credentials',
        access_token: 'opaque',
        id_token: 'opaque',
        service: 'https://provider.example/token',
        created_at: Date.now(),
        expires_in: 3600,
      }),
    )
    const cached = await resolveCachedCodexOauthSession(args)
    if (!cached || cached.accessToken !== 'opaque' || cached.accountId) {
      throw new Error('Missing claims must not inherit an old account')
    }
    originalWrite('OAUTH_FIXTURE_OK\n')
  } finally {
    process.stdout.write = originalWrite
    globalThis.fetch = originalFetch
    rl.close()
    await rm(authDir, { recursive: true, force: true })
  }
}

export async function testCodexOauthCliUsesBrowserWorkspaceWithoutSecondPrompt() {
  const entry = `const mod = await import(new URL('./tests/codexOauthDiagnostics.ts', import.meta.resolve('@taskyon/tycli/interactive'))); await mod.runCodexOauthTerminalFixture();`
  const result = await runCliE2eSession({
    testName: 'Codex OAuth terminal workspace',
    cwd: process.cwd(),
    runner: 'pty',
    runCommand: `yarn node --import @taskyon/tycli/register --experimental-strip-types --input-type=module -e ${JSON.stringify(entry)}`,
    env: { TASKYON_CHATGPT_WORKSPACE_ID: '' },
    steps: [
      { waitFor: 'TOKEN_EXCHANGED', delayMs: 200, input: '2\n' },
      { waitFor: 'OAUTH_FIXTURE_OK', input: '', timeoutMs: 5000 },
    ],
  })
  if (
    result.code !== 0 ||
    !result.output.includes('NEXT=2') ||
    result.output.includes('Workspace number:')
  ) {
    throw new Error(
      `OAuth must retain the browser workspace and one terminal reader: ${result.output}`,
    )
  }
}
