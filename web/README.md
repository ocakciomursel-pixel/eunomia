# Eunomia — web

The app for [Eunomia](../README.md): the landing page and the per-user product (sign in with
a passkey or a wallet → run your own bounded treasury), on Stellar mainnet.
Vite · React 19 · TypeScript · GSAP + framer-motion · `@stellar/stellar-sdk` ·
`passkey-kit` · StellarWalletsKit.

## Develop

```bash
npm install
cp .env.example .env.local   # fill in the EUNOMIA_* settings (see Environment)
npm run dev                  # http://localhost:5173
```

## Test · build · lint

```bash
npm test           # Vitest — pure-lib suites (wallet errors, events, funding, treasury ops…)
npm run build      # docs, tsc -b, vite build, security headers, check:no-secrets
npm run lint       # eslint
```

Unit tests never reach a chain: under Vitest the build settings fall back to stand-in values
(`STAND_IN_ENV` in `src/networks.ts`) whose RPC host cannot resolve.

## Live check · Playwright

`tests/e2e/passkey-signin.live.spec.ts` drives the return visit on production: create a
passkey wallet on eunomia.finance with a virtual authenticator, throw the session away, sign
in again with the same passkey and land on the same wallet. It runs against the live site
because a passkey is bound to its rp.id, and it costs one relay-sponsored wallet deploy — a
real mainnet fee — per run.

```bash
npm run test:live:install   # Chromium + system deps, once
npm run test:live
```

## Environment

Build-time, public (they end up in the bundle). The build refuses to start without them:

```
EUNOMIA_RPC_URL=…        # deployed: this app's https://<host>/api/rpc (local dev: the provider URL)
EUNOMIA_FACTORY_ID=…     # the treasury factory (C…); it holds the deposit cap of each token
EUNOMIA_REGISTRY_ID=…    # the treasury registry (C…)
```

The provider's URL carries its account key, so a deployed page never calls it: `/api/rpc`
(`src/lib/rpcProxy.ts`) forwards an allow-list of JSON-RPC methods to it, with the URL held as
the worker secret `RELAY_RPC_URL`.

Optional — the app runs without them, but feedback + activity logging silently no-op:

```
VITE_SUPABASE_URL=…
VITE_SUPABASE_ANON_KEY=…   # publishable key; RLS is insert-only (see ../supabase/migrations)
VITE_WALLETCONNECT_PROJECT_ID=…
```

Copy `.env.example` to `.env.local`. Beware invisible non-ASCII bytes when pasting keys —
`src/lib/supabase.ts` strips them for a reason.

## Deploy

Cloudflare, manual (no auto-deploy on push):

```bash
npm run deploy:cf   # npm run build, then wrangler deploy
```

The relay's settings are `vars` in `wrangler.jsonc` (set at deploy) and its fee key is a
secret: `wrangler secret put RELAY_SECRET`. See `../DEPLOYMENT.md`.

## Layout

```
src/components/landing/   the marketing page (hero, proof, how it works, guarantees, footer)
src/components/shell/     the product chrome — sidebar/tabs, rules feed, charts, treasury switcher
src/pages/                Overview · Payments · Agent · Activity · Settings · Setup
src/lib/                  userTreasury (deploy/fund/pay) · smartWalletTx (act as a passkey wallet)
                          relayHandler (fee sponsorship) · passkey · walletKit/walletSigner
                          insights (chart series) · events/analytics · activity (Supabase)
worker/                   the Cloudflare worker: static assets + /api/relay + /api/rpc, and its daily fee budget
src/networks.ts           the mainnet table and the build settings that complete it
src/config.ts             the app's view of that network — public values only
```
