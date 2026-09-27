# Bakhta Web (بخت‌آ)

Persian, right-to-left Next.js frontend for the Bakhta lottery demo: the Four Leaf (چهار برگ)
and Six Chance games, guest and registered-user purchase, public ticket check, and
My Orders / My Tickets. It talks only to the Fastify API in `../backend`. There is no real
payment: in demo mode, orders are confirmed through the backend's dev-only confirmation
endpoint.

- Frontend: **http://localhost:3001**
- Backend API: **http://localhost:3000** (required — the frontend has no data of its own)

## Prerequisites

- Node.js 20+
- Local PostgreSQL with the Bakhta schema migrated and seeded (see `../README.md` and
  `../backend/README.md`). Draws are never generated automatically: a SUPER_ADMIN creates
  each one from the admin panel (Dashboard reminder or Draws → Create draw)

## Environment

### `web/.env.local` (copy from `.env.example`; never commit it)

| Variable                   | Demo value              | Purpose                                                                  |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Backend base URL                                                         |
| `NEXT_PUBLIC_DEMO_MODE`    | `true`                  | Auto-confirm new orders via the backend's dev-only confirmation endpoint |

`NEXT_PUBLIC_*` values are baked in when the dev server or build starts, so restart after
changing them.

### `backend/.env` (copy from `backend/.env.example`; never commit it)

Beyond `DATABASE_URL`, the demo needs:

```
PORT=3000
NODE_ENV=development
DEV_ORDER_CONFIRMATION_ENABLED=true
CORS_ORIGINS=http://localhost:3001
```

`DEV_ORDER_CONFIRMATION_ENABLED` must be `true` whenever `NEXT_PUBLIC_DEMO_MODE=true`, or
checkout stops at "pending payment". The route is also refused when `NODE_ENV=production`.

## Demo startup

Use two terminals:

```bash
# 1. Backend. `npm run dev` does not load .env by itself, so pass it to Node explicitly.
cd backend
npx tsx watch --env-file=.env src/server.ts

# 2. Frontend
cd web
npm install      # first time only
npm run dev      # http://localhost:3001
```

Check: `curl http://localhost:3000/v1/games` should list `FOUR_LEAF` and `SIX_CHANCE`, and
the homepage should show both games with live countdowns.

## Demo flow

1. **Homepage**: both games, with ticket price, prize/jackpot, next draw time and countdown.
2. **Guest Four Leaf**: open چهار برگ and enter `0427` (Persian `۰۴۲۷` works too; leading
   zeroes are kept). Continue, enter any email, and submit. The Claim Token panel appears
   **once**. It is never stored or shown again.
3. **Guest Six Chance**: 6 distinct numbers from 1–33 plus a chance symbol from 1–5, or tick
   quick-pick.
4. **Ticket check** (`/tickets/check`): enter a public code such as `T-XXXXXXXXXXXX`. The
   page shows only public data (no owner, email or claim token).
5. **Register and log in**, buy a ticket. Registered tickets get no Claim Token.
6. **My Orders / My Tickets**: only the signed-in user's own purchases.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Notes

- **Prices and rules** on the purchase page come from the selected draw's snapshotted rule
  version (`draw.currentRulesSnapshot`), which is what the backend prices the order from,
  not from the game's current active rules.
- **Languages**: English (default for first-time visitors) and Persian, switched with the
  `EN | فا` control in the header. The choice is stored in the `bakhta_locale` cookie
  (value `en` or `fa` only) so the server renders the right `lang`/`dir` on first paint.
  All copy lives in `src/lib/i18n/messages.ts`; `fa` is type-checked against `en`, so a
  missing translation fails `tsc`. Backend error text is never shown — the API client maps
  errors to reason keys that the UI translates.
- **Auth**: the session token is kept in `sessionStorage` only. Claim Tokens exist only in
  component state on the confirmation screen.
- **Font**: Vazirmatn is self-hosted at build time via `next/font/google`. The first build
  needs network access to download it.
- **Shared database**: running the backend integration tests (`npm test` in `backend/`)
  against the same database as the demo leaves `TEST_GAME_*` games behind, and those appear
  on the homepage. Point tests at a separate database before a demo.
