# CMS Astro Package Guidance

- Keep this package helpers-only: env/client setup, sitemap, JSON-LD and locale paths.
- It must remain Astro-adjacent rather than Astro-runtime-coupled; do not add components, routes, preview endpoints or Cloudflare behavior.
- Maintain unprefixed default-locale behavior and test canonical, alternate-locale and XML escaping cases.
