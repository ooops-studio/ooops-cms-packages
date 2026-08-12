# CMS API Package Guidance

- Keep this package as the canonical typed CMS REST, media, forms and read-only preview client.
- Preserve typed errors, timeout behavior, browser-safe public Forms requests without authorization, and explicit server-only token use.
- Test URL/header/body construction, pagination, error classification and credential boundaries for every client change.
- Do not add Astro, Cloudflare, UI, route, SEO, sitemap or content-model assumptions here.
