import type {CmsNotifications} from '@timphongtro/api';
import {displayError,readApiJson} from './api-errors';
const panel=document.querySelector<HTMLDetailsElement>('[data-notification-root]');
if(panel){
 const trigger=panel.querySelector<HTMLElement>('summary')!;
 let last=Date.now(),busy=false;
 const empty=(message:string)=>{const p=document.createElement('p');p.className='cms-notice-empty';p.textContent=message;return p;};
 const row=(title:string,description:string,href:string,count?:number)=>{
  const a=document.createElement('a');a.className='cms-notice-row';a.href=href;
  const dot=document.createElement('span');dot.className='cms-notice-dot'+(count?'':' neutral');
  const body=document.createElement('div'),strong=document.createElement('strong'),p=document.createElement('p');strong.textContent=title;p.textContent=description;
  if(count){const badge=document.createElement('b');badge.textContent=String(count);strong.appendChild(badge);}
  body.appendChild(strong);body.appendChild(p);a.appendChild(dot);a.appendChild(body);return a;
 };
 const sync=(data:CmsNotifications)=>{
  for(const badge of document.querySelectorAll<HTMLElement>('[data-notification-count]')){badge.hidden=data.pending===0;badge.textContent=data.pending>99?'99+':String(data.pending);}
  for(const [selector,count] of [['[data-listing-queue-count]',data.counts.listings],['[data-seller-queue-count]',data.counts.sellers],['[data-topup-queue-count]',data.counts.topups],['[data-withdrawal-queue-count]',data.counts.withdrawals],['[data-renewal-queue-count]',data.counts.renewals]] as const)for(const badge of document.querySelectorAll<HTMLElement>(selector)){badge.hidden=count===0;badge.textContent=count>99?'99+':String(count);}
  trigger.setAttribute('aria-label',data.pending?`Thông báo, ${data.pending} mục cần xử lý`:'Thông báo và công việc');
  panel.querySelector('[data-notification-caption]')!.textContent=`${data.pending} mục cần xử lý`;
  panel.querySelector('[data-notification-queue]')!.replaceChildren(...(data.items.length?data.items.map(i=>row(i.title,i.description,i.href,i.count)):[empty('Không có công việc chờ trong phạm vi của bạn.')]));
  panel.querySelector('[data-notification-activity]')?.replaceChildren(...(data.activity.length?data.activity.map(i=>row(i.label,i.actor+' · '+new Date(i.created_at*1000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),i.href)):[empty('Chưa có hoạt động quản trị.')]));
 };
 async function refresh(force=false){
  if(busy||document.visibilityState==='hidden'||!force&&Date.now()-last<15000)return;
  busy=true;const error=panel!.querySelector<HTMLElement>('[data-notification-error]')!;
  try{
   const response=await fetch('/api/cms/notifications',{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok&&[401,403].includes(response.status)){panel!.querySelector('[data-notification-queue]')!.replaceChildren();panel!.querySelector('[data-notification-activity]')?.replaceChildren();for(const badge of document.querySelectorAll<HTMLElement>('[data-renewal-queue-count],[data-notification-count],[data-seller-queue-count],[data-topup-queue-count],[data-withdrawal-queue-count],[data-listing-queue-count]'))badge.hidden=true;}
   sync(await readApiJson<CmsNotifications>(response,'Không thể cập nhật thông báo. Hãy tải lại trang rồi thử lại.'));error.hidden=true;last=Date.now();
  }catch(e){error.textContent=displayError(e,'Không thể cập nhật thông báo. Hãy tải lại trang rồi thử lại.');error.hidden=false;}finally{busy=false;}
 }
 panel.addEventListener('toggle',()=>{trigger.setAttribute('aria-expanded',String(panel.open));if(panel.open)void refresh();});
 panel.querySelector('[data-close-notifications]')?.addEventListener('click',()=>{panel.open=false;trigger.focus();});
 document.addEventListener('click',event=>{if(panel.open&&!panel.contains(event.target as Node))panel.open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel.open){panel.open=false;trigger.focus();}});
 window.addEventListener('focus',()=>void refresh());
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
 window.setInterval(()=>void refresh(),60000);
}
