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
          <div>AI/LLM toolchain configurations</div>
          <template v-for="{ key, value } in toolchainEntries" :key="key">
            {{ key }}
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
              @update:model-value="(nextVal) => applyToolchainUpdate(key, nextVal)"
            />
          </template>
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
              <div class="text-subtitle2">PMTiles OPFS Cache Info</div>
              <div class="text-caption">Single-file cache diagnostics and current limits.</div>
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
import { getPmtilesOpfsCacheDebugSnapshot } from '@taskyon/common/modules/pmtilesOpfsCache'
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

const toolchainEntries = computed(() =>
  Object.keys(state.toolchainConfig).map((key) => ({
    key,
    value: state.toolchainConfig[key]!,
  })),
)

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

const applyToolchainUpdate = (key: string, nextValue: unknown) => {
  const parsed = FunctionArgumentsSchema.safeParse(nextValue)
  if (!parsed.success) return
  const target = state.toolchainConfig[key]
  if (!target) return
  Object.assign(target, parsed.data)
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
    pmtilesCacheInfoModel.value = await getPmtilesOpfsCacheDebugSnapshot()
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
