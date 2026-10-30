export {};
const normalize=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim();
for(const root of document.querySelectorAll<HTMLElement>('[data-bank-picker]')){
 const select=root.getElementsByTagName('select')[0]!,input=root.querySelector<HTMLInputElement>('[data-bank-input]')!,combo=root.querySelector<HTMLElement>('[data-bank-combobox]')!,popup=root.querySelector<HTMLElement>('[data-bank-dropdown]')!,list=root.querySelector<HTMLElement>('[data-bank-list]')!,empty=root.querySelector<HTMLElement>('[data-bank-empty]')!,status=root.querySelector<HTMLElement>('[data-bank-status]')!;
 const options=[...select.options].filter(o=>o.value).map(o=>({code:o.value,name:o.dataset.bankName??o.textContent??'',fullName:o.dataset.bankFullName??'',search:normalize(o.dataset.bankSearchText??o.textContent??''),group:o.parentElement?.getAttribute('label')??''}));
 let filtered=options,active=-1,lastCommitted=select.value,open=false;
 input.disabled=select.disabled;input.required=select.required;select.hidden=true;select.required=false;select.tabIndex=-1;select.setAttribute('aria-hidden','true');combo.hidden=false;
 root.querySelector<HTMLLabelElement>('[data-bank-label]')!.htmlFor=input.id;
 input.value=options.find(o=>o.code===select.value)?.name??'';
 const validate=()=>{const invalid=(!select.value&&Boolean(input.value.trim()))||input.required&&!select.value;input.setCustomValidity(invalid?'Chọn ngân hàng trong danh sách gợi ý.':'');};validate();
 const place=()=>{const bounds=input.getBoundingClientRect(),viewport=window.visualViewport,bottom=(viewport?.height??innerHeight)+(viewport?.offsetTop??0),spaceBelow=bottom-bounds.bottom-18,spaceAbove=bounds.top-(viewport?.offsetTop??0)-18,up=spaceBelow<180&&spaceAbove>spaceBelow;popup.classList.toggle('opens-up',up);popup.style.maxHeight=Math.max(100,Math.min(300,up?spaceAbove:spaceBelow))+'px';};
 const close=()=>{open=false;popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 const highlight=(index:number)=>{active=index;for(const [i,node] of [...list.querySelectorAll<HTMLElement>('[role=option]')].entries())node.classList.toggle('is-active',i===active);const node=list.querySelector<HTMLElement>('[role=option].is-active');if(node){input.setAttribute('aria-activedescendant',node.id);if(node.offsetTop<popup.scrollTop)popup.scrollTop=node.offsetTop;else if(node.offsetTop+node.offsetHeight>popup.scrollTop+popup.clientHeight)popup.scrollTop=node.offsetTop+node.offsetHeight-popup.clientHeight;}else input.removeAttribute('aria-activedescendant');};
 const commit=(code:string)=>{const option=options.find(o=>o.code===code);select.value=option?.code??'';lastCommitted=select.value;input.value=option?.name??'';input.removeAttribute('aria-invalid');validate();select.dispatchEvent(new Event('change',{bubbles:true}));status.textContent=option?'Đã chọn '+option.name:'';close();};
 const show=(query:string)=>{
  if(input.disabled)return;
  const terms=normalize(query).split(' ').filter(Boolean);filtered=options.filter(o=>terms.every(t=>o.search.includes(t)||o.search.replace(/ /g,'').includes(t)));list.replaceChildren();
  let group='';for(const [index,option] of filtered.entries()){
   if(!terms.length&&group!==option.group){group=option.group;const heading=document.createElement('p');heading.className='bank-option-group';heading.setAttribute('role','presentation');heading.textContent=group;list.appendChild(heading);}
   const row=document.createElement('div');row.id=input.id+'-option-'+option.code;row.setAttribute('role','option');row.setAttribute('aria-selected',String(select.value===option.code));row.dataset.value=option.code;row.className='bank-option';
   const title=document.createElement('strong');title.textContent=option.name;row.appendChild(title);
   const sub=document.createElement('span');sub.textContent=option.fullName||option.code;row.appendChild(sub);
   row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('pointermove',()=>highlight(index));row.addEventListener('click',()=>commit(option.code));list.appendChild(row);
  }
  empty.hidden=filtered.length>0;status.textContent=filtered.length+' ngân hàng phù hợp';popup.hidden=false;open=true;input.setAttribute('aria-expanded','true');place();highlight(terms.length&&filtered.length?0:filtered.findIndex(o=>o.code===select.value));
 };
 input.addEventListener('focus',()=>show(''));input.addEventListener('click',()=>{if(!open)show('');});
 input.addEventListener('input',()=>{select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));input.removeAttribute('aria-invalid');validate();show(input.value);});
 input.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!open){show(input.value===options.find(o=>o.code===select.value)?.name?'':input.value);if(active<0)highlight(event.key==='ArrowDown'?0:filtered.length-1);}else if(filtered.length)highlight(active<0?(event.key==='ArrowDown'?0:filtered.length-1):(active+(event.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length);}
  else if(event.key==='Enter'&&open){event.preventDefault();if(filtered[active])commit(filtered[active].code);}
  else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();commit(lastCommitted);}
  else if(event.key==='Tab')close();
 });
 input.addEventListener('blur',()=>{const exact=options.find(o=>[o.code,o.name].some(v=>normalize(v)===normalize(input.value)));if(exact)commit(exact.code);else{validate();if(input.value&&!select.value)input.setAttribute('aria-invalid','true');close();}});
 input.addEventListener('invalid',()=>input.setAttribute('aria-invalid','true'));
 document.addEventListener('pointerdown',event=>{if(!root.contains(event.target as Node))close();});
 window.addEventListener('resize',()=>{if(open)place();});window.visualViewport?.addEventListener('resize',()=>{if(open)place();});
 select.form?.addEventListener('reset',()=>window.setTimeout(()=>commit(select.value),0));
}
