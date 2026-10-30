import {displayError,readApiJson} from './api-errors';
type Row=Record<string,any>;
const root=document.querySelector('#cms-data');
if(root){
 const {key,items,actorId}=JSON.parse(root.textContent??'{}') as {key:string;items:Row[];actorId:string};
 let editing:Row|null=null,acting:Row|null=null,action='',rolesTarget:Row|null=null;
 const editor=document.querySelector<HTMLDialogElement>('#cms-editor');
 const editForm=document.querySelector<HTMLFormElement>('#cms-edit-form');
 const confirm=document.querySelector<HTMLDialogElement>('#cms-confirm');
 const confirmForm=document.querySelector<HTMLFormElement>('#cms-confirm-form');
 const roles=document.querySelector<HTMLDialogElement>('#cms-roles');
 const rolesForm=document.querySelector<HTMLFormElement>('#cms-roles-form');
 const find=(id:string|undefined)=>items.find(r=>r.id===id)??null;
 const clearError=(form:HTMLFormElement)=>{form.querySelector<HTMLElement>('[role=alert]')!.hidden=true;};
 async function send(form:HTMLFormElement,path:string,method:string,body:Row){
  const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  button.disabled=true;clearError(form);
  try{
   const response=await fetch('/api/cms/'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   await readApiJson(response,'Không thể lưu thay đổi. Kiểm tra nội dung rồi thử lại.');
   location.reload();
  }catch(error){
   const target=form.querySelector<HTMLElement>('[role=alert]')!;target.textContent=displayError(error,'Không thể lưu thay đổi. Hãy kiểm tra lại trạng thái bản ghi.');target.hidden=false;button.disabled=false;
  }
 }
 function openEditor(row:Row|null){
  if(!editForm||!editor)return;editing=row;editForm.reset();clearError(editForm);
  editor.querySelector('[data-editor-title]')!.textContent=row?'Sửa bản ghi':'Tạo mới';
  for(const element of editForm.querySelectorAll('[name]')){
   const control=element as HTMLInputElement|HTMLTextAreaElement;
   if(control.name==='permissions'){(control as HTMLInputElement).checked=Boolean(row?.permissions?.includes(control.value));continue;}
   if(control instanceof HTMLInputElement&&control.type==='checkbox'){control.checked=Boolean(row?.[control.name]);continue;}
   if(control.name==='password'){
    control.required=!row;control.disabled=Boolean(row);control.closest<HTMLElement>('[data-field-wrap]')!.hidden=Boolean(row);continue;
   }
   if(row)control.value=String(row[control.name]??'');
   else if(control.name==='owner_id')control.value=actorId;
  }
  editor.showModal();
 }
 document.querySelector('[data-cms-create]')?.addEventListener('click',()=>openEditor(null));
 for(const button of document.querySelectorAll<HTMLButtonElement>('[data-cms-edit]'))button.addEventListener('click',()=>openEditor(find(button.dataset.cmsEdit)));
 editForm?.addEventListener('submit',event=>{
  event.preventDefault();const data:Row=Object.fromEntries(new FormData(editForm));
  for(const name of ['price_vnd','duration_days','area_m2','is_active'])if(name in data)data[name]=Number(data[name]);
  if(key==='plans')data.is_priority=Number(Boolean(editForm.querySelector<HTMLInputElement>('[name=is_priority]')?.checked));
  if(key==='roles')data.permissions=new FormData(editForm).getAll('permissions');
  if(editing)data.version=editing.version;
  void send(editForm,key+(editing?'/'+editing.id:''),editing?'PATCH':'POST',data);
 });
 for(const button of document.querySelectorAll<HTMLButtonElement>('[data-cms-action]'))button.addEventListener('click',()=>{
  acting=find(button.dataset.id);action=button.dataset.cmsAction??'';if(!acting||!confirm||!confirmForm)return;
  confirmForm.reset();clearError(confirmForm);
  const labels:Record<string,string>={lock:'Khóa tài khoản',unlock:'Mở khóa tài khoản',delete:'Chuyển vào thùng rác',restore:'Khôi phục bản ghi'};
  confirm.querySelector('[data-confirm-title]')!.textContent=labels[action];
  confirm.querySelector('[data-confirm-description]')!.textContent=(acting.name??acting.title)+'. '+(action==='delete'?'Bản ghi được ẩn và giữ lịch sử. Bạn có thể khôi phục trong thùng rác.':action==='restore'&&key==='users'?'Tài khoản khôi phục vẫn bị khóa; mở khóa riêng sau khi kiểm tra.':action==='restore'?'Bản ghi được khôi phục; gói/khu vực/nội dung cần bật lại nếu muốn sử dụng.':'Các phiên đăng nhập của tài khoản sẽ bị thu hồi.');
  confirm.showModal();
 });
 confirmForm?.addEventListener('submit',event=>{
  event.preventDefault();if(!acting)return;
  const data:Row={version:acting.version,note:new FormData(confirmForm).get('note')};
  let path=key+'/'+acting.id,method='POST';
  if(action==='lock'||action==='unlock'){path+='/lock';data.locked=action==='lock';}
  else if(action==='restore')path+='/restore';else method='DELETE';
  void send(confirmForm,path,method,data);
 });
 for(const button of document.querySelectorAll<HTMLButtonElement>('[data-cms-roles]'))button.addEventListener('click',()=>{
  rolesTarget=find(button.dataset.cmsRoles);if(!rolesTarget||!roles||!rolesForm)return;
  rolesForm.reset();clearError(rolesForm);roles.querySelector('[data-roles-description]')!.textContent=rolesTarget.name+' · '+rolesTarget.email;
  for(const control of rolesForm.querySelectorAll<HTMLInputElement>('[name=role_ids]'))control.checked=rolesTarget.role_ids.includes(control.value);
  roles.showModal();
 });
 rolesForm?.addEventListener('submit',event=>{event.preventDefault();if(!rolesTarget)return;void send(rolesForm,'users/'+rolesTarget.id+'/roles','POST',{version:rolesTarget.version,role_ids:new FormData(rolesForm).getAll('role_ids')});});
}
