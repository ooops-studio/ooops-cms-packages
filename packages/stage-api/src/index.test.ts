import {describe, expect, it, vi} from 'vitest'

import {OoopsStageApiError, OoopsStageClient} from './index'

describe('OoopsStageClient', () => {
	it('builds urls, query strings, and auth headers', async() => {
		const fetchMock = vi.fn(async() =>
			new Response(JSON.stringify({ok: true, items: []}), {status: 200})
		)
		const client = new OoopsStageClient({
			baseUrl: 'https://stage.example.com/api/stage/v1/',
			token: 'token_123',
			fetch: fetchMock as typeof fetch
		})

		await client.content.listCollectionEntries('blog posts', {limit: 10, q: 'hello world', tag: ['featured', 'public']})

		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
		expect(url.toString()).toBe('https://stage.example.com/api/stage/v1/content/collections/blog%20posts/entries?limit=10&q=hello+world&tag=featured&tag=public')
		expect(init.headers).toMatchObject({authorization: 'Bearer token_123', accept: 'application/json'})
	})

	it('sends JSON bodies', async() => {
		const fetchMock = vi.fn(async() => new Response(JSON.stringify({ok: true}), {status: 200}))
		const client = new OoopsStageClient({baseUrl: 'https://stage.example.com/api/stage/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await client.media.completeUpload({fileName: 'a.jpg', objectKey: 'uploads/a.jpg', mimeType: 'image/jpeg'})

		const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
		expect(init.method).toBe('POST')
		expect(init.headers).toMatchObject({'content-type': 'application/json'})
		expect(init.body).toBe(JSON.stringify({fileName: 'a.jpg', objectKey: 'uploads/a.jpg', mimeType: 'image/jpeg'}))
	})

	it('throws typed API errors', async() => {
		const fetchMock = vi.fn(async() =>
			new Response(JSON.stringify({ok: false, error: 'scope_denied', code: 'scope_denied', message: 'Nope.'}), {status: 403})
		)
		const client = new OoopsStageClient({baseUrl: 'https://stage.example.com/api/stage/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await expect(client.seo.get()).rejects.toMatchObject({
			name: 'OoopsStageApiError',
			status: 403,
			code: 'scope_denied',
			message: 'Nope.'
		} satisfies Partial<OoopsStageApiError>)
	})

	it('sends lifecycle metadata for publish and schedule actions', async() => {
		const fetchMock = vi.fn(async() => new Response(JSON.stringify({ok: true}), {status: 200}))
		const client = new OoopsStageClient({baseUrl: 'https://stage.example.com/api/stage/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await client.content.publishCollectionEntry('projects', 'entry-1', {versionLabel: 'Launch', versionNote: 'Approved'})
		await client.content.scheduleSingle('homepage', {
			scheduledFor: new Date('2026-06-01T10:30:00.000Z'),
			versionLabel: 'Homepage launch',
			versionNote: null
		})

		const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][]

		expect(calls[0]?.[1].body).toBe(
			JSON.stringify({action: 'publish', versionLabel: 'Launch', versionNote: 'Approved'})
		)
		expect(calls[1]?.[1].body).toBe(
			JSON.stringify({
				action: 'schedule',
				scheduledFor: '2026-06-01T10:30:00.000Z',
				versionLabel: 'Homepage launch',
				versionNote: null
			})
		)
	})

	it('uploads media through sign-upload, raw PUT, and complete', async() => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ok: true, url: 'https://upload.example/a.jpg', objectKey: 'public/a.jpg'}), {status: 200}))
			.mockResolvedValueOnce(new Response('', {status: 200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ok: true, asset: {id: 'asset-1'}}), {status: 201}))
		const client = new OoopsStageClient({baseUrl: 'https://stage.example.com/api/stage/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await expect(
			client.media.upload({
				fileName: 'a.jpg',
				mimeType: 'image/jpeg',
				sizeBytes: 3,
				data: 'raw',
				complete: {altEn: 'Alt text'}
			})
		).resolves.toEqual({ok: true, asset: {id: 'asset-1'}})

		expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://upload.example/a.jpg')
		expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({method: 'PUT', body: 'raw'})
		expect((fetchMock.mock.calls[2]?.[1] as RequestInit).body).toBe(
			JSON.stringify({
				altEn: 'Alt text',
				fileName: 'a.jpg',
				objectKey: 'public/a.jpg',
				mimeType: 'image/jpeg',
				sizeBytes: 3
			})
		)
	})

	it('wraps invalid JSON responses in typed API errors', async() => {
		const fetchMock = vi.fn(async() => new Response('not-json', {status: 200}))
		const client = new OoopsStageClient({baseUrl: 'https://stage.example.com/api/stage/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await expect(client.seo.get()).rejects.toMatchObject({
			name: 'OoopsStageApiError',
			code: 'invalid_json_response',
			message: 'Stage API returned invalid JSON.'
		})
	})
})
