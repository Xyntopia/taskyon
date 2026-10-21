<template>
  <q-dialog v-model="show" persistent>
    <q-card class="q-pa-sm" style="width: min(94vw, 520px)" data-cy="search-provider-setup">
      <q-card-section>
        <div class="text-h6">Set up web search</div>
        <div class="text-body2 q-mt-sm">
          Choose a search service and create your own API key. Registration opens in a new tab;
          return here to connect it to Taskyon.
        </div>
      </q-card-section>
      <q-card-section class="q-gutter-md">
        <q-select
          v-model="provider"
          :options="WEB_SEARCH_PROVIDERS"
          option-label="label"
          option-value="id"
          emit-value
          map-options
          outlined
          label="Search provider"
          data-cy="search-provider-select"
        />
        <div class="text-caption">{{ currentProvider.pricing }}</div>
        <q-btn
          flat
          outline
          color="primary"
          no-caps
          :href="currentProvider.keyUrl"
          target="_blank"
          rel="noopener noreferrer"
          label="Create / manage API key"
          data-cy="search-provider-register"
        />
        <SecretInput
          v-model="apiKey"
          filled
          label="API key"
          placeholder="Paste your API key here"
          data-cy="search-provider-key"
          @keyup.enter="save"
        />
        <div class="text-caption">
          Your key is stored in Taskyon's encrypted, tool-scoped secret store. Queries are sent
          directly to your selected provider after network permission. Save & test sends one sample
          search that counts toward your provider's quota and may incur charges.
        </div>
        <q-banner v-if="error" class="bg-negative text-white" data-cy="search-provider-error">
          {{ error }}
        </q-banner>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" :disable="testing" @click="$emit('cancel')" />
        <q-btn
          color="primary"
          no-caps
          label="Save & test"
          :loading="testing"
          :disable="!apiKey.trim()"
          data-cy="search-provider-save"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SecretInput from '@taskyon/ui/components/varViews/SecretInput.vue'
import { WEB_SEARCH_PROVIDERS, type WebSearchProvider } from '@taskyon/taskyon/tools/webSearchTool'

const show = defineModel<boolean>({ required: true })
const props = defineProps<{
  initialProvider?: WebSearchProvider
  testing?: boolean
  error?: string
}>()
const emit = defineEmits<{
  (event: 'save', value: { provider: WebSearchProvider; apiKey: string }): void
  (event: 'cancel'): void
}>()

const provider = ref<WebSearchProvider>('tinyfish')
const apiKey = ref('')
const currentProvider = computed(
  () =>
    WEB_SEARCH_PROVIDERS.find((entry) => entry.id === provider.value) ?? WEB_SEARCH_PROVIDERS[0],
)
watch(show, (visible) => {
  if (!visible) {
    apiKey.value = ''
  } else {
    provider.value = props.initialProvider ?? 'tinyfish'
  }
})
const save = () => {
  if (!apiKey.value.trim() || props.testing) return
  emit('save', { provider: provider.value, apiKey: apiKey.value.trim() })
}
</script>
