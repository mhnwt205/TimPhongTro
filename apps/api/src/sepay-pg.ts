import type {Bindings} from './security';

export type SepayPgConfig={environment:'sandbox'|'production';merchantId:string;secretKey:string};
export type SepayOrder={invoice:string;amountVnd:number;currency:string;status:string;providerReference:string;paid:boolean};

const signedFields=new Set([
 'merchant','env','operation','payment_method','order_amount','currency','order_invoice_number',
 'order_description','customer_id','agreement_id','agreement_name','agreement_type',
 'agreement_payment_frequency','agreement_amount_per_payment','success_url','error_url','cancel_url','order_id',
]);
const checkoutFieldOrder=['payment_method','order_invoice_number','order_amount','currency','order_description','success_url','error_url','cancel_url','merchant','operation'];
const encoder=new TextEncoder();

export function sepayPgConfig(bindings:Pick<Bindings,'SEPAY_ENV'|'SEPAY_MERCHANT_ID'|'SEPAY_SECRET_KEY'>):SepayPgConfig|null{
 const environment=bindings.SEPAY_ENV?.trim();
 const merchantId=bindings.SEPAY_MERCHANT_ID?.trim();
 const secretKey=bindings.SEPAY_SECRET_KEY?.trim();
 if((environment!=='sandbox'&&environment!=='production')||!merchantId||!secretKey)return null;
 return {environment,merchantId,secretKey};
}

export function checkoutEndpoint(environment:'sandbox'|'production'){
 return environment==='sandbox'
  ?'https://pay-sandbox.sepay.vn/v1/checkout/init'
  :'https://pay.sepay.vn/v1/checkout/init';
}

async function digest(secret:string,message:string){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(message)));
}
function toBase64(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
function signatureMessage(fields:Record<string,unknown>,orderedKeys:string[]){
 return orderedKeys.filter(key=>signedFields.has(key)&&Object.hasOwn(fields,key))
  .map(key=>`${key}=${fields[key]===null?'':String(fields[key])}`).join(',');
}
export async function sepaySignature(fields:Record<string,unknown>,secret:string){
 return toBase64(await digest(secret,signatureMessage(fields,Object.keys(fields))));
}

export async function createCheckoutFields(config:SepayPgConfig,input:{invoice:string;amountVnd:number;successUrl:string;errorUrl:string;cancelUrl:string}){
 // Match sepay-pg-node's field insertion/signing order, then return its hidden fields.
 const fields:Record<string,string|number>={
  payment_method:'BANK_TRANSFER',
  order_invoice_number:input.invoice,
  order_amount:input.amountVnd,
  currency:'VND',
  order_description:`Nap tien ${input.invoice}`,
  success_url:input.successUrl,
  error_url:input.errorUrl,
  cancel_url:input.cancelUrl,
  merchant:config.merchantId,
  operation:'PURCHASE',
 };
 fields.signature=await sepaySignature(fields,config.secretKey);
 return fields;
}

function safeEqual(a:string,b:string){
 if(a.length!==b.length)return false;
 let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
 return difference===0;
}

export async function verifyIpnSignature(fields:Record<string,unknown>,provided:string,secret:string){
 let value=provided.trim();
 if(value.toLowerCase().startsWith('sha256='))value=value.slice(7);
 const receivedOrder=Object.keys(fields);
 const canonicalOrder=[...checkoutFieldOrder,'order_id','agreement_id','agreement_name','agreement_type','agreement_payment_frequency','agreement_amount_per_payment'];
 const candidates=[receivedOrder,canonicalOrder,[...signedFields]];
 const signatures=new Set<string>();
 for(const order of candidates){
  try{
   const expected=toBase64(await digest(secret,signatureMessage(fields,order)));
   signatures.add(expected);
   signatures.add(Array.from(await digest(secret,signatureMessage(fields,order)),b=>b.toString(16).padStart(2,'0')).join(''));
  }catch{return false;}
 }
 return [...signatures].some(signature=>safeEqual(value,signature));
}

function objects(value:unknown,out:Record<string,unknown>[]=[],depth=0):Record<string,unknown>[]{
 if(!value||typeof value!=='object'||depth>8)return out;
 if(Array.isArray(value)){for(const item of value)objects(item,out,depth+1);return out;}
 const row=value as Record<string,unknown>;out.push(row);
 for(const child of Object.values(row))objects(child,out,depth+1);
 return out;
}
function readString(row:Record<string,unknown>,...keys:string[]):string{
 for(const key of keys){const value=row[key];if(typeof value==='string'&&value.trim())return value.trim();if(typeof value==='number'&&Number.isFinite(value))return String(value);}
 return '';
}
function readAmount(row:Record<string,unknown>):number|null{
 for(const key of ['order_amount','amount','total_amount','paid_amount','transaction_amount']){
  const value=row[key];
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;
  if(typeof value==='string'&&/^\d+(?:\.0+)?$/.test(value.trim())){const parsed=Number(value);if(Number.isSafeInteger(parsed)&&parsed>=0)return parsed;}
 }
 return null;
}
const paidStates=new Set(['PAID','SUCCESS','SUCCESSFUL','SUCCEEDED','COMPLETED','CAPTURED','SETTLED','PAID_SUCCESS']);
export function parseSepayOrder(value:unknown,expectedInvoice:string):SepayOrder|null{
 const rows=objects(value);
 const invoiceKeys=['order_invoice_number','invoice_number','invoice','invoiceNumber'];
 const row=rows.find(item=>invoiceKeys.some(key=>readString(item,key)===expectedInvoice));
 if(!row)return null;
 const invoice=readString(row,...invoiceKeys);
 const amountVnd=readAmount(row);
 const currency=readString(row,'currency','order_currency').toUpperCase();
 const status=readString(row,'order_status','payment_status','transaction_status','status','state').toUpperCase();
 const providerReference=readString(row,'transaction_id','transactionId','payment_id','paymentId','reference_number','order_id','id')||invoice;
 if(!invoice||amountVnd===null||!currency||!status)return null;
 return {invoice,amountVnd,currency,status,providerReference,paid:paidStates.has(status)};
}

function base64Utf8(value:string){
 const bytes=encoder.encode(value);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
}
export async function fetchSepayOrder(config:SepayPgConfig,invoice:string,fetcher:typeof fetch=fetch):Promise<SepayOrder|null>{
 const host=config.environment==='sandbox'?'https://pgapi-sandbox.sepay.vn/v1':'https://pgapi.sepay.vn/v1';
 const response=await fetcher(`${host}/order/detail/${encodeURIComponent(invoice)}`,{
  method:'GET',headers:{Accept:'application/json',Authorization:`Basic ${base64Utf8(`${config.merchantId}:${config.secretKey}`)}`},
  signal:AbortSignal.timeout(10000),
 });
 if(response.status===404)return null;
 if(!response.ok){
  const error=new Error('SePay order lookup failed');
  Object.assign(error,{status:response.status});throw error;
 }
 let payload:unknown;
 try{payload=await readBoundedJson(response,65536);}catch{throw new Error('SePay returned invalid or oversized order data');}
 const order=parseSepayOrder(payload,invoice);
 if(!order)throw new Error('SePay order data did not match the requested invoice');
 return order;
}

export function verifyIpnAuthorization(header:string|null,config:SepayPgConfig){
 if(!header)return null;
 const separator=header.indexOf(' ');if(separator<0)return false;
 const scheme=header.slice(0,separator).toLowerCase(),token=header.slice(separator+1).trim();
 if(scheme==='apikey')return safeEqual(token,config.secretKey);
 if(scheme==='basic'){
  try{
   const decoded=atob(token);
   return safeEqual(decoded,`${config.merchantId}:${config.secretKey}`);
  }catch{return false;}
 }
 return false;
}

async function readBoundedJson(response:Response,maxBytes:number):Promise<unknown>{
 const statedLength=Number(response.headers.get('content-length')??0);
 if(Number.isFinite(statedLength)&&statedLength>maxBytes)throw new Error('SePay order response exceeded the allowed size');
 const reader=response.body?.getReader();
 if(!reader)throw new Error('SePay order response body was empty');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>maxBytes){await reader.cancel();throw new Error('SePay order response exceeded the allowed size');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
