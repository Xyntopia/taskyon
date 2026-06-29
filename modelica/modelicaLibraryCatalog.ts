import { computed, ref } from 'vue'

type ModelicaLibraryPreset = {
  id: string
  label: string
  menuLabel: string
  url: string
  license: string
}
type DownloadableModelicaLibrary = {
  id: string
  name: string
  license: string
  description: string
  link: string
  installUrl: string
  mirrorUrl: string
  upstreamUrl: string
}
type ModelicaLibraryManifestEntry = {
  id?: string
  name?: string
  file_name?: string
  license?: string
  short_description?: string
  source_url?: string
  download_url?: string
  mirror_url?: string
  mirror?: boolean
}
type ModelicaLibraryManifest = {
  mirror_manifest_url?: string
  libraries?: ModelicaLibraryManifestEntry[]
}

type ModelicaLibraryManifestJson = {
  mirror_manifest_url?: unknown
  libraries?: unknown
}

const removeZipExtension = (fileName: string): string => fileName.replace(/\.zip$/i, '')
const sanitizeId = (value: string): string =>
  String(value || '')
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
const fileNameFromLibraryName = (name: string): string => `${sanitizeId(name)}.zip`
const resolveLibraryId = (library: ModelicaLibraryManifestEntry): string =>
  String(library?.id || sanitizeId(String(library?.name || ''))).trim()
const resolveLibraryFileName = (library: ModelicaLibraryManifestEntry): string =>
  String(library?.file_name || `${resolveLibraryId(library)}.zip`).trim()
const resolveLibraryUrl = (library: ModelicaLibraryManifestEntry): string =>
  String(library?.mirror_url || library?.download_url || '').trim()
const readOptionalString = (source: Record<string, unknown>, key: string): string | undefined => {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}
const withOptionalString = (
  target: ModelicaLibraryManifestEntry,
  source: Record<string, unknown>,
  key: keyof ModelicaLibraryManifestEntry,
): ModelicaLibraryManifestEntry => {
  const value = readOptionalString(source, key)
  return value === undefined ? target : { ...target, [key]: value }
}

const parseManifestEntry = (raw: unknown): ModelicaLibraryManifestEntry | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const entry = [
    'id',
    'name',
    'file_name',
    'license',
    'short_description',
    'source_url',
    'download_url',
    'mirror_url',
  ].reduce<ModelicaLibraryManifestEntry>(
    (acc, key) => withOptionalString(acc, source, key as keyof ModelicaLibraryManifestEntry),
    {},
  )
  return source.mirror === true ? { ...entry, mirror: true } : entry
}

const parseModelicaLibraryManifest = (raw: unknown): ModelicaLibraryManifest => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Remote Modelica library manifest is not an object')
  }
  const source = raw as ModelicaLibraryManifestJson
  if (!Array.isArray(source.libraries)) {
    throw new Error('Remote Modelica library manifest does not contain a libraries array')
  }
  const libraries = source.libraries.map(parseManifestEntry).filter((entry) => entry !== null)
  if (typeof source.mirror_manifest_url !== 'string') return { libraries }
  return { mirror_manifest_url: source.mirror_manifest_url, libraries }
}

const manifestModules = import.meta.glob<ModelicaLibraryManifest>('./modelica_libraries.json', {
  eager: true,
  import: 'default',
})
const bundledManifest = Object.values(manifestModules)[0] ?? { libraries: [] }
const activeManifest = ref<ModelicaLibraryManifest>(bundledManifest)
const manifestLibraries = computed(() =>
  (activeManifest.value.libraries ?? []).filter((entry) => typeof entry?.name === 'string'),
)

const humanizeLabel = (fileName: string): string => {
  const stem = removeZipExtension(fileName)
  return stem.replaceAll(/[_-]+/g, ' ').trim()
}

const byLabel = (a: ModelicaLibraryPreset, b: ModelicaLibraryPreset): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

const formatMenuLabel = (label: string, license: string): string =>
  `${label} (${license && license.length > 0 ? license : 'Unknown'})`

export const detectedModelicaLibraryPresets = computed<ModelicaLibraryPreset[]>(() =>
  manifestLibraries.value
    .map((library) => {
      const name = String(library?.name || '').trim()
      const fileName = resolveLibraryFileName(library) || fileNameFromLibraryName(name)
      const id = resolveLibraryId(library) || removeZipExtension(fileName) || fileName
      const license = String(library?.license || 'Unknown').trim() || 'Unknown'
      const label = humanizeLabel(fileName)
      return {
        id,
        label,
        menuLabel: formatMenuLabel(label, license),
        url: resolveLibraryUrl(library),
        license,
      }
    })
    .filter((preset) => preset.id.length > 0 && preset.url.length > 0)
    .sort(byLabel),
)

const presetUrlById = computed(() =>
  detectedModelicaLibraryPresets.value.reduce<Record<string, string>>((acc, preset) => {
    const key = String(preset.id || '')
      .trim()
      .toLowerCase()
    if (!key) return acc
    acc[key] = preset.url
    return acc
  }, {}),
)

export const downloadableModelicaLibraries = computed<DownloadableModelicaLibrary[]>(() =>
  manifestLibraries.value
    .map((library) => {
      const name = String(library?.name || '').trim()
      const id = resolveLibraryId(library)
      const mirrorUrl = String(library?.mirror_url || '').trim()
      const upstreamUrl = String(library?.download_url || '').trim()
      return {
        id,
        name,
        license: String(library?.license || 'Unknown').trim() || 'Unknown',
        description: String(library?.short_description || '').trim(),
        link: String(library?.source_url || library?.download_url || '').trim(),
        installUrl: String(
          presetUrlById.value[id.toLowerCase()] || resolveLibraryUrl(library),
        ).trim(),
        mirrorUrl,
        upstreamUrl,
      }
    })
    .filter((library) => library.id.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
)

export const defaultModelicaLibraryPreset = computed(() =>
  detectedModelicaLibraryPresets.value.find((preset) =>
    preset.id.startsWith('ModelicaStandardLibrary-'),
  ),
)

export const DEFAULT_MODELICA_LIBRARY_URL = defaultModelicaLibraryPreset.value?.url || ''
export const DEFAULT_MODELICA_LIBRARY_ID =
  defaultModelicaLibraryPreset.value?.id || 'ModelicaStandardLibrary-4.1.0'

export function getDefaultModelicaLibraryUrl(): string {
  return defaultModelicaLibraryPreset.value?.url || ''
}

export async function refreshModelicaLibraryManifestFromMirror(): Promise<boolean> {
  const manifestUrl = String(activeManifest.value.mirror_manifest_url || '').trim()
  if (!manifestUrl) return false

  const response = await fetch(manifestUrl, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Failed to refresh Modelica library manifest: HTTP ${response.status}`)
  }
  const nextManifest = parseModelicaLibraryManifest(await response.json())
  activeManifest.value = nextManifest
  return true
}

console.info(
  '[modelica-library-catalog] detected presets:',
  detectedModelicaLibraryPresets.value.map((preset) => ({
    id: preset.id,
    label: preset.label,
    url: preset.url,
  })),
)
