export function readWorkspaceScalarMap(source, field) {
	const lines = source.split(/\r?\n/u)
	const start = lines.findIndex((line) => line === `${field}:`)
	if (start === -1) return {}
	const result = {}
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index]
		if (line.length > 0 && !/^\s/u.test(line)) break
		if (!line.trim() || line.trimStart().startsWith('#')) continue
		const match = line.match(/^\s{2}((?:"(?:[^"\\]|\\.)*")|(?:'[^']*')|[^:]+):\s*(.*?)\s*$/u)
		if (!match) throw new Error(`pnpm-workspace.yaml has an unsupported ${field} entry: ${line.trim()}`)
		result[readScalar(match[1])] = readScalar(match[2])
	}
	return result
}

export function replaceWorkspaceScalarMap(source, field, values) {
	const lines = source.replace(/\s*$/u, '').split(/\r?\n/u)
	const start = lines.findIndex((line) => line === `${field}:`)
	let end = start
	if (start !== -1) {
		end = start + 1
		while (end < lines.length && (lines[end] === '' || /^\s/u.test(lines[end]))) end += 1
	}
	const section = renderScalarMap(field, values).split('\n')
	if (start === -1) lines.push(...section)
	else lines.splice(start, end - start, ...section)
	return `${lines.join('\n')}\n`
}

export function renderPackedWorkspace({allowBuilds = {}, overrides = {}}) {
	return [
		'packages: []',
		renderScalarMap('allowBuilds', allowBuilds),
		renderScalarMap('overrides', overrides),
		''
	].join('\n')
}

function renderScalarMap(field, values) {
	return [
		`${field}:`,
		...Object.entries(values)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
	].join('\n')
}

function readScalar(value) {
	if (value === 'true') return true
	if (value === 'false') return false
	if (value.startsWith('"')) return JSON.parse(value)
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
	return value
}
