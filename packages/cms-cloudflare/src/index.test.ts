import {describe, expect, it, vi} from 'vitest'

import {
	createCmsPreviewRedirect,
	handleCmsRebuildWebhook,
	signCmsWebhookPayload,
	triggerCloudflarePagesDeployHook,
	verifyCmsPreviewCookie,
	verifyCmsWebhookSignature,
	verifyCmsWebhookRequest
} from './index'

const secret = 'cms_secret'
const timestamp = '2026-07-09T10:00:00.000Z'
const now = timestamp
const body = JSON.stringify({ok: true, id: 'entry-1'})

describe('cms signatures', () => {
	it('signs and verifies a valid payload', async() => {
		const signature = await signCmsWebhookPayload({secret, timestamp, body})

		expect(signature).toMatch(/^v1=[a-f0-9]{64}$/)
		await expect(
			verifyCmsWebhookSignature({secret, timestamp, body, signature, now})
		).resolves.toEqual({ok: true, timestamp})
	})

	it('accepts a raw hex signature', async() => {
		const signature = (await signCmsWebhookPayload({secret, timestamp, body})).replace('v1=', '')

		await expect(
			verifyCmsWebhookSignature({secret, timestamp, body, signature, now})
		).resolves.toEqual({ok: true, timestamp})
	})

	it('rejects invalid, stale, and tampered signatures', async() => {
		const signature = await signCmsWebhookPayload({secret, timestamp, body})

		await expect(
			verifyCmsWebhookSignature({secret, timestamp, body, signature: 'v1=bad', now})
		).resolves.toMatchObject({ok: false, code: 'invalid_signature_format'})
		await expect(
			verifyCmsWebhookSignature({secret, timestamp, body, signature, now: '2026-07-09T10:10:01.000Z'})
		).resolves.toMatchObject({ok: false, code: 'stale_timestamp'})
		await expect(
			verifyCmsWebhookSignature({secret, timestamp, body: `${body} `, signature, now})
		).resolves.toMatchObject({ok: false, code: 'invalid_signature'})
	})

	it('returns clear errors for missing headers', async() => {
		await expect(
			verifyCmsWebhookSignature({secret, timestamp: '', body, signature: '', now})
		).resolves.toMatchObject({ok: false, code: 'missing_timestamp'})
	})
})

describe('cms webhook requests', () => {
	it('verifies a signed request and parses JSON', async() => {
		const request = await signedWebhookRequest({event: 'cms.entry.published'})

		await expect(
			verifyCmsWebhookRequest(request, {secret, now})
		).resolves.toMatchObject({
			ok: true,
			event: 'cms.entry.published',
			timestamp,
			body,
			json: {ok: true, id: 'entry-1'}
		})
	})

	it('rejects invalid JSON after signature verification', async() => {
		const invalidBody = '{'
		const request = await signedWebhookRequest({body: invalidBody})

		await expect(
			verifyCmsWebhookRequest(request, {secret, now})
		).resolves.toMatchObject({ok: false, status: 400, code: 'invalid_json'})
	})

	it('filters disallowed events as ignored', async() => {
		const request = await signedWebhookRequest({event: 'cms.entry.draft.updated'})

		await expect(
			verifyCmsWebhookRequest(request, {secret, allowedEvents: ['cms.entry.published'], now})
		).resolves.toMatchObject({ok: false, status: 202, code: 'ignored_event'})
	})
})

describe('cms preview redirects', () => {
	it('creates a redirect with a signed preview cookie', async() => {
		const response = await createCmsPreviewRedirect(
			new Request('https://site.example/api/preview?token=preview_token&redirect=/el/about?draft=1'),
			{previewToken: 'preview_token', previewSecret: secret, now}
		)

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/el/about?draft=1')
		const cookie = response.headers.get('set-cookie') ?? ''
		expect(cookie).toContain('cms_preview=')
		expect(cookie).toContain('HttpOnly')
		const value = cookie.match(/cms_preview=([^;]+)/)?.[1] ?? ''
		await expect(verifyCmsPreviewCookie({value, secret, now})).resolves.toMatchObject({
			ok: true,
			path: '/el/about?draft=1'
		})
	})

	it('rejects invalid tokens and external redirects', async() => {
		await expect(
			createCmsPreviewRedirect(
				new Request('https://site.example/api/preview?token=wrong&redirect=/about'),
				{previewToken: 'preview_token', previewSecret: secret, now}
			).then((response) => response.status)
		).resolves.toBe(401)

		await expect(
			createCmsPreviewRedirect(
				new Request('https://site.example/api/preview?token=preview_token&redirect=https://evil.example'),
				{previewToken: 'preview_token', previewSecret: secret, now}
			).then((response) => response.status)
		).resolves.toBe(400)
	})

	it('can add a non-sensitive preview indicator to the redirect', async() => {
		const response = await createCmsPreviewRedirect(
			new Request('https://site.example/api/preview?token=preview_token&redirect=/about?draft=1'),
			{previewToken: 'preview_token', previewSecret: secret, indicatorParam: 'cmsPreview', now}
		)

		expect(response.headers.get('location')).toBe('/about?draft=1&cmsPreview=1')
	})
})

describe('cloudflare deploy hooks', () => {
	it('posts to the deploy hook URL', async() => {
		const fetchMock = vi.fn(async() => new Response('queued', {status: 200}))

		await expect(
			triggerCloudflarePagesDeployHook('https://api.cloudflare.com/deploy', fetchMock as typeof fetch)
		).resolves.toEqual({ok: true, status: 200, text: 'queued'})

		expect(fetchMock).toHaveBeenCalledWith('https://api.cloudflare.com/deploy', {method: 'POST'})
	})

	it('handles rebuild webhooks end to end', async() => {
		const request = await signedWebhookRequest({event: 'cms.entry.published'})
		const fetchMock = vi.fn(async() => new Response('queued', {status: 200}))

		const response = await handleCmsRebuildWebhook(request, {
			secret,
			deployHookUrl: 'https://api.cloudflare.com/deploy',
			fetch: fetchMock as typeof fetch,
			allowedEvents: ['cms.entry.published'],
			now
		})

		await expect(response.json()).resolves.toMatchObject({ok: true, event: 'cms.entry.published'})
		expect(response.status).toBe(200)
		expect(fetchMock).toHaveBeenCalledOnce()
	})

	it('does not deploy ignored events', async() => {
		const request = await signedWebhookRequest({event: 'cms.entry.draft.updated'})
		const fetchMock = vi.fn(async() => new Response('queued', {status: 200}))

		const response = await handleCmsRebuildWebhook(request, {
			secret,
			deployHookUrl: 'https://api.cloudflare.com/deploy',
			fetch: fetchMock as typeof fetch,
			allowedEvents: ['cms.entry.published'],
			now
		})

		await expect(response.json()).resolves.toMatchObject({ok: false, code: 'ignored_event'})
		expect(response.status).toBe(202)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('returns 502 when the deploy hook fails', async() => {
		const request = await signedWebhookRequest({event: 'cms.entry.published'})
		const fetchMock = vi.fn(async() => new Response('nope', {status: 500}))

		const response = await handleCmsRebuildWebhook(request, {
			secret,
			deployHookUrl: 'https://api.cloudflare.com/deploy',
			fetch: fetchMock as typeof fetch,
			now
		})

		await expect(response.json()).resolves.toMatchObject({ok: false, code: 'deploy_hook_failed'})
		expect(response.status).toBe(502)
	})
})

async function signedWebhookRequest(options: {event?: string; body?: string} = {}) {
	const event = options.event ?? 'cms.entry.published'
	const rawBody = options.body ?? body
	const signature = await signCmsWebhookPayload({secret, timestamp, body: rawBody})
	return new Request('https://site.example/api/cms/rebuild', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-cms-event': event,
			'x-cms-signature': signature,
			'x-cms-timestamp': timestamp
		},
		body: rawBody
	})
}
