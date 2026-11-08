import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Globe2 } from 'lucide-react';
import type { Locale } from './i18n';
import './language-picker.css';

const choices = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
] as const;
const languageLabel: Record<Locale, string> = { en: 'Language', ru: 'Язык', de: 'Sprache', fr: 'Langue' };

export default function LanguagePicker({ locale, onChange, compact = false, disabled = false }: {
  locale: Locale; onChange: (locale: Locale) => void; compact?: boolean; disabled?: boolean;
}) {
  const selectedIndex = Math.max(0, choices.findIndex(choice => choice.code === locale));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId(), listId = `${uid}-languages`;

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function show(index = selectedIndex) {
    if (disabled) return;
    setActiveIndex(index); setOpen(true);
  }
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function choose(index: number) {
    if (disabled) return;
    close(true);
    onChange(choices[index].code);
  }
  function triggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); show(event.key === 'Home' ? 0 : choices.length - 1); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }
  function listKey(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActiveIndex(index => (index + 1) % choices.length); break;
      case 'ArrowUp': event.preventDefault(); setActiveIndex(index => (index + choices.length - 1) % choices.length); break;
      case 'Home': event.preventDefault(); setActiveIndex(0); break;
      case 'End': event.preventDefault(); setActiveIndex(choices.length - 1); break;
      case 'Enter': case ' ': event.preventDefault(); choose(activeIndex); break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(true); break;
      case 'Tab': break;
      default: {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const match = choices.findIndex(choice => choice.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
          if (match >= 0) { event.preventDefault(); setActiveIndex(match); }
        }
      }
    }
  }

  return <div ref={root} className={`language-picker ${compact ? 'is-compact' : ''}`}>
    <button ref={trigger} type="button" className="language-picker-trigger" disabled={disabled}
      aria-label={`${languageLabel[locale]}: ${choices[selectedIndex].label}`} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? listId : undefined}
      onKeyDown={triggerKey} onClick={() => open ? close(true) : show()}>
      <Globe2 className="language-picker-globe" size={16} aria-hidden="true" />
      <span className="language-picker-label" lang={locale}>{choices[selectedIndex].label}</span>
      <ChevronDown className="language-picker-chevron" size={14} aria-hidden="true" />
    </button>
    {open && <div ref={list} id={listId} className="language-picker-menu" role="listbox" tabIndex={-1}
      aria-label={languageLabel[locale]} aria-activedescendant={`${uid}-language-${choices[activeIndex].code}`} onKeyDown={listKey}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
      {choices.map((choice, index) => <button key={choice.code} id={`${uid}-language-${choice.code}`} type="button"
        className={`language-picker-option ${index === activeIndex ? 'is-active' : ''}`} role="option"
        aria-selected={choice.code === locale} tabIndex={-1} lang={choice.code}
        onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>
        <span>{choice.label}</span>{choice.code === locale && <Check size={17} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
