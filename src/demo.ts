import type { Locale } from './i18n';
import type { Snapshot } from './types';
import { addDays, dateKey } from './calendar';
const copy = {
  ru: { user: 'Вы', groups: ['Свои люди', 'Пиксельная команда', 'Семья'], titles: ['Вечер на сервере','Завтрак без спешки','Планируем выходные','Прогулка у озера','Семейный ужин','Новые идеи'], places: ['Наш Minecraft-сервер','Кофейня в центре','Видеозвонок','У озера','Дома','Видеозвонок'], note: 'Соберёмся вместе! Отметьте, получится ли присоединиться.' },
  en: { user: 'You', groups: ['Our people','Pixel crew','Family'], titles: ['An evening on the server','A slow breakfast','Weekend plans','A walk by the lake','Family dinner','Fresh ideas'], places: ['Our Minecraft server','Downtown café','Video call','By the lake','At home','Video call'], note: 'Let’s get together! Let everyone know if you can make it.' },
  de: { user: 'Du', groups: ['Lieblingsmenschen','Pixel-Crew','Familie'], titles: ['Ein Abend auf dem Server','Frühstück ohne Eile','Wochenendpläne','Spaziergang am See','Familienessen','Neue Ideen'], places: ['Unser Minecraft-Server','Café im Zentrum','Videoanruf','Am See','Zu Hause','Videoanruf'], note: 'Lasst uns zusammenkommen! Sag Bescheid, ob du dabei bist.' },
  fr: { user: 'Vous', groups: ['Nos proches','Équipe pixel','Famille'], titles: ['Soirée sur le serveur','Petit-déjeuner tranquille','Préparons le week-end','Balade au lac','Dîner en famille','Nouvelles idées'], places: ['Notre serveur Minecraft','Café du centre','Appel vidéo','Au bord du lac','À la maison','Appel vidéo'], note: 'Retrouvons-nous ! Dites-nous si vous pouvez venir.' }
};
export function createDemo(locale: Locale): Snapshot {
  const c=copy[locale], today=new Date();
  const members=[{id:'you',name:c.user},{id:'mia',name:'Mia'},{id:'leo',name:'Leo'},{id:'max',name:'Max'},{id:'anna',name:'Anna'}];
  const groups=c.groups.map((name,i)=>({id:`demo-${i}`,name,emoji:['🌿','👾','🏡'][i],color:['#729b75','#9b85ca','#d7a25e'][i],inviteCode:['DEMO01','DEMO02','DEMO03'][i],memberCount:[5,4,3][i],createdBy:'you',members:members.slice(0,[5,4,3][i])}));
  const events=c.titles.map((title,i)=>({id:`event-${i}`,groupId:groups[[1,0,0,0,2,1][i]].id,title,date:dateKey(addDays(today,[0,1,2,4,6,10][i])),startTime:['18:00','10:30','19:00','14:00','18:30','16:00'][i],endTime:['20:00','12:00','20:00','16:00','20:00','17:00'][i],location:c.places[i],notes:c.note,createdBy:'you',responses:{mia:'yes' as const,leo:'yes' as const,...(i%2===0?{max:'maybe' as const}:{you:'yes' as const})}}));
  return {user:{id:'you',name:c.user,locale},groups,events};
}
