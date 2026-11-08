import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dict, errorText, isLocale, locales, localeTags, text } from '../src/i18n.ts';

test('all four requested languages have complete, non-empty copy with matching types', () => {
  assert.deepEqual(locales.map(({ code }) => code), ['ru', 'de', 'en', 'fr']);
  const expectedKeys = Object.keys(dict.en).sort();
  for (const { code, label, short } of locales) {
    assert.ok(label.trim());
    assert.match(short, /^[A-Z]{2}$/);
    assert.ok(localeTags[code]);
    assert.deepEqual(Object.keys(dict[code]).sort(), expectedKeys, `${code} has missing or unexpected keys`);
    for (const key of expectedKeys) {
      const value = dict[code][key];
      if (Array.isArray(dict.en[key])) {
        assert.ok(Array.isArray(value), `${code}.${key} must be an array`);
        assert.equal(value.length, dict.en[key].length);
        assert.ok(value.every((entry) => typeof entry === 'string' && entry.trim()));
      } else {
        assert.equal(typeof value, 'string', `${code}.${key} must be text`);
        assert.ok(value.trim(), `${code}.${key} must not be empty`);
      }
    }
    assert.equal(dict[code].weekdaysShort.length, 7);
    assert.equal(dict[code].weekdaysLong.length, 7);
    assert.equal(dict[code].months.length, 12);
  }
});

test('interpolated copy has the same placeholders in each language and resolves them', () => {
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const variables = { count: 3, provider: 'Google', date: '06.11.2026' };
  for (const key of Object.keys(dict.en)) {
    if (typeof dict.en[key] !== 'string') continue;
    for (const { code } of locales) {
      assert.deepEqual(placeholders(dict[code][key]), placeholders(dict.en[key]), `${code}.${key} placeholder mismatch`);
      const result = text(code, key, variables);
      assert.doesNotMatch(result, /\{\w+\}/, `${code}.${key} leaves a visible placeholder`);
    }
  }
  assert.equal(text('ru', 'membersLabel', { count: 5 }), 'Участников: 5');
  assert.equal(text('en', 'signInWith', { provider: '<Google>' }), 'Continue with <Google>');
  assert.equal(text('en', 'signInWith'), 'Continue with {provider}');
});

test('current app dictionary references exist in every language', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const used = new Set([...app.matchAll(/\bt\.([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]));
  for (const { code } of locales) {
    for (const key of used) assert.ok(key in dict[code], `Missing UI copy: ${code}.${key}`);
  }
});

test('API and OAuth errors display localized copy without internal codes or placeholders', () => {
  for (const { code } of locales) {
    for (const errorCode of [
      'invalid_input', 'invalid_time', 'group_not_found', 'event_not_found', 'forbidden',
      'invite_not_found', 'rate_limited', 'native_api_missing', 'provider_not_configured',
      'authorization_cancelled', 'invalid_oauth_state', 'invalid_exchange_code',
      'authentication_failed', 'identity_already_linked', 'provider_revocation_failed',
    ]) {
      const message = errorText(code, errorCode);
      assert.ok(message.trim());
      assert.notEqual(message, errorCode);
      assert.doesNotMatch(message, /\{\w+\}/);
    }
    assert.equal(errorText(code, 'unknown_future_error'), dict[code].error);
    assert.equal(errorText(code, 'constructor'), dict[code].error);
    assert.equal(errorText(code, '__proto__'), dict[code].error);
    assert.equal(errorText(code, 'toString'), dict[code].error);
  }
  assert.equal(errorText('ru', 'authorization_cancelled'), 'Вход отменён.');
  assert.equal(errorText('de', 'provider_not_configured'), dict.de.providerNotConfigured);
});

test('locale validation rejects unsupported and malformed values', () => {
  for (const code of ['ru', 'de', 'en', 'fr']) assert.equal(isLocale(code), true);
  for (const value of ['it', 'EN', 'en-GB', '', null, undefined, 1, {}, ['ru']]) assert.equal(isLocale(value), false);
});
