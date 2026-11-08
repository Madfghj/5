import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Save } from 'lucide-react';
import type { Locale } from './i18n';
import LanguagePicker from './LanguagePicker';
import type { Customization, User } from './types';
import './customization.css';

const defaults: Customization = { avatar: 'mint', theme: 'meadow', palette: 'sage', tagline: '', defaultView: 'month', reducedMotion: false, compactCalendar: false };
const preferences = (value?: Customization): Customization => ({ ...defaults, ...value });
const copy = {
  en: { intro: 'Choose how the app looks.', name: 'Your name', nameHint: 'Shown to your groups.', language: 'Language', avatar: 'Your avatar', mint: 'Mint', lavender: 'Lavender', stone: 'Stone', sunset: 'Sunset', theme: 'Background', meadow: 'Meadow', forest: 'Forest', dusk: 'Dusk', palette: 'Colors', sage: 'Green', white: 'White', sand: 'Sand', cocoa: 'Brown', tagline: 'A few words about you', optional: 'optional', taglineHint: 'For example: free in the evenings.', save: 'Save my space', saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save your changes. Please try again.', advanced: 'Make planning comfortable.', defaultView: 'Open the calendar in', month: 'Month', week: 'Week', schedule: 'Schedule', motion: 'Less animation', motionHint: 'Keep transitions and movement to a minimum.', compact: 'Compact calendar', compactHint: 'Show dates in smaller cells.', savePreferences: 'Save preferences' },
  ru: { intro: 'Настрой вид приложения.', name: 'Твоё имя', nameHint: 'Его видят участники твоих групп.', language: 'Язык', avatar: 'Твой аватар', mint: 'Мята', lavender: 'Лаванда', stone: 'Камень', sunset: 'Закат', theme: 'Фон', meadow: 'Луг', forest: 'Лес', dusk: 'Сумерки', palette: 'Цвета', sage: 'Зелёный', white: 'Белый', sand: 'Песочный', cocoa: 'Коричневый', tagline: 'Пара слов о себе', optional: 'необязательно', taglineHint: 'Например: свободен по вечерам.', save: 'Сохранить мой стиль', saving: 'Сохраняем…', saved: 'Сохранено', error: 'Не удалось сохранить изменения. Попробуй ещё раз.', advanced: 'Планируй так, как удобно тебе.', defaultView: 'Открывать календарь в виде', month: 'Месяц', week: 'Неделя', schedule: 'Расписание', motion: 'Меньше анимации', motionHint: 'Минимум движений и переходов на экране.', compact: 'Компактный календарь', compactHint: 'Даты займут меньше места.', savePreferences: 'Сохранить настройки' },
  de: { intro: 'Passe die Ansicht der App an.', name: 'Dein Name', nameHint: 'Deine Gruppen können ihn sehen.', language: 'Sprache', avatar: 'Dein Avatar', mint: 'Minze', lavender: 'Lavendel', stone: 'Stein', sunset: 'Abendrot', theme: 'Hintergrund', meadow: 'Wiese', forest: 'Wald', dusk: 'Abend', palette: 'Farben', sage: 'Grün', white: 'Weiß', sand: 'Sand', cocoa: 'Braun', tagline: 'Ein paar Worte über dich', optional: 'optional', taglineHint: 'Zum Beispiel: abends Zeit.', save: 'Meinen Stil speichern', saving: 'Wird gespeichert…', saved: 'Gespeichert', error: 'Deine Änderungen konnten nicht gespeichert werden. Versuche es erneut.', advanced: 'Plane so, wie es dir gefällt.', defaultView: 'Kalender öffnen als', month: 'Monat', week: 'Woche', schedule: 'Terminübersicht', motion: 'Weniger Animationen', motionHint: 'Weniger Bewegung und Übergänge auf dem Bildschirm.', compact: 'Kompakter Kalender', compactHint: 'Datumsfelder nehmen weniger Platz ein.', savePreferences: 'Einstellungen speichern' },
  fr: { intro: 'Choisis l’apparence de l’application.', name: 'Ton prénom', nameHint: 'Il est visible dans tes groupes.', language: 'Langue', avatar: 'Ton avatar', mint: 'Menthe', lavender: 'Lavande', stone: 'Pierre', sunset: 'Soleil', theme: 'Fond', meadow: 'Prairie', forest: 'Forêt', dusk: 'Crépuscule', palette: 'Couleurs', sage: 'Vert', white: 'Blanc', sand: 'Sable', cocoa: 'Marron', tagline: 'Quelques mots sur toi', optional: 'facultatif', taglineHint: 'Par exemple : libre le soir.', save: 'Enregistrer mon style', saving: 'Enregistrement…', saved: 'Enregistré', error: 'Impossible d’enregistrer tes modifications. Réessaie.', advanced: 'Planifie comme tu aimes.', defaultView: 'Ouvrir le calendrier en vue', month: 'Mois', week: 'Semaine', schedule: 'Programme', motion: 'Moins d’animations', motionHint: 'Limiter les mouvements et les transitions.', compact: 'Calendrier compact', compactHint: 'Les dates occupent moins de place.', savePreferences: 'Enregistrer les préférences' },
};

export function PixelAvatar({ avatar, size = 32 }: { avatar: Customization['avatar']; size?: number }) {
  const colors = {
    mint: ['#dfedce', '#4f7755', '#bed7a1', '#304f39'],
    lavender: ['#e9e0f1', '#8a719e', '#d7c5e4', '#534061'],
    stone: ['#e5e7e2', '#768578', '#c5d0bf', '#3e5143'],
    sunset: ['#f5e2cd', '#bd8057', '#ebbf8e', '#79513b'],
  }[avatar] || ['#dfedce', '#4f7755', '#bed7a1', '#304f39'];
  return <svg className="preset-pixel-avatar" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" shapeRendering="crispEdges">
    <rect width="64" height="64" rx="8" fill={colors[0]} />
    <path d="M16 24h32v28H16zM12 28h4v16h-4zm36 0h4v16h-4z" fill={colors[1]} />
    <path d="M20 28h24v20H20z" fill={colors[2]} />
    <path d="M24 32h4v4h-4zm12 0h4v4h-4zm-8 8h8v4h-8z" fill={colors[3]} />
    {avatar === 'mint' ? <path d="M28 12h8v12h-8zm8-4h12v8H36zM16 8h12v8H16z" fill={colors[1]} />
      : avatar === 'lavender' ? <g fill={colors[1]}><path d="M20 16h8v8h-8zm16 0h8v8h-8zM28 8h8v8h-8zm0 16h8v4h-8z" /><path d="M28 16h8v8h-8z" fill="#f8edb1" /></g>
        : avatar === 'stone' ? <path d="M16 16h32v12H16zm4-4h24v4H20z" fill={colors[1]} />
          : <g><path d="M20 16h24v8H20zm4-4h16v4H24z" fill={colors[1]} /><path d="M28 16h8v8h-8z" fill="#fae7a1" /></g>}
    <path d="M24 52h16v4H24z" fill={colors[1]} />
  </svg>;
}

export default function CustomizationPanel({ locale, user, busy, onLocaleChange, onSave }: {
  locale: Locale; user: User; busy: boolean; onLocaleChange: (locale: Locale) => void;
  onSave: (input: { name: string; customization: Customization }) => Promise<unknown>;
}) {
  const t = copy[locale];
  const [name, setName] = useState(user.name);
  const [draft, setDraft] = useState(() => preferences(user.customization));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | ''>('');
  const dirty = useRef(false), owner = useRef(user.id);
  const locked = busy || saving;
  useEffect(() => {
    if (owner.current !== user.id || !dirty.current) {
      owner.current = user.id; dirty.current = false;
      setName(user.name); setDraft(preferences(user.customization));
    }
  }, [user.id, user.name, user.customization]);
  function change(next: Partial<Customization>) { dirty.current = true; setStatus(''); setDraft(previous => ({ ...previous, ...next })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked || !name.trim()) return;
    setSaving(true); setStatus('');
    try {
      const result = await onSave({ name: name.trim(), customization: { ...preferences(user.customization), avatar: draft.avatar, theme: draft.theme, palette: draft.palette, tagline: draft.tagline.trim() } });
      if (result !== false) { dirty.current = false; setName(name.trim()); setStatus('saved'); }
    } catch { setStatus('error'); } finally { setSaving(false); }
  }
  return <div className="customization-page">
    <div className="customization-preview">
      <PixelAvatar avatar={draft.avatar} />
      <div><strong>{name.trim() || user.name}</strong><p>{draft.tagline.trim() || t.intro}</p></div>
    </div>
    <form className="customization-card" onSubmit={event => void submit(event)} aria-busy={locked}>
      <div className="customization-fields">
        <label className="field"><span>{t.name}</span><input required maxLength={60} autoComplete="name" value={name} disabled={locked} onChange={event => { dirty.current = true; setStatus(''); setName(event.target.value); }} /><small className="customization-help">{t.nameHint}</small></label>
        <div className="field customization-language"><span>{t.language}</span><LanguagePicker locale={locale} disabled={locked} onChange={onLocaleChange} /></div>
      </div>
      <fieldset className="customization-options" disabled={locked}><legend>{t.avatar}</legend><div className="customization-avatar-grid">{(['mint', 'lavender', 'stone', 'sunset'] as const).map(value => <button type="button" key={value} className={`customization-avatar-option ${draft.avatar === value ? 'is-selected' : ''}`} aria-pressed={draft.avatar === value} onClick={() => change({ avatar: value })}><PixelAvatar avatar={value} /><span>{t[value]}</span>{draft.avatar === value && <Check className="customization-check" size={14} aria-hidden="true" />}</button>)}</div></fieldset>
      <fieldset className="customization-options" disabled={locked}><legend>{t.palette}</legend><div className="customization-palette-grid">{(['sage', 'white', 'sand', 'cocoa'] as const).map(value => <button type="button" key={value} className={`customization-palette-option ${draft.palette === value ? 'is-selected' : ''}`} aria-pressed={draft.palette === value} onClick={() => change({ palette: value })}><span className={`customization-swatch customization-swatch-${value}`} aria-hidden="true">{draft.palette === value && <Check size={15} />}</span><span>{t[value]}</span></button>)}</div></fieldset>
      <fieldset className="customization-options" disabled={locked}><legend>{t.theme}</legend><div className="customization-theme-grid">{(['meadow', 'forest', 'dusk'] as const).map(value => <button type="button" key={value} className={`customization-theme-option ${draft.theme === value ? 'is-selected' : ''}`} aria-pressed={draft.theme === value} onClick={() => change({ theme: value })}><span className={`customization-theme-preview customization-theme-${value}`} aria-hidden="true">{draft.theme === value && <span><Check size={15} /></span>}</span><strong>{t[value]}</strong></button>)}</div></fieldset>
      <label className="field customization-tagline"><span>{t.tagline}<small>{t.optional}</small></span><input value={draft.tagline} maxLength={80} placeholder={t.taglineHint} disabled={locked} onChange={event => change({ tagline: event.target.value })} /><small className="customization-count">{draft.tagline.length}/80</small></label>
      <div className="customization-actions"><span className={`customization-feedback ${status}`} role={status === 'error' ? 'alert' : 'status'}>{status ? t[status] : ''}</span><button type="submit" className="button primary" disabled={locked || !name.trim()}><Save size={16} aria-hidden="true" />{saving ? t.saving : t.save}</button></div>
    </form>
  </div>;
}

export function AdvancedPreferences({ locale, customization, busy, onSave }: {
  locale: Locale; customization?: Customization; busy: boolean; onSave: (customization: Customization) => Promise<unknown>;
}) {
  const t = copy[locale];
  const [draft, setDraft] = useState(() => preferences(customization));
  const [saving, setSaving] = useState(false), [status, setStatus] = useState<'saved' | 'error' | ''>('');
  const dirty = useRef(false), locked = busy || saving;
  useEffect(() => { if (!dirty.current) setDraft(preferences(customization)); }, [customization]);
  function change(next: Partial<Customization>) { dirty.current = true; setStatus(''); setDraft(previous => ({ ...previous, ...next })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked) return; setSaving(true); setStatus('');
    try {
      const result = await onSave({ ...preferences(customization), defaultView: draft.defaultView, reducedMotion: draft.reducedMotion, compactCalendar: draft.compactCalendar });
      if (result !== false) { dirty.current = false; setStatus('saved'); }
    } catch { setStatus('error'); } finally { setSaving(false); }
  }
  return <form className="customization-card advanced-preferences" onSubmit={event => void submit(event)} aria-busy={locked}>
    <p className="customization-intro">{t.advanced}</p>
    <label className="field"><span>{t.defaultView}</span><select value={draft.defaultView} disabled={locked} onChange={event => change({ defaultView: event.target.value as Customization['defaultView'] })}>{(['month', 'week', 'schedule'] as const).map(value => <option value={value} key={value}>{t[value]}</option>)}</select></label>
    <label className="customization-toggle"><input type="checkbox" checked={draft.reducedMotion} disabled={locked} onChange={event => change({ reducedMotion: event.target.checked })} /><span><strong>{t.motion}</strong><small>{t.motionHint}</small></span></label>
    <label className="customization-toggle"><input type="checkbox" checked={draft.compactCalendar} disabled={locked} onChange={event => change({ compactCalendar: event.target.checked })} /><span><strong>{t.compact}</strong><small>{t.compactHint}</small></span></label>
    <div className="customization-actions"><span className={`customization-feedback ${status}`} role={status === 'error' ? 'alert' : 'status'}>{status ? t[status] : ''}</span><button className="button primary" disabled={locked} type="submit"><Save size={16} aria-hidden="true" />{saving ? t.saving : t.savePreferences}</button></div>
  </form>;
}
