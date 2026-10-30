import L from 'leaflet';
import {mapLink,parseGooglePoint,validPoint,type MapPoint} from '../../../shared/maps';
import type {AddressSuggestion} from '../../../shared/geocoding';
import {displayError,readApiJson} from './api-errors';
const root=document.querySelector<HTMLElement>('[data-map-editor]');
if(root){
 const lat=root.querySelector<HTMLInputElement>('#map-lat')!,lng=root.querySelector<HTMLInputElement>('#map-lng')!,link=root.querySelector<HTMLInputElement>('[data-map-link]')!,host=root.querySelector<HTMLElement>('[data-interactive-map]')!,status=root.querySelector<HTMLElement>('[data-map-status]')!,open=root.querySelector<HTMLAnchorElement>('[data-map-open]')!,street=root.querySelector<HTMLInputElement>('#listing-street')!,suggestions=root.querySelector<HTMLElement>('[data-map-suggestions]')!,location=document.querySelector('select[name=location_id]')!;
 const map=L.map(host,{scrollWheelZoom:true}).setView([10.7769,106.7009],14);map.attributionControl.setPrefix(false);
 L.tileLayer('/api/maps/tiles/{z}/{x}/{y}',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 const icon=L.divIcon({className:'listing-map-pin',html:'<span></span>',iconSize:[28,36],iconAnchor:[14,34]});
 let marker:L.Marker|null=null,generation=0,controller:AbortController|null=null,timer:number|undefined;
 const results=L.layerGroup().addTo(map);
 const changed=()=>lat.dispatchEvent(new Event('input',{bubbles:true}));
 const clearSuggestions=()=>{results.clearLayers();suggestions.replaceChildren();suggestions.hidden=true;};
 const cancel=()=>{generation++;controller?.abort();window.clearTimeout(timer);};
 const clearPoint=()=>{lat.value='';lng.value='';marker?.remove();marker=null;};
 const point=(p:MapPoint,dirty=true)=>{lat.value=String(Number(p.lat.toFixed(6)));lng.value=String(Number(p.lng.toFixed(6)));if(marker)marker.setLatLng([p.lat,p.lng]);else{marker=L.marker([p.lat,p.lng],{icon,draggable:true,autoPan:true}).addTo(map);marker.on('dragend',()=>{const p=marker!.getLatLng().wrap();void reverse({lat:p.lat,lng:p.lng});});}map.setView([p.lat,p.lng],Math.max(map.getZoom(),16));open.href=mapLink(`${p.lat},${p.lng}`);if(dirty)changed();};
 async function lookup(kind:'search'|'reverse',body:unknown,id:number):Promise<AddressSuggestion[]|null>{
  for(let attempt=0;attempt<2;attempt++){
   if(id!==generation)return null;
   controller=new AbortController();
   const response=await fetch('/api/account/maps/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   if(id!==generation)return null;
   if(response.status===429&&attempt===0){status.textContent='Đang chờ tìm vị trí…';await new Promise(r=>window.setTimeout(r,Math.max(1500,Math.min(5000,Number(response.headers.get('Retry-After')??2)*1000))));continue;}
   const data=await readApiJson<{items?:AddressSuggestion[]}>(response,'Chưa tìm được địa chỉ. Bạn có thể nhập địa chỉ thủ công.');
   return data.items??[];
  }
  throw new Error('Đang có nhiều lượt tìm. Thử lại sau một chút hoặc nhập địa chỉ thủ công.');
 }
 function choose(item:AddressSuggestion){cancel();clearSuggestions();street.value=item.address;point(item);status.textContent='Đã chọn vị trí. Kiểm tra lại số nhà trước khi gửi tin.';}
 async function search(){
  cancel();clearSuggestions();const value=street.value.trim();if(value.length<3){status.textContent='Nhập ít nhất 3 ký tự để tìm địa chỉ.';return;}
  const id=generation;status.textContent='Đang tìm địa chỉ…';
  const region=(location as unknown as {value:string;selectedOptions:{textContent:string}[]});
  const query=[value,region.value?region.selectedOptions[0]?.textContent:'','TP.HCM'].filter(Boolean).join(', ').slice(0,300);
  try{const items=await lookup('search',{query},id);if(id!==generation||!items)return;if(!items.length){status.textContent='Chưa tìm thấy địa chỉ. Bạn có thể bấm vị trí trên bản đồ hoặc nhập địa chỉ đầy đủ hơn.';return;}
   status.textContent='Chọn một địa chỉ gợi ý hoặc bấm vị trí phòng trên bản đồ.';suggestions.hidden=false;
   for(const item of items){const button=document.createElement('button');button.type='button';button.className='map-suggestion';button.textContent=item.address;button.addEventListener('click',()=>choose(item));suggestions.appendChild(button);L.circleMarker([item.lat,item.lng],{radius:7,color:'#1b6c80',fillColor:'#fff',fillOpacity:1,weight:3,bubblingMouseEvents:false}).addTo(results).on('click',()=>choose(item));}
   const bounds=L.latLngBounds(items.map(item=>[item.lat,item.lng] as L.LatLngTuple));map.fitBounds(bounds,{padding:[35,35],maxZoom:16});
  }catch(e){if(id===generation&&!(e instanceof DOMException&&e.name==='AbortError'))status.textContent=displayError(e,'Chưa tìm được địa chỉ. Hãy thử lại.');}
 }
 async function reverse(p:MapPoint){
  if(!validPoint(p))return;cancel();clearSuggestions();point(p);street.value='';const id=generation;status.textContent='Đang lấy địa chỉ tại điểm đã chọn…';
  try{const items=await lookup('reverse',{point:p},id);if(id!==generation||!items)return;street.value=items[0]?.address??'';status.textContent=street.value?'Đã điền địa chỉ theo vị trí bạn chọn. Kiểm tra lại số nhà trước khi gửi tin.':'Chưa có địa chỉ cho điểm này. Bạn có thể nhập địa chỉ phòng vào ô bên trên.';changed();}
  catch(e){if(id===generation&&!(e instanceof DOMException&&e.name==='AbortError'))status.textContent=displayError(e,'Chưa lấy được địa chỉ. Bạn có thể nhập địa chỉ thủ công.');}
 }
 map.on('click',(event:L.LeafletMouseEvent)=>{const p=event.latlng.wrap();void reverse({lat:p.lat,lng:p.lng});});
 street.autocomplete='off';street.addEventListener('input',()=>{cancel();clearSuggestions();clearPoint();changed();status.textContent='';if(street.value.trim().length>=3)status.textContent='Nhấn Enter hoặc Tìm địa chỉ để xem các vị trí gợi ý.';});
 street.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void search();}});
 location.addEventListener('change',()=>{cancel();clearSuggestions();clearPoint();changed();status.textContent='Nhấn Tìm địa chỉ để xem gợi ý trong khu vực mới.';});
 root.querySelector('[data-map-address]')!.addEventListener('click',()=>void search());
 link.addEventListener('change',()=>{const p=parseGooglePoint(link.value);if(p)void reverse(p);else status.textContent='Dán liên kết Google Maps đầy đủ hoặc nhập địa chỉ ở ô bên trên.';});
 root.querySelector('[data-map-clear]')!.addEventListener('click',()=>{cancel();clearSuggestions();clearPoint();link.value='';changed();status.textContent='Đã bỏ điểm đánh dấu; bạn có thể nhập địa chỉ hoặc bấm vị trí khác.';});
 root.querySelector('[data-map-current]')!.addEventListener('click',()=>{if(!navigator.geolocation){status.textContent='Chưa lấy được vị trí. Bạn có thể bấm vị trí phòng trên bản đồ.';return;}status.textContent='Đang lấy vị trí…';navigator.geolocation.getCurrentPosition(p=>void reverse({lat:p.coords.latitude,lng:p.coords.longitude}),()=>status.textContent='Chưa lấy được vị trí. Bạn có thể nhập địa chỉ hoặc bấm trên bản đồ.',{timeout:12000,maximumAge:0,enableHighAccuracy:true});});
 const privacy=()=>root.querySelector('[data-map-privacy]')!.textContent=document.querySelector<HTMLInputElement>('[name=address_visibility]:checked')?.value==='exact'?'Tin đã duyệt sẽ hiển thị địa chỉ và vị trí bạn cung cấp.':'Chỉ khu vực đã chọn được hiển thị công khai; vị trí cụ thể được giữ riêng.';
 document.querySelectorAll('[name=address_visibility]').forEach(e=>e.addEventListener('change',privacy));privacy();
 const initial={lat:Number(lat.value),lng:Number(lng.value)};if(lat.value&&lng.value&&validPoint(initial))point(initial,false);

}
