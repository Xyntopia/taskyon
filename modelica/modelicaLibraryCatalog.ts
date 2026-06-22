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
}

const libraryZipModules = import.meta.glob('../../../../public/modelica-libraries/*.zip', {
  eager: true,
  import: 'default',
  query: '?url',
})

const rootLibraryZipModules = import.meta.glob('/public/modelica-libraries/*.zip', {
  eager: true,
  import: 'default',
  query: '?url',
})

type ManifestLibraryEntry = {
  name?: unknown
  license?: unknown
  short_description?: unknown
  source_url?: unknown
  download_url?: unknown
}

type ManifestModule = {
  libraries?: ManifestLibraryEntry[]
}

const pathToFileName = (path: string): string => {
  const chunks = String(path || '').split('/')
  return chunks[chunks.length - 1] || ''
}

const removeZipExtension = (fileName: string): string => fileName.replace(/\.zip$/i, '')
const sanitizeId = (value: string): string =>
  String(value || '')
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')

const manifestModules = import.meta.glob('./modelica_libraries.json', {
  eager: true,
  import: 'default',
})

const humanizeLabel = (fileName: string): string => {
  const stem = removeZipExtension(fileName)
  return stem.replaceAll(/[_-]+/g, ' ').trim()
}

const byLabel = (a: ModelicaLibraryPreset, b: ModelicaLibraryPreset): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

const mergedLibraryZipModules = {
  ...libraryZipModules,
  ...rootLibraryZipModules,
} satisfies Record<string, unknown>

const isManifestModule = (value: unknown): value is ManifestModule =>
  typeof value === 'object' && value !== null

const manifestLibraries = Object.values(manifestModules)
  .flatMap((entry) => (isManifestModule(entry) ? entry.libraries ?? [] : []))
  .filter((entry) => typeof entry?.name === 'string')

const licenseById = manifestLibraries.reduce<Record<string, string>>((acc, library) => {
  const key = sanitizeId(String(library?.name || '')).toLowerCase()
  if (!key) return acc
  acc[key] = String(library?.license || 'Unknown').trim() || 'Unknown'
  return acc
}, {})

const formatMenuLabel = (label: string, license: string): string =>
  `${label} (${license && license.length > 0 ? license : 'Unknown'})`

export const detectedModelicaLibraryPresets: ModelicaLibraryPreset[] = Object.entries(
  mergedLibraryZipModules,
)
  .map(([path, url]) => {
    const fileName = pathToFileName(path)
    const id = removeZipExtension(fileName) || fileName
    const license = licenseById[String(id || '').toLowerCase()] || 'Unknown'
    const label = humanizeLabel(fileName)
    return {
      id,
      label,
      menuLabel: formatMenuLabel(label, license),
      url: String(url || ''),
      license,
    }
  })
  .filter((preset) => preset.id.length > 0 && preset.url.length > 0)
  .sort(byLabel)

const presetUrlById = detectedModelicaLibraryPresets.reduce<Record<string, string>>(
  (acc, preset) => {
    const key = String(preset.id || '')
      .trim()
      .toLowerCase()
    if (!key) return acc
    acc[key] = preset.url
    return acc
  },
  {},
)

export const downloadableModelicaLibraries: DownloadableModelicaLibrary[] = manifestLibraries
  .map((library) => {
    const name = String(library?.name || '').trim()
    const id = sanitizeId(name)
    return {
      id,
      name,
      license: String(library?.license || 'Unknown').trim() || 'Unknown',
      description: String(library?.short_description || '').trim(),
      link: String(library?.source_url || library?.download_url || '').trim(),
      installUrl: String(presetUrlById[id.toLowerCase()] || '').trim(),
    }
  })
  .filter((library) => library.id.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

const defaultMslPreset = detectedModelicaLibraryPresets.find((preset) =>
  preset.id.startsWith('ModelicaStandardLibrary-'),
)

export const DEFAULT_MODELICA_LIBRARY_URL =
  defaultMslPreset?.url || '/modelica-libraries/ModelicaStandardLibrary-4.1.0.zip'
export const DEFAULT_MODELICA_LIBRARY_ID = defaultMslPreset?.id || 'ModelicaStandardLibrary-4.1.0'

console.info('[modelica-library-catalog] relative glob matches:', Object.keys(libraryZipModules))
console.info('[modelica-library-catalog] root glob matches:', Object.keys(rootLibraryZipModules))
console.info(
  '[modelica-library-catalog] detected presets:',
  detectedModelicaLibraryPresets.map((preset) => ({
    id: preset.id,
    label: preset.label,
    url: preset.url,
  })),
)
