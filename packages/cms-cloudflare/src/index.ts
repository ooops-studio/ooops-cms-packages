import {
	createCmsPreviewClient,
	type CmsApiFetch,
	type OoopsCmsPreviewClient
} from '@ooopsstudio/cms-api'

export type CmsPreviewKind = 'collection' | 'single'

export type CmsPreviewSession = {
	apiId: string;
	expiresAt: number;
	kind: CmsPreviewKind;
	previewToken: string;
	slug?: string;
}

export type CreateCmsPreviewSessionInput = Omit<CmsPreviewSession, 'expiresAt'> & {
	now?: Date | number | string;
	ttlSeconds?: number;
}

export type CmsPreviewCookieOptions = {
	secret: string;
	secure: boolean;
	cookieName?: string;
	path?: string;
	ttlSeconds?: number;
}

export type ReadCmsPreviewSessionOptions = Pick<CmsPreviewCookieOptions, 'secret' | 'cookieName'> & {
	now?: Date | number | string;
}

export type CmsPreviewClientOptions = {
	baseUrl: string;
	token: string;
	fetch?: CmsApiFetch;
	timeoutMs?: number;
}

export type CmsPreviewClientFromRequest = {
	client: OoopsCmsPreviewClient;
	previewToken: string;
}

export type JsonResponseInit = NonNullable<ConstructorParameters<typeof Response>[1]>

const defaultCookieName = 'ooops_cms_preview'
const defaultCookiePath = '/preview/content/'
const defaultTtlSeconds = 30 * 60
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Read the opaque preview token issued by Ooops CMS from the canonical query parameter. */
export const readCmsPreviewToken = (request: Request, parameter = 'preview') => {
	const token = new URL(request.url).searchParams.get(parameter)?.trim()
	return token || null
}

/** Build the consumer route shape that Ooops CMS uses for draft preview redirects. */
export const cmsPreviewPath = ({
	apiId,
	kind,
	slug
}: Pick<CmsPreviewSession, 'apiId' | 'kind' | 'slug'>) => {
	assertNonEmpty(apiId, 'apiId')
	if (kind === 'collection') {
		assertNonEmpty(slug ?? '', 'slug')
		return `/preview/content/collections/${encodeURIComponent(apiId)}/${encodeURIComponent(slug ?? '')}`
	}
	return `/preview/content/singles/${encodeURIComponent(apiId)}`
}

/** Create the read-only CMS client used to validate a preview token server-side. */
export const createCmsPreviewClientFromRequest = (
	request: Request,
	options: CmsPreviewClientOptions & {previewParameter?: string}
): CmsPreviewClientFromRequest | null => {
	const previewToken = readCmsPreviewToken(request, options.previewParameter)
	if (!previewToken) return null
	return {
		previewToken,
		client: createCmsPreviewClient({...options, previewToken})
	}
}

/** Recreate the read-only CMS client from a validated, encrypted preview session. */
export const createCmsPreviewClientFromSession = (
	session: CmsPreviewSession,
	options: CmsPreviewClientOptions
) => createCmsPreviewClient({...options, previewToken: session.previewToken})

export const createCmsPreviewSession = (
	input: CreateCmsPreviewSessionInput
): CmsPreviewSession => {
	assertNonEmpty(input.apiId, 'apiId')
	assertNonEmpty(input.previewToken, 'previewToken')
	if (input.kind === 'collection') assertNonEmpty(input.slug ?? '', 'slug')
	const ttlSeconds = normalizeTtl(input.ttlSeconds)
	return {
		apiId: input.apiId,
		expiresAt: resolveNow(input.now) + ttlSeconds * 1_000,
		kind: input.kind,
		previewToken: input.previewToken,
		...(input.slug ? {slug: input.slug} : {})
	}
}

/** Encrypt a preview session using AES-GCM before placing it in an HttpOnly cookie. */
export const serializeCmsPreviewSessionCookie = async(
	session: CmsPreviewSession,
	options: CmsPreviewCookieOptions
) => {
	assertNonEmpty(options.secret, 'secret')
	const cookieName = options.cookieName ?? defaultCookieName
	const path = normalizeCookiePath(options.path)
	const ttlSeconds = normalizeTtl(options.ttlSeconds)
	const value = await encryptSession(session, options.secret)
	return `${cookieName}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${options.secure ? '; Secure' : ''}`
}

/** Decrypt and validate an existing preview session. Invalid or expired cookies are ignored. */
export const readCmsPreviewSession = async(
	request: Request,
	options: ReadCmsPreviewSessionOptions
): Promise<CmsPreviewSession | null> => {
	if (!options.secret) return null
	const cookieName = options.cookieName ?? defaultCookieName
	const value = parseCookies(request.headers.get('cookie'))[cookieName]
	if (!value) return null

	const [rawIv, rawCiphertext, ...rest] = value.split('.')
	if (!rawIv || !rawCiphertext || rest.length > 0) return null

	try {
		const decrypted = await crypto.subtle.decrypt(
			{name: 'AES-GCM', iv: fromBase64Url(rawIv)},
			await getCookieKey(options.secret),
			fromBase64Url(rawCiphertext)
		)
		return asSession(JSON.parse(decoder.decode(decrypted)), resolveNow(options.now))
	} catch {
		return null
	}
}

export const clearCmsPreviewSessionCookie = (
	options: Pick<CmsPreviewCookieOptions, 'secure' | 'cookieName' | 'path'>
) => {
	const cookieName = options.cookieName ?? defaultCookieName
	const path = normalizeCookiePath(options.path)
	return `${cookieName}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${options.secure ? '; Secure' : ''}`
}

/** Apply the cache and indexing protections required for private draft previews. */
export const cmsPreviewResponseHeaders = (initial?: ConstructorParameters<typeof Headers>[0]) => {
	const headers = new Headers(initial)
	headers.set('cache-control', 'private, no-store')
	headers.set('referrer-policy', 'no-referrer')
	headers.set('x-robots-tag', 'noindex, nofollow, noarchive')
	return headers
}

export const withCmsPreviewResponseHeaders = (response: Response) =>
	new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: cmsPreviewResponseHeaders(response.headers)
	})

export const jsonResponse = (body: unknown, init: JsonResponseInit = {}) => {
	const headers = new Headers(init.headers)
	headers.set('content-type', 'application/json; charset=utf-8')
	return new Response(JSON.stringify(body), {...init, headers})
}

const encryptSession = async(session: CmsPreviewSession, secret: string) => {
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const encrypted = await crypto.subtle.encrypt(
		{name: 'AES-GCM', iv},
		await getCookieKey(secret),
		encoder.encode(JSON.stringify(session))
	)
	return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`
}

const getCookieKey = async(secret: string) => {
	const material = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{name: 'PBKDF2'},
		false,
		['deriveKey']
	)
	return crypto.subtle.deriveKey(
		{name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000, salt: encoder.encode('ooops-cms-preview-v1')},
		material,
		{name: 'AES-GCM', length: 256},
		false,
		['encrypt', 'decrypt']
	)
}

const asSession = (value: unknown, now: number): CmsPreviewSession | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const input = value as Record<string, unknown>
	if (input.kind !== 'collection' && input.kind !== 'single') return null
	if (typeof input.apiId !== 'string' || !input.apiId) return null
	if (typeof input.previewToken !== 'string' || !input.previewToken) return null
	if (typeof input.expiresAt !== 'number' || input.expiresAt <= now) return null
	if (input.slug !== undefined && typeof input.slug !== 'string') return null
	if (input.kind === 'collection' && !input.slug) return null
	return {
		apiId: input.apiId,
		expiresAt: input.expiresAt,
		kind: input.kind,
		previewToken: input.previewToken,
		...(typeof input.slug === 'string' ? {slug: input.slug} : {})
	}
}

const parseCookies = (header: string | null) =>
	Object.fromEntries(
		(header ?? '')
			.split(';')
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const separator = part.indexOf('=')
				return separator === -1
					? [part, '']
					: [part.slice(0, separator), part.slice(separator + 1)]
			})
	)

const normalizeCookiePath = (value = defaultCookiePath) => {
	if (!value.startsWith('/') || value.includes(';') || /[\r\n]/.test(value)) {
		throw new Error('path must be a safe absolute cookie path.')
	}
	return value
}

const normalizeTtl = (value = defaultTtlSeconds) => {
	if (!Number.isFinite(value) || value <= 0) throw new Error('ttlSeconds must be greater than zero.')
	return Math.floor(value)
}

const resolveNow = (input?: Date | number | string) => {
	const value = input === undefined ? Date.now() : new Date(input).getTime()
	if (!Number.isFinite(value)) throw new Error('now must be a valid date.')
	return value
}

const toBase64Url = (value: Uint8Array) => {
	let binary = ''
	for (const byte of value) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const fromBase64Url = (value: string) => {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
	const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
	return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const assertNonEmpty = (value: string, field: string) => {
	if (!value) throw new Error(`${field} is required.`)
}
