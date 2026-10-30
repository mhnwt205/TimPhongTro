// Shared area labels, room types and filters for listings loaded from D1.
export const areas = [
  { id: 'binh-thanh', name: 'Bình Thạnh' }, { id: 'thu-duc', name: 'Thủ Đức' },
  { id: 'tan-binh', name: 'Tân Bình' }, { id: 'go-vap', name: 'Gò Vấp' },
  { id: 'phu-nhuan', name: 'Phú Nhuận' }, { id: 'binh-tan', name: 'Bình Tân' },
] as const;
export const amenities = [
  { id: 'furnished', name: 'Có nội thất' }, { id: 'ac', name: 'Máy lạnh' },
  { id: 'loft', name: 'Có gác' }, { id: 'balcony', name: 'Ban công' }, { id: 'flexible', name: 'Giờ giấc tự do' },
] as const;
export type Room = { map_point?:import('./maps').MapPoint; images?: string[]; is_priority?: boolean; water_unit?:'per_person'|'per_m3'; areaLabel?: string; seller?: {name:string;phone:string;zalo:string}; id: string; title: string; area: string; street: string; type: 'room' | 'mini'; rent: number; size: number; people: number; photo: number; amenities: string[]; deposit: number; electricity: number; water: number; service: number; parking: number; description: string };
export const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? 'TP.HCM';
export const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + 'đ';
export const rentLabel = (value: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value / 1000000) + ' triệu';
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
export function filterRooms(query: URLSearchParams,source:Room[]=[]): Room[] {
  const q = normalize((query.get('q') ?? '').slice(0, 120)), area = query.get('area'), type = query.get('type');
  const min = Number(query.get('min') || 0), max = Number(query.get('max') || Infinity);
  const selected = query.getAll('amenity');
  const sizeRange=({'0-20':[0,20],'20-30':[20,30],'30-50':[30,50],'50-1000':[50,1000]} as Record<string,number[]>)[query.get('size')??''];
  const result = source.filter((room) => (!q || normalize([room.title,room.areaLabel??areaName(room.area),room.street,room.description].join(' ')).includes(q))
    && (!area || room.area === area) && (!type || room.type === type) && room.rent >= (Number.isFinite(min) ? min : 0)
    && room.rent <= (!Number.isNaN(max) ? max : Infinity) && (!sizeRange||room.size>=sizeRange[0]&&room.size<sizeRange[1]) && selected.every((value) => room.amenities.includes(value)));
  const priority=(a:Room,b:Room)=>Number(Boolean(b.is_priority))-Number(Boolean(a.is_priority));
  if (query.get('sort') === 'price-asc') result.sort((a,b) => priority(a,b)||a.rent-b.rent);
  else if (query.get('sort') === 'price-desc') result.sort((a,b) => priority(a,b)||b.rent-a.rent);
  else if (query.get('sort') === 'area-desc') result.sort((a,b) => priority(a,b)||b.size-a.size);
  else result.sort(priority);
  return result;
}
