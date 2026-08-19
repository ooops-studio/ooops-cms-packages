# CMS Cloudflare Package Guidance

- Use Web Crypto and Fetch/Request/Response-compatible APIs only; keep the package safe for Workers and Pages Functions.
- Match the deployed Ooops CMS preview contract: the CMS emits an opaque `preview` query token and the consumer validates it server-side through `@ooopsstudio/cms-api`.
- Preserve encrypted preview sessions, scoped cookie security defaults, expiry enforcement and private/no-index response headers.
- Test initial handoff, tampered and expired cookies, reload persistence and the exact CMS preview request paths.
- Do not invent outgoing CMS webhook events, add Astro routes, browser UI, content-model assumptions or Node-only crypto dependencies.
