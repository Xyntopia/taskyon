import { dump } from 'js-yaml';
import { z } from 'zod';
import {
  YamlRepresentation,
  YamlObjectRepresentation,
  convertToYamlWComments,
} from './types';

/* convert a zod schema into a nested object where the description
appear in keys starting with '#'
*/

export function zodToYAMLObject(
  schema: z.ZodTypeAny,
  optionalSymbol = '',
): YamlRepresentation {
  // Base case for primitive types
  if (schema instanceof z.ZodString) {
    return 'string';
  } else if (schema instanceof z.ZodNumber) {
    return 'number';
  } else if (schema instanceof z.ZodBoolean) {
    return 'boolean';
  } else if (schema instanceof z.ZodNull) {
    return 'null';
  } else if (schema instanceof z.ZodEnum) {
    return Object.keys(schema.Values).join('|');
  }

  // Modified ZodObject case to handle optionals
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape as Record<
      string,
      z.ZodTypeAny
    >;
    const yamlObject: YamlObjectRepresentation = {};
    for (const key in shape) {
      const fieldSchema = shape[key];
      const optionalSuffix =
        fieldSchema instanceof z.ZodOptional ? optionalSymbol : '';
      if (fieldSchema?.description) {
        yamlObject[`# ${key} description`] =
          `${fieldSchema.description} ${optionalSuffix}`.trim();
      }
      yamlObject[key] = zodToYAMLObject(fieldSchema);
    }
    return yamlObject;
  }

  // Handle arrays
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToYAMLObject(schema.element),
    };
  }

  // records
  if (schema instanceof z.ZodRecord) {
    const values = zodToYAMLObject(schema.element);
    return {
      key1: values,
      key2: values,
      '...': '...',
    };
  }

  // TODO: what do we do with arrays & objects in this example?
  // Handle union types
  if (schema instanceof z.ZodUnion) {
    const options = (schema.options as z.ZodTypeAny[])
      .map((option) => {
        const val = zodToYAMLObject(option);
        if (typeof val === 'object') {
          return undefined;
        }
        return val;
      })
      .filter((r) => r);
    return options.join('|');
  }

  // Modified ZodOptional case
  if (schema instanceof z.ZodOptional) {
    return zodToYAMLObject(schema.unwrap());
  }

  // Modified ZodOptional case
  if (schema instanceof z.ZodNullable) {
    return zodToYAMLObject(schema.unwrap());
  }

  // Add more cases as needed for other Zod types (unions, etc.)
  // Fallback for unsupported types
  return 'unsupported';
}

export function zodToYamlString(schema: z.ZodTypeAny): string {
  const objrepr = zodToYAMLObject(schema);
  const yamlSchema = convertToYamlWComments(dump(objrepr));
  return yamlSchema;
}
