import express from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8, decodeJwt } from 'jose';
import { customizationShape, customizationInput, customizationCommand } from '../cloud/customization.mjs';
import { installEmailAuth } from './email-auth.mjs';

const DAY = 86_400_000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const locales = new Set(['ru', 'de', 'en', 'fr']);
const responseValues = new Set(['yes', 'no', 'maybe']);
const presenceModes = new Set(['online', 'away', 'dnd', 'invisible']);
const presenceStatus = (row) => row.presence_mode === 'invisible' || !Number.isFinite(row.last_seen_at) || Date.now() - row.last_seen_at > 90_000 ? 'offline' : row.presence_mode === 'away' || row.presence_mode === 'dnd' ? row.presence_mode : 'online';
const ownPresence = (row) => ({ mode: row.presence_mode || 'online', status: presenceStatus(row) });
const colors = { green: '#729b75', blue: '#6e9fc1', orange: '#d7a25e', purple: '#9b85ca', pink: '#cd859a', yellow: '#d7c866' };
const fail = (status, code, message = code) => Object.assign(new Error(message), { status, code });
const text = (value, max, required = true) => {
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) throw fail(400, 'invalid_input');
  return value.trim();
};
const optionalText = (value, max) => value == null ? '' : text(value, max, false);
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validCodeChallenge = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;

function validDate(date) {
  if (typeof date !== 'string' || !/^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function slot(value) {
  if (typeof value !== 'string' || !/^(?:0[89]|1\d|20):(?:00|30)$/.test(value)) return -1;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m <= 1200 ? h * 60 + m : -1;
}

function validateAvailability(value) {
  if (!validDate(value.date)) throw fail(400, 'invalid_date');
  if (!responseValues.has(value.value)) throw fail(400, 'invalid_response');
  if (value.time != null && slot(value.time) < 480) throw fail(400, 'invalid_time');
  return { date: value.date, value: value.value, time: value.time ?? null, note: optionalText(value.note, 280) };
}
const publicAvailability = (row) => ({ groupId: row.group_id, userId: row.user_id, date: row.date, value: row.value, time: row.time, note: row.note, updatedAt: row.updated_at });

export function createApp(options = {}) {
  const env = options.env || process.env;
  const dbPath = options.dbPath || env.DATABASE_PATH || resolve('work/opencalendar.sqlite');
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,locale TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS email_credentials(email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,parameters TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_customization(user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,avatar TEXT NOT NULL DEFAULT 'mint' CHECK(avatar IN ('mint','lavender','stone','sunset')),theme TEXT NOT NULL DEFAULT 'meadow' CHECK(theme IN ('meadow','forest','dusk')),palette TEXT NOT NULL DEFAULT 'sage' CHECK(palette IN ('sage','white','sand','cocoa')),tagline TEXT NOT NULL DEFAULT '' CHECK(length(tagline)<=80),default_view TEXT NOT NULL DEFAULT 'month' CHECK(default_view IN ('month','week','schedule')),reduced_motion INTEGER NOT NULL DEFAULT 0 CHECK(reduced_motion IN (0,1)),compact_calendar INTEGER NOT NULL DEFAULT 0 CHECK(compact_calendar IN (0,1)));
    CREATE TABLE IF NOT EXISTS user_presence(user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,mode TEXT NOT NULL DEFAULT 'online' CHECK(mode IN ('online','away','dnd','invisible')),last_seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,emoji TEXT NOT NULL,color TEXT NOT NULL,invite_code TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members(group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,joined_at INTEGER NOT NULL,PRIMARY KEY(group_id,user_id));
    CREATE TABLE IF NOT EXISTS availability(group_id TEXT NOT NULL,user_id TEXT NOT NULL,date TEXT NOT NULL,value TEXT NOT NULL CHECK(value IN ('yes','no','maybe')),time TEXT,note TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL,PRIMARY KEY(group_id,user_id,date),FOREIGN KEY(group_id,user_id) REFERENCES members(group_id,user_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,title TEXT NOT NULL,date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,location TEXT NOT NULL,notes TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS responses(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,value TEXT NOT NULL CHECK(value IN ('yes','no','maybe')),PRIMARY KEY(event_id,user_id));
    CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(provider,subject));
    CREATE TABLE IF NOT EXISTS provider_tokens(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,encrypted_token TEXT NOT NULL,token_type TEXT NOT NULL,PRIMARY KEY(provider,subject));
    CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
    CREATE INDEX IF NOT EXISTS events_group_date ON events(group_id,date);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const app = express();
  app.disable('x-powered-by');
  const publicUrl = (env.PUBLIC_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const clientUrl = env.CLIENT_URL || 'http://localhost:5173';
  const nativeRedirect = env.NATIVE_REDIRECT_URL || 'space.opencalendar.app://auth';
  const origins = new Set((env.ALLOWED_ORIGINS || `${new URL(clientUrl).origin},capacitor://localhost,tauri://localhost,http://localhost,https://localhost`).split(',').map((value) => value.trim()).filter(Boolean));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.has(origin)); }, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));
  app.use(express.json({ limit: '24kb' }));
  app.use(express.urlencoded({ extended: false, limit: '24kb' }));
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      req.body ??= {};
      if (typeof req.body !== 'object' || Array.isArray(req.body)) return next(fail(400, 'invalid_input'));
    }
    next();
  });
  const windows = new Map();
  const oauthPending = new Map();
  const exchangeCodes = new Map();
  const streams = new Set();
  let closed = false;

  // Sliding per-process limits prevent accidental storms and invite-code brute force.
  function limit(key, max, duration = 60_000) {
    const now = Date.now();
    const found = windows.get(key);
    const window = !found || found.reset <= now ? { count: 0, reset: now + duration } : found;
    window.count += 1;
    windows.set(key, window);
    if (window.count > max) throw fail(429, 'rate_limited');
  }

  const selectUser = db.prepare('SELECT u.id,u.name,u.locale,p.mode AS presence_mode,p.last_seen_at,e.email,e.verified,c.avatar,c.theme,c.palette,c.tagline,c.default_view,c.reduced_motion,c.compact_calendar FROM users u LEFT JOIN user_presence p ON p.user_id=u.id LEFT JOIN email_credentials e ON e.user_id=u.id LEFT JOIN user_customization c ON c.user_id=u.id WHERE u.id=?');
  const sessionUser = db.prepare('SELECT u.id,u.name,u.locale,p.mode AS presence_mode,p.last_seen_at,e.email,e.verified,c.avatar,c.theme,c.palette,c.tagline,c.default_view,c.reduced_motion,c.compact_calendar FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_presence p ON p.user_id=u.id LEFT JOIN email_credentials e ON e.user_id=u.id LEFT JOIN user_customization c ON c.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?');
  const connectedProviders = db.prepare("SELECT DISTINCT provider FROM identities WHERE user_id=? AND provider IN ('apple','google','microsoft','telegram') ORDER BY provider");
  const ownUser = (user) => user ? { id: user.id, name: user.name, locale: user.locale, connectedProviders: connectedProviders.all(user.id).map((identity) => identity.provider), presence: ownPresence(user), customization: customizationShape(user), ...(user.email ? { email: user.email, emailVerified: Boolean(user.verified) } : {}) } : null;
  const membership = db.prepare('SELECT 1 FROM members WHERE group_id=? AND user_id=?');
  const groupRow = db.prepare('SELECT * FROM groups WHERE id=?');
  const eventRow = db.prepare('SELECT * FROM events WHERE id=?');
  const currentMembers = db.prepare('SELECT u.id,u.name,p.mode AS presence_mode,p.last_seen_at,c.avatar FROM members m JOIN users u ON m.user_id=u.id LEFT JOIN user_presence p ON p.user_id=u.id LEFT JOIN user_customization c ON c.user_id=u.id WHERE m.group_id=? ORDER BY m.joined_at,u.id');
  const eventResponses = db.prepare('SELECT r.user_id,r.value FROM responses r JOIN events e ON e.id=r.event_id JOIN members m ON m.group_id=e.group_id AND m.user_id=r.user_id WHERE r.event_id=?');
  const groupMembers = (groupId) => currentMembers.all(groupId).map((member) => ({ id: member.id, name: member.name, avatar: member.avatar || 'mint', presence: presenceStatus(member) }));
  const publicGroup = (row) => {
    const members = groupMembers(row.id);
    return { id: row.id, name: row.name, emoji: row.emoji, color: row.color, inviteCode: row.invite_code, memberCount: members.length, members, createdBy: row.created_by };
  };
  const publicEvent = (row) => ({ id: row.id, groupId: row.group_id, title: row.title, date: row.date, startTime: row.start_time, endTime: row.end_time, location: row.location, notes: row.notes, createdBy: row.created_by, responses: Object.fromEntries(eventResponses.all(row.id).map((response) => [response.user_id, response.value])) });
  const transaction = (callback) => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = callback(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function getUser(req, required = true) {
    const authorization = req.headers.authorization;
    const token = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const user = token && token.length < 200 ? sessionUser.get(hash(token), Date.now()) : null;
    if (!user && required) throw fail(401, 'unauthorized');
    return ownUser(user);
  }
  app.use('/api', (req, res, next) => {
    try {
      limit(`ip:${req.socket.remoteAddress}`, options.rateLimit || 500);
      next();
    } catch (error) { next(error); }
  });
  function ensureMember(groupId, userId) {
    if (!membership.get(groupId, userId)) throw fail(404, 'group_not_found');
    return groupRow.get(groupId);
  }
  function ensureEvent(eventId, userId, editable = false) {
    const event = eventRow.get(eventId);
    if (!event) throw fail(404, 'event_not_found');
    const group = ensureMember(event.group_id, userId);
    if (editable && event.created_by !== userId && group.created_by !== userId) throw fail(403, 'forbidden');
    return event;
  }
  function broadcast(userIds) {
    const affected = new Set(userIds);
    for (const stream of streams) if (affected.has(stream.userId)) stream.response.write(`event: change\ndata: {}\n\n`);
  }
  const notifyGroup = (groupId) => broadcast(groupMembers(groupId).map((member) => member.id));
  const notifyPresence = (userId) => broadcast(db.prepare('SELECT DISTINCT peer.user_id FROM members own JOIN members peer ON peer.group_id=own.group_id WHERE own.user_id=?').all(userId).map((member) => member.user_id));
  const newSession = (userId) => {
    const token = secret();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(token), userId, Date.now() + 30 * DAY);
    return { token, user: ownUser(selectUser.get(userId)) };
  };
  const route = (callback) => (req, res, next) => Promise.resolve().then(() => callback(req, res)).catch(next);
  installEmailAuth({ app, db, route, getUser, newSession, selectUser, ownUser, limit, fail });
  const tokenKey = () => createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY || `${env.APPLE_PRIVATE_KEY}\0opencalendar-apple-revocation-v1`).digest();
  const encryptToken = (value) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  };
  const decryptToken = (value) => {
    const record = Buffer.from(value, 'base64url'), decipher = createDecipheriv('aes-256-gcm', tokenKey(), record.subarray(0, 12));
    decipher.setAuthTag(record.subarray(12, 28));
    return Buffer.concat([decipher.update(record.subarray(28)), decipher.final()]).toString('utf8');
  };
  async function appleClientSecret() {
    const key = await importPKCS8(env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
    return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID }).setIssuer(env.APPLE_TEAM_ID).setIssuedAt().setExpirationTime('10m').setAudience('https://appleid.apple.com').setSubject(env.APPLE_CLIENT_ID).sign(key);
  }
  function validateEvent(body) {
    const title = text(body.title, 120);
    if (!validDate(body.date)) throw fail(400, 'invalid_date');
    const start = slot(body.startTime), end = slot(body.endTime);
    if (start < 480 || end < 480 || end <= start) throw fail(400, 'invalid_time');
    return { title, date: body.date, startTime: body.startTime, endTime: body.endTime, location: optionalText(body.location, 200), notes: optionalText(body.notes, 2000) };
  }

  app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.1.0' }));
  app.post('/api/session', route((req, res) => {
    limit(`session:${req.socket.remoteAddress}`, 20, 3_600_000);
    const name = text(req.body.name, 60);
    const locale = req.body.locale ?? 'ru';
    if (!locales.has(locale)) throw fail(400, 'invalid_locale');
    const id = randomUUID();
    db.prepare('INSERT INTO users(id,name,locale,created_at) VALUES(?,?,?,?)').run(id, name, locale, Date.now());
    res.status(201).json(newSession(id));
  }));
  app.get('/api/state', route((req, res) => {
    const user = getUser(req);
    const groups = db.prepare('SELECT g.* FROM groups g JOIN members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.created_at').all(user.id).map(publicGroup);
    const events = db.prepare('SELECT e.* FROM events e JOIN members m ON m.group_id=e.group_id WHERE m.user_id=? ORDER BY e.date,e.start_time,e.created_at').all(user.id).map(publicEvent);
    const availability = db.prepare('SELECT a.* FROM availability a JOIN members responder ON responder.group_id=a.group_id AND responder.user_id=a.user_id WHERE a.group_id IN (SELECT group_id FROM members WHERE user_id=?) ORDER BY a.date,a.group_id,a.user_id').all(user.id).map(publicAvailability);
    res.json({ user, groups, events, availability });
  }));
  app.post('/api/presence/heartbeat', route((req, res) => {
    const user = getUser(req);
    limit(`presence:${user.id}`, 60);
    const saved = db.prepare("INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,'online',?) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at RETURNING mode AS presence_mode,last_seen_at").get(user.id, Date.now());
    notifyPresence(user.id);
    res.json({ presence: ownPresence(saved) });
  }));
  app.post('/api/presence/leave', route((req, res) => {
    const user = getUser(req);
    limit(`presence:${user.id}`, 60);
    const saved = db.prepare("INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,'online',0) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=0 RETURNING mode AS presence_mode,last_seen_at").get(user.id);
    notifyPresence(user.id);
    res.json({ presence: ownPresence(saved) });
  }));
  app.patch('/api/presence', route((req, res) => {
    const user = getUser(req);
    limit(`presence:${user.id}`, 60);
    if (!presenceModes.has(req.body.mode)) throw fail(400, 'invalid_presence');
    const saved = db.prepare('INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,last_seen_at=excluded.last_seen_at RETURNING mode AS presence_mode,last_seen_at').get(user.id, req.body.mode, Date.now());
    notifyPresence(user.id);
    res.json({ presence: ownPresence(saved) });
  }));
  app.put('/api/availability', route((req, res) => {
    const user = getUser(req), groupId = text(req.body.groupId, 80);
    ensureMember(groupId, user.id);
    const value = validateAvailability(req.body);
    db.prepare('INSERT INTO availability(group_id,user_id,date,value,time,note,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(group_id,user_id,date) DO UPDATE SET value=excluded.value,time=excluded.time,note=excluded.note,updated_at=excluded.updated_at').run(groupId, user.id, value.date, value.value, value.time, value.note, Date.now());
    notifyGroup(groupId);
    res.json(publicAvailability(db.prepare('SELECT * FROM availability WHERE group_id=? AND user_id=? AND date=?').get(groupId, user.id, value.date)));
  }));
  app.delete('/api/availability', route((req, res) => {
    const user = getUser(req), groupId = text(req.body.groupId, 80);
    ensureMember(groupId, user.id);
    if (!validDate(req.body.date)) throw fail(400, 'invalid_date');
    db.prepare('DELETE FROM availability WHERE group_id=? AND user_id=? AND date=?').run(groupId, user.id, req.body.date);
    notifyGroup(groupId);
    res.json({ ok: true });
  }));
  app.patch('/api/profile', route((req, res) => {
    const user = getUser(req);
    const name = req.body.name == null ? user.name : text(req.body.name, 60);
    const locale = req.body.locale ?? user.locale;
    if (!locales.has(locale)) throw fail(400, 'invalid_locale');
    const customization = req.body.customization === undefined ? null : customizationCommand(user.id, customizationInput(req.body.customization));
    transaction(() => {
      db.prepare('UPDATE users SET name=?,locale=? WHERE id=?').run(name, locale, user.id);
      if (customization) { const [sql, ...args] = customization; db.prepare(sql).run(...args); }
    });
    const peers = db.prepare('SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.group_id=m2.group_id WHERE m1.user_id=?').all(user.id).map((row) => row.user_id);
    broadcast([user.id, ...peers]);
    res.json({ user: ownUser(selectUser.get(user.id)) });
  }));
  app.post('/api/groups', route((req, res) => {
    const user = getUser(req);
    limit(`groups:${user.id}`, 20, 3_600_000);
    const name = text(req.body.name, 80);
    const emoji = req.body.emoji == null ? '🌿' : text(req.body.emoji, 16);
    const chosenColor = req.body.color || 'green';
    const color = typeof chosenColor === 'string' && Object.hasOwn(colors, chosenColor) ? colors[chosenColor] : chosenColor;
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw fail(400, 'invalid_color');
    const id = randomUUID(), code = randomBytes(6).toString('hex').toUpperCase();
    transaction(() => {
      db.prepare('INSERT INTO groups(id,name,emoji,color,invite_code,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id, name, emoji, color, code, user.id, Date.now());
      db.prepare('INSERT INTO members(group_id,user_id,joined_at) VALUES(?,?,?)').run(id, user.id, Date.now());
    });
    notifyGroup(id);
    res.status(201).json(publicGroup(groupRow.get(id)));
  }));
  app.post('/api/groups/join', route((req, res) => {
    const user = getUser(req);
    limit(`join:${user.id}`, 10);
    const code = text(req.body.code, 32).replace(/[-\s]/g, '').toUpperCase();
    const group = db.prepare('SELECT * FROM groups WHERE invite_code=?').get(code);
    if (!group) throw fail(404, 'invite_not_found');
    db.prepare('INSERT OR IGNORE INTO members(group_id,user_id,joined_at) VALUES(?,?,?)').run(group.id, user.id, Date.now());
    notifyGroup(group.id);
    res.json(publicGroup(group));
  }));
  app.delete('/api/groups/:id/membership', route((req, res) => {
    const user = getUser(req), group = ensureMember(req.params.id, user.id);
    const affected = groupMembers(group.id).map((member) => member.id);
    transaction(() => {
      db.prepare('DELETE FROM responses WHERE user_id=? AND event_id IN (SELECT id FROM events WHERE group_id=?)').run(user.id, group.id);
      db.prepare('DELETE FROM members WHERE group_id=? AND user_id=?').run(group.id, user.id);
      const remaining = groupMembers(group.id);
      if (!remaining.length) db.prepare('DELETE FROM groups WHERE id=?').run(group.id);
      else if (group.created_by === user.id) db.prepare('UPDATE groups SET created_by=? WHERE id=?').run(remaining[0].id, group.id);
    });
    broadcast(affected);
    res.json({ ok: true });
  }));
  app.post('/api/events', route((req, res) => {
    const user = getUser(req);
    const groupId = text(req.body.groupId, 80);
    ensureMember(groupId, user.id);
    const value = validateEvent(req.body), id = randomUUID();
    db.prepare('INSERT INTO events(id,group_id,title,date,start_time,end_time,location,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, groupId, value.title, value.date, value.startTime, value.endTime, value.location, value.notes, user.id, Date.now());
    notifyGroup(groupId);
    res.status(201).json(publicEvent(eventRow.get(id)));
  }));
  app.patch('/api/events/:id', route((req, res) => {
    const user = getUser(req), old = ensureEvent(req.params.id, user.id, true);
    // Event edits preserve the group; moving an event would expose responses to another audience.
    if (req.body.groupId && req.body.groupId !== old.group_id) throw fail(400, 'cannot_move_event');
    const value = validateEvent({ ...publicEvent(old), ...req.body });
    db.prepare('UPDATE events SET title=?,date=?,start_time=?,end_time=?,location=?,notes=? WHERE id=?').run(value.title, value.date, value.startTime, value.endTime, value.location, value.notes, old.id);
    notifyGroup(old.group_id);
    res.json(publicEvent(eventRow.get(old.id)));
  }));
  app.delete('/api/events/:id', route((req, res) => {
    const user = getUser(req), event = ensureEvent(req.params.id, user.id, true);
    db.prepare('DELETE FROM events WHERE id=?').run(event.id);
    notifyGroup(event.group_id);
    res.json({ ok: true });
  }));
  app.put('/api/events/:id/response', route((req, res) => {
    const user = getUser(req), event = ensureEvent(req.params.id, user.id);
    const value = req.body.value;
    if (!responseValues.has(value)) throw fail(400, 'invalid_response');
    db.prepare('INSERT INTO responses(event_id,user_id,value) VALUES(?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET value=excluded.value').run(event.id, user.id, value);
    notifyGroup(event.group_id);
    res.json(publicEvent(eventRow.get(event.id)));
  }));
  app.delete('/api/session', route((req, res) => {
    const user = getUser(req);
    const tokenHash = hash(req.headers.authorization.slice(7));
    transaction(() => {
      db.prepare("INSERT INTO user_presence(user_id,mode,last_seen_at) VALUES(?,'online',0) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=0").run(user.id);
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    });
    notifyPresence(user.id);
    for (const stream of streams) if (stream.tokenHash === tokenHash) stream.response.end();
    res.json({ ok: true });
  }));
  app.delete('/api/account', route(async (req, res) => {
    const user = getUser(req);
    // Apple requires revoking its authorization grant when an account is deleted.
    const appleTokens = db.prepare("SELECT * FROM provider_tokens WHERE user_id=? AND provider='apple'").all(user.id);
    for (const record of appleTokens) {
      try {
        const body = new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, client_secret: await appleClientSecret(), token: decryptToken(record.encrypted_token), token_type_hint: record.token_type });
        const revoke = await fetch('https://appleid.apple.com/auth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
        if (!revoke.ok) throw new Error('revocation_failed');
      } catch { throw fail(502, 'provider_revocation_failed'); }
    }
    const groups = db.prepare('SELECT g.* FROM groups g JOIN members m ON g.id=m.group_id WHERE m.user_id=?').all(user.id);
    const affected = new Set([user.id]);
    for (const group of groups) for (const member of groupMembers(group.id)) affected.add(member.id);
    transaction(() => {
      for (const group of groups) {
        const remaining = groupMembers(group.id).filter((member) => member.id !== user.id);
        if (!remaining.length) db.prepare('DELETE FROM groups WHERE id=?').run(group.id);
        else if (group.created_by === user.id) db.prepare('UPDATE groups SET created_by=? WHERE id=?').run(remaining[0].id, group.id);
      }
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    });
    broadcast(affected);
    for (const stream of streams) if (stream.userId === user.id) stream.response.end();
    res.json({ ok: true });
  }));
  app.get('/api/live', route((req, res) => {
    const user = getUser(req);
    const count = [...streams].filter((stream) => stream.userId === user.id).length;
    if (count >= 5) throw fail(429, 'too_many_connections');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('event: connected\ndata: {}\n\n');
    const stream = { userId: user.id, response: res, tokenHash: hash(req.headers.authorization.slice(7)) };
    streams.add(stream);
    const heartbeat = setInterval(() => {
      if (!sessionUser.get(stream.tokenHash, Date.now())) return res.end();
      res.write(': heartbeat\n\n');
    }, 20_000);
    heartbeat.unref();
    res.on('close', () => { clearInterval(heartbeat); streams.delete(stream); });
  }));

  // Providers are activated only after the owner supplies real application credentials.
  const providerConfigs = {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuer: ['https://accounts.google.com', 'accounts.google.com'] },
    apple: { clientId: env.APPLE_CLIENT_ID, authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', jwks: 'https://appleid.apple.com/auth/keys', issuer: 'https://appleid.apple.com' },
    microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, authorize: `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID || 'common')}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID || 'common')}/oauth2/v2.0/token`, jwks: `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID || 'common')}/discovery/v2.0/keys` },
    telegram: { clientId: env.TELEGRAM_CLIENT_ID, clientSecret: env.TELEGRAM_CLIENT_SECRET, authorize: 'https://oauth.telegram.org/auth', token: 'https://oauth.telegram.org/token', jwks: 'https://oauth.telegram.org/.well-known/jwks.json', issuer: 'https://oauth.telegram.org' },
  };
  const configured = (provider) => provider === 'apple' ? Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) : Boolean(providerConfigs[provider]?.clientId && providerConfigs[provider]?.clientSecret);
  const jwksCache = new Map();
  const provider = (id) => {
    if (!Object.hasOwn(providerConfigs, id)) throw fail(404, 'provider_not_found');
    if (!configured(id)) throw fail(503, 'provider_not_configured');
    return providerConfigs[id];
  };
  const cookieName = (state) => `oc_oauth_${state.slice(0, 12)}`;
  const cookieValue = (req, name) => (req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const callbackPath = (id) => `/api/auth/${id}/callback`;
  const redirectAuth = (res, returnTo, key, value) => {
    const destination = new URL(returnTo);
    destination.hash = new URLSearchParams({ [key]: value }).toString();
    res.redirect(303, destination.href);
  };
  app.get('/api/auth/providers', (req, res) => res.json(Object.keys(providerConfigs).map((id) => ({ id, configured: configured(id) }))));
  app.post('/api/auth/:provider/start', route((req, res) => {
    const id = req.params.provider;
    provider(id);
    const user = getUser(req, false);
    limit(`oauth:${req.socket.remoteAddress}`, 15);
    const returnTo = req.body.returnTo || clientUrl;
    if (returnTo !== clientUrl && returnTo !== nativeRedirect) throw fail(400, 'invalid_return_url');
    const codeChallenge = req.body.codeChallenge;
    if (!validCodeChallenge(codeChallenge)) throw fail(400, 'invalid_code_challenge');
    const ticket = secret(), state = secret();
    oauthPending.set(state, { provider: id, ticketHash: hash(ticket), userId: user?.id || null, returnTo, codeChallenge, verifier: secret() + secret(), nonce: secret(), expires: Date.now() + 10 * 60_000 });
    res.json({ url: `${publicUrl}/api/auth/${id}/authorize?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(state)}` });
  }));
  app.get('/api/auth/:provider/authorize', route((req, res) => {
    const id = req.params.provider, config = provider(id);
    const pending = typeof req.query.state === 'string' ? oauthPending.get(req.query.state) : null;
    if (!pending || pending.provider !== id || pending.expires < Date.now() || !safeEqual(pending.ticketHash, hash(String(req.query.ticket || '')))) throw fail(400, 'invalid_oauth_state');
    const browserKey = secret();
    pending.browserHash = hash(browserKey);
    pending.ticketHash = null; // Tickets can be opened only once.
    const secure = publicUrl.startsWith('https://');
    res.cookie(cookieName(req.query.state), browserKey, { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', maxAge: 10 * 60_000, path: callbackPath(id) });
    const destination = new URL(config.authorize);
    for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: `${publicUrl}${callbackPath(id)}`, response_type: 'code', scope: id === 'apple' ? 'name email' : id === 'telegram' ? 'openid profile' : 'openid profile email', state: req.query.state, nonce: pending.nonce })) destination.searchParams.set(key, value);
    if (id === 'apple') destination.searchParams.set('response_mode', 'form_post');
    else {
      destination.searchParams.set('code_challenge', createHash('sha256').update(pending.verifier).digest('base64url'));
      destination.searchParams.set('code_challenge_method', 'S256');
    }
    res.redirect(303, destination.href);
  }));
  async function oauthCallback(req, res) {
    const id = req.params.provider, config = provider(id);
    const body = req.method === 'POST' ? req.body : req.query;
    const state = typeof body.state === 'string' ? body.state : '';
    const pending = oauthPending.get(state);
    oauthPending.delete(state);
    if (!pending || pending.provider !== id || pending.expires < Date.now() || !pending.browserHash || !safeEqual(pending.browserHash, hash(cookieValue(req, cookieName(state)) || ''))) throw fail(400, 'invalid_oauth_state');
    res.clearCookie(cookieName(state), { path: callbackPath(id) });
    if (body.error) return redirectAuth(res, pending.returnTo, 'auth_error', 'authorization_cancelled');
    try {
      if (typeof body.code !== 'string' || body.code.length > 4096) throw fail(400, 'invalid_oauth_code');
      const payload = new URLSearchParams({ grant_type: 'authorization_code', code: body.code, client_id: config.clientId, redirect_uri: `${publicUrl}${callbackPath(id)}` });
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (id === 'telegram') headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
      else payload.set('client_secret', id === 'apple' ? await appleClientSecret() : config.clientSecret);
      if (id !== 'apple') payload.set('code_verifier', pending.verifier);
      const tokenResponse = await fetch(config.token, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(15_000) });
      if (!tokenResponse.ok) throw fail(401, 'oauth_exchange_failed');
      const tokens = await tokenResponse.json();
      if (typeof tokens.id_token !== 'string') throw fail(401, 'invalid_identity_token');
      if (!jwksCache.has(id)) jwksCache.set(id, createRemoteJWKSet(new URL(config.jwks)));
      let issuer = config.issuer;
      if (id === 'microsoft') {
        const unverified = decodeJwt(tokens.id_token);
        if (typeof unverified.tid !== 'string' || !/^[0-9a-f-]{36}$/i.test(unverified.tid)) throw fail(401, 'invalid_identity_token');
        const tenant = env.MICROSOFT_TENANT_ID || 'common';
        if (!['common', 'organizations', 'consumers'].includes(tenant) && tenant.toLowerCase() !== unverified.tid.toLowerCase()) throw fail(401, 'invalid_tenant');
        issuer = `https://login.microsoftonline.com/${unverified.tid}/v2.0`;
      }
      const verified = await jwtVerify(tokens.id_token, jwksCache.get(id), { audience: config.clientId, issuer, algorithms: id === 'apple' ? ['RS256'] : ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'nonce'] });
      const claims = verified.payload;
      if (!safeEqual(claims.nonce, pending.nonce) || typeof claims.sub !== 'string') throw fail(401, 'invalid_identity_token');
      const subject = id === 'microsoft' ? `${claims.tid}:${claims.sub}` : claims.sub;
      const existing = db.prepare('SELECT user_id FROM identities WHERE provider=? AND subject=?').get(id, subject);
      if (pending.userId && !selectUser.get(pending.userId)) throw fail(401, 'unauthorized');
      if (existing && pending.userId && existing.user_id !== pending.userId) throw fail(409, 'identity_already_linked');
      let name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 60) : id === 'apple' ? 'Apple user' : id === 'telegram' ? 'Telegram user' : 'Calendar user';
      if (id === 'apple' && typeof body.user === 'string') {
        try { const info = JSON.parse(body.user); const fullName = [info.name?.firstName, info.name?.lastName].filter((value) => typeof value === 'string').join(' ').trim(); if (fullName) name = fullName.slice(0, 60); } catch { /* Apple's name is sent only once and is optional. */ }
      }
      let appleToken;
      if (id === 'apple') {
        const revocationToken = tokens.refresh_token || tokens.access_token;
        if (typeof revocationToken !== 'string') throw fail(401, 'missing_revocation_token');
        appleToken = { encrypted: encryptToken(revocationToken), type: tokens.refresh_token ? 'refresh_token' : 'access_token' };
      }
      // Only Apple's encrypted grant is retained, solely for account-deletion revocation.
      // Defer every account/link mutation until the initiating app proves its verifier.
      const code = secret();
      exchangeCodes.set(hash(code), { provider: id, subject, name, appleToken, linkUserId: pending.userId, expectedUserId: existing?.user_id || pending.userId, codeChallenge: pending.codeChallenge, expires: Date.now() + 60_000 });
      return redirectAuth(res, pending.returnTo, 'auth_code', code);
    } catch (error) {
      return redirectAuth(res, pending.returnTo, 'auth_error', error.code && /^[a-z_]+$/.test(error.code) ? error.code : 'authentication_failed');
    }
  }
  app.get('/api/auth/:provider/callback', route(oauthCallback));
  app.post('/api/auth/:provider/callback', route(oauthCallback));
  app.post('/api/auth/exchange', route((req, res) => {
    limit(`exchange:${req.socket.remoteAddress}`, 30);
    const code = text(req.body.code, 200);
    const key = hash(code), record = exchangeCodes.get(key);
    if (!record || record.expires < Date.now() || (record.expectedUserId && !selectUser.get(record.expectedUserId))) {
      exchangeCodes.delete(key);
      throw fail(401, 'invalid_exchange_code');
    }
    const verifier = req.body.codeVerifier;
    if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(createHash('sha256').update(verifier).digest('base64url'), record.codeChallenge)) throw fail(401, 'invalid_exchange_verifier');
    exchangeCodes.delete(key);
    const result = transaction(() => {
      const existing = db.prepare('SELECT user_id FROM identities WHERE provider=? AND subject=?').get(record.provider, record.subject);
      if (existing && record.linkUserId && existing.user_id !== record.linkUserId) throw fail(409, 'identity_already_linked');
      let userId = existing?.user_id || record.linkUserId;
      if (!userId) {
        userId = randomUUID();
        db.prepare('INSERT INTO users(id,name,locale,created_at) VALUES(?,?,?,?)').run(userId, record.name, 'en', Date.now());
      }
      if (!existing) db.prepare('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)').run(record.provider, record.subject, userId);
      if (record.appleToken) db.prepare('INSERT INTO provider_tokens(provider,subject,user_id,encrypted_token,token_type) VALUES(?,?,?,?,?) ON CONFLICT(provider,subject) DO UPDATE SET encrypted_token=excluded.encrypted_token,token_type=excluded.token_type').run(record.provider, record.subject, userId, record.appleToken.encrypted, record.appleToken.type);
      return newSession(userId);
    });
    res.json(result);
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));
  const distPath = options.staticDir === false ? null : options.staticDir || resolve(dirname(fileURLToPath(import.meta.url)), '../dist/client');
  if (distPath && existsSync(resolve(distPath, 'index.html'))) {
    app.use(express.static(distPath, { index: false, dotfiles: 'deny' }));
    app.get(/.*/, (req, res) => res.sendFile(resolve(distPath, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500);
    if (status >= 500 && status !== 503 && !options.quiet) console.error('[OpenCalendar]', error.message);
    const code = error.code && /^[a-z_]+$/.test(error.code) ? error.code : status === 400 ? 'invalid_input' : status === 413 ? 'request_too_large' : 'server_error';
    res.status(status).json({ error: code, code });
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of windows) if (value.reset < now) windows.delete(key);
    for (const [key, value] of oauthPending) if (value.expires < now) oauthPending.delete(key);
    for (const [key, value] of exchangeCodes) if (value.expires < now) exchangeCodes.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
  }, 60_000);
  cleanup.unref();
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(cleanup);
    for (const stream of streams) stream.response.end();
    streams.clear();
    db.close();
  }
  return { app, db, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = createApp();
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  const server = runtime.app.listen(port, host, () => console.log(`OpenCalendar API listening on http://${host}:${port}`));
  const stop = () => { runtime.close(); server.close(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
