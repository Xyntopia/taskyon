import { dump } from 'js-yaml';
import { z } from 'zod';

interface tyYamlObjectRepresentation {
  [key: string]: tyYamlRepresentation;
}

type tyYamlRepresentationValue = string | number | boolean | null;

type tyYamlRepresentation =
  | tyYamlObjectRepresentation
  | tyYamlObjectRepresentation[]
  | tyYamlRepresentationValue
  | tyYamlRepresentationValue[];

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
      const fieldSchema = shape[key];
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
  }

  // Fallback for unsupported types
  return { type: 'unsupported' };
}

// Main function to build OpenAPI specification from Zod schemas
export function zodSchemasToOpenApi(
  schemas: Record<string, z.ZodTypeAny>,
  title: string,
  version: string,
  format: 'json' | 'yaml' = 'json',
): string {
  const openApiSpec = {
    openapi: '3.0.0',
    info: {
      title,
      version,
    },
    paths: {},
    components: {
      schemas: {} as tyYamlObjectRepresentation,
    },
  };

  for (const [name, schema] of Object.entries(schemas)) {
    openApiSpec.components.schemas[name] = zodToOpenApiSchema(schema);
  }

  if (format === 'yaml') {
    return dump(openApiSpec);
  }

  return JSON.stringify(openApiSpec, null, 2);
}

interface YamlObjectRepresentation {
  [key: string]: YamlRepresentation;
}

export type YamlRepresentation =
  | string
  | YamlObjectRepresentation
  | YamlArrayRepresentation;
interface YamlArrayRepresentation {
  type: 'array';
  items: YamlRepresentation;
}

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
  const regex = /( *)(('# .*:)\s*(>-)?)([\s\S]*?)(?=\n\s*\S+:|$)/g;

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
      const isMultiline = !!keyEnd; // check if the comment block is multiline (i.e., has a '>-')
      // Modify each line of the comment block
      let modifiedCommentBlock = [];
      if (isMultiline) {
        // Split the comment block into individual lines
        const commentLines = commentBlock.split('\n').filter((l) => l.trim());
        // Trim the first line and apply the indentation to all other lines
        modifiedCommentBlock = commentLines.map((line) => {
          return indent + '# ' + line.trim(); // add the indentation and '#' to each line
        });
      } else {
        // If the comment block is not multiline, simply add the indentation and '#' to it
        modifiedCommentBlock = [indent + '# ' + commentBlock];
      }
      return modifiedCommentBlock.join('\n');
    },
  );
}

export function zodToYamlString(schema: z.ZodTypeAny): string {
  const objrepr = zodToYAMLObject(schema);
  const yamlSchema = convertToYamlWComments(dump(objrepr));
  return yamlSchema;
}
