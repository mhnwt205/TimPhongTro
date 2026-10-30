import type {Withdrawal} from './withdrawals';
import {transferQrPayload} from './topup-qr';

export function withdrawalQrPayload(r:Withdrawal):string|null{
 return r.status==='approved'&&r.processor_id?transferQrPayload(r,'RUT'):null;
}
