# CMS Cloudflare Package Guidance

- Use Web Crypto and Fetch/Request/Response-compatible APIs only; keep the package safe for Workers and Pages Functions.
- Preserve raw-body signature verification, timestamp tolerance, safe relative preview redirects, cookie security defaults and typed failures.
- Test invalid, stale and tampered webhooks, ignored events, redirects and deploy-hook failures.
- Do not add Astro routes, browser UI, CMS REST client behavior or Node-only crypto dependencies.
