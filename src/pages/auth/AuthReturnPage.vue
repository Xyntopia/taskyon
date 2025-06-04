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
  const code = props.query.code
  if (!code) {
    error.value = 'No code in URL'
    loading.value = false
    return
  }

  const verifier = sessionStorage.getItem('gitlab_code_verifier')
  if (!verifier) {
    error.value = 'Missing PKCE verifier'
    loading.value = false
    return
  }

  try {
    const clientId = '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b'
    const redirectUri = `${window.location.origin}/oauth/return/${props.serviceName}`

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

    // Optionally store locally
    sessionStorage.setItem('gitlab_access_token', accessToken)

    // Send token back to parent
    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'oauth-success',
          service: props.serviceName,
          token: accessToken,
        },
        '*',
      )
    }

    // Close the window
    window.close()
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : 'Token exchange failed'
  } finally {
    loading.value = false
  }
})
</script>
