<template>
  <FadeAwayScrollPage>
    <q-toolbar class="q-pt-md">
      <q-tabs v-model="selectedTab" class="col-auto" dense no-caps>
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
          <div>AI/LLM chat completion configurations</div>
          <template v-for="[key, val] in Object.entries(state.toolchainConfig)" :key="key">
            {{ key }}
            <ObjectTreeView
              :model-value="val as Record<string, unknown>"
              :schema="tystate.allTools[key]?.parameters"
              class="fit"
              hide-missing
              @update:model-value="(val) => console.log('updated', val)"
            />
          </template>
          <q-separator size="xl" spaced class="self-stretch" />
          other settings:
          <ObjectTreeView
            v-model="state.llmSettings"
            :schema="
              convertZodToJsonSchemaCached(TyProfile.shape.llmSettings, {
                unrepresentable: 'any',
              })
            "
            class="fit"
          />
          <!--{{ state.llmSettings }}-->
        </q-tab-panel>
        <q-tab-panel name="app config" :class="tabPanelClass">
          <div>All of the app configurations</div>
          <ObjectTreeView
            v-model="state.appConfiguration"
            :schema="
              convertZodToJsonSchemaCached(TyProfile.shape.appConfiguration, {
                unrepresentable: 'any',
              })
            "
            class="fit"
          />
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import { convertZodToJsonSchemaCached } from '@taskyon/taskyon'
import ObjectTreeView from 'components/varViews/ObjectTreeView.vue'
import ExpertEnable from 'components/taskyon/ExpertEnable.vue'
import LLMProviders from 'components/taskyon/LLMProviders.vue'
import SyncTaskyon from 'components/taskyon/SyncTaskyon.vue'
import FadeAwayScrollPage from 'src/components/FadeAwayScrollPage.vue'
import PasswordManager from 'src/components/taskyon/PasswordManager.vue'
import { TyProfile } from 'src/modules/taskyon/types'
import { useAppStateStore } from 'src/stores/appState'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTaskyonStore } from 'src/stores/taskyonState'

const route = useRoute()
const state = useAppStateStore()
const tystate = useTaskyonStore()

const tabPanelClass = 'column items-center'

const selectedTab = computed(() => {
  return (route.params.tab as string) || 'aiserviceprovider'
})
</script>
