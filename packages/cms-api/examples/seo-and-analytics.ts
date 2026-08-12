import { OoopsCmsClient } from '@ooopsstudio/cms-api';

const cms = new OoopsCmsClient({
  baseUrl: process.env.OOOPS_CMS_API_BASE_URL ?? 'https://cms.ooops.work/api/cms/v1',
  token: process.env.OOOPS_CMS_API_TOKEN ?? ''
});

const [seo, overview] = await Promise.all([
  cms.seo.get<{ ok: true; site: unknown; targets: Array<{ id: string; routePattern: string; targetKind: string }> }>(),
  cms.analytics.overview<{ ok: true; summary?: Record<string, unknown> }>({ range: '30d' })
]);

console.log('SEO targets');
for (const target of seo.targets) {
  console.log(`- ${target.routePattern} (${target.targetKind})`);
}

console.log('Analytics overview');
console.log(JSON.stringify(overview.summary ?? overview, null, 2));
