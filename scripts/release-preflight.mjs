import process from 'node:process'

const args = parseArgs(process.argv.slice(2))
const isDryRun = args['dry-run'] === true
const registry = validateRegistry(args.registry ?? process.env.REGISTRY_STRATEGY ?? 'npm')
const hasNpmToken = Boolean(process.env.NPM_TOKEN)
const hasTrustedPublishingSignals = Boolean(
	process.env.GITHUB_ACTIONS === 'true'
	&& process.env.NPM_CONFIG_PROVENANCE === 'true'
)
const hasGitHubPackagesToken = Boolean(
	process.env.GITHUB_PACKAGES_TOKEN || process.env.GITHUB_TOKEN
)

const checks = {
	npm: [
		{
			ok: hasNpmToken || hasTrustedPublishingSignals,
			message: 'npm publishing needs either NPM_TOKEN or npm trusted publishing with GitHub OIDC/provenance enabled.'
		}
	],
	github: [
		{
			ok: hasGitHubPackagesToken,
			message: 'GitHub Packages publishing needs GITHUB_PACKAGES_TOKEN or GITHUB_TOKEN.'
		}
	],
	both: [
		{
			ok: hasNpmToken || hasTrustedPublishingSignals,
			message: 'npm publishing needs either NPM_TOKEN or npm trusted publishing with GitHub OIDC/provenance enabled.'
		},
		{
			ok: hasGitHubPackagesToken,
			message: 'GitHub Packages publishing needs GITHUB_PACKAGES_TOKEN or GITHUB_TOKEN.'
		}
	]
}[registry]

console.log(`Release preflight${isDryRun ? ' dry-run' : ''}:`)
console.log(`- registry strategy: ${registry}`)
console.log(`- NPM_TOKEN present: ${hasNpmToken ? 'yes' : 'no'}`)
console.log(`- trusted publishing signals present: ${hasTrustedPublishingSignals ? 'yes' : 'no'}`)
console.log(`- GitHub Packages token present: ${hasGitHubPackagesToken ? 'yes' : 'no'}`)

if (isDryRun) {
	console.log('- publish step will be skipped by the workflow dry-run path')
	process.exit(0)
}

const failures = checks.filter((check) => !check.ok)

if (failures.length > 0) {
	console.error('Release preflight failed.')

	for (const failure of failures) {
		console.error(`- ${failure.message}`)
	}

	process.exit(1)
}

console.log('Release preflight passed.')

function parseArgs(argv) {
	const parsed = {}

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]

		if (!argument.startsWith('--')) {
			throw new Error(`Unexpected argument "${argument}"`)
		}

		const [key, inlineValue] = argument.slice(2).split('=')

		if (inlineValue !== undefined) {
			parsed[key] = inlineValue
			continue
		}

		const nextValue = argv[index + 1]

		if (!nextValue || nextValue.startsWith('--')) {
			parsed[key] = true
			continue
		}

		parsed[key] = nextValue
		index += 1
	}

	return parsed
}

function validateRegistry(value) {
	if (!['npm', 'github', 'both'].includes(value)) {
		throw new Error('Registry strategy must be one of: npm, github, both.')
	}

	return value
}
