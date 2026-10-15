// main.js
// Tien trinh chinh (main process) cua Electron.
// Nhiem vu: mo cua so ung dung, khoi tao CAC file Excel database (moi module 1 file rieng,
// de tien backup/chinh sua tung module doc lap), va cung cap kenh IPC de doc/ghi du lieu
// Excel cho renderer (index.html va cac module con qua iframe) su dung.
//
// Khong dung PHP / MySQL / XAMPP / Apache / Internet / Server online.
// Toan bo du lieu luu trong cac file Excel cuc bo, trong thu muc /database/.
//
// PHAN MO RONG "Dong bo Dien Thoai" (them sau, tuy chon, KHONG bat buoc): neu nguoi dung nhap
// URL Apps Script Web App + ma PC_TOKEN trong Cai Dat -> tab "Dien Thoai", app se day du lieu ton kho
// Module 01/02 len 1 Google Sheet (de ban dien thoai Capacitor doc), va dinh ky keo ve cac
// phieu xuat moi do dien thoai tao, ghi vao dung sheet PhieuXuat/PhieuXuatItems cua module2.
// Neu KHONG cau hinh gi, phan nay hoan toan khong chay - app van la Excel offline nhu cu.
// Xem chi tiet trong sheets-webapp-client.js va README.md muc "Dong bo dien thoai".

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, powerSaveBlocker, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
// PC 7.95: bố cục thư mục mới (xem core/paths.js) — chuyển cấu hình cũ ở gốc app/ sang config/ NGAY ĐẦU TIÊN, trước khi bất cứ thứ gì đọc cấu hình.
const PATHS = require('./core/paths');
const LEGACY_MIGRATION = PATHS.migrateLegacyConfig();
const sheetsSync = require('./core/sheets-webapp-client');
// PC 7.10: PC_TOKEN cài cố định trong app-config.js (pcToken) — máy mới không phải nhập tay. Phải TRÙNG PC_TOKEN trong Apps Script (Code.gs).
const FIXED_PC_TOKEN = (() => { try { return String(require('./core/app-config').pcToken || '').trim(); } catch (e) { return ''; } })();
const AUTO_LOCK_ADMIN = (() => { try { return require('./core/app-config').autoLockDefaultAdmin !== false; } catch (e) { return true; } })();
const FIXED_WEBAPP_URL = (() => { try { const u = String(require('./core/app-config').webAppUrl || '').trim(); return /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(u) ? u : ''; } catch (e) { return ''; } })(); // link Web App cố định (app-config.js)
const m8Store = require('./html/js/m8-store'); // Module 8: lưu/đọc database theo từng sheet (dùng chung với tong-hop.js)
const klSize = require('./html/js/size-label'); // nhãn Size có tiền tố (BTP 50…) — dùng chung với ô "Tìm trong toàn kho"

let DB_DIR = path.join(__dirname, 'database');

// NHẬT KÝ LỖI (rà soát 09/2026): lỗi không bắt được ở tiến trình chính trước đây chỉ hiện hộp lỗi / mất dấu.
// Ghi thêm vào database/_nhat-ky-loi.log (tối đa ~1 MB, quá thì giữ nửa sau) để tra cứu khi có sự cố.
// PC 0.19 — ghi nhật ký lỗi KHÔNG chặn tiến trình chính (trước đây đọc/ghi file đồng bộ mỗi lần có lỗi — lỗi mạng lặp lại
// mỗi vài giây làm cửa sổ khựng). Các dòng được xếp hàng ghi lần lượt nên không lẫn thứ tự.
// Riêng lỗi làm sập (uncaughtException) vẫn ghi ĐỒNG BỘ để chắc chắn còn dấu vết.
let logChain = Promise.resolve();
const logLine = (where, err) => `[${new Date().toISOString()}] ${where}: ${(err && (err.stack || err.message)) || err}\n`;
function logError(where, err) {
  const line = logLine(where, err);
  const f = path.join(DB_DIR, '_nhat-ky-loi.log');
  logChain = logChain.then(async () => {
    try {
      await fs.promises.mkdir(DB_DIR, { recursive: true });
      let size = 0; try { size = (await fs.promises.stat(f)).size; } catch (e) { size = 0; }
      if (size > 1024 * 1024) {
        const keep = await fs.promises.readFile(f, 'utf8');
        await fs.promises.writeFile(f, keep.slice(Math.floor(keep.length / 2)), 'utf8');
      }
      await fs.promises.appendFile(f, line, 'utf8');
    } catch (e) { /* ghi nhật ký lỗi không được thì thôi */ }
  });
}
function logErrorSync(where, err) {
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    fs.appendFileSync(path.join(DB_DIR, '_nhat-ky-loi.log'), logLine(where, err), 'utf8');
  } catch (e) { /* bỏ qua */ }
}
process.on('uncaughtException', (err) => { console.error('uncaughtException:', err); logErrorSync('uncaughtException', err); });

// PHÂN QUYỀN MỤC CÀI ĐẶT (PC 6.7) — CHẶN THẬT ở tiến trình chính các kênh IPC GHI/ĐỔI của từng mục trong Cài đặt: người dùng
// không có quyền tương ứng (CD_SAOLUU / CD_DONGBO) thì kênh trả { ok:false, error }, dù có gọi thẳng
// window.backup2API… từ DevTools. Chỉ chặn kênh ghi / đổi (kênh ĐỌC như update:get-info, lan:get-info,
// sheets:get-config vẫn mở vì trang chính / các module cần). PHẢI bọc ipcMain.handle TRƯỚC lan.install() để lớp chặn nằm
// NGOÀI CÙNG (máy con LAN chuyển kênh sheets:* sang máy chủ — máy chủ không được kiểm quyền theo phiên của máy chủ).
const PC_GUARD = {
  // PC 7.3: chỉ còn 3 mục Cài đặt cần quyền riêng: CD_SAOLUU (Sao lưu & Drive — GHI lên Drive, đổi thư mục / lịch), CD_DONGBO (Đồng bộ điện thoại),
  // TAIKHOAN. Các mục cơ bản — Giao diện, Trợ lý AI, Cập nhật phiên bản, Mạng LAN, KHÔI PHỤC dữ liệu — mọi tài khoản đều có, không phân quyền
  // ('ANY' = chỉ cần đã đăng nhập). Riêng: khôi phục chỉ chép lại database của module mà tài khoản được cấp (xem restoreAllowedKeys),
  // và chế độ "Máy chủ" của Mạng LAN chỉ tài khoản Quản trị được đặt / đổi ('LANCFG' — xem pcGuardDeny).
  // PC 7.64 — Sao lưu & Drive BẢN MỚI (sao-luu-moi.js): cùng 2 mã quyền với bản cũ.
  'bk2:set-config': 'CD_SAOLUU', 'bk2:run-now': 'CD_SAOLUU', 'bk2:choose-folder': 'CD_SAOLUU',
  'bk2:restore-drive': 'CD_KHOIPHUC', 'bk2:pick-file': 'CD_KHOIPHUC', 'bk2:restore-file': 'CD_KHOIPHUC',
  'sheets:set-config': 'CD_DONGBO', 'sheets:test-connection': 'CD_DONGBO', 'sheets:push-now': 'CD_DONGBO',
  'sheets:sync-now': 'CD_DONGBO', 'sheets:set-pick': 'CD_DONGBO', 'sheets:set-auto-pick': 'CD_DONGBO',
  'lx:email-list': 'LX_EMAIL', 'lx:email-ack': 'LX_EMAIL', // PC 8.34
  'update:set-config': 'ADMIN', 'update:apply': 'ANY', 'update:rollback': 'ANY',
  // PC 7.14 — VAI TRÒ (Người dùng cấp 1 / cấp 2 / Quản lý / Quản trị): CHẶN THẬT mọi kênh GHI dữ liệu theo vai trò (xem pcGuardDeny).
  'db:write-sheet': 'WRITE', 'db:write-sheets': 'WRITE', 'phone:mark-deleted': 'WRITE_QL', 'sheets:pull-now': 'WRITE_QL',
  // PC 7.18 — CHẶN ĐỌC khi chưa đăng nhập (Electron là cửa vào duy nhất): mọi kênh đọc database cần có phiên đăng nhập.
  // Máy chủ LAN phục vụ máy con bằng hàm gốc (không qua lớp này) nên không bị ảnh hưởng.
  'db:read-sheet': 'READ', 'db:list-sheets': 'READ', 'db:read-m2-derived': 'READ', 'db:global-search': 'READ', 'db:dashboard-summary': 'READ',
  'lan:new-token': 'ANY', 'lan:test': 'ANY', 'lan:set-config': 'LANCFG', 'lan:restart': 'ANY',
  // PC 7.61 — module Lịch sử: chỉ tài khoản Quản trị XEM; mọi tài khoản đã đăng nhập đều được GHI (báo nhập file / đổi module đang mở)
  'history:query': 'ADMIN', 'history:log-import': 'ANY', 'history:set-context': 'ANY',
  // PC 0.65 — Đối chiếu hàng ngày (M16): liên kết file Excel + ghi thẳng. Cần quyền module M16; GHI file Kho cần thêm vai trò Quản lý trở lên (xem pcGuardDeny › DCX_WRITE).
  'dcx:get': 'M16', 'dcx:pick': 'M16', 'dcx:unlink': 'M16', 'dcx:read': 'M16', 'dcx:check': 'M16', 'dcx:set-backup-dir': 'M16', 'dcx:open-backup': 'M16', 'dcx:state-get': 'M16', 'dcx:state-set': 'M16',
  'dcx:commit': 'DCX_WRITE',
  // PC 1.02 — Công cụ Quản lý file (M18): mọi kênh cần quyền module M18 (chặn THẬT ở đây, không chỉ ẩn nút).
  'fm:root': 'M18', 'fm:pickFolder': 'M18', 'fm:list': 'M18', 'fm:applyRename': 'M18', 'fm:applyOrganize': 'M18', 'fm:findDuplicates': 'M18', 'fm:trash': 'M18', 'fm:cancel': 'M18', 'fm:undoLast': 'M18', 'fm:history': 'M18',
  // PC 1.03 — Lưu trữ cá nhân (M19): mọi kênh lt:* cần quyền module M19 (chặn THẬT ở đây). Riêng đổi cài đặt máy chủ LAN / Drive (lt:cfg-set) cần vai trò Quản lý trở lên.
  'lt:init': 'M19', 'lt:ngan': 'M19', 'lt:list': 'M19', 'lt:send-text': 'M19', 'lt:send-files': 'M19', 'lt:pick-send': 'M19', 'lt:edit': 'M19', 'lt:del': 'M19', 'lt:restore': 'M19', 'lt:purge': 'M19',
  'lt:empty-trash': 'M19', 'lt:ngan-save': 'M19', 'lt:ngan-del': 'M19', 'lt:file-data': 'M19', 'lt:open': 'M19', 'lt:show': 'M19', 'lt:save-as': 'M19', 'lt:open-url': 'M19', 'lt:status': 'M19', 'lt:sync': 'M19', 'lt:cfg-get': 'M19',
  'lt:cfg-set': 'LT_CFG'
};
const PC_GUARD_NAME = { LX_EMAIL: 'Duyệt email Lịch xuất nhập hàng', CD_SAOLUU: 'Sao lưu Drive (toàn quyền)', CD_KHOIPHUC: 'Khôi phục Drive', CD_DONGBO: 'Đồng bộ điện thoại', ADMIN: 'Nguồn cập nhật (chỉ tài khoản Quản trị)', M16: 'Đối chiếu hàng ngày', M18: 'Quản lý file', M19: 'Lưu trữ cá nhân' };
(function guardIpc() {
  const rawHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => {
    const code = PC_GUARD[channel];
    if (!code) return rawHandle(channel, fn);
    return rawHandle(channel, async (event, ...args) => {
      const deny = pcGuardDeny(code, args);
      if (deny) return { ok: false, error: deny };
      return fn(event, ...args);
    });
  };
})();
// MẠNG LAN (10/2026) — nhiều máy PC dùng chung 1 database: máy chủ / máy con (xem lan.js). PHẢI bọc ipcMain.handle
// TRƯỚC mọi lệnh đăng ký kênh IPC bên dưới (máy con chuyển các kênh db:* / sheets:* sang máy chủ).
const lan = require('./core/lan')({ app, appDir: __dirname, logError: (w, e) => logError(w, e), getWindow: () => mainWindow,
  resolvePath: (k) => resolveDbPath(k), dbKeys: () => Object.keys(DB_FILES),
  onCacheFile: (k) => { try { const p = resolveDbPath(k); wbCache.delete(p); rowsCache.delete(p); } catch (e) { /* bỏ qua */ } },
  // PC 7.48: mã kết nối máy chủ chỉ trả về cho tài khoản Quản trị (tài khoản thường gọi lan:get-info không thấy mã)
  canSeeSecret: () => { try { return !!isQuanTri(findSessionUser(ensureDefaultAdmin(storedPerm()))); } catch (e) { return false; } },
  getUserName: () => authSessionTen || '' }); // PC 7.61: gửi kèm tài khoản khi máy con ghi dữ liệu (module Lịch sử)
lan.install(ipcMain);
lan.registerIpc(ipcMain);
// Đổi chế độ Mạng LAN cần khởi động lại tiến trình chính (mở/đóng cổng máy chủ, chuyển kênh dữ liệu).
ipcMain.handle('lan:restart', () => { setTimeout(() => { appQuitting = true; app.relaunch({ args: [__dirname] }); try { app.releaseSingleInstanceLock(); } catch (e) { /* bỏ qua */ } app.quit(); setTimeout(() => { try { app.exit(0); } catch (e) { /* bỏ qua */ } }, 10000); /* PC 8.02: 10 giây vẫn chưa thoát → ép thoát (relaunch vẫn chạy) */ }, 400); return { ok: true }; });
process.on('unhandledRejection', (err) => { console.error('unhandledRejection:', err); logError('unhandledRejection', err); });
// MAC DINH: database nam trong app/database (canh code), giu dung hanh vi ban dau cua ung
// dung theo yeu cau cua nguoi dung. LUU Y rui ro da tung gap: neu giai nen ban cap nhat moi DE
// LEN cung thu muc cai dat, cac file Excel du lieu MAU dong kem trong ban zip cap nhat SE GHI
// DE len file dang chua du lieu that. Cach an toan khi cap nhat: sao luu (copy) toan bo thu
// muc app/database ra ngoai TRUOC khi giai nen de len, roi copy lai vao sau khi giai nen xong.

// ---------------------------------------------------------------------------
// GOP LAI DU LIEU TUNG BI DI CHUYEN RA userData (o mot ban truoc cua ung dung, nay da quay ve
// mac dinh app/database theo yeu cau nguoi dung) - CHI CHAY 1 LAN DUY NHAT cho moi may, de
// khong lam mat du lieu that nguoi dung da nhap trong khoang thoi gian dung ban "database nam
// ngoai app/database" do. Danh dau da gop xong bang 1 file rong dat trong chinh thu muc userData
// cu (khong dung app/database lam noi danh dau, vi thu muc do se bi ghi de moi lan giai nen ban
// cap nhat, khien migrate chay lai va GHI DE NHAM du lieu moi trong app/database bang du lieu cu
// dong bang trong userData).
function migrateDbDirBackToAppFolder() {
  const oldUserDataDbDir = path.join(app.getPath('userData'), 'database');
  const markerPath = path.join(oldUserDataDbDir, '.reverted-to-app-dir');
  if (fs.existsSync(markerPath)) return; // da gop 1 lan roi, khong lam lai

  if (fs.existsSync(oldUserDataDbDir)) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    let filesToCopy = [];
    try {
      filesToCopy = fs.readdirSync(oldUserDataDbDir).filter(f => f.toLowerCase().endsWith('.xlsx'));
    } catch (err) {
      console.error('Loi doc thu muc userData/database de gop lai:', err.message);
    }
    filesToCopy.forEach(fileName => {
      const src = path.join(oldUserDataDbDir, fileName);
      const dest = path.join(DB_DIR, fileName);
      // GHI DE app/database bang ban trong userData - vi trong khoang thoi gian dung ban truoc,
      // userData moi la noi chua du lieu THAT/moi nhat; ban trong app/database luc nay chi la
      // file mau/du lieu cu dong kem san trong file zip.
      try {
        fs.copyFileSync(src, dest);
      } catch (err) {
        console.error(`Loi gop file "${fileName}" tu userData ve app/database:`, err.message);
      }
    });
    try {
      fs.writeFileSync(markerPath, 'Da gop du lieu tu userData ve app/database vao ' + new Date().toISOString());
    } catch (err) {
      console.error('Loi ghi file danh dau da gop database:', err.message);
    }
  }

}

// ---------------------------------------------------------------------------
// DONG BO DIEN THOAI (Google Sheets lam cau noi, qua Apps Script Web App - KHONG dung Google
// Cloud Console / Service Account) - xem ghi chu dau file va sheets-webapp-client.js
// Cau hinh luu trong sheets-sync-config.json (canh main.js), giong nguyen tac bk2-config.json
// o tren - nguoi dung chinh qua Cai Dat -> tab "Dien Thoai", khong can sua code.
//
// LUONG DU LIEU (sua lai 09/2026):
//   Dien thoai --(Apps Script)--> tab PhieuXuat/PhieuXuatItems (trangThai = "Chưa xử lý")
//   PC keo ve (pullPhieuXuatVeLocal):
//     - Neu Module 02 DANG MO (iframe con song, da dang ky qua 'phone:import-phieu:register'):
//       GIAO cho chinh Module 02 nhap phieu (tru Số kiện/Trọng lượng trong "Dữ Liệu", luu Excel),
//       vi Module 02 giu toan bo danh sach phieu + Dữ Liệu trong bo nho va se GHI DE file Excel
//       o lan luu ke tiep — neu main.js tu ghi Excel luc nay thi phieu dien thoai se bi MAT.
//     - Neu Module 02 CHUA MO: main.js tu ghi thang vao Excel (ca 3 sheet trong 1 lan ghi).
//     - Danh dau "Đã xử lý" + "xuLyLuc" tren Sheet CHI SAU KHI da luu Excel thanh cong.
//   PC day len (pushTonKhoLenSheet) NGAY SAU khi keo ve, ghi tab "Meta" (lastPushAt) CUOI CUNG.
//   Ban dien thoai coi phieu "Đã xử lý" nhung xuLyLuc > lastPushAt la VAN DANG CHO (chua co
//   trong so ton vua day) — tranh bi cong lai so luong trong khoang giua 2 buoc tren.
// ---------------------------------------------------------------------------
const SHEETS_CONFIG_PATH = PATHS.cfgFile('sheets-sync-config.json');

// Bọc: có link cố định trong app-config.js thì LUÔN dùng link đó (ghi đè link cũ trong sheets-sync-config.json).
function loadSheetsConfig() {
  const c = loadSheetsConfigRaw();
  if (FIXED_WEBAPP_URL) c.webAppUrl = FIXED_WEBAPP_URL;
  if (FIXED_PC_TOKEN) c.pcToken = FIXED_PC_TOKEN;
  return c;
}
// ---------------------------------------------------------------------------
// PC 0.20 — MÃ HÓA MÃ TRUY CẬP TRÊN ĐĨA (hướng C): pcToken + phanQuyen[].token trong sheets-sync-config.json được mã hóa bằng
// Electron safeStorage (Windows: DPAPI — khóa gắn với TÀI KHOẢN WINDOWS trên MÁY NÀY). Trong bộ nhớ app vẫn là chữ thường, nên
// đăng nhập / xem mã / đẩy lên Sheet không đổi gì. Hệ quả: file cấu hình (kể cả bản sao lưu lên Drive) chép sang máy khác /
// tài khoản Windows khác thì KHÔNG giải mã được → máy đó coi như máy mới, kéo tài khoản từ Google Sheet (isFreshMachine).
// Giá trị không giải mã được giữ NGUYÊN chuỗi "enc1:…" (không bao giờ ghi đè thành rỗng) — xem isEncOpaque.
// Máy không có safeStorage (hiếm) → lưu như cũ (chữ thường), không lỗi.
// ---------------------------------------------------------------------------
const ENC_PREFIX = 'enc1:';
const canEncrypt = () => { try { return app.isReady() && safeStorage.isEncryptionAvailable(); } catch (e) { return false; } };
const isEncOpaque = (v) => typeof v === 'string' && v.startsWith(ENC_PREFIX);
function encSecret(v) {
  if (typeof v !== 'string' || !v || isEncOpaque(v) || !canEncrypt()) return v;
  try { return ENC_PREFIX + safeStorage.encryptString(v).toString('base64'); } catch (e) { return v; }
}
function decSecret(v) { // → { v, ok }: ok=false khi là chuỗi mã hóa mà máy này không giải được (giữ nguyên chuỗi)
  if (!isEncOpaque(v)) return { v, ok: true };
  if (!canEncrypt()) return { v, ok: false };
  try { return { v: safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64')), ok: true }; } catch (e) { return { v, ok: false }; }
}
// Giải mã TẠI CHỖ object cấu hình vừa đọc; trả true nếu giải được hết.
function decryptCfgSecrets(o) {
  let all = true;
  if (!o || typeof o !== 'object') return all;
  if ('pcToken' in o) { const r = decSecret(o.pcToken); o.pcToken = r.v; all = all && r.ok; }
  if (Array.isArray(o.phanQuyen)) o.phanQuyen.forEach((u) => { if (u && 'token' in u) { const r = decSecret(u.token); u.token = r.v; all = all && r.ok; } });
  return all;
}
// Bản sao đã mã hóa để GHI ra đĩa (không đụng object của nơi gọi).
function encryptCfgSecrets(cfg) {
  const o = structuredClone(cfg);
  if (typeof o.pcToken === 'string') o.pcToken = encSecret(o.pcToken);
  if (Array.isArray(o.phanQuyen)) o.phanQuyen = o.phanQuyen.map((u) => (u && typeof u.token === 'string') ? Object.assign({}, u, { token: encSecret(u.token) }) : u);
  return o;
}
const cfgHasPlainSecrets = (o) => !!o && ((typeof o.pcToken === 'string' && o.pcToken && !isEncOpaque(o.pcToken)) ||
  (Array.isArray(o.phanQuyen) && o.phanQuyen.some((u) => u && typeof u.token === 'string' && u.token && !isEncOpaque(u.token))));
let shCfgCache = null; // PC 0.19 — bộ đệm sheets-sync-config.json (xem loadSheetsConfigRaw)
function loadSheetsConfigRaw() {
  const defaults = {
    // Mac dinh TAT dong bo tu dong (0) — chi dong bo khi bam tay (yeu cau nguoi dung 09/2026).
    webAppUrl: '', pcToken: '', intervalMinutes: 0,
    // Cac bang duoc tick san cho nut "Đồng bộ ngay" (Cai Dat) — xem SYNC_TABLES.
    // Mac dinh KHONG tick bang nao (yeu cau nguoi dung 09/2026) — nguoi dung tu tick bang muon dong bo.
    // (M03/M04 tung bi khoa tren giao dien khi dien thoai an 2 kho nay — da mo lai 09/2026, tick nhu cac bang khac.)
    syncPick: { pull: false, M01: false, M01VT: false, M01VTB: false, M02: false, M03: false, M04: false, M08: false, LX: true, C3D: false },
    // Cau hinh tao moi da theo mac dinh moi -> danh dau san de khong chay lai cac buoc chuyen doi ben duoi.
    defaultsV2: true, defaultsV3: true,
    lastPushAt: null, lastPushOk: null, lastPushError: null,
    lastPullAt: null, lastPullOk: null, lastPullError: null,
  };
  try {
    // PC 0.19 — BỘ ĐỆM: file này bị đọc + phân tích lại ở ~40 chỗ (kể cả vòng kiểm tra quyền) → chỉ đọc lại khi file đổi
    // (khác thời điểm sửa / kích thước). Trả BẢN SAO để nơi gọi có sửa object cũng không làm bẩn bộ đệm.
    let st = null; try { st = fs.statSync(SHEETS_CONFIG_PATH); } catch (e) { st = null; }
    if (!st) { shCfgCache = null; return defaults; }
    if (shCfgCache && shCfgCache.mtimeMs === st.mtimeMs && shCfgCache.size === st.size) return structuredClone(shCfgCache.data);
    const raw = fs.readFileSync(SHEETS_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const allDecrypted = decryptCfgSecrets(parsed); // PC 0.20
    // Chuyen doi 1 lan: cau hinh tao tu ban cu (mac dinh tu dong 5 phut) -> doi sang TAT theo mac
    // dinh moi. Sau lan nay nguoi dung chon lai tan suat nao thi giu nguyen lua chon do.
    if (!parsed.defaultsV2) { parsed.intervalMinutes = 0; parsed.defaultsV2 = true; saveSheetsConfig({ ...defaults, ...parsed }); }
    // Chuyen doi 1 lan (09/2026): bo tick M03/M04 da luu tu ban cu (dien thoai khong dung nua). Sau lan nay
    // nguoi dung tick lai thi giu nguyen lua chon do.
    if (!parsed.defaultsV3) {
      parsed.syncPick = { ...(parsed.syncPick || {}), M03: false, M04: false };
      parsed.defaultsV3 = true;
      saveSheetsConfig({ ...defaults, ...parsed, syncPick: { ...defaults.syncPick, ...parsed.syncPick } });
    }
    const out = { ...defaults, ...parsed, syncPick: { ...defaults.syncPick, ...(parsed.syncPick || {}) } };
    // Chưa giải mã được (VD gọi trước khi app sẵn sàng) → không giữ bộ đệm, lần sau đọc lại.
    try { const st2 = fs.statSync(SHEETS_CONFIG_PATH); shCfgCache = allDecrypted ? { mtimeMs: st2.mtimeMs, size: st2.size, data: structuredClone(out) } : null; } catch (e) { shCfgCache = null; }
    return out;
  } catch (err) {
    console.error('Loi doc sheets-sync-config.json, dung cau hinh mac dinh:', err.message);
    return defaults;
  }
}

function saveSheetsConfig(cfg) {
  shCfgCache = null;
  // PC 0.19 — GHI AN TOÀN: ghi ra file tạm rồi đổi tên. Trước đây ghi thẳng: mất điện / treo máy giữa lúc ghi có thể làm
  // hỏng file → mất danh sách tài khoản. Đổi tên không được (antivirus / OneDrive đang giữ file) thì ghi thẳng như cũ.
  const data = JSON.stringify(encryptCfgSecrets(cfg), null, 2); // PC 0.20: mã truy cập mã hóa trên đĩa
  const tmp = SHEETS_CONFIG_PATH + '.tmp-ghi';
  try {
    fs.writeFileSync(tmp, data, 'utf8');
    try { fs.renameSync(tmp, SHEETS_CONFIG_PATH); }
    catch (e) { fs.writeFileSync(SHEETS_CONFIG_PATH, data, 'utf8'); try { fs.unlinkSync(tmp); } catch (e2) { /* bỏ qua */ } }
  } catch (err) {
    console.error('Loi ghi sheets-sync-config.json:', err.message);
  }
  shCfgCache = null;
  // Tài khoản / quyền có thể vừa đổi → kiểm tra ngay (thay cho vòng lặp 4 giây trước đây).
  setImmediate(() => { try { permWatch(false); } catch (e) { /* main.js chưa nạp xong */ } });
}

// Cap nhat 1 vai truong trang thai ma KHONG ghi de cac truong khac (doc lai file moi nhat truoc).
function patchSheetsConfig(patch) {
  const cfg = { ...loadSheetsConfig(), ...patch };
  saveSheetsConfig(cfg);
  return cfg;
}

// PC 7.56 — dấu (hash) của dữ liệu vừa đẩy, so với lần đẩy trước để cột "Trạng thái" biết CÓ DỮ LIỆU MỚI hay không.
const pushSig = (x) => require('crypto').createHash('sha1').update(JSON.stringify(x)).digest('hex');

function requireSheetsConfig() {
  const cfg = loadSheetsConfig();
  if (!cfg.webAppUrl || !cfg.pcToken) {
    throw new Error('Chưa nhập đường dẫn Web App hoặc mã PC_TOKEN trong Cài Đặt → Điện Thoại.');
  }
  return cfg;
}

const SH_TAB = {
  M01: 'TonKho_M01', M01_VITRI: 'TonKho_M01_ViTri', M01_VITRIBOT: 'TonKho_M01_ViTriBot', M02: 'TonKho_M02',
  M03: 'TonKho_M03', M03_LSX: 'DanhMuc_M03_LSX', M04: 'TonKho_M04',
  // Module 08 (Tổng Hợp) — CHỈ XEM trên điện thoại, tách nhiều tab nhỏ (1 ô Google Sheet tối đa
  // 50.000 ký tự, không nhét được cả khối JSON "State" như trong Excel).
  M08_MAHOA: 'M08_MaHoa', M08_MADATAO: 'M08_MaDaTao', M08_TONGHOP: 'M08_TongHop',
  M08_RADONG: 'M08_RaDong', M08_SIZE: 'M08_SizeLabel', M08_KS: 'M08_KhangSinh',
  // File Excel "Báo Cáo Tổng Tồn" + "Bảng Tổng Hợp HLSO" (Module 01) do chính Module 01 dựng sẵn,
  // cắt base64 thành nhiều ô — điện thoại chỉ tải về để lưu / chia sẻ (xem buildM01ReportPush()).
  PX_LUUTRU: 'PhieuXuat_LuuTru', PXI_LUUTRU: 'PhieuXuatItems_LuuTru', // phiếu cũ đã lưu trữ (maybeArchivePhieu)
  M01_BAOCAO: 'BaoCao_M01', M02_BAOCAO: 'BaoCao_M02', // M02 = "Bảng Tổng Hợp" (tab Báo Cáo của Module 02)
  LX: 'LichXuat_Cont', LX_THANG: 'LichXuat_Thang', // Lịch xuất nhập hàng (PC 7.31) — điện thoại XEM; từ PC 7.63 quản lý trở lên còn gửi yêu cầu thêm / chuyển lịch qua LX_YC
  LX_EM: 'LichXuat_Email', // hộp chờ duyệt email → lịch xuất (PC 8.22)
  C3D: 'C3D_Data', // Container Loading 3D (PC 8.61): cont đã sửa + phương án đã lưu → điện thoại XEM / mở (lệnh Web App c3dData)
  LX_YC: 'LichXuat_YeuCau', // hộp thư yêu cầu từ điện thoại (PC 7.63) — PC kéo về, xử lý, đánh dấu 'Đã xử lý'
  META: 'Meta', PX: 'PhieuXuat', PXI: 'PhieuXuatItems',
};
const TRANG_THAI_DA_XU_LY = 'Đã xử lý';
const TRANG_THAI_LOI_THIEU_DONG = 'Lỗi - không có dòng hàng';

// Ten cot sheet "DuLieuChinh" cua Module 02 — PHAI khop TARGET_COLS / PX_DAXUAT_DB_LABEL trong
// html/js/ton-kho-gui.js.
const M2COL = {
  maHang: 'Mã hàng', tenHang: 'Tên hàng', dacTinh: 'Đặc tính', soLo: 'Số lô', size: 'Size',
  quyCach: 'Quy cách', ngayNhapKho: 'Ngày nhập kho', phieuNhap: 'Phiếu nhập/Voucher',
  soKien: 'Số kiện', trongLuong: 'Trọng Lượng (KG)', daXuat: 'Đã trừ theo phiếu xuất',
};
const M2_PUSH_COLUMNS = [M2COL.maHang, M2COL.tenHang, M2COL.dacTinh, M2COL.soLo, M2COL.size,
  M2COL.quyCach, M2COL.ngayNhapKho, M2COL.phieuNhap, M2COL.soKien, M2COL.trongLuong];

// "Đặc tính" của Module 2 KHÔNG lấy thẳng cột trong Excel mà SUY RA như trên màn hình PC — BẢN CHÉP của
// lastCommaSegment() + matchManualDacTinhPrefix() + deriveDacTinhFromTenHang() trong
// html/js/ton-kho-gui.js (sửa công thức ở đó thì PHẢI sửa lại ở đây):
//   1) lấy phần sau dấu "," cuối của Tên hàng (VD "TÔM TCT BTP30, BLOCK, 1.8Kg x 5, 0046" → "0046");
//   2) tra bảng Đặc tính nhập tay (sheet DacTinh_NhapTay, cột "Đặc tính" dạng "<số>.<đặc tính>"): phần trước
//      dấu "." trùng (so cả dạng số, bỏ số 0 đầu: "0046" = "46") → lấy nguyên giá trị, VD "46.EU-H";
//   3) kết quả "CKQ" → dùng Số lô của dòng đó; nếu Số lô đó đã được chuyển tay (sheet DacTinh_ChuyenLo) → dùng đặc tính đã chuyển.
// Dùng khi đẩy TonKho_M02 lên Sheet để điện thoại hiện đúng Đặc tính như PC.
function m2WithDerivedDacTinh(rows) {
  let manual = [];
  try {
    manual = readSheet('module2', 'DacTinh_NhapTay')
      .map(r => String(r['Đặc tính'] ?? '').trim()).filter(Boolean)
      .map(dt => { const m = dt.match(/^([^.]+)\./); return m ? { prefix: m[1].trim(), dt } : null; })
      .filter(Boolean);
  } catch (err) { console.error('Loi doc DacTinh_NhapTay (Module 2):', err.message); }
  // Số lô đã chuyển tay sang đặc tính thật (sheet DacTinh_ChuyenLo, cột "Số lô" / "Đặc tính")
  const loMap = {};
  try {
    readSheet('module2', 'DacTinh_ChuyenLo').forEach(r => {
      const lo = String(r['Số lô'] ?? '').trim().toLowerCase();
      const dt = String(r['Đặc tính'] ?? '').trim();
      if (lo && dt) loMap[lo] = dt;
    });
  } catch (err) { console.error('Loi doc DacTinh_ChuyenLo (Module 2):', err.message); }
  const lastSeg = (ten) => {
    const t = String(ten ?? '').trim();
    if (!t) return '';
    if (!t.includes(',')) return t;
    const parts = t.split(',');
    return parts[parts.length - 1].trim();
  };
  const matchPrefix = (v) => {
    const vTrim = String(v).trim();
    if (!vTrim) return null;
    const vNum = /^\d+$/.test(vTrim) ? String(parseInt(vTrim, 10)) : null;
    for (const r of manual) {
      if (r.prefix === vTrim) return r.dt;
      if (vNum !== null && /^\d+$/.test(r.prefix) && String(parseInt(r.prefix, 10)) === vNum) return r.dt;
    }
    return null;
  };
  return rows.map(r => {
    const seg = lastSeg(r[M2COL.tenHang]);
    if (!seg) return r;
    let dt = matchPrefix(seg) || seg;
    if (dt === 'CKQ') {
      const lo = String(r[M2COL.soLo] ?? '').trim();
      dt = (lo && loMap[lo.toLowerCase()]) || lo;   // đã chuyển tay Số lô -> Đặc tính thì dùng đặc tính đó
    }
    return dt ? { ...r, [M2COL.dacTinh]: dt } : r;
  });
}

function syncToNumber(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
// Khoa khop 1 lo hang — GIONG pxRowMatchKey() trong ton-kho-gui.js va ham matchKey()
// trong ban-dien-thoai/apps-script/Code.gs.
function syncMatchKey(maHang, soLo, size, phieuNhap) {
  return [maHang, soLo, size, phieuNhap].map(v => String(v ?? '').trim()).join('|');
}
// Google Sheets co the tra ve ngay dang so serial neu o bi tu dinh dang thanh ngay.
function sheetValueToIso(v) {
  if (typeof v === 'number' && isFinite(v)) {
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString();
  }
  const s = String(v || '').trim();
  return s || new Date().toISOString();
}

// Module 1 luu LoadData voi ten cot trung tinh c0, c1... (ten cot that nam trong LoadDataMeta).
// Doi lai ve ten cot that de dien thoai doc duoc; ten trong/trung thi danh so de khong de nhau.
function readModule1LoadDataLabeled() {
  let headers = [];
  let fileName = '';
  let importedAt = null;
  let dataDate = '';
  try {
    const metaRows = readSheet('module1', 'LoadDataMeta');
    const cell = metaRows[0] && metaRows[0].data;
    if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
      const meta = JSON.parse(cell.slice('__JSON__'.length));
      headers = Array.isArray(meta.headers) ? meta.headers : [];
      fileName = meta.fileName || '';
      importedAt = meta.importedAt || null;
      dataDate = meta.dataDate || '';
    }
  } catch (err) {
    console.error('Loi doc LoadDataMeta (Module 1):', err.message);
  }
  const used = new Set();
  const columns = headers.map((h, i) => {
    let name = String(h ?? '').trim() || `Cột ${i + 1}`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
    }
    used.add(name);
    return name;
  });
  // "_key"/"_row": dinh danh 1 dong Load Data de dien thoai tao phieu xuat Module 01 — uu tien
  // cot "Item ID" (khong doi khi nap lai file), khong co thi dung so thu tu dong ("r:<i>").
  const itemIdIdx = headers.findIndex(h => m1FuzzyNorm(h) === 'item id');
  const rows = readSheet('module1', 'LoadData').map((o, i) => {
    const r = {};
    columns.forEach((c, j) => { r[c] = o['c' + j] ?? ''; });
    const itemId = itemIdIdx >= 0 ? String(o['c' + itemIdIdx] ?? '').trim() : '';
    r._key = itemId ? 'id:' + itemId : 'r:' + i;
    r._row = i;
    return r;
  });
  return { columns: columns.concat(['_key', '_row']), rows, fileName, importedAt, dataDate, headers, itemIdIdx };
}

// GIONG fuzzyNormalize() / parseLooseNumber() trong html/js/ton-kho-an-an.js (Module 1).
function m1FuzzyNorm(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[.,()\/\\\-_:;]/g, ' ').replace(/\s+/g, ' ').trim();
}
function m1LooseNumber(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (s === '') return NaN;
  s = s.replace(/[\u00A0\s]/g, '');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^-?\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const m = s.match(/^-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

// Khoa dinh danh 1 dong "Tồn theo vị trí" (Module 1, sheet ViTri): Mã hàng|Lô|Vị trí#<thu tu neu
// trung>. Dong khong co Mã hàng khong co khoa (Module 1 cung bo qua cac dong nay). GIONG
// vtPhoneKeys() trong html/js/ton-kho-an-an.js.
function vtRowKeys(list, getMa, getLo, getVt) {
  const seen = new Map();
  return list.map(r => {
    const ma = String(getMa(r) ?? '').trim();
    if (!ma) return '';
    const base = [ma, String(getLo(r) ?? '').trim(), String(getVt(r) ?? '').trim()].join('|');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return base + '#' + n;
  });
}
const VT_LBL = { ma: 'Mã hàng', ten: 'Tên hàng', dvt: 'ĐVT', lo: 'Lô (Batch)', vt: 'Vị trí', sl: 'SL Tồn', tl: 'T.Lượng' };

// ---- "Vị Trí Bột" (Module 1, sheet ViTriBot — cột lưu đúng tên cột file mẫu, xem VITRIBOT_STORE_KEYS
// trong html/js/ton-kho-an-an.js). Khoa 1 dong: Mã hàng|Vị trí|NSX|HSD#<thu tu neu trung>; dong khong co
// ca Mã hàng lan Vị trí thi khong co khoa. GIONG vtbPhoneKeys() trong ton-kho-an-an.js va cot "_key" ma
// Code.gs (buildItemsVTB_) dung de kiem tra phieu. Sua 1 noi thi sua ca 3 noi.
const VTB_STORE = { vt: 'VT', ma: 'MÃ HÀNG', sl: 'SL', nsx: 'NSX', hsd: 'HSD', nhap: 'NHẬP', ghiChu: 'GHI CHÚ', vtMoi: 'VỊ TRÍ MỚI' };
// Ten cot khi DAY len tab TonKho_M01_ViTriBot (dien thoai + Code.gs doc theo ten nay).
// "Vị trí mới" (hàng đang chuyển) chỉ để XEM trên điện thoại — không nằm trong khóa dòng.
const VTB_PUSH = { vt: 'Vị trí', ma: 'Mã hàng', sl: 'SL', nsx: 'NSX', hsd: 'HSD', nhap: 'Nhập', ghiChu: 'Ghi chú', vtMoi: 'Vị trí mới' };
function vtbRowKeys(list) {
  const seen = new Map();
  const t = v => String(v ?? '').trim();
  return list.map(r => {
    const ma = t(r[VTB_STORE.ma]), vt = t(r[VTB_STORE.vt]);
    if (!ma && !vt) return '';
    const base = [ma, vt, t(r[VTB_STORE.nsx]), t(r[VTB_STORE.hsd])].join('|');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return base + '#' + n;
  });
}
// Dong du lieu "Vị Trí Bột" hop le = co Mã hàng hoac Vị trí (giong restoreViTriBot() loc r.vt || r.ma).
function readViTriBotRows(sheetRows) {
  return (sheetRows || []).filter(r => String(r[VTB_STORE.ma] ?? '').trim() || String(r[VTB_STORE.vt] ?? '').trim());
}

// CHI cac tab can cho dung cac bang dang dong bo (+ Meta + 2 tab phieu) — khong dong toi tab cua
// bang khong duoc chon (Apps Script ban cu chua biet tab M03/M04 van dong bo duoc cac bang khac).
function allSyncTabs(tables) {
  const tabs = {
    [SH_TAB.META]: null,
    [SH_TAB.PX]: sheetsSync.PHIEU_HEADERS, [SH_TAB.PXI]: sheetsSync.PHIEU_ITEM_HEADERS,
  };
  // BaoCao_M01 KHÔNG nằm ở đây: pc.writeTable tự tạo tab; Code.gs bản cũ chưa biết tab này thì chỉ riêng
  // phần báo cáo lỗi (ghi vào Meta m01BaoCaoLoi), không làm hỏng cả lần đồng bộ.
  const TAB_OF = { M01: [SH_TAB.M01], M01VT: [SH_TAB.M01_VITRI], M01VTB: [SH_TAB.M01_VITRIBOT], M02: [SH_TAB.M02], M03: [SH_TAB.M03, SH_TAB.M03_LSX], M04: [SH_TAB.M04],
    M08: [SH_TAB.M08_MAHOA, SH_TAB.M08_MADATAO, SH_TAB.M08_TONGHOP, SH_TAB.M08_RADONG, SH_TAB.M08_SIZE, SH_TAB.M08_KS],
    LX: [SH_TAB.LX, SH_TAB.LX_THANG], C3D: [SH_TAB.C3D] };
  (tables || []).forEach(t => (TAB_OF[t] || []).forEach(name => { tabs[name] = null; }));
  return tabs;
}

// DAY (push) tồn kho Module 01 (bang chinh + Ton theo vi tri) va Module 02 (Dữ Liệu, DA tru
// phieu xuat) len Google Sheet. Module 03/04 CHUA duoc day — xem README.md.
// ===========================================================================================
// MODULE 03 (NXT Bot/Sot) va MODULE 04 (NXT - TNK/TGC) — 2 module nay KHONG co bang "ton" luu san:
// ton duoc TINH tu lich su nhap/xuat. Cac ham duoi day chep dung cong thuc cua tung module (sua
// cong thuc o module nao thi PHAI sua ca o day cho khop):
//   - Module 03: computeLots() trong html/js/nxt-bot-sot.js — moi lo = 1 phieu nhap (hoac chuyen
//     vao), xuat/chuyen di tru FIFO theo khoa LSX|Loai hang|Vi tri. Dien thoai xuat theo LO
//     (giong bang "Chon hang xuat" tren PC), bat buoc chon "LSX xuat" nhu form PC.
//   - Module 04: getExportRowsByLocation() trong html/js/nxt-hang-nhap-khau.js — moi dong = 1 lo
//     nhap x 1 vi tri, ton = SL tai vi tri − da xuat tu dung vi tri do.
// ===========================================================================================
const M3COL = {
  maPhieu: 'Mã phiếu', ngay: 'Ngày nhập', viTri: 'Vị trí', loaiHang: 'Loại Hàng', maHang: 'Mã Hàng',
  lsx: 'LSX / Hợp đồng', khach: 'Khách hàng', net: 'Trọng lượng (kg)', kien: 'Kiện/Bao', tong: 'Tổng (kg)', ghiChu: 'Ghi chú',
};
const M4COL = {
  ngay: 'Ngày nhập', type: 'Loại hàng', supplier: 'Nhà cung cấp', inv: 'INV', po: 'TP/PO', code: 'Mã hàng',
  dacTinh: 'Đặc tính', size: 'Size', weight: 'Trọng lượng', viTri: 'Vị trí', ton: 'SL tồn', net: 'Net (kg)', note: 'Ghi chú',
};
const m3Str = (v) => (v == null ? '' : String(v));
const m3NumOrNull = (v) => (v === '' || v == null ? null : Number(v));

function m3ParseState(sj) {
  const flour = new Map(sj('FlourCodes').map(r => [m3Str(r.id), m3Str(r.name)]));
  const loc = new Map(sj('Locations').map(r => [m3Str(r.id), m3Str(r.name)]));
  const lsx = sj('LSX').map(r => ({ id: m3Str(r.id), code: m3Str(r.code), name: m3Str(r.name), khachHang: m3Str(r.khachHang) }));
  const tx = sj('Transactions').map(r => ({
    id: m3Str(r.id), maPhieu: m3Str(r.maPhieu), type: m3Str(r.type), date: m3Str(r.date),
    lsxId: m3Str(r.lsxId), lsxToId: m3Str(r.lsxToId), flourId: m3Str(r.flourId), qty: Number(r.qty) || 0,
    locId: m3Str(r.locId), locToId: m3Str(r.locToId), note: m3Str(r.note), createdAt: Number(r.createdAt) || 0,
    loaiHang: m3Str(r.loaiHang), net: m3NumOrNull(r.net), soLuong: m3NumOrNull(r.soLuong),
    khachHang: m3Str(r.khachHang), hsdThang: m3NumOrNull(r.hsdThang), ngaySX: m3Str(r.ngaySX),
  }));
  return { flour, loc, lsx, lsxById: new Map(lsx.map(l => [l.id, l])), tx };
}

// GIONG computeLots() (Module 03) — chi giu cac truong can cho dien thoai.
function m3ComputeLots(st) {
  const key = (l, f, lo) => l + '|' + f + '|' + lo;
  const lots = [];
  st.tx.forEach(t => {
    if (t.type === 'nhap') {
      lots.push({ lotId: t.id, maPhieu: t.maPhieu, date: t.date, createdAt: t.createdAt, lsxId: t.lsxId, flourId: t.flourId,
        locId: t.locId, loaiHang: t.loaiHang, net: t.net, khachHang: t.khachHang, soLuong: t.soLuong, note: t.note, remaining: t.qty });
    } else if (t.type === 'chuyen') {
      lots.push({ lotId: t.id + '-in', maPhieu: t.maPhieu, date: t.date, createdAt: t.createdAt, lsxId: t.lsxToId, flourId: t.flourId,
        locId: t.locToId || t.locId, loaiHang: t.loaiHang || null, net: t.net || null, khachHang: t.khachHang || null,
        soLuong: t.soLuong || null, note: 'Hàng chuyển từ LSX ' + ((st.lsxById.get(t.lsxId) || {}).code || '?') + ' qua' + (t.note ? ' — ' + t.note : ''),
        remaining: t.qty });
    }
  });
  const groups = new Map();
  lots.forEach(l => { const k = key(l.lsxId, l.flourId, l.locId); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
  groups.forEach(arr => arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt)));
  const consumption = new Map();
  st.tx.forEach(t => {
    if (t.type === 'xuat' || t.type === 'chuyen') {
      const k = key(t.lsxId, t.flourId, t.locId);
      consumption.set(k, (consumption.get(k) || 0) + t.qty);
    }
  });
  groups.forEach((arr, k) => {
    let toConsume = consumption.get(k) || 0;
    for (const lot of arr) {
      if (toConsume <= 0.0001) break;
      const take = Math.min(lot.remaining, toConsume);
      lot.remaining -= take;
      toConsume -= take;
    }
  });
  groups.forEach(arr => arr.forEach(l => { if (l.net) l.soLuong = Number((l.remaining / l.net).toFixed(2)); }));
  const result = [];
  groups.forEach(arr => arr.forEach(l => { if (l.remaining > 0.0001) result.push(l); }));
  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

function m3SheetsFromDisk() {
  return (n) => readSheet('module3', n);
}

function buildM03PushRows() {
  const st = m3ParseState(m3SheetsFromDisk());
  const rows = m3ComputeLots(st).map(l => {
    const lsx = st.lsxById.get(l.lsxId) || {};
    return {
      [M3COL.maPhieu]: l.maPhieu, [M3COL.ngay]: l.date, [M3COL.viTri]: st.loc.get(l.locId) || '',
      [M3COL.loaiHang]: st.flour.get(l.flourId) || '', [M3COL.maHang]: l.loaiHang || '',
      [M3COL.lsx]: lsx.code || '', [M3COL.khach]: l.khachHang || lsx.khachHang || '',
      [M3COL.net]: l.net == null ? '' : l.net, [M3COL.kien]: l.soLuong == null ? '' : l.soLuong,
      [M3COL.tong]: Number(l.remaining.toFixed(4)), [M3COL.ghiChu]: l.note || '',
      _key: l.lotId,
    };
  });
  const lsxRows = st.lsx.map(l => ({ id: l.id, code: l.code, name: l.name, khachHang: l.khachHang }));
  return { rows, columns: Object.values(M3COL).concat(['_key']), lsxRows };
}

// ---- Module 04 ----
const M4_SHEETS = { records: 'nhaphang_data', exports: 'xuathang_data', locations: 'vitri_data', history: 'lichsu_data' };
function m4Restore(row) {
  const out = {};
  Object.keys(row || {}).forEach(k => {
    const v = row[k];
    if (typeof v === 'string' && v.startsWith('__JSON__')) { try { out[k] = JSON.parse(v.slice(8)); } catch (e) { out[k] = v; } }
    else out[k] = v;
  });
  return out;
}
function m4Flatten(item) {
  const flat = {};
  Object.keys(item).forEach(k => { const v = item[k]; flat[k] = (v !== null && typeof v === 'object') ? '__JSON__' + JSON.stringify(v) : v; });
  return flat;
}
// GIONG getExportRowsByLocation() (Module 04): moi lo nhap x vi tri con ton > 0.
function m4ComputeRows(records, exportsArr, locations) {
  const locMapOf = new Map();
  locations.forEach(lr => {
    const id = m3Str(lr.importId);
    if (!locMapOf.has(id)) locMapOf.set(id, {});
    const m = locMapOf.get(id);
    m[lr.location] = (m[lr.location] || 0) + Number(lr.qty);
  });
  const exported = new Map(); // importId -> tong, "importId::loc" -> tai vi tri
  exportsArr.forEach(e => {
    const id = m3Str(e.importId);
    exported.set(id, (exported.get(id) || 0) + Number(e.qty));
    const k = id + '::' + (e.location || '');
    exported.set(k, (exported.get(k) || 0) + Number(e.qty));
  });
  const out = [];
  records.forEach(r => {
    const id = m3Str(r.id);
    const locEntries = Object.entries(locMapOf.get(id) || {});
    if (!locEntries.length) {
      const remaining = Number(r.qty) - (exported.get(id) || 0);
      if (remaining > 0) out.push({ record: r, location: '', remaining, key: id + '::' });
    } else {
      locEntries.forEach(([location, locationQty]) => {
        const remaining = Number(locationQty) - (exported.get(id + '::' + location) || 0);
        if (remaining > 0) out.push({ record: r, location, remaining, key: id + '::' + location });
      });
    }
  });
  return out;
}
function buildM04PushRows() {
  const rd = (n) => readSheet('module4', n).map(m4Restore);
  const rows = m4ComputeRows(rd(M4_SHEETS.records), rd(M4_SHEETS.exports), rd(M4_SHEETS.locations)).map(({ record: r, location, remaining, key }) => ({
    [M4COL.ngay]: r.ngayNhap || '', [M4COL.type]: r.type || '', [M4COL.supplier]: r.supplier || '', [M4COL.inv]: r.inv || '',
    [M4COL.po]: r.po || '', [M4COL.code]: r.code || '', [M4COL.dacTinh]: r.dacTinh || '', [M4COL.size]: r.size || '',
    [M4COL.weight]: Number(r.weight) || 0, [M4COL.viTri]: location, [M4COL.ton]: remaining,
    [M4COL.net]: Number(((Number(r.weight) || 0) * remaining).toFixed(3)), [M4COL.note]: r.note || '', _key: key,
  }));
  return { rows, columns: Object.values(M4COL).concat(['_key']) };
}

// Ngay (yyyy-mm-dd, gio may PC) tu 1 moc ISO — Module 03/04 luu ngay theo dang nay.
function isoDateLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  const x = isNaN(d.getTime()) ? new Date() : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function phoneNote(ph) {
  return '📱 ' + [ph.nguoiTao, ph.maPhieu].filter(Boolean).join(' — ') + (ph.ghiChu ? ' | ' + ph.ghiChu : '');
}

// Module 03 CHUA MO: ghi thang phieu xuat (Transactions + Log) — GIONG nut "Xác nhận xuất" o form
// "Xuất sử dụng": moi dong = 1 giao dich type 'xuat' (so kg), ma phieu PX_nn tang tiep.
function applyPhonePhieuM3DirectToExcel(list) {
  const dbPath = resolveDbPath('module3');
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'Chưa có database Module 03.' };
  const wb = XLSX.readFile(dbPath);
  const sj = (n) => sheetRows(wb.Sheets[n]);
  const txRows = sj('Transactions');
  const logRows = sj('Log');
  const st = m3ParseState(sj);
  const importedIds = [];
  let newCount = 0;
  let seq = txRows.reduce((m, t) => { const x = /^PX_(\d+)$/.exec(m3Str(t.maPhieu)); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  const already = new Set(txRows.map(t => m3Str(t.phoneId)).filter(Boolean));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  for (const ph of list) {
    if (already.has(ph.id)) { importedIds.push(ph.id); continue; }
    const lots = m3ComputeLots(st);
    const byId = new Map(lots.map(l => [l.lotId, l]));
    const want = new Map();
    let bad = '';
    ph.items.forEach(it => {
      const l = byId.get(String(it.itemKey || ''));
      if (!l) { bad = bad || 'không còn lô ' + it.itemKey; return; }
      want.set(l.lotId, (want.get(l.lotId) || 0) + syncToNumber(it.soLuongXuat));
    });
    want.forEach((q, id) => { if (q > byId.get(id).remaining + 0.0001) bad = bad || 'vượt tồn lô ' + byId.get(id).maPhieu; });
    if (bad) { console.error('Phieu dien thoai Module 03 bo qua:', ph.id, bad); continue; }
    const date = isoDateLocal(ph.ngayTao);
    const note = phoneNote(ph);
    want.forEach((qty, lotId) => {
      const l = byId.get(lotId);
      const t = {
        id: uid(), maPhieu: 'PX_' + String(++seq).padStart(2, '0'), type: 'xuat', date, lsxId: l.lsxId, lsxToId: '',
        flourId: l.flourId, qty, locId: l.locId, locToId: '', note, createdAt: Date.now(), loaiHang: l.loaiHang || '',
        net: '', soLuong: '', khachHang: '', hsdThang: '', dinhMuc: '', dinhMucBao: '', ngaySX: '', lsxXuatId: ph.lsxXuat || '',
        phoneId: ph.id,
      };
      txRows.push(t);
      st.tx.push({ ...t, qty: Number(qty) });
      logRows.push({ id: uid(), type: 'xuat', at: Date.now(), date, lsxId: l.lsxId, lsxToId: '', flourId: l.flourId,
        locId: l.locId, locToId: '', qty, note, maPhieu: t.maPhieu });
    });
    importedIds.push(ph.id);
    newCount++;
  }
  if (newCount) {
    const setSheet = (name, data) => {
      const ws = rowsToSheet(data);
      if (wb.Sheets[name]) { delete wb.Sheets[name]; wb.SheetNames = wb.SheetNames.filter(n => n !== name); }
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    setSheet('Transactions', txRows);
    setSheet('Log', logRows);
    saveWorkbook(wb, dbPath);
  }
  return { ok: true, importedIds, newCount };
}

// Module 04 CHUA MO: them dong vao "xuathang_data" — GIONG nut "Xác nhận xuất" (moi lo x vi tri
// 1 dong) + 1 dong lich su.
function applyPhonePhieuM4DirectToExcel(list) {
  const dbPath = resolveDbPath('module4');
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'Chưa có database Module 04.' };
  const wb = XLSX.readFile(dbPath);
  const sj = (n) => sheetRows(wb.Sheets[n]).map(m4Restore);
  const records = sj(M4_SHEETS.records);
  const exportsArr = sj(M4_SHEETS.exports);
  const locations = sj(M4_SHEETS.locations);
  const history = sj(M4_SHEETS.history);
  const importedIds = [];
  let newCount = 0;
  const already = new Set(exportsArr.map(e => m3Str(e.phoneId)).filter(Boolean));
  const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  for (const ph of list) {
    if (already.has(ph.id)) { importedIds.push(ph.id); continue; }
    const byKey = new Map(m4ComputeRows(records, exportsArr, locations).map(x => [x.key, x]));
    const want = new Map();
    let bad = '';
    ph.items.forEach(it => {
      const k = String(it.itemKey || '');
      if (!byKey.has(k)) { bad = bad || 'không còn dòng ' + k; return; }
      want.set(k, (want.get(k) || 0) + syncToNumber(it.soLuongXuat));
    });
    want.forEach((q, k) => { if (q > byKey.get(k).remaining + 1e-9) bad = bad || 'vượt tồn ' + byKey.get(k).record.code; });
    if (bad) { console.error('Phieu dien thoai Module 04 bo qua:', ph.id, bad); continue; }
    const ngayXuat = isoDateLocal(ph.ngayTao);
    const note = phoneNote(ph);
    const toExport = [];
    want.forEach((qty, k) => {
      const { record: s, location } = byKey.get(k);
      toExport.push({ importId: s.id, location, ngayXuat, type: s.type, supplier: s.supplier, inv: s.inv, po: s.po,
        code: s.code, size: s.size, weight: s.weight, qty, note, dacTinh: s.dacTinh, phoneId: ph.id });
    });
    exportsArr.push(...toExport);
    const total = toExport.reduce((a, x) => a + x.qty, 0);
    history.unshift({ id: gid(), time: new Date().toISOString(), module: 'Xuất hàng', action: 'xuat',
      summary: `📱 Điện thoại xuất ${toExport.length} mặt hàng, tổng SL ${total}`, details: toExport });
    importedIds.push(ph.id);
    newCount++;
  }
  if (newCount) {
    const setSheet = (name, data) => {
      const ws = rowsToSheet(data.map(m4Flatten));
      if (wb.Sheets[name]) { delete wb.Sheets[name]; wb.SheetNames = wb.SheetNames.filter(n => n !== name); }
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    setSheet(M4_SHEETS.exports, exportsArr);
    setSheet(M4_SHEETS.history, history);
    saveWorkbook(wb, dbPath);
  }
  return { ok: true, importedIds, newCount };
}

// Cac bang ton kho co the day len (ma dung chung voi cot "module" cua phieu xuat dien thoai).
const SYNC_TABLES = ['M01', 'M01VT', 'M01VTB', 'M02', 'M03', 'M04', 'M08', 'LX', 'C3D']; // LX = Lịch xuất nhập hàng (PC 7.31)

// Module 08: doc khoi JSON "State" (segmentData / generatedResults / tab2Data / tab3Data — xem
// saveState() trong html/js/tong-hop.js) + 2 sheet rieng (KhangSinh, Tab3_SizeLabel_DaGhiNhan).
async function buildM08Push() {
  let st = {};
  try {
    // Dạng mới: nhiều sheet (MaHoa, MaDaTao, TongHop, RaDong…); chưa chuyển thì đọc sheet "State" cũ.
    st = (await m8Store.decode(name => readSheet('module8', name)))
      || m8Store.decodeOld(readSheet('module8', m8Store.SHEETS.old)) || {};
  } catch (err) { console.error('Loi doc database Module 8:', err.message); }
  const seg = st.segmentData || {};
  const maHoa = [];
  Object.keys(seg).sort((a, b) => Number(a) - Number(b)).forEach(k => {
    (seg[k] || []).forEach(e => maHoa.push({ seg: Number(k), code: e.code ?? '', name: e.name ?? '' }));
  });
  const maDaTao = (st.generatedResults || []).map((r, i) => ({ stt: r.stt ?? i + 1, code: r.code ?? '', note: r.note ?? '' }));
  const tab2 = st.tab2Data || { headers: [], rows: [] };
  const tab3 = st.tab3Data || { headers: [], rows: [] };
  const clean = (v) => (v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
  const tableOf = (t, extra) => {
    const cols = (t.headers || []).map(String).concat(extra || []);
    return { cols, rows: (t.rows || []).map(r => { const o = {}; cols.forEach(c => { o[c] = clean(r[c]); }); return o; }) };
  };
  return {
    maHoa, maDaTao,
    tongHop: tableOf(tab2), raDong: tableOf(tab3, ['__code']),
    tab2Meta: { codeCol: tab2.codeCol || '', dateCol: tab2.dateCol || '' },
    tab3Meta: { codeCol: tab3.codeCol || '' },
    size: readSheet('module8', 'Tab3_SizeLabel_DaGhiNhan').map(r => ({ code: String(r['Mã Size'] ?? ''), label: String(r['Nhãn hiển thị'] ?? '') })),
  };
}

// ===========================================================================================
// KHÁNG SINH → ĐIỆN THOẠI, "CHỈ PHẦN MỚI" (PC 5.0)
// Mỗi lần đẩy M08 chỉ gửi dòng MỚI / ĐÃ ĐỔI / ĐÃ XOÁ so với lần gửi trước (so dấu nội dung, xem ksHash); lần đầu
// (chưa có _ks-push-state.json / đổi KS_FORMAT) gửi CẢ bảng (full) theo đợt 2.000 dòng. Gửi bản RÚT GỌN (ksCompact) — điện thoại chỉ cần ngày, lô, mã, kết quả, đặt tính, 7 chỉ
// tiêu, các lần kiểm lại; dữ liệu đầy đủ vẫn ở PC.
// ===========================================================================================
const KS_FORMAT = 1;
const KS_AB = ['enro', 'cipro', 'oxy', 'doxy', 'sulfo', 'aoz', 'cap'];
function ksCompact(key, value) {
  if (!String(key).startsWith('s:batch:')) return typeof value === 'string' ? value : JSON.stringify(value ?? '');
  let r; try { r = typeof value === 'string' ? JSON.parse(value) : value; } catch (e) { return typeof value === 'string' ? value : ''; }
  if (!r || typeof r !== 'object') return '';
  const inp = r.inputs || {};
  const L = (r.lan2All && r.lan2All.length ? r.lan2All : (r.lan2 ? [r.lan2] : []))
    .map(l => [l.date || '', l.dat || '', l.kyhieu || '', l.ghichu || '', l.so || '', l.stt || '', l.mau || '', l.group || '']);
  const o = { d: r.date || '', b: r.batch || '', n: r.note || '', r: r.dat || '', k: r.kyhieu || '', i: KS_AB.map(f => inp[f] == null ? '' : String(inp[f])), s: r.savedAt || '' };
  if (L.length) o.L = L;
  if (r.lan1Src && r.lan1Src.ngayKiem) o.nk = r.lan1Src.ngayKiem;
  if (r.mota) o.m = String(r.mota).slice(0, 200);
  return '~' + JSON.stringify(o); // "~" = dạng rút gọn (điện thoại tự mở rộng)
}
// Biết dòng nào đã gửi bằng DẤU NỘI DUNG (không dựa vào đồng hồ máy — máy con LAN có thể lệch giờ): file
// database/_ks-push-state.json = { format, hashes: { key: dấu của bản rút gọn đã gửi } }. Dòng có dấu khác / mới → gửi;
// key đã gửi mà nay không còn → gửi lệnh xoá. Mốc thời gian u do APPS SCRIPT gán (giờ máy chủ Google, luôn tăng).
function ksHash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + str.length; }
function ksPushStatePath() { return path.join(DB_DIR, '_ks-push-state.json'); }
async function pushKhangSinhIncremental(cfg) {
  const rows = readSheet('module8', 'KhangSinh').filter(r => r.key !== undefined && r.key !== null && r.key !== '');
  let st = null;
  try { st = JSON.parse(fs.readFileSync(ksPushStatePath(), 'utf8')); } catch (e) { st = null; }
  const full = !st || st.format !== KS_FORMAT || !st.hashes;
  const prev = full ? {} : st.hashes;
  const hashes = {}, send = [];
  rows.forEach(r => {
    const k = String(r.key), v = ksCompact(k, r.value), h = ksHash(v);
    hashes[k] = h;
    if (full || prev[k] !== h) send.push([k, '', v]);
  });
  const dels = full ? [] : Object.keys(prev).filter(k => !(k in hashes)).map(k => [k, '']);
  if (!send.length && !dels.length) return { sent: 0, deleted: 0, full };
  const CH = 2000;
  try {
    for (let i = 0; i < Math.max(send.length, 1); i += CH) {
      await sheetsSync.call(cfg, 'pc.ksUpsert', { rows: send.slice(i, i + CH), dels: i === 0 ? dels : [], full: full && i === 0 }, 300000);
    }
  } catch (err) {
    // Apps Script CŨ (chưa có pc.ksUpsert) → đẩy cả bảng theo kiểu cũ (key, value) để điện thoại bản cũ vẫn xem được;
    // KHÔNG lưu dấu → khi Code.gs mới được dán, lần đẩy sau tự gửi đầy đủ theo kiểu mới.
    if (!/Không có chức năng|bản cũ/.test(err.message || '')) throw err;
    const clean = (v) => (v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M08_KS, ['key', 'value'], rows.map(r => ({ key: String(r.key), value: clean(r.value) })));
    try { fs.unlinkSync(ksPushStatePath()); } catch (e) { /* không có */ }
    return { sent: rows.length, deleted: 0, full: true, legacy: true };
  }
  try { fs.writeFileSync(ksPushStatePath(), JSON.stringify({ format: KS_FORMAT, at: new Date().toISOString(), hashes })); }
  catch (e) { console.error('Lỗi ghi _ks-push-state.json:', e.message); }
  return { sent: send.length, deleted: dels.length, full };
}


// ===========================================================================================
// TÌM TRONG TOÀN KHO (ô tìm kiếm trang chính — html/js/global-search.js), 09/2026.
// Gom tồn kho HIỆN TẠI của Module 1–4 thành 1 danh sách dòng cùng khuôn:
//   { m, src, vt, ma, ten, size, tag, hd, dt, ton, kg, lo, extra }
// Dùng LẠI đúng các hàm đọc/tính tồn của phần đẩy tồn lên điện thoại (không chép công thức lần nữa):
//   - Module 1: sheet ViTri ("Tồn theo vị trí": 1 dòng / Mã hàng × Lô × Vị trí, SL = "SL Tồn", KG = SL × T.Lượng,
//     Đặc tính/Hợp đồng tách từ Tên hàng như vtSplitName). Mã có trong Load Data mà KHÔNG có ở ViTri thì lấy dòng
//     Load Data (Tồn cuối, KG = Tồn cuối × Trọng lượng, không có vị trí) — không cộng 2 nguồn cho cùng 1 mã (tránh
//     tính trùng). Thêm các dòng "Vị Trí Bột" (sheet ViTriBot, không có KG).
//   - Module 2: m2WithDerivedDacTinh(DuLieuChinh) — Số kiện / Trọng Lượng (KG), không có vị trí.
//   - Module 3: buildM03PushRows() — lô còn tồn (FIFO), KG = "Tổng (kg)", Tồn = "Kiện/Bao" nếu có.
//   - Module 4: buildM04PushRows() — lô nhập × vị trí còn tồn, KG = "Net (kg)".
// Chỉ lấy dòng còn tồn (> 0). Không ghi gì vào database.
// ===========================================================================================
const GS_SEG_OLD = 'State';
function gsNum(v) { const n = m1LooseNumber(v); return isNaN(n) ? 0 : n; }
function gsStr(v) { return v == null ? '' : String(v).trim(); }
function gsSplitName(ten) { // GIỐNG vtSplitName() (Module 1)
  const p = String(ten ?? '').split(' - ');
  return p.length >= 3 ? [p[p.length - 2].trim(), p[p.length - 1].trim()] : ['', ''];
}
function gsReadMaHoa() {
  // Module 8 › Mã hóa sản phẩm: sheet "MaHoa" (Tổ hợp | Mã | Tên); chưa chuyển thì đọc khối JSON "State" cũ.
  try {
    const rows = readSheet('module8', m8Store.SHEETS.maHoa);
    if (rows.length) return rows.map(r => ({ seg: Number(r['Tổ hợp']), code: gsStr(r['Mã']), name: gsStr(r['Tên']) })).filter(r => r.code);
    const old = m8Store.decodeOld(readSheet('module8', m8Store.SHEETS.old || GS_SEG_OLD)) || {};
    const seg = old.segmentData || {};
    const out = [];
    Object.keys(seg).forEach(k => (seg[k] || []).forEach(e => out.push({ seg: Number(k), code: gsStr(e.code), name: gsStr(e.name) })));
    return out.filter(r => r.code);
  } catch (err) { console.error('Tim toan kho — loi doc Ma hoa Module 8:', err.message); return []; }
}
function gsReadMeta(dbKey, sheet) {
  try {
    const cell = (readSheet(dbKey, sheet)[0] || {}).data;
    if (typeof cell === 'string' && cell.startsWith('__JSON__')) return JSON.parse(cell.slice(8));
  } catch (err) { /* không có meta */ }
  return {};
}
async function buildGlobalSearchData() {
  await prefetchDbFiles(['module1', 'module2', 'module3', 'module4', 'module8']);
  const maHoa = gsReadMaHoa();
  const sizeOf = klSize.create(maHoa.filter(r => r.seg === 8));
  const rows = [];
  const errors = [];
  const push = (o) => {
    const p = o.ma ? sizeOf(o.ma, o.ten) : { size: '', tag: '' };
    rows.push({
      m: o.m, src: o.src, vt: gsStr(o.vt), ma: gsStr(o.ma), ten: gsStr(o.ten),
      size: gsStr(o.size) || p.size, tag: o.tag != null ? o.tag : p.tag,
      hd: gsStr(o.hd), dt: gsStr(o.dt), ton: o.ton == null ? null : o.ton, kg: o.kg == null ? null : o.kg,
      lo: gsStr(o.lo), extra: gsStr(o.extra),
    });
  };
  const dates = {};

  // ---- Module 1 ----
  try {
    const m1 = readModule1LoadDataLabeled();
    const col = (name) => { const i = m1.headers.findIndex(h => m1FuzzyNorm(h) === m1FuzzyNorm(name)); return i >= 0 ? m1.columns[i] : null; };
    const cMa = col('Mã hàng'), cTen = col('Tên hàng'), cHd = col('Hợp đồng'), cSz = col('Size'), cDt = col('Đặc tính'),
          cTon = col('Tồn cuối'), cTl = col('Trọng lượng');
    const ldByMa = new Map();
    const ld = cMa ? m1.rows.map(r => {
      const ma = klSize.shortCode(r[cMa]);
      const o = { ma, ten: cTen ? r[cTen] : '', hd: cHd ? r[cHd] : '', dt: cDt ? r[cDt] : '', size: cSz ? r[cSz] : '',
        ton: cTon ? gsNum(r[cTon]) : 0, tl: cTl ? gsNum(r[cTl]) : 0 };
      if (ma && !ldByMa.has(ma.toUpperCase())) ldByMa.set(ma.toUpperCase(), o);
      return o;
    }) : [];
    const vtSeen = new Set();
    readSheet('module1', 'ViTri').forEach(r => {
      const ma = klSize.shortCode(r[VT_LBL.ma]);
      const sl = gsNum(r[VT_LBL.sl]);
      if (!ma || !(sl > 0)) return;
      const key = ma.toUpperCase();
      vtSeen.add(key);
      const ref = ldByMa.get(key) || {};
      const ten = gsStr(r[VT_LBL.ten]) || gsStr(ref.ten);
      const [dt, hd] = gsSplitName(ten);
      const tl = gsNum(r[VT_LBL.tl]) || ref.tl || 0;
      push({ m: 1, src: 'M01VT', vt: r[VT_LBL.vt], ma, ten, hd: hd || ref.hd, dt: dt || ref.dt, ton: sl, kg: tl ? sl * tl : null, lo: r[VT_LBL.lo] });
    });
    ld.forEach(o => {
      if (!o.ma || !(o.ton > 0) || vtSeen.has(o.ma.toUpperCase())) return;
      push({ m: 1, src: 'M01', vt: '', ma: o.ma, ten: o.ten, hd: o.hd, dt: o.dt, ton: o.ton, kg: o.tl ? o.ton * o.tl : null });
    });
    readViTriBotRows(readSheet('module1', 'ViTriBot')).forEach(r => {
      const sl = gsNum(r[VTB_STORE.sl]);
      const ma = gsStr(r[VTB_STORE.ma]);
      if (!ma || !(sl > 0)) return;
      push({ m: 1, src: 'M01VTB', vt: r[VTB_STORE.vt], ma, ten: r[VTB_STORE.ghiChu], hd: '', dt: '', ton: sl, kg: null,
        extra: ['NSX ' + gsStr(r[VTB_STORE.nsx]), 'HSD ' + gsStr(r[VTB_STORE.hsd])].filter(x => x.length > 4).join(' · ') });
    });
    dates.m1 = m1.dataDate || '';
    dates.m1vt = gsReadMeta('module1', 'ViTriMeta').dataDate || '';
  } catch (err) { console.error('Tim toan kho — Module 1:', err.message); errors.push('Module 1: ' + err.message); }

  // ---- Module 2 ----
  try {
    m2WithDerivedDacTinh(readSheet('module2', 'DuLieuChinh')).forEach(r => {
      const ton = gsNum(r[M2COL.soKien]), kg = gsNum(r[M2COL.trongLuong]);
      if (!(ton > 0) && !(kg > 0)) return;
      // Mã Kho gửi thường KHÔNG theo quy ước 21 ký tự (VD "VRHOITN0085JPA10023" = 19 ký tự) → không đọc được nhãn Size
      // từ mã. Khi đó lấy cột "Size" của Module 2 nếu nó đã là nhãn có tiền tố chữ (VD "NL85", "BTP 50") → gõ "NL 85"
      // vẫn ra dòng Kho gửi. Cột Size chỉ có số ("50") thì KHÔNG dùng làm nhãn (tránh "50 MKS" bị hiểu thành nhãn "50").
      const szCol = gsStr(r[M2COL.size]);
      const codeTag = sizeOf(r[M2COL.maHang], r[M2COL.tenHang]).tag;
      const tag = codeTag || (/^[A-Za-zÀ-ỹĐđ]+\s*\d/.test(szCol) ? szCol : '');
      push({ m: 2, src: 'M02', vt: '', ma: r[M2COL.maHang], ten: r[M2COL.tenHang], hd: '', dt: r[M2COL.dacTinh], size: r[M2COL.size],
        tag, ton, kg, lo: r[M2COL.soLo], extra: gsStr(r[M2COL.phieuNhap]) ? 'PN ' + gsStr(r[M2COL.phieuNhap]) : '' });
    });
    dates.m2 = gsReadMeta('module2', 'DuLieuMeta').dataDate || '';
  } catch (err) { console.error('Tim toan kho — Module 2:', err.message); errors.push('Module 2: ' + err.message); }

  // ---- Module 3 ----
  try {
    buildM03PushRows().rows.forEach(r => {
      const kg = Number(r[M3COL.tong]) || 0;
      if (!(kg > 0)) return;
      const kien = r[M3COL.kien] === '' ? null : Number(r[M3COL.kien]);
      push({ m: 3, src: 'M03', vt: r[M3COL.viTri], ma: gsStr(r[M3COL.maHang]) || gsStr(r[M3COL.loaiHang]), ten: r[M3COL.loaiHang],
        hd: r[M3COL.lsx], dt: r[M3COL.loaiHang], ton: kien != null && !isNaN(kien) ? kien : null, kg, lo: r[M3COL.maPhieu],
        extra: gsStr(r[M3COL.khach]) });
    });
  } catch (err) { console.error('Tim toan kho — Module 3:', err.message); errors.push('Module 3: ' + err.message); }

  // ---- Module 4 ----
  try {
    buildM04PushRows().rows.forEach(r => {
      const ton = Number(r[M4COL.ton]) || 0;
      if (!(ton > 0)) return;
      const type = gsStr(r[M4COL.type]), size = gsStr(r[M4COL.size]);
      // Nhãn để tìm "TGC 51/60": Loại hàng + Size (mã M4 không theo quy ước 21 ký tự).
      const tag = type && size ? type + ' ' + size : undefined;
      push({ m: 4, src: 'M04', vt: r[M4COL.viTri], ma: r[M4COL.code], ten: type, hd: r[M4COL.po], dt: r[M4COL.dacTinh], size,
        ton, kg: Number(r[M4COL.net]) || null, lo: gsStr(r[M4COL.inv]) ? 'INV ' + gsStr(r[M4COL.inv]) : '', extra: gsStr(r[M4COL.supplier]), tag });
    });
  } catch (err) { console.error('Tim toan kho — Module 4:', err.message); errors.push('Module 4: ' + err.message); }

  return { ok: true, rows, maHoa, dates, errors, builtAt: new Date().toISOString() };
}


// ===========================================================================================
// TRANG CHÍNH (bản 10/2026) — số liệu cho html/js/dashboard-overview.js, IPC `db:dashboard-summary`.
// Chỉ đọc. Dùng LẠI đúng cách tính của từng module:
//   - M01: Load Data, KL = Tồn cuối × Trọng lượng (GIỐNG Module 1 "Tổng KL (kg)" và trang chính cũ).
//   - M02: m2WithDerivedDacTinh(DuLieuChinh), KL = "Trọng Lượng (KG)".
//   - Nhóm size (M01, M02): size lấy từ mã 21 ký tự (size-label.js, từ điển Module 8), không có thì cột Size;
//     số đầu tiên trong chuỗi (51/60 → 51, NL85 → 85). Xếp theo MỐC TRÊN: ≤15 ≤20 ≤25 ≤30 ≤40 ≤50 ≤60 ≤75 ≤85 ≤110,
//     còn lại / không đọc được → "Size nhỏ khác" (người dùng chốt 30/09/2026: từ size 30 trở lên bước 5 con).
//   - M03: buildM03PushRows() (lô còn tồn FIFO) theo "Loại Hàng"; nhập/xuất tháng hiện tại từ Transactions.
//   - M04: buildM04PushRows() (lô × vị trí còn tồn) theo "Loại hàng + Size"; KL = Net (kg).
// ===========================================================================================
const DASH_SIZE_UPPER = [15, 20, 25, 30, 40, 50, 60, 75, 85, 110];
const DASH_SIZE_LABEL = ['08 – 15', '16 – 20', '21 – 25', '26 – 30', '35 – 40', '45 – 50', '55 – 60', '65 – 75', '80 – 85', '90 – 110', 'Size nhỏ khác'];
function dashSizeGroup(sizeText) {
  const m = String(sizeText == null ? '' : sizeText).match(/\d+/);
  if (!m) return DASH_SIZE_UPPER.length;
  const n = parseInt(m[0], 10);
  const i = DASH_SIZE_UPPER.findIndex(u => n <= u);
  return i === -1 ? DASH_SIZE_UPPER.length : i;
}
async function buildDashboardSummary() {
  await prefetchDbFiles(['module1', 'module2', 'module3', 'module4', 'module8']);
  const sizeOf = klSize.create(gsReadMaHoa().filter(r => r.seg === 8));
  const out = { ok: true, sizeLabels: DASH_SIZE_LABEL, errors: [] };
  const codesAll = new Set();

  // ---- Module 1 ----
  try {
    const m1 = readModule1LoadDataLabeled();
    const norm = m1FuzzyNorm;
    const find = (name, exact) => {
      let i = m1.headers.findIndex(h => norm(h) === norm(name));
      if (i === -1 && !exact) i = m1.headers.findIndex(h => { const a = norm(h), b = norm(name); return a && (a.includes(b) || b.includes(a)); });
      return i >= 0 ? m1.columns[i] : null;
    };
    const cMa = find('Mã hàng'), cTen = find('Tên hàng'), cSz = find('Size', true), cTon = find('Tồn cuối', true) || find('Tồn cuối'), cTl = find('Trọng lượng');
    if (m1.rows.length && cMa) {
      const sizes = new Array(DASH_SIZE_LABEL.length).fill(0);
      const codes = new Set();
      let kg = 0;
      m1.rows.forEach(r => {
        const ma = String(r[cMa] == null ? '' : r[cMa]).trim();
        if (ma) { codes.add(ma.toUpperCase()); codesAll.add(klSize.shortCode(ma).toUpperCase()); }
        const q = cTon ? m1LooseNumber(r[cTon]) : NaN, w = cTl ? m1LooseNumber(r[cTl]) : NaN;
        const k = (!isNaN(q) && !isNaN(w)) ? q * w : 0;
        if (!k) return;
        kg += k;
        const sz = sizeOf(ma, cTen ? r[cTen] : '').size || (cSz ? r[cSz] : '');
        sizes[dashSizeGroup(sz)] += k;
      });
      out.m1 = { kg, ma: codes.size, date: m1.dataDate || (m1.importedAt ? new Date(m1.importedAt).toLocaleDateString('en-GB') : ''), sizes };
    }
  } catch (err) { console.error('Trang chính — Module 1:', err.message); out.errors.push('Module 1: ' + err.message); }

  // ---- Module 2 ----
  try {
    const rows = m2WithDerivedDacTinh(readSheet('module2', 'DuLieuChinh'));
    if (rows.length) {
      const sizes = new Array(DASH_SIZE_LABEL.length).fill(0);
      const codes = new Set();
      let kg = 0;
      rows.forEach(r => {
        const ma = String(r[M2COL.maHang] == null ? '' : r[M2COL.maHang]).trim();
        if (ma) { codes.add(ma.toUpperCase()); codesAll.add(klSize.shortCode(ma).toUpperCase()); }
        const k = m1LooseNumber(r[M2COL.trongLuong]);
        if (isNaN(k) || !k) return;
        kg += k;
        const sz = sizeOf(ma, r[M2COL.tenHang]).size || r[M2COL.size];
        sizes[dashSizeGroup(sz)] += k;
      });
      const meta = gsReadMeta('module2', 'DuLieuMeta');
      out.m2 = { kg, ma: codes.size, date: meta.dataDate || (meta.importedAt ? new Date(meta.importedAt).toLocaleDateString('en-GB') : ''), sizes };
    }
  } catch (err) { console.error('Trang chính — Module 2:', err.message); out.errors.push('Module 2: ' + err.message); }
  out.maAll = codesAll.size;

  // ---- Module 3 ----
  try {
    const tx = readSheet('module3', 'Transactions');
    if (tx.length) {
      const by = new Map();
      let ton = 0;
      buildM03PushRows().rows.forEach(r => {
        const v = Number(r[M3COL.tong]) || 0;
        if (v <= 0) return;
        const g = String(r[M3COL.loaiHang] || r[M3COL.maHang] || '(chưa rõ loại)').trim();
        by.set(g, (by.get(g) || 0) + v); ton += v;
      });
      const now = new Date(), ym = now.getFullYear() * 100 + now.getMonth() + 1;
      let inM = 0, outM = 0, last = null;
      tx.forEach(t => {
        const d = new Date(t.date);
        if (isNaN(d)) return;
        if (!last || d > last) last = d;
        if (d.getFullYear() * 100 + d.getMonth() + 1 !== ym) return;
        const q = Number(t.qty) || 0;
        if (t.type === 'nhap') inM += q; else if (t.type === 'xuat') outM += q;
      });
      out.m3 = { ton, inMonth: inM, outMonth: outM, month: now.getMonth() + 1, count: tx.length,
        last: last ? last.toISOString() : '', items: [...by.entries()].map(([g, v]) => ({ g, v })).sort((a, b) => b.v - a.v) };
    }
  } catch (err) { console.error('Trang chính — Module 3:', err.message); out.errors.push('Module 3: ' + err.message); }

  // ---- Module 4 ----
  try {
    const imp = readSheet('module4', 'nhaphang_data');
    if (imp.length) {
      const by = new Map(), lots = new Set(), byType = new Map();
      let ton = 0;
      buildM04PushRows().rows.forEach(r => {
        const v = Number(r[M4COL.net]) || 0;
        if (!(Number(r[M4COL.ton]) > 0)) return;
        const type = String(r[M4COL.type] || '').trim(), size = String(r[M4COL.size] || '').trim();
        const g = [type, size].filter(Boolean).join(' ') || '(chưa rõ)';
        by.set(g, (by.get(g) || 0) + v); ton += v;
        byType.set(type || '(khác)', (byType.get(type || '(khác)') || 0) + v);
        lots.add(String(r._key || '').split('::')[0]);
      });
      let last = null;
      imp.forEach(r => { const d = new Date(r.ngayNhap); if (!isNaN(d) && (!last || d > last)) last = d; });
      // Thứ tự: theo loại hàng rồi theo size (số đầu) — đọc như 1 bảng size.
      const sizeNum = (g) => { const m = g.match(/\d+/); return m ? parseInt(m[0], 10) : 9999; };
      const items = [...by.entries()].map(([g, v]) => ({ g, v }))
        .sort((a, b) => a.g.split(' ')[0].localeCompare(b.g.split(' ')[0]) || sizeNum(a.g) - sizeNum(b.g));
      out.m4 = { ton, lots: lots.size, last: last ? last.toISOString() : '', items,
        types: [...byType.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => b.v - a.v) };
    }
  } catch (err) { console.error('Trang chính — Module 4:', err.message); out.errors.push('Module 4: ' + err.message); }
  return out;
}

// ---- BÁO CÁO EXCEL MODULE 01 CHO ĐIỆN THOẠI ("Báo Cáo Tổng Tồn" + "Bảng Tổng Hợp HLSO") ----
// Công thức 2 bảng này nằm trọn trong html/js/ton-kho-an-an.js (rất dài, phụ thuộc nhóm Đặc tính,
// Size, 7 module lọc…) → KHÔNG chép sang main.js/điện thoại. Thay vào đó nhờ Module 01 ĐANG MỞ dựng
// đúng 2 file như nút Xuất Excel trên PC (buildPhoneReportSnapshot), lưu bản gần nhất vào
// m01-baocao-dien-thoai.json. Module 01 chưa mở thì dùng bản đã lưu (điện thoại hiện "lập lúc …").
// Module 02 dùng CÙNG cơ chế cho "Bảng Tổng Hợp" (buildM2PhoneReportSnapshot trong ton-kho-gui.js → tab BaoCao_M02,
// bản gần nhất lưu m02-baocao-dien-thoai.json).
const REPORT_CACHE_PATH = {
  module1: PATHS.cfgFile('m01-baocao-dien-thoai.json'),
  module2: PATHS.cfgFile('m02-baocao-dien-thoai.json'),
};
const REPORT_CHUNK = 40000; // 1 ô Google Sheet tối đa 50.000 ký tự
// SỬA LỖI (PC 2.6) — điện thoại: "tồn kho đã cập nhật ngày 30 nhưng báo cáo vẫn là file ngày 27".
// Báo cáo do TRANG Module 01/02 ĐANG MỞ dựng từ số liệu trong BỘ NHỚ của trang đó. Trang chỉ nạp dữ liệu 1 lần lúc mở,
// nên khi Load Data mới được nạp từ NƠI KHÁC (máy con Mạng LAN, khôi phục sao lưu…), trang vẫn giữ số cũ → báo cáo cũ,
// trong khi bảng tồn đẩy lên điện thoại đọc thẳng database (số mới). Nay: so ngày số liệu + lúc nạp của bản báo cáo với
// meta trong DATABASE; lệch → tự nạp lại trang module đó (chạy nền) rồi xin dựng lại; vẫn lệch / module đang đóng mà bản
// lưu đã cũ → KHÔNG đẩy báo cáo cũ, báo rõ lỗi cho điện thoại (giữ bản trước trên Sheet).
const REPORT_META_SHEET = { module1: 'LoadDataMeta', module2: 'DuLieuMeta' };
function dbReportStamp(dbKey) {
  try {
    const cell = (readSheet(dbKey, REPORT_META_SHEET[dbKey])[0] || {}).data;
    if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
      const m = JSON.parse(cell.slice(8));
      return { dataDate: m.dataDate || '', importedAt: m.importedAt || null };
    }
  } catch (err) { console.error('Loi doc meta bao cao ' + dbKey + ':', err.message); }
  return { dataDate: '', importedAt: null };
}
const stampMs = (v) => { const t = v == null || v === '' ? 0 : new Date(v).getTime(); return Number.isFinite(t) ? t : 0; };
// Bản báo cáo lệch database? (bản lập bởi trang cũ chưa có importedAt → chỉ so ngày số liệu)
function reportStale(snap, stamp) {
  if (!snap) return false;
  if ((snap.dataDate || '') !== (stamp.dataDate || '')) return true;
  if (Object.prototype.hasOwnProperty.call(snap, 'importedAt') && stampMs(snap.importedAt) !== stampMs(stamp.importedAt)) return true;
  return false;
}
const staleMsg = (dbKey, snap, stamp) => 'Báo cáo trên PC còn là số liệu ' + (snap.dataDate || 'cũ') + ' trong khi tồn kho đã là '
  + (stamp.dataDate || 'bản mới') + ' — trên máy PC (máy chủ) mở ' + (IMPORT_LABEL[dbKey] || dbKey) + ', bấm Làm mới (↻) rồi đồng bộ lại.';
// Nạp lại trang module (chạy nền) và chờ trang đăng ký lại (phone:register-module) — tối đa ~25 giây.
async function reloadImportFrame(dbKey) {
  const old = importFrames[dbKey];
  if (!old) return false;
  importFrames[dbKey] = null; // trang mới nạp xong sẽ tự đăng ký lại (có thể là CÙNG đối tượng khung → không so sánh được)
  try { if (!old.reload()) { importFrames[dbKey] = old; return false; } } catch (err) { importFrames[dbKey] = old; return false; }
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (importFrames[dbKey] && isImportFrameAlive(dbKey)) return true;
  }
  return false;
}
async function snapshotFromFrame(dbKey) {
  const snap = await requestFrameImport(dbKey, null, 'baocao');
  return snap && snap.ok && Array.isArray(snap.files) ? snap : null;
}
async function getReportSnapshot(dbKey) {
  const cachePath = REPORT_CACHE_PATH[dbKey];
  const label = IMPORT_LABEL[dbKey] || dbKey;
  const stamp = dbReportStamp(dbKey);
  let staleSnap = null;
  if (isImportFrameAlive(dbKey)) {
    try {
      let snap = await snapshotFromFrame(dbKey);
      if (snap && reportStale(snap, stamp)) {
        console.log(label + ': bao cao lech database (' + snap.dataDate + ' / ' + stamp.dataDate + ') — nap lai trang module');
        staleSnap = snap; snap = null;
        if (await reloadImportFrame(dbKey)) {
          const again = await snapshotFromFrame(dbKey);
          if (again && !reportStale(again, stamp)) { snap = again; staleSnap = null; } else if (again) staleSnap = again;
        }
      }
      if (snap) {
        // PC 0.19 — ghi bộ đệm báo cáo (có thể vài MB) KHÔNG chặn tiến trình chính; ghi file tạm rồi đổi tên để lần đọc
        // dự phòng bên dưới không bao giờ gặp file ghi dở.
        const tmpSnap = cachePath + '.tmp-ghi', body = JSON.stringify(snap);
        fs.promises.writeFile(tmpSnap, body, 'utf8').then(() => fs.promises.rename(tmpSnap, cachePath))
          .catch((err) => { console.error('Loi ghi ' + path.basename(cachePath) + ':', err.message); fs.promises.unlink(tmpSnap).catch(() => {}); });
        return snap;
      }
      if (!staleSnap) console.error(label + ' khong dung duoc bao cao dien thoai.');
    } catch (err) { console.error('Loi xin bao cao dien thoai tu ' + label + ':', err.message); }
  }
  try {
    if (fs.existsSync(cachePath)) {
      const snap = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (snap && Array.isArray(snap.files)) {
        if (reportStale(snap, stamp)) return { stale: true, error: staleMsg(dbKey, snap, stamp) };
        return Object.assign(snap, { fromCache: true });
      }
    }
  } catch (err) { console.error('Loi doc ' + path.basename(cachePath) + ':', err.message); }
  if (staleSnap) return { stale: true, error: staleMsg(dbKey, staleSnap, stamp) };
  return null;
}
// Đẩy báo cáo Excel của 1 module lên tab riêng + ghi 3 khóa Meta <prefix>BaoCaoAt / BaoCaoCu / BaoCaoLoi.
// Lỗi ở đây KHÔNG được làm hỏng lần đẩy tồn kho của module đó.
async function pushReportTab(cfg, meta, dbKey, tabName, prefix) {
  try {
    const snap = await getReportSnapshot(dbKey);
    if (snap && snap.stale) { meta[prefix + 'BaoCaoLoi'] = snap.error; return; } // giữ bản cũ trên Sheet, báo lỗi rõ
    if (snap) {
      await sheetsSync.pushTableOverwrite(cfg, tabName, M01_REPORT_COLUMNS, buildM01ReportRows(snap));
      meta[prefix + 'BaoCaoAt'] = snap.generatedAt || '';
      meta[prefix + 'BaoCaoCu'] = snap.fromCache ? 'x' : '';
      meta[prefix + 'BaoCaoLoi'] = (snap.errors || []).join(' | ');
    }
  } catch (err) {
    console.error('Loi day bao cao Excel ' + dbKey + ' len Sheet:', err.message);
    meta[prefix + 'BaoCaoLoi'] = err.message;
  }
}
// Mỗi file = nhiều dòng (part 0,1,2…), cột data có tiền tố "~" để Sheet không bao giờ hiểu nhầm
// base64 (có thể bắt đầu bằng "+" / "=") là công thức. Phải khớp getBaoCaoM01_() trong Code.gs.
const M01_REPORT_COLUMNS = ['key', 'title', 'name', 'reportDate', 'generatedAt', 'part', 'parts', 'data'];
function buildM01ReportRows(snap) {
  const rows = [];
  ((snap && snap.files) || []).forEach(f => {
    const b64 = String(f.b64 || '');
    const parts = Math.max(1, Math.ceil(b64.length / REPORT_CHUNK));
    for (let i = 0; i < parts; i++) {
      rows.push({ key: f.key, title: f.title, name: f.name, reportDate: snap.reportDate || '', generatedAt: snap.generatedAt || '',
        part: i, parts, data: '~' + b64.slice(i * REPORT_CHUNK, (i + 1) * REPORT_CHUNK) });
    }
  });
  return rows;
}

// tables: mang ma bang can day (mac dinh: tat ca). Meta ghi them lastPushAt_<ma> cho TUNG bang;
// "lastPushAt" chung = moc CU NHAT trong cac bang (an toan cho Apps Script ban cu chi doc 1 moc).
async function pushTonKhoLenSheetInner(tables) {
  const cfg = requireSheetsConfig();
  const pick = new Set((tables && tables.length ? tables : SYNC_TABLES).filter(t => SYNC_TABLES.includes(t)));
  if (!pick.size) return loadSheetsConfig();
  await sheetsSync.ensureTabs(cfg, allSyncTabs([...pick]));
  // Nạp sẵn các file sắp đọc ở luồng phụ → readSheet() bên dưới không phải phân tích file trên tiến trình chính.
  const DB_OF_TABLE = { M01: 'module1', M01VT: 'module1', M01VTB: 'module1', M02: 'module2', M03: 'module3', M04: 'module4', M08: 'module8', C3D: 'module14' };
  // Chờ các lệnh ghi Excel ĐANG XẾP HÀNG của đúng các file sắp đọc (VD vừa sửa số liệu rồi bấm "Đẩy lên điện thoại"
  // ngay) — nếu không, lần đẩy có thể đọc bản file CŨ trước lần ghi đó (rà soát PC 2.2).
  await waitDbWrites([...pick].map(t => DB_OF_TABLE[t]).filter(Boolean));
  await prefetchDbFiles([...pick].map(t => DB_OF_TABLE[t]).filter(Boolean));

  const metaOld = {};
  try {
    (await sheetsSync.readTable(cfg, SH_TAB.META)).rows.forEach(r => { if (r.key) metaOld[String(r.key)] = r.value; });
  } catch (err) { /* Meta chua co — tao moi ben duoi */ }
  const meta = { ...metaOld };
  const now = () => new Date().toISOString();
  const sigs = {}; // dấu dữ liệu từng bảng vừa đẩy (cột Trạng thái)

  if (pick.has('M01')) {
    const m1 = readModule1LoadDataLabeled();
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M01, m1.columns, m1.rows);
    sigs.M01 = pushSig([m1.columns, m1.rows]);
    Object.assign(meta, {
      lastPushAt_M01: now(), m01FileName: m1.fileName, m01Rows: m1.rows.length,
      m01ImportedAt: m1.importedAt ? new Date(m1.importedAt).toISOString() : '',
      m01DataDate: m1.dataDate || '', // "Ngày số liệu" dd/mm/yyyy nhập ở Load Data (điện thoại hiện ngày này)
    });
    // Báo cáo Excel cho điện thoại — lỗi ở đây KHÔNG được làm hỏng lần đẩy tồn kho M01 ở trên.
    await pushReportTab(cfg, meta, 'module1', SH_TAB.M01_BAOCAO, 'm01');
  }
  if (pick.has('M01VT')) {
    const m1ViTriRaw = readSheet('module1', 'ViTri');
    const vtKeys = vtRowKeys(m1ViTriRaw, r => r[VT_LBL.ma], r => r[VT_LBL.lo], r => r[VT_LBL.vt]);
    const m1ViTriRows = m1ViTriRaw.map((r, i) => ({ ...r, _key: vtKeys[i] })).filter(r => r._key);
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M01_VITRI,
      m1ViTriRows.length ? Object.values(VT_LBL).concat(['_key']) : [], m1ViTriRows);
    sigs.M01VT = pushSig(m1ViTriRows);
    let vtDataDate = '', vtImportedAt = '';
    try {
      const cell = (readSheet('module1', 'ViTriMeta')[0] || {}).data;
      if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
        const m = JSON.parse(cell.slice(8));
        vtDataDate = m.dataDate || '';
        vtImportedAt = m.importedAt ? new Date(m.importedAt).toISOString() : '';
      }
    } catch (err) { console.error('Loi doc ViTriMeta (Module 1):', err.message); }
    // m01ViTriImportedAt = lúc nạp file vị trí trên PC — điện thoại ẩn phiếu "đã nhận" TRƯỚC mốc này (thuộc tồn cũ).
    Object.assign(meta, { lastPushAt_M01VT: now(), m01ViTriRows: m1ViTriRows.length, m01ViTriDataDate: vtDataDate, m01ViTriImportedAt: vtImportedAt });
  }
  if (pick.has('M01VTB')) {
    // Vị Trí Bột: đẩy đúng thứ tự dòng trong sheet ViTriBot (khóa "_key" tính theo thứ tự này).
    const raw = readViTriBotRows(readSheet('module1', 'ViTriBot'));
    const keys = vtbRowKeys(raw);
    const rows = raw.map((r, i) => {
      const o = { _key: keys[i] };
      Object.keys(VTB_PUSH).forEach(f => {
        const v = r[VTB_STORE[f]];
        o[VTB_PUSH[f]] = f === 'sl' ? (isNaN(m1LooseNumber(v)) ? 0 : m1LooseNumber(v)) : String(v ?? '').trim();
      });
      return o;
    }).filter(r => r._key && r[VTB_PUSH.sl] > 0); // SL = 0 (hết hàng) không đẩy lên điện thoại — lọc SAU khi tính khoá
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M01_VITRIBOT,
      rows.length ? Object.values(VTB_PUSH).concat(['_key']) : [], rows);
    sigs.M01VTB = pushSig(rows);
    let vtbDataDate = '', vtbImportedAt = '';
    try {
      const cell = (readSheet('module1', 'ViTriBotMeta')[0] || {}).data;
      if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
        const m = JSON.parse(cell.slice(8));
        vtbDataDate = m.dataDate || '';
        vtbImportedAt = m.importedAt ? new Date(m.importedAt).toISOString() : '';
      }
    } catch (err) { console.error('Loi doc ViTriBotMeta (Module 1):', err.message); }
    Object.assign(meta, { lastPushAt_M01VTB: now(), m01ViTriBotRows: rows.length, m01ViTriBotDataDate: vtbDataDate, m01ViTriBotImportedAt: vtbImportedAt });
  }
  if (pick.has('M03')) {
    const m3 = buildM03PushRows();
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M03, m3.rows.length ? m3.columns : [], m3.rows);
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M03_LSX, ['id', 'code', 'name', 'khachHang'], m3.lsxRows);
    sigs.M03 = pushSig([m3.rows, m3.lsxRows]);
    Object.assign(meta, { lastPushAt_M03: now(), m03Rows: m3.rows.length });
  }
  if (pick.has('M04')) {
    const m4 = buildM04PushRows();
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M04, m4.rows.length ? m4.columns : [], m4.rows);
    sigs.M04 = pushSig(m4.rows);
    Object.assign(meta, { lastPushAt_M04: now(), m04Rows: m4.rows.length });
  }
  if (pick.has('M08')) {
    const m8 = await buildM08Push();
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M08_MAHOA, ['seg', 'code', 'name'], m8.maHoa);
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M08_MADATAO, ['stt', 'code', 'note'], m8.maDaTao);
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M08_TONGHOP, m8.tongHop.cols, m8.tongHop.rows);
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M08_RADONG, m8.raDong.cols, m8.raDong.rows);
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M08_SIZE, ['code', 'label'], m8.size);
    const ks = await pushKhangSinhIncremental(cfg); // kháng sinh: chỉ phần mới (PC 5.0)
    meta.lastPushAt_KS = now(); meta.ksSent = ks.sent;
    sigs.M08 = pushSig([m8.maHoa, m8.maDaTao, m8.tongHop, m8.raDong, m8.size, ks.sent]);
    Object.assign(meta, {
      lastPushAt_M08: now(), m08Tab2CodeCol: m8.tab2Meta.codeCol, m08Tab2DateCol: m8.tab2Meta.dateCol,
      m08Tab3CodeCol: m8.tab3Meta.codeCol,
    });
  }
  if (pick.has('LX')) {
    // Lịch xuất nhập hàng (PC 7.31): đẩy các lịch từ đầu tháng thứ (hiện tại − 2) trở đi (đủ để xem lại 3 tháng) + bảng tổng kết MỌI tháng.
    // Điện thoại chỉ XEM. Cột chiTiet (JSON từng dòng hàng) cắt còn ≤ 40.000 ký tự (1 ô Google Sheet tối đa 50.000).
    const d0 = new Date(); d0.setDate(1); d0.setMonth(d0.getMonth() - 2);
    const from = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-01';
    const LX_COLS = ['id', 'loai', 'ngay', 'trangThai', 'lsx', 'khach', 'thiTruong', 'matHang', 'size', 'tonKien', 'kg', 'chiTiet', 'canXuat', 'doLuc', 'cont']; // PC 7.35: thêm cột loai (xuat|nhap); PC 7.74: thêm cont (mã nhóm chung container) cho điện thoại
    const lxRows = readSheet('lichxuat', 'LichXuatCont').filter(r => /^\d{4}-\d{2}-\d{2}/.test(String(r.ngay || '')) && String(r.ngay).slice(0, 10) >= from).map(r => {
      const o = {}; LX_COLS.forEach(c => { o[c] = r[c] == null ? '' : r[c]; });
      o.loai = o.loai === 'nhap' ? 'nhap' : 'xuat';
      o.ngay = String(o.ngay).slice(0, 10);
      if (String(o.chiTiet).length > 40000) o.chiTiet = '';
      return o;
    });
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.LX, lxRows.length ? LX_COLS : [], lxRows);
    const TK_COLS = ['thang', 'soLich', 'daXuat', 'kg', 'kgDaXuat', 'soNhap', 'daNhap', 'kgNhap', 'kgDaNhap', 'capNhat']; // PC 7.35: thêm số liệu NHẬP
    const tkRows = readSheet('lichxuat', 'TongKetThang').filter(r => /^\d{4}-\d{2}$/.test(String(r.thang || ''))).map(r => {
      const o = {}; TK_COLS.forEach(c => { o[c] = r[c] == null ? '' : r[c]; }); return o;
    });
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.LX_THANG, tkRows.length ? TK_COLS : [], tkRows);
    sigs.LX = pushSig([lxRows, tkRows]);
    Object.assign(meta, { lastPushAt_LX: now(), lxRows: lxRows.length });
  }
  if (pick.has('C3D')) {
    // Container Loading 3D (PC 8.61): cont người dùng đã sửa / thêm + phương án đã lưu. Điện thoại chỉ XEM / mở (không ghi ngược về PC).
    // Mỗi dòng: kind = cont | plan; data = chuỗi JSON (≤ 40.000 ký tự / ô Google Sheet — phương án quá lớn thì bỏ qua).
    const C3D_COLS = ['kind', 'id', 'name', 'capNhat', 'contName', 'loaded', 'requested', 'data'], c3dRows = [];
    readSheet('module14', 'C3D_Container').forEach(r => { if (r.id && String(r.data || '').length <= 40000) c3dRows.push({ kind: 'cont', id: r.id, name: r.name || '', capNhat: '', contName: '', loaded: '', requested: '', data: r.data }); });
    readSheet('module14', 'C3D_Plan').forEach(r => { if (r.id && String(r.data || '').length <= 40000) c3dRows.push({ kind: 'plan', id: r.id, name: r.name || '', capNhat: r.capNhat || '', contName: r.contName || '', loaded: r.loaded === '' || r.loaded == null ? '' : r.loaded, requested: r.requested === '' || r.requested == null ? '' : r.requested, data: r.data }); });
    readSheet('module14', 'C3D_Thung').forEach(r => { if (r.id && String(r.data || '').length <= 40000) c3dRows.push({ kind: 'thung', id: r.id, name: r.name || '', capNhat: r.capNhat || '', contName: '', loaded: '', requested: '', data: r.data }); }); // danh mục kích thước thùng (PC 8.68)
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.C3D, c3dRows.length ? C3D_COLS : [], c3dRows);
    sigs.C3D = pushSig(c3dRows);
    Object.assign(meta, { lastPushAt_C3D: now(), c3dRows: c3dRows.length });
  }
  if (pick.has('M02')) {
    const m2Rows = m2WithDerivedDacTinh(readSheet('module2', 'DuLieuChinh'));
    await sheetsSync.pushTableOverwrite(cfg, SH_TAB.M02, m2Rows.length ? M2_PUSH_COLUMNS : [], m2Rows);
    sigs.M02 = pushSig(m2Rows);
    let m2DataDate = '', m2ImportedAt = '';
    try {
      const cell = (readSheet('module2', 'DuLieuMeta')[0] || {}).data;
      if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
        const m = JSON.parse(cell.slice(8));
        m2DataDate = m.dataDate || '';
        m2ImportedAt = m.importedAt ? new Date(m.importedAt).toISOString() : '';
      }
    } catch (err) { console.error('Loi doc DuLieuMeta (Module 2):', err.message); }
    // m02ImportedAt = lúc bấm "Nạp Dữ Liệu" Module 2 — điện thoại ẩn phiếu "đã nhận" TRƯỚC mốc này (thuộc tồn cũ).
    Object.assign(meta, { lastPushAt_M02: now(), m02Rows: m2Rows.length, m02DataDate: m2DataDate, m02ImportedAt: m2ImportedAt });
    // Báo cáo Excel "Bảng Tổng Hợp" cho điện thoại (tab BaoCao_M02).
    await pushReportTab(cfg, meta, 'module2', SH_TAB.M02_BAOCAO, 'm02');
  }

  // Meta ghi SAU CUNG: dien thoai dua vao lastPushAt_<ma> de biet phieu nao da nam trong so ton.
  const stamps = SYNC_TABLES.map(t => meta['lastPushAt_' + t]).filter(Boolean).sort();
  meta.lastPushAt = stamps.length === SYNC_TABLES.length ? stamps[0] : (metaOld.lastPushAt || '');
  await sheetsSync.pushTableOverwrite(cfg, SH_TAB.META, ['key', 'value'],
    Object.entries(meta).map(([key, value]) => ({ key, value })));

  // Trạng thái TỪNG bảng (cột "Trạng thái" ở Công cụ › Đồng bộ điện thoại): changed = dữ liệu khác lần đẩy trước.
  const cfgPrev = loadSheetsConfig();
  const prevSigs = cfgPrev.pushSigs || {}, pushStatus = { ...(cfgPrev.pushStatus || {}) }, nowIso = now();
  Object.keys(sigs).forEach(t => {
    const changed = prevSigs[t] !== sigs[t];
    pushStatus[t] = { at: nowIso, changed, changedAt: changed ? nowIso : ((pushStatus[t] && pushStatus[t].changedAt) || null), error: null };
  });
  return patchSheetsConfig({ lastPushAt: nowIso, lastPushOk: true, lastPushError: null, lastPushTables: [...pick], pushSigs: { ...prevSigs, ...sigs }, pushStatus });
}

// ---- ĐẨY RIÊNG BÁO CÁO EXCEL khi số liệu báo cáo đổi mà tồn kho KHÔNG đổi (09/2026) ----
// VD Module 1: bấm "Nạp dữ liệu" ở "Báo Cáo Kho Gửi" hoặc sửa "Bột + Sốt + Bếp"/"Kho Gửi" ở Tổng Hợp > Báo cáo ngoài
// sổ sách. Trước đây báo cáo điện thoại CHỈ được dựng lại khi đẩy tồn M01 (vòng tự động / bấm đồng bộ) và chỉ khi
// Module 01 đang mở lúc đó → điện thoại tải về file cũ, thiếu 2 số này. Nay module báo "báo cáo đã đổi"
// (phoneImportBridge.reportChanged) → chờ 4 giây gom các lần sửa liên tiếp → dựng lại ngay từ module đang mở
// (cũng làm mới bản lưu m0x-baocao-dien-thoai.json) → nếu đã bật đồng bộ điện thoại thì đẩy tab BaoCao_M0x + Meta.
const REPORT_PUSH_OF = { module1: ['M01_BAOCAO', 'm01'], module2: ['M02_BAOCAO', 'm02'] };
const reportPushTimers = {};
async function pushReportOnly(dbKey) {
  const [tabKey, prefix] = REPORT_PUSH_OF[dbKey];
  const cfgNow = loadSheetsConfig();
  if (!cfgNow.webAppUrl || !cfgNow.pcToken) { await getReportSnapshot(dbKey); return; } // chưa bật đồng bộ: chỉ làm mới bản lưu
  const cfg = requireSheetsConfig();
  await sheetsSync.ensureTabs(cfg, allSyncTabs([]));
  const meta = {};
  try {
    (await sheetsSync.readTable(cfg, SH_TAB.META)).rows.forEach(r => { if (r.key) meta[String(r.key)] = r.value; });
  } catch (err) { /* Meta chưa có — tạo mới */ }
  await pushReportTab(cfg, meta, dbKey, SH_TAB[tabKey], prefix);
  await sheetsSync.pushTableOverwrite(cfg, SH_TAB.META, ['key', 'value'],
    Object.entries(meta).map(([key, value]) => ({ key, value })));
}
function scheduleReportPush(dbKey) {
  if (!REPORT_PUSH_OF[dbKey]) return;
  clearTimeout(reportPushTimers[dbKey]);
  reportPushTimers[dbKey] = setTimeout(() => {
    withSheetsSyncLock(() => pushReportOnly(dbKey)).catch(err => {
      console.error('Loi day rieng bao cao ' + dbKey + ':', err.message);
      logError('Đẩy báo cáo Excel ' + dbKey + ' lên điện thoại', err);
    });
  }, 4000);
}
ipcMain.handle('phone:report-changed', (event, dbKey) => {
  scheduleReportPush(dbKey);
  return { ok: true };
});

async function pushTonKhoLenSheet(tables) {
  try {
    return await pushTonKhoLenSheetInner(tables);
  } catch (err) {
    const errAt = new Date().toISOString();
    const stErr = { ...((loadSheetsConfig().pushStatus) || {}) };
    (tables && tables.length ? tables : SYNC_TABLES).forEach(t => { if (SYNC_TABLES.includes(t)) stErr[t] = { ...(stErr[t] || {}), at: errAt, error: err.message }; });
    patchSheetsConfig({ lastPushAt: errAt, lastPushOk: false, lastPushError: err.message, pushStatus: stErr });
    throw err;
  }
}

// ---- Giao viec nhap phieu cho Module 01 / 02 DANG MO (iframe con song) ----
// Module 01 (ton-kho-an-an.js) va Module 02 (ton-kho-gui.js) deu giu toan bo du lieu + danh
// sach phieu trong bo nho va ghi de CA sheet moi lan luu -> khi module dang mo, main.js KHONG duoc
// tu ghi Excel cua module do (se bi ghi de mat), ma phai gui phieu sang cho chinh module nhap.
const importFrames = { module1: null, module2: null, module3: null, module4: null };
const IMPORT_LABEL = { module1: 'Module 01', module2: 'Module 02', module3: 'Module 03', module4: 'Module 04' };
let importSeq = 0;
const pendingImports = new Map();

function isImportFrameAlive(dbKey) {
  const fr = importFrames[dbKey];
  if (!fr || !mainWindow || mainWindow.isDestroyed()) return false;
  try {
    if (fr.detached) return false;
    // PC 3.0: trang chính tự NHẢ module lâu không dùng (iframe → about:blank) — khung vẫn còn nhưng không còn trang module.
    if (!/\.html/i.test(String(fr.url || ''))) return false;
    const frames = mainWindow.webContents.mainFrame.framesInSubtree;
    return frames.some(f => f.processId === fr.processId && f.routingId === fr.routingId);
  } catch (err) {
    return false;
  }
}

function requestFrameImport(dbKey, list, kind) {
  const label = IMPORT_LABEL[dbKey] || dbKey;
  return new Promise((resolve, reject) => {
    const reqId = ++importSeq;
    const timer = setTimeout(() => {
      pendingImports.delete(reqId);
      reject(new Error(`${label} không phản hồi (quá 30 giây) — sẽ thử lại ở lần đồng bộ sau.`));
    }, 30000);
    pendingImports.set(reqId, { resolve, timer });
    try {
      importFrames[dbKey].send('phone:import-phieu', { reqId, list, kind: kind || '' });
    } catch (err) {
      clearTimeout(timer);
      pendingImports.delete(reqId);
      reject(err);
    }
  });
}

async function importPhieuIntoModule(dbKey, list, applyDirect, kind) {
  if (isImportFrameAlive(dbKey)) return await requestFrameImport(dbKey, list, kind);
  importFrames[dbKey] = null;
  // Kiem tra lai NGAY TRONG hang doi ghi: module vua mo trong luc cho thi KHONG ghi thang (module
  // dang doc Excel vao bo nho) — de lan dong bo sau giao cho module xu ly.
  return queueWrite(dbKey, () => {
    if (isImportFrameAlive(dbKey)) {
      return { ok: false, error: (IMPORT_LABEL[dbKey] || dbKey) + ' vừa được mở — sẽ nhập phiếu ở lần đồng bộ sau.' };
    }
    return applyDirect(list);
  });
}

// Module 02 CHUA MO: tu ghi thang vao Excel — cung cach tru ton nhu nut "Tạo phiếu" tren PC
// (Số kiện, Trọng lượng theo ti le, co "Đã trừ theo phiếu xuất"), ca 3 sheet trong 1 lan ghi file.
function applyPhonePhieuDirectToExcel(list) {
  const dbPath = resolveDbPath('module2');
  const wb = fs.existsSync(dbPath) ? XLSX.readFile(dbPath) : XLSX.utils.book_new();
  const sj = (n) => sheetRows(wb.Sheets[n]);
  const duLieu = sj('DuLieuChinh');
  const headers = sj('PhieuXuat');
  const items = sj('PhieuXuatItems');

  const existingIds = new Set(headers.map(h => String(h.id)));
  const usedMa = new Set(headers.map(h => String(h.maPhieu)));
  const rowIndex = new Map();
  duLieu.forEach(r => rowIndex.set(syncMatchKey(r[M2COL.maHang], r[M2COL.soLo], r[M2COL.size], r[M2COL.phieuNhap]), r));

  const importedIds = [];
  let newCount = 0;
  for (const ph of list) {
    if (existingIds.has(String(ph.id))) { importedIds.push(ph.id); continue; }
    let maPhieu = String(ph.maPhieu || '').trim() || String(ph.id);
    if (usedMa.has(maPhieu)) {
      let n = 2;
      while (usedMa.has(`${maPhieu}-${n}`)) n++;
      maPhieu = `${maPhieu}-${n}`;
    }
    usedMa.add(maPhieu);
    ph.items.forEach(it => {
      const qty = syncToNumber(it.soLuongXuat);
      const r = rowIndex.get(syncMatchKey(it.maHang, it.soLo, it.size, it.phieuNhap));
      let tlTru = 0;
      let soKienLucTao = it.soKien;
      if (r) {
        const soKienGoc = syncToNumber(r[M2COL.soKien]);
        const tlGoc = syncToNumber(r[M2COL.trongLuong]);
        soKienLucTao = soKienGoc;
        tlTru = soKienGoc > 0 ? tlGoc * (qty / soKienGoc) : 0;
        r[M2COL.soKien] = soKienGoc - qty;
        r[M2COL.trongLuong] = tlGoc - tlTru;
        if (qty) r[M2COL.daXuat] = 1;
      }
      items.push({
        phieuId: ph.id, maHang: it.maHang, tenHang: it.tenHang, phieuNhap: it.phieuNhap,
        soLo: it.soLo, size: it.size, soKien: soKienLucTao, soLuongXuat: qty, trongLuongTru: tlTru,
      });
    });
    // Moi nhat len dau — dung thu tu pxPhieuList.unshift() cua Module 02.
    headers.unshift({
      id: ph.id, maPhieu, ngayTao: ph.ngayTao,
      nguon: 'Điện thoại', nguoiTao: ph.nguoiTao || '', ghiChu: ph.ghiChu || '',
    });
    existingIds.add(String(ph.id));
    importedIds.push(ph.id);
    newCount++;
  }

  if (newCount) {
    const setSheet = (name, rows) => {
      const ws = rowsToSheet(rows);
      if (wb.Sheets[name]) {
        delete wb.Sheets[name];
        wb.SheetNames = wb.SheetNames.filter(n => n !== name);
      }
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    setSheet('DuLieuChinh', duLieu);
    setSheet('PhieuXuat', headers);
    setSheet('PhieuXuatItems', items);
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    saveWorkbook(wb, dbPath);
  }
  return { ok: true, importedIds, newCount };
}

// Module 01 CHUA MO: tu ghi thang vao Excel — GIONG createXuatSlip() + applyXuatSlipDeduction()
// trong ton-kho-an-an.js: them 1 phieu vao "Xuất Hàng" (sheet PhieuXuat, 1 o JSON) va TRU NGAY
// cot "Tồn cuối" cua dung dong Load Data (phieu dien thoai duoc danh dau "Đã trừ tồn"; tren PC
// van bam "Hủy trừ tồn kho" duoc nhu phieu thuong).
function m1FindRow(rows, itemKey, rowIndex, maHang, itemIdIdx, maHangIdx, getCell) {
  const key = String(itemKey || '');
  if (key.startsWith('id:') && itemIdIdx >= 0) {
    const want = key.slice(3);
    const i = rows.findIndex(r => String(getCell(r, itemIdIdx) ?? '').trim() === want);
    return i;
  }
  const i = Number(key.startsWith('r:') ? key.slice(2) : rowIndex);
  if (!Number.isInteger(i) || i < 0 || i >= rows.length) return -1;
  if (maHangIdx >= 0 && maHang && String(getCell(rows[i], maHangIdx) ?? '').trim() !== String(maHang).trim()) return -1;
  return i;
}

function applyPhonePhieuM1DirectToExcel(list) {
  const dbPath = resolveDbPath('module1');
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'Chưa có database Module 01.' };
  const wb = XLSX.readFile(dbPath);
  const sj = (n) => sheetRows(wb.Sheets[n]);
  let headers = [];
  const metaCell = (sj('LoadDataMeta')[0] || {}).data;
  if (typeof metaCell === 'string' && metaCell.startsWith('__JSON__')) {
    try { headers = JSON.parse(metaCell.slice('__JSON__'.length)).headers || []; } catch (err) { headers = []; }
  }
  const tonIdx = headers.findIndex(h => m1FuzzyNorm(h) === m1FuzzyNorm('Tồn cuối'));
  if (tonIdx < 0) return { ok: false, error: 'Module 01 không có cột "Tồn cuối" — không nhập được phiếu.' };
  const itemIdIdx = headers.findIndex(h => m1FuzzyNorm(h) === 'item id');
  const maHangIdx = headers.findIndex(h => m1FuzzyNorm(h) === m1FuzzyNorm('Mã hàng'));
  const rows = sj('LoadData');
  const getCell = (r, ci) => r['c' + ci];

  let payload = { slips: [], seq: 1 };
  const pxCell = (sj('PhieuXuat')[0] || {}).data;
  if (typeof pxCell === 'string' && pxCell.startsWith('__JSON__')) {
    try { payload = JSON.parse(pxCell.slice('__JSON__'.length)); } catch (err) { /* giu mac dinh */ }
  }
  if (!Array.isArray(payload.slips)) payload.slips = [];
  if (!Number.isFinite(payload.seq)) payload.seq = 1;

  const importedIds = [];
  let newCount = 0;
  const now = new Date().toISOString();
  for (const ph of list) {
    if (payload.slips.some(sl => sl.phoneId === ph.id)) { importedIds.push(ph.id); continue; }
    const lines = [];
    const missing = [];
    ph.items.forEach(it => {
      const i = m1FindRow(rows, it.itemKey, it.rowIndex, it.maHang, itemIdIdx, maHangIdx, getCell);
      if (i < 0) { missing.push(it.maHang); return; }
      const qty = syncToNumber(it.soLuongXuat);
      lines.push({ i, maHang: it.maHang, tenHang: it.tenHang, size: it.size, hopDong: it.hopDong, qty });
      const cur = m1LooseNumber(rows[i]['c' + tonIdx]);
      rows[i]['c' + tonIdx] = (isNaN(cur) ? 0 : cur) - qty;
    });
    if (missing.length) {
      // Khong tim thay dong (VD Load Data vua nap lai bang file khac): hoan lai phan da tru cua
      // phieu nay va bo qua ca phieu — de lan sau (sau khi day ton moi) dien thoai tao lai.
      lines.forEach(l => { rows[l.i]['c' + tonIdx] = m1LooseNumber(rows[l.i]['c' + tonIdx]) + l.qty; });
      console.error('Phieu dien thoai Module 01 khong khop dong Load Data:', ph.id, missing.join(', '));
      continue;
    }
    payload.slips.unshift({
      id: 'PX-' + String(payload.seq++).padStart(4, '0'),
      moduleId: 'dienthoai',
      moduleLabel: '📱 Điện thoại' + (ph.nguoiTao ? ' — ' + ph.nguoiTao : '') + (ph.maPhieu ? ' (' + ph.maPhieu + ')' : ''),
      createdAt: ph.ngayTao || now,
      lines,
      deducted: true,
      deductedAt: now,
      phoneId: ph.id, phoneMaPhieu: ph.maPhieu || '', nguoiTao: ph.nguoiTao || '', ghiChu: ph.ghiChu || '',
    });
    importedIds.push(ph.id);
    newCount++;
  }

  if (newCount) {
    const setSheet = (name, data) => {
      const ws = rowsToSheet(data);
      if (wb.Sheets[name]) { delete wb.Sheets[name]; wb.SheetNames = wb.SheetNames.filter(n => n !== name); }
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    setSheet('LoadData', rows);
    setSheet('PhieuXuat', [{ data: '__JSON__' + JSON.stringify(payload) }]);
    saveWorkbook(wb, dbPath);
  }
  return { ok: true, importedIds, newCount };
}

// Module 01 CHUA MO — phieu "Tồn theo vị trí": tru "SL Tồn" dung dong (khoa vtRowKeys) va luu phieu
// vao sheet "ViTriPhieuDienThoai" (1 o JSON) — GIONG importPhonePhieuVT() trong ton-kho-an-an.js.
function applyPhonePhieuVTDirectToExcel(list) {
  const dbPath = resolveDbPath('module1');
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'Chưa có database Module 01.' };
  const wb = XLSX.readFile(dbPath);
  const sj = (n) => sheetRows(wb.Sheets[n]);
  const rows = sj('ViTri');
  const keys = vtRowKeys(rows, r => r[VT_LBL.ma], r => r[VT_LBL.lo], r => r[VT_LBL.vt]);
  const idxByKey = new Map(keys.map((k, i) => [k, i]).filter(([k]) => k));
  let payload = { slips: [], seq: 1 };
  const cell = (sj('ViTriPhieuDienThoai')[0] || {}).data;
  if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
    try { payload = JSON.parse(cell.slice('__JSON__'.length)); } catch (err) { /* giu mac dinh */ }
  }
  if (!Array.isArray(payload.slips)) payload.slips = [];
  if (!Number.isFinite(payload.seq)) payload.seq = 1;
  const importedIds = [];
  let newCount = 0;
  const now = new Date().toISOString();
  for (const ph of list) {
    if (payload.slips.some(sl => sl.phoneId === ph.id)) { importedIds.push(ph.id); continue; }
    const idxs = ph.items.map(it => idxByKey.get(String(it.itemKey || '').trim()));
    if (idxs.some(i => i === undefined)) {
      console.error('Phieu dien thoai (Vi tri) khong khop dong:', ph.id);
      continue;
    }
    const lines = ph.items.map((it, n) => {
      const r = rows[idxs[n]];
      const qty = syncToNumber(it.soLuongXuat);
      const cur = m1LooseNumber(r[VT_LBL.sl]);
      r[VT_LBL.sl] = (isNaN(cur) ? 0 : cur) - qty;
      return { key: String(it.itemKey), maGoc: r[VT_LBL.ma], ten: r[VT_LBL.ten], dvt: r[VT_LBL.dvt], lo: r[VT_LBL.lo], vt: r[VT_LBL.vt], tl: r[VT_LBL.tl], qty };
    });
    payload.slips.unshift({
      id: 'VT-' + String(payload.seq++).padStart(4, '0'),
      phoneId: ph.id, maPhieu: ph.maPhieu || '', nguoiTao: ph.nguoiTao || '', ghiChu: ph.ghiChu || '',
      createdAt: ph.ngayTao || now, lines, deducted: true, deductedAt: now,
    });
    importedIds.push(ph.id);
    newCount++;
  }
  if (newCount) {
    const setSheet = (name, data) => {
      const ws = rowsToSheet(data);
      if (wb.Sheets[name]) { delete wb.Sheets[name]; wb.SheetNames = wb.SheetNames.filter(n => n !== name); }
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    setSheet('ViTri', rows);
    setSheet('ViTriPhieuDienThoai', [{ data: '__JSON__' + JSON.stringify(payload) }]);
    saveWorkbook(wb, dbPath);
  }
  return { ok: true, importedIds, newCount };
}

// Module 01 CHUA MO — phieu "Vị Trí Bột": tru cot "SL" dung dong (khoa vtbRowKeys) va luu phieu vao
// sheet "ViTriBotPhieuDienThoai" (1 o JSON) — GIONG importPhonePhieuVTB() trong ton-kho-an-an.js.
function applyPhonePhieuVTBDirectToExcel(list) {
  const dbPath = resolveDbPath('module1');
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'Chưa có database Module 01.' };
  const wb = XLSX.readFile(dbPath);
  const sj = (n) => sheetRows(wb.Sheets[n]);
  const rows = sj('ViTriBot'); // giu MOI dong khi ghi lai (dong trong khong co khoa, khong bi dung toi)
  const keys = vtbRowKeys(rows);
  const idxByKey = new Map(keys.map((k, i) => [k, i]).filter(([k]) => k));
  let payload = { slips: [], seq: 1 };
  const cell = (sj('ViTriBotPhieuDienThoai')[0] || {}).data;
  if (typeof cell === 'string' && cell.startsWith('__JSON__')) {
    try { payload = JSON.parse(cell.slice('__JSON__'.length)); } catch (err) { /* giu mac dinh */ }
  }
  if (!Array.isArray(payload.slips)) payload.slips = [];
  if (!Number.isFinite(payload.seq)) payload.seq = 1;
  const importedIds = [];
  let newCount = 0;
  const now = new Date().toISOString();
  for (const ph of list) {
    if (payload.slips.some(sl => sl.phoneId === ph.id)) { importedIds.push(ph.id); continue; }
    const idxs = ph.items.map(it => idxByKey.get(String(it.itemKey || '').trim()));
    if (!idxs.length || idxs.some(i => i === undefined)) {
      console.error('Phieu dien thoai (Vi tri Bot) khong khop dong:', ph.id);
      continue;
    }
    const lines = ph.items.map((it, n) => {
      const r = rows[idxs[n]];
      const qty = syncToNumber(it.soLuongXuat);
      const cur = m1LooseNumber(r[VTB_STORE.sl]);
      r[VTB_STORE.sl] = (isNaN(cur) ? 0 : cur) - qty;
      const g = f => String(r[VTB_STORE[f]] ?? '').trim();
      return { key: String(it.itemKey), vt: g('vt'), ma: g('ma'), nsx: g('nsx'), hsd: g('hsd'), nhap: g('nhap'), ghiChu: g('ghiChu'), qty };
    });
    payload.slips.unshift({
      id: 'VTB-' + String(payload.seq++).padStart(4, '0'),
      phoneId: ph.id, maPhieu: ph.maPhieu || '', nguoiTao: ph.nguoiTao || '', ghiChu: ph.ghiChu || '',
      createdAt: ph.ngayTao || now, lines, deducted: true, deductedAt: now,
    });
    importedIds.push(ph.id);
    newCount++;
  }
  if (newCount) {
    const setSheet = (name, data) => {
      const ws = rowsToSheet(data);
      if (wb.Sheets[name]) { delete wb.Sheets[name]; wb.SheetNames = wb.SheetNames.filter(n => n !== name); }
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    setSheet('ViTriBot', rows);
    setSheet('ViTriBotPhieuDienThoai', [{ data: '__JSON__' + JSON.stringify(payload) }]);
    saveWorkbook(wb, dbPath);
  }
  return { ok: true, importedIds, newCount };
}

// PC 7.63 — YEU CAU LICH XUAT NHAP TU DIEN THOAI (tai khoan Quan ly tro len: them nhanh / chuyen ngay).
// Dien thoai ghi vao tab LichXuat_YeuCau (Code.gs › lichXuatGui). Moi vong keo phieu, may chu doc cac dong chua xu ly va GUI xuong trang chinh
// ('lx:remote-ops'); js/lich-xuat-cont.js ghi vao lich roi goi 'lx:remote-ack' → o day danh dau 'Đã xử lý' / 'Lỗi - …' va day lai bang LX len Sheet.
// Trang chinh chua kip tra loi thi sau 5 phut gui lai (xu ly lap lai khong tao trung). Code.gs chua cap nhat (chua co tab) → bo qua, khong anh huong phan khac.
const lxInFlight = new Map();
let lxYcTabReady = false;
async function dispatchLichXuatRequests(cfg) {
  if (lan.isClient()) return; // chi MAY CHU lam viec nay
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let t;
  try {
    if (!lxYcTabReady) { await sheetsSync.ensureTabs(cfg, { [SH_TAB.LX_YC]: sheetsSync.LX_YC_HEADERS }); lxYcTabReady = true; }
    t = await sheetsSync.readTable(cfg, SH_TAB.LX_YC);
  } catch (err) { return; }
  const now = Date.now();
  const ops = t.rows.filter(r => {
    const id = String(r.id || '').trim(), st = String(r.trangThai || '').trim();
    return id && st !== TRANG_THAI_DA_XU_LY && !st.startsWith('Lỗi') && now - (lxInFlight.get(id) || 0) > 5 * 60 * 1000;
  }).slice(0, 60).map(r => ({
    id: String(r.id).trim(), hanhDong: String(r.hanhDong).trim() === 'move' ? 'move' : 'add', loai: String(r.loai).trim() === 'nhap' ? 'nhap' : 'xuat',
    targetId: String(r.targetId || '').trim(), ngay: String(r.ngay || '').trim().slice(0, 10), lsx: String(r.lsx || '').trim(), trangThaiLich: String(r.trangThaiLich || '').trim(),
  }));
  lxCleanOldErrors(cfg, t).catch(() => {}); // PC 8.54
  if (!ops.length) return;
  ops.forEach(o => lxInFlight.set(o.id, now));
  mainWindow.webContents.send('lx:remote-ops', ops);
}
// PC 8.54: dòng yêu cầu 'Lỗi - …' cũ hơn 24 giờ được chuyển thành 'Đã xử lý (bỏ lỗi cũ)' → điện thoại (chỉ hiện dòng bắt đầu bằng 'Lỗi') tự hết cảnh báo đỏ; chạy tối đa 30 phút / lần.
let lxCleanAt = 0;
async function lxCleanOldErrors(cfg, t) {
  const now = Date.now(); if (now - lxCleanAt < 30 * 60 * 1000) return; lxCleanAt = now;
  const cut = now - 24 * 3600 * 1000, updates = [];
  (t.rows || []).forEach(r => {
    const st = String(r.trangThai || '').trim(); if (!st.startsWith('Lỗi')) return;
    const at = new Date(String(r.xuLyLuc || r.taoLuc || '')).getTime();
    if (at && at < cut) updates.push({ rowNumber: r._rowNumber, id: String(r.id || '').trim(), values: { trangThai: 'Đã xử lý (bỏ lỗi cũ)' } });
  });
  if (!updates.length) return;
  await withSheetsSyncLock(async () => { await sheetsSync.markRowsProcessed(cfg, SH_TAB.LX_YC, t.headers, updates); });
}
ipcMain.handle('lx:remote-ack', async (event, results) => {
  try {
    const list = (Array.isArray(results) ? results : []).filter(r => r && r.id).slice(0, 200);
    if (!list.length) return { ok: true };
    const cfg = requireSheetsConfig();
    return await withSheetsSyncLock(async () => {
      // Đẩy lịch mới lên TRƯỚC rồi mới đánh dấu 'Đã xử lý' → điện thoại không có lúc thẻ "Chờ PC" biến mất mà lịch chưa kịp hiện.
      try { await pushTonKhoLenSheet(['LX']); } catch (err) { console.error('Loi day lich xuat len Sheet sau khi nhan yeu cau dien thoai:', err.message); }
      const t = await sheetsSync.readTable(cfg, SH_TAB.LX_YC);
      const byId = new Map(list.map(r => [String(r.id), r]));
      const xuLyLuc = new Date().toISOString(), updates = [];
      t.rows.forEach(h => {
        const id = String(h.id || '').trim(), r = byId.get(id); if (!r) return;
        updates.push({ rowNumber: h._rowNumber, id, values: { trangThai: r.ok ? TRANG_THAI_DA_XU_LY : 'Lỗi - ' + String(r.error || 'không rõ').slice(0, 200), xuLyLuc } });
      });
      await sheetsSync.markRowsProcessed(cfg, SH_TAB.LX_YC, t.headers, updates);
      list.forEach(r => lxInFlight.delete(String(r.id)));
      return { ok: true, updated: updates.length };
    });
  } catch (err) {
    logError('Ghi nhận yêu cầu lịch xuất nhập từ điện thoại', err);
    return { ok: false, error: err.message };
  }
});

// PC 8.22 — EMAIL → LỊCH XUẤT (PC 8.28: thêm hanhDong 'xe' = thư "Thông tin xe", PC tự điền vào phiếu xuất — xem js/lich-xuat-cont.js › emXe). Apps Script (Code.gs › emailQuet_) đọc Gmail, ghi đề xuất vào tab LichXuat_Email (trangThai trống = chờ duyệt).
// Trang chính (js/lich-xuat-cont.js, nút "✉ Email") lấy danh sách qua 'lx:email-list' (scan=true → bảo Apps Script quét Gmail ngay), người dùng duyệt / bỏ qua
// rồi báo lại qua 'lx:email-ack' → đánh dấu 'Đã duyệt' / 'Bỏ qua' / 'Lỗi - …'. Chỉ MÁY CHỦ chạy handler này (có cấu hình Web App); máy con LAN gọi được vì lan.js chuyển 2 kênh lx:email-* sang máy chủ (PC 8.39) — quyền LX_EMAIL vẫn kiểm theo tài khoản đăng nhập trên máy con (PC_GUARD nằm ngoài cùng).
let lxEmTabReady = false;
// Kho Lạnh 1.5: EMAIL ĐÃ BẬT LẠI. Đổi EMAIL_TAM_DUNG = true nếu cần tạm dừng.
const EMAIL_TAM_DUNG = false;
ipcMain.handle('lx:email-list', async (event, opts) => {
  if (EMAIL_TAM_DUNG) return { ok: false, paused: true, rows: [], error: 'Email đang tạm dừng' };
  try {
    const cfg = requireSheetsConfig();
    if (!lxEmTabReady) { await sheetsSync.ensureTabs(cfg, { [SH_TAB.LX_EM]: sheetsSync.LX_EM_HEADERS }); lxEmTabReady = true; }
    if (opts && opts.history) { // PC 8.27: thư đã duyệt / bỏ qua / lỗi (Apps Script giữ 14 ngày) — để xem lại, hoàn tác
      const th = await sheetsSync.readTable(cfg, SH_TAB.LX_EM);
      const rows = th.rows.filter(r => String(r.id || '').trim() && String(r.trangThai || '').trim()).map(r => ({
        id: String(r.id).trim(), nhanLuc: String(r.nhanLuc || '').trim(), nguoiGui: String(r.nguoiGui || '').trim(), tieuDe: String(r.tieuDe || '').trim(),
        lsx: String(r.lsx || '').trim(), hanhDong: ['tao', 'doi', 'huy', 'xe'].includes(String(r.hanhDong).trim()) ? String(r.hanhDong).trim() : 'khac',
        ngay: String(r.ngay || '').trim().slice(0, 10), gio: String(r.gio || '').trim(), ghiChu: String(r.ghiChu || '').trim(),
        trangThai: String(r.trangThai || '').trim(), xuLyLuc: String(r.xuLyLuc || '').trim(),
      })).sort((a, b) => (a.xuLyLuc < b.xuLyLuc ? 1 : a.xuLyLuc > b.xuLyLuc ? -1 : 0)).slice(0, 150);
      return { ok: true, rows };
    }
    let scanned = null;
    if (opts && opts.scan) scanned = await sheetsSync.emailQuet(cfg);
    const t = await sheetsSync.readTable(cfg, SH_TAB.LX_EM);
    const rows = t.rows.filter(r => String(r.id || '').trim() && !String(r.trangThai || '').trim()).slice(-200).map(r => ({
      id: String(r.id).trim(), nhanLuc: String(r.nhanLuc || '').trim(), nguoiGui: String(r.nguoiGui || '').trim(), tieuDe: String(r.tieuDe || '').trim(),
      lsx: String(r.lsx || '').trim(), hanhDong: ['tao', 'doi', 'huy', 'xe'].includes(String(r.hanhDong).trim()) ? String(r.hanhDong).trim() : 'khac',
      ngay: String(r.ngay || '').trim().slice(0, 10), gio: String(r.gio || '').trim(), ghiChu: String(r.ghiChu || '').trim(),
    })).sort((a, b) => (a.nhanLuc < b.nhanLuc ? -1 : a.nhanLuc > b.nhanLuc ? 1 : 0));
    return { ok: true, rows, moi: scanned ? scanned.moi : null };
  } catch (err) {
    logError('Đọc hộp thư email lịch xuất', err);
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('lx:email-ack', async (event, results) => {
  if (EMAIL_TAM_DUNG) return { ok: false, paused: true, error: 'Email đang tạm dừng' };
  try {
    const list = (Array.isArray(results) ? results : []).filter(r => r && r.id).slice(0, 200);
    if (!list.length) return { ok: true };
    const cfg = requireSheetsConfig();
    return await withSheetsSyncLock(async () => {
      const t = await sheetsSync.readTable(cfg, SH_TAB.LX_EM);
      const byId = new Map(list.map(r => [String(r.id), r]));
      const xuLyLuc = new Date().toISOString(), updates = [];
      t.rows.forEach(h => {
        const id = String(h.id || '').trim(), r = byId.get(id); if (!r) return;
        const st = r.restore ? '' : (r.ok === false ? 'Lỗi - ' + String(r.error || 'không rõ').slice(0, 200) : (r.boQua ? 'Bỏ qua' : 'Đã duyệt')); // restore (PC 8.27) = đưa về Chờ duyệt
        updates.push({ rowNumber: h._rowNumber, id, values: { trangThai: st, xuLyLuc: r.restore ? '' : xuLyLuc } });
      });
      await sheetsSync.markRowsProcessed(cfg, SH_TAB.LX_EM, t.headers, updates);
      return { ok: true, updated: updates.length };
    });
  } catch (err) {
    logError('Ghi nhận duyệt email lịch xuất', err);
    return { ok: false, error: err.message };
  }
});

// KEO (pull) cac phieu xuat MOI do dien thoai tao ve Module 01/02.
async function pullPhieuXuatVeLocalInner() {
  const cfg = requireSheetsConfig();
  await sheetsSync.ensureTabs(cfg, allSyncTabs([]));
  try { await dispatchLichXuatRequests(cfg); } catch (err) { console.error('Loi kiem tra yeu cau lich xuat tu dien thoai:', err.message); } // PC 7.63

  const px = await sheetsSync.readTable(cfg, SH_TAB.PX);
  // Phieu cho xu ly = trangThai trong hoac "Chưa xử lý" (khong phai "Đã xử lý"/"Lỗi - ...").
  const pending = px.rows.filter(h => {
    const t = String(h.trangThai || '').trim();
    return String(h.id || '').trim() && t !== TRANG_THAI_DA_XU_LY && !t.startsWith('Lỗi');
  });

  let soPhieuMoi = 0;
  let soPhieuLoi = 0;
  const importErrors = [];
  const modulesMoi = new Set();
  if (pending.length) {
    const pxi = await sheetsSync.readTable(cfg, SH_TAB.PXI);
    const itemsBy = {};
    pxi.rows.forEach(it => {
      const pid = String(it.phieuId || '').trim();
      if (!pid) return;
      (itemsBy[pid] = itemsBy[pid] || []).push({
        maHang: String(it.maHang ?? ''), tenHang: String(it.tenHang ?? ''),
        phieuNhap: String(it.phieuNhap ?? ''), soLo: String(it.soLo ?? ''), size: String(it.size ?? ''),
        soKien: syncToNumber(it.soKien), soLuongXuat: syncToNumber(it.soLuongXuat),
        itemKey: String(it.itemKey ?? ''), rowIndex: it.rowIndex, hopDong: String(it.hopDong ?? ''),
        viTri: String(it.viTri ?? ''),
      });
    });

    const list = [];
    const loiUpdates = [];
    const now = Date.now();
    pending.forEach(h => {
      const id = String(h.id).trim();
      const items = (itemsBy[id] || []).filter(it => it.soLuongXuat > 0);
      const ngayTao = sheetValueToIso(h.ngayTao);
      if (!items.length) {
        // Dien thoai ghi dong hang TRUOC roi moi ghi dau phieu, nen phieu khong co dong hang la
        // phieu hong. Cho 10 phut (phong khi dang ghi do) roi moi danh dau loi.
        if (now - new Date(ngayTao).getTime() > 10 * 60 * 1000) {
          loiUpdates.push({ rowNumber: h._rowNumber, id: String(h.id).trim(), values: { trangThai: TRANG_THAI_LOI_THIEU_DONG, xuLyLuc: new Date().toISOString() } });
        }
        return;
      }
      list.push({
        id, maPhieu: String(h.maPhieu || '').trim(), ngayTao,
        nguoiTao: String(h.nguoiTao || ''), ghiChu: String(h.ghiChu || ''), items,
        module: ['M01', 'M01VT', 'M01VTB', 'M03', 'M04'].includes(String(h.module || '').trim()) ? String(h.module).trim() : 'M02',
        lsxXuat: String(h.lsxXuat || '').trim(),
        _rowNumber: h._rowNumber,
      });
    });

    // Moi module nhap rieng; 1 module loi khong chan module kia — phieu nao da nhap xong thi
    // danh dau ngay, phieu cua module loi giu "Chưa xử lý" de lan sau thu lai.
    const done = new Set();
    const groups = [
      { dbKey: 'module2', mod: 'M02', label: 'Module 02', apply: applyPhonePhieuDirectToExcel },
      { dbKey: 'module1', mod: 'M01', label: 'Module 01', apply: applyPhonePhieuM1DirectToExcel, kind: 'tonkhoanan' },
      { dbKey: 'module1', mod: 'M01VT', label: 'Module 01 (Tồn theo vị trí)', apply: applyPhonePhieuVTDirectToExcel, kind: 'vitri' },
      { dbKey: 'module1', mod: 'M01VTB', label: 'Module 01 (Vị Trí Bột)', apply: applyPhonePhieuVTBDirectToExcel, kind: 'vitribot' },
      { dbKey: 'module3', mod: 'M03', label: 'Module 03', apply: applyPhonePhieuM3DirectToExcel },
      { dbKey: 'module4', mod: 'M04', label: 'Module 04', apply: applyPhonePhieuM4DirectToExcel },
    ];
    for (const g of groups) {
      const part = list.filter(p => p.module === g.mod);
      if (!part.length) continue;
      try {
        const result = await importPhieuIntoModule(g.dbKey, part.map(({ _rowNumber, module, ...p }) => p), g.apply, g.kind);
        if (!result || !result.ok) throw new Error((result && result.error) || 'không rõ lỗi');
        if (result.newCount) lan.noteChange(g.dbKey, [], { id: 'dien-thoai', name: 'Điện thoại' }); // máy chủ LAN: báo máy con có dữ liệu mới
        soPhieuMoi += result.newCount || 0;
        // Phieu vua duoc danh dau "Đã xử lý" (ke ca khi module da co san phieu nen newCount = 0) deu phai day lai ton,
        // neu khong dien thoai se ket o "PC đã nhận, đang cập nhật tồn" mai mai.
        if (result.newCount || (result.importedIds || []).length) modulesMoi.add(g.mod);
        (result.importedIds || []).forEach(x => done.add(String(x)));
      } catch (err) {
        importErrors.push(`${g.label}: ${err.message}`);
      }
    }
    const xuLyLuc = new Date().toISOString();
    const okUpdates = list.filter(p => done.has(p.id))
      .map(p => ({ rowNumber: p._rowNumber, id: p.id, values: { trangThai: TRANG_THAI_DA_XU_LY, xuLyLuc } }));
    await sheetsSync.markRowsProcessed(cfg, SH_TAB.PX, px.headers, okUpdates);
    if (loiUpdates.length) {
      await sheetsSync.markRowsProcessed(cfg, SH_TAB.PX, px.headers, loiUpdates);
      soPhieuLoi = loiUpdates.length;
    }
  }
  if (importErrors.length) throw new Error('Nhập phiếu chưa xong — ' + importErrors.join(' | '));

  // Tu chua: phieu da "Đã xử lý" nhung xuLyLuc van SAU moc day ton cua bang do (lan day truoc bi loi/bo sot)
  // -> dien thoai dang ket o "đang cập nhật tồn". Them bang do vao danh sach can day lai.
  try {
    const metaNow = {};
    (await sheetsSync.readTable(cfg, SH_TAB.META)).rows.forEach(r => { if (r.key) metaNow[String(r.key)] = r.value; });
    const toMs = v => { const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; };
    px.rows.forEach(h => {
      if (String(h.trangThai || '').trim() !== TRANG_THAI_DA_XU_LY) return;
      const m = String(h.module || '').trim();
      const mod = SYNC_TABLES.includes(m) ? m : 'M02';
      const xl = toMs(h.xuLyLuc);
      const lp = toMs(metaNow['lastPushAt_' + mod] || metaNow.lastPushAt);
      if (xl && xl > lp) modulesMoi.add(mod);
    });
  } catch (err) { console.error('Khong kiem tra duoc phieu ket cho cap nhat ton:', err.message); }

  await maybeArchivePhieu(cfg);
  const cfgOut = patchSheetsConfig({ lastPullAt: new Date().toISOString(), lastPullOk: true, lastPullError: null, lastPullNew: Number(soPhieuMoi) || 0 });
  return { cfg: cfgOut, soPhieuMoi, soPhieuLoi, modulesMoi: [...modulesMoi] };
}

// LƯU TRỮ PHIẾU CŨ trên Google Sheet (09/2026) — tối đa 1 lần/ngày, chạy SAU khi kéo + đánh dấu phiếu xong và vẫn
// trong khóa đồng bộ (withSheetsSyncLock) nên không chen giữa lúc PC đọc tab ↔ đánh dấu dòng. Phiếu đã xong > 90 ngày
// chuyển sang tab PhieuXuat_LuuTru / PhieuXuatItems_LuuTru (Code.gs pcArchive_) → 2 tab chính không phình mãi.
// Lỗi (VD Code.gs cũ chưa có pc.archive) chỉ ghi nhật ký, KHÔNG làm hỏng lần kéo phiếu.
const PHIEU_ARCHIVE_DAYS = 90;
async function maybeArchivePhieu(cfg) {
  const today = new Date().toISOString().slice(0, 10);
  if (String(loadSheetsConfig().lastArchiveDay || '') === today) return;
  try {
    const r = await sheetsSync.archivePhieu(cfg, PHIEU_ARCHIVE_DAYS);
    patchSheetsConfig({ lastArchiveDay: today, lastArchiveMoved: (r && r.moved) || 0 });
  } catch (err) {
    console.error('Luu tru phieu cu tren Sheet loi:', err.message);
    logError('Lưu trữ phiếu cũ trên Google Sheet', err);
    patchSheetsConfig({ lastArchiveDay: today }); // thử lại vào ngày mai, không gọi lặp mỗi lần kéo phiếu
  }
}

async function pullPhieuXuatVeLocal() {
  try {
    return await pullPhieuXuatVeLocalInner();
  } catch (err) {
    patchSheetsConfig({ lastPullAt: new Date().toISOString(), lastPullOk: false, lastPullError: err.message });
    throw err;
  }
}

// Moi thao tac dong bo (tu dong / bam tay) chay NOI TIEP nhau, khong bao gio chong len nhau.
let sheetsSyncChain = Promise.resolve();
function withSheetsSyncLock(fn) {
  const run = sheetsSyncChain.then(fn, fn);
  sheetsSyncChain = run.catch(() => {});
  return run;
}

// 1 vong dong bo day du: KEO phieu ve truoc, roi DAY ton (da tru phieu vua nhap) len sau.
// Cac bang dang tick o Cai Dat (syncPick) — vong tu dong CHI day cac bang nay (+ bang vua nhan phieu),
// khong day ca M03/M04 khi nguoi dung da bo tick (dien thoai dang an 2 kho do).
function pickedSyncTables(extra) {
  const pick = loadSheetsConfig().syncPick || {};
  const set = new Set(SYNC_TABLES.filter(t => pick[t] !== false));
  (extra || []).forEach(t => { if (SYNC_TABLES.includes(t)) set.add(t); });
  return [...set];
}

async function runSheetsSyncCycle() {
  let pullResult = null;
  try {
    pullResult = await pullPhieuXuatVeLocal();
  } catch (err) {
    console.error('Loi keo phieu xuat ve:', err.message);
  }
  try {
    const tables = pickedSyncTables(pullResult && pullResult.modulesMoi);
    if (tables.length) await pushTonKhoLenSheet(tables);
  } catch (err) {
    console.error('Loi day ton kho len Sheet:', err.message);
  }
  return pullResult;
}

let sheetsSyncTimer = null;
let sheetsSyncStartupTimer = null;
let sheetsAutoQueued = false;
// PC 7.41 — CHU KY TU DONG THEO TUNG MUC (cot "Tu dong" o Cong cu > Dong bo dien thoai).
// autoPick = { pull: phut, M01: phut, ..., LX: phut } — 0 / thieu = TAT. Cau hinh cu chua co autoPick thi dung
// intervalMinutes chung cho cac muc dang tick (giu hanh vi cu).
const AUTO_KEYS = ['pull'].concat(SYNC_TABLES);
const AUTO_MINUTES_OK = [0, 1, 5, 10, 15, 30, 60, 120];
function getAutoPick(cfg) {
  const out = {};
  if (cfg.autoPick && typeof cfg.autoPick === 'object') {
    AUTO_KEYS.forEach(k => { const m = Number(cfg.autoPick[k]); out[k] = AUTO_MINUTES_OK.includes(m) ? m : 0; });
    return out;
  }
  const legacy = Number(cfg.intervalMinutes) > 0 ? Number(cfg.intervalMinutes) : 0;
  const pick = cfg.syncPick || {};
  AUTO_KEYS.forEach(k => { out[k] = legacy && (k === 'pull' || pick[k] !== false) ? legacy : 0; });
  return out;
}
const sheetsAutoLastRun = {}; // key -> thoi diem (ms) lan chay tu dong gan nhat
function scheduleAutoSheetsSync() {
  if (sheetsSyncTimer) { clearInterval(sheetsSyncTimer); sheetsSyncTimer = null; }
  if (sheetsSyncStartupTimer) { clearTimeout(sheetsSyncStartupTimer); sheetsSyncStartupTimer = null; }
  if (lan.isClient()) return; // máy con LAN: CHỈ máy chủ đồng bộ điện thoại (máy con đẩy tồn cũ sẽ ghi đè tồn đúng)
  const cfg = loadSheetsConfig();
  const ap = getAutoPick(cfg);
  if (!(cfg.webAppUrl && cfg.pcToken && AUTO_KEYS.some(k => ap[k] > 0))) return;
  const tick = () => {
    if (sheetsAutoQueued) return; // vong truoc chua xong thi bo qua, khong xep hang don
    const c = loadSheetsConfig();
    const cur = getAutoPick(c);
    const now = Date.now();
    const due = AUTO_KEYS.filter(k => cur[k] > 0 && now - (sheetsAutoLastRun[k] || 0) >= cur[k] * 60 * 1000 - 5000);
    if (!due.length) return;
    due.forEach(k => { sheetsAutoLastRun[k] = now; });
    sheetsAutoQueued = true;
    withSheetsSyncLock(async () => {
      let pullResult = null;
      if (due.includes('pull')) {
        try { pullResult = await pullPhieuXuatVeLocal(); } catch (err) { console.error('Loi keo phieu xuat ve:', err.message); }
      }
      // Bang den han + bang vua nhan phieu (de dien thoai thay dung so ton da tru)
      const set = new Set(due.filter(k => SYNC_TABLES.includes(k)));
      ((pullResult && pullResult.modulesMoi) || []).forEach(t => { if (SYNC_TABLES.includes(t)) set.add(t); });
      if (set.size) {
        try { await pushTonKhoLenSheet([...set]); } catch (err) { console.error('Loi day ton kho len Sheet:', err.message); }
      }
    }).finally(() => { sheetsAutoQueued = false; });
  };
  sheetsSyncStartupTimer = setTimeout(tick, 15 * 1000); // chay 1 lan ngay sau khi mo app (cho cac muc da bat)
  sheetsSyncTimer = setInterval(tick, 30 * 1000);       // kiem tra moi 30 giay xem muc nao den han
}

// ---------------------------------------------------------------------------
// MOI MODULE = 1 FILE EXCEL RIENG BIET (thay vi truoc day dung chung 1 database.xlsx cho
// tat ca). Ly do: de nguoi dung de dang backup/mo/sua thu cong dung DUNG file cua DUNG module
// can, khong so lam anh huong nham du lieu cua module khac khi thao tac tren Excel.
// "main" van la 1 file rieng cho Users/Passwords (man hinh Cai dat tai khoan chung, khong
// thuoc rieng module nao).
// ---------------------------------------------------------------------------
const DB_FILES = {
  module1: 'M01_TonKhoAnAn.xlsx',
  // Module 2 = "Tồn Kho Gửi" — ĐÚNG theo vị trí "Module 02" hiện tại trên Dashboard
  // (trước đây dùng dbKey riêng 'baoCaoTonKhoGui' để né trùng với 'module6' của Cài Đặt — nay
  // đánh số lại TOÀN BỘ dbKey cho khớp đúng vị trí hiển thị, không cần né tránh nữa).
  module2: 'M02_TonKhoGui.xlsx',
  module3: 'M03_NxtBotSot.xlsx',
  module4: 'M04_NxtTnkTgc.xlsx',
  module5: 'M05_SoLieuKiemKe.xlsx',
  module6: 'M06_InChungTuKho.xlsx',
  module7: 'M07_SoLieuCuoiKy.xlsx',
  module8: 'M08_TongHop.xlsx',
  // PC 0.63: Module 16 "Đối chiếu hàng ngày" (trước là M12 · Số liệu kho/xưởng, nằm trong nhóm Đối chiếu số liệu) — module RIÊNG, database RIÊNG.
  // Dữ liệu Kho / Xưởng đã đọc từ Excel (sheet DCX_*), file Excel gốc không bị đụng. Sheet DCX_* cũ ở M12_SoLieuKhoXuong.xlsx được chuyển sang đây 1 lần
  // (xem migrateDoiChieuHangNgayFromModule12) — M12 không còn dbKey.
  module16: 'M16_DoiChieuHangNgay.xlsx',
  // PC 7.94: Phiếu nhập/xuất kho (menu số 11) — danh sách phiếu đã lưu (sheet PNX_Phieu, mỗi phiếu 1 dòng JSON)
  module13: 'M13_PhieuNhapXuat.xlsx',
  // PC 8.57: Container Loading 3D (menu số 12) — container đã sửa / thêm (C3D_Container), phương án đã lưu (C3D_Plan), trạng thái làm việc (C3D_State)
  module14: 'M14_Container3D.xlsx',
  // Cài Đặt KHÔNG hiện dưới dạng 1 ô "Module 0X" đánh số trên Dashboard (mở qua nút "⚙ Cài đặt"
  // riêng) nên dùng dbKey tên riêng 'settings', không chiếm số thứ tự nào — tránh lặp lại đúng
  // vấn đề gây nhầm lẫn của bản trước (dbKey 'module6' từng vừa là Cài Đặt vừa lẫn với module
  // hiển thị ở vị trí khác).
  settings: 'CD_CaiDat.xlsx',
  // PC 7.31: Lịch xuất nhập hàng có database Excel RIÊNG (trước đó nằm chung file Cài Đặt, sheet LichXuatCont).
  // Sheet: LichXuatCont (từng lịch) + TongKetThang (tổng kết từng tháng — giữ lịch sử kể cả khi lịch lẻ bị xóa).
  lichxuat: 'LX_LichXuatNhap.xlsx',
};

// ---------------------------------------------------------------------------
// DI TRU TEN FILE CU SANG TEN MOI (chi doi TEN FILE, KHONG dong gi den NOI DUNG ben trong) —
// bat buoc phai chay TRUOC ensureDatabase(), vi dbKey/vi tri module da duoc DANH SO LAI cho
// khop dung thu tu hien tai tren Dashboard (xem lich su thay doi). Neu khong co buoc nay, app
// se tuong nham la "chua co database" o dbKey moi va tao file RONG de, trong khi du lieu that
// cua nguoi dung van con nguyen trong file mang TEN CU — gay cam giac "mat du lieu" dù thuc ra
// file cu van con tren dia, chi la app dang tim sai ten.
// Dinh dang: [ten file CU, ten file MOI]. Chi doi ten khi: file CU ton tai VA file MOI CHUA co
// (neu file MOI da co san tuc la da di tru roi hoac nguoi dung tu tao moi - khong dong vao).
const DB_FILE_MIGRATIONS = []; // Kho Lạnh 1.0: database mới hoàn toàn — không đổi tên / mang theo file của bản 8.x
function migrateDbFileNames() {
  if (!fs.existsSync(DB_DIR)) return; // lan chay dau tien, chua co gi de di tru ca
  DB_FILE_MIGRATIONS.forEach(([oldName, newName]) => {
    const oldPath = path.join(DB_DIR, oldName);
    const newPath = path.join(DB_DIR, newName);
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      try {
        fs.renameSync(oldPath, newPath);
      } catch (err) {
        // Doi ten that bai (VD file CU dang mo bang Excel tren Windows) -> CHEP sang ten moi, giu file cu.
        // Neu khong, ensureDatabase() se tao file RONG o ten moi va nguoi dung tuong "mat du lieu".
        try { fs.copyFileSync(oldPath, newPath); }
        catch (err2) { console.error(`Loi di tru database "${oldName}" -> "${newName}":`, err.message, '|', err2.message); }
      }
    }
  });
}

// ---------------------------------------------------------------------------

function resolveDbPath(dbKey) {
  const fileName = DB_FILES[dbKey];
  if (!fileName) throw new Error(`Khong nhan dien duoc database key: "${dbKey}"`);
  return path.join(DB_DIR, fileName);
}

// ---------------------------------------------------------------------------
// DI TRU DU LIEU "Nhap Lieu" BI GHI NHAM VAO MODULE 4 (LOI o ban truoc cua
// html/js/nhap-lieu-module.js: dung nham dbKey 'module4' thay vi 'module5' de ghi 2 sheet
// NhapLieuPages/NhapLieuTransferred). Neu may nay tung chay ban co loi do, du lieu that cua
// nguoi dung dang nam LAN trong file module4_nxttnktgc.xlsx (file cua module NXT - TNK/TGC,
// hoan toan khac). Ham nay CHI CO TAC DUNG khi con dau vet loi (2 sheet la ten do trong
// module4), tu dong sao chep dung du lieu do ve file module5_doichieukhohang.xlsx (noi no
// thuc su thuoc ve). Nguyen tac AN TOAN giong het cac ham di tru khac trong file nay: KHONG
// BAO GIO ghi de neu module5 da co san du lieu that o sheet do, va KHONG xoa gi ben module4 -
// chi copy, giu nguyen ban goc lam du phong.
function migrateNhapLieuDataFromModule4() {
  try {
    const m4Path = resolveDbPath('module4');
    if (!fs.existsSync(m4Path)) return; // module4 chua duoc tao lan nao -> khong co gi de di tru

    const wb4 = XLSX.readFile(m4Path);
    const strayNames = ['NhapLieuPages', 'NhapLieuTransferred'];
    const strayPresent = strayNames.filter((n) => wb4.Sheets[n]);
    if (!strayPresent.length) return; // khong co dau vet loi -> may nay chua bao gio bi anh huong

    const m5Path = resolveDbPath('module5');
    const wb5 = fs.existsSync(m5Path) ? XLSX.readFile(m5Path) : XLSX.utils.book_new();
    let migratedAny = false;

    strayPresent.forEach((sheetName) => {
      const strayRows = sheetRows(wb4.Sheets[sheetName]);
      if (!strayRows.length) return; // sheet la nhung rong -> khong co gi thuc su de di tru

      const existingRows = wb5.Sheets[sheetName]
        ? sheetRows(wb5.Sheets[sheetName])
        : [];
      if (existingRows.length) {
        // module5 DA CO du lieu that o sheet nay roi -> KHONG dong vao de tranh chong/lan du
        // lieu; giu nguyen ca 2 noi, ghi log de nguoi dung tu doi chieu thu cong neu can.
        console.error(`[migrate] Bo qua "${sheetName}": module5 da co du lieu san, khong tu dong gop voi ban trong module4.`);
        return;
      }

      const newSheet = rowsToSheet(strayRows);
      if (wb5.Sheets[sheetName]) {
        delete wb5.Sheets[sheetName];
        wb5.SheetNames = wb5.SheetNames.filter((n) => n !== sheetName);
      }
      XLSX.utils.book_append_sheet(wb5, newSheet, sheetName);
      migratedAny = true;
      console.log(`[migrate] Da chuyen ${strayRows.length} dong "${sheetName}" tu module4 (nham) sang module5 (dung).`);
    });

    if (migratedAny) saveWorkbook(wb5, m5Path);
  } catch (err) {
    console.error('[migrate] Loi di tru du lieu Nhap Lieu tu module4 sang module5:', err.message);
  }
}

// ---------------------------------------------------------------------------
// PC 0.63 — "ĐỐI CHIẾU HÀNG NGÀY" (trước là M12 · Số liệu kho/xưởng, 1 tab trong nhóm Đối chiếu số liệu) thành module RIÊNG M16 với database RIÊNG
// M16_DoiChieuHangNgay.xlsx. Hàm này CHUYỂN 1 LẦN các sheet DCX_* (dữ liệu đã đọc, chuyển kho, sửa tay, file gốc DCX_Raw*) từ file cũ
// M12_SoLieuKhoXuong.xlsx sang file mới rồi XÓA các sheet đó khỏi file cũ.
// AN TOÀN: (1) chép sang file mới trước, ĐỌC LẠI file mới và so từng dòng với bản cũ — chỉ khi giống hệt mới xóa ở file cũ;
// (2) file mới đã có dữ liệu thật KHÁC ở sheet nào thì KHÔNG đụng sheet đó (cả 2 bên giữ nguyên, ghi log);
// (3) file cũ hết sheet thì chép 1 bản vào thư mục _ban-luu-hang-ngay rồi mới xóa file; (4) máy con LAN không chạy (máy chủ làm); lỗi gì cũng chỉ ghi log.
// ---------------------------------------------------------------------------
const DB_LEGACY_M12 = 'M12_SoLieuKhoXuong.xlsx';
function migrateDoiChieuHangNgayFromModule12() {
  try {
    if (typeof lan !== 'undefined' && lan && typeof lan.isClient === 'function' && lan.isClient()) return;
    const oldPath = path.join(DB_DIR, DB_LEGACY_M12);
    if (!fs.existsSync(oldPath)) return; // chưa từng có file cũ → không có gì để chuyển
    const wbOld = XLSX.readFile(oldPath);
    const names = (wbOld.SheetNames || []).filter((n) => /^DCX_/i.test(n));
    if (!names.length) return; // file cũ không còn sheet của module này
    const newPath = resolveDbPath('module16');
    const wbNew = fs.existsSync(newPath) ? XLSX.readFile(newPath) : XLSX.utils.book_new();
    const same = (a, b) => JSON.stringify(sheetRows(a)) === JSON.stringify(sheetRows(b));
    const done = []; // sheet đã nằm ĐÚNG ở file mới (vừa chép hoặc đã chép từ lần trước)
    let needSave = false;
    names.forEach((n) => {
      const cur = wbNew.Sheets[n];
      if (cur && sheetRows(cur).length) {
        if (same(cur, wbOld.Sheets[n])) { done.push(n); return; } // lần trước đã chép xong nhưng chưa kịp xóa ở file cũ
        console.error(`[migrate] Giu nguyen "${n}": M16 da co du lieu khac, khong tu dong ghi de / gop voi ban trong M12.`);
        return;
      }
      if (cur) { delete wbNew.Sheets[n]; wbNew.SheetNames = wbNew.SheetNames.filter((x) => x !== n); }
      XLSX.utils.book_append_sheet(wbNew, wbOld.Sheets[n], n);
      done.push(n); needSave = true;
    });
    if (!done.length) return;
    if (needSave) {
      saveWorkbook(wbNew, newPath);
      const chk = XLSX.readFile(newPath); // đọc lại từ đĩa để chắc chắn đã ghi đủ
      const bad = done.filter((n) => !chk.Sheets[n] || !same(chk.Sheets[n], wbOld.Sheets[n]));
      if (bad.length) { console.error('[migrate] M12 -> M16: ghi lai file moi khong khop o', bad.join(', '), '— GIU NGUYEN file cu.'); return; }
    }
    // Đã chắc chắn dữ liệu nằm đủ ở file mới → xóa các sheet này khỏi database cũ
    done.forEach((n) => { delete wbOld.Sheets[n]; });
    wbOld.SheetNames = wbOld.SheetNames.filter((n) => !done.includes(n));
    if (wbOld.Workbook && Array.isArray(wbOld.Workbook.Sheets)) wbOld.Workbook.Sheets = wbOld.Workbook.Sheets.filter((x) => wbOld.SheetNames.includes(x.name));
    if (wbOld.SheetNames.length) {
      saveWorkbook(wbOld, oldPath); // (lưu kèm bản chụp ngày của db-core)
    } else {
      try {
        const dir = path.join(DB_DIR, '_ban-luu-hang-ngay');
        fs.mkdirSync(dir, { recursive: true });
        const d = new Date(), pad = (x) => String(x).padStart(2, '0');
        fs.copyFileSync(oldPath, path.join(dir, `M12_SoLieuKhoXuong_truoc-khi-chuyen-sang-M16_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`));
      } catch (e) { console.error('[migrate] Khong chep duoc ban du phong file M12 cu:', e.message); return; }
      fs.unlinkSync(oldPath);
    }
    console.log(`[migrate] Da chuyen ${done.length} sheet (${done.join(', ')}) tu M12_SoLieuKhoXuong.xlsx sang ${path.basename(newPath)} va xoa khoi file cu.`);
  } catch (err) {
    console.error('[migrate] Loi chuyen du lieu Doi chieu hang ngay M12 -> M16:', err.message);
  }
}

// ---------------------------------------------------------------------------
// KHOI TAO CAC FILE DATABASE EXCEL (chi tao file nao CHUA TON TAI, khong ghi de du lieu cu
// cua file da co san)
// ---------------------------------------------------------------------------
function ensureDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  migrateDbFileNames(); // đổi tên file database CŨ sang tên MỚI trước khi tạo file thiếu — bắt
                         // buộc chạy trước mọi bước bên dưới để không mất dữ liệu cũ của người dùng.
  migrateNhapLieuDataFromModule4();
  migrateDoiChieuHangNgayFromModule12(); // PC 0.63: sheet DCX_* của Đối chiếu hàng ngày: M12 (cũ) -> M16 (mới)

  // Module 1 - Ton Kho An An: sheet "DacTinh" (module "Dac Tinh") - xem ghi chu chi tiet trong
  // ton-kho-an-an.html o cac ham persistDacTinh()/restoreDacTinh().
  const m1Path = resolveDbPath('module1');
  if (!fs.existsSync(m1Path)) {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Đặc Tính', 'Nhóm đã gộp']]);
    XLSX.utils.book_append_sheet(wb, sheet, 'DacTinh');
    saveWorkbook(wb, m1Path);
  }

  // Module 2 - "Tồn Kho Gửi" (đúng vị trí "Module 02" hiện tại trên Dashboard — xem
  // index.html): cac sheet tuong ung persistedRows/pxPhieuList/dtManualRows/dtGroupMap trong
  // ton-kho-gui.html (xem cac ham hydrate...FromDb()/save...() trong file do).
  // "DanhSach_Nhom" la sheet THAM KHAO tinh (danh sach 23 nhom co dinh DT_GROUPS da co san
  // trong code) - chi tao 1 lan luc khoi tao, KHONG duoc doc/ghi lai boi app (writeSheet() chi
  // dong lai dung sheet duoc goi ten, nen sheet nay luon giu nguyen qua cac lan luu khac).
  const m2Path = resolveDbPath('module2');
  if (!fs.existsSync(m2Path)) {
    const wb = XLSX.utils.book_new();
    const duLieuHeaders = ['Mã hàng', 'Tên hàng', 'Số lô', 'Size', 'Quy cách',
      'Ngày nhập kho', 'Phiếu nhập/Voucher', 'Số kiện', 'Trọng Lượng (KG)'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([duLieuHeaders]), 'DuLieuChinh');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['id', 'maPhieu', 'ngayTao']]), 'PhieuXuat');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['phieuId', 'maHang', 'tenHang',
      'phieuNhap', 'soLo', 'size', 'soKien', 'soLuongXuat']]), 'PhieuXuatItems');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Diễn giải đặc tính', 'Đặc tính']]), 'DacTinh_NhapTay');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Đặc tính', 'Nhóm đã gộp']]), 'DacTinh_NhomGop');
    const dtGroupsList = [
      'MKS', 'NHẬT, ASC, HQ, MỸ', 'NHẬT, ASC-A,B, HQ, MỸ', 'NHẬT, ASC-B, HQ, MỸ',
      'NHẬT, ASC, HQ', 'NHẬT, EU, HQ', 'NHẬT, ASC-A,B, HQ', 'NHẬT, ASC-B, HQ', 'NHẬT, ASC',
      'NHẬT, HQ', 'NHẬT, EU', 'ASC, HQ, MỸ', 'ASC-A, B, HQ, MỸ', 'ASC-B, HQ, MỸ', 'ASC, HQ',
      'ASC-A,B, HQ', 'ASC-B, HQ', 'ASC', 'EU, HQ, MỸ', 'EU, HQ', 'EU', 'HQ', 'KHÔNG ĐẠT',
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [['Nhóm đã gộp (cố định trong module)'], ...dtGroupsList.map(g => [g])]), 'DanhSach_Nhom');
    saveWorkbook(wb, m2Path);
  }

  // Module 3 - NXT Bot/Sot: cac sheet tuong ung STATE.config/lsx/tx/log trong nxt-bot-sot.html
  const m3Path = resolveDbPath('module3');
  if (!fs.existsSync(m3Path)) {
    const wb = XLSX.utils.book_new();
    ['FlourCodes', 'Locations', 'LSX', 'DinhMuc', 'Transactions', 'Log'].forEach(name => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), name);
    });
    saveWorkbook(wb, m3Path);
  }

  // Module 4 - NXT TNK/TGC: cac sheet tuong ung records/exportRecords/locationRecords/
  // categories/history trong nxt-hang-nhap-khau.html
  const m4Path = resolveDbPath('module4');
  if (!fs.existsSync(m4Path)) {
    const wb = XLSX.utils.book_new();
    ['NhapHang', 'XuatHang', 'ViTri', 'LoaiHang', 'LichSu', 'DacTinh'].forEach(name => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), name);
    });
    saveWorkbook(wb, m4Path);
  }

  // Module 5 - Doi Chieu Kho Hang: sheet cho module "Nhap Lieu" long ben trong (cac trang du
  // lieu da luu + danh sach id da chuyen sang "Bang So Lieu")
  const m5Path = resolveDbPath('module5');
  if (!fs.existsSync(m5Path)) {
    const wb = XLSX.utils.book_new();
    ['NhapLieuPages', 'NhapLieuTransferred'].forEach(name => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), name);
    });
    saveWorkbook(wb, m5Path);
  }

  // Module 6 - Chung Tu Xuat Kho: sheet "ThongTinPhieu" (cac bang cau hinh doc trong
  // chung-tu-xuat-kho.html)
  const m6Path = resolveDbPath('module6');
  if (!fs.existsSync(m6Path)) {
    const wb = XLSX.utils.book_new();
    ['TTB', 'Xa', 'Kiem'].forEach(name => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), name);
    });
    saveWorkbook(wb, m6Path);
  }

  // Module 7 - Số Liệu Kho/Kế Toán (viết lại 10/2026): tự quản lý các sheet DC_* của chính nó qua
  // window.dbAPI — xem html/quan-ly-kho/dc-store.js (sheet của bản cũ trong file vẫn được giữ nguyên). Ở đây chỉ cần tạo TRƯỚC file rỗng với sheet "Meta" placeholder để
  // file tồn tại sẵn ngay từ lần chạy đầu (giúp tính năng sao lưu nhận diện
  // được file dù người dùng chưa mở Module 7 lần nào).
  const m7Path = resolveDbPath('module7');
  if (!fs.existsSync(m7Path)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['khoi', 'headers', 'fileName', 'importedAt']]), 'Meta');
    saveWorkbook(wb, m7Path);
  }

  // Module 8 - "Tổng Hợp": gom 3 công cụ (Mã hóa sản phẩm, Dữ liệu tổng hợp, Báo cáo rã đông)
  // vốn trước đây tự lưu chung 1 khối JSON duy nhất vào localStorage của trình duyệt — nay
  // chuyển sang lưu 1 dòng JSON duy nhất trong sheet "State" (xem saveState()/loadState() trong
  // tong-hop.js) để dữ liệu nằm trong database Excel giống các module khác, không mất khi xóa
  // cache trình duyệt.
  const m8Path = resolveDbPath('module8');
  if (!fs.existsSync(m8Path)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tổ hợp', 'Mã', 'Tên']]), 'MaHoa');
    saveWorkbook(wb, m8Path);
  }

  // Cài Đặt: hien tai tab "Chuc nang 2" doc/ghi database cua cac module khac (khong dung
  // database rieng cua chinh no), tab "Chuc nang 3" con trong chua gan - file nay tao san 1
  // sheet rong, du dung ngay khi co tinh nang moi can luu du lieu rieng cho man hinh Cai Dat.
  const settingsPath = resolveDbPath('settings');
  if (!fs.existsSync(settingsPath)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');
    saveWorkbook(wb, settingsPath);
  }

  // Lịch xuất nhập hàng (PC 7.31): file riêng. Lần đầu CHÉP các lịch đang nằm trong settings_caidat.xlsx (sheet LichXuatCont) sang;
  // sheet cũ trong file Cài Đặt giữ nguyên làm bản dự phòng (không xóa).
  const lxPath = resolveDbPath('lichxuat');
  if (!fs.existsSync(lxPath)) {
    let old = [];
    try { old = dbCore.readSheetAt(settingsPath, 'LichXuatCont'); } catch (err) { console.error('Loi doc lich xuat cu trong settings:', err.message); }
    try { dbCore.writeSheetsAt(lxPath, { LichXuatCont: old, TongKetThang: [] }, DB_DIR); }
    catch (err) { console.error('Loi tao database lich xuat:', err.message); }
  }
}

// ---------------------------------------------------------------------------
// DOC MOT SHEET TU 1 FILE EXCEL (theo dbKey) -> tra ve mang object (JSON)
// ---------------------------------------------------------------------------
// BỘ NHỚ ĐỆM ĐỌC FILE EXCEL: XLSX.readFile phải giải nén + phân tích CẢ file dù chỉ cần 1 sheet nhỏ
// (file Module 1 ~9.000 dòng mất ~1 giây/lần) — trong khi 1 lần đồng bộ / mở module đọc cùng 1 file
// nhiều lần (LoadData, LoadDataMeta, ViTri, ViTriMeta…; Module 8 đọc 7 sheet). Giữ workbook đã phân
// tích theo (đường dẫn + thời điểm sửa + kích thước file): file đổi (app ghi, khôi phục, OneDrive đồng
// bộ…) thì tự đọc lại. Chỉ dùng cho ĐỌC (readSheet/listSheets) — hàm ghi luôn đọc file mới từ đĩa
// rồi xoá mục đệm của file đó. Giữ tối đa 4 file gần nhất để không tốn RAM.
// Lõi đọc/ghi Excel (ô dài, ghi nguyên tử, bản lưu hằng ngày, bộ đệm) nằm ở db-core.js — dùng chung với
// luồng phụ db-worker.js. Xem CLAUDE.md "Rà soát dài hạn".
const dbCore = require('./core/db-core');
const { wbCache, sheetRows, rowsToSheet, saveWorkbook, readWorkbookCached } = dbCore;
dbCore.setErrorLogger(logError);
// ===== LUỒNG PHỤ ĐỌC/GHI EXCEL (db-worker.js) — rà soát 09/2026 =====
// Lệnh đọc/ghi của giao diện (IPC db:*) giao cho luồng phụ → tiến trình chính KHÔNG còn đứng 1–2 giây mỗi lần
// phân tích / ghi file lớn. Luồng phụ lỗi / sập: tự khởi động lại; sập quá 3 lần thì chạy thẳng trên tiến
// trình chính như trước (dbInline*) — không bao giờ mất khả năng đọc/ghi. Thứ tự ghi từng file vẫn do
// queueWrite() giữ; ghi file luôn nguyên tử (db-core.saveWorkbook) nên luồng phụ sập giữa chừng không hỏng file.
const { Worker } = require('worker_threads');
let dbWorker = null, dbWorkerCrashes = 0, dbWorkerSeq = 0, dbWorkerStopping = false;
const dbWorkerPending = new Map();
function dbWorkerFailAll(err) {
  dbWorkerPending.forEach((p) => p.reject(err));
  dbWorkerPending.clear();
}
function getDbWorker() {
  if (dbWorker) return dbWorker;
  if (dbWorkerCrashes > 3) return null;
  try {
    const w = new Worker(path.join(__dirname, 'core', 'db-worker.js'));
    w.on('message', (m) => {
      if (m && m.log) { logError('Luồng phụ Excel › ' + m.log.where, m.log.message); return; }
      const p = m && dbWorkerPending.get(m.id);
      if (!p) return;
      dbWorkerPending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    });
    const onDead = (why) => (err) => {
      if (dbWorker !== w || dbWorkerStopping) return; // tắt chủ động lúc thoát app: không phải sự cố
      dbWorker = null; dbWorkerCrashes++;
      logError('Luồng phụ Excel dừng (' + why + ')', err);
      const e = new Error('Luồng đọc/ghi Excel bị dừng.'); e.workerDied = true;
      dbWorkerFailAll(e);
    };
    w.on('error', onDead('error'));
    w.on('exit', (code) => { if (code !== 0) onDead('exit ' + code)(new Error('exit ' + code)); else if (dbWorker === w) dbWorker = null; });
    dbWorker = w;
    return w;
  } catch (err) {
    dbWorkerCrashes++;
    logError('Không khởi động được luồng phụ Excel', err);
    return null;
  }
}
// Gửi 1 lệnh cho luồng phụ. Không có luồng phụ → trả về null (nơi gọi tự chạy bản trên tiến trình chính).
function dbWorkerCall(msg) {
  const w = getDbWorker();
  if (!w) return null;
  return new Promise((resolve, reject) => {
    const id = ++dbWorkerSeq;
    dbWorkerPending.set(id, { resolve, reject });
    try { w.postMessage({ ...msg, id }); }
    catch (err) { dbWorkerPending.delete(id); reject(err); }
  });
}
// Chạy qua luồng phụ; luồng phụ không có / sập giữa chừng → chạy lại NGAY trên tiến trình chính (lệnh đọc/ghi
// đều lặp lại được an toàn: ghi lại đúng dữ liệu đó lần nữa cho kết quả y hệt).
async function viaWorker(msg, inlineFn) {
  const p = dbWorkerCall(msg);
  if (!p) return inlineFn();
  try { return await p; }
  catch (err) { if (err && err.workerDied) return inlineFn(); throw err; }
}
async function readSheetAsync(dbKey, sheetName) {
  return viaWorker({ op: 'read', dbPath: resolveDbPath(dbKey), sheetName }, () => readSheet(dbKey, sheetName));
}
async function listSheetsAsync(dbKey) {
  return viaWorker({ op: 'list', dbPath: resolveDbPath(dbKey) }, () => listSheets(dbKey));
}

// NẠP SẴN (luồng phụ) toàn bộ sheet của các file sắp đọc ĐỒNG BỘ trên tiến trình chính (VD đẩy tồn lên
// Google Sheet: readSheet() gọi rải rác trong nhiều hàm) → readSheet() lấy từ rowsCache, không phải tự phân
// tích file. Mỗi mục kèm mtime/size đo TRƯỚC khi đọc: file đổi sau đó thì readSheet() tự đọc lại như cũ.
const rowsCache = new Map(); // dbPath -> { mtimeMs, size, sheets }
async function prefetchDbFiles(dbKeys) {
  await Promise.all([...new Set(dbKeys)].map(async (k) => {
    const dbPath = resolveDbPath(k);
    try {
      const p = dbWorkerCall({ op: 'readAll', dbPath });
      if (!p) return;
      const r = await p;
      if (!r || !r.exists) { rowsCache.delete(dbPath); return; }
      rowsCache.set(dbPath, { mtimeMs: r.mtimeMs, size: r.size, sheets: r.sheets });
      while (rowsCache.size > 6) rowsCache.delete(rowsCache.keys().next().value);
    } catch (err) { /* nạp sẵn lỗi: readSheet() tự đọc trực tiếp */ }
  }));
}

function readSheet(dbKey, sheetName) {
  const dbPath = resolveDbPath(dbKey);
  if (!fs.existsSync(dbPath)) return [];
  const rc = rowsCache.get(dbPath);
  if (rc) {
    const st = fs.statSync(dbPath);
    if (rc.mtimeMs === st.mtimeMs && rc.size === st.size) {
      return (rc.sheets[sheetName] || []).map((r) => ({ ...r })); // bản sao: nơi gọi sửa object không làm bẩn đệm
    }
    rowsCache.delete(dbPath);
  }
  const wb = readWorkbookCached(dbPath);
  return sheetRows(wb.Sheets[sheetName]);
}

// ---------------------------------------------------------------------------
// GHI MOT MANG OBJECT (JSON) VAO 1 SHEET CUA 1 FILE (theo dbKey), GIU NGUYEN CAC SHEET KHAC
// ---------------------------------------------------------------------------
// HANG DOI GHI (write queue) THEO TUNG dbKey: writeSheet() la thao tac "doc ca file -> sua 1
// sheet trong bo nho -> ghi de lai ca file". Neu 2 lenh ghi CUNG 1 file (dbKey) chay gan nhu
// dong thoi (vd 2 module con trong iframe cung ghi vao 1 database), lenh sau co the doc duoc
// noi dung CU (truoc khi lenh dau ghi xong) roi ghi de len, lam MAT thay doi cua lenh dau tien.
// De tranh, moi dbKey co 1 "hang doi" (Promise noi tiep nhau) - lenh ghi thu 2 chi thuc su bat
// dau doc file SAU KHI lenh ghi thu 1 da ghi xong hoan toan, dam bao khong con doc-ghi chong lan.
const writeQueues = {};
// Chờ hàng đợi ghi của các file (tối đa ms) — dùng trước khi ĐỌC file để đẩy lên điện thoại.
function waitDbWrites(dbKeys, ms) {
  const qs = [...new Set(dbKeys || [])].map(k => writeQueues[k]).filter(Boolean);
  if (!qs.length) return Promise.resolve();
  return Promise.race([Promise.all(qs), new Promise(r => setTimeout(r, ms || 15000))]);
}
function queueWrite(dbKey, taskFn) {
  const prev = writeQueues[dbKey] || Promise.resolve();
  const next = prev.then(taskFn, taskFn); // chay taskFn du lenh truoc thanh cong hay loi
  writeQueues[dbKey] = next.catch(() => {}); // khong de 1 loi lam "ket" hang doi cho cac lenh sau
  return next;
}

// CẬP NHẬT PHIÊN BẢN NGAY TRONG APP từ GitHub (Cài Đặt › Cập nhật) — xem updater.js. Chỉ thay file code,
// không đụng database/; khởi động lại sau khi các lệnh ghi Excel đang xếp hàng đã xong.
require('./core/updater')({ app, ipcMain, appDir: __dirname, logError,
  waitWrites: () => Promise.all(Object.values(writeQueues)),
  onBeforeRestart: () => forceLogoutAfterUpdate() }); // PC 7.47: cập nhật / quay lại bản cũ xong → đăng xuất (bản điện thoại không bị ảnh hưởng)

// PC 7.61 — LỊCH SỬ THAO TÁC (lich-su.js): ghi thêm / sửa / xóa dữ liệu, nhập / xuất file, đăng nhập… kèm tài khoản + máy + giờ.
const lichSu = require('./core/lich-su')({ getDir: () => DB_DIR, logError });
let histActiveModule = 'Trang chính'; // module đang mở (trang chính báo qua history:set-context) — dùng cho file xuất (will-download)
// Người thao tác của 1 lệnh IPC: máy này → tài khoản đang đăng nhập; máy con LAN (máy chủ nhận) → tài khoản máy con gửi kèm.
const histCtxOf = (event) => (event && event.__remote)
  ? { remote: true, tk: String(event.__user || ''), may: String(event.__from || 'máy con') }
  : { remote: false, tk: authSessionTen || '', may: lichSu.machine };
function histWho(h) {
  let ten = '';
  try { if (h && !h.remote) { const u = findSessionUser(ensureDefaultAdmin(storedPerm())); if (u) ten = u.tenHienThi || u.ten || ''; } } catch (e) { /* bỏ qua */ }
  return { tk: (h && h.tk) || '', ten, may: (h && h.may) || lichSu.machine };
}
// Ghi 1 dòng "thao tác hệ thống" (đăng nhập, khôi phục…) — loai: 'dang-nhap' | 'dang-xuat' | 'he-thong' | 'nhap-file' | 'xuat-file'
function histNote(loai, mod, mota, extra, h) {
  try { lichSu.add(Object.assign({ loai, mod, mota }, histWho(h || histCtxOf(null)), extra || {})); } catch (e) { /* bỏ qua */ }
}

function writeSheet(dbKey, sheetName, dataArray) {
  return writeSheets(dbKey, { [sheetName]: Array.isArray(dataArray) ? dataArray : [] });
}

// ---------------------------------------------------------------------------
// GHI NHIỀU SHEET CÙNG LÚC trong 1 lần đọc/ghi file (qua cùng hàng đợi queueWrite) — sheets:
// { tênSheet: mảng object | null }. null = XOÁ sheet đó. Chạy ở luồng phụ (db-worker.js); luồng phụ không
// dùng được thì chạy thẳng ở đây (dbCore.writeSheetsAt — cùng 1 hàm, cùng kết quả).
async function writeSheetsNow(dbKey, sheets, from, hist) { // CHỈ gọi bên trong queueWrite(dbKey, …)
  const dbPath = resolveDbPath(dbKey);
  wbCache.delete(dbPath); rowsCache.delete(dbPath);
  const want = !!hist; // PC 7.61: lệnh ghi do NGƯỜI DÙNG (db:write-sheet/s) → so sánh cũ/mới để ghi Lịch sử
  let r = await viaWorker({ op: 'write', dbPath, sheets, dbDir: DB_DIR, wantDiff: want }, () => dbCore.writeSheetsAt(dbPath, sheets, DB_DIR, want));
  if (r && typeof r === 'object' && r.__ok) { // giữ nguyên giá trị trả về cũ (true) cho mọi nơi gọi
    try { const who = histWho(hist); lichSu.recordWrite(dbKey, r.diffs, who); } catch (e) { logError('Lịch sử (ghi dữ liệu)', e); }
    r = true;
  }
  wbCache.delete(dbPath); rowsCache.delete(dbPath);
  lan.noteChange(dbKey, Object.keys(sheets || {}), from || lan.me);
  return r;
}
function writeSheets(dbKey, sheets, from, hist) {
  return queueWrite(dbKey, () => writeSheetsNow(dbKey, sheets, from, hist));
}
// MÁY CHỦ LAN: ghi từ 1 khung trang (máy này hoặc máy con) — TỪ CHỐI nếu sheet trên máy chủ đã đổi so với lúc khung
// đó đọc (máy khác / điện thoại vừa sửa) → không âm thầm ghi đè. Kiểm tra + ghi + ghi nhận dấu mới trong CÙNG 1 lượt
// hàng đợi ghi, nên không có lệnh ghi nào chen giữa. Máy đơn → ghi như cũ.
class LanConflictError extends Error {}
// PC 0.58 — QUYỀN SỞ HỮU PHIẾU KIỂM KÊ (core/page-owner.js): chặn THẬT ở đây, trong hàng đợi ghi. Phiếu của người khác luôn giữ nguyên bản đang lưu;
// chỉ chủ phiếu / admin ghi được; phiếu mới đóng dấu chủ = tài khoản ghi (máy con LAN: tài khoản gửi kèm). Chỉ áp cho module5 (Nhập Liệu).
const pageOwner = require('./core/page-owner');
async function ownerFilterWrite(dbKey, sheets, hist, event) {
  if (dbKey !== 'module5' || !pageOwner.touches(sheets)) return sheets;
  const tk = String((hist && hist.tk) || '').trim().toLowerCase();
  const r = await pageOwner.apply(sheets, (name) => readSheetAsync('module5', name), { tk, admin: isAdminName(tk) });
  if (event) event.__ownerIgnored = r.ignored || 0;
  return r.sheets;
}
function writeSheetsFromReader(dbKey, sheets, event) {
  const hist = histCtxOf(event);
  if (!lan.isServer()) return queueWrite(dbKey, async () => writeSheetsNow(dbKey, await ownerFilterWrite(dbKey, sheets, hist, event), undefined, hist));
  const reader = lan.readerId(event);
  return queueWrite(dbKey, async () => {
    for (const name of Object.keys(sheets || {})) {
      const seen = lan.readHash(reader, dbKey, name);
      if (!seen) continue;
      const cur = lan.hashRows(await readSheetAsync(dbKey, name));
      if (cur !== seen) {
        throw new LanConflictError('Dữ liệu "' + name + '" vừa được máy khác / điện thoại thay đổi — bấm Làm mới (↻) để tải số liệu mới rồi làm lại. Thao tác vừa rồi CHƯA được lưu.');
      }
    }
    const r = await writeSheetsNow(dbKey, await ownerFilterWrite(dbKey, sheets, hist, event), lan.origin(event), hist);
    for (const name of Object.keys(sheets || {})) lan.recordRead(reader, dbKey, name, await readSheetAsync(dbKey, name));
    return r;
  });
}

// ---------------------------------------------------------------------------
// LIET KE TAT CA TEN SHEET HIEN CO TRONG 1 FILE (theo dbKey)
// ---------------------------------------------------------------------------
function listSheets(dbKey) {
  const dbPath = resolveDbPath(dbKey);
  if (!fs.existsSync(dbPath)) return [];
  const wb = readWorkbookCached(dbPath);
  return wb.SheetNames;
}

// ---------------------------------------------------------------------------
// TAO CUA SO UNG DUNG
// ---------------------------------------------------------------------------
let mainWindow;

// PC 7.88 — THƯ VIỆN CHƯA ĐÚNG BẢN (node_modules cũ: nút "Cập nhật" chỉ thay file code, không cài lại thư viện).
// Mở bằng Electron.vbs mới thì đã tự chạy Chay_Lan_Dau.bat; còn mở kiểu khác (shortcut cũ, npm start) thì nhắc ở đây.
// App VẪN chạy được với thư viện cũ (các trang tự dùng bản xlsx dự phòng trong app/lib) — chỉ là chưa có bản vá bảo mật.
function warnOutdatedLibs() {
  let r;
  try { r = require('./core/kiem-tra-thu-vien').check(); } catch (e) { return; }
  if (!r || r.ok) return;
  try { logError('Thư viện chưa đúng bản', new Error(r.reasons.join(' '))); } catch (e) { /* bỏ qua */ }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let nodeNote = '';
  try { const kt = require('./core/kiem-tra-thu-vien'); if (!kt.nodeOk()) nodeNote = '\n\n⚠ Máy đang có Node.js ' + process.versions.node + ' quá cũ — hãy cài Node.js bản LTS (từ ' + kt.NODE_MIN + ' trở lên) tại nodejs.org TRƯỚC, rồi mới chạy Chay_Lan_Dau.bat.'; } catch (e) { /* bỏ qua */ }
  dialog.showMessageBox(mainWindow, {
    type: 'warning', title: 'Cần cài bản thư viện mới', noLink: true,
    message: 'Bản app này cần thư viện mới (bản vá bảo mật) nhưng máy vẫn đang dùng bản cũ.',
    detail: r.reasons.join('\n') + '\n\nCách cài (cần Internet, tải khoảng 150 MB, chỉ 1 lần):\n1. Thoát hẳn app (máy chủ LAN: chuột phải biểu tượng ở khay › Thoát).\n2. Mở thư mục app, nhấp đúp "Chay_Lan_Dau.bat" và chờ cài xong — app tự mở lại.\n\nApp vẫn dùng bình thường trong lúc chưa cài.' + nodeNote,
    buttons: ['Đã hiểu', 'Mở thư mục app'], defaultId: 0, cancelId: 0,
  }).then((res) => { if (res && res.response === 1) require('electron').shell.openPath(__dirname); }).catch(() => {});
}

const WIN_LOGIN = { w: 460, h: 640 }, WIN_MAIN = { w: 1280, h: 820, minW: 900, minH: 600 };
// Renderer (auth-gate.js) báo "đang khóa / đã mở khóa" → đổi kích thước cửa sổ: khóa = cửa sổ nhỏ cố định, mở = cửa sổ lớn.
ipcMain.on('win:mode', (event, locked) => {
  try {
    const w = mainWindow;
    if (!w || w.isDestroyed() || event.sender !== w.webContents) return;
    if (locked) {
      if (w.isMaximized()) w.unmaximize();
      w.setResizable(false); w.setMaximizable(false); w.setMinimumSize(1, 1);
      w.setContentSize(WIN_LOGIN.w, WIN_LOGIN.h); w.center();
    } else {
      w.setResizable(true); w.setMaximizable(true); w.setMinimumSize(WIN_MAIN.minW, WIN_MAIN.minH);
      w.setContentSize(WIN_MAIN.w, WIN_MAIN.h); w.center();
    }
  } catch (e) { /* bỏ qua */ }
});

function createWindow() {
  const winOptions = {
    // 1.10: lúc CHƯA đăng nhập chỉ hiện cửa sổ nhỏ (khung đăng nhập); đăng nhập xong mới phóng ra cửa sổ lớn — xem 'win:mode' bên dưới.
    width: WIN_LOGIN.w,
    height: WIN_LOGIN.h,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    center: true,
    autoHideMenuBar: true, // an thanh menu mac dinh cua Electron, giu giao dien sach
    show: false, // chi hien khi da nap xong (ready-to-show) de tranh nhay man hinh trang luc khoi dong
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Bat buoc phai co: mac dinh Electron CHI chay preload.js (va vi vay window.dbAPI) o
      // khung chinh (index.html) - KHONG tu dong chay trong iframe con. Cac module duoc nhung
      // vao index.html qua <iframe> (ke ca iframe long ben trong module 6), nen neu khong bat
      // dong nay thi window.dbAPI se la "undefined" ben trong cac module do, moi loi goi
      // doc/ghi database Excel se loi ngay lap tuc.
      nodeIntegrationInSubFrames: true
    }
  };

  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  if (fs.existsSync(iconPath)) {
    winOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(winOptions);
  mainWindow.loadFile(path.join(__dirname, 'html', 'index.html'));

  // PC 7.18 — Electron là cửa vào duy nhất: chỉ cho điều hướng trong thư mục html/ của app; không cho mở cửa sổ mới.
  // Link http(s) bên ngoài mở bằng trình duyệt mặc định (chỉ http/https). Mọi thứ khác bị chặn.
  const HTML_ROOT = path.join(__dirname, 'html');
  const isAppUrl = (u) => {
    try {
      const x = new URL(u);
      if (x.protocol !== 'file:') return false;
      const f = path.resolve(require('url').fileURLToPath(x));
      return f === HTML_ROOT || f.startsWith(HTML_ROOT + path.sep);
    } catch (e) { return false; }
  };
  const openExternalSafe = (u) => { try { if (/^https?:\/\//i.test(u)) require('electron').shell.openExternal(u); } catch (e) { /* bỏ qua */ } };
  mainWindow.webContents.on('will-navigate', (e, u) => { if (!isAppUrl(u)) { e.preventDefault(); openExternalSafe(u); } });
  // Khung con (iframe module): chặn file:// ngoài thư mục html/ và http(s); vẫn cho about:, blob:, data: (in ấn / xuất file dùng).
  mainWindow.webContents.on('will-frame-navigate', (e) => {
    const u = String(e.url || '');
    if (/^(about|blob|data):/i.test(u)) return;
    if (!isAppUrl(u)) e.preventDefault();
  });
  // Cửa sổ mới: chỉ cho blob:/about:blank do chính app tạo (xem trước / in chứng từ — chung-tu-xuat-kho.js › openPrintTab); không nạp preload.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(blob:|about:blank$)/i.test(String(url || ''))) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true } } };
    }
    openExternalSafe(url);
    return { action: 'deny' };
  });

  // Mở bằng cờ --hidden (máy chủ LAN tự chạy khi bật máy tính) → không hiện cửa sổ, chỉ có biểu tượng ở khay.
  mainWindow.once('ready-to-show', () => { if (!START_HIDDEN) { mainWindow.show(); setTimeout(warnOutdatedLibs, 2500); } });
  // MÁY CHỦ LAN: bấm ✕ = ẨN xuống khay (app vẫn chạy cho máy con). Thoát hẳn: chuột phải biểu tượng khay › Thoát.
  // Windows tắt máy / đăng xuất: cho đóng thật (không ẩn xuống khay), nếu không có thể chặn việc tắt máy.
  mainWindow.on('query-session-end', () => { appQuitting = true; });
  mainWindow.on('session-end', () => { appQuitting = true; });
  // PC 8.02 — SỬA LỖI TREO SAU KHI CẬP NHẬT: trang module có beforeunload (VD Phiếu nhập xuất đang sửa dở, S.dirty) khiến Electron
  // ÂM THẦM HUỶ việc đóng cửa sổ khi không có handler này → app.quit() sau Cập nhật không thoát được, cửa sổ đứng im, phải tắt bằng Task Manager.
  // Đang thoát / khởi động lại (appQuitting) → bỏ qua beforeunload. Người dùng tự bấm ✕ / F5 khi còn phiếu chưa lưu → hỏi rõ ràng thay vì im lặng.
  mainWindow.webContents.on('will-prevent-unload', (e) => {
    if (appQuitting) { e.preventDefault(); return; }
    let r = 0;
    try {
      r = dialog.showMessageBoxSync(mainWindow, { type: 'warning', buttons: ['Thoát, bỏ phần chưa lưu', 'Ở lại'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Còn dữ liệu chưa lưu', message: 'Đang có phiếu sửa dở chưa lưu.', detail: 'Thoát / tải lại bây giờ sẽ mất phần chưa lưu.' });
    } catch (err) { r = 0; }
    if (r === 0) e.preventDefault(); // preventDefault = bỏ qua beforeunload, cho phép đóng
  });
  mainWindow.on('close', (e) => {
    if (lan.isServer() && !appQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (serverTray && !trayHintShown) {
        trayHintShown = true;
        try { serverTray.displayBalloon({ title: 'Kho Lạnh vẫn đang chạy', content: 'Máy chủ Mạng LAN chạy ngầm để các máy con làm việc. Mở lại: bấm vào biểu tượng ở góc phải thanh taskbar.' }); } catch (err) { /* bỏ qua */ }
      }
    }
  });

  // Tai lai trang chinh = toan bo iframe module bi huy -> Module 02 phai dang ky lai.
  const resetImportFrames = () => { Object.keys(importFrames).forEach(k => { importFrames[k] = null; }); };
  mainWindow.webContents.on('did-navigate', resetImportFrames);
  mainWindow.webContents.on('render-process-gone', resetImportFrames);

  // Bo comment dong duoi de mo DevTools khi can debug:
  // mainWindow.webContents.openDevTools();
}

// ---------------------------------------------------------------------------
// MÁY CHỦ LAN CHẠY NGẦM (10/2026): biểu tượng ở khay hệ thống (góc phải taskbar), đóng cửa sổ = ẩn, máy không tự ngủ
// khi app đang chạy (powerSaveBlocker) — máy con luôn kết nối được dù không ai mở app trên máy chủ.
// ---------------------------------------------------------------------------
const START_HIDDEN = process.argv.includes('--hidden');
let appQuitting = false, serverTray = null, trayHintShown = false;
app.on('before-quit', () => { appQuitting = true; });
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); mainWindow.once('ready-to-show', () => mainWindow.show()); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function setupServerBackground() {
  if (!lan.isServer()) return;
  try { powerSaveBlocker.start('prevent-app-suspension'); } catch (e) { logError('powerSaveBlocker', e); }
  try {
    serverTray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
    serverTray.setToolTip('Kho Lạnh — Máy chủ Mạng LAN (đang chạy)');
    serverTray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mở Kho Lạnh', click: showMainWindow },
      { type: 'separator' },
      { label: 'Thoát hẳn (máy con sẽ mất kết nối)', click: () => {
        const r = dialog.showMessageBoxSync({ type: 'warning', buttons: ['Thoát hẳn', 'Không'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Thoát máy chủ', message: 'Thoát hẳn app trên máy chủ?', detail: 'Các máy con sẽ không đọc/ghi được dữ liệu cho tới khi mở lại app trên máy này.\n\nNếu đang bật "Luôn giữ máy chủ mở" (Cài Đặt › Mạng LAN), Windows sẽ tự mở lại app ngầm trong vòng 5 phút — muốn tắt hẳn hãy bỏ tick mục đó trước.' });
        if (r === 0) { appQuitting = true; app.quit(); }
      } },
    ]));
    serverTray.on('click', showMainWindow);
  } catch (e) { logError('Tray', e); }
}

// ---------------------------------------------------------------------------
// CHI CHO PHEP 1 BAN UNG DUNG CHAY CUNG LUC
// Truoc day, lo tay mo 2 ung dung cung luc thi ca 2 deu chay, cung doc/ghi chung cac file Excel
// database va cung dem gio sao luu / dong bo Sheets -> 1 trong 2 ban bi treo. Nay: ban mo SAU
// se hien bang thong bao roi tu thoat; ban dang chay duoc dua len truoc (het thu nho / an).
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (gotSingleInstanceLock) {
  app.on('second-instance', (event, argv) => {
    // PC 5.5: bản do công việc định kỳ "Luôn giữ máy chủ mở" tự mở (kèm --hidden) chỉ để kiểm tra app còn sống → KHÔNG bật cửa sổ.
    if ((argv || []).includes('--hidden')) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// PC 0.20 — lần đầu chạy bản này: file cấu hình còn mã dạng chữ → ghi lại (tự mã hóa). Không đổi nội dung nào khác.
app.whenReady().then(() => {
  setTimeout(() => {
    try {
      if (!canEncrypt() || !fs.existsSync(SHEETS_CONFIG_PATH)) return;
      const o = JSON.parse(fs.readFileSync(SHEETS_CONFIG_PATH, 'utf8'));
      if (!cfgHasPlainSecrets(o)) return;
      decryptCfgSecrets(o); // phần đã mã hóa (nếu có) giải ra, phần không giải được giữ nguyên chuỗi
      saveSheetsConfig(o);
    } catch (e) { logError('Mã hóa file cấu hình tài khoản', e); }
  }, 1500);
});
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    // Day la ban mo thu 2: chi bao cho nguoi dung roi thoat, KHONG khoi tao database / cua so /
    // bo dem gio de khong tranh chap voi ban dang chay.
    // Máy chủ LAN đang chạy ngầm (ẩn ở khay): bản đang chạy tự hiện cửa sổ (second-instance) → thoát lặng lẽ,
    // không hiện hộp cảnh báo gây hiểu nhầm.
    if (lan.isServer()) { app.quit(); return; }
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Ứng dụng đang mở',
      message: 'Ứng dụng đã được mở rồi!',
      detail: 'Không thể mở 2 ứng dụng cùng lúc vì sẽ bị treo và tranh chấp dữ liệu.\n' +
              'Vui lòng dùng cửa sổ đang mở (xem trên thanh taskbar). Bản vừa mở thêm sẽ tự đóng lại.',
      buttons: ['Đã hiểu'],
      noLink: true
    });
    app.quit();
    return;
  }
  migrateDbDirBackToAppFolder(); // gộp lại dữ liệu (nếu có) từ vị trí userData của bản trước về
                                 // đúng app/database — chỉ chạy 1 lần duy nhất, xem chú thích ở
                                 // định nghĩa hàm phía trên.
  // MÁY CON LAN: thư mục dữ liệu = BẢN SAO của máy chủ (app/database-may-con) — chỉ dùng để XEM khi máy chủ tắt.
  // Database riêng cũ của máy này (app/database) giữ nguyên, không đụng tới.
  if (lan.isClient()) DB_DIR = lan.cacheDir;
  ensureDatabase();
  dbCore.cleanupTmpWrites(DB_DIR); // file tạm của lần ghi dở (app bị tắt giữa chừng) — file thật vẫn nguyên vẹn
  createWindow();
  scheduleAutoSheetsSync(); // bat dau dong bo Google Sheets tu dong (neu da cau hinh o Cai Dat)
  lan.start(); // Mạng LAN: máy chủ mở cổng / máy con bắt đầu theo dõi thay đổi (máy đơn: không làm gì)
  setupServerBackground(); // máy chủ: biểu tượng khay + chạy ngầm

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ĐÓNG APP khi còn lệnh ghi Excel đang chạy / xếp hàng (luồng phụ): chờ ghi xong rồi mới thoát (tối đa 20 giây)
// — nếu không, lần lưu cuối cùng (VD vừa sửa rồi đóng ngay) có thể bị cắt ngang và mất.
let quitAfterWrites = false;
app.on('before-quit', (event) => {
  if (quitAfterWrites) return;
  const queues = Object.values(writeQueues);
  if (!queues.length && !dbWorkerPending.size) return;
  event.preventDefault();
  quitAfterWrites = true;
  const timeout = new Promise((r) => setTimeout(r, 20000));
  Promise.race([Promise.all(queues), timeout]).finally(() => {
    try { dbWorkerStopping = true; if (dbWorker) dbWorker.terminate(); } catch (e) { /* bỏ qua */ }
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// CAC KENH IPC DE TRANG GIAO DIEN (renderer) DOC/GHI EXCEL
// dbKey: 'main' | 'module1' | 'module2' | 'module3' | 'module4' | 'module5' | 'module6' | 'module7' | 'module8' (xem DB_FILES)
// Vi du su dung (trong 1 module, VD nxt-bot-sot.html):
//   const res = await window.dbAPI.readSheet('module2', 'Transactions');
//   await window.dbAPI.writeSheet('module2', 'Transactions', [...]);
// ---------------------------------------------------------------------------
// Lấy lại tiêu điểm bàn phím cho cửa sổ sau hộp thoại gốc alert/confirm/prompt (lỗi Electron trên Windows:
// ô nhập không gõ được tới khi cửa sổ mất rồi lấy lại tiêu điểm) — xem appWindowAPI trong preload.js.
ipcMain.handle('window:refocus', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) { win.blur(); win.focus(); event.sender.focus(); }
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// PC 0.65 — Đối chiếu hàng ngày: liên kết file Excel Kho/Xưởng + ghi thẳng (core/dcx-link.js). Dữ liệu nằm trong config/, theo tài khoản + máy này;
// KHÔNG qua Mạng LAN (kênh dcx:* không nằm trong FORWARD của lan.js), KHÔNG lên Drive / Google Sheet.
require('./core/dcx-link').install({ ipcMain, dialog, shell: require('electron').shell, XLSX, getWindow: () => mainWindow, getUser: () => authSessionTen, histNote: (...a) => histNote(...a), logError: (...a) => logError(...a) });

// PC 1.02 — Công cụ Quản lý file (M18): đổi tên / sắp xếp / file trùng trong thư mục người dùng chọn (core/fm-module.js). KHÔNG qua Mạng LAN, KHÔNG đụng database.
// Thư mục app, database, config và userData bị chặn không cho chọn (kể cả thư mục cha của chúng).
require('./core/fm-module').install({ ipcMain, dialog, shell: require('electron').shell, getWindow: () => mainWindow, userDataDir: app.getPath('userData'),
  blockedDirs: [__dirname, PATHS.APP_DIR, PATHS.CONFIG_DIR, DB_DIR, app.getPath('userData'), path.dirname(app.getPath('exe'))] });

// PC 1.03 — Công cụ Lưu trữ cá nhân (M19): khung chat riêng từng tài khoản (tin nhắn / ảnh / file), dữ liệu ở config/luu-tru/<tài khoản>/.
// Đồng bộ điện thoại: máy chủ LAN nhỏ (bật trong module) + Google Drive qua Apps Script (pc.ltPull / pc.ltPush / pc.ltFilePut / pc.ltFileGet). KHÔNG qua Mạng LAN nhiều PC, KHÔNG vào database Excel.
require('./core/luu-tru').install({ ipcMain, dialog, shell: require('electron').shell, app, nativeImage: require('electron').nativeImage, getWindow: () => mainWindow, getUser: () => authSessionTen,
  baseDir: PATHS.CONFIG_DIR, call: (...a) => require('./core/sheets-webapp-client').call(...a), getSheetsCfg: () => loadSheetsConfig(), logError: (...a) => logError(...a),
  // Điện thoại gọi máy chủ LAN bằng Tên người dùng + Mã truy cập của chính tài khoản đó. Chặn: admin còn mã mặc định, mã không đọc được, tài khoản tắt, chưa có quyền kho 'LT'.
  verify: (ten, token) => {
    try {
      const nameKey = String(ten || '').trim().toLowerCase(); if (!nameKey || !token) return null;
      const u = storedPerm().find((x) => String(x.ten || '').toLowerCase() === nameKey);
      if (!u || u.bat === false || isEncOpaque(u.token) || isDefaultAdmin(u) || !sameStr(u.token || '', String(token))) return null;
      const all = isAdminName(u.ten) || (roleOf(u) === 'quantri' && !(Array.isArray(u.kho) && u.kho.length));
      if (!all && !(Array.isArray(u.kho) && u.kho.includes('LT'))) return { denied: true };
      return { ten: String(u.ten).toLowerCase() };
    } catch (e) { return null; }
  } });

ipcMain.handle('db:read-sheet', async (event, dbKey, sheetName) => {
  try {
    const data = await readSheetAsync(dbKey, sheetName);
    lan.recordRead(lan.readerId(event), dbKey, sheetName, data); // máy chủ LAN: nhớ dấu nội dung để chống ghi đè
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('db:write-sheet', async (event, dbKey, sheetName, dataArray) => {
  try {
    await writeSheetsFromReader(dbKey, { [sheetName]: Array.isArray(dataArray) ? dataArray : [] }, event);
    return { ok: true, ignored: event && event.__ownerIgnored || 0 }; // PC 0.58: >0 = có phần ghi của phiếu người khác bị bỏ qua
  } catch (err) {
    return { ok: false, error: err.message, conflict: err instanceof LanConflictError };
  }
});

// Trang chính (biểu đồ "Top đặc tính"): dòng Kho gửi kèm Đặc tính ĐÃ SUY RA — dùng đúng hàm
// m2WithDerivedDacTinh() của phần đẩy lên điện thoại, không chép công thức lần thứ 3.
ipcMain.handle('db:read-m2-derived', async () => {
  try {
    return { ok: true, data: m2WithDerivedDacTinh(await readSheetAsync('module2', 'DuLieuChinh')) };
  } catch (err) {
    return { ok: false, error: err.message, data: [] };
  }
});

// Ô "Tìm trong toàn kho" ở trang chính — xem buildGlobalSearchData().
ipcMain.handle('db:global-search', async () => {
  try { return await buildGlobalSearchData(); }
  catch (err) { return { ok: false, error: err.message, rows: [], maHoa: [] }; }
});

// Trang chính (tổng quan kho) — xem buildDashboardSummary().
ipcMain.handle('db:dashboard-summary', async () => {
  try { return await buildDashboardSummary(); }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:write-sheets', async (event, dbKey, sheets) => {
  try {
    await writeSheetsFromReader(dbKey, sheets, event);
    return { ok: true, ignored: event && event.__ownerIgnored || 0 };
  } catch (err) {
    return { ok: false, error: err.message, conflict: err instanceof LanConflictError };
  }
});

ipcMain.handle('db:list-sheets', async (event, dbKey) => {
  try {
    return { ok: true, sheets: await listSheetsAsync(dbKey) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// LỊCH SỬ THAO TÁC (PC 7.61) — module 11 "Lịch Sử" (html/lich-su.html). Xem lich-su.js.
// history:query (chỉ Quản trị — PC_GUARD 'ADMIN') · history:log-import (khung trang báo người dùng vừa CHỌN FILE để nhập)
// history:set-context (trang chính báo module đang mở → gán cho file xuất ra).
// ---------------------------------------------------------------------------
const histFmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
ipcMain.handle('history:query', (event, f) => {
  try { return lichSu.query(f); } catch (err) { return { ok: false, error: err.message, rows: [], total: 0, months: [], taiKhoan: [], modules: [] }; }
});
ipcMain.handle('history:set-context', (event, name) => { histActiveModule = String(name || 'Trang chính').slice(0, 80); return { ok: true }; });
ipcMain.handle('history:log-import', (event, files) => {
  try {
    const mod = lichSu.moduleOfFrame(event && event.senderFrame && event.senderFrame.url) || histActiveModule;
    (Array.isArray(files) ? files : []).slice(0, 5).forEach((f) => {
      const name = String((f && f.name) || '').replace(/[\\/]/g, '').slice(0, 160); if (!name) return;
      const size = Number(f && f.size) || 0;
      histNote('nhap-file', mod, 'Nhập file: ' + name + (size ? ' (' + histFmtSize(size) + ')' : ''));
    });
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
// MỌI file tải / xuất ra từ giao diện (Excel, PDF, ảnh, sao lưu…) đi qua 'will-download' — ghi khi tải XONG (hủy hộp thoại lưu thì không ghi).
app.whenReady().then(() => {
  try {
    session.defaultSession.on('will-download', (e, item) => {
      let name = ''; try { name = item.getFilename(); } catch (er) { /* bỏ qua */ }
      item.once('done', (ev, state) => {
        if (state !== 'completed') return;
        let size = 0; try { size = item.getReceivedBytes(); } catch (er) { /* bỏ qua */ }
        histNote('xuat-file', histActiveModule, 'Xuất file: ' + (name || '(không tên)') + (size ? ' (' + histFmtSize(size) + ')' : ''));
      });
    });
  } catch (err) { logError('Lịch sử (will-download)', err); }
});

// ---------------------------------------------------------------------------
// CAC KENH IPC CHO TINH NANG "Dong Bo Dien Thoai" (Google Sheets) - xem UI trong
// html/cai-dat.html (tab "Dien Thoai") va logic trong html/js/cai-dat.js
// ---------------------------------------------------------------------------
ipcMain.handle('sheets:get-config', () => {
  try {
    return { ok: true, config: uiConfig(loadSheetsConfig()), fixedUrl: !!FIXED_WEBAPP_URL, fixedToken: !!FIXED_PC_TOKEN };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sheets:set-config', (event, { webAppUrl, pcToken, intervalMinutes }) => {
  try {
    const cfg = loadSheetsConfig();
    cfg.webAppUrl = FIXED_WEBAPP_URL || (webAppUrl || '').trim();
    cfg.pcToken = FIXED_PC_TOKEN || (pcToken || '').trim();
    // 0 = TAT tu dong, chi dong bo khi bam tay (nut "Đồng bộ ngay" o Cai Dat / Module 02).
    const mins = Number(intervalMinutes);
    const oldMins = Number(cfg.intervalMinutes) || 0;
    cfg.intervalMinutes = Number.isFinite(mins) && mins >= 0 ? mins : 0;
    // PC 7.41: doi chu ky chung o Cai Dat = ap cho TAT CA muc (muon rieng tung muc thi chinh o Cong cu > Dong bo dien thoai).
    if (cfg.intervalMinutes !== oldMins) { cfg.autoPick = {}; AUTO_KEYS.forEach(k => { cfg.autoPick[k] = AUTO_MINUTES_OK.includes(cfg.intervalMinutes) ? cfg.intervalMinutes : 0; }); }
    // Bo cac truong cua ban cu (Service Account) neu con sot trong file cau hinh.
    delete cfg.spreadsheetId;
    delete cfg.keyFilePath;
    saveSheetsConfig(cfg);
    scheduleAutoSheetsSync(); // ap dung cau hinh moi ngay, khong can khoi dong lai app
    return { ok: true, config: uiConfig(cfg) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sheets:test-connection', async () => {
  try {
    const cfg = loadSheetsConfig();
    if (!cfg.webAppUrl || !cfg.pcToken) {
      return { ok: false, error: 'Chưa nhập đường dẫn Web App hoặc mã PC_TOKEN.' };
    }
    const info = await sheetsSync.testConnection(cfg);
    return { ok: true, ...info };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});


// PC 7.37 — ĐỒNG BỘ ĐIỆN THOẠI (nút bấm tay) chỉ đẩy / kéo các bảng thuộc module tài khoản được phân quyền: M01 · M01VT · M01VTB · M02 · M03 · M04 · M08
// (cùng mã với quyền module PC). LX (Lịch xuất nhập hàng) ai có CD_DONGBO cũng đẩy được. Lấy phiếu xuất (pull) cần ít nhất 1 quyền M01* / M02.
// Vòng tự động theo lịch là việc của MÁY (không theo người đăng nhập) nên không lọc.
function syncAllowed() {
  const list = ensureDefaultAdmin(storedPerm());
  const u = findSessionUser(list);
  if (!u) throw new Error('Chưa đăng nhập.');
  const pc = effectivePc(u, list);
  const tables = new Set(SYNC_TABLES.filter(t => t === 'LX' || (t === 'C3D' ? pc.includes('M14') : pc.includes(t))));
  const pull = ['M01', 'M01VT', 'M01VTB', 'M02'].some(c => pc.includes(c));
  return { tables, pull };
}
ipcMain.handle('sheets:push-now', async () => {
  try {
    const al = syncAllowed();
    if (!al.tables.size) return { ok: false, error: 'Tài khoản của bạn chưa được phân quyền module nào để đồng bộ.' };
    const cfg = await withSheetsSyncLock(() => pushTonKhoLenSheet([...al.tables]));
    return { ok: true, config: uiConfig(cfg) };
  } catch (err) {
    return { ok: false, error: err.message, config: uiConfig(loadSheetsConfig()) };
  }
});

// Nut "🔄 Đồng bộ ngay" (Cai Dat + tab Phieu Xuat cua Module 02): chay NGAY 1 vong day du — keo
// phieu dien thoai ve roi day ton kho (da tru) len — khong cho chu ky tu dong. Tra ve ket qua
// tung buoc de giao dien bao ro buoc nao loi.
// opts: { pull: true/false, tables: ['M01','M01VT','M02'] } — nguoi dung tick chon o Cai Dat
// (hoac Module 02 goi rieng { pull:true, tables:['M02'] }). Bo trong = dong bo tat ca. Neu vua
// nhan phieu dien thoai cho bang nao thi LUON day lai bang do (du khong tick) — neu khong, dien
// thoai se thay so ton cu chua tru phieu vua nhan.
ipcMain.handle('sheets:sync-now', async (event, opts) => {
  try {
    requireSheetsConfig();
  } catch (err) {
    return { ok: false, error: err.message, config: uiConfig(loadSheetsConfig()) };
  }
  let al;
  try { al = syncAllowed(); } catch (err) { return { ok: false, error: err.message }; }
  const o = opts && typeof opts === 'object' ? opts : { pull: true, tables: SYNC_TABLES };
  return withSheetsSyncLock(async () => {
    const out = { ok: true, soPhieuMoi: 0, soPhieuLoi: 0, pullError: null, pushError: null, pushed: [] };
    const tables = new Set((o.tables || []).filter(t => SYNC_TABLES.includes(t) && al.tables.has(t)));
    if (o.pull && al.pull) {
      try {
        const r = await pullPhieuXuatVeLocal();
        out.soPhieuMoi = r.soPhieuMoi;
        out.soPhieuLoi = r.soPhieuLoi;
        (r.modulesMoi || []).forEach(m => tables.add(m));
      } catch (err) {
        out.ok = false;
        out.pullError = err.message;
      }
    }
    if (tables.size) {
      try {
        await pushTonKhoLenSheet([...tables]);
        out.pushed = [...tables];
      } catch (err) {
        out.ok = false;
        out.pushError = err.message;
      }
    }
    out.config = loadSheetsConfig();
    return out;
  });
});

// Nút "Đẩy lên điện thoại" trên thanh trên cùng của từng module (js/index.js › addModulePushButtons, PC 2.2):
// CHỈ đẩy các bảng điện thoại thuộc ĐÚNG module đang mở — không kéo phiếu, không đụng bảng của module khác.
// Máy con Mạng LAN: kênh 'sheets:*' tự chuyển sang máy chủ (lan.js) → máy chủ đẩy database chung.
const PUSH_TABLES_OF_DB = { module1: ['M01', 'M01VT', 'M01VTB'], module2: ['M02'], module3: ['M03'], module4: ['M04'], module8: ['M08'], module14: ['C3D'] };
ipcMain.handle('sheets:push-module', async (event, dbKey) => {
  let tables = PUSH_TABLES_OF_DB[dbKey];
  if (!tables) return { ok: false, error: 'Module này không có dữ liệu trên điện thoại.' };
  try { const al = syncAllowed(); tables = tables.filter(t => al.tables.has(t)); } catch (err) { return { ok: false, error: err.message }; }
  if (!tables.length) return { ok: false, error: 'Tài khoản của bạn không có quyền đồng bộ module này.' };
  try {
    requireSheetsConfig();
  } catch (err) {
    return { ok: false, needConfig: true, error: err.message, config: uiConfig(loadSheetsConfig()) };
  }
  try {
    await withSheetsSyncLock(() => pushTonKhoLenSheet(tables));
    return { ok: true, pushed: tables, config: uiConfig(loadSheetsConfig()) };
  } catch (err) {
    return { ok: false, error: err.message, config: uiConfig(loadSheetsConfig()) };
  }
});

// ---------------------------------------------------------------------------
// PHAN QUYEN DIEN THOAI THEO TOKEN (09/2026) — danh sach nguoi dung luu trong sheets-sync-config.json
// (field phanQuyen, CO token goc de hien/copy cho nguoi quan ly), day len tab "PhanQuyen" tren Google Sheet:
// ma bam SHA-256 (Code.gs › resolveUser_ bam token dien thoai gui len roi so) + cot maTruyCap (token dang chu, noi bo).
// Dien thoai Quan tri sua tab nay qua Code.gs (pq.*) → PC doc ve + gop o 'sheets:perm-get' / 'sheets:perm-save'.
//   { id, ten, token, quyen: 'xem'|'xuat'|'quantri', kho: ['M01','M01VT','M01VTB','M02','M03','M04','M08'], bat: true/false }
// ---------------------------------------------------------------------------
const PQ_TAB = 'PhanQuyen';
const PQ_KHO = ['M01', 'M01VT', 'M01VTB', 'M02', 'M03', 'M04', 'M08', 'BC01', 'BC02', 'LX', 'C3D', 'SCAN', 'QR', 'LT']; // LT = Lưu trữ cá nhân (PC 1.03 / ĐT 1.02) · QR = Tạo mã QR (PC 0.69 / ĐT 0.17) · C3D = Xếp cont 3D (phân quyền điện thoại riêng, PC 8.62); BC01/BC02 = trang Báo cáo điện thoại (M01/M02)
const PQ_COLUMNS = ['tokenHash', 'ten', 'tenHienThi', 'quyen', 'kho', 'trangThai', 'capNhat', 'maTruyCap', 'pcModules'];
// Module được mở trên PC (menu Tài khoản, PC 5.6) — GIỐNG const PC trong html/js/tai-khoan.js. Cột `pcModules` trên Sheet =
// "M01,M02,CD_SAOLUU"; điện thoại KHÔNG sửa cột này (Code.gs pqSave_ giữ nguyên giá trị cũ).
// PC 6.7: quyền "Cài đặt" (CAIDAT) cũ được TÁCH thành quyền riêng cho từng mục: CD_SAOLUU (Sao lưu & Drive — gồm KHÔI PHỤC ghi đè
// dữ liệu), CD_DONGBO (Đồng bộ điện thoại), CD_CAPNHAT (Cập nhật phiên bản), CD_AI (Trợ lý AI — API key), CD_LAN (Mạng LAN).
// Mục "Giao diện" (Sáng/Tối) + Đổi mã của chính mình: MỌI tài khoản đều dùng được, không cần quyền. Tài khoản cũ còn mã CAIDAT
// → cleanPcModules tự đổi thành đủ 5 quyền con (giữ nguyên hành vi cũ, quản trị bỏ tick từng mục sau đó).
// PC 6.8: "Sao lưu & Drive" chia 2 mức — CD_SAOLUU = toàn quyền (sao lưu LÊN Drive, đổi thư mục / lịch sao lưu, khôi phục);
// CD_KHOIPHUC = chỉ đọc + khôi phục dữ liệu TỪ Drive về máy (không ghi / sửa file trên Drive). CD_SAOLUU luôn kéo theo CD_KHOIPHUC.
// PC 7.3: BỎ khỏi bảng phân quyền các mục cơ bản (CD_KHOIPHUC, CD_CAPNHAT, CD_AI, CD_LAN) — tài khoản PC nào cũng có sẵn; mã cũ còn lưu
// trong danh sách tự bị lọc bỏ (cleanPcModules chỉ giữ mã có trong PQ_PC). Chỉ còn 2 mã Cài đặt: CD_SAOLUU + CD_DONGBO (cùng TAIKHOAN).
// PC 7.37: thêm lại CD_KHOIPHUC (Khôi phục Drive: chỉ khôi phục module được cấp, KHÔNG sao lưu lên Drive); CD_SAOLUU luôn kéo theo CD_KHOIPHUC.
const PQ_CD = ['CD_SAOLUU', 'CD_KHOIPHUC', 'CD_DONGBO'];
// PC 7.2: Module 01 tách 3 quyền riêng giống điện thoại — M01 = Tồn An An (Load Data chính, Dữ Liệu, Phân Loại, Báo Cáo, Đặc Tính, Tổng Hợp),
// M01VT = Tồn theo vị trí, M01VTB = Vị Trí Bột. Tài khoản cũ có M01 được chuyển 1 lần thành đủ 3 (xem migrateSplitM01) để giữ nguyên quyền cũ.
// PC 8.34: LX_EMAIL = duyệt / quét email Lịch xuất (hộp ✉ Email, thư tự xử lý, thông tin xe) — chặn THẬT ở lx:email-list / lx:email-ack (PC_GUARD); Quản trị luôn có.
const PQ_PC = ['M01', 'M01VT', 'M01VTB', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M08RD', 'M09', 'M13', 'M14', 'M15', 'M17', 'M18', 'M19', 'M16', 'LX_EMAIL'].concat(PQ_CD, ['TAIKHOAN']); // M19 = Lưu trữ cá nhân (PC 1.03) · M18 = Quản lý file (PC 1.02) · M17 = Tạo mã QR (PC 0.69) · M15 = Scan tài liệu (PC 0.21) · M16 = Đối chiếu hàng ngày (PC 0.63, trước là M12)
const migrateSplitM01 = (v) => { const a = Array.isArray(v) ? v.slice() : []; if (a.includes('M01')) ['M01VT', 'M01VTB'].forEach(c => { if (!a.includes(c)) a.push(c); }); return a; };
// Danh sách phân quyền lưu trên máy — chuyển 1 lần quyền M01 cũ → M01 + M01VT + M01VTB (cờ pcSplitM01 chống chạy lại, để quản trị bỏ tick con thì không bị tick lại).
// PC 8.52: "Báo cáo rã đông" tách khỏi Tổng Hợp thành menu riêng với quyền riêng M08RD → tài khoản đang có M08 được cấp thêm M08RD 1 lần (giữ nguyên quyền cũ).
const migrateRD = (v) => { const a = Array.isArray(v) ? v.slice() : []; if (a.includes('M08') && !a.includes('M08RD')) a.push('M08RD'); return a; };
function storedPerm() {
  const cfg = loadSheetsConfig();
  let list = cfg.phanQuyen || [];
  if (!cfg.pcSplitRD) {
    list = list.map(u => (Array.isArray(u.pcModules) && u.pcModules.includes('M08')) ? { ...u, pcModules: migrateRD(u.pcModules) } : u);
    patchSheetsConfig({ phanQuyen: list, pcSplitRD: true });
  }
  if (!cfg.pcSplitM01) {
    list = list.map(u => (Array.isArray(u.pcModules) && u.pcModules.includes('M01')) ? { ...u, pcModules: migrateSplitM01(u.pcModules) } : u);
    patchSheetsConfig({ phanQuyen: list, pcSplitM01: true });
  }
  return list;
}
const PQ_MIN_TOKEN = 8;
// Tài khoản MẶC ĐỊNH admin / admin (PC 5.7): mã "admin" chỉ có 5 ký tự nên là NGOẠI LỆ DUY NHẤT của quy tắc 8–64 ký tự.
// Vì mã yếu → tài khoản này CHỈ nằm trên máy PC, KHÔNG đẩy lên Sheet (điện thoại không đăng nhập được bằng admin/admin)
// cho tới khi người quản lý đổi sang mã ≥ 8 ký tự.
const isDefaultAdmin = (u) => !!u && String(u.ten || '').trim().toLowerCase() === 'admin' && String(u.token || '').trim() === 'admin';
// PC 7.0 — "admin" là TÀI KHOẢN CHÍNH: luôn bật, luôn Quản trị, đủ mọi quyền (module PC + kho điện thoại), không xóa / không đổi tên;
// tài khoản Quản trị khác KHÔNG xem / sửa được mã của admin (perm-get giấu mã, perm-save giữ nguyên bản ghi admin);
// chỉ admin mới thấy / đổi "Nguồn cập nhật (GitHub)".
const isAdminName = (t) => String(t || '').trim().toLowerCase() === 'admin';
// Cấu hình đồng bộ gửi ra giao diện: BỎ danh sách phân quyền (có mã gốc của mọi người, kể cả admin) — giao diện không dùng tới.
function uiConfig(c) { if (!c || typeof c !== 'object') return c; const o = Object.assign({}, c); delete o.phanQuyen; return o; }
const isWeakToken = (u) => String(u && u.token || '').length < PQ_MIN_TOKEN;
const cleanPcModules = (v) => {
  let a = Array.isArray(v) ? v.slice() : [];
  if (a.includes('CAIDAT')) a = a.filter(m => m !== 'CAIDAT').concat(PQ_CD); // mã cũ (trước 6.7) → các quyền con còn hiệu lực
  if (a.includes('M12')) a = a.filter(m => m !== 'M12').concat(a.includes('M16') ? [] : ['M16']); // PC 0.63: quyền cũ M12 (Số liệu kho/xưởng) = M16 (Đối chiếu hàng ngày) — tài khoản cũ giữ nguyên quyền
  if (a.includes('CD_SAOLUU') && !a.includes('CD_KHOIPHUC')) a.push('CD_KHOIPHUC'); // toàn quyền Drive kéo theo khôi phục
  return a.filter((m, i, x) => PQ_PC.includes(m) && x.indexOf(m) === i);
};
// PC 7.14 — 4 VAI TRÒ (giá trị lưu giữ nguyên 'xem' / 'xuat' / 'quantri' để tương thích Sheet + điện thoại, thêm 'quanly'):
//   xem     = "Người dùng" cấp 1 (chữ vàng) — CHỈ XEM, không xóa / sửa / nhập / xuất
//   xuat    = "Người dùng" cấp 2 (chữ xanh lá) — xem + XUẤT PHIẾU (module In Chứng Từ Kho), không xóa / sửa / nhập
//   quanly  = "Quản lý" (ngọc lục bảo) — thao tác đủ trong module được phân quyền; Cài đặt chỉ có mục nào được cấp; chỉ khi Quản trị / admin chỉ định mới có "Tài khoản" (PC 7.15: tạo / xem mã / sửa / xóa người dùng cấp 1 & 2)
//   quantri = "Quản trị" (chữ đỏ) — toàn quyền như admin; chỉ admin mặc định được tạo / sửa / xóa tài khoản Quản trị
const PQ_QUYEN = ['xem', 'xuat', 'quanly', 'quantri'];
const ROLE_LEVEL = { xem: 1, xuat: 2, quanly: 3, quantri: 4 };
const roleOf = (u) => !u ? '' : (isAdminName(u.ten) ? 'quantri' : (PQ_QUYEN.includes(u.quyen) ? u.quyen : 'xem'));
const roleLevel = (u) => ROLE_LEVEL[roleOf(u)] || 0;
const ROLE_NAME = { xem: 'Người dùng cấp 1 (chỉ xem)', xuat: 'Người dùng cấp 2 (xem + xuất phiếu)', quanly: 'Quản lý', quantri: 'Quản trị' };
// Database module được GHI khi chỉ có quyền cấp 2: Chứng từ xuất kho (module6 — xuất / in phiếu). 'settings' (Giao diện, cấu hình AI cá nhân) mọi tài khoản đều ghi được.
const XUAT_WRITE_KEYS = ['module6'];
const ANY_WRITE_KEYS = ['settings', 'lichxuat']; // lichxuat: ai không chỉ-xem đều sửa lịch xuất như trước (renderer kiểm canEdit)
// Giới hạn quyền module theo vai trò: cấp 1 / 2 không có mục Cài đặt nào; Quản lý không có "Tài khoản" (chống tự nâng quyền).
// PC 7.15: Quản lý CÓ THỂ được tài khoản Quản trị / admin chỉ định thêm quyền "Tài khoản" (TAIKHOAN) — khi đó chỉ tạo / xem mã / sửa / xóa được tài khoản cấp 1 & 2 (xem perm-save).
// PC 7.43: Quản trị (không phải admin) TỰ BỎ TICK module / kho không dùng (ẩn đi, tick lại là hiện). Các quyền Cài đặt (CD_*) + Tài khoản LUÔN còn để không tự khóa mình;
// danh sách module trống (bản cũ chưa từng lưu) = coi như đủ quyền. admin chính vẫn luôn đủ (xem cleanPermList / effectivePc).
const PQ_FIXED_PC = ['TAIKHOAN', 'LX_EMAIL'].concat(PQ_CD);
const limitPcByRole = (mods, role) => role === 'quantri' ? (mods.length ? PQ_PC.filter(m => PQ_FIXED_PC.includes(m) || mods.includes(m)) : PQ_PC.slice())
  : mods.filter(m => (m !== 'TAIKHOAN' || role === 'quanly') && (role === 'quanly' || !PQ_CD.includes(m)));
// Cấp độ để so sánh khi quản lý tài khoản: 1 cấp 1 · 2 cấp 2 · 3 Quản lý · 4 Quản trị · 5 admin chính.
const permLevel = (u) => isAdminName(u && u.ten) ? 5 : (ROLE_LEVEL[PQ_QUYEN.includes(u && u.quyen) ? u.quyen : 'xem'] || 1);
const sha256Hex = (t) => require('crypto').createHash('sha256').update(String(t), 'utf8').digest('hex');
// Quy tắc mã (kể cả mã quản lý TỰ GÕ) — GIỐNG tokenError() trong html/js/cai-dat.js.
const PQ_TOKEN_OK = /^[A-Za-z0-9\-_.@#!]+$/;
// Tên người dùng = ID đăng nhập: chữ không dấu, số và . _ - (1–40 ký tự, không dấu cách), KHÔNG phân biệt
// hoa/thường. Tên hiển thị = tên có dấu để hiện (VD "Thắng") — GIỐNG userIdError() trong html/js/cai-dat.js.
const PQ_USER_OK = /^[A-Za-z0-9._-]{1,40}$/;
function cleanPermList(list) {
  const pcToken = String(loadSheetsConfig().pcToken || '').trim();
  const out = [];
  const seenTen = new Set(), seenTok = new Set();
  (Array.isArray(list) ? list : []).forEach((u, i) => {
    const ten = String(u && u.ten || '').trim();
    const tenHienThi = String(u && u.tenHienThi || '').trim().slice(0, 60) || ten;
    const token = String(u && u.token || '').trim();
    if (!ten) throw new Error(`Dòng ${i + 1}: chưa nhập tên người dùng.`);
    if (!PQ_USER_OK.test(ten)) throw new Error(`Tên người dùng "${ten}": chỉ gồm chữ không dấu, số và . _ - (tối đa 40 ký tự, không dấu cách). Tên có dấu ghi ở cột "Tên hiển thị".`);
    if (!isDefaultAdmin({ ten, token })) {
      if (token.length < PQ_MIN_TOKEN) throw new Error(`"${ten}": mã quá ngắn (tối thiểu 8 ký tự) — bấm "Tạo mã" hoặc "Tự đặt".`);
      if (token.length > 64 || !PQ_TOKEN_OK.test(token)) throw new Error(`"${ten}": mã chỉ gồm chữ không dấu, số và - _ . @ # ! (8–64 ký tự, không dấu cách).`);
      if (pcToken && token === pcToken) throw new Error(`"${ten}": mã trùng PC_TOKEN của máy PC — chọn mã khác.`);
    }
    const kTen = ten.toLowerCase();
    if (seenTen.has(kTen)) throw new Error(`Tên người dùng "${ten}" bị trùng (không phân biệt hoa/thường) — mỗi người 1 tên đăng nhập riêng.`);
    if (seenTok.has(token.toLowerCase())) throw new Error(`Mã của "${ten}" trùng với người khác — bấm "Tạo mã" hoặc "Tự đặt" để đổi.`);
    seenTen.add(kTen); seenTok.add(token.toLowerCase());
    const kho = (Array.isArray(u.kho) ? u.kho : []).filter(k => PQ_KHO.includes(k));
    const adm = isAdminName(ten); // tài khoản chính: không cho hạ quyền / tắt / bớt quyền dù giao diện gửi gì lên
    const role = adm ? 'quantri' : (PQ_QUYEN.includes(u.quyen) ? u.quyen : 'xem');
    // PC 7.14: Quản trị = toàn quyền như admin. PC 7.43: riêng admin chính luôn đủ; Quản trị khác giữ đúng phần đã tick (trống = đủ), quyền Cài đặt / Tài khoản luôn có.
    out.push({ id: String(u.id || ('u' + Date.now().toString(36) + i)), ten, tenHienThi, token,
      quyen: role, kho: (adm || (role === 'quantri' && !kho.length)) ? PQ_KHO.slice() : kho, bat: adm ? true : u.bat !== false,
      tuDat: !!u.tuDat, pcModules: adm ? PQ_PC.slice() : limitPcByRole(cleanPcModules(u.pcModules), role) });
  });
  return out;
}
// PC 7.95 — CHỐT CHẶN DUY NHẤT trước khi GHI ĐÈ tab PhanQuyen trên Google Sheet (mọi đường lưu / đổi mã đều đi qua đây).
// Nguyên nhân mất sạch tài khoản trước đây: máy mới chỉ có admin → đẩy danh sách 1 người lên ĐÈ cả Sheet; các máy khác + điện thoại thấy
// "bị xóa" nên xóa theo. Nay: (1) PHẢI đọc được Sheet hiện tại — không đọc được thì DỪNG, không ghi mù; (2) tài khoản đang có trên Sheet mà danh
// sách đẩy lên không còn thì DỪNG, trừ những tên người dùng CHỦ ĐỘNG xóa (opts.allowNames — đã xác nhận). admin chính không tính (chỉ nằm trên máy).
// Trước khi ghi, Web App (Code.gs) còn lưu bản sao tab cũ (PhanQuyen_BanLuu) — xem pcBackupTab_.
async function pushPermTab(cfg, list, opts) {
  opts = opts || {};
  const lc = (x) => String(x || '').trim().toLowerCase();
  let current;
  try { current = await readPermFromSheet(cfg); }
  catch (err) { const e = new Error('Không đọc được danh sách đang có trên Google Sheet (' + err.message + ') nên DỪNG, không ghi đè — kiểm tra mạng rồi lưu lại.'); e.code = 'PQ_READFAIL'; throw e; }
  const have = new Set(list.map((u) => lc(u.ten))), allow = opts.allowNames || new Set();
  const lost = (current || []).filter((r) => r.ten && !isAdminName(r.ten) && !have.has(lc(r.ten)) && !allow.has(lc(r.ten))).map((r) => r.ten);
  if (lost.length) { const e = new Error('Ghi lên Google Sheet sẽ XÓA ' + lost.length + ' tài khoản đang có trên Sheet mà danh sách trên máy này không có: ' + lost.slice(0, 6).join(', ') + (lost.length > 6 ? '…' : '') + '. Đã dừng để tránh mất tài khoản.'); e.code = 'PQ_LOST'; e.lost = lost; throw e; }
  const now = new Date().toISOString();
  // Tài khoản mã yếu (admin / admin mặc định) CHỈ ở trên PC — không đẩy lên Sheet.
  const rows = list.filter(u => !isWeakToken(u) && !isEncOpaque(u.token) && !(cfg.adminAutoLocked && isAdminName(u.ten))).map(u => ({ tokenHash: sha256Hex(u.token), ten: u.ten, tenHienThi: u.tenHienThi || u.ten, quyen: u.quyen, kho: u.kho.join(','),
    trangThai: u.bat ? 'Bật' : 'Tắt', capNhat: now, maTruyCap: u.token, pcModules: cleanPcModules(u.pcModules).join(',') }));
  await sheetsSync.pushTableOverwrite(cfg, PQ_TAB, PQ_COLUMNS, rows);
  patchSheetsConfig({ pcSplitSheet: true, pcSplitRDSheet: true, pcSplitRD: true }); // Sheet đã mang mã mới (M01VT / M01VTB) → ngừng chuyển mã cũ khi đọc Sheet
}
// Đọc tab PhanQuyen trên Sheet → mảng người dùng (điện thoại Quản trị có thể thêm / sửa / xóa người ở đó).
// null nếu tab chưa có cột "maTruyCap" (Web App / PC bản cũ chưa ghi) — khi đó KHÔNG gộp gì.
async function readPermFromSheet(cfg) {
  const t = await sheetsSync.readTable(cfg, PQ_TAB);
  const migRD = !cfg.pcSplitRDSheet; // PC 8.52: Sheet chưa mang mã M08RD → M08 chuyển thành M08 + M08RD
  const mig = !cfg.pcSplitSheet; // PC 7.2: Sheet còn mã cũ (chưa được PC đẩy lại sau khi tách) (M01 gộp) → chuyển thành đủ M01 + M01VT + M01VTB
  if (!t.headers.includes('maTruyCap')) return null;
  return t.rows.map(r => {
    const q = String(r.quyen || '').trim();
    return {
      ten: String(r.ten || '').trim(), tenHienThi: String(r.tenHienThi || '').trim(),
      quyen: PQ_QUYEN.includes(q) ? q : 'xem',
      kho: String(r.kho || '').split(',').map(x => x.trim()).filter(k => PQ_KHO.includes(k)),
      bat: String(r.trangThai || '').trim() === 'Bật', token: String(r.maTruyCap || '').trim(),
      // undefined = Sheet chưa có cột pcModules (Web App / PC bản cũ) → khi gộp giữ nguyên giá trị trên máy
      pcModules: t.headers.includes('pcModules') ? cleanPcModules((migRD ? migrateRD : (x => x))((mig ? migrateSplitM01 : (x => x))(String(r.pcModules || '').split(',').map(x => x.trim())))) : undefined
    };
  }).filter(r => r.ten);
}
const permFromSheet = (s, i) => ({ id: 'u' + Date.now().toString(36) + i, ten: s.ten, tenHienThi: s.tenHienThi || s.ten,
  token: s.token, quyen: s.quyen, kho: s.kho, bat: s.bat, tuDat: true, pcModules: s.pcModules || [] });
// Gộp thay đổi làm trên điện thoại vào danh sách máy PC: người có ở cả 2 nơi → lấy quyền / kho / bật-tắt / mã theo Sheet;
// người chỉ có trên Sheet → thêm; người chỉ có trên PC → xóa nếu PC đã từng đẩy lên (tức là bị xóa trên điện thoại).
function mergePermFromSheet(local, sheetRows, dropMissing) {
  const byTen = new Map(sheetRows.map(r => [r.ten.toLowerCase(), r]));
  const out = []; let changed = false;
  local.forEach(u => {
    const s = byTen.get(String(u.ten).toLowerCase());
    // Tài khoản mã yếu (admin mặc định) không bao giờ có trên Sheet → không coi là "đã bị xóa trên điện thoại".
    if (!s) { if (dropMissing && !isWeakToken(u) && !isAdminName(u.ten)) changed = true; else out.push(u); return; }
    if (isAdminName(u.ten)) { out.push(u); return; } // admin: quyền / kho / bật-tắt / mã chỉ do máy PC quyết định, điện thoại (Sheet) không đổi được
    const n = { ...u, tenHienThi: s.tenHienThi || u.tenHienThi, quyen: s.quyen, kho: s.kho, bat: s.bat };
    if (s.pcModules !== undefined) n.pcModules = s.pcModules;
    if (s.token && s.token !== u.token) { n.token = s.token; n.tuDat = true; }
    if (JSON.stringify(n) !== JSON.stringify(u)) changed = true;
    out.push(n);
  });
  const have = new Set(local.map(u => String(u.ten).toLowerCase()));
  sheetRows.forEach((s, i) => { if (!have.has(s.ten.toLowerCase()) && s.token && !isAdminName(s.ten)) { out.push(permFromSheet(s, i)); changed = true; } });
  return { list: out, changed };
}
// Danh sách phân quyền hiện tại (đã gộp Sheet nếu có) — LUÔN có tài khoản admin mặc định (admin / admin) nếu chưa có tên "admin".
async function loadPermListMerged() {
  const cfg = loadSheetsConfig();
  let list = storedPerm();
  // Có thay đổi PC chưa đẩy lên (phanQuyenPushedAt rỗng + đã có danh sách) thì KHÔNG gộp, tránh đè mất chỉnh sửa trên máy.
  // Danh sách chỉ có admin mặc định (chưa từng lưu) coi như rỗng → vẫn kéo người dùng từ Sheet về.
  const onlyDefault = list.every(isWeakToken);
  if (cfg.webAppUrl && cfg.pcToken && (cfg.phanQuyenPushedAt || !list.length || onlyDefault)) {
    try {
      const rows = await readPermFromSheet(cfg);
      if (rows) {
        const m = mergePermFromSheet(list, rows, !!cfg.phanQuyenPushedAt);
        if (m.changed) { list = m.list; patchSheetsConfig({ phanQuyen: list }); }
      }
    } catch (err) { console.error('Loi lay phan quyen tu Sheet:', err.message); }
  }
  list = ensureDefaultAdmin(list);
  list = autoLockDefaultAdmin(list);
  return list;
}
// PC 7.11 — TỰ KHÓA admin mặc định: máy đã có tài khoản Quản trị khác (bật, có quyền TAIKHOAN, mã ≥ 8 ký tự) mà admin vẫn là admin / admin
// → đổi mã admin trên máy này thành mã ngẫu nhiên (không ai biết, không đẩy lên Sheet) để admin / admin hết dùng được, khỏi phải đổi tay từng máy.
// Không làm khi chính admin đang đăng nhập (tránh làm hỏng phiên / bước bắt buộc đổi mã). Tắt: app-config.js › autoLockDefaultAdmin: false.
function autoLockDefaultAdmin(list) {
  if (!AUTO_LOCK_ADMIN || authSessionTen === 'admin') return list;
  const adm = list.find(u => isAdminName(u.ten));
  if (!adm || !isDefaultAdmin(adm)) return list;
  const hasQT = list.some(u => !isAdminName(u.ten) && u.bat !== false && u.quyen === 'quantri' && !isWeakToken(u));
  if (!hasQT) return list;
  const out = list.map(u => u === adm ? { ...u, token: require('crypto').randomBytes(18).toString('base64url'), tuDat: false } : u);
  patchSheetsConfig({ phanQuyen: out, adminAutoLocked: true });
  return out;
}
// PC 7.95: KHÔNG còn tự tạo tài khoản admin / admin. Máy chưa có tài khoản nào (hoặc chỉ còn admin / admin cũ) = "máy mới" → màn Thiết lập máy mới
// (kéo danh sách tài khoản từ Google Sheet, hoặc tạo admin đầu tiên) — xem isFreshMachine() + các lệnh setup:*. Hàm giữ tên để các nơi gọi cũ không phải đổi.
function ensureDefaultAdmin(list) { return list; }
// PC 0.20: mọi mã đều là chuỗi mã hóa KHÔNG giải được (file cấu hình chép từ máy / tài khoản Windows khác) → coi như máy mới để
// kéo lại tài khoản từ Google Sheet; nếu không sẽ bị khóa ngoài vì không ai đăng nhập được.
const isFreshMachine = () => { const l = storedPerm(); return !l.length || l.every(isDefaultAdmin) || l.every((u) => isEncOpaque(u && u.token)); };
// ---------------------------------------------------------------------------
// ĐĂNG NHẬP TRÊN PC (PC 5.8) — phiên đăng nhập giữ ở tiến trình chính: Ctrl+R (làm mới app) KHÔNG phải đăng nhập lại,
// tắt app mở lại thì phải đăng nhập. Mã truy cập KHÔNG bao giờ gửi về giao diện. Chặn module = ở giao diện (js/auth-gate.js);
// riêng việc xem / sửa danh sách tài khoản (sheets:perm-get / perm-save) được chặn ngay ở đây.
// ---------------------------------------------------------------------------
let authSessionTen = null;       // tên người dùng (chữ thường) đang đăng nhập
const authFail = { n: 0, until: 0 };
const AUTH_MAX_FAIL = 5, AUTH_LOCK_MS = 30000;
const sameStr = (a, b) => { const x = require('crypto').createHash('sha256').update(String(a)).digest(), y = require('crypto').createHash('sha256').update(String(b)).digest(); return require('crypto').timingSafeEqual(x, y); };
// Quyền module PC thực tế. Tài khoản Quản trị CŨ (tạo trước khi có quyền PC) mà CHƯA tài khoản nào được cấp module PC
// → coi như đủ quyền, để không ai bị khóa ngoài ngay sau khi cập nhật.
function effectivePc(u, list) {
  if (isAdminName(u.ten)) return PQ_PC.slice(); // admin: luôn đủ quyền
  const role = roleOf(u);
  // PC 7.14: Quản trị = toàn quyền song song với admin; PC 7.43: trừ module / kho Quản trị tự bỏ tick (xem limitPcByRole)
  return limitPcByRole(cleanPcModules(u.pcModules), role); // cấp 1 / 2 / Quản lý: chỉ module được phân quyền (đã bỏ mục Cài đặt không hợp vai trò)
}
function publicUser(u, list) {
  return { ten: u.ten, tenHienThi: u.tenHienThi || u.ten, quyen: u.quyen, pc: effectivePc(u, list), kho: Array.isArray(u.kho) ? u.kho.slice() : [], matKhauMacDinh: isDefaultAdmin(u), isAdmin: isAdminName(u.ten), isQuanTri: isQuanTri(u),
    vaiTro: roleOf(u), canWrite: roleLevel(u) >= 3, canExport: roleLevel(u) >= 2 };
}
function findSessionUser(list) {
  if (!authSessionTen) return null;
  const u = list.find(x => String(x.ten || '').toLowerCase() === authSessionTen);
  return (u && u.bat !== false) ? u : null;
}
// PC 7.52 — TỰ CẬP NHẬT QUYỀN, KHÔNG CẦN ĐĂNG XUẤT: khi Quản trị đổi vai trò / module / kho / bật-tắt của tài khoản đang đăng nhập (trên máy này,
// hoặc trên máy khác / điện thoại rồi lên Sheet), main.js phát hiện và báo cho giao diện (auth:perm-changed) → trang tự tải lại với quyền mới.
// Mốc so sánh = chữ ký quyền mà giao diện đọc lần cuối (permSeenSig, đặt ở auth:state / auth:login) nên mỗi lần đổi chỉ báo MỘT lần.
let permSeenSig = null, permWatchBusy = false;
function sessionPermSig(list) {
  const u = findSessionUser(list);
  if (!u) return authSessionTen ? 'none' : null; // bị tắt / bị xóa → 'none' (giao diện hỏi lại auth:state sẽ bị khóa về màn đăng nhập)
  const p = publicUser(u, list);
  return JSON.stringify([p.vaiTro, (p.pc || []).slice().sort(), (p.kho || []).slice().sort()]);
}
async function permWatch(pullSheet) {
  if (permWatchBusy || !authSessionTen || permSeenSig === null) return;
  permWatchBusy = true;
  try {
    let list;
    if (pullSheet && !isAdminName(authSessionTen) && loadSheetsConfig().webAppUrl && loadSheetsConfig().pcToken) {
      list = await Promise.race([loadPermListMerged(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]).catch(() => null);
    }
    if (!list) list = ensureDefaultAdmin(storedPerm());
    const sig = sessionPermSig(list);
    if (sig !== null && sig !== permSeenSig && mainWindow && !mainWindow.isDestroyed()) {
      permSeenSig = sig; // chỉ báo 1 lần; giao diện gọi auth:state sau đó sẽ đặt lại cùng giá trị
      mainWindow.webContents.send('auth:perm-changed', { removed: sig === 'none' });
    }
  } catch (e) { /* mất mạng / lỗi đọc: bỏ qua, vòng sau thử lại */ }
  finally { permWatchBusy = false; }
}
setInterval(() => { permWatch(true); }, 30 * 1000); // kéo Sheet mỗi 30 giây (đổi quyền từ máy khác / điện thoại)
// PC 0.19: bỏ vòng 4 giây — đổi tài khoản trên máy này giờ báo NGAY qua saveSheetsConfig(); vòng 60 giây chỉ để
// bắt trường hợp file cấu hình bị thay từ ngoài (khôi phục sao lưu…). Không dùng mạng.
setInterval(() => { permWatch(false); }, 60 * 1000);
// ---------------------------------------------------------------------------
// THIẾT LẬP MÁY MỚI (PC 7.95) — thay cho đăng nhập admin / admin lần đầu.
// Máy chưa có tài khoản nào (giải nén bản mới / mất file cấu hình) → KHÔNG cho đăng nhập, KHÔNG tạo admin / admin. Người dùng phải:
//   (1) "Kéo tài khoản về" từ Google Sheet (Web App + PC_TOKEN lấy từ app-config.js, thiếu thì nhập) → rồi đăng nhập bằng tài khoản đã cấp; hoặc
//   (2) nếu Sheet CHƯA có tài khoản nào → tạo tài khoản admin (chủ hệ thống) với mã tự đặt; hoặc nạp lại từ file sheets-sync-config.json đã sao lưu.
// Các lệnh setup:* chỉ chạy khi isFreshMachine() — đã có tài khoản thật thì từ chối hết (không thể dùng để vượt đăng nhập).
// ---------------------------------------------------------------------------
const SETUP_DENY = { ok: false, error: 'Máy này đã có tài khoản — không dùng được màn thiết lập máy mới.' };
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'Hết thời gian chờ')), ms))]);
const setupInfo = () => { const c = loadSheetsConfig(); return { hasUrl: !!c.webAppUrl, hasToken: !!c.pcToken, urlFixed: !!FIXED_WEBAPP_URL, tokenFixed: !!FIXED_PC_TOKEN }; };
// Danh sách (từ Sheet hoặc file cấu hình) → tài khoản HỢP LỆ đã chuẩn hóa (bỏ dòng sai tên / mã yếu / trùng). Cho phép cả admin nếu mã đủ mạnh (chỉ ở bước thiết lập máy mới).
function importAccounts(rows) {
  const lc = (x) => String(x || '').trim().toLowerCase();
  const pc = String(loadSheetsConfig().pcToken || '').trim();
  const ok = [], seenT = new Set(), seenK = new Set();
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const ten = String(r && r.ten || '').trim(), token = String(r && r.token || '').trim();
    if (!PQ_USER_OK.test(ten) || seenT.has(lc(ten))) return;
    if (token.length < PQ_MIN_TOKEN || token.length > 64 || !PQ_TOKEN_OK.test(token) || (pc && token === pc) || seenK.has(token.toLowerCase())) return;
    seenT.add(lc(ten)); seenK.add(token.toLowerCase());
    ok.push(permFromSheet({ ten, tenHienThi: r.tenHienThi, token, quyen: PQ_QUYEN.includes(r.quyen) ? r.quyen : 'xem', kho: Array.isArray(r.kho) ? r.kho : [], bat: r.bat !== false, pcModules: Array.isArray(r.pcModules) ? r.pcModules : [] }, i));
  });
  try { return cleanPermList(ok); } catch (e) { return []; }
}
// PC 8.52: MÁY MỚI (vừa thiết lập tài khoản lần đầu) → Trợ lý AI MẶC ĐỊNH TẮT. Máy chưa có dòng AI_Config vốn đã tắt; hàm này lo trường hợp database mang từ máy khác sang
// (chép file / khôi phục) đã có enabled=true — tắt lại, GIỮ NGUYÊN API Key + model để người dùng chủ động bật ở Cài Đặt › Trợ Lý AI khi cần.
function aiOffForNewMachine() {
  try {
    const cur = readSheet('settings', 'AI_Config'), row = (cur && cur[0]) || null;
    if (row && (row.enabled === true || String(row.enabled) === 'true')) writeSheet('settings', 'AI_Config', [{ apiKey: row.apiKey || '', model: row.model || '', enabled: false }]);
  } catch (err) { console.error('Khong tat duoc Tro ly AI cho may moi:', err.message); }
}
ipcMain.handle('setup:pull', async (event, o) => {
  if (!isFreshMachine()) return SETUP_DENY;
  try {
    o = o || {};
    let cfg = loadSheetsConfig();
    const patch = {};
    if (!cfg.webAppUrl) { const u = String(o.url || '').trim(); if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(u)) return { ok: false, needInput: true, error: 'Nhập đường dẫn Web App (bắt đầu https://script.google.com/… và kết thúc bằng /exec).' }; patch.webAppUrl = u; }
    if (!cfg.pcToken) { const t = String(o.pcToken || '').trim(); if (!t) return { ok: false, needInput: true, error: 'Nhập mã PC_TOKEN.' }; patch.pcToken = t; }
    if (Object.keys(patch).length) cfg = patchSheetsConfig(patch);
    let rows;
    try { rows = await withTimeout(readPermFromSheet(cfg), 25000, 'Hết 25 giây chờ Google Sheet'); }
    catch (err) { return { ok: false, network: true, error: 'Không kéo được danh sách từ Google Sheet: ' + err.message }; }
    const accounts = importAccounts(rows || []);
    if (!accounts.length) return { ok: true, count: 0, sheetRows: (rows || []).length };
    patchSheetsConfig({ phanQuyen: accounts, phanQuyenPushedAt: new Date().toISOString(), pcSplitM01: true, pcSplitSheet: true, pcSplitRDSheet: true, pcSplitRD: true });
    aiOffForNewMachine();
    return { ok: true, count: accounts.length, sheetRows: (rows || []).length, skipped: Math.max(0, (rows || []).length - accounts.length) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('setup:create-admin', async (event, ma, o) => {
  if (!isFreshMachine()) return SETUP_DENY;
  try {
    o = o || {};
    const code = String(ma || '').trim(), cfg = loadSheetsConfig();
    if (code.length < PQ_MIN_TOKEN || code.length > 64 || !PQ_TOKEN_OK.test(code) || code.toLowerCase() === 'admin') return { ok: false, error: 'Mã admin 8–64 ký tự: chữ không dấu, số và - _ . @ # ! (không dấu cách, không dùng chữ "admin").' };
    if (cfg.pcToken && code === cfg.pcToken) return { ok: false, error: 'Mã trùng PC_TOKEN của máy PC — chọn mã khác.' };
    const online = !!(cfg.webAppUrl && cfg.pcToken) && !o.offline;
    if (online) { // Sheet phải ĐỌC ĐƯỢC và CHƯA có tài khoản — ngược lại phải kéo về, không tạo mới (tránh ghi đè)
      let rows;
      try { rows = await withTimeout(readPermFromSheet(cfg), 25000, 'Hết 25 giây chờ Google Sheet'); }
      catch (err) { return { ok: false, network: true, error: 'Không đọc được Google Sheet (' + err.message + ') nên chưa tạo tài khoản — trên Sheet có thể đã có tài khoản. Kiểm tra mạng rồi thử lại.' }; }
      if ((rows || []).length) return { ok: false, hasAccounts: true, error: 'Trên Google Sheet đã có ' + rows.length + ' dòng tài khoản — hãy bấm "Kéo tài khoản về" thay vì tạo mới.' };
    }
    const admin = { id: 'u' + Date.now().toString(36) + 'adm', ten: 'admin', tenHienThi: 'Quản trị', token: code, quyen: 'quantri', kho: PQ_KHO.slice(), bat: true, tuDat: true, pcModules: PQ_PC.slice() };
    patchSheetsConfig({ phanQuyen: [admin], phanQuyenPushedAt: null, pcSplitM01: true, pcSplitSheet: true, pcSplitRDSheet: true, pcSplitRD: true });
    let pushed = false, warning = '';
    if (online) {
      try { await withSheetsSyncLock(() => pushPermTab(loadSheetsConfig(), [admin], {})); patchSheetsConfig({ phanQuyenPushedAt: new Date().toISOString() }); pushed = true; }
      catch (err) { warning = 'Đã tạo admin trên máy nhưng chưa đẩy lên Sheet: ' + err.message; }
    } else if (o.offline) warning = 'Đã tạo admin TẠM trên máy này (không có mạng). Khi có mạng: Cài đặt › Tài khoản › "Kéo danh sách từ Sheet" rồi lưu lại.';
    aiOffForNewMachine();
    return { ok: true, pushed, warning };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('setup:import-file', async () => {
  if (!isFreshMachine()) return SETUP_DENY;
  try {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Chọn file cấu hình đã sao lưu (sheets-sync-config.json)', properties: ['openFile'], filters: [{ name: 'File cấu hình (.json)', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: true, canceled: true };
    const st = fs.statSync(r.filePaths[0]); if (st.size > 2 * 1024 * 1024) return { ok: false, error: 'File quá lớn — không phải file cấu hình.' };
    let o; try { o = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (e) { return { ok: false, error: 'Không đọc được file (không phải JSON).' }; }
    const allDec = decryptCfgSecrets(o); // PC 0.20: file sao lưu từ CHÍNH máy này giải mã được; từ máy khác thì không
    const accounts = importAccounts(o && o.phanQuyen);
    if (!accounts.length && !allDec) return { ok: false, error: 'File cấu hình này được mã hóa trên máy (hoặc tài khoản Windows) khác nên không đọc được mã truy cập. Hãy dùng "Kéo tài khoản từ Google Sheet".' };
    if (isEncOpaque(o && o.pcToken)) o.pcToken = '';
    if (!accounts.length) return { ok: false, error: 'File này không có tài khoản hợp lệ nào (cần mục "phanQuyen" với tên + mã 8 ký tự trở lên).' };
    const patch = { phanQuyen: accounts, phanQuyenPushedAt: null, pcSplitM01: true, pcSplitSheet: true, pcSplitRDSheet: true, pcSplitRD: true };
    const cur = loadSheetsConfig();
    if (!cur.webAppUrl && /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(String(o.webAppUrl || ''))) patch.webAppUrl = String(o.webAppUrl).trim();
    if (!cur.pcToken && String(o.pcToken || '').trim()) patch.pcToken = String(o.pcToken).trim();
    patchSheetsConfig(patch);
    aiOffForNewMachine();
    return { ok: true, count: accounts.length };
  } catch (err) { return { ok: false, error: err.message }; }
});
// Cài đặt › Tài khoản › "Kéo danh sách từ Sheet": gộp tài khoản có trên Sheet mà máy này chưa có (và lấy quyền / mã mới nhất từ Sheet); KHÔNG xóa tài khoản nào trên máy.
ipcMain.handle('sheets:perm-pull', async () => {
  const deny = requireTaiKhoan(); if (deny) return { ok: false, error: deny };
  try {
    const cfg = loadSheetsConfig();
    if (!(cfg.webAppUrl && cfg.pcToken)) return { ok: false, error: 'Chưa có Web App + PC_TOKEN (Cài đặt › Điện thoại).' };
    const rows = await withTimeout(readPermFromSheet(cfg), 25000, 'Hết 25 giây chờ Google Sheet');
    if (!rows) return { ok: false, error: 'Tab PhanQuyen trên Sheet chưa có cột maTruyCap — dán Code.gs mới vào Apps Script.' };
    const local = storedPerm(), before = new Set(local.map((u) => String(u.ten).toLowerCase()));
    const mg = mergePermFromSheet(local, rows, false);
    const added = mg.list.filter((u) => !before.has(String(u.ten).toLowerCase())).length;
    if (mg.changed) patchSheetsConfig({ phanQuyen: mg.list });
    return { ok: true, added, sheetRows: rows.length, changed: mg.changed };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('auth:state', async () => {
  try {
    const list = ensureDefaultAdmin(storedPerm());
    const u = findSessionUser(list);
    if (!u) { authSessionTen = null; permSeenSig = null; const fresh = isFreshMachine(); return { ok: true, user: null, setup: fresh, setupInfo: fresh ? setupInfo() : null }; }
    permSeenSig = sessionPermSig(list); // PC 7.52: giao diện vừa đọc quyền → mốc để phát hiện quyền đổi (xem permWatch)
    return { ok: true, user: publicUser(u, list) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('auth:login', async (event, ten, matKhau, ghiNho, tuDong) => {
  let usedSaved = false;
  try {
    const now = Date.now();
    if (authFail.until > now) return { ok: false, error: `Nhập sai nhiều lần — thử lại sau ${Math.ceil((authFail.until - now) / 1000)} giây.` };
    if (isFreshMachine()) return { ok: false, setup: true, error: 'Máy này chưa có tài khoản — hãy thiết lập máy mới (kéo danh sách tài khoản từ Google Sheet) trước.' };
    let list = ensureDefaultAdmin(storedPerm());
    const nameKey = String(ten || '').trim().toLowerCase();
    const findU = () => list.find(x => String(x.ten || '').toLowerCase() === nameKey);
    let u = findU();
    let pass = String(matKhau || '');
    if (!pass) { // để trống → dùng mã đã ghi nhớ (nếu đúng người đã nhớ)
      const rem = readRemembered();
      if (rem && rem.ten.toLowerCase() === nameKey) { pass = rem.pass; usedSaved = true; }
    }
    // PC 7.9: máy mới / mất file cấu hình → danh sách chỉ có admin mặc định. Không khớp trên máy thì kéo danh sách từ Google Sheet
    // (nếu đã có Web App + PC_TOKEN) rồi thử lại 1 lần — để tài khoản Quản trị đồng bộ qua Sheet đăng nhập được ngay, không phải dùng admin mặc định.
    // Riêng admin KHÔNG bao giờ lấy từ Sheet nên bỏ qua bước này.
    // PC 7.45: MỖI LẦN đăng nhập đều kéo phân quyền mới nhất từ Sheet (trước đây chỉ kéo khi mã không khớp → tài khoản con đúng mã vẫn
    // dùng quyền module / kho CŨ trên máy, dù Quản trị đã đổi trên điện thoại; chỉ khi Quản trị mở Cài đặt › Tài khoản mới cập nhật).
    // Chờ tối đa 8 giây — mất mạng / Sheet chậm thì dùng danh sách đang có trên máy.
    let pulled = false;
    const pullSheetPerm = async () => {
      pulled = true;
      const c = loadSheetsConfig();
      if (!(c.webAppUrl && c.pcToken)) return;
      try {
        list = await Promise.race([loadPermListMerged(), new Promise((_, rej) => setTimeout(() => rej(new Error('Hết 8 giây chờ Sheet')), 8000))]);
        u = findU();
      } catch (e) { /* offline → giữ danh sách trên máy */ }
    };
    // admin KHÔNG lấy quyền từ Sheet — trừ khi còn mã mặc định (kéo Sheet trước: có Quản trị thì admin / admin bị khóa, PC 7.11)
    if (!isAdminName(nameKey) || (AUTO_LOCK_ADMIN && u && isDefaultAdmin(u))) await pullSheetPerm();
    if (pass && !pulled && !isAdminName(nameKey) && !(u && sameStr(u.token || '', pass))) await pullSheetPerm();
    if (u && isEncOpaque(u.token)) { // PC 0.20 — mã mã hóa trên máy / tài khoản Windows khác, máy này không đọc được
      return { ok: false, error: 'Mã của tài khoản này được mã hóa trên máy (hoặc tài khoản Windows) khác nên máy này không đọc được. Đăng nhập bằng tài khoản khác rồi vào Cài đặt › Tài khoản › "Kéo danh sách từ Sheet", hoặc đặt lại mã cho tài khoản này.' };
    }
    if (!u || !pass || !sameStr(u.token || '', pass)) {
      if (usedSaved) clearRemembered(); // mã đã lưu không còn đúng (bị đổi / đặt lại) → xóa, bắt nhập lại
      authFail.n++;
      if (authFail.n >= AUTH_MAX_FAIL) { authFail.n = 0; authFail.until = now + AUTH_LOCK_MS; }
      return { ok: false, error: usedSaved ? 'Mã đã ghi nhớ không còn đúng (có thể đã bị đổi) — nhập lại mã truy cập.' : 'Sai tên người dùng hoặc mã truy cập.' };
    }
    if (u.bat === false) return { ok: false, error: 'Tài khoản này đang bị tắt.' };
    if (!effectivePc(u, list).length) return { ok: false, error: 'Tài khoản này chưa được cấp quyền dùng trên PC — nhờ quản trị bật module PC ở Cài đặt › Tài khoản.' };
    authFail.n = 0; authSessionTen = String(u.ten).toLowerCase();
    let remembered = false;
    // PC 7.33: ô "Tự động đăng nhập" (chỉ có nghĩa khi đã ghi nhớ) → lần mở app sau tự vào, không cần bấm Đăng nhập
    if (ghiNho) remembered = writeRemembered(u.ten, pass, !!tuDong);
    else clearRemembered();
    permSeenSig = sessionPermSig(list);
    histNote('dang-nhap', 'Hệ thống', 'Đăng nhập' + (usedSaved ? ' (mã đã ghi nhớ)' : ''));
    return { ok: true, user: publicUser(u, list), remembered };
  } catch (err) { return { ok: false, error: err.message }; }
});
// GHI NHỚ ĐĂNG NHẬP: tên + mã truy cập được mã hóa bằng safeStorage (Windows DPAPI — chỉ đúng tài khoản Windows trên máy này giải mã được)
// rồi lưu trong userData. Mã KHÔNG bao giờ trả về giao diện: giao diện chỉ biết "đã nhớ tên X" và gửi mật khẩu rỗng để main tự dùng bản đã lưu.
const rememberFile = () => path.join(app.getPath('userData'), 'kla-remember.bin');
function readRemembered() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(rememberFile())) return null;
    const o = JSON.parse(safeStorage.decryptString(fs.readFileSync(rememberFile())));
    return (o && o.ten && o.pass) ? { ten: String(o.ten), pass: String(o.pass), auto: o.auto === true } : null;
  } catch (e) { return null; }
}
function writeRemembered(ten, pass, auto) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.writeFileSync(rememberFile(), safeStorage.encryptString(JSON.stringify({ ten: String(ten), pass: String(pass), auto: !!auto })));
    return true;
  } catch (e) { return false; }
}
function clearRemembered() { try { if (fs.existsSync(rememberFile())) fs.unlinkSync(rememberFile()); } catch (e) {} }
ipcMain.handle('auth:remembered', async () => {
  const r = readRemembered();
  return { ok: true, has: !!r, ten: r ? r.ten : '', auto: !!(r && r.auto), canRemember: (() => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } })() };
});
ipcMain.handle('auth:forget', async () => { clearRemembered(); return { ok: true }; });
// Đăng xuất = người dùng chủ động rời phiên → tắt tự động đăng nhập (vẫn giữ ghi nhớ tên/mã) để không bị tự vào lại ngay; muốn bật lại thì tick lại ở lần đăng nhập sau.
ipcMain.handle('auth:logout', async () => { if (authSessionTen) histNote('dang-xuat', 'Hệ thống', 'Đăng xuất'); authSessionTen = null; const r = readRemembered(); if (r && r.auto) writeRemembered(r.ten, r.pass, false); return { ok: true }; });
// PC 7.47 — TỰ ĐĂNG XUẤT KHI CẬP NHẬT PHẦN MỀM: sau khi cập nhật (hoặc quay lại bản cũ) app khởi động lại → phải đăng nhập lại để nhận
// quyền / giao diện bản mới. Giống bấm "Đăng xuất": xóa phiên + tắt "Tự động đăng nhập" (tên + mã ghi nhớ vẫn giữ → chỉ cần bấm Đăng nhập).
// Chỉ áp dụng cho app PC; app điện thoại có cơ chế riêng, không đổi.
function forceLogoutAfterUpdate() {
  try { authSessionTen = null; const r = readRemembered(); if (r && r.auto) writeRemembered(r.ten, r.pass, false); } catch (e) { logError('Đăng xuất sau cập nhật', e); }
}
// Phòng khi cập nhật bằng cách chép file tay / cách khác (không qua nút Cập nhật): lúc khởi động thấy số phiên bản khác lần chạy trước → cũng đăng xuất.
// Lần chạy đầu tiên (chưa có dấu phiên bản) chỉ ghi nhận, không đăng xuất.
// PC 7.95: sau khi cập nhật lên bố cục thư mục mới → file code cũ ở gốc app/ được chuyển vào _ban-cu/legacy-…/ (không xóa); ghi nhật ký việc chuyển cấu hình.
app.whenReady().then(() => {
  try {
    const mv = PATHS.sweepLegacyCode();
    if (LEGACY_MIGRATION.moved.length || mv.length || LEGACY_MIGRATION.errors.length) logError('Bố cục thư mục mới', new Error('cấu hình chuyển sang config/: ' + (LEGACY_MIGRATION.moved.join(', ') || '—') + (LEGACY_MIGRATION.errors.length ? ' · LỖI: ' + LEGACY_MIGRATION.errors.join('; ') : '') + ' · file mã cũ đã dọn: ' + (mv.join(', ') || '—')));
  } catch (e) { /* không dọn được thì để nguyên */ }
});
app.whenReady().then(() => {
  try {
    const cur = String((JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')) || {}).version || '').trim();
    if (!cur) return;
    const mark = path.join(app.getPath('userData'), 'kla-last-version.txt');
    let last = ''; try { last = fs.readFileSync(mark, 'utf8').trim(); } catch (e) { /* chưa có */ }
    if (last && last !== cur) forceLogoutAfterUpdate();
    if (last !== cur) fs.writeFileSync(mark, cur, 'utf8');
  } catch (e) { /* không đọc được version.json → bỏ qua */ }
});
// Người đang đăng nhập tự đổi mã của mình (không cần quyền TAIKHOAN).
ipcMain.handle('auth:change-password', async (event, matKhauCu, matKhauMoi) => {
  try {
    const list = ensureDefaultAdmin(storedPerm());
    const me = findSessionUser(list);
    if (!me) return { ok: false, error: 'Chưa đăng nhập.' };
    if (!sameStr(me.token || '', String(matKhauCu || ''))) return { ok: false, error: 'Mã hiện tại không đúng.' };
    const nw = String(matKhauMoi || '').trim();
    if (nw === me.token) return { ok: false, error: 'Mã mới phải khác mã hiện tại.' };
    const next = list.map(u => u === me ? { ...u, token: nw, tuDat: true } : u);
    const r = await permSaveCore(next, { soft: true });
    if (!r.ok) return r;
    { const rem = readRemembered(); if (rem && rem.ten.toLowerCase() === String(me.ten).toLowerCase()) writeRemembered(me.ten, nw, rem.auto); } // đang nhớ chính người này → cập nhật mã mới
    histNote('he-thong', 'Hệ thống', 'Đổi mật khẩu của chính mình');
    return { ok: true, pushed: !!r.pushed, warning: r.warning || '', user: publicUser(findSessionUser(r.list) || me, r.list) };
  } catch (err) { return { ok: false, error: err.message }; }
});
// Kiểm quyền cho PC_GUARD (đầu file): trả '' nếu được phép, ngược lại là câu báo lỗi hiện cho người dùng.
// Tài khoản Quản trị = tài khoản có vai trò "Quản trị" (quyen === 'quantri') hoặc admin chính. Dùng cho chế độ "Máy chủ" của Mạng LAN.
const isQuanTri = (u) => !!u && (isAdminName(u.ten) || u.quyen === 'quantri');
function pcGuardDeny(code, args) {
  if (code === 'READ') return authSessionTen ? '' : 'Chưa đăng nhập.'; // PC 7.18: kiểm nhẹ theo phiên (đọc nhiều, không đọc file phân quyền mỗi lần)
  try {
    const list = ensureDefaultAdmin(storedPerm());
    const u = findSessionUser(list);
    if (!u) return 'Chưa đăng nhập.';
    if (code === 'ANY') return ''; // PC 7.3: mục cơ bản — chỉ cần đã đăng nhập
    if (code === 'LANCFG') { // Mạng LAN: Máy đơn / Máy con ai cũng đặt được; đặt hoặc đổi MÁY CHỦ chỉ Quản trị (kể cả khi máy này đang là máy chủ)
      const want = args && args[0] && args[0].mode;
      if ((want === 'server' || lan.isServer()) && !isQuanTri(u)) return 'Chế độ “Máy chủ” của Mạng LAN chỉ tài khoản Quản trị được đặt hoặc đổi.';
      return '';
    }
    if (code === 'ADMIN') return isQuanTri(u) ? '' : 'Chỉ tài khoản Quản trị được xem / đổi mục này.';
    if (code === 'WRITE') { // PC 7.14: ghi dữ liệu module — cấp 1 chỉ xem; cấp 2 chỉ ghi module xuất phiếu; Quản lý trở lên ghi đủ
      const lv = roleLevel(u);
      if (lv >= 3) return '';
      const key = String(args && args[0] || '');
      if (ANY_WRITE_KEYS.includes(key)) return '';
      if (lv === 2 && XUAT_WRITE_KEYS.includes(key)) return '';
      return 'Bạn không được cấp quyền';
    }
    if (code === 'WRITE_QL') return roleLevel(u) >= 3 ? '' : 'Bạn không được cấp quyền';
    if (code === 'LT_CFG') { // PC 1.03: bật / tắt máy chủ LAN + Drive của Lưu trữ cá nhân — cần quyền M19 và vai trò Quản lý trở lên
      if (roleLevel(u) < 3) return 'Chỉ tài khoản Quản lý trở lên được đổi cài đặt đồng bộ của Lưu trữ cá nhân.';
      return effectivePc(u, list).includes('M19') ? '' : 'Tài khoản của bạn không có quyền dùng “Lưu trữ cá nhân”.';
    }
    if (code === 'DCX_WRITE') { // PC 0.65: ghi thẳng vào file Excel Kho — như ghi dữ liệu module (Quản lý trở lên) và phải có quyền M16
      if (roleLevel(u) < 3) return 'Bạn không được cấp quyền sửa dữ liệu (tài khoản chỉ xem / xuất phiếu không ghi được vào file Excel).';
      return effectivePc(u, list).includes('M16') ? '' : 'Tài khoản của bạn không có quyền dùng “Đối chiếu hàng ngày”.';
    }
    if (!effectivePc(u, list).includes(code)) return `Tài khoản của bạn không có quyền dùng mục “${PC_GUARD_NAME[code] || code}” trong Cài đặt — nhờ quản trị bật ở Cài đặt › Tài khoản.`;
    return '';
  } catch (err) { return 'Không kiểm tra được quyền: ' + err.message; }
}
// Chỉ tài khoản được mở menu "Tài khoản" mới xem / sửa được danh sách (có cả mã gốc của mọi người).
function requireTaiKhoan() {
  const list = ensureDefaultAdmin(storedPerm());
  const u = findSessionUser(list);
  if (!u) return 'Chưa đăng nhập.';
  if (!effectivePc(u, list).includes('TAIKHOAN')) return 'Tài khoản của bạn không có quyền quản lý tài khoản.';
  return '';
}
ipcMain.handle('sheets:perm-get', async () => {
  const deny = requireTaiKhoan(); if (deny) return { ok: false, error: deny };
  try {
    let list = await loadPermListMerged();
    // Bản cũ chưa ai có quyền PC: Quản trị hiện đủ quyền (xem effectivePc) → điền sẵn để bảng không báo "không có" và lưu lại không tự khóa.
    if (!list.some(u => cleanPcModules(u.pcModules).length)) list = list.map(u => u.quyen === 'quantri' ? { ...u, pcModules: PQ_PC.slice() } : u);
    // PC 7.43: Quản trị (bản cũ có thể trống) → form hiện đúng quyền thực tế: trống = đủ kho + đủ module; luôn kèm quyền Cài đặt / Tài khoản.
    list = list.map(u => (u.quyen === 'quantri' || isAdminName(u.ten))
      ? { ...u, pcModules: isAdminName(u.ten) ? PQ_PC.slice() : limitPcByRole(cleanPcModules(u.pcModules), 'quantri'),
          kho: (isAdminName(u.ten) || !Array.isArray(u.kho) || !u.kho.length) ? PQ_KHO.slice() : u.kho } : u);
    // Người xem KHÔNG phải admin: mã của admin không bao giờ rời tiến trình chính (giao diện chỉ thấy dòng admin bị làm mờ).
    const sessUser = findSessionUser(ensureDefaultAdmin(storedPerm()));
    const viewerIsAdmin = !!sessUser && isAdminName(sessUser.ten);
    // PC 7.15: không xem được mã của tài khoản CÙNG CẤP hoặc CAO HƠN mình — Quản trị: giấu admin + Quản trị; Quản lý: giấu cả Quản lý (kể cả chính mình), Quản trị, admin.
    // PC 7.17: riêng tài khoản QUẢN TRỊ (không phải admin) vẫn xem được mã của CHÍNH MÌNH.
    if (!viewerIsAdmin) { const lim = Math.min(permLevel(sessUser), 4), selfQT = !!sessUser && roleOf(sessUser) === 'quantri', me = String(sessUser && sessUser.ten || '').trim().toLowerCase();
      list = list.map(u => (permLevel(u) >= lim && !(selfQT && String(u.ten || '').trim().toLowerCase() === me)) ? { ...u, token: '' } : u); }
    return { ok: true, list, viewerIsAdmin };
  }
  catch (err) { return { ok: false, error: err.message }; }
});
// opts.confirmLost: người dùng đã xác nhận XÓA các tài khoản sẽ biến mất khỏi Sheet. opts.soft: đổi mã của chính mình — luôn lưu trên máy, không bao giờ hỏi xóa
// (nếu có gì bất thường thì chỉ BỎ QUA bước đẩy lên Sheet kèm cảnh báo).
async function permSaveCore(list, opts) {
  opts = opts || {};
  const lc = (x) => String(x || '').trim().toLowerCase();
  let clean;
  try { clean = cleanPermList(list); } catch (err) { return { ok: false, error: err.message }; }
  const c0 = loadSheetsConfig();
  const oldNames = new Set((c0.phanQuyen || []).map((u) => lc(u.ten)));
  let sheetRows = null;
  if (c0.webAppUrl && c0.pcToken) {
    try {
      sheetRows = await readPermFromSheet(c0);
      // Người vừa được tạo trên điện thoại (chưa có trong danh sách PC cũ lẫn mới) → giữ lại, không để lần đẩy này xóa mất.
      const known = new Set((c0.phanQuyen || []).concat(clean).map((u) => lc(u.ten)));
      (sheetRows || []).forEach((r, i) => { if (!known.has(lc(r.ten)) && r.token) clean.push(permFromSheet(r, i)); });
    } catch (err) { console.error('Loi doc phan quyen truoc khi luu:', err.message); }
  }
  // PC 7.95: tài khoản đang có trên Sheet mà danh sách mới KHÔNG còn. "chủ động" = máy này từng có (người dùng vừa xóa);
  // "lạ" = máy này chưa từng có (vd Sheet chỉ lưu mã băm, không có mã gốc để kéo về) → luôn phải xác nhận.
  const cleanNames = new Set(clean.map((u) => lc(u.ten)));
  const vanish = (sheetRows || []).filter((r) => r.ten && !isAdminName(r.ten) && !cleanNames.has(lc(r.ten))).map((r) => r.ten);
  const strange = vanish.filter((n) => !oldNames.has(lc(n)));
  const needConfirm = !opts.confirmLost && (strange.length > 0 || vanish.length >= 2);
  if (needConfirm && !opts.soft) {
    return { ok: false, needConfirm: true, lost: vanish, error: 'Lần lưu này sẽ XÓA ' + vanish.length + ' tài khoản khỏi Google Sheet: ' + vanish.slice(0, 8).join(', ') + (vanish.length > 8 ? '…' : '') + '.' };
  }
  patchSheetsConfig({ phanQuyen: clean, phanQuyenPushedAt: null });
  const cfg = loadSheetsConfig();
  if (!cfg.webAppUrl || !cfg.pcToken) return { ok: true, pushed: false, list: clean, warning: 'Đã lưu trên máy nhưng CHƯA đẩy lên Sheet — nhập Web App + PC_TOKEN rồi bấm Lưu lại.' };
  if (needConfirm && opts.soft) return { ok: true, pushed: false, list: clean, warning: 'Đã lưu trên máy, CHƯA đẩy lên Sheet: danh sách trên máy này chưa khớp với Sheet (' + vanish.slice(0, 4).join(', ') + '…). Vào Cài đặt › Tài khoản bấm "Kéo danh sách từ Sheet" rồi lưu lại.' };
  try {
    await withSheetsSyncLock(() => pushPermTab(cfg, clean, { allowNames: new Set(vanish.map(lc)) }));
    patchSheetsConfig({ phanQuyenPushedAt: new Date().toISOString() });
    return { ok: true, pushed: true, list: clean };
  } catch (err) {
    return { ok: true, pushed: false, list: clean, warning: 'Đã lưu trên máy nhưng đẩy lên Sheet lỗi: ' + err.message + (err.code ? '' : ' (Apps Script đã triển khai bản mới chưa?)') };
  }
}
// Luu danh sach + day ngay len Sheet (neu da cai Web App). Chua day duoc van LUU tren may, bao loi de bam lai.
ipcMain.handle('sheets:perm-save', async (event, list, opts) => {
  const deny = requireTaiKhoan(); if (deny) return { ok: false, error: deny };
  // Không cho tự khóa mình: sau khi lưu phải còn ít nhất 1 Quản trị đang bật có quyền TAIKHOAN.
  let arr = Array.isArray(list) ? list : [];
  {
    // PC 7.0: bản ghi admin chỉ admin được sửa. Người khác lưu → thay lại bằng bản ghi admin đang lưu trên máy (giữ mã, quyền…);
    // danh sách thiếu admin (bị xóa / đổi tên) → thêm lại. Admin tự lưu thì chỉ đảm bảo vẫn còn dòng admin.
    const cur = ensureDefaultAdmin(storedPerm());
    const stored = cur.find(u => isAdminName(u.ten));
    const me = findSessionUser(cur);
    const meAdmin = !!me && isAdminName(me.ten);
    const hasAdm = arr.some(u => u && isAdminName(u.ten));
    if (stored && (!meAdmin || !hasAdm)) arr = (hasAdm ? arr.map(u => (u && isAdminName(u.ten)) ? stored : u) : [stored].concat(arr));
  }
  {
    // PC 7.14: tài khoản vai trò QUẢN TRỊ chỉ do admin mặc định tạo / nâng / sửa / xóa. Quản trị khác chỉ quản lý được các vai trò còn lại.
    const cur = ensureDefaultAdmin(storedPerm());
    const me = findSessionUser(cur);
    if (!me || !isAdminName(me.ten)) {
      const curQT = new Map(cur.filter(x => !isAdminName(x.ten) && x.quyen === 'quantri').map(x => [String(x.ten).toLowerCase(), x]));
      const nameOf = (u) => String(u && u.ten || '').trim().toLowerCase();
      if (arr.some(u => u && !isAdminName(u.ten) && u.quyen === 'quantri' && !curQT.has(nameOf(u))))
        return { ok: false, error: 'Chỉ tài khoản admin mới được tạo / nâng tài khoản lên vai trò Quản trị.' };
      // PC 7.17: Quản trị (không phải admin) được đổi MÃ + TÊN HIỂN THỊ của CHÍNH MÌNH — vai trò / bật-tắt / tên đăng nhập vẫn giữ nguyên bản đang lưu.
      // PC 7.43: thêm KHO điện thoại + MODULE PC (tự bỏ tick để ẩn, tick lại để hiện); quyền Cài đặt / Tài khoản luôn được giữ lại ở cleanPermList.
      const meKey = me ? nameOf(me) : '', mineIn = (me && roleOf(me) === 'quantri') ? arr.find(u => nameOf(u) === meKey) : null;
      arr = arr.filter(u => !(u && curQT.has(nameOf(u)))).concat(Array.from(curQT.values()).map(x => {
        if (!mineIn || nameOf(x) !== meKey) return x; // giữ nguyên bản ghi các Quản trị đang có
        const tok = String(mineIn.token || '').trim(), hien = String(mineIn.tenHienThi || '').trim();
        return Object.assign({}, x, { token: tok || x.token, tenHienThi: hien || x.tenHienThi,
          kho: Array.isArray(mineIn.kho) ? mineIn.kho : x.kho, pcModules: Array.isArray(mineIn.pcModules) ? mineIn.pcModules : x.pcModules });
      }));
    }
  }
  {
    // PC 7.15: QUẢN LÝ được admin cấp quyền "Tài khoản" → chỉ tạo / xem mã / sửa / xóa người dùng CẤP 1 & 2.
    // Tài khoản cùng cấp hoặc cao hơn (Quản lý, Quản trị, admin): giữ nguyên bản ghi đang lưu — không sửa / xóa / đổi mã / nâng quyền được.
    const cur = ensureDefaultAdmin(storedPerm());
    const me = findSessionUser(cur);
    const nameOf = (u) => String(u && u.ten || '').trim().toLowerCase();
    if (me && !isAdminName(me.ten) && roleOf(me) === 'quanly') {
      const high = cur.filter(x => permLevel(x) >= 3);
      const highBy = new Map(high.map(x => [nameOf(x), x]));
      const lowBy = new Map(cur.filter(x => permLevel(x) < 3).map(x => [nameOf(x), x]));
      const myPc = effectivePc(me, cur), myKho = Array.isArray(me.kho) ? me.kho : [];
      // Chỉ cấp được quyền / kho mà chính mình có; phần ngoài phạm vi của mình trên tài khoản đó thì giữ nguyên.
      const inter = (sub, prev, mine) => { const s = Array.isArray(sub) ? sub : [], p = Array.isArray(prev) ? prev : []; return mine.filter(m => s.includes(m)).concat(p.filter(m => !mine.includes(m))); };
      const out = []; let bad = '';
      arr.forEach(u => {
        if (!u || bad) return;
        const k = nameOf(u), h = highBy.get(k);
        if (h) { if (String(u.id || '') !== String(h.id || '')) bad = 'Tên người dùng \u201c' + String(u.ten).trim() + '\u201d đã có.'; return; } // bản ghi cấp cao: bỏ, lát nữa đặt lại đúng bản đang lưu
        const role = PQ_QUYEN.includes(u.quyen) ? u.quyen : 'xem';
        if (role === 'quanly' || role === 'quantri') { bad = 'Vai trò Quản lý chỉ được tạo / sửa tài khoản Người dùng cấp 1 và cấp 2.'; return; }
        const prev = lowBy.get(k);
        out.push(Object.assign({}, u, { quyen: role, pcModules: inter(u.pcModules, prev && prev.pcModules, myPc), kho: inter(u.kho, prev && prev.kho, myKho) }));
      });
      if (bad) return { ok: false, error: bad };
      arr = out.concat(high);
    }
    if (!me || permLevel(me) < 4) {
      // Quyền "Tài khoản" của một Quản lý chỉ do tài khoản QUẢN TRỊ (hoặc admin) chỉ định: người dùng cấp thấp hơn lưu thì giữ nguyên trạng thái đang có.
      const storedBy = new Map(cur.map(x => [nameOf(x), x]));
      arr = arr.map(u => {
        if (!u || u.quyen !== 'quanly') return u;
        const prev = storedBy.get(nameOf(u));
        const had = !!(prev && prev.quyen === 'quanly' && cleanPcModules(prev.pcModules).includes('TAIKHOAN'));
        const mods = (Array.isArray(u.pcModules) ? u.pcModules : []).filter(m => m !== 'TAIKHOAN');
        return Object.assign({}, u, { pcModules: had ? mods.concat('TAIKHOAN') : mods });
      });
    }
  }
  if (!arr.some(u => u && (u.quyen === 'quantri' || isAdminName(u.ten)) && u.bat !== false))
    return { ok: false, error: 'Phải còn ít nhất 1 tài khoản Quản trị đang bật.' };
  const rr = await permSaveCore(arr, { confirmLost: !!(opts && opts.confirmLost) });
  if (rr && rr.ok) histNote('he-thong', 'Cài Đặt · Tài khoản', 'Lưu danh sách tài khoản / phân quyền');
  return rr;
});

// Luu lua chon bang (checkbox) cua nut "Đồng bộ ngay" o Cai Dat.
ipcMain.handle('sheets:set-pick', (event, pick) => {
  try {
    const cur = loadSheetsConfig();
    const next = { ...cur.syncPick };
    ['pull'].concat(SYNC_TABLES).forEach(k => { if (pick && k in pick) next[k] = !!pick[k]; });
    return { ok: true, config: uiConfig(patchSheetsConfig({ syncPick: next })) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// PC 7.41 — Luu chu ky tu dong (phut) cho TUNG muc o Cong cu > Dong bo dien thoai. 0 = tat.
ipcMain.handle('sheets:set-auto-pick', (event, map) => {
  try {
    const cur = loadSheetsConfig();
    const next = { ...getAutoPick(cur) };
    AUTO_KEYS.forEach(k => { if (map && k in map) { const m = Number(map[k]); next[k] = AUTO_MINUTES_OK.includes(m) ? m : 0; } });
    const cfg = patchSheetsConfig({ autoPick: next });
    scheduleAutoSheetsSync();
    return { ok: true, config: uiConfig(cfg) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Bam tay "Lấy phiếu xuất mới": keo phieu ve, co phieu moi thi DAY LAI ton kho ngay de dien
// thoai thay so ton da tru (khong phai cho toi vong tu dong ke tiep).
ipcMain.handle('sheets:pull-now', async () => {
  try { if (!syncAllowed().pull) return { ok: false, error: 'Tài khoản của bạn chưa được phân quyền module có phiếu xuất (M01 / M02).' }; } catch (err) { return { ok: false, error: err.message }; }
  try {
    const res = await withSheetsSyncLock(async () => {
      const r = await pullPhieuXuatVeLocal();
      // Day lai ton bat cu khi nao co bang can cap nhat (phieu moi HOAC phieu cu con ket) — loi day phai bao ra.
      if ((r.modulesMoi || []).length) {
        try { await pushTonKhoLenSheet(pickedSyncTables(r.modulesMoi)); r.pushed = pickedSyncTables(r.modulesMoi); }
        catch (err) { console.error('Loi day ton kho sau khi keo phieu:', err.message); r.pushError = err.message; }
      }
      return r;
    });
    return { ok: !res.pushError, error: res.pushError ? 'Đã nhận phiếu nhưng chưa đẩy được tồn lên điện thoại: ' + res.pushError : undefined,
      config: uiConfig(loadSheetsConfig()), soPhieuMoi: res.soPhieuMoi, soPhieuLoi: res.soPhieuLoi, pushed: res.pushed || [] };
  } catch (err) {
    return { ok: false, error: err.message, config: uiConfig(loadSheetsConfig()) };
  }
});

// LICH SU PHIEU DIEN THOAI (chi doc): doc TOAN BO tab PhieuXuat + PhieuXuatItems tren Google Sheet (moi trang thai:
// Chưa xử lý / Đã xử lý / Lỗi - Đã hủy...) de man hinh "Phiếu xuất toàn hệ thống" tren PC hien dung lich su ma dien
// thoai dang thay — ke ca phieu da xu ly nhung khong con trong database PC. KHONG ghi gi len Sheet hay vao Excel.
ipcMain.handle('sheets:history', async () => {
  try {
    const cfg = requireSheetsConfig();
    const [px, pxi] = await Promise.all([sheetsSync.readTable(cfg, SH_TAB.PX), sheetsSync.readTable(cfg, SH_TAB.PXI)]);
    // Gồm cả phiếu ĐÃ LƯU TRỮ (maybeArchivePhieu) — Code.gs cũ chưa có tab lưu trữ thì bỏ qua.
    try {
      const [pxA, pxiA] = await Promise.all([sheetsSync.readTable(cfg, SH_TAB.PX_LUUTRU), sheetsSync.readTable(cfg, SH_TAB.PXI_LUUTRU)]);
      px.rows = pxA.rows.concat(px.rows); pxi.rows = pxiA.rows.concat(pxi.rows);
    } catch (err) { /* chưa có lưu trữ */ }
    const itemsBy = {};
    pxi.rows.forEach(it => {
      const pid = String(it.phieuId || '').trim();
      if (!pid) return;
      (itemsBy[pid] = itemsBy[pid] || []).push({
        maHang: String(it.maHang ?? ''), tenHang: String(it.tenHang ?? ''), phieuNhap: String(it.phieuNhap ?? ''),
        soLo: String(it.soLo ?? ''), size: String(it.size ?? ''), viTri: String(it.viTri ?? ''),
        hopDong: String(it.hopDong ?? ''), soKien: syncToNumber(it.soKien), soLuongXuat: syncToNumber(it.soLuongXuat),
      });
    });
    const list = px.rows.filter(h => String(h.id || '').trim()).map(h => {
      const id = String(h.id).trim();
      return {
        id, maPhieu: String(h.maPhieu || '').trim(), ngayTao: sheetValueToIso(h.ngayTao),
        trangThai: String(h.trangThai || '').trim(), nguoiTao: String(h.nguoiTao || ''), ghiChu: String(h.ghiChu || ''),
        xuLyLuc: h.xuLyLuc ? sheetValueToIso(h.xuLyLuc) : '', module: String(h.module || '').trim(),
        items: (itemsBy[id] || []).filter(x => x.soLuongXuat > 0),
      };
    });
    return { ok: true, list };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// XOA PHIEU DIEN THOAI TREN PC -> bao len Sheet: doi trangThai thanh "Lỗi - Đã hủy trên PC" de dien thoai chuyen phieu
// sang tab "Đã hủy" (thay vi giu mai o "Đã nhận"/"đang cập nhật tồn"), roi day lai ton kho cua module do
// (so luong da duoc hoan lai tren PC). Loi mang/Sheet KHONG chan thao tac xoa tren PC — chi tra ve { ok:false }.
const TRANG_THAI_HUY_TREN_PC = 'Lỗi - Đã hủy trên PC';
ipcMain.handle('phone:mark-deleted', async (event, mod, ids) => {
  try {
    const cfg = loadSheetsConfig();
    if (!cfg.webAppUrl || !cfg.pcToken) return { ok: true, skipped: true };   // chua bat dong bo dien thoai
    const want = new Set((Array.isArray(ids) ? ids : []).map(x => String(x || '').trim()).filter(Boolean));
    if (!want.size) return { ok: true, marked: 0 };
    return await withSheetsSyncLock(async () => {
      const px = await sheetsSync.readTable(requireSheetsConfig(), SH_TAB.PX);
      const xuLyLuc = new Date().toISOString();
      const updates = px.rows
        .filter(h => want.has(String(h.id || '').trim()) && !String(h.trangThai || '').trim().startsWith('Lỗi'))
        .map(h => ({ rowNumber: h._rowNumber, id: String(h.id || '').trim(), values: { trangThai: TRANG_THAI_HUY_TREN_PC, xuLyLuc } }));
      if (updates.length) await sheetsSync.markRowsProcessed(requireSheetsConfig(), SH_TAB.PX, px.headers, updates);
      let pushError = null;
      if (SYNC_TABLES.includes(mod)) {
        try { await pushTonKhoLenSheet(pickedSyncTables([mod])); } catch (err) { pushError = err.message; }
      }
      return { ok: !pushError, marked: updates.length, error: pushError || undefined };
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Module 01/02 (iframe) dang ky "toi dang mo" ngay khi nap trang — tu day main.js giao phieu dien
// thoai cho chinh module do nhap thay vi tu ghi Excel (xem importPhieuIntoModule()).
ipcMain.handle('phone:register-module', (event, dbKey) => {
  const key = Object.prototype.hasOwnProperty.call(importFrames, dbKey) ? dbKey : 'module2';
  importFrames[key] = event.senderFrame;
  return { ok: true };
});

ipcMain.handle('phone:import-result', (event, reqId, result) => {
  const p = pendingImports.get(reqId);
  if (p) {
    pendingImports.delete(reqId);
    clearTimeout(p.timer);
    p.resolve(result);
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Nhãn module + hàm dùng chung cho Sao lưu & Drive (sao-luu-moi.js). Bản sao lưu cũ (backup:*) đã gỡ ở PC 7.68.
// ---------------------------------------------------------------------------
// PC 7.86: nhãn KHÔNG kèm số module — số trên menu đã đánh lại, còn tên file database vẫn là moduleN_… (không đổi)
const DB_LABELS = {
  module1: 'M01 · Tồn kho An An', module2: 'M02 · Tồn kho gửi', module3: 'M03 · NXT Bột/Sốt',
  module4: 'M04 · NXT TNK/TGC', module5: 'M05 · Số liệu kiểm kê', module6: 'M06 · In chứng từ kho',
  module7: 'M07 · Số liệu cuối kỳ', module8: 'M08 · Tổng hợp', module13: 'M13 · Phiếu nhập/xuất kho', module14: 'M14 · Container 3D', module16: 'M16 · Đối chiếu hàng ngày', settings: 'CD · Cài đặt', lichxuat: 'LX · Lịch xuất nhập hàng'
};
// Ban sao luu tu phien ban cu co the mang TEN FILE CU (xem DB_FILE_MIGRATIONS) — tim nguoc theo chuoi doi ten.
function findBackupFileName(folder, fileName) {
  if (fs.existsSync(path.join(folder, fileName))) return fileName;
  const queue = [fileName], seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift();
    for (const [oldName, newName] of DB_FILE_MIGRATIONS) {
      if (newName !== cur || seen.has(oldName)) continue;
      if (fs.existsSync(path.join(folder, oldName))) return oldName;
      seen.add(oldName); queue.push(oldName);
    }
  }
  return null;
}
// PC 7.3 — KHÔI PHỤC DỮ LIỆU ai cũng dùng được nhưng CHỈ khôi phục database của module mình được cấp quyền: module1 ← M01 / M01VT / M01VTB
// (3 quyền dùng chung file module1), moduleN ← M0N (N = 2…8; M09 không có database riêng), 'settings' (Cài Đặt) ← CD_SAOLUU (toàn quyền Drive).
// Admin = đủ quyền → khôi phục được tất cả. Trả về Set dbKey được phép.
function restoreAllowedKeys() {
  const list = ensureDefaultAdmin(storedPerm());
  const u = findSessionUser(list);
  if (!u) throw new Error('Chưa đăng nhập.');
  const pc = effectivePc(u, list), ok = new Set();
  if (['M01', 'M01VT', 'M01VTB'].some(c => pc.includes(c))) ok.add('module1');
  for (let n = 2; n <= 8; n++) if (pc.includes('M0' + n)) ok.add('module' + n);
  if (pc.includes('M16')) ok.add('module16'); // PC 0.63 (trước là M12 · module12)
  if (pc.includes('M13')) ok.add('module13'); // PC 7.94
  if (pc.includes('M14')) ok.add('module14'); // PC 8.57
  if (pc.includes('CD_SAOLUU')) { ok.add('settings'); ok.add('lichxuat'); }
  return ok;
}
// SAO LƯU & DRIVE (bảng theo từng module) — xem sao-luu-moi.js (kênh bk2:*).
require('./core/sao-luu-moi').install({
  ipcMain, dialog, XLSX, DB_FILES, DB_LABELS, appDir: __dirname, lan, logError, histNote, lichSu,
  getDbDir: () => DB_DIR, getWindow: () => mainWindow,
  withSyncLock: (fn) => withSheetsSyncLock(fn), restoreAllowedKeys, findBackupFileName,
  clearCaches: () => { wbCache.clear(); rowsCache.clear(); const p = dbWorkerCall({ op: 'clearCache' }); if (p) p.catch(() => {}); }
});
// PC 0.19 — nút "Giải phóng bộ nhớ" (menu tài khoản): giao diện tự nhả các module đang ẩn; ở đây xả bộ đệm workbook Excel
// (tiến trình chính + luồng phụ). Dữ liệu trên đĩa KHÔNG đổi — lần đọc sau chỉ đọc lại file.
ipcMain.handle('app:giai-phong-bo-nho', async () => {
  try { wbCache.clear(); rowsCache.clear(); } catch (e) { /* bỏ qua */ }
  try { const p = dbWorkerCall({ op: 'clearCache' }); if (p) await p.catch(() => {}); } catch (e) { /* bỏ qua */ }
  let mb = 0;
  try { mb = Math.round(app.getAppMetrics().reduce((t, m) => t + ((m.memory && m.memory.workingSetSize) || 0), 0) / 1024); } catch (e) { mb = 0; }
  return { ok: true, mb };
});
