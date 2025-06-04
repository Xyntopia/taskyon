<template>
  <q-layout>
    <q-page-container>
      <q-page class="q-pa-md flex flex-center column items-center">
        <q-card flat bordered class="q-pa-lg bg-grey-2 text-center">
          <div class="text-h6 q-mb-sm">OAuth Login Success</div>
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
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{ serviceName: string; query: Record<string, string> }>()

const error = ref<string | null>(null)
const loading = ref(true)

const closeWindow = () => window.close()

onMounted(async () => {
  const service = props.serviceName
  const code = props.query.code
  if (!code) {
    error.value = 'No code in URL'
    loading.value = false
    return
  }

  // Read the per-service PKCE verifier and config:
  const verifierKey = `oauth_pkce_verifier_${service}`
  const configKey = `oauth_config_${service}`
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
    const redirectUri = `${window.location.origin}/oauth/return/${service}`

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
    const accessToken = data.access_token

    // Optionally store per-service access token (or whatever)
    sessionStorage.setItem(`${service}_access_token`, accessToken)

    // Let the opener know which service just finished:
    window.opener?.postMessage(
      {
        type: 'oauth-success',
        service,
        token: accessToken,
      },
      window.location.origin,
    )

    window.close()
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : 'Token exchange failed'
  } finally {
    loading.value = false
  }
})
</script>
