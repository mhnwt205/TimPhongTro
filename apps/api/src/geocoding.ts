import {Hono} from 'hono';
import {type ApiEnv,requireUser,readBody,limit,sha256} from './security';
import {validPoint} from '../../shared/maps';
import {addressSuggestions} from '../../shared/geocoding';
const router=new Hono<ApiEnv>();
router.use('/account/maps/*',requireUser);
router.use('/maps/tiles/*',requireUser);
router.get('/maps/tiles/:z/:x/:y',async c=>{
 const z=Number(c.req.param('z')),x=Number(c.req.param('x')),y=Number(c.req.param('y'));
 if(!Number.isInteger(z)||z<0||z>19||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=2**z||y>=2**z)return c.json({error:'Vị trí bản đồ không hợp lệ.'},400);
 try{
  const upstream=await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`,{headers:{'User-Agent':'TimPhongTro/1.0 (+https://trotothcm.id.vn)','Referer':'https://trotothcm.id.vn/','Accept':'image/png'},cf:{cacheTtl:86400}});
  const size=Number(upstream.headers.get('content-length')??0);
  if(!upstream.ok||!upstream.headers.get('content-type')?.startsWith('image/png')||size>2097152||!upstream.body)throw new Error('tile');
  const reader=upstream.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2097152){await reader.cancel();throw new Error('tile');}chunks.push(value);}
  const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  return new Response(body,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=3600, s-maxage=86400','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
 }catch{return c.body(null,503,{ 'Cache-Control':'no-store' });}
});
for(const kind of ['search','reverse'] as const)router.post('/account/maps/'+kind,async c=>{
 const data=await readBody(c),query=typeof data.query==='string'?data.query.trim():'';
 if(kind==='search'&&(query.length<3||query.length>300)||kind==='reverse'&&!validPoint(data.point))return c.json({error:'Nhập địa chỉ từ 3–300 ký tự hoặc chọn vị trí hợp lệ trên bản đồ.'},400);
 const denied=await limit(c,'map-lookup',c.get('user').id,30,60);if(denied)return denied;
 const point=validPoint(data.point)?data.point:null;
 const key=await sha256('nominatim:'+kind+':'+(kind==='search'?query.toLocaleLowerCase('vi'):point!.lat.toFixed(5)+','+point!.lng.toFixed(5)));
 const cached=await c.env.DB.prepare('SELECT result FROM map_geocode_cache WHERE key=? AND expires_at>unixepoch()').bind(key).first<{result:string}>();
 if(cached)return c.json({items:JSON.parse(cached.result)});
 const now=Date.now(),day=Math.floor(now/86400000);
 const reserved=await c.env.DB.prepare(`UPDATE map_geocode_budget SET last_ms=?,day=?,calls=CASE WHEN day=? THEN calls+1 ELSE 1 END WHERE id=1 AND last_ms<=? AND (day!=? OR calls<1000) RETURNING calls`).bind(now,day,day,now-1250,day).first();
 if(!reserved){c.header('Retry-After','2');return c.json({error:'Đang có nhiều lượt tìm vị trí. Đợi một chút rồi thử lại.'},429);}
 const url=new URL(kind==='search'?'https://nominatim.openstreetmap.org/search':'https://nominatim.openstreetmap.org/reverse');
 if(kind==='search'){url.searchParams.set('q',query);url.searchParams.set('limit','5');url.searchParams.set('countrycodes','vn');url.searchParams.set('viewbox','105.5,12,108,9.5');}
 else{url.searchParams.set('lat',String(point!.lat));url.searchParams.set('lon',String(point!.lng));url.searchParams.set('zoom','18');}
 url.searchParams.set('format','jsonv2');url.searchParams.set('accept-language','vi');
 try{
  const r=await fetch(url,{headers:{'User-Agent':'TimPhongTro/1.0 (+https://trotothcm.id.vn)','Accept':'application/json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok||Number(r.headers.get('content-length')??0)>131072)throw new Error('provider');
  const reader=r.body?.getReader();if(!reader)throw new Error('provider');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072){await reader.cancel();throw new Error('provider');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const items=addressSuggestions(JSON.parse(new TextDecoder().decode(bytes)));
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO map_geocode_cache(key,result,expires_at) VALUES(?,?,unixepoch()+604800) ON CONFLICT(key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at').bind(key,JSON.stringify(items)),c.env.DB.prepare('DELETE FROM map_geocode_cache WHERE key IN (SELECT key FROM map_geocode_cache WHERE expires_at<=unixepoch() LIMIT 100)')]);
  return c.json({items});
 }catch{return c.json({error:'Chưa tìm được địa chỉ lúc này. Bạn vẫn có thể nhập địa chỉ và thử chọn vị trí lại sau.'},503);}
});
export default router;
