import type { DocumentationManifest } from '@taskyon/common/modules/resourceFiles'

export const taskyonDocumentationManifest: DocumentationManifest = {
  internal: [
    {
      User: [
        '/docs/user/index.md',
        '/docs/user/getting-started.md',
        {
          Workflows: [
            '/docs/user/task-trees.md',
            '/docs/user/prompting.md',
            '/docs/user/chat-output-and-variables.md',
          ],
        },
        {
          'Tools and integrations': [
            '/docs/user/providers-and-models.md',
            '/docs/user/tools-and-mcp.md',
            '/docs/user/browser-research.md',
            '/docs/user/integrations.md',
          ],
        },
        {
          Reference: [
            '/docs/user/capabilities-and-limits.md',
            '/docs/user/storage-and-security.md',
            '/docs/user/troubleshooting.md',
          ],
        },
      ],
    },
    {
      Developer: [
        '/docs/developer/index.md',
        {
          Foundations: [
            '/docs/developer/core-policies.md',
            '/docs/developer/architecture.md',
            '/docs/developer/security-model.md',
          ],
        },
        {
          Development: [
            '/docs/developer/development.md',
            '/docs/developer/configuration.md',
            '/docs/developer/documentation.md',
            '/docs/developer/diagnostics.md',
          ],
        },
        {
          Runtime: [
            '/docs/developer/task-processing.md',
            '/docs/developer/tools-and-workflows.md',
            '/docs/developer/client-api.md',
            '/docs/developer/p2p.md',
          ],
        },
        {
          Integrations: ['/docs/developer/extensions.md', '/docs/developer/modelica.md'],
        },
        {
          CLI: ['/docs/developer/tycli.md', '/docs/developer/tycli-e2e.md'],
        },
        '/docs/developer/proposals.md',
        { API: ['/resources/peers/local/api'] },
      ],
    },
  ],
  external: [],
}
