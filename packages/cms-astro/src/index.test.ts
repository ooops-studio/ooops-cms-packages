import {describe, expect, it} from 'vitest'

import {
	CmsAstroEnvError,
	alternateLocales,
	articleJsonLd,
	canonicalForLocale,
	createCanonicalUrl,
	createSitemapUrl,
	createCmsClientFromAstroEnv,
	localeFromPathname,
	localePath,
	mergeSitemapUrls,
	readCmsAstroEnv,
	renderSitemapXml,
	websiteJsonLd
} from './index'

describe('env helpers', () => {
	it('reads CMS env vars and normalizes URLs', () => {
		expect(readCmsAstroEnv({
			OOOPS_CMS_API_BASE_URL: 'https://cms.example/v1/',
			OOOPS_CMS_API_TOKEN: 'cms-token',
			PUBLIC_SITE_URL: 'https://site.example/'
		})).toEqual({
			enabled: true,
			apiBaseUrl: 'https://cms.example/v1',
			apiToken: 'cms-token',
			siteUrl: 'https://site.example',
			missing: []
		})
	})

	it('returns disabled state when CMS env is missing', () => {
		expect(readCmsAstroEnv({})).toMatchObject({
			enabled: false,
			siteUrl: 'http://localhost:4321',
			missing: ['OOOPS_CMS_API_BASE_URL', 'OOOPS_CMS_API_TOKEN']
		})
	})

	it('throws in strict mode and creates clients only when configured', () => {
		expect(() => readCmsAstroEnv({}, {strict: true})).toThrow(CmsAstroEnvError)
		expect(createCmsClientFromAstroEnv({})).toBeNull()
		expect(createCmsClientFromAstroEnv({
			OOOPS_CMS_API_BASE_URL: 'https://cms.example/v1',
			OOOPS_CMS_API_TOKEN: 'token'
		})).toMatchObject({baseUrl: 'https://cms.example/v1'})
	})
})

describe('sitemap helpers', () => {
	it('normalizes canonical URLs and sitemap entries', () => {
		expect(createCanonicalUrl('https://site.example/', 'posts/hello')).toBe('https://site.example/posts/hello')
		expect(createSitemapUrl('https://site.example/', '/', {priority: 2})).toEqual({
			loc: 'https://site.example/',
			priority: 2
		})
	})

	it('merges and renders escaped sitemap XML', () => {
		const urls = mergeSitemapUrls(
			[createSitemapUrl('https://site.example', '/a&b', {
				lastmod: new Date('2026-07-09T10:00:00.000Z'),
				changefreq: 'weekly',
				priority: 1.8,
				alternates: [{hreflang: 'el', href: 'https://site.example/el/a&b'}]
			})],
			[null, undefined]
		)
		const xml = renderSitemapXml(urls)

		expect(xml).toContain('<loc>https://site.example/a&amp;b</loc>')
		expect(xml).toContain('<lastmod>2026-07-09T10:00:00.000Z</lastmod>')
		expect(xml).toContain('<priority>1.0</priority>')
		expect(xml).toContain('hreflang="el"')
		expect(xml).toContain('https://site.example/el/a&amp;b')
	})
})

describe('json-ld helpers', () => {
	it('creates website JSON-LD without empty optional fields', () => {
		expect(websiteJsonLd({
			name: 'Site',
			url: 'https://site.example',
			description: null,
			sameAs: []
		})).toEqual({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: 'Site',
			url: 'https://site.example'
		})
	})

	it('creates article JSON-LD with serialized dates', () => {
		expect(articleJsonLd({
			headline: 'Article',
			url: 'https://site.example/article',
			datePublished: new Date('2026-07-09T10:00:00.000Z'),
			authorName: 'Ion'
		})).toMatchObject({
			'@type': 'Article',
			headline: 'Article',
			datePublished: '2026-07-09T10:00:00.000Z',
			author: {'@type': 'Person', name: 'Ion'}
		})
	})
})

describe('locale helpers', () => {
	it('keeps default locale unprefixed and prefixes secondary locales', () => {
		expect(localePath({locale: 'en', defaultLocale: 'en', path: '/about'})).toBe('/about')
		expect(localePath({locale: 'el', defaultLocale: 'en', path: '/about'})).toBe('/el/about')
		expect(localePath({locale: 'en', defaultLocale: 'en', path: '/en/about'})).toBe('/about')
	})

	it('creates localized canonicals and alternates', () => {
		expect(canonicalForLocale({
			siteUrl: 'https://site.example/',
			locale: 'el',
			defaultLocale: 'en',
			path: '/about'
		})).toBe('https://site.example/el/about')

		expect(alternateLocales({
			siteUrl: 'https://site.example',
			locales: ['en', 'el'],
			defaultLocale: 'en',
			pathByLocale: {en: '/about', el: '/about'}
		})).toEqual([
			{locale: 'en', hreflang: 'en', href: 'https://site.example/about'},
			{locale: 'el', hreflang: 'el', href: 'https://site.example/el/about'}
		])
	})

	it('detects locale from pathnames', () => {
		expect(localeFromPathname({pathname: '/el/about', locales: ['en', 'el'], defaultLocale: 'en'})).toBe('el')
		expect(localeFromPathname({pathname: '/about', locales: ['en', 'el'], defaultLocale: 'en'})).toBe('en')
	})
})
