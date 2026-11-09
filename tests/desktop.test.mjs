import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAuthSubscription, desktopAuthCallback, desktopPkceChallenge, externalHttpsUrl, observeWindowLifecycle, publicHttpsOrigin } from '../src/desktop.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const callback = character => `space.opencalendar.app://auth#auth_code=${character.repeat(43)}`;

test('desktop PKCE matches RFC 7636 S256 without relying on secure-context SubtleCrypto', () => {
  assert.equal(desktopPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.throws(() => desktopPkceChallenge('short'));
});

test('desktop auth accepts only the exact registered return URL and a single valid callback value', () => {
  assert.equal(desktopAuthCallback(callback('a')).code, 'a'.repeat(43));
  assert.equal(desktopAuthCallback(callback('a').replace('://auth#', '://auth/#')).code, 'a'.repeat(43));
  assert.equal(desktopAuthCallback('space.opencalendar.app://auth#auth_error=authorization_cancelled').error, 'authorization_cancelled');
  for (const value of [
    `https://auth#auth_code=${'a'.repeat(43)}`,
    callback('a').replace('://auth', '://auth.evil'),
    callback('a').replace('://auth', '://user@auth'),
    callback('a').replace('://auth', '://auth:123'),
    callback('a').replace('://auth', '://auth/other'),
    callback('a').replace('#', '?untrusted=1#'),
    `${callback('a')}&auth_code=${'b'.repeat(43)}`,
    `${callback('a')}&auth_error=authorization_cancelled`,
    'space.opencalendar.app://auth#auth_code=short',
    'space.opencalendar.app://auth#auth_error=<script>',
  ]) assert.equal(desktopAuthCallback(value), null, value);
});

test('desktop external opener rejects executable, local-file, plaintext and credential-bearing links', () => {
  assert.equal(externalHttpsUrl('https://signal.me/#contact'), 'https://signal.me/#contact');
  for (const value of ['javascript:alert(1)', 'file:///Users/test/secrets', 'data:text/html,test', 'http://example.com', 'https://user:password@example.com', ' https://example.com', 'https://example.com/\nnext']) {
    assert.throws(() => externalHttpsUrl(value));
  }
  assert.equal(publicHttpsOrigin('https://calendar.example'), true);
  for (const value of ['', 'http://calendar.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://calendar.example/api', 'https://calendar.example#token', 'https://user@calendar.example']) assert.equal(publicHttpsOrigin(value), false, value);
});

test('live auth listener precedes cold read and deduplicates hot/cold callbacks across resubscriptions', async () => {
  const cold = deferred(), calls = [], handlers = new Set();
  const subscribe = createDesktopAuthSubscription({
    onOpenUrl: async handler => { calls.push('listen'); handlers.add(handler); return () => handlers.delete(handler); },
    getCurrent: () => { calls.push('cold'); return cold.promise; },
  });
  const received = [], stop = subscribe(url => received.push(url));
  await tick();
  assert.deepEqual(calls, ['listen', 'cold']);
  for (const handler of handlers) handler([callback('a'), callback('a').replace('://auth', '://wrong')]);
  cold.resolve([callback('a')]);
  await tick();
  assert.deepEqual(received, [callback('a')]);
  stop();
  const next = [], stopNext = subscribe(url => next.push(url));
  await tick();
  for (const handler of handlers) handler([callback('a'), callback('b')]);
  await tick();
  assert.deepEqual(next, [callback('b')]);
  assert.equal(calls.filter(value => value === 'cold').length, 1);
  stopNext(); assert.equal(handlers.size, 0);
});

test('a failed legacy exchange can accept the callback again but a completed exchange cannot', async () => {
  let deliver, exchanges = 0;
  const subscribe = createDesktopAuthSubscription({
    onOpenUrl: async handler => { deliver = handler; return () => {}; },
    getCurrent: async () => null,
  });
  const stop = subscribe(async () => ++exchanges > 1);
  await tick();
  deliver([callback('a'), callback('a')]);
  await tick();
  assert.equal(exchanges, 1);
  deliver([callback('a')]);
  await tick();
  assert.equal(exchanges, 2);
  deliver([callback('a')]);
  await tick();
  assert.equal(exchanges, 2);
  stop();
});

test('React effect cleanup during cold read does not lose the launch callback for the replacement listener', async () => {
  const cold = deferred(); let reads = 0;
  const subscribe = createDesktopAuthSubscription({ onOpenUrl: async () => () => {}, getCurrent: () => { reads++; return cold.promise; } });
  const old = [], current = [], stopOld = subscribe(url => old.push(url));
  await tick(); stopOld();
  const stopCurrent = subscribe(url => current.push(url));
  await tick(); cold.resolve([callback('c')]); await tick();
  assert.deepEqual(old, []);
  assert.deepEqual(current, [callback('c')]);
  assert.equal(reads, 1); stopCurrent();
});

test('cleanup before asynchronous registration removes the late listener and skips cold access', async () => {
  const registration = deferred(); let removed = 0, reads = 0;
  const subscribe = createDesktopAuthSubscription({ onOpenUrl: () => registration.promise, getCurrent: async () => { reads++; return [callback('d')]; } });
  const received = [], stop = subscribe(url => received.push(url));
  stop(); registration.resolve(() => { removed++; }); await tick();
  assert.equal(removed, 1); assert.equal(reads, 0); assert.deepEqual(received, []);
});

test('desktop focus events win over stale initial snapshots and close awaits the leave request', async () => {
  const initial = deferred(), leave = deferred();
  let focusHandler, closeHandler, removed = 0, left = 0;
  const focuses = [];
  const watcher = observeWindowLifecycle({
    onFocusChanged: async handler => { focusHandler = handler; return () => { removed++; }; },
    onCloseRequested: async handler => { closeHandler = handler; return () => { removed++; }; },
    isFocused: () => initial.promise,
  }, { focus: value => focuses.push(value), close: () => { left++; return leave.promise; } });
  await tick(); focusHandler({ payload: true }); initial.resolve(false);
  assert.equal(await watcher.ready, true); assert.deepEqual(focuses, [true]);
  focusHandler({ payload: false }); assert.deepEqual(focuses, [true, false]);
  let closed = false;
  const closing = closeHandler().then(() => { closed = true; });
  await tick(); assert.equal(left, 1); assert.equal(closed, false);
  leave.resolve(); await closing; assert.equal(closed, true);
  watcher.dispose(); assert.equal(removed, 2);
});

test('a focus-only observer does not install another close handler, and disposed observers release late listeners', async () => {
  const pending = deferred(); let closeListeners = 0, removed = 0, focusReads = 0;
  const watcher = observeWindowLifecycle({
    onFocusChanged: () => pending.promise,
    onCloseRequested: async () => { closeListeners++; return () => {}; },
    isFocused: async () => { focusReads++; return true; },
  }, { focus: () => assert.fail('Disposed observer must not update presence') });
  watcher.dispose(); pending.resolve(() => { removed++; }); await watcher.ready;
  assert.equal(closeListeners, 0); assert.equal(removed, 1); assert.equal(focusReads, 0);
});
