# @ooopsstudio/cms-api

## 0.3.1

### Patch Changes

- Invoke authenticated and public fetch implementations with the platform global receiver so the client works in Cloudflare Workers runtimes.

## 0.3.0

### Minor Changes

- [`5b019c4`](https://github.com/ooops-studio/ooops-cms-packages/commit/5b019c41730b86a4a1182e2cd44db40a0e1c2f9a) Thanks [@italiour](https://github.com/italiour)! - Add the field-scoped, server-only `createCmsDraftWriter()` client with token introspection, optimistic draft reads and typed atomic patch operations for existing single and collection entries.

  Breaking for direct `OoopsCmsClient` consumers: the generic public `request()` escape hatch is now internal. Use the typed read client methods or the separate draft writer.

## 0.2.0

### Minor Changes

- [`fc935e9`](https://github.com/ooops-studio/ooops-cms-packages/commit/fc935e9d2b81705d2b72938b1f3deee6a422d472) Thanks [@italiour](https://github.com/italiour)! - Add tokenless public forms and read-only preview clients that match the current CMS routes, and align the authenticated client with the read-only CMS v1 OpenAPI contract.

### Patch Changes

- [#2](https://github.com/ooops-studio/ooops-cms-packages/pull/2) [`2849fac`](https://github.com/ooops-studio/ooops-cms-packages/commit/2849fac7c0342e6dfb590241bfbddab8ec204edf) Thanks [@italiour](https://github.com/italiour)! - Normalize authenticated CMS client timeouts to the same typed `OoopsCmsApiError` contract used by the public forms and preview clients.
