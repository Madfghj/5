import { fail, text } from './validation.mjs';

const choices = {
  avatar: new Set(['mint', 'lavender', 'stone', 'sunset']),
  theme: new Set(['meadow', 'forest', 'dusk']),
  palette: new Set(['sage', 'white', 'sand', 'cocoa']),
  defaultView: new Set(['month', 'week', 'schedule']),
};
const columns = { avatar: 'avatar', theme: 'theme', palette: 'palette', tagline: 'tagline', defaultView: 'default_view', reducedMotion: 'reduced_motion', compactCalendar: 'compact_calendar' };

export function customizationShape(row) {
  return { avatar: row.avatar || 'mint', theme: row.theme || 'meadow', palette: row.palette || 'sage', tagline: row.tagline || '', defaultView: row.default_view || 'month', reducedMotion: Boolean(row.reduced_motion), compactCalendar: Boolean(row.compact_calendar) };
}

export function customizationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'invalid_customization');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(columns, key)) throw fail(400, 'invalid_customization');
    if (Object.hasOwn(choices, key)) {
      if (!choices[key].has(item)) throw fail(400, 'invalid_customization');
      result[key] = item;
    } else if (key === 'tagline') {
      result[key] = text(item, 80, false);
    } else {
      if (typeof item !== 'boolean') throw fail(400, 'invalid_customization');
      result[key] = item;
    }
  }
  return result;
}

// Column names come only from the strict allowlist; update only supplied fields.
export function customizationCommand(userId, changes) {
  const keys = Object.keys(changes);
  if (!keys.length) return null;
  const fields = keys.map((key) => columns[key]);
  return [`INSERT INTO user_customization(user_id,${fields.join(',')}) VALUES(${Array(keys.length + 1).fill('?').join(',')}) ON CONFLICT(user_id) DO UPDATE SET ${fields.map((field) => `${field}=excluded.${field}`).join(',')}`, userId, ...keys.map((key) => typeof changes[key] === 'boolean' ? Number(changes[key]) : changes[key])];
}
