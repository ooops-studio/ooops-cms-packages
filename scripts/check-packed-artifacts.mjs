import {spawn} from 'node:child_process'
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const packagesRoot = path.join(repoRoot, 'packages')
const packages = await getPublishablePackages(packagesRoot)
const typescriptCli = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

for (const pkgInfo of packages) {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'packages-monorepo-template-pack-'))

	try {
		const tarballDir = path.join(tempRoot, 'tarballs')
		await run('pnpm', ['pack', '--pack-destination', tarballDir], {cwd: pkgInfo.dir})

		const tarballs = await readdir(tarballDir)
		assert(tarballs.length === 1, `${pkgInfo.name} should produce exactly one tarball`)
		const tarballPath = path.join(tarballDir, tarballs[0])

		await assertTarballContents(pkgInfo, tarballPath)

		const consumerDir = path.join(tempRoot, 'consumer')
		await writeConsumerFixture(consumerDir)
		await run('pnpm', ['add', tarballPath], {cwd: consumerDir})
		await writeConsumerChecks(consumerDir, pkgInfo)
		await run(process.execPath, ['consumer.mjs'], {cwd: consumerDir})
		await run(process.execPath, [typescriptCli, '-p', 'tsconfig.json', '--noEmit'], {cwd: consumerDir})
	} finally {
		await rm(tempRoot, {recursive: true, force: true})
	}
}

console.log(`Verified packed artifact installation and consumption for ${packages.length} publishable package(s).`)

async function getPublishablePackages(root) {
	const entries = await readdir(root, {withFileTypes: true})
	const result = []

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}

		const dir = path.join(root, entry.name)
		const manifestPath = path.join(dir, 'package.json')
		const pkg = JSON.parse(await readFile(manifestPath, 'utf8'))

		if (pkg.private === true) {
			continue
		}

		result.push({
			name: pkg.name,
			dir,
			exports: Object.keys(pkg.exports ?? {})
		})
	}

	return result
}

async function writeConsumerFixture(consumerDir) {
	await run('mkdir', ['-p', consumerDir], {cwd: repoRoot})
	await writeFile(path.join(consumerDir, 'package.json'), JSON.stringify({
		name: 'packed-artifact-consumer',
		private: true,
		type: 'module'
	}, null, 2) + '\n')
	await writeFile(path.join(consumerDir, 'tsconfig.json'), JSON.stringify({
		compilerOptions: {
			module: 'ESNext',
			moduleResolution: 'Bundler',
			target: 'ES2022',
			noEmit: true,
			strict: true
		},
		include: ['consumer.ts']
	}, null, 2) + '\n')
}

async function writeConsumerChecks(consumerDir, pkgInfo) {
	const specifiers = pkgInfo.exports.map((entry) => exportKeyToSpecifier(pkgInfo.name, entry))
	const consumerJs = specifiers.map((specifier) => `await import('${specifier}')`).join('\n') + '\n'
	const consumerTs = specifiers.map((specifier) => `import '${specifier}'`).join('\n') + '\n'

	await writeFile(path.join(consumerDir, 'consumer.mjs'), consumerJs)
	await writeFile(path.join(consumerDir, 'consumer.ts'), consumerTs)
}

function exportKeyToSpecifier(packageName, exportKey) {
	return exportKey === '.' ? packageName : `${packageName}/${exportKey.slice(2)}`
}

async function assertTarballContents(pkgInfo, tarballPath) {
	const {stdout} = await run('tar', ['-tf', tarballPath], {cwd: repoRoot, capture: true})
	const files = stdout.trim().split('\n').filter(Boolean)

	assert(files.includes('package/package.json'), `${pkgInfo.name} tarball must contain package/package.json`)
	assert(files.some((file) => file.startsWith('package/dist/')), `${pkgInfo.name} tarball must contain built files under package/dist/`)

	const forbiddenPrefixes = [
		'package/src/',
		'package/test/',
		'package/coverage/'
	]

	for (const forbiddenPrefix of forbiddenPrefixes) {
		assert(
			!files.some((file) => file.startsWith(forbiddenPrefix)),
			`${pkgInfo.name} tarball must not include ${forbiddenPrefix}`
		)
	}
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
			const text = chunk.toString()
			stdout += text
		})

		child.stderr.on('data', (chunk) => {
			const text = chunk.toString()
			stderr += text
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

function assert(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}
