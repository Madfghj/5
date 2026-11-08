import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Mail, Save, ShieldCheck } from 'lucide-react';
import type { Locale } from './i18n';
import type { Provider, User } from './types';
import './service-hub.css';

const copy = {
  en: { google: 'Google', apple: 'Apple', microsoft: 'Microsoft', telegram: 'Telegram', connect: 'Connect', connected: 'Connected', unavailable: 'Not available yet', checking: 'Checking availability…', setup: 'Services marked unavailable still need setup. Your current account stays available.', signal: 'Signal', signalHint: 'An optional contact link shared with your groups. It does not sign you in.', signalLink: 'Your Signal link', saveSignal: 'Save contact link', signalInvalid: 'Use a full HTTPS link from signal.me.', proton: 'Proton Mail', protonHint: 'Your Proton Mail address works for email sign-in. Create a separate OpenCalendar password; keep your Proton Mail password with Proton.', existingEmail: 'Email on your profile', verified: 'Email verified', unverified: 'Email not verified', existingHint: 'This profile already has an email address.', email: 'Email address', password: 'New OpenCalendar password', confirm: 'Repeat the new password', passwordHint: '12–128 characters. This password is for OpenCalendar.', linkEmail: 'Add email sign-in', mismatch: 'The passwords do not match.', weakPassword: 'Use a password between 12 and 128 characters.', invalidEmail: 'Enter a valid email address.', saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save your changes. Please try again.' },
  ru: { google: 'Google', apple: 'Apple', microsoft: 'Microsoft', telegram: 'Telegram', connect: 'Подключить', connected: 'Подключено', unavailable: 'Пока недоступно', checking: 'Проверяем доступность…', setup: 'Недоступные сервисы ещё нужно настроить. Текущий аккаунт продолжает работать.', signal: 'Signal', signalHint: 'Необязательная ссылка для связи, которую видят твои группы. Она не используется для входа.', signalLink: 'Твоя ссылка Signal', saveSignal: 'Сохранить контакт', signalInvalid: 'Укажи полную HTTPS-ссылку с signal.me.', proton: 'Proton Mail', protonHint: 'Адрес Proton Mail подходит для входа по почте. Придумай отдельный пароль OpenCalendar. Пароль Proton Mail остаётся в Proton.', existingEmail: 'Почта в твоём профиле', verified: 'Почта подтверждена', unverified: 'Почта не подтверждена', existingHint: 'К этому профилю уже добавлен адрес почты.', email: 'Адрес почты', password: 'Новый пароль OpenCalendar', confirm: 'Повтори новый пароль', passwordHint: 'От 12 до 128 символов. Этот пароль — для OpenCalendar.', linkEmail: 'Добавить вход по почте', mismatch: 'Пароли не совпадают.', weakPassword: 'Используй пароль от 12 до 128 символов.', invalidEmail: 'Укажи действительный адрес почты.', saving: 'Сохраняем…', saved: 'Сохранено', error: 'Не удалось сохранить изменения. Попробуй ещё раз.' },
  de: { google: 'Google', apple: 'Apple', microsoft: 'Microsoft', telegram: 'Telegram', connect: 'Verbinden', connected: 'Verbunden', unavailable: 'Noch nicht verfügbar', checking: 'Verfügbarkeit wird geprüft…', setup: 'Nicht verfügbare Dienste müssen noch eingerichtet werden. Dein aktuelles Konto bleibt nutzbar.', signal: 'Signal', signalHint: 'Ein optionaler Kontaktlink für deine Gruppen. Er wird nicht zur Anmeldung verwendet.', signalLink: 'Dein Signal-Link', saveSignal: 'Kontaktlink speichern', signalInvalid: 'Verwende einen vollständigen HTTPS-Link von signal.me.', proton: 'Proton Mail', protonHint: 'Deine Proton-Mail-Adresse funktioniert für die E-Mail-Anmeldung. Erstelle ein eigenes OpenCalendar-Passwort. Dein Proton-Mail-Passwort bleibt bei Proton.', existingEmail: 'E-Mail in deinem Profil', verified: 'E-Mail bestätigt', unverified: 'E-Mail nicht bestätigt', existingHint: 'Dieses Profil hat bereits eine E-Mail-Adresse.', email: 'E-Mail-Adresse', password: 'Neues OpenCalendar-Passwort', confirm: 'Neues Passwort wiederholen', passwordHint: '12–128 Zeichen. Dieses Passwort ist für OpenCalendar.', linkEmail: 'E-Mail-Anmeldung hinzufügen', mismatch: 'Die Passwörter stimmen nicht überein.', weakPassword: 'Verwende ein Passwort mit 12 bis 128 Zeichen.', invalidEmail: 'Gib eine gültige E-Mail-Adresse ein.', saving: 'Wird gespeichert…', saved: 'Gespeichert', error: 'Deine Änderungen konnten nicht gespeichert werden. Versuche es erneut.' },
  fr: { google: 'Google', apple: 'Apple', microsoft: 'Microsoft', telegram: 'Telegram', connect: 'Connecter', connected: 'Connecté', unavailable: 'Pas encore disponible', checking: 'Vérification de la disponibilité…', setup: 'Les services indisponibles doivent encore être configurés. Ton compte actuel reste accessible.', signal: 'Signal', signalHint: 'Un lien de contact facultatif visible par tes groupes. Il ne sert pas à te connecter.', signalLink: 'Ton lien Signal', saveSignal: 'Enregistrer le contact', signalInvalid: 'Utilise un lien HTTPS complet de signal.me.', proton: 'Proton Mail', protonHint: 'Ton adresse Proton Mail convient à la connexion par e-mail. Crée un mot de passe propre à OpenCalendar. Ton mot de passe Proton Mail reste chez Proton.', existingEmail: 'E-mail de ton profil', verified: 'E-mail confirmé', unverified: 'E-mail non confirmé', existingHint: 'Ce profil possède déjà une adresse e-mail.', email: 'Adresse e-mail', password: 'Nouveau mot de passe OpenCalendar', confirm: 'Répéter le nouveau mot de passe', passwordHint: '12 à 128 caractères. Ce mot de passe est pour OpenCalendar.', linkEmail: 'Ajouter la connexion par e-mail', mismatch: 'Les mots de passe ne correspondent pas.', weakPassword: 'Utilise un mot de passe de 12 à 128 caractères.', invalidEmail: 'Indique une adresse e-mail valide.', saving: 'Enregistrement…', saved: 'Enregistré', error: 'Impossible d’enregistrer tes modifications. Réessaie.' },
};

function ServiceMark({ id }: { id: Provider['id'] | 'signal' | 'proton' }) {
  return <span className={`service-mark service-mark-${id}`} aria-hidden="true">
    {id === 'google' ? <b>G</b> : id === 'microsoft' ? <svg viewBox="0 0 20 20" width="23" height="23"><path fill="#f25022" d="M0 0h9v9H0z" /><path fill="#7fba00" d="M11 0h9v9h-9z" /><path fill="#00a4ef" d="M0 11h9v9H0z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
      : id === 'telegram' ? <svg width="25" height="25" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2aabee" /><path d="m5 11 13-5-2.5 12-4-3-2 2 .4-4.3L16 8.8l-7.7 3.9z" fill="white" /></svg>
        : id === 'apple' ? <svg width="25" height="25" viewBox="0 0 24 24" fill="currentColor"><path d="M17.1 12.5c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3.1-1.7-1.3-.1-2.6.8-3.2.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.7.8-3.4 2-1.4 2.4-.4 6 1 7.9.6 1 1.4 2 2.4 2 1-.1 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7s1.7-1 2.4-1.9c.8-1.1 1.1-2.2 1.1-2.3-.1 0-3.5-1.3-3.5-3zM15 6.4c.6-.8 1.1-1.8 1-2.9-.9.1-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z" /></svg>
          : id === 'signal' ? <svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" /><path d="M9 22l1-5a7 7 0 1 1 4 6z" fill="currentColor" /></svg>
            : <Mail size={24} />}
  </span>;
}

function validSignal(value: string) {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'signal.me' && !url.username && !url.password && !url.port; }
  catch { return false; }
}

export default function ServiceHub({ locale, user, providers, busy, onProvider, onSaveSignal, onLinkEmail }: {
  locale: Locale; user: User; providers: Provider[]; busy: boolean;
  onProvider: (id: Provider['id']) => void; onSaveSignal: (url: string) => Promise<unknown>;
  onLinkEmail: (input: { email: string; password: string }) => Promise<unknown>;
}) {
  const t = copy[locale], uid = useId();
  const [signal, setSignal] = useState(user.contacts?.signal || '');
  const [signalStatus, setSignalStatus] = useState<'saved' | 'error' | 'signalInvalid' | ''>('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [emailStatus, setEmailStatus] = useState<'saved' | 'error' | 'invalidEmail' | 'weakPassword' | 'mismatch' | ''>('');
  const [pending, setPending] = useState<'signal' | 'email' | null>(null);
  const signalDirty = useRef(false), signalOwner = useRef(user.id), locked = busy || pending !== null;
  useEffect(() => {
    if (signalOwner.current !== user.id || !signalDirty.current) {
      signalOwner.current = user.id; signalDirty.current = false; setSignal(user.contacts?.signal || '');
    }
  }, [user.id, user.contacts?.signal]);
  useEffect(() => { setEmail(''); setPassword(''); setRepeat(''); setEmailStatus(''); }, [user.id]);

  async function saveSignal(event: FormEvent) {
    event.preventDefault(); if (locked) return;
    const value = signal.trim();
    if (!validSignal(value)) { setSignalStatus('signalInvalid'); return; }
    setPending('signal'); setSignalStatus('');
    try {
      const result = await onSaveSignal(value);
      if (result === false) setSignalStatus('error');
      else { signalDirty.current = false; setSignal(value); setSignalStatus('saved'); }
    } catch { setSignalStatus('error'); } finally { setPending(null); }
  }
  async function addEmail(event: FormEvent) {
    event.preventDefault(); if (locked || user.email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setEmailStatus('invalidEmail'); return; }
    if (password.length < 12 || password.length > 128) { setEmailStatus('weakPassword'); return; }
    if (password !== repeat) { setEmailStatus('mismatch'); return; }
    setPending('email'); setEmailStatus('');
    try {
      const result = await onLinkEmail({ email: email.trim(), password });
      if (result === false) setEmailStatus('error');
      else { setPassword(''); setRepeat(''); setEmailStatus('saved'); }
    } catch { setEmailStatus('error'); } finally { setPending(null); }
  }
  return <div className="service-hub">
    <div className="service-provider-grid">{(['google', 'apple', 'microsoft', 'telegram'] as const).map(id => {
      const ready = !!providers.find(provider => provider.id === id)?.configured;
      const connected = !!user.connectedProviders?.includes(id);
      return <section className={`service-provider-card ${connected ? 'is-connected' : ''}`} key={id}>
        <div className="service-card-heading"><ServiceMark id={id} /><h3>{t[id]}</h3></div>
        <button type="button" className={`button ${ready && !connected ? 'primary' : 'secondary'}`} disabled={locked || !ready || connected} onClick={() => onProvider(id)}>
          {connected ? <Check size={16} aria-hidden="true" /> : ready ? <ArrowUpRight size={16} aria-hidden="true" /> : null}
          {connected ? t.connected : providers.length === 0 ? t.checking : ready ? t.connect : t.unavailable}
        </button>
      </section>;
    })}</div>
    {providers.some(provider => !provider.configured) && <p className="service-setup-note"><ShieldCheck size={17} aria-hidden="true" /><span>{t.setup}</span></p>}
    <section className="service-detail-card">
      <div className="service-card-heading"><ServiceMark id="signal" /><h3>{t.signal}</h3></div>
      <p className="service-explanation">{t.signalHint}</p>
      <form onSubmit={event => void saveSignal(event)} aria-busy={pending === 'signal'}>
        <label className="field" htmlFor={`${uid}-signal`}><span>{t.signalLink}</span><input id={`${uid}-signal`} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={500} placeholder="https://signal.me/#…" value={signal} disabled={locked} onChange={event => { signalDirty.current = true; setSignalStatus(''); setSignal(event.target.value); }} /></label>
        {signalStatus && <p className={`service-feedback ${signalStatus === 'saved' ? 'saved' : 'error'}`} role={signalStatus === 'saved' ? 'status' : 'alert'}>{t[signalStatus]}</p>}
        <button className="button secondary" type="submit" disabled={locked}><Save size={16} aria-hidden="true" />{pending === 'signal' ? t.saving : t.saveSignal}</button>
      </form>
    </section>
    <section className="service-detail-card">
      <div className="service-card-heading"><ServiceMark id="proton" /><h3>{t.proton}</h3></div>
      {user.email ? <div className="service-existing-email"><span>{t.existingEmail}</span><strong>{user.email}</strong><span className={`service-email-state ${user.emailVerified ? 'verified' : ''}`}>{user.emailVerified && <Check size={14} aria-hidden="true" />}{user.emailVerified ? t.verified : t.unverified}</span><p>{t.existingHint}</p></div>
        : <><p className="service-explanation">{t.protonHint}</p><form onSubmit={event => void addEmail(event)} aria-busy={pending === 'email'}>
          <label className="field" htmlFor={`${uid}-email`}><span>{t.email}</span><input id={`${uid}-email`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@proton.me" value={email} disabled={locked} onChange={event => { setEmail(event.target.value); setEmailStatus(''); }} /></label>
          <label className="field" htmlFor={`${uid}-password`}><span>{t.password}</span><input id={`${uid}-password`} type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby={`${uid}-password-hint`} value={password} disabled={locked} onChange={event => { setPassword(event.target.value); setEmailStatus(''); }} /></label>
          <p className="service-input-hint" id={`${uid}-password-hint`}>{t.passwordHint}</p>
          <label className="field" htmlFor={`${uid}-confirm`}><span>{t.confirm}</span><input id={`${uid}-confirm`} type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={repeat} disabled={locked} aria-invalid={repeat.length > 0 && repeat !== password} onChange={event => { setRepeat(event.target.value); setEmailStatus(''); }} /></label>
          {emailStatus && <p className={`service-feedback ${emailStatus === 'saved' ? 'saved' : 'error'}`} role={emailStatus === 'saved' ? 'status' : 'alert'}>{t[emailStatus]}</p>}
          <button className="button primary" type="submit" disabled={locked || !email.trim() || !password || !repeat}><Mail size={16} aria-hidden="true" />{pending === 'email' ? t.saving : t.linkEmail}</button>
        </form></>}
    </section>
  </div>;
}
