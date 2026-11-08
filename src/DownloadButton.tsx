import { useState } from 'react';
import { Download } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { API_BASE, native } from './api';
import { desktop, openDesktopHttps } from './desktop';
import type { Locale } from './i18n';

const copy = {
  en: ['Download apps', 'Could not open downloads. Please try again.'],
  ru: ['Скачать приложение', 'Не удалось открыть загрузки. Попробуй ещё раз.'],
  de: ['Apps herunterladen', 'Downloads konnten nicht geöffnet werden. Bitte erneut versuchen.'],
  fr: ['Télécharger', 'Impossible d’ouvrir les téléchargements. Réessayez.'],
};
export default function DownloadButton({ locale, className = '' }: { locale: Locale; className?: string }) {
  const [error, setError] = useState(false);
  async function open() {
    setError(false);
    const url = `${API_BASE || window.location.origin}/downloads.html`;
    try {
      if (desktop) await openDesktopHttps(url);
      else if (native) await Browser.open({ url });
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch { setError(true); }
  }
  return <><button type="button" className={`download-app-button ${className}`} onClick={() => void open()}><Download size={18}/><span>{copy[locale][0]}</span></button>{error && <small className="download-error" role="status">{copy[locale][1]}</small>}</>;
}
