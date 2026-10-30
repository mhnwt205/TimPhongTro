import {displayError,readApiJson} from './api-errors';
export {};

const form=document.querySelector<HTMLFormElement>('[data-listing-form]');
if(form&&form.dataset.editable!=='false'){
 const error=form.querySelector<HTMLElement>('[data-listing-error]')!;
 const uploadError=form.querySelector<HTMLElement>('[data-upload-error]')!;
 const status=form.querySelector<HTMLElement>('[data-upload-status]')!;
 const grid=form.querySelector<HTMLElement>('[data-listing-photos]')!;
 const input=form.querySelector<HTMLInputElement>('#listing-photos')!;
 const cms=form.dataset.mode==='cms';
 const ownerSelect=form.querySelector('#listing-owner') as HTMLSelectElement|null;
 let photos:string[]=JSON.parse(form.dataset.photos??'[]');
 let busy=false,dirty=false,leaving=false;
 let selectedOwner=ownerSelect?.value??'';

 const message=(el:HTMLElement,text:string)=>{el.textContent=text;el.hidden=!text;};
 const render=()=>{
  grid.replaceChildren();
  photos.forEach((id,index)=>{
   const figure=document.createElement('figure');figure.className='listing-photo';
   const image=document.createElement('img');image.src='/api/listing-images/'+id;image.alt='Ảnh phòng '+(index+1);image.loading='lazy';image.decoding='async';
   const caption=document.createElement('figcaption');caption.textContent=index===0?'Ảnh bìa':'Ảnh '+(index+1);
   const actions=document.createElement('div');
   if(index>0){const cover=document.createElement('button');cover.type='button';cover.textContent='Làm ảnh bìa';cover.addEventListener('click',()=>{photos.splice(index,1);photos.unshift(id);dirty=true;render();});actions.appendChild(cover);}
   const remove=document.createElement('button');remove.type='button';remove.textContent='Gỡ ảnh';remove.setAttribute('aria-label','Gỡ ảnh phòng '+(index+1));remove.addEventListener('click',()=>{photos.splice(index,1);dirty=true;render();});
   actions.appendChild(remove);figure.appendChild(image);figure.appendChild(caption);figure.appendChild(actions);grid.appendChild(figure);
  });
 };
 render();
 form.addEventListener('input',()=>dirty=true);
 window.addEventListener('beforeunload',event=>{if(dirty&&!leaving)event.preventDefault();});

 type ImageSource={width:number;height:number;draw:(context:CanvasRenderingContext2D,width:number,height:number)=>void;close:()=>void};
 async function openImage(file:File):Promise<ImageSource>{
  if(typeof createImageBitmap==='function'){
   try{
    const bitmap=await createImageBitmap(file);
    return {width:bitmap.width,height:bitmap.height,draw:(context,width,height)=>context.drawImage(bitmap,0,0,width,height),close:()=>bitmap.close()};
   }catch{/* Try the browser's built-in image viewer for phone photo formats. */}
  }
  const objectUrl=URL.createObjectURL(file),image=new Image();
  try{
   await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Ảnh này không mở được trên trình duyệt của thiết bị.'));image.src=objectUrl;});
   return {width:image.naturalWidth,height:image.naturalHeight,draw:(context,width,height)=>context.drawImage(image,0,0,width,height),close:()=>URL.revokeObjectURL(objectUrl)};
  }catch{
   URL.revokeObjectURL(objectUrl);
   throw new Error('Không mở được ảnh này. Hãy chọn ảnh JPG, PNG hoặc đổi ảnh sang định dạng tương thích rồi thử lại.');
  }
 }
 function toBlob(canvas:HTMLCanvasElement,quality:number):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Không xử lý được ảnh trên thiết bị. Hãy thử ảnh khác.')),'image/jpeg',quality));
 }
 function blobToBase64(blob:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>{const result=String(reader.result??''),comma=result.indexOf(',');comma<0?reject(new Error('Không chuẩn bị được ảnh để gửi.')):resolve(result.slice(comma+1));};
   reader.onerror=()=>reject(new Error('Không đọc được ảnh trên thiết bị. Hãy thử lại.'));
   reader.readAsDataURL(blob);
  });
 }
 async function jpeg(file:File):Promise<string>{
  if(file.size>2*1024*1024)throw new Error('Mỗi ảnh cần nhỏ hơn 2 MB.');
  const source=await openImage(file);
  try{
   if(source.width<200||source.height<200)throw new Error('Ảnh cần rõ nét, mỗi cạnh ít nhất 200 px.');
   if(source.width*source.height>80000000)throw new Error('Ảnh có độ phân giải quá lớn để xử lý trên điện thoại. Hãy chọn ảnh nhỏ hơn.');
   const scale=Math.min(1,1600/Math.max(source.width,source.height));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
   const context=canvas.getContext('2d');
   if(!context)throw new Error('Không xử lý được ảnh trên thiết bị. Hãy thử ảnh khác.');
   context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);source.draw(context,canvas.width,canvas.height);
   for(const quality of [.86,.72,.58,.42,.3]){
    const blob=await toBlob(canvas,quality);
    if(blob.size<=614400)return await blobToBase64(blob);
   }
   throw new Error('Ảnh vẫn còn quá nặng sau khi thu gọn. Hãy chọn ảnh khác.');
  }finally{source.close();}
 }
 async function upload(url:string,body:Record<string,unknown>):Promise<{id:string;error?:string}>{
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),60000);
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   const data=await readApiJson<{id?:string}>(response,'Chưa tải được ảnh. Kiểm tra định dạng và dung lượng rồi thử lại.');
   if(!data.id)throw new Error('Chưa nhận được ảnh đã tải lên. Hãy thử lại.');
   return {id:data.id};
  }catch(cause){
   if(cause instanceof Error&&cause.name==='AbortError')throw new Error('Tải ảnh mất quá lâu. Kiểm tra kết nối mạng rồi thử lại.');
   if(cause instanceof TypeError)throw new Error(displayError(cause,'Không gửi được ảnh. Kiểm tra kết nối mạng rồi thử lại.'));
   throw cause;
  }finally{window.clearTimeout(timeout);}
 }

 ownerSelect?.addEventListener('change',()=>{
  if(photos.length){ownerSelect.value=selectedOwner;message(uploadError,'Gỡ ảnh trước khi đổi người đăng để ảnh được gắn đúng tài khoản.');return;}
  selectedOwner=ownerSelect.value;message(uploadError,'');
 });
 input.addEventListener('change',async()=>{
  if(busy)return;
  const files=Array.from(input.files??[]);message(uploadError,'');
  if(!files.length)return;
  if(cms&&!form.dataset.id&&!ownerSelect?.value){message(uploadError,'Chọn người đăng trước khi tải ảnh.');input.value='';return;}
  if(files.length+photos.length>8){message(uploadError,'Mỗi tin có tối đa 8 ảnh. Hãy gỡ bớt ảnh trước.');input.value='';return;}
  busy=true;input.disabled=true;if(ownerSelect)ownerSelect.disabled=true;
  let added=0;
  try{
   for(let index=0;index<files.length;index++){
    status.textContent=`Đang chuẩn bị ảnh ${index+1}/${files.length}…`;
    const encoded=await jpeg(files[index]);
    const url=cms?(form.dataset.id?'/api/cms/listing-submissions/'+encodeURIComponent(form.dataset.id)+'/images':'/api/cms/listing-images'):'/api/uploads/listing-images';
    const body=cms?{jpeg:encoded,owner_id:ownerSelect?.value}:{jpeg:encoded};
    status.textContent=`Đang gửi ảnh ${index+1}/${files.length}…`;
    const uploaded=await upload(url,body);
    photos.push(uploaded.id);dirty=true;added++;render();
   }
   status.textContent=`Đã thêm ${added} ảnh.`;
  }catch(cause){
   message(uploadError,displayError(cause,'Chưa tải được ảnh. Kiểm tra kết nối mạng rồi thử lại.'));
   status.textContent=added?`Đã thêm ${added} ảnh. Chọn lại ảnh còn thiếu để tiếp tục.`:'';
  }finally{
   busy=false;input.disabled=false;if(ownerSelect)ownerSelect.disabled=false;input.value='';
  }
 });

 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy){message(error,'Đang tải ảnh lên. Đợi hoàn tất rồi lưu tin.');return;}
  const submitter=(event as SubmitEvent).submitter;
  const submit=submitter instanceof HTMLButtonElement&&submitter.value==='submit';
  message(error,'');
  if(!form.reportValidity())return;
  const values=new FormData(form),get=(key:string)=>String(values.get(key)??'');
  if(submit&&(photos.length<3||get('description').trim().length<30||get('street').trim().length<5)){
   message(error,'Bổ sung ít nhất 3 ảnh, địa chỉ/khu vực từ 5 ký tự và mô tả từ 30 ký tự để gửi duyệt.');error.scrollIntoView({block:'center',behavior:'smooth'});return;
  }
  const body={
   title:get('title'),location_id:get('location_id'),room_type:get('room_type'),price_vnd:get('price_vnd'),area_m2:get('area_m2'),description:get('description'),plan_id:get('plan_id'),owner_id:cms?get('owner_id'):undefined,version:Number(form.dataset.version),request_key:form.dataset.requestKey,submit,
   details:{map_point:get('map_lat')!==''||get('map_lng')!==''?{lat:get('map_lat')===''?null:Number(get('map_lat')),lng:get('map_lng')===''?null:Number(get('map_lng'))}:null,street:get('street'),address_visibility:get('address_visibility'),people:get('people'),deposit:get('deposit'),electricity:get('electricity'),water:get('water'),water_unit:get('water_unit'),service:get('service'),parking:get('parking'),amenities:values.getAll('amenity'),photos},
  };
  const buttons=Array.from(form.querySelectorAll<HTMLButtonElement>('button[type=submit]')),previous=buttons.map(button=>button.disabled);buttons.forEach(button=>button.disabled=true);busy=true;
  try{
   const endpoint=form.getAttribute('action')??'/api/account/listings',response=await fetch(endpoint,{method:cms&&form.dataset.id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   await readApiJson<{id:string}>(response,'Chưa lưu được tin. Kiểm tra lại thông tin rồi thử lại.');
   leaving=true;window.location.assign(cms?'/quan-tri/tin-phong?status='+(submit?'pending':'draft')+'&'+(submit?'submitted':'saved')+'=1':'/tai-khoan/tin-dang?'+(submit?'submitted':'saved')+'=1');
  }catch(cause){
   message(error,displayError(cause,'Chưa lưu được tin. Nội dung bạn nhập vẫn còn trên trang; hãy tải lại để kiểm tra trạng thái trước khi gửi lại.'));error.scrollIntoView({block:'center',behavior:'smooth'});buttons.forEach((button,index)=>button.disabled=previous[index]);busy=false;
  }
 });
}
