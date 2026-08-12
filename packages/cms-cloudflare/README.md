# @ooopsstudio/cms-cloudflare

Cloudflare-friendly helpers for CMS webhooks, preview redirects, and Pages deploy hooks.

This package is framework-agnostic and ships no UI, routes, Astro components, or content model assumptions. It is intended for Cloudflare Workers and Cloudflare Pages Functions adapters.

## Install

```sh
pnpm add @ooopsstudio/cms-cloudflare
```

## Webhook signatures

CMS webhook signatures use:

```txt
HMAC-SHA256(timestamp + "." + rawBody)
```

The canonical header format is:

```txt
x-cms-signature: v1=<hex>
```

```ts
import {verifyCmsWebhookRequest} from '@ooopsstudio/cms-cloudflare'

export async function onRequestPost({request, env}) {
	const result = await verifyCmsWebhookRequest(request, {
		secret: env.CMS_WEBHOOK_SECRET,
		allowedEvents: ['cms.entry.published']
	})

	if (!result.ok) {
		return new Response(result.message, {status: result.status})
	}

	return Response.json({ok: true, event: result.event})
}
```

## Cloudflare Pages rebuild webhook

```ts
import {handleCmsRebuildWebhook} from '@ooopsstudio/cms-cloudflare'

export async function onRequestPost({request, env}) {
	return handleCmsRebuildWebhook(request, {
		secret: env.CMS_WEBHOOK_SECRET,
		deployHookUrl: env.CLOUDFLARE_PAGES_DEPLOY_HOOK_URL,
		allowedEvents: ['cms.entry.published', 'cms.single.published']
	})
}
```

Required environment variables:

```txt
CMS_WEBHOOK_SECRET=
CLOUDFLARE_PAGES_DEPLOY_HOOK_URL=
```

## Preview redirect

```ts
import {createCmsPreviewRedirect} from '@ooopsstudio/cms-cloudflare'

export async function onRequestGet({request, env}) {
	return createCmsPreviewRedirect(request, {
		previewToken: env.CMS_PREVIEW_TOKEN,
		previewSecret: env.CMS_PREVIEW_SECRET
	})
}
```

The default query convention is:

```txt
/api/preview?token=<token>&redirect=/target-path
```

The redirect must be a relative path. External URLs are rejected to avoid open redirects.

Required environment variables:

```txt
CMS_PREVIEW_TOKEN=
CMS_PREVIEW_SECRET=
```

## Local webhook test signing

```ts
import {signCmsWebhookPayload} from '@ooopsstudio/cms-cloudflare'

const body = JSON.stringify({event: 'cms.entry.published'})
const timestamp = new Date().toISOString()
const signature = await signCmsWebhookPayload({
	secret: process.env.CMS_WEBHOOK_SECRET!,
	timestamp,
	body
})

await fetch('http://localhost:8788/api/cms/rebuild', {
	method: 'POST',
	headers: {
		'content-type': 'application/json',
		'x-cms-event': 'cms.entry.published',
		'x-cms-signature': signature,
		'x-cms-timestamp': timestamp
	},
	body
})
```

## Public API

- `signCmsWebhookPayload(input)`
- `verifyCmsWebhookSignature(input)`
- `verifyCmsWebhookRequest(request, options)`
- `createCmsPreviewRedirect(request, options)`
- `verifyCmsPreviewCookie(input)`
- `triggerCloudflarePagesDeployHook(url, fetch?)`
- `handleCmsRebuildWebhook(request, options)`
- `jsonResponse(body, init?)`

## Notes

- Uses Web Crypto only.
- No runtime dependencies.
- Default timestamp tolerance is five minutes.
- Preview cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and valid for one hour by default.
- License: MIT.
