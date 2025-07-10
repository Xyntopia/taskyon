<template>
  <q-layout>
    <q-page-container>
      <q-page class="q-pa-md flex flex-center column items-center">
        <q-card flat bordered class="q-pa-lg bg-grey-2 text-center">
          <div>Authenticate: {{ oauthURL }}</div>
          <div v-if="code" class="text-h6 q-mb-sm">OAuth Login Success</div>
          <div v-if="loading">Finalizing login…</div>
          <div v-else-if="error" class="text-negative q-mt-sm">{{ error }}</div>
          <div v-else class="text-positive">
            Access token received. You can now close this window.
          </div>
          <q-btn
            v-if="!loading"
            class="q-mt-md"
            label="Close Window"
            color="primary"
            flat
            @click="closeWindow"
          />
          <q-btn
            v-if="phase === 'start' && oauthURL"
            class="q-mt-md"
            label="Start Oauth Process"
            color="primary"
            flat
            @click="startOauth(oauthURL)"
          />
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
/**
 * This window is meant to be opened as a popup window for oauth applications!
 * it will automatically forward to a specified oauth
 */
import { onMounted, ref } from 'vue'
import { base64UrlDecode, base64UrlEncode } from '../../modules/utils'
import type { OAuthCredentials } from 'src/modules/taskyon/types'

const props = defineProps<{
  phase: 'start' | 'return'
  query?: Record<string, string>
}>()

// because our service will return to our URL with its oan query parameters,
// we need the svcId to be base64 encoded so that we can use it as a path
const oauthURL = props.query?.svcUrl || base64UrlDecode(props.query?.svcId || '')
const error = ref<string | null>(null)
const loading = ref(true)
const clientId = props.query?.cid
const code = props.query?.code
const scope = props.query?.scope

const closeWindow = () => window.close()

const svcId64 = base64UrlEncode(oauthURL)
const redirectUri = `${window.location.origin}/oauth/return?svcId=${svcId64}`

async function startOauth(oauthURL: string) {
  // 1) Generate PKCE
  const challenge = await generatePKCE(oauthURL)

  // 3) Redirect into GitLab’s authorize endpoint
  if (clientId && scope) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    window.location.replace(`${oauthURL}?${params.toString()}`)
  } else {
    error.value = 'need clientId and scope!!'
  }
}

onMounted(async () => {
  if (props.phase === 'start' && oauthURL) {
    await startOauth(oauthURL)
    return
  }

  // ————————————————
  // else: mode === 'return' (your existing “exchange code for token”)
  if (!code) {
    error.value = 'No code in URL'
    loading.value = false
    return
  }

  // Read the per-service PKCE verifier and config:
  const verifierKey = `oauth_pkce_verifier_${oauthURL}`
  const configKey = `oauth_config_${oauthURL}`
  const verifier = sessionStorage.getItem(verifierKey)
  const configStr = sessionStorage.getItem(configKey)

  if (!verifier) {
    error.value = 'Missing PKCE verifier'
    loading.value = false
    return
  }
  if (!configStr) {
    error.value = 'Missing OAuth configuration'
    loading.value = false
    return
  }

  // Once read, clear them so nothing collides with a future login:
  sessionStorage.removeItem(verifierKey)
  sessionStorage.removeItem(configKey)

  // Parse out clientId (we only stored that):
  const { clientId } = JSON.parse(configStr)

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })

    const res = await fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      throw new Error(`Token request failed (${res.status})`)
    }

    const data = await res.json()
    console.log('Token exchange response:', data)
    const accessToken = data.access_token
    const refreshToken = data.refresh_token

    console.log('recevied new accessToken:', accessToken, refreshToken)

    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'oauth-credentials',
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          service: oauthURL,
          token_type: data.token_type,
          expires_in: data.expires_in,
          created_at: data.created_at,
        } as OAuthCredentials,
        window.location.origin,
      )
    }

    closeWindow()
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : 'Token exchange failed'
  } finally {
    loading.value = false
  }
})

async function generatePKCE(svc: string) {
  const array = crypto.getRandomValues(new Uint8Array(64))
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  // 2) Stash for later
  sessionStorage.setItem(`oauth_pkce_verifier_${svc}`, verifier)
  sessionStorage.setItem(
    `oauth_config_${svc}`,
    JSON.stringify({
      clientId: clientId,
      scope: scope,
    }),
  )
  return challenge
}
</script>
