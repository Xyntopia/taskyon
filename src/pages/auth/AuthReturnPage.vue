<template>
  <q-layout>
    <q-page-container>
      <q-page>
        <div>Auth Return Page for: {{ serviceName }}</div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

// (1) Define props exactly as before:
const props = defineProps<{ serviceName: string; query: Record<string, string> }>()

// (2) A reactive to hold any error or “loading” state, if you want to show a spinner/text:
const error = ref<string | null>(null)
const loading = ref(false)
const accessToken = ref<string | null>(null)

// (3) Once mounted, grab the code + verifier, then POST for token:
onMounted(async () => {
  // (a) Extract “code” from props.query
  const code = props.query.code
  if (!code) {
    error.value = 'No code found in URL query params'
    return
  }

  // (b) Pull PKCE verifier back out of sessionStorage
  const verifier = sessionStorage.getItem('gitlab_code_verifier')
  if (!verifier) {
    error.value = 'Missing PKCE verifier in sessionStorage'
    return
  }

  loading.value = true
  try {
    const clientId = '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b'
    const redirectUri = `${window.location.origin}/oauth/return/${props.serviceName}`

    // Build x-www-form-urlencoded body
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
      const text = await res.text()
      throw new Error(`Token endpoint returned ${res.status}: ${text}`)
    }

    const data = await res.json()
    accessToken.value = data.access_token as string

    // (c) At this point you have the access token. You can:
    //     • store it in a Vuex/Pinia store,
    //     • call your backend to persist it,
    //     • or immediately redirect/close this page.
    console.log('✅ GitLab access token:', accessToken.value)
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : 'Unknown error during token exchange'
  } finally {
    loading.value = false
  }
})
</script>
