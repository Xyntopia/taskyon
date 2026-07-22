<template>
  <section v-if="$slots.welcome" class="context-welcome column items-center">
    <p class="context-welcome-message text-center">
      <slot name="welcome" />
    </p>

    <div class="context-welcome-input">
      <slot name="hero-input" />
    </div>

    <div v-if="customSuggestions.length > 0" class="context-welcome-suggestions row justify-center">
      <div
        v-for="suggestion in customSuggestions"
        :key="suggestion.label"
        class="context-welcome-suggestion"
      >
        <CreateTaskButton
          v-if="'md' in suggestion"
          :markdown="suggestion.md"
          :label="suggestion.label"
          outline
          no-caps
        />
        <q-btn v-else :to="suggestion.url" :label="suggestion.label" outline no-caps />
      </div>
    </div>
  </section>

  <section v-else class="frontpage-hero column items-center no-wrap">
    <svg class="frontpage-tree frontpage-tree--left" viewBox="0 0 360 640" aria-hidden="true">
      <g class="tree-lines tree-lines--primary">
        <path d="M106 618V386" />
        <path d="M106 472 48 414" />
        <path d="M106 448 190 364" />
        <path d="M106 390 62 346" />
        <path d="M62 346 28 346" />
        <path d="M62 346 62 300" />
        <path d="M106 386 106 262" />
        <path d="M106 284 72 250" />
        <path d="M72 250 34 250" />
        <path d="M106 324 168 262" />
        <path d="M132 298 188 298" />
        <path d="M188 298 218 268" />
        <path d="M168 262V166" />
        <path d="M168 218 240 146" />
        <path d="M202 184 262 184" />
        <path d="M262 184 292 154" />
        <path d="M168 198 120 150" />
        <path d="M144 174 102 174" />
        <path d="M102 174 72 144" />
        <path d="M168 166 168 92" />
        <path d="M168 132 214 86" />
        <path d="M168 126 134 92" />
        <path d="M168 108 196 108" />
        <path d="M196 108 232 72" />
        <path d="M214 86 268 86" />
        <path d="M268 86 306 48" />
        <path d="M268 86 316 118" />
        <path d="M120 150 86 116" />
        <path d="M86 116 42 116" />
        <path d="M190 364 288 364" />
        <path d="M190 364 238 316" />
        <path d="M238 316 312 316" />
        <path d="M288 364 326 326" />
        <path d="M288 364 326 398" />
        <path d="M238 316 260 286" />
        <path d="M260 286 332 286" />
        <path d="M48 414 48 340" />
        <path d="M48 340 18 310" />
        <path d="M106 518 158 570" />
        <path d="M158 570 222 570" />
        <path d="M158 570 124 604" />
        <path d="M222 570 258 606" />
      </g>
      <g class="tree-lines tree-lines--secondary">
        <circle cx="106" cy="386" r="3" />
        <circle cx="62" cy="346" r="2.5" />
        <circle cx="28" cy="346" r="2" />
        <circle cx="34" cy="250" r="2" />
        <circle cx="190" cy="364" r="3" />
        <circle cx="218" cy="268" r="2.4" />
        <circle cx="240" cy="146" r="3" />
        <circle cx="292" cy="154" r="2.2" />
        <circle cx="168" cy="92" r="2.5" />
        <circle cx="214" cy="86" r="2.5" />
        <circle cx="232" cy="72" r="2" />
        <circle cx="268" cy="86" r="2.5" />
        <circle cx="306" cy="48" r="2" />
        <circle cx="316" cy="118" r="2" />
        <circle cx="42" cy="116" r="2" />
        <circle cx="48" cy="414" r="3" />
        <circle cx="238" cy="316" r="3" />
        <circle cx="332" cy="286" r="2" />
        <circle cx="312" cy="316" r="2.5" />
        <circle cx="326" cy="398" r="2" />
        <circle cx="222" cy="570" r="2.5" />
        <circle cx="124" cy="604" r="2" />
        <circle cx="258" cy="606" r="2" />
      </g>
    </svg>
    <svg class="frontpage-tree frontpage-tree--right" viewBox="0 0 420 360" aria-hidden="true">
      <g class="tree-lines tree-lines--primary">
        <path d="M18 286 C88 252 134 252 202 286 S332 324 402 278" />
        <path d="M260 260V174" />
        <path d="M260 216 310 166" />
        <path d="M260 216 220 176" />
        <path d="M310 166V112" />
        <path d="M310 138 346 102" />
        <path d="M346 102 382 102" />
        <path d="M220 176V128" />
        <path d="M220 148 184 112" />
        <path d="M184 112 140 112" />
        <path d="M260 260 306 306" />
        <path d="M306 306 358 306" />
      </g>
      <g class="tree-lines tree-lines--secondary">
        <circle cx="260" cy="216" r="3" />
        <circle cx="310" cy="166" r="3" />
        <circle cx="346" cy="102" r="2.4" />
        <circle cx="382" cy="102" r="2" />
        <circle cx="220" cy="176" r="3" />
        <circle cx="140" cy="112" r="2" />
        <circle cx="306" cy="306" r="2.4" />
        <circle cx="358" cy="306" r="2" />
      </g>
    </svg>
    <div class="frontpage-brand column items-center">
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-if="state.appConfiguration.showLogo && !isTauriApp"
        class="svg-container frontpage-logo"
        :style="{
          '--icon-primary': $q.dark.isActive ? 'white' : 'var(--q-primary)',
          '--icon-secondary': 'var(--q-secondary)',
          width: '3.5rem',
          height: 'auto',
          display: 'inline-block',
        }"
        v-html="logoSvg"
      />
      <div
        v-else-if="state.appConfiguration.showLogo"
        class="svg-container frontpage-logo"
        :style="{
          '--icon-primary': $q.dark.isActive ? 'white' : 'var(--q-primary)',
          '--icon-secondary': 'var(--q-secondary)',
          width: '3.5rem',
          height: 'auto',
          display: 'inline-block',
        }"
        v-html="logoSvgStatic"
      />
      <h1>Taskyon</h1>
      <p class="frontpage-motto">Research. <span>Design.</span> Reproduce.</p>
    </div>

    <div class="frontpage-hero-input">
      <slot name="hero-input" />
    </div>

    <div class="frontpage-stages row justify-center items-stretch">
      <article
        v-for="stage in stages"
        :key="stage.title"
        :class="[
          'frontpage-stage-card column',
          { 'frontpage-stage-card--active': activeStage === stage.title },
        ]"
      >
        <button
          type="button"
          class="frontpage-stage-button column items-start"
          @click="toggleStage(stage.title)"
        >
          <span class="frontpage-stage-heading row items-center no-wrap">
            <span class="frontpage-stage-kicker">{{ stage.number }}</span>
            <span class="frontpage-stage-title">{{ stage.title }}</span>
          </span>
          <span class="frontpage-stage-summary">{{ stage.summary }}</span>
        </button>
        <p v-if="activeStage === stage.title" class="frontpage-stage-detail">{{ stage.detail }}</p>
      </article>
    </div>

    <div class="frontpage-examples column items-center">
      <div class="frontpage-example-separator row items-center no-wrap">
        <span />
        <p>Start with a guided design question</p>
        <span />
      </div>
      <div class="frontpage-example-buttons row justify-center">
        <q-btn
          v-for="example in examples"
          :key="example.label"
          class="frontpage-example-button"
          no-caps
          unelevated
          :icon="example.icon"
          :label="example.label"
          @click="startExample(example.prompt)"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { isTauri } from '@tauri-apps/api/core'
import {
  matBatteryChargingFull,
  matComputer,
  matRocketLaunch,
  matSatelliteAlt,
  matSmartToy,
} from '@quasar/extras/material-icons'
import { useAppStateStore } from 'src/stores/appState'
import CreateTaskButton from './CreateTaskButton.vue'
import logoSvg from 'src/assets/taskyon_logo_complex_animated.svg?raw'
import logoSvgStatic from 'src/assets/taskyon_logo_complex_static.svg?raw'
import { computed, ref } from 'vue'

const state = useAppStateStore()
const isTauriApp = process.env.CLIENT ? isTauri() : false
const customSuggestions = computed(() => state.appConfiguration.chatSuggestions ?? [])

const stages = [
  {
    number: '1',
    title: 'Research',
    summary: 'Gather evidence and requirements.',
    detail:
      'Start with sources, assumptions, constraints, and open questions for one concrete design problem.',
  },
  {
    number: '2',
    title: 'Design',
    summary: 'Structure one credible solution.',
    detail:
      'Turn research into components, decisions, validation steps, and a visible task tree you can inspect.',
  },
  {
    number: '3',
    title: 'Reproduce',
    summary: 'Replay and compare later runs.',
    detail:
      'Make successful work reusable by identifying parameters, replayable steps, evidence, and outputs.',
  },
] as const

const examples = [
  {
    label: 'Local AI workstation',
    icon: matComputer,
    prompt:
      'I want to design a local AI workstation. Please start by asking me the most important questions about my budget, target models, power limits, noise constraints, and what I want to run locally.',
  },
  {
    label: 'Mission drone',
    icon: matRocketLaunch,
    prompt:
      'I want to design a mission drone. Please start by asking me the key questions about payload, flight time, range, environment, safety margins, and budget before proposing any components.',
  },
  {
    label: 'Home battery system',
    icon: matBatteryChargingFull,
    prompt:
      'I want to plan a home battery or small energy system. Please start by asking me about my electricity usage, tariffs, solar, EV charging, backup needs, budget, and optimization goals.',
  },
  {
    label: 'Satellite',
    icon: matSatelliteAlt,
    prompt:
      'I want to design a satellite. Please start by asking me about the mission objective, target orbit, payload, mass and power budget, communications link, lifetime, launch vehicle constraints, and overall budget before proposing any subsystems.',
  },
  {
    label: 'Autonomous Mars rover',
    icon: matSmartToy,
    prompt:
      'I want to design an autonomous Mars rover. Please start by asking me about the science goals, landing site and terrain, mission duration, mobility and autonomy requirements, instruments, power source, thermal and dust constraints, communications, and mass and budget limits before proposing any subsystems.',
  },
] as const

const activeStage = ref<(typeof stages)[number]['title'] | null>(null)

function toggleStage(stage: (typeof stages)[number]['title']) {
  activeStage.value = activeStage.value === stage ? null : stage
}

function startExample(prompt: string) {
  state.messageDraft = prompt
}
</script>

<style scoped>
.context-welcome {
  width: min(100%, 44rem);
  min-width: 0;
  gap: 1rem;
  padding: 1rem;
}

.context-welcome-message {
  max-width: 36rem;
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
}

.context-welcome-input,
.context-welcome-suggestions {
  width: 100%;
  min-width: 0;
}

.context-welcome-suggestions {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.context-welcome-suggestion {
  max-width: 18rem;
}

.frontpage-hero {
  position: relative;
  width: min(100%, 64rem);
  min-width: 0;
  min-height: 0;
  padding: clamp(0.5rem, 1.8vh, 1.2rem) clamp(0.6rem, 2vw, 1.75rem);
  isolation: isolate;
}

.frontpage-brand {
  gap: 0.2rem;
  margin-bottom: clamp(0.6rem, 1.6vh, 1.1rem);
}

.frontpage-hero-input {
  width: min(100%, 44rem);
  min-width: 0;
}

.frontpage-brand h1 {
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 3.9rem);
  font-weight: 400;
  letter-spacing: 0.04em;
  line-height: 0.95;
}

.frontpage-motto {
  margin: 0;
  font-size: clamp(0.95rem, 1.8vw, 1.18rem);
  letter-spacing: 0.03em;
}

.frontpage-stages {
  position: relative;
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  gap: clamp(0.45rem, 1.2vw, 0.9rem);
  margin-top: clamp(0.75rem, 1.8vh, 1.15rem);
}

.frontpage-stage-card {
  flex: 1 1 10.5rem;
  min-width: 0;
  max-width: 13.5rem;
  min-height: 4.05rem;
  border-radius: 0.75rem;
  overflow: visible;
}

.frontpage-stage-button {
  width: 100%;
  min-height: 4.05rem;
  padding: 0.55rem 0.68rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.frontpage-stage-heading {
  gap: 0.38rem;
  min-width: 0;
  margin-bottom: 0.2rem;
}

.frontpage-stage-kicker {
  display: grid;
  width: 1.25rem;
  height: 1.25rem;
  flex: 0 0 1.25rem;
  place-items: center;
  border-radius: 50%;
  font-size: 0.68rem;
  font-weight: 700;
}

.frontpage-stage-title {
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 700;
}

.frontpage-stage-summary,
.frontpage-stage-detail {
  font-size: 0.78rem;
  line-height: 1.32;
}

.frontpage-stage-detail {
  margin: -0.2rem 0.72rem 0.7rem;
  padding-top: 0.52rem;
}

.frontpage-examples {
  width: 100%;
  min-width: 0;
  margin-top: clamp(0.75rem, 1.8vh, 1.15rem);
  gap: 0.45rem;
}

.frontpage-example-separator {
  width: min(100%, 22rem);
  min-width: 0;
  gap: 0.65rem;
  font-size: 0.78rem;
}

.frontpage-example-separator p {
  margin: 0;
  white-space: nowrap;
}

.frontpage-example-separator span {
  height: 1px;
  flex: 1;
  min-width: 0;
}

.frontpage-example-buttons {
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  gap: 0.45rem 0.65rem;
}

.frontpage-example-button {
  flex: 1 1 9.5rem;
  min-width: 0;
  max-width: 12.5rem;
  min-height: 2.15rem;
  border-radius: 0.65rem;
  font-size: 0.78rem;
}

.frontpage-tree {
  position: absolute;
  pointer-events: none;
  z-index: -1;
  overflow: visible;
}

.frontpage-tree--left {
  left: min(-8vw, -2rem);
  top: 1rem;
  width: clamp(11rem, 22vw, 21rem);
}

.frontpage-tree--right {
  right: min(-9vw, -2rem);
  bottom: 0;
  width: clamp(12rem, 26vw, 28rem);
}

/* --- base layout --- */
.welcome-message-text {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.svg-container,
.task-button {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

/* smooth fade before hiding */
@media (max-height: 630px) {
  .task-button {
    opacity: 0;
    transform: scale(0.9);
  }
}

@media (max-width: 760px) {
  .frontpage-hero {
    padding: 0.6rem 0.7rem;
  }

  .frontpage-stages {
    gap: 0.6rem;
    margin-top: 1.2rem;
  }

  .frontpage-stages::before {
    display: none;
  }

  .frontpage-stage-card {
    flex: 1 1 100%;
    max-width: 100%;
  }

  .frontpage-tree--left {
    left: -8rem;
    top: 2rem;
  }

  .frontpage-tree--right {
    display: none;
  }
}

/* compact mobile: keep the hero input central and visible */
@media (max-width: 560px) {
  .frontpage-hero {
    padding: 0.4rem 0.6rem;
    justify-content: center;
  }

  .frontpage-brand {
    gap: 0.1rem;
    margin-bottom: 0.5rem;
  }

  .frontpage-brand h1 {
    font-size: clamp(1.8rem, 9vw, 2.6rem);
  }

  /* keep hints visible but very subtle and compact */
  .frontpage-stages {
    margin-top: 0.75rem;
    gap: 0.35rem;
    opacity: 0.7;
  }

  .frontpage-stage-card {
    flex: 1 1 0;
    min-height: 0;
  }

  .frontpage-stage-button {
    min-height: 0;
    padding: 0.5rem 0.6rem;
  }

  .frontpage-stage-kicker {
    display: none;
  }

  .frontpage-stage-summary,
  .frontpage-stage-detail {
    display: none;
  }

  .frontpage-stage-title {
    font-size: 0.82rem;
    text-align: center;
    width: 100%;
  }

  .frontpage-examples {
    margin-top: 0.55rem;
    gap: 0.4rem;
  }

  .frontpage-example-separator {
    display: none;
  }

  .frontpage-example-button {
    flex: 1 1 100%;
    max-width: 100%;
    min-height: 2.2rem;
    font-size: 0.82rem;
  }
}

/* fully remove from layout */
@media (max-height: 610px) {
  .task-button {
    display: none !important;
  }
}

/* fade + collapse logo */
@media (max-height: 470px) {
  .svg-container {
    opacity: 0;
    transform: scale(0.9);
  }
}
@media (max-height: 450px) {
  .svg-container {
    display: none !important;
  }
}
</style>
