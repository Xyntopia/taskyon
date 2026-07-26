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
import { ref, shallowRef, computed, watchEffect } from 'vue'
import { useQuasar } from 'quasar'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { StreamLanguage, type LanguageSupport, type StreamParser } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Codemirror } from 'vue-codemirror'

const content = defineModel<string>({
  required: true,
  default: '',
})

const props = withDefaults(
  defineProps<{
    language?: string
    extraExtensions?: Extension[]
    readOnly?: boolean
  }>(),
  {
    language: '',
    extraExtensions: () => [],
    readOnly: false,
  },
)

const $q = useQuasar()
const langExtension = shallowRef<Extension | null>()
const languageKey = ref('')

// ---------------------------
// 1️⃣ Scan all legacy modes at build time
// ---------------------------
const legacyJsModesMap = import.meta.glob(
  '/node_modules/@codemirror/legacy-modes/mode/*.js',
) as Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => Promise<any>
>

const legacyCjsModesMap = import.meta.glob(
  '/node_modules/@codemirror/legacy-modes/mode/*.cjs',
) as Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => Promise<any>
>

const legacyModesMap = {
  ...legacyJsModesMap,
  ...legacyCjsModesMap,
}

async function loadLegacyMode(lang: string) {
  const entry = Object.entries(legacyModesMap).find(
    ([path]) => path.endsWith(`/${lang}.js`) || path.endsWith(`/${lang}.cjs`),
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
  typescript: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
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
  const extras = Array.isArray(props.extraExtensions) ? props.extraExtensions : []
  const editorExtensions = [
    basicSetup,
    EditorState.readOnly.of(props.readOnly),
    EditorView.editable.of(!props.readOnly),
    ...(langExtension.value ? [langExtension.value] : []),
    ...extras,
  ]
  return $q.dark.isActive ? [...editorExtensions, oneDark] : editorExtensions
})
</script>
