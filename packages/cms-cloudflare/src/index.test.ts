import {describe, expect, it, vi} from 'vitest'

import {
	clearCmsPreviewSessionCookie,
	cmsPreviewPath,
	cmsPreviewResponseHeaders,
	createCmsPreviewClientFromRequest,
	createCmsPreviewClientFromSession,
	createCmsPreviewSession,
	readCmsPreviewSession,
	readCmsPreviewToken,
	serializeCmsPreviewSessionCookie,
	withCmsPreviewResponseHeaders
} from './index'

const now = '2026-07-09T10:00:00.000Z'
const secret = 'cms-preview-session-secret'

describe('Ooops CMS preview request contract', () => {
	it('reads the CMS-issued opaque token from the canonical preview parameter', () => {
		const request = new Request('https://site.example/preview/content/singles/homepage?preview=preview_123')
		expect(readCmsPreviewToken(request)).toBe('preview_123')
		expect(readCmsPreviewToken(new Request('https://site.example/preview/content/singles/homepage'))).toBeNull()
	})

	it('creates a read-only CMS preview client with the server API token', async() => {
		const fetchMock = vi.fn(async() => Response.json({ok: true, preview: true, data: {title: 'Draft'}}))
		const request = new Request('https://site.example/preview/content/singles/homepage?preview=preview_123')
		const result = createCmsPreviewClientFromRequest(request, {
			baseUrl: 'https://cms.ooops.studio/api/cms/v1',
			token: 'api_123',
			fetch: fetchMock as typeof fetch
		})

		expect(result?.previewToken).toBe('preview_123')
		await result?.client.content.getSingle('homepage')
		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
		expect(url.pathname).toBe('/api/cms/v1/preview/content/singles/homepage')
		expect(url.searchParams.get('preview')).toBe('preview_123')
		expect(init.headers).toMatchObject({authorization: 'Bearer api_123'})
	})

	it('builds the consumer paths emitted by the CMS', () => {
		expect(cmsPreviewPath({kind: 'single', apiId: 'homepage'}))
			.toBe('/preview/content/singles/homepage')
		expect(cmsPreviewPath({kind: 'collection', apiId: 'blog posts', slug: 'hello world'}))
			.toBe('/preview/content/collections/blog%20posts/hello%20world')
	})
})

describe('encrypted preview sessions', () => {
	it('round-trips a validated token through an encrypted HttpOnly cookie', async() => {
		const session = createCmsPreviewSession({
			apiId: 'posts',
			kind: 'collection',
			previewToken: 'preview_123',
			slug: 'hello-world',
			now
		})
		const cookie = await serializeCmsPreviewSessionCookie(session, {secret, secure: true})

		expect(cookie).toContain('Path=/preview/content/')
		expect(cookie).toContain('HttpOnly')
		expect(cookie).toContain('SameSite=Lax')
		expect(cookie).toContain('Secure')
		expect(cookie).not.toContain('preview_123')

		const request = new Request('https://site.example/preview/content/collections/posts/hello-world', {
			headers: {cookie: cookie.split(';')[0] ?? ''}
		})
		await expect(readCmsPreviewSession(request, {secret, now})).resolves.toEqual(session)
	})

	it('rejects tampered and expired sessions', async() => {
		const session = createCmsPreviewSession({
			apiId: 'homepage',
			kind: 'single',
			previewToken: 'preview_123',
			now,
			ttlSeconds: 1
		})
		const cookie = await serializeCmsPreviewSessionCookie(session, {
			secret,
			secure: true,
			ttlSeconds: 1
		})
		const value = cookie.split(';')[0] ?? ''

		await expect(readCmsPreviewSession(new Request('https://site.example', {
			headers: {cookie: `${value}x`}
		}), {secret, now})).resolves.toBeNull()
		await expect(readCmsPreviewSession(new Request('https://site.example', {
			headers: {cookie: value}
		}), {secret, now: '2026-07-09T10:00:02.000Z'})).resolves.toBeNull()
	})

	it('recreates the preview client only from the decrypted session', async() => {
		const fetchMock = vi.fn(async() => Response.json({ok: true, preview: true, item: {title: 'Draft'}}))
		const session = createCmsPreviewSession({
			apiId: 'posts',
			kind: 'collection',
			previewToken: 'preview_123',
			slug: 'hello-world',
			now
		})
		const client = createCmsPreviewClientFromSession(session, {
			baseUrl: 'https://cms.ooops.studio/api/cms/v1',
			token: 'api_123',
			fetch: fetchMock as typeof fetch
		})

		await client.content.getCollectionEntry(session.apiId, session.slug ?? '')
		const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][]
		expect(calls[0]?.[0].searchParams.get('preview')).toBe('preview_123')
	})

	it('clears the exact preview cookie scope', () => {
		expect(clearCmsPreviewSessionCookie({secure: true}))
			.toBe('ooops_cms_preview=; Path=/preview/content/; HttpOnly; SameSite=Lax; Max-Age=0; Secure')
	})
})

describe('preview response privacy', () => {
	it('sets private cache, referrer, and robots protections', async() => {
		const headers = cmsPreviewResponseHeaders({'content-type': 'text/html'})
		expect(headers.get('cache-control')).toBe('private, no-store')
		expect(headers.get('referrer-policy')).toBe('no-referrer')
		expect(headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')

		const response = withCmsPreviewResponseHeaders(new Response('draft', {status: 203}))
		expect(response.status).toBe(203)
		expect(await response.text()).toBe('draft')
		expect(response.headers.get('cache-control')).toBe('private, no-store')
	})
})
