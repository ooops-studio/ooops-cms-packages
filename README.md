# Ooops CMS Packages

Public, ESM-only integration packages for consuming Ooops CMS from applications and Astro sites.

## Packages

- `@ooopsstudio/cms-api`: typed read, preview, forms and media clients.
- `@ooopsstudio/cms-astro`: Astro-oriented content, locale, SEO and sitemap helpers.
- `@ooopsstudio/cms-cloudflare`: Cloudflare preview, webhook verification and rebuild helpers.

The packages are deliberately separate from the CMS application. They expose stable consumer contracts without importing application internals or owning CMS data.

## Requirements

- Node.js `>=22.14.0`
- pnpm `11.13.0`

## Development

```sh
pnpm install --frozen-lockfile
pnpm validate
```

Use package-scoped commands while iterating:

```sh
pnpm --filter @ooopsstudio/cms-api test
pnpm --filter @ooopsstudio/cms-astro test
pnpm --filter @ooopsstudio/cms-cloudflare test
```

The strict validation pipeline runs manifest and license guards, lint, type checks, builds, tests, size limits, dependency boundaries, packed-consumer checks, Publint, ATTW and release readiness.

## Package boundaries

- `cms-api` owns transport-neutral CMS client behavior.
- `cms-astro` may depend on `cms-api`, but it must not duplicate client or authentication behavior.
- `cms-cloudflare` owns Cloudflare-specific preview and webhook adapters.
- Browser code must never receive private CMS tokens.
- CMS application source remains in the separate `ooops-cms` repository.

## Local consumers

During local development, sibling repositories may override these packages with paths under `../ooops-cms-packages/packages/*`. Published consumers must use semver package versions.

## Release

Changesets control package versions and npm publishing. The dependency order is:

1. `@ooopsstudio/cms-api`
2. `@ooopsstudio/cms-astro` and `@ooopsstudio/cms-cloudflare`

Before the first publish, configure npm trusted publishing for `ooops-studio/ooops-cms-packages`, protect `main`, and run the Release workflow with `dry_run=true`.

## License

MIT, Copyright 2026 Ooops Design Studio.
