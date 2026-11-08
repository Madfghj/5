#!/usr/bin/env node
import { randomBytes, createHash } from 'node:crypto';

const known = ['google', 'apple', 'microsoft', 'telegram'];
const expectedAuthorizeOrigins = {
  google: 'https://accounts.google.com',
  apple: 'https://appleid.apple.com',
  microsoft: 'https://login.microsoftonline.com',
  telegram: 'https://oauth.telegram.org',
};
const requiredKeys = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  apple: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'],
  microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  telegram: ['TELEGRAM_CLIENT_ID', 'TELEGRAM_CLIENT_SECRET'],
};
const args = process.argv.slice(2);
const originAt = args.indexOf('--origin');
const input = originAt >= 0 ? args[originAt + 1] : process.env.OPENCALENDAR_ORIGIN;
if (!input || args.some((item, index) => !['--origin', '--probe-starts'].includes(item) && index !== originAt + 1)) {
  console.error('Usage: node auth-readiness.mjs --origin https://your-app.example [--probe-starts]');
  process.exit(2);
}
let base;
try {
  base = new URL(input);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error();
  if (base.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && base.protocol === 'http:')) throw new Error();
} catch {
  console.error('Expected an HTTPS origin without credentials, path, query or fragment. Localhost HTTP is allowed.');
  process.exit(2);
}
const origin = base.origin;
const probeStarts = args.includes('--probe-starts') || process.env.AUTH_READINESS_PROBE_STARTS === '1';
const report = {
  schemaVersion: 1,
  origin,
  checkedAt: new Date().toISOString(),
  probeStarts,
  liveLoginVerified: false,
  providers: [],
};
async function request(path, options = {}) {
  const target = new URL(path, origin);
  if (target.origin !== origin) throw new Error('unexpected_origin');
  return fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...options });
}
try {
  const response = await request('/api/auth/providers');
  report.providersHttpStatus = response.status;
  if (!response.ok) throw new Error('provider_endpoint_unavailable');
  const values = await response.json();
  if (!Array.isArray(values)) throw new Error('invalid_provider_response');
  for (const id of known) {
    const configuration = values.find(item => item?.id === id);
    const item = {
      id,
      configured: configuration?.configured === true,
      callbackUrl: `${origin}/api/auth/${id}/callback`,
      requiredServerKeys: requiredKeys[id],
      liveLoginVerified: false,
    };
    report.providers.push(item);
    if (!probeStarts || !item.configured) {
      item.authorizationProbe = item.configured ? 'not_requested' : 'skipped_unconfigured';
      continue;
    }
    // Initiate only providers which the server explicitly declares configured.
    // This does not submit an identity or complete consent/login at the provider.
    const verifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const started = await request(`/api/auth/${id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codeChallenge }),
    });
    item.startHttpStatus = started.status;
    const payload = await started.json();
    if (!started.ok) {
      item.authorizationProbe = 'failed';
      item.errorCode = typeof payload.code === 'string' && /^[a-z_]+$/.test(payload.code) ? payload.code : 'start_failed';
      continue;
    }
    const authorize = new URL(payload.url);
    if (authorize.origin !== origin || authorize.pathname !== `/api/auth/${id}/authorize`) throw new Error('unexpected_authorize_url');
    const opened = await request(authorize.pathname + authorize.search);
    item.authorizeHttpStatus = opened.status;
    const location = opened.headers.get('Location');
    if (opened.status !== 303 || !location) {
      item.authorizationProbe = 'failed';
      item.errorCode = 'authorize_redirect_missing';
      continue;
    }
    const target = new URL(location);
    const cookie = opened.headers.get('Set-Cookie') || '';
    item.authorizationOrigin = target.origin;
    item.expectedAuthorizationOrigin = target.origin === expectedAuthorizeOrigins[id];
    item.callbackMatches = target.searchParams.get('redirect_uri') === item.callbackUrl;
    item.responseType = target.searchParams.get('response_type');
    item.scopes = target.searchParams.get('scope');
    item.providerPkceMethod = target.searchParams.get('code_challenge_method');
    item.browserBindingCookie = {
      httpOnly: /;\s*HttpOnly\b/i.test(cookie),
      secure: /;\s*Secure\b/i.test(cookie),
      sameSite: /;\s*SameSite=([^;]+)/i.exec(cookie)?.[1] || null,
    };
    item.authorizationProbe = item.expectedAuthorizationOrigin && item.callbackMatches && item.responseType === 'code' ? 'redirect_ready' : 'failed';
    // State, nonce, tickets, cookie values, client IDs and provider secrets are never printed.
  }
  report.anySocialProviderConfigured = report.providers.some(item => item.configured);
  report.allRequestedSocialProvidersConfigured = report.providers.every(item => item.configured);
  report.needsConfiguration = report.providers.filter(item => !item.configured).map(item => item.id);
  report.needsInteractiveLoginCheck = report.providers.filter(item => item.configured).map(item => item.id);
  console.log(JSON.stringify(report, null, 2));
  if (report.providers.some(item => item.authorizationProbe === 'failed')) process.exitCode = 1;
} catch (error) {
  report.errorCode = typeof error.message === 'string' && /^[a-z_]+$/.test(error.message) ? error.message : 'request_failed';
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
