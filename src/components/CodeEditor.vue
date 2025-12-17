<template>
  <codemirror
    :key="languageKey"
    v-model="content"
    placeholder="Code goes here..."
    indent-with-tab
    :line-wrapping="true"
    :tab-size="2"
    :extensions="extensions"
    v-bind="$attrs"
  />
</template>

<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useQuasar } from 'quasar'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import type { LanguageSupport } from '@codemirror/language'
import { StreamLanguage } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Codemirror } from 'vue-codemirror'

const content = defineModel<string>({
  required: true,
  default: '',
})

const props = defineProps<{ language?: string }>()

const $q = useQuasar()
const langExtension = ref<Extension>()
const languageKey = ref('')

// ---------------------------
// 1️⃣ Scan all legacy modes at build time
// ---------------------------
const legacyModesMap = import.meta.glob(
  '/node_modules/@codemirror/legacy-modes/mode/*.js',
) as Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => Promise<any>
>

async function loadLegacyMode(lang: string) {
  const entry = Object.entries(legacyModesMap).find(([path]) => path.endsWith(`${lang}.js`))
  if (!entry) return null
  const mod = await entry[1]()
  return StreamLanguage.define(mod.default ?? mod)
}

// ---------------------------
// 2️⃣ Load CM6 modern language
// ---------------------------
async function loadModernLanguage(lang: string) {
  try {
    switch (lang) {
      case 'javascript':
        return (await import('@codemirror/lang-javascript')).javascript()
      case 'python':
        return (await import('@codemirror/lang-python')).python()
      case 'cpp':
        return (await import('@codemirror/lang-cpp')).cpp()
      case 'json':
        return (await import('@codemirror/lang-json')).json()
      case 'rust':
        return (await import('@codemirror/lang-rust')).rust()
      case 'sql':
        return (await import('@codemirror/lang-sql')).sql()
      case 'jinja':
        return (await import('@codemirror/lang-jinja')).jinja()
      default:
        throw new Error('not found')
    }
  } catch {
    return null
  }
}

// ---------------------------
// 3️⃣ Runtime loader with fallback
// ---------------------------
async function loadLanguage(lang: string) {
  // 1. Try modern CM6
  let ext: LanguageSupport | StreamLanguage<unknown> | null = await loadModernLanguage(lang)
  if (ext) return ext

  // 2. Try legacy modes
  ext = await loadLegacyMode(lang)
  if (ext) return ext

  // 3. Optional: external URL fallback
  try {
    const url = `https://unpkg.com/@codemirror/lang-${lang}?module`
    const mod = await import(/* @vite-ignore */ url)
    return mod[lang]()
  } catch {
    console.warn(`No CodeMirror language found for '${lang}', using plaintext fallback`)
    return null
  }
}

// ---------------------------
// Watch language prop and update
// ---------------------------
watchEffect(
  () =>
    void (async () => {
      if (props.language) {
        langExtension.value = await loadLanguage(props.language)
        languageKey.value = props.language
      }
    })(),
)

// ---------------------------
// Compute extensions
// ---------------------------
const extensions = computed(() => {
  return $q.dark.isActive
    ? [basicSetup, ...(langExtension.value ? [langExtension.value] : []), oneDark]
    : [basicSetup, ...(langExtension.value ? [langExtension.value] : [])]
})
</script>
