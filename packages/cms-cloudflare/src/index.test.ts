import {describe, expect, it, vi} from 'vitest'

import {
	clearCmsPreviewSessionCookie,
	CmsCloudflareError,
	cmsPreviewPath,
	cmsPreviewResponseHeaders,
	createCmsRebuildHandler,
	createCmsRebuildSignatureHeaders,
	createCmsPreviewClientFromRequest,
	createCmsPreviewClientFromSession,
	createCmsPreviewSession,
	readCmsPreviewSession,
	readCmsPreviewToken,
	serializeCmsRebuildEvent,
	serializeCmsPreviewSessionCookie,
	triggerCloudflareDeployHook,
	verifyCmsRebuildRequest,
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

const rebuildSecret = 'cms-rebuild-signing-secret-at-least-32-bytes'
const rebuildEvent = {
	version: 1,
	id: '019d-event-123',
	type: 'cms.content.published',
	organizationId: '019d-org-123',
	occurredAt: now,
	resource: {kind: 'collection', id: '019d-entry-123', apiId: 'posts'}
} as const

const signedRebuildRequest = async(
	event = rebuildEvent,
	options: {secret?: string; timestamp?: string} = {}
) => {
	const body = serializeCmsRebuildEvent(event)
	const headers = await createCmsRebuildSignatureHeaders(body, {
		eventId: event.id,
		secret: options.secret ?? rebuildSecret,
		timestamp: options.timestamp ?? now
	})
	return new Request('https://site.example/api/cms/rebuild', {method: 'POST', headers, body})
}

describe('signed CMS rebuild requests', () => {
	it('verifies a valid request and atomically claims its event id', async() => {
		const claim = vi.fn(async() => 'claimed' as const)
		const verified = await verifyCmsRebuildRequest(await signedRebuildRequest(), {
			secret: rebuildSecret,
			replayStore: {claim, complete: async() => {}, release: async() => {}},
			now
		})

		expect(verified.event).toEqual(rebuildEvent)
		expect(verified.duplicate).toBe(false)
		expect(claim).toHaveBeenCalledWith(rebuildEvent.id, new Date(now).getTime() + 10 * 60 * 1_000)
	})

	it('rejects invalid and stale signatures before claiming the event', async() => {
		const claim = vi.fn(async() => 'claimed' as const)
		const invalid = await signedRebuildRequest()
		invalid.headers.set('x-ooops-signature', `v1=${'0'.repeat(64)}`)
		await expect(verifyCmsRebuildRequest(invalid, {
			secret: rebuildSecret,
			replayStore: {claim, complete: async() => {}, release: async() => {}},
			now
		})).rejects.toMatchObject({code: 'signature_invalid', status: 401})

		await expect(verifyCmsRebuildRequest(await signedRebuildRequest(rebuildEvent, {
			timestamp: '2026-07-09T09:54:59.000Z'
		}), {
			secret: rebuildSecret,
			replayStore: {claim, complete: async() => {}, release: async() => {}},
			now
		})).rejects.toMatchObject({code: 'signature_expired', status: 401})
		expect(claim).not.toHaveBeenCalled()
	})

	it('marks an already claimed event as a duplicate', async() => {
		const verified = await verifyCmsRebuildRequest(await signedRebuildRequest(), {
			secret: rebuildSecret,
			replayStore: {
				claim: async() => 'completed' as const,
				complete: async() => {},
				release: async() => {}
			},
			now
		})
		expect(verified.duplicate).toBe(true)
	})
})

describe('Cloudflare deploy hook triggering', () => {
	it('accepts the documented Workers Builds response', async() => {
		const fetchMock = vi.fn(async() => Response.json({
			success: true,
			result: {
				already_exists: false,
				branch: 'main',
				build_uuid: '019d-build-123',
				status: 'queued'
			}
		}))
		await expect(triggerCloudflareDeployHook({
			deployHookUrl: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/11111111-2222-3333-4444-555555555555',
			fetch: fetchMock as typeof fetch
		})).resolves.toEqual({
			alreadyExists: false,
			branch: 'main',
			buildId: '019d-build-123',
			status: 'queued'
		})
		expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
			method: 'POST',
			redirect: 'error'
		}))
	})

	it('rejects non-Cloudflare targets and exposes retryable hook failures', async() => {
		await expect(triggerCloudflareDeployHook({
			deployHookUrl: 'https://attacker.example/rebuild'
		})).rejects.toMatchObject({code: 'deploy_hook_url_invalid', retryable: false})

		await expect(triggerCloudflareDeployHook({
			deployHookUrl: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/11111111-2222-3333-4444-555555555555',
			fetch: vi.fn(async() => Response.json({success: false}, {status: 503})) as typeof fetch
		})).rejects.toMatchObject({code: 'deploy_hook_rejected', retryable: true})
	})
})

describe('CMS rebuild handler', () => {
	it('triggers one build and returns duplicate success without a second trigger', async() => {
		let state: 'available' | 'claimed' | 'completed' = 'available'
		const complete = vi.fn(async() => { state = 'completed' })
		const release = vi.fn(async() => { state = 'available' })
		const fetchMock = vi.fn(async() => Response.json({
			success: true,
			result: {already_exists: false, branch: 'main', build_uuid: '019d-build-123', status: 'queued'}
		}))
		const handler = createCmsRebuildHandler({
			secret: rebuildSecret,
			deployHookUrl: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/11111111-2222-3333-4444-555555555555',
			replayStore: {
				claim: async() => state === 'completed' ? 'completed' : state === 'claimed' ? 'in_progress' : (state = 'claimed'),
				complete,
				release
			},
			fetch: fetchMock as typeof fetch,
			now
		})

		const first = await handler(await signedRebuildRequest())
		expect(first.status).toBe(202)
		expect(await first.json()).toMatchObject({ok: true, status: 'accepted', buildId: '019d-build-123'})
		const duplicate = await handler(await signedRebuildRequest())
		expect(await duplicate.json()).toMatchObject({ok: true, status: 'duplicate'})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(complete).toHaveBeenCalledOnce()
		expect(release).not.toHaveBeenCalled()
	})

	it('returns standardized JSON when the deploy hook fails', async() => {
		const release = vi.fn(async() => {})
		const handler = createCmsRebuildHandler({
			secret: rebuildSecret,
			deployHookUrl: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/11111111-2222-3333-4444-555555555555',
			replayStore: {
				claim: async() => 'claimed' as const,
				complete: async() => {},
				release
			},
			fetch: vi.fn(async() => Response.json({success: false}, {status: 503})) as typeof fetch,
			now
		})
		const response = await handler(await signedRebuildRequest())
		expect(response.status).toBe(502)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(await response.json()).toEqual({
			ok: false,
			code: 'deploy_hook_rejected',
			message: 'Cloudflare rejected the deploy hook request with status 503.',
			retryable: true
		})
		expect(release).toHaveBeenCalledWith(rebuildEvent.id)
	})

	it('returns a retryable conflict while the same event is still running', async() => {
		const fetchMock = vi.fn()
		const handler = createCmsRebuildHandler({
			secret: rebuildSecret,
			deployHookUrl: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/11111111-2222-3333-4444-555555555555',
			replayStore: {
				claim: async() => 'in_progress' as const,
				complete: async() => {},
				release: async() => {}
			},
			fetch: fetchMock as typeof fetch,
			now
		})
		const response = await handler(await signedRebuildRequest())
		expect(response.status).toBe(409)
		expect(response.headers.get('retry-after')).toBe('2')
		expect(await response.json()).toMatchObject({code: 'event_in_progress', retryable: true})
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('preserves typed package errors', () => {
		expect(new CmsCloudflareError(401, 'test', 'Test')).toMatchObject({
			name: 'CmsCloudflareError', status: 401, code: 'test', retryable: false
		})
	})
})
