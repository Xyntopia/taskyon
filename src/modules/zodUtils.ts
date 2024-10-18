/* eslint-disable @typescript-eslint/no-explicit-any */
// the reason we are disabling no-explicit-any for this entire file is so that we can use the deepPartial function...
import { z } from 'zod';

export interface tyYamlObjectRepresentation {
  [key: string]: tyYamlRepresentation;
}

type tyYamlRepresentationValue = string | number | boolean | null;

export type tyYamlRepresentation =
  | tyYamlObjectRepresentation
  | tyYamlObjectRepresentation[]
  | tyYamlRepresentationValue
  | tyYamlRepresentationValue[];

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
  short = false,
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
  } else if (schema instanceof z.ZodEffects) {
    return zodToYAMLObject(schema.innerType());
  }

  // Modified ZodObject case to handle optionals
  if (schema instanceof z.ZodObject) {
    if (short) return 'object';
    const shape: Record<string, z.ZodTypeAny> = schema.shape as Record<
      string,
      z.ZodTypeAny
    >;
    const yamlObject: YamlObjectRepresentation = {};
    for (const key in shape) {
      const fieldSchema = shape[key]!;
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
    return short
      ? 'array'
      : {
          type: 'array',
          items: zodToYAMLObject(schema.element),
        };
  }

  // records
  if (schema instanceof z.ZodRecord) {
    const values = zodToYAMLObject(schema.element);
    return short
      ? 'record'
      : {
          key1: values,
          key2: values,
          '...': '...',
        };
  }

  // TODO: what do we do with arrays & objects in this example?
  // Handle union types
  // if we have an object, right now we are returning undefined. So we can not handle that yet..
  if (schema instanceof z.ZodUnion) {
    if (short) return 'union';
    const options = (schema.options as z.ZodTypeAny[])
      .map((option) => {
        const val = zodToYAMLObject(option, '', true);
        if (typeof val === 'object') {
          throw Error(
            'We can currently not convert a union with an object, this is currently too difficult for our AI to understand...',
          );
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

export function zodToDescriptionObject(schema: z.ZodTypeAny): {
  [key: string]: string;
} {
  const descriptions: { [key: string]: string } = {};

  function traverseSchema(schema: z.ZodTypeAny, path: string = '') {
    if (schema instanceof z.ZodObject) {
      const shape: Record<string, z.ZodTypeAny> = schema.shape as Record<
        string,
        z.ZodTypeAny
      >;
      for (const key in shape) {
        const fieldSchema = shape[key]!;
        const newPath = path ? `${path}.${key}` : key;
        if (fieldSchema.description) {
          descriptions[newPath] = fieldSchema.description;
        }
        traverseSchema(fieldSchema, newPath);
      }
    }
  }

  traverseSchema(schema);
  return descriptions;
}

// our own little custom implementation of deepPartial for ZoD
export function deepPartial(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape as Record<
      string,
      z.ZodTypeAny
    >;

    const partialShape: Record<string, z.ZodTypeAny> = {};
    for (const key in shape) {
      const fieldSchema = shape[key]!;
      partialShape[key] = deepPartial(fieldSchema);
    }

    return z.object(partialShape).partial();
  } else if (schema instanceof z.ZodArray) {
    return z.array(deepPartial(schema.element));
  } else if (schema instanceof z.ZodRecord) {
    return z.record(deepPartial(schema.element));
  } else if (schema instanceof z.ZodUnion) {
    const partialUnionTypes = schema.options.map(deepPartial);

    if (partialUnionTypes.length === 1) {
      return partialUnionTypes[0]; // Single type, no need for a union
    } else {
      return z.union(
        partialUnionTypes as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
      );
    }
  } else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable
  ) {
    // Unwrap and apply deepPartial to the underlying schema
    return schema.constructor(deepPartial(schema.unwrap()));
  } else {
    // Return the schema unchanged for non-object types (string, number, etc.)
    return schema;
  }
}

type ZodDeepPartial<T extends z.ZodTypeAny> =
  T extends z.ZodObject<z.ZodRawShape>
    ? z.ZodObject<
        {
          [k in keyof T['shape']]: z.ZodOptional<ZodDeepPartial<T['shape'][k]>>;
        },
        T['_def']['unknownKeys'],
        T['_def']['catchall']
      >
    : T extends z.ZodArray<infer Type, infer Card>
      ? z.ZodArray<ZodDeepPartial<Type>, Card>
      : T extends z.ZodOptional<infer Type>
        ? z.ZodOptional<ZodDeepPartial<Type>>
        : T extends z.ZodNullable<infer Type>
          ? z.ZodNullable<ZodDeepPartial<Type>>
          : T extends z.ZodTuple<infer Items>
            ? {
                [k in keyof Items]: Items[k] extends z.ZodTypeAny
                  ? ZodDeepPartial<Items[k]>
                  : never;
              } extends infer PI
              ? PI extends z.ZodTupleItems
                ? z.ZodTuple<PI>
                : never
              : never
            : T extends z.ZodDefault<infer Type>
              ? z.ZodDefault<ZodDeepPartial<Type>>
              : T extends z.ZodRecord<infer KeySchema, infer ValueSchema>
                ? z.ZodRecord<KeySchema, ZodDeepPartial<ValueSchema>>
                : T;

export function deepPartialify<T extends z.ZodTypeAny>(
  schema: T,
): ZodDeepPartial<T> {
  return _deepPartialify(schema);
}

function _deepPartialify(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const newShape: any = {};

    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = z.ZodOptional.create(_deepPartialify(fieldSchema));
    }
    return new z.ZodObject({
      ...schema._def,
      shape: () => newShape,
    }) as any;
  } else if (schema instanceof z.ZodArray) {
    return new z.ZodArray({
      ...schema._def,
      type: _deepPartialify(schema.element),
    });
  } else if (schema instanceof z.ZodOptional) {
    return z.ZodOptional.create(_deepPartialify(schema.unwrap()));
  } else if (schema instanceof z.ZodNullable) {
    return z.ZodNullable.create(_deepPartialify(schema.unwrap()));
  } else if (schema instanceof z.ZodDefault) {
    // TODO: right now, we're simply leaving default values out of the equation ;). Because
    // for some reason it adds "undefined" default values. maybe add that in the future at some point...
    /*return z.ZodDefault.create(
      _deepPartialify(schema._def.innerType),
      schema._def.defaultValue(),
    );*/
    return _deepPartialify(schema._def.innerType);
  } else if (schema instanceof z.ZodTuple) {
    return z.ZodTuple.create(
      schema.items.map((item: any) => _deepPartialify(item)),
    );
  } else if (schema instanceof z.ZodRecord) {
    return new z.ZodRecord({
      ...schema._def,
      valueType: _deepPartialify(schema._def.valueType), // Recursively partialify value type of the record
    });
  } else {
    return schema;
  }
}

type ZodDeepStrict<T extends z.ZodTypeAny> =
  T extends z.ZodObject<infer Shape>
    ? z.ZodObject<
        {
          [K in keyof Shape]: ZodDeepStrict<Shape[K]>;
        },
        T['_def']['unknownKeys'],
        T['_def']['catchall']
      >
    : T extends z.ZodArray<infer Type, infer Card>
      ? z.ZodArray<ZodDeepStrict<Type>, Card>
      : T extends z.ZodRecord<infer KeySchema, infer ValueSchema>
        ? z.ZodRecord<KeySchema, ZodDeepStrict<ValueSchema>>
        : T extends z.ZodOptional<infer Type>
          ? z.ZodOptional<ZodDeepStrict<Type>>
          : T extends z.ZodNullable<infer Type>
            ? z.ZodNullable<ZodDeepStrict<Type>>
            : T extends z.ZodUnion<infer Options>
              ? z.ZodUnion<{ [K in keyof Options]: ZodDeepStrict<Options[K]> }>
              : T;

export function deepStrictify<T extends z.ZodTypeAny>(
  schema: T,
): ZodDeepStrict<T> {
  return _deepStrict(schema) as ZodDeepStrict<T>;
}

export function _deepStrict(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const newShape: any = {};

    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = _deepStrict(fieldSchema);
    }
    return new z.ZodObject({
      ...schema._def,
      shape: () => newShape,
      unknownKeys: 'strict',
    }) as any;
  } else if (schema instanceof z.ZodArray) {
    return new z.ZodArray({
      ...schema._def,
      type: _deepStrict(schema.element),
    });
  } else if (schema instanceof z.ZodOptional) {
    return z.ZodOptional.create(_deepStrict(schema.unwrap()));
  } else if (schema instanceof z.ZodNullable) {
    return z.ZodNullable.create(_deepStrict(schema.unwrap()));
  } else if (schema instanceof z.ZodDefault) {
    return z.ZodDefault.create(
      _deepStrict(schema._def.innerType),
      schema._def.defaultValue(),
    );
  } else if (schema instanceof z.ZodTuple) {
    return z.ZodTuple.create(
      schema.items.map((item: any) => _deepStrict(item)),
    );
  } else if (schema instanceof z.ZodRecord) {
    return new z.ZodRecord({
      ...schema._def,
      valueType: _deepStrict(schema._def.valueType), // Recursively partialify value type of the record
    });
  } else {
    return schema;
  }
}
