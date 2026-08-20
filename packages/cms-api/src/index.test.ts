import {describe, expect, it, vi} from 'vitest'

import {
	createCmsClient,
	createCmsDraftWriter,
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

	it('does not expose the internal generic transport', () => {
		const client = createCmsClient({baseUrl: 'https://cms.example.com/api/cms/v1', token: 'token'})
		expect(client).not.toHaveProperty('request')
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

describe('OoopsCmsDraftWriter', () => {
	it('constructs draft URLs, sends If-Match, and reads the response ETag', async() => {
		const fetchMock = vi.fn(async(url: URL, _init?: RequestInit) => {
			if (url.pathname.endsWith('/token')) {
				return new Response(JSON.stringify({ok: true, token: {preset: 'draft_editor'}}), {status: 200})
			}
			return new Response(JSON.stringify({
				ok: true,
				entryId: 'entry-1',
				apiId: 'home page',
				kind: url.pathname.includes('/collections/') ? 'collection' : 'single',
				status: 'draft',
				values: {title: 'Next'},
				revision: 'body-revision'
			}), {status: 200, headers: {etag: '"response-revision"'}})
		})
		const writer = createCmsDraftWriter({
			baseUrl: 'https://cms.example.com/api/cms/v1/',
			token: 'writer-token',
			fetch: fetchMock as typeof fetch
		})

		await writer.token.inspect()
		const single = await writer.drafts.getSingle('home page')
		await writer.drafts.patchSingle('home page', [{op: 'field.set', field: 'title', value: 'Next'}], single.revision)
		await writer.drafts.getCollectionEntry('blog posts', 'entry/id')
		await writer.drafts.patchCollectionEntry(
			'blog posts',
			'entry/id',
			[{op: 'repeatable.move', field: 'slides', rowId: 'row-2', afterId: 'row-1'}],
			'"revision-2"'
		)

		const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][]
		expect(calls.map(([url]) => url.pathname)).toEqual([
			'/api/cms/v1/token',
			'/api/cms/v1/content/singles/home%20page/draft',
			'/api/cms/v1/content/singles/home%20page/draft',
			'/api/cms/v1/content/collections/blog%20posts/entries/entry%2Fid/draft',
			'/api/cms/v1/content/collections/blog%20posts/entries/entry%2Fid/draft'
		])
		expect(calls[2]?.[1]).toMatchObject({
			method: 'PATCH',
			headers: expect.objectContaining({'if-match': '"response-revision"', authorization: 'Bearer writer-token'}),
			body: JSON.stringify({operations: [{op: 'field.set', field: 'title', value: 'Next'}]})
		})
		expect(calls[4]?.[1].headers).toMatchObject({'if-match': '"revision-2"'})
		expect(single).toMatchObject({revision: 'response-revision', etag: 'response-revision'})
	})

	it('preserves typed error and timeout semantics', async() => {
		const denied = createCmsDraftWriter({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'writer-token',
			fetch: vi.fn(async() => new Response(JSON.stringify({
				ok: false,
				error: 'cms_api_token_grant_denied',
				code: 'cms_api_token_grant_denied',
				message: 'No field grant.'
			}), {status: 403})) as typeof fetch
		})
		await expect(denied.drafts.getSingle('homepage')).rejects.toMatchObject({
			name: 'OoopsCmsApiError',
			status: 403,
			code: 'cms_api_token_grant_denied'
		})

		const timedOut = createCmsDraftWriter({
			baseUrl: 'https://cms.example.com/api/cms/v1',
			token: 'writer-token',
			timeoutMs: 1,
			fetch: vi.fn((_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
			})) as typeof fetch
		})
		await expect(timedOut.drafts.getSingle('homepage')).rejects.toMatchObject({
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
