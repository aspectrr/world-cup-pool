# world-cup-pool

2026 FIFA World Cup pool — three Bun-native packages in one repo.

| Package | Stack | What it does |
| --- | --- | --- |
| [`wc-api`](./wc-api) | Elysia + Drizzle (`bun:sqlite`) | Polls ESPN for scores, subscribes to Polymarket for odds, serves both over REST + WebSocket |
| [`world-cup-bracket`](./world-cup-bracket) | React + Vite | Live bracket, standings, per-team odds |
| [`world-cup-setup`](./world-cup-setup) | React + Vite | Spinning-wheel snake draft (8 players × 6 teams) |

Everything runs on the **Bun runtime** — API, build, test, lint.

## Prerequisites

- [Bun](https://bun.com) ≥ 1.2

## Local development

```bash
# from the repo root — each package is independent
cd wc-api && bun install && bun dev         # API on :3000
cd world-cup-bracket && bun install && bun dev   # Vite dev server
cd world-cup-setup && bun install && bun dev
```

The bracket app talks to the API at `VITE_API_URL` (defaults to `http://localhost:3000` in dev, `https://wc-api.fly.dev` in prod). See [`world-cup-bracket/.env.development`](./world-cup-bracket/.env.development).

## wc-api

REST + WebSocket server. One browser socket (`/ws`) gets a full snapshot on connect, then deltas whenever ESPN polls or odds recompute.

### Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/results` | Merged finished (DB) + live (ESPN) match results |
| POST | `/api/poll` | Force an ESPN poll, return fresh results |
| POST | `/api/seed` | Bulk-insert historical finished matches |
| GET | `/api/odds` | Current Polymarket implied probabilities |
| GET | `/api/health` | DB path, counts, last-poll times, WS state |
| WS | `/ws` | Snapshot on connect, then `matches` / `odds` deltas |

### Environment variables

| Var | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `./data` | SQLite volume mount point (set to `/data` on Fly) |

### Data model

SQLite `results` table — one row per finished match, keyed `homeIdx v awayIdx`:

| Column | Type | Notes |
| --- | --- | --- |
| `match_id` | TEXT PK | `"{homeIdx}v{awayIdx}"` |
| `espn_id` | TEXT | ESPN event id |
| `home_idx` / `away_idx` | INTEGER | 0–47 team index (see `WC_TEAMS`) |
| `home_score` / `away_score` | INTEGER | |
| `status` | TEXT | `scheduled` / `live` / `finished` |
| `clock` | TEXT | ESPN display clock |
| `date` | TEXT | ISO date |
| `winner_idx` | INTEGER | Set for knockouts decided by ET/pens (regulation tied) |
| `detail` | TEXT | `"FT"` / `"FT aet"` / `"Pen"` etc. |
| `updated_at` | TEXT | `datetime('now')` |

Migrations run as raw `ALTER TABLE` on boot (idempotent) so existing volumes upgrade in place. Add `drizzle-kit` the first time the schema actually changes.

## Deployment

`wc-api` deploys to **Fly.io** via [`fly.toml`](./wc-api/fly.toml) — `oven/bun:1-debian` image, persistent SQLite volume mounted at `/data`. The Vite apps are static builds (no Dockerfile); deploy `dist/` to your static host (Render/Vercel/Cloudflare).

```bash
cd wc-api
fly deploy
```

## Architecture notes

- **ESPN polling**: every 20s (ESPN's REST cache floor). Perceived latency is killed by the WS broadcast on poll completion, not by polling faster.
- **Polymarket odds**: one outbound WS to `ws-subscriptions-clob.polymarket.com`, subscribed to each WC market's Yes token. Token IDs are bootstrapped from Gamma REST every 5 min so newly-listed fixtures appear without a redeploy. Mid-price = implied probability.
- **Team canonicalization**: 48 WC teams indexed 0–47. The API and bracket both carry the same `WC_TEAMS` list (duplicated intentionally to keep the API dependency-free — update both if the field changes).
