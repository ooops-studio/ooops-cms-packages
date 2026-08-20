---
"@ooopsstudio/cms-api": minor
---

Add the field-scoped, server-only `createCmsDraftWriter()` client with token introspection, optimistic draft reads and typed atomic patch operations for existing single and collection entries.

Breaking for direct `OoopsCmsClient` consumers: the generic public `request()` escape hatch is now internal. Use the typed read client methods or the separate draft writer.
