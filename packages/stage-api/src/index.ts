export type StageApiFetch = typeof fetch

export type OoopsStageClientOptions = {
	baseUrl: string;
	token: string;
	fetch?: StageApiFetch;
	timeoutMs?: number;
}

export type StageApiRequestOptions = {
	query?: Record<
		string,
		string | number | boolean | readonly (string | number | boolean)[] | null | undefined
	>;
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export type ContentLifecycleMetadata = {
	versionLabel?: string | null;
	versionNote?: string | null;
}

export type ScheduleContentLifecycleOptions = ContentLifecycleMetadata & {
	scheduledFor: string | Date;
}

export type StageMediaUploadRequest = {
	fileName: string;
	mimeType: string;
	sizeBytes: number;
}

export type StageMediaUploadInput = StageMediaUploadRequest & {
	data: Blob | ArrayBuffer | ArrayBufferView | string;
	complete?: Record<string, unknown>;
}

export type StageApiErrorBody = {
	ok: false;
	error: string;
	code: string;
	message: string;
}

export class OoopsStageApiError extends Error {
	readonly status: number
	readonly code: string
	readonly body: unknown

	constructor(status: number, code: string, message: string, body: unknown) {
		super(message)
		this.name = 'OoopsStageApiError'
		this.status = status
		this.code = code
		this.body = body
	}
}

const trimSlashes = (value: string) => value.replace(/\/+$/, '')

const appendQuery = (url: URL, query?: StageApiRequestOptions['query']) => {
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
		throw new OoopsStageApiError(
			response.status,
			'invalid_json_response',
			'Stage API returned invalid JSON.',
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

const serializeScheduledFor = (value: string | Date) =>
	value instanceof Date ? value.toISOString() : value

const queryOptions = (query?: StageApiRequestOptions['query']): StageApiRequestOptions =>
	query ? {query} : {}

const lifecycleBody = (
	action: 'publish' | 'schedule',
	input?: ContentLifecycleMetadata | ScheduleContentLifecycleOptions
) => ({
	action,
	...(action === 'schedule' ?
		{scheduledFor: serializeScheduledFor((input as ScheduleContentLifecycleOptions).scheduledFor)} :
		{}),
	...(input?.versionLabel === undefined ? {} : {versionLabel: input.versionLabel}),
	...(input?.versionNote === undefined ? {} : {versionNote: input.versionNote})
})

export class OoopsStageClient {
	readonly baseUrl: string
	private readonly token: string
	private readonly fetchImpl: StageApiFetch
	private readonly timeoutMs?: number

	constructor(options: OoopsStageClientOptions) {
		if (!options.baseUrl) throw new Error('baseUrl is required.')
		if (!options.token) throw new Error('token is required.')
		this.baseUrl = trimSlashes(options.baseUrl)
		this.token = options.token
		this.fetchImpl = options.fetch ?? fetch
		if (options.timeoutMs !== undefined) {
			this.timeoutMs = options.timeoutMs
		}
	}

	async request<T>(method: string, path: string, options: StageApiRequestOptions = {}): Promise<T> {
		const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
		appendQuery(url, options.query)
		const timeoutMs = options.timeoutMs ?? this.timeoutMs
		const timeoutController = timeoutMs ? new AbortController() : null
		const timeout = timeoutController
			? setTimeout(() => timeoutController.abort(
				new DOMException('Stage API request timed out.', 'TimeoutError')
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
				const body = parsed as Partial<StageApiErrorBody> | null
				throw new OoopsStageApiError(
					response.status,
					body?.code || body?.error || 'stage_api_error',
					body?.message || response.statusText,
					parsed
				)
			}
			return parsed as T
		} finally {
			if (timeout) clearTimeout(timeout)
		}
	}

	schema = {
		list: <T = unknown>() => this.request<T>('GET', '/schema')
	}

	imports = {
		validate: <T = unknown>(bundle: unknown) => this.request<T>('POST', '/imports/validate', {body: bundle}),
		apply: <T = unknown>(bundle: unknown) => this.request<T>('POST', '/imports/apply', {body: bundle})
	}

	content = {
		listCollections: <T = unknown>() => this.request<T>('GET', '/content/collections'),
		listCollectionEntries: <T = unknown>(apiId: string, query?: StageApiRequestOptions['query']) =>
			this.request<T>(
				'GET',
				`/content/collections/${encodeURIComponent(apiId)}/entries`,
				queryOptions(query)
			),
		getCollectionEntry: <T = unknown>(apiId: string, idOrSlug: string) =>
			this.request<T>(
				'GET',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(idOrSlug)}`
			),
		createCollectionEntry: <T = unknown>(apiId: string, body: unknown) =>
			this.request<T>('POST', `/content/collections/${encodeURIComponent(apiId)}/entries`, {body}),
		updateCollectionEntry: <T = unknown>(apiId: string, idOrSlug: string, body: unknown) =>
			this.request<T>(
				'PATCH',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(idOrSlug)}`,
				{body}
			),
		publishCollectionEntry: <T = unknown>(
			apiId: string,
			idOrSlug: string,
			metadata?: ContentLifecycleMetadata
		) =>
			this.request<T>(
				'POST',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(idOrSlug)}`,
				{body: lifecycleBody('publish', metadata)}
			),
		scheduleCollectionEntry: <T = unknown>(
			apiId: string,
			idOrSlug: string,
			options: ScheduleContentLifecycleOptions
		) =>
			this.request<T>(
				'POST',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(idOrSlug)}`,
				{body: lifecycleBody('schedule', options)}
			),
		archiveCollectionEntry: <T = unknown>(apiId: string, idOrSlug: string) =>
			this.request<T>(
				'DELETE',
				`/content/collections/${encodeURIComponent(apiId)}/entries/${encodeURIComponent(idOrSlug)}`
			),
		listSingles: <T = unknown>() => this.request<T>('GET', '/content/singles'),
		getSingle: <T = unknown>(apiId: string) => this.request<T>('GET', `/content/singles/${encodeURIComponent(apiId)}`),
		updateSingle: <T = unknown>(apiId: string, body: unknown) =>
			this.request<T>('PATCH', `/content/singles/${encodeURIComponent(apiId)}`, {body}),
		publishSingle: <T = unknown>(apiId: string, metadata?: ContentLifecycleMetadata) =>
			this.request<T>('POST', `/content/singles/${encodeURIComponent(apiId)}`, {body: lifecycleBody('publish', metadata)}),
		scheduleSingle: <T = unknown>(apiId: string, options: ScheduleContentLifecycleOptions) =>
			this.request<T>('POST', `/content/singles/${encodeURIComponent(apiId)}`, {body: lifecycleBody('schedule', options)}),
		archiveSingle: <T = unknown>(apiId: string) => this.request<T>('DELETE', `/content/singles/${encodeURIComponent(apiId)}`)
	}

	media = {
		list: <T = unknown>(query?: StageApiRequestOptions['query']) =>
			this.request<T>('GET', '/media', queryOptions(query)),
		get: <T = unknown>(id: string) => this.request<T>('GET', `/media/${encodeURIComponent(id)}`),
		signUpload: <T = unknown>(body: unknown) => this.request<T>('POST', '/media/sign-upload', {body}),
		completeUpload: <T = unknown>(body: unknown) => this.request<T>('POST', '/media/complete', {body}),
		upload: async <T = unknown>({data, complete, ...request}: StageMediaUploadInput) => {
			const signed = await this.media.signUpload<{
				ok: true;
				url?: string;
				uploadUrl?: string;
				objectKey: string;
				headers?: Record<string, string>;
			}>(request)
			const uploadUrl = signed.uploadUrl ?? signed.url
			if (!uploadUrl) {
				throw new OoopsStageApiError(
					502,
					'upload_url_missing',
					'Stage API did not return an upload URL.',
					signed
				)
			}
			const uploadResponse = await this.fetchImpl(uploadUrl, {
				method: 'PUT',
				headers: {
					'content-type': request.mimeType,
					...(signed.headers ?? {})
				},
				body: data as BodyInit
			})
			if (!uploadResponse.ok) {
				throw new OoopsStageApiError(
					uploadResponse.status,
					'media_upload_failed',
					uploadResponse.statusText || 'Media upload failed.',
					await uploadResponse.text()
				)
			}
			return await this.media.completeUpload<T>({
				...complete,
				fileName: request.fileName,
				objectKey: signed.objectKey,
				mimeType: request.mimeType,
				sizeBytes: request.sizeBytes
			})
		},
		delete: <T = unknown>(id: string) => this.request<T>('DELETE', `/media/${encodeURIComponent(id)}`),
		deleteMany: <T = unknown>(assetIds: string[]) => this.request<T>('DELETE', '/media', {body: {assetIds}})
	}

	forms = {
		list: <T = unknown>(query?: StageApiRequestOptions['query']) => this.request<T>('GET', '/forms', queryOptions(query)),
		get: <T = unknown>(formId: string) => this.request<T>('GET', `/forms/${encodeURIComponent(formId)}`),
		listSubmissions: <T = unknown>(formId: string, query?: StageApiRequestOptions['query']) =>
			this.request<T>('GET', `/forms/${encodeURIComponent(formId)}/submissions`, queryOptions(query)),
		getSubmission: <T = unknown>(formId: string, submissionId: string) =>
			this.request<T>('GET', `/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(submissionId)}`),
		createSubmission: <T = unknown>(shareToken: string, body: unknown) =>
			this.request<T>('POST', `/forms/shares/${encodeURIComponent(shareToken)}/submissions`, {body})
	}

	analytics = {
		dashboard: <T = unknown>(query?: StageApiRequestOptions['query']) => this.request<T>('GET', '/analytics/dashboard', queryOptions(query)),
		overview: <T = unknown>(query?: StageApiRequestOptions['query']) => this.request<T>('GET', '/analytics/overview', queryOptions(query)),
		series: <T = unknown>(query?: StageApiRequestOptions['query']) => this.request<T>('GET', '/analytics/series', queryOptions(query)),
		realtime: <T = unknown>(query?: StageApiRequestOptions['query']) => this.request<T>('GET', '/analytics/realtime', queryOptions(query)),
		breakdown: <T = unknown>(dimension: string, query?: StageApiRequestOptions['query']) =>
			this.request<T>('GET', `/analytics/breakdown/${encodeURIComponent(dimension)}`, queryOptions(query))
	}

	seo = {
		get: <T = unknown>() => this.request<T>('GET', '/seo'),
		write: <T = unknown>(body: unknown) => this.request<T>('POST', '/seo', {body})
	}

	webhooks = {
		list: <T = unknown>() => this.request<T>('GET', '/webhooks'),
		create: <T = unknown>(body: unknown) => this.request<T>('POST', '/webhooks', {body}),
		get: <T = unknown>(id: string) => this.request<T>('GET', `/webhooks/${encodeURIComponent(id)}`),
		update: <T = unknown>(id: string, body: unknown) => this.request<T>('PATCH', `/webhooks/${encodeURIComponent(id)}`, {body}),
		delete: <T = unknown>(id: string) => this.request<T>('DELETE', `/webhooks/${encodeURIComponent(id)}`),
		deliveries: <T = unknown>(id: string, query?: StageApiRequestOptions['query']) =>
			this.request<T>('GET', `/webhooks/${encodeURIComponent(id)}/deliveries`, queryOptions(query))
	}
}
