import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
if(Number(process.versions.node.split('.')[0])<24) { console.error('OpenCalendar needs Node.js 24 or newer.');process.exit(1); }
if(!existsSync('node_modules/wrangler/bin/wrangler.js')) { console.error('Install dependencies first: pnpm install --frozen-lockfile');process.exit(1); }
const api=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','wrangler.json','--ip','127.0.0.1','--port','8788','--persist-to','.wrangler/state','--inspector-port','0'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort'],{cwd:root,stdio:'inherit',windowsHide:true});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;api.kill();ui.kill();process.exitCode=code;}
api.on('exit',code=>stop(code||0));ui.on('exit',code=>stop(code||0));
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
console.log('\nOpenCalendar.space: http://127.0.0.1:5174\nPress Ctrl+C to stop.\n');
