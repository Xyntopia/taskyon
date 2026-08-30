<template>
  <FadeAwayScrollPage>
    <q-toolbar class="q-pt-md">
      <q-tabs :model-value="selectedTab" class="col-auto" dense no-caps>
        <q-route-tab
          to="/settings/aiserviceprovider"
          label="AI Service Provider"
          name="aiserviceprovider"
          data-cy="aiserviceprovider"
        />
        <q-route-tab to="/settings/profile" label="Profile & Backup" name="profile" />
        <q-route-tab to="/settings/secrets" label="Secrets" name="secrets" />
        <q-route-tab
          to="/settings/sandbox-network"
          label="Sandbox Network"
          name="sandbox-network"
        />
        <q-route-tab
          v-if="state.appConfiguration.expertMode || selectedTab == 'agent config'"
          to="/settings/agent config"
          label="AI Configuration"
          name="agent config"
        />
        <q-route-tab
          v-if="state.appConfiguration.expertMode || selectedTab == 'app config'"
          to="/settings/app config"
          label="App Configuration"
          name="app config"
        />
      </q-tabs>
      <q-space />
      <q-btn flat dense label="Browser Access" to="/browser-access" />
    </q-toolbar>
    <div class="fit text-center"><ExpertEnable /></div>
    <q-card flat class="q-ma-xs">
      <q-tab-panels :model-value="selectedTab" animated swipeable infinite>
        <q-tab-panel name="aiserviceprovider" :class="tabPanelClass">
          <LLMProviders
            v-model:expert-mode-on="state.appConfiguration.expertMode"
            style="max-width: 600px"
          />
        </q-tab-panel>
        <q-tab-panel name="profile" :class="tabPanelClass">
          <SyncTaskyon style="max-width: 600px" />
        </q-tab-panel>
        <q-tab-panel name="secrets" :class="tabPanelClass">
          <PasswordManager
            copybtn
            delete-all-btn
            title="Taskyon Password Manager"
            style="max-width: 600px"
          />
        </q-tab-panel>
        <q-tab-panel name="sandbox-network" :class="tabPanelClass">
          <div class="column q-gutter-md fit" style="max-width: 900px">
            <SandboxFetchSettings
              v-model:transport="state.appConfiguration.sandboxFetchTransport"
              v-model:wss-url="state.appConfiguration.sandboxFetchWssUrl"
              v-model:cors-proxy-url="state.appConfiguration.sandboxCorsProxyUrl"
              v-model:custom-proxy-template="state.appConfiguration.customProxyTemplate"
            />
            <div class="row items-center q-gutter-sm">
              <q-btn outline label="Check CORS proxy" @click="checkCorsProxy" />
              <span v-if="corsProxyStatus" class="text-caption">{{ corsProxyStatus }}</span>
            </div>
          </div>
        </q-tab-panel>
        <q-tab-panel name="agent config" :class="tabPanelClass">
          <div class="column q-gutter-md fit" style="max-width: 900px">
            <div class="text-h6">AI/LLM toolchain configurations</div>
            <q-select
              :model-value="state.selectedToolchainProfile ?? null"
              :options="toolchainProfileOptions"
              label="Runtime toolchain profile"
              emit-value
              map-options
              outlined
              @update:model-value="selectToolchainProfile"
            />
            <div class="text-caption">
              Selecting a profile changes runtime settings. Expanding a profile below only edits it.
            </div>

            <div class="text-subtitle1">Base settings</div>
            <ObjectView
              view-mode="tree"
              :default-expanded-depth="0"
              :enable-expert-mode="state.appConfiguration.expertMode"
              :model-value="state.toolchainProfiles.base"
              :schema="toolchainSchema"
              class="fit"
              copy-object-btn
              show-missing-mode-select
              :show-header-row="state.appConfiguration.expertMode"
              :icons="toolchainIcons"
              missing-mode="hide"
              copy-btn
              @update:model-value="
                (nextValue) => applyToolchainSettingsUpdate(state.toolchainProfiles.base, nextValue)
              "
            />

            <q-separator />
            <div class="row items-start q-gutter-sm">
              <q-input
                v-model="newToolchainProfileName"
                class="col"
                label="New profile name"
                outlined
                dense
                :error="!!newToolchainProfileError"
                :error-message="newToolchainProfileError"
                @keyup.enter="createToolchainProfile"
              />
              <q-btn
                label="Add profile"
                color="primary"
                :disable="!canCreateToolchainProfile"
                @click="createToolchainProfile"
              />
            </div>

            <div v-if="!toolchainProfileNames.length" class="text-caption">
              No named toolchain profiles yet.
            </div>
            <q-expansion-item
              v-for="profileName in toolchainProfileNames"
              :key="profileName"
              :label="profileName"
              expand-separator
            >
              <template #header>
                <q-item-section>{{ profileName }}</q-item-section>
                <q-item-section side>
                  <q-btn
                    flat
                    dense
                    color="negative"
                    label="Delete"
                    @click.stop="deleteToolchainProfile(profileName)"
                  />
                </q-item-section>
              </template>
              <div class="column q-gutter-sm q-pa-sm">
                <div class="text-caption">
                  Only explicit overrides are stored here. Deleting an override uses the base value.
                </div>
                <ObjectView
                  view-mode="tree"
                  :default-expanded-depth="0"
                  :enable-expert-mode="state.appConfiguration.expertMode"
                  :model-value="state.toolchainProfiles.profiles[profileName]!"
                  :schema="toolchainSchema"
                  class="fit"
                  copy-object-btn
                  show-missing-mode-select
                  :show-header-row="state.appConfiguration.expertMode"
                  :icons="toolchainIcons"
                  missing-mode="placeholders"
                  allow-object-structure-editing
                  copy-btn
                  @update:model-value="
                    (nextValue) =>
                      applyToolchainSettingsUpdate(
                        state.toolchainProfiles.profiles[profileName]!,
                        nextValue,
                      )
                  "
                />
              </div>
            </q-expansion-item>
          </div>
          <q-separator size="xl" spaced class="self-stretch" />
          other settings:
          <ObjectView
            v-model="llmSettingsModel"
            :schema="
              convertZodToJsonSchemaCached(TyProfile.shape.llmSettings, {
                unrepresentable: 'any',
              })
            "
            class="fit"
          />
        </q-tab-panel>
        <q-tab-panel name="app config" :class="tabPanelClass">
          <div>All of the app configurations</div>
          <ObjectView
            v-model="appConfigurationModel"
            :schema="
              convertZodToJsonSchemaCached(appConfigurationWithoutSandboxFetch, {
                unrepresentable: 'any',
              })
            "
            :icons="settingsIcons.appConfiguration as iconMap"
            class="fit"
          />
          <q-separator size="xl" spaced class="self-stretch" />
          <div class="row items-center justify-between fit" style="max-width: 900px">
            <div>
              <div class="text-subtitle2">PMTiles storage cache</div>
              <div class="text-caption">Logical range-cache diagnostics and current limits.</div>
            </div>
            <q-btn flat dense label="Refresh" @click="refreshPmtilesCacheInfo" />
          </div>
          <ObjectView
            v-model="pmtilesCacheInfoModel"
            :read-only="true"
            :copy-object-btn="true"
            class="fit"
          />
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import type { JSONSchema7 } from 'json-schema'
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
import SandboxFetchSettings from '@taskyon/ui/components/SandboxFetchSettings.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import { getPmtilesStorageCacheDebugSnapshot } from '@taskyon/ui/gis/pmtilesStorageCache'
import {
  convertZodToJsonSchemaCached,
  FunctionArguments as FunctionArgumentsSchema,
} from '@taskyon/taskyon'
import ExpertEnable from 'components/taskyon/ExpertEnable.vue'
import LLMProviders from 'components/taskyon/LLMProviders.vue'
import SyncTaskyon from 'components/taskyon/SyncTaskyon.vue'
import PasswordManager from 'src/components/taskyon/PasswordManager.vue'
import type { iconMap } from 'src/modules/icons'
import { iconRegistry, settingsIcons } from 'src/modules/icons'
import { TyProfile } from 'src/modules/taskyon/types'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const state = useAppStateStore()
const tystate = useTaskyonStore()
const corsProxyStatus = ref('')
const appConfigurationWithoutSandboxFetch = TyProfile.shape.appConfiguration.omit({
  sandboxFetchTransport: true,
  sandboxFetchWssUrl: true,
  sandboxCorsProxyUrl: true,
  customProxyTemplate: true,
})
const appConfigurationModel = computed<Record<string, unknown>>({
  get: () =>
    Object.fromEntries(
      Object.entries(state.appConfiguration).filter(
        ([key]) =>
          ![
            'sandboxFetchTransport',
            'sandboxFetchWssUrl',
            'sandboxCorsProxyUrl',
            'customProxyTemplate',
          ].includes(key),
      ),
    ),
  set: (nextValue) => {
    Object.assign(state.appConfiguration, nextValue)
  },
})

const tabPanelClass = 'column items-center'

const checkCorsProxy = async () => {
  corsProxyStatus.value = 'Checking…'
  const available = await tystate.checkCorsProxyAvailability()
  corsProxyStatus.value = available ? 'Available' : 'Unavailable'
}

const toolchainProfileNames = computed(() => Object.keys(state.toolchainProfiles.profiles).sort())
const toolchainProfileOptions = computed(() => [
  { label: 'Base only', value: null },
  ...toolchainProfileNames.value.map((name) => ({ label: name, value: name })),
])
const newToolchainProfileName = ref('')
const newToolchainProfileError = computed(() => {
  const name = newToolchainProfileName.value.trim()
  if (!name) return ''
  if (name === 'base') return 'The name "base" is reserved'
  if (Object.hasOwn(state.toolchainProfiles.profiles, name)) return 'This profile already exists'
  return ''
})
const canCreateToolchainProfile = computed(
  () => !!newToolchainProfileName.value.trim() && !newToolchainProfileError.value,
)

const toolchainSettingKeys = computed(() => {
  const keys = new Set(Object.keys(tystate.allTools))
  Object.keys(state.toolchainProfiles.base).forEach((key) => keys.add(key))
  Object.values(state.toolchainProfiles.profiles).forEach((profile) => {
    Object.keys(profile).forEach((key) => keys.add(key))
  })
  return [...keys].sort()
})

const toolchainSchema = computed<JSONSchema7>(() => ({
  type: 'object',
  properties: Object.fromEntries(
    toolchainSettingKeys.value.flatMap((key) => {
      const parameters = tystate.allTools[key]?.parameters
      return [[key, parameters ?? { type: 'object' }]]
    }),
  ),
}))

const selectToolchainProfile = (profileName: string | null) => {
  state.setSelectedToolchainProfile(profileName ?? undefined)
}

const createToolchainProfile = () => {
  if (!canCreateToolchainProfile.value) return
  state.createToolchainProfile(newToolchainProfileName.value)
  newToolchainProfileName.value = ''
}

const deleteToolchainProfile = (profileName: string) => {
  if (!window.confirm(`Delete toolchain profile "${profileName}"?`)) return
  state.deleteToolchainProfile(profileName)
}

const getToolchainIcons = (key: string): iconMap => {
  const directIcons = iconRegistry[key]
  if (directIcons && typeof directIcons === 'object') {
    return directIcons
  }

  if (key === state.llmSettings.entryFunction) {
    return (iconRegistry.entryNode as iconMap) ?? {}
  }

  return {}
}

const toolchainIcons = computed<iconMap>(() =>
  Object.fromEntries(toolchainSettingKeys.value.map((key) => [key, getToolchainIcons(key)])),
)

const parseToolchainSettings = (
  nextValue: unknown,
): Record<string, Record<string, unknown>> | undefined => {
  if (nextValue === null || typeof nextValue !== 'object' || Array.isArray(nextValue)) return

  const parsedSettings: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(nextValue)) {
    const parsed = FunctionArgumentsSchema.safeParse(value)
    if (!parsed.success) return
    parsedSettings[key] = parsed.data
  }
  return parsedSettings
}

const applyToolchainSettingsUpdate = (
  config: Record<string, Record<string, unknown>>,
  nextValue: unknown,
) => {
  const parsedSettings = parseToolchainSettings(nextValue)
  if (!parsedSettings) return

  Object.keys(config).forEach((key) => {
    if (!Object.hasOwn(parsedSettings, key)) delete config[key]
  })
  Object.assign(config, parsedSettings)
}

const llmSettingsModel = computed({
  get: () => state.llmSettings as Record<string, unknown>,
  set: (nextValue) => {
    state.patchLLMSettings(nextValue)
  },
})

const pmtilesCacheInfoModel = ref<Record<string, unknown>>({
  loading: true,
})

const refreshPmtilesCacheInfo = async () => {
  pmtilesCacheInfoModel.value = {
    loading: true,
  }
  try {
    pmtilesCacheInfoModel.value = await getPmtilesStorageCacheDebugSnapshot(tystate.storageClient)
  } catch (error) {
    pmtilesCacheInfoModel.value = {
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

onMounted(() => {
  void refreshPmtilesCacheInfo()
})

const selectedTab = computed(() => {
  return (route.params.tab as string) || 'aiserviceprovider'
})
</script>
