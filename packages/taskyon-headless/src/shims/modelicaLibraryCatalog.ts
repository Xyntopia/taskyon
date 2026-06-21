import { computed } from 'vue'

export const DEFAULT_MODELICA_LIBRARY_URL =
  'https://github.com/modelica/ModelicaStandardLibrary/archive/refs/tags/v4.1.0.zip'
export const DEFAULT_MODELICA_LIBRARY_ID = 'ModelicaStandardLibrary-4.1.0'
export const detectedModelicaLibraryPresets = computed(() => [
  {
    id: DEFAULT_MODELICA_LIBRARY_ID,
    label: DEFAULT_MODELICA_LIBRARY_ID,
    menuLabel: `${DEFAULT_MODELICA_LIBRARY_ID} (BSD-3-Clause)`,
    url: DEFAULT_MODELICA_LIBRARY_URL,
    license: 'BSD-3-Clause',
  },
])
export const downloadableModelicaLibraries = computed(() => [
  {
    id: DEFAULT_MODELICA_LIBRARY_ID,
    name: DEFAULT_MODELICA_LIBRARY_ID,
    license: 'BSD-3-Clause',
    description: 'Official Modelica Standard Library (MSL) release archive.',
    link: 'https://github.com/modelica/ModelicaStandardLibrary',
    installUrl: DEFAULT_MODELICA_LIBRARY_URL,
    mirrorUrl: '',
    upstreamUrl: DEFAULT_MODELICA_LIBRARY_URL,
  },
])
export const defaultModelicaLibraryPreset = computed(() => detectedModelicaLibraryPresets.value[0])

export function getDefaultModelicaLibraryUrl(): string {
  return DEFAULT_MODELICA_LIBRARY_URL
}

export function refreshModelicaLibraryManifestFromMirror(): Promise<boolean> {
  return Promise.resolve(false)
}
