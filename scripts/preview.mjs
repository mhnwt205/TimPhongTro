import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const config=resolve('apps/web/dist/server/wrangler.json');
const args=process.argv.slice(2),stateIndex=args.indexOf('--state'),portIndex=args.indexOf('--port');
const state=resolve(stateIndex>=0?args[stateIndex+1]:'apps/web/.wrangler/preview-state');
const port=portIndex>=0?Number(args[portIndex+1]):4322;
if(!state.startsWith(resolve('.')+'/')||!Number.isSafeInteger(port)||port<3000||port>60000)throw new Error('Preview chỉ dùng state trong dự án và cổng local hợp lệ.');
await access(config).catch(()=>{throw new Error('Hãy chạy npm run build hoặc npm run build:production trước.');});
async function run(args) {
  const code=await new Promise((done)=>{
    const child=spawn('npm',args,{stdio:'inherit'});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
    child.on('error',()=>done(1));child.on('exit',status=>done(status??1));
  });
  if(code)process.exit(code);
}
// Both commands are explicitly LOCAL; preview never connects to the production database.
await run(['exec','--workspace=@timphongtro/web','--','wrangler','d1','migrations','apply','DB','--local','--config',config,'--persist-to',state]);
await run(['exec','--workspace=@timphongtro/web','--','wrangler','dev','--local','--config',config,'--persist-to',state,'--port',String(port),'--inspector-port',String(port+4910)]);
