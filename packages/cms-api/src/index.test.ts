import {describe, expect, it, vi} from 'vitest'

import {
	createCmsClient,
	createCmsPreviewClient,
	createCmsPublicFormsClient,
	OoopsCmsApiError,
	OoopsCmsClient
} from './index'

describe('OoopsCmsClient', () => {
	it('provides the canonical client factory', () => {
		expect(createCmsClient({baseUrl: 'https://cms.example.com/api/cms/v1', token: 'token'}))
			.toBeInstanceOf(OoopsCmsClient)
	})

	it('builds urls, query strings, and auth headers', async() => {
		const fetchMock = vi.fn(async() =>
			new Response(JSON.stringify({ok: true, items: []}), {status: 200})
		)
		const client = new OoopsCmsClient({
			baseUrl: 'https://cms.example.com/api/cms/v1/',
			token: 'token_123',
			fetch: fetchMock as typeof fetch
		})

		await client.content.listCollectionEntries('blog posts', {limit: 10, q: 'hello world', tag: ['featured', 'public']})

		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
		expect(url.toString()).toBe('https://cms.example.com/api/cms/v1/content/collections/blog%20posts/entries?limit=10&q=hello+world&tag=featured&tag=public')
		expect(init.headers).toMatchObject({authorization: 'Bearer token_123', accept: 'application/json'})
	})

	it('throws typed API errors', async() => {
		const fetchMock = vi.fn(async() =>
			new Response(JSON.stringify({ok: false, error: 'scope_denied', code: 'scope_denied', message: 'Nope.'}), {status: 403})
		)
		const client = new OoopsCmsClient({baseUrl: 'https://cms.example.com/api/cms/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await expect(client.seo.get()).rejects.toMatchObject({
			name: 'OoopsCmsApiError',
			status: 403,
			code: 'scope_denied',
			message: 'Nope.'
		} satisfies Partial<OoopsCmsApiError>)
	})

	it('wraps invalid JSON responses in typed API errors', async() => {
		const fetchMock = vi.fn(async() => new Response('not-json', {status: 200}))
		const client = new OoopsCmsClient({baseUrl: 'https://cms.example.com/api/cms/v1', token: 'token_123', fetch: fetchMock as typeof fetch})

		await expect(client.seo.get()).rejects.toMatchObject({
			name: 'OoopsCmsApiError',
			code: 'invalid_json_response',
			message: 'CMS API returned invalid JSON.'
		})
	})

	it('wraps authenticated client timeouts in typed API errors', async() => {
		const fetchMock = vi.fn(
			(_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('Aborted', 'AbortError'))
				})
			})
		)
		const client = new OoopsCmsClient({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'token_123',
			fetch: fetchMock as typeof fetch,
			timeoutMs: 1
		})

		await expect(client.seo.get()).rejects.toMatchObject({
			name: 'OoopsCmsApiError',
			status: 408,
			code: 'request_timeout'
		})
	})
})

describe('public consumer clients', () => {
	it('submits public forms without an authorization header', async() => {
		const fetchMock = vi.fn(async() => new Response(JSON.stringify({ok: true}), {status: 201}))
		const client = createCmsPublicFormsClient({
			baseUrl: 'https://cms.example.com/api/cms/v1/',
			fetch: fetchMock as typeof fetch
		})

		await client.forms.submit('share token', {answers: {email: 'hello@example.com'}})

		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
		expect(url.toString()).toBe('https://cms.example.com/api/cms/public/forms/share%20token/submissions')
		expect(init.headers).not.toHaveProperty('authorization')
		expect(init.body).toBe(JSON.stringify({answers: {email: 'hello@example.com'}}))
	})

	it('uses the API token for preview reads and sends the preview token as a query value', async() => {
		const fetchMock = vi.fn(async() => new Response(JSON.stringify({ok: true}), {status: 200}))
		const client = createCmsPreviewClient({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'api_123',
			previewToken: 'preview_123',
			fetch: fetchMock as typeof fetch
		})

		await client.content.getSingle('homepage')
		await client.content.getCollectionEntry('posts', 'hello world')

		const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][]
		for (const [url, init] of calls) {
			expect(url.searchParams.get('preview')).toBe('preview_123')
			expect(init.headers).toMatchObject({authorization: 'Bearer api_123'})
			expect(init.method).toBe('GET')
		}
		expect(calls[0]?.[0].pathname).toBe('/api/cms/v1/preview/content/singles/homepage')
		expect(calls[1]?.[0].pathname).toBe('/api/cms/v1/preview/content/collections/posts/hello%20world')
	})

	it('does not expose write methods from the preview client', () => {
		const client = createCmsPreviewClient({baseUrl: 'https://cms.example.com', token: 'api', previewToken: 'preview'})
		expect(client.content).not.toHaveProperty('updateSingle')
		expect(client.content).not.toHaveProperty('createCollectionEntry')
	})

	it('wraps public client timeouts in a typed API error', async() => {
		const fetchMock = vi.fn(
			(_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('Aborted', 'AbortError'))
				})
			})
		)
		const client = createCmsPreviewClient({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'api_123',
			previewToken: 'preview_123',
			fetch: fetchMock as typeof fetch,
			timeoutMs: 1
		})

		await expect(client.content.getSingle('homepage')).rejects.toMatchObject({
			name: 'OoopsCmsApiError',
			status: 408,
			code: 'request_timeout'
		})
	})
})
