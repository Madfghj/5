import { AUTH_RETURN_URL, desktopPkceChallenge, externalHttpsUrl } from './desktop.ts';

export type DesktopAuthProvider = 'google' | 'apple' | 'microsoft' | 'telegram';
type Attempt = {
  version: 1;
  provider: DesktopAuthProvider;
  pollToken: string;
  verifier: string;
  expiresAt: number;
  verificationCode: string | null;
};
export type DesktopAuthAttempt = Attempt & { verificationCode: string };
export type DesktopAuthView = {
  provider: DesktopAuthProvider;
  phase: 'opening' | 'waiting' | 'confirm' | 'reconnecting' | 'completing';
  verificationCode: string | null;
};
export type DesktopAuthStatus = {
  status: 'pending' | 'confirm' | 'ready' | 'error' | 'cancelled';
  error?: string;
  expiresAt?: number;
};
type Proof = { pollToken: string; codeVerifier: string };
type StartBody = { codeChallenge: string; desktopPollHash: string; returnTo: string; locale: string };
type Dependencies<T> = {
  load: () => unknown;
  save: (value: DesktopAuthAttempt | null) => void;
  start: (provider: DesktopAuthProvider, body: StartBody, signal: AbortSignal) => Promise<{ url: string; expiresAt: number; verificationCode: string }>;
  status: (proof: Proof, signal: AbortSignal) => Promise<DesktopAuthStatus>;
  exchange: (proof: { code: string; codeVerifier: string }, signal: AbortSignal) => Promise<T>;
  cancel: (proof: Proof, signal: AbortSignal) => Promise<unknown>;
  open: (url: string) => Promise<void>;
  complete: (result: T) => void;
  error: (code: string) => void;
  now?: () => number;
  random?: () => string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const tokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const verificationPattern = /^\d{6}$/;
const providers = new Set(['google', 'apple', 'microsoft', 'telegram']);
const maximumLifetime = 10 * 60_000;

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function savedAttempt(value: unknown): value is DesktopAuthAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as DesktopAuthAttempt;
  return attempt.version === 1 && providers.has(attempt.provider)
    && typeof attempt.pollToken === 'string' && tokenPattern.test(attempt.pollToken)
    && typeof attempt.verifier === 'string' && tokenPattern.test(attempt.verifier)
    && typeof attempt.verificationCode === 'string' && verificationPattern.test(attempt.verificationCode)
    && Number.isFinite(attempt.expiresAt);
}

function plausibleExpiry(expiresAt: number, now: number) {
  return Number.isFinite(expiresAt) && expiresAt <= now + maximumLifetime + 30_000;
}

function terminalError(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'desktop_auth_network_error';
}

async function request<R>(action: (signal: AbortSignal) => Promise<R>, parent?: AbortSignal): Promise<R> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) controller.abort();
  const timer = setTimeout(abort, 12_000);
  try { return await action(controller.signal); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}

// The app keeps its proof locally and completes the exchange only after the
// browser confirms the code shown in this app.
export function createDesktopAuthController<T>(dependencies: Dependencies<T>) {
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || pause;
  let restored: unknown;
  try { restored = dependencies.load(); } catch { /* storage is optional */ }
  const expired = savedAttempt(restored) && restored.expiresAt <= now();
  let attempt: Attempt | null = savedAttempt(restored) && !expired && plausibleExpiry(restored.expiresAt, now()) ? restored : null;
  let cleanStorage = restored != null && !attempt;
  let phase: DesktopAuthView['phase'] = 'waiting';
  let loop: Promise<void> | null = null;
  let loopAbort: AbortController | null = null;
  let startAbort: AbortController | null = null;
  const subscribers = new Set<(view: DesktopAuthView | null) => void>();

  const view = (): DesktopAuthView | null => attempt && {
    provider: attempt.provider,
    phase,
    verificationCode: attempt.verificationCode,
  };
  const notify = () => {
    const value = view();
    subscribers.forEach(listener => listener(value));
  };
  function persist(value: Attempt | null) {
    const verificationCode = value?.verificationCode;
    try { dependencies.save(value && verificationCode ? { ...value, verificationCode } : null); }
    catch { /* keep the current proof in memory */ }
  }
  function clear(value: Attempt, error?: string) {
    if (attempt !== value) return;
    attempt = null;
    loopAbort?.abort();
    persist(null);
    notify();
    if (error) dependencies.error(error);
  }
  const proof = (value: Attempt): Proof => ({ pollToken: value.pollToken, codeVerifier: value.verifier });
  const cancelRemote = (value: Attempt) => request(signal => dependencies.cancel(proof(value), signal)).catch(() => {});

  function run() {
    if (loop || !attempt?.verificationCode || !subscribers.size) return;
    const controller = new AbortController();
    loopAbort = controller;
    loop = (async () => {
      let failures = 0;
      while (attempt && !controller.signal.aborted) {
        const value: Attempt = attempt;
        if (value.expiresAt <= now()) { clear(value, 'oauth_expired'); break; }
        try {
          const result = await request(signal => dependencies.status(proof(value), signal), controller.signal);
          if (attempt !== value || controller.signal.aborted) break;
          if (result.expiresAt !== undefined && plausibleExpiry(result.expiresAt, now())) {
            if (value.expiresAt !== result.expiresAt) {
              value.expiresAt = result.expiresAt;
              persist(value);
            }
          }
          if (value.expiresAt <= now()) { clear(value, 'oauth_expired'); break; }
          if (result.status === 'error') { clear(value, result.error || 'authentication_failed'); break; }
          if (result.status === 'cancelled') { clear(value, 'authorization_cancelled'); break; }
          if (result.status === 'ready') {
            phase = 'completing';
            notify();
            // A React resubscription must not abort an exchange the server
            // may have consumed. Explicit cancellation ignores a late result.
            const session = await request(signal => dependencies.exchange({ code: value.pollToken, codeVerifier: value.verifier }, signal));
            if (attempt === value) {
              dependencies.complete(session);
              clear(value);
            }
            break;
          }
          if (result.status !== 'pending' && result.status !== 'confirm') {
            clear(value, 'authentication_failed');
            break;
          }
          failures = 0;
          phase = result.status === 'confirm' ? 'confirm' : 'waiting';
          notify();
        } catch (error) {
          if (attempt !== value || controller.signal.aborted) break;
          if (terminalError(error)) { clear(value, errorCode(error)); break; }
          failures++;
          phase = 'reconnecting';
          notify();
        }
        if (attempt === value) {
          const delay = Math.min(2000 * 2 ** Math.min(Math.max(failures - 1, 0), 3), 15_000);
          await sleep(Math.min(delay, Math.max(0, value.expiresAt - now())), controller.signal);
        }
      }
    })().finally(() => {
      loop = null;
      loopAbort = null;
      run();
    });
  }

  return {
    getView: view,
    hasPending: () => attempt !== null,
    subscribe(listener: (value: DesktopAuthView | null) => void) {
      subscribers.add(listener);
      listener(view());
      if (cleanStorage) {
        cleanStorage = false;
        persist(null);
        if (expired) dependencies.error('oauth_expired');
      }
      run();
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) loopAbort?.abort();
      };
    },
    async begin(provider: DesktopAuthProvider, locale: string) {
      if (attempt) return false;
      const random = dependencies.random || randomToken;
      const value: Attempt = {
        version: 1, provider, pollToken: random(), verifier: random(),
        expiresAt: now() + maximumLifetime, verificationCode: null,
      };
      attempt = value;
      phase = 'opening';
      notify();
      const controller = new AbortController();
      startAbort = controller;
      try {
        const result = await request(signal => dependencies.start(provider, {
          codeChallenge: desktopPkceChallenge(value.verifier),
          desktopPollHash: desktopPkceChallenge(value.pollToken),
          returnTo: AUTH_RETURN_URL,
          locale,
        }, signal), controller.signal);
        if (attempt !== value) { void cancelRemote(value); return false; }
        if (!plausibleExpiry(result.expiresAt, now()) || result.expiresAt <= now()
          || typeof result.verificationCode !== 'string' || !verificationPattern.test(result.verificationCode)) {
          clear(value, 'authentication_failed');
          void cancelRemote(value);
          return false;
        }
        value.expiresAt = result.expiresAt;
        value.verificationCode = result.verificationCode;
        persist(value);
        phase = 'waiting';
        notify();
        run();
        try { await dependencies.open(externalHttpsUrl(result.url)); }
        catch {
          clear(value, 'desktop_browser_open_failed');
          void cancelRemote(value);
          return false;
        }
        return true;
      } catch (error) {
        clear(value, errorCode(error));
        void cancelRemote(value);
        return false;
      } finally {
        if (startAbort === controller) startAbort = null;
      }
    },
    async cancel() {
      const value = attempt;
      if (!value) return;
      startAbort?.abort();
      clear(value);
      await cancelRemote(value);
    },
  };
}
