# @ooopsstudio/cms-astro

Astro-friendly helpers for CMS consumer sites.

This package is helpers-only. It does not ship Astro components, routes, UI, Cloudflare handlers, content mappers, newsletter forms, or preview endpoints.

## Install

```sh
pnpm add @ooopsstudio/cms-astro @ooopsstudio/cms-api
```

## Env and Client Setup

```ts
import { createCmsClientFromAstroEnv, readCmsAstroEnv } from '@ooopsstudio/cms-astro';

const env = readCmsAstroEnv(import.meta.env);
const cms = createCmsClientFromAstroEnv(import.meta.env);

if (cms) {
  const homepage = await cms.content.getSingle('homepage');
}
```

Preferred env names are:

```txt
OOOPS_CMS_API_BASE_URL=
OOOPS_CMS_API_TOKEN=
PUBLIC_SITE_URL=
```

The package deliberately accepts only the CMS env names because it has not yet been published.

## Sitemap

```ts
import { createSitemapUrl, renderSitemapXml } from '@ooopsstudio/cms-astro';

const urls = [
  createSitemapUrl('https://site.example', '/', { priority: 1 }),
  createSitemapUrl('https://site.example', '/projects', { changefreq: 'weekly' })
];

export const GET = () =>
  new Response(renderSitemapXml(urls), {
    headers: { 'content-type': 'application/xml; charset=utf-8' }
  });
```

## JSON-LD

```ts
import { websiteJsonLd, articleJsonLd } from '@ooopsstudio/cms-astro';

const siteSchema = websiteJsonLd({
  name: 'Portfolio',
  url: 'https://site.example'
});

const articleSchema = articleJsonLd({
  headline: 'The Body As Image',
  url: 'https://site.example/posts/body-as-image',
  authorName: 'Ion Taliouridis'
});
```

## Localized Paths

Default locale routes are unprefixed. Secondary locale routes are prefixed.

```ts
import { alternateLocales, localePath } from '@ooopsstudio/cms-astro';

localePath({ locale: 'en', defaultLocale: 'en', path: '/about' }); // /about
localePath({ locale: 'el', defaultLocale: 'en', path: '/about' }); // /el/about

alternateLocales({
  siteUrl: 'https://site.example',
  locales: ['en', 'el'],
  defaultLocale: 'en',
  pathByLocale: {
    en: '/about',
    el: '/about'
  }
});
```

## Boundaries

Use `@ooopsstudio/cms-cloudflare` for preview redirects, rebuild webhooks, signatures, and Cloudflare deploy hooks.

Keep project-specific content mappers, Astro layouts, pages, and visual rendering in your site template.

## License

MIT
