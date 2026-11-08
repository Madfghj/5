import { assetResponse } from './assets.generated.mjs';
import { handleAuth, revokeApple } from './auth.mjs';
import { hash, secret } from './crypto.mjs';
import { customizationShape, customizationInput, customizationCommand } from './customization.mjs';
import { fail, text, locales, responses, colors, eventInput, contactLinks, availabilityInput, validDate } from './validation.mjs';

const DAY = 86_400_000;
const presenceModes = new Set(['online', 'away', 'dnd', 'invisible']);
const presenceStatus = (row) => row.presence_mode === 'invisible' || !Number.isFinite(row.last_seen_at) || Date.now() - row.last_seen_at > 90_000 ? 'offline' : row.presence_mode === 'away' || row.presence_mode === 'dnd' ? row.presence_mode : 'online';
const ownPresence = (row) => ({ mode: row.presence_mode || 'online', status: presenceStatus(row) });
const publicUserQuery = 'SELECT u.id,u.name,u.locale,u.username,u.contacts,e.email,e.verified,p.mode AS presence_mode,p.last_seen_at,c.avatar,c.theme,c.palette,c.tagline,c.default_view,c.reduced_motion,c.compact_calendar FROM users u LEFT JOIN email_credentials e ON e.user_id=u.id LEFT JOIN user_presence p ON p.user_id=u.id LEFT JOIN user_customization c ON c.user_id=u.id WHERE u.id=?';
function userShape(row) {
  if (!row) return null;
  let contacts = {};
  try { contacts = JSON.parse(row.contacts || '{}'); } catch { /* old malformed profile cannot expose markup */ }
  return { id: row.id, name: row.name, locale: row.locale, contacts, presence: ownPresence(row), customization: customizationShape(row), ...(row.username ? { username: row.username } : {}), ...(row.email ? { email: row.email, emailVerified: Boolean(row.verified) } : {}) };
}
function memberShape(row) {
  let contacts = {};
  try { contacts = JSON.parse(row.contacts || '{}'); } catch { /* no contacts */ }
  return { id: row.id, name: row.name, avatar: row.avatar || 'mint', ...(row.username ? { username: row.username } : {}), contacts, presence: presenceStatus(row) };
}
const plainGroup = (row, people) => ({ id: row.id, name: row.name, emoji: row.emoji, color: row.color, inviteCode: row.invite_code, createdBy: row.created_by, members: people, memberCount: people.length });
const plainEvent = (row, values) => ({ id: row.id, groupId: row.group_id, title: row.title, date: row.date, startTime: row.start_time, endTime: row.end_time, location: row.location, notes: row.notes, createdBy: row.created_by, responses: values });
const plainAvailability = (row) => ({ groupId: row.group_id, userId: row.user_id, date: row.date, value: row.value, time: row.time, note: row.note, updatedAt: row.updated_at });
async function readBody(request) {
  if (['GET', 'HEAD'].includes(request.method)) return {};
  if (Number(request.headers.get('Content-Length')) > 24 * 1024) throw fail(413, 'request_too_large');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const pieces = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 24 * 1024) { await reader.cancel(); throw fail(413, 'request_too_large'); }
    pieces.push(value);
  }
  const data = new Uint8Array(length); let at = 0;
  for (const piece of pieces) { data.set(piece, at); at += piece.length; }
  const source = new TextDecoder().decode(data);
  if (!source) return {};
  if ((request.headers.get('Content-Type') || '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(source));
  let body;
  try { body = JSON.parse(source); } catch { throw fail(400, 'invalid_input'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'invalid_input');
  return body;
}

export function createHandler(env) {
  if (!env.DB) throw new Error('D1 binding DB is required');
  const db = env.DB;
  const statement = (sql, ...args) => db.prepare(sql).bind(...args);
  const first = (sql, ...args) => statement(sql, ...args).first();
  const all = async (sql, ...args) => (await statement(sql, ...args).all()).results || [];
  const run = (sql, ...args) => statement(sql, ...args).run();
  const batch = (commands) => db.batch(commands.map(([sql, ...args]) => statement(sql, ...args)));
  const selectUser = async (id) => {
    const user = userShape(await first(publicUserQuery, id));
    if (!user) return null;
    const identities = await all("SELECT DISTINCT provider FROM identities WHERE user_id=? AND provider IN ('apple','google','microsoft','telegram') ORDER BY provider", id);
    return { ...user, connectedProviders: identities.map((identity) => identity.provider) };
  };
  const newSession = async (id) => {
    const token = secret();
    await run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', await hash(token), id, Date.now() + 30 * DAY);
    return { token, user: await selectUser(id) };
  };
  const limit = async (key, max, duration = 60_000) => {
    const now = Date.now();
    const row = await first('INSERT INTO rate_limits(key_hash,count,reset_at) VALUES(?,1,?) ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count', await hash(key), now + duration, now, now);
    if (row.count > max) throw fail(429, 'rate_limited');
  };
  const getUser = async (request, required = true) => {
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const record = token && token.length < 200 ? await first('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?', await hash(token), Date.now()) : null;
    const user = record ? await selectUser(record.user_id) : null;
    if (!user && required) throw fail(401, 'unauthorized');
    return user;
  };
  const members = async (id) => (await all('SELECT u.id,u.name,u.username,u.contacts,p.mode AS presence_mode,p.last_seen_at,c.avatar FROM members m JOIN users u ON u.id=m.user_id LEFT JOIN user_presence p ON p.user_id=u.id LEFT JOIN user_customization c ON c.user_id=u.id WHERE m.group_id=? ORDER BY m.joined_at,u.id', id)).map(memberShape);
  const groupShape = async (row) => {
    const people = await members(row.id);
    return plainGroup(row, people);
  };
  const eventShape = async (row) => ({ id: row.id, groupId: row.group_id, title: row.title, date: row.date, startTime: row.start_time, endTime: row.end_time, location: row.location, notes: row.notes, createdBy: row.created_by, responses: Object.fromEntries((await all('SELECT r.user_id,r.value FROM responses r JOIN members m ON m.user_id=r.user_id JOIN events e ON e.group_id=m.group_id AND e.id=r.event_id WHERE r.event_id=?', row.id)).map((v) => [v.user_id, v.value])) });
  const ensureGroup = async (id, userId) => {
    const row = await first('SELECT g.* FROM groups g JOIN members m ON m.group_id=g.id WHERE g.id=? AND m.user_id=?', id, userId);
    if (!row) throw fail(404, 'group_not_found');
    return row;
  };
  const ensureEvent = async (id, userId, edit = false) => {
    const row = await first('SELECT e.*,g.created_by AS group_owner FROM events e JOIN groups g ON g.id=e.group_id JOIN members m ON m.group_id=e.group_id WHERE e.id=? AND m.user_id=?', id, userId);
    if (!row) throw fail(404, 'event_not_found');
    if (edit && row.created_by !== userId && row.group_owner !== userId) throw fail(403, 'forbidden');
    return row;
  };
  return async function fetchRequest(request, executionContext) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return (await assetResponse(request)) || new Response('Not found', { status: 404 });
    const origin = request.headers.get('Origin');
    const publicUrl = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
    const allowed = new Set((env.ALLOWED_ORIGINS || `${publicUrl},${url.origin},capacitor://localhost,tauri://localhost,http://tauri.localhost,https://tauri.localhost,https://localhost,http://localhost`).split(',').map((v) => v.trim()));
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin' };
    if (origin && allowed.has(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Credentials'] = 'true'; }
    const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    try {
      const appleFormPost = request.method === 'POST' && url.pathname === '/api/auth/apple/callback';
      if (origin && !allowed.has(origin) && !appleFormPost) throw fail(403, 'invalid_origin');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '600' } });
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      await limit(`ip:${ip}`, Number(env.RATE_LIMIT_PER_MINUTE) || 500);
      const body = await readBody(request);
      const context = { env, request, url, publicUrl, body, ip, first, all, run, batch, selectUser, getUser, newSession, limit, json, executionContext };
      const authResponse = await handleAuth(context);
      if (authResponse) return authResponse;
      const path = url.pathname, method = request.method;
      if (path === '/api/health' && method === 'GET') return json({ ok: true, version: '0.3.3', liveMode: 'polling', pollIntervalMs: 5000 });
      if (path === '/api/session' && method === 'POST') {
        await limit(`session:${ip}`, 20, 3_600_000);
        const name = text(body.name, 60), locale = body.locale || 'en';
        if (!locales.has(locale)) throw fail(400, 'invalid_locale');
        const id = crypto.randomUUID();
        await run('INSERT INTO users(id,name,locale,created_at) VALUES(?,?,?,?)', id, name, locale, Date.now());
        return json(await newSession(id), 201);
      }
      if (!['/api/live', '/api/state', '/api/profile', '/api/groups', '/api/groups/join', '/api/events', '/api/availability', '/api/presence', '/api/presence/heartbeat', '/api/presence/leave', '/api/session', '/api/account'].includes(path) && !/^\/api\/(?:groups\/[^/]+\/membership|events\/[^/]+(?:\/response)?)$/.test(path)) return json({ error: 'not_found', code: 'not_found' }, 404);
      const user = await getUser(request);
      if (path === '/api/live' && method === 'GET') return json({ code: 'live_polling', error: 'live_polling', pollIntervalMs: 5000 }, 503);
      if ((['/api/presence/heartbeat', '/api/presence/leave'].includes(path) && method === 'POST') || (path === '/api/presence' && method === 'PATCH')) {
        await limit(`presence:${user.id}`, 60);
        const now = path === '/api/presence/leave' ? 0 : Date.now();
        let saved;
        if (method === 'PATCH') {
          if (!presenceModes.has(body.mode)) throw fail(400, 'invalid_presence');
          saved = await first('INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,last_seen_at=excluded.last_seen_at RETURNING mode AS presence_mode,last_seen_at', user.id, body.mode, now);
        } else {
          saved = await first("INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,'online',?) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at RETURNING mode AS presence_mode,last_seen_at", user.id, now);
        }
        return json({ presence: ownPresence(saved) });
      }
      if (path === '/api/state' && method === 'GET') {
        const groups = await all('SELECT g.* FROM groups g JOIN members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.created_at,g.id', user.id);
        const events = await all('SELECT e.* FROM events e JOIN members m ON m.group_id=e.group_id WHERE m.user_id=? ORDER BY e.date,e.start_time,e.created_at', user.id);
        // Scoped collection reads avoid one database query per event during polling.
        const people = await all('SELECT m.group_id,u.id,u.name,u.username,u.contacts,p.mode AS presence_mode,p.last_seen_at,c.avatar FROM members m JOIN users u ON u.id=m.user_id LEFT JOIN user_presence p ON p.user_id=u.id LEFT JOIN user_customization c ON c.user_id=u.id WHERE m.group_id IN (SELECT group_id FROM members WHERE user_id=?) ORDER BY m.joined_at,u.id', user.id);
        const answers = await all('SELECT r.event_id,r.user_id,r.value FROM responses r JOIN events e ON e.id=r.event_id JOIN members responder ON responder.user_id=r.user_id AND responder.group_id=e.group_id WHERE e.group_id IN (SELECT group_id FROM members WHERE user_id=?)', user.id);
        const membersByGroup = new Map(), responsesByEvent = new Map();
        for (const person of people) { if (!membersByGroup.has(person.group_id)) membersByGroup.set(person.group_id, []); membersByGroup.get(person.group_id).push(memberShape(person)); }
        for (const answer of answers) { if (!responsesByEvent.has(answer.event_id)) responsesByEvent.set(answer.event_id, {}); responsesByEvent.get(answer.event_id)[answer.user_id] = answer.value; }
        const availability = await all('SELECT a.* FROM availability a JOIN members responder ON responder.group_id=a.group_id AND responder.user_id=a.user_id WHERE a.group_id IN (SELECT group_id FROM members WHERE user_id=?) ORDER BY a.date,a.group_id,a.user_id', user.id);
        return json({ user, groups: groups.map((g) => plainGroup(g, membersByGroup.get(g.id) || [])), events: events.map((e) => plainEvent(e, responsesByEvent.get(e.id) || {})), availability: availability.map(plainAvailability) });
      }
      if (path === '/api/availability' && ['PUT', 'DELETE'].includes(method)) {
        const groupId = text(body.groupId, 80);
        await ensureGroup(groupId, user.id);
        if (!validDate(body.date)) throw fail(400, 'invalid_date');
        if (method === 'DELETE') {
          await run('DELETE FROM availability WHERE group_id=? AND user_id=? AND date=?', groupId, user.id, body.date);
          return json({ ok: true });
        }
        const value = availabilityInput(body), updatedAt = Date.now();
        const saved = await first('INSERT INTO availability(group_id,user_id,date,value,time,note,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=?) ON CONFLICT(group_id,user_id,date) DO UPDATE SET value=excluded.value,time=excluded.time,note=excluded.note,updated_at=excluded.updated_at RETURNING *', groupId, user.id, value.date, value.value, value.time, value.note, updatedAt, groupId, user.id);
        if (!saved) throw fail(404, 'group_not_found');
        return json(plainAvailability(saved));
      }
      if (path === '/api/profile' && method === 'PATCH') {
        const name = body.name == null ? user.name : text(body.name, 60), locale = body.locale ?? user.locale;
        if (!locales.has(locale)) throw fail(400, 'invalid_locale');
        const contacts = body.contacts === undefined ? user.contacts : contactLinks(user.contacts, body.contacts);
        const username = body.username === undefined ? user.username || null : body.username === '' ? null : text(body.username, 64);
        const customization = body.customization === undefined ? null : customizationCommand(user.id, customizationInput(body.customization));
        await batch([
          ['UPDATE users SET name=?,locale=?,username=?,contacts=? WHERE id=?', name, locale, username, JSON.stringify(contacts), user.id],
          ...(customization ? [customization] : []),
        ]);
        return json({ user: await selectUser(user.id) });
      }
      if (path === '/api/groups' && method === 'POST') {
        await limit(`groups:${user.id}`, 20, 3_600_000);
        const name = text(body.name, 80), emoji = body.emoji == null ? '🌿' : text(body.emoji, 16);
        const rawColor = body.color || 'green', color = Object.hasOwn(colors, rawColor) ? colors[rawColor] : rawColor;
        if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw fail(400, 'invalid_color');
        const id = crypto.randomUUID(), code = [...crypto.getRandomValues(new Uint8Array(6))].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
        await batch([['INSERT INTO groups(id,name,emoji,color,invite_code,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, name, emoji, color, code, user.id, Date.now()], ['INSERT INTO members(group_id,user_id,joined_at) VALUES(?,?,?)', id, user.id, Date.now()]]);
        return json(await groupShape(await first('SELECT * FROM groups WHERE id=?', id)), 201);
      }
      if (path === '/api/groups/join' && method === 'POST') {
        await limit(`join:${user.id}`, 10);
        const code = text(body.code, 32).replace(/[-\s]/g, '').toUpperCase();
        const group = await first('SELECT * FROM groups WHERE invite_code=?', code);
        if (!group) throw fail(404, 'invite_not_found');
        await run('INSERT OR IGNORE INTO members(group_id,user_id,joined_at) VALUES(?,?,?)', group.id, user.id, Date.now());
        return json(await groupShape(group));
      }
      let match = path.match(/^\/api\/groups\/([^/]+)\/membership$/);
      if (match && method === 'DELETE') {
        const group = await ensureGroup(match[1], user.id);
        await batch([
          ['DELETE FROM responses WHERE user_id=? AND event_id IN (SELECT id FROM events WHERE group_id=?)', user.id, group.id],
          ['DELETE FROM members WHERE group_id=? AND user_id=?', group.id, user.id],
          ['UPDATE groups SET created_by=(SELECT user_id FROM members WHERE group_id=? ORDER BY joined_at,user_id LIMIT 1) WHERE id=? AND created_by=? AND EXISTS(SELECT 1 FROM members WHERE group_id=?)', group.id, group.id, user.id, group.id],
          ['DELETE FROM groups WHERE id=? AND NOT EXISTS(SELECT 1 FROM members WHERE group_id=?)', group.id, group.id],
        ]);
        return json({ ok: true });
      }
      if (path === '/api/events' && method === 'POST') {
        const groupId = text(body.groupId, 80);
        await ensureGroup(groupId, user.id);
        const v = eventInput(body), id = crypto.randomUUID();
        const result = await run('INSERT INTO events(id,group_id,title,date,start_time,end_time,location,notes,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=?)', id, groupId, v.title, v.date, v.startTime, v.endTime, v.location, v.notes, user.id, Date.now(), groupId, user.id);
        if (!result.meta.changes) throw fail(404, 'group_not_found');
        return json(await eventShape(await first('SELECT * FROM events WHERE id=?', id)), 201);
      }
      match = path.match(/^\/api\/events\/([^/]+)(\/response)?$/);
      if (match) {
        const event = await ensureEvent(match[1], user.id, !match[2] && ['PATCH', 'DELETE'].includes(method));
        if (match[2] && method === 'PUT') {
          if (!responses.has(body.value)) throw fail(400, 'invalid_response');
          const result = await run('INSERT INTO responses(event_id,user_id,value) SELECT e.id,?,? FROM events e JOIN members m ON m.group_id=e.group_id WHERE e.id=? AND m.user_id=? ON CONFLICT(event_id,user_id) DO UPDATE SET value=excluded.value', user.id, body.value, event.id, user.id);
          if (!result.meta.changes) throw fail(404, 'event_not_found');
          return json(await eventShape(event));
        }
        if (!match[2] && method === 'PATCH') {
          if (body.groupId && body.groupId !== event.group_id) throw fail(400, 'cannot_move_event');
          const v = eventInput({ ...(await eventShape(event)), ...body });
          const result = await run('UPDATE events SET title=?,date=?,start_time=?,end_time=?,location=?,notes=? WHERE id=? AND EXISTS(SELECT 1 FROM members WHERE group_id=events.group_id AND user_id=?) AND (created_by=? OR EXISTS(SELECT 1 FROM groups WHERE id=events.group_id AND created_by=?))', v.title, v.date, v.startTime, v.endTime, v.location, v.notes, event.id, user.id, user.id, user.id);
          if (!result.meta.changes) throw fail(404, 'event_not_found');
          return json(await eventShape(await first('SELECT * FROM events WHERE id=?', event.id)));
        }
        if (!match[2] && method === 'DELETE') {
          const result = await run('DELETE FROM events WHERE id=? AND EXISTS(SELECT 1 FROM members WHERE group_id=events.group_id AND user_id=?) AND (created_by=? OR EXISTS(SELECT 1 FROM groups WHERE id=events.group_id AND created_by=?))', event.id, user.id, user.id, user.id);
          if (!result.meta.changes) throw fail(404, 'event_not_found');
          return json({ ok: true });
        }
      }
      if (path === '/api/session' && method === 'DELETE') {
        await batch([
          ["INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,'online',0) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=0", user.id],
          ['DELETE FROM sessions WHERE token_hash=?', await hash(request.headers.get('Authorization').slice(7))],
        ]);
        return json({ ok: true });
      }
      if (path === '/api/account' && method === 'DELETE') {
        await revokeApple(context, user.id);
        await batch([
          ['UPDATE groups SET created_by=(SELECT user_id FROM members WHERE group_id=groups.id AND user_id<>? ORDER BY joined_at,user_id LIMIT 1) WHERE created_by=? AND EXISTS(SELECT 1 FROM members WHERE group_id=groups.id AND user_id<>?)', user.id, user.id, user.id],
          ['DELETE FROM groups WHERE created_by=?', user.id],
          ['DELETE FROM users WHERE id=?', user.id],
        ]);
        return json({ ok: true });
      }
      return json({ error: 'not_found', code: 'not_found' }, 404);
    } catch (error) {
      const status = Number(error.status) || 500;
      const code = typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'server_error';
      return json({ error: code, code }, status);
    }
  };
}

export default { async fetch(request, env, context) { return createHandler(env)(request, context); } };
