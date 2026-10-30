export const permissionGroups = [
  { key: 'users', label: 'Tài khoản', actions: ['read','create','update','delete','assign_roles'] },
  { key: 'roles', label: 'Vai trò và quyền', actions: ['read','create','update','delete'] },
  { key: 'sellers', label: 'Người đăng', actions: ['read','review'] },
  { key: 'plans', label: 'Gói đăng tin', actions: ['read','create','update','delete'] },
  { key: 'locations', label: 'Khu vực', actions: ['read','create','update','delete'] },
  { key: 'content', label: 'Trang nội dung', actions: ['read','create','update','delete'] },
  { key: 'site_content', label: 'Nội dung website', actions: ['read','update'] },
  { key: 'listings', label: 'Tin phòng', actions: ['read','create','update','delete','review'] },
  { key: 'renewals', label: 'Gia hạn tin', actions: ['read','review'] },
  { key: 'reports', label: 'Báo cáo tin đăng', actions: ['read','review'] },
  { key: 'audit', label: 'Nhật ký quản trị', actions: ['read'] },
  { key: 'topups', label: 'Đối soát nạp tiền', actions: ['read','reconcile'] },
  { key: 'withdrawals', label: 'Yêu cầu rút số dư', actions: ['read','review','pay'] },
  { key: 'wallets', label: 'Số dư và sổ giao dịch', actions: ['read','adjust'] },
  { key: 'payments', label: 'Nhận nạp qua SePay', actions: ['read','update'] },
] as const;
export const allPermissions: string[] = permissionGroups.flatMap(g => g.actions.map(a => `${g.key}.${a}`));
export const actionLabels: Record<string,string> = { read:'Xem',create:'Tạo',update:'Sửa',delete:'Xóa / khôi phục',assign_roles:'Gán vai trò',review:'Xét duyệt',reconcile:'Đối soát / xác nhận',adjust:'Điều chỉnh số dư',pay:'Xác nhận đã chuyển tiền' };
export const can = (user: { is_super_admin: number; permissions: string[] } | null | undefined, permission: string) => Boolean(user && (user.is_super_admin || user.permissions.includes(permission)));
