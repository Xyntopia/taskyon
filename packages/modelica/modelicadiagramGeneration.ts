import type { Thunk } from '@taskyon/common/modules/tsHelpers'
import { buildTypeLookupCandidates, extractImportAliases } from './qualifiedNameResolution'
import {
  readClassMetadata,
  readSourceMetadata,
  unwrapMetadata,
  type ClassMetadata,
  type MetadataExpression,
} from './modelicaClassMetadata'

type SourceRootMaterializer = (qualifiedName: string) => boolean
export type DiagramResolutionCaches = {
  icons: Map<string, DiagramIconSpec | null>
  ports: Map<string, DiagramPort[] | null>
}
export const createDiagramResolutionCaches = (): DiagramResolutionCaches => ({
  icons: new Map(),
  ports: new Map(),
})

type DiagramPlacement = {
  origin?: [number, number]
  extent?: [[number, number], [number, number]]
  rotation?: number
}

type DiagramColor = [number, number, number]

type DiagramIconGraphic =
  | {
      kind: 'Rectangle'
      extent: [[number, number], [number, number]]
      visible?: boolean
      origin?: [number, number]
      rotation?: number
      lineThickness?: number
      lineColor?: DiagramColor
      fillColor?: DiagramColor
      fillPattern?: string
    }
  | {
      kind: 'Ellipse'
      extent: [[number, number], [number, number]]
      visible?: boolean
      origin?: [number, number]
      rotation?: number
      lineThickness?: number
      lineColor?: DiagramColor
      fillColor?: DiagramColor
      fillPattern?: string
    }
  | {
      kind: 'Line'
      points: Array<[number, number]>
      visible?: boolean
      origin?: [number, number]
      rotation?: number
      lineThickness?: number
      color?: DiagramColor
    }
  | {
      kind: 'Polygon'
      points: Array<[number, number]>
      visible?: boolean
      origin?: [number, number]
      rotation?: number
      lineThickness?: number
      lineColor?: DiagramColor
      fillColor?: DiagramColor
      fillPattern?: string
    }
  | {
      kind: 'Text'
      extent?: [[number, number], [number, number]]
      textString: string
      visible?: boolean
      origin?: [number, number]
      rotation?: number
      textColor?: DiagramColor
    }

type DiagramIconSpec = {
  coordinateExtent?: [[number, number], [number, number]]
  graphics: DiagramIconGraphic[]
}

type DiagramComponent = {
  id: string
  name: string
  typeName: string
  description?: string
  qualifiedTypeName?: string
  iconValues?: Record<string, string>
  placement?: DiagramPlacement
  iconRef?: string
  icon?: DiagramIconSpec
  ports?: DiagramPort[]
}

type DiagramPort = {
  name: string
  typeName: string
  placement?: DiagramPlacement
  icon?: DiagramIconSpec
}

type DiagramConnection = {
  id: string
  from: string
  to: string
  fromPort?: string
  toPort?: string
  linePoints?: Array<{ x: number; y: number }>
  lineColor?: DiagramColor
}

type DiagramDto = {
  className: string
  classIcon?: DiagramIconSpec
  components: DiagramComponent[]
  connections: DiagramConnection[]
}

const findArrayElements = (value?: MetadataExpression): MetadataExpression[] => {
  if (!value) return []
  const node = unwrapMetadata(value)
  return node.kind === 'array' || node.kind === 'tuple' ? node.elements : []
}

const asNumber = (value?: MetadataExpression): number | null => {
  if (!value) return null
  const node = unwrapMetadata(value)
  if (node.kind === 'literal' && ['integer', 'real'].includes(node.literal_type)) {
    const result = Number(node.text)
    return Number.isFinite(result) ? result : null
  }
  if (node.kind === 'unary') {
    const result = asNumber(node.value)
    return result == null ? null : node.operator.trim() === '-' ? -result : result
  }
  return null
}

const asBoolean = (value?: MetadataExpression): boolean | null => {
  if (!value) return null
  const node = unwrapMetadata(value)
  return node.kind === 'literal' && node.literal_type === 'boolean' ? node.text === 'true' : null
}

const asPair = (value?: MetadataExpression): [number, number] | null => {
  const elements = findArrayElements(value)
  if (elements.length !== 2) return null
  const a = asNumber(elements[0]),
    b = asNumber(elements[1])
  return a == null || b == null ? null : [a, b]
}
const asExtent = (value?: MetadataExpression): [[number, number], [number, number]] | undefined => {
  const elements = findArrayElements(value)
  const a = asPair(elements[0]),
    b = asPair(elements[1])
  return elements.length === 2 && a && b ? [a, b] : undefined
}
const asColor = (value?: MetadataExpression): DiagramColor | undefined => {
  const elements = findArrayElements(value)
  const a = asNumber(elements[0]),
    b = asNumber(elements[1]),
    c = asNumber(elements[2])
  return elements.length === 3 && a != null && b != null && c != null
    ? [Math.round(a), Math.round(b), Math.round(c)]
    : undefined
}
const asPoints = (value?: MetadataExpression): Array<[number, number]> | undefined => {
  const points = findArrayElements(value)
    .map(asPair)
    .filter((v): v is [number, number] => v != null)
  return points.length ? points : undefined
}
const asStringLiteral = (value?: MetadataExpression): string | undefined => {
  if (!value) return undefined
  const node = unwrapMetadata(value)
  return node.kind === 'literal' && node.literal_type === 'string' ? node.text : undefined
}
const asEnumName = (value?: MetadataExpression): string | undefined => {
  if (!value) return undefined
  const node = unwrapMetadata(value)
  return node.kind === 'reference' ? node.name : node.kind === 'literal' ? node.text : undefined
}
const namedArgsMap = (values: MetadataExpression[]): Record<string, MetadataExpression> =>
  Object.fromEntries(
    values.flatMap((value) => {
      const node = unwrapMetadata(value)
      return node.kind === 'entry' && node.value ? [[node.name, node.value]] : []
    }),
  )

const findFunctionCallByName = (value: MetadataExpression, name?: string) => {
  const node = unwrapMetadata(value)
  return node.kind === 'call' && (!name || node.name === name) ? node : null
}
const findNamedModification = (values: MetadataExpression[], name: string) => {
  for (const value of values) {
    const node = unwrapMetadata(value)
    if ((node.kind === 'entry' || node.kind === 'call') && node.name === name) {
      return { modifications: node.arguments, value: node.kind === 'entry' ? node.value : null }
    }
  }
  return null
}

const expressionToDisplayText = (value: MetadataExpression): string => {
  const node = unwrapMetadata(value)
  switch (node.kind) {
    case 'literal':
      return node.text
    case 'reference':
      return node.name
    case 'unary':
      return `${node.operator.trim()}${expressionToDisplayText(node.value)}`
    case 'binary':
      return `${expressionToDisplayText(node.left)} ${node.operator} ${expressionToDisplayText(node.right)}`
    case 'call':
      return `${node.name}(${node.arguments.map(expressionToDisplayText).join(', ')})`
    case 'entry':
      return node.value
        ? `${node.name}=${expressionToDisplayText(node.value)}`
        : `${node.name}(${node.arguments.map(expressionToDisplayText).join(', ')})`
    default:
      return ''
  }
}

const extractPlacement = (
  annotation: MetadataExpression[],
  options?: { preferIconTransformation?: boolean },
): DiagramPlacement | undefined => {
  const mods = findNamedModification(annotation, 'Placement')?.modifications
  if (!mods) return undefined
  const names = options?.preferIconTransformation
    ? ['iconTransformation', 'transformation']
    : ['transformation', 'iconTransformation']
  const transform = names
    .map((name) => findNamedModification(mods, name)?.modifications)
    .find((value) => value != null)
  if (!transform) return undefined
  const origin = asPair(findNamedModification(transform, 'origin')?.value ?? undefined)
  const extent = asExtent(findNamedModification(transform, 'extent')?.value ?? undefined)
  const rotation = asNumber(findNamedModification(transform, 'rotation')?.value ?? undefined)
  if (!origin && !extent && rotation == null) return undefined
  return {
    ...(origin ? { origin } : {}),
    ...(extent ? { extent } : {}),
    ...(rotation != null ? { rotation } : {}),
  }
}

const parseIconGraphic = (value: MetadataExpression): DiagramIconGraphic | null => {
  const call = findFunctionCallByName(value)
  if (!call) return null
  const name = call.name
  const args = namedArgsMap(call.arguments)
  const commonGraphicFields: {
    visible?: boolean
    origin?: [number, number]
    rotation?: number
    lineThickness?: number
  } = {}
  const visible = asBoolean(args.visible)
  const origin = asPair(args.origin)
  const rotation = asNumber(args.rotation)
  const lineThickness = asNumber(args.lineThickness)
  if (visible != null) commonGraphicFields.visible = visible
  if (origin) commonGraphicFields.origin = origin
  if (rotation != null) commonGraphicFields.rotation = rotation
  if (lineThickness != null) commonGraphicFields.lineThickness = lineThickness
  if (name === 'Rectangle') {
    const extent = asExtent(args.extent)
    if (!extent) return null
    const out: Extract<DiagramIconGraphic, { kind: 'Rectangle' }> = {
      kind: 'Rectangle',
      extent,
    }
    const lineColor = asColor(args.lineColor)
    const fillColor = asColor(args.fillColor)
    const fillPattern = asEnumName(args.fillPattern)
    if (lineColor) out.lineColor = lineColor
    if (fillColor) out.fillColor = fillColor
    if (fillPattern) out.fillPattern = fillPattern
    return { ...out, ...commonGraphicFields }
  }
  if (name === 'Ellipse') {
    const extent = asExtent(args.extent)
    if (!extent) return null
    const out: Extract<DiagramIconGraphic, { kind: 'Ellipse' }> = {
      kind: 'Ellipse',
      extent,
    }
    const lineColor = asColor(args.lineColor)
    const fillColor = asColor(args.fillColor)
    const fillPattern = asEnumName(args.fillPattern)
    if (lineColor) out.lineColor = lineColor
    if (fillColor) out.fillColor = fillColor
    if (fillPattern) out.fillPattern = fillPattern
    return { ...out, ...commonGraphicFields }
  }
  if (name === 'Line') {
    const points = asPoints(args.points)
    if (!points) return null
    const out: Extract<DiagramIconGraphic, { kind: 'Line' }> = { kind: 'Line', points }
    const color = asColor(args.color ?? args.lineColor)
    if (color) out.color = color
    return { ...out, ...commonGraphicFields }
  }
  if (name === 'Polygon') {
    const points = asPoints(args.points)
    if (!points) return null
    const out: Extract<DiagramIconGraphic, { kind: 'Polygon' }> = {
      kind: 'Polygon',
      points,
    }
    const lineColor = asColor(args.lineColor ?? args.color)
    const fillColor = asColor(args.fillColor)
    const fillPattern = asEnumName(args.fillPattern)
    if (lineColor) out.lineColor = lineColor
    if (fillColor) out.fillColor = fillColor
    if (fillPattern) out.fillPattern = fillPattern
    return { ...out, ...commonGraphicFields }
  }
  if (name === 'Text') {
    const textString = asStringLiteral(args.textString)
    if (!textString) return null
    const out: Extract<DiagramIconGraphic, { kind: 'Text' }> = {
      kind: 'Text',
      textString,
    }
    const extent = asExtent(args.extent)
    const textColor = asColor(args.textColor ?? args.lineColor ?? args.color)
    if (extent) out.extent = extent
    if (textColor) out.textColor = textColor
    return { ...out, ...commonGraphicFields }
  }
  return null
}

const extractIconFromClass = (value: ClassMetadata): DiagramIconSpec | undefined => {
  const mods = findNamedModification(value.annotation, 'Icon')?.modifications
  if (!mods) return undefined
  const coordinates = findNamedModification(mods, 'coordinateSystem')?.modifications
  const coordinateExtent = coordinates
    ? asExtent(findNamedModification(coordinates, 'extent')?.value ?? undefined)
    : undefined
  const graphics = findArrayElements(findNamedModification(mods, 'graphics')?.value ?? undefined)
    .map(parseIconGraphic)
    .filter((v): v is DiagramIconGraphic => v != null)
  return graphics.length || coordinateExtent
    ? { graphics, ...(coordinateExtent ? { coordinateExtent } : {}) }
    : undefined
}

const mergeIcons = (a?: DiagramIconSpec, b?: DiagramIconSpec): DiagramIconSpec | undefined => {
  if (!a) return b
  if (!b) return a
  const coordinateExtent = b.coordinateExtent ?? a.coordinateExtent
  return {
    ...(coordinateExtent ? { coordinateExtent } : {}),
    graphics: [...a.graphics, ...b.graphics],
  }
}

function createDiagramResolver(
  classes: Record<string, ClassMetadata>,
  materialize: SourceRootMaterializer,
  caches: DiagramResolutionCaches,
  aliases: ReturnType<typeof extractImportAliases>,
) {
  const local = new Map<string, ClassMetadata>()
  const addClasses = (values: Record<string, ClassMetadata>) => {
    for (const value of Object.values(values)) {
      local.set(value.qualified_name, value)
      addClasses(value.classes)
    }
  }
  addClasses(classes)
  const resolveClass = (name: string, context?: string): ClassMetadata | undefined => {
    for (const candidate of buildTypeLookupCandidates(name, context, aliases)) {
      const value = local.get(candidate)
      if (value) return value
      if (!materialize(candidate)) continue
      try {
        const loaded = readClassMetadata(candidate)
        local.set(candidate, loaded)
        return loaded
      } catch {
        /* Try the next qualified candidate. */
      }
    }
    return undefined
  }
  const icon = (
    name: string,
    context?: string,
    visiting = new Set<string>(),
  ): DiagramIconSpec | undefined => {
    const value = resolveClass(name, context)
    if (!value || visiting.has(value.qualified_name)) return undefined
    const key = value.qualified_name
    if (caches.icons.has(key)) return caches.icons.get(key) ?? undefined
    visiting.add(key)
    const inherited = value.extends.reduce<DiagramIconSpec | undefined>(
      (result, base) => mergeIcons(result, icon(base.base_name, key, visiting)),
      undefined,
    )
    const result = mergeIcons(inherited, extractIconFromClass(value))
    visiting.delete(key)
    caches.icons.set(key, result ?? null)
    return result
  }
  const ports = (name: string, context?: string, visiting = new Set<string>()): DiagramPort[] => {
    const value = resolveClass(name, context)
    if (!value || visiting.has(value.qualified_name)) return []
    const key = value.qualified_name
    if (caches.ports.has(key)) return caches.ports.get(key) ?? []
    visiting.add(key)
    const inherited = value.extends.flatMap((base) => ports(base.base_name, key, visiting))
    const own = Object.values(value.components).flatMap((component): DiagramPort[] => {
      if (resolveClass(component.type_name, key)?.class_type !== 'connector') return []
      const placement = extractPlacement(component.annotation, { preferIconTransformation: true })
      const portIcon = icon(component.type_name, key)
      return [
        {
          name: component.name,
          typeName: component.type_name,
          ...(placement ? { placement } : {}),
          ...(portIcon ? { icon: portIcon } : {}),
        },
      ]
    })
    visiting.delete(key)
    const result = Array.from(
      new Map([...inherited, ...own].map((port) => [port.name, port])).values(),
    )
    caches.ports.set(key, result)
    return result
  }
  return { resolveClass, icon, ports }
}

const sourceRootPathsForQualifiedName = (qualifiedName: string): string[] => {
  const parts = qualifiedName
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return []

  const paths = [`${parts.join('/')}.mo`]
  for (let count = parts.length - 1; count > 0; count -= 1) {
    const prefix = parts.slice(0, count).join('/')
    paths.push(`${prefix}.mo`, `${prefix}/package.mo`)
  }
  return Array.from(new Set(paths))
}

const loadedSourceRootByPath = (
  loadedSourceRootFiles: Record<string, string>,
  path: string,
): { filePath: string; source: string } | null => {
  const direct = loadedSourceRootFiles[path]
  if (typeof direct === 'string') return { filePath: path, source: direct }

  const suffix = `/${path}`
  const match = Object.entries(loadedSourceRootFiles).find(([filePath]) =>
    filePath.endsWith(suffix),
  )
  return match ? { filePath: match[0], source: match[1] } : null
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const extractClassSourceFromFile = (fileSource: string, className: string): string | null => {
  const escapedName = escapeRegExp(className)
  const declaration = new RegExp(
    `(?:^|\\n)\\s*(?:(?:encapsulated|partial|expandable|pure|impure|operator)\\s+)*(?:model|block|record|type|package|connector|function|class)\\s+${escapedName}\\b`,
    'm',
  )
  const startMatch = declaration.exec(fileSource)
  if (!startMatch) return null

  const startIndex = startMatch.index + (startMatch[0].startsWith('\n') ? 1 : 0)
  const endPattern = new RegExp(`(?:^|\\n)\\s*end\\s+${escapedName}\\s*;`, 'm')
  const endMatch = endPattern.exec(fileSource.slice(startIndex))
  if (!endMatch) return null

  const endIndex = startIndex + endMatch.index + endMatch[0].length
  return fileSource.slice(startIndex, endIndex).trim()
}

export const findOriginalModelicaClassSource = (
  qualifiedName: string,
  loadedSourceRootFiles: Thunk<Record<string, string>>,
): { fileName: string; source: string } | null => {
  const files = loadedSourceRootFiles()
  const name = qualifiedName.split('.').at(-1)
  if (!name) return null
  for (const path of sourceRootPathsForQualifiedName(qualifiedName)) {
    const file = loadedSourceRootByPath(files, path)
    if (!file) continue
    const source = extractClassSourceFromFile(file.source, name)
    if (source) return { fileName: file.filePath, source }
  }
  return null
}

export function handleExtractDiagram(
  payload: { source: string; qualifiedName?: string; fileName?: string },
  materializeSourceRoot: SourceRootMaterializer,
  caches: DiagramResolutionCaches,
): DiagramDto {
  if (!payload.source.trim()) throw new Error('Cannot build diagram: source is empty')
  const document = readSourceMetadata(payload.source, payload.fileName ?? 'Model.mo')
  const resolver = createDiagramResolver(
    document.classes,
    materializeSourceRoot,
    caches,
    extractImportAliases(payload.source),
  )
  const root = payload.qualifiedName
    ? resolver.resolveClass(payload.qualifiedName)
    : Object.values(document.classes)[0]
  if (!root) throw new Error('Cannot build diagram: no class found in source')
  const nodeId = (endpoint: string) => endpoint.split('.')[0] ?? ''
  const connected = new Set(root.connections.flatMap((v) => [nodeId(v.lhs), nodeId(v.rhs)]))
  const components = Object.values(root.components).flatMap((component): DiagramComponent[] => {
    const placement = extractPlacement(component.annotation)
    if (
      !placement &&
      (!connected.has(component.name) || ['parameter', 'constant'].includes(component.variability))
    )
      return []
    const values: Record<string, string> = {}
    for (const modifier of component.modifiers) {
      const node = unwrapMetadata(modifier)
      if (node.kind === 'entry' && node.value)
        values[node.name] = expressionToDisplayText(node.value)
    }
    const qualifiedTypeName = resolver.resolveClass(
      component.type_name,
      root.qualified_name,
    )?.qualified_name
    const icon = resolver.icon(component.type_name, root.qualified_name)
    return [
      {
        id: component.name,
        name: component.name,
        typeName: component.type_name,
        description: component.description,
        ...(placement ? { placement } : {}),
        iconRef: component.type_name,
        ...(qualifiedTypeName ? { qualifiedTypeName } : {}),
        ...(icon ? { icon } : {}),
        ports: resolver.ports(component.type_name, root.qualified_name),
        iconValues: values,
      },
    ]
  })
  const ids = new Set(components.map((v) => v.id))
  const connections = root.connections.flatMap((connection, index): DiagramConnection[] => {
    const from = nodeId(connection.lhs),
      to = nodeId(connection.rhs)
    if (!ids.has(from) || !ids.has(to)) return []
    const fromPort = connection.lhs.split('.').slice(1).join('.')
    const toPort = connection.rhs.split('.').slice(1).join('.')
    return [
      {
        id: `connect-${index + 1}`,
        from,
        to,
        ...(fromPort ? { fromPort } : {}),
        ...(toPort ? { toPort } : {}),
      },
    ]
  })
  const classIcon = extractIconFromClass(root)
  return {
    className: root.qualified_name || root.name,
    ...(classIcon ? { classIcon } : {}),
    components,
    connections,
  }
}
