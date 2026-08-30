import { secureFetchCacheNamespace } from '@taskyon/taskyon/api'

export const browserRecordNamespacePrefixes = [
  'dag/',
  'design-graph/',
  'design-graphs/',
  'design-projects/',
  'documentation/',
  'modelica/',
  'pmtiles/',
  'ranking/',
  `${secureFetchCacheNamespace}/`,
  'spaceships/',
  'taskyon/local/',
  'taskyon/ui-state/',
  'tool-files/',
  'ui/',
  'workspace-files/',
] as const

export const isBrowserRecordNamespace = (logicalNamespace: string) => {
  return browserRecordNamespacePrefixes.some(
    (prefix) => logicalNamespace === prefix.slice(0, -1) || logicalNamespace.startsWith(prefix),
  )
}
