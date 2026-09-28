@AGENTS.md

# Project memory

## Owner constraints — never weaken
- Trade locks are whole-ticker, symmetric (buys and sells), 5 business days. This is a compliance / trading-restriction rule. No per-lot locks.
- Whole shares only. Schwab is the live-money broker and its Trader API takes no fractional orders; don't build fractional-share features.
- ICE is hard-banned.
- Report staleness is a true 90-day half-life: `0.5^(age/90)`.
- `trade:reconcile -- --record-missing` writes fills, which set compliance locks. It stays a deliberate manual step; preview/cron/scheduler only *check* reconcile and halt on a mismatch.
- Order submits are never retried; an unknown outcome is resolved by lookup (`findSubmitted`), never a resend. Token refreshes and reads may retry on timeout/network errors.
- Never ask the owner to paste tokens, secrets, OAuth `code=` URLs or the token file into chat.
- Keep model identifiers out of commits, PRs and code.

## Deployment (owner's server)
- Unraid, repo at `/mnt/user/appdata/juniresearch`; docker compose service `web` (target `trader`), port 58472→3000. Env comes from the host's `.env.local` via `env_file` — the in-container "`.env.local` not found" line is expected. Env changes need `docker compose up -d` (not `restart`).
- Trade state: `./data/trade` → `/app/data/trade` (`fills.jsonl`, `cron.log`, `halt-state.json`, `schwab-token.json`, `runs/`).
- CLI: `docker compose exec web npm run trade:<plan|reconcile|execute|cron|review|audit|auth>`. `trade:execute -- --preview` plans only; `trade:cron -- --now` skips the fire-window check (still refuses when the market is closed).
- `BROKER` defaults to `alpaca-paper` — set `BROKER=schwab` explicitly. Alpaca order ids are UUIDs, Schwab's are numeric.
- Modes: `PREVIEW_ONLY=true` (plan + Discord allocation post, reconciles, never submits); `TRADE_DISABLED=1` kill switch; `TRADE_SCHEDULER_ENABLED=1` arms the in-process scheduler (09:45 ET default slot); `DISCORD_WEBHOOK_URL`; `TRADE_STATUS_TOKEN` for `GET /api/trade/status`.
- Schwab OAuth redirect: `https://research.juniperfin.com/schwab/callback` (`/?code=` redirects there). Refresh tokens last ~7 days; `SCHWAB_REFRESH_TOKEN` env is tried first, the token file is the fallback.

## Cloud sessions
- Env vars set in the cloud environment settings only reach *new* sessions.
- The cloud env has Schwab credentials, so read-only probes of the live account are possible (construct the broker with `BROKER: "schwab"`; never submit). It does not have the server's `fills.jsonl`, so reconcile/preview results here are meaningless.

## Known open issue
- Schwab positions bought manually are fractional. A TRIM rounds to 0 shares (dust, harmless), but an EXIT sells `pos.qty` exactly, so `SchwabBroker.submitOrder`'s whole-share guard throws and aborts the run (nothing is sent). Proposed, not yet approved: sell `floor(qty)`, skip a <1-share remainder with a "sell manually in the Schwab app" note.

## Dev workflow
- Checks: `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint <files>`. `lib/trade/scheduler.test.ts` has pre-existing `no-explicit-any` lint errors.
- Don't run `vitest --root /` (hangs). Put throwaway probe scripts in the repo root as `zz-*.ts`, run with `npx tsx`, then delete them.
- Dev branch `claude/kind-ptolemy-n1s0nj`; the owner typically says "merge then push" → `git merge --no-ff` into `main` and push.
- Engine docs: `docs/engine.md` (💡 ideas, 🚫 rejected); specs/plans in `docs/superpowers/`.
