import {access, readFile, readdir} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const modulesRoot = path.join(repoRoot, 'optional-modules')
const rootManifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const moduleDirs = await readdir(modulesRoot, {withFileTypes: true})
const ids = new Set()

for (const entry of moduleDirs) {
	if (!entry.isDirectory()) {
		continue
	}

	const manifestPath = path.join(modulesRoot, entry.name, 'module.json')
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

	assert(manifest.id === entry.name, `${relative(manifestPath)} id must match directory name`)
	assert(!ids.has(manifest.id), `Duplicate optional module id "${manifest.id}"`)
	ids.add(manifest.id)

	for (const field of ['label', 'description']) {
		assert(typeof manifest[field] === 'string' && manifest[field].trim(), `${relative(manifestPath)} requires "${field}"`)
	}

	for (const field of ['files', 'scripts', 'devDependencies']) {
		assert(Array.isArray(manifest[field]), `${relative(manifestPath)} "${field}" must be an array`)
	}

	for (const file of manifest.files) {
		await access(path.join(repoRoot, file))
	}

	for (const script of manifest.scripts) {
		assert(rootManifest.scripts?.[script], `${relative(manifestPath)} references missing root script "${script}"`)
	}

	for (const dependency of manifest.devDependencies) {
		assert(rootManifest.devDependencies?.[dependency], `${relative(manifestPath)} references missing devDependency "${dependency}"`)
	}
}

console.log(`Validated ${ids.size} optional module manifests.`)

function assert(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}

function relative(filePath) {
	return path.relative(repoRoot, filePath)
}
