# OpenCalendar API

Node.js 24, Express, SQLite (`node:sqlite`), Server-Sent Events and OIDC. No external database account is required for local development. The server never seeds fictitious user accounts or group activity.

Run from the project root with the package's server script (or `node --env-file-if-exists=.env server/index.mjs`). The default address is `http://127.0.0.1:8787`. The Vite development server proxies `/api` to it.

## Environment

| Variable | Default / purpose |
| --- | --- |
| `HOST` | `127.0.0.1`; use `0.0.0.0` only when LAN access is needed |
| `PORT` | `8787` |
| `DATABASE_PATH` | `work/opencalendar.sqlite`, relative to the working directory |
| `PUBLIC_URL` | `http://127.0.0.1:8787`; public HTTPS backend origin for OAuth |
| `CLIENT_URL` | `http://localhost:5173`; exact permitted web OAuth return URL |
| `NATIVE_REDIRECT_URL` | `space.opencalendar.app://auth`; exact permitted native return URL |
| `ALLOWED_ORIGINS` | Comma-separated origins; default is CLIENT_URL origin, `capacitor://localhost`, `http://localhost`, `https://localhost` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google web OAuth client credentials |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft confidential web application credentials |
| `MICROSOFT_TENANT_ID` | `common`; alternatively a tenant UUID, `organizations`, or `consumers` |
| `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET` | Telegram OIDC credentials from BotFather Mini App → Login Widget; not the Bot API token |
| `APPLE_CLIENT_ID` | Apple Services ID associated with the app |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Sign in with Apple key; PKCS#8 PEM, literal `\n` accepted |
| `TOKEN_ENCRYPTION_KEY` | Stable random server secret, recommended 32+ random characters, for Apple revocation token AES-256-GCM encryption |

OAuth secrets belong on the backend, never in Vite variables or native application files. When `TOKEN_ENCRYPTION_KEY` is absent, the Apple private key derives the encryption key; keep the old key or migrate ciphertext before rotating that private key. SQLite contains personal calendar data and hashed sessions: use persistent private storage, restrictive filesystem permissions and private backups. One server process owns live subscriptions; a multi-instance deployment needs shared pub/sub and shared rate limiting in addition to the SQLite deployment strategy.

## API

Authenticated requests send `Authorization: Bearer <token>`. Tokens expire after 30 days, are stored only as SHA-256 hashes in SQLite, and logout revokes the current session. Errors return JSON `{ "error": "code", "code": "code" }` and an appropriate HTTP status.

| Method | Route | Body / result |
| --- | --- | --- |
| GET | `/api/health` | `{ok,version}` |
| POST | `/api/session` | `{name,locale}` → `{token,user}` guest account |
| DELETE | `/api/session` | Revoke current session |
| GET | `/api/state` | `{user,groups,events}` scoped to the current user's memberships |
| PATCH | `/api/profile` | `{name?,locale?}` → `{user}` |
| POST | `/api/groups` | `{name,emoji?,color?}` → Group |
| POST | `/api/groups/join` | `{code}` → Group |
| DELETE | `/api/groups/:id/membership` | Leave a group; remove own responses; transfer ownership or delete the empty group |
| POST | `/api/events` | Event fields → CalendarEvent |
| PATCH | `/api/events/:id` | Partial event fields; author or group owner only |
| DELETE | `/api/events/:id` | Author or group owner only |
| PUT | `/api/events/:id/response` | `{value:"yes"|"no"|"maybe"}` → CalendarEvent |
| GET | `/api/live` | Authenticated SSE stream: `connected`, `change`; client refetches `/api/state` on changes |
| DELETE | `/api/account` | Revoke Apple grant if linked; erase user, sessions, identities, responses, authored events; transfer groups with other members |

Locales are `ru`, `de`, `en`, `fr`. Group colors accept six-digit hex colors, or `green`, `blue`, `orange`, `purple`, `pink`, `yellow` which normalize to hex. Invite codes are 12 hexadecimal characters and are case-insensitive; spaces/hyphens may be added for readability. A member can invite others by sharing the code. An unknown or inaccessible group/event returns 404 to avoid revealing its existence.

Event fields are `{groupId,title,date,startTime,endTime,location?,notes?}`. Dates are real ISO calendar dates from 2000 through 2100. Times are local wall-clock strings, 08:00 through 20:00 inclusive in half-hour increments; an event's end must be later than its start. The API does not convert between time zones. Groups should agree on their event time zone before inviting members from different zones.

When the project contains `dist/client/index.html`, the API server also serves the built application and static assets, falling back to its index for non-API GET routes. Unknown `/api` routes always remain JSON 404 responses. In a same-origin production deployment, set `CLIENT_URL` and `PUBLIC_URL` to the production HTTPS origin; build with an empty `VITE_API_URL` for the web client.

SSE uses bearer authentication with streaming `fetch`, not an EventSource query token. Changes notify only affected group members. A heartbeat checks session expiry every 20 seconds. The client reconnects and refetches after interruption. There are at most five concurrent live streams per user. Current in-process limits are 500 API requests/minute/IP, 20 guest sessions/hour/IP, 20 groups/hour/user, 10 invite join attempts/minute/user, and 15 OAuth starts/minute/IP. IP limits use the socket peer; a production reverse proxy requires a carefully configured trusted-proxy policy.

## OAuth contract

1. `GET /api/auth/providers` → `[{id:"google"|"apple"|"microsoft"|"telegram",configured:boolean}]`. A provider remains unconfigured until its complete credentials exist.
2. Generate a cryptographically random client verifier (32 random bytes encoded as base64url gives 43 characters) and retain it locally until callback. Calculate the base64url SHA-256 digest of its ASCII string. `POST /api/auth/:provider/start` with `{codeChallenge,returnTo?}` → `{url}`. The challenge must be a canonical 43-character base64url digest. Omit bearer authentication for sign-in; include the current bearer **only when linking a provider to that account**. The optional return URL must exactly match `CLIENT_URL` or `NATIVE_REDIRECT_URL`; omitting it selects `CLIENT_URL`.
3. Open the returned URL in the system browser. This one-use ticket establishes an HttpOnly browser cookie, then redirects to the provider. Google/Microsoft/Telegram use PKCE. Apple uses `form_post` and a Secure/SameSite=None cookie on HTTPS. Telegram requests only `openid profile` and exchanges its code with HTTP Basic client authentication, without sending the client secret in the request body. No Telegram phone-number or bot-messaging permission is requested.
4. Register exactly `${PUBLIC_URL}/api/auth/google/callback`, `/api/auth/apple/callback`, `/api/auth/microsoft/callback`, or `/api/auth/telegram/callback` with the respective provider. Google/Microsoft/Telegram use GET callbacks; Apple uses POST. Apple needs a verified HTTPS domain; localhost is unsuitable. Configure the Telegram origin and redirect URL in BotFather Mini App → Login Widget and leave the signing algorithm at RS256, which the server verifies.
5. The server validates one-use state, browser binding, ID token signature, issuer, audience, expiration and nonce. Microsoft subjects include the tenant ID to avoid cross-tenant identity collisions.
6. Success redirects to the allowed return URL with fragment `#auth_code=<one-time-code>`. The client removes the fragment, then calls `POST /api/auth/exchange` with `{code,codeVerifier}` → `{token,user}`. The verifier must match the initiating client's SHA-256 challenge. This app-level PKCE binding prevents another application that intercepts a custom-scheme callback from redeeming its code. Account creation and provider linking are deferred until this proof succeeds; callback completion alone never mutates account identities. A rejected verifier leaves the legitimate exchange available; a successful exchange consumes the code once. Codes expire after 60 seconds. Failures redirect with `#auth_error=<code>` once the browser/state is valid. Clear the locally retained verifier after success or a terminal callback error.

Existing identities are never silently merged. Linking an identity already owned by another account returns `identity_already_linked`. Guest accounts cannot be recovered after losing their token unless a provider was linked beforehand.

Google, Microsoft and Telegram access/refresh tokens are not retained. Apple's encrypted refresh token (or access token if no refresh token is returned) is retained solely to revoke the Apple authorization grant during account deletion. If revocation cannot finish, deletion returns `provider_revocation_failed` and keeps the account for retry. New provider-only local accounts start in English, matching the cloud API. Configured credentials are not evidence that a real provider callback has passed; verify each provider separately before release.

## Validation

`node --test tests/server.test.mjs` covers authentication, membership isolation, all three response values, time/date validation, edit authorization, actual SSE delivery and outsider isolation, ownership transfer, deletion, SQLite persistence, hashed sessions, color validation, production static routing, unconfigured OAuth behavior, PKCE/browser-binding rejection, body sizes and request limits. Its OIDC integration test signs real RSA ID tokens against an in-memory mock provider, verifies guest linking and returning-account sign-in, rejects issuer/nonce mismatches, prevents identity takeover and silent account merging, rejects intercepted callback codes lacking the verifier, and consumes successful exchange codes once. External OAuth token exchange and provider-console registration require real credentials and a configured HTTPS domain.

Telegram-specific signed-token coverage additionally verifies Basic client authentication, minimum scopes, its provider PKCE verifier, exact native return, absent browser cookie, wrong issuer/audience/nonce, expired tokens, invalid signatures, state/code replay rejection, and returning-account identity. See [Telegram's official OIDC documentation](https://core.telegram.org/bots/telegram-login) for the provider contract.
