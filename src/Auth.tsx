import DownloadButton from './DownloadButton';
import { useId, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Globe2, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { dict, errorText, locales, type Locale } from './i18n';
import './auth.css';

export type ProviderId = 'google' | 'apple' | 'microsoft' | 'telegram';
export type EmailAuthInput = { name?: string; email: string; password: string };
export type AuthProps = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onGuest: (name: string) => Promise<void>;
  onEmail: (mode: 'register' | 'login', input: EmailAuthInput) => Promise<void>;
  onProvider: (id: ProviderId) => Promise<void>;
  providers: ReadonlyArray<{ id: string; configured: boolean }>;
  providersStatus?: 'loading' | 'ready' | 'error';
  onRetryProviders?: () => void;
  busy: boolean;
  error?: string;
  allowDemo?: boolean;
  onExploreDemo: () => void;
};

function AuthMark() {
  return <img className="auth-mark" src="/icon-192.png" width="47" height="47" alt="" aria-hidden="true"/>;
}

function ProviderMark({ provider }: { provider: ProviderId }) {
  if (provider === 'telegram') return <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2aabee"/><path d="m5 11 13-5-3 13-4-4-2 2v-4l7-5-9 6z" fill="white"/></svg>;
  if (provider === 'google') return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M22 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.6c-.2 1.2-.9 2.3-2 3v2.5h3.4c2-1.8 3-4.4 3-7.5z"/><path fill="#34a853" d="M12 22c2.8 0 5.2-.9 7-2.3l-3.4-2.6c-.9.6-2.1 1-3.6 1-2.7 0-5-1.8-5.8-4.2H2.7v2.7C4.4 19.8 8 22 12 22z"/><path fill="#fbbc05" d="M6.2 13.9a6 6 0 0 1 0-3.8V7.4H2.7a10 10 0 0 0 0 9.2z"/><path fill="#ea4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5L18.7 4A10 10 0 0 0 2.7 7.4l3.5 2.7C7 7.7 9.3 5.9 12 5.9z"/></svg>;
  if (provider === 'microsoft') return <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true"><path fill="#f25022" d="M0 0h9v9H0z"/><path fill="#7fba00" d="M11 0h9v9h-9z"/><path fill="#00a4ef" d="M0 11h9v9H0z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.1 12.5c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3.1-1.7-1.3-.1-2.6.8-3.2.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.7.8-3.4 2-1.4 2.4-.4 6 1 7.9.6 1 1.4 2 2.4 2 1-.1 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7s1.7-1 2.4-1.9c.8-1.1 1.1-2.2 1.1-2.3-.1 0-3.5-1.3-3.5-3zM15 6.4c.6-.8 1.1-1.8 1-2.9-.9.1-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z"/></svg>;
}

function CalendarIllustration() {
  return <div className="welcome-scene" aria-hidden="true"><span className="welcome-spark one">✳</span><span className="welcome-spark two">+</span><div className="welcome-cloud cloud-one"/><div className="welcome-cloud cloud-two"/><div className="welcome-island"/><div className="welcome-tree tree-left"><i/><b/></div><div className="welcome-tree tree-right"><i/><b/></div><div className="welcome-calendar"><div className="welcome-calendar-top"><i/><i/></div><div className="welcome-calendar-days">{Array.from({length:12},(_,index)=><span key={index} className={index===7?'picked':''}>{index===7?<Check size={20}/>:String(index+1).padStart(2,'0')}</span>)}</div></div><div className="welcome-pixel-flower">✦</div></div>;
}

export function AuthPanel(props: AuthProps) {
  const { locale, providers, onGuest, onEmail, onProvider, onExploreDemo, busy } = props;
  const t = dict[locale];
  const uid = useId();
  const [mode,setMode] = useState<'register'|'login'>('register');
  const [name,setName] = useState('');
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [repeat,setRepeat] = useState('');
  const [guestName,setGuestName] = useState('');
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  const working = busy || pending;
  const mismatch = mode==='register' && repeat.length>0 && repeat!==password;

  async function perform(action: () => Promise<void>) {
    if (working) return;
    setError('');
    setPending(true);
    try { await action(); }
    catch (cause) {
      const code = typeof cause==='object' && cause!==null && 'code' in cause && typeof cause.code==='string' ? cause.code : '';
      setError(code ? errorText(locale,code) : t.authFailed);
    } finally { setPending(false); }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(mode==='register' && password!==repeat) { setError(t.passwordMismatch);return; }
    void perform(()=>onEmail(mode,{email:email.trim(),password,...(mode==='register'?{name:name.trim()}:{})}));
  }

  return <div className="auth-panel">
    <div className="auth-panel-heading"><h2>{mode==='register'?t.createAccount:t.signIn}</h2></div>
    <div className="auth-mode-tabs" role="group" aria-label={t.account}><button type="button" aria-pressed={mode==='register'} className={mode==='register'?'active':''} disabled={working} onClick={()=>{setMode('register');setError('');}}>{t.createAccount}</button><button type="button" aria-pressed={mode==='login'} className={mode==='login'?'active':''} disabled={working} onClick={()=>{setMode('login');setError('');}}>{t.signIn}</button></div>
    <form className="auth-email-form" onSubmit={submit}>
      {mode==='register'&&<label className="auth-field" htmlFor={`${uid}-name`}><span>{t.name}</span><div><UserRound size={17}/><input id={`${uid}-name`} value={name} onChange={e=>setName(e.target.value)} name="name" autoComplete="name" required minLength={1} maxLength={60} placeholder={t.namePlaceholder} disabled={working}/></div></label>}
      <label className="auth-field" htmlFor={`${uid}-email`}><span>{t.email}</span><div><Mail size={17}/><input id={`${uid}-email`} value={email} onChange={e=>setEmail(e.target.value)} type="email" inputMode="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required placeholder="you@example.com" disabled={working}/></div></label>
      <label className="auth-field" htmlFor={`${uid}-password`}><span>{t.password}</span><div><LockKeyhole size={17}/><input id={`${uid}-password`} value={password} onChange={e=>setPassword(e.target.value)} type="password" name="password" autoComplete={mode==='register'?'new-password':'current-password'} minLength={mode==='register'?12:1} maxLength={128} required placeholder={mode==='register'?t.passwordPlaceholder:t.passwordLoginPlaceholder} aria-describedby={mode==='register'?`${uid}-password-hint`:undefined} disabled={working}/></div></label>
      {mode==='register'&&<><p className="auth-input-hint" id={`${uid}-password-hint`}>{t.passwordHint}</p><label className="auth-field" htmlFor={`${uid}-repeat`}><span>{t.repeatPassword}</span><div><LockKeyhole size={17}/><input id={`${uid}-repeat`} value={repeat} onChange={e=>setRepeat(e.target.value)} type="password" name="passwordConfirmation" autoComplete="new-password" minLength={12} maxLength={128} required placeholder={t.repeatPasswordPlaceholder} aria-invalid={mismatch} disabled={working}/></div></label></>}
      {(error||props.error||mismatch)&&<p className="auth-form-error" role="alert">{error||props.error||(mismatch?t.passwordMismatch:'')}</p>}
      <button className="auth-submit" type="submit" disabled={working||mismatch}>{working?t.loading:mode==='register'?t.createAccount:t.signIn}<ArrowRight size={17}/></button>
    </form>
    <div className="auth-divider"><span>{t.orContinueWith}</span></div>
    {props.providersStatus==='loading'&&<p className="auth-method-status" role="status">{t.checkingSignInMethods}</p>}
    {props.providersStatus==='error'&&<div className="auth-method-status error" role="alert"><span>{t.networkError}</span><button type="button" onClick={props.onRetryProviders}>{t.tryAgain}</button></div>}
    {props.providersStatus==='ready'&&providers.some(p=>!p.configured)&&<p className="auth-method-status">{t.signInSetupPending}</p>}
    <div className="auth-social-grid">{(['telegram','google','apple','microsoft'] as const).map(id=>{
      const configured = !!providers.find(provider=>provider.id===id)?.configured;
      return <button type="button" key={id} className="auth-provider" disabled={working||!configured} title={configured?t.signInWith.replace('{provider}',t[id]):t.providerNotConfigured} onClick={()=>void perform(()=>onProvider(id))}><ProviderMark provider={id}/><span><strong>{t[id]}</strong>{!configured&&<small>{t.authProviderUnavailable}</small>}</span></button>;
    })}</div>
    <details className="auth-guest"><summary>{t.continueAsGuest}<ChevronDown size={15}/></summary><p>{t.guestAccountHint}</p><form onSubmit={e=>{e.preventDefault();void perform(()=>onGuest(guestName.trim()));}}><label className="auth-sr-only" htmlFor={`${uid}-guest`}>{t.name}</label><input id={`${uid}-guest`} name="guestName" autoComplete="name" value={guestName} onChange={e=>setGuestName(e.target.value)} required maxLength={60} placeholder={t.namePlaceholder} disabled={working}/><button type="submit" disabled={working||!guestName.trim()} aria-label={t.enterApp}><ArrowRight size={18}/></button></form></details>
    {props.allowDemo&&<button className="auth-demo-link" type="button" disabled={working} onClick={onExploreDemo}><Sparkles size={14}/>{t.exploreDemo}<ArrowRight size={14}/></button>}
    <p className="auth-privacy"><ShieldCheck size={14}/><span>{t.accountPrivacyHint}</span></p>
  </div>;
}

export function WelcomeFlow(props: AuthProps) {
  const {locale,onLocaleChange,onExploreDemo,busy} = props;
  const t = dict[locale];
  const [step,setStep] = useState<'language'|'account'>('language');
  const order: Locale[] = ['en','ru','de','fr'];
  return <main className="welcome-page">
    <section className="welcome-story"><a className="welcome-brand" href="#" onClick={e=>e.preventDefault()} aria-label="OpenCalendar.space"><AuthMark/><span>OpenCalendar<span>.space</span></span></a><div className="welcome-story-copy"><h1>{t.calendar}</h1><p>{locale==='ru'?'Общий календарь для групп. Выбери день и отметь удобное время.':locale==='de'?'Gemeinsamer Kalender für Gruppen. Wähle einen Tag und eine Uhrzeit.':locale==='fr'?'Un calendrier de groupe. Choisissez un jour et une heure.':'Shared calendar for groups. Choose a day and a time.'}</p><CalendarIllustration/></div></section>
    <section className="welcome-form-side"><DownloadButton locale={locale} className="welcome-download"/><div className="welcome-topline"><div className="welcome-progress" aria-label={t.onboardingProgress}><span className="complete">01</span><i/><span className={step==='account'?'complete':''}>02</span></div>{step==='account'&&<button type="button" className="welcome-back" disabled={busy} onClick={()=>setStep('language')}><ArrowLeft size={14}/>{t.language}</button>}</div>
      <div className="welcome-form-card">{step==='language'?<div className="language-step"><div className="language-globe"><Globe2 size={25}/></div><h2>{t.chooseLanguageTitle}</h2><p>{t.chooseLanguageSubtitle}</p><div className="welcome-languages" role="group" aria-label={t.language}>{order.map(code=>{const choice=locales.find(item=>item.code===code)!;return <button type="button" key={code} lang={code} aria-pressed={locale===code} className={locale===code?'selected':''} onClick={()=>onLocaleChange(code)}><span className="language-symbol" aria-hidden="true"><Globe2 size={19}/></span><span><strong>{choice.label}</strong></span><span className="language-check">{locale===code&&<Check size={15}/>}</span></button>;})}</div><button className="auth-submit" type="button" onClick={()=>setStep('account')}>{t.continueButton}<ArrowRight size={17}/></button>{props.allowDemo&&<button className="auth-demo-link" type="button" onClick={onExploreDemo}><Sparkles size={14}/>{t.exploreDemo}<ArrowRight size={14}/></button>}<p className="welcome-language-note">{t.changeLanguageLater}</p></div>:<AuthPanel {...props}/>}</div>
    </section>
  </main>;
}
