import { OoopsStageClient } from '@ooopsstudio/stage-api';

const stage = new OoopsStageClient({
  baseUrl: process.env.OOOPS_STAGE_API_BASE_URL ?? 'https://stage.ooops.work/api/stage/v1',
  token: process.env.OOOPS_STAGE_API_TOKEN ?? ''
});

const schema = await stage.schema.list<{
  ok: true;
  contentTypes: Array<{ apiId: string; kind: string; name: string }>;
}>();

console.log('Available content types');
for (const contentType of schema.contentTypes) {
  console.log(`- ${contentType.apiId} (${contentType.kind})`);
}

const posts = await stage.content.listCollectionEntries<{
  ok: true;
  items: Array<{ id: string; slug?: string | null; title?: string | null }>;
  nextCursor?: string | null;
}>('posts', { limit: 10 });

console.log('Latest posts');
for (const post of posts.items) {
  console.log(`- ${post.title ?? post.slug ?? post.id}`);
}
