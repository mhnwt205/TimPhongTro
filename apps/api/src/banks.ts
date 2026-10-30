import {Banks} from 'vietnam-qr-pay';
// Canonical identifiers prevent aliases for the same receiving bank bypassing deduplication.
export const receivingBanks=[
 ['VCB','Vietcombank'],['BIDV','BIDV'],['CTG','VietinBank'],['AGRIBANK','Agribank'],['TCB','Techcombank'],['MB','MB Bank'],['ACB','ACB'],['VPB','VPBank'],['TPB','TPBank'],['STB','Sacombank'],['VIB','VIB'],['HDB','HDBank'],['SHB','SHB'],['OCB','OCB'],['MSB','MSB'],['SEAB','SeABank'],['NAB','Nam A Bank'],['EIB','Eximbank'],['BAB','Bac A Bank'],['LPB','LPBank'],['PVB','PVcomBank'],['ABB','ABBANK'],['NCB','NCB'],['SCB','SCB'],['VAB','VietABank'],['BVB','BVBank'],['KLB','KienlongBank'],['SGB','Saigonbank'],['CAKE','CAKE by VPBank'],['UOB','UOB Việt Nam'],['SHINHAN','Shinhan Bank Việt Nam'],['WOORI','Woori Bank Việt Nam'],['HSBC','HSBC Việt Nam'],['STANDARD','Standard Chartered Việt Nam'],
] as const;
export const canonicalBankName=(code:string)=>receivingBanks.find(b=>b[0]===code)?.[1]??null;

// Keep existing account identity codes stable; the public directory uses different aliases.
const directoryAliases:Record<string,string>={BIDV:'BID',MB:'MBB',SEAB:'SSB',PVB:'PVCOMBANK',NCB:'NVB',SHINHAN:'SVB',WOORI:'WRB',STANDARD:'SC'};
export const bankDirectory=receivingBanks.map(([code,name])=>{
 const bank=Banks.find(b=>b.code===(directoryAliases[code]??code)&&!b.deprecated);
 return {code,name,fullName:bank?.name??name,bin:bank?.bin??'',qrSupported:Boolean(bank&&bank.vietQRStatus>=0),keywords:bank?.keywords??''};
});
