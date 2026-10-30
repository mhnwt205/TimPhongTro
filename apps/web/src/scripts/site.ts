const key = 'timphongtro:saved:v1';
const readSaved = (): string[] => {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-z0-9-]{1,100}$/.test(id)))].slice(0,100) : []; }
  catch { return []; }
};
let toastTimer: ReturnType<typeof setTimeout>;
const toast = (message: string) => {
  const el = document.querySelector<HTMLElement>('[data-toast]'); if (!el) return;
  clearTimeout(toastTimer); el.textContent=message; el.hidden=false;
  toastTimer=setTimeout(() => { el.hidden=true; },2400);
};
function updateSaved() {
  const saved=readSaved();
  document.querySelectorAll<HTMLButtonElement>('[data-save-room]').forEach((button) => {
    const active=saved.includes(button.dataset.saveRoom ?? '');
    button.setAttribute('aria-pressed',String(active));button.classList.toggle('is-saved',active);
    button.setAttribute('aria-label',(active ? 'Bỏ lưu ' : 'Lưu ')+(button.dataset.roomTitle ?? 'phòng'));
    button.title=active?'Đã lưu · Nhấn để bỏ lưu':'Lưu phòng yêu thích';
    const label=button.querySelector<HTMLElement>('[data-save-label]');if(label)label.textContent=active?'Đã lưu':'Lưu phòng';
  });
  document.querySelectorAll<HTMLElement>('[data-saved-count]').forEach((el) => { el.textContent=String(saved.length);el.hidden=!saved.length; });
  const page=document.querySelector('[data-saved-page]');
  if (page) {
    let count=0;
    page.querySelectorAll<HTMLElement>('[data-room-card]').forEach((el) => { el.hidden=!saved.includes(el.dataset.roomCard ?? '');if(!el.hidden)count++; });
    const empty=page.querySelector<HTMLElement>('[data-saved-empty]');if(empty)empty.hidden=count>0;
    const total=page.querySelector<HTMLElement>('[data-saved-total]');if(total)total.textContent=String(count);
  }
}
updateSaved();
window.addEventListener('storage',updateSaved);
window.addEventListener('pageshow',updateSaved);
document.addEventListener('click',(event) => {
  const target=event.target as Element|null;
  const save=target?.closest<HTMLButtonElement>('[data-save-room]');
  if (save?.dataset.saveRoom) {
    const saved=readSaved(),id=save.dataset.saveRoom,active=saved.includes(id);
    try { localStorage.setItem(key,JSON.stringify(active ? saved.filter((value)=>value!==id) : [...saved,id].slice(-100)));updateSaved();toast(active ? 'Đã bỏ khỏi danh sách yêu thích' : 'Đã thêm vào danh sách yêu thích'); }
    catch { toast('Trình duyệt chưa cho phép lưu. Vui lòng thử lại.'); }
  }
  const opener=target?.closest<HTMLButtonElement>('[data-open-dialog]');
  if(opener?.dataset.openDialog) { const dialog=document.getElementById(opener.dataset.openDialog);if(dialog instanceof HTMLDialogElement){dialog.showModal();document.documentElement.classList.add('dialog-open');} }
  if(target?.closest('[data-close-dialog]'))target.closest('dialog')?.close();
  const eye=target?.closest<HTMLButtonElement>('[data-toggle-password]');
  if(eye){const input=document.getElementById(eye.dataset.togglePassword ?? '') as HTMLInputElement|null;if(input){const visible=input.type==='password';input.type=visible?'text':'password';eye.setAttribute('aria-label',visible?'Ẩn mật khẩu':'Hiện mật khẩu');eye.setAttribute('aria-pressed',String(visible));}}
});
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('close',()=>document.documentElement.classList.remove('dialog-open'));
  dialog.addEventListener('click',(event)=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
});
document.querySelectorAll<HTMLElement>('[data-cost-calculator]').forEach((calculator)=>{
  const electricityInput=calculator.querySelector<HTMLInputElement>('#electricity-usage');
  const peopleInput=calculator.querySelector<HTMLInputElement>('#water-people');
  const waterInput=calculator.querySelector<HTMLInputElement>('#water-usage');
  const output=calculator.querySelector('output');
  const update=()=>{
    if(!output)return;
    const electricity=Math.max(0,Math.min(500,Number(electricityInput?.value)||0));
    const people=Math.max(1,Math.min(20,Number(peopleInput?.value)||1));
    const usage=Math.max(0,Math.min(100,Number(waterInput?.value)||0));
    const waterCost=calculator.dataset.waterUnit==='per_m3'?usage*Number(calculator.dataset.water):people*Number(calculator.dataset.water);
    const total=Number(calculator.dataset.baseCost)+electricity*Number(calculator.dataset.electricity)+waterCost;
    output.textContent=new Intl.NumberFormat('vi-VN').format(total)+'đ';
  };
  electricityInput?.addEventListener('input',update);peopleInput?.addEventListener('input',update);waterInput?.addEventListener('input',update);update();
});
