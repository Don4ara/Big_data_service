# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project overview

This repository is a NestJS backend with a static frontend dashboard. It generates intentionally messy mock restaurant-order data, stores generated orders in PostgreSQL through Prisma, and exposes `/data-vitrine` APIs for generation, streaming, in-memory reads, DB-backed paginated reads, manual insertion, and CAPTCHA reset.

The generated data deliberately includes inconsistent real-world-style formats. Do not normalize dirty fields unless a task explicitly changes that mock-data contract.

## Commands

- Install dependencies: `npm install`
- Clean CI install: `npm ci`
- Build: `npm run build`
- Start dev server: `npm run start:dev`
- Start production build locally: `npm run build && npm run start:prod`
- Unit tests: `npm test`
- Watch unit tests: `npm run test:watch`
- Coverage: `npm run test:cov`
- E2E tests: `npm run test:e2e`
- Single unit test file: `npx jest src/app.controller.spec.ts`
- Single E2E test file: `npx jest test/app.e2e-spec.ts --config ./test/jest-e2e.json`
- Generate Prisma client: `npx prisma generate`
- Apply migrations in an existing environment: `npx prisma migrate deploy`
- Create/apply a local migration during development: `npx prisma migrate dev`
- Start local infrastructure stack: `docker compose up -d`
- Start worker stack: `docker compose -f docker-compose.workers.yml up -d`
- Start local worker stack variant: `docker compose -f docker-compose.workers.local.yml up -d`

Formatting and linting:

- Lint: `npm run lint`
- Format backend/test TS files: `npm run format`
- `npm run lint` runs ESLint with `--fix`, so it mutates files.
- `npm run format` runs Prettier with `--write`, so it mutates files.

CI uses Node.js 22 and runs `npm ci`, `npm run lint`, and `npm run build`.

## Required environment

Configuration is loaded globally via `ConfigModule.forRoot({ isGlobal: true })` in `src/app.module.ts`.

Common variables:

- App/database: `PORT`, `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
- Geocoding: `GEOAPIFY_API_KEY`, `GEOCODING_CONCURRENCY`, `GEOAPIFY_TIMEOUT_MS`, `GEOCODING_RETRIES`, `GEOCODING_MIN_TIME_MS`, `SHARED_GEOCACHE_ENABLED`
- Redis/shared state: `REDIS_URL`, `SHARED_MARKET_STATE_ENABLED`
- Auto-generation: `AUTO_GENERATE`, `AUTO_GENERATE_BATCH_SIZE`, `AUTO_GENERATE_INTERVAL`
- Generation/write performance: `ORDER_GENERATION_CONCURRENCY`, `DB_WRITE_CHUNK_SIZE`, `MAX_QUEUED_DB_BATCHES`
- Market seeds: `MARKET_PROFILE_SEED`, `MARKET_RUN_SEED`

`prisma.config.ts` reads `DATABASE_URL` and points Prisma at `prisma/schema.prisma` and `prisma/migrations/`.

## Architecture overview

- `src/main.ts` boots Nest and enables CORS.
- `src/app.module.ts` loads global config and imports `DataVitrineModule`.
- `src/data-vitrine/data-vitrine.module.ts` wires `DataVitrineController`, `DataVitrineService`, `GeocodingService`, `PrismaService`, and `SharedMarketStateService`.
- `src/data-vitrine/data-vitrine.controller.ts` exposes `/data-vitrine` endpoints:
  - `GET /generate` for one-shot batch generation
  - `GET /stream` for SSE generation
  - `GET /orders` for the in-memory buffer
  - `GET /orders/db` for paginated DB-backed reads with search/filtering
  - `POST /orders` for manual insertion into the in-memory buffer
  - `POST /solve-captcha` to clear the anti-scrape limiter for DB reads
- `src/data-vitrine/data-vitrine.service.ts` orchestrates restaurant seeding, order generation, background auto-generation, in-memory buffering, and DB write queueing.
- Generation helpers live under `src/data-vitrine/generation/`.
- Market/season helpers live under `src/data-vitrine/market/`.
- Review scoring helpers live under `src/data-vitrine/review/`.
- Geocoding lives in `src/data-vitrine/geo/geocoding.service.ts`.
- Prisma integration is in `src/prisma.service.ts`, `prisma/schema.prisma`, and `src/data-vitrine/persistence/order-persistence.ts`.

## Runtime and data-generation flow

- `DataVitrineService.onModuleInit()` seeds the fixed restaurant catalog into Postgres and hydrates restaurant caches.
- If `AUTO_GENERATE=true`, the service starts background generation using `AUTO_GENERATE_BATCH_SIZE` and `AUTO_GENERATE_INTERVAL`.
- `generateOrders()` builds a status plan, generates orders with bounded concurrency, keeps only the latest 500 orders in memory, and queues DB writes.
- `generateSingleOrder()` intentionally emits dirty real-world-style data, including mixed date formats, phone formats, money strings, quantity strings, optional reviews, and varied statuses.
- DB writes are queued and persisted through `buildOrderCreateData()` using nested Prisma creates.

Preserve the intentionally messy mock-data contract unless a task explicitly asks to normalize it.

## Persistence and Prisma

- `prisma/schema.prisma` models orders, customers, addresses, coordinates, items, options, couriers, courier locations, reviews, and restaurants.
- `Order` is the root persisted entity.
- `src/data-vitrine/persistence/order-persistence.ts` maps generated nested order objects into Prisma nested create input.
- `src/prisma.service.ts` uses `@prisma/adapter-pg` with an explicit `pg.Pool` limit, so DB connection pressure depends on both pool size and worker count.
- Schema changes usually require checking the generator, persistence mapper, API selects, and frontend expectations together.

## Geocoding, Redis, and market state

- `src/data-vitrine/geo/geocoding.service.ts` calls Geoapify.
- Geocoding uses an in-process L1 cache for promise deduplication and hot reads.
- When `SHARED_GEOCACHE_ENABLED=true` and `REDIS_URL` is set, Redis is used as the shared geocode cache.
- `GEOCODING_CONCURRENCY`, `GEOAPIFY_TIMEOUT_MS`, `GEOCODING_RETRIES`, and `GEOCODING_MIN_TIME_MS` control external API pressure.
- If Redis shared cache access fails, geocoding falls back to in-memory-only caching.
- `src/data-vitrine/market/shared-market-state.service.ts` uses Redis for shared market batch/season state when enabled, and falls back to local state if Redis is unavailable.

When optimizing generation speed, treat geocoding/API pressure, DB write queueing, Prisma nested creates, and Redis/shared-state behavior as connected bottlenecks.

## Frontend/dashboard

The `frontend/` directory is a simple static dashboard, not a separate framework app.

- `frontend/app.js` calls `http://localhost:3000/data-vitrine` directly.
- It reads paginated DB-backed orders from `GET /data-vitrine/orders/db`.
- It expects server-side pagination and search.
- It handles backend `429 CAPTCHA_REQUIRED` responses by showing a modal and calling `POST /data-vitrine/solve-captcha`.
- If backend ports, route behavior, response shape, pagination, or selected DB fields change, update `frontend/app.js` manually because the API base URL and rendering expectations are hardcoded.

## Docker and worker topology

- `docker-compose.yml` starts local infrastructure: PostgreSQL, Redis, Kafka, and Kafka UI.
- Kafka is present in Docker Compose, but no current source integration was found.
- `docker-compose.workers.yml` starts multiple app worker containers with `AUTO_GENERATE=true`.
- `docker-compose.workers.local.yml` is a local worker-stack variant.
- Workers use different `PORT` values and share the same database.
- Pool sizing, worker count, `ORDER_GENERATION_CONCURRENCY`, `DB_WRITE_CHUNK_SIZE`, `MAX_QUEUED_DB_BATCHES`, Redis behavior, and Geoapify limits should be considered together.

## Working guidelines for Codex

- Prefer source files, Prisma schema, package scripts, `.env.example`, and Docker Compose files over `README.md` when they conflict.
- Do not normalize intentionally dirty generated order fields unless explicitly requested.
- When changing order shape, check all of:
  - generator output in `src/data-vitrine/data-vitrine.service.ts`
  - Prisma mapping in `src/data-vitrine/persistence/order-persistence.ts`
  - Prisma schema in `prisma/schema.prisma`
  - API selects in `getOrdersPaginated()`
  - frontend rendering in `frontend/app.js`
- Treat `npm run lint` and `npm run format` as mutating commands.
- Avoid broad DB/worker performance changes without considering external Geoapify limits, Redis cache behavior, and Prisma connection pressure.

## Notes from current repo state

- This repository already uses this `AGENTS.md` as the primary Codex guidance file.
- `README.md` starts with “README НЕ АКТУАЛЬНА!!!”; use it only for broad domain context and prefer source code, Prisma schema, package scripts, and Docker Compose files over README claims.
- No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` were found during the latest guidance refresh.
