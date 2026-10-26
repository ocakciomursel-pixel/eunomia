# Security headers

Written by `scripts/headers.mjs` into `dist/_headers` after every `vite build`, and served by
Cloudflare with every static asset on `eunomia.finance`. Closes audit finding F4 (and fourth-round finding L9).

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below | Clickjacking was the concrete exploit: with the page framable, an attacker overlays their own UI on a connected session and gets the user to click the real "Send payment" / "Add payee" controls. The passkey ceremony still binds to the real origin — but what the user *believes* they are approving is attacker-controlled. The script and connect lists close what an injected script could do or reach. |
| `X-Frame-Options` | `DENY` | Same control for browsers that honour it ahead of `frame-ancestors`. |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing of served assets. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Treasury and wallet addresses appear in URLs; do not leak the path off-origin. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | No downgrade. `preload` is deliberately omitted — submitting to the preload list is hard to reverse and should be a separate, deliberate decision. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Features the app never uses. **`publickey-credentials-get` is deliberately not restricted** — that is WebAuthn, which passkey login needs. |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Isolates the browsing context from cross-origin openers while keeping wallet and passkey popup flows working (review L9). |

## The Content-Security-Policy

- `default-src 'self'`.
- `script-src 'self'` plus the **`'sha256-…'` hash of every inline script** in the build, and
  the Cloudflare Web Analytics beacon (`https://static.cloudflareinsights.com`). The hashes
  cannot be written by hand — the docs site (VitePress) inlines a page-hash map that changes
  whenever the docs do — so `inlineScriptHashes()` in `scripts/headers.mjs` reads every built
  `.html` file in `dist/` after `vite build` and hashes each inline script with CRLF normalised
  to LF the way the browser's HTML parser hashes it.
- `connect-src` names every endpoint the app talks to, using **exact origins from
  `dist/build-info.json`** rather than wildcards (`*.stellar.org` or `*.supabase.co`, review L9):
  - `'self'`, `build.rpcOrigin` (in a deployed build, the app's own `/api/rpc`), and
    `build.horizonOrigin` (`https://horizon.stellar.org`);
  - `build.supabaseOrigin` over both `https:` and `wss:` (when configured at build time);
  - the WalletConnect / Reown origins (`https://*.walletconnect.org`,
    `wss://*.walletconnect.org`, `https://*.walletconnect.com`, `wss://*.walletconnect.com`,
    `https://*.reown.com`, `https://*.web3modal.org`);
  - `https://cloudflareinsights.com` (the Web Analytics beacon).
  A wrong list does not fail loudly — it silently breaks mobile wallet connect — so it was
  probed with Chromium across the landing, the app pages, the wallet modal and the docs: no
  violations.
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com`
  (React and framer-motion write `style` attributes; stylesheets load from Google Fonts and
  Fontshare), `font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com`,
  `img-src 'self' data: blob: https:` (wallet icons from the WalletConnect registry),
  `frame-src https://verify.walletconnect.org https://verify.walletconnect.com https://secure.walletconnect.org`,
  and `worker-src 'self' blob:`.
- `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`.
