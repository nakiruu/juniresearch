# Running the render site in Docker

The render site is a statically generated Next.js app. The Docker image builds
it and serves it with the Next.js standalone server. The published reports
(`data/*.json`) are baked in at build time, so **rebuild the image to pick up new
reports**. The site needs no secrets.

## Quick start

```bash
docker compose up --build
```

Then open http://localhost:58472 (report pages at `/research/<ticker>`, e.g.
http://localhost:58472/research/avgo). Host port 58472 is a deliberately uncommon
high port; the container listens on 3000 internally.

## Without compose

```bash
docker build -t juniresearch-web .
docker run --rm -p 58472:3000 juniresearch-web
```

## What is and isn't in the image

- **In:** the built site and the reports that existed at build time. The image
  runs as a non-root user and the container listens on port 3000 (override with
  `-e PORT=...`); the compose file publishes it on host port 58472.
- **Out:** the capture and synthesis pipeline. Its capture steps (`detect`,
  `facts:prepare`, the MCP tearsheet and search calls) reach Claude's connectors,
  which are not available inside a container, so run those in your dev session as
  before. After they produce a new `data/<ticker>.json`, rebuild the image.

## Operating the trader

The deployed service (`docker-compose.yml`) builds the `trader` target: the
full app, not just the static site. It serves the site, arms the in-process
trade scheduler (`instrumentation.ts`, gated by `TRADE_SCHEDULER_ENABLED`),
and lets you run the `trade:*` CLI by hand via `docker exec`. The lean
`runner` stage from before still exists for a site-only deploy with no
secrets: `docker build --target runner -t juniresearch-web .`.

**Arm trading.** Set `BROKER`, `TRADE_SCHEDULER_ENABLED=1`, and the broker
keys (`APCA_*` or `SCHWAB_*`) in `.env.local`, then rebuild and restart:

```bash
docker compose up -d --build
```

Leaving `TRADE_SCHEDULER_ENABLED` unset keeps the container serving pages
without ever trading — deploying the image never auto-arms it.

**Run the CLI in-container.** The trader image keeps every dependency
(including `tsx`), so the `trade:*` npm scripts work over `docker exec`:

```bash
docker exec -it <service> npm run trade:reconcile
docker exec -it <service> npm run trade:plan
docker exec -it <service> npm run trade:audit
docker exec -it <service> npm run trade:execute
```

**Schwab.** `docker exec -it <service> npm run trade:auth` writes the OAuth
token to the mounted `data/trade` volume. Its refresh token expires every
~7 days — re-run `trade:auth` weekly.

**Check status.**

```bash
curl -H "Authorization: Bearer $TRADE_STATUS_TOKEN" http://<host>:58472/api/trade/status
```

**Volume permissions.** The `./data/trade` host directory (mounted at
`/app/data/trade`) must be writable by uid 1001 (the `nextjs` user the
container runs as) — it holds `fills.jsonl` (the compliance ledger) and
`schwab-token.json`, both persisted across rebuilds.
