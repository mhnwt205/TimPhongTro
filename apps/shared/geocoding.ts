export type AddressSuggestion={id:string;lat:number;lng:number;address:string;name:string};
export function addressSuggestions(value:unknown):AddressSuggestion[]{
 const entries=Array.isArray(value)?value:[value];
 return entries.slice(0,5).flatMap((entry,index)=>{
  if(!entry||typeof entry!=='object')return [];
  const p=entry as Record<string,unknown>;
  const number=(v:unknown)=>typeof v==='number'?v:typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v)?Number(v):NaN;
  const lat=number(p.lat),lng=number(p.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||typeof p.display_name!=='string')return [];
  const address=p.display_name.trim().slice(0,200);if(address.length<3)return [];
  const name=typeof p.name==='string'?p.name.trim().slice(0,200):address;
  return [{id:String(p.osm_type??'place')+'-'+String(p.osm_id??index),lat,lng,address,name:name||address}];
 });
}
