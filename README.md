# packages-monorepo-template

Opinionated TypeScript + pnpm template for publishable npm package workspaces. It stays generic at the root and pushes package complexity into package-local scripts and config so the repo can grow from a simple library into more advanced multi-package systems.

## Requirements

- Node 20.x or 22.x
- pnpm 10.20.0

## Quick start

1. Use this repository as a GitHub template.
2. Clone your new repository.
3. Run `pnpm bootstrap`.
   - This runs `pnpm install`, bootstraps the controlled template placeholders, and uses git and folder-name defaults when it can.
   - Use `pnpm bootstrap --help` for non-interactive flags, `--dry-run`, or `--skip-install`.
4. If pnpm warns that build scripts were ignored, run `pnpm approve-builds` and approve the packages your environment requires before the first build.
5. Run `pnpm -w validate`.

Fresh template repos stay green in GitHub Actions before bootstrap. CI automatically runs a template-safe profile until the placeholders are replaced, then it promotes itself to the full `validate` pipeline.

## Workspace contract

The root workspace orchestrates packages. Packages own their own tool choices.

Required package scripts:

- `typecheck`
- `build`

Optional package scripts:

- `test`
- `size`
- `publint`
- `attw`

That means the root contract scales without assuming that every package has one entrypoint, one export map shape, or one publish profile.

## What’s inside

- Shared TypeScript base config
- Shared ESLint flat config
- Shared Vitest base config for package-local merges
- Generic dependency-cruiser baseline
- Local CI and release workflows
- Template guard for unreplaced publish-facing placeholders
- Demo package showing the simplest public package shape
- Non-workspace archetype examples for more advanced package shapes

## Workspace layout

```text
.
├─ packages/
│  └─ stage-api/                         # simple public single-entry package example
├─ examples/package-archetypes/     # non-workspace archetype examples
├─ scripts/template-guard.mjs       # fails fast while manifest placeholders remain
├─ scripts/smoke-check-archetypes.mjs
├─ scripts/create-package.mjs
├─ scripts/copy-package-from-repo.mjs
├─ scripts/deprecate-package.mjs
├─ scripts/package-readiness.mjs
├─ package-readiness.config.json
├─ renovate.json                    # dependency update automation
├─ license-policy.json              # allowed dependency licenses
├─ .github/workflows/ci.yml         # local CI workflow
├─ .github/workflows/release.yml    # local Changesets release workflow
├─ tsconfig.base.json               # shared TS defaults
├─ eslint.config.js                 # shared lint defaults
├─ vitest.config.ts                 # shared test defaults
└─ .dependency-cruiser.cjs          # generic graph rules
```

## Common scripts

- `pnpm -w lint` — lint shared root files plus package and example config files
- `pnpm -w typecheck` — run required package `typecheck` scripts recursively
- `pnpm -w build` — run required package `build` scripts recursively
- `pnpm -w test` — run package `test` scripts when present
- `pnpm -w size` — run package `size` scripts when present
- `pnpm -w depcruise` — run dependency-cruiser against workspace source
- `pnpm bootstrap` — install dependencies and run the template bootstrap flow in one command
- `pnpm init:template` — replace the controlled template placeholders, update repository metadata, and optionally rename the starter package directory
- `pnpm -w check:manifests` — validate package manifest policy for public and private workspace packages
- `pnpm -w publint` — run package `publint` scripts when present
- `pnpm -w attw` — run package `attw` scripts when present
- `pnpm -w check:packed-artifacts` — pack each publishable package, install the tarball into a temp consumer, and verify imports, types, and tarball contents
- `pnpm -w readiness` — generate an advisory package-readiness report
- `pnpm -w readiness:json` — emit the package-readiness report as JSON
- `pnpm -w readiness:strict` — fail on packages that need review or are blocked
- `pnpm -w check:licenses` — verify installed dependency licenses against `license-policy.json`
- `pnpm -w audit:prod` — blocking production dependency audit
- `pnpm -w audit:dev` — development dependency audit; CI runs it as non-blocking warning by default
- `pnpm -w release:preflight` — verify publish credentials or trusted publishing assumptions before release
- `pnpm -w publish:packages -- --dry-run` — preview the registry-aware package publish targets without publishing
- `pnpm -w create:package -- --name @your-scope/example --archetype public-package` — create a new package from an archetype
- `pnpm -w copy:package -- --from ../other-repo/packages/example` — copy a package from another monorepo and normalize obvious workspace-only fields
- `pnpm -w deprecate:package -- --package @your-scope/old-package` — dry-run npm deprecation guidance for a package; add `--execute` to run `npm deprecate`
- `pnpm -w validate:ci` — run template-safe CI before bootstrap and automatically switch to full `validate` after bootstrap
- `pnpm -w guard:template` — fail fast if publish-facing manifests still contain placeholders
- `pnpm -w smoke:archetypes` — verify the documented package archetype examples stay in sync
- `pnpm -w validate` — the strict initialized-repo quality contract used locally and in release workflows

Filter by package: `pnpm -w -F @your-scope/<pkg> <script>`

## Package archetypes

The template supports four generic package shapes without making the repo domain-specific:

- **Public package**: publishable single-entry library. See `packages/stage-api/` and `examples/package-archetypes/public-package/`.
- **Private workspace package**: internal support code that participates in required checks but omits publish-oriented scripts. See `examples/package-archetypes/private-workspace/`.
- **Multi-entry package**: one package with multiple public subpaths and package-local entry mapping. See `examples/package-archetypes/multi-entry-package/`.
- **Adapter package**: publishable package with peer dependencies and package-local overrides. See `examples/package-archetypes/adapter-package/`.

These examples are intentionally not part of the workspace. They document supported expansion paths without forcing those shapes into every generated repo.

## Shared defaults and package-local overrides

The root configs are shared defaults, not rigid rules.

Use package-local config when a package needs to diverge:

- **Vitest**: create `packages/<name>/vitest.config.ts` and merge from the root base.
- **tsup**: keep build entry maps in `packages/<name>/tsup.config.ts`.
- **size-limit**: use `.json` for simple packages and `.mjs` when the config needs logic or multiple budgets.
- **peer dependencies**: declare them only in the packages that need adapter-style host integration.
- **dependency-cruiser layering**: extend the generic baseline with repo-specific import rules when your package graph needs stricter architecture enforcement.

## Publish safety checks

The template includes two generic publish-oriented checks beyond `publint` and `attw`:

- **Manifest policy** checks package metadata for publishable packages:
  - `license`
  - `repository`
  - `homepage`
  - `bugs.url`
  - `engines.node`
  - `files`
  - `exports`
  - `publishConfig.access` for scoped public packages
- **Packed artifact smoke test** verifies the actual tarball:
  - `pnpm pack` succeeds
  - the tarball contains built files under `dist/`
  - the tarball omits `src/`, `test/`, and `coverage/`
  - a temp consumer can install the tarball
  - Node can import every exported specifier
  - TypeScript can resolve every exported specifier

## When to override root defaults

Stay with the root defaults when the package is a straightforward library.

Override locally when the package has one of these traits:

- multiple public subpath exports
- browser vs server entrypoints
- peer dependencies
- special size budgets
- stricter or package-specific test setup
- custom dependency-layering rules

The root should stay orchestration-only. Package-specific complexity should stay package-local.

## Adding a new package

Start with the minimum package interface:

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "tsup"
  }
}
```

Then add optional scripts only if the package needs them:

```json
{
  "scripts": {
    "test": "vitest run",
    "size": "size-limit --config .size-limit.json",
    "publint": "publint",
    "attw": "attw --pack --ignore-rules no-resolution --ignore-rules cjs-resolves-to-esm"
  }
}
```

Use the archetype examples when choosing a package shape instead of copying the demo package blindly.

## Optional tooling installer

This repository was generated from a mandatory core plus optional tooling modules. Re-run `pnpm init:template -- --dry-run` to preview changes before reconfiguring the template.

Registry strategy: `npm`

Enabled module state:

- `dependency-cruiser` — enabled; Dependency graph architecture checks.
- `license-policy` — enabled; Dependency license policy, checker script, and schema.
- `migration-tools` — enabled; Scripts for creating packages and copying packages from another monorepo.
- `package-readiness` — enabled; Advisory or strict release-readiness reports for publishable packages.
- `publint-attw` — enabled; publint and Are The Types Wrong package compatibility checks.
- `registry-github` — disabled; Optional GitHub Packages publishing and consumer registry documentation.
- `release` — enabled; Changesets release workflow, publish preflight, and release documentation.
- `renovate` — enabled; Weekly dependency update automation for npm, pnpm lockfile, and GitHub Actions.
- `security-audit` — enabled; Production and development dependency audit scripts and CI jobs.
- `size-limit` — enabled; Package-level size-limit scripts, configs, and dev dependencies.

Disabled modules are removed by default from scripts, workflows, docs and files. Use `--no-cleanup` when you want to leave optional source files in place for later.

## Dependency automation

Renovate is enabled by default for this generated repository. It runs weekly for npm/pnpm dependencies, lockfile maintenance, and GitHub Actions updates. Automerge is disabled so maintainers review updates before merging.

## Security checks

- `pnpm -w audit:prod` blocks CI on production advisories at `moderate` or higher.
- `pnpm -w audit:dev` blocks CI for development dependency advisories.
- `pnpm -w check:licenses` blocks validation when installed packages use licenses outside `license-policy.json`.

## Release safety

Release supports classic `NPM_TOKEN` and npm trusted publishing for npm, plus GitHub Packages publishing when the registry strategy is `github` or `both`. Before publishing, `pnpm -w release:preflight` verifies that the required credentials for `npm` are present. The release workflow also supports manual `workflow_dispatch` with `dry_run=true` for validation without publishing.

Recommended branch protection:

- Protect `main`.
- Require CI to pass before merge.
- Require review for release PRs generated by Changesets.
- Disable direct pushes to `main`.

## Package readiness

Package readiness is enabled as a strict release gate. It summarizes package metadata, docs, export surface, packed size, quality scripts, changeset state and public-facing leakage warnings.

```sh
pnpm -w readiness
pnpm -w readiness:json
pnpm -w readiness:strict
```

Use `package-readiness.config.json` to adjust thresholds for large intentional packages, for example service suites with many public subpaths.

## For internal package splits

This template can extract reusable packages from larger monorepos into focused package repos, for example `ooops-suite` to `ooops-stage-packages` or `ooops-analytics-packages`.

```sh
pnpm -w copy:package -- --from ../ooops-suite/packages/stage-api
pnpm -w create:package -- --name @your-scope/new-package --archetype public-package
pnpm -w deprecate:package -- --package @your-scope/old-package
```

Migration scripts support dry-run behavior and never commit changes. The deprecation helper is dry-run by default and only calls `npm deprecate` when `--execute` is passed.

## CI and release

The bundled GitHub Actions workflows are local to the repository.

- CI uses `pnpm -w validate:ci`, which is template-aware:
  - before bootstrap it runs a template-safe profile so the fresh template repo stays green
  - after bootstrap it automatically runs the full `pnpm -w validate` pipeline
- CI also runs `pnpm -w audit:prod` as blocking and `pnpm -w audit:dev` as blocking.
- Release stays strict and always uses `pnpm -w validate`.
- Release runs `pnpm -w release:preflight` before publish and supports manual dry-run validation through `workflow_dispatch`.
- Package publishing uses registry strategy `npm`.

## Troubleshooting

- **“I want the shortest possible onboarding path.”**  
  Run `pnpm bootstrap`. It installs dependencies, infers defaults from git and the current folder name when possible, then runs the same bootstrap flow as `pnpm init:template`.

- **“I want to bootstrap the generated repo without editing files manually.”**  
  Run `pnpm init:template`. It prompts for scope, repository, package names, and starter package directory, and it can run non-interactively with flags or preview changes with `--dry-run`.

- **“Install warned that build scripts were ignored.”**  
  Run `pnpm approve-builds` and approve the packages your environment needs, or configure pnpm’s build-script policy for CI and local development.

- **“validate fails immediately with placeholder errors.”**  
  Replace the placeholder values in the manifest files called out by `pnpm -w guard:template`.

- **“GitHub Actions is not permitted to create or approve pull requests.”**  
  Add a PAT with `repo` scope as `RELEASE_TOKEN`. The bundled release workflow already prefers it over the default `github.token`.

- **“A package needs more complex config than the demo package.”**  
  Use one of the archetype examples under `examples/package-archetypes/` and keep the extra complexity inside that package.

## License

MIT (change as needed).
