# @ooopsstudio/cms-api

Typed TypeScript client for Ooops CMS REST API v1.

## Installation

```bash
pnpm add @ooopsstudio/cms-api
```

The package is ESM-only and supports Node.js 22.14 or newer.

```ts
import { createCmsClient } from '@ooopsstudio/cms-api';

const cms = createCmsClient({
  baseUrl: 'https://cms.example.com/api/cms/v1',
  token: process.env.OOOPS_CMS_API_TOKEN!
});

const posts = await cms.content.listCollectionEntries('posts', { limit: 20 });
const media = await cms.media.list({ kind: 'images' });
```

Use API tokens only in server-side integrations. The authenticated client mirrors the CMS v1 read-only OpenAPI contract.

## Public forms and previews

Public forms use the tokenless `/api/cms/public` endpoint. The client accepts either the CMS origin or the v1 API base URL:

```ts
import { createCmsPublicFormsClient } from '@ooopsstudio/cms-api';

const publicForms = createCmsPublicFormsClient({ baseUrl: 'https://cms.example.com' });
await publicForms.forms.submit(process.env.CMS_FORM_SHARE_TOKEN!, {
  answers: { email: 'hello@example.com' }
});
```

Draft previews require both a scoped CMS API token and the short-lived preview token:

```ts
import { createCmsPreviewClient } from '@ooopsstudio/cms-api';

const preview = createCmsPreviewClient({
  baseUrl: 'https://cms.example.com/api/cms/v1',
  token: process.env.CMS_API_TOKEN!,
  previewToken: process.env.CMS_PREVIEW_TOKEN!
});

const homepage = await preview.content.getSingle('homepage');
```

The OpenAPI contract is served at:

```txt
GET /api/cms/v1/openapi.json
```

## License

MIT
