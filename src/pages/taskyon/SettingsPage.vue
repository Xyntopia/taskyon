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
            <template
              v-for="{ key, value } in getToolchainEntries(state.toolchainProfiles.base)"
              :key="`base:${key}`"
            >
              <div class="text-subtitle2">{{ key }}</div>
              <ObjectView
                :enable-expert-mode="state.appConfiguration.expertMode"
                :model-value="value"
                :schema="tystate.allTools[key]?.parameters"
                class="fit"
                copy-object-btn
                show-missing-mode-select
                :show-header-row="state.appConfiguration.expertMode"
                :icons="getToolchainIcons(key)"
                missing-mode="hide"
                copy-btn
                @update:model-value="
                  (nextVal) => applyToolchainUpdate(state.toolchainProfiles.base, key, nextVal)
                "
              />
            </template>

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
                <template
                  v-for="{ key, value } in getProfileToolchainEntries(profileName)"
                  :key="`${profileName}:${key}`"
                >
                  <div class="text-subtitle2">{{ key }}</div>
                  <ObjectView
                    :enable-expert-mode="state.appConfiguration.expertMode"
                    :model-value="value"
                    :schema="tystate.allTools[key]?.parameters"
                    class="fit"
                    copy-object-btn
                    show-missing-mode-select
                    :show-header-row="state.appConfiguration.expertMode"
                    :icons="getToolchainIcons(key)"
                    missing-mode="placeholders"
                    allow-object-structure-editing
                    copy-btn
                    @update:model-value="
                      (nextVal) =>
                        applyToolchainUpdate(
                          state.toolchainProfiles.profiles[profileName]!,
                          key,
                          nextVal,
                        )
                    "
                  />
                </template>
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
            v-model="state.appConfiguration"
            :schema="
              convertZodToJsonSchemaCached(TyProfile.shape.appConfiguration, {
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
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
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

const tabPanelClass = 'column items-center'

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

const getToolchainEntries = (config: Record<string, Record<string, unknown>>) =>
  Object.keys(config)
    .sort()
    .map((key) => ({ key, value: config[key]! }))

const getProfileToolchainEntries = (profileName: string) => {
  const profile = state.toolchainProfiles.profiles[profileName]!
  const keys = new Set([...Object.keys(state.toolchainProfiles.base), ...Object.keys(profile)])
  return [...keys].sort().map((key) => ({ key, value: profile[key] ?? {} }))
}

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

const applyToolchainUpdate = (
  config: Record<string, Record<string, unknown>>,
  key: string,
  nextValue: unknown,
) => {
  const parsed = FunctionArgumentsSchema.safeParse(nextValue)
  if (!parsed.success) return
  config[key] = parsed.data
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
