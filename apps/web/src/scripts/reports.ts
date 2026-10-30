import {displayError,readApiJson} from './api-errors';
for(const form of document.querySelectorAll<HTMLFormElement>('[data-report-form],[data-report-review]'))form.addEventListener('submit',async event=>{
 event.preventDefault();const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!,error=form.querySelector<HTMLElement>('[data-report-error]')!;
 button.disabled=true;error.hidden=true;
 try{
  const body:Record<string,unknown>=Object.fromEntries(new FormData(form));if(form.hasAttribute('data-report-review'))body.version=Number(body.version);
  const r=await fetch(form.dataset.endpoint??form.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await readApiJson<{code?:string}>(r,'Chưa gửi được thông tin. Kiểm tra nội dung rồi thử lại.');
  if(form.hasAttribute('data-report-review')){location.reload();return;}
  form.hidden=true;const success=document.querySelector<HTMLElement>('[data-report-success]')!;success.querySelector('[data-report-code]')!.textContent=data.code??'';success.hidden=false;success.scrollIntoView({block:'nearest'});
 }catch(e){error.textContent=displayError(e,'Chưa xác nhận được kết quả. Tải lại trang để kiểm tra trước khi gửi lại.');error.hidden=false;button.disabled=false;}
});
