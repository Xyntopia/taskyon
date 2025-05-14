// the reason we are disabling no-explicit-any for this entire file is so that we can use the deepPartial function...
import { dump } from 'js-yaml'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'

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

// Convert JSON Schema to our YAML-like representation
export function jsonSchemaToYAMLObject(
  schema: JSONSchema7Definition,
  optionalSymbol = '',
): unknown {
  // --- handle boolean schemas up front ---
  if (schema === true) {
    // “anything goes” → treat as string
    return 'string'
  }
  if (schema === false) {
    // totally disallowed → mark unsupported
    return 'unsupported'
  }

  // primitives
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'null') return 'null'
  // enums
  if (schema.enum)
    return schema.enum.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('|')
  // objects
  if (schema.type === 'object' && schema.properties) {
    const yamlObj: Record<string, unknown> = {}
    const req = new Set(Array.isArray(schema.required) ? schema.required : [])
    const properties = schema.properties as { [key: string]: { description?: string } }
    for (const key of Object.keys(properties)) {
      const prop = properties[key]!
      const optSuffix = req.has(key) ? '' : optionalSymbol
      if (prop.description) {
        yamlObj[`# ${key} description`] = `${prop.description}${optSuffix}`
      }
      yamlObj[key] = jsonSchemaToYAMLObject(prop, optionalSymbol)
    }
    return yamlObj
  }

  // arrays: schema.items may be an array or single
  if (schema.type === 'array' && schema.items) {
    const itemSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items
    if (itemSchema === undefined) {
      return {
        type: 'array',
        items: 'unsupported',
      }
    }
    return {
      type: 'array',
      items: jsonSchemaToYAMLObject(itemSchema, optionalSymbol),
    }
  }

  // records/additionalProperties
  if (schema.type === 'object' && schema.additionalProperties !== undefined) {
    let valSchema: JSONSchema7Definition
    if (schema.additionalProperties === true) {
      valSchema = { type: 'string' }
    } else if (schema.additionalProperties === false) {
      // nothing allowed
      return {}
    } else {
      valSchema = schema.additionalProperties
    }
    const valRep = jsonSchemaToYAMLObject(valSchema, optionalSymbol)
    return { key1: valRep, key2: valRep, '...': '...' }
  }

  // oneOf unions: now OK because we accept Definition[]
  if (schema.oneOf) {
    const parts = schema.oneOf.map((opt) => jsonSchemaToYAMLObject(opt, optionalSymbol))
    return parts.join('|')
  }

  // fallback
  return 'unsupported'
}

// Top‑level: from JSON Schema to YAML string with comments
export function jsonSchemaToYamlString(schema: JSONSchema7, optionalSymbol = ''): string {
  const objrepr = jsonSchemaToYAMLObject(schema, optionalSymbol)
  return convertToYamlWComments(dump(objrepr))
}

export function testJsonSchemaToYaml() {
  const schema: JSONSchema7 = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'identifier' },
      count: { type: 'number', default: 0, description: 'counter' },
      tags: { type: 'array', items: { type: 'string' }, description: 'labels' },
      meta: {
        type: 'object',
        properties: {
          flag: { type: 'boolean' },
          tier: { enum: ['free', 'pro', 'enterprise'], description: 'user tier' },
        },
        description: 'metadata',
      },
    },
  }
  const out = jsonSchemaToYamlString(schema, '?')

  const expected = `\
# id description: identifier
id: string
# count description: counter?
count: number
# tags description: labels?
tags:
  type: array
  items: string
# meta description: metadata?
meta:
  # flag description
  # tier description: user tier?
  tier: free|pro|enterprise
  flag: boolean
`

  if (out.trim() !== expected.trim()) {
    throw new Error(`
YAML output doesn’t match expected snapshot!

— expected —
${expected}

— received —
${out}
    `)
  }

  console.log('✅ test passed')
  return { out }
}
