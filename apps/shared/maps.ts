export type MapPoint={lat:number;lng:number};
export const validPoint=(p:unknown):p is MapPoint=>Boolean(p&&typeof p==='object'&&typeof (p as MapPoint).lat==='number'&&typeof (p as MapPoint).lng==='number'&&Number.isFinite((p as MapPoint).lat)&&Number.isFinite((p as MapPoint).lng)&&Math.abs((p as MapPoint).lat)<=90&&Math.abs((p as MapPoint).lng)<=180);
export function parseGooglePoint(value:string):MapPoint|null{
 try{const url=new URL(value);if(url.protocol!=='https:'||!(url.hostname==='google.com'||url.hostname.endsWith('.google.com')||url.hostname==='www.google.com.vn')||!url.pathname.startsWith('/maps'))return null;
 const detail=decodeURIComponent(url.href).match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/),query=(url.searchParams.get('q')??url.searchParams.get('query')??'').match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/),camera=url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/),m=detail??query??camera;if(!m)return null;const p={lat:Number(m[1]),lng:Number(m[2])};return validPoint(p)?p:null;
 }catch{return null;}
}
export const mapEmbed=(query:string)=>'https://maps.google.com/maps?'+new URLSearchParams({q:query,output:'embed',z:'15'});
export const mapLink=(query:string)=>'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query});
