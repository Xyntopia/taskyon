import type { DocumentationManifest } from '@taskyon/common/modules/resourceFiles'

export const taskyonDocumentationManifest: DocumentationManifest = {
  internal: [
    {
      User: [
        { url: '/docs/user/index.md', aliases: ['index', 'simple_intro'] },
        { url: '/docs/user/getting-started.md', aliases: ['README'] },
        {
          Workflows: [
            {
              url: '/docs/user/task-trees.md',
              aliases: ['task_trees', 'conversations/taskyon_description'],
            },
            {
              url: '/docs/user/prompting.md',
              aliases: ['prompting_best_practice', 'simple_prompts', 'draft/prompting'],
            },
            {
              url: '/docs/user/chat-output-and-variables.md',
              aliases: ['conversations/features_intro', 'structured_responses'],
            },
          ],
        },
        {
          'Tools and integrations': [
            {
              url: '/docs/user/providers-and-models.md',
              aliases: ['AI Providers', 'local_llm'],
            },
            { url: '/docs/user/tools-and-mcp.md', aliases: ['tools', 'draft/tools'] },
            '/docs/user/browser-research.md',
            { url: '/docs/user/integrations.md', aliases: ['taskyon_integration'] },
          ],
        },
        {
          Reference: [
            {
              url: '/docs/user/capabilities-and-limits.md',
              aliases: [
                'taskyon_features',
                'taskyon_features_long',
                'taskyon_chat_and_agent_features',
                'taskyon_advanced',
                'draft/features',
                'awesome_chats',
              ],
            },
            {
              url: '/docs/user/storage-and-security.md',
              aliases: ['secret_store', 'Taskyon Cryptosesson overview'],
            },
            { url: '/docs/user/troubleshooting.md', aliases: ['faq'] },
          ],
        },
      ],
    },
    {
      Developer: [
        '/docs/developer/index.md',
        {
          Foundations: [
            {
              url: '/docs/developer/core-policies.md',
              aliases: ['DEVELOPMENT POLICY'],
            },
            {
              url: '/docs/developer/architecture.md',
              aliases: ['taskyon_communication_layers'],
            },
            '/docs/developer/security-model.md',
          ],
        },
        {
          Development: [
            { url: '/docs/developer/development.md', aliases: ['DEVELOPMENT'] },
            {
              url: '/docs/developer/configuration.md',
              aliases: ['taskyon_configuration'],
            },
            '/docs/developer/documentation.md',
            '/docs/developer/diagnostics.md',
          ],
        },
        {
          Runtime: [
            '/docs/developer/task-processing.md',
            {
              url: '/docs/developer/tools-and-workflows.md',
              aliases: ['taskyon_workflow_guide'],
            },
            {
              url: '/docs/developer/client-api.md',
              aliases: ['taskyon_api', 'use_taskyon_chatcompletion_api'],
            },
            '/docs/developer/p2p.md',
          ],
        },
        {
          Integrations: [
            '/docs/developer/extensions.md',
            {
              url: '/docs/developer/modelica.md',
              aliases: ['rumoca_compile_for_taskyon'],
            },
          ],
        },
        {
          CLI: [
            '/docs/developer/tycli.md',
            {
              url: '/docs/developer/tycli-e2e.md',
              aliases: ['tycli_general_agent_e2e_tasks'],
            },
          ],
        },
        '/docs/developer/proposals.md',
        { API: ['/resources/peers/local/api'] },
      ],
    },
  ],
  external: [],
}
