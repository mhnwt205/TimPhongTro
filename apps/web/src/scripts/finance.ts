import {downloadQrPng} from './qr-download';
import {displayError,readApiJson} from './api-errors';
const dialog=document.querySelector<HTMLDialogElement>('#finance-confirm');
let pendingForm:HTMLFormElement|null=null;
const money=(v:number)=>v.toLocaleString('vi-VN')+'đ';
function body(form:HTMLFormElement){
 const values:Record<string,unknown>=Object.fromEntries(new FormData(form));
 for(const control of form.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))if(control.name)values[control.name]=control.checked;
 for(const control of form.querySelectorAll<HTMLInputElement>('input[type=hidden][name=confirmed]'))values[control.name]=control.value==='true';
 for(const control of form.querySelectorAll<HTMLInputElement>('[data-number]'))if(control.name)values[control.name]=Number(control.value);
 return values;
}
async function submit(form:HTMLFormElement){
 const error=form.querySelector<HTMLElement>('[data-finance-error]')!,button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;
 const confirmation=dialog?.querySelector<HTMLButtonElement>('[data-finance-confirm-submit]');
 button.disabled=true;if(confirmation)confirmation.disabled=true;error.hidden=true;
 try{
  const response=await fetch(form.dataset.endpoint!,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body(form)),signal:AbortSignal.timeout(20000)});
  const data=await readApiJson<{topup?:{code:string};withdrawal?:{code:string}}>(response,'Không thực hiện được thao tác. Kiểm tra lại thông tin rồi thử lại.');
  const target=data.topup?'/tai-khoan/nap-tien/'+encodeURIComponent(data.topup.code):data.withdrawal?'/tai-khoan/rut-tien/'+encodeURIComponent(data.withdrawal.code):form.dataset.successUrl;
  if(target)location.assign(target);else location.reload();
 }catch(e){dialog?.close();error.textContent=displayError(e,'Không thực hiện được thao tác. Tải lại trang để kiểm tra trạng thái trước khi thử lại.');error.hidden=false;error.scrollIntoView({block:'nearest'});button.disabled=false;if(confirmation)confirmation.disabled=false;}
}
for(const form of document.querySelectorAll<HTMLFormElement>('[data-finance-form]'))form.addEventListener('submit',event=>{
 event.preventDefault();const data=body(form),kind=form.dataset.confirm;
 if(!kind||kind==='settings'&&!data.accepting_topups){void submit(form);return;}
 if(!dialog)return;pendingForm=form;
 const beneficiary=form.dataset.beneficiary??'',amount=Number(data.actual_vnd??data.amount_vnd??0);
 const descriptions:Record<string,string>={
  withdrawal:`Giữ ${money(amount)} để rút về ${String(data.account_holder??'')} · ${String(data.account_number??'')}.`,
  'withdrawal-cancel':'Hủy yêu cầu rút và hoàn khoản tiền đang giữ về số dư khả dụng?',
  'withdrawal-approve':'Duyệt yêu cầu và đưa vào trạng thái đang chuyển khoản? Tiền chưa được chuyển tự động.',
  'withdrawal-reject':'Từ chối yêu cầu và hoàn khoản giữ? Chỉ thực hiện khi chắc chắn chưa chuyển tiền.',
  'withdrawal-claim':'Nhận xử lý yêu cầu này? Chỉ bạn có thể xác nhận chuyển hoặc nhả xử lý sau bước này.',
  'withdrawal-release':'Nhả xử lý để quản trị viên khác tiếp tục? Chỉ thực hiện khi chắc chắn chưa chuyển tiền.',
  'withdrawal-pay':`Xác nhận đã chuyển ${money(amount)} cho ${beneficiary}. Mã ngân hàng: ${String(data.bank_reference??'')}.`,
  reconcile:data.provider_transaction_id?`Ghi nhận ${money(amount)} cho ${beneficiary}. Mã giao dịch SePay: ${String(data.provider_transaction_id)}.`:`Ghi nhận ${money(amount)} cho ${beneficiary}. Mã giao dịch ngân hàng: ${String(data.bank_reference??'')}.`,
  adjustment:`Điều chỉnh ${amount>0?'+':''}${money(amount)} vào số dư đăng tin của ${beneficiary}.`,
  report:'Xác nhận bạn đã thực hiện chuyển khoản cho yêu cầu này.',
  cancel:'Hủy yêu cầu chưa chuyển tiền này?',
  settings:'Mở nhận yêu cầu nạp tiền qua SePay.',
  review:'Xác nhận thay đổi trạng thái xử lý yêu cầu nạp này.'
 };
 dialog.querySelector('[data-finance-confirm-text]')!.textContent=descriptions[kind]??'Xác nhận thực hiện thao tác?';
 dialog.querySelector('[data-finance-confirm-note]')!.textContent=kind.startsWith('withdrawal')?'Kiểm tra đúng ngân hàng, số tài khoản, tên người nhận và số tiền. Duyệt trên website không thực hiện chuyển khoản ngân hàng. Chỉ đánh dấu đã chuyển sau khi ngân hàng báo thành công.':kind==='report'?'Báo đã chuyển không tự cộng số dư. Quản trị viên sẽ kiểm tra khoản tiền thực nhận.':kind==='adjustment'?'Thao tác chỉ thay đổi số dư đăng tin. Việc chuyển hoặc hoàn tiền ngân hàng được xử lý riêng.':kind==='reconcile'&&data.provider_transaction_id?'Chỉ xác nhận sau khi đã kiểm tra giao dịch SePay và số tiền thực nhận. Thao tác sẽ cộng khoản tiền vào số dư và lưu lịch sử.':kind==='reconcile'?'Chỉ xác nhận sau khi đã đối chiếu giao dịch thực tế. Thao tác cập nhật số dư và lưu lịch sử giao dịch.':kind==='settings'?'Người đăng đã được duyệt sẽ có thể tạo yêu cầu nạp và thanh toán qua SePay.':'Lịch sử xử lý sẽ được lưu lại.';
 dialog.showModal();
});
dialog?.querySelector('[data-finance-confirm-submit]')?.addEventListener('click',()=>{if(pendingForm)void submit(pendingForm);});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-topup-amount]'))button.addEventListener('click',()=>{const input=document.querySelector<HTMLInputElement>('#topup-amount');if(input){input.value=button.dataset.topupAmount!;input.focus();}});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-value]'))button.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(button.dataset.copyValue!);const toast=document.querySelector<HTMLElement>('[data-toast]');if(toast){toast.textContent='Đã sao chép.';toast.hidden=false;window.setTimeout(()=>toast.hidden=true,2500);}}
 catch{const toast=document.querySelector<HTMLElement>('[data-toast]');if(toast){toast.textContent='Chưa sao chép được. Bạn có thể chọn và sao chép nội dung đang hiển thị.';toast.hidden=false;window.setTimeout(()=>toast.hidden=true,4000);}}
});

for(const select of document.querySelectorAll('[data-bank-code]'))select.addEventListener('change',()=>{const field=document.querySelector<HTMLInputElement>('#bank-name'),option=select.querySelector('option:checked') as HTMLElement|null;if(field)field.value=option?.dataset.bankName??'';});

for(const button of document.querySelectorAll<HTMLButtonElement>('[data-download-topup-qr]')){button.hidden=false;button.addEventListener('click',async()=>{
 const img=document.querySelector<HTMLImageElement>('[data-topup-qr]');if(!img)return;
 button.disabled=true;
 try{
  await downloadQrPng(img.src,button.dataset.qrFilename??'nap-tien');
 }catch(e){const toast=document.querySelector<HTMLElement>('[data-toast]');if(toast){toast.textContent=displayError(e,'Chưa lưu được ảnh QR. Bạn có thể quét mã trực tiếp trên màn hình.');toast.hidden=false;window.setTimeout(()=>toast.hidden=true,5000);}}
 finally{button.disabled=false;}
});}

for(const button of document.querySelectorAll<HTMLButtonElement>('[data-sepay-checkout]'))button.addEventListener('click',async()=>{
 const error=document.querySelector<HTMLElement>('[data-sepay-error]');button.disabled=true;if(error)error.hidden=true;
 try{
  const code=button.dataset.sepayCheckout??'';
  const response=await fetch('/api/account/topups/'+encodeURIComponent(code)+'/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
  const checkout=await readApiJson<{checkout_url:string;fields:Record<string,string|number>}>(response,'Chưa mở được trang thanh toán. Tải lại yêu cầu rồi thử lại.');
  const target=new URL(checkout.checkout_url);
  if(target.protocol!=='https:'||!['pay-sandbox.sepay.vn','pay.sepay.vn'].includes(target.hostname)||!checkout.fields||typeof checkout.fields!=='object')throw new Error('Thông tin thanh toán không hợp lệ. Tải lại trang rồi thử lại.');
  const paymentForm=document.createElement('form');paymentForm.method='POST';paymentForm.action=target.toString();paymentForm.hidden=true;
  for(const [name,value] of Object.entries(checkout.fields)){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=String(value);paymentForm.appendChild(input);}
  document.body.appendChild(paymentForm);HTMLFormElement.prototype.submit.call(paymentForm);
 }catch(e){if(error){error.textContent=displayError(e,'Chưa mở được trang thanh toán. Kiểm tra trạng thái yêu cầu rồi thử lại.');error.hidden=false;error.scrollIntoView({block:'nearest'});}button.disabled=false;}
});

const statusPoll=document.querySelector<HTMLElement>('[data-topup-status-poll]');
if(statusPoll){
 let attempts=0;const endpoint=statusPoll.dataset.topupStatusPoll!;
 const poll=async()=>{
  if(attempts++>=10){statusPoll.classList.add('warning');statusPoll.textContent='Chưa nhận được xác nhận thanh toán. Đừng thanh toán lần nữa; hãy tải lại trang sau ít phút để kiểm tra lại.';return;}
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal:AbortSignal.timeout(15000)});const data=await readApiJson<{credited?:boolean;exception?:boolean;pending?:boolean}>(response,'');if(data.credited||data.exception||data.pending===false){window.location.replace(location.pathname);return;}}
  catch{}
  window.setTimeout(poll,5000);
 };
 window.setTimeout(poll,1000);
}
