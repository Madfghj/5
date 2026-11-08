import type {Locale} from './i18n';
import type {Snapshot} from './types';

// Real sessions always start empty while their own server data loads.
// Demo storage is only consulted after an explicit choice in a development build.
export function bootstrapSession(token:string|null,allowDemo:boolean,demoRequested:boolean,locale:Locale,restoreDemo:()=>Snapshot|null,createDemo:()=>Snapshot) {
  const demoEnabled=!token&&allowDemo&&demoRequested;
  return {
    token,demoEnabled,onboarding:!token&&!demoEnabled,
    snapshot:demoEnabled?restoreDemo()||createDemo():{user:{id:'',name:'',locale},groups:[],events:[]} as Snapshot,
  };
}
