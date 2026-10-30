import {readApiJson} from './api-errors';
export async function downloadQrPng(endpoint:string,filename:string):Promise<void>{
 const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok){try{await readApiJson(response,'Chưa tải được mã QR. Tải lại trang để kiểm tra trạng thái yêu cầu.');}catch(error){throw error;}throw new Error('Chưa tải được mã QR. Tải lại trang để kiểm tra trạng thái yêu cầu.');}
 const svg=await response.blob(),source=URL.createObjectURL(svg),loaded=new Image();
 try{
  loaded.src=source;await loaded.decode();
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=900;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Chưa lưu được ảnh QR. Bạn có thể quét trực tiếp trên màn hình.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,900,900);ctx.drawImage(loaded,0,0,900,900);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Chưa lưu được ảnh QR.')),'image/png'));
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename+'.png';document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
 }finally{URL.revokeObjectURL(source);}
}
