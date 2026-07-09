import { OoopsStageClient } from '@ooopsstudio/stage-api';

const stage = new OoopsStageClient({
  baseUrl: process.env.OOOPS_STAGE_API_BASE_URL ?? 'https://stage.ooops.work/api/stage/v1',
  token: process.env.OOOPS_STAGE_API_TOKEN ?? ''
});

const [seo, overview] = await Promise.all([
  stage.seo.get<{ ok: true; site: unknown; targets: Array<{ id: string; routePattern: string; targetKind: string }> }>(),
  stage.analytics.overview<{ ok: true; summary?: Record<string, unknown> }>({ range: '30d' })
]);

console.log('SEO targets');
for (const target of seo.targets) {
  console.log(`- ${target.routePattern} (${target.targetKind})`);
}

console.log('Analytics overview');
console.log(JSON.stringify(overview.summary ?? overview, null, 2));
