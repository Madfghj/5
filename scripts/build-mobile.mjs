import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const config=JSON.parse(await readFile(new URL('../mobile.config.json',import.meta.url),'utf8'));
const raw=process.env.VITE_API_URL||config.apiOrigin;
const api=new URL(raw);
if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||!['','/'].includes(api.pathname)||['localhost','127.0.0.1','0.0.0.0','::1'].includes(api.hostname))throw Error('Set a public HTTPS API origin in mobile.config.json or VITE_API_URL.');
const env={...process.env,VITE_API_URL:api.origin};
for(const args of [['node_modules/typescript/bin/tsc','-b'],['node_modules/vite/bin/vite.js','build','--outDir','dist-mobile']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env,windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
console.log(`Native UI is connected to ${api.origin}`);
