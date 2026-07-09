# @ooopsstudio/stage-api

Typed TypeScript client for the branded Ooops Stage REST API v1.

## Installation

```bash
pnpm add @ooopsstudio/stage-api
```

The package is ESM-only and supports Node.js 20 or newer.

```ts
import { OoopsStageClient } from '@ooopsstudio/stage-api';

const stage = new OoopsStageClient({
  baseUrl: 'https://stage.ooops.work/api/stage/v1',
  token: process.env.OOOPS_STAGE_API_TOKEN!
});

const posts = await stage.content.listCollectionEntries('posts', { limit: 20 });
const media = await stage.media.list({ kind: 'images' });
```

Use API tokens from server-side integrations. Browser usage should only use scoped read-only tokens with allowed origins configured in Stage settings.

## Content lifecycle

Publish and schedule calls accept version metadata. If the Stage organization requires version labels, the API rejects publish/schedule calls without `versionLabel`.

```ts
await stage.content.publishCollectionEntry('projects', 'kokles', {
  versionLabel: 'Launch copy',
  versionNote: 'Approved by editorial'
});

await stage.content.scheduleSingle('homepage', {
  scheduledFor: '2026-06-01T10:30:00.000Z',
  versionLabel: 'Homepage release'
});
```

## Media uploads

Use `media.upload` for the full sign-upload, raw upload, and complete flow:

```ts
await stage.media.upload({
  fileName: 'poster.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: file.byteLength,
  data: file,
  complete: {
    altEn: 'Poster artwork'
  }
});
```

OpenAPI contract:

```txt
GET /api/stage/v1/openapi.json
```

Common scopes:

- `cms:schema:read`
- `cms:content:read`
- `cms:content:write`
- `cms:content:publish`
- `media:read`
- `media:write`
- `forms:read`
- `forms:write`
- `analytics:read`
- `seo:read`
- `seo:write`
- `webhooks:read`
- `webhooks:write`

## Examples

The `examples/` folder contains runnable TypeScript examples for the main integration flows:

- `read-content.ts`: inspect schema and read published collection entries.
- `media-upload.ts`: request an upload URL, upload a file, and complete the media asset.
- `forms-and-webhooks.ts`: list forms and create a webhook subscription.
- `seo-and-analytics.ts`: read SEO registry data and analytics overview data.

Run them from a server-side environment with a scoped token:

```bash
OOOPS_STAGE_API_BASE_URL=https://stage.ooops.work/api/stage/v1 \
OOOPS_STAGE_API_TOKEN=ooops_stage_... \
pnpm exec tsx packages/stage-api/examples/read-content.ts
```

Use least-privilege scopes per integration. For example, content readers only need `cms:schema:read` and `cms:content:read`; webhook automation needs `webhooks:read` and `webhooks:write`.

## License

MIT
