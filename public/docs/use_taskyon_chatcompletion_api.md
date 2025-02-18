# Connect taskyon to other services

- Because taskyon.space offers its own OpenAI compatible API, you can connect taskyon to other programs as well
- Login to [https://taskyon.space/settings/taskyonspace](https://taskyon.space/settings/taskyonspace) and create
  a new API key with the restrictions you would like.
- use that key and the url: https://sicynrpldixtrddgqnpm.supabase.co/functions/v1/api to connect to the taskyon chatCompletion API.

## aider

for aider (https://aider.chat/docs/llms/openai-compat.html), you need to set the environment variables:

You can create a new taskyon key here: https://taskyon.space/settings/taskyonspace

```bash
OPENAI_API_BASE=https://sicynrpldixtrddgqnpm.supabase.co/functions/v1/api
OPENAI_API_KEY=<TASKYON_KEY>
```

And to start the chat with a specific model:

```
aider --model openai/<model>
```

Where <model> can be anything from this list: [https://taskyon.space/pricing](https://taskyon.space/pricing)
