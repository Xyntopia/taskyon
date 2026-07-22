// useVariableGraph.ts
import { computed, type Ref } from 'vue'
import { type JSONSchema7, type JSONSchema7Definition } from 'json-schema'
import type z from 'zod'

export type iconMap = {
  [key: string]: string | iconMap
}

type Key = string | number | symbol
type Indexable = Record<Key, unknown>

export const getByPath =
  (path: readonly Key[]) =>
  (obj: Indexable): unknown =>
    path.reduce<unknown>(
      (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Indexable)[key] : undefined),
      obj,
    )

export type VariableKind =
  | 'object'
  | 'array'
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'timestamp'
  | 'color'
  | 'unknown'

export interface VariableNode {
  id: string
  key: string
  path: string[]
  label: string
  description?: string
  kind: VariableKind
  value?: unknown
  default?: unknown
  icon?: string
  offIcon?: string
  onIcon?: string
  options?: Array<string | number>
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema
  children?: VariableNode[]
  lazy?: boolean
  missing?: boolean
  required?: boolean
}

type SchemaWithMeta =
  | (JSONSchema7 & {
      icon?: string
      offIcon?: string
      onIcon?: string
      label?: string
    })
  | undefined

export type UseVariableGraphOptions = {
  missingMode: 'hide' | 'placeholders' | 'all'
  showMissingIndicator: boolean
  descriptionsAsLabels: boolean
  inputFieldBehavior: 'auto' | 'textarea' | 'autogrow'
  lazyRender: boolean
  icons: iconMap
  schemaDocumentation: boolean
}

const isMissing = (value: unknown) => value === undefined || value === null

type UnionResolution = {
  schema: SchemaWithMeta
  /**
   * When resolving a discriminated union for an object, we generally want to *only* show keys
   * defined by the effective schema. Otherwise stale keys from a previously selected union branch
   * would be shown with unknown subschemas.
   */
  preferSchemaKeysOnly: boolean
}

const normalizeSchemaDef = (def?: JSONSchema7Definition): JSONSchema7 | undefined => {
  if (!def) return undefined
  if (typeof def === 'boolean') return undefined
  return def
}

const getUnionOptions = (schema: SchemaWithMeta): JSONSchema7[] => {
  if (!schema || typeof schema !== 'object') return []
  const anyOf = Array.isArray((schema as JSONSchema7).anyOf)
    ? ((schema as JSONSchema7).anyOf as JSONSchema7Definition[])
    : []
  const oneOf = Array.isArray((schema as JSONSchema7).oneOf)
    ? ((schema as JSONSchema7).oneOf as JSONSchema7Definition[])
    : []
  const defs = [...oneOf, ...anyOf]
  return defs.map(normalizeSchemaDef).filter((s): s is JSONSchema7 => !!s)
}

const schemaTypeMatchesValue = (schema: JSONSchema7, value: unknown): boolean => {
  const t = schema.type
  if (!t) return true
  const schemaTypes = Array.isArray(t) ? t : [t]

  const runtimeType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value

  const runtimeAsJsonSchemaType =
    runtimeType === 'string' || runtimeType === 'number' || runtimeType === 'boolean'
      ? runtimeType
      : runtimeType === 'object'
        ? 'object'
        : runtimeType === 'array'
          ? 'array'
          : runtimeType === 'null'
            ? 'null'
            : undefined

  if (!runtimeAsJsonSchemaType) return true
  return schemaTypes.includes(runtimeAsJsonSchemaType as never)
}

const normalizeSchemaDefDeep = (def: JSONSchema7Definition): JSONSchema7 | undefined => {
  if (!def || typeof def === 'boolean') return undefined
  return def
}

const getAdditionalPropertyCandidates = (schema: JSONSchema7): JSONSchema7[] => {
  const raw = schema.additionalProperties
  if (!raw || typeof raw === 'boolean') return []
  const normalized = normalizeSchemaDefDeep(raw)
  if (!normalized) return []
  return getUnionOptions(normalized).length ? getUnionOptions(normalized) : [normalized]
}

const scoreSchemaFit = (schema: JSONSchema7, value: unknown): number => {
  let score = 0

  if (!schemaTypeMatchesValue(schema, value)) return -100
  score += 1

  if (Array.isArray(schema.enum) && schema.enum.some((v) => v === value)) score += 100

  const c = (schema as unknown as { const?: unknown }).const
  if (c !== undefined && c === value) score += 100

  if (
    schema.type === 'object' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Array.isArray(schema.enum)
  ) {
    const obj = value as Record<string, unknown>
    const props = (schema.properties ?? {}) as Record<string, JSONSchema7Definition>
    const propKeys = new Set(Object.keys(props))
    const valueKeys = Object.keys(obj)

    if (propKeys.size > 0) {
      for (const key of valueKeys) {
        if (propKeys.has(key)) {
          score += 6
          continue
        }
        if (schema.additionalProperties === false) score -= 20
        else score -= 2
      }
    }

    const additionalCandidates = getAdditionalPropertyCandidates(schema)
    if (additionalCandidates.length > 0) {
      for (const key of valueKeys) {
        const v = obj[key]
        const propSchema = normalizeSchemaDefDeep(props[key] as JSONSchema7Definition)
        if (propSchema) continue
        const bestAdditionalScore = additionalCandidates.reduce((best, candidate) => {
          return Math.max(best, scoreSchemaFit(candidate, v))
        }, -100)
        score += bestAdditionalScore > -100 ? Math.min(6, bestAdditionalScore) : -12
      }
    }
  }

  return score
}

const getConstOrSingleEnum = (schema: unknown): string | number | undefined => {
  if (!schema || typeof schema !== 'object') return undefined
  const s = schema as Record<string, unknown>

  // JSON Schema const
  if ('const' in s && (typeof s.const === 'string' || typeof s.const === 'number')) {
    return s.const
  }

  // JSON Schema enum with exactly one value
  if ('enum' in s && Array.isArray(s.enum) && s.enum.length === 1) {
    const v = s.enum[0]
    if (typeof v === 'string' || typeof v === 'number') return v
  }

  return undefined
}

const detectDiscriminatorKey = (
  options: JSONSchema7[],
): { key: string; values: Array<string | number> } | null => {
  const objOptions = options.filter(
    (o) => o.type === 'object' && o.properties && typeof o.properties === 'object',
  )
  if (objOptions.length !== options.length) return null

  const propKeys = Object.keys((objOptions[0]!.properties ?? {}) as Record<string, unknown>)
  const commonKeys = propKeys.filter((k) =>
    objOptions.every(
      (o) => (o.properties ?? {}) && Object.prototype.hasOwnProperty.call(o.properties!, k),
    ),
  )

  const candidates = commonKeys
    .map((key) => {
      const values = objOptions.map((o) => getConstOrSingleEnum((o.properties ?? {})[key]))
      if (values.some((v) => v === undefined)) return null
      const vals = values as Array<string | number>
      const unique = new Set(vals)
      if (unique.size !== vals.length) return null
      return { key, values: vals }
    })
    .filter((x): x is { key: string; values: Array<string | number> } => x !== null)

  if (candidates.length === 0) return null

  // Prefer conventional discriminators
  const preferred =
    candidates.find((c) => c.key === 'kind') ?? candidates.find((c) => c.key === 'type')
  return preferred ?? candidates[0]!
}

const mergeObjectSchemas = (base: JSONSchema7, override: JSONSchema7): JSONSchema7 => {
  const baseProps = (base.properties ?? {}) as Record<string, JSONSchema7Definition>
  const overrideProps = (override.properties ?? {}) as Record<string, JSONSchema7Definition>

  return {
    ...base,
    ...override,
    properties: {
      ...baseProps,
      ...overrideProps,
    },
    required: Array.from(new Set([...(base.required ?? []), ...(override.required ?? [])])),
  }
}

const withInheritedDescription = (
  schema: JSONSchema7,
  fallbackDescription: string | undefined,
): JSONSchema7 => {
  if (schema.description || !fallbackDescription) return schema
  return {
    ...schema,
    description: fallbackDescription,
  }
}

const resolveUnionSchemaForValue = (schema: SchemaWithMeta, value: unknown): UnionResolution => {
  const options = getUnionOptions(schema)
  if (!schema || options.length === 0) return { schema, preferSchemaKeysOnly: false }
  const parentDescription = schema.description

  // 1) Discriminated object union
  const disc = detectDiscriminatorKey(options)
  if (disc) {
    const vObj =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    const currentDiscVal = vObj ? vObj[disc.key] : undefined

    const matchByDisc = (opt: JSONSchema7): boolean => {
      const propSchema = (opt.properties ?? {})[disc.key]
      if (!propSchema) return false
      const c = getConstOrSingleEnum(propSchema)
      if (c === undefined) return false
      return c === currentDiscVal
    }

    const selected =
      (currentDiscVal !== undefined && options.find(matchByDisc)) ||
      // fallback: pick the first option
      options[0]!

    const discriminatorSchema: JSONSchema7 = {
      title: disc.key,
      // give ObjectView an enum dropdown with all variants
      enum: disc.values,
      default:
        typeof currentDiscVal === 'string' || typeof currentDiscVal === 'number'
          ? currentDiscVal
          : disc.values[0],
      // best-effort type
      type: typeof disc.values[0] === 'number' ? 'number' : 'string',
    }

    const effective = withInheritedDescription(
      mergeObjectSchemas(selected, {
        type: 'object',
        properties: {
          [disc.key]: discriminatorSchema,
        },
        required: [disc.key],
      }),
      parentDescription,
    )

    return {
      schema: effective,
      preferSchemaKeysOnly: true,
    }
  }

  // 2) Non-discriminated union: pick the first that matches value reasonably well
  const scored = options.map((opt) => {
    return { opt, score: scoreSchemaFit(opt, value) }
  })

  const typePreference = (opt: JSONSchema7) => {
    const t = Array.isArray(opt.type) ? opt.type[0] : opt.type
    if (t === 'number' || t === 'integer') return 0
    if (t === 'string') return 1
    if (t === 'boolean') return 2
    if (t === 'array') return 3
    if (t === 'object') return 4
    return 5
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return typePreference(a.opt) - typePreference(b.opt)
  })
  const selected = scored[0]?.opt ?? schema
  return {
    schema: withInheritedDescription(selected, parentDescription),
    preferSchemaKeysOnly: false,
  }
}

export const getValueByPath = (obj: unknown, path: string[]): unknown => {
  let cur = obj
  for (const segment of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[segment]
  }
  return cur
}

const hasAnyVisibleImmediateChild = (
  obj: Record<string, unknown>,
  subschema?: JSONSchema7 | z.core.JSONSchema.BaseSchema,
  hideMissing = false,
): boolean => {
  if (!hideMissing) {
    return Object.keys(obj).length > 0
  }
  if (subschema && 'properties' in subschema && (subschema as JSONSchema7).type === 'object') {
    const s = subschema as JSONSchema7
    return Object.entries((s.properties ?? {}) as Record<string, JSONSchema7Definition>).some(
      ([k]) => {
        const v = obj[k]
        return v !== undefined && v !== null && v !== ''
      },
    )
  }
  return Object.values(obj).some((v) => v !== undefined && v !== null && v !== '')
}

const buildVariableNodes = (
  obj: Record<string, unknown>,
  schema: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined,
  keyPath: string[],
  options: UseVariableGraphOptions,
  preferSchemaKeysOnly = false,
): VariableNode[] => {
  const resolvedRoot = resolveUnionSchemaForValue(schema as SchemaWithMeta, obj)
  const effectiveSchema = resolvedRoot.schema as
    | JSONSchema7
    | z.core.JSONSchema.BaseSchema
    | undefined
  const effectivePreferSchemaKeysOnly = preferSchemaKeysOnly || resolvedRoot.preferSchemaKeysOnly

  const mapEntry = (
    key: string,
    value: unknown,
    subschema: SchemaWithMeta,
    path: string[],
    preferSchemaKeysOnlyForChildren: boolean,
    required?: boolean,
  ): VariableNode | null => {
    const missing = isMissing(value)
    const { descriptionsAsLabels, inputFieldBehavior, lazyRender } = options
    if (options.missingMode === 'hide' && missing) {
      return null
    }

    const resolved = resolveUnionSchemaForValue(subschema, value)
    const effectiveSubschema = resolved.schema

    const newPath = [...path, key]
    const label =
      (descriptionsAsLabels ? effectiveSubschema?.description?.trim() : undefined) ??
      effectiveSubschema?.title ??
      effectiveSubschema?.label ??
      key

    const desc = effectiveSubschema?.description?.trim()
    const base: VariableNode = {
      id: '/' + newPath.map((s) => encodeURIComponent(String(s))).join('/'),
      key,
      path: newPath,
      label,
      kind: 'unknown',
      missing,
      ...(required !== undefined ? { required } : {}),
      ...(desc ? { description: desc } : {}),
      ...(effectiveSubschema ? { schema: effectiveSubschema } : {}),
    }

    const icon = getByPath(newPath)(options.icons) as string | undefined
    if (icon) base.icon = icon
    if (effectiveSubschema?.icon) base.icon = effectiveSubschema.icon
    if (effectiveSubschema?.offIcon) base.offIcon = effectiveSubschema.offIcon
    if (effectiveSubschema?.onIcon) base.onIcon = effectiveSubschema.onIcon
    if (effectiveSubschema?.default !== undefined) base.default = effectiveSubschema.default

    const isUndef = value === undefined || value === null
    const runtimeType = effectiveSubschema?.enum
      ? 'enum'
      : effectiveSubschema?.format === 'timestamp'
        ? 'timestamp'
        : effectiveSubschema?.format === 'color'
          ? 'color'
          : (effectiveSubschema?.type ?? (Array.isArray(value) ? 'array' : typeof value))

    switch (runtimeType) {
      case 'enum': {
        const actualVal = isUndef
          ? (effectiveSubschema!.default ?? effectiveSubschema!.enum![0])
          : value
        return {
          ...base,
          value: actualVal,
          options: effectiveSubschema!.enum as Array<string | number>,
          kind: 'enum',
        }
      }
      case 'timestamp': {
        const ts = isUndef ? (effectiveSubschema!.default ?? Date.now()) : (value as number)
        return {
          ...base,
          value: ts,
          kind: 'timestamp',
        }
      }
      case 'color': {
        const actualVal = isUndef ? (effectiveSubschema!.default ?? '#000000') : value
        return {
          ...base,
          value: actualVal as string,
          kind: 'color',
        }
      }
      case 'object': {
        const childObj =
          !isUndef && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {}

        const childPreferSchemaKeysOnly =
          preferSchemaKeysOnlyForChildren || resolved.preferSchemaKeysOnly

        if (lazyRender) {
          const hasChildren = hasAnyVisibleImmediateChild(
            childObj,
            effectiveSubschema,
            options.missingMode === 'hide',
          )
          if (options.missingMode === 'hide' && !hasChildren) return null
          return {
            ...base,
            kind: 'object',
            children: [],
            lazy: hasChildren,
          }
        }

        const children = buildVariableNodes(
          childObj,
          effectiveSubschema,
          newPath,
          options,
          childPreferSchemaKeysOnly,
        )
        if (options.missingMode === 'hide' && children.length === 0) return null

        return {
          ...base,
          kind: 'object',
          children,
        }
      }
      case 'array': {
        const arrVal =
          !isUndef && Array.isArray(value) ? (value as unknown[]) : isUndef ? [] : [value]
        const itemDefinition = Array.isArray(effectiveSubschema?.items)
          ? effectiveSubschema.items[0]
          : effectiveSubschema?.items
        const itemSchema = normalizeSchemaDef(itemDefinition)
        const children =
          options.schemaDocumentation && itemSchema?.type === 'object'
            ? buildVariableNodes({}, itemSchema, newPath, options)
            : undefined
        return {
          ...base,
          value: arrVal,
          kind: 'array',
          ...(children ? { children } : {}),
        }
      }
      case 'string': {
        const actualVal = isUndef ? '' : typeof value === 'string' ? value : JSON.stringify(value)
        const isSingleLine =
          actualVal.length < 100 && !actualVal.includes('\n') && inputFieldBehavior !== 'textarea'
        return {
          ...base,
          value: actualVal,
          kind: isSingleLine ? 'string' : 'text',
        }
      }
      case 'boolean':
        return {
          ...base,
          value: !!value,
          kind: 'boolean',
        }
      case 'number':
      case 'integer': {
        const numVal = isUndef ? undefined : (value as number)
        return {
          ...base,
          value: numVal,
          kind: 'number',
        }
      }
      default:
        return {
          ...base,
          value,
          kind: 'unknown',
        }
    }
  }

  // typed object schema handling (properties + additionalProperties)
  if (
    effectiveSchema &&
    'type' in effectiveSchema &&
    (effectiveSchema as JSONSchema7).type === 'object' &&
    ('properties' in effectiveSchema || 'additionalProperties' in effectiveSchema)
  ) {
    const s = effectiveSchema as JSONSchema7
    const schemaProps = (s.properties ?? {}) as Record<string, JSONSchema7Definition>
    const schemaKeys = Object.keys(schemaProps)
    const runtimeKeys = Object.keys(obj)

    const additionalProperties = (s.additionalProperties ?? undefined) as unknown
    const additionalPropSchema =
      additionalProperties && typeof additionalProperties === 'object'
        ? (additionalProperties as JSONSchema7)
        : undefined

    const allKeys = (() => {
      if (effectivePreferSchemaKeysOnly) return schemaKeys

      if (options.missingMode === 'placeholders') {
        // If the schema does not list explicit properties (e.g. z.record), fall back to runtime keys.
        return schemaKeys.length > 0 ? schemaKeys : runtimeKeys
      }

      return Array.from(new Set([...schemaKeys, ...runtimeKeys]))
    })()

    return allKeys
      .filter((key) => {
        if (options.missingMode !== 'hide') return true
        const v = obj[key]
        return !isMissing(v)
      })
      .map((key) => {
        const subschemaDef = schemaProps[key] ?? additionalPropSchema
        const sub = normalizeSchemaDef(subschemaDef as JSONSchema7Definition) as SchemaWithMeta
        return mapEntry(
          key,
          obj[key],
          sub,
          keyPath,
          effectivePreferSchemaKeysOnly,
          schemaKeys.includes(key) ? (s.required ?? []).includes(key) : undefined,
        )
      })
      .filter((n): n is VariableNode => n !== null)
  }

  // unknown object (no schema)
  return Object.entries(obj)
    .filter(
      ([, value]) =>
        options.missingMode !== 'hide' || (value !== undefined && value !== null && value !== ''),
    )
    .map(([key, value]) => mapEntry(key, value, undefined, keyPath, effectivePreferSchemaKeysOnly))
    .filter((n): n is VariableNode => n !== null)
}

export const flattenVariables = (nodes: VariableNode[], leavesOnly = true): VariableNode[] => {
  const result: VariableNode[] = []
  const stack = [...nodes]
  while (stack.length) {
    const node = stack.pop()!
    const hasChildren = node.children && node.children.length > 0
    if (!hasChildren) {
      result.push(node)
    } else {
      if (!leavesOnly) result.push(node)
      stack.push(...node.children!)
    }
  }
  return result.reverse()
}

export const filterVariableTree = (nodes: VariableNode[], searchText: string): VariableNode[] => {
  const matches = (node: VariableNode) => {
    const hay = `${node.label} ${node.key} ${node.id}`.toLowerCase()
    return hay.includes(searchText)
  }

  const recurse = (list: VariableNode[]): VariableNode[] =>
    list
      .map<VariableNode | null>((node) => {
        const childMatches = node.children ? recurse(node.children) : []
        const selfMatch = matches(node)

        if (selfMatch || childMatches.length > 0) {
          return {
            ...node,
            children: childMatches,
          }
        }
        return null
      })
      .filter((n): n is VariableNode => n !== null)

  return recurse(nodes)
}

export const filterFlat = (nodes: VariableNode[], searchText: string): VariableNode[] => {
  return nodes.filter((node) => {
    const hay = `${node.label} ${node.key} ${node.id}`.toLowerCase()
    return hay.includes(searchText)
  })
}

export const useVariableGraph = (
  modelValue: Ref<Record<string, unknown> | undefined>,
  schema: Ref<JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined>,
  options: Ref<UseVariableGraphOptions>,
) => {
  const rootNodes = computed(() => {
    if (!modelValue.value) return []
    return buildVariableNodes(modelValue.value, schema.value, [], options.value)
  })

  const buildChildrenForPath = (
    path: string[],
    subschema?: JSONSchema7 | z.core.JSONSchema.BaseSchema,
  ): VariableNode[] => {
    if (!modelValue.value) return []
    const raw = getValueByPath(modelValue.value, path)
    const obj =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    return buildVariableNodes(obj, subschema, path, options.value)
  }

  return {
    rootNodes,
    buildChildrenForPath,
    getValueByPath,
  }
}
