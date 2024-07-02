// src/utils/openapi.ts
export function generateOpenApiSpec() {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Sample API',
      version: '1.0.0',
    },
    paths: {
      '/example': {
        get: {
          summary: 'Example endpoint',
          responses: {
            '200': {
              description: 'Successful response',
            },
          },
        },
      },
    },
  };
}
