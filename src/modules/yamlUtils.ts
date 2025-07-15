import { z } from 'zod'
import { dump } from 'js-yaml'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'

export function zodToYamlString(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' }) as JSONSchema7
  const yamlSchema = jsonSchemaToYamlString(jsonSchema)
  return yamlSchema
}

const defaultYamlReplacer = (_key: string, value: unknown) => {
  if (typeof value === 'function' || typeof value === 'symbol') {
    return `[unserializable ${typeof value}]`
  }
  return value
}

export const safeYamlDump = (data: unknown) => {
  try {
    const res = dump(data, {
      replacer: defaultYamlReplacer,
    })
    /*const res = dump(data, {
      skipInvalid: true,
    })*/
    return res
  } catch (error) {
    if (error instanceof Error) {
      console.warn(
        `Error converting tool result to YAML: ${error.message}. Retrying with skipInvalid option.`,
      )
    } else {
      console.warn('Error converting tool result to YAML. Retrying with skipInvalid option.')
    }
    const res = dump(data, { skipInvalid: true })
    return res
  }
}

// TODO: move these into yaml utils and get rid of this file...
export interface tyYamlObjectRepresentation {
  [key: string]: tyYamlRepresentation
}

type tyYamlRepresentationValue = string | number | boolean | null

export type tyYamlRepresentation =
  | tyYamlObjectRepresentation
  | tyYamlObjectRepresentation[]
  | tyYamlRepresentationValue
  | tyYamlRepresentationValue[]

interface YamlObjectRepresentation {
  [key: string]: YamlRepresentation
}

export type YamlRepresentation = string | YamlObjectRepresentation | YamlArrayRepresentation
interface YamlArrayRepresentation {
  type: 'array'
  items: YamlRepresentation
}

/**
 * Converts a string representation of an object to YAML format with comments.
 *
 * This function takes a string representation of an object as input, extracts comments
 * from it, which are represented by a key, starting with an '#'
 * and returns a new string in YAML format with the comments preserved, but the keys removed.
 *
 * this:
 *
  # comment: >-
        # This is a comment
        # spanning multiple lines
  bar: baz
  qux: quux

  becomes:

  # This is a comment
  # spanning multiple lines
  bar: baz
  qux: quux

and this:



 *
 * @param {string} objrepr - The string representation of the object to be converted.
 * @returns {string} The converted YAML string with comments.
 */
export function convertToYamlWComments(objrepr: string) {
  // Regular expression to match the entire comment section, including the key and optional '>-'
  // The regex pattern is broken down as follows:
  // ( *) - captures the indentation (group 1)
  // (# .*:) - captures the key (group 2)
  // \s*(>-)? - captures the optional '>-'
  // ([\s\S]*?) - captures the comment block (group 4)
  // (?=\n\s*\S+:|$) - ensures the match is followed by a newline and indentation, or the end of the string
  const regex = /( *)(('# .*:)\s*(>-)?)([\s\S]*?)(?=\n\s*\S+:|$)/g

  return objrepr.replace(
    regex,
    (
      match, // the entire match
      indent: string, // the indentation (group 1)
      keyX, // the key (group 2, not used)
      key, // the key (group 3, not used)
      keyEnd: string, // the optional '>-'
      commentBlock: string, // the comment block (group 4)
    ) => {
      const isMultiline = !!keyEnd // check if the comment block is multiline (i.e., has a '>-')
      // Modify each line of the comment block
      let modifiedCommentBlock = []
      if (isMultiline) {
        // Split the comment block into individual lines
        const commentLines = commentBlock.split('\n').filter((l) => l.trim())
        // Trim the first line and apply the indentation to all other lines
        modifiedCommentBlock = commentLines.map((line) => {
          return indent + '# ' + line.trim() // add the indentation and '#' to each line
        })
      } else {
        // If the comment block is not multiline, simply add the indentation and '#' to it
        modifiedCommentBlock = [indent + '# ' + commentBlock]
      }
      return modifiedCommentBlock.join('\n')
    },
  )
}

export function jsonSchemaToYAMLObject(
  schema: JSONSchema7Definition,
  optionalSymbol = '',
  isOptional = false,
): unknown {
  // --- handle boolean schemas up front ---
  if (schema === true) {
    return 'string'
  }
  if (schema === false) {
    return 'unknown'
  }

  // primitives
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'null') return 'null'

  // enums
  if (schema.enum) {
    return schema.enum.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('|')
  }

  // object with explicit properties
  if (schema.type === 'object' && schema.properties) {
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
    const out: Record<string, unknown> = {}
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propIsOptional = !required.has(key)
      // comments: preserve as real YAML comments later when you dump
      if (typeof propSchema === 'object' && propSchema.description) {
        out[`# ${key} description`] =
          `${propSchema.description}${propIsOptional ? optionalSymbol : ''}`
      }
      out[key] = jsonSchemaToYAMLObject(propSchema, optionalSymbol, propIsOptional)
    }
    return out
  }

  // arrays
  if (schema.type === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items

    if (!items) {
      return { type: 'array', items: 'unknown' }
    }

    return {
      type: 'array',
      // TODO: not sure, if the isOptional is needed here!
      items: jsonSchemaToYAMLObject(items, optionalSymbol, isOptional),
    }
  }

  // object as a "record" or generic object
  if (schema.type === 'object' && schema.additionalProperties !== undefined) {
    let valSchema: JSONSchema7Definition

    if (schema.additionalProperties === true) {
      valSchema = { type: 'string' }
    } else if (schema.additionalProperties === false) {
      return {} // nothing allowed
    } else {
      valSchema = schema.additionalProperties
    }

    const rep = jsonSchemaToYAMLObject(valSchema, optionalSymbol, isOptional)
    // if it's a true nested shape, keep it; otherwise classify
    const leaf = typeof rep === 'string' ? rep : valSchema.type === 'array' ? 'array' : 'record'

    return {
      key1: leaf,
      key2: leaf,
      '...': '...',
    }
  }

  // unions (oneOf / anyOf)
  const union = schema.oneOf ?? schema.anyOf
  if (union) {
    // 1) Map & normalize each branch
    const mapped = union
      .map((sub) => ({
        schema: sub,
        rep: jsonSchemaToYAMLObject(sub, optionalSymbol, isOptional),
      }))
      // 2) Filter out null if optional
      .filter(({ rep }) => !(isOptional && rep === 'null'))

    // 3) If only one left and it's an object schema → recurse
    if (mapped[0] && typeof mapped[0].schema === 'object' && mapped[0].schema.type === 'object') {
      return jsonSchemaToYAMLObject(mapped[0].schema, optionalSymbol, isOptional)
    }

    // 4) Otherwise, label and join
    const labels = mapped.map(({ schema: sub, rep }) =>
      typeof rep === 'string'
        ? rep
        : typeof sub === 'object' && sub.type === 'array'
          ? 'array'
          : 'object',
    )
    // 5) dedupe & join with commas
    return Array.from(new Set(labels)).join(',')
  }

  // fallback
  return 'unknown'
}

// Top‑level: from JSON Schema to YAML string with comments
export function jsonSchemaToYamlString(schema: JSONSchema7, optionalSymbol = ''): string {
  const objrepr = jsonSchemaToYAMLObject(schema, optionalSymbol)
  return convertToYamlWComments(dump(objrepr))
}
