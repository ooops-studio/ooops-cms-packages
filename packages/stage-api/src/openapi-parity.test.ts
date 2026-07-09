import {readFileSync} from 'node:fs'
import path from 'node:path'

import {describe, expect, it} from 'vitest'

import {OoopsStageClient} from './index'

const openApiPath = path.resolve(process.cwd(), '../../docs/stage-api-v1.openapi.json')
const openApi = JSON.parse(readFileSync(openApiPath, 'utf8')) as {
	paths: Record<string, Record<string, unknown>>;
	components: {schemas: Record<string, {properties?: Record<string, unknown>}>};
}

describe('OoopsStageClient OpenAPI parity', () => {
	it('tracks content lifecycle metadata and schedule support', () => {
		const lifecycleAction = openApi.components.schemas.ContentLifecycleActionRequest

		expect(lifecycleAction?.properties?.action).toMatchObject({
			enum: ['publish', 'schedule']
		})
		expect(lifecycleAction?.properties).toHaveProperty('scheduledFor')
		expect(lifecycleAction?.properties).toHaveProperty('versionLabel')
		expect(lifecycleAction?.properties).toHaveProperty('versionNote')

		const client = new OoopsStageClient({
			baseUrl: 'https://stage.example.com/api/stage/v1',
			token: 'token',
			fetch: (async() => new Response('{}')) as typeof fetch
		})
		expect(typeof client.content.publishCollectionEntry).toBe('function')
		expect(typeof client.content.scheduleCollectionEntry).toBe('function')
		expect(typeof client.content.publishSingle).toBe('function')
		expect(typeof client.content.scheduleSingle).toBe('function')
	})

	it('tracks public media upload endpoints with a one-call helper', () => {
		expect(openApi.paths).toHaveProperty('/media/sign-upload')
		expect(openApi.paths).toHaveProperty('/media/complete')

		const client = new OoopsStageClient({
			baseUrl: 'https://stage.example.com/api/stage/v1',
			token: 'token',
			fetch: (async() => new Response('{}')) as typeof fetch
		})
		expect(typeof client.media.signUpload).toBe('function')
		expect(typeof client.media.completeUpload).toBe('function')
		expect(typeof client.media.upload).toBe('function')
	})
})
