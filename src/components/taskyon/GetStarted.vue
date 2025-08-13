<template>
  <div class="text-h6 col-auto column items-center">
    <!-- eslint-disable vue/no-v-html -->
    <div
      class="svg-container q-pa-lg"
      :style="{
        '--icon-primary': $q.dark.isActive ? 'white' : 'var(--q-primary)',
        '--icon-secondary': $q.dark.isActive ? 'var(--q-secondary)' : 'var(--q-primary)',
        width: '10rem',
        height: 'auto',
        display: 'inline-block',
      }"
      v-html="logoSvg"
    />
    <p v-if="state.appConfiguration.welcomeMsg" class="welcome-message-text text-center">
      {{ state.appConfiguration.welcomeMsg }}
    </p>
    <div class="row q-gutter-xs justify-center">
      <div
        v-for="s in state.appConfiguration.chatSuggestions"
        :key="s.label"
        class="col-auto task-button"
        style="max-width: 200px"
      >
        <CreateTaskButton
          v-if="'md' in s"
          :markdown="s.md"
          :label="s.label"
          outline
          no-caps
          style="height: 100%"
        />
        <q-btn
          v-else-if="s.url"
          :to="s.url.toString()"
          :label="s.label"
          outline
          no-caps
          style="height: 100%"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppStateStore } from 'src/stores/appState'
import CreateTaskButton from './CreateTaskButton.vue'
import logoSvg from 'src/assets/taskyon_logo_complex_animated.svg?raw'

const state = useAppStateStore()
</script>
