const gallery=document.querySelector<HTMLElement>('[data-detail-gallery]');
const viewer=document.querySelector<HTMLDialogElement>('[data-photo-viewer]');
if(gallery&&viewer){
 let images:string[]=[];
 try{const value:unknown=JSON.parse(gallery.dataset.images??'[]');if(Array.isArray(value))images=value.filter((item):item is string=>typeof item==='string'&&item.startsWith('/'));}catch{images=[];}
 const title=gallery.dataset.title??'Ảnh phòng',main=gallery.querySelector<HTMLImageElement>('[data-gallery-current]')!,inlineThumbs=[...gallery.querySelectorAll<HTMLButtonElement>('[data-gallery-select]')],photo=viewer.querySelector<HTMLImageElement>('[data-photo-current]')!,counter=viewer.querySelector<HTMLElement>('[data-photo-counter]')!,thumbs=viewer.querySelector<HTMLElement>('[data-photo-thumbs]')!,previous=viewer.querySelector<HTMLButtonElement>('[data-photo-prev]')!,next=viewer.querySelector<HTMLButtonElement>('[data-photo-next]')!;
 let current=0,touchStart:number|null=null;
 const show=(index:number)=>{
  if(!images.length)return;
  current=(index+images.length)%images.length;main.src=images[current];main.alt=`${title} · Ảnh ${current+1}`;gallery.dataset.active=String(current);photo.src=images[current];photo.alt=`${title} · Ảnh ${current+1} trên ${images.length}`;counter.textContent=`${current+1} / ${images.length}`;
  inlineThumbs.forEach((button,i)=>{if(i===current){button.setAttribute('aria-current','true');button.scrollIntoView({block:'nearest',inline:'center'});}else button.removeAttribute('aria-current');});
  thumbs.querySelectorAll<HTMLButtonElement>('[data-photo-index]').forEach((button,i)=>{if(i===current){button.setAttribute('aria-current','true');button.scrollIntoView({block:'nearest',inline:'center'});}else button.removeAttribute('aria-current');});
  previous.hidden=next.hidden=images.length<2;
 };
 images.forEach((src,index)=>{const button=document.createElement('button');button.type='button';button.className='photo-viewer-thumb';button.dataset.photoIndex=String(index);button.setAttribute('aria-label',`Xem ảnh ${index+1}`);const image=document.createElement('img');image.src=src;image.alt='';image.loading='lazy';image.decoding='async';button.appendChild(image);button.addEventListener('click',()=>show(index));thumbs.appendChild(button);});
 inlineThumbs.forEach((button,index)=>button.addEventListener('click',()=>show(index)));
 gallery.querySelector<HTMLButtonElement>('[data-gallery-prev]')?.addEventListener('click',()=>show(current-1));
 gallery.querySelector<HTMLButtonElement>('[data-gallery-next]')?.addEventListener('click',()=>show(current+1));
 gallery.querySelector<HTMLButtonElement>('[data-gallery-zoom]')?.addEventListener('click',()=>{show(current);viewer.showModal();viewer.querySelector<HTMLButtonElement>('[data-photo-close]')?.focus();});
 viewer.querySelector('[data-photo-close]')?.addEventListener('click',()=>viewer.close());
 previous.addEventListener('click',()=>show(current-1));next.addEventListener('click',()=>show(current+1));
 viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close();});
 viewer.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();show(current-1);}else if(event.key==='ArrowRight'){event.preventDefault();show(current+1);}});
 gallery.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();show(current-1);}else if(event.key==='ArrowRight'){event.preventDefault();show(current+1);}});
 const stage=viewer.querySelector<HTMLElement>('.photo-viewer-stage')!;
 stage.addEventListener('touchstart',event=>{touchStart=event.changedTouches[0]?.clientX??null;},{passive:true});
 stage.addEventListener('touchend',event=>{const end=event.changedTouches[0]?.clientX;if(touchStart!==null&&end!==undefined&&Math.abs(end-touchStart)>45)show(current+(end<touchStart?1:-1));touchStart=null;},{passive:true});
}
