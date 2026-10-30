import qrcode from 'qrcode-generator';
import {QRPay} from 'vietnam-qr-pay';
import {bankDirectory} from './banks';
import type {Topup} from './wallets';
type QrTopup=Pick<Topup,'bank_code'|'account_number'|'requested_vnd'|'code'|'status'>;
type Transfer={bank_code:string;account_number:string;amount_vnd:number;code:string};
export function transferQrPayload(t:Transfer,prefix:'NAP'|'RUT'):string|null{
 const bank=bankDirectory.find(b=>b.code===t.bank_code);
 if(!bank?.qrSupported||!/^\d{6}$/.test(bank.bin)||!/^\d{6,24}$/.test(t.account_number)||!Number.isSafeInteger(t.amount_vnd)||t.amount_vnd<5000||t.amount_vnd>1000000||!new RegExp('^'+prefix+'[A-HJ-NP-Z2-9]{12}$').test(t.code))return null;
 return QRPay.initVietQR({bankBin:bank.bin,bankNumber:t.account_number,amount:String(t.amount_vnd),purpose:t.code}).build();
}
export function topupQrPayload(t:QrTopup):string|null{
 return t.status==='pending'?transferQrPayload({...t,amount_vnd:t.requested_vnd},'NAP'):null;
}
export function topupQrSvg(payload:string):string{
 const qr=qrcode(0,'M');qr.addData(payload,'Byte');qr.make();
 return qr.createSvgTag({cellSize:4,margin:16,scalable:true});
}
