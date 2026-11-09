import { createRemoteJWKSet, jwtVerify, decodeJwt, SignJWT, importPKCS8 } from 'jose';
import { bytes, base64url, secret, hash, challenge, safeEqual, passwordHash, passwordParameters, encryptToken, decryptToken } from './crypto.mjs';
import { fail, text, locales, emailAddress, password } from './validation.mjs';
import { desktopCompletion, desktopConfirmation, desktopConfirmPath, desktopConfirmCookie, desktopConfirmCookieName, verificationCode } from './desktop-completion.mjs';

const jwksCache = new Map();
const callbackPath = (provider) => `/api/auth/${provider}/callback`;
const cookieName = (state) => `oc_oauth_${state.slice(0, 12)}`;
const cookieValue = (request, name) => (request.headers.get('Cookie') || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1);
const validChallenge = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && base64url(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))) === value;
const challengeToHex = (value) => [...Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))].map(value => value.toString(16).padStart(2, '0')).join('');
const confirmationLifetime = 300_000;
const confirmationProof = (flowId, code) => hash(`${flowId}:${code}`);
const clearConfirmation = 'verification_hash=NULL,confirm_cookie_hash=NULL,confirm_csrf_hash=NULL,verified_record=NULL';
function desktopPage(page, status = 200, cookies = []) {
  const headers = new Headers(page.headers);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(page.body, { status, headers });
}
function redirect(returnTo, key, value, cookie) {
  const destination = new URL(returnTo);
  destination.hash = new URLSearchParams({ [key]: value }).toString();
  return new Response(null, { status: 303, headers: { Location: destination.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
function configuration(env) {
  const tenant = encodeURIComponent(env.MICROSOFT_TENANT_ID || 'common');
  return {
    google: { clientId: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuer: ['https://accounts.google.com', 'accounts.google.com'] },
    apple: { clientId: env.APPLE_CLIENT_ID, authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', jwks: 'https://appleid.apple.com/auth/keys', issuer: 'https://appleid.apple.com' },
    microsoft: { clientId: env.MICROSOFT_CLIENT_ID, secret: env.MICROSOFT_CLIENT_SECRET, authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, jwks: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys` },
    telegram: { clientId: env.TELEGRAM_CLIENT_ID, secret: env.TELEGRAM_CLIENT_SECRET, authorize: 'https://oauth.telegram.org/auth', token: 'https://oauth.telegram.org/token', jwks: 'https://oauth.telegram.org/.well-known/jwks.json', issuer: 'https://oauth.telegram.org' },
  };
}
function isConfigured(env, id, config) {
  return id === 'apple' ? Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) : Boolean(config.clientId && config.secret);
}
async function appleSecret(env) {
  const key = await importPKCS8(env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID }).setIssuer(env.APPLE_TEAM_ID).setIssuedAt().setExpirationTime('10m').setAudience('https://appleid.apple.com').setSubject(env.APPLE_CLIENT_ID).sign(key);
}
export async function revokeApple(c, userId) {
  const records = await c.all("SELECT * FROM provider_tokens WHERE user_id=? AND provider='apple'", userId);
  for (const record of records) {
    try {
      const body = new URLSearchParams({ client_id: c.env.APPLE_CLIENT_ID, client_secret: await appleSecret(c.env), token: await decryptToken(record.encrypted_token, c.env), token_type_hint: record.token_type });
      const response = await fetch('https://appleid.apple.com/auth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('revocation_failed');
    } catch { throw fail(502, 'provider_revocation_failed'); }
  }
}

export async function handleAuth(c) {
  const { env, request, url, body, ip, publicUrl, json, first, all, run, batch, selectUser, newSession, getUser, limit } = c;
  const path = url.pathname, method = request.method;
  if (!path.startsWith('/api/auth/')) return null;
  const configs = configuration(env);
  const secure = publicUrl.startsWith('https://');
  const provider = (id) => {
    if (!Object.hasOwn(configs, id)) throw fail(404, 'provider_not_found');
    if (!isConfigured(env, id, configs[id])) throw fail(503, 'provider_not_configured');
    return configs[id];
  };
  const desktopProof = async () => {
    await limit(`desktop-status-ip:${ip}`, 240);
    if (!validChallenge(body.pollToken)) throw fail(401, 'invalid_desktop_handoff');
    const pollHash = await hash(body.pollToken);
    const flow = await first('SELECT * FROM oauth_desktop_handoffs WHERE poll_hash=?', pollHash);
    if (!flow) throw fail(401, 'invalid_desktop_handoff');
    const verifier = body.codeVerifier;
    if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(await challenge(verifier), flow.code_challenge)) throw fail(401, 'invalid_exchange_verifier');
    await limit(`desktop-status-flow:${pollHash}`, 60);
    if (flow.expires_at <= Date.now()) throw fail(401, 'oauth_expired');
    return flow;
  };
  const renderConfirmation = async (flow, csrf, error = false) => {
    const record = JSON.parse(flow.verified_record);
    const linkName = flow.user_id ? (await first('SELECT name FROM users WHERE id=?', flow.user_id))?.name : null;
    return desktopConfirmation({ locale: flow.locale, flowId: flow.state_hash, csrf, provider: record.provider, providerName: record.name, linkName, error });
  };
  if (path === desktopConfirmPath && method === 'POST') {
    await limit(`desktop-confirm-ip:${ip}`, 60);
    const origin = request.headers.get('Origin');
    const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    const { flowId, csrf, code, decision } = body;
    const invalid = (locale) => desktopPage(desktopCompletion('error', locale), 400);
    if ((origin && origin !== new URL(publicUrl).origin) || contentType !== 'application/x-www-form-urlencoded'
      || typeof flowId !== 'string' || !/^[a-f0-9]{64}$/.test(flowId) || !validChallenge(csrf)
      || (decision !== 'confirm' && decision !== 'deny')) return invalid();
    const cookie = cookieValue(request, desktopConfirmCookieName(flowId));
    if (!validChallenge(cookie)) return invalid();
    const now = Date.now();
    const [cookieHash, csrfHash] = await Promise.all([hash(cookie), hash(csrf)]);
    const flow = await first("SELECT * FROM oauth_desktop_handoffs WHERE state_hash=? AND status='confirm' AND expires_at>?", flowId, now);
    if (!flow || !safeEqual(cookieHash, flow.confirm_cookie_hash) || !safeEqual(csrfHash, flow.confirm_csrf_hash)) return invalid();
    const guard = "state_hash=? AND status='confirm' AND expires_at>? AND confirm_cookie_hash=? AND confirm_csrf_hash=? AND failed_attempts<5";
    const proof = [flowId, Date.now(), cookieHash, csrfHash];
    const clearCookie = desktopConfirmCookie(flowId, '', secure, 0);
    if (decision === 'deny') {
      const denied = await first(`UPDATE oauth_desktop_handoffs SET status='cancelled',error='authorization_cancelled',${clearConfirmation} WHERE ${guard} RETURNING status`, ...proof);
      return denied ? desktopPage(desktopCompletion('cancelled', flow.locale), 200, [clearCookie]) : invalid(flow.locale);
    }
    const submittedHash = typeof code === 'string' && /^[0-9]{6}$/.test(code) ? await confirmationProof(flowId, code) : '';
    if (!safeEqual(submittedHash, flow.verification_hash)) {
      const updated = await first(`UPDATE oauth_desktop_handoffs SET failed_attempts=failed_attempts+1,
        status=CASE WHEN failed_attempts=4 THEN 'error' ELSE status END,
        error=CASE WHEN failed_attempts=4 THEN 'invalid_desktop_verification_code' ELSE error END,
        verification_hash=CASE WHEN failed_attempts=4 THEN NULL ELSE verification_hash END,
        confirm_cookie_hash=CASE WHEN failed_attempts=4 THEN NULL ELSE confirm_cookie_hash END,
        confirm_csrf_hash=CASE WHEN failed_attempts=4 THEN NULL ELSE confirm_csrf_hash END,
        verified_record=CASE WHEN failed_attempts=4 THEN NULL ELSE verified_record END
        WHERE ${guard} RETURNING *`, ...proof);
      if (updated?.status === 'confirm') return desktopPage(await renderConfirmation(updated, csrf, true), 400);
      return desktopPage(desktopCompletion('error', flow.locale), 400, [clearCookie]);
    }
    const expiresAt = Date.now() + confirmationLifetime;
    // D1 batches are transactional. Once an app cancellation wins, neither
    // the exchange row nor a ready status can be created by this form.
    const [, approved] = await batch([
      [`INSERT INTO oauth_exchanges(code_hash,record,expires_at)
        SELECT poll_hash,verified_record,? FROM oauth_desktop_handoffs WHERE ${guard} AND verification_hash=?`, expiresAt, ...proof, submittedHash],
      [`UPDATE oauth_desktop_handoffs SET status='ready',expires_at=?,${clearConfirmation}
        WHERE ${guard} AND verification_hash=? RETURNING status`, expiresAt, ...proof, submittedHash],
    ]);
    if (!approved?.results?.length) return invalid(flow.locale);
    return desktopPage(desktopCompletion('ready', flow.locale), 200, [clearCookie]);
  }
  if (path === '/api/auth/desktop/status' && method === 'POST') {
    const flow = await desktopProof();
    return json({ status: flow.status, ...(flow.error ? { error: flow.error } : {}), expiresAt: flow.expires_at });
  }
  if (path === '/api/auth/desktop/cancel' && method === 'POST') {
    const flow = await desktopProof();
    await limit(`desktop-cancel:${flow.poll_hash}`, 10);
    // A ready exchange with no exchange row has already been claimed. A
    // cancellation must not report success after that claim won the race.
    await batch([
      [`UPDATE oauth_desktop_handoffs SET status='cancelled',error='authorization_cancelled',${clearConfirmation}
        WHERE poll_hash=? AND state_hash=? AND expires_at>? AND (status IN ('pending','confirm','error','cancelled') OR
        (status='ready' AND EXISTS(SELECT 1 FROM oauth_exchanges WHERE code_hash=? AND json_extract(record,'$.desktopStateHash')=?)))`, flow.poll_hash, flow.state_hash, Date.now(), flow.poll_hash, flow.state_hash],
      ["DELETE FROM oauth_pending WHERE state_hash=? AND EXISTS(SELECT 1 FROM oauth_desktop_handoffs WHERE poll_hash=? AND state_hash=? AND status='cancelled')", flow.state_hash, flow.poll_hash, flow.state_hash],
      ["DELETE FROM oauth_exchanges WHERE code_hash=? AND json_extract(record,'$.desktopStateHash')=? AND EXISTS(SELECT 1 FROM oauth_desktop_handoffs WHERE poll_hash=? AND state_hash=? AND status='cancelled')", flow.poll_hash, flow.state_hash, flow.poll_hash, flow.state_hash],
    ]);
    const saved = await first('SELECT status,expires_at FROM oauth_desktop_handoffs WHERE poll_hash=? AND state_hash=?', flow.poll_hash, flow.state_hash);
    if (saved?.status !== 'cancelled') throw fail(409, 'oauth_already_consumed');
    return json({ status: 'cancelled', expiresAt: saved.expires_at });
  }
  if (path === '/api/auth/providers' && method === 'GET') return json(Object.keys(configs).map((id) => ({ id, configured: isConfigured(env, id, configs[id]) })));
  if (path === '/api/auth/email/link' && method === 'POST') {
    const user = await getUser(request);
    await limit(`email-link-user:${user.id}`, 10, 3_600_000);
    await limit(`email-link-ip:${ip}`, 30, 3_600_000);
    if (await first('SELECT user_id FROM email_credentials WHERE user_id=?', user.id)) throw fail(409, 'email_already_linked');
    const email = emailAddress(body.email), pass = password(body.password, true);
    if (await first('SELECT user_id FROM email_credentials WHERE email=?', email)) throw fail(409, 'email_exists');
    const salt = secret(16), passwordValue = await passwordHash(pass, salt);
    try {
      await run('INSERT INTO email_credentials(email,user_id,password_hash,salt,parameters,verified,created_at) VALUES(?,?,?,?,?,0,?)', email, user.id, passwordValue, salt, JSON.stringify(passwordParameters), Date.now());
    } catch (error) {
      // Both unique constraints remain authoritative when linking requests race.
      if (await first('SELECT user_id FROM email_credentials WHERE user_id=?', user.id)) throw fail(409, 'email_already_linked');
      if (await first('SELECT user_id FROM email_credentials WHERE email=?', email)) throw fail(409, 'email_exists');
      throw error;
    }
    return json({ user: await selectUser(user.id) });
  }
  if (path === '/api/auth/email/register' && method === 'POST') {
    await limit(`email-register:${ip}`, 10, 3_600_000);
    const email = emailAddress(body.email), pass = password(body.password, true), name = text(body.name, 60), locale = body.locale || 'en';
    if (!locales.has(locale)) throw fail(400, 'invalid_locale');
    await limit(`email-register-address:${email}`, 5, 3_600_000);
    if (await first('SELECT user_id FROM email_credentials WHERE email=?', email)) throw fail(409, 'email_exists');
    const id = crypto.randomUUID(), salt = secret(16), passwordValue = await passwordHash(pass, salt);
    try {
      await batch([
        ['INSERT INTO users(id,name,locale,created_at) VALUES(?,?,?,?)', id, name, locale, Date.now()],
        ['INSERT INTO email_credentials(email,user_id,password_hash,salt,parameters,verified,created_at) VALUES(?,?,?,?,?,0,?)', email, id, passwordValue, salt, JSON.stringify(passwordParameters), Date.now()],
      ]);
    } catch (error) {
      // The unique constraint, not the earlier lookup, is authoritative under concurrency.
      if (await first('SELECT user_id FROM email_credentials WHERE email=?', email)) throw fail(409, 'email_exists');
      throw error;
    }
    return json(await newSession(id), 201);
  }
  if (path === '/api/auth/email/login' && method === 'POST') {
    await limit(`email-login:${ip}`, 30, 10 * 60_000);
    const email = emailAddress(body.email), pass = password(body.password);
    await limit(`email-login-address:${email}`, 12, 10 * 60_000);
    const record = await first('SELECT * FROM email_credentials WHERE email=?', email);
    // Unknown email follows the same expensive KDF path; no account-existence timing shortcut.
    const salt = record?.salt || 'AAAAAAAAAAAAAAAAAAAAAA';
    const digest = await passwordHash(pass, salt);
    if (!record || !safeEqual(digest, record.password_hash)) throw fail(401, 'invalid_credentials');
    return json(await newSession(record.user_id));
  }
  let match = path.match(/^\/api\/auth\/(google|apple|microsoft|telegram)\/(start|authorize|callback)$/);
  if (match) {
    const id = match[1], action = match[2], config = provider(id);
    if (action === 'start' && method === 'POST') {
      await limit(`oauth:${ip}`, 15);
      const user = await getUser(request, false);
      const clientUrl = env.CLIENT_URL || publicUrl;
      const nativeUrl = env.NATIVE_REDIRECT_URL || 'space.opencalendar.app://auth';
      const returnTo = body.returnTo || clientUrl;
      const normalize = (value) => { try { return new URL(value).href; } catch { return ''; } };
      if (![normalize(clientUrl), normalize(nativeUrl)].includes(normalize(returnTo))) throw fail(400, 'invalid_return_url');
      const codeChallenge = body.codeChallenge;
      if (!validChallenge(codeChallenge)) throw fail(400, 'invalid_code_challenge');
      const desktop = body.desktopPollHash !== undefined;
      if (desktop && (returnTo !== nativeUrl || !validChallenge(body.desktopPollHash))) throw fail(400, 'invalid_desktop_handoff');
      const locale = desktop ? body.locale || 'en' : 'en';
      if (!locales.has(locale)) throw fail(400, 'invalid_locale');
      const state = secret(), ticket = secret(), stateHash = await hash(state), expiresAt = Date.now() + 600_000;
      const pollHash = desktop ? challengeToHex(body.desktopPollHash) : null;
      const appCode = desktop ? verificationCode() : null;
      await batch([
        ['DELETE FROM oauth_pending WHERE expires_at<?', Date.now()],
        ['DELETE FROM oauth_exchanges WHERE expires_at<?', Date.now()],
        ['DELETE FROM oauth_desktop_handoffs WHERE expires_at<?', Date.now()],
      ]);
      if (pollHash && await first('SELECT 1 FROM oauth_desktop_handoffs WHERE poll_hash=?', pollHash)) throw fail(409, 'desktop_handoff_exists');
      try {
        await batch([
          ['INSERT INTO oauth_pending(state_hash,provider,ticket_hash,user_id,return_to,code_challenge,verifier,nonce,expires_at,desktop_poll_hash) VALUES(?,?,?,?,?,?,?,?,?,?)', stateHash, id, await hash(ticket), user?.id || null, returnTo, codeChallenge, secret() + secret(), secret(), expiresAt, pollHash],
          ...(pollHash ? [["INSERT INTO oauth_desktop_handoffs(poll_hash,state_hash,user_id,code_challenge,locale,status,expires_at,verification_hash) VALUES(?,?,?,?,?,'pending',?,?)", pollHash, stateHash, user?.id || null, codeChallenge, locale, expiresAt, await confirmationProof(stateHash, appCode)]] : []),
        ]);
      } catch (error) {
        if (pollHash && await first('SELECT 1 FROM oauth_desktop_handoffs WHERE poll_hash=?', pollHash)) throw fail(409, 'desktop_handoff_exists');
        throw error;
      }
      return json({ url: `${publicUrl}/api/auth/${id}/authorize?state=${encodeURIComponent(state)}&ticket=${encodeURIComponent(ticket)}`, ...(desktop ? { expiresAt, verificationCode: appCode } : {}) });
    }
    if (action === 'authorize' && method === 'GET') {
      const state = url.searchParams.get('state') || '', ticket = url.searchParams.get('ticket') || '';
      if (state.length > 100 || ticket.length > 100) throw fail(400, 'invalid_oauth_state');
      const browserKey = secret();
      const record = await first('UPDATE oauth_pending SET ticket_hash=NULL,browser_hash=? WHERE state_hash=? AND provider=? AND ticket_hash=? AND expires_at>? RETURNING *', await hash(browserKey), await hash(state), id, await hash(ticket), Date.now());
      if (!record) throw fail(400, 'invalid_oauth_state');
      const destination = new URL(config.authorize);
      for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: `${publicUrl}${callbackPath(id)}`, response_type: 'code', scope: id === 'apple' ? 'name email' : id === 'telegram' ? 'openid profile' : 'openid profile email', state, nonce: record.nonce })) destination.searchParams.set(key, value);
      if (id === 'apple') destination.searchParams.set('response_mode', 'form_post');
      else { destination.searchParams.set('code_challenge', await challenge(record.verifier)); destination.searchParams.set('code_challenge_method', 'S256'); }
      const cookie = `${cookieName(state)}=${browserKey}; Path=${callbackPath(id)}; Max-Age=600; HttpOnly; SameSite=${secure ? 'None; Secure' : 'Lax'}`;
      return new Response(null, { status: 303, headers: { Location: destination.href, 'Set-Cookie': cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    if (action === 'callback' && (method === 'GET' || (method === 'POST' && id === 'apple'))) {
      const values = method === 'POST' ? body : Object.fromEntries(url.searchParams);
      const state = typeof values.state === 'string' && values.state.length < 100 ? values.state : '';
      const browserHash = await hash(cookieValue(request, cookieName(state)) || '');
      const pending = await first('DELETE FROM oauth_pending WHERE state_hash=? AND provider=? AND browser_hash=? AND expires_at>? RETURNING *', await hash(state), id, browserHash, Date.now());
      if (!pending) throw fail(400, 'invalid_oauth_state');
      const clearedCookie = `${cookieName(state)}=; Path=${callbackPath(id)}; Max-Age=0; HttpOnly; SameSite=${secure ? 'None; Secure' : 'Lax'}`;
      const finishError = async (error) => {
        if (!pending.desktop_poll_hash) return redirect(pending.return_to, 'auth_error', error, clearedCookie);
        const status = error === 'authorization_cancelled' ? 'cancelled' : 'error';
        await run(`UPDATE oauth_desktop_handoffs SET status=?,error=?,${clearConfirmation} WHERE poll_hash=? AND state_hash=? AND status='pending'`, status, error, pending.desktop_poll_hash, pending.state_hash);
        const flow = await first('SELECT status,locale FROM oauth_desktop_handoffs WHERE poll_hash=? AND state_hash=?', pending.desktop_poll_hash, pending.state_hash);
        return desktopPage(desktopCompletion(flow?.status === 'cancelled' ? 'cancelled' : 'error', flow?.locale), 200, [clearedCookie]);
      };
      if (values.error) return finishError('authorization_cancelled');
      try {
        if (typeof values.code !== 'string' || values.code.length > 4096) throw fail(400, 'invalid_oauth_code');
        const payload = new URLSearchParams({ grant_type: 'authorization_code', code: values.code, client_id: config.clientId, redirect_uri: `${publicUrl}${callbackPath(id)}` });
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (id === 'telegram') headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.secret}`)}`;
        else payload.set('client_secret', id === 'apple' ? await appleSecret(env) : config.secret);
        if (id !== 'apple') payload.set('code_verifier', pending.verifier);
        const tokenResponse = await fetch(config.token, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(15_000) });
        if (!tokenResponse.ok) throw fail(401, 'oauth_exchange_failed');
        const tokens = await tokenResponse.json();
        if (typeof tokens.id_token !== 'string') throw fail(401, 'invalid_identity_token');
        if (!jwksCache.has(config.jwks)) jwksCache.set(config.jwks, createRemoteJWKSet(new URL(config.jwks)));
        let issuer = config.issuer;
        if (id === 'microsoft') {
          const unverified = decodeJwt(tokens.id_token);
          if (typeof unverified.tid !== 'string' || !/^[a-f0-9-]{36}$/i.test(unverified.tid)) throw fail(401, 'invalid_identity_token');
          const tenant = env.MICROSOFT_TENANT_ID || 'common';
          if (!['common', 'organizations', 'consumers'].includes(tenant) && tenant.toLowerCase() !== unverified.tid.toLowerCase()) throw fail(401, 'invalid_tenant');
          issuer = `https://login.microsoftonline.com/${unverified.tid}/v2.0`;
        }
        const { payload: claims } = await jwtVerify(tokens.id_token, jwksCache.get(config.jwks), { algorithms: ['RS256'], audience: config.clientId, issuer, requiredClaims: ['exp', 'iat', 'sub', 'nonce'] });
        if (!safeEqual(claims.nonce, pending.nonce) || typeof claims.sub !== 'string') throw fail(401, 'invalid_identity_token');
        const subject = id === 'microsoft' ? `${claims.tid}:${claims.sub}` : claims.sub;
        const existing = await first('SELECT user_id FROM identities WHERE provider=? AND subject=?', id, subject);
        if (pending.user_id && !await selectUser(pending.user_id)) throw fail(401, 'unauthorized');
        if (existing && pending.user_id && existing.user_id !== pending.user_id) throw fail(409, 'identity_already_linked');
        let name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 60) : id === 'apple' ? 'Apple user' : id === 'telegram' ? 'Telegram user' : 'Calendar user';
        if (id === 'apple' && typeof values.user === 'string') { try { const info = JSON.parse(values.user); const fullName = [info.name?.firstName, info.name?.lastName].filter((v) => typeof v === 'string').join(' ').trim(); if (fullName) name = fullName.slice(0, 60); } catch { /* name is optional */ } }
        const username = typeof claims.preferred_username === 'string' ? claims.preferred_username.slice(0, 64) : typeof claims.username === 'string' ? claims.username.slice(0, 64) : null;
        let appleToken;
        if (id === 'apple') {
          const token = tokens.refresh_token || tokens.access_token;
          if (typeof token !== 'string') throw fail(401, 'missing_revocation_token');
          appleToken = { encrypted: await encryptToken(token, env), type: tokens.refresh_token ? 'refresh_token' : 'access_token' };
        }
        const record = { provider: id, subject, name, username, appleToken, linkUserId: pending.user_id, codeChallenge: pending.code_challenge };
        if (pending.desktop_poll_hash) {
          // The provider has authenticated the browser. The person in that
          // browser still needs to prove possession of the initiating app.
          const cookie = secret(), csrf = secret(), now = Date.now();
          const flow = await first(`UPDATE oauth_desktop_handoffs SET status='confirm',expires_at=?,confirm_cookie_hash=?,confirm_csrf_hash=?,verified_record=?
            WHERE poll_hash=? AND state_hash=? AND status='pending' AND expires_at>? RETURNING *`,
          now + confirmationLifetime, await hash(cookie), await hash(csrf), JSON.stringify({ ...record, desktopStateHash: pending.state_hash }), pending.desktop_poll_hash, pending.state_hash, now);
          if (!flow) return finishError('oauth_expired');
          return desktopPage(await renderConfirmation(flow, csrf), 200, [clearedCookie, desktopConfirmCookie(flow.state_hash, cookie, secure)]);
        }
        const code = secret();
        await run('INSERT INTO oauth_exchanges(code_hash,record,expires_at) VALUES(?,?,?)', await hash(code), JSON.stringify(record), Date.now() + 60_000);
        // No account is created or linked until the initiating app proves its verifier.
        return redirect(pending.return_to, 'auth_code', code, clearedCookie);
      } catch (error) {
        return finishError(typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'authentication_failed');
      }
    }
  }
  if (path === '/api/auth/exchange' && method === 'POST') {
    await limit(`exchange:${ip}`, 30);
    const key = await hash(text(body.code, 200));
    const value = await first('SELECT * FROM oauth_exchanges WHERE code_hash=? AND expires_at>?', key, Date.now());
    if (!value) throw fail(401, 'invalid_exchange_code');
    const record = JSON.parse(value.record), verifier = body.codeVerifier;
    if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(await challenge(verifier), record.codeChallenge)) throw fail(401, 'invalid_exchange_verifier');
    const claimed = await first('DELETE FROM oauth_exchanges WHERE code_hash=? AND record=? AND expires_at>? RETURNING code_hash', key, value.record, Date.now());
    if (!claimed) throw fail(401, 'invalid_exchange_code');
    let existing = await first('SELECT user_id FROM identities WHERE provider=? AND subject=?', record.provider, record.subject);
    if (record.linkUserId && !await selectUser(record.linkUserId)) throw fail(401, 'unauthorized');
    if (existing && record.linkUserId && existing.user_id !== record.linkUserId) throw fail(409, 'identity_already_linked');
    const proposed = existing?.user_id || record.linkUserId || crypto.randomUUID();
    const commands = [];
    if (!existing && !record.linkUserId) commands.push(['INSERT INTO users(id,name,locale,username,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM identities WHERE provider=? AND subject=?)', proposed, record.name, 'en', record.username, Date.now(), record.provider, record.subject]);
    if (!existing) commands.push(['INSERT INTO identities(provider,subject,user_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) ON CONFLICT(provider,subject) DO NOTHING', record.provider, record.subject, proposed, proposed]);
    if (commands.length) await batch(commands);
    existing = await first('SELECT user_id FROM identities WHERE provider=? AND subject=?', record.provider, record.subject);
    if (!existing) throw fail(401, 'invalid_exchange_code');
    if (record.linkUserId && existing.user_id !== record.linkUserId) throw fail(409, 'identity_already_linked');
    if (record.appleToken) await run('INSERT INTO provider_tokens(provider,subject,user_id,encrypted_token,token_type) VALUES(?,?,?,?,?) ON CONFLICT(provider,subject) DO UPDATE SET user_id=excluded.user_id,encrypted_token=excluded.encrypted_token,token_type=excluded.token_type', record.provider, record.subject, existing.user_id, record.appleToken.encrypted, record.appleToken.type);
    return json(await newSession(existing.user_id));
  }
  return null;
}
