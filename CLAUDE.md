# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Paperdoc is a QVAC hackathon project — a Better-T-Stack monorepo integrating Tether's local-first `@qvac/sdk` AI runtime into a mobile + backend app. Built 2026-06-10 with [create-better-t-stack](https://github.com/AmanVarshney01/create-better-t-stack) v3.32.0; the reproducible command and addon selection are pinned in `bts.jsonc` at the repo root. Re-run `pnpm dlx create-better-t-stack add` to extend the stack.

**Naming quirk (preserve as-is):** the directory, root `package.json`, and Expo app name use lowercase `paperdoc`, but the workspace scope, internal package names, and Expo scheme are capital-P `@Paperdoc/*` / `Paperdoc://`. This mismatch is intentional — do not "fix" it.

## Workspace Layout

```
apps/
  web/      # Vite + TanStack Router + React 19 (port 3001)
  native/   # Expo Router + Uniwind + HeroUI Native (iOS/Android)
  server/   # Hono + Bun + tRPC (port 3000)
packages/
  api/      # @Paperdoc/api — tRPC router, procedures, context
  auth/     # @Paperdoc/auth — Better Auth instance, shared by server + clients
  db/       # @Paperdoc/db — Drizzle schema + libSQL/Turso client
  env/      # @Paperdoc/env — per-runtime env validation (server/web/native exports)
  ui/       # @Paperdoc/ui — shadcn primitives, Tailwind v4 globals
  config/   # @Paperdoc/config — shared tsconfig.base.json
docs/
  llms-full.txt  # mirror of https://docs.qvac.tether.io/llms-full.txt (QVAC SDK reference)
```

Default branch is `master` (renamed from `main` at scaffold time).

## Commands

All commands run from the repo root.

| Task                        | Command                |
| --------------------------- | ---------------------- |
| Install                     | `pnpm install`         |
| Dev (all apps)              | `pnpm run dev`         |
| Dev (web only)              | `pnpm run dev:web`     |
| Dev (server only)           | `pnpm run dev:server`  |
| Dev (native only)           | `pnpm run dev:native`  |
| Build all                   | `pnpm run build`       |
| Type check (all workspaces) | `pnpm run check-types` |
| Lint + format               | `pnpm run check`       |
| Local libSQL                | `pnpm run db:local`    |
| Push schema                 | `pnpm run db:push`     |
| Generate migration          | `pnpm run db:generate` |
| Run migrations              | `pnpm run db:migrate`  |
| Drizzle Studio              | `pnpm run db:studio`   |

**There is no test runner configured.** `pnpm run check-types` is the closest substitute for local CI; do not invent one without asking.

## Architecture

### Request flow (server)

`apps/server/src/index.ts` is a Hono app that mounts two route groups:

- `/api/auth/*` → `auth.handler` from `@Paperdoc/auth` (Better Auth, email+password, `expo()` plugin for native deep links)
- `/trpc/*` → `@hono/trpc-server` adapter wrapping `appRouter` from `@Paperdoc/api/routers`

The tRPC context is built from each Hono request by `createContext` in `packages/api/src/index.ts` — it calls `auth.api.getSession({ headers })` and exposes `{ auth, session }` to every procedure. `protectedProcedure` throws `UNAUTHORIZED` when `session` is missing; use it for any endpoint that needs an authenticated user.

### Database

`@Paperdoc/db` is a thin wrapper around `drizzle-orm` + `@libsql/client` (Turso/libSQL). Schema lives in `packages/db/src/schema/` (currently `auth.ts`, re-exported from `index.ts`). Drizzle Kit reads `DATABASE_URL` from `apps/server/.env` (set up by `drizzle.config.ts` via `dotenv.config({ path: "../../apps/server/.env" })`).

### Clients

- **Web** (`apps/web`): Vite dev server on **port 3001**; routing is file-based via `@tanstack/router-plugin` (auto-generates `src/routeTree.gen.ts` — gitignored). tRPC + React Query are wired in `src/main.tsx`. Shared UI comes from `@Paperdoc/ui`; shadcn primitives are added with `npx shadcn@latest add … -c packages/ui`.
- **Native** (`apps/native`): Expo SDK 56, `expo-router` (file-based routes under `app/`), Uniwind for Tailwind v4, HeroUI Native for primitives. The Expo scheme is `Paperdoc` (capital P) and is whitelisted in `trustedOrigins` of the auth config — keep them in sync.
- The `VITE_SERVER_URL` (web) and `EXPO_PUBLIC_SERVER_URL` (native) env vars point at the Hono server.

### Env validation

`@Paperdoc/env` exports three entry points — `server`, `web`, `native` — each backed by `@t3-oss/env-core` + Zod. The server bundle requires `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`, `CORS_ORIGIN`, `NODE_ENV`. Web requires `VITE_SERVER_URL`; native requires `EXPO_PUBLIC_SERVER_URL`. Add new env vars to the matching entry point, not directly to `.env`.

## Conventions

- **TypeScript strict everywhere.** `tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `verbatimModuleSyntax`. Workspace `tsconfig.json` files just extend the base.
- **pnpm catalog for shared versions.** `pnpm-workspace.yaml` defines a `catalog:` block; reference it as `"<dep>": "catalog:"` in any package.json. Do not duplicate versions.
- **Workspace deps use the `@Paperdoc/*` scope** (capital P) and `"workspace:*"`.
- **Lefthook** runs `oxlint --fix` and `oxfmt --write` in parallel on staged files at `pre-commit` (`stage_fixed: true`). Don't bypass the hook with `--no-verify` unless explicitly asked.
- **Linter/formatter is oxlint + oxfmt** (Rust-based, configured via `.oxlintrc.json` / `.oxfmtrc.json`). Do not swap in ESLint/Prettier.
- **Build orchestration is Turborepo** (`turbo.json`); dev/persistent tasks set `cache: false`. Use `turbo -F <workspace> <task>` for single-package scripts.
- **Runtime is Bun** for the server. The bundled production server is built with `tsdown` (see `apps/server/tsdown.config.ts`) and `bun build --compile` for a single binary.

## QVAC Integration

The QVAC SDK reference is mirrored at `docs/llms-full.txt` (~19k lines, 800KB) — read it before designing any `@qvac/sdk` integration. Key constraints:

- The SDK is a singleton with lifecycle `loadModel()` → inference call → `unloadModel()` → `close()`. It spawns a Bare worker on Node/Expo and runs in-process on Bare.
- Hardware floor: 2GB RAM (4GB recommended), 5GB disk for model artifacts.
- `apps/native` (Expo ≥54) is the most direct fit; the server can shell out to a Bare process or run inference locally where Metal/Vulkan is available.

## Git Commit Best Practices

Commits on this repo follow these rules. Follow them unless the user explicitly says otherwise.

**Subject line (required).**

- Imperative mood, present tense: "Add user profile route", not "Added" or "Adds".
- ≤ 72 characters. No trailing period. Capitalize the first word.
- Use a Conventional Commits prefix when meaningful: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `perf:`. Scope with `(<package>):` for cross-cutting work, e.g. `feat(api): add protectedProcedure guard`. Skip the prefix for trivial `chore` work (typo, dependency bump) only when the diff is self-evident.

**Body (optional but encouraged for non-trivial changes).**

- Blank line after the subject, then wrap at 72 columns.
- Explain _why_ the change is needed and any non-obvious trade-offs. The diff already shows _what_ — the body explains intent.
- Reference related issues, design docs, or memory slugs (`mem:...`) when relevant.

**One logical change per commit.** Split unrelated edits, even small ones, into separate commits. If a refactor and a feature are tangled, commit the refactor first.

**Do not commit:**

- Secrets (`.env`, `*.pem`, `*.key`) — `.gitignore` already excludes `.env` and `.env*.local`, but check before staging.
- Generated artifacts: `node_modules/`, `dist/`, `apps/web/src/routeTree.gen.ts`, `.turbo/`, Drizzle migration outputs that haven't been reviewed.
- Lockfile churn unrelated to your change (`pnpm-lock.yaml` should only change when deps change).

**Agent-authored commits** must end with the trailer:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

(The exact model name in the trailer should match the agent that did the work.)

**Safety rules** (these are project-wide, not just this repo):

- Never `git push --force` to `master`/`main` — always create a new commit or rebase locally.
- Never `git commit --amend` a commit that has already been pushed or shared.
- Never skip hooks (`--no-verify`, `--no-gpg-sign`) unless the user explicitly asks.
- Branch from `master`, never from `main` (it doesn't exist on this repo).
- `bts.jsonc`, `lefthook.yml`, `.oxlintrc.json`, `.oxfmtrc.json`, `pnpm-workspace.yaml`, and `turbo.json` are load-bearing config — don't rewrite them casually.
