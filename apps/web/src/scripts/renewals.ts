export {};
import {displayError,readApiJson} from './api-errors';
const money=(n:number)=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
const date=(n:number)=>new Date(n*1000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
async function send(path:string,body:unknown){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await readApiJson(r,'Chưa lưu được yêu cầu. Kiểm tra thông tin rồi thử lại.');}
const form=document.querySelector<HTMLFormElement>('[data-renewal-create]');
if(form){
 const select=form.querySelector('select') as HTMLSelectElement,preview=form.querySelector<HTMLElement>('[data-renewal-preview]')!,error=form.querySelector<HTMLElement>('[data-renewal-error]')!;
 select.addEventListener('change',()=>{const option=select.selectedOptions[0];preview.textContent=select.value?'Phí '+money(Number(option.dataset.price))+' · Ngày hết hạn dự kiến '+date(Math.max(Number(form.dataset.currentExpiry),Math.floor(Date.now()/1000))+Number(option.dataset.days)*86400)+'. Thời hạn chính xác được xác định khi CMS duyệt.':'Chọn gói để xem phí và ngày hết hạn dự kiến.';});
 form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const values=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;error.hidden=true;
  try{await send('/api/account/listings/'+form.dataset.id+'/renewals',{plan_id:values.get('plan_id'),request_key:form.dataset.requestKey,confirmed:values.has('confirmed')});window.location.reload();}catch(e){error.textContent=displayError(e,'Chưa gửi được yêu cầu gia hạn. Kiểm tra trạng thái tin rồi thử lại.');error.hidden=false;button.disabled=false;}
 });
}
const cancelDialog=document.querySelector<HTMLDialogElement>('[data-renewal-cancel-dialog]');
if(cancelDialog){let selected:HTMLButtonElement|null=null;const error=cancelDialog.querySelector<HTMLElement>('[data-cancel-error]')!;
 document.querySelectorAll<HTMLButtonElement>('[data-renewal-cancel]').forEach(button=>button.addEventListener('click',()=>{selected=button;error.hidden=true;cancelDialog.showModal();}));
 cancelDialog.querySelector('[data-keep-renewal]')?.addEventListener('click',()=>cancelDialog.close());
 cancelDialog.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.addEventListener('click',async e=>{if(!selected)return;const button=e.currentTarget as HTMLButtonElement;button.disabled=true;try{await send('/api/account/renewals/'+selected.dataset.renewalCancel+'/cancel',{version:Number(selected.dataset.version)});window.location.reload();}catch(e){error.textContent=displayError(e,'Chưa hủy được yêu cầu. Tải lại trang để kiểm tra trạng thái rồi thử lại.');error.hidden=false;button.disabled=false;}});
}
document.querySelectorAll<HTMLFormElement>('[data-renewal-review]').forEach(form=>form.addEventListener('submit',async e=>{
 e.preventDefault();const values=new FormData(form),error=form.querySelector<HTMLElement>('[data-renewal-error]')!,button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;error.hidden=true;button.disabled=true;
 try{await send('/api/cms/renewals/'+form.dataset.id+'/review',{version:Number(form.dataset.version),listing_version:Number(form.dataset.listingVersion),decision:values.get('decision'),note:values.get('note'),confirmed:values.has('confirmed')});window.location.reload();}catch(e){error.textContent=displayError(e,'Chưa lưu được kết quả gia hạn. Tải lại trang để kiểm tra trạng thái rồi thử lại.');error.hidden=false;button.disabled=false;}
}));
