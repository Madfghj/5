import {useEffect,useRef} from 'react';
import {App as NativeApp} from '@capacitor/app';
import {api,API_BASE,native} from './api';
import {desktop,observeDesktopWindow,publicHttpsOrigin} from './desktop';
import type {Locale} from './i18n';
import type {PresenceMode,PresenceStatus,User} from './types';

const copy={
  en:{label:'Your status',online:'Online',away:'Away',dnd:'Do not disturb',offline:'Offline',hint:'Your status updates automatically when you enter or leave. You can also choose a status.'},
  ru:{label:'Твой статус',online:'В сети',away:'Отошёл',dnd:'Не беспокоить',offline:'Не в сети',hint:'При входе и выходе статус обновляется автоматически. Его также можно выбрать вручную.'},
  de:{label:'Dein Status',online:'Online',away:'Abwesend',dnd:'Nicht stören',offline:'Offline',hint:'Dein Status aktualisiert sich beim Öffnen und Verlassen automatisch. Du kannst ihn auch selbst wählen.'},
  fr:{label:'Votre statut',online:'En ligne',away:'Absent',dnd:'Ne pas déranger',offline:'Hors ligne',hint:'Votre statut change automatiquement à l’ouverture et à la fermeture. Vous pouvez aussi le choisir.'},
};

export function PresenceDot({status,locale='en'}:{status?:PresenceStatus;locale?:Locale}) {
  return status?<span className={`presence-dot presence-${status}`} role="img" aria-label={copy[locale][status]} title={copy[locale][status]}/>:null;
}

export function usePresence(token:string|null,onPresence?:(presence:NonNullable<User['presence']>)=>void) {
  const callback=useRef(onPresence),initialPulse=useRef<Promise<void>>(Promise.resolve());
  callback.current=onPresence;
  useEffect(()=>{
    if(!token)return;
    let stopped=false,foreground=!desktop;
    const pulse=async()=>{
      if(stopped||!foreground||document.visibilityState==='hidden')return;
      await api<{presence:NonNullable<User['presence']>}>('/presence/heartbeat',token,{}).then(result=>{if(!stopped)callback.current?.(result.presence);}).catch(()=>{});
    };
    const leave=()=>desktop&&!publicHttpsOrigin(API_BASE)?Promise.resolve():fetch(`${API_BASE}/api/presence/leave`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}',keepalive:true}).then(()=>{}).catch(()=>{});
    const visibility=()=>document.visibilityState==='hidden'?leave():void pulse();
    const desktopListener=desktop?observeDesktopWindow({focus:focused=>{foreground=focused;if(focused)void pulse();else void leave();},close:()=>{foreground=false;return leave();}}):null;
    initialPulse.current=desktopListener?desktopListener.ready.then(()=>pulse()):pulse();
    const timer=setInterval(()=>void pulse(),30_000);
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',leave);
    window.addEventListener('pageshow',pulse);
    const listener=native&&!desktop?NativeApp.addListener('appStateChange',state=>{foreground=state.isActive;if(foreground)void pulse();else leave();}):null;
    return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',pulse);void listener?.then(handle=>handle.remove());desktopListener?.dispose();};
  },[token]);
  return initialPulse;
}

export default function PresenceControl({locale,presence,busy,onChange}:{locale:Locale;presence?:User['presence'];busy:boolean;onChange:(mode:PresenceMode)=>void}) {
  const t=copy[locale];
  return <div className="presence-control"><label className="field"><span><PresenceDot status={presence?.status} locale={locale}/>{t.label}</span><select value={presence?.mode||'online'} disabled={busy} onChange={event=>onChange(event.target.value as PresenceMode)}><option value="online">● {t.online}</option><option value="away">◐ {t.away}</option><option value="dnd">⊖ {t.dnd}</option><option value="invisible">○ {t.offline}</option></select></label><p>{t.hint}</p></div>;
}
