export const CMS_REBUILD_EVENT_ID_HEADER = 'x-ooops-event-id'
export const CMS_REBUILD_SIGNATURE_HEADER = 'x-ooops-signature'
export const CMS_REBUILD_TIMESTAMP_HEADER = 'x-ooops-timestamp'

export type CmsRebuildEventType =
	| 'cms.content.published'
	| 'cms.content.unpublished'
	| 'cms.forms.published'
	| 'cms.forms.unpublished'
	| 'cms.seo.published'

export type CmsRebuildResource = {
	id: string;
	kind: 'collection' | 'form' | 'seo' | 'single';
	apiId?: string;
}

export type CmsRebuildEvent = {
	id: string;
	occurredAt: string;
	organizationId: string;
	resource: CmsRebuildResource;
	type: CmsRebuildEventType;
	version: 1;
}

export type CmsRebuildReplayStore = {
	/** Atomically claim an event id and distinguish active work from a completed replay. */
	claim: (
		eventId: string,
		expiresAt: number
	) => CmsRebuildClaimState | Promise<CmsRebuildClaimState>;
	/** Persist successful completion so later deliveries are idempotent. */
	complete: (eventId: string, expiresAt: number) => void | Promise<void>;
	/** Release failed work so the CMS can retry the same signed event. */
	release: (eventId: string) => void | Promise<void>;
}

export type CmsRebuildClaimState = 'claimed' | 'completed' | 'in_progress'

export type CreateCmsRebuildSignatureHeadersOptions = {
	eventId: string;
	secret: string;
	timestamp?: Date | number | string;
}

export type VerifyCmsRebuildRequestOptions = {
	secret: string;
	replayStore: CmsRebuildReplayStore;
	now?: Date | number | string;
	toleranceSeconds?: number;
}

export type VerifiedCmsRebuildRequest = {
	claimExpiresAt: number;
	claimState: CmsRebuildClaimState;
	duplicate: boolean;
	event: CmsRebuildEvent;
	rawBody: string;
}

export type TriggerCloudflareDeployHookOptions = {
	deployHookUrl: string;
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
}

export type CloudflareDeployHookResult = {
	alreadyExists: boolean;
	branch: string | null;
	buildId: string;
	status: string | null;
}

export type CreateCmsRebuildHandlerOptions = VerifyCmsRebuildRequestOptions &
	TriggerCloudflareDeployHookOptions

export class CmsCloudflareError extends Error {
	readonly code: string
	readonly retryable: boolean
	readonly status: number

	constructor(status: number, code: string, message: string, retryable = false) {
		super(message)
		this.name = 'CmsCloudflareError'
		this.status = status
		this.code = code
		this.retryable = retryable
	}
}

const encoder = new TextEncoder()

export const serializeCmsRebuildEvent = (event: CmsRebuildEvent) => {
	assertCmsRebuildEvent(event)
	return JSON.stringify(event)
}

export const createCmsRebuildSignatureHeaders = async(
	body: string,
	options: CreateCmsRebuildSignatureHeadersOptions
) => {
	assertNonEmpty(body, 'body')
	assertNonEmpty(options.eventId, 'eventId')
	assertSecret(options.secret)
	const timestamp = Math.floor(resolveNow(options.timestamp) / 1_000).toString()
	const signature = await sign(`${timestamp}.${options.eventId}.${body}`, options.secret)
	return new Headers({
		'content-type': 'application/json; charset=utf-8',
		[CMS_REBUILD_EVENT_ID_HEADER]: options.eventId,
		[CMS_REBUILD_SIGNATURE_HEADER]: `v1=${signature}`,
		[CMS_REBUILD_TIMESTAMP_HEADER]: timestamp
	})
}

export const verifyCmsRebuildRequest = async(
	request: Request,
	options: VerifyCmsRebuildRequestOptions
): Promise<VerifiedCmsRebuildRequest> => {
	if (request.method !== 'POST') {
		throw new CmsCloudflareError(405, 'method_not_allowed', 'CMS rebuild requests must use POST.')
	}
	assertSecret(options.secret)
	if (
		!options.replayStore ||
		typeof options.replayStore.claim !== 'function' ||
		typeof options.replayStore.complete !== 'function' ||
		typeof options.replayStore.release !== 'function'
	) {
		throw new CmsCloudflareError(500, 'replay_store_required', 'A durable replay store is required.')
	}

	const eventId = request.headers.get(CMS_REBUILD_EVENT_ID_HEADER)?.trim() ?? ''
	const timestampRaw = request.headers.get(CMS_REBUILD_TIMESTAMP_HEADER)?.trim() ?? ''
	const signatureRaw = request.headers.get(CMS_REBUILD_SIGNATURE_HEADER)?.trim() ?? ''
	if (!eventId || !timestampRaw || !signatureRaw) {
		throw new CmsCloudflareError(401, 'signature_headers_missing', 'CMS rebuild signature headers are required.')
	}

	const timestampSeconds = Number(timestampRaw)
	if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
		throw new CmsCloudflareError(401, 'signature_timestamp_invalid', 'CMS rebuild signature timestamp is invalid.')
	}
	const toleranceSeconds = normalizePositiveInteger(options.toleranceSeconds ?? 5 * 60, 'toleranceSeconds')
	const now = resolveNow(options.now)
	if (Math.abs(now - timestampSeconds * 1_000) > toleranceSeconds * 1_000) {
		throw new CmsCloudflareError(401, 'signature_expired', 'CMS rebuild signature has expired.')
	}

	const signature = signatureRaw.startsWith('v1=') ? signatureRaw.slice(3) : ''
	if (!/^[a-f0-9]{64}$/i.test(signature)) {
		throw new CmsCloudflareError(401, 'signature_invalid', 'CMS rebuild signature is invalid.')
	}
	const rawBody = await request.text()
	const valid = await verifySignature(
		`${timestampRaw}.${eventId}.${rawBody}`,
		options.secret,
		signature
	)
	if (!valid) {
		throw new CmsCloudflareError(401, 'signature_invalid', 'CMS rebuild signature is invalid.')
	}

	let event: unknown
	try {
		event = JSON.parse(rawBody)
	} catch {
		throw new CmsCloudflareError(400, 'event_json_invalid', 'CMS rebuild event must be valid JSON.')
	}
	assertCmsRebuildEvent(event)
	if (event.id !== eventId) {
		throw new CmsCloudflareError(401, 'event_id_mismatch', 'CMS rebuild event id does not match its signature.')
	}

	const claimExpiresAt = now + toleranceSeconds * 2 * 1_000
	const claimState = await options.replayStore.claim(event.id, claimExpiresAt)
	if (!['claimed', 'completed', 'in_progress'].includes(claimState)) {
		throw new CmsCloudflareError(500, 'replay_store_invalid', 'Replay store returned an invalid claim state.', true)
	}
	return {claimExpiresAt, claimState, duplicate: claimState === 'completed', event, rawBody}
}

export const triggerCloudflareDeployHook = async(
	options: TriggerCloudflareDeployHookOptions
): Promise<CloudflareDeployHookResult> => {
	const url = validateDeployHookUrl(options.deployHookUrl)
	const fetcher = options.fetch ?? globalThis.fetch
	if (typeof fetcher !== 'function') {
		throw new CmsCloudflareError(500, 'fetch_unavailable', 'Fetch is unavailable in this runtime.')
	}
	const timeoutMs = normalizePositiveInteger(options.timeoutMs ?? 10_000, 'timeoutMs')
	let response: Response
	try {
		response = await fetcher(url, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(timeoutMs)
		})
	} catch(error) {
		throw new CmsCloudflareError(
			502,
			'deploy_hook_unavailable',
			error instanceof Error ? `Cloudflare Deploy Hook failed: ${error.message}` : 'Cloudflare Deploy Hook failed.',
			true
		)
	}

	let payload: unknown = null
	try {
		payload = await response.json()
	} catch {
		// Error handling below also covers non-JSON Cloudflare responses.
	}
	const result = asRecord(asRecord(payload).result)
	if (!response.ok || asRecord(payload).success !== true || typeof result.build_uuid !== 'string') {
		throw new CmsCloudflareError(
			502,
			'deploy_hook_rejected',
			`Cloudflare rejected the deploy hook request with status ${response.status}.`,
			response.status === 429 || response.status >= 500
		)
	}

	return {
		alreadyExists: result.already_exists === true,
		branch: typeof result.branch === 'string' ? result.branch : null,
		buildId: result.build_uuid,
		status: typeof result.status === 'string' ? result.status : null
	}
}

export const createCmsRebuildHandler = (options: CreateCmsRebuildHandlerOptions) =>
	async(request: Request) => {
		let claimedEvent: {id: string; expiresAt: number} | null = null
		try {
			const verified = await verifyCmsRebuildRequest(request, options)
			if (verified.duplicate) {
				return rebuildJsonResponse({ok: true, status: 'duplicate', eventId: verified.event.id}, 202)
			}
			if (verified.claimState === 'in_progress') {
				return rebuildJsonResponse({
					ok: false,
					code: 'event_in_progress',
					message: 'This CMS rebuild event is already being processed.',
					retryable: true
				}, 409, {'retry-after': '2'})
			}
			claimedEvent = {id: verified.event.id, expiresAt: verified.claimExpiresAt}
			const build = await triggerCloudflareDeployHook(options)
			await options.replayStore.complete(claimedEvent.id, claimedEvent.expiresAt)
			claimedEvent = null
			return rebuildJsonResponse({
				ok: true,
				status: build.alreadyExists ? 'already_queued' : 'accepted',
				eventId: verified.event.id,
				buildId: build.buildId,
				branch: build.branch
			}, 202)
		} catch(error) {
			if (claimedEvent) {
				try {
					await options.replayStore.release(claimedEvent.id)
				} catch {
					// Preserve the original failure; the claim expires if explicit release fails.
				}
			}
			const failure = error instanceof CmsCloudflareError
				? error
				: new CmsCloudflareError(500, 'rebuild_failed', 'Unable to process the CMS rebuild request.', true)
			return rebuildJsonResponse({
				ok: false,
				code: failure.code,
				message: failure.message,
				retryable: failure.retryable
			}, failure.status, failure.status === 405 ? {'allow': 'POST'} : undefined)
		}
	}

const rebuildJsonResponse = (
	body: Record<string, unknown>,
	status: number,
	initialHeaders?: ConstructorParameters<typeof Headers>[0]
) => {
	const headers = new Headers(initialHeaders)
	headers.set('cache-control', 'private, no-store')
	headers.set('content-type', 'application/json; charset=utf-8')
	return new Response(JSON.stringify(body), {status, headers})
}

const assertCmsRebuildEvent: (value: unknown) => asserts value is CmsRebuildEvent = (value) => {
	const event = asRecord(value)
	const resource = asRecord(event.resource)
	const validTypes: CmsRebuildEventType[] = [
		'cms.content.published',
		'cms.content.unpublished',
		'cms.forms.published',
		'cms.forms.unpublished',
		'cms.seo.published'
	]
	const validKinds: CmsRebuildResource['kind'][] = ['collection', 'form', 'seo', 'single']
	if (
		event.version !== 1 ||
		typeof event.id !== 'string' || !event.id ||
		typeof event.organizationId !== 'string' || !event.organizationId ||
		typeof event.occurredAt !== 'string' || !Number.isFinite(new Date(event.occurredAt).getTime()) ||
		typeof event.type !== 'string' || !validTypes.includes(event.type as CmsRebuildEventType) ||
		typeof resource.id !== 'string' || !resource.id ||
		typeof resource.kind !== 'string' || !validKinds.includes(resource.kind as CmsRebuildResource['kind']) ||
		(resource.apiId !== undefined && typeof resource.apiId !== 'string')
	) {
		throw new CmsCloudflareError(400, 'event_invalid', 'CMS rebuild event is invalid.')
	}
}

const validateDeployHookUrl = (value: string) => {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new CmsCloudflareError(500, 'deploy_hook_url_invalid', 'Cloudflare Deploy Hook URL is invalid.')
	}
	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'api.cloudflare.com' ||
		!/^\/client\/v4\/workers\/builds\/deploy_hooks\/[0-9a-f-]+$/i.test(url.pathname) ||
		url.username || url.password || url.search || url.hash
	) {
		throw new CmsCloudflareError(500, 'deploy_hook_url_invalid', 'Cloudflare Deploy Hook URL is invalid.')
	}
	return url
}

const sign = async(value: string, secret: string) => {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{name: 'HMAC', hash: 'SHA-256'},
		false,
		['sign']
	)
	return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))))
}

const verifySignature = async(value: string, secret: string, signature: string) => {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{name: 'HMAC', hash: 'SHA-256'},
		false,
		['verify']
	)
	return crypto.subtle.verify('HMAC', key, fromHex(signature), encoder.encode(value))
}

const fromHex = (value: string) => {
	const bytes = new Uint8Array(value.length / 2)
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}

const toHex = (value: Uint8Array) =>
	Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')

const assertNonEmpty = (value: string, name: string) => {
	if (!value.trim()) throw new CmsCloudflareError(400, `${name}_required`, `${name} is required.`)
}

const assertSecret = (value: string) => {
	if (!value || encoder.encode(value).byteLength < 32) {
		throw new CmsCloudflareError(500, 'signing_secret_invalid', 'CMS rebuild signing secret must be at least 32 bytes.')
	}
}

const normalizePositiveInteger = (value: number, name: string) => {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new CmsCloudflareError(500, `${name}_invalid`, `${name} must be a positive integer.`)
	}
	return value
}

const resolveNow = (input?: Date | number | string) => {
	const value = input === undefined ? Date.now() : new Date(input).getTime()
	if (!Number.isFinite(value)) throw new CmsCloudflareError(500, 'now_invalid', 'now must be a valid date.')
	return value
}

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {}
