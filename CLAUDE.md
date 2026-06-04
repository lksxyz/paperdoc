# CLAUDE.md

## Workspace

- **pnpm + moonrepo** monorepo. Tasks run via `moon <project>:<task>` or `moon :<task>` (all projects).
- Node 22, pnpm 10.30, TypeScript ~6.0.
- Workspace root: `/home/fahmi/Kode/Hackathon/Sui/paperdoc`

## Projects

| ID | Path | Stack |
|---|---|---|
| `platform` | `apps/platform/` | TanStack Router, React 19, Tailwind CSS v4, Vite |
| `api` | `apps/api/` | Hono + Effect framework |
| `ui` | `packages/ui/` | Shared UI components |

## Commands

Use `pnpm` directly or `moon` for cache-aware task orchestration.

| Action | Command |
|---|---|
| Dev server (platform) | `moon platform:dev` or `pnpm --filter platform dev` |
| Build | `moon platform:build` or `pnpm --filter platform build` |
| Typecheck | `moon platform:typecheck` or `pnpm --filter platform typecheck` |
| Lint | `moon :lint` (all projects) or `pnpm run lint` (root biome lint) |

## Toolchain & Style

- **Biome** for lint, format, organize imports (auto-fix on save in VS Code).
- JS/TS: single quotes, semicolons `asNeeded`, trailing commas `es5`, indent 2.
- Non-JS files: indent 4 spaces.
- `verbatimModuleSyntax` enabled — use `import type` for type-only imports.
- Tailwind CSS v4 (`@import "tailwindcss"`, `@theme` directive, `@plugin "tailwindcss-motion"`).
- `useSortedClasses` rule in `nursery` (warn, not fix on save) — Tailwind class sorting not auto-applied.

## Testing

- **Vitest** with `happy-dom`, globals enabled, HTML reporter.
- Unit tests: `tests/**/*.{test,spec}.{ts,tsx}`, setup at `tests/setup-client.ts`.
- Coverage: v8 provider, output to `tests-results/coverage`.
- **Playwright** e2e: `tests-e2e/`, 4 projects (Chromium, Firefox, Safari, Mobile Chrome).
- E2E dev server: builds + previews on port 3001 by default.

## Docker

- Compose services: Postgres (5432), Mailpit (1025/8025), instrumentation (Jaeger etc). Uncomment for MinIO, ClickHouse, Redis.
- Production image: `joseluisq/static-web-server` serving `build/client` via SWS, distroless runtime.

## VCS

- GitLab, default branch `main`.
- Pre-commit hook (defined in `.moon/workspace.yml`): `moon run :format --affected --status=all` then `moon run :lint --affected --status=staged`.

## Commit Guidelines

### Micro / Atomic Commits

When committing, always use **micro/atomic commits**:

- **One commit = one logical change** — each commit does exactly one thing
- **Self-contained** — the code works and passes tests at every commit
- **Never bundle unrelated changes** — split into separate commits if needed
- Stage and commit changes incrementally as you complete each logical unit of work

### Conventional Commits

When the user asks to commit, use the [Conventional Commits](https://www.conventionalcommits.org/) format.

#### Format

```
type(scope): description

[optional body]

[optional footer]
```

#### Allowed Types

`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

#### Rules

- **Type**: Must be one of the allowed types
- **Scope**: Optional but recommended for clarity
- **Description**: Required; use imperative mood (e.g., "add" not "added")
- **Body**: Optional; use for additional context
- **Footer**: For breaking changes (`BREAKING CHANGE: ...`) or issue references

#### Examples

- `feat(parser): add ability to parse arrays`
- `fix(ui): correct button alignment`
- `docs: update README with usage instructions`
- `refactor: improve performance of data processing`
- `chore: update dependencies`
- `feat!: send email on registration` (breaking change)

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

## Moonrepo Best Practices

- **implicitDeps** in `.moon/tasks/all.yml` auto-runs `packages/ui:build` before any project task
- **fileGroups** define common inputs (`env`, `docs`, `config`) for granular caching
- `inferTasksFromScripts: true` auto-discovers tasks from `package.json`
- Run `moon query projects` to see all projects, `moon graph` for task dependencies
- Add `moon daemon start` to `.bashrc` for faster local execution