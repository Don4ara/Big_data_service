# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install`
- Start dev server: `npm run start:dev`
- Start production build locally: `npm run build && npm run start:prod`
- Build: `npm run build`
- Lint: `npm run lint`
- Format backend/test TS files: `npm run format`
- Unit tests: `npm test`
- Watch unit tests: `npm run test:watch`
- Coverage: `npm run test:cov`
- E2E tests: `npm run test:e2e`
- Run a single Jest test file: `npx jest src/app.controller.spec.ts`
- Run a single E2E test file: `npx jest test/app.e2e-spec.ts --config ./test/jest-e2e.json`
- Generate Prisma client after schema changes: `npx prisma generate`
- Apply migrations in an existing environment: `npx prisma migrate deploy`
- Create/apply a local migration during development: `npx prisma migrate dev`
- Start local Postgres only: `docker compose up -d postgres`
- Start worker stack: `docker compose -f docker-compose.workers.yml up -d`
- Start local worker stack variant: `docker compose -f docker-compose.workers.local.yml up -d`

## Required environment

- Backend configuration is loaded through `ConfigModule.forRoot({ isGlobal: true })` in `src/app.module.ts`.
- `.env.example` only includes `GEOAPIFY_API_KEY`, but the app also expects `DATABASE_URL` for Prisma and Postgres credentials when using `docker-compose.yml`.
- `prisma.config.ts` reads `DATABASE_URL` and uses `prisma/schema.prisma` plus `prisma/migrations/`.

## Architecture overview

This repo is a NestJS service that generates “dirty” mock restaurant-order data, persists it to PostgreSQL through Prisma, and serves a simple frontend dashboard that reads paginated orders from the backend.

### Main runtime flow

- `src/main.ts` boots Nest and enables CORS.
- `src/app.module.ts` wires the app around a single business module: `DataVitrineModule`.
- `src/data-vitrine/data-vitrine.controller.ts` exposes the public API under `/data-vitrine`:
  - `GET /generate` for one-shot batch generation
  - `GET /stream` for SSE generation
  - `GET /orders` for the in-memory buffer
  - `GET /orders/db` for paginated DB-backed reads with search/filtering
  - `POST /orders` for manual insertion into the in-memory buffer
  - `POST /solve-captcha` to clear the anti-scrape limiter for DB reads

### Generation pipeline

`src/data-vitrine/data-vitrine.service.ts` is the core of the system.

- On module init it seeds the fixed restaurant catalog into Postgres and caches restaurants in memory for later generation.
- If `AUTO_GENERATE=true`, it starts a background interval worker using `AUTO_GENERATE_BATCH_SIZE` and `AUTO_GENERATE_INTERVAL`.
- `generateOrders()` fans out order creation with `Promise.all`, keeps only the latest 500 generated orders in memory for lightweight frontend access, then writes successful orders to Postgres.
- `generateSingleOrder()` intentionally produces inconsistent real-world-style data formats (dates, phone numbers, money strings, quantities, etc.). Preserve this behavior unless the task explicitly changes the mock-data contract.
- Persistence uses deep nested Prisma creates for customers, addresses, coordinates, items, options, couriers, locations, and optional reviews. This means write-path changes often affect both generator shape and Prisma relations.

### Geocoding and API pressure

`src/data-vitrine/geocoding.service.ts` is the main external-API integration.

- Geocoding is done through Geoapify.
- The service now uses a two-level cache:
  - in-process memory cache for promise deduping and hot reads
  - shared Postgres-backed cache (`GeocodeCache` in Prisma) keyed by normalized city name
- `GEOCODING_CONCURRENCY` controls the `p-limit` gate for outgoing geocoding requests.
- If the shared cache table is unavailable, the service degrades to in-memory-only caching instead of breaking generation.

When optimizing generation speed, treat geocoding as the first bottleneck and nested Prisma writes as the second.

### Data model

`prisma/schema.prisma` models a denormalized order domain split into related tables:

- `Order` is the root entity.
- Related records include `Customer`, `DeliveryAddress`, `Coordinates`, `OrderItem`, `OrderOptions`, `Courier`, `CourierLocation`, `Review`, and the fixed `Restaurant` catalog.
- `GeocodeCache` stores shared geocoding results used across workers/processes.

Because the generator and frontend expect nested order-shaped data, schema changes should be checked against both write logic and dashboard reads.

### Frontend/dashboard

The `frontend/` directory is a simple static dashboard, not a separate framework app.

- `frontend/app.js` calls `http://localhost:3006/data-vitrine` directly.
- It expects server-side pagination, search, and filter behavior from `GET /data-vitrine/orders/db`.
- The frontend also handles the backend’s anti-scrape `429 CAPTCHA_REQUIRED` response by showing a modal and calling `POST /solve-captcha`.

If backend ports or route behavior change, the dashboard may need manual updates because its API base URL is hardcoded.

### Docker and worker topology

- `docker-compose.yml` only starts PostgreSQL.
- `docker-compose.workers.yml` and `docker-compose.workers.local.yml` run many app instances with `AUTO_GENERATE=true`; this is how high-throughput generation is achieved.
- Each worker has its own `PORT` and API key, but all share the same database.
- `src/prisma.service.ts` uses `@prisma/adapter-pg` with an explicit `pg.Pool` limit of 5 connections, so pool sizing and worker counts interact directly.

## Notes from current repo state

- `README.md` explicitly says it is not up to date. Prefer code, Prisma schema, and compose files over README claims when they conflict.
- There is currently no existing `CLAUDE.md`, `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` in this repository.
