// AI SDK tools on Datacircle's open API: find the best GTM APIs. The API needs no key: https://api.datacircle.dev/v1
// (its spec: https://api.datacircle.dev/v1/openapi.json). More at https://datacircle.dev

import { jsonSchema, tool } from 'ai';
import type { JSONSchema7, Tool } from 'ai';
import { ApiError, BASE_URL, Client, VERSION, brief, briefPlans, clamp, objects, slugify } from './client.js';
import type { Answer, DatacircleOptions } from './client.js';

export { ApiError, BASE_URL, VERSION };
export type { Answer, DatacircleOptions };

/** datacircle_list_apis' input. */
export interface ListApisInput {
  query?: string;
  limit?: number;
}

/** datacircle_best_plans' input. */
export interface BestPlansInput {
  slug: string;
  limit?: number;
}

/** datacircle_search_plans' input. */
export interface SearchPlansInput {
  api?: string;
  query?: string;
  sort?: 'score' | 'provider' | 'price';
  limit?: number;
  offset?: number;
}

/** datacircle_provider's input. */
export interface ProviderInput {
  slug: string;
}

const LIST_APIS_ABOUT = "Lists the GTM APIs on Datacircle's sheet (https://datacircle.dev). GTM means go-to-market. GTM APIs are the APIs sales and marketing teams use. Gives each API's slug, how many plans and providers it has and its best plan. Call it first to find an API's slug.";
const BEST_PLANS_ABOUT = "Gives an API's plans best first by their score out of 100 on Datacircle's benchmark (https://datacircle.dev), each with its rank, provider, plan, $ per 1,000 calls and its page. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const SEARCH_PLANS_ABOUT = "Searches every plan on Datacircle's sheet (https://datacircle.dev), or one API's, by provider or plan name, sorted by score, provider or price. Gives how many were found and up to limit of them. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const PROVIDER_ABOUT = "Gives each API one provider sells and its rank on each on Datacircle's benchmark (https://datacircle.dev), with its best plan there, its best rank first. total is how many APIs it sells, ranked on how many of them it has a rank.";

// Tells a model that sent a provider's name to an API's tool where a provider's plans are.
const FOR_PROVIDER = "A provider's plans: datacircle_search_plans with its name as query, like bright data, or datacircle_provider.";

type Field = { type: 'string' | 'integer'; description: string; enum?: readonly string[] };

/**
 * The input's JSON schema, and its check: a number sent as a string is read as one, a null as left out, a key the
 * schema doesn't name is dropped. A required string left out is given as '', so that the tool answers which one it
 * needs.
 */
function input<T>(fields: Record<string, Field>, required: readonly string[] = []) {
  const properties: Record<string, JSONSchema7> = {};
  for (const [name, field] of Object.entries(fields)) {
    properties[name] = { type: field.type, description: field.description, ...(field.enum ? { enum: [...field.enum] } : {}) };
  }
  const schema: JSONSchema7 = { type: 'object', properties, required: [...required], additionalProperties: false };
  return jsonSchema<T>(schema, {
    validate: (value) => {
      if (value === undefined || value === null) value = {};
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, error: new Error('The input must be an object of ' + Object.keys(fields).join(', ')) };
      }
      const out: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(fields)) {
        let v = (value as Record<string, unknown>)[name];
        if (v === undefined || v === null || v === '') {
          if (required.includes(name)) out[name] = '';
          continue;
        }
        if (field.type === 'integer') {
          const n = typeof v === 'string' ? Number(v.trim()) : v;
          if (typeof n !== 'number' || !Number.isFinite(n)) {
            return { success: false, error: new Error(`${name} must be a number: ${field.description}`) };
          }
          v = Math.trunc(n);
        } else if (typeof v === 'number') {
          v = String(v);
        } else if (typeof v !== 'string') {
          return { success: false, error: new Error(`${name} must be a string: ${field.description}`) };
        }
        if (field.enum && !field.enum.includes(v as string)) {
          return { success: false, error: new Error(`${name} must be one of ${field.enum.join(', ')}`) };
        }
        out[name] = v;
      }
      return { success: true, value: out as T };
    },
  });
}

/** An answer of 4xx (an unknown slug, a wrong argument) is the tool's result as {error}, so that the model reads the API's words and can call again. */
function asResult(error: unknown): Answer {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

function listApisTool(client: Client): Tool<ListApisInput, Answer> {
  return tool({
    description: LIST_APIS_ABOUT,
    inputSchema: input<ListApisInput>({
      query: { type: 'string', description: "Words of the API's name or slug, like email or linkedin profile: the APIs that hold the most of them come first. The sheet's order when left out" },
      limit: { type: 'integer', description: 'How many APIs to give, 1 to 200. 20 when left out: the sheet has about 150' },
    }),
    execute: async ({ query = '', limit }, { abortSignal }) => {
      let apis: Answer[];
      try {
        apis = objects(await client.get<unknown>('/apis', {}, abortSignal));
      } catch (error) {
        return asResult(error);
      }
      const words = query.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
      const found = apis
        .map((api, order) => {
          const name = `${String(api.api ?? '')} ${String(api.slug ?? '').replace(/-/g, ' ')}`.toLowerCase();
          return { order, matched: words.filter((word) => name.includes(word)).length, api };
        })
        .filter(({ matched }) => matched > 0 || words.length === 0)
        // The most words matched first, the sheet's order within each.
        .sort((a, b) => b.matched - a.matched || a.order - b.order);
      const answer: Answer = {
        total: found.length,
        apis: found.slice(0, limit === undefined ? 20 : clamp(limit, 1, 200))
          .map(({ api }) => brief(api, ['api', 'slug', 'plans', 'providers', 'best', 'bestPage', 'sheetPage'])),
      };
      if (words.length > 0 && (found.length === 0 || found[0].matched < words.length)) {
        // A provider's name sent as an API's, like Bright Data, whose data matches many APIs: where its plans are.
        answer.note = `No API's name holds every word of ${JSON.stringify(query)}. A provider's plans: datacircle_search_plans with its name as query, or datacircle_provider.`;
      }
      return answer;
    },
  });
}

function bestPlansTool(client: Client): Tool<BestPlansInput, Answer> {
  return tool({
    description: BEST_PLANS_ABOUT,
    inputSchema: input<BestPlansInput>({
      slug: { type: 'string', description: "The API's slug, like email-finder or linkedin-profile, as datacircle_list_apis gives it" },
      limit: { type: 'integer', description: 'How many plans to give, 1 to 50. 10 when left out' },
    }, ['slug']),
    execute: async ({ slug, limit }, { abortSignal }) => {
      const api = slugify(slug);
      if (api === '') return { error: `Give an API's slug, like email-finder: datacircle_list_apis gives every slug. ${FOR_PROVIDER}` };
      try {
        const answer = await client.get(`/apis/${api}/best`, { limit: limit === undefined ? undefined : clamp(limit, 1, 50) }, abortSignal);
        return { ...answer, plans: briefPlans(answer.plans) };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // A provider's name sent as the API's slug: the API's words, and where a provider's plans are.
          return { error: `${error.message}. datacircle_list_apis gives every API's slug. ${FOR_PROVIDER}` };
        }
        return asResult(error);
      }
    },
  });
}

function searchPlansTool(client: Client): Tool<SearchPlansInput, Answer> {
  const search = (api: string, query: string, input: SearchPlansInput, signal?: AbortSignal) =>
    client.get('/plans', {
      api: api.trim(),
      query: query.trim(),
      sort: input.sort,
      limit: input.limit === undefined ? undefined : clamp(input.limit, 1, 50),
      offset: input.offset === undefined || input.offset <= 0 ? undefined : Math.trunc(input.offset),
    }, signal);
  return tool({
    description: SEARCH_PLANS_ABOUT,
    inputSchema: input<SearchPlansInput>({
      api: { type: 'string', description: "Only this API's plans: its name or slug, like email-finder. A provider's name goes in query, never here. Every API when left out" },
      query: { type: 'string', description: "Words that must all appear in the provider's or plan's name, like bright data" },
      sort: { type: 'string', enum: ['score', 'provider', 'price'], description: 'score (best first, the default), provider (A to Z) or price ($ per 1,000, lowest first)' },
      limit: { type: 'integer', description: 'How many plans to give, 1 to 50. 10 when left out' },
      offset: { type: 'integer', description: 'How many found plans to skip first. 0 when left out' },
    }),
    execute: async (input, { abortSignal }) => {
      let api = input.api ?? '';
      let query = input.query ?? '';
      const notes: string[] = [];
      try {
        let answer: Answer;
        try {
          answer = await search(api, query, input, abortSignal);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 400 && error.message.includes('api must be') && query.trim() === '')) throw error;
          // A provider's name sent as the API: the plans whose provider or plan name holds it.
          [api, query] = ['', api];
          answer = await search(api, query, input, abortSignal);
          notes.push(`No API is named ${JSON.stringify(input.api)}: these are the plans whose provider or plan name holds it.`);
        }
        if (answer.total === 0 && query.includes('-')) {
          // A slug sent as a name, like bright-data, which no name holds: its words, like bright data. A name with a
          // hyphen, like A-Leads, is found as it is first.
          const words = query.replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ');
          try {
            answer = await search(api, words, input, abortSignal);
            notes.push(`No provider's or plan's name holds ${JSON.stringify(query)}: these are the plans whose name holds ${JSON.stringify(words)}.`);
          } catch {
            // The first answer stands.
          }
        }
        return { ...answer, plans: briefPlans(answer.plans), ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
      } catch (error) {
        return asResult(error);
      }
    },
  });
}

function providerTool(client: Client): Tool<ProviderInput, Answer> {
  return tool({
    description: PROVIDER_ABOUT,
    inputSchema: input<ProviderInput>({
      slug: { type: 'string', description: "The provider's slug, like bright-data, or its name, like Bright Data: the name is made a slug" },
    }, ['slug']),
    execute: async ({ slug }, { abortSignal }) => {
      const provider = slugify(slug);
      if (provider === '') return { error: "Give a provider's slug or name, like bright-data or Bright Data" };
      let answer: Answer;
      try {
        answer = await client.get(`/providers/${provider}`, {}, abortSignal);
      } catch (error) {
        return asResult(error);
      }
      const apis = objects(answer.apis).map((entry) => {
        const plans = objects(entry.plans);
        const kept: Answer = { ...brief(entry, ['api', 'slug', 'rank', 'bestPage']), plans: plans.length };
        const best = bestPlan(plans);
        if (best) kept.best = brief(best, ['plan', 'score', 'perThousand', 'page']);
        return kept;
      });
      // Its best rank first, the APIs where it has none last, in the API's order.
      const rank = (api: Answer) => (typeof api.rank === 'number' ? api.rank : Infinity);
      apis.sort((a, b) => rank(a) - rank(b));
      return { ...answer, apis, total: apis.length, ranked: apis.filter((api) => typeof api.rank === 'number').length };
    },
  });
}

/** A provider's best plan on an API: its lowest rank, the first when none has a rank. */
function bestPlan(plans: Answer[]): Answer | undefined {
  const ranked = plans.filter((plan) => typeof plan.rank === 'number');
  if (ranked.length === 0) return plans[0];
  return ranked.reduce((best, plan) => ((plan.rank as number) < (best.rank as number) ? plan : best));
}

/** The four tools by the names their answers give each other. */
export type DatacircleTools = {
  datacircle_list_apis: Tool<ListApisInput, Answer>;
  datacircle_best_plans: Tool<BestPlansInput, Answer>;
  datacircle_search_plans: Tool<SearchPlansInput, Answer>;
  datacircle_provider: Tool<ProviderInput, Answer>;
};

/**
 * The four tools, for generateText's, streamText's or an Agent's tools: datacircle_list_apis (GET /apis),
 * datacircle_best_plans (GET /apis/{slug}/best), datacircle_search_plans (GET /plans) and datacircle_provider
 * (GET /providers/{slug}). Their answers name each other by these names.
 */
export function datacircleTools(options?: DatacircleOptions): DatacircleTools {
  const client = new Client(options);
  return {
    datacircle_list_apis: listApisTool(client),
    datacircle_best_plans: bestPlansTool(client),
    datacircle_search_plans: searchPlansTool(client),
    datacircle_provider: providerTool(client),
  };
}

/** datacircle_list_apis alone: GET /apis. */
export const listApis = (options?: DatacircleOptions): Tool<ListApisInput, Answer> => listApisTool(new Client(options));

/** datacircle_best_plans alone: GET /apis/{slug}/best. */
export const bestPlans = (options?: DatacircleOptions): Tool<BestPlansInput, Answer> => bestPlansTool(new Client(options));

/** datacircle_search_plans alone: GET /plans. */
export const searchPlans = (options?: DatacircleOptions): Tool<SearchPlansInput, Answer> => searchPlansTool(new Client(options));

/** datacircle_provider alone: GET /providers/{slug}. */
export const providerRanks = (options?: DatacircleOptions): Tool<ProviderInput, Answer> => providerTool(new Client(options));
