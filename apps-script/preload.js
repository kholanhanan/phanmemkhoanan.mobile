// preload.js
// Cau noi an toan (contextBridge) giua giao dien (index.html va cac module con qua iframe)
// va tien trinh chinh (main.js). Trong the <script> cua tung module co the goi truc tiep:
//   window.dbAPI.readSheet(dbKey, sheetName)
//   window.dbAPI.writeSheet(dbKey, sheetName, dataArray)
//   window.dbAPI.listSheets(dbKey)
//
// dbKey xac dinh DUNG FILE Excel nao (moi module 1 file rieng, xem DB_FILES trong main.js).
// Danh sach nay khop DUNG thu tu hien tai tren Dashboard (xem index.html) — moi dbKey deu la
// 'module' + dung so thu tu o vi tri do, khong con dbKey ten rieng gay nham lan nhu truoc:
//   'module1' -> M01_TonKhoAnAn.xlsx              (Ton Kho An An - "Dac Tinh")
//   'module2' -> M02_TonKhoGui.xlsx        (Ton Kho Gui)
//   'module3' -> M03_NxtBotSot.xlsx              (NXT Bot/Sot)
//   'module4' -> M04_NxtTnkTgc.xlsx              (NXT - TNK/TGC)
//   'module5' -> M05_SoLieuKiemKe.xlsx        (Doi Chieu Kho Hang)
//   'module6' -> M06_InChungTuKho.xlsx         (Chung Tu Xuat Kho)
//   'module7' -> M07_SoLieuCuoiKy.xlsx              (So Lieu Kho/Ke Toan - Quan Ly Ton Kho)
//   'settings' -> CD_CaiDat.xlsx               (man hinh Cai Dat - khong danh so tren Dashboard)

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dbAPI', {
  // Doc du lieu tu 1 sheet trong file Excel cua dbKey, tra ve mang object
  readSheet: (dbKey, sheetName) => ipcRenderer.invoke('db:read-sheet', dbKey, sheetName),

  // Ghi (thay the toan bo) du lieu cua 1 sheet trong file Excel cua dbKey
  writeSheet: (dbKey, sheetName, dataArray) => ipcRenderer.invoke('db:write-sheet', dbKey, sheetName, dataArray),

  // Kho gui (Module 2) kem cot "Dac tinh" da suy ra nhu man hinh PC (trang chinh dung ve bieu do)
  readM2Derived: () => ipcRenderer.invoke('db:read-m2-derived'),

  // Ô "Tìm trong toàn kho" (trang chính): tồn hiện tại Module 1–4 gom 1 khuôn dòng + bảng Mã hóa Module 8
  globalSearch: () => ipcRenderer.invoke('db:global-search'),
  // Trang chính (tổng quan kho): tổng KL, nhóm size M01/M02, M03 theo loại hàng, M04 theo loại + size
  dashboardSummary: () => ipcRenderer.invoke('db:dashboard-summary'),

  // Ghi NHIEU sheet trong 1 lan ghi file: { tenSheet: mangObject | null (null = xoa sheet) }
  writeSheets: (dbKey, sheets) => ipcRenderer.invoke('db:write-sheets', dbKey, sheets),

  // Liet ke tat ca cac sheet hien co trong file Excel cua dbKey
  listSheets: (dbKey) => ipcRenderer.invoke('db:list-sheets', dbKey)
});

// Cập nhật phiên bản từ GitHub (Cài Đặt › Cập nhật, nút báo bản mới ở trang chính) — xem updater.js
// Mạng LAN — nhiều máy PC dùng chung 1 database (Cài Đặt › Mạng LAN, xem lan.js)
contextBridge.exposeInMainWorld('lanAPI', {
  getInfo: () => ipcRenderer.invoke('lan:get-info'),
  newToken: () => ipcRenderer.invoke('lan:new-token'),
  test: (host, port, token) => ipcRenderer.invoke('lan:test', host, port, token),
  setConfig: (cfg) => ipcRenderer.invoke('lan:set-config', cfg),
  restart: () => ipcRenderer.invoke('lan:restart'),
  onChanged: (cb) => ipcRenderer.on('lan:changed', (e, d) => { try { cb(d); } catch (err) { console.error(err); } }),
  onStatus: (cb) => ipcRenderer.on('lan:status', (e, d) => { try { cb(d); } catch (err) { console.error(err); } }),
});

contextBridge.exposeInMainWorld('updateAPI', {
  getInfo: () => ipcRenderer.invoke('update:get-info'),
  setConfig: (cfg) => ipcRenderer.invoke('update:set-config', cfg),
  check: () => ipcRenderer.invoke('update:check'),
  apply: () => ipcRenderer.invoke('update:apply'),
  rollback: () => ipcRenderer.invoke('update:rollback'),
});

// window.sheetsSyncAPI — tính năng "Đồng Bộ Điện Thoại": đẩy dữ liệu tồn kho Module 01/02 lên
// 1 Google Sheet qua Apps Script Web App (để bản điện thoại đọc), và kéo về các phiếu xuất mới do điện thoại
// tạo. Xem giao diện trong html/cai-dat.html (tab "Điện Thoại") và logic trong main.js.
contextBridge.exposeInMainWorld('sheetsSyncAPI', {
  getConfig: () => ipcRenderer.invoke('sheets:get-config'),
  setConfig: (webAppUrl, pcToken, intervalMinutes) =>
    ipcRenderer.invoke('sheets:set-config', { webAppUrl, pcToken, intervalMinutes }),
  testConnection: () => ipcRenderer.invoke('sheets:test-connection'),
  pushNow: () => ipcRenderer.invoke('sheets:push-now'),
  pullNow: () => ipcRenderer.invoke('sheets:pull-now'),
  // Đồng bộ ngay 1 vòng đầy đủ (lấy phiếu điện thoại về + đẩy tồn kho lên) — dùng ở Cài Đặt và
  // tab "Phiếu Xuất" của Module 02.
  // opts: { pull: true/false, tables: ['M01','M01VT','M01VTB','M02','M03','M04'] } — bỏ trống = tất cả.
  syncNow: (opts) => ipcRenderer.invoke('sheets:sync-now', opts),
  // PC 7.63: yêu cầu thêm / chuyển Lịch xuất nhập hàng do điện thoại (Quản lý trở lên) gửi — main.js gửi xuống, trang chính xử lý rồi báo lại.
  onLichXuatOps: (cb) => ipcRenderer.on('lx:remote-ops', (e, ops) => { try { cb(ops); } catch (err) { console.error(err); } }),
  lichXuatAck: (results) => ipcRenderer.invoke('lx:remote-ack', results),
  // PC 8.22: hộp chờ duyệt EMAIL → lịch xuất. opts { scan: true } = bảo Apps Script quét Gmail ngay.
  lichXuatEmail: (opts) => ipcRenderer.invoke('lx:email-list', opts || {}),
  lichXuatEmailAck: (results) => ipcRenderer.invoke('lx:email-ack', results),
  // Nút "Đẩy lên điện thoại" cạnh đồng hồ (index.js): đẩy RIÊNG các bảng của 1 module (dbKey 'module1'…'module8').
  pushModule: (dbKey) => ipcRenderer.invoke('sheets:push-module', dbKey),
  setPick: (pick) => ipcRenderer.invoke('sheets:set-pick', pick),
  // PC 7.41: chu kỳ tự động (phút) theo từng mục — { pull, M01, ..., LX: 0|1|5|10|15|30|60|120 }, 0 = tắt
  setAutoPick: (map) => ipcRenderer.invoke('sheets:set-auto-pick', map),
  // Danh sách tài khoản / phân quyền theo token (Cài Đặt → Tài khoản — html/js/tai-khoan.js dùng permGet / permSave).
  // Lịch sử phiếu điện thoại trên Google Sheet (chỉ đọc) — dùng ở màn "Phiếu xuất toàn hệ thống".
  historyGet: () => ipcRenderer.invoke('sheets:history'),
  permGet: () => ipcRenderer.invoke('sheets:perm-get'),
  permSave: (list, opts) => ipcRenderer.invoke('sheets:perm-save', list, opts),
  permPull: () => ipcRenderer.invoke('sheets:perm-pull') // PC 7.95: kéo tài khoản có trên Sheet về máy này (không xóa gì trên máy)
});

// window.phoneImportBridge — Module 01/02/03/04 (ton-kho-an-an.js, ton-kho-gui.js,
// nxt-bot-sot.js, nxt-hang-nhap-khau.js) dùng:
// đăng ký "module đang mở" với main.js, rồi nhận các phiếu xuất điện thoại mà main.js vừa kéo về để TỰ nhập vào bộ nhớ
// + database (tránh việc main.js ghi thẳng Excel rồi bị Module 02 ghi đè mất ở lần lưu kế tiếp).
contextBridge.exposeInMainWorld('phoneImportBridge', {
  register: (dbKey) => ipcRenderer.invoke('phone:register-module', dbKey || 'module2'),
  onImportRequest: (callback) => {
    ipcRenderer.on('phone:import-phieu', (_event, payload) => callback(payload));
  },
  sendResult: (reqId, result) => ipcRenderer.invoke('phone:import-result', reqId, result),
  // Xóa phiếu điện thoại trên PC → báo lên Sheet (trạng thái "Lỗi - Đã hủy trên PC") + đẩy lại tồn kho của module đó.
  // mod: 'M01' | 'M01VT' | 'M01VTB' | 'M02' | 'M03' | 'M04'; ids: id phiếu điện thoại (phoneId).
  markDeleted: (mod, ids) => ipcRenderer.invoke('phone:mark-deleted', mod, ids),
  // Số liệu BÁO CÁO vừa đổi (không đổi tồn) → main.js dựng lại + đẩy báo cáo Excel cho điện thoại sau ~4 giây.
  reportChanged: (dbKey) => ipcRenderer.invoke('phone:report-changed', dbKey)
});

// SỬA LỖI "popup khựng, không gõ được" (09/2026): lỗi đã biết của Electron trên Windows — sau hộp thoại gốc
// alert() / confirm() / prompt(), ô nhập trong trang mất khả năng nhận phím cho tới khi cửa sổ mất rồi lấy lại
// tiêu điểm. lib/theme-sync.js (nạp ở MỌI trang) bọc 3 hàm đó và gọi refocus() ngay sau khi hộp thoại đóng.
// Đăng nhập trên PC (PC 5.8) — html/js/auth-gate.js. Mã truy cập không bao giờ trả về giao diện.
// PC 7.64 — Sao lưu & Drive BẢN MỚI (bảng theo module) — kênh bk2:* trong sao-luu-moi.js
contextBridge.exposeInMainWorld('backup2API', {
  getState: () => ipcRenderer.invoke('bk2:get-state'),
  setConfig: (cfg) => ipcRenderer.invoke('bk2:set-config', cfg),
  chooseFolder: (opts) => ipcRenderer.invoke('bk2:choose-folder', opts),
  runNow: (p) => ipcRenderer.invoke('bk2:run-now', p),
  restoreDrive: (p) => ipcRenderer.invoke('bk2:restore-drive', p),
  pickFile: (dbKey) => ipcRenderer.invoke('bk2:pick-file', dbKey),
  restoreFile: (p) => ipcRenderer.invoke('bk2:restore-file', p),
  reloadApp: () => ipcRenderer.invoke('bk2:reload-app')
});

contextBridge.exposeInMainWorld('authAPI', {
  winMode: (locked) => ipcRenderer.send('win:mode', !!locked), // 1.10: cửa sổ nhỏ khi chưa đăng nhập
  state: () => ipcRenderer.invoke('auth:state'),
  login: (ten, matKhau, ghiNho, tuDong) => ipcRenderer.invoke('auth:login', ten, matKhau, !!ghiNho, !!tuDong),
  remembered: () => ipcRenderer.invoke('auth:remembered'),
  forget: () => ipcRenderer.invoke('auth:forget'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (cu, moi) => ipcRenderer.invoke('auth:change-password', cu, moi),
  // PC 7.95 — Thiết lập máy mới (main.js › setup:*): chỉ chạy được khi máy chưa có tài khoản nào
  setupPull: (o) => ipcRenderer.invoke('setup:pull', o),
  setupCreateAdmin: (ma, o) => ipcRenderer.invoke('setup:create-admin', ma, o),
  setupImportFile: () => ipcRenderer.invoke('setup:import-file'),
  onPermChanged: (cb) => ipcRenderer.on('auth:perm-changed', (e, d) => { try { cb(d); } catch (err) { console.error(err); } }) // PC 7.52: quyền của tài khoản đang đăng nhập vừa đổi
});

// PC 7.61 — Lịch sử thao tác (module 11). query: chỉ Quản trị (main.js chặn thật); logImport / setContext: mọi tài khoản đã đăng nhập.
contextBridge.exposeInMainWorld('historyAPI', {
  query: (filters) => ipcRenderer.invoke('history:query', filters || {}),
  logImport: (files) => ipcRenderer.invoke('history:log-import', files || []),
  setContext: (name) => ipcRenderer.invoke('history:set-context', name || '')
});

contextBridge.exposeInMainWorld('appWindowAPI', {
  refocus: () => ipcRenderer.invoke('window:refocus'),
  giaiPhongBoNho: () => ipcRenderer.invoke('app:giai-phong-bo-nho'), // PC 0.19 — xả bộ đệm Excel ở tiến trình chính
});

// PC 0.65 — Đối chiếu hàng ngày (M16): liên kết file Excel + ghi thẳng. Dữ liệu chỉ nằm trên máy này, theo tài khoản (core/dcx-link.js).
contextBridge.exposeInMainWorld('dcxAPI', {
  get: () => ipcRenderer.invoke('dcx:get'),
  pick: (slot) => ipcRenderer.invoke('dcx:pick', slot),
  unlink: (slot) => ipcRenderer.invoke('dcx:unlink', slot),
  read: (slot) => ipcRenderer.invoke('dcx:read', slot),
  check: () => ipcRenderer.invoke('dcx:check'),
  commit: (arg) => ipcRenderer.invoke('dcx:commit', arg),
  setBackupDir: (reset) => ipcRenderer.invoke('dcx:set-backup-dir', !!reset),
  openBackup: () => ipcRenderer.invoke('dcx:open-backup'),
  stateGet: () => ipcRenderer.invoke('dcx:state-get'),
  stateSet: (text) => ipcRenderer.invoke('dcx:state-set', text)
});

// PC 1.02 — Công cụ "Quản lý file" (M18): đổi tên hàng loạt, sắp xếp, file trùng, thùng rác. Chỉ làm việc trong thư mục người dùng chọn (core/fm-module.js).
contextBridge.exposeInMainWorld('fmAPI', {
  root: () => ipcRenderer.invoke('fm:root'),
  pickFolder: () => ipcRenderer.invoke('fm:pickFolder'),
  list: (o) => ipcRenderer.invoke('fm:list', o),
  applyRename: (items) => ipcRenderer.invoke('fm:applyRename', items),
  applyOrganize: (o) => ipcRenderer.invoke('fm:applyOrganize', o),
  findDuplicates: () => ipcRenderer.invoke('fm:findDuplicates'),
  trash: (rels) => ipcRenderer.invoke('fm:trash', rels),
  cancel: () => ipcRenderer.invoke('fm:cancel'),
  undoLast: () => ipcRenderer.invoke('fm:undoLast'),
  history: () => ipcRenderer.invoke('fm:history'),
  onProgress: (cb) => { ipcRenderer.removeAllListeners('fm:progress'); ipcRenderer.on('fm:progress', (_e, p) => cb(p)); }
});

// PC 1.03 — Công cụ "Lưu trữ cá nhân" (M19): tin nhắn / ảnh / file riêng của tài khoản đang đăng nhập, đồng bộ điện thoại qua LAN + Drive (core/luu-tru.js).
contextBridge.exposeInMainWorld('ltAPI', {
  init: () => ipcRenderer.invoke('lt:init'),
  ngan: () => ipcRenderer.invoke('lt:ngan'),
  list: (q) => ipcRenderer.invoke('lt:list', q),
  sendText: (ng, text) => ipcRenderer.invoke('lt:send-text', ng, text),
  sendFiles: (ng, files) => ipcRenderer.invoke('lt:send-files', ng, files),
  pickSend: (ng) => ipcRenderer.invoke('lt:pick-send', ng),
  edit: (id, patch) => ipcRenderer.invoke('lt:edit', id, patch),
  del: (id) => ipcRenderer.invoke('lt:del', id),
  restore: (id) => ipcRenderer.invoke('lt:restore', id),
  purge: (id) => ipcRenderer.invoke('lt:purge', id),
  emptyTrash: () => ipcRenderer.invoke('lt:empty-trash'),
  nganSave: (ng) => ipcRenderer.invoke('lt:ngan-save', ng),
  nganDel: (id) => ipcRenderer.invoke('lt:ngan-del', id),
  fileData: (id) => ipcRenderer.invoke('lt:file-data', id),
  open: (id) => ipcRenderer.invoke('lt:open', id),
  show: (id) => ipcRenderer.invoke('lt:show', id),
  saveAs: (id) => ipcRenderer.invoke('lt:save-as', id),
  openUrl: (u) => ipcRenderer.invoke('lt:open-url', u),
  status: () => ipcRenderer.invoke('lt:status'),
  sync: () => ipcRenderer.invoke('lt:sync'),
  cfgGet: () => ipcRenderer.invoke('lt:cfg-get'),
  cfgSet: (p) => ipcRenderer.invoke('lt:cfg-set', p)
});
