import {spawn} from 'node:child_process'
import {access, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {createInterface} from 'node:readline/promises'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
	printHelp()
	process.exit(0)
}

const repoRoot = process.cwd()
const packagesRoot = path.join(repoRoot, 'packages')
const optionalModules = await readOptionalModules(repoRoot)
const optionalModuleIds = optionalModules.map((module) => module.id)
const defaultOptionalModuleIds = optionalModuleIds.filter((moduleId) => moduleId !== 'registry-github')
const presets = {
	'minimal-library': [],
	'internal-packages': defaultOptionalModuleIds,
	'public-strict': defaultOptionalModuleIds
}
const starterPackageDir = await resolveStarterPackageDir(packagesRoot)
const starterPackageName = path.basename(starterPackageDir)

const rootManifestPath = path.join(repoRoot, 'package.json')
const starterManifestPath = path.join(starterPackageDir, 'package.json')
const changesetConfigPath = path.join(repoRoot, '.changeset', 'config.json')
const rootReadmePath = path.join(repoRoot, 'README.md')
const starterReadmePath = path.join(starterPackageDir, 'README.md')

const rootManifest = await readJson(rootManifestPath)
const starterManifest = await readJson(starterManifestPath)
const changesetConfig = await readJson(changesetConfigPath)
const rootReadme = await readFile(rootReadmePath, 'utf8')
const starterReadme = await readFile(starterReadmePath, 'utf8')

const gitRepoInfo = await readGitRepositoryInfo(repoRoot)
const repoInfo = parseRepositoryUrl(rootManifest.repository?.url ?? '')
const rootNameInfo = parseScopedName(rootManifest.name)
const starterNameInfo = parseScopedName(starterManifest.name)
const defaultScope = sanitizeScope(starterNameInfo.scope || rootNameInfo.scope || gitRepoInfo.owner || '')
const defaultRepoOwner = preferTemplateSafeValue(gitRepoInfo.owner, repoInfo.owner, 'ooops-studio')
const defaultRepoName = preferTemplateSafeValue(gitRepoInfo.repo, path.basename(repoRoot), 'repo-name')
const rl = shouldPrompt(args)
	? createInterface({input: process.stdin, output: process.stdout})
	: null

try {
	const scope = await resolveValue(
		'scope',
		args.scope,
		defaultScope
	)
	const repoOwner = await resolveValue('repo-owner', args['repo-owner'], defaultRepoOwner)
	const repoName = await resolveValue('repo-name', args['repo-name'], defaultRepoName)
	const workspaceName = await resolveValue('workspace-name', args['workspace-name'], rootNameInfo.name || repoName)
	const packageName = await resolveValue('package-name', args['package-name'], starterNameInfo.name || workspaceName)
	const packageDir = await resolveValue('package-dir', args['package-dir'], packageName)
	const packageDescription = await resolveValue(
		'package-description',
		args['package-description'],
		defaultPackageDescription(starterManifest.description, packageName, repoName)
	)

	validateScope(scope)
	validatePackageSegment(workspaceName, 'workspace-name')
	validatePackageSegment(packageName, 'package-name')
	validatePackageDir(packageDir)
	validateRepositorySegment(repoOwner, 'repo-owner')
	validateRepositorySegment(repoName, 'repo-name')
	validateDescription(packageDescription)

	const values = {
		scope,
		repoOwner,
		repoName,
		workspaceName,
		packageName,
		packageDir,
		packageDescription
	}
	const moduleOptions = await resolveModuleOptions(args, rl, optionalModules)

	if (!args.dryRun && !args.yes && rl) {
		printSummary(values, starterPackageName, moduleOptions)
		const confirmation = (await rl.question('Proceed with template initialization? [y/N] ')).trim().toLowerCase()

		if (!['y', 'yes'].includes(confirmation)) {
			console.log('Aborted.')
			process.exit(1)
		}
	}

	const changedPaths = []
	const nextStarterPackageDir = path.join(packagesRoot, packageDir)

	let nextRootManifest = {
		...rootManifest,
		name: scopedName(scope, workspaceName),
		repository: {
			...(rootManifest.repository ?? {}),
			type: 'git',
			url: `https://github.com/${repoOwner}/${repoName}.git`
		}
	}
	nextRootManifest = configureRootManifest(nextRootManifest, moduleOptions, optionalModules)

	await writeJson(rootManifestPath, nextRootManifest, args.dryRun, changedPaths)

	const nextStarterManifest = configurePackageManifest({
		...starterManifest,
		name: scopedName(scope, packageName),
		description: packageDescription,
		repository: {
			...(starterManifest.repository ?? {}),
			type: 'git',
			url: `git+https://github.com/${repoOwner}/${repoName}.git`
		},
		homepage: `https://github.com/${repoOwner}/${repoName}`,
		bugs: {
			...(starterManifest.bugs ?? {}),
			url: `https://github.com/${repoOwner}/${repoName}/issues`
		}
	}, moduleOptions)

	await writeJson(starterManifestPath, nextStarterManifest, args.dryRun, changedPaths)

	const nextChangesetConfig = {
		...changesetConfig,
		changelog: ['@changesets/changelog-github', {repo: `${repoOwner}/${repoName}`}]
	}

	await writeJson(changesetConfigPath, nextChangesetConfig, args.dryRun, changedPaths)

	const exampleUpdates = [
		['examples/package-archetypes/public-package/package.json', scopedName(scope, packageName)],
		['examples/package-archetypes/private-workspace/package.json', scopedName(scope, `${packageName}-internal`)],
		['examples/package-archetypes/multi-entry-package/package.json', scopedName(scope, `${packageName}-multi`)],
		['examples/package-archetypes/adapter-package/package.json', scopedName(scope, `${packageName}-adapter`)]
	]

	for (const [relativePath, exampleName] of exampleUpdates) {
		const absolutePath = path.join(repoRoot, relativePath)
		const exampleManifest = await readJson(absolutePath)
		await writeJson(
			absolutePath,
			configurePackageManifest({...exampleManifest, name: exampleName}, moduleOptions),
			args.dryRun,
			changedPaths
		)
	}

	await writeText(
		path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
		createCiWorkflow(moduleOptions),
		args.dryRun,
		changedPaths
	)

	if (moduleOptions.enabled.has('release')) {
		await writeText(
			path.join(repoRoot, '.github', 'workflows', 'release.yml'),
			createReleaseWorkflow(moduleOptions),
			args.dryRun,
			changedPaths
		)
	}

	await writeText(
		starterReadmePath,
		starterReadme
			.replaceAll(starterManifest.name, scopedName(scope, packageName))
			.replaceAll(`packages/${starterPackageName}/`, `packages/${packageDir}/`),
		args.dryRun,
		changedPaths
	)

	await writeText(
		rootReadmePath,
		rewriteReadmeForModules(rootReadme
			.replaceAll(`packages/${starterPackageName}/`, `packages/${packageDir}/`)
			.replace(`└─ ${starterPackageName}/                         # simple public single-entry package example`, `└─ ${packageDir}/                         # simple public single-entry package example`),
		moduleOptions),
		args.dryRun,
		changedPaths
	)

	await writeText(
		path.join(repoRoot, 'SETUP.md'),
		createSetupDocument(values, moduleOptions),
		args.dryRun,
		changedPaths
	)

	await applyModuleCleanup(repoRoot, moduleOptions, optionalModules, args.dryRun, changedPaths)

	if (starterPackageDir !== nextStarterPackageDir) {
		await moveStarterPackage(starterPackageDir, nextStarterPackageDir, args.dryRun, changedPaths)
	}

	if (changedPaths.length === 0) {
		console.log('No changes were needed.')
		process.exit(0)
	}

	console.log(args.dryRun ? 'Dry run complete. Planned changes:' : 'Template initialization complete. Updated:')

	for (const changedPath of changedPaths) {
		console.log(`- ${path.relative(repoRoot, changedPath)}`)
	}

	if (!args.dryRun) {
		await verifyTemplateGuard(repoRoot)
		console.log('')
		console.log('Updating pnpm lockfile...')
		await run('pnpm', ['install', '--lockfile-only'], {cwd: repoRoot})
		console.log('')
		console.log('Next steps:')
		console.log('- Run `pnpm -w validate` to verify the bootstrapped workspace.')
	}
} finally {
	await rl?.close()
}

async function readOptionalModules(root) {
	const modulesRoot = path.join(root, 'optional-modules')
	const entries = await readdir(modulesRoot, {withFileTypes: true})
	const modules = []

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}

		const manifestPath = path.join(modulesRoot, entry.name, 'module.json')
		modules.push(JSON.parse(await readFile(manifestPath, 'utf8')))
	}

	return modules.sort((a, b) => a.id.localeCompare(b.id))
}

async function resolveModuleOptions(options, readline, modules) {
	const preset = options.preset ?? 'internal-packages'
	assert(presets[preset], `Unknown preset "${preset}". Expected one of: ${Object.keys(presets).join(', ')}`)

	let enabled = new Set(presets[preset])

	if (options.modules) {
		enabled = new Set(options.modules.split(',').map((module) => module.trim()).filter(Boolean))
	}

	for (const moduleId of enabled) {
		assert(optionalModuleIds.includes(moduleId), `Unknown optional module "${moduleId}"`)
	}

	let registry = validateRegistryStrategy(options.registry ?? (enabled.has('registry-github') ? 'github' : 'npm'))

	if (!options.yes && readline && !options.registry) {
		const answer = (await readline.question(`Package registry [npm/github/both] [${registry}]: `)).trim().toLowerCase()

		if (answer) {
			registry = validateRegistryStrategy(answer)
		}
	}

	if (registry === 'github' || registry === 'both') {
		enabled.add('registry-github')
	}

	if (!options.yes && readline && !options.modules) {
		console.log('')
		console.log(`Optional tooling preset: ${preset}`)

		for (const module of modules) {
			const defaultEnabled = enabled.has(module.id)
			const answer = (await readline.question(`Enable ${module.label}? [${defaultEnabled ? 'Y/n' : 'y/N'}] `)).trim().toLowerCase()

			if (answer === '') {
				continue
			}

			if (['y', 'yes'].includes(answer)) {
				enabled.add(module.id)
				continue
			}

			if (['n', 'no'].includes(answer)) {
				enabled.delete(module.id)
			}
		}
	}

	if (registry === 'github' || registry === 'both') {
		enabled.add('registry-github')
	}

	return {
		preset,
		enabled,
		cleanup: options.cleanup !== false,
		devAuditBlocking: preset === 'public-strict' || options['dev-audit'] === 'blocking',
		publishingMode: options['publish-auth'] ?? 'trusted-publishing',
		actionPinning: options['action-pinning'] ?? 'versions',
		registry
	}
}

function validateRegistryStrategy(value) {
	assert(['npm', 'github', 'both'].includes(value), 'registry must be one of: npm, github, both')
	return value
}

function configureRootManifest(pkg, moduleOptions, modules) {
	const next = structuredClone(pkg)
	const enabled = moduleOptions.enabled
	const scripts = {
		typecheck: "pnpm -r --filter './packages/*' run typecheck",
		lint: pkg.scripts.lint,
		test: "pnpm -r --filter './packages/*' --if-present run test",
		build: "pnpm -r --filter './packages/*' run build",
		bootstrap: 'node ./scripts/setup-template.mjs',
		'init:template': 'node ./scripts/init-template.mjs',
		'guard:template': 'node ./scripts/template-guard.mjs',
		'check:manifests': 'node ./scripts/check-package-manifests.mjs',
		'check:optional-modules': 'node ./scripts/check-optional-modules.mjs',
		'smoke:archetypes': 'node ./scripts/smoke-check-archetypes.mjs',
		'validate:ci': 'node ./scripts/validate-ci.mjs',
		prepare: 'husky'
	}

	if (enabled.has('size-limit')) {
		scripts.size = "pnpm -r --filter './packages/*' --if-present run size"
	}

	if (enabled.has('dependency-cruiser')) {
		scripts.depcruise = 'depcruise --config .dependency-cruiser.cjs packages/**/src'
	}

	if (enabled.has('publint-attw')) {
		scripts.publint = "pnpm -r --filter './packages/*' --if-present run publint"
		scripts.attw = "pnpm -r --filter './packages/*' --if-present run attw"
		scripts['check:packed-artifacts'] = 'node ./scripts/check-packed-artifacts.mjs'
	}

	if (enabled.has('package-readiness')) {
		scripts.readiness = 'node ./scripts/package-readiness.mjs'
		scripts['readiness:json'] = 'node ./scripts/package-readiness.mjs --json'
		scripts['readiness:strict'] = 'node ./scripts/package-readiness.mjs --strict'
	}

	if (enabled.has('license-policy')) {
		scripts['check:licenses'] = 'node ./scripts/check-licenses.mjs'
	}

	if (enabled.has('migration-tools')) {
		scripts['smoke:package-tools'] = 'node ./scripts/smoke-check-package-tools.mjs'
		scripts['create:package'] = 'node ./scripts/create-package.mjs'
		scripts['copy:package'] = 'node ./scripts/copy-package-from-repo.mjs'
		scripts['deprecate:package'] = 'node ./scripts/deprecate-package.mjs'
	}

	if (enabled.has('security-audit')) {
		scripts['audit:prod'] = 'pnpm audit --prod --audit-level moderate'
		scripts['audit:dev'] = 'pnpm audit --dev --audit-level moderate'
	}

	if (enabled.has('release')) {
		scripts['release:preflight'] = 'node ./scripts/release-preflight.mjs'
		scripts['publish:packages'] = 'node ./scripts/publish-packages.mjs'
		scripts.changeset = 'changeset'
	}

	scripts.validate = createValidateScript(moduleOptions)
	next.scripts = scripts

	for (const module of modules) {
		if (enabled.has(module.id)) {
			continue
		}

		for (const dependency of module.devDependencies) {
			delete next.devDependencies?.[dependency]
		}
	}

	return next
}

function createValidateScript(moduleOptions) {
	const enabled = moduleOptions.enabled
	const commands = [
		'pnpm guard:template',
		'pnpm check:manifests',
		'pnpm check:optional-modules'
	]

	if (enabled.has('license-policy')) {
		commands.push('pnpm check:licenses')
	}

	commands.push('pnpm lint', 'pnpm typecheck', 'pnpm build', 'pnpm test')

	if (enabled.has('size-limit')) {
		commands.push('pnpm size')
	}

	if (enabled.has('dependency-cruiser')) {
		commands.push('pnpm depcruise')
	}

	if (enabled.has('publint-attw')) {
		commands.push('pnpm publint', 'pnpm attw', 'pnpm check:packed-artifacts')
	}

	if (enabled.has('package-readiness')) {
		commands.push(moduleOptions.preset === 'public-strict' ? 'pnpm readiness:strict' : 'pnpm readiness')
	}

	if (enabled.has('migration-tools')) {
		commands.push('pnpm smoke:package-tools')
	}

	return commands.join(' && ')
}

function configurePackageManifest(pkg, moduleOptions) {
	const next = structuredClone(pkg)
	const enabled = moduleOptions.enabled

	if (!enabled.has('size-limit')) {
		delete next.scripts?.size
	}

	if (!enabled.has('publint-attw')) {
		delete next.scripts?.publint
		delete next.scripts?.attw
	}

	if (!enabled.has('dependency-cruiser')) {
		delete next.scripts?.depcruise
	}

	return next
}

function createCiWorkflow(moduleOptions) {
	const auditSteps = moduleOptions.enabled.has('security-audit')
		? `
      - name: Audit production dependencies
        run: pnpm -w audit:prod

      - name: Audit development dependencies
        run: pnpm -w audit:dev${moduleOptions.devAuditBlocking ? '' : '\n        continue-on-error: true'}
`
		: ''

	return `name: CI

on:
  pull_request:
  push:
    branches:
      - '**'

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Setup pnpm
        uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10
        with:
          version: 11.22.0

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22.14.0
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
${auditSteps}
      - name: Validate workspace
        run: pnpm -w validate:ci
`
}

function createReleaseWorkflow(moduleOptions) {
	return `name: Release

on:
  push:
    branches:
      - main
  workflow_dispatch:
    inputs:
      dry_run:
        description: Run release validation without publishing
        required: true
        default: true
        type: boolean

permissions:
  contents: write
  id-token: write
  packages: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    env:
      NPM_CONFIG_PROVENANCE: true
      REGISTRY_STRATEGY: ${moduleOptions.registry}

    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10
        with:
          version: 11.22.0

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22.14.0
          package-manager-cache: false
          registry-url: https://registry.npmjs.org

      - name: Upgrade npm for trusted publishing
        run: npm install --global npm@11.19.0

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Release preflight dry-run
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}
        run: pnpm -w release:preflight -- --dry-run

      - name: Release preflight
        if: \${{ github.event_name != 'workflow_dispatch' || !inputs.dry_run }}
        run: pnpm -w release:preflight

      - name: Validate workspace
        run: pnpm -w validate

      - name: Release dry-run completed
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}
        run: |
          echo "Release validation completed. Publishing was skipped because dry_run=true."

      - name: Version and publish packages
        if: \${{ github.event_name != 'workflow_dispatch' || !inputs.dry_run }}
        uses: changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1 # v2.1.1
        with:
          github-token: \${{ secrets.RELEASE_TOKEN != '' && secrets.RELEASE_TOKEN || github.token }}
          commit-message: Version Packages
          pr-title: Version Packages
          version-script: pnpm -w changeset version
          publish-script: pnpm -w publish:packages
        env:
          GITHUB_PACKAGES_TOKEN: \${{ secrets.GITHUB_PACKAGES_TOKEN }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
`
}

function rewriteReadmeForModules(readme, moduleOptions) {
	let next = readme
	next = filterReadmeLines(next, moduleOptions)

	next = replaceReadmeRange(next, '## Optional tooling installer', '## Dependency and security automation', createReadmeInstallerSection(moduleOptions))
	const toolingSection = createReadmeToolingSection(moduleOptions)
	next = replaceReadmeRange(next, '## Dependency and security automation', '## CI and release', toolingSection)
	next = replaceReadmeRange(next, '## CI and release', '## Troubleshooting', createReadmeCiSection(moduleOptions))

	return next
}

function filterReadmeLines(readme, moduleOptions) {
	const disabled = (moduleId) => !moduleOptions.enabled.has(moduleId)

	return readme
		.split('\n')
		.filter((line) => {
			if (disabled('renovate') && line.includes('renovate.json')) {
				return false
			}

			if (disabled('license-policy') && (line.includes('license-policy') || line.includes('check:licenses'))) {
				return false
			}

			if (disabled('security-audit') && (line.includes('audit:prod') || line.includes('audit:dev'))) {
				return false
			}

			if (disabled('release') && (line.includes('release:preflight') || line.includes('Changesets release') || line.includes('release.yml'))) {
				return false
			}

			if (disabled('release') && line.includes('publish:packages')) {
				return false
			}

			if (disabled('registry-github') && (line.includes('GitHub Packages') || line.includes('registry-github') || line.includes('.npmrc.example'))) {
				return false
			}

			if (disabled('migration-tools') && (line.includes('create:package') || line.includes('copy:package') || line.includes('deprecate:package') || line.includes('internal package splits'))) {
				return false
			}

			if (disabled('size-limit') && (line.includes('size-limit') || line.includes('pnpm -w size') || line.includes('"size"') || line.includes('Size:'))) {
				return false
			}

			if (disabled('publint-attw') && (line.includes('publint') || line.includes('attw'))) {
				return false
			}

			if (disabled('package-readiness') && (line.includes('readiness') || line.includes('Package readiness'))) {
				return false
			}

			if (disabled('dependency-cruiser') && (line.includes('dependency-cruiser') || line.includes('depcruise'))) {
				return false
			}

			return true
		})
		.join('\n')
}

function createReadmeInstallerSection(moduleOptions) {
	const moduleLines = optionalModules.map((module) => {
		const status = moduleOptions.enabled.has(module.id) ? 'enabled' : 'disabled'
		return `- \`${module.id}\` — ${status}; ${module.description}`
	})

	return `## Optional tooling installer

This repository was generated from a mandatory core plus optional tooling modules. Re-run \`pnpm init:template -- --dry-run\` to preview changes before reconfiguring the template.

Registry strategy: \`${moduleOptions.registry}\`

Enabled module state:

${moduleLines.join('\n')}

Disabled modules are removed by default from scripts, workflows, docs and files. Use \`--no-cleanup\` when you want to leave optional source files in place for later.

`
}

function createReadmeToolingSection(moduleOptions) {
	const sections = []

	if (moduleOptions.enabled.has('renovate')) {
		sections.push(`## Dependency automation

Renovate is enabled by default for this generated repository. It runs weekly for npm/pnpm dependencies, lockfile maintenance, and GitHub Actions updates. Automerge is disabled so maintainers review updates before merging.`)
	}

	if (moduleOptions.enabled.has('security-audit') || moduleOptions.enabled.has('license-policy')) {
		const bullets = []

		if (moduleOptions.enabled.has('security-audit')) {
			bullets.push('- `pnpm -w audit:prod` blocks CI on production advisories at `moderate` or higher.')
			bullets.push(`- \`pnpm -w audit:dev\` ${moduleOptions.devAuditBlocking ? 'blocks CI' : 'runs in CI as a warning/non-blocking job'} for development dependency advisories.`)
		}

		if (moduleOptions.enabled.has('license-policy')) {
			bullets.push('- `pnpm -w check:licenses` blocks validation when installed packages use licenses outside `license-policy.json`.')
		}

		sections.push(`## Security checks

${bullets.join('\n')}`)
	}

	if (moduleOptions.enabled.has('release')) {
		sections.push(`## Release safety

Release supports classic \`NPM_TOKEN\` and npm trusted publishing for npm, plus GitHub Packages publishing when the registry strategy is \`github\` or \`both\`. Before publishing, \`pnpm -w release:preflight\` verifies that the required credentials for \`${moduleOptions.registry}\` are present. The release workflow also supports manual \`workflow_dispatch\` with \`dry_run=true\` for validation without publishing.

Recommended branch protection:

- Protect \`main\`.
- Require CI to pass before merge.
- Require review for release PRs generated by Changesets.
- Disable direct pushes to \`main\`.`)
	}

	if (moduleOptions.enabled.has('package-readiness')) {
		sections.push(`## Package readiness

Package readiness is enabled as ${moduleOptions.preset === 'public-strict' ? 'a strict release gate' : 'an advisory report'}. It summarizes package metadata, docs, export surface, packed size, quality scripts, changeset state and public-facing leakage warnings.

\`\`\`sh
pnpm -w readiness
pnpm -w readiness:json
pnpm -w readiness:strict
\`\`\`

Use \`package-readiness.config.json\` to adjust thresholds for large intentional packages, for example service suites with many public subpaths.`)
	}

	if (moduleOptions.enabled.has('registry-github')) {
		sections.push(`## GitHub Packages

GitHub Packages support is enabled with registry strategy \`${moduleOptions.registry}\`. Keep package manifests registry-neutral: do not add \`publishConfig.registry\`, because \`both\` needs to publish the same package version to more than one registry.

Checklist:

- Package names should be scoped to the GitHub owner or organization scope.
- Release workflows need \`packages: write\`.
- Private/internal consumers need npm auth, usually via \`.npmrc\` or CI user config.
- Use \`GITHUB_PACKAGES_TOKEN\` when a dedicated package token is preferred; otherwise the workflow can use \`GITHUB_TOKEN\`.`)
	}

	if (moduleOptions.enabled.has('migration-tools')) {
		sections.push(`## For internal package splits

This template can extract reusable packages from larger monorepos into focused package repos, for example \`ooops-suite\` to \`ooops-cms-packages\` or \`ooops-analytics-packages\`.

\`\`\`sh
pnpm -w copy:package -- --from ../ooops-suite/packages/cms-api
pnpm -w create:package -- --name @your-scope/new-package --archetype public-package
pnpm -w deprecate:package -- --package @your-scope/old-package
\`\`\`

Migration scripts support dry-run behavior and never commit changes. The deprecation helper is dry-run by default and only calls \`npm deprecate\` when \`--execute\` is passed.`)
	}

	if (sections.length === 0) {
		return ''
	}

	return `${sections.join('\n\n')}\n\n`
}

function createReadmeCiSection(moduleOptions) {
	const lines = [
		'## CI and release',
		'',
		'The bundled GitHub Actions workflows are local to the repository.',
		'',
		'- CI uses `pnpm -w validate:ci`, which is template-aware:',
		'  - before bootstrap it runs a template-safe profile so the fresh template repo stays green',
		'  - after bootstrap it automatically runs the full `pnpm -w validate` pipeline'
	]

	if (moduleOptions.enabled.has('security-audit')) {
		lines.push(`- CI also runs \`pnpm -w audit:prod\` as blocking and \`pnpm -w audit:dev\` as ${moduleOptions.devAuditBlocking ? 'blocking' : 'non-blocking'}.`)
	}

	if (moduleOptions.enabled.has('release')) {
		lines.push('- Release stays strict and always uses `pnpm -w validate`.')
		lines.push('- Release runs `pnpm -w release:preflight` before publish and supports manual dry-run validation through `workflow_dispatch`.')
		lines.push(`- Package publishing uses registry strategy \`${moduleOptions.registry}\`.`)
	}

	return `${lines.join('\n')}\n\n`
}

function replaceReadmeRange(readme, startHeading, endHeading, replacement) {
	const start = readme.indexOf(startHeading)
	const end = readme.indexOf(endHeading)

	if (start === -1 || end === -1 || end <= start) {
		return readme
	}

	return `${readme.slice(0, start)}${replacement}${readme.slice(end)}`
}

function createSetupDocument(values, moduleOptions) {
	const enabledModules = optionalModules
		.filter((module) => moduleOptions.enabled.has(module.id))
		.map((module) => `- ${module.label} (\`${module.id}\`)`)

	const releaseChecklist = moduleOptions.enabled.has('release')
		? createReleaseChecklist(moduleOptions)
		: ['- Release module disabled. Add release tooling later if this repo will publish packages.']

	const securityChecklist = [
		moduleOptions.enabled.has('security-audit') ? '- Production dependency audit enabled.' : '- Security audit module disabled.',
		moduleOptions.enabled.has('license-policy') ? '- License policy check enabled.' : '- License policy module disabled.',
		moduleOptions.enabled.has('package-readiness') ? `- Package readiness enabled in ${moduleOptions.preset === 'public-strict' ? 'strict' : 'advisory'} mode.` : '- Package readiness module disabled.',
		moduleOptions.actionPinning === 'sha' ? '- GitHub Actions SHA pinning selected; replace version-pinned actions with commit SHAs.' : '- GitHub Actions use version-pinned actions by default.'
	]

	return `# Setup

Generated by \`pnpm init:template\`.

## Project

- Workspace: \`${scopedName(values.scope, values.workspaceName)}\`
- Starter package: \`${scopedName(values.scope, values.packageName)}\`
- Repository: \`https://github.com/${values.repoOwner}/${values.repoName}\`
- Preset: \`${moduleOptions.preset}\`
- Publish auth preference: \`${moduleOptions.publishingMode}\`
- Registry strategy: \`${moduleOptions.registry}\`

## Enabled modules

${enabledModules.length > 0 ? enabledModules.join('\n') : '- No optional tooling modules enabled.'}

## Release checklist

${releaseChecklist.join('\n')}

## CI and security checklist

${securityChecklist.join('\n')}

## Next steps

- Run \`pnpm install\`.
- Run \`pnpm -w validate:ci\`.
- If package readiness reports large intentional packages, add package-specific overrides in \`package-readiness.config.json\`.
- Review package README files and package metadata before the first release.
`
}

function createReleaseChecklist(moduleOptions) {
	const checklist = [
		'- Protect `main` and require CI before merge.',
		'- Run the Release workflow with `dry_run=true` before the first publish.'
	]

	if (moduleOptions.registry === 'npm' || moduleOptions.registry === 'both') {
		checklist.unshift('- Configure npm trusted publishing or `NPM_TOKEN`.')
	}

	if (moduleOptions.registry === 'github' || moduleOptions.registry === 'both') {
		checklist.unshift('- Confirm package scopes match the GitHub owner or organization.')
		checklist.unshift('- Configure `GITHUB_PACKAGES_TOKEN` if `GITHUB_TOKEN` is not enough for your package policy.')
	}

	return checklist
}

async function applyModuleCleanup(root, moduleOptions, modules, dryRun, changedPaths) {
	if (!moduleOptions.cleanup) {
		return
	}

	for (const module of modules) {
		if (moduleOptions.enabled.has(module.id)) {
			continue
		}

		for (const file of module.files) {
			await removePath(path.join(root, file), dryRun, changedPaths)
		}

		await removePath(path.join(root, 'optional-modules', module.id), dryRun, changedPaths)
	}
}

async function removePath(filePath, dryRun, changedPaths) {
	if (!await fileExists(filePath)) {
		return
	}

	if (!dryRun) {
		await rm(filePath, {recursive: true, force: true})
	}

	changedPaths.push(filePath)
}

async function resolveStarterPackageDir(root) {
	const preferredDir = path.join(root, 'demo')

	if (await fileExists(path.join(preferredDir, 'package.json'))) {
		return preferredDir
	}

	const entries = await readdir(root, {withFileTypes: true})
	const packageDirs = []

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}

		const candidate = path.join(root, entry.name)

		if (await fileExists(path.join(candidate, 'package.json'))) {
			packageDirs.push(candidate)
		}
	}

	if (packageDirs.length === 1) {
		return packageDirs[0]
	}

	throw new Error('Could not determine the starter package directory. Expected packages/demo or exactly one package under packages/.')
}

async function resolveValue(flagName, cliValue, fallbackValue) {
	if (cliValue) {
		return cliValue.trim()
	}

	if (!rl) {
		throw new Error(`Missing required option --${flagName}. Run pnpm init:template --help for non-interactive usage.`)
	}

	const suffix = fallbackValue ? ` [${fallbackValue}]` : ''
	const answer = (await rl.question(`${labelFor(flagName)}${suffix}: `)).trim()

	return answer || fallbackValue
}

function shouldPrompt(options) {
	return !options.yes && process.stdin.isTTY && process.stdout.isTTY
}

function printSummary(values, currentStarterPackageName, moduleOptions) {
	console.log('')
	console.log('Bootstrap summary')
	console.log(`- Workspace package: ${scopedName(values.scope, values.workspaceName)}`)
	console.log(`- Starter package: ${scopedName(values.scope, values.packageName)}`)
	console.log(`- Starter directory: packages/${currentStarterPackageName} -> packages/${values.packageDir}`)
	console.log(`- Repository: https://github.com/${values.repoOwner}/${values.repoName}`)
	console.log(`- Tooling preset: ${moduleOptions.preset}`)
	console.log(`- Registry strategy: ${moduleOptions.registry}`)
	console.log(`- Enabled modules: ${[...moduleOptions.enabled].join(', ') || 'none'}`)
	console.log(`- Cleanup disabled modules: ${moduleOptions.cleanup ? 'yes' : 'no'}`)
	console.log('')
}

function defaultPackageDescription(currentDescription, packageName, repoName) {
	if (currentDescription && !/archetype|template/i.test(currentDescription)) {
		return currentDescription
	}

	if (packageName && repoName) {
		return `${packageName} package for the ${repoName} npm package workspace.`
	}

	if (packageName) {
		return `${packageName} package.`
	}

	return 'Package description.'
}

function sanitizeScope(value) {
	return value.replace(/^@/, '').trim()
}

function preferTemplateSafeValue(primaryValue, secondaryValue, placeholderValue) {
	if (primaryValue && primaryValue !== placeholderValue) {
		return primaryValue
	}

	if (secondaryValue && secondaryValue !== placeholderValue) {
		return secondaryValue
	}

	return ''
}

function scopedName(scope, name) {
	return `@${scope}/${name}`
}

function parseScopedName(value) {
	const match = /^@([^/]+)\/(.+)$/.exec(value ?? '')

	if (!match || /<.+>/.test(value ?? '')) {
		return {scope: '', name: ''}
	}

	return {scope: match[1], name: match[2]}
}

function parseRepositoryUrl(value) {
	const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(value)

	if (!match) {
		return {owner: '', repo: ''}
	}

	return {
		owner: match[1],
		repo: match[2]
	}
}

function validateScope(value) {
	assert(/^[a-z0-9][a-z0-9._-]*$/.test(value), 'scope must be a valid npm scope segment without "@"')
}

function validatePackageSegment(value, label) {
	assert(/^[a-z0-9][a-z0-9._-]*$/.test(value), `${label} must be a valid npm package segment`)
}

function validatePackageDir(value) {
	assert(/^[a-z0-9][a-z0-9._-]*$/.test(value), 'package-dir must be a single path segment')
}

function validateRepositorySegment(value, label) {
	assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value), `${label} must contain only letters, numbers, dots, underscores, or hyphens`)
}

function validateDescription(value) {
	assert(typeof value === 'string' && value.trim().length > 0, 'package-description is required')
}

async function moveStarterPackage(fromDir, toDir, dryRun, changedPaths) {
	if (dryRun) {
		changedPaths.push(toDir)
		return
	}

	await rename(fromDir, toDir)
	changedPaths.push(toDir)
}

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeJson(filePath, data, dryRun, changedPaths) {
	const currentText = await readFile(filePath, 'utf8')
	const nextText = `${JSON.stringify(data, null, detectIndent(currentText))}\n`
	await writeText(filePath, nextText, dryRun, changedPaths)
}

async function writeText(filePath, nextText, dryRun, changedPaths) {
	let currentText = ''

	try {
		currentText = await readFile(filePath, 'utf8')
	} catch(error) {
		if (error.code !== 'ENOENT') {
			throw error
		}
	}

	if (currentText === nextText) {
		return
	}

	if (!dryRun) {
		await writeFile(filePath, nextText)
	}

	changedPaths.push(filePath)
}

async function verifyTemplateGuard(root) {
	try {
		await run(process.execPath, [path.join(root, 'scripts', 'template-guard.mjs')], {cwd: root})
		console.log('')
		console.log('Template guard passed.')
	} catch(error) {
		console.log('')
		console.log('Template guard still reports remaining placeholders:')
		console.log(error.message)
	}
}

function detectIndent(content) {
	const match = /^(\s+)"[^"]+":/m.exec(content)
	return match?.[1] ?? '\t'
}

async function fileExists(filePath) {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

async function readGitRepositoryInfo(root) {
	try {
		const {stdout} = await run('git', ['remote', 'get-url', 'origin'], {
			cwd: root,
			capture: true
		})
		return parseRepositoryUrl(stdout.trim())
	} catch {
		return {owner: '', repo: ''}
	}
}

function labelFor(flagName) {
	return {
		scope: 'npm scope',
		'repo-owner': 'GitHub owner or org',
		'repo-name': 'repository name',
		'workspace-name': 'workspace package name',
		'package-name': 'starter package name',
		'package-dir': 'starter package directory',
		'package-description': 'starter package description'
	}[flagName]
}

function parseArgs(argv) {
	const result = {
		dryRun: false,
		yes: false,
		help: false,
		cleanup: true
	}

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]

		if (argument === '--') {
			continue
		}

		if (argument === '--dry-run') {
			result.dryRun = true
			continue
		}

		if (argument === '--yes') {
			result.yes = true
			continue
		}

		if (argument === '--no-cleanup') {
			result.cleanup = false
			continue
		}

		if (argument === '--help' || argument === '-h') {
			result.help = true
			continue
		}

		if (!argument.startsWith('--')) {
			throw new Error(`Unexpected argument "${argument}". Run pnpm init:template --help for usage.`)
		}

		const [rawKey, inlineValue] = argument.slice(2).split('=')
		const key = rawKey

		if (inlineValue !== undefined) {
			result[key] = inlineValue
			continue
		}

		const nextValue = argv[index + 1]
		assert(nextValue && !nextValue.startsWith('--'), `Missing value for --${key}`)
		result[key] = nextValue
		index += 1
	}

	return result
}

function run(command, args, options) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
			env: process.env
		})

		let stdout = ''
		let stderr = ''

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString()
		})

		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString()
		})

		child.on('close', (code) => {
			if (code === 0) {
				resolve({stdout, stderr})
				return
			}

			reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}\n${stderr || stdout}`))
		})
	})
}

function printHelp() {
	console.log(`Bootstrap a generated repository by replacing the controlled template placeholders.

Usage:
  pnpm init:template
  pnpm init:template --scope acme --repo-owner acme --repo-name platform --workspace-name platform --package-name sdk --package-dir sdk --package-description "SDK package"

Options:
  --scope                 npm scope without "@"
  --repo-owner            GitHub user or organization
  --repo-name             GitHub repository name
  --workspace-name        root workspace package name
  --package-name          starter package name
  --package-dir           starter package directory under packages/
  --package-description   starter package description
  --preset                minimal-library, internal-packages, or public-strict
  --modules               comma-separated optional modules to enable
  --no-cleanup            keep disabled optional module files in the generated repo
  --dev-audit             warning or blocking
  --publish-auth          trusted-publishing or npm-token
  --registry              npm, github, or both
  --action-pinning        versions or sha
  --dry-run               print the planned changes without writing files
  --yes                   skip the interactive confirmation
  --help, -h              show this message
`)
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}
