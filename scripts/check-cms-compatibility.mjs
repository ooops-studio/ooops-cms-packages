import {readFile} from 'node:fs/promises'
import process from 'node:process'
import {isDeepStrictEqual} from 'node:util'

const localContractUrl = new URL('../docs/cms-api-v1.openapi.json', import.meta.url)
const source = process.argv[2] ?? 'https://cms.ooops.studio/api/cms/v1/openapi.json'

const [expected, actual] = await Promise.all([
	readJson(localContractUrl),
	readJson(source)
])

if (!isDeepStrictEqual(sortJson(expected), sortJson(actual))) {
	console.error(`CMS compatibility check failed: ${source} differs from docs/cms-api-v1.openapi.json.`)
	process.exit(1)
}

const pathCount = Object.keys(actual.paths ?? {}).length
console.log(`CMS compatibility check passed: ${source} matches ${pathCount} OpenAPI paths.`)

async function readJson(input) {
	if (input instanceof URL && input.protocol === 'file:') {
		return JSON.parse(await readFile(input, 'utf8'))
	}
	if (typeof input === 'string' && /^https?:\/\//.test(input)) {
		const response = await fetch(input, {
			headers: {accept: 'application/json'},
			signal: AbortSignal.timeout(15_000)
		})
		if (!response.ok) throw new Error(`Could not fetch ${input}: HTTP ${response.status}`)
		return response.json()
	}
	return JSON.parse(await readFile(String(input), 'utf8'))
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson)
	if (!value || typeof value !== 'object') return value
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => [key, sortJson(nested)])
	)
}
