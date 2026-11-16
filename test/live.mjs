// Each tool's own execute on the live API: its four calls and the answers a model's mistakes get. npm test
import { datacircleTools, listApis, bestPlans, searchPlans, providerRanks } from '@datacircle/ai-sdk';

const tools = datacircleTools();
const opts = { toolCallId: 'direct', messages: [] };
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
};
const run = async (t, input) => t.execute(await validated(t, input), opts);
// The input as the SDK hands it to execute: through the tool's own schema check.
async function validated(t, input) {
  const r = await t.inputSchema.validate(input);
  if (!r.success) throw r.error;
  return r.value;
}

let r = await run(tools.datacircle_list_apis, {});
check('list_apis', r.total > 100 && r.apis.length === 20 && r.apis[0].slug, `total ${r.total}, first ${r.apis[0]?.slug}`);
r = await run(tools.datacircle_list_apis, { query: 'email', limit: '3' });
check('list_apis email', r.apis.length === 3 && r.apis.every((a) => /email/i.test(a.api + a.slug)) && !r.note, r.apis.map((a) => a.slug).join(', '));
r = await run(tools.datacircle_list_apis, { query: 'Bright Data' });
check('list_apis provider name', typeof r.note === 'string' && r.note.includes('datacircle_search_plans'), r.note);

r = await run(tools.datacircle_best_plans, { slug: 'email-finder', limit: 3 });
check('best_plans', r.plans.length === 3 && r.plans[0].rank === 1 && typeof r.plans[0].score === 'number' && r.plans[0].page && !('aggregators' in r.plans[0]),
  `${r.api}: ${r.plans.map((p) => `${p.rank}. ${p.provider} ${p.score}`).join(' / ')}`);
r = await run(tools.datacircle_best_plans, { slug: 'Email Finder', limit: 99 });
check('best_plans name, limit 99', r.plans?.length >= 10 && r.slug === 'email-finder', `${r.plans?.length} plans`);
r = await run(tools.datacircle_best_plans, { slug: 'bright-data' });
check('best_plans unknown slug', r.error?.startsWith('no API has the slug bright-data') && r.error.includes('datacircle_search_plans') && !r.slugs, r.error);
r = await run(tools.datacircle_best_plans, {});
check('best_plans no slug', r.error?.startsWith("Give an API's slug"), r.error);

r = await run(tools.datacircle_search_plans, { query: 'bright data', sort: 'price', limit: 5 });
check('search_plans', r.total > 0 && r.plans.length === 5 && r.plans.every((p) => /bright data/i.test(p.provider)), `total ${r.total}, cheapest ${r.plans[0]?.perThousand}`);
r = await run(tools.datacircle_search_plans, { api: 'email-finder', limit: 2, offset: 1 });
check('search_plans api offset', r.plans.length === 2 && r.plans[0].rank === 2, r.plans.map((p) => `${p.rank}. ${p.provider}`).join(' / '));
r = await run(tools.datacircle_search_plans, { api: 'Bright Data' });
check('search_plans provider as api', r.total > 0 && r.note?.startsWith('No API is named'), `total ${r.total}: ${r.note}`);
r = await run(tools.datacircle_search_plans, { query: 'bright-data' });
check('search_plans slug as query', r.total > 0 && r.note?.includes('"bright data"'), `total ${r.total}: ${r.note}`);
r = await run(tools.datacircle_search_plans, { offset: -3, limit: 0 });
check('search_plans out of range clamped', r.plans.length === 1, `${r.plans.length} plan`);
try {
  await validated(tools.datacircle_search_plans, { sort: 'cheapest' });
  check('search_plans bad sort', false, 'accepted');
} catch (e) {
  check('search_plans bad sort', e.message.includes('sort must be one of'), e.message);
}

r = await run(tools.datacircle_provider, { slug: 'Bright Data' });
check('provider', r.slug === 'bright-data' && r.total > 10 && r.ranked > 0 && r.apis[0].rank <= r.apis[1].rank && r.apis[0].best?.plan,
  `${r.provider}: ${r.total} APIs, ranked on ${r.ranked}, best ${r.apis[0].api} #${r.apis[0].rank}`);
r = await run(tools.datacircle_provider, { slug: 'nobody-x' });
check('provider unknown', r.error?.startsWith('no provider has the slug nobody-x'), r.error);

// The single tools are the same tools.
for (const [name, t, input] of [['listApis', listApis(), { limit: 1 }], ['bestPlans', bestPlans(), { slug: 'serp', limit: 1 }],
  ['searchPlans', searchPlans(), { limit: 1 }], ['providerRanks', providerRanks(), { slug: 'bright-data' }]]) {
  r = await run(t, input);
  check(name, !r.error && (r.apis ?? r.plans)?.length > 0, Object.keys(r).join(','));
}

// Each call's User-Agent, through a fetch of the app's own.
const seen = [];
const traced = datacircleTools({ fetch: (url, init) => (seen.push([String(url), init.headers['User-Agent']]), fetch(url, init)) });
await run(traced.datacircle_best_plans, { slug: 'serp', limit: 1 });
check('fetch option', seen.length === 1 && seen[0][0] === 'https://api.datacircle.dev/v1/apis/serp/best?limit=1' && seen[0][1] === 'datacircle-ai-sdk/0.1.0', seen.flat().join(' '));

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
