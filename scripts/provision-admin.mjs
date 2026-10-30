// Explicit operator action. Password is read without terminal echo, held only in memory.
import {hashPassword} from '../apps/api/src/password.ts';
const args=process.argv.slice(2);
const emailIndex=args.indexOf('--email'),email=(args[emailIndex+1]??'').toLowerCase();
if(!args.includes('--remote')||emailIndex<0||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('Usage: node --use-env-proxy scripts/provision-admin.mjs --remote --email <email>');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Cloudflare credentials required.');
const database='53bbfe5b-25d6-419a-b89e-f450d795027c';
async function query(sql,params=[]){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
 const d=await r.json();if(!r.ok||!d.success)throw new Error('D1 request failed; no credential details printed.');return d.result[0];
}
const verifyOnly=args.includes('--verify-only');
if(!verifyOnly&&(await query('SELECT id FROM users WHERE email=?',[email])).results.length)throw new Error('Email already exists. Existing password and privileges were preserved.');
function secret(){
 return new Promise((resolve,reject)=>{
  if(!process.stdin.isTTY){reject(new Error('Interactive terminal required.'));return;}
  process.stdout.write('Nhập mật khẩu admin (ẩn): ');process.stdin.setRawMode(true);process.stdin.resume();let value='';
  const receive=(buffer)=>{for(const ch of buffer.toString()){
   if(ch==='\u0003'){process.stdin.setRawMode(false);process.stdin.pause();reject(new Error('Cancelled'));return;}
   if(ch==='\r'||ch==='\n'){process.stdin.off('data',receive);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);return;}
   if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else value+=ch;
  }};process.stdin.on('data',receive);
 });
}
let password=await secret();if(password.length<12||password.length>128)throw new Error('Password must be 12–128 characters.');
if(!verifyOnly){
const digest=await hashPassword(password);
const result=await query(`INSERT INTO users(id,email,name,password_hash,role,is_super_admin,email_verified_at,change_token) VALUES(?,?,?,?,'admin',1,unixepoch(),?) ON CONFLICT(email) DO NOTHING RETURNING id`,[crypto.randomUUID(),email,'Quản trị website',digest,crypto.randomUUID()]);
if(result.results.length!==1)throw new Error('Account already exists; no password was overwritten.');
const verified=await query(`SELECT count(*) AS n FROM users u WHERE email=? AND is_super_admin=1 AND is_locked=0 AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM admin_audit a WHERE a.target_id=u.id AND a.action='admin.bootstrap')`,[email]);
if(verified.results[0]?.n!==1)throw new Error('Could not verify grant/audit.');
console.log('Created and verified administrator; password and hash were not printed.');
}
const base='https://trotothcm.id.vn';
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password,context:'cms'})});
password='';
const auth=await login.json();if(!login.ok||!auth.user?.is_super_admin)throw new Error('Live CMS login could not be verified.');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
if(!cookie)throw new Error('Missing CMS session.');
try{
 for(const path of ['/quan-tri','/quan-tri/tai-khoan','/quan-tri/vai-tro','/quan-tri/nguoi-dang','/quan-tri/goi-dang-tin','/quan-tri/khu-vuc','/quan-tri/noi-dung','/quan-tri/tin-phong','/quan-tri/nhat-ky','/quan-tri/bao-mat','/api/cms/summary']){
  const response=await fetch(base+path,{headers:{Cookie:cookie},redirect:'manual'});if(response.status!==200)throw new Error('Live CMS route failed: '+path);
  if(!response.headers.get('cache-control')?.includes('no-store'))throw new Error('Missing private cache protection.');
 }
 console.log('Live CMS login and all 10 management screens verified.');
}finally{await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:'{}'});}
