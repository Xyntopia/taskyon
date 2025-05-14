import { dump } from 'js-yaml'
import { jsonSchemaToYamlString } from './zodUtils'
import { z } from 'zod'
import type { JSONSchema7 } from 'json-schema'

export function zodToYamlString(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema) as JSONSchema7
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
