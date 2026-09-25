<template>
  <q-card flat bordered data-cy="sandbox-fetch-settings">
    <q-card-section>
      <div class="text-subtitle1">Sandbox network fetch</div>
      <div class="text-caption">
        Approved tool requests use the host's chosen transport. A custom proxy can also be selected
        for providers.
      </div>
      <q-select
        v-model="transport"
        :options="SANDBOX_FETCH_TRANSPORT_OPTIONS"
        label="Sandbox fetch transport"
        emit-value
        map-options
        outlined
        dense
        data-cy="sandbox-fetch-transport"
      />
      <q-input
        v-if="transport === 'wss'"
        v-model="wssUrl"
        label="Taskyon WSS tunnel URL"
        hint="The authenticated remote tunnel used for approved sandbox requests."
        outlined
        dense
        data-cy="sandbox-fetch-wss-url"
      />
      <q-input
        v-model="customProxyTemplate"
        label="Custom proxy URL template"
        hint="Include {url} where the encoded destination should go. Used when selected by a provider or tool."
        outlined
        dense
        data-cy="sandbox-fetch-proxy-url"
      />
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import {
  SANDBOX_FETCH_TRANSPORT_OPTIONS,
  type SandboxFetchTransport,
} from '@taskyon/common/modules/webFetching/mediatedFetch'

const transport = defineModel<SandboxFetchTransport>('transport', { required: true })
const wssUrl = defineModel<string>('wssUrl', { required: true })
const customProxyTemplate = defineModel<string>('customProxyTemplate', { required: true })
</script>
