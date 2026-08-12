export const browserRecordNamespacePrefixes = [
  'dag/',
  'design-graph/',
  'design-graphs/',
  'design-projects/',
  'documentation/',
  'modelica/',
  'pmtiles/',
  'spaceships/',
  'tool-files/',
] as const

export const isBrowserRecordNamespace = (namespace: string) =>
  browserRecordNamespacePrefixes.some(
    (prefix) => namespace === prefix.slice(0, -1) || namespace.startsWith(prefix),
  )
