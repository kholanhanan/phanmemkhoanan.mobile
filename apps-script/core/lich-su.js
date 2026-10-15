// lich-su.js — LỊCH SỬ THAO TÁC (PC 7.61). Chạy ở tiến trình chính (main.js require).
// Ghi lại CHỈ thao tác liên quan đến SỐ LIỆU: nhập file · xuất file · thêm / sửa / xóa dữ liệu của MỌI module · khôi phục dữ liệu từ sao lưu.
// KHÔNG ghi đăng nhập / đăng xuất / đổi mật khẩu / lưu tài khoản (lọc bằng LOAI_GHI ở dưới — cả lúc ghi lẫn lúc đọc, nên dòng cũ cũng ẩn).
// kèm TÀI KHOẢN, MÁY, GIỜ. Mỗi dòng 1 JSON, lưu theo THÁNG: database/_lich-su/YYYY-MM.jsonl (không phình 1 file duy nhất).
// Nguồn ghi:
//   • db:write-sheet(s) (main.js › writeSheetsNow): so sánh nội dung cũ / mới (db-core.js › diffSheet) → thêm / sửa / xóa bao nhiêu dòng.
//   • session 'will-download' (main.js): MỌI file xuất ra (Excel / PDF / ảnh / sao lưu…).
//   • window.historyAPI.logImport (preload.js, gọi từ lib/theme-sync.js): người dùng chọn file để nhập.
//   • đăng nhập / đăng xuất / đổi mật khẩu / lưu tài khoản / khôi phục / đồng bộ điện thoại (main.js).
// Ghi lịch sử KHÔNG BAO GIỜ được làm hỏng thao tác chính: mọi hàm ở đây tự bắt lỗi.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODULE_NAME = {
  module1: 'Tồn Kho An An', module2: 'Tồn Kho Gửi', module3: 'NXT Bột/Sốt',
  module4: 'NXT TNK/TGC', module5: 'Đối chiếu số liệu › Số liệu kiểm kê', module6: 'In Chứng Từ Kho',
  module7: 'Đối chiếu số liệu › Số liệu cuối kỳ', module8: 'Tổng Hợp', module9: 'Phiếu Xuất Toàn Hệ Thống',
  module10: 'Đồng Bộ Điện Thoại', module13: 'Phiếu nhập/xuất kho', module14: 'Container Loading 3D', module15: 'Scan tài liệu', module18: 'Tạo mã QR', module19: 'Quản lý file', module20: 'Lưu trữ cá nhân', module16: 'Đối chiếu hàng ngày', module17: 'Công cụ', settings: 'Cài Đặt', lichxuat: 'Trang chính · Lịch xuất nhập hàng', main: 'Hệ thống',
};
// Trang HTML → tên module (dùng cho nhập file: biết khung nào vừa chọn file qua event.senderFrame.url)
const PAGE_MODULE = {
  'ton-kho-an-an.html': MODULE_NAME.module1, 'ton-kho-gui.html': MODULE_NAME.module2, 'nxt-bot-sot.html': MODULE_NAME.module3,
  'nxt-hang-nhap-khau.html': MODULE_NAME.module4, 'doi-chieu-kho-hang.html': MODULE_NAME.module5, 'nhap-lieu-module.html': MODULE_NAME.module5,
  'chung-tu-xuat-kho.html': MODULE_NAME.module6, 'tong-hop.html': MODULE_NAME.module8, 'phieu-xuat-he-thong.html': MODULE_NAME.module9,
  'dong-bo-dien-thoai.html': MODULE_NAME.module10, 'doi-chieu-xuong-kho.html': MODULE_NAME.module16, 'phieu-nhap-xuat.html': MODULE_NAME.module13, 'container-3d.html': MODULE_NAME.module14, 'scan-tai-lieu.html': MODULE_NAME.module15, 'tao-ma-qr.html': MODULE_NAME.module18, 'quan-ly-file.html': MODULE_NAME.module19, 'luu-tru.html': MODULE_NAME.module20, 'cong-cu.html': MODULE_NAME.module17, 'cai-dat.html': MODULE_NAME.settings, 'tai-khoan.html': 'Cài Đặt · Tài khoản',
  'lich-su.html': 'Lịch Sử', 'index.html': 'Trang chính',
};
const SHEET_NAME = {
  LoadData: 'Load Data', ViTri: 'Tồn theo vị trí', ViTriBot: 'Vị trí bột', PhieuXuat: 'Phiếu xuất', PhieuXuatItems: 'Chi tiết phiếu xuất',
  DacTinh: 'Đặc tính', BaoCaoNgoaiSoSach: 'Báo cáo ngoài sổ sách', DuLieuChinh: 'Dữ liệu chính', Transactions: 'Giao dịch nhập / xuất',
  LSX: 'Lệnh sản xuất', DinhMuc: 'Định mức', FlourCodes: 'Mã bột', Locations: 'Vị trí', LichXuatCont: 'Lịch xuất container',
  TongKetThang: 'Tổng kết tháng', KhangSinh: 'Tra cứu kháng sinh', NhapLieuPages: 'Nhập liệu', NhapLieuTransferred: 'Nhập liệu đã chuyển',
  ViTriPhieuDienThoai: 'Phiếu xuất vị trí (điện thoại)', ViTriBotPhieuDienThoai: 'Phiếu vị trí bột (điện thoại)', nhaphang_data: 'Nhập hàng',
  xuathang_data: 'Xuất hàng', vitri_data: 'Vị trí', lichsu_data: 'Lịch sử nhập / xuất', DacTinh_NhapTay: 'Đặc tính nhập tay',
  DacTinh_ChuyenLo: 'Đặc tính chuyển lô', DacTinh_NhomGop: 'Đặc tính nhóm gộp', DacTinh_DaGhiNhan: 'Đặc tính đã ghi nhận',
  MaHoa: 'Mã hóa sản phẩm', MaDaTao: 'Mã đã tạo', TongHop: 'Bảng tổng hợp', RaDong: 'Rã đông',
  Tab3_SizeLabel_DaGhiNhan: 'Nhãn size đã ghi nhận', C3D_Container: 'Container (xếp hàng 3D)', C3D_Plan: 'Phương án xếp container',
};
// Sheet "kỹ thuật" (cấu hình / siêu dữ liệu / trạng thái giao diện / khóa AI) — KHÔNG ghi lịch sử: chỉ là nhiễu, riêng AI_Config có khóa bí mật.
const NOISE_RE = /(^|_)Meta$|^UIHideState$|^DieuKienTuThem$|^AI_Config$|^AI_Glossary$|^Log$|^_|^State$|^Sheet1$|^PNX_AutoLog$|^FileNap$|^C3D_State$/i; // PC 8.28: PNX_AutoLog = nhật ký kỹ thuật chống tạo trùng List/Phiếu tự động

// Chỉ những loại này được ghi / hiện. Muốn ghi thêm loại nào: thêm vào đây.
const LOAI_GHI = new Set(['du-lieu', 'nhap-file', 'xuat-file', 'khoi-phuc']);

module.exports = function createHistory(opts) {
  const getDir = opts.getDir;         // () => thư mục database hiện tại
  const logError = opts.logError || (() => {});
  const machine = (os.hostname() || 'PC').slice(0, 40);
  const root = () => path.join(getDir(), '_lich-su');
  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
  const fileOf = (key) => path.join(root(), key + '.jsonl');

  const moduleName = (dbKey) => MODULE_NAME[dbKey] || String(dbKey || '');
  const sheetName = (s) => SHEET_NAME[s] || String(s || '');
  const isNoise = (s) => NOISE_RE.test(String(s || ''));
  function moduleOfFrame(url) {
    try { const m = String(url || '').split('?')[0].replace(/\\/g, '/').match(/([^/]+\.html)$/i); return m ? (PAGE_MODULE[m[1].toLowerCase()] || '') : ''; } catch (e) { return ''; }
  }

  // entry: { loai, mod, bang, mota, them, sua, xoa, mau, ten, tk, may }
  function add(entry) {
    try {
      if (!entry || !LOAI_GHI.has(entry.loai)) return; // đăng nhập / hệ thống… không ghi
      const now = new Date();
      const e = Object.assign({ t: now.getTime(), may: machine }, entry);
      if (e.mota) e.mota = String(e.mota).slice(0, 400);
      if (Array.isArray(e.mau)) e.mau = e.mau.slice(0, 6).map((x) => String(x).slice(0, 260));
      Object.keys(e).forEach((k) => { if (e[k] === undefined || e[k] === '' || e[k] === 0 || (Array.isArray(e[k]) && !e[k].length)) { if (k !== 't') delete e[k]; } });
      fs.mkdirSync(root(), { recursive: true });
      fs.appendFileSync(fileOf(monthKey(now)), JSON.stringify(e) + '\n', 'utf8');
    } catch (err) { logError('Ghi lịch sử thao tác', err); }
  }

  // Ghi kết quả so sánh của 1 lần lưu (db-core.js › writeSheetsAt wantDiff). ctx: { ten, tk, may }
  function recordWrite(dbKey, diffs, ctx) {
    try {
      (diffs || []).forEach((d) => {
        if (!d || isNoise(d.sheet)) return;
        const parts = [];
        if (d.them) parts.push('thêm ' + d.them);
        if (d.sua) parts.push('sửa ' + d.sua);
        if (d.xoa) parts.push(d.xoaBang ? 'xóa toàn bộ ' + d.xoa : 'xóa ' + d.xoa);
        if (!parts.length) return;
        add({ loai: 'du-lieu', mod: moduleName(dbKey), bang: sheetName(d.sheet), mota: parts.join(', ') + ' dòng', them: d.them, sua: d.sua, xoa: d.xoa, mau: d.mau,
          ten: ctx && ctx.ten, tk: ctx && ctx.tk, may: ctx && ctx.may });
      });
    } catch (err) { logError('Ghi lịch sử (recordWrite)', err); }
  }

  // Đọc: filters { tuNgay:'yyyy-mm-dd', denNgay, tk, loai, mod, q, limit } → { rows, total, months, taiKhoan, modules }
  function listMonths() {
    try { return fs.readdirSync(root()).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).map((n) => n.slice(0, 7)).sort().reverse(); } catch (e) { return []; }
  }
  function query(f) {
    f = f || {};
    const months = listMonths();
    const t0 = f.tuNgay ? new Date(f.tuNgay + 'T00:00:00').getTime() : 0;
    const t1 = f.denNgay ? new Date(f.denNgay + 'T23:59:59.999').getTime() : Infinity;
    const wantM = months.filter((m) => {
      const a = new Date(m + '-01T00:00:00').getTime(); const b = new Date(new Date(a).getFullYear(), new Date(a).getMonth() + 1, 1).getTime() - 1;
      return b >= t0 && a <= t1;
    });
    const q = String(f.q || '').trim().toLowerCase();
    const out = []; const users = new Set(); const mods = new Set();
    for (const m of wantM) {
      let txt = '';
      try { txt = fs.readFileSync(fileOf(m), 'utf8'); } catch (e) { continue; }
      txt.split('\n').forEach((line) => {
        if (!line) return;
        let e; try { e = JSON.parse(line); } catch (er) { return; }
        if (!LOAI_GHI.has(e.loai)) return; // ẩn cả dòng cũ (đăng nhập, hệ thống…)
        if (e.t < t0 || e.t > t1) return;
        if (e.tk) users.add(e.tk); if (e.mod) mods.add(e.mod);
        if (f.tk && e.tk !== f.tk) return;
        if (f.mod && e.mod !== f.mod) return;
        if (f.loai) {
          if (f.loai === 'them' || f.loai === 'sua' || f.loai === 'xoa') { if (e.loai !== 'du-lieu' || !e[f.loai]) return; }
          else if (e.loai !== f.loai) return;
        }
        if (q) {
          const hay = [e.tk, e.ten, e.mod, e.bang, e.mota, e.may, (e.mau || []).join(' ')].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return;
        }
        out.push(e);
      });
    }
    out.sort((a, b) => b.t - a.t);
    const dem = { tong: out.length, nhap: 0, xuat: 0, them: 0, sua: 0, xoa: 0 }; // đếm số THAO TÁC (không phải số dòng dữ liệu)
    out.forEach((e) => { if (e.loai === 'nhap-file') dem.nhap++; else if (e.loai === 'xuat-file') dem.xuat++; else if (e.loai === 'du-lieu') { if (e.them) dem.them++; if (e.sua) dem.sua++; if (e.xoa) dem.xoa++; } });
    const limit = Math.max(1, Math.min(Number(f.limit) || 500, 5000));
    return { ok: true, total: out.length, dem, rows: out.slice(0, limit), months, taiKhoan: Array.from(users).sort(), modules: Array.from(mods).sort() };
  }

  return { add, recordWrite, query, moduleName, sheetName, isNoise, moduleOfFrame, machine, MODULE_NAME };
};
