<!-- CodeEditor.vue-->
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
import type { LanguageSupport, StreamParser } from '@codemirror/language'
import { StreamLanguage } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { Codemirror } from 'vue-codemirror'

const content = defineModel<string>({
  required: true,
  default: '',
})

const props = defineProps<{ language?: string }>()

const $q = useQuasar()
const langExtension = ref<Extension | null>()
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
  const entry = Object.entries(legacyModesMap).find(
    ([path]) => path.endsWith(`/${lang}.js`), // note the slash for safety
  )
  if (!entry) return null

  const mod = await entry[1]()

  // Try to get the named export that matches the filename
  const parser: StreamParser<unknown> | undefined = mod[lang] ?? mod.default

  if (!parser) {
    console.warn(`Legacy mode module for '${lang}' has no export '${lang}' or default export`)
    return null
  }

  return StreamLanguage.define(parser)
}

// ---------------------------
// 2️⃣ Load CM6 modern language
// ---------------------------
const modernLanguageLoaders: Record<string, () => Promise<LanguageSupport>> = {
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  // Assumes @codemirror/lang-jinja exports a `jinja()` function
  jinja: async () => (await import('@codemirror/lang-jinja')).jinja(),
}

async function loadModernLanguage(lang: string) {
  const loader = modernLanguageLoaders[lang]
  if (!loader) return null

  try {
    return await loader()
  } catch (error) {
    console.warn(`No CodeMirror modern language found for '${lang}':`, error)
    return null
  }
}

// ---------------------------
// 3️⃣ Safety check for dynamically loaded extensions
// ---------------------------
function isSafeExtension(ext: Extension | null | undefined): ext is Extension {
  if (!ext) return false
  try {
    // Try to construct a temporary EditorState; if this fails,
    // the extension is likely from a different @codemirror/state instance.
    EditorState.create({
      doc: '',
      extensions: [ext],
    })
    return true
  } catch (e) {
    console.warn('[CodeEditor] Ignoring incompatible CodeMirror extension from CDN:', e)
    return false
  }
}

// ---------------------------
// 4️⃣ Runtime loader with fallback
// ---------------------------
async function loadLanguage(lang: string) {
  // 1. Try modern CM6
  let ext: LanguageSupport | StreamLanguage<unknown> | null = await loadModernLanguage(lang)
  if (ext) return ext

  // 2. Try legacy modes
  ext = await loadLegacyMode(lang)
  if (ext) return ext

  // 3. Optional: external URL fallback (CDN)
  try {
    const url = `https://unpkg.com/@codemirror/lang-${lang}?module`
    const mod = await import(/* @vite-ignore */ url)
    const candidate = typeof mod[lang] === 'function' ? mod[lang]() : null

    if (isSafeExtension(candidate)) {
      return candidate
    }

    console.warn(
      `[CodeMirror] CDN language '${lang}' is incompatible with local CodeMirror, falling back to plaintext`,
    )
    return null
  } catch (err) {
    console.warn(
      `No CodeMirror language found for '${lang}' via CDN, using plaintext fallback`,
      err,
    )
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
