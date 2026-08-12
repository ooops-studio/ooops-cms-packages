import {spawn} from 'node:child_process'
import process from 'node:process'

await run('node', [
	'./scripts/create-package.mjs',
	'--name',
	'@ooopsstudio/example',
	'--archetype',
	'public-package',
	'--dry-run'
])

await run('node', [
	'./scripts/copy-package-from-repo.mjs',
	'--from',
	'./packages/cms-api',
	'--name',
	'@ooopsstudio/copied-cms-api',
	'--dry-run'
])

await run('node', [
	'./scripts/deprecate-package.mjs',
	'--package',
	'@ooopsstudio/cms-api'
])

console.log('Package creation and migration tool smoke checks passed.')

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
			stdio: 'inherit',
			env: process.env
		})

		child.on('close', (code) => {
			if (code === 0) {
				resolve()
				return
			}

			reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
		})
	})
}
