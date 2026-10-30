export {};
import {displayError,readApiJson} from './api-errors';
const form=document.querySelector<HTMLFormElement>('[data-profile-form]');
if(form){
 const name=form.querySelector<HTMLInputElement>('[name=display_name]')!,phone=form.querySelector<HTMLInputElement>('[name=phone]')!,zalo=form.querySelector<HTMLInputElement>('[name=zalo_phone]')!,intro=form.querySelector<HTMLTextAreaElement>('[name=introduction]')!,button=form.querySelector<HTMLButtonElement>('button[type=submit]')!,error=form.querySelector<HTMLElement>('[data-profile-error]')!;
 const normalize=(s:string)=>s.trim().replace(/[\s().-]/g,'').replace(/^\+84/,'0');
 const data=()=>({display_name:name.value.trim(),seller_type:form.querySelector<HTMLInputElement>('[name=seller_type]:checked')?.value??'',phone:normalize(phone.value),zalo_phone:normalize(zalo.value)||normalize(phone.value),introduction:intro.value.trim()});
 const original=JSON.stringify(data());let saving=false,leaving=false;
 const dirty=()=>JSON.stringify(data())!==original;
 const update=()=>{
  const value=data(),valid={name:value.display_name.length>=2&&value.display_name.length<=100,role:Boolean(value.seller_type),phone:/^0[35789]\d{8}$/.test(value.phone)};
  const complete=Object.values(valid).filter(Boolean).length;
  document.querySelector('[data-profile-completed]')!.textContent=complete+'/3';(document.querySelector('[data-profile-progress]') as HTMLProgressElement).value=complete;
  for(const [key,ok] of Object.entries(valid)){const item=document.querySelector<HTMLElement>('[data-profile-check='+key+']')!;item.dataset.complete=String(ok);item.querySelector('path')?.setAttribute('d',ok?'m5 12 4 4L19 6':'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z');}
  document.querySelector('[data-profile-counter]')!.textContent=intro.value.length+'/600';document.querySelector('[data-profile-preview-name]')!.textContent=value.display_name||'Tên hiển thị của bạn';document.querySelector('[data-profile-initial]')!.textContent=value.display_name.charAt(0).toUpperCase()||'?';document.querySelector('[data-profile-preview-role]')!.textContent=value.seller_type==='owner'?'Chủ trọ':value.seller_type==='broker'?'Môi giới / saler':'Chưa chọn vai trò';document.querySelector('[data-profile-preview-phone]')!.textContent=value.phone||'Chưa thêm số điện thoại';document.querySelector('[data-profile-preview-zalo]')!.textContent=value.zalo_phone?'Zalo: '+value.zalo_phone:'Zalo dùng cùng số điện thoại';
  const changed=dirty();button.disabled=saving||(!changed&&!['new','rejected'].includes(form.dataset.profileState??''));
  form.querySelector('[data-profile-save-caption]')!.textContent=changed?'Có thay đổi chưa gửi':form.dataset.profileState==='new'?'Chưa gửi hồ sơ':'Thông tin đã lưu';
  form.querySelector('[data-profile-dirty-note]')!.textContent=changed?'Gửi để lưu và xét duyệt thông tin mới.':'Kiểm tra thông tin liên hệ trước khi gửi.';
 };
 form.addEventListener('input',()=>{phone.setCustomValidity('');zalo.setCustomValidity('');update();});form.addEventListener('change',update);update();
 window.addEventListener('beforeunload',event=>{if(dirty()&&!leaving){event.preventDefault();}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();const value=data();if(!/^0[35789]\d{8}$/.test(value.phone)){phone.setCustomValidity('Nhập số di động Việt Nam hợp lệ, ví dụ 0901234567.');phone.reportValidity();return;}if(!/^0[35789]\d{8}$/.test(value.zalo_phone)){zalo.setCustomValidity('Nhập số Zalo hợp lệ hoặc để trống để dùng số điện thoại.');zalo.reportValidity();return;}
  if(!form.reportValidity())return;
  saving=true;button.disabled=true;error.hidden=true;
  try{const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,version:Number(new FormData(form).get('version'))}),signal:AbortSignal.timeout(20000)});const result=await readApiJson<{unchanged?:boolean}>(response,'Chưa lưu được hồ sơ. Kiểm tra lại thông tin rồi thử lại.');leaving=true;location.assign('/tai-khoan/ho-so?'+(result.unchanged?'unchanged=1':'updated=1'));}
  catch(e){error.textContent=displayError(e,'Chưa lưu được hồ sơ. Tải lại để kiểm tra trạng thái trước khi gửi thêm.');error.hidden=false;error.scrollIntoView({block:'nearest'});saving=false;update();}
 });
}
