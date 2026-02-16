// useVariableGraph.ts
import { computed, type Ref } from 'vue'
import { type JSONSchema7 } from 'json-schema'
import type z from 'zod'
import { getByPath } from '../../../packages/taskyon/src/utils/objHelpers'
import type { iconMap } from 'src/modules/icons'

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
}

const isMissing = (value: unknown) => value === undefined || value === null

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
  if (subschema && 'properties' in subschema && subschema.type === 'object') {
    return Object.entries(subschema.properties ?? {}).some(([k]) => {
      const v = obj[k]
      return v !== undefined && v !== null && v !== ''
    })
  }
  return Object.values(obj).some((v) => v !== undefined && v !== null && v !== '')
}

const buildVariableNodes = (
  obj: Record<string, unknown>,
  schema: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined,
  keyPath: string[],
  options: UseVariableGraphOptions,
): VariableNode[] => {
  const mapEntry = (
    key: string,
    value: unknown,
    subschema: SchemaWithMeta,
    path: string[],
  ): VariableNode | null => {
    const missing = isMissing(value)
    const { descriptionsAsLabels, inputFieldBehavior, lazyRender } = options
    if (options.missingMode === 'hide' && missing) {
      return null
    }

    const newPath = [...path, key]
    const label =
      (descriptionsAsLabels ? subschema?.description?.trim() : undefined) ??
      subschema?.title ??
      subschema?.label ??
      key

    const desc = subschema?.description?.trim()

    const base: VariableNode = {
      id: newPath.join('.'),
      key,
      path: newPath,
      label,
      kind: 'unknown',
      missing,
      ...(desc ? { description: desc } : {}),
      ...(subschema ? { schema: subschema } : {}),
    }

    const icon = getByPath(newPath)(options.icons) as string | undefined
    if (icon) base.icon = icon
    if (subschema?.icon) base.icon = subschema.icon
    if (subschema?.offIcon) base.offIcon = subschema.offIcon
    if (subschema?.onIcon) base.onIcon = subschema.onIcon
    if (subschema?.default !== undefined) base.default = subschema.default

    const isUndef = value === undefined || value === null
    const runtimeType = subschema?.enum
      ? 'enum'
      : subschema?.format === 'timestamp'
        ? 'timestamp'
        : subschema?.format === 'color'
          ? 'color'
          : (subschema?.type ?? (Array.isArray(value) ? 'array' : typeof value))

    switch (runtimeType) {
      case 'enum': {
        const actualVal = isUndef ? (subschema!.default ?? subschema!.enum![0]) : value
        return {
          ...base,
          value: actualVal,
          options: subschema!.enum as Array<string | number>,
          kind: 'enum',
        }
      }
      case 'timestamp': {
        const ts = isUndef ? (subschema!.default ?? Date.now()) : (value as number)
        return {
          ...base,
          value: ts,
          kind: 'timestamp',
        }
      }
      case 'color': {
        const actualVal = isUndef ? (subschema!.default ?? '#000000') : value
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

        if (lazyRender) {
          const hasChildren = hasAnyVisibleImmediateChild(
            childObj,
            subschema,
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

        const children = buildVariableNodes(childObj, subschema, newPath, options)
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
        return {
          ...base,
          value: arrVal,
          kind: 'array',
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

  if (schema && 'type' in schema && schema.type === 'object' && 'properties' in schema) {
    const schemaProps = (schema.properties ?? {}) as Record<string, JSONSchema7>
    const schemaKeys = Object.keys(schemaProps)
    const runtimeKeys = Object.keys(obj)

    const allKeys =
      options.missingMode === 'placeholders'
        ? schemaKeys
        : Array.from(new Set([...schemaKeys, ...runtimeKeys]))

    return allKeys
      .filter((key) => {
        if (options.missingMode !== 'hide') return true
        const v = obj[key]
        return !isMissing(v)
      })
      .map((key) => mapEntry(key, obj[key], schemaProps[key], keyPath))
      .filter((n): n is VariableNode => n !== null)
  }

  return Object.entries(obj)
    .filter(
      ([, value]) =>
        options.missingMode !== 'hide' || (value !== undefined && value !== null && value !== ''),
    )
    .map(([key, value]) => mapEntry(key, value, undefined, keyPath))
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
