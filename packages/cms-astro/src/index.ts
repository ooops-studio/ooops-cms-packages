import {OoopsCmsClient} from '@ooopsstudio/cms-api'

export type CmsAstroEnv = Record<string, string | boolean | number | undefined>

export type ReadCmsAstroEnvOptions = {
	strict?: boolean;
	defaultSiteUrl?: string;
}

export type CmsAstroEnvResult = {
	enabled: boolean;
	apiBaseUrl: string;
	apiToken: string;
	siteUrl: string;
	missing: string[];
}

export type CreateCmsClientFromAstroEnvOptions = ReadCmsAstroEnvOptions & {
	fetch?: typeof fetch;
	timeoutMs?: number;
}

export type CmsAstroLocaleConfig = {
	locales: readonly string[];
	defaultLocale: string;
}

export type SitemapChangeFrequency =
	| 'always'
	| 'hourly'
	| 'daily'
	| 'weekly'
	| 'monthly'
	| 'yearly'
	| 'never'

export type SitemapUrl = {
	loc: string;
	lastmod?: string | Date | null;
	changefreq?: SitemapChangeFrequency;
	priority?: number;
	alternates?: Array<{hreflang: string; href: string}>;
}

export type JsonLdPayload = Record<string, unknown>

export type WebsiteJsonLdInput = {
	name: string;
	url: string;
	description?: string | null;
	image?: string | null;
	sameAs?: readonly string[];
}

export type ArticleJsonLdInput = {
	headline: string;
	url: string;
	description?: string | null;
	image?: string | readonly string[] | null;
	datePublished?: string | Date | null;
	dateModified?: string | Date | null;
	authorName?: string | null;
	publisherName?: string | null;
}

export type LocalePathInput = {
	locale: string;
	defaultLocale: string;
	path: string;
}

export type CanonicalForLocaleInput = LocalePathInput & {
	siteUrl: string;
}

export type AlternateLocalesInput = {
	siteUrl: string;
	locales: readonly string[];
	defaultLocale: string;
	pathByLocale: Record<string, string>;
}

export type LocaleFromPathnameInput = {
	pathname: string;
	locales: readonly string[];
	defaultLocale: string;
}

const defaultSiteUrl = 'http://localhost:4321'

export class CmsAstroEnvError extends Error {
	readonly missing: string[]

	constructor(missing: string[]) {
		super(`Missing CMS Astro env: ${missing.join(', ')}`)
		this.name = 'CmsAstroEnvError'
		this.missing = missing
	}
}

export const readCmsAstroEnv = (
	env: CmsAstroEnv,
	options: ReadCmsAstroEnvOptions = {}
): CmsAstroEnvResult => {
	const apiBaseUrl = stringEnv(env.OOOPS_CMS_API_BASE_URL)
	const apiToken = stringEnv(env.OOOPS_CMS_API_TOKEN)
	const siteUrl = normalizeSiteUrl(
		stringEnv(env.PUBLIC_SITE_URL) || options.defaultSiteUrl || defaultSiteUrl
	)
	const missing = [
		...(apiBaseUrl ? [] : ['OOOPS_CMS_API_BASE_URL']),
		...(apiToken ? [] : ['OOOPS_CMS_API_TOKEN'])
	]

	if (options.strict && missing.length > 0) {
		throw new CmsAstroEnvError(missing)
	}

	return {
		enabled: missing.length === 0,
		apiBaseUrl: normalizeSiteUrl(apiBaseUrl),
		apiToken,
		siteUrl,
		missing
	}
}

export const createCmsClientFromAstroEnv = (
	env: CmsAstroEnv,
	options: CreateCmsClientFromAstroEnvOptions = {}
) => {
	const result = readCmsAstroEnv(env, options)
	if (!result.enabled) return null
	return new OoopsCmsClient({
		baseUrl: result.apiBaseUrl,
		token: result.apiToken,
		...(options.fetch ? {fetch: options.fetch} : {}),
		...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs})
	})
}

export const createCanonicalUrl = (siteUrl: string, path: string) =>
	`${normalizeSiteUrl(siteUrl)}${normalizePath(path)}`

export const createSitemapUrl = (
	siteUrl: string,
	path: string,
	options: Omit<SitemapUrl, 'loc'> = {}
): SitemapUrl => ({
	loc: createCanonicalUrl(siteUrl, path),
	...options
})

export const mergeSitemapUrls = (...groups: Array<Array<SitemapUrl | null | undefined>>) =>
	groups.flat().filter((url): url is SitemapUrl => Boolean(url))

export const renderSitemapXml = (urls: SitemapUrl[]) => {
	const hasAlternates = urls.some((url) => (url.alternates?.length ?? 0) > 0)
	const urlsetAttributes = hasAlternates ? [
		'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
		'xmlns:xhtml="http://www.w3.org/1999/xhtml"'
	].join(' ') :
		'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'

	const entries = urls
		.map((url) => {
			const lastmod = url.lastmod instanceof Date ? url.lastmod.toISOString() : url.lastmod
			return [
				'  <url>',
				`    <loc>${escapeXml(url.loc)}</loc>`,
				lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
				url.changefreq ? `    <changefreq>${url.changefreq}</changefreq>` : '',
				typeof url.priority === 'number' ?
					`    <priority>${Math.max(0, Math.min(1, url.priority)).toFixed(1)}</priority>` :
					'',
				...(url.alternates ?? []).map((alternate) =>
					`    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}" />`
				),
				'  </url>'
			].filter(Boolean).join('\n')
		})
		.join('\n')

	return '<?xml version="1.0" encoding="UTF-8"?>\n' +
		`<urlset ${urlsetAttributes}>\n` +
		entries +
		'\n</urlset>\n'
}

export const websiteJsonLd = (input: WebsiteJsonLdInput): JsonLdPayload => stripEmpty({
	'@context': 'https://schema.org',
	'@type': 'WebSite',
	name: input.name,
	url: input.url,
	description: input.description,
	image: input.image,
	sameAs: input.sameAs?.length ? input.sameAs : undefined
})

export const articleJsonLd = (input: ArticleJsonLdInput): JsonLdPayload => stripEmpty({
	'@context': 'https://schema.org',
	'@type': 'Article',
	headline: input.headline,
	url: input.url,
	description: input.description,
	image: input.image,
	datePublished: serializeDate(input.datePublished),
	dateModified: serializeDate(input.dateModified),
	author: input.authorName ? {'@type': 'Person', name: input.authorName} : undefined,
	publisher: input.publisherName ? {'@type': 'Organization', name: input.publisherName} : undefined
})

export const localePath = (input: LocalePathInput) => {
	const path = normalizePath(input.path)
	const localePrefix = `/${input.locale}`
	if (input.locale === input.defaultLocale) {
		if (path === localePrefix) return '/'
		if (path.startsWith(`${localePrefix}/`)) return path.slice(localePrefix.length) || '/'
		return path
	}
	if (path === localePrefix || path.startsWith(`${localePrefix}/`)) return path
	return `${localePrefix}${path === '/' ? '' : path}`
}

export const canonicalForLocale = (input: CanonicalForLocaleInput) =>
	createCanonicalUrl(input.siteUrl, localePath(input))

export const alternateLocales = (input: AlternateLocalesInput) =>
	input.locales.map((locale) => ({
		locale,
		hreflang: locale,
		href: canonicalForLocale({
			siteUrl: input.siteUrl,
			locale,
			defaultLocale: input.defaultLocale,
			path: input.pathByLocale[locale] ?? '/'
		})
	}))

export const localeFromPathname = (input: LocaleFromPathnameInput) => {
	const pathname = normalizePath(input.pathname)
	const matched = input.locales
		.filter((locale) => locale !== input.defaultLocale)
		.find((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`))
	return matched ?? input.defaultLocale
}

const stringEnv = (value: CmsAstroEnv[string]) =>
	typeof value === 'string' ? value.trim() : value === undefined ? '' : String(value).trim()

const normalizeSiteUrl = (value: string) => value.replace(/\/+$/, '')

const normalizePath = (path: string) => {
	const clean = path.trim() || '/'
	return clean.startsWith('/') ? clean : `/${clean}`
}

const escapeXml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')

const serializeDate = (value: string | Date | null | undefined) =>
	value instanceof Date ? value.toISOString() : value || undefined

const stripEmpty = (payload: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(payload).filter(([, value]) =>
			value !== undefined &&
			value !== null &&
			!(Array.isArray(value) && value.length === 0)
		)
	)
