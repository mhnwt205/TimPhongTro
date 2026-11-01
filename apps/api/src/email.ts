import type {Bindings} from './security';

export type EmailMessage={to:string;subject:string;html:string;text:string;key:string};
export function escapeHtml(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]??char));}
export async function sendResend(env:Bindings,message:EmailMessage):Promise<boolean>{
 if(env.EMAIL_TEST_CAPTURE==='true')return true;
 const key=env.RESEND_API_KEY,from=env.EMAIL_FROM;
 if(!key||!from||key.length>256||from.length>254||message.to.length>254)return false;
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':message.key},body:JSON.stringify({from,to:[message.to],subject:message.subject,html:message.html,text:message.text})});
  return response.ok;
 }catch{return false;}
}
export function emailShell(title:string,paragraphs:string[],url:string,button:string){
 const content=paragraphs.map(p=>`<p style="font:16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#334b59">${escapeHtml(p)}</p>`).join('');
 return `<!doctype html><html lang="vi"><body style="margin:0;background:#f3f7f9;padding:28px 12px"><main style="max-width:560px;margin:auto;background:white;border:1px solid #dce6eb;border-radius:14px;padding:32px"><p style="font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;color:#087e9c">TRỌ TỐT TP.HCM</p><h1 style="font:600 23px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#193b4d">${escapeHtml(title)}</h1>${content}<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0d7792;color:white;text-decoration:none;padding:13px 20px;border-radius:8px;font:600 15px -apple-system,BlinkMacSystemFont,sans-serif">${escapeHtml(button)}</a></p><p style="font:13px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;color:#657b88">Nếu bạn không thực hiện yêu cầu này, có thể bỏ qua email.</p></main></body></html>`;
}
