import z from 'zod'

//export const convertZodToJsonSchemaCached = lruCache(100)(zodToJsonSchema)
export const convertZodToJsonSchemaCached = z.toJSONSchema
