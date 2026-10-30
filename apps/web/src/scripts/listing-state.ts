import {displayError,readApiJson} from './api-errors';
const descriptions:Record<string,{title:string;body:string}>={
 hide:{title:'Tạm ẩn tin?',body:'Tin sẽ ngừng hiển thị công khai. Thời hạn gói vẫn tiếp tục chạy, không hoàn phí hoặc cộng bù thời gian.'},
 unavailable:{title:'Đánh dấu đã hết phòng?',body:'Tin được gỡ khỏi danh sách phòng đang cho thuê. Thời hạn gói vẫn tiếp tục chạy. Bạn có thể mở lại bản đã duyệt nếu tin còn hạn.'},
 reopen:{title:'Mở lại tin?',body:'Bản nội dung đã duyệt sẽ được hiển thị trở lại trong thời hạn còn lại. Không thu phí mới và không công khai bản sửa chưa được duyệt.'},
 confirm:{title:'Xác nhận phòng vẫn còn?',body:'Xác nhận rằng thông tin phòng hiện vẫn còn cho thuê. Thao tác này không gia hạn hoặc thay đổi phí đăng tin.'},
 block:{title:'CMS tạm gỡ tin?',body:'Tin sẽ ngừng hiển thị. Người đăng không thể tự mở lại; chỉ CMS có quyền mở gỡ. Thời hạn đã mua vẫn tiếp tục chạy.'},
 unblock:{title:'Mở gỡ tin CMS?',body:'Bỏ chặn của CMS. Tin chỉ xuất hiện nếu còn hạn, đang còn phòng, không bị người đăng tạm ẩn và có bản đã duyệt hợp lệ.'},
};
document.querySelectorAll<HTMLElement>('[data-listing-state]').forEach(root=>{
 const dialog=root.querySelector<HTMLDialogElement>('dialog')!,error=root.querySelector<HTMLElement>('[data-state-error]')!,confirm=root.querySelector<HTMLButtonElement>('[data-state-confirm]')!,note=root.querySelector<HTMLTextAreaElement>('[name=note]')!;
 let action='';
 root.querySelectorAll<HTMLButtonElement>('[data-state-action]').forEach(button=>button.addEventListener('click',()=>{
  action=button.dataset.stateAction??'';const copy=descriptions[action];if(!copy)return;
  root.querySelector('[data-state-title]')!.textContent=copy.title;root.querySelector('[data-state-description]')!.textContent=copy.body;
  root.querySelector<HTMLElement>('[data-state-note-wrap]')!.hidden=action!=='block';note.required=action==='block';note.value='';error.hidden=true;dialog.showModal();
 }));
 confirm.addEventListener('click',async()=>{
  if(action==='block'&&!note.reportValidity())return;confirm.disabled=true;error.hidden=true;
  try{const response=await fetch(root.dataset.endpoint!,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:Number(root.dataset.version),action,note:note.value})});await readApiJson(response,'Chưa cập nhật được trạng thái tin. Tải lại trang rồi thử lại.');window.location.reload();}
  catch(e){error.textContent=displayError(e,'Chưa cập nhật được trạng thái tin. Tải lại trang để kiểm tra trước khi thử lại.');error.hidden=false;confirm.disabled=false;}
 });
});
