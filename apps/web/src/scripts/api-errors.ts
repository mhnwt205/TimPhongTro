type ApiErrorBody={error?:unknown};

function statusMessage(response:Response,fallback:string){
 if(response.status===401)return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử thao tác.';
 if(response.status===403)return 'Tài khoản hiện tại không có quyền thực hiện thao tác này.';
 if(response.status===404)return 'Không tìm thấy nội dung cần xử lý. Tải lại danh sách để kiểm tra.';
 if(response.status===409)return 'Dữ liệu vừa thay đổi. Tải lại trang để cập nhật trước khi thử lại.';
 if(response.status===413)return 'Dữ liệu gửi lên vượt quá giới hạn. Rút gọn nội dung hoặc chọn tệp nhỏ hơn rồi thử lại.';
 if(response.status===429){
  const seconds=Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds)&&seconds>0?`Bạn vừa gửi quá nhiều yêu cầu. Đợi khoảng ${seconds} giây rồi thử lại.`:'Bạn vừa gửi quá nhiều yêu cầu. Đợi một chút rồi thử lại.';
 }
 if(response.status>=500)return 'Hệ thống đang gặp sự cố khi xử lý yêu cầu. Tải lại trang để kiểm tra kết quả trước khi gửi lại.';
 return fallback;
}

/** Read API JSON without exposing browser/parser errors when a Worker returns an empty or non-JSON response. */
export async function readApiJson<T=unknown>(response:Response,fallback:string):Promise<T>{
 let data:unknown;
 try{data=await response.json();}
 catch{
  if(!response.ok)throw new Error(statusMessage(response,fallback));
  throw new Error('Máy chủ gửi phản hồi không đọc được. Tải lại trang để kiểm tra trạng thái trước khi thao tác lại.');
 }
 if(!response.ok){
  const message=data&&typeof data==='object'&&'error'in data?(data as ApiErrorBody).error:null;
  throw new Error(typeof message==='string'&&message.trim()?message:statusMessage(response,fallback));
 }
 return data as T;
}

/** Convert browser/network exceptions into short Vietnamese guidance. */
export function displayError(error:unknown,fallback:string){
 if(error instanceof DOMException&&error.name==='TimeoutError')return 'Chưa nhận được kết quả từ máy chủ. Tải lại trang để kiểm tra trạng thái trước khi gửi lại.';
 if(error instanceof TypeError)return 'Không kết nối được với máy chủ. Kiểm tra kết nối mạng rồi thử lại.';
 if(error instanceof SyntaxError)return 'Máy chủ gửi phản hồi không đọc được. Tải lại trang để kiểm tra trạng thái trước khi thao tác lại.';
 if(error instanceof Error&&error.name==='AbortError')return fallback;
 if(error instanceof DOMException)return fallback;
 return error instanceof Error&&error.message.trim()?error.message:fallback;
}
