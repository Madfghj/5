import { useState, type FormEvent } from 'react';
import { ExternalLink, Save } from 'lucide-react';
import type { Locale } from './i18n';
type Contacts={telegram?:string;whatsapp?:string;signal?:string};
const copy={
  en:{title:'Contact links',hint:'Optional links shared with your group. These are contact details, not verified sign-in accounts.',save:'Save links',invalid:'Use an HTTPS link from t.me, wa.me or signal.me.'},
  ru:{title:'Связаться со мной',hint:'Необязательные ссылки для участников группы. Это контакты, а не подтверждённые способы входа.',save:'Сохранить ссылки',invalid:'Используйте HTTPS-ссылку с t.me, wa.me или signal.me.'},
  de:{title:'Kontaktlinks',hint:'Optionale Links für deine Gruppe. Dies sind Kontaktdaten, keine bestätigten Anmeldekonten.',save:'Links speichern',invalid:'Verwende einen HTTPS-Link von t.me, wa.me oder signal.me.'},
  fr:{title:'Liens de contact',hint:'Liens facultatifs pour votre groupe. Ce sont des coordonnées, pas des comptes de connexion vérifiés.',save:'Enregistrer les liens',invalid:'Utilisez un lien HTTPS de t.me, wa.me ou signal.me.'}
};
export default function ContactsForm({locale,contacts,busy,onSave}:{locale:Locale;contacts:Contacts;busy:boolean;onSave:(value:Contacts)=>Promise<void>}) {
  const [values,setValues]=useState<Contacts>(contacts),[error,setError]=useState('');const t=copy[locale];
  function submit(event:FormEvent){event.preventDefault();for(const provider of ['telegram','whatsapp','signal'] as const){const value=values[provider]?.trim();if(!value)continue;try{const url=new URL(value);const domains=provider==='telegram'?['t.me','telegram.me']:provider==='whatsapp'?['wa.me']:['signal.me'];if(url.protocol!=='https:'||!domains.includes(url.hostname)||url.username||url.password)throw Error();}catch{setError(t.invalid);return;}}setError('');void onSave({telegram:values.telegram?.trim()||'',whatsapp:values.whatsapp?.trim()||'',signal:values.signal?.trim()||''});}
  return <form className="contacts-form" onSubmit={submit}><h3 className="form-section-title">{t.title}</h3><p className="muted">{t.hint}</p>{(['telegram','whatsapp','signal'] as const).map(provider=><label className="field" key={provider}><span>{provider==='telegram'?'Telegram':provider==='whatsapp'?'WhatsApp':'Signal'}<ExternalLink size={12}/></span><input type="url" autoComplete="off" maxLength={500} placeholder={provider==='telegram'?'https://t.me/username':provider==='whatsapp'?'https://wa.me/username':'https://signal.me/#…'} value={values[provider]||''} onChange={e=>setValues(v=>({...v,[provider]:e.target.value}))}/></label>)}{error&&<p className="field-error" role="alert">{error}</p>}<button className="button secondary full" disabled={busy} type="submit"><Save size={15}/>{t.save}</button></form>;
}
export function MemberContacts({contacts}:{contacts?:Contacts}) {
  return <span className="member-contacts">{(['telegram','whatsapp','signal'] as const).map(provider=>{const href=contacts?.[provider];if(!href)return null;try{const url=new URL(href);const domains=provider==='telegram'?['t.me','telegram.me']:provider==='whatsapp'?['wa.me']:['signal.me'];if(url.protocol!=='https:'||!domains.includes(url.hostname)||url.username||url.password)return null;}catch{return null;}return <a key={provider} href={href} target="_blank" rel="noopener noreferrer" title={provider==='telegram'?'Telegram':provider==='whatsapp'?'WhatsApp':'Signal'} aria-label={provider==='telegram'?'Telegram':provider==='whatsapp'?'WhatsApp':'Signal'}>{provider==='telegram'?'T':provider==='whatsapp'?'W':'S'}</a>;})}</span>;
}
