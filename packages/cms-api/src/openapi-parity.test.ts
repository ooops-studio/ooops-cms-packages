import {readFileSync} from 'node:fs'
import path from 'node:path'

import {describe, expect, it} from 'vitest'

import {createCmsDraftWriter, OoopsCmsClient} from './index'

const openApiPath = path.resolve(process.cwd(), '../../docs/cms-api-v1.openapi.json')
const openApi = JSON.parse(readFileSync(openApiPath, 'utf8')) as {
	paths: Record<string, Record<string, unknown>>;
	components: {schemas: Record<string, {properties?: Record<string, unknown>}>};
}

describe('OoopsCmsClient OpenAPI parity', () => {
	it('tracks the current read-only content and preview contract', () => {
		expect(openApi.paths).toHaveProperty('/preview/content/collections/{apiId}/{slug}')
		expect(openApi.paths).toHaveProperty('/preview/content/singles/{apiId}')
		expect(openApi.paths).toHaveProperty('/analytics/runtime')

		const client = new OoopsCmsClient({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'token',
			fetch: (async() => new Response('{}')) as typeof fetch
		})
		expect(typeof client.content.getCollectionEntry).toBe('function')
		expect(typeof client.content.getSingle).toBe('function')
		expect(typeof client.analytics.runtime).toBe('function')
	})

	it('does not expose removed write/import/webhook APIs', () => {
		for (const path of ['/imports/validate', '/media/sign-upload', '/webhooks']) {
			expect(openApi.paths).not.toHaveProperty(path)
		}
		const client = new OoopsCmsClient({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'token',
			fetch: (async() => new Response('{}')) as typeof fetch
		})
		expect(client).not.toHaveProperty('imports')
		expect(client).not.toHaveProperty('webhooks')
		expect(client.media).not.toHaveProperty('upload')
		expect(client.content).not.toHaveProperty('updateSingle')
	})

	it('tracks the field-scoped draft writer contract separately from read clients', () => {
		expect(openApi.paths).toHaveProperty('/token')
		expect(openApi.paths).toHaveProperty('/content/singles/{apiId}/draft')
		expect(openApi.paths).toHaveProperty('/content/collections/{apiId}/entries/{entryId}/draft')
		expect(openApi.paths['/content/singles/{apiId}/draft']).toHaveProperty('patch')

		const writer = createCmsDraftWriter({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'writer-token',
			fetch: (async() => new Response('{}')) as typeof fetch
		})
		expect(typeof writer.token.inspect).toBe('function')
		expect(typeof writer.drafts.patchSingle).toBe('function')
		expect(typeof writer.drafts.patchCollectionEntry).toBe('function')

		const reader = new OoopsCmsClient({baseUrl: 'https://cms.example.com/api/cms/v1', token: 'reader'})
		expect(reader).not.toHaveProperty('drafts')
		expect(reader).not.toHaveProperty('request')
	})
})
