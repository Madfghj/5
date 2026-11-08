import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const clientVerifier = randomBytes(32).toString('base64url');
const clientChallenge = createHash('sha256').update(clientVerifier).digest('base64url');

async function fixture(t, options = {}) {
  const runtime = createApp({ dbPath: ':memory:', quiet: true, env: {}, ...options });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let stopped = false;
  const close = async () => {
    if (stopped) return;
    stopped = true;
    runtime.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  t.after(close);
  const request = async (path, { token, method = 'GET', body, ...rest } = {}) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...rest });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const user = async (name = 'Alex', locale = 'ru') => {
    const response = await request('/session', { method: 'POST', body: { name, locale } });
    assert.equal(response.status, 201);
    return response.body;
  };
  const group = async (token) => {
    const response = await request('/groups', { token, method: 'POST', body: { name: 'Family', emoji: '🌿', color: 'green' } });
    assert.equal(response.status, 201);
    return response.body;
  };
  const event = async (token, groupId, fields = {}) => request('/events', { token, method: 'POST', body: { groupId, title: 'Dinner', date: '2026-11-06', startTime: '18:00', endTime: '19:30', location: 'Home', notes: '', ...fields } });
  return { ...runtime, server, base, request, user, group, event, close };
}

test('desktop CORS exposes authenticated API errors only to the exact desktop origin', async (t) => {
  const f = await fixture(t);
  const allowed = await f.request('/state', { headers: { Origin: 'tauri://localhost' } });
  assert.equal(allowed.status, 401);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost');
  for (const origin of ['null', 'tauri://localhost.evil.example', 'https://evil.example']) {
    const denied = await f.request('/state', { headers: { Origin: origin } });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('session and profile validate input; logout revokes the bearer', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/health')).body.ok, true);
  assert.equal((await f.request('/state')).status, 401);
  assert.equal((await f.request('/session', { method: 'POST', body: { name: '', locale: 'ru' } })).status, 400);
  assert.equal((await f.request('/session', { method: 'POST', body: { name: 'Name', locale: 'it' } })).status, 400);
  assert.equal((await f.request('/session', { method: 'POST' })).status, 400);
  assert.equal((await f.request('/session', { method: 'POST', body: [] })).status, 400);
  const account = await f.user('  Marie  ', 'fr');
  assert.equal(account.user.name, 'Marie');
  assert.deepEqual(account.user.connectedProviders, []);
  assert.ok(account.token.length >= 40);
  const profile = await f.request('/profile', { token: account.token, method: 'PATCH', body: { name: 'Mia', locale: 'de' } });
  assert.equal(profile.body.user.name, 'Mia');
  assert.equal(profile.body.user.locale, 'de');
  assert.equal((await f.request('/profile', { token: account.token, method: 'PATCH', body: { locale: 'es' } })).status, 400);
  assert.equal((await f.request('/session', { token: account.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/state', { token: account.token })).status, 401);
});

test('group invites reveal data only after joining; votes are exactly yes, no, or maybe', async (t) => {
  const f = await fixture(t);
  const a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside');
  const group = await f.group(a.token);
  assert.equal(group.memberCount, 1);
  assert.equal(group.color, '#729b75');
  assert.match(group.inviteCode, /^[A-F0-9]{12}$/);
  const created = await f.event(a.token, group.id);
  assert.equal(created.status, 201);
  assert.equal((await f.request('/state', { token: b.token })).body.events.length, 0);
  assert.equal((await f.request(`/events/${created.body.id}/response`, { token: b.token, method: 'PUT', body: { value: 'yes' } })).status, 404);
  const joined = await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode.toLowerCase() } });
  assert.equal(joined.body.memberCount, 2);
  assert.equal((await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } })).body.memberCount, 2);
  assert.equal((await f.request('/groups/join', { token: outsider.token, method: 'POST', body: { code: '000000000000' } })).status, 404);
  for (const value of ['yes', 'no', 'maybe']) {
    const voted = await f.request(`/events/${created.body.id}/response`, { token: b.token, method: 'PUT', body: { value } });
    assert.equal(voted.status, 200);
    assert.equal(voted.body.responses[b.user.id], value);
    assert.equal(Object.keys(voted.body.responses).length, 1);
  }
  assert.equal((await f.request(`/events/${created.body.id}/response`, { token: b.token, method: 'PUT', body: { value: 'later' } })).status, 400);
  const state = (await f.request('/state', { token: b.token })).body;
  assert.equal(state.events[0].responses[b.user.id], 'maybe');
  assert.equal(state.groups[0].members.length, 2);
  assert.equal((await f.request('/state', { token: outsider.token })).body.groups.length, 0);
});

test('all event time boundaries and real calendar dates are enforced server-side', async (t) => {
  const f = await fixture(t), a = await f.user(), group = await f.group(a.token);
  assert.equal((await f.event(a.token, group.id, { startTime: '08:00', endTime: '08:30' })).status, 201);
  assert.equal((await f.event(a.token, group.id, { startTime: '19:30', endTime: '20:00' })).status, 201);
  assert.equal((await f.event(a.token, group.id, { date: '2028-02-29' })).status, 201);
  assert.equal((await f.event(a.token, group.id, { date: '2100-12-31', location: 'x'.repeat(200) })).status, 201);
  for (const fields of [
    { startTime: '07:30' }, { startTime: '18:15' }, { endTime: '20:30' },
    { startTime: '20:00', endTime: '20:00' }, { startTime: '19:00', endTime: '18:00' },
    { date: '2026-02-29' }, { date: '2026-13-01' }, { date: '2026-11-31' }, { date: 'tomorrow' }, { date: '2100-02-29' }, { date: '2101-01-01' },
    { title: '   ' }, { title: 'x'.repeat(121) },
  ]) assert.equal((await f.event(a.token, group.id, fields)).status, 400, JSON.stringify(fields));
});

test('group colors accept six-digit hex while rejecting CSS injection and unsupported strings', async (t) => {
  const f = await fixture(t), a = await f.user();
  for (const color of ['#729b75', '#9b85ca', '#d7a25e', '#6e9fc1', '#cd859a', '#78aba0', '#ABCDEF']) {
    const result = await f.request('/groups', { token: a.token, method: 'POST', body: { name: 'Group', color } });
    assert.equal(result.status, 201);
    assert.equal(result.body.color, color);
  }
  for (const color of ['#abc', 'red', 'url(https://example.com)', '#fff;display:none', {}, '__proto__']) assert.equal((await f.request('/groups', { token: a.token, method: 'POST', body: { name: 'Group', color } })).status, 400);
});

test('creators and group owners can edit events; unrelated members cannot', async (t) => {
  const f = await fixture(t), owner = await f.user('Owner'), member = await f.user('Member');
  const group = await f.group(owner.token);
  await f.request('/groups/join', { token: member.token, method: 'POST', body: { code: group.inviteCode } });
  const created = await f.event(owner.token, group.id);
  assert.equal((await f.request(`/events/${created.body.id}`, { token: member.token, method: 'PATCH', body: { title: 'Wrong' } })).status, 403);
  assert.equal((await f.request(`/events/${created.body.id}`, { token: member.token, method: 'DELETE' })).status, 403);
  const updated = await f.request(`/events/${created.body.id}`, { token: owner.token, method: 'PATCH', body: { title: 'Updated' } });
  assert.equal(updated.body.title, 'Updated');
  const memberEvent = await f.event(member.token, group.id);
  assert.equal((await f.request(`/events/${memberEvent.body.id}`, { token: owner.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request(`/events/${created.body.id}`, { token: owner.token, method: 'PATCH', body: { groupId: 'different-group' } })).status, 400);
});

test('SSE notifies both group members while an outsider receives no group changes', async (t) => {
  const f = await fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), c = await f.user('Outside');
  const group = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const connect = async (account) => {
    const controller = new AbortController();
    const response = await fetch(`${f.base}/api/live`, { headers: { Authorization: `Bearer ${account.token}` }, signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: connected/);
    t.after(() => controller.abort());
    return { reader, controller };
  };
  const [streamA, streamB, streamC] = await Promise.all([connect(a), connect(b), connect(c)]);
  const readA = streamA.reader.read(), readB = streamB.reader.read();
  await f.event(a.token, group.id);
  for (const read of [readA, readB]) {
    const record = await Promise.race([read, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('SSE timed out')), 1500); timer.unref(); })]);
    assert.match(new TextDecoder().decode(record.value), /event: change/);
  }
  const outsiderResult = await Promise.race([streamC.reader.read().then(() => 'data'), new Promise((resolve) => setTimeout(() => resolve('quiet'), 100))]);
  assert.equal(outsiderResult, 'quiet');
  for (const stream of [streamA, streamB, streamC]) stream.controller.abort();
});

test('leaving removes votes, transfers group ownership, and immediately removes read access', async (t) => {
  const f = await fixture(t), a = await f.user('Owner'), b = await f.user('Member');
  const group = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const created = await f.event(b.token, group.id);
  await f.request(`/events/${created.body.id}/response`, { token: a.token, method: 'PUT', body: { value: 'yes' } });
  assert.equal((await f.request(`/groups/${group.id}/membership`, { token: a.token, method: 'DELETE' })).status, 200);
  const remaining = (await f.request('/state', { token: b.token })).body;
  assert.equal(remaining.groups[0].createdBy, b.user.id);
  assert.equal(remaining.events[0].responses[a.user.id], undefined);
  assert.equal((await f.request('/state', { token: a.token })).body.groups.length, 0);
  assert.equal((await f.request(`/events/${created.body.id}/response`, { token: a.token, method: 'PUT', body: { value: 'yes' } })).status, 404);
  await f.request(`/groups/${group.id}/membership`, { token: b.token, method: 'DELETE' });
  assert.equal((await f.request('/state', { token: b.token })).body.groups.length, 0);
});

test('account deletion removes personal records, authored events and sessions but preserves other members', async (t) => {
  const f = await fixture(t), a = await f.user('Owner'), b = await f.user('Member');
  const group = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  await f.event(a.token, group.id);
  const bEvent = await f.event(b.token, group.id);
  await f.request(`/events/${bEvent.body.id}/response`, { token: a.token, method: 'PUT', body: { value: 'maybe' } });
  assert.equal((await f.request('/account', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/state', { token: a.token })).status, 401);
  const state = (await f.request('/state', { token: b.token })).body;
  assert.equal(state.groups[0].createdBy, b.user.id);
  assert.equal(state.groups[0].memberCount, 1);
  assert.equal(state.events.length, 1);
  assert.deepEqual(state.events[0].responses, {});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users WHERE id=?').get(a.user.id).count, 0);
  assert.equal((await f.request('/account', { token: b.token, method: 'DELETE' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM groups').get().count, 0);
});

test('SQLite preserves sessions, groups, events and responses across process restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'oc-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'calendar.sqlite');
  const first = await fixture(t, { dbPath });
  const a = await first.user(), group = await first.group(a.token), event = await first.event(a.token, group.id);
  await first.request(`/events/${event.body.id}/response`, { token: a.token, method: 'PUT', body: { value: 'yes' } });
  // Raw bearer values never enter the database.
  assert.equal(first.db.prepare('SELECT token_hash FROM sessions').get().token_hash.length, 64);
  assert.notEqual(first.db.prepare('SELECT token_hash FROM sessions').get().token_hash, a.token);
  await first.close();
  const second = await fixture(t, { dbPath });
  const state = await second.request('/state', { token: a.token });
  assert.equal(state.status, 200);
  assert.equal(state.body.groups[0].id, group.id);
  assert.equal(state.body.events[0].responses[a.user.id], 'yes');
  await second.close();
});

test('unconfigured OAuth providers are explicit and exchange codes cannot be fabricated', async (t) => {
  const f = await fixture(t);
  const providers = (await f.request('/auth/providers')).body;
  assert.deepEqual(providers.map((provider) => provider.id), ['google', 'apple', 'microsoft', 'telegram']);
  assert.ok(providers.every((provider) => provider.configured === false));
  for (const id of ['google', 'apple', 'microsoft', 'telegram']) {
    const response = await f.request(`/auth/${id}/start`, { method: 'POST', body: {} });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'provider_not_configured');
  }
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code: 'fabricated' } })).status, 401);
});

test('Telegram OIDC uses Basic client authentication and verifies identity before native exchange or linking', async (t) => {
  const incomplete = await fixture(t, { env: { TELEGRAM_CLIENT_ID: '123456789' } });
  assert.equal((await incomplete.request('/auth/providers')).body.find(provider => provider.id === 'telegram').configured, false);
  const clientId = '123456789', clientSecret = 'local-test-only-secret';
  const f = await fixture(t, { env: { TELEGRAM_CLIENT_ID: clientId, TELEGRAM_CLIENT_SECRET: clientSecret } });
  assert.equal((await f.request('/auth/providers')).body.find(provider => provider.id === 'telegram').configured, true);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const otherKey = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'telegram-test-key', use: 'sig', alg: 'RS256' };
  const originalFetch = globalThis.fetch;
  let identityToken, tokenRequest;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input) === 'https://oauth.telegram.org/token') {
      tokenRequest = { headers: new Headers(init.headers), body: new URLSearchParams(init.body) };
      return Response.json({ id_token: identityToken, access_token: 'unused-telegram-token' });
    }
    if (String(input) === 'https://oauth.telegram.org/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    return originalFetch(input, init);
  });
  const begin = async (token) => {
    const started = await f.request('/auth/telegram/start', { token, method: 'POST', body: { codeChallenge: clientChallenge, returnTo: 'space.opencalendar.app://auth' } });
    assert.equal(started.status, 200);
    const authorize = new URL(started.body.url);
    const opened = await fetch(`${f.base}${authorize.pathname}${authorize.search}`, { redirect: 'manual' });
    const destination = new URL(opened.headers.get('location'));
    assert.equal(destination.origin, 'https://oauth.telegram.org');
    assert.equal(destination.pathname, '/auth');
    assert.equal(destination.searchParams.get('scope'), 'openid profile');
    assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(destination.searchParams.get('client_secret'), null);
    return { destination, state: destination.searchParams.get('state'), nonce: destination.searchParams.get('nonce'), cookie: opened.headers.get('set-cookie').split(';')[0] };
  };
  const sign = (flow, invalid = '') => new SignJWT({ nonce: invalid === 'nonce' ? 'wrong-nonce' : flow.nonce, name: 'Telegram Name', preferred_username: 'calendar_member' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(invalid === 'issuer' ? 'https://attacker.example' : 'https://oauth.telegram.org')
    .setAudience(invalid === 'audience' ? 'other-client' : clientId)
    .setSubject('telegram-stable-subject').setIssuedAt().setExpirationTime(invalid === 'expired' ? '-1m' : '5m')
    .sign(invalid === 'signature' ? otherKey.privateKey : privateKey);
  const callback = flow => fetch(`${f.base}/api/auth/telegram/callback?state=${encodeURIComponent(flow.state)}&code=telegram-code`, { redirect: 'manual', headers: { Cookie: flow.cookie } });
  const result = response => new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1));
  const valid = await begin();
  const noCookie = await fetch(`${f.base}/api/auth/telegram/callback?state=${encodeURIComponent(valid.state)}&code=telegram-code`, { redirect: 'manual' });
  assert.equal(noCookie.status, 400, 'the initiating browser cookie is required');
  for (const invalid of ['nonce', 'issuer', 'audience', 'expired', 'signature']) {
    const flow = await begin();
    identityToken = await sign(flow, invalid);
    const rejected = result(await callback(flow));
    assert.ok(rejected.get('auth_error'), invalid);
    assert.equal(rejected.get('auth_code'), null, invalid);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM identities').get().count, 0);
  const flow = await begin();
  identityToken = await sign(flow);
  const accepted = await callback(flow);
  assert.equal(accepted.status, 303);
  assert.equal(new URL(accepted.headers.get('location')).protocol, 'space.opencalendar.app:');
  assert.equal(tokenRequest.headers.get('Authorization'), `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`);
  assert.equal(tokenRequest.body.get('client_secret'), null);
  assert.equal(tokenRequest.body.get('client_id'), clientId);
  assert.equal(tokenRequest.body.get('redirect_uri'), flow.destination.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(tokenRequest.body.get('code_verifier')).digest('base64url'), flow.destination.searchParams.get('code_challenge'));
  assert.equal((await callback(flow)).status, 400, 'a consumed state cannot be replayed');
  const code = result(accepted).get('auth_code');
  assert.ok(code);
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: randomBytes(32).toString('base64url') } })).body.code, 'invalid_exchange_verifier');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0, 'a callback or stolen exchange code cannot create an account');
  const exchanged = await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: clientVerifier } });
  assert.equal(exchanged.status, 200);
  assert.equal(exchanged.body.user.name, 'Telegram Name');
  assert.equal(exchanged.body.user.locale, 'en');
  assert.deepEqual(exchanged.body.user.connectedProviders, ['telegram']);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM provider_tokens').get().count, 0);
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: clientVerifier } })).status, 401);
  const returning = await begin();
  identityToken = await sign(returning);
  const returnCode = result(await callback(returning)).get('auth_code');
  const returned = await f.request('/auth/exchange', { method: 'POST', body: { code: returnCode, codeVerifier: clientVerifier } });
  assert.equal(returned.body.user.id, exchanged.body.user.id);
  const other = await f.user('Separate profile');
  const conflict = await begin(other.token);
  identityToken = await sign(conflict);
  assert.equal(result(await callback(conflict)).get('auth_error'), 'identity_already_linked');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
});

test('OAuth start restricts return URLs, uses PKCE and browser binding, and rejects ticket reuse', async (t) => {
  const f = await fixture(t, { env: { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' } });
  assert.equal((await f.request('/auth/google/start', { method: 'POST', body: { returnTo: 'https://attacker.example' } })).status, 400);
  assert.equal((await f.request('/auth/google/start', { method: 'POST', body: {} })).body.code, 'invalid_code_challenge');
  for (const codeChallenge of ['short', 'a'.repeat(44), '+'.repeat(43), 'A'.repeat(42) + 'B']) assert.equal((await f.request('/auth/google/start', { method: 'POST', body: { codeChallenge } })).status, 400);
  const started = await f.request('/auth/google/start', { method: 'POST', body: { codeChallenge: clientChallenge } });
  assert.equal(started.status, 200);
  const url = new URL(started.body.url);
  const opened = await fetch(`${f.base}${url.pathname}${url.search}`, { redirect: 'manual' });
  assert.equal(opened.status, 303);
  assert.match(opened.headers.get('set-cookie'), /HttpOnly/);
  const providerUrl = new URL(opened.headers.get('location'));
  assert.equal(providerUrl.origin, 'https://accounts.google.com');
  assert.equal(providerUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(providerUrl.searchParams.get('nonce').length > 30);
  assert.ok(providerUrl.searchParams.get('code_challenge').length > 30);
  assert.equal((await fetch(`${f.base}${url.pathname}${url.search}`, { redirect: 'manual' })).status, 400);
  const state = providerUrl.searchParams.get('state');
  const callback = await fetch(`${f.base}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=fake`, { redirect: 'manual' });
  assert.equal(callback.status, 400, 'callback without initiating browser cookie is rejected before token exchange');
});

test('OIDC verifies actual signed ID tokens, links a guest, rejects nonce mismatch and consumes exchange codes once', async (t) => {
  const f = await fixture(t, { env: { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' } });
  const account = await f.user('Guest');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-signing-key', use: 'sig', alg: 'RS256' };
  const originalFetch = globalThis.fetch;
  let identityToken, seenVerifier;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      seenVerifier = new URLSearchParams(init.body).get('code_verifier');
      return Response.json({ id_token: identityToken, access_token: 'unused-access-token' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    return originalFetch(input, init);
  });
  const begin = async (token = account.token) => {
    const started = await f.request('/auth/google/start', { token, method: 'POST', body: { codeChallenge: clientChallenge } });
    const authorize = new URL(started.body.url);
    const opened = await fetch(`${f.base}${authorize.pathname}${authorize.search}`, { redirect: 'manual' });
    const providerUrl = new URL(opened.headers.get('location'));
    return { providerUrl, cookie: opened.headers.get('set-cookie').split(';')[0], state: providerUrl.searchParams.get('state'), nonce: providerUrl.searchParams.get('nonce') };
  };
  const sign = (nonce, issuer = 'https://accounts.google.com') => new SignJWT({ nonce, name: 'Google Name' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer).setAudience('test-client').setSubject('google-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const callback = (flow) => fetch(`${f.base}/api/auth/google/callback?state=${encodeURIComponent(flow.state)}&code=authorized-code`, { redirect: 'manual', headers: { Cookie: flow.cookie } });
  const valid = await begin();
  identityToken = await sign(valid.nonce);
  const accepted = await callback(valid);
  assert.equal(accepted.status, 303);
  assert.ok(seenVerifier.length >= 43);
  const code = new URLSearchParams(new URL(accepted.headers.get('location')).hash.slice(1)).get('auth_code');
  assert.ok(code);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM identities').get().count, 0, 'callback alone must not attach a provider identity');
  const missingVerifier = await f.request('/auth/exchange', { method: 'POST', body: { code } });
  assert.equal(missingVerifier.status, 401);
  assert.equal(missingVerifier.body.code, 'invalid_exchange_verifier');
  const intercepted = await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: randomBytes(32).toString('base64url') } });
  assert.equal(intercepted.status, 401, 'a stolen native redirect code is useless without the initiating client verifier');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM identities').get().count, 0, 'failed proof must not mutate account identities');
  const exchange = await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: clientVerifier } });
  assert.equal(exchange.status, 200);
  assert.equal(exchange.body.user.id, account.user.id, 'provider links to existing guest account without replacing its identity');
  assert.deepEqual(exchange.body.user.connectedProviders, ['google']);
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: clientVerifier } })).status, 401);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM identities WHERE user_id=?').get(account.user.id).count, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM provider_tokens').get().count, 0, 'Google access token is not retained');
  for (const invalid of ['nonce', 'issuer']) {
    const flow = await begin();
    identityToken = await sign(invalid === 'nonce' ? 'wrong-nonce' : flow.nonce, invalid === 'issuer' ? 'https://attacker.example' : 'https://accounts.google.com');
    const rejected = await callback(flow);
    const fragment = new URLSearchParams(new URL(rejected.headers.get('location')).hash.slice(1));
    assert.ok(fragment.get('auth_error'));
    assert.equal(fragment.get('auth_code'), null);
  }
  const anotherGuest = await f.user('Another');
  const duplicate = await begin(anotherGuest.token);
  identityToken = await sign(duplicate.nonce);
  const conflict = await callback(duplicate);
  assert.equal(new URLSearchParams(new URL(conflict.headers.get('location')).hash.slice(1)).get('auth_error'), 'identity_already_linked');
  const returning = await begin(null);
  identityToken = await sign(returning.nonce);
  const login = await callback(returning);
  const loginCode = new URLSearchParams(new URL(login.headers.get('location')).hash.slice(1)).get('auth_code');
  const returned = await f.request('/auth/exchange', { method: 'POST', body: { code: loginCode, codeVerifier: clientVerifier } });
  assert.equal(returned.body.user.id, account.user.id, 'sign-in without linking returns the previously linked account');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2, 'a different guest account is preserved without silent merging');
  f.db.prepare('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)').run('google', 'second-private-subject', account.user.id);
  f.db.prepare('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)').run('internal', 'private-internal-id', account.user.id);
  assert.deepEqual((await f.request('/state', { token: account.token })).body.user.connectedProviders, ['google']);
  const profile = await f.request('/profile', { token: account.token, method: 'PATCH', body: { name: 'Still me' } });
  assert.deepEqual(profile.body.user.connectedProviders, ['google']);
  const group = await f.group(account.token);
  await f.request('/groups/join', { token: anotherGuest.token, method: 'POST', body: { code: group.inviteCode } });
  const peerState = (await f.request('/state', { token: anotherGuest.token })).body;
  assert.deepEqual(peerState.user.connectedProviders, []);
  assert.ok(peerState.groups[0].members.every((member) => !('connectedProviders' in member) && !('subject' in member)));
  assert.doesNotMatch(JSON.stringify(peerState), /google|private-subject|private-internal-id/);
});

test('production serves built assets and SPA index while API misses stay JSON', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'oc-static-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>OpenCalendar test</title>');
  await writeFile(join(directory, 'app.js'), 'console.log("static-test");');
  const f = await fixture(t, { staticDir: directory });
  for (const path of ['/', '/calendar']) {
    const response = await fetch(`${f.base}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /OpenCalendar test/);
  }
  const asset = await fetch(`${f.base}/app.js`);
  assert.match(await asset.text(), /static-test/);
  const missing = await f.request('/missing');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'not_found');
  await f.close();
});

test('day availability is member-only, attributed from the bearer and upserted per person and day', async (t) => {
  const f = await fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside'), group = await f.group(a.token);
  const day = { groupId: group.id, date: '2026-11-08', value: 'yes', time: null, note: '' };
  assert.equal((await f.request('/availability', { method: 'PUT', body: day })).status, 401);
  for (const method of ['PUT', 'DELETE']) assert.equal((await f.request('/availability', { token: outsider.token, method, body: day })).status, 404);
  const first = await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, userId: b.user.id } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.userId, a.user.id);
  assert.equal(first.body.time, null);
  assert.ok(Number.isInteger(first.body.updatedAt));
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  await f.request('/availability', { token: b.token, method: 'PUT', body: { ...day, value: 'maybe', time: '08:00', note: 'After breakfast' } });
  const changed = await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, value: 'no', time: '20:00', note: '  Away  ' } });
  assert.equal(changed.body.note, 'Away');
  assert.ok(changed.body.updatedAt >= first.body.updatedAt);
  const state = (await f.request('/state', { token: b.token })).body;
  assert.equal(state.availability.length, 2);
  assert.equal(state.availability.find((row) => row.userId === a.user.id).value, 'no');
  assert.equal(state.availability.find((row) => row.userId === b.user.id).time, '08:00');
  assert.ok(state.availability.every((row) => Object.keys(row).sort().join(',') === 'date,groupId,note,time,updatedAt,userId,value'));
  assert.deepEqual((await f.request('/state', { token: outsider.token })).body.availability, []);
  const removed = await f.request('/availability', { token: b.token, method: 'DELETE', body: { ...day, userId: a.user.id } });
  assert.equal(removed.status, 200);
  assert.deepEqual((await f.request('/state', { token: a.token })).body.availability.map((row) => row.userId), [a.user.id]);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await f.request('/availability', { token: a.token, method: 'DELETE', body: day })).status, 200);
  assert.deepEqual((await f.request('/state', { token: a.token })).body.availability, []);
});

test('day availability validates real dates, half-hour optional times, three values and short notes', async (t) => {
  const f = await fixture(t), a = await f.user(), group = await f.group(a.token);
  const day = { groupId: group.id, date: '2028-02-29', value: 'yes', time: null, note: '' };
  for (const time of [null, '08:00', '08:30', '19:30', '20:00']) assert.equal((await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, time } })).status, 200);
  for (const value of ['yes', 'maybe', 'no']) assert.equal((await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, value } })).status, 200);
  for (const fields of [{ date: '2026-02-29' }, { date: '2026-11-31' }, { date: '2026-1-01' }, { date: 'tomorrow' }, { time: '07:30' }, { time: '20:30' }, { time: '08:15' }, { time: '8:00' }, { time: '' }, { time: 800 }, { value: 'later' }, { note: 'x'.repeat(281) }, { note: [] }]) {
    const result = await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, ...fields } });
    assert.equal(result.status, 400, JSON.stringify(fields));
  }
  assert.equal((await f.request('/availability', { token: a.token, method: 'DELETE', body: { ...day, date: '2026-02-29' } })).body.code, 'invalid_date');
  assert.equal((await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, note: `  ${'x'.repeat(280)}  ` } })).body.note.length, 280);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM availability').get().n, 1);
});

test('availability cascades on leaving, account removal and group removal without stale rejoin answers', async (t) => {
  const f = await fixture(t), a = await f.user('Owner'), b = await f.user('Peer'), group = await f.group(a.token), solo = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const day = { groupId: group.id, date: '2026-11-08', value: 'yes', time: null, note: '' };
  for (const token of [a.token, b.token]) await f.request('/availability', { token, method: 'PUT', body: day });
  await f.request('/availability', { token: a.token, method: 'PUT', body: { ...day, groupId: solo.id } });
  await f.request(`/groups/${group.id}/membership`, { token: b.token, method: 'DELETE' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM availability WHERE user_id=?').get(b.user.id).n, 0);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  assert.equal((await f.request('/state', { token: b.token })).body.availability.length, 1);
  await f.request('/availability', { token: b.token, method: 'PUT', body: day });
  assert.equal((await f.request('/account', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM availability WHERE user_id=?').get(a.user.id).n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM availability WHERE group_id=?').get(solo.id).n, 0);
  assert.deepEqual((await f.request('/state', { token: b.token })).body.availability.map((row) => row.userId), [b.user.id]);
  await f.request(`/groups/${group.id}/membership`, { token: b.token, method: 'DELETE' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM availability').get().n, 0);
});

test('presence preserves manual modes, expires without heartbeat and hides private presence details from peers', async (t) => {
  const f = await fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside'), group = await f.group(a.token);
  assert.deepEqual(a.user.presence, { mode: 'online', status: 'offline' });
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const peerStatus = async () => (await f.request('/state', { token: b.token })).body.groups[0].members.find((member) => member.id === a.user.id).presence;
  assert.equal(await peerStatus(), 'offline');
  assert.equal((await f.request('/presence/heartbeat', { method: 'POST', body: {} })).status, 401);
  assert.equal((await f.request('/presence', { method: 'PATCH', body: { mode: 'away' } })).status, 401);
  for (const mode of ['offline', 'busy', null, [], 1]) assert.equal((await f.request('/presence', { token: a.token, method: 'PATCH', body: { mode } })).body.code, 'invalid_presence');
  const heartbeat = await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: { userId: b.user.id } });
  assert.deepEqual(heartbeat.body.presence, { mode: 'online', status: 'online' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_presence WHERE user_id=?').get(b.user.id).n, 0);
  assert.equal(await peerStatus(), 'online');
  assert.deepEqual((await f.request('/presence', { token: a.token, method: 'PATCH', body: { mode: 'away' } })).body.presence, { mode: 'away', status: 'away' });
  assert.equal(await peerStatus(), 'away');
  const old = Date.now() - 91_000;
  f.db.prepare('UPDATE user_presence SET last_seen_at=? WHERE user_id=?').run(old, a.user.id);
  assert.deepEqual((await f.request('/state', { token: a.token })).body.user.presence, { mode: 'away', status: 'offline' });
  assert.equal(await peerStatus(), 'offline');
  assert.equal(f.db.prepare('SELECT last_seen_at FROM user_presence WHERE user_id=?').get(a.user.id).last_seen_at, old, 'state polling must not revive presence');
  assert.deepEqual((await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} })).body.presence, { mode: 'away', status: 'away' });
  assert.deepEqual((await f.request('/presence', { token: a.token, method: 'PATCH', body: { mode: 'invisible', userId: b.user.id } })).body.presence, { mode: 'invisible', status: 'offline' });
  assert.deepEqual((await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} })).body.presence, { mode: 'invisible', status: 'offline' });
  const privateRow = f.db.prepare('SELECT * FROM user_presence WHERE user_id=?').get(a.user.id);
  assert.equal((await f.request('/presence', { token: a.token, method: 'PATCH', body: { mode: 'invalid' } })).status, 400);
  assert.deepEqual(f.db.prepare('SELECT * FROM user_presence WHERE user_id=?').get(a.user.id), privateRow);
  const peerState = (await f.request('/state', { token: b.token })).body;
  assert.equal(peerState.groups[0].members.find((member) => member.id === a.user.id).presence, 'offline');
  assert.ok(peerState.groups[0].members.every((member) => !('mode' in member) && !('last_seen_at' in member)));
  assert.doesNotMatch(JSON.stringify(peerState), /invisible|last_seen|presence_mode/);
  const outsideState = (await f.request('/state', { token: outsider.token })).body;
  assert.deepEqual(outsideState.groups, []);
  assert.equal(JSON.stringify(outsideState).includes(a.user.id), false);
  assert.equal((await f.request('/account', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_presence WHERE user_id=?').get(a.user.id).n, 0);
});

test('DND is visible to peers and leave or logout goes offline without losing the manual mode', async (t) => {
  const f = await fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), group = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const peerStatus = async () => (await f.request('/state', { token: b.token })).body.groups[0].members.find((member) => member.id === a.user.id).presence;
  assert.equal((await f.request('/presence/leave', { method: 'POST', body: {} })).status, 401);
  const changed = await f.request('/presence', { token: a.token, method: 'PATCH', body: { mode: 'dnd' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.presence, { mode: 'dnd', status: 'dnd' });
  assert.equal(await peerStatus(), 'dnd');
  assert.deepEqual((await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} })).body.presence, { mode: 'dnd', status: 'dnd' });
  const left = await f.request('/presence/leave', { token: a.token, method: 'POST', body: { userId: b.user.id } });
  assert.deepEqual(left.body.presence, { mode: 'dnd', status: 'offline' });
  assert.equal(f.db.prepare('SELECT last_seen_at FROM user_presence WHERE user_id=?').get(a.user.id).last_seen_at, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_presence WHERE user_id=?').get(b.user.id).n, 0);
  assert.equal(await peerStatus(), 'offline');
  assert.deepEqual((await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} })).body.presence, { mode: 'dnd', status: 'dnd' });
  assert.equal(await peerStatus(), 'dnd');
  assert.equal((await f.request('/session', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/state', { token: a.token })).status, 401);
  assert.deepEqual({ ...f.db.prepare('SELECT mode,last_seen_at FROM user_presence WHERE user_id=?').get(a.user.id) }, { mode: 'dnd', last_seen_at: 0 });
  assert.equal(await peerStatus(), 'offline');
});

test('customization is strict, persists partial preferences and shares only avatars with group members', async (t) => {
  const f = await fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside'), group = await f.group(a.token);
  const defaults = { avatar: 'mint', theme: 'meadow', palette: 'sage', tagline: '', defaultView: 'month', reducedMotion: false, compactCalendar: false };
  assert.deepEqual(a.user.customization, defaults);
  assert.equal((await f.request('/profile', { method: 'PATCH', body: { customization: { avatar: 'stone' } } })).status, 401);
  const preferences = { avatar: 'lavender', theme: 'forest', palette: 'cocoa', tagline: '  Private motto  ', defaultView: 'week', reducedMotion: true, compactCalendar: true };
  const changed = await f.request('/profile', { token: a.token, method: 'PATCH', body: { name: 'Ann', locale: 'fr', customization: preferences } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(changed.body.user.customization, { ...preferences, tagline: 'Private motto' });
  const partial = await f.request('/profile', { token: a.token, method: 'PATCH', body: { customization: { palette: 'white', tagline: 'New private motto' } } });
  assert.deepEqual(partial.body.user.customization, { ...preferences, palette: 'white', tagline: 'New private motto' });
  for (const customization of [null, [], 'forest', { avatar: 'https://evil.test/image' }, { theme: 'night' }, { palette: 'black' }, { defaultView: 'year' }, { reducedMotion: 1 }, { compactCalendar: 'true' }, { tagline: 'x'.repeat(81) }, { unknown: true }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    const rejected = await f.request('/profile', { token: a.token, method: 'PATCH', body: { name: 'Must not save', customization } });
    assert.equal(rejected.status, 400, JSON.stringify(customization));
  }
  const own = (await f.request('/state', { token: a.token })).body.user;
  assert.equal(own.name, 'Ann');
  assert.equal(own.locale, 'fr');
  assert.deepEqual(own.customization, partial.body.user.customization);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const peer = (await f.request('/state', { token: b.token })).body;
  const member = peer.groups[0].members.find((item) => item.id === a.user.id);
  assert.equal(member.avatar, 'lavender');
  assert.ok(!('customization' in member) && !('tagline' in member) && !('theme' in member) && !('email' in member));
  assert.doesNotMatch(JSON.stringify(peer), /New private motto|"forest"|"white"/);
  assert.deepEqual(peer.user.customization, defaults);
  assert.deepEqual((await f.request('/state', { token: outsider.token })).body.groups, []);
  await f.request('/account', { token: a.token, method: 'DELETE' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_customization WHERE user_id=?').get(a.user.id).n, 0);
});

test('adding an email creates separate credentials for the same account without changing or merging accounts', async (t) => {
  const f = await fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), group = await f.group(a.token), pass = 'A separate OpenCalendar password';
  await f.event(a.token, group.id);
  const input = { email: ' Anna@Proton.me ', password: pass };
  assert.equal((await f.request('/auth/email/link', { method: 'POST', body: input })).status, 401);
  assert.equal((await f.request('/auth/email/link', { token: a.token, method: 'POST', body: { ...input, email: 'bad' } })).body.code, 'invalid_email');
  assert.equal((await f.request('/auth/email/link', { token: a.token, method: 'POST', body: { ...input, password: 'short' } })).body.code, 'weak_password');
  const linked = await f.request('/auth/email/link', { token: a.token, method: 'POST', body: { ...input, userId: b.user.id } });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.user.id, a.user.id);
  assert.equal(linked.body.user.email, 'anna@proton.me');
  assert.equal(linked.body.user.emailVerified, false);
  const stored = f.db.prepare('SELECT * FROM email_credentials WHERE user_id=?').get(a.user.id);
  assert.notEqual(stored.password_hash, pass);
  assert.ok(stored.salt.length >= 22);
  assert.equal(JSON.parse(stored.parameters).p, 5);
  for (const email of ['anna@proton.me', 'replacement@proton.me']) assert.equal((await f.request('/auth/email/link', { token: a.token, method: 'POST', body: { ...input, email } })).body.code, 'email_already_linked');
  assert.equal((await f.request('/auth/email/link', { token: b.token, method: 'POST', body: { ...input, email: 'ANNA@PROTON.ME' } })).body.code, 'email_exists');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
  const login = await f.request('/auth/email/login', { method: 'POST', body: { email: 'ANNA@PROTON.ME', password: pass } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.id, a.user.id);
  const restored = (await f.request('/state', { token: login.body.token })).body;
  assert.equal(restored.groups[0].id, group.id);
  assert.equal(restored.events.length, 1);
  assert.equal((await f.request('/auth/email/login', { method: 'POST', body: { email: 'anna@proton.me', password: 'wrong password' } })).body.code, 'invalid_credentials');
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const peer = (await f.request('/state', { token: b.token })).body;
  assert.ok(peer.groups[0].members.every((member) => !('email' in member) && !('emailVerified' in member)));
  assert.equal(JSON.stringify(peer).includes('anna@proton.me'), false);
  assert.equal(f.db.prepare('SELECT email FROM email_credentials WHERE user_id=?').get(a.user.id).email, 'anna@proton.me');
  await f.request('/account', { token: a.token, method: 'DELETE' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM email_credentials WHERE user_id=?').get(a.user.id).n, 0);
});

test('presence limits rapid heartbeats per authenticated account', async (t) => {
  const f = await fixture(t), a = await f.user();
  for (let attempt = 0; attempt < 60; attempt++) assert.equal((await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} })).status, 200);
  const rejected = await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.code, 'rate_limited');
});

test('body size and per-process request limits are enforced', async (t) => {
  const f = await fixture(t, { rateLimit: 4 });
  const large = await f.request('/session', { method: 'POST', body: { name: 'a'.repeat(30_000) } });
  assert.equal(large.status, 413);
  for (let i = 0; i < 4; i += 1) assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/health')).status, 429);
});
