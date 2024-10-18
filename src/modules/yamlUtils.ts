import { dump } from 'js-yaml';
import {
  convertToYamlWComments,
  tyYamlObjectRepresentation,
  tyYamlRepresentation,
  zodToYAMLObject,
} from './zodUtils';
import { z } from 'zod';

// Helper function to convert a Zod schema to an OpenAPI schema
function zodToOpenApiSchema(schema: z.ZodTypeAny): tyYamlObjectRepresentation {
  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  } else if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  } else if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  } else if (schema instanceof z.ZodNull) {
    return { type: 'null' };
  } else if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: Object.keys(schema.Values) };
  } else if (schema instanceof z.ZodLiteral) {
    return { type: 'string', enum: [schema.value] };
  } else if (schema instanceof z.ZodObject) {
    const properties: tyYamlObjectRepresentation = {};
    const required: string[] = [];
    const shape: Record<string, z.ZodTypeAny> = schema.shape as Record<
      string,
      z.ZodTypeAny
    >;

    for (const key in shape) {
      const fieldSchema = shape[key]!;
      properties[key] = zodToOpenApiSchema(fieldSchema);
      if (!(fieldSchema instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    const obj: tyYamlRepresentation = {
      type: 'object',
      properties,
    };
    if (required.length) {
      obj.required = required;
    }
    return obj;
  } else if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToOpenApiSchema(schema.element),
    };
  } else if (schema instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: zodToOpenApiSchema(schema.element),
    };
  } else if (schema instanceof z.ZodUnion) {
    return {
      oneOf: schema.options.map(zodToOpenApiSchema),
    };
  } else if (schema instanceof z.ZodOptional) {
    return zodToOpenApiSchema(schema.unwrap());
  } else if (schema instanceof z.ZodNullable) {
    return {
      ...zodToOpenApiSchema(schema.unwrap()),
      nullable: true,
    };
  } else if (schema instanceof z.ZodDiscriminatedUnion) {
    return {
      oneOf: schema.options.map(zodToOpenApiSchema),
    };
  }

  // Fallback for unsupported types
  return { type: 'object' };
}

// Main function to build OpenAPI specification from Zod schemas
export function zodSchemasToOpenApi(
  schemas: Record<string, z.ZodTypeAny>,
  title: string,
  version: string,
  messageTypes: string[],
  format: 'json' | 'yaml' = 'json',
): string {
  const openApiSpec = {
    openapi: '3.0.0',
    info: {
      title,
      version,
    },
    transport: [
      {
        postMessage: {
          schemes: ['postMessage'],
          //consumes: ['application/json'],
          //produces: ['application/json'],
        },
      },
    ],
    paths: {} as tyYamlObjectRepresentation,
    components: {
      schemas: {} as tyYamlObjectRepresentation,
    },
  };

  for (const [name, schema] of Object.entries(schemas)) {
    openApiSpec.components.schemas[name] = zodToOpenApiSchema(schema);
  }

  // Generate paths for each message type
  for (const messageType of messageTypes) {
    const schema = schemas[messageType];
    if (schema instanceof z.ZodObject) {
      openApiSpec.paths[`/${messageType}`] = {
        post: {
          summary: `Handle ${messageType} message`,
          requestBody: {
            content: {
              'window.postMessage': {
                schema: {
                  $ref: `#/components/schemas/${messageType}`,
                },
              },
            },
          },
          /*responses: {
              // TODO:
            },*/
        },
      };
    }
  }

  if (format === 'yaml') {
    return dump(openApiSpec);
  }

  return JSON.stringify(openApiSpec, null, 2);
}

export function zodToYamlString(schema: z.ZodTypeAny): string {
  const objrepr = zodToYAMLObject(schema);
  const yamlSchema = convertToYamlWComments(dump(objrepr));
  return yamlSchema;
}
