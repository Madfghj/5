import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHandler } from '../cloud/index.mjs';

function d1Adapter(db) {
  const prepared = (sql, args = []) => ({
    bind(...values) { return prepared(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { success: true, results: db.prepare(sql).all(...args), meta: {} }; },
    async run() { const result = db.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    _execute() { if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return { success: true, results: db.prepare(sql).all(...args), meta: {} }; const result = db.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
  });
  return { prepare: (sql) => prepared(sql), async batch(statements) { db.exec('BEGIN IMMEDIATE'); try { const results = statements.map((s) => s._execute()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
function fixture(t, extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../drizzle/0001_availability.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../drizzle/0002_presence.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../drizzle/0003_customization.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  const env = { DB: d1Adapter(db), PUBLIC_URL: 'https://calendar.test', CLIENT_URL: 'https://calendar.test', ...extra };
  let handler = createHandler(env);
  const request = async (path, { token, method = 'GET', body, headers = {}, raw } = {}) => {
    const req = new Request(`https://calendar.test/api${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : raw !== undefined ? { body: raw } : {}) });
    const response = await handler(req);
    const result = await response.text();
    let value;
    try { value = JSON.parse(result); } catch { value = result; }
    return { status: response.status, body: value, headers: response.headers };
  };
  const user = async (name = 'Guest', locale = 'en') => { const value = await request('/session', { method: 'POST', body: { name, locale } }); assert.equal(value.status, 201, JSON.stringify(value.body)); return value.body; };
  const group = async (token) => { const value = await request('/groups', { token, method: 'POST', body: { name: 'Our group', emoji: '🌿', color: '#729b75' } }); assert.equal(value.status, 201, JSON.stringify(value.body)); return value.body; };
  const event = async (token, groupId, fields = {}) => request('/events', { token, method: 'POST', body: { groupId, title: 'A meeting', date: '2026-11-07', startTime: '08:30', endTime: '09:00', location: 'Here', notes: '', ...fields } });
  return { db, env, request, user, group, event, restart: () => { handler = createHandler(env); } };
}

test('desktop CORS admits the exact Tauri origin without granting hostile or opaque origins', async (t) => {
  const f = fixture(t);
  const allowed = await f.request('/state', { headers: { Origin: 'tauri://localhost' } });
  assert.equal(allowed.status, 401, 'CORS must not replace account authentication');
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost');
  const preflight = await f.request('/state', { method: 'OPTIONS', headers: { Origin: 'tauri://localhost', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  for (const origin of ['null', 'tauri://localhost.evil.example', 'https://evil.example']) {
    const denied = await f.request('/health', { headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('cloud guest profile, hashed sessions, expiry, and logout persist across handler instances', async (t) => {
  const f = fixture(t);
  assert.equal((await f.request('/health')).body.liveMode, 'polling');
  const a = await f.user('Anna');
  assert.equal(a.user.locale, 'en');
  assert.deepEqual(a.user.connectedProviders, []);
  assert.notEqual(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash, a.token);
  f.restart();
  assert.equal((await f.request('/state', { token: a.token })).body.user.name, 'Anna');
  assert.equal((await f.request('/live', { token: a.token })).body.code, 'live_polling');
  assert.equal((await f.request('/session', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/state', { token: a.token })).status, 401);
  const b = await f.user('Ben');
  f.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(b.user.id);
  assert.equal((await f.request('/state', { token: b.token })).status, 401);
});

test('cloud groups authorize members, preserve all three answers and reveal participant names without emails', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), stranger = await f.user('Outside');
  const group = await f.group(a.token), event = await f.event(a.token, group.id);
  assert.equal(event.status, 201);
  assert.equal((await f.request(`/events/${event.body.id}/response`, { token: b.token, method: 'PUT', body: { value: 'yes' } })).status, 404);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode.toLowerCase() } });
  for (const value of ['yes', 'no', 'maybe']) {
    const answer = await f.request(`/events/${event.body.id}/response`, { token: b.token, method: 'PUT', body: { value } });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.responses[b.user.id], value);
  }
  assert.equal((await f.request(`/events/${event.body.id}/response`, { token: b.token, method: 'PUT', body: { value: 'other' } })).status, 400);
  f.restart();
  const state = (await f.request('/state', { token: a.token })).body;
  assert.deepEqual(state.groups[0].members.map((m) => m.name).sort(), ['Anna', 'Ben']);
  assert.equal(state.groups[0].members.some((m) => 'email' in m), false);
  assert.equal(state.events[0].responses[b.user.id], 'maybe');
  assert.equal((await f.request('/state', { token: stranger.token })).body.events.length, 0);
  assert.equal((await f.request('/groups/join', { token: stranger.token, method: 'POST', body: { code: '0123456789AB' } })).status, 404);
});

test('cloud validates half-hour boundaries, real dates, colors and event edit authorization', async (t) => {
  const f = fixture(t), owner = await f.user(), member = await f.user('Member'), group = await f.group(owner.token);
  await f.request('/groups/join', { token: member.token, method: 'POST', body: { code: group.inviteCode } });
  const event = await f.event(owner.token, group.id);
  assert.equal((await f.event(owner.token, group.id, { startTime: '19:30', endTime: '20:00', date: '2028-02-29' })).status, 201);
  for (const fields of [{ startTime: '07:30' }, { startTime: '08:15' }, { endTime: '20:30' }, { endTime: '08:30' }, { date: '2026-02-29' }, { date: '2026-11-31' }]) assert.equal((await f.event(owner.token, group.id, fields)).status, 400);
  assert.equal((await f.request('/groups', { token: owner.token, method: 'POST', body: { name: 'x', color: 'red;url(x)' } })).status, 400);
  assert.equal((await f.request(`/events/${event.body.id}`, { token: member.token, method: 'PATCH', body: { title: 'Illegal' } })).status, 403);
  assert.equal((await f.request(`/events/${event.body.id}`, { token: owner.token, method: 'PATCH', body: { groupId: 'different' } })).body.code, 'cannot_move_event');
  const theirs = await f.event(member.token, group.id);
  assert.equal((await f.request(`/events/${theirs.body.id}`, { token: owner.token, method: 'PATCH', body: { title: 'Moderated' } })).body.title, 'Moderated');
});

test('cloud contact links are optional, validated and scoped to authorized group members', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), group = await f.group(a.token);
  const contacts = { telegram: 'https://t.me/anna', whatsapp: 'https://wa.me/AnnaUser', signal: 'https://signal.me/#eu/SecretContact' };
  const changed = await f.request('/profile', { token: a.token, method: 'PATCH', body: { name: 'Ann', username: 'ann', contacts } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.contacts.signal, contacts.signal);
  for (const value of ['javascript:alert(1)', 'https://t.me.evil.test/anna', 'https://user@t.me/anna', 'http://t.me/anna']) assert.equal((await f.request('/profile', { token: a.token, method: 'PATCH', body: { contacts: { telegram: value } } })).body.code, 'invalid_contact');
  assert.equal((await f.request('/state', { token: b.token })).body.groups.length, 0);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const people = (await f.request('/state', { token: b.token })).body.groups[0].members;
  assert.equal(people.find((p) => p.id === a.user.id).contacts.signal, contacts.signal);
  await f.request('/profile', { token: a.token, method: 'PATCH', body: { contacts: { signal: '' } } });
  assert.equal('signal' in (await f.request('/state', { token: a.token })).body.user.contacts, false);
});

test('cloud leaving removes access and responses, transfers group ownership and deletes empty groups', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), group = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  const event = (await f.event(a.token, group.id)).body;
  await f.request(`/events/${event.id}/response`, { token: a.token, method: 'PUT', body: { value: 'yes' } });
  assert.equal((await f.request(`/groups/${group.id}/membership`, { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/state', { token: a.token })).body.groups.length, 0);
  const state = (await f.request('/state', { token: b.token })).body;
  assert.equal(state.groups[0].createdBy, b.user.id);
  assert.deepEqual(state.events[0].responses, {});
  await f.request(`/groups/${group.id}/membership`, { token: b.token, method: 'DELETE' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM groups').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
});

test('cloud email registration uses salted scrypt, case-insensitive uniqueness, durable login and explicit unverified status', async (t) => {
  const f = fixture(t), pass = 'A correct horse battery staple';
  assert.equal((await f.request('/auth/email/register', { method: 'POST', body: { name: 'A', email: 'bad', password: pass } })).body.code, 'invalid_email');
  assert.equal((await f.request('/auth/email/register', { method: 'POST', body: { name: 'A', email: 'a@example.test', password: 'short' } })).body.code, 'weak_password');
  const signup = await f.request('/auth/email/register', { method: 'POST', body: { name: 'Email Anna', email: ' Anna@Example.test ', password: pass, locale: 'de' } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.equal(signup.body.user.email, 'anna@example.test');
  assert.equal(signup.body.user.emailVerified, false);
  const stored = f.db.prepare('SELECT * FROM email_credentials').get();
  assert.notEqual(stored.password_hash, pass);
  assert.ok(stored.salt.length >= 22);
  assert.equal(JSON.parse(stored.parameters).p, 5);
  assert.equal((await f.request('/auth/email/register', { method: 'POST', body: { name: 'Other', email: 'ANNA@example.test', password: pass } })).body.code, 'email_exists');
  f.restart();
  const login = await f.request('/auth/email/login', { method: 'POST', body: { email: 'ANNA@EXAMPLE.TEST', password: pass } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.id, signup.body.user.id);
  for (const [email, password] of [['anna@example.test', 'wrong password'], ['missing@example.test', pass]]) assert.equal((await f.request('/auth/email/login', { method: 'POST', body: { email, password } })).body.code, 'invalid_credentials');
});

test('cloud account deletion removes personal credentials and authored events while preserving peers', async (t) => {
  const f = fixture(t), a = await f.user('A'), b = await f.user('B'), group = await f.group(a.token);
  await f.request('/groups/join', { token: b.token, method: 'POST', body: { code: group.inviteCode } });
  await f.event(a.token, group.id);
  const bEvent = await f.event(b.token, group.id);
  assert.equal((await f.request('/account', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/state', { token: a.token })).status, 401);
  const state = (await f.request('/state', { token: b.token })).body;
  assert.equal(state.groups[0].createdBy, b.user.id);
  assert.deepEqual(state.events.map((e) => e.id), [bEvent.body.id]);
});

test('cloud OAuth flags, persistent tickets, app PKCE and browser binding reject forged sign-ins', async (t) => {
  const f = fixture(t, { TELEGRAM_CLIENT_ID: '12345', TELEGRAM_CLIENT_SECRET: 'test-secret' });
  const providers = (await f.request('/auth/providers')).body;
  assert.equal(providers.find((p) => p.id === 'telegram').configured, true);
  assert.equal(providers.find((p) => p.id === 'google').configured, false);
  assert.equal((await f.request('/auth/google/start', { method: 'POST', body: {} })).body.code, 'provider_not_configured');
  const verifier = randomBytes(32).toString('base64url'), codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal((await f.request('/auth/telegram/start', { method: 'POST', body: { codeChallenge, returnTo: 'https://evil.test' } })).body.code, 'invalid_return_url');
  assert.equal((await f.request('/auth/telegram/start', { method: 'POST', body: { codeChallenge: 'bad' } })).body.code, 'invalid_code_challenge');
  const started = await f.request('/auth/telegram/start', { method: 'POST', body: { codeChallenge } });
  const target = new URL(started.body.url);
  f.restart();
  const opened = await f.request(`${target.pathname.slice(4)}${target.search}`);
  assert.equal(opened.status, 303);
  const authorize = new URL(opened.headers.get('Location'));
  assert.equal(authorize.origin, 'https://oauth.telegram.org');
  assert.equal(authorize.searchParams.get('scope'), 'openid profile');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await f.request(`${target.pathname.slice(4)}${target.search}`)).body.code, 'invalid_oauth_state');
  const callback = `/auth/telegram/callback?state=${authorize.searchParams.get('state')}&code=anything`;
  assert.equal((await f.request(callback)).body.code, 'invalid_oauth_state');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identities').get().n, 0);
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code: 'fabricated', codeVerifier: verifier } })).body.code, 'invalid_exchange_code');
});

test('cloud real signed OIDC claims require the original app verifier before an identity is linked', async (t) => {
  const f = fixture(t, { GOOGLE_CLIENT_ID: 'our-google-client', GOOGLE_CLIENT_SECRET: 'test-secret' });
  const signup = await f.request('/auth/email/register', { method: 'POST', body: { name: 'Link me', email: 'original@example.test', password: 'A correct horse battery staple', locale: 'de' } });
  assert.equal(signup.status, 201);
  const a = signup.body;
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'cloud-test'; jwk.alg = 'RS256';
  const verifier = randomBytes(32).toString('base64url'), codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const start = await f.request('/auth/google/start', { token: a.token, method: 'POST', body: { codeChallenge } });
  const target = new URL(start.body.url), opened = await f.request(`${target.pathname.slice(4)}${target.search}`);
  const auth = new URL(opened.headers.get('Location'));
  const state = auth.searchParams.get('state'), nonce = auth.searchParams.get('nonce');
  const idToken = await new SignJWT({ nonce, name: 'Remote name', email: 'google-private@example.test', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'cloud-test' }).setSubject('google-person').setIssuer('https://accounts.google.com').setAudience('our-google-client').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: idToken });
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    return realFetch(input, init);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const cookie = opened.headers.get('Set-Cookie').split(';')[0];
  const callback = await f.request(`/auth/google/callback?state=${state}&code=provider-code`, { headers: { Cookie: cookie } });
  assert.equal(callback.status, 303, JSON.stringify(callback.body));
  const code = new URLSearchParams(new URL(callback.headers.get('Location')).hash.slice(1)).get('auth_code');
  assert.ok(code, callback.headers.get('Location'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identities').get().n, 0);
  f.restart();
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: 'wrong'.repeat(10) } })).body.code, 'invalid_exchange_verifier');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identities').get().n, 0);
  const exchange = await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: verifier } });
  assert.equal(exchange.status, 200, JSON.stringify(exchange.body));
  assert.equal(exchange.body.user.id, a.user.id);
  assert.deepEqual(exchange.body.user.connectedProviders, ['google']);
  assert.equal(exchange.body.user.email, 'original@example.test');
  assert.equal(exchange.body.user.emailVerified, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identities').get().n, 1);
  assert.equal((await f.request('/auth/exchange', { method: 'POST', body: { code, codeVerifier: verifier } })).body.code, 'invalid_exchange_code');
  // Multiple linked subjects still reveal only a deduplicated social-provider list to the owner.
  f.db.prepare('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)').run('google', 'second-private-subject', a.user.id);
  f.db.prepare('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)').run('internal', 'private-internal-id', a.user.id);
  const ownState = (await f.request('/state', { token: a.token })).body;
  assert.deepEqual(ownState.user.connectedProviders, ['google']);
  assert.equal(ownState.user.locale, 'de');
  assert.equal(ownState.user.name, 'Link me');
  const profile = await f.request('/profile', { token: a.token, method: 'PATCH', body: { name: 'Still me' } });
  assert.deepEqual(profile.body.user.connectedProviders, ['google']);
  const peer = await f.user('Peer'), group = await f.group(a.token);
  await f.request('/groups/join', { token: peer.token, method: 'POST', body: { code: group.inviteCode } });
  const peerState = (await f.request('/state', { token: peer.token })).body;
  assert.deepEqual(peerState.user.connectedProviders, []);
  assert.ok(peerState.groups[0].members.every((member) => !('connectedProviders' in member) && !('subject' in member) && !('email' in member)));
  assert.doesNotMatch(JSON.stringify(peerState), /google|private-subject|private-internal-id|example\.test/);
});

test('cloud day availability is member-only, attributed from the bearer and upserted per person and day', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside'), group = await f.group(a.token);
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
  f.restart();
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

test('cloud day availability validates real dates, half-hour optional times, three values and short notes', async (t) => {
  const f = fixture(t), a = await f.user(), group = await f.group(a.token);
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

test('cloud availability cascades on leaving, account removal and group removal without stale rejoin answers', async (t) => {
  const f = fixture(t), a = await f.user('Owner'), b = await f.user('Peer'), group = await f.group(a.token), solo = await f.group(a.token);
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

test('cloud presence preserves manual modes, expires without heartbeat and hides private presence details from peers', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside'), group = await f.group(a.token);
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
  assert.ok(peerState.groups[0].members.every((member) => !('mode' in member) && !('last_seen_at' in member) && !('email' in member)));
  assert.doesNotMatch(JSON.stringify(peerState), /invisible|last_seen|presence_mode/);
  const outsideState = (await f.request('/state', { token: outsider.token })).body;
  assert.deepEqual(outsideState.groups, []);
  assert.equal(JSON.stringify(outsideState).includes(a.user.id), false);
  f.restart();
  assert.deepEqual((await f.request('/state', { token: a.token })).body.user.presence, { mode: 'invisible', status: 'offline' });
  assert.equal((await f.request('/account', { token: a.token, method: 'DELETE' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_presence WHERE user_id=?').get(a.user.id).n, 0);
});

test('cloud DND is visible to peers and leave or logout goes offline without losing the manual mode', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), group = await f.group(a.token);
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

test('cloud customization is strict, persists partial preferences and shares only avatars with group members', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), outsider = await f.user('Outside'), group = await f.group(a.token);
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
  f.restart();
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

test('cloud adding an email creates separate credentials for the same account without changing or merging accounts', async (t) => {
  const f = fixture(t), a = await f.user('Anna'), b = await f.user('Ben'), group = await f.group(a.token), pass = 'A separate OpenCalendar password';
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
  f.restart();
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

test('cloud presence limits rapid heartbeats per authenticated account', async (t) => {
  const f = fixture(t), a = await f.user();
  for (let attempt = 0; attempt < 60; attempt++) assert.equal((await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} })).status, 200);
  const rejected = await f.request('/presence/heartbeat', { token: a.token, method: 'POST', body: {} });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.code, 'rate_limited');
});

test('cloud CORS, Apple callback exception, body bounds and database-backed rate limits are enforced', async (t) => {
  const f = fixture(t, { RATE_LIMIT_PER_MINUTE: '15' });
  assert.equal((await f.request('/health', { headers: { Origin: 'https://evil.test' } })).body.code, 'invalid_origin');
  assert.equal((await f.request('/health', { headers: { Origin: 'https://calendar.test' } })).headers.get('Access-Control-Allow-Origin'), 'https://calendar.test');
  assert.equal((await f.request('/session', { method: 'POST', raw: 'a'.repeat(25 * 1024) })).status, 413);
  // The Apple form reaches provider/state validation rather than generic CORS denial.
  const apple = await f.request('/auth/apple/callback', { method: 'POST', body: { state: 'bad' }, headers: { Origin: 'https://appleid.apple.com' } });
  assert.equal(apple.body.code, 'provider_not_configured');
  assert.equal((await f.request('/auth/email/register', { method: 'POST', body: {}, headers: { Origin: 'https://appleid.apple.com' } })).body.code, 'invalid_origin');
  for (let i = 0; i < 20; i++) await f.request('/health');
  f.restart();
  assert.equal((await f.request('/health')).status, 429);
  assert.ok(f.db.prepare('SELECT COUNT(*) n FROM rate_limits').get().n > 0);
});
