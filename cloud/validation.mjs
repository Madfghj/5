export const fail = (status, code) => Object.assign(new Error(code), { status, code });
export function text(value, max, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) throw fail(400, 'invalid_input');
  return value.trim();
}
export const optionalText = (value, max) => value == null ? '' : text(value, max, false);
export const locales = new Set(['en', 'ru', 'de', 'fr']);
export const responses = new Set(['yes', 'no', 'maybe']);
export const colors = { green: '#729b75', blue: '#6e9fc1', orange: '#d7a25e', purple: '#9b85ca', pink: '#cd859a', yellow: '#d7c866' };
export function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) throw fail(400, 'invalid_email');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@\u0000-\u001f]+@[^\s@\u0000-\u001f]+\.[^\s@\u0000-\u001f]+$/.test(email)) throw fail(400, 'invalid_email');
  return email;
}
export function password(value, registration = false) {
  if (typeof value !== 'string' || value.length < (registration ? 12 : 1) || value.length > 128) throw fail(400, registration ? 'weak_password' : 'invalid_credentials');
  return value;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function slot(time) {
  if (typeof time !== 'string' || !/^(?:0[89]|1\d|20):(?:00|30)$/.test(time)) return -1;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m <= 1200 ? h * 60 + m : -1;
}
export function availabilityInput(value) {
  if (!validDate(value.date)) throw fail(400, 'invalid_date');
  if (!responses.has(value.value)) throw fail(400, 'invalid_response');
  if (value.time != null && slot(value.time) < 480) throw fail(400, 'invalid_time');
  return { date: value.date, value: value.value, time: value.time ?? null, note: optionalText(value.note, 280) };
}
export function eventInput(value) {
  const title = text(value.title, 120);
  if (!validDate(value.date)) throw fail(400, 'invalid_date');
  const start = slot(value.startTime), end = slot(value.endTime);
  if (start < 480 || end < 480 || end <= start) throw fail(400, 'invalid_time');
  return { title, date: value.date, startTime: value.startTime, endTime: value.endTime, location: optionalText(value.location, 200), notes: optionalText(value.notes, 2000) };
}
export function contactLinks(current, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw fail(400, 'invalid_contact');
  const hosts = { telegram: ['t.me', 'telegram.me'], whatsapp: ['wa.me'], signal: ['signal.me'] };
  const result = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (!Object.hasOwn(hosts, key)) throw fail(400, 'invalid_contact');
    if (value === '' || value === null) { delete result[key]; continue; }
    if (typeof value !== 'string' || value.length > 512) throw fail(400, 'invalid_contact');
    let url;
    try { url = new URL(value); } catch { throw fail(400, 'invalid_contact'); }
    if (url.protocol !== 'https:' || !hosts[key].includes(url.hostname) || url.username || url.password || url.port || (url.pathname === '/' && !url.hash)) throw fail(400, 'invalid_contact');
    result[key] = url.href;
  }
  return result;
}
