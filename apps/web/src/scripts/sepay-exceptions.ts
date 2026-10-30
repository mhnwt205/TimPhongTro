import {displayError,readApiJson} from './api-errors';

for(const form of document.querySelectorAll<HTMLFormElement>('[data-sepay-exception-form]'))form.addEventListener('submit',async event=>{
 event.preventDefault();
 const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!,error=form.querySelector<HTMLElement>('[data-sepay-exception-error]')!;
 const note=form.querySelector<HTMLInputElement>('input[name=note]')?.value.trim()??'';
 if(note.length<5){error.textContent='Nhập ghi chú kiểm tra từ 5 ký tự.';error.hidden=false;return;}
 button.disabled=true;error.hidden=true;
 try{
  const response=await fetch(form.dataset.endpoint!,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note}),signal:AbortSignal.timeout(15000)});
  await readApiJson(response,'Chưa cập nhật được trạng thái kiểm tra. Tải lại trang rồi thử lại.');
  window.location.reload();
 }catch(e){error.textContent=displayError(e,'Chưa cập nhật được trạng thái kiểm tra. Tải lại trang rồi thử lại.');error.hidden=false;button.disabled=false;}
});
