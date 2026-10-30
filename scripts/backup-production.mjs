// Read-only logical backup before schema changes; contains private data, never print its rows.
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Missing Cloudflare credentials.');
const database='53bbfe5b-25d6-419a-b89e-f450d795027c';
async function query(sql){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql})});
 const d=await r.json();if(!r.ok||!d.success)throw new Error('Backup query failed. No private data printed.');return d.result[0].results;
}
const schema=await query("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name");
const tables={};
for(const row of schema.filter(r=>r.type==='table'&&!r.name.startsWith('_cf_'))){
 if(!/^[a-zA-Z0-9_]+$/.test(row.name))throw new Error('Unexpected table name.');
 tables[row.name]=await query('SELECT * FROM "'+row.name+'"');
}
const folder=resolve('.cache/backups');await mkdir(folder,{recursive:true,mode:0o700});
const path=resolve(folder,'before-cms-'+new Date().toISOString().replaceAll(':','-')+'.json');
await writeFile(path,JSON.stringify({at:new Date().toISOString(),database,schema,tables}),{mode:0o600});
console.log('Logical backup saved locally with restricted permissions: '+Object.keys(tables).length+' tables, '+(await stat(path)).size+' bytes.');
