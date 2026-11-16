# Datacircle tools for the AI SDK

Find the best GTM APIs. We benchmark all the GTM APIs and we put the results on our website.

Our website: https://datacircle.dev

This package gives the [AI SDK](https://ai-sdk.dev) four tools that call Datacircle's open API, https://api.datacircle.dev/v1. You need no key and no account.

| Tool | What the tool gives | Call |
| --- | --- | --- |
| `datacircle_list_apis` | Every GTM API on Datacircle, with the API's slug, number of plans, number of providers and best plan | `GET /apis` |
| `datacircle_best_plans` | One API's plans, sorted by score out of 100, best first. Each plan comes with a rank and a price per 1,000 calls | `GET /apis/{slug}/best` |
| `datacircle_search_plans` | Plans that match a provider or plan name, on all APIs or on one API. You can sort them by score, provider or price | `GET /plans` |
| `datacircle_provider` | The APIs a provider sells, and the provider's rank on each API | `GET /providers/{slug}` |

## Install

```bash
npm install @datacircle/ai-sdk ai
```

The package works with AI SDK 5, 6 and 7.

## Use the tools

```ts
import { generateText, isStepCount } from 'ai';
import { datacircleTools } from '@datacircle/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'Who are the 3 best providers for the email-finder API?',
  tools: datacircleTools(),
  stopWhen: isStepCount(5),
});

console.log(text);
```

On AI SDK 5 and 6, use `stepCountIs` instead of `isStepCount`. You can pass the same tools to `streamText` and to an Agent:

```ts
import { ToolLoopAgent } from 'ai';
import { datacircleTools } from '@datacircle/ai-sdk';

const agent = new ToolLoopAgent({ model: 'openai/gpt-5-mini', tools: datacircleTools() });
const { text } = await agent.generate({ prompt: 'Find the 3 cheapest plans of Bright Data.' });
```

You can also import each tool alone: `listApis()`, `bestPlans()`, `searchPlans()` and `providerRanks()`. Each tool's answer names the other tools by these keys, so keep these exact key names:

```ts
import { bestPlans, searchPlans } from '@datacircle/ai-sdk';

const tools = { datacircle_best_plans: bestPlans(), datacircle_search_plans: searchPlans() };
```

Each tool gives back a JSON object. Each plan comes with a rank, provider, plan, score, price per 1,000 (`perThousand`, in dollars) and a page on datacircle.dev. That page lists every field. When the API gives no data, for example for an unknown slug, the tool returns `{"error": "..."}` with the API's message. The model can then call again. If the network fails, the tool throws an error. The AI SDK passes the error message to the model and the run goes on.

`datacircleTools({ fetch })` sets the `fetch` the tools use, for example to add a proxy or a timeout. Each tool function takes the same options.

## Network

Each tool call makes one HTTPS GET request to https://api.datacircle.dev/v1 and nothing else. The request holds only the tool's own arguments: no key and nothing from your chats. The API takes up to 60 calls a minute from one IP address. The tool waits once, for a minute at most, when the API asks the tool to wait. The package depends only on the AI SDK and stores nothing.

## Links

- Datacircle: https://datacircle.dev
- The API: https://datacircle.dev/api
- The API's spec: https://api.datacircle.dev/v1/openapi.json
- What each key means: https://datacircle.dev/fields

MIT license.
