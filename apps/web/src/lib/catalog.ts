import {env} from 'cloudflare:workers';
import {publicRooms} from '@timphongtro/api';
import {areas} from '../../../shared/rooms';
export async function catalog(){
 const [published,storedAreas]=await Promise.all([
  publicRooms(env.DB),
  env.DB.prepare('SELECT id,name FROM locations WHERE is_active=1 AND deleted_at IS NULL ORDER BY name').all<{id:string;name:string}>(),
 ]);
 const liveAreas=[...(storedAreas.results.length?storedAreas.results:areas)];
 const labels=new Map(liveAreas.map(area=>[area.id,area.name]));
 for(const area of areas)if(!labels.has(area.id)){labels.set(area.id,area.name);liveAreas.push(area);}
 const live=published.map(room=>({...room,areaLabel:labels.get(room.area)??room.areaLabel}));
 return {rooms:live,areas:liveAreas};
}
