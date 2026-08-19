# @ooopsstudio/cms-cloudflare

Cloudflare-friendly helpers for the secure draft-preview contract implemented by Ooops CMS.

The CMS redirects an editor to a consumer route with a short-lived opaque `preview` token. The consumer validates that token server-side with `@ooopsstudio/cms-api`, removes it from the browser URL, and stores it in an encrypted, scoped, `HttpOnly` session cookie. Draft responses must remain private and unindexable.

This package is framework-agnostic and ships no routes, UI, content-model assumptions, or unsupported CMS webhook protocol.

## Install

```sh
pnpm add @ooopsstudio/cms-api @ooopsstudio/cms-cloudflare
```

## Validate the initial CMS handoff

```ts
import {
	createCmsPreviewClientFromRequest,
	createCmsPreviewSession,
	serializeCmsPreviewSessionCookie
} from '@ooopsstudio/cms-cloudflare'

const result = createCmsPreviewClientFromRequest(request, {
	baseUrl: env.OOOPS_CMS_API_BASE_URL,
	token: env.OOOPS_CMS_API_TOKEN
})

if (!result) return new Response('Preview not found', {status: 404})

// This call validates the opaque token against the deployed CMS.
const payload = await result.client.content.getSingle('homepage')
const session = createCmsPreviewSession({
	apiId: 'homepage',
	kind: 'single',
	previewToken: result.previewToken
})
const cookie = await serializeCmsPreviewSessionCookie(session, {
	secret: env.OOOPS_CMS_PREVIEW_SESSION_SECRET,
	secure: new URL(request.url).protocol === 'https:'
})

return new Response(null, {
	status: 302,
	headers: {
		location: '/preview/content/singles/homepage',
		'set-cookie': cookie
	}
})
```

The CMS preview token and CMS API token must never be exposed through a `PUBLIC_*` environment variable or client-side JavaScript.

## Continue a validated preview session

```ts
import {
	createCmsPreviewClientFromSession,
	readCmsPreviewSession
} from '@ooopsstudio/cms-cloudflare'

const session = await readCmsPreviewSession(request, {
	secret: env.OOOPS_CMS_PREVIEW_SESSION_SECRET
})

if (!session) return new Response('Preview not found', {status: 404})

const preview = createCmsPreviewClientFromSession(session, {
	baseUrl: env.OOOPS_CMS_API_BASE_URL,
	token: env.OOOPS_CMS_API_TOKEN
})
const payload = session.kind === 'single'
	? await preview.content.getSingle(session.apiId)
	: await preview.content.getCollectionEntry(session.apiId, session.slug!)
```

## Protect draft responses

```ts
import {withCmsPreviewResponseHeaders} from '@ooopsstudio/cms-cloudflare'

return withCmsPreviewResponseHeaders(new Response(html, {
	headers: {'content-type': 'text/html; charset=utf-8'}
}))
```

The helper sets:

- `Cache-Control: private, no-store`
- `Referrer-Policy: no-referrer`
- `X-Robots-Tag: noindex, nofollow, noarchive`

## Public API

- `readCmsPreviewToken(request, parameter?)`
- `cmsPreviewPath(input)`
- `createCmsPreviewClientFromRequest(request, options)`
- `createCmsPreviewClientFromSession(session, options)`
- `createCmsPreviewSession(input)`
- `serializeCmsPreviewSessionCookie(session, options)`
- `readCmsPreviewSession(request, options)`
- `clearCmsPreviewSessionCookie(options)`
- `cmsPreviewResponseHeaders(initial?)`
- `withCmsPreviewResponseHeaders(response)`
- `jsonResponse(body, init?)`

## Security properties

- Web Crypto only; compatible with Cloudflare Workers and Node 22+.
- AES-GCM authenticated encryption with a PBKDF2-derived key.
- Preview cookies default to a 30-minute TTL and `/preview/content/` scope.
- Cookies are `HttpOnly` and `SameSite=Lax`; production HTTPS callers enable `Secure`.
- Invalid, tampered, malformed, or expired cookies are treated as absent.
- No outgoing webhook contract is claimed: the current Ooops CMS API exposes preview reads, not publish webhooks.
- License: MIT.
