# AGENTS.md

## Cursor Cloud specific instructions

### Overview

AI Invoice Maker — a single Next.js 16 (App Router) application with Prisma ORM, PostgreSQL, and OpenAI integration. No monorepo; no test framework; no Docker.

### Services

| Service | Command | Notes |
|---------|---------|-------|
| Next.js dev server | `npm run dev` | Port 3000. Must override `DATABASE_URL` if the system env points to remote Neon. |
| PostgreSQL | `sudo pg_ctlcluster 16 main start` | Must be running before dev server or Prisma commands. |

### Key gotchas

- **`DATABASE_URL` env collision:** The VM may inject a system-level `DATABASE_URL` pointing to a remote Neon instance. `prisma.config.ts` imports `dotenv/config`, but `dotenv` does **not** override existing env vars. You must prefix Prisma CLI commands with the local URL: `DATABASE_URL="postgresql://ai_invoice:ai_invoice_dev@localhost:5432/ai_invoice" npx prisma migrate dev`. The `.env` file is also created during setup, but system env vars take precedence.
- **Migration history was SQLite:** The original migrations were SQLite-flavored but the schema is PostgreSQL. During first setup, the old `prisma/migrations/` directory was removed and a fresh PostgreSQL migration was generated. If you see a `migration_lock.toml` mismatch error, remove the `prisma/migrations/` directory and re-run `npx prisma migrate dev --name init` with the local `DATABASE_URL`.
- **Auth is email-only (no password):** NextAuth credentials provider accepts any email and auto-creates the user. Sign in with any email (e.g. `test@example.com`).
- **No automated test suite:** There is no Jest/Vitest/Playwright/Cypress configured. `npm test` is not available.

### Standard commands

See `package.json` scripts: `npm run dev`, `npm run build`, `npm run lint`. Prisma CLI: `npx prisma migrate dev`, `npx prisma generate`.
