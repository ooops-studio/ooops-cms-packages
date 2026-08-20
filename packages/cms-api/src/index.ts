export type CmsApiFetch = typeof fetch

export type OoopsCmsClientOptions = {
	baseUrl: string;
	token: string;
	fetch?: CmsApiFetch;
	timeoutMs?: number;
}

export type CmsApiRequestOptions = {
	query?: Record<
		string,
		string | number | boolean | readonly (string | number | boolean)[] | null | undefined
	>;
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export type CmsQuery = CmsApiRequestOptions['query']

export type CmsRecord = Record<string, unknown>

export type CmsSingleResponse<T = CmsRecord> = {
	ok: true;
	content: T;
}

export type CmsCollectionResponse<T = CmsRecord> = {
	ok: true;
	items: T[];
	nextCursor?: string | null;
}

export type CmsCollectionEntryResponse<T = CmsRecord> = {
	ok: true;
	item: T;
}

export type CmsPublicFormSubmissionInput = {
	answers: Record<string, unknown>;
	submitterIdentity?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export type CmsPublicFormsClientOptions = {
	baseUrl: string;
	fetch?: CmsApiFetch;
	timeoutMs?: number;
}

export type CmsPreviewClientOptions = {
	baseUrl: string;
	token: string;
	previewToken: string;
	fetch?: CmsApiFetch;
	timeoutMs?: number;
}

export type CmsDraftWriterOptions = OoopsCmsClientOptions

export type CmsApiTokenPreset = 'website_read' | 'draft_editor'

export type CmsApiGrantFieldSummary = {
	apiId: string;
	displayName: string;
	kind: string;
	isLocalized: boolean;
}

export type CmsApiGrantSummary = {
	apiId: string;
	displayName: string;
	kind: 'single' | 'collection';
	fields: CmsApiGrantFieldSummary[];
}

export type CmsTokenInspectionResponse = {
	ok: true;
	token: {
		organization: {id: string; slug: string; name: string};
		preset: CmsApiTokenPreset;
		expiresAt: string;
		scopes: string[];
		grants: CmsApiGrantSummary[];
	};
}

export type CmsDraftFieldSetOperation = {
	op: 'field.set';
	field: string;
	locale?: string;
	value: unknown;
}

export type CmsDraftFieldPatchOperation = {
	op: 'field.patch';
	field: string;
	locale?: string;
	action: 'add' | 'replace' | 'remove';
	path: string;
	value?: unknown;
}

export type CmsDraftRepeatableAddOperation = {
	op: 'repeatable.add';
	field: string;
	afterId?: string | null;
	value?: {values?: Record<string, unknown>; localized?: Record<string, Record<string, unknown>>};
}

export type CmsDraftRepeatablePatchOperation = {
	op: 'repeatable.patch';
	field: string;
	rowId: string;
	child: string;
	locale?: string;
	value: unknown;
}

export type CmsDraftRepeatableRemoveOperation = {
	op: 'repeatable.remove';
	field: string;
	rowId: string;
}

export type CmsDraftRepeatableMoveOperation = {
	op: 'repeatable.move';
	field: string;
	rowId: string;
	afterId?: string | null;
}

export type CmsDraftOperation =
	| CmsDraftFieldSetOperation
	| CmsDraftFieldPatchOperation
	| CmsDraftRepeatableAddOperation
	| CmsDraftRepeatablePatchOperation
	| CmsDraftRepeatableRemoveOperation
	| CmsDraftRepeatableMoveOperation

export type CmsDraftResponse<TValues extends CmsRecord = CmsRecord> = {
	ok: true;
	entryId: string;
	apiId: string;
	kind: 'single' | 'collection';
	status: string;
	values: TValues;
	revision: string;
	etag: string;
}

export type CmsApiErrorBody = {
	ok: false;
	error: string;
	code: string;
	message: string;
}

export class OoopsCmsApiError extends Error {
	readonly status: number
	readonly code: string
	readonly body: unknown

	constructor(status: number, code: string, message: string, body: unknown) {
		super(message)
		this.name = 'OoopsCmsApiError'
		this.status = status
		this.code = code
		this.body = body
	}
}

const trimSlashes = (value: string) => value.replace(/\/+$/, '')

const appendQuery = (url: URL, query?: CmsApiRequestOptions['query']) => {
	if (!query) return
	for (const [key, value] of Object.entries(query)) {
		if (value === null || value === undefined || value === '') continue
		if (Array.isArray(value)) {
			for (const item of value) url.searchParams.append(key, String(item))
		} else {
			url.searchParams.set(key, String(value))
		}
	}
}

const parseJsonResponse = async(response: Response) => {
	const text = await response.text()
	if (!text) return null
	try {
		return JSON.parse(text) as unknown
	} catch {
		throw new OoopsCmsApiError(
			response.status,
			'invalid_json_response',
			'CMS API returned invalid JSON.',
			text
		)
	}
}

const composeSignals = (signals: AbortSignal[]) => {
	const activeSignals = signals.filter(Boolean)
	if (activeSignals.length === 0) return undefined
	if (activeSignals.length === 1) return activeSignals[0]
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
		return AbortSignal.any(activeSignals)
	}
	const controller = new AbortController()
	const abort = () => controller.abort()
	for (const signal of activeSignals) {
		if (signal.aborted) {
			controller.abort()
			break
		}
		signal.addEventListener('abort', abort, {once: true})
	}
	return controller.signal
}

const queryOptions = (query?: CmsApiRequestOptions['query']): CmsApiRequestOptions =>
	query ? {query} : {}

class CmsApiTransport {
	readonly baseUrl: string
	private readonly token: string
	private readonly fetchImpl: CmsApiFetch
	private readonly timeoutMs?: number

	constructor(options: OoopsCmsClientOptions) {
		if (!options.baseUrl) throw new Error('baseUrl is required.')
		if (!options.token) throw new Error('token is required.')
		this.baseUrl = trimSlashes(options.baseUrl)
		this.token = options.token
		this.fetchImpl = options.fetch ?? fetch
		if (options.timeoutMs !== undefined) {
			this.timeoutMs = options.timeoutMs
		}
	}

	async requestWithResponse<T>(
		method: string,
		path: string,
		options: CmsApiRequestOptions = {}
	): Promise<{data: T; response: Response}> {
		const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
		appendQuery(url, options.query)
		const timeoutMs = options.timeoutMs ?? this.timeoutMs
		const timeoutController = timeoutMs ? new AbortController() : null
		const timeout = timeoutController
			? setTimeout(() => timeoutController.abort(
				new DOMException('CMS API request timed out.', 'TimeoutError')
			), timeoutMs)
			: null
		const signal = composeSignals([
			...(options.signal ? [options.signal] : []),
			...(timeoutController ? [timeoutController.signal] : [])
		])
		try {
			const requestInit: RequestInit = {
				method,
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${this.token}`,
					...(options.body === undefined ? {} : {'content-type': 'application/json'}),
					...options.headers
				}
			}

			if (options.body !== undefined) {
				requestInit.body = JSON.stringify(options.body)
			}

			if (signal) {
				requestInit.signal = signal
			}

			const response = await this.fetchImpl(url, requestInit)
			const parsed = await parseJsonResponse(response)
			if (!response.ok) {
				const body = parsed as Partial<CmsApiErrorBody> | null
				throw new OoopsCmsApiError(
					response.status,
					body?.code || body?.error || 'cms_api_error',
					body?.message || response.statusText,
					parsed
				)
			}
			return {data: parsed as T, response}
		} catch(error) {
			if (timeoutController?.signal.aborted && !(error instanceof OoopsCmsApiError)) {
				throw new OoopsCmsApiError(408, 'request_timeout', 'CMS API request timed out.', null)
			}
			throw error
		} finally {
			if (timeout) clearTimeout(timeout)
		}
	}

	async request<T>(method: string, path: string, options: CmsApiRequestOptions = {}): Promise<T> {
		return (await this.requestWithResponse<T>(method, path, options)).data
	}
}

export class OoopsCmsClient {
	readonly baseUrl: string
	private readonly transport: CmsApiTransport

	constructor(options: OoopsCmsClientOptions) {
		this.transport = new CmsApiTransport(options)
		this.baseUrl = this.transport.baseUrl
	}

	schema = {
		list: <T = unknown>() => this.transport.request<T>('GET', '/schema')
	}

	content = {
		listCollections: <T = unknown>() => this.transport.request<T>('GET', '/content/collections'),
		listCollectionEntries: <T = unknown>(apiId: string, query?: CmsApiRequestOptions['query']) =>
			this.transport.request<T>(
				'GET',
				`/content/collections/${encodeURIComponent(apiId)}/entries`,
				queryOptions(query)
			),
		getCollectionEntry: <T = unknown>(apiId: string, idOrSlug: string) =>
			this.transport.request<T>(
				'GET',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(idOrSlug)}`
			),
		listSingles: <T = unknown>() => this.transport.request<T>('GET', '/content/singles'),
		getSingle: <T = unknown>(apiId: string) => this.transport.request<T>('GET', `/content/singles/${encodeURIComponent(apiId)}`)
	}

	media = {
		list: <T = unknown>(query?: CmsApiRequestOptions['query']) =>
			this.transport.request<T>('GET', '/media', queryOptions(query)),
		get: <T = unknown>(id: string) => this.transport.request<T>('GET', `/media/${encodeURIComponent(id)}`)
	}

	forms = {
		list: <T = unknown>(query?: CmsApiRequestOptions['query']) => this.transport.request<T>('GET', '/forms', queryOptions(query)),
		get: <T = unknown>(formId: string) => this.transport.request<T>('GET', `/forms/${encodeURIComponent(formId)}`),
		listSubmissions: <T = unknown>(formId: string, query?: CmsApiRequestOptions['query']) =>
			this.transport.request<T>('GET', `/forms/${encodeURIComponent(formId)}/submissions`, queryOptions(query)),
		getSubmission: <T = unknown>(formId: string, submissionId: string) =>
			this.transport.request<T>('GET', `/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(submissionId)}`)
	}

	analytics = {
		dashboard: <T = unknown>(query?: CmsApiRequestOptions['query']) => this.transport.request<T>('GET', '/analytics/dashboard', queryOptions(query)),
		/** Fetch from the consumer server; never expose the CMS API token to browsers. */
		runtime: <T = unknown>() => this.transport.request<T>('GET', '/analytics/runtime'),
		overview: <T = unknown>(query?: CmsApiRequestOptions['query']) => this.transport.request<T>('GET', '/analytics/overview', queryOptions(query)),
		series: <T = unknown>(query?: CmsApiRequestOptions['query']) => this.transport.request<T>('GET', '/analytics/series', queryOptions(query)),
		realtime: <T = unknown>(query?: CmsApiRequestOptions['query']) => this.transport.request<T>('GET', '/analytics/realtime', queryOptions(query)),
		breakdown: <T = unknown>(dimension: string, query?: CmsApiRequestOptions['query']) =>
			this.transport.request<T>('GET', `/analytics/breakdown/${encodeURIComponent(dimension)}`, queryOptions(query))
	}

	seo = {
		get: <T = unknown>() => this.transport.request<T>('GET', '/seo')
	}
}

export const createCmsClient = (options: OoopsCmsClientOptions) =>
	new OoopsCmsClient(options)

const unquoteEtag = (value: string | null) => {
	if (!value) return null
	const trimmed = value.trim()
	return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed
}

const quoteRevision = (revision: string) => {
	const unquoted = unquoteEtag(revision) ?? revision
	return `"${unquoted}"`
}

export class OoopsCmsDraftWriter {
	readonly baseUrl: string
	private readonly transport: CmsApiTransport

	constructor(options: CmsDraftWriterOptions) {
		if (typeof window !== 'undefined') {
			throw new Error('CMS draft writer tokens are server-side only.')
		}
		this.transport = new CmsApiTransport(options)
		this.baseUrl = this.transport.baseUrl
	}

	token = {
		inspect: () => this.transport.request<CmsTokenInspectionResponse>('GET', '/token')
	}

	private async draftRequest<TValues extends CmsRecord>(
		method: 'GET' | 'PATCH',
		path: string,
		operations?: readonly CmsDraftOperation[],
		revision?: string
	): Promise<CmsDraftResponse<TValues>> {
		const {data, response} = await this.transport.requestWithResponse<Omit<CmsDraftResponse<TValues>, 'etag'>>(
			method,
			path,
			{
				...(operations ? {body: {operations}} : {}),
				...(revision ? {headers: {'if-match': quoteRevision(revision)}} : {})
			}
		)
		const etag = unquoteEtag(response.headers.get('etag')) ?? data.revision
		return {...data, revision: etag, etag}
	}

	drafts = {
		getSingle: <TValues extends CmsRecord = CmsRecord>(apiId: string) =>
			this.draftRequest<TValues>('GET', `/content/singles/${encodeURIComponent(apiId)}/draft`),
		patchSingle: <TValues extends CmsRecord = CmsRecord>(
			apiId: string,
			operations: readonly CmsDraftOperation[],
			revision: string
		) => this.draftRequest<TValues>(
			'PATCH',
			`/content/singles/${encodeURIComponent(apiId)}/draft`,
			operations,
			revision
		),
		getCollectionEntry: <TValues extends CmsRecord = CmsRecord>(apiId: string, entryId: string) =>
			this.draftRequest<TValues>(
				'GET',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(entryId)}/draft`
			),
		patchCollectionEntry: <TValues extends CmsRecord = CmsRecord>(
			apiId: string,
			entryId: string,
			operations: readonly CmsDraftOperation[],
			revision: string
		) => this.draftRequest<TValues>(
			'PATCH',
			`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(entryId)}/draft`,
			operations,
			revision
		)
	}
}

export const createCmsDraftWriter = (options: CmsDraftWriterOptions) =>
	new OoopsCmsDraftWriter(options)

type PublicRequestOptions = {
	baseUrl: string;
	fetch?: CmsApiFetch;
	timeoutMs?: number;
}

const publicRequest = async<T>(
	options: PublicRequestOptions,
	path: string,
	request: {body?: unknown; token?: string; query?: CmsApiRequestOptions['query']} = {}
) => {
	const url = new URL(`${trimSlashes(options.baseUrl)}${path}`)
	appendQuery(url, request.query)
	const controller = options.timeoutMs ? new AbortController() : null
	const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : null
	try {
		const response = await (options.fetch ?? fetch)(url, {
			method: request.body === undefined ? 'GET' : 'POST',
			headers: {
				accept: 'application/json',
				...(request.body === undefined ? {} : {'content-type': 'application/json'}),
				...(request.token ? {authorization: `Bearer ${request.token}`} : {})
			},
			...(request.body === undefined ? {} : {body: JSON.stringify(request.body)}),
			...(controller ? {signal: controller.signal} : {})
		})
		const parsed = await parseJsonResponse(response)
		if (!response.ok) {
			const body = parsed as Partial<CmsApiErrorBody> | null
			throw new OoopsCmsApiError(
				response.status,
				body?.code || body?.error || 'cms_api_error',
				body?.message || response.statusText,
				parsed
			)
		}
		return parsed as T
	} catch(error) {
		if (controller?.signal.aborted && !(error instanceof OoopsCmsApiError)) {
			throw new OoopsCmsApiError(408, 'request_timeout', 'CMS API request timed out.', null)
		}
		throw error
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

const publicFormsBaseUrl = (baseUrl: string) => {
	const normalized = trimSlashes(baseUrl)
	if (normalized.endsWith('/api/cms/v1')) {
		return `${normalized.slice(0, -'/api/cms/v1'.length)}/api/cms/public`
	}
	if (normalized.endsWith('/api/cms/public')) return normalized
	return `${normalized}/api/cms/public`
}

export class OoopsCmsPublicFormsClient {
	readonly forms: {
		submit: <T = unknown>(shareToken: string, body: CmsPublicFormSubmissionInput) => Promise<T>;
	}

	constructor(options: CmsPublicFormsClientOptions) {
		if (!options.baseUrl) throw new Error('baseUrl is required.')
		const requestOptions = {...options, baseUrl: publicFormsBaseUrl(options.baseUrl)}
		this.forms = {
			submit: <T = unknown>(shareToken: string, body: CmsPublicFormSubmissionInput) => {
				if (!shareToken) throw new Error('shareToken is required.')
				return publicRequest<T>(requestOptions, `/forms/${encodeURIComponent(shareToken)}/submissions`, {body})
			}
		}
	}
}

export class OoopsCmsPreviewClient {
	readonly content: {
		getSingle: <T = unknown>(apiId: string) => Promise<T>;
		getCollectionEntry: <T = unknown>(apiId: string, slug: string) => Promise<T>;
	}

	constructor(options: CmsPreviewClientOptions) {
		if (!options.baseUrl) throw new Error('baseUrl is required.')
		if (!options.token) throw new Error('token is required.')
		if (!options.previewToken) throw new Error('previewToken is required.')
		const request = <T>(path: string) =>
			publicRequest<T>(options, path, {
				token: options.token,
				query: {preview: options.previewToken}
			})
		this.content = {
			getSingle: <T = unknown>(apiId: string) =>
				request<T>(`/preview/content/singles/${encodeURIComponent(apiId)}`),
			getCollectionEntry: <T = unknown>(apiId: string, slug: string) =>
				request<T>(`/preview/content/collections/${encodeURIComponent(apiId)}/${encodeURIComponent(slug)}`)
		}
	}
}

export const createCmsPublicFormsClient = (options: CmsPublicFormsClientOptions) =>
	new OoopsCmsPublicFormsClient(options)

export const createCmsPreviewClient = (options: CmsPreviewClientOptions) =>
	new OoopsCmsPreviewClient(options)
