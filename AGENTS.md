# CMS Packages Guidance

## Scope

This monorepo publishes framework-agnostic CMS integration packages. Keep contracts stable, ESM-only, dependency-light and safe for Node 22 and edge runtimes where applicable.

## Required workflow

- Run `pnpm -w validate` before changes that affect public behavior; run the targeted package `test`, `typecheck`, `build`, `publint`, `attw` and `pack:dry` while developing.
- Add unit tests for every changed public helper and packed-artifact coverage for exports or dependency graph changes.
- Use Changesets for publishable API changes and keep README examples aligned with the exported API.

## Architecture

- `cms-api` owns REST/content/forms/preview clients; `cms-astro` owns Astro build helpers; `cms-cloudflare` owns request security and Pages-friendly helpers.
- Keep framework routes, UI, content mappers and visual SEO rendering outside these packages.
- Do not introduce Node-only APIs into Cloudflare-facing code. Never expose private CMS credentials in browser-safe paths.

## Avoid

- Do not duplicate endpoint clients, HMAC logic, sitemap/i18n helpers or preview security across packages.
- Do not add broad dependencies, hidden network effects, or undocumented export subpaths.
