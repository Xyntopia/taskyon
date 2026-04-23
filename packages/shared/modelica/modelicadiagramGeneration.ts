import { get_class_info, parse_source_root_file } from 'rumoca'
import type { Thunk } from '../modules/tsHelpers'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const findRecordByTaggedKey = (
  value: unknown,
  tag: string,
  maxDepth = 8,
): Record<string, unknown> | null => {
  const visit = (node: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > maxDepth) return null
    const record = asRecord(node)
    if (record) {
      const tagged = asRecord(record[tag])
      if (tagged) return tagged
      for (const child of Object.values(record)) {
        const found = visit(child, depth + 1)
        if (found) return found
      }
      return null
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return visit(value, 0)
}

const findArrayElements = (value: unknown): unknown[] => {
  const arrayRecord = asRecord(asRecord(value)?.Array) ?? findRecordByTaggedKey(value, 'Array')
  return Array.isArray(arrayRecord?.elements) ? (arrayRecord.elements as unknown[]) : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

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
  components: DiagramComponent[]
  connections: DiagramConnection[]
}

const targetName = (value: unknown): string => {
  const record = asRecord(value)
  const parts = Array.isArray(record?.parts) ? record.parts : []
  const last = parts[parts.length - 1]
  const ident = asRecord(asRecord(last)?.ident)
  return asString(ident?.text)
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const terminal = asRecord(asRecord(value)?.Terminal)
  const token = asRecord(terminal?.token)
  const terminalValue = Number(token?.text)
  if (Number.isFinite(terminalValue)) return terminalValue
  const literal = asRecord(asRecord(value)?.Literal)
  const integerValue = Number(literal?.Integer)
  if (Number.isFinite(integerValue)) return integerValue
  const realValue = Number(literal?.Real)
  if (Number.isFinite(realValue)) return realValue
  const unary = asRecord(asRecord(value)?.Unary)
  if (unary) {
    const rhs = asNumber(unary.rhs)
    if (rhs == null) return null
    const op = asRecord(unary.op)
    return op?.Minus ? -rhs : rhs
  }
  return null
}

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value
  const terminal = asRecord(asRecord(value)?.Terminal)
  const tokenText = asString(asRecord(terminal?.token)?.text).trim().toLowerCase()
  if (tokenText === 'true') return true
  if (tokenText === 'false') return false
  const literal = asRecord(asRecord(value)?.Literal)
  if (typeof literal?.Boolean === 'boolean') return literal.Boolean
  return null
}

const asPair = (value: unknown): [number, number] | null => {
  const elements = findArrayElements(value)
  if (elements.length !== 2) return null
  const first = asNumber(elements[0])
  const second = asNumber(elements[1])
  if (first == null || second == null) return null
  return [first, second]
}

const asExtent = (value: unknown): [[number, number], [number, number]] | undefined => {
  const elements = findArrayElements(value)
  if (elements.length !== 2) return undefined
  const a = asPair(elements[0])
  const b = asPair(elements[1])
  if (!a || !b) return undefined
  return [a, b]
}

const asColor = (value: unknown): DiagramColor | undefined => {
  const elements = findArrayElements(value)
  if (elements.length !== 3) return undefined
  const r = asNumber(elements[0])
  const g = asNumber(elements[1])
  const b = asNumber(elements[2])
  if (r == null || g == null || b == null) return undefined
  return [Math.round(r), Math.round(g), Math.round(b)]
}

const asPoints = (value: unknown): Array<[number, number]> | undefined => {
  const elements = findArrayElements(value)
  const points = elements
    .map((entry) => asPair(entry))
    .filter((entry): entry is [number, number] => entry != null)
  return points.length > 0 ? points : undefined
}

const asStringLiteral = (value: unknown): string | undefined => {
  const terminal = asRecord(asRecord(value)?.Terminal)
  if (terminal?.terminal_type === 'String') {
    const text = asString(asRecord(terminal.token)?.text)
    return text || undefined
  }
  return undefined
}

const expressionToDisplayText = (value: unknown): string => {
  const directNumber = asNumber(value)
  if (directNumber != null) return String(directNumber)
  const strLiteral = asStringLiteral(value)
  if (strLiteral) return strLiteral
  const refText = componentRefToString(value)
  if (refText) return refText
  const terminal = asRecord(asRecord(value)?.Terminal)
  const terminalText = asString(asRecord(terminal?.token)?.text).trim()
  if (terminalText) return terminalText
  const unary = asRecord(asRecord(value)?.Unary)
  if (unary) {
    const op = asRecord(unary.op)
    const rhs = expressionToDisplayText(unary.rhs)
    if (rhs.length === 0) return ''
    return op?.Minus ? `-${rhs}` : rhs
  }
  const functionCall = asRecord(asRecord(value)?.FunctionCall)
  if (functionCall) {
    const comp = componentRefToString(functionCall.comp)
    const args = Array.isArray(functionCall.args) ? functionCall.args : []
    const renderedArgs = args
      .map((arg) => {
        const named = asRecord(asRecord(arg)?.NamedArgument)
        if (named) {
          const name = asString(asRecord(named.name)?.text)
          const rendered = expressionToDisplayText(named.value)
          return name && rendered ? `${name}=${rendered}` : rendered
        }
        return expressionToDisplayText(arg)
      })
      .filter((argText) => argText.length > 0)
    return comp ? `${comp}(${renderedArgs.join(', ')})` : renderedArgs.join(', ')
  }
  return ''
}

const extractIconValueMap = (component: Record<string, unknown>): Record<string, string> => {
  const mods = asRecord(component.modifications)
  if (!mods) return {}
  const out: Record<string, string> = {}
  Object.entries(mods).forEach(([key, expr]) => {
    const rendered = expressionToDisplayText(expr).trim()
    if (rendered.length === 0) return
    out[key] = rendered
  })
  return out
}

const asEnumName = (value: unknown): string | undefined => {
  const fromRef = componentRefToString(value)
  if (fromRef) return fromRef
  const terminal = asRecord(asRecord(value)?.Terminal)
  const tokenText = asString(asRecord(terminal?.token)?.text).trim()
  return tokenText || undefined
}

const namedArgsMap = (argsValue: unknown): Record<string, unknown> => {
  const args = Array.isArray(argsValue) ? argsValue : []
  const map: Record<string, unknown> = {}
  for (const arg of args) {
    const named = asRecord(asRecord(arg)?.NamedArgument)
    if (!named) continue
    const key = asString(asRecord(named.name)?.text)
    if (!key) continue
    map[key] = named.value
  }
  return map
}

const componentRefToString = (value: unknown): string => {
  const record = asRecord(value)
  const parts = Array.isArray(record?.parts) ? record.parts : []
  const names = parts
    .map((part) => asString(asRecord(asRecord(part)?.ident)?.text))
    .filter((name) => name.length > 0)
  return names.join('.')
}

const findFunctionCallByName = (
  value: unknown,
  expectedName?: string,
  maxDepth = 8,
): Record<string, unknown> | null => {
  const normalizedExpected = expectedName?.trim().toLowerCase()
  const visit = (node: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > maxDepth) return null
    const directCall = asRecord(asRecord(node)?.FunctionCall)
    if (directCall) {
      const name = componentRefToString(directCall.comp).trim().toLowerCase()
      if (!normalizedExpected || name === normalizedExpected) return directCall
    }
    const record = asRecord(node)
    if (record) {
      for (const child of Object.values(record)) {
        const found = visit(child, depth + 1)
        if (found) return found
      }
      return null
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return visit(value, 0)
}

const findNamedModification = (
  entries: unknown[],
  name: string,
): { modifications?: unknown[]; value?: unknown } | null => {
  for (const entry of entries) {
    const classMod = asRecord(asRecord(entry)?.ClassModification)
    if (classMod && targetName(classMod.target) === name) {
      const mods = Array.isArray(classMod.modifications) ? classMod.modifications : null
      return mods ? { modifications: mods } : {}
    }
    const mod = asRecord(asRecord(entry)?.Modification)
    if (mod && targetName(mod.target) === name) {
      return { value: mod.value }
    }
  }
  return null
}

const extractPlacement = (
  annotationValue: unknown,
  options?: { preferIconTransformation?: boolean },
): DiagramPlacement | undefined => {
  const annotations = Array.isArray(annotationValue) ? annotationValue : []
  const placement = findNamedModification(annotations, 'Placement')
  const placementMods = placement?.modifications
  if (!placementMods) return undefined
  const transform = options?.preferIconTransformation
    ? (findNamedModification(placementMods, 'iconTransformation') ??
      findNamedModification(placementMods, 'transformation'))
    : (findNamedModification(placementMods, 'transformation') ??
      findNamedModification(placementMods, 'iconTransformation'))
  const transformMods = transform?.modifications
  if (!transformMods) return undefined

  const originPair = asPair(findNamedModification(transformMods, 'origin')?.value)
  const extentPair = asExtent(findNamedModification(transformMods, 'extent')?.value)
  const rotationValue = asNumber(findNamedModification(transformMods, 'rotation')?.value)
  if (!originPair && !extentPair && rotationValue == null) return undefined

  const out: DiagramPlacement = {}
  if (originPair) out.origin = originPair
  if (extentPair) out.extent = extentPair
  if (rotationValue != null) out.rotation = rotationValue
  return out
}

const parseIconGraphic = (value: unknown): DiagramIconGraphic | null => {
  const call = findFunctionCallByName(value)
  if (!call) return null
  const name = componentRefToString(call.comp)
  const args = namedArgsMap(call.args)
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

const extractIconFromClass = (classDef: Record<string, unknown>): DiagramIconSpec | undefined => {
  const annotation = Array.isArray(classDef.annotation) ? classDef.annotation : []
  const iconNode = findNamedModification(annotation, 'Icon')
  const iconMods = iconNode?.modifications
  let coordinateExtent: [[number, number], [number, number]] | undefined
  let graphicsArray: unknown[] = []
  if (iconMods) {
    const coordinateSystemNode = findNamedModification(iconMods, 'coordinateSystem')
    const coordinateMods = coordinateSystemNode?.modifications
    coordinateExtent = coordinateMods
      ? asExtent(findNamedModification(coordinateMods, 'extent')?.value)
      : undefined
    const graphicsValue = findNamedModification(iconMods, 'graphics')?.value
    graphicsArray = findArrayElements(graphicsValue)
  } else if (iconNode?.value) {
    const iconCall = findFunctionCallByName(iconNode.value, 'Icon')
    if (iconCall) {
      const iconArgs = namedArgsMap(iconCall.args)
      const coordinateSystemCall =
        findFunctionCallByName(iconArgs.coordinateSystem, 'coordinateSystem') ??
        findFunctionCallByName(iconArgs.coordinateSystem, 'CoordinateSystem')
      if (coordinateSystemCall) {
        const coordinateArgs = namedArgsMap(coordinateSystemCall.args)
        coordinateExtent = asExtent(coordinateArgs.extent)
      }
      graphicsArray = findArrayElements(iconArgs.graphics)
    }
  } else {
    for (const entry of annotation) {
      const call = findFunctionCallByName(entry, 'Icon')
      if (!call) continue
      const args = namedArgsMap(call.args)
      const coordinateSystem =
        findFunctionCallByName(args.coordinateSystem, 'coordinateSystem') ??
        findFunctionCallByName(args.coordinateSystem, 'CoordinateSystem')
      if (coordinateSystem) {
        const coordinateArgs = namedArgsMap(coordinateSystem.args)
        coordinateExtent = asExtent(coordinateArgs.extent)
      }
      graphicsArray = findArrayElements(args.graphics)
      break
    }
  }
  const graphics = graphicsArray
    .map((entry) => parseIconGraphic(entry))
    .filter((entry): entry is DiagramIconGraphic => entry != null)
  if (graphics.length === 0 && !coordinateExtent) return undefined
  const out: DiagramIconSpec = { graphics }
  if (coordinateExtent) out.coordinateExtent = coordinateExtent
  return out
}

const extractTypeName = (value: unknown): string => {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  const nameParts = Array.isArray(record?.name) ? record.name : []
  if (nameParts.length > 0) {
    const names = nameParts
      .map((part) => asString(asRecord(part)?.text))
      .filter((name) => name.length > 0)
    if (names.length > 0) return names.join('.')
  }
  return componentRefToString(value)
}

const extractLineFromAnnotation = (
  annotationValue: unknown,
): { points?: Array<{ x: number; y: number }>; color?: DiagramColor } | null => {
  const annotations = Array.isArray(annotationValue) ? annotationValue : []
  if (annotations.length > 0) {
    const lineNode = findNamedModification(annotations, 'Line')
    const lineMods = lineNode?.modifications
    if (lineMods) {
      const pointsRaw = asPoints(findNamedModification(lineMods, 'points')?.value)
      const colorRaw = asColor(findNamedModification(lineMods, 'color')?.value)
      const points = pointsRaw?.map(([x, y]) => ({ x, y }))
      if (points || colorRaw) {
        const out: { points?: Array<{ x: number; y: number }>; color?: DiagramColor } = {}
        if (points) out.points = points
        if (colorRaw) out.color = colorRaw
        return out
      }
    }
  }
  const parseFunctionCallLine = (
    value: unknown,
  ): { points?: Array<{ x: number; y: number }>; color?: DiagramColor } | null => {
    const call = asRecord(asRecord(value)?.FunctionCall)
    if (!call) return null
    if (componentRefToString(call.comp) !== 'Line') return null
    const args = namedArgsMap(call.args)
    const pointsRaw = asPoints(args.points)
    const colorRaw = asColor(args.color)
    const points = pointsRaw?.map(([x, y]) => ({ x, y }))
    if (!points && !colorRaw) return null
    const out: { points?: Array<{ x: number; y: number }>; color?: DiagramColor } = {}
    if (points) out.points = points
    if (colorRaw) out.color = colorRaw
    return out
  }
  if (annotations.length > 0) {
    for (const entry of annotations) {
      const parsed = parseFunctionCallLine(entry)
      if (parsed) return parsed
    }
    return null
  }
  return parseFunctionCallLine(annotationValue)
}

const extractConnectEquations = (
  equations: unknown[],
  push: (
    lhs: string,
    rhs: string,
    meta?: { points?: Array<{ x: number; y: number }>; color?: DiagramColor },
  ) => void,
): void => {
  for (const equation of equations) {
    const record = asRecord(equation)
    if (!record) continue
    const connect = asRecord(record.Connect)
    if (connect) {
      const lhs = componentRefToString(connect.lhs)
      const rhs = componentRefToString(connect.rhs)
      const lineFromConnect = extractLineFromAnnotation(connect.annotation)
      const lineFromEquation = extractLineFromAnnotation(record.annotation)
      const lineMeta = lineFromConnect ?? lineFromEquation ?? undefined
      if (lhs && rhs) push(lhs, rhs, lineMeta)
      continue
    }
    const forEq = asRecord(record.For)
    if (forEq) {
      const nested = Array.isArray(forEq.equations) ? forEq.equations : []
      extractConnectEquations(nested, push)
      continue
    }
    const whenEq = Array.isArray(record.When) ? record.When : null
    if (whenEq) {
      for (const block of whenEq) {
        const eqs = Array.isArray(asRecord(block)?.eqs) ? (asRecord(block)?.eqs as unknown[]) : []
        extractConnectEquations(eqs, push)
      }
      continue
    }
    const ifEq = asRecord(record.If)
    if (ifEq) {
      const condBlocks = Array.isArray(ifEq.cond_blocks) ? ifEq.cond_blocks : []
      for (const block of condBlocks) {
        const eqs = Array.isArray(asRecord(block)?.eqs) ? (asRecord(block)?.eqs as unknown[]) : []
        extractConnectEquations(eqs, push)
      }
      const elseBlock = Array.isArray(ifEq.else_block) ? ifEq.else_block : []
      extractConnectEquations(elseBlock, push)
    }
  }
}

const findClassByLeaf = (
  classes: Record<string, unknown>,
  leafName: string,
): Record<string, unknown> | null => {
  const direct = asRecord(classes[leafName])
  if (direct) return direct
  for (const value of Object.values(classes)) {
    const classDef = asRecord(value)
    const nested = asRecord(classDef?.classes)
    if (!nested) continue
    const found = findClassByLeaf(nested, leafName)
    if (found) return found
  }
  return null
}

const firstClassDeep = (classes: Record<string, unknown>): Record<string, unknown> | null => {
  const firstKey = Object.keys(classes)[0]
  if (!firstKey) return null
  const first = asRecord(classes[firstKey])
  if (!first) return null
  return first
}

const classByName = (
  stored: Record<string, unknown>,
  qualifiedName?: string,
): Record<string, unknown> | null => {
  const classes = asRecord(stored.classes)
  if (!classes) return null
  const requestedLeaf = qualifiedName?.split('.').filter(Boolean).pop() ?? ''
  if (requestedLeaf) {
    const found = findClassByLeaf(classes, requestedLeaf)
    if (found) return found
  }
  return firstClassDeep(classes)
}

const canonicalNodeId = (endpoint: string): string => endpoint.split('.').filter(Boolean)[0] ?? ''

const qualifiedNameToFileName = (qualifiedName: string): string =>
  `${
    qualifiedName
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/') || 'Model'
  }.mo`

const shortFileNameFromQualifiedName = (qualifiedName: string): string => {
  const leaf = qualifiedName
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .pop()
  return `${leaf || 'Model'}.mo`
}

const withWithinContext = (source: string, qualifiedName: string): string => {
  const trimmed = source.trim()
  if (!trimmed) return source
  if (/^\s*within\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/m.test(source)) return source
  const parts = qualifiedName
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return source
  const parent = parts.slice(0, -1).join('.')
  return `within ${parent};\n\n${source}`
}

const removeTopLevelImportsForDiagramParse = (source: string): string => {
  const lines = source.split('\n')
  let encounteredClassDeclaration = false
  const classStart = /^\s*(?:model|class|package|block|record|connector|type|function|operator)\b/i
  const importLine = /^\s*import\b.*;\s*$/
  const out: string[] = []
  for (const line of lines) {
    if (classStart.test(line)) encounteredClassDeclaration = true
    if (!encounteredClassDeclaration && importLine.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

const parseSourceRootAst = (source: string, fileName: string): Record<string, unknown> => {
  const parseJson = (input: string): Record<string, unknown> =>
    JSON.parse(String(parse_source_root_file(input, fileName))) as Record<string, unknown>
  try {
    return parseJson(source)
  } catch (firstError) {
    const fallback = removeTopLevelImportsForDiagramParse(source)
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
    if (fallback === source) {
      throw new Error(`Cannot parse Modelica source for diagram extraction: ${firstMessage}`)
    }
    try {
      return parseJson(fallback)
    } catch (secondError) {
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError)
      throw new Error(
        `Cannot parse Modelica source for diagram extraction: primary=${firstMessage}; fallback=${secondMessage}`,
      )
    }
  }
}

const parseClassInfoAst = (source: string, qualifiedName: string): Record<string, unknown> => {
  const fileNames = [
    qualifiedNameToFileName(qualifiedName),
    shortFileNameFromQualifiedName(qualifiedName),
    'Model.mo',
  ]
  const sourceVariants = [source, withWithinContext(source, qualifiedName)]
  let lastError: unknown = null
  for (const candidateSource of sourceVariants) {
    for (const fileName of fileNames) {
      try {
        return parseSourceRootAst(candidateSource, fileName)
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Cannot parse Modelica source for diagram extraction')
}

const parseQualifiedFromLoadedSourceRoots = (
  qualifiedName: string,
  loadedSourceRootFiles: Thunk<Record<string, string>>,
): Record<string, unknown> | null => {
  const filePath = `${qualifiedName.replaceAll('.', '/')}.mo`
  const source = loadedSourceRootFiles()[filePath]
  if (!source) return null
  return parseSourceRootAst(source, filePath)
}

const readNestedString = (source: Record<string, unknown>, path: string[]): string => {
  let cursor: unknown = source
  for (const key of path) {
    const record = asRecord(cursor)
    if (!record) return ''
    cursor = record[key]
  }
  return asString(cursor)
}

const isParameterLikeComponent = (component: Record<string, unknown>): boolean => {
  const directFlag =
    component.is_parameter === true ||
    component.parameter === true ||
    component.is_constant === true ||
    component.constant === true
  if (directFlag) return true
  const variability = [
    readNestedString(component, ['variability']),
    readNestedString(component, ['prefixes', 'variability']),
    readNestedString(component, ['prefixes', 'variability', 'kind']),
    readNestedString(component, ['class_prefixes', 'variability']),
    readNestedString(component, ['class_prefixes', 'variability', 'kind']),
    readNestedString(component, ['declaration_prefixes', 'variability']),
    readNestedString(component, ['declaration_prefixes', 'variability', 'kind']),
  ]
    .map((value) => value.trim().toLowerCase())
    .find((value) => value.length > 0)
  return variability === 'parameter' || variability === 'constant'
}

const shouldIncludeDiagramComponent = (
  componentId: string,
  component: Record<string, unknown>,
  connectedIds: Set<string>,
): boolean => {
  const placement = extractPlacement(component.annotation)
  if (placement) return true
  if (connectedIds.has(componentId)) return !isParameterLikeComponent(component)
  return false
}

const buildTypeLookupCandidates = (
  typeName: string,
  classQualifiedName: string | undefined,
): string[] => {
  const normalized = typeName.trim()
  if (!normalized) return []
  const candidates: string[] = [normalized]
  if (!normalized.startsWith('Modelica.')) {
    candidates.push(`Modelica.${normalized}`)
  }
  const classParts = (classQualifiedName ?? '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  const packageParts = classParts.slice(0, -1)
  for (let i = packageParts.length; i >= 1; i -= 1) {
    candidates.push(`${packageParts.slice(0, i).join('.')}.${normalized}`)
  }
  return Array.from(new Set(candidates))
}

const extractExtendsBaseNames = (classDef: Record<string, unknown>): string[] => {
  const extendsList = Array.isArray(classDef.extends) ? classDef.extends : []
  return extendsList
    .map((entry) => {
      const extend = asRecord(entry)
      const base = asRecord(extend?.base_name)
      return extractTypeName(base)
    })
    .filter((name) => name.length > 0)
}

const mergeIcons = (
  inherited: DiagramIconSpec | undefined,
  own: DiagramIconSpec | undefined,
): DiagramIconSpec | undefined => {
  if (!inherited && !own) return undefined
  const inheritedGraphics = inherited?.graphics ?? []
  const ownGraphics = own?.graphics ?? []
  const graphics = [...inheritedGraphics, ...ownGraphics]
  const coordinateExtent = own?.coordinateExtent ?? inherited?.coordinateExtent
  if (graphics.length === 0 && !coordinateExtent) return undefined
  const out: DiagramIconSpec = { graphics }
  if (coordinateExtent) out.coordinateExtent = coordinateExtent
  return out
}

const resolveTypeIcon = (
  typeName: string,
  classQualifiedName: string | undefined,
  cache: Map<string, DiagramIconSpec | null>,
  loadedSourceRootFiles: Thunk<Record<string, string>>,
  visited: Set<string> = new Set<string>(),
): DiagramIconSpec | undefined => {
  const normalizedType = typeName.trim()
  if (!normalizedType) return undefined
  const traceSine = normalizedType.includes('SineVoltage')
  const candidates = buildTypeLookupCandidates(normalizedType, classQualifiedName)
  if (traceSine) {
    console.log('[diagram][icon] resolveTypeIcon start', {
      typeName: normalizedType,
      classQualifiedName,
      candidates,
    })
  }
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue
    if (cache.has(candidate)) {
      const cached = cache.get(candidate)
      if (cached) return cached
      continue
    }
    visited.add(candidate)
    try {
      const rawInfo = get_class_info(candidate)
      const info = JSON.parse(String(rawInfo)) as Record<string, unknown>
      const sourceModelica = asString(info.source_modelica)
      if (traceSine) {
        console.log('[diagram][icon] candidate class_info', {
          candidate,
          qualified: asString(info.qualified_name) || candidate,
          sourceLength: sourceModelica.length,
          sourcePreview: sourceModelica.slice(0, 220),
        })
      }
      if (!sourceModelica.trim()) {
        cache.set(candidate, null)
        continue
      }
      const qualified = asString(info.qualified_name) || candidate
      let parsed: Record<string, unknown>
      try {
        parsed = parseClassInfoAst(sourceModelica, qualified)
      } catch {
        const fallbackParsed = parseQualifiedFromLoadedSourceRoots(qualified, loadedSourceRootFiles)
        if (!fallbackParsed) throw new Error('Cannot parse Modelica source for diagram extraction')
        parsed = fallbackParsed
      }
      const iconClass = classByName(parsed, qualified) ?? classByName(parsed, candidate)
      const ownIcon = iconClass ? extractIconFromClass(iconClass) : undefined
      if (traceSine) {
        console.log('[diagram][icon] own icon extracted', {
          candidate,
          hasIconClass: Boolean(iconClass),
          ownGraphics: ownIcon?.graphics.length ?? 0,
          ownHasExtent: Boolean(ownIcon?.coordinateExtent),
        })
      }
      let inheritedIcon: DiagramIconSpec | undefined
      if (iconClass) {
        const bases = extractExtendsBaseNames(iconClass)
        const parentIcons = bases
          .map((baseName) =>
            resolveTypeIcon(baseName, qualified, cache, loadedSourceRootFiles, visited),
          )
          .filter((entry): entry is DiagramIconSpec => entry != null)
        if (parentIcons.length > 0) {
          inheritedIcon = parentIcons.reduce<DiagramIconSpec | undefined>(
            (acc, icon) => mergeIcons(acc, icon),
            undefined,
          )
        }
      }
      const icon = mergeIcons(inheritedIcon, ownIcon)
      if (traceSine) {
        console.log('[diagram][icon] merge icon result', {
          candidate,
          inheritedGraphics: inheritedIcon?.graphics.length ?? 0,
          mergedGraphics: icon?.graphics.length ?? 0,
          mergedHasExtent: Boolean(icon?.coordinateExtent),
        })
      }
      cache.set(candidate, icon ?? null)
      if (icon) return icon
    } catch (error) {
      if (traceSine) {
        console.log('[diagram][icon] candidate failed', {
          candidate,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      cache.set(candidate, null)
    } finally {
      visited.delete(candidate)
    }
  }
  return undefined
}

const endpointPortName = (endpoint: string): string | undefined => {
  const parts = endpoint
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length <= 1) return undefined
  const remainder = parts.slice(1).join('.')
  return remainder.length > 0 ? remainder : undefined
}

const isConnectorType = (
  typeName: string,
  classQualifiedName: string | undefined,
  cache: Map<string, boolean>,
): boolean => {
  const normalized = typeName.trim()
  if (!normalized) return false
  const candidates = buildTypeLookupCandidates(normalized, classQualifiedName)
  for (const candidate of candidates) {
    if (cache.has(candidate)) {
      if (cache.get(candidate)) return true
      continue
    }
    try {
      const rawInfo = get_class_info(candidate)
      const info = JSON.parse(String(rawInfo)) as Record<string, unknown>
      const restriction = asString(info.restriction).trim().toLowerCase()
      const classType = asString(info.class_type).trim().toLowerCase()
      const isConnector =
        restriction.includes('connector') ||
        classType.includes('connector') ||
        candidate.endsWith('.Pin') ||
        candidate.endsWith('.Port')
      cache.set(candidate, isConnector)
      if (isConnector) return true
    } catch {
      cache.set(candidate, false)
    }
  }
  return false
}

const resolveTypePorts = (
  typeName: string,
  classQualifiedName: string | undefined,
  iconCache: Map<string, DiagramIconSpec | null>,
  portCache: Map<string, DiagramPort[] | null>,
  connectorTypeCache: Map<string, boolean>,
  loadedSourceRootFiles: Thunk<Record<string, string>>,
  visited: Set<string> = new Set<string>(),
): DiagramPort[] => {
  const normalizedType = typeName.trim()
  if (!normalizedType) return []
  const candidates = buildTypeLookupCandidates(normalizedType, classQualifiedName)
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue
    if (portCache.has(candidate)) {
      const cached = portCache.get(candidate)
      if (cached) return cached
      continue
    }
    visited.add(candidate)
    try {
      const rawInfo = get_class_info(candidate)
      const info = JSON.parse(String(rawInfo)) as Record<string, unknown>
      const sourceModelica = asString(info.source_modelica)
      if (!sourceModelica.trim()) {
        portCache.set(candidate, null)
        continue
      }
      const qualified = asString(info.qualified_name) || candidate
      let parsed: Record<string, unknown>
      try {
        parsed = parseClassInfoAst(sourceModelica, qualified)
      } catch {
        const fallbackParsed = parseQualifiedFromLoadedSourceRoots(qualified, loadedSourceRootFiles)
        if (!fallbackParsed) {
          portCache.set(candidate, null)
          continue
        }
        parsed = fallbackParsed
      }
      const typeClass = classByName(parsed, qualified) ?? classByName(parsed, candidate)
      if (!typeClass) {
        portCache.set(candidate, null)
        continue
      }
      const inherited = extractExtendsBaseNames(typeClass).flatMap((baseName) =>
        resolveTypePorts(
          baseName,
          qualified,
          iconCache,
          portCache,
          connectorTypeCache,
          loadedSourceRootFiles,
          visited,
        ),
      )
      const ownComponents = asRecord(typeClass.components) ?? {}
      const ownPorts: DiagramPort[] = Object.entries(ownComponents)
        .map(([componentId, value]) => ({ componentId, component: asRecord(value) ?? {} }))
        .filter(({ component }) =>
          isConnectorType(extractTypeName(component.type_name), qualified, connectorTypeCache),
        )
        .map(({ componentId, component }) => {
          const portTypeName = extractTypeName(component.type_name)
          const portPlacement = extractPlacement(component.annotation, {
            preferIconTransformation: true,
          })
          const portIcon = resolveTypeIcon(
            portTypeName,
            qualified,
            iconCache,
            loadedSourceRootFiles,
          )
          const port: DiagramPort = {
            name: asString(component.name) || componentId,
            typeName: portTypeName,
          }
          if (portPlacement) port.placement = portPlacement
          if (portIcon) port.icon = portIcon
          return port
        })
      const merged = [...inherited, ...ownPorts]
      const byName = new Map<string, DiagramPort>()
      merged.forEach((port) => byName.set(port.name, port))
      const result = Array.from(byName.values())
      portCache.set(candidate, result.length > 0 ? result : null)
      if (result.length > 0) return result
    } catch {
      portCache.set(candidate, null)
    } finally {
      visited.delete(candidate)
    }
  }
  return []
}

export function handleExtractDiagram(
  payload: {
    source: string
    qualifiedName?: string
    fileName?: string
  },
  loadedSourceRootFiles: Thunk<Record<string, string>>,
): DiagramDto {
  const source = asString(payload.source)
  if (!source.trim()) throw new Error('Cannot build diagram: source is empty')
  const fileName = asString(payload.fileName) || 'Model.mo'
  const parsed = parseSourceRootAst(source, fileName)
  const classDef = classByName(parsed, payload.qualifiedName)
  if (!classDef) throw new Error('Cannot build diagram: no class found in source')

  const className = asString(classDef.name) || 'Model'
  const componentsMap = asRecord(classDef.components) ?? {}
  const iconCache = new Map<string, DiagramIconSpec | null>()
  const portCache = new Map<string, DiagramPort[] | null>()
  const connectorTypeCache = new Map<string, boolean>()
  const equations = Array.isArray(classDef.equations) ? classDef.equations : []
  const rawConnections: Array<{
    lhs: string
    rhs: string
    points?: Array<{ x: number; y: number }>
    color?: DiagramColor
  }> = []
  extractConnectEquations(equations, (lhs, rhs, meta) => {
    const item: {
      lhs: string
      rhs: string
      points?: Array<{ x: number; y: number }>
      color?: DiagramColor
    } = {
      lhs,
      rhs,
    }
    if (meta?.points) item.points = meta.points
    if (meta?.color) item.color = meta.color
    rawConnections.push(item)
  })
  const connectedIds = new Set<string>()
  rawConnections.forEach((connection) => {
    const from = canonicalNodeId(connection.lhs)
    const to = canonicalNodeId(connection.rhs)
    if (from) connectedIds.add(from)
    if (to) connectedIds.add(to)
  })

  const components: DiagramComponent[] = Object.entries(componentsMap)
    .filter(([componentId, value]) =>
      shouldIncludeDiagramComponent(componentId, asRecord(value) ?? {}, connectedIds),
    )
    .map(([componentId, value]) => {
      const component = asRecord(value) ?? {}
      const placement = extractPlacement(component.annotation)
      const typeName = extractTypeName(component.type_name)
      const iconRef = typeName
      const icon = resolveTypeIcon(iconRef, payload.qualifiedName, iconCache, loadedSourceRootFiles)
      const ports = resolveTypePorts(
        typeName,
        payload.qualifiedName,
        iconCache,
        portCache,
        connectorTypeCache,
        loadedSourceRootFiles,
      )
      const item: DiagramComponent = {
        id: componentId,
        name: asString(component.name) || componentId,
        typeName,
      }
      const iconValues = extractIconValueMap(component)
      const description = asString(component.description) || asString(component.comment)
      if (description) item.description = description
      if (Object.keys(iconValues).length > 0) item.iconValues = iconValues
      if (placement) item.placement = placement
      if (iconRef) item.iconRef = iconRef
      if (icon) item.icon = icon
      if (ports.length > 0) item.ports = ports
      return item
    })
  const componentIds = new Set(components.map((component) => component.id))

  const connections: DiagramConnection[] = []
  rawConnections.forEach((connection, index) => {
    const from = canonicalNodeId(connection.lhs)
    const to = canonicalNodeId(connection.rhs)
    const fromPort = endpointPortName(connection.lhs)
    const toPort = endpointPortName(connection.rhs)
    if (!from || !to) return
    if (!componentIds.has(from) || !componentIds.has(to)) return
    connections.push({
      id: `connect-${index + 1}`,
      from,
      to,
      ...(fromPort ? { fromPort } : {}),
      ...(toPort ? { toPort } : {}),
      ...(connection.points ? { linePoints: connection.points } : {}),
      ...(connection.color ? { lineColor: connection.color } : {}),
    })
  })

  return {
    className,
    components,
    connections,
  }
}
