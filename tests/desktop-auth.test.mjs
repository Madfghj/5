import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDesktopAuthController } from '../src/desktop-auth.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const epoch = 1_800_000_000_000;
const pollToken = 'A'.repeat(43);
const verifier = 'B'.repeat(42) + 'A';
const verificationCode = '004281';
const proof = { pollToken, codeVerifier: verifier };
const browserUrl = 'https://calendar.example/api/auth/google/authorize?state=opaque';
const session = { token: 'session', user: { id: 'profile' } };
const restored = { version: 1, provider: 'google', pollToken, verifier, verificationCode, expiresAt: epoch + 10_000 };
const startResult = { url: browserUrl, expiresAt: epoch + 10_000, verificationCode };
const hash = text => createHash('sha256').update(text).digest('base64url');

function setup(t, overrides = {}) {
  const waits = [], updates = [], completed = [], errors = [];
  let saved = null, calls = 0;
  const controller = createDesktopAuthController({
    load: () => null,
    save: value => { saved = value; },
    start: async () => startResult,
    status: async () => ({ status: 'pending' }),
    exchange: async () => session,
    cancel: async () => {},
    open: async () => {},
    complete: value => completed.push(value),
    error: value => errors.push(value),
    now: () => epoch,
    random: () => calls++ % 2 ? verifier : pollToken,
    sleep: (ms, signal) => new Promise(resolve => {
      const finish = () => { signal.removeEventListener('abort', finish); resolve(); };
      if (signal.aborted) finish();
      else {
        signal.addEventListener('abort', finish, { once: true });
        waits.push({ ms, finish });
      }
    }),
    ...overrides,
  });
  const subscribe = () => {
    const stop = controller.subscribe(value => updates.push(value));
    t.after(stop);
    return stop;
  };
  return { controller, subscribe, waits, updates, completed, errors, getSaved: () => saved };
}

test('desktop signs in only after browser confirmation and starts polling before opening the browser', async t => {
  const actions = [], statuses = ['pending', 'confirm', 'ready'];
  let exchanges = 0;
  const state = setup(t, {
    start: async (provider, body) => {
      actions.push('start');
      assert.equal(provider, 'google');
      assert.deepEqual(body, {
        codeChallenge: hash(verifier), desktopPollHash: hash(pollToken),
        returnTo: 'space.opencalendar.app://auth', locale: 'ru',
      });
      return startResult;
    },
    status: async value => {
      actions.push('status');
      assert.deepEqual(value, proof);
      return { status: statuses.shift(), expiresAt: epoch + 20_000 };
    },
    open: async url => { actions.push('open'); assert.equal(url, browserUrl); },
    exchange: async value => {
      exchanges++;
      assert.deepEqual(value, { code: pollToken, codeVerifier: verifier });
      return session;
    },
  });
  state.subscribe();
  assert.equal(await state.controller.begin('google', 'ru'), true);
  assert.deepEqual(actions, ['start', 'status', 'open']);
  assert.equal(await state.controller.begin('telegram', 'ru'), false);
  assert.deepEqual(state.controller.getView(), { provider: 'google', phase: 'waiting', verificationCode });
  assert.equal(state.getSaved().expiresAt, epoch + 20_000);
  state.waits.shift().finish();
  await tick();
  assert.deepEqual(state.controller.getView(), { provider: 'google', phase: 'confirm', verificationCode });
  assert.equal(exchanges, 0);
  state.waits.shift().finish();
  await tick();
  assert.equal(exchanges, 1);
  assert.deepEqual(state.completed, [session]);
  assert.equal(state.controller.hasPending(), false);
  assert.equal(state.getSaved(), null);
});

test('a restored attempt retries transient status and exchange failures with the same proof', async t => {
  let statusCalls = 0, exchanges = 0;
  const state = setup(t, {
    load: () => ({ ...restored }),
    status: async value => {
      assert.deepEqual(value, proof);
      if (++statusCalls === 1) throw new TypeError('Offline');
      return { status: 'ready' };
    },
    exchange: async value => {
      assert.deepEqual(value, { code: pollToken, codeVerifier: verifier });
      if (++exchanges === 1) throw Object.assign(new Error('Temporary upstream failure'), { status: 503 });
      return session;
    },
    open: async () => assert.fail('Restoring an attempt must not reopen its one-time browser URL'),
  });
  assert.equal(state.controller.getView().verificationCode, verificationCode);
  state.subscribe();
  await tick();
  assert.equal(state.controller.getView().phase, 'reconnecting');
  state.waits.shift().finish();
  await tick();
  assert.equal(state.controller.getView().phase, 'reconnecting');
  assert.equal(exchanges, 1);
  state.waits.shift().finish();
  await tick();
  assert.equal(exchanges, 2);
  assert.deepEqual(state.completed, [session]);
  assert.deepEqual(state.errors, []);
});

test('React resubscription does not abort or duplicate a server-claimed exchange', async t => {
  const reply = deferred();
  let calls = 0, exchangeSignal;
  const state = setup(t, {
    load: () => ({ ...restored }),
    status: async () => ({ status: 'ready' }),
    exchange: (_proof, signal) => { calls++; exchangeSignal = signal; return reply.promise; },
  });
  const stop = state.subscribe();
  await tick();
  stop();
  state.subscribe();
  await tick();
  assert.equal(calls, 1);
  assert.equal(exchangeSignal.aborted, false);
  reply.resolve(session);
  await tick();
  assert.deepEqual(state.completed, [session]);
  assert.equal(state.getSaved(), null);
});

test('cancelling a desktop attempt prevents a late ready response from signing in', async t => {
  const status = deferred(), cancellations = [];
  const state = setup(t, {
    status: () => status.promise,
    cancel: async value => cancellations.push(value),
    exchange: async () => assert.fail('Cancelled attempt must never exchange'),
  });
  state.subscribe();
  await state.controller.begin('telegram', 'en');
  await state.controller.cancel();
  status.resolve({ status: 'ready' });
  await tick();
  assert.deepEqual(cancellations, [proof]);
  assert.deepEqual(state.completed, []);
  assert.equal(state.getSaved(), null);
});

test('desktop opener failure and expired saved proofs surface an error and release the attempt', async t => {
  const cancellations = [];
  const state = setup(t, {
    load: () => ({ ...restored, expiresAt: epoch }),
    cancel: async value => cancellations.push(value),
    open: async () => { throw new Error('Browser unavailable'); },
  });
  state.subscribe();
  assert.deepEqual(state.errors, ['oauth_expired']);
  assert.equal(state.getSaved(), null);
  assert.equal(await state.controller.begin('google', 'en'), false);
  assert.deepEqual(state.errors, ['oauth_expired', 'desktop_browser_open_failed']);
  assert.deepEqual(cancellations, [proof]);
  assert.equal(state.controller.hasPending(), false);
});
