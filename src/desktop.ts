import { isTauri } from '@tauri-apps/api/core';
import { sha256 } from '@noble/hashes/sha2.js';

// A desktop build flag does not prove that native APIs are available. This
// documented runtime check also keeps browser previews and Capacitor separate.
export const desktop = isTauri();
export const AUTH_RETURN_URL = 'space.opencalendar.app://auth';
type Unlisten = () => void;

// WKWebView custom origins may not expose SubtleCrypto. Keep S256 PKCE with
// the already bundled SHA-256 implementation; randomness still comes from
// crypto.getRandomValues when the verifier is created.
export function desktopPkceChallenge(verifier: string): string {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('Invalid PKCE verifier');
  return btoa(String.fromCharCode(...sha256(new TextEncoder().encode(verifier)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function publicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
      && !['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export function externalHttpsUrl(value: string): string {
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid external URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links can be opened');
  return url.href;
}

export function desktopAuthCallback(value: string): { url: string; code: string | null; error: string | null } | null {
  try {
    const url = new URL(value);
    if (`${url.protocol}//${url.host}` !== AUTH_RETURN_URL || !['', '/'].includes(url.pathname) || url.username || url.password || url.search) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    const code = params.get('auth_code'), error = params.get('auth_error');
    if ([...params].length !== 1 || (code ? !/^[A-Za-z0-9_-]{43,200}$/.test(code) : !error || !/^[a-z_]{1,100}$/.test(error))) return null;
    return { url: url.href, code, error };
  } catch { return null; }
}

type LinkSource = {
  onOpenUrl: (handler: (urls: string[]) => void) => Promise<Unlisten>;
  getCurrent: () => Promise<string[] | null>;
};

// Install the live listener before reading the launch URL. One shared cold read
// survives React's effect setup/cleanup cycle; consumed codes never replay when
// a locale change resubscribes the listener.
export function createDesktopAuthSubscription(source: LinkSource) {
  let coldUrls: Promise<string[] | null> | undefined, coldDelivered = false;
  const consumedCodes = new Set<string>(), inFlightCodes = new Set<string>();
  let lastError = '', lastErrorAt = 0;
  return (handler: (url: string) => void | boolean | Promise<void | boolean>, onError: (error: unknown) => void = () => {}) => {
    let disposed = false, unlisten: Unlisten | undefined;
    const deliver = (urls: string[]) => {
      if (disposed) return;
      for (const value of urls) {
        const callback = desktopAuthCallback(value);
        if (!callback) continue;
        if (callback.code) {
          if (consumedCodes.has(callback.code) || inFlightCodes.has(callback.code)) continue;
          const code = callback.code;
          inFlightCodes.add(code);
          void Promise.resolve().then(() => handler(callback.url)).then(accepted => {
            if (accepted !== false) {
              consumedCodes.add(code);
              if (consumedCodes.size > 64) consumedCodes.delete(consumedCodes.values().next().value!);
            }
          }).catch(onError).finally(() => inFlightCodes.delete(code));
          continue;
        } else {
          const now = Date.now();
          if (lastError === callback.url && now - lastErrorAt < 2000) continue;
          lastError = callback.url; lastErrorAt = now;
        }
        handler(callback.url);
      }
    };
    void (async () => {
      unlisten = await source.onOpenUrl(deliver);
      if (disposed) { unlisten(); return; }
      coldUrls ||= source.getCurrent();
      const urls = await coldUrls;
      if (!disposed && !coldDelivered) { coldDelivered = true; if (urls) deliver(urls); }
    })().catch(error => { if (!disposed) onError(error); });
    return () => { disposed = true; unlisten?.(); };
  };
}

const authSubscription = createDesktopAuthSubscription({
  onOpenUrl: async handler => (await import('@tauri-apps/plugin-deep-link')).onOpenUrl(handler),
  getCurrent: async () => (await import('@tauri-apps/plugin-deep-link')).getCurrent(),
});
export function observeDesktopAuth(handler: (url: string) => void | boolean | Promise<void | boolean>, onError?: (error: unknown) => void) {
  return desktop ? authSubscription(handler, onError) : () => {};
}

type WindowSource = {
  onFocusChanged: (handler: (event: { payload: boolean }) => void) => Promise<Unlisten>;
  onCloseRequested: (handler: () => void | Promise<void>) => Promise<Unlisten>;
  isFocused: () => Promise<boolean>;
};
type WindowCallbacks = { focus: (focused: boolean) => void; close?: () => void | Promise<void>; error?: (error: unknown) => void };
export function observeWindowLifecycle(source: WindowSource, callbacks: WindowCallbacks) {
  let disposed = false, focusVersion = 0, focused = false;
  const listeners: Unlisten[] = [];
  const attach = async (pending: Promise<Unlisten>) => {
    const unlisten = await pending;
    if (disposed) unlisten(); else listeners.push(unlisten);
  };
  const ready = (async () => {
    await Promise.all([
      attach(source.onFocusChanged(event => {
        if (disposed) return;
        focusVersion++; focused = event.payload; callbacks.focus(focused);
      })),
      callbacks.close ? attach(source.onCloseRequested(async () => {
        if (disposed) return;
        focusVersion++; focused = false;
        // Tauri waits for this handler before destroying the window. Bound the
        // final leave request so closing never waits on an unavailable network.
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1200);
          void Promise.resolve().then(callbacks.close).catch(() => {}).finally(() => { clearTimeout(timer); resolve(); });
        });
      })) : Promise.resolve(),
    ]);
    if (disposed) return false;
    const version = focusVersion, initial = await source.isFocused();
    if (!disposed && version === focusVersion) { focused = initial; callbacks.focus(focused); }
    return focused;
  })().catch(error => { if (!disposed) callbacks.error?.(error); return focused; });
  return { ready, dispose: () => { disposed = true; listeners.splice(0).forEach(unlisten => unlisten()); } };
}
export function observeDesktopWindow(callbacks: WindowCallbacks) {
  let disposed = false, watcher: ReturnType<typeof observeWindowLifecycle> | undefined;
  const ready = desktop ? import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    if (disposed) return false;
    watcher = observeWindowLifecycle(getCurrentWindow(), callbacks);
    return watcher.ready;
  }).catch(error => { if (!disposed) callbacks.error?.(error); return false; }) : Promise.resolve(true);
  return { ready, dispose: () => { disposed = true; watcher?.dispose(); } };
}

export async function openDesktopHttps(value: string) {
  const url = externalHttpsUrl(value);
  if (!desktop) throw new Error('Desktop runtime unavailable');
  await (await import('@tauri-apps/plugin-opener')).openUrl(url);
}
export async function copyDesktopText(value: string) {
  if (!desktop) throw new Error('Desktop runtime unavailable');
  await (await import('@tauri-apps/plugin-clipboard-manager')).writeText(value);
}
export async function saveDesktopCalendar(contents: string): Promise<boolean> {
  if (!desktop) throw new Error('Desktop runtime unavailable');
  const { save } = await import('@tauri-apps/plugin-dialog');
  const destination = await save({ defaultPath: 'OpenCalendar.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
  if (!destination) return false;
  // The save dialog grants access to this exact selected path. No broad disk
  // permission or browser download URL is needed by the desktop app.
  await (await import('@tauri-apps/plugin-fs')).writeTextFile(destination, contents);
  return true;
}
