import {downloadQrPng} from './qr-download';
const panel=document.querySelector<HTMLElement>('[data-withdrawal-qr-panel]');
if(panel){
 const image=panel.querySelector<HTMLImageElement>('[data-withdrawal-qr]'),content=panel.querySelector<HTMLElement>('[data-withdrawal-qr-content]'),error=panel.querySelector<HTMLElement>('[data-withdrawal-qr-error]'),button=panel.querySelector<HTMLButtonElement>('[data-download-withdrawal-qr]');
 if(image&&content&&error&&button){
  let stopped=false,checking=false;
  const stop=(message:string)=>{stopped=true;content.hidden=true;button.disabled=true;image.removeAttribute('src');error.textContent=message;error.hidden=false;window.clearInterval(timer);};
  const verify=async()=>{
   if(stopped||checking||document.visibilityState==='hidden')return;
   checking=true;
   try{
    const response=await fetch(panel.dataset.detailUrl!,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error();
    const data=await response.json() as {qr_available:boolean;withdrawal:{version:number;status:string;processor_id:string|null}};
    const r=data.withdrawal;
    if(!data.qr_available||r.status!=='approved'||r.version!==Number(panel.dataset.version)||r.processor_id!==panel.dataset.processor)stop('Yêu cầu đã thay đổi. Tải lại trang để kiểm tra trước khi chuyển tiền.');
   }catch{stop('Chưa kiểm tra được trạng thái yêu cầu. Tải lại trang trước khi chuyển tiền.');}
   finally{checking=false;}
  };
  const timer=window.setInterval(()=>void verify(),30000);
  window.addEventListener('focus',()=>void verify());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void verify();});
  image.addEventListener('error',()=>{if(!stopped)stop('Chưa tải được mã QR. Tải lại trang để kiểm tra trước khi chuyển tiền.');});
  if(image.complete&&!image.naturalWidth)stop('Chưa tải được mã QR. Tải lại trang để kiểm tra trước khi chuyển tiền.');
  button.hidden=false;
  button.addEventListener('click',async()=>{
   if(stopped)return;button.disabled=true;
   try{await downloadQrPng(image.src,button.dataset.qrFilename??'rut-tien');}
   catch{stop('Chưa lưu được mã QR. Tải lại trang để kiểm tra trạng thái yêu cầu.');}
   finally{if(!stopped)button.disabled=false;}
  });
 }
}
