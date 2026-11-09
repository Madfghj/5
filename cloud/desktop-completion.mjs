const copy = {
  en: {
    confirm: ['Confirm sign-in', 'Enter the six-digit code displayed in the OpenCalendar app where you started this sign-in.'],
    form: ['Provider account', 'OpenCalendar profile to link', 'Sign-in code', 'Confirm', 'Cancel', 'That code was incorrect. Check the app and try again.'],
    ready: ['Sign-in confirmed', 'Return to the OpenCalendar app where you started signing in. It will finish there automatically.'],
    cancelled: ['Sign-in cancelled', 'Return to the OpenCalendar app where you started signing in. You can try again there.'],
    error: ['Sign-in could not finish', 'Return to the OpenCalendar app where you started signing in and try again.'],
    note: 'Only continue if you started this sign-in in your own OpenCalendar app. This page does not sign you into the website.',
    close: 'You can close this browser tab.',
  },
  ru: {
    confirm: ['Подтверди вход', 'Введи шестизначный код из приложения OpenCalendar, в котором ты начал вход.'],
    form: ['Аккаунт сервиса', 'Профиль OpenCalendar для привязки', 'Код входа', 'Подтвердить', 'Отмена', 'Неверный код. Проверь код в приложении и попробуй снова.'],
    ready: ['Вход подтверждён', 'Вернись в приложение OpenCalendar, в котором ты начал вход. Оно завершит вход автоматически.'],
    cancelled: ['Вход отменён', 'Вернись в приложение OpenCalendar, в котором ты начал вход. Там можно попробовать снова.'],
    error: ['Не удалось завершить вход', 'Вернись в приложение OpenCalendar, в котором ты начал вход, и попробуй снова.'],
    note: 'Продолжай, только если ты сам начал этот вход в своём приложении OpenCalendar. Эта страница не выполняет вход на сайте.',
    close: 'Эту вкладку браузера можно закрыть.',
  },
  de: {
    confirm: ['Anmeldung bestätigen', 'Gib den sechsstelligen Code aus der OpenCalendar-App ein, in der du die Anmeldung begonnen hast.'],
    form: ['Anbieterkonto', 'Zu verknüpfendes OpenCalendar-Profil', 'Anmeldecode', 'Bestätigen', 'Abbrechen', 'Der Code war falsch. Prüfe den Code in der App und versuche es erneut.'],
    ready: ['Anmeldung bestätigt', 'Kehre zur OpenCalendar-App zurück, in der du die Anmeldung begonnen hast. Sie wird dort automatisch abgeschlossen.'],
    cancelled: ['Anmeldung abgebrochen', 'Kehre zur OpenCalendar-App zurück, in der du die Anmeldung begonnen hast. Dort kannst du es erneut versuchen.'],
    error: ['Anmeldung nicht abgeschlossen', 'Kehre zur OpenCalendar-App zurück, in der du die Anmeldung begonnen hast, und versuche es erneut.'],
    note: 'Fahre nur fort, wenn du diese Anmeldung selbst in deiner OpenCalendar-App begonnen hast. Diese Seite meldet dich nicht auf der Website an.',
    close: 'Du kannst diesen Browser-Tab schließen.',
  },
  fr: {
    confirm: ['Confirmer la connexion', 'Saisissez le code à six chiffres affiché dans l’application OpenCalendar où vous avez commencé la connexion.'],
    form: ['Compte du fournisseur', 'Profil OpenCalendar à associer', 'Code de connexion', 'Confirmer', 'Annuler', 'Le code est incorrect. Vérifiez le code dans l’application et réessayez.'],
    ready: ['Connexion confirmée', 'Revenez dans l’application OpenCalendar où vous avez commencé la connexion. Elle s’y terminera automatiquement.'],
    cancelled: ['Connexion annulée', 'Revenez dans l’application OpenCalendar où vous avez commencé la connexion. Vous pourrez y réessayer.'],
    error: ['Connexion non terminée', 'Revenez dans l’application OpenCalendar où vous avez commencé la connexion et réessayez.'],
    note: 'Continuez uniquement si vous avez vous-même commencé cette connexion dans votre application OpenCalendar. Cette page ne vous connecte pas au site web.',
    close: 'Vous pouvez fermer cet onglet du navigateur.',
  },
};

export const desktopConfirmPath = '/api/auth/desktop/confirm';
export const desktopConfirmCookieName = (flowId) => `oc_desktop_${flowId.slice(0, 24)}`;
export function desktopConfirmCookie(flowId, value, secure, maxAge = 300) {
  return `${desktopConfirmCookieName(flowId)}=${value}; Path=${desktopConfirmPath}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function verificationCode() {
  const number = new Uint32Array(1);
  // Reject the incomplete last range to give every six-digit code equal odds.
  do { crypto.getRandomValues(number); } while (number[0] >= 4_294_000_000);
  return String(number[0] % 1_000_000).padStart(6, '0');
}

const providerNames = { google: 'Google', telegram: 'Telegram', apple: 'Apple', microsoft: 'Microsoft' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function page(status, locale, content = '') {
  const language = Object.hasOwn(copy, locale) ? locale : 'en';
  const words = copy[language], [title, description] = words[status] || words.error;
  const confirming = status === 'confirm';
  return {
    body: `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · OpenCalendar</title><style>html{color-scheme:light;background:#fbf7ee;color:#25392c;font:18px/1.65 system-ui,sans-serif}body{margin:0;padding:24px;min-height:85vh;display:grid;place-items:center}main{max-width:540px;padding:32px;border:1px solid #d3dccb;border-radius:12px;background:#fffdf7}h1{font-size:1.65rem;line-height:1.25}p{margin:18px 0}.brand{font-weight:750;color:#436146}.note{font-size:.86rem;color:#566451;border-top:1px solid #dde3d5;padding-top:18px}label{display:block}input,button{font:inherit;padding:.35em .6em;margin:.3em .3em .3em 0}input{width:7em}button{cursor:pointer}.error{color:#862828}</style></head><body><main><div class="brand">OpenCalendar.space</div><h1>${title}</h1><p>${description}</p>${confirming ? content : `<p>${words.close}</p>`}<p class="note">${words.note}</p></main></body></html>`,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      // Keep the origin on the POST without forwarding the OAuth callback URL.
      'Referrer-Policy': confirming ? 'origin' : 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action ${confirming ? "'self'" : "'none'"}; frame-ancestors 'none'`,
    },
  };
}

export function desktopCompletion(status, locale = 'en') {
  return page(['ready', 'cancelled', 'error'].includes(status) ? status : 'error', locale);
}

export function desktopConfirmation({ locale = 'en', flowId, csrf, provider, providerName, linkName, error = false }) {
  const words = Object.hasOwn(copy, locale) ? copy[locale] : copy.en;
  const [accountLabel, profileLabel, codeLabel, confirm, cancel, invalidCode] = words.form;
  const providerLabel = Object.hasOwn(providerNames, provider) ? providerNames[provider] : '';
  return page('confirm', locale, `
    <p><strong>${accountLabel} (${providerLabel})</strong><br><bdi>${escapeHtml(providerName)}</bdi></p>
    ${linkName ? `<p><strong>${profileLabel}</strong><br><bdi>${escapeHtml(linkName)}</bdi></p>` : ''}
    <form method="post" action="${desktopConfirmPath}">
      <input type="hidden" name="flowId" value="${escapeHtml(flowId)}">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      ${error ? `<p class="error" role="alert">${invalidCode}</p>` : ''}
      <label for="code">${codeLabel}</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" required>
      <div><button name="decision" value="confirm">${confirm}</button><button name="decision" value="deny" formnovalidate>${cancel}</button></div>
    </form>`);
}
