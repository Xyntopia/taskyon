import { dump } from 'js-yaml'
import { convertToYamlWComments, zodToYAMLObject } from './zodUtils'
import type { z } from 'zod'

export function zodToYamlString(schema: z.ZodTypeAny): string {
  const objrepr = zodToYAMLObject(schema)
  const yamlSchema = convertToYamlWComments(dump(objrepr))
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
