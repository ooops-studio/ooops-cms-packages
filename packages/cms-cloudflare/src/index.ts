export type CmsCloudflareFetch = typeof fetch

export type SignCmsWebhookPayloadInput = {
	secret: string;
	timestamp: string;
	body: string;
}

export type VerifyCmsWebhookSignatureInput = SignCmsWebhookPayloadInput & {
	signature: string;
	toleranceMs?: number;
	now?: Date | number | string;
}

export type CmsWebhookSignatureVerificationResult =
	| {ok: true; timestamp: string}
	| CmsCloudflareErrorResult

export type CmsCloudflareErrorResult = {
	ok: false;
	status: number;
	code: string;
	message: string;
}

export type VerifyCmsWebhookRequestOptions = {
	secret: string;
	allowedEvents?: readonly string[];
	toleranceMs?: number;
	now?: Date | number | string;
}

export type CmsWebhookVerificationResult<TJson = unknown> =
	| {ok: true; event: string; timestamp: string; body: string; json: TJson}
	| {ok: false; status: number; code: string; message: string}

export type CreateCmsPreviewRedirectOptions = {
	previewToken: string;
	previewSecret: string;
	cookieName?: string;
	cookieMaxAgeSeconds?: number;
	defaultRedirectPath?: string;
	tokenParam?: string;
	redirectParam?: string;
	indicatorParam?: string | false;
	now?: Date | number | string;
}

export type VerifyCmsPreviewCookieInput = {
	value: string;
	secret: string;
	toleranceMs?: number;
	now?: Date | number | string;
}

export type CmsPreviewCookieVerificationResult =
	| {ok: true; path: string; timestamp: string}
	| {ok: false; status: number; code: string; message: string}

export type TriggerCloudflarePagesDeployHookResult = {
	ok: boolean;
	status: number;
	text: string;
}

export type HandleCmsRebuildWebhookOptions = VerifyCmsWebhookRequestOptions & {
	deployHookUrl: string;
	fetch?: CmsCloudflareFetch;
}

export type JsonResponseInit = NonNullable<ConstructorParameters<typeof Response>[1]>

const defaultToleranceMs = 5 * 60 * 1000
const defaultPreviewCookieName = 'cms_preview'
const defaultPreviewCookieMaxAgeSeconds = 60 * 60
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const signCmsWebhookPayload = async(input: SignCmsWebhookPayloadInput): Promise<string> => {
	assertNonEmpty(input.secret, 'secret')
	assertNonEmpty(input.timestamp, 'timestamp')
	const hex = await hmacSha256Hex(input.secret, `${input.timestamp}.${input.body}`)
	return `v1=${hex}`
}

export const verifyCmsWebhookSignature = async(
	input: VerifyCmsWebhookSignatureInput
): Promise<CmsWebhookSignatureVerificationResult> => {
	const validationError = validateSignatureInput(input)
	if (validationError) return validationError

	const normalizedSignature = normalizeCmsWebhookSignature(input.signature)
	if (!normalizedSignature) {
		return {
			ok: false,
			status: 401,
			code: 'invalid_signature_format',
			message: 'CMS signature must be a v1 hex digest.'
		}
	}

	const expected = stripSignatureVersion(await signCmsWebhookPayload(input))
	if (!timingSafeHexEqual(expected, normalizedSignature)) {
		return {
			ok: false,
			status: 401,
			code: 'invalid_signature',
			message: 'CMS webhook signature is invalid.'
		}
	}

	return {ok: true, timestamp: input.timestamp}
}

export const verifyCmsWebhookRequest = async<TJson = unknown>(
	request: Request,
	options: VerifyCmsWebhookRequestOptions
): Promise<CmsWebhookVerificationResult<TJson>> => {
	if (!options.secret) {
		return {
			ok: false,
			status: 500,
			code: 'missing_secret',
			message: 'CMS webhook secret is not configured.'
		}
	}

	const timestamp = request.headers.get('x-cms-timestamp') ?? ''
	const signature = request.headers.get('x-cms-signature') ?? ''
	const event = request.headers.get('x-cms-event') ?? ''
	const body = await request.text()

	if (!event) {
		return {
			ok: false,
			status: 400,
			code: 'missing_event',
			message: 'CMS webhook event header is required.'
		}
	}

	if (options.allowedEvents && !options.allowedEvents.includes(event)) {
		return {
			ok: false,
			status: 202,
			code: 'ignored_event',
			message: `CMS webhook event "${event}" is not handled by this endpoint.`
		}
	}

	const signatureInput: VerifyCmsWebhookSignatureInput = {
		secret: options.secret,
		timestamp,
		body,
		signature
	}
	if (options.toleranceMs !== undefined) signatureInput.toleranceMs = options.toleranceMs
	if (options.now !== undefined) signatureInput.now = options.now

	const signatureResult = await verifyCmsWebhookSignature(signatureInput)
	if (!signatureResult.ok) return signatureResult

	try {
		return {
			ok: true,
			event,
			timestamp,
			body,
			json: JSON.parse(body) as TJson
		}
	} catch {
		return {
			ok: false,
			status: 400,
			code: 'invalid_json',
			message: 'CMS webhook body must be valid JSON.'
		}
	}
}

export const createCmsPreviewRedirect = async(
	request: Request,
	options: CreateCmsPreviewRedirectOptions
): Promise<Response> => {
	const url = new URL(request.url)
	const tokenParam = options.tokenParam ?? 'token'
	const redirectParam = options.redirectParam ?? 'redirect'
	const token = url.searchParams.get(tokenParam)
	if (!options.previewToken || token !== options.previewToken) {
		return jsonResponse({ok: false, code: 'invalid_preview_token', message: 'Preview token is invalid.'}, {status: 401})
	}

	let redirectPath = sanitizeRedirectPath(
		url.searchParams.get(redirectParam) ?? options.defaultRedirectPath ?? '/'
	)
	if (!redirectPath) {
		return jsonResponse({ok: false, code: 'invalid_redirect', message: 'Preview redirect must be a relative path.'}, {status: 400})
	}
	if (options.indicatorParam) {
		const markedRedirect = new URL(redirectPath, 'https://cms-preview.local')
		markedRedirect.searchParams.set(options.indicatorParam, '1')
		redirectPath = `${markedRedirect.pathname}${markedRedirect.search}${markedRedirect.hash}`
	}

	const cookieName = options.cookieName ?? defaultPreviewCookieName
	const maxAge = options.cookieMaxAgeSeconds ?? defaultPreviewCookieMaxAgeSeconds
	const cookieValue = await createPreviewCookieValue({
		secret: options.previewSecret,
		path: redirectPath,
		timestamp: resolveTimestamp(options.now)
	})

	const response = new Response(null, {
		status: 302,
		headers: {
			location: redirectPath
		}
	})
	response.headers.append('set-cookie', serializeCookie(cookieName, cookieValue, maxAge))
	return response
}

export const verifyCmsPreviewCookie = async(
	input: VerifyCmsPreviewCookieInput
): Promise<CmsPreviewCookieVerificationResult> => {
	if (!input.secret) {
		return {
			ok: false,
			status: 500,
			code: 'missing_secret',
			message: 'CMS preview secret is not configured.'
		}
	}

	const [payload, signature] = input.value.split('.')
	if (!payload || !signature) {
		return {
			ok: false,
			status: 401,
			code: 'invalid_preview_cookie',
			message: 'CMS preview cookie is malformed.'
		}
	}

	const expected = stripSignatureVersion(await signCmsWebhookPayload({
		secret: input.secret,
		timestamp: payload,
		body: ''
	}))
	if (!timingSafeHexEqual(expected, signature)) {
		return {
			ok: false,
			status: 401,
			code: 'invalid_preview_cookie_signature',
			message: 'CMS preview cookie signature is invalid.'
		}
	}

	let parsed: {path?: unknown; timestamp?: unknown}
	try {
		parsed = JSON.parse(utf8Base64UrlDecode(payload)) as {path?: unknown; timestamp?: unknown}
	} catch {
		return {
			ok: false,
			status: 401,
			code: 'invalid_preview_cookie_payload',
			message: 'CMS preview cookie payload is invalid.'
		}
	}

	if (typeof parsed.path !== 'string' || typeof parsed.timestamp !== 'string') {
		return {
			ok: false,
			status: 401,
			code: 'invalid_preview_cookie_payload',
			message: 'CMS preview cookie payload is incomplete.'
		}
	}

	const timestampError = validateTimestamp(parsed.timestamp, input.toleranceMs, input.now)
	if (timestampError) return timestampError

	return {ok: true, path: parsed.path, timestamp: parsed.timestamp}
}

export const triggerCloudflarePagesDeployHook = async(
	url: string,
	fetchImpl: CmsCloudflareFetch = fetch
): Promise<TriggerCloudflarePagesDeployHookResult> => {
	if (!url) {
		return {ok: false, status: 500, text: 'Cloudflare Pages deploy hook URL is not configured.'}
	}
	const response = await fetchImpl(url, {method: 'POST'})
	const text = await response.text()
	return {ok: response.ok, status: response.status, text}
}

export const handleCmsRebuildWebhook = async(
	request: Request,
	options: HandleCmsRebuildWebhookOptions
): Promise<Response> => {
	const webhook = await verifyCmsWebhookRequest(request, options)
	if (!webhook.ok) {
		return jsonResponse(
			{ok: false, code: webhook.code, message: webhook.message},
			{status: webhook.status}
		)
	}

	const deploy = await triggerCloudflarePagesDeployHook(options.deployHookUrl, options.fetch)
	if (!deploy.ok) {
		return jsonResponse(
			{
				ok: false,
				code: 'deploy_hook_failed',
				status: deploy.status,
				message: deploy.text || 'Cloudflare deploy hook failed.'
			},
			{status: 502}
		)
	}

	return jsonResponse({ok: true, event: webhook.event, deployStatus: deploy.status})
}

export const jsonResponse = (body: unknown, init: JsonResponseInit = {}) => {
	const headers = new Headers(init.headers)
	headers.set('content-type', 'application/json; charset=utf-8')
	return new Response(JSON.stringify(body), {...init, headers})
}

const createPreviewCookieValue = async(
	input: {secret: string; path: string; timestamp: string}
) => {
	assertNonEmpty(input.secret, 'secret')
	const payload = utf8Base64UrlEncode(
		JSON.stringify({path: input.path, timestamp: input.timestamp})
	)
	const signature = stripSignatureVersion(await signCmsWebhookPayload({
		secret: input.secret,
		timestamp: payload,
		body: ''
	}))
	return `${payload}.${signature}`
}

const validateSignatureInput = (
	input: VerifyCmsWebhookSignatureInput
): CmsWebhookSignatureVerificationResult | null => {
	if (!input.secret) {
		return {ok: false, status: 500, code: 'missing_secret', message: 'CMS webhook secret is not configured.'}
	}
	if (!input.timestamp) {
		return {ok: false, status: 400, code: 'missing_timestamp', message: 'CMS webhook timestamp is required.'}
	}
	if (!input.signature) {
		return {ok: false, status: 401, code: 'missing_signature', message: 'CMS webhook signature is required.'}
	}
	return validateTimestamp(input.timestamp, input.toleranceMs, input.now)
}

const validateTimestamp = (
	timestamp: string,
	toleranceMs = defaultToleranceMs,
	nowInput?: Date | number | string
): CmsCloudflareErrorResult | null => {
	const timestampMs = Date.parse(timestamp)
	if (!Number.isFinite(timestampMs)) {
		return {ok: false, status: 400, code: 'invalid_timestamp', message: 'CMS timestamp must be a valid date.'}
	}
	const nowMs = nowInput === undefined ? Date.now() : new Date(nowInput).getTime()
	if (Math.abs(nowMs - timestampMs) > toleranceMs) {
		return {ok: false, status: 401, code: 'stale_timestamp', message: 'CMS timestamp is outside the allowed tolerance.'}
	}
	return null
}

const hmacSha256Hex = async(secret: string, value: string) => {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{name: 'HMAC', hash: 'SHA-256'},
		false,
		['sign']
	)
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
	return bytesToHex(new Uint8Array(signature))
}

const normalizeCmsWebhookSignature = (signature: string) => {
	const value = stripSignatureVersion(signature.trim())
	return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
}

const stripSignatureVersion = (signature: string) =>
	signature.startsWith('v1=') ? signature.slice(3) : signature

const timingSafeHexEqual = (left: string, right: string) => {
	const leftBytes = hexToBytes(left)
	const rightBytes = hexToBytes(right)
	let diff = leftBytes.length ^ rightBytes.length
	const length = Math.max(leftBytes.length, rightBytes.length)
	for (let index = 0; index < length; index += 1) {
		diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
	}
	return diff === 0
}

const bytesToHex = (bytes: Uint8Array) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const hexToBytes = (hex: string) => {
	const bytes = new Uint8Array(Math.ceil(hex.length / 2))
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}

const sanitizeRedirectPath = (value: string) => {
	if (!value.startsWith('/') || value.startsWith('//')) return null
	try {
		const parsed = new URL(value, 'https://cms-preview.local')
		return `${parsed.pathname}${parsed.search}${parsed.hash}`
	} catch {
		return null
	}
}

const serializeCookie = (name: string, value: string, maxAgeSeconds: number) =>
	`${name}=${value}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; Path=/; HttpOnly; Secure; SameSite=Lax`

const resolveTimestamp = (input?: Date | number | string) =>
	input === undefined ? new Date().toISOString() : new Date(input).toISOString()

const utf8Base64UrlEncode = (value: string) =>
	base64ToBase64Url(bytesToBase64(encoder.encode(value)))

const utf8Base64UrlDecode = (value: string) =>
	decoder.decode(base64ToBytes(base64UrlToBase64(value)))

const bytesToBase64 = (bytes: Uint8Array) => {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

const base64ToBytes = (value: string) => {
	const binary = atob(value)
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}
	return bytes
}

const base64ToBase64Url = (value: string) =>
	value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const base64UrlToBase64 = (value: string) => {
	const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
	return padded.replace(/-/g, '+').replace(/_/g, '/')
}

const assertNonEmpty = (value: string, field: string) => {
	if (!value) throw new Error(`${field} is required.`)
}
