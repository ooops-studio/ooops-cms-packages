# Repository Setup

- Workspace: `@ooopsstudio/cms-packages`
- Repository: `https://github.com/ooops-studio/ooops-cms-packages`
- Registry: npm
- Package access: public
- Publishing: npm trusted publishing
- Runtime: Node.js `>=22.14.0`
- Package manager: pnpm `11.13.0`

## Release checklist

- Configure npm trusted publishers for each public package.
- Protect `main` and require CI.
- Run `pnpm validate` locally.
- Run the Release workflow with `dry_run=true` before merging the first version PR.
