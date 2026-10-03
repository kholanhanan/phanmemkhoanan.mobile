/* Kho Lạnh An An — bản điện thoại.
 *
 * Nói chuyện với Google Sheet qua Apps Script Web App (../apps-script/Code.gs), KHÔNG dùng
 * window.dbAPI (chỉ có trong bản Electron). Mã APP_TOKEN chỉ cho xem tồn / tạo phiếu.
 *
 * 3 màn hình:
 *   - Xuất kho: chọn 1 trong 3 nguồn — Kho gửi (Module 02, theo lô), Tồn kho An An (Module 01,
 *     theo dòng Load Data, trừ "Tồn cuối") hoặc Vị trí (Module 01 › Tồn theo vị trí, trừ "SL Tồn")
 *     — "còn lại" = số PC đẩy lên trừ các phiếu điện thoại PC chưa nhận. 1 phiếu chỉ 1 nguồn.
 *   - Tồn kho: xem Tồn kho (Module 01) và Vị trí (chỉ xem).
 *   - Phiếu đã gửi: trạng thái từng phiếu (đang chờ PC / PC đã nhận / lỗi).
 *
 * Số liệu tải về được LƯU TRÊN MÁY (IndexedDB — bộ nhớ lớn, không mất khi tắt app). Mở app lần
 * sau dùng ngay bản đã lưu; app chỉ hỏi Web App 1 câu rất nhẹ ("trangThai": mốc PC đẩy từng bảng
 * + số đang chờ) rồi CHỈ tải lại bảng nào PC vừa cập nhật. Mất mạng vẫn xem được.
 * Phiếu đang soạn cũng được lưu, kèm 1 mã nội bộ cố định — bấm gửi lại sau khi mất mạng không
 * bao giờ tạo trùng phiếu (Web App bỏ qua mã đã có).
 */
(function () {
  'use strict';

  const LS_CFG = 'klanan.cfg.v1';
  const LS_CART = 'klanan.cart.v1';
  const LS_CACHE = 'klanan.cache.v1.';
  // Tăng mỗi lần sửa app.js — hiện ở cuối Cài đặt để kiểm tra điện thoại đang chạy đúng bản chưa.
  // ĐÁNH SỐ LẠI TỪ 1.1 (30/09/2026, trước đó 3.x) — tăng mỗi lần phát hành; nhớ đổi cả ?v= trong index.html
  // và "version" trong package.json (GitHub Actions lấy số đó làm versionName của APK).
  const APP_VERSION = '2.1 (02/10/2026)';
  const PAGE = 50;

  // Tên cột — PHẢI khớp tab TonKho_M02 (M2_PUSH_COLUMNS trong main.js của app PC).
  const C = {
    maHang: 'Mã hàng', tenHang: 'Tên hàng', dacTinh: 'Đặc tính', soLo: 'Số lô', size: 'Size',
    quyCach: 'Quy cách', ngayNhapKho: 'Ngày nhập kho', phieuNhap: 'Phiếu nhập/Voucher',
    soKien: 'Số kiện', trongLuong: 'Trọng Lượng (KG)'
  };

  // ------------------------------------------------------------------ tiện ích
  const $ = (id) => document.getElementById(id);
  // Chỉ để HIỂN THỊ: bỏ tiền tố "TPC-" của mã hàng. Dữ liệu gốc/gửi về PC/tìm kiếm giữ nguyên.
  const noTpc = (v) => String(v ?? '').replace(/^TPC-/i, '');
  // Vị trí HIỂN THỊ gọn: bỏ tiền tố kho "TG<số>." (TG1.A.01.2.3 -> A.01.2.3). Chỉ để hiển thị —
  // dữ liệu, khóa dòng, tìm kiếm và file phiếu xuất vẫn dùng vị trí đầy đủ.
  const shortPlace = (v) => String(v ?? '').replace(/^TG\d*\./i, '');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const num = (v) => {
    if (v === '' || v === null || v === undefined) return 0;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };
  // "1,200." / "9.698,4" / "17." -> số — GIỐNG parseLooseNumber() của Module 01.
  const looseNum = (v) => {
    if (typeof v === 'number') return v;
    let x = String(v ?? '').trim().replace(/[\u00A0\s]/g, '');
    if (!x) return 0;
    const hc = x.includes(','), hd = x.includes('.');
    if (hc && hd) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    else if (hc) x = /^-?\d+,\d{1,2}$/.test(x) ? x.replace(',', '.') : x.replace(/,/g, '');
    const m = x.match(/^-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  };
  // Tìm kiếm không phân biệt khoảng trắng: mỗi từ khóa phải có trong chuỗi (như cũ), HOẶC cả cụm từ khóa
  // viết liền (bỏ dấu cách) có trong chuỗi đã bỏ dấu cách → "BTP30" tìm ra "BTP 30" và ngược lại.
  // o (tuỳ chọn): đối tượng để nhớ sẵn bản bỏ dấu cách (o.sc) — đỡ tính lại mỗi lần gõ phím.
  const cmp = (v) => String(v ?? '').replace(/\s+/g, '');
  function wordsHit(s, qs, o) {
    if (!qs.length) return true;
    if (qs.every((w) => s.includes(w))) return true;
    let sc;
    if (o) { if (o.sc === undefined || o.scOf !== s) { o.sc = cmp(s); o.scOf = s; } sc = o.sc; } else sc = cmp(s);
    return sc.includes(qs.join(''));
  }
  const normHeader = (h) => norm(h).replace(/[.,()\/\\\-_:;]/g, ' ').replace(/\s+/g, ' ').trim();
  const findHeader = (headers, name) => { const n = normHeader(name); return headers.findIndex((h) => normHeader(h) === n); };
  const isHiddenCol = (h) => String(h).startsWith('_');
  const SRC_OF = { M02: 'm02', M01: 'm01', M01VT: 'vitri', M01VTB: 'vitribot', M03: 'm03', M04: 'm04' };
  const SRC_LABEL = { M02: 'Tồn kho gửi (M02)', M01: 'Tồn kho An An (M01)', M01VT: 'Vị trí (M01)', M01VTB: 'Vị trí Bột (M01)', M03: 'NXT Bột/Sốt (M03)', M04: 'NXT TNK/TGC (M04)' };
  const SRC_DEST = {
    M02: 'Module 02 (tab Phiếu Xuất)',
    M01: 'Module 01 (Tổng Hợp → Xuất Hàng)',
    M01VT: 'Module 01 (Tồn theo vị trí → Phiếu xuất từ điện thoại)',
    M01VTB: 'Module 01 (Vị Trí Bột → Phiếu xuất từ điện thoại)',
    M03: 'Module 03 (Xuất sử dụng, mã PX_…)',
    M04: 'Module 04 (Xuất hàng)'
  };
  const modOf = (m) => (SRC_OF[m] ? m : 'M02');
  // Toàn bộ kho điện thoại biết đọc. Kho nằm trong HIDDEN_SOURCES bị ẨN khỏi app (không tải, không hiện ở
  // Trang chủ / Chọn kho / tìm mã) nhưng code vẫn giữ nguyên — muốn dùng lại chỉ cần bỏ khỏi danh sách ẩn.
  // Phiếu CŨ của kho đang ẩn vẫn hiện ở tab Phiếu (xem, xuất file, xóa khi PC chưa nhận).
  const ALL_SOURCES = ['m02', 'm01', 'vitri', 'vitribot', 'm03', 'm04'];
  // 09/2026: M03 / M04 từng tạm ẩn — đã MỞ LẠI vì có phân quyền theo tài khoản (ai không được tick M03/M04 trong
  // "Kho được dùng" thì applyPerms() tự ẩn). Muốn ẩn hẳn 1 kho cho mọi người thì thêm mã vào đây, VD ['m03'].
  const HIDDEN_SOURCES = [];
  // SOURCES = kho đang dùng được = bỏ kho ẩn + bỏ kho token không có quyền (applyPerms() tính lại khi biết quyền).
  let SOURCES = ALL_SOURCES.filter((k) => !HIDDEN_SOURCES.includes(k));
  // Bố cục mới: các kho trong 1 tab "Kho". place = cột giữa của dòng hàng (Mã · <place> · SL).
  const KHO = {
    m02: { name: 'Tồn kho gửi', mod: 'Module 02', desc: 'theo lô', place: 'Lô', placeOf: (it) => it.soLo },
    m01: { name: 'Tồn kho An An', mod: 'Module 01', desc: 'tồn cuối', place: 'HĐ', placeOf: (it) => it.hopDong },
    vitri: { name: 'Tồn vị trí An An', mod: 'Module 01', desc: 'theo ô vị trí', place: 'Vị trí', placeOf: (it) => it.viTri },
    vitribot: { name: 'Vị trí Bột', mod: 'Module 01', desc: 'theo ô vị trí · HSD', place: 'Vị trí', placeOf: (it) => it.viTri },
    m03: { name: 'NXT Bột / Sốt', mod: 'Module 03', desc: 'theo lô, cần LSX', place: 'Vị trí', placeOf: (it) => it.viTri },
    m04: { name: 'NXT TNK / TGC', mod: 'Module 04', desc: 'lô × vị trí', place: 'Vị trí', placeOf: (it) => it.viTri }
  };
  // Phần quy cách/trọng lượng trong Tên hàng An An, VD "Tôm TCT vỏ (An An), Block, …, 16 (1.8 kg x 6 gói)
  // - 23.MKS-CANA - GK" → "1.8 kg x 6 gói": nhóm (…) CUỐI CÙNG trong phần trước " - " có chữ số + đơn vị
  // khối lượng (kg/g/gr/lb) hoặc dạng "a x b". Không tìm được → ''.
  function netOfName(ten) {
    const head = String(ten ?? '').split(' - ')[0];
    const groups = head.match(/\(([^()]*)\)/g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i].slice(1, -1).trim();
      if (/\d/.test(g) && (/\d\s*(kg|g|gr|gram|lb|lbs)\b/i.test(g) || /\d\s*[x×*]\s*\d/i.test(g))) return g;
    }
    return '';
  }
  // Dòng 2 của dòng hàng: tên hàng + 1–2 thông tin phụ quan trọng nhất của từng kho.
  function lotLine2(src, l) {
    const it = l.item || {};
    // Vị trí Bột: hạn dùng (còn/hết N ngày) · NSX · Nhập · Ghi chú — như cột "HSD (ngày)" bảng PC.
    if (src === 'vitribot') {
      const n = vtbHsdDaysLeft(it);
      const hsd = n === null ? (it.hsd ? 'HSD ' + it.hsd : '') : n < 0 ? `Hết hạn ${fmt(-n)} ngày` : `Còn hạn ${fmt(n)} ngày`;
      return [it.vtMoi ? 'Chuyển → ' + shortPlace(it.vtMoi) : '', hsd, it.nsx ? 'NSX ' + it.nsx : '', it.nhap ? 'Nhập ' + it.nhap : '', it.ghiChu].filter(Boolean).join(' · ');
    }
    // Kho An An (M01, Vị trí): bỏ tên hàng dài, chỉ hiện Net (quy cách) · Đặc tính · Hợp đồng — Đặc tính/Hợp đồng
    // tách từ 2 phần cuối của Tên hàng giống bảng PC (vtSplitName); M01 ưu tiên cột riêng nếu file có.
    if (src === 'vitri' || src === 'm01') {
      const [dt0, hd0] = vtSplitName(it.tenHang);
      const dt = (src === 'm01' && String(it.dacTinh || '').trim()) || dt0;
      const hd = (src === 'm01' && String(it.hopDong || '').trim()) || hd0;
      const net = netOfName(it.tenHang);
      const parts = [net, dt, hd].map((v) => noTpc(String(v || '').trim())).filter(Boolean);
      // Số lô (Batch) không hiện ở dòng ngoài — chỉ xem trong bảng chi tiết / bảng xuất (openQtySheet).
      if (src === 'm01' && !l.sizeTag && String(it.size || '').trim()) parts.push('Size ' + noTpc(it.size));
      return parts.length ? parts.join(' · ') : noTpc(it.tenHang || '');
    }
    let extra = {
      m02: [['Size', it.size], ['PN', it.phieuNhap]],
      vitri: [['Lô', it.soLo]],
      m01: [['Size', it.size]],
      m03: [['LSX', it.lsx], ['Phiếu', it.maPhieuLo]],
      m04: [['Size', it.size], ['INV', it.inv]]
    }[src] || [];
    if (l.sizeTag) extra = extra.filter(([k]) => k !== 'Size');
    // Tồn kho gửi (M02): Đặc tính đứng TRƯỚC tên hàng (tên dài hay bị cắt "…" ở cuối dòng).
    if (src === 'm02' && String(it.dacTinh || '').trim()) {
      return [noTpc(it.dacTinh), noTpc(it.tenHang || '')].concat(extra.filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + ' ' + noTpc(v))).filter(Boolean).join(' · ');
    }
    const name = src === 'm03' ? (it.loaiHang || it.tenHang) : src === 'm04' ? (it.type || '') : (it.tenHang || '');
    return [noTpc(name)].concat(extra.filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + ' ' + noTpc(v))).filter(Boolean).join(' · ');
  }
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  // Số KG: "," hàng nghìn, "." thập phân, luôn 2 số lẻ — VD 1,500.50 kg (giống PC).
  const fmtKg = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const matchKey = (ma, lo, size, pn) => [ma, lo, size, pn].map((v) => String(v ?? '').trim()).join('|');
  const fmtTime = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
  };
  const load = (k, dflt) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* đầy bộ nhớ: bỏ qua bản lưu tạm */ } };
  const newId = () => 'dt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const stamp = () => {
    const d = new Date(); const p = (x) => String(x).padStart(2, '0');
    return 'DT' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  };
  // Ngày hôm nay dạng yyyy-mm-dd (giá trị mặc định cho <input type="date">).
  const todayISO = () => {
    const d = new Date(); const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // ------------------------------------------------------------------ trạng thái
  const state = {
    cfg: load(LS_CFG, { url: '', token: '', name: '' }),
    cart: load(LS_CART, null),           // { id, ghiChu, items: [{key, maHang, tenHang, soLo, size, phieuNhap, soKien, qty}] }
    tab: 'home',
    phieuSeg: 'cho',                    // nhóm đang xem ở tab Phiếu: soan | cho | nhan | huy
    phieuMonth: '',                     // (bản 1.4) lọc phiếu Đã nhận / Đã hủy theo tháng 'YYYY-MM' — rỗng = tất cả
    // Tab Kho MỞ APP luôn vào "Tổng — tất cả kho" (người dùng yêu cầu 30/09/2026, bản 3.63). Đổi kho trong lúc dùng
    // vẫn giữ tới khi tắt app. Chỉ được dùng 1 kho thì vào thẳng kho đó (applyPerms).
    xuatSrc: SOURCES.length > 1 ? 'tong' : (SOURCES[0] || 'm02'),
    // Tab Tồn kho: xem 5 bảng như Xuất kho (dùng chung dữ liệu đã lưu trên máy, không tải 2 lần).
    tonMode: SOURCES.includes(load('klanan.tonMode', 'm01')) ? load('klanan.tonMode', 'm01') : 'm01',
    m02: null, m01: null, vitri: null, vitribot: null, phieu: null,  // { data, fetchedAt, error }
    lots: { m02: [], m01: [], vitri: [], vitribot: [], m03: [], m04: [] }, // dòng có thể xuất, theo từng nguồn
    tonRows: { m02: [], m01: [], vitri: [], vitribot: [], m03: [], m04: [] },
    q: { xuat: '', xuat2: '', ton: '', home: '' },
    // Lọc theo nhiều cột cùng lúc (nút cạnh ô tìm kiếm): colf.xuat[nguồn] / colf.ton[nguồn] = { khóa cột: [các giá trị đã tick] }.
    // Lưu riêng theo từng nguồn để đổi nguồn không mất bộ lọc đang gõ của nguồn kia.
    colf: { xuat: {}, ton: {} },
    limit: { xuat: PAGE, ton: PAGE },
    open: {},                           // dòng đang mở chi tiết
    busy: false
  };
  // Trang "Báo cáo" (tab riêng, xem renderBaoCao()). perm = mã quyền trong "Kho được dùng" của tài khoản
  // (tab PhanQuyen, cột kho) — ĐỘC LẬP với quyền xem kho M01/M02. Phải khớp ALL_KHO / KHO_OF_ACTION (Code.gs),
  // PQ_KHO (main.js), KHO (cai-dat.js) và PQ_KHO (bên dưới, quản lý người dùng trên điện thoại).
  const REPORT_CFG = {
    m01: { perm: 'BC01', action: 'baoCaoM01', prefix: 'm01', kho: 'Tồn kho An An', pc: 'Module 1 "Tồn Kho An An"', need: 'đã có dữ liệu ở menu Dữ Liệu' },
    m02: { perm: 'BC02', action: 'baoCaoM02', prefix: 'm02', kho: 'Tồn kho gửi', pc: 'Module 2 "Tồn Kho Gửi"', need: 'đã có dữ liệu ở menu Dữ Liệu' },
  };
  const REPORT_SRCS = Object.keys(REPORT_CFG);

  // ---- PHÂN QUYỀN THEO TOKEN (lệnh 'toi' của Web App — Code.gs › resolveUser_) ----
  // state.me = null  → Web App bản cũ / mã APP_TOKEN chung: đủ mọi quyền như trước.
  // state.me = { admin, ten, quyen: 'xem'|'xuat', kho: ['M01','M01VT','M01VTB','M02','M08',…] }.
  // Máy chủ mới là nơi CHẶN thật; ở đây chỉ ẩn kho / nút không có quyền cho gọn.
  // Đường dẫn Web App cố định trong app-config.js (nếu có) → ẩn ô nhập đường dẫn, luôn dùng link này.
  const FIXED_URL = (() => { const u = String((window.KLANAN_CONFIG && window.KLANAN_CONFIG.url) || '').trim(); return /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(u) ? u : ''; })();
  if (FIXED_URL && state.cfg.url !== FIXED_URL) { state.cfg.url = FIXED_URL; save(LS_CFG, state.cfg); }
  // Đã đủ thông tin kết nối chưa (đường dẫn + mã truy cập). Có link cố định thì chỉ còn thiếu ID / mật khẩu.
  const cfgOk = () => !!(state.cfg.url && state.cfg.token);
  state.me = load('klanan.me.v1', null);
  const LS_ME = 'klanan.me.v1';
  const isAdmin = () => !state.me || !!state.me.admin;
  const canCreate = () => !state.me || state.me.quyen === 'xuat';
  // Phiếu do chính tài khoản này tạo: so cột nguoiDung (ID) — phiếu cũ chưa có cột này thì so "Người tạo"
  // với ID hoặc tên hiển thị. GIỐNG phieuVisibleTo_() trong Code.gs.
  const isMyPhieu = (p) => {
    if (!state.me) return true;
    const nd = String(p.nguoiDung || '').trim().toLowerCase();
    if (nd) return nd === String(state.me.ten || '').toLowerCase();
    const nt = String(p.nguoiTao || '').trim();
    return nt === state.me.ten || nt === state.me.hienThi;
  };
  // Sửa / xóa phiếu: quản lý = mọi phiếu; tài khoản "Tạo phiếu" = phiếu của chính mình (máy chủ kiểm tra lại).
  const canEditPhieu = (p) => isAdmin() || (canCreate() && (!p || isMyPhieu(p)));
  const canView = (k) => !state.me || (state.me.kho || []).includes(TABLE_OF[k]);
  // Quyền xem trang Báo cáo của từng nguồn (mã BC01 / BC02 trong "Kho được dùng").
  const canReport = (src) => !state.me || (state.me.kho || []).includes(REPORT_CFG[src].perm);
  const QUYEN_TEXT = { xem: 'Chỉ xem tồn kho', xuat: 'Xem + tạo phiếu xuất' };
  // Quản lý người dùng (Cài đặt → Quản lý người dùng): mã APP_TOKEN chung (state.me = null) hoặc tài khoản Quản trị.
  const canManage = () => !state.me || !!state.me.quanTri;
  function applyPerms() {
    SOURCES = ALL_SOURCES.filter((k) => !HIDDEN_SOURCES.includes(k) && canView(k));
    // Kho không còn quyền: bỏ số liệu đã lưu trên máy (không cho xem bản cũ).
    ALL_SOURCES.concat(['m08']).forEach((k) => {
      if (canView(k)) return;
      if (state[k]) { state[k] = null; store.del(k); }
      if (state.lots[k]) state.lots[k] = [];
      if (state.tonRows[k]) state.tonRows[k] = [];
    });
    if (state.xuatSrc === 'tong' ? SOURCES.length <= 1 : !SOURCES.includes(state.xuatSrc)) state.xuatSrc = SOURCES.length > 1 ? 'tong' : (SOURCES[0] || 'm02');
    // Phiếu đang soạn thuộc kho không còn quyền / token chỉ xem → bỏ (không gửi được nữa).
    if (state.cart && state.cart.items.length && (!canCreate() || !SOURCES.includes(SRC_OF[state.cart.module]))) { state.cart = null; localStorage.removeItem(LS_CART); }
    const myName = state.me && !state.me.admin ? (state.me.hienThi || state.me.ten) : '';
    if (myName && state.cfg.name !== myName) { state.cfg.name = myName; save(LS_CFG, state.cfg); }
    const anyReport = REPORT_SRCS.some(canReport);
    REPORT_SRCS.forEach((k) => { if (!canReport(k)) delete repState[k]; }); // mất quyền → bỏ file đã tải
    if (!canView('m08')) { state.ks = null; store.del('ks'); M8.dataOf = null; } // mất quyền kháng sinh → bỏ dữ liệu đã lưu
    const multi = $('xuatMulti'); if (multi) multi.hidden = !canCreate();
    // Thanh tab chỉ hiện phần tài khoản này thật sự dùng được. Tài khoản KHÔNG có kho nào (VD chỉ được
    // "Tra cứu kháng sinh") thì bỏ Trang chủ / Kho / Phiếu — các trang đó chẳng có gì để xem.
    document.querySelectorAll('.tab').forEach((b) => { b.hidden = !tabOk(b.dataset.tab); });
    if (!tabOk(state.tab)) { state.tab = firstTab(); showTabUi(); }
  }
  // Tab nào được dùng với quyền hiện tại. Không có tab nào dùng được (chưa cấp quyền gì) → vẫn cho Trang chủ.
  function tabOk(t) {
    const hasKho = SOURCES.length > 0;
    if (t === 'home' || t === 'xuat') return hasKho || !(canView('m08') || REPORT_SRCS.some(canReport));
    if (t === 'phieu') return hasKho && canCreate();
    if (t === 'baocao') return REPORT_SRCS.some(canReport);
    if (t === 'm8') return canView('m08');
    return false;
  }
  const firstTab = () => ['home', 'xuat', 'phieu', 'baocao', 'm8'].find(tabOk) || 'home';
  function showTabUi() {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === state.tab));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== state.tab; });
  }
  // Hỏi Web App "tôi là ai". Web App bản cũ chưa có lệnh 'toi' → coi như đủ quyền (state.me = null).
  async function fetchMe() {
    try {
      const r = await api('toi');
      state.me = r.user && !r.user.admin ? r.user : null;
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'CFG') throw e;
      if (/Không có chức năng/.test(e.message)) state.me = null; else return; // mất mạng: giữ quyền đã biết
    }
    save(LS_ME, state.me);
    applyPerms();
  }

  // ---- Kho lưu dữ liệu trên máy: IndexedDB (dung lượng lớn), dự phòng localStorage ----
  const CACHE_KEYS = ['m02', 'vitri', 'vitribot', 'm01', 'm03', 'm04', 'm08', 'phieu', 'ks']; // ks = kháng sinh tải dần (bản 2.0)
  const store = (() => {
    let dbp = null;
    const open = () => {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          if (!window.indexedDB) { rej(new Error('no idb')); return; }
          const r = indexedDB.open('klanan', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    };
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    return {
      async get(k) { try { return await tx('readonly', (s) => s.get(k)); } catch (e) { return load(LS_CACHE + k, null); } },
      async set(k, v) { try { await tx('readwrite', (s) => s.put(v, k)); } catch (e) { save(LS_CACHE + k, v); } },
      async del(k) { try { await tx('readwrite', (s) => s.delete(k)); } catch (e) { /* bỏ qua */ } localStorage.removeItem(LS_CACHE + k); },
    };
  })();
  async function loadCaches() {
    for (const k of CACHE_KEYS) {
      let v = await store.get(k);
      if (!v) { // chuyển bản lưu cũ (localStorage) sang IndexedDB 1 lần
        v = load(LS_CACHE + k, null);
        if (v) { await store.set(k, v); localStorage.removeItem(LS_CACHE + k); }
      }
      state[k] = v || null;
    }
  }
  // Bảng trên Google Sheet ứng với từng nguồn — để so mốc "PC đẩy lúc" (Meta.lastPushAt_<bảng>).
  const TABLE_OF = { m02: 'M02', m01: 'M01', vitri: 'M01VT', vitribot: 'M01VTB', m03: 'M03', m04: 'M04', m08: 'M08' };
  const stampIn = (meta, k) => (meta && (meta['lastPushAt_' + TABLE_OF[k]] || meta.lastPushAt)) || '';
  // "Ngày số liệu" (dd/mm/yyyy) người dùng nhập ở Load Data trên PC — ngày CỦA số tồn, khác giờ PC đẩy lên.
  const DATA_DATE_KEY = { m01: 'm01DataDate', vitri: 'm01ViTriDataDate', vitribot: 'm01ViTriBotDataDate', m02: 'm02DataDate' };
  const dataDateIn = (meta, k) => (meta && DATA_DATE_KEY[k] && String(meta[DATA_DATE_KEY[k]] || '').trim()) || '';
  const shortDate = (d) => String(d || '').replace(/^(\d{2}\/\d{2})\/\d{4}$/, '$1');
  state.stale = new Set();   // bảng mà PC đã đẩy bản mới hơn bản đang lưu trên máy
  let lastCheckAt = 0;
  // Bản chụp chi tiết các phiếu đã gửi (để xuất lại file đúng mẫu từ màn "Phiếu đã gửi").
  const LS_SENT = 'klanan.sentDocs.v1';
  // Phiếu "PC đã nhận" / "Đã hủy" mà người dùng ẨN khỏi danh sách — CHỈ trên máy này (Google Sheet và PC
  // không đổi gì; phiếu đã vào PC thì hủy/sửa phải làm trên PC). Lưu id → thời điểm ẩn.
  const LS_HIDDEN = 'klanan.phieuAn.v1';
  let hiddenPhieu = load(LS_HIDDEN, {});
  const sentDocs = load(LS_SENT, {});
  function rememberSent(doc) {
    sentDocs[doc.id] = doc;
    const ids = Object.keys(sentDocs).sort((a, b) => String(sentDocs[b].ngayTao).localeCompare(String(sentDocs[a].ngayTao)));
    ids.slice(150).forEach((id) => { delete sentDocs[id]; });
    save(LS_SENT, sentDocs);
  }
  if (state.cart && !state.cart.module) state.cart.module = 'M02'; // phiếu soạn từ bản cũ

  function saveCart() {
    if (state.cart && state.cart.items.length) { save(LS_CART, state.cart); return; }
    const hadEdit = state.cart && state.cart.editOf;
    state.cart = null;
    localStorage.removeItem(LS_CART);
    if (hadEdit) { buildLots(); toast('Đã bỏ chỉnh sửa — phiếu giữ nguyên như cũ. Muốn xóa phiếu, dùng nút Xóa phiếu ở màn Phiếu đã gửi.'); }
  }


  // ------------------------------------------------------------------ gọi Web App
  async function api(action, extra) {
    if (!state.cfg.url || !state.cfg.token) throw Object.assign(new Error('Chưa cài đặt kết nối.'), { code: 'CFG' });
    // MẠNG CHẬP CHỜN (bản 1.5): lệnh CHỈ ĐỌC (không kèm dữ liệu gửi đi) bị rớt mạng giữa chừng (lỗi kết nối, chưa nhận
    // được trả lời) → tự thử lại 1 lần sau 1,5 giây. Lệnh GHI (tạo / sửa / hủy phiếu — có kèm dữ liệu) KHÔNG tự thử lại
    // để không bao giờ tạo trùng phiếu. Quá 45 giây không trả lời thì không thử lại (mạng quá chậm).
    const tries = extra && !extra.readOnly ? 1 : 2; // readOnly: lệnh đọc có tham số (m08 noKs, ksSince) vẫn được thử lại
    let res;
    for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      // text/plain: yêu cầu "đơn giản", không kích hoạt CORS preflight (Apps Script không hỗ trợ).
      res = await fetch(state.cfg.url, {
        method: 'POST', redirect: 'follow', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        // nguoiDung: Tên người dùng (ID đăng nhập) — Web App kiểm tra cùng mã truy cập (như ID + mật khẩu).
        body: JSON.stringify(Object.assign({ token: state.cfg.token, nguoiDung: String(state.cfg.user || '').trim(), action }, extra || {}))
      });
      break;
    } catch (e) {
      if (e.name !== 'AbortError' && attempt < tries) { clearTimeout(timer); await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw new Error(e.name === 'AbortError' ? 'Mạng quá chậm, đã chờ 45 giây không có phản hồi.' : 'Không kết nối được. Kiểm tra mạng hoặc đường dẫn Web App.');
    } finally {
      clearTimeout(timer);
    }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error('Web App trả về trang lạ. Đường dẫn phải kết thúc bằng /exec và quyền truy cập là "Bất kỳ ai".');
    }
    if (!data.ok) {
      let msg = data.error || 'Web App báo lỗi.';
      if (/^Không có chức năng/.test(msg)) msg += ' — Web App chưa cập nhật bản mới: dán lại apps-script/Code.gs, rồi Triển khai → Quản lý triển khai → Phiên bản mới.';
      throw Object.assign(new Error(msg), { code: data.code });
    }
    return data;
  }

  // KHÁNG SINH "CHỈ PHẦN MỚI" (bản 2.0, cần Code.gs mới): dữ liệu kháng sinh lưu TRÊN MÁY (state.ks.rows: key → giá trị),
  // mỗi lần chỉ hỏi ksSince(since = mốc lần trước) → nhận dòng mới / vừa sửa + dòng đã xoá; so TỔNG số dòng với máy chủ,
  // lệch → tải lại toàn bộ. Code.gs cũ chưa có ksSince → state.ksOff = true, quay về cách cũ (bảng khangSinh trong m08).
  async function ksSync(full) {
    const cur = state.ks && state.ks.rows ? state.ks : null;
    const since = full || !cur ? '' : (cur.u || '');
    const res = await api('ksSince', { since, readOnly: true });
    const rows = since ? Object.assign({}, cur.rows) : {};
    // Sheet còn khuôn CŨ (key | value) do PC đẩy lúc Web App chưa cập nhật: giá trị nằm ở cột 2, cột 3 trống → lấy cột 2.
    (res.rows || []).forEach((r) => { rows[r[0]] = (r[2] === '' || r[2] == null) && r[1] && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(String(r[1])) ? r[1] : r[2]; });
    (res.dels || []).forEach((k) => { delete rows[k]; });
    const n = Object.keys(rows).length;
    if (since && typeof res.total === 'number' && n !== res.total) return ksSync(true); // lệch → tải lại toàn bộ
    state.ks = { rows, u: res.u || since, n, at: new Date().toISOString(), srvTotal: res.total };
    await store.set('ks', state.ks);
    M8.dataOf = null;
  }
  async function fetchInto(key, action) {
    try {
      let data;
      if (key === 'm08' && !state.ksOff) {
        data = await api(action, { noKs: true, readOnly: true });
        try {
          await ksSync(false);
          const hasBatch = Object.keys(state.ks.rows).some((k) => k.startsWith('s:batch:'));
          if (!hasBatch) { // ksSince không có lô nào → thử lấy cả bảng kháng sinh theo cách cũ (m08 đầy đủ)
            const full = await api(action, { readOnly: true });
            const t = full && full.khangSinh;
            if (t && t.rows && t.rows.length) { data = full; state.ks = null; await store.del('ks'); M8.dataOf = null; }
          }
        } catch (e) {
          if (/Không có chức năng|không hỗ trợ|unknown/i.test(e.message || '')) { state.ksOff = true; state.ks = null; await store.del('ks'); data = await api(action); }
          else throw e;
        }
      } else data = await api(action);
      state[key] = { data, fetchedAt: new Date().toISOString(), error: null };
      state.stale.delete(key);
      await store.set(key, state[key]);
    } catch (e) {
      state[key] = Object.assign({}, state[key] || {}, { error: e.message, errorCode: e.code });
      throw e;
    }
  }

  // ------------------------------------------------------------------ chuẩn hóa dữ liệu
  // Đang SỬA 1 phiếu chưa được PC nhận: số "chờ PC" trên server đã gồm chính phiếu đó -> cộng trả lại
  // để dòng hàng của phiếu vẫn "còn lấy được" đúng bằng lúc trước khi phiếu được tạo.
  function adjustForEdit() {
    const ed = state.cart && state.cart.editOf;
    if (!ed) return;
    (state.lots[SRC_OF[state.cart.module] || 'm02'] || []).forEach((l) => {
      const back = num(ed.orig && ed.orig[l.key]);
      if (back > 0) { l.cho = Math.max(l.cho - back, 0); l.con = l.soKien - l.cho; }
    });
  }
  // Nhãn Size có tiền tố ("BTP 50", "TGC 51/60"…) — quy tắc PC, xem size-label.js. Từ điển Size lấy
  // từ Module 8 đã đồng bộ về máy (nếu có), không thì dùng bản chụp chuẩn của PC.
  let sizeTagFn = null, sizeTagOf = null;
  function sizeTagger() {
    const d = state.m08 && state.m08.data;
    if (sizeTagFn && sizeTagOf === d) return sizeTagFn;
    let seg8 = [];
    if (d && d.maHoa && d.maHoa.headers) {
      const h = d.maHoa.headers, iS = h.indexOf('seg'), iC = h.indexOf('code'), iN = h.indexOf('name');
      seg8 = d.maHoa.rows.filter((r) => Number(r[iS]) === 8).map((r) => ({ code: r[iC], name: r[iN] }));
    }
    sizeTagFn = window.KLSize ? window.KLSize.create(seg8) : () => '';
    sizeTagOf = d;
    return sizeTagFn;
  }
  // Tìm theo NHÃN SIZE có tiền tố: gõ "BTP 50" (đúng nhãn Size đang có) → chỉ lấy dòng có nhãn đúng "BTP 50",
  // không lẫn "BTP 17 ... 50.KD" hay "BTP 51/60". Gõ thêm chữ khác sau nhãn ("BTP 50 G.08") vẫn lọc tiếp bình thường.
  // Gõ không khớp nhãn nào (vd "50", "btp 5") → giữ cách tìm cũ (chứa từ khóa).
  // KHÔNG TÍNH KHOẢNG TRẮNG: "BTP30" = "BTP 30" = "btp  30" (so nhãn Size đã bỏ hết dấu cách).
  // 09/2026: gõ dạng NHÃN SIZE (chữ + số, vd "BTP 13") thì KHÔNG BAO GIỜ rơi về tìm "chứa từ khóa" nữa:
  //   • "BTP 13" / "BTP  13" (không có dấu cách cuối)  → nhãn BẮT ĐẦU bằng "BTP13": ra BTP 13, BTP 130…
  //   • "BTP 13 " (CÓ dấu cách ở cuối)                 → chỉ đúng nhãn "BTP 13".
  //   • Không có nhãn nào khớp → để TRỐNG (không hiện dòng khác, vd dòng có "13" trong vị trí L.13.x).
  // qs.trail = true khi ô nhập kết thúc bằng dấu cách (do xuatQueries() gắn).
  function makeLotMatch(qs, lots) {
    const plain = (l) => wordsHit(l.s, qs, l);
    if (!qs.length) return plain;
    const tagOf = (l) => cmp(norm(l.sizeTag).trim());
    const tags = new Set(), prefixes = new Set();
    (lots || []).forEach((l) => {
      if (!l.sizeTag) return;
      const t = tagOf(l);
      tags.add(t);
      const m = /^[a-z]+/.exec(t);
      if (m) prefixes.add(m[0]);
    });
    // Nhãn + từ khóa phụ: "BTP 50 G.08" → đúng nhãn "BTP 50" rồi lọc tiếp theo phần còn lại.
    for (let k = qs.length - 1; k >= 1; k--) {
      const tag = qs.slice(0, k).join('');
      if (!tags.has(tag)) continue;
      const rest = qs.slice(k);
      return (l) => !!l.sizeTag && tagOf(l) === tag && wordsHit(l.s, rest, l);
    }
    // Toàn bộ ô nhập là 1 nhãn Size (hoặc đang gõ dở nhãn).
    const all = qs.join('');
    const m = /^([a-z]+)\d/.exec(all);
    if (m && prefixes.has(m[1])) {
      if (qs.trail) return (l) => !!l.sizeTag && tagOf(l) === all;        // có dấu cách cuối → khớp đúng
      return (l) => !!l.sizeTag && tagOf(l).startsWith(all);              // không có → khớp phần đầu
    }
    return plain;
  }
  // Tab Kho có 2 ô tìm song song: mỗi ô vẫn tìm như cũ (các từ trong 1 ô = VÀ, nhãn Size, bỏ qua khoảng
  // trắng); 2 ô kết hợp theo VÀ → gõ "H.09" ở ô 1, "BTP 50" ở ô 2 = dòng ở vị trí H.09 CÓ size BTP 50.
  // xuatQueries() trả về mảng từ khóa (đã chuẩn hoá) — mảng rỗng khi cả 2 ô trống; có thuộc tính
  // .alt = từ khóa ô 2 khi ô 2 có chữ (dùng bởi makeXuatMatch).
  function xuatQueries() {
    const split = (v) => norm(v || '').trim().split(/\s+/).filter(Boolean);
    const a = split(state.q.xuat), b = split(state.q.xuat2);
    const endSp = (v) => /\s$/.test(String(v || ''));   // dấu cách cuối (trước khi bị trim) → khớp đúng nhãn
    a.trail = endSp(state.q.xuat); b.trail = endSp(state.q.xuat2);
    const out = a.length ? a : b;
    if (a.length && b.length) out.alt = b;
    return out;
  }
  function makeXuatMatch(qs, lots) {
    const m1 = makeLotMatch(qs, lots);
    if (!qs.alt) return m1;
    const m2 = makeLotMatch(qs.alt, lots);
    return (l) => m1(l) && m2(l);
  }
  function buildLots() {
    buildLotsRaw();
    adjustForEdit();
    const tag = sizeTagger();
    SOURCES.forEach((k) => (state.lots[k] || []).forEach((l) => {
      const it = l.item || {};
      l.sizeTag = tag(it.maHang, it.tenHang);
      // Mã Kho gửi thường KHÔNG đủ 21 ký tự (VD "VRHOITN0085JPA10023") → không đọc được nhãn từ mã → dùng cột Size
      // nếu nó đã là nhãn có chữ đứng trước (VD "NL85") để gõ "NL 85" vẫn ra. Size chỉ có số ("50") thì KHÔNG dùng.
      // M04: nhãn = Loại hàng + Size ("TGC 51/60"). GIỐNG main.js › buildGlobalSearchData() trên PC.
      if (!l.sizeTag && k === 'm02' && /^[A-Za-zÀ-ỹĐđ]+\s*\d/.test(String(it.size || '').trim())) l.sizeTag = String(it.size).trim();
      if (!l.sizeTag && k === 'm04' && String(it.type || '').trim() && String(it.size || '').trim()) l.sizeTag = String(it.type).trim() + ' ' + String(it.size).trim();
      if (l.sizeTag) l.s += ' ' + norm(l.sizeTag);
    }));
  }
  function buildLotsRaw() {
    // ---- Module 02: theo lô (Mã hàng + Số lô + Size + Phiếu nhập) ----
    const d2 = state.m02 && state.m02.data;
    state.lots.m02 = [];
    if (d2 && d2.headers) {
      const ix = {};
      // Khớp đúng tên cột trước; không thấy thì khớp kiểu bỏ dấu/hoa-thường (VD "Đặc Tính", "Dac tinh").
      Object.entries(C).forEach(([k, label]) => { ix[k] = d2.headers.indexOf(label); if (ix[k] < 0) ix[k] = findHeader(d2.headers, label); });
      // Chẩn đoán: bảng Kho gửi không có cột Đặc tính, hoặc có mà trống hết → báo ở dòng đếm của tab Kho.
      state.lots.m02DtIssue = ix.dacTinh < 0
        ? 'Dữ liệu Kho gửi trên máy KHÔNG có cột "Đặc tính" (các cột: ' + d2.headers.filter((h) => !isHiddenCol(h)).join(', ') + ')'
        : (d2.rows.length && !d2.rows.some((r) => String(r[ix.dacTinh] ?? '').trim()) ? 'Cột "Đặc tính" của Kho gửi đang TRỐNG ở mọi dòng' : '');
      const get = (r, k) => (ix[k] >= 0 ? r[ix[k]] : '');
      const pending = d2.pending || {};
      state.lots.m02 = d2.rows.map((r) => {
        const f = {};
        Object.keys(C).forEach((k) => { f[k] = get(r, k); });
        const key = matchKey(f.maHang, f.soLo, f.size, f.phieuNhap);
        const soKien = num(f.soKien);
        const cho = num(pending[key]);
        return {
          raw: r, module: 'M02', key, title: f.tenHang || f.maHang, unit: 'kiện',
          // 'Đặc tính' thêm ở CUỐI: bộ lọc cột lưu theo vị trí (_0, _1…) nên không đổi thứ tự các cột cũ.
          subs: [['Mã', f.maHang], ['Lô', f.soLo], ['Size', f.size], ['PN', f.phieuNhap], ['Đặc tính', f.dacTinh]],
          soKien, cho, con: soKien - cho,
          item: { maHang: f.maHang, tenHang: f.tenHang, dacTinh: f.dacTinh, soLo: f.soLo, size: f.size, phieuNhap: f.phieuNhap, soKien,
                  kgPer: soKien > 0 ? looseNum(f.trongLuong) / soKien : 0,
                  rawKg: looseNum(f.trongLuong) },  // = cột Trọng Lượng (KG) — PC cộng thẳng cột này
          s: norm([f.maHang, f.tenHang, f.dacTinh, f.soLo, f.size, f.phieuNhap].join(' '))
        };
      });
    }
    // ---- Module 01: theo dòng Load Data (cột "_key" do PC đẩy lên), số lượng = "Tồn cuối" ----
    const d1 = state.m01 && state.m01.data;
    state.lots.m01 = [];
    if (d1 && d1.headers) {
      const h = d1.headers;
      const iKey = h.indexOf('_key'), iRow = h.indexOf('_row'), iTon = findHeader(h, 'Tồn cuối'),
            iMa = findHeader(h, 'Mã hàng'), iTen = findHeader(h, 'Tên hàng'), iHd = findHeader(h, 'Hợp đồng'),
            iSz = findHeader(h, 'Size'), iDvt = findHeader(h, 'ĐVT'), iDt = findHeader(h, 'Đặc tính'),
            // Tổng KL giống PC (ton-kho-an-an.js › getWeightBasisAllRows): Tồn cuối (NET) × Trọng lượng (kg/đơn vị);
            // không có cột NET thì dùng Tồn cuối. findHeader so khớp CHÍNH XÁC nên không lẫn "Tồn cuối" với "(NET)".
            iNet = findHeader(h, 'Tồn cuối (NET)'), iTl = findHeader(h, 'Trọng lượng');
      state.lots.m01Ready = iKey >= 0 && iTon >= 0;
      if (state.lots.m01Ready) {
        const pending = d1.pending || {};
        const v = (r, i) => (i >= 0 ? r[i] : '');
        state.lots.m01 = d1.rows.map((r) => {
          const itemKey = String(r[iKey]).trim();
          const key = 'M01|' + itemKey;
          const soKien = looseNum(r[iTon]);
          const cho = num(pending[key]);
          const tl = iTl >= 0 ? looseNum(r[iTl]) : 0;
          // KG = "Tổng KL (kg)" của Module 1 trên PC = Tồn cuối × Trọng lượng (kg/đơn vị). KHÔNG dùng
          // "Tồn cuối (NET)" — cột đó đã là kg net, nhân thêm Trọng lượng ra số sai (bản ≤ 3.44).
          const kgPer = tl > 0 ? tl : 0;
          return {
            raw: r, module: 'M01', key, title: v(r, iTen) || v(r, iMa), unit: String(v(r, iDvt) || 'SL'),
            subs: [['Mã', v(r, iMa)], ['HĐ', v(r, iHd)], ['Size', v(r, iSz)]],
            soKien, cho, con: soKien - cho,
            item: { itemKey, rowIndex: iRow >= 0 ? r[iRow] : '', maHang: v(r, iMa), tenHang: v(r, iTen), size: v(r, iSz), hopDong: v(r, iHd), dacTinh: v(r, iDt), dvt: v(r, iDvt), soKien, kgPer,
              rawKg: soKien * kgPer },  // = "Tổng KL (kg)" của dòng trên PC (Tồn cuối × Trọng lượng)
            s: norm([v(r, iMa), v(r, iTen), v(r, iHd), v(r, iSz), v(r, iDt)].join(' '))
          };
        });
      }
    }
    // ---- Module 01 › Tồn theo vị trí: theo dòng (Mã hàng|Lô|Vị trí#n, cột "_key"), số lượng = "SL Tồn" ----
    const dv = state.vitri && state.vitri.data;
    state.lots.vitri = [];
    state.lots.vitriReady = false;
    if (dv && dv.headers) {
      const h = dv.headers;
      const iKey = h.indexOf('_key'), iSl = findHeader(h, 'SL Tồn'), iMa = findHeader(h, 'Mã hàng'),
            iTen = findHeader(h, 'Tên hàng'), iLo = findHeader(h, 'Lô (Batch)'), iVt = findHeader(h, 'Vị trí'),
            iDvt = findHeader(h, 'ĐVT'), iTl = findHeader(h, 'T.Lượng');
      state.lots.vitriReady = iKey >= 0 && iSl >= 0;
      if (state.lots.vitriReady) {
        const pending = dv.pending || {};
        const v = (r, i) => (i >= 0 ? r[i] : '');
        state.lots.vitri = dv.rows.map((r) => {
          const itemKey = String(r[iKey]).trim();
          const key = 'VT|' + itemKey;
          const soKien = looseNum(r[iSl]);
          const cho = num(pending[key]);
          const [dt, hd] = vtSplitName(v(r, iTen));
          return {
            raw: r, module: 'M01VT', key, title: v(r, iMa) || v(r, iTen), unit: String(v(r, iDvt) || 'SL'),
            subs: [['Vị trí', shortPlace(v(r, iVt))], ['Đặc tính', dt], ['Hợp đồng', hd]], // Lô chỉ xem trong bảng chi tiết / bảng xuất
            soKien, cho, con: soKien - cho,
            item: { itemKey, maHang: v(r, iMa), tenHang: v(r, iTen), soLo: v(r, iLo), viTri: v(r, iVt), dvt: v(r, iDvt), tl: looseNum(v(r, iTl)), soKien },
            s: norm([v(r, iMa), v(r, iTen), v(r, iLo), v(r, iVt)].join(' '))
          };
        });
      }
    }
    // ---- Module 01 › Vị Trí Bột: theo dòng (cột "_key" = Mã hàng|Vị trí|NSX|HSD#n do PC đẩy lên), số lượng = "SL" ----
    const db = state.vitribot && state.vitribot.data;
    state.lots.vitribot = [];
    state.lots.vitribotReady = false;
    if (db && db.headers) {
      const h = db.headers;
      const ix = (n) => findHeader(h, n);
      const iKey = h.indexOf('_key'), iSl = ix('SL');
      state.lots.vitribotReady = iKey >= 0 && iSl >= 0;
      if (state.lots.vitribotReady) {
        const pending = db.pending || {};
        const v = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
        const [iVt, iMa, iNsx, iHsd, iNhap, iGc, iVtMoi] = ['Vị trí', 'Mã hàng', 'NSX', 'HSD', 'Nhập', 'Ghi chú', 'Vị trí mới'].map(ix);
        state.lots.vitribot = db.rows.map((r) => {
          const itemKey = String(r[iKey]).trim();
          const key = 'M01VTB|' + itemKey;
          const soKien = looseNum(r[iSl]);
          const cho = num(pending[key]);
          const item = { itemKey, maHang: v(r, iMa), tenHang: v(r, iGc), viTri: v(r, iVt), soLo: v(r, iNsx),
            nsx: v(r, iNsx), hsd: v(r, iHsd), nhap: v(r, iNhap), ghiChu: v(r, iGc), vtMoi: v(r, iVtMoi), soKien };
          const n = vtbHsdDaysLeft(item);
          return {
            raw: r, module: 'M01VTB', key, title: item.maHang || item.viTri, unit: 'SL',
            subs: [['Vị trí', shortPlace(item.viTri)], ['NSX', item.nsx], ['HSD', item.hsd], ['Nhập', item.nhap], ['Ghi chú', item.ghiChu], ['Vị trí mới', shortPlace(item.vtMoi)]],
            facts0: n === null ? [] : [['HSD còn', n < 0 ? `Đã hết hạn ${fmt(-n)} ngày` : `${fmt(n)} ngày`]],
            hsdDays: n,
            soKien, cho, con: soKien - cho,
            item,
            s: norm([item.maHang, item.viTri, item.vtMoi, item.nsx, item.hsd, item.nhap, item.ghiChu].join(' '))
          };
        }).filter((l) => l.soKien > 0); // 30/09/2026: lược bỏ dòng SL = 0 (hết hàng) — khoá dòng (_key) vẫn do PC tính trên cả danh sách
      }
    }
    // ---- Module 03 (NXT Bột/Sốt): theo LÔ (cột "_key" = mã lô), tồn = "Tổng (kg)". Lô có
    // "Trọng lượng (kg)" (kg/kiện) thì nhập số KIỆN nguyên như form PC, quy ra kg khi gửi. ----
    const d3 = state.m03 && state.m03.data;
    state.lots.m03 = [];
    state.lots.m03Ready = false;
    if (d3 && d3.headers) {
      const h = d3.headers;
      const ix = (n) => findHeader(h, n);
      const iKey = h.indexOf('_key'), iTong = ix('Tổng (kg)');
      state.lots.m03Ready = iKey >= 0 && iTong >= 0;
      if (state.lots.m03Ready) {
        const pending = d3.pending || {};
        const v = (r, i) => (i >= 0 ? r[i] : '');
        const [iMp, iNgay, iVt, iLoai, iMa, iLsx, iKh, iNet] = ['Mã phiếu', 'Ngày nhập', 'Vị trí', 'Loại Hàng', 'Mã Hàng', 'LSX / Hợp đồng', 'Khách hàng', 'Trọng lượng (kg)'].map(ix);
        state.lots.m03 = d3.rows.map((r) => {
          const itemKey = String(r[iKey]).trim();
          const key = 'M03|' + itemKey;
          const soKien = looseNum(r[iTong]);
          const cho = num(pending[key]);
          const pack = looseNum(v(r, iNet));
          return {
            raw: r, module: 'M03', key, title: [v(r, iLoai), v(r, iMa)].filter(Boolean).join(' — '), unit: 'kg', pack: pack > 0 ? pack : 0,
            subs: [['LSX', v(r, iLsx)], ['Vị trí', shortPlace(v(r, iVt))], ['Phiếu', v(r, iMp)], ['Ngày', v(r, iNgay)]],
            soKien, cho, con: soKien - cho,
            item: { itemKey, maHang: v(r, iMa), tenHang: v(r, iLoai), loaiHang: v(r, iLoai), lsx: v(r, iLsx), viTri: v(r, iVt), maPhieuLo: v(r, iMp), pack: pack > 0 ? pack : 0, soKien },
            s: norm([v(r, iMa), v(r, iLoai), v(r, iLsx), v(r, iVt), v(r, iMp), v(r, iKh)].join(' '))
          };
        });
      }
    }
    // ---- Module 04 (NXT TNK/TGC): theo lô nhập × vị trí (cột "_key"), tồn = "SL tồn". ----
    const d4 = state.m04 && state.m04.data;
    state.lots.m04 = [];
    state.lots.m04Ready = false;
    if (d4 && d4.headers) {
      const h = d4.headers;
      const ix = (n) => findHeader(h, n);
      const iKey = h.indexOf('_key'), iTon = ix('SL tồn');
      state.lots.m04Ready = iKey >= 0 && iTon >= 0;
      if (state.lots.m04Ready) {
        const pending = d4.pending || {};
        const v = (r, i) => (i >= 0 ? r[i] : '');
        const [iType, iSup, iInv, iPo, iCode, iDt, iSize, iW, iVt] = ['Loại hàng', 'Nhà cung cấp', 'INV', 'TP/PO', 'Mã hàng', 'Đặc tính', 'Size', 'Trọng lượng', 'Vị trí'].map(ix);
        state.lots.m04 = d4.rows.map((r) => {
          const itemKey = String(r[iKey]).trim();
          const key = 'M04|' + itemKey;
          const soKien = looseNum(r[iTon]);
          const cho = num(pending[key]);
          return {
            raw: r, module: 'M04', key, title: [v(r, iCode), v(r, iSize)].filter(Boolean).join(' — ') || v(r, iType), unit: 'SL',
            subs: [['Vị trí', shortPlace(v(r, iVt)) || 'Chưa có'], ['Loại', v(r, iType)], ['INV', v(r, iInv)], ['PO', v(r, iPo)]],
            soKien, cho, con: soKien - cho,
            item: { itemKey, maHang: v(r, iCode), tenHang: v(r, iType), type: v(r, iType), supplier: v(r, iSup), inv: v(r, iInv), po: v(r, iPo),
              dacTinh: v(r, iDt), size: v(r, iSize), weight: looseNum(v(r, iW)), viTri: v(r, iVt), soKien },
            s: norm([v(r, iCode), v(r, iType), v(r, iSup), v(r, iInv), v(r, iPo), v(r, iDt), v(r, iSize), v(r, iVt)].join(' '))
          };
        });
      }
    }
  }

  // Tên hàng dạng "... (quy cách) - <Đặc tính> - <Hợp đồng>": lấy 2 phần SAU CÙNG khi tách theo " - "
  // (có dấu cách 2 bên). GIỐNG vtSplitName() ở Module 01 trên PC và ở export.js — nên bảng trên điện thoại
  // tách ra đúng như cột "Đặc tính" / "Hợp đồng" của bảng "Tồn theo vị trí" trên PC.
  function vtSplitName(ten) {
    const p = String(ten ?? '').split(' - ');
    return p.length >= 3 ? [p[p.length - 2].trim(), p[p.length - 1].trim()] : ['', ''];
  }

  // Số ngày còn hạn của 1 dòng Vị Trí Bột — CHÉP từ vtbParseDMY()/vtbHsdExpiryDate()/vtbHsdDaysLeft() trong
  // app/html/js/ton-kho-an-an.js (sửa công thức ở PC thì chép lại). HSD là ngày dd/mm/yyyy → dùng luôn; HSD là
  // thời hạn ("6 THÁNG", "180 NGÀY", "1 NĂM"…) → cộng vào NSX. Không tính được → null; âm = đã hết hạn.
  function vtbParseDMY(s) {
    const m = String(s ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
  }
  function vtbHsdDaysLeft(it) {
    let exp = vtbParseDMY(it.hsd);
    if (!exp) {
      const m = String(it.hsd ?? '').trim().toLowerCase().match(/^(\d+)\s*(ngày|ngay|tuần|tuan|tháng|thang|năm|nam)/);
      const nsx = m && vtbParseDMY(it.nsx);
      if (!nsx) return null;
      const n = Number(m[1]), unit = m[2];
      exp = new Date(nsx);
      if (/^ng/.test(unit)) exp.setDate(exp.getDate() + n);
      else if (/^tu/.test(unit)) exp.setDate(exp.getDate() + n * 7);
      else if (/^th/.test(unit)) exp.setMonth(exp.getMonth() + n);
      else exp.setFullYear(exp.getFullYear() + n);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);
    return Math.round((exp - today) / 86400000);
  }

  function buildTonRows(mode) {
    const src = state[mode];
    const d = src && src.data;
    if (!d || !d.headers) { state.tonRows[mode] = []; return; }
    const visible = d.headers.map((h, i) => (isHiddenCol(h) ? -1 : i)).filter((i) => i >= 0);
    state.tonRows[mode] = d.rows.map((r, i) => ({ i, r, s: norm(visible.map((j) => r[j]).join(' ')) }));
  }

  // Cột dùng làm tiêu đề / mã / số lượng cho bảng Tồn kho — tìm theo tên, không có thì lấy mặc định.
  // lotLabel/unitText: nhãn hiển thị cho cột "lô" và đơn vị số lượng khi bảng không có cột ĐVT.
  function pickCols(headers, mode) {
    const find = (names) => { for (const n of names) { const i = findHeader(headers, n); if (i >= 0) return i; } return -1; };
    if (mode === 'm02') return { title: find(['Tên hàng']), code: find(['Mã hàng']), qty: find(['Số kiện']), unit: -1, unitText: 'kiện',
      lot: find(['Số lô']), lotLabel: 'Lô', place: -1, size: find(['Size']) };
    if (mode === 'm03') return { title: find(['Loại Hàng']), code: find(['Mã Hàng']), qty: find(['Tổng (kg)']), unit: -1, unitText: 'kg',
      lot: find(['LSX / Hợp đồng']), lotLabel: 'LSX', place: find(['Vị trí']), size: -1 };
    if (mode === 'm04') return { title: find(['Mã hàng']), code: -1, qty: find(['SL tồn']), unit: -1, unitText: 'SL',
      lot: find(['INV']), lotLabel: 'INV', place: find(['Vị trí']), size: find(['Size']) };
    return {
      title: find(['Tên hàng']),
      code: find(['Mã hàng']),
      qty: mode === 'vitri' ? find(['SL Tồn']) : find(['Tồn cuối', 'SL Tồn', 'Số kiện']),
      unit: find(['ĐVT']),
      lot: find(['Lô (Batch)', 'Số lô', 'Hợp đồng']),
      lotLabel: mode === 'vitri' ? 'Lô' : 'HĐ',
      place: find(['Vị trí']),
      size: find(['Size'])
    };
  }

  // ------------------------------------------------------------------ hiển thị: thanh trên
  function renderFreshness() {
    const el = $('freshness');
    if (state.tab === 'home') { // Trang chủ: mốc PC đẩy mới nhất trong các kho đã lưu trên máy
      const at = SOURCES.map((k) => state[k] && state[k].data && stampIn(state[k].data.meta, k)).filter(Boolean).sort().pop();
      const n = SOURCES.filter((k) => state[k] && state[k].data).length;
      el.classList.remove('is-stale');
      el.textContent = at ? `PC cập nhật ${fmtTime(at)} · ${n}/${SOURCES.length} kho đã lưu trên máy` : (state.cfg.url ? 'Chưa có kho nào trên máy — chạm 1 kho để tải' : '');
      return;
    }
    if (state.tab === 'baocao') { // Trang Báo cáo: giờ PC lập file mới nhất trong các báo cáo đã tải
      const at = REPORT_SRCS.filter(canReport).map((k) => (repFiles(k)[0] || {}).generatedAt).filter(Boolean).sort().pop();
      el.classList.remove('is-stale');
      el.textContent = at ? `Báo cáo PC lập lúc ${fmtTime(at)} · bấm ↻ để tải lại` : '';
      return;
    }
    if (state.tab === 'xuat' && state.xuatSrc === 'tong') { // Tổng: gộp các kho đã lưu trên máy
      const at = SOURCES.map((k) => state[k] && state[k].data && stampIn(state[k].data.meta, k)).filter(Boolean).sort().pop();
      const n = SOURCES.filter((k) => state[k] && state[k].data).length;
      el.classList.remove('is-stale');
      el.textContent = `Tổng ${n}/${SOURCES.length} kho đã lưu trên máy` + (at ? ` · PC cập nhật ${fmtTime(at)}` : '');
      return;
    }
    const src = state.tab === 'ton' ? state[state.tonMode] : state.tab === 'phieu' ? state.phieu : state.tab === 'm8' ? state.m08 : state[state.xuatSrc];
    const meta = src && src.data && src.data.meta;
    let text = '';
    const curKey = state.tab === 'ton' ? state.tonMode : state.tab === 'phieu' ? 'phieu' : state.tab === 'm8' ? 'm08' : state.xuatSrc;
    const pcAt = state.tab !== 'phieu' ? stampIn(meta, curKey) : '';
    // Kho có "Ngày số liệu" (M01, Vị trí, M02): "Tồn kho cập nhật ngày <ngày của file tồn> · Số liệu PC lúc <giờ ngày>".
    const dDate = state.tab !== 'phieu' ? dataDateIn(meta, curKey) : '';
    const hasDateKey = state.tab !== 'phieu' && !!DATA_DATE_KEY[curKey];
    let html = '';
    if (hasDateKey && (dDate || pcAt)) {
      html = 'Tồn kho cập nhật ngày ' + (dDate ? '<b>' + esc(dDate) + '</b>' : '<span class="fr-miss">— (chưa nhập trên PC)</span>')
        + (pcAt ? ' · Số liệu PC lúc ' + esc(fmtTime(pcAt)) : '');
      text = (dDate ? 'Tồn kho cập nhật ngày ' + dDate : 'Tồn kho cập nhật ngày —') + (pcAt ? ' · Số liệu PC lúc ' + fmtTime(pcAt) : '');
    } else if (pcAt) text = 'Số liệu PC lúc ' + fmtTime(pcAt) + ' · đã lưu trên máy';
    else if (src && src.fetchedAt) text = 'Tải lúc ' + fmtTime(src.fetchedAt);
    if (state.stale.has(curKey)) { text += ' · PC có số liệu mới, đang tải…'; if (html) html += ' · PC có số liệu mới, đang tải…'; }
    if (src && src.error) {
      text = (src.fetchedAt ? text + ' — ' : '') + (src.fetchedAt ? 'đang xem bản lưu trên máy, chưa tải lại được' : src.error);
      html = '';
      el.classList.add('is-stale');
    } else {
      el.classList.remove('is-stale');
    }
    if (html) el.innerHTML = html; else el.textContent = text;
  }

  // ------------------------------------------------------------------ thanh TỔNG cố định phía dưới (Xuất kho / Tồn kho)
  // Luôn hiện tổng số lượng của TOÀN BỘ dòng đang lọc (không chỉ các dòng đã hiện ở trang hiện tại);
  // không tìm kiếm thì là tổng tất cả, có tìm kiếm thì là tổng các dòng khớp.
  function updateTotalBar(info) {
    const bar = $('totalBar');
    if (!bar) return;
    if (!info) { bar.hidden = true; document.body.classList.remove('has-totalbar'); return; }
    $('totalBarLabel').innerHTML = `${info.filtered ? 'Tổng khớp tìm kiếm' : 'Tổng tất cả'} <small>${fmt(info.count)} dòng</small>`;
    $('totalBarValue').innerHTML = `${esc(fmt(info.sum))}${info.unit ? ` <small>${esc(info.unit)}</small>` : ''}`;
    bar.hidden = false;
    document.body.classList.add('has-totalbar');
  }
  // Đơn vị chung của một nhóm dòng: cùng 1 đơn vị thì hiện, lẫn nhiều đơn vị thì bỏ trống (tránh cộng gộp gây hiểu nhầm).
  function commonUnit(units) {
    const set = new Set(units.map((u) => String(u || '').trim()).filter(Boolean));
    return set.size === 1 ? [...set][0] : '';
  }

  // ------------------------------------------------------------------ lọc theo nhiều cột
  // Dùng chung cho cả 2 màn hình (Xuất kho / Tồn kho), kết hợp AND với ô tìm kiếm chung ở trên:
  // 1 dòng phải khớp ô tìm kiếm chung LẪN tất cả các ô cột đã điền trong bảng trượt "Lọc theo nhiều cột".

  // Tồn kho: lọc trực tiếp theo TỪNG CỘT của bảng (giống hệt cách PC lọc theo cột ở Load Data) —
  // khóa cột = chỉ số cột trong headers, bỏ các cột ẩn (tên bắt đầu bằng "_").
  function tonFilterFields(mode) {
    const src = state[mode];
    const headers = (src && src.data && src.data.headers) || [];
    const out = [];
    headers.forEach((h, i) => { if (!isHiddenCol(h)) out.push({ key: String(i), label: h }); });
    return out;
  }
  function tonFieldValue(row, key) { return row.r[Number(key)]; }
  // Danh sách giá trị có sẵn cho 1 cột (để tick chọn nhiều) — lấy trên TOÀN BỘ dữ liệu đang tải (không theo
  // bộ lọc/tìm kiếm hiện tại), bỏ rỗng, gộp trùng kèm số dòng, sắp theo bảng chữ cái.
  function fieldOptionsOf(rows, valueOf, key) {
    const cnt = new Map();
    for (const r of rows) {
      const v = valueOf(r, key);
      if (v === '' || v === null || v === undefined) continue;
      const k = String(v);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    return Array.from(cnt, ([v, n]) => ({ v, n })).sort((x, y) => x.v.localeCompare(y.v, 'vi'));
  }
  function tonFieldOptions(mode, key) { return fieldOptionsOf(state.tonRows[mode] || [], tonFieldValue, key); }
  function xuatFieldOptions(src, key) { return fieldOptionsOf(state.lots[src] || [], xuatFieldValue, key); }

  // Xuất kho: mỗi nguồn đã có sẵn "subs" (nhãn cột hiển thị ở dòng, VD "Vị trí", "Size"…) — dùng lại
  // đúng các nhãn đó để bảng lọc khớp với những gì người dùng đang thấy trên danh sách, cộng thêm
  // 1 ô tiêu đề (Tên hàng / Mã hàng tuỳ nguồn) chưa nằm trong "subs".
  const XUAT_TITLE_LABEL = { vitri: 'Mã hàng', vitribot: 'Mã hàng', m03: 'Mã hàng', m04: 'Mã hàng', tong: 'Mã hàng' };
  function xuatFilterFields(src) {
    const lots = state.lots[src] || [];
    const subLabels = lots.length ? lots[0].subs.map(([k]) => k) : [];
    return [{ key: '_title', label: XUAT_TITLE_LABEL[src] || 'Tên hàng' }, ...subLabels.map((l, i) => ({ key: 's' + i, label: l }))];
  }
  function xuatFieldValue(lot, key) {
    if (key === '_title') return lot.title;
    const pair = lot.subs[Number(key.slice(1))];
    return pair ? pair[1] : '';
  }

  // Huy hiệu số lượng bộ lọc + dãy "chip" hiển thị bộ lọc đang bật + trạng thái nút Lọc.
  function renderFilterUi(scope) {
    const isX = scope === 'xuat';
    const src = isX ? state.xuatSrc : state.tonMode;
    const fields = isX ? xuatFilterFields(src) : tonFilterFields(src);
    const store = (isX ? state.colf.xuat : state.colf.ton)[src] || {};
    const entries = Object.entries(store).filter(([, v]) => v && v.length);
    const btn = $(isX ? 'xuatFilterBtn' : 'tonFilterBtn');
    const badge = $(isX ? 'xuatFilterBadge' : 'tonFilterBadge');
    btn.classList.toggle('has-filter', entries.length > 0);
    badge.hidden = !entries.length;
    badge.textContent = entries.length;
    $(isX ? 'xuatFilterChips' : 'tonFilterChips').innerHTML = entries.map(([k, v]) => {
      const f = fields.find((x) => x.key === k);
      return `<button type="button" class="filter-chip" data-cfdel="${esc(k)}">${esc((f && f.label) || k)}: ${esc(cfSummary(v))}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    }).join('');
  }

  // Tóm tắt các giá trị đã chọn của 1 cột: "A", hoặc "A +2".
  function cfSummary(vals) {
    const v = (vals || []).map(noTpc);
    return v.length <= 1 ? (v[0] || '') : `${v[0]} +${v.length - 1}`;
  }
  // Bộ lọc mỗi cột = MẢNG các giá trị đã tick. Trong 1 cột: khớp BẤT KỲ giá trị nào đã chọn (HOẶC);
  // giữa các cột: phải khớp TẤT CẢ (VÀ). So khớp nguyên giá trị (không phân biệt hoa/thường, dấu).
  function cfCompile(store) {
    return Object.entries(store || {}).filter(([, v]) => v && v.length).map(([k, v]) => [k, new Set(v.map(norm))]);
  }

  // Bảng trượt "Lọc theo nhiều cột": chạm vào 1 ô cột → mở danh sách giá trị có ô tick để chọn NHIỀU giá trị
  // cùng lúc. Mỗi lần tick áp dụng NGAY vào danh sách phía sau; "Áp dụng" chỉ để đóng bảng cho gọn.
  function openColFilterSheet(scope) {
    const isX = scope === 'xuat';
    const src = isX ? state.xuatSrc : state.tonMode;
    const fields = isX ? xuatFilterFields(src) : tonFilterFields(src);
    const bucket = isX ? state.colf.xuat : state.colf.ton;
    const store = bucket[src] || (bucket[src] = {});
    if (!fields.length) { toast('Chưa có dữ liệu để lọc theo cột.', true); return; }
    const rerender = () => { renderFilterUi(scope); state.limit[scope] = PAGE; renderXuat(); };
    const body = $('sheetBody');
    const SHOW_MAX = 200;

    // Lọc PHÂN TẦNG: danh sách giá trị của 1 cột chỉ gồm giá trị của những dòng còn lại sau khi áp các cột KHÁC
    // (cùng ô tìm kiếm chung và "Chỉ lô còn hàng"). VD chọn 2 mã hàng → cột Vị trí chỉ liệt kê vị trí của 2 mã đó.
    // Giá trị đang tick nhưng không còn dòng nào vẫn giữ lại (số dòng 0) để còn bỏ tick được.
    function cascadeOptions(key) {
      const qs = isX ? xuatQueries() : norm(state.q.ton).trim().split(/\s+/).filter(Boolean);
      const cf = cfCompile(store).filter(([k]) => k !== key);
      let rows, valueOf;
      if (isX) {
        const onlyAvail = $('onlyAvail').checked;
        valueOf = xuatFieldValue;
        const lotHit = makeXuatMatch(qs, state.lots[src]);
        rows = (state.lots[src] || []).filter((l) => (!onlyAvail || l.con > 0) && hsdQuickOk(src, l) && khoOk(src, l) && lotHit(l)
          && cf.every(([k, set]) => set.has(norm(xuatFieldValue(l, k)))));
      } else {
        valueOf = tonFieldValue;
        rows = (state.tonRows[src] || []).filter((x) => wordsHit(x.s, qs, x)
          && cf.every(([k, set]) => set.has(norm(tonFieldValue(x, k)))));
      }
      const opts = fieldOptionsOf(rows, valueOf, key);
      const have = new Set(opts.map((o) => o.v));
      (store[key] || []).forEach((v) => { if (!have.has(v)) opts.push({ v, n: 0 }); });
      return opts.sort((x, y) => x.v.localeCompare(y.v, 'vi'));
    }

    function showMain() {
      body.oninput = null;
      body.innerHTML = `
        <div class="sheet-grip"></div>
        <h2>Lọc theo nhiều cột</h2>
        <p class="lead">Chạm vào từng ô để chọn một hoặc nhiều giá trị. Trong cùng một cột: khớp bất kỳ giá trị nào đã chọn. Giữa các cột: phải khớp tất cả, và danh sách của mỗi cột chỉ hiện giá trị còn lại theo các cột khác đã lọc.</p>
        <div class="filter-grid">
          ${fields.map((f) => {
            const vals = store[f.key] || [];
            return `<div class="field"><span>${esc(f.label)}</span>
              <button type="button" class="cf-pick${vals.length ? ' has' : ''}" data-pick="${esc(f.key)}">
                <span class="cf-pick-t">${vals.length ? esc(cfSummary(vals)) : 'Tất cả'}</span>${vals.length > 1 ? `<b class="cf-pick-n">${vals.length}</b>` : ''}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>
              </button></div>`;
          }).join('')}
        </div>
        <button type="button" class="btn btn-primary" id="cfApply">Áp dụng</button>
        <button type="button" class="btn btn-ghost" id="cfClear">Xóa lọc</button>`;
      body.onclick = (e) => {
        const pk = e.target.closest('[data-pick]');
        if (pk) { showPicker(pk.getAttribute('data-pick')); return; }
        if (e.target.closest('#cfApply')) { closeSheet(); return; }
        if (e.target.closest('#cfClear')) {
          Object.keys(store).forEach((k) => delete store[k]);
          rerender();
          showMain();
        }
      };
    }

    function showPicker(key) {
      const f = fields.find((x) => x.key === key);
      const all = cascadeOptions(key);
      const sel = new Set(store[key] || []);
      // Cho phép gõ nhãn size có tiền tố ("BTP 60", "BTP 16/20"…) để tìm mã hàng, giống ô tìm
      // kiếm chung ở trên — nhãn này tính từ chính giá trị (mã hàng 21 ký tự), trả về '' với các
      // cột khác (Vị trí, Đặc tính…) nên không ảnh hưởng gì tới các cột đó.
      const tagOf = isX ? sizeTagger() : () => '';
      let q = '';
      let matched = [];
      body.innerHTML = `
        <div class="sheet-grip"></div>
        <h2>${esc(f.label)}</h2>
        <p class="lead" id="cfpInfo"></p>
        <input type="search" class="search" id="cfpQ" placeholder="Gõ để thu hẹp danh sách…" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="cfp-actions">
          <button type="button" class="btn btn-ghost" id="cfpAll"></button>
          <button type="button" class="btn btn-ghost" id="cfpNone">Bỏ chọn hết</button>
        </div>
        <ul class="cfp-list" id="cfpList"></ul>
        <button type="button" class="btn btn-primary" id="cfpDone">Xong</button>`;
      const commit = () => { if (sel.size) store[key] = Array.from(sel); else delete store[key]; rerender(); };
      const draw = () => {
        const nq = norm(q).trim();
        matched = nq ? all.filter((o) => norm(noTpc(o.v)).includes(nq) || norm(o.v).includes(nq)
          || norm(tagOf(o.v, '')).includes(nq)) : all;
        const shown = matched.slice(0, SHOW_MAX);
        $('cfpList').innerHTML = shown.map((o, i) => `<li><label class="cfp-item"><input type="checkbox" data-i="${i}"${sel.has(o.v) ? ' checked' : ''}><span class="cfp-t">${esc(noTpc(o.v))}</span><em>${fmt(o.n)}</em></label></li>`).join('')
          + (matched.length > shown.length ? `<li class="cfp-more">Còn ${fmt(matched.length - shown.length)} giá trị nữa — gõ thêm để thu hẹp, hoặc bấm "Chọn hết đang hiện".</li>` : '')
          + (!matched.length ? '<li class="cfp-more">Không có giá trị nào khớp.</li>' : '');
        $('cfpAll').textContent = `Chọn hết đang hiện (${fmt(matched.length)})`;
        $('cfpAll').disabled = !matched.length;
        info();
        shownRef = shown;
      };
      let shownRef = [];
      const info = () => { $('cfpInfo').textContent = sel.size ? `Đã chọn ${fmt(sel.size)} / ${fmt(all.length)} giá trị` : `${fmt(all.length)} giá trị còn lại — chưa chọn (= tất cả)`; };
      body.oninput = (e) => { if (e.target.id === 'cfpQ') { q = e.target.value; draw(); } };
      body.onchange = (e) => {
        const cb = e.target.closest('input[data-i]');
        if (!cb) return;
        const o = shownRef[Number(cb.getAttribute('data-i'))];
        if (!o) return;
        if (cb.checked) sel.add(o.v); else sel.delete(o.v);
        info(); commit();
      };
      body.onclick = (e) => {
        if (e.target.closest('#cfpAll')) { matched.forEach((o) => sel.add(o.v)); draw(); commit(); return; }
        if (e.target.closest('#cfpNone')) { sel.clear(); draw(); commit(); return; }
        if (e.target.closest('#cfpDone')) { body.onchange = null; showMain(); }
      };
      draw();
    }

    openSheet('', () => { body.oninput = null; body.onchange = null; body.onclick = null; });
    showMain();
  }

  // ------------------------------------------------------------------ màn hình Xuất kho
  function cartQty(key) {
    if (!state.cart) return 0;
    return state.cart.items.filter((it) => it.key === key).reduce((s, it) => s + num(it.qty), 0);
  }

  // Sắp xếp danh sách tab Kho khi bấm tiêu đề cột (Mã hàng / Vị trí-Lô / SL): tăng → giảm → bỏ.
  // Nhớ trên máy (dùng chung mọi kho). So chuỗi kiểu "tự nhiên" (H.9 < H.10, BTP 30 < BTP 100).
  state.sort = load('klanan.xuatSort', null);
  state.hsdQ = ['sap', 'het'].includes(load('klanan.hsdQ', '')) ? load('klanan.hsdQ', '') : ''; // lọc nhanh hạn dùng (Vị trí Bột)
  // Chế độ "Chọn nhiều": chạm dòng = tick/bỏ tick; thanh dưới "Thêm vào phiếu" đưa MỌI dòng đã tick vào
  // phiếu với SỐ CÒN LẤY ĐƯỢC (sửa lại từng dòng trong phiếu nếu cần). Không lưu qua lần mở app.
  state.multi = { on: false, sel: new Set() };
  const natCmp = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' }).compare;
  // Đặc tính của 1 dòng: Kho gửi / M04 có cột riêng; An An (M01, Vị trí) tách từ Tên hàng như bảng PC.
  function dtOf(src, it) {
    it = it || {};
    if (src === 'm02' || src === 'm04') return String(it.dacTinh || '').trim();
    if (src === 'm01' || src === 'vitri') return String((src === 'm01' && it.dacTinh) || vtSplitName(it.tenHang)[0] || '').trim();
    return '';
  }
  // Nhóm hạn dùng cho lọc nhanh (Vị trí Bột): 'het' = đã hết hạn (< 0 ngày), 'sap' = còn 0–9 ngày — cùng
  // ngưỡng 10 ngày với màu cột "HSD (ngày)" trên PC. Không tính được hạn → ''.
  const hsdGroup = (l) => (l.hsdDays == null ? '' : l.hsdDays < 0 ? 'het' : l.hsdDays < 10 ? 'sap' : '');
  const hsdQuickOk = (src, l) => src !== 'vitribot' || !state.hsdQ || hsdGroup(l) === state.hsdQ;
  // LỌC THEO KHO (bản 1.5) — chỉ kho "Tồn vị trí An An": vị trí "TG1.J.12.3.1" thuộc Kho 1 … "TG5.…" thuộc Kho 5.
  // state.xuatKho: '' = Tổng (mặc định, KHÔNG lưu — mở app luôn về Tổng), '1'…'5'. Hiển thị vị trí vẫn bỏ tiền tố.
  const khoNoOf = (l) => { const m = /^TG(\d+)\./i.exec(String((l && l.item && l.item.viTri) || '').trim()); return m ? String(Number(m[1])) : ''; };
  const khoOk = (src, l) => src !== 'vitri' || !state.xuatKho || khoNoOf(l) === state.xuatKho;
  function placeKhoPick(src, lots, onlyAvail) {
    const on = src === 'vitri';
    const pick = $('khoPick'), sel = $('xuatKho'); if (!pick || !sel) return;
    pick.hidden = !on;
    // Ô "Chỉ lô còn hàng": hàng trên (cạnh Sắp xếp) cho kho khác; khi có nút Kho thì xuống hàng số dòng (theo mẫu đã duyệt)
    const tog = $('onlyAvail').closest('.toggle'), metaRow = $('xuatMeta').parentElement, optRow = pick.parentElement;
    const target = on ? metaRow : optRow;
    if (tog && tog.parentElement !== target) target.insertBefore(tog, target.firstChild);
    metaRow.classList.toggle('has-toggle', on);
    if (!on) return;
    const cnt = { '': 0 };
    (lots || []).forEach((l) => { if (onlyAvail && !(l.con > 0)) return; cnt['']++; const k = khoNoOf(l); if (k) cnt[k] = (cnt[k] || 0) + 1; });
    Array.from(sel.options).forEach((o) => { o.textContent = (o.value ? 'Kho: Kho ' + o.value : 'Kho: Tổng') + ' (' + fmt(cnt[o.value] || 0) + ')'; });
    if (sel.value !== (state.xuatKho || '')) sel.value = state.xuatKho || '';
    pick.classList.toggle('on', !!state.xuatKho); // cùng kiểu "đang lọc" với nút Sắp xếp
  }
  function sortKeyOf(src, l, key) {
    if (key === 'qty') return l.con - cartQty(l.key);
    // Hạn dùng: số ngày còn hạn (âm = đã hết hạn, lên đầu); dòng không tính được hạn xuống cuối.
    if (key === 'hsd') return l.hsdDays == null ? Infinity : l.hsdDays;
    if (key === 'dt') return noTpc(dtOf(src, l.item));
    if (key === 'place') return noTpc(KHO[src].placeOf(l.item || {}) || '');
    return noTpc((l.item && l.item.maHang) || l.title || '');
  }
  function sortLots(src, rows) {
    const so = state.sort;
    if (!so || !so.key) return rows;
    const dir = so.dir === -1 ? -1 : 1;
    return rows.map((l, i) => ({ l, i, k: sortKeyOf(src, l, so.key) })).sort((a, b) => {
      const numeric = so.key === 'qty' || so.key === 'hsd';
      if (so.key === 'hsd' && (a.k === Infinity) !== (b.k === Infinity)) return a.k === Infinity ? 1 : -1; // không rõ hạn: luôn cuối
      let c = numeric ? (a.k === b.k ? 0 : a.k - b.k) : natCmp(String(a.k), String(b.k));
      if (!numeric && (a.k === '') !== (b.k === '')) return a.k === '' ? 1 : -1; // ô trống luôn xuống cuối
      // Cùng đặc tính → xếp tiếp theo vị trí/lô rồi mã hàng (các dòng cùng nhóm nằm liền, dễ gom xuất)
      if (!c && so.key === 'dt') c = natCmp(String(sortKeyOf(src, a.l, 'place')), String(sortKeyOf(src, b.l, 'place'))) * dir || natCmp(String(sortKeyOf(src, a.l, 'ma')), String(sortKeyOf(src, b.l, 'ma'))) * dir;
      return c * dir || a.i - b.i;
    }).map((x) => x.l);
  }
  function paintSortPick() {
    const sel = $('xuatSort'); if (!sel) return;
    const v = state.sort && state.sort.key ? state.sort.key + ':' + (state.sort.dir === -1 ? -1 : 1) : '';
    sel.value = [...sel.options].some((o) => o.value === v) ? v : '';
    // Tiêu đề cột đang sắp theo kiểu không có trong danh sách (VD Mã hàng Z→A) → vẫn tô nút
    sel.parentElement.classList.toggle('on', !!v);
    const src = state.xuatSrc;
    [...sel.options].forEach((o) => {
      if (o.value.startsWith('dt:')) o.disabled = src === 'm03' || src === 'vitribot';
      if (o.value.startsWith('hsd:')) o.disabled = src !== 'vitribot'; // hạn dùng chỉ có ở Vị trí Bột
    });
  }
  function paintSortHead() {
    paintSortPick();
    document.querySelectorAll('#xuatHead > [data-sort]').forEach((el) => {
      const on = state.sort && state.sort.key === el.dataset.sort;
      el.classList.toggle('sorted', !!on);
      el.dataset.arrow = on ? (state.sort.dir === -1 ? '▼' : '▲') : '';
      el.title = 'Bấm để sắp xếp' + (on ? (state.sort.dir === -1 ? ' (đang giảm dần)' : ' (đang tăng dần)') : '');
    });
  }
  function renderXuat() {
    const list = $('xuatList');
    const meta = $('xuatMeta');
    const src = state.xuatSrc;
    if ($('xuatMulti')) $('xuatMulti').hidden = !canCreate() || src === 'tong';
    if (src === 'tong') { renderTong(); return; }
    $('khoPickerName').textContent = KHO[src].name;
    $('khoPickerSub').textContent = KHO[src].mod + ' · ' + KHO[src].desc + ' · đổi kho';
    $('xuatHeadPlace').textContent = KHO[src].place;
    // 2 ô tìm song song (ô 1 HOẶC ô 2) — gợi ý ngắn vì mỗi ô chỉ còn nửa bề ngang; gợi ý đầy đủ để ở title.
    $('xuatSearch').title = { m01: 'Tìm mã hàng, tên, hợp đồng, size', vitri: 'Tìm vị trí, mã hàng, tên, lô', vitribot: 'Tìm vị trí, mã hàng, NSX, HSD, ghi chú',
      m03: 'Tìm loại hàng, mã hàng, LSX, vị trí', m04: 'Tìm mã hàng, INV, PO, size, vị trí' }[src] || 'Tìm mã hàng, tên, lô, size, phiếu nhập';
    $('xuatSearch').placeholder = src === 'vitri' || src === 'vitribot' ? 'Vị trí / mã…' : 'Tìm giá trị 1';
    const lots = state.lots[src];
    if (!SOURCES.length) {
      list.innerHTML = ''; $('xuatMore').hidden = true; $('xuatHead').hidden = true; updateTotalBar(null);
      meta.innerHTML = emptyHtml('Chưa được cấp kho nào', 'Mã truy cập này chưa được chọn kho nào. Liên hệ người quản lý app PC.');
      return;
    }
    if (!state[src] || !state[src].data) {
      list.innerHTML = '';
      meta.innerHTML = state[src] && state[src].error
        ? emptyHtml('Chưa tải được', state[src].error)
        : emptyHtml('Chưa có số liệu', state.cfg.url ? 'Bấm nút tải lại ở góc trên để lấy tồn kho.' : 'Mở Cài đặt để nhập đường dẫn Web App.');
      $('xuatMore').hidden = true; $('xuatHead').hidden = true;
      updateTotalBar(null);
      return;
    }
    if (src !== 'm02' && !state.lots[src + 'Ready'] && (state[src].data.rows || []).length) {
      list.innerHTML = '';
      meta.innerHTML = emptyHtml('Chưa xuất được từ nguồn này', 'Trên PC: cập nhật app bản mới, bấm "🔄 Đồng bộ ngay" rồi tải lại ở đây.');
      $('xuatMore').hidden = true; $('xuatHead').hidden = true;
      updateTotalBar(null);
      return;
    }
    const q = xuatQueries();
    const onlyAvail = $('onlyAvail').checked;
    const cf = cfCompile(state.colf.xuat[src]);
    const lotHit = makeXuatMatch(q, lots);
    const rows = sortLots(src, lots.filter((l) => (!onlyAvail || l.con > 0) && hsdQuickOk(src, l) && khoOk(src, l) && lotHit(l)
      && cf.every(([k, set]) => set.has(norm(xuatFieldValue(l, k))))));
    renderHsdQuick(src, lots, onlyAvail);
    placeKhoPick(src, lots, onlyAvail);
    paintSortHead();
    renderFilterUi('xuat');
    const shown = rows.slice(0, state.limit.xuat);
    state.xuatRows = rows; // cho "Chọn hết" ở chế độ chọn nhiều
    meta.textContent = lots.length ? `${fmt(rows.length)} dòng${src === 'vitri' && state.xuatKho ? ' · Kho ' + state.xuatKho : ''}${q.length ? ' khớp tìm kiếm' : ''}${src === 'vitribot' && state.hsdQ ? (state.hsdQ === 'het' ? ' · đã hết hạn' : ' · sắp hết hạn (< 10 ngày)') : ''}` : '';
    if (src === 'm02' && lots.length && state.lots.m02DtIssue) meta.textContent += ' · ⚠ ' + state.lots.m02DtIssue + ' — trên PC bấm Đồng bộ / Đẩy tồn kho lại.';
    // Tổng = đúng con số "còn" đang hiện ở từng dòng (đã trừ phần đang soạn trong phiếu), cộng cho TẤT CẢ dòng đang lọc
    updateTotalBar(lots.length ? { filtered: q.length > 0, count: rows.length, unit: commonUnit(rows.map((l) => l.unit)),
      sum: rows.reduce((sum, l) => sum + (l.con - cartQty(l.key)), 0) } : null);
    if (!lots.length) {
      list.innerHTML = '';
      const emptyTitle = { m02: 'Tồn kho gửi đang trống', m01: 'Tồn kho An An đang trống', vitri: 'Tồn theo vị trí đang trống', vitribot: 'Vị trí Bột đang trống',
        m03: 'Tồn NXT Bột/Sốt đang trống', m04: 'Tồn NXT TNK/TGC đang trống' }[src];
      const emptyWhere = { m02: 'Module 02', m01: 'Module 01', vitri: 'Module 01 → Tồn theo vị trí', vitribot: 'Module 01 → Load Data → "Tải dữ liệu vị trí Bột"', m03: 'Module 03', m04: 'Module 04' }[src];
      meta.innerHTML = emptyHtml(emptyTitle, `Trên PC: nạp dữ liệu ở ${emptyWhere} rồi bấm "🔄 Đồng bộ ngay".`);
    } else if (!rows.length) {
      list.innerHTML = '';
      meta.innerHTML = emptyHtml('Không có dòng nào khớp', onlyAvail ? 'Thử bỏ chọn "Chỉ lô còn hàng" hoặc đổi từ khóa.' : 'Thử từ khóa khác, ví dụ mã hàng hoặc size.');
    } else {
      // Dòng hàng 1 dòng: Mã hàng · <Vị trí / Lô / HĐ> · SL còn; dòng 2 = tên + thông tin phụ + nhãn chờ/đang soạn.
      // Đơn vị chung của cả danh sách ghi 1 lần ở tiêu đề cột "SL (…)" — dòng nào khác đơn vị mới
      // ghi riêng, để cột mã hàng đủ chỗ hiện trọn 21 ký tự.
      state.listUnit = commonUnit(shown.map((l) => l.unit));
      setRowColWidths($('view-xuat'), shown.map((l) => [src, l]));
      list.innerHTML = shown.map((l) => lotRowHtml(src, l)).join('');
    }
    $('xuatHeadUnit').textContent = state.listUnit && state.listUnit !== 'SL' ? `SL (${state.listUnit})` : 'SL'; // tránh "SL (SL)"
    $('xuatHead').hidden = !shown.length;
    renderMultiBar();
    $('xuatMore').hidden = rows.length <= shown.length;
    $('xuatMore').textContent = `Xem thêm (${fmt(rows.length - shown.length)} dòng)`;
  }

  // 3 nút lọc nhanh hạn dùng (chỉ kho Vị trí Bột). Số trên nút = số dòng thuộc nhóm đó (theo "Chỉ lô còn
  // hàng", không theo ô tìm kiếm) để biết ngay còn bao nhiêu dòng cần xử lý.
  function renderHsdQuick(src, lots, onlyAvail) {
    const box = $('hsdQuick');
    if (!box) return;
    box.hidden = src !== 'vitribot' || !lots.length;
    if (box.hidden) return;
    const cnt = { sap: 0, het: 0 };
    lots.forEach((l) => { if (!onlyAvail || l.con > 0) { const g = hsdGroup(l); if (g) cnt[g]++; } });
    $('hsdQSap').textContent = cnt.sap ? '(' + fmt(cnt.sap) + ')' : '';
    $('hsdQHet').textContent = cnt.het ? '(' + fmt(cnt.het) + ')' : '';
    box.querySelectorAll('[data-hsdq]').forEach((b) => b.classList.toggle('is-on', b.dataset.hsdq === (state.hsdQ || '')));
  }

  // Độ rộng cột Vị trí/Lô và cột SL co giãn theo giá trị DÀI NHẤT đang hiện (vd "TG2.G.05.03"),
  // để không bị cắt chữ; mã hàng dùng phần còn lại. Ghi vào biến CSS --kp-w / --kq-w của khung
  // chứa danh sách (dùng chung cho dòng tiêu đề cột).
  function setRowColWidths(el, pairs) {
    // Độ rộng cột Vị trí/Lô và cột SL vừa khít giá trị dài nhất đang hiện; mã hàng dùng phần còn lại.
    // Đo bằng canvas rồi NHÂN HỆ SỐ lấy từ 1 chữ mẫu vẽ thật trong trang: Android phóng to chữ theo
    // "Cỡ chữ" của máy (WebView textZoom) nhưng canvas KHÔNG biết → trước đây cột Vị trí bị tính hẹp,
    // chữ bị cắt "A.12…". Ưu tiên: Vị trí + SL hiện ĐỦ; màn hẹp thì thu nhỏ chữ dòng 1 (tối thiểu
    // 10.5px), vẫn không đủ thì cho mã hàng xuống 2 dòng (class k-wrap) thay vì cắt bớt.
    const cv = setRowColWidths.cv || (setRowColWidths.cv = document.createElement('canvas').getContext('2d'));
    const family = getComputedStyle(document.body).fontFamily;
    const avail = Math.max(160, (el.clientWidth || window.innerWidth) - 24 - 24 - 12); // lề khung + lề dòng + 2 khoảng cách cột
    const texts = pairs.map(([src, l]) => ({
      code: noTpc((l.item && l.item.maHang) || l.title),
      place: shortPlace(noTpc(KHO[src].placeOf(l.item || {}) || '—')),
      qty: fmt(l.con - cartQty(l.key)),
      unit: state.listUnit && state.listUnit === l.unit ? '' : ' ' + l.unit
    }));
    // Hệ số phóng chữ thật = độ rộng chữ mẫu trong trang ÷ độ rộng canvas cùng font (≈ 1 nếu cỡ chữ mặc định).
    const SAMPLE = 'A.12.03 BE6FH 1234';
    const probe = document.createElement('span');
    probe.textContent = SAMPLE;
    probe.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:700 20px ${family};letter-spacing:0`;
    el.appendChild(probe);
    cv.font = `700 20px ${family}`;
    const zoom = Math.max(1, (probe.getBoundingClientRect().width || 0) / (cv.measureText(SAMPLE).width || 1)) || 1;
    probe.remove();
    const widest = (font, arr) => { cv.font = font; return zoom * arr.reduce((m, t) => Math.max(m, cv.measureText(String(t)).width), 0); };
    let fs = 12.5, qfs = 18, kp, kq, code;
    for (;;) {
      kp = Math.ceil(widest(`700 ${fs}px ${family}`, texts.map((t) => t.place)) + 14);  // + đệm 2 bên của ô vị trí
      kq = Math.ceil(widest(`700 ${qfs}px ${family}`, texts.map((t) => t.qty)) + widest(`400 11px ${family}`, texts.map((t) => t.unit)) + 6);
      code = Math.ceil(widest(`700 ${fs}px ${family}`, texts.map((t) => t.code)) * 0.98);
      if (code + kp + kq <= avail || fs <= 10.5) break;
      fs = Math.round((fs - 0.5) * 10) / 10;
      if (qfs > 15) qfs -= 1;
    }
    // Vị trí tối đa ~45% và SL ~30% bề ngang dòng (mã hàng luôn còn chỗ); không đủ chỗ cho mã → mã xuống dòng.
    kp = Math.min(Math.round(avail * 0.45), Math.max(44, kp));
    kq = Math.min(Math.round(avail * 0.3), Math.max(36, kq));
    el.classList.toggle('k-wrap', code + kp + kq > avail);
    el.style.setProperty('--k-fs', fs + 'px');
    el.style.setProperty('--kq-fs', qfs + 'px');
    el.style.setProperty('--kp-w', kp + 'px');
    el.style.setProperty('--kq-w', kq + 'px');
    requestAnimationFrame(() => fixPlaceOverflow(el, avail));
  }
  // Chốt chặn sau khi vẽ: ô Vị trí nào vẫn bị cắt chữ (font chưa tải xong, máy phóng chữ lạ…) thì nới
  // cột theo đúng độ rộng thật của ô đó (tối đa 45% dòng).
  function fixPlaceOverflow(el, avail) {
    let need = 0;
    el.querySelectorAll('.krow .k-place').forEach((c) => { if (c.scrollWidth > c.clientWidth + 1) need = Math.max(need, c.scrollWidth - c.clientWidth); });
    if (!need) return;
    const cur = parseFloat(getComputedStyle(el).getPropertyValue('--kp-w')) || 66;
    el.style.setProperty('--kp-w', Math.min(Math.round(avail * 0.45), Math.ceil(cur + need + 2)) + 'px');
  }


  function lotRowHtml(src, l, khoLabel) {
    const inCart = cartQty(l.key);
    const con = l.con - inCart;
    const placeFull = noTpc(KHO[src].placeOf(l.item || {}) || '');
    const place = shortPlace(placeFull);
    const code = noTpc((l.item && l.item.maHang) || l.title);
    const pills = (l.hsdDays != null && l.hsdDays < 10 ? `<span class="pill ${l.hsdDays < 0 ? 'hsd-het' : 'hsd-sap'}">${l.hsdDays < 0 ? 'hết hạn' : 'sắp hết hạn'}</span>` : '')
      + (l.item && l.item.vtMoi ? '<span class="pill chuyen">đang chuyển</span>' : '')
      + (l.cho ? `<span class="pill wait">chờ PC ${fmt(l.cho)}</span>` : '') + (inCart ? `<span class="pill soan">soạn ${fmt(inCart)}</span>` : '');
    const kien = l.pack ? ` title="≈ ${fmt(Math.floor(con / l.pack + 1e-9))} kiện"` : '';
    const pickCls = state.multi.on ? (canPick(l) ? (state.multi.sel.has(l.key) ? ' picked' : '') : ' no-pick') : '';
    return `<li class="row${l.con <= 0 ? ' is-empty' : ''}${inCart ? ' in-cart' : ''}${pickCls}">
      <button type="button" class="krow" data-lot="${esc(l.key)}" data-src="${src}">
        <span class="k1"><span class="k-code">${esc(code)}</span><span class="k-place${place ? '' : ' none'}" title="${esc(placeFull)}">${esc(place || '—')}</span>
          <span class="k-qty"${kien}><b>${fmt(con)}</b>${!khoLabel && state.listUnit && state.listUnit === l.unit ? '' : ` <small>${esc(l.unit)}</small>`}</span></span>
        <span class="k2">${khoLabel ? `<span class="pill soan">${esc(khoLabel)}</span>` : ''}${l.sizeTag ? `<span class="k-size">${esc(l.sizeTag)}</span>` : ''}<span class="k-name">${esc(lotLine2(src, l))}</span>${pills}</span>
      </button>
    </li>`;
  }


  // ------------------------------------------------------------------ Kho › "Tổng" (tất cả kho)
  // Gộp dòng của MỌI kho đang dùng (đã lưu trên máy) vào 1 danh sách — GIỐNG ô "Tìm trong toàn kho" trang chính PC
  // (app/html/js/global-search.js): tìm theo nhãn Size + từng từ ở mọi cột (makeLotMatch), lọc nhiều cột phân tầng
  // (bảng "Lọc theo nhiều cột": Kho, Vị trí, Size, Hợp đồng, Đặc tính), mặc định xếp theo mã hàng rồi kho. Chạm 1 dòng
  // → bảng chi tiết mã đó (CHỈ các dòng đang khớp tìm kiếm + bộ lọc), chạm tiếp 1 dòng trong đó → màn xuất như cũ.
  // Mỗi dòng Tổng là 1 "vỏ" bọc dòng thật (w.lot, w.src) — xuất / phiếu luôn dùng dòng thật của kho gốc.
  const TONG_ORDER = ['m01', 'vitri', 'vitribot', 'm02', 'm03', 'm04'];
  const tongCache = { refs: null, list: [] };
  function tongHd(src, it) {
    if (src === 'm01') return String(it.hopDong || vtSplitName(it.tenHang)[1] || '').trim();
    if (src === 'vitri') return vtSplitName(it.tenHang)[1] || '';
    if (src === 'm03') return String(it.lsx || '').trim();
    if (src === 'm04') return String(it.po || '').trim();
    return '';
  }
  function tongLots() {
    const refs = SOURCES.map((k) => state.lots[k]);
    if (tongCache.refs && tongCache.refs.length === refs.length && refs.every((r, i) => r === tongCache.refs[i])) return tongCache.list;
    const list = [];
    SOURCES.slice().sort((a, b) => TONG_ORDER.indexOf(a) - TONG_ORDER.indexOf(b)).forEach((k) => (state.lots[k] || []).forEach((l) => {
      const it = l.item || {};
      const ma = noTpc(it.maHang || l.title || '');
      list.push({
        src: k, lot: l, key: l.key, module: l.module, unit: l.unit, pack: l.pack, hsdDays: l.hsdDays, item: it,
        get con() { return l.con; }, get cho() { return l.cho; },
        sizeTag: l.sizeTag, s: l.s, title: ma, _ma: ma.toUpperCase(), _ord: TONG_ORDER.indexOf(k),
        subs: [['Kho', KHO[k].name], ['Vị trí', shortPlace(noTpc(it.viTri || ''))], ['Size', l.sizeTag || String(it.size || '').trim()],
          ['Hợp đồng', tongHd(k, it)], ['Đặc tính', dtOf(k, it)]]
      });
    }));
    tongCache.refs = refs; tongCache.list = list;
    state.lots.tong = list; // cho bảng "Lọc theo nhiều cột" (xuatFilterFields / cascadeOptions đọc state.lots[src])
    return list;
  }
  function tongKgOf(w) {
    if (w.src === 'm03') return Math.max(w.con, 0);
    const per = KHO_KG_PER[w.src];
    return per ? Math.max(w.con, 0) * per(w.item) : 0;
  }
  function tongFiltered() {
    const lots = tongLots();
    const q = xuatQueries();
    const onlyAvail = $('onlyAvail').checked;
    const cf = cfCompile(state.colf.xuat.tong);
    const hit = makeXuatMatch(q, lots);
    let rows = lots.filter((w) => (!onlyAvail || w.con > 0) && hit(w) && cf.every(([k, set]) => set.has(norm(xuatFieldValue(w, k)))));
    const so = state.sort;
    if (so && so.key) {
      const dir = so.dir === -1 ? -1 : 1;
      const numeric = so.key === 'qty' || so.key === 'hsd';
      rows = rows.map((w, i) => ({ w, i, k: sortKeyOf(w.src, w.lot, so.key) })).sort((a, b) => {
        if (so.key === 'hsd' && (a.k === Infinity) !== (b.k === Infinity)) return a.k === Infinity ? 1 : -1;
        if (!numeric && (a.k === '') !== (b.k === '')) return a.k === '' ? 1 : -1;
        const c = numeric ? (a.k === b.k ? 0 : a.k - b.k) : natCmp(String(a.k), String(b.k));
        return c * dir || a.i - b.i;
      }).map((x) => x.w);
    } else {
      rows = rows.slice().sort((a, b) => natCmp(a._ma, b._ma) || a._ord - b._ord || (b.con - a.con));
    }
    return { lots, q, rows };
  }
  function renderTong() {
    const list = $('xuatList');
    const meta = $('xuatMeta');
    $('khoPickerName').textContent = 'Tổng — tất cả kho';
    $('khoPickerSub').textContent = `${SOURCES.length} kho · tìm trong mọi kho · đổi kho`;
    $('xuatHeadPlace').textContent = 'Vị trí / Lô';
    $('xuatSearch').title = 'Tìm mã hàng, size (VD BTP 50), vị trí, hợp đồng, đặc tính — trong mọi kho';
    $('xuatSearch').placeholder = 'Mã / size / vị trí…';
    renderHsdQuick('tong', [], true);
    paintSortHead();
    if (!SOURCES.length) {
      list.innerHTML = ''; $('xuatMore').hidden = true; $('xuatHead').hidden = true; updateTotalBar(null);
      meta.innerHTML = emptyHtml('Chưa được cấp kho nào', 'Mã truy cập này chưa được chọn kho nào. Liên hệ người quản lý app PC.');
      return;
    }
    const missing = SOURCES.filter((k) => !(state[k] && state[k].data)).map((k) => KHO[k].name);
    const { lots, q, rows } = tongFiltered();
    renderFilterUi('xuat');
    state.xuatRows = rows;
    const shown = rows.slice(0, state.limit.xuat);
    meta.textContent = lots.length ? `${fmt(rows.length)} dòng${q.length ? ' khớp tìm kiếm' : ''} · ${fmt(new Set(rows.map((w) => w._ma)).size)} mã`
      + (missing.length ? ` · chưa tải: ${missing.join(', ')}` : '') : '';
    // Cùng 1 đơn vị → cộng số lượng; lẫn nhiều đơn vị (kiện, SL, kg…) → cộng KG. Không cộng trùng Tồn kho An An
    // với Tồn vị trí (totalsOf).
    const T = totalsOf(rows.map((w) => [w.src, w.lot]));
    updateTotalBar(lots.length ? (T.units.length === 1
      ? { filtered: q.length > 0, count: rows.length, unit: T.units[0][0], sum: Math.round(T.units[0][1] * 100) / 100 }
      : { filtered: q.length > 0, count: rows.length, unit: 'kg', sum: T.kg }) : null);
    if (!lots.length) {
      list.innerHTML = '';
      meta.innerHTML = emptyHtml('Chưa có số liệu', state.cfg.url ? 'Bấm nút tải lại ở góc trên để lấy tồn kho của mọi kho.' : 'Mở Cài đặt để nhập đường dẫn Web App.');
    } else if (!rows.length) {
      list.innerHTML = '';
      meta.innerHTML = emptyHtml('Không có dòng nào khớp', 'Thử từ khóa khác, bỏ bớt bộ lọc cột, hoặc bỏ chọn "Chỉ lô còn hàng".');
    } else {
      state.listUnit = '';
      setRowColWidths($('view-xuat'), shown.map((w) => [w.src, w.lot]));
      list.innerHTML = shown.map((w) => lotRowHtml(w.src, w.lot, KHO[w.src].name).replace('data-lot=', 'data-tong="1" data-lot=')).join('');
    }
    $('xuatHeadUnit').textContent = 'SL';
    $('xuatHead').hidden = !shown.length;
    renderMultiBar();
    $('xuatMore').hidden = rows.length <= shown.length;
    $('xuatMore').textContent = `Xem thêm (${fmt(rows.length - shown.length)} dòng)`;
  }
  // Bảng chi tiết 1 mã trong "Tổng": CHỈ các dòng của mã đó đang khớp tìm kiếm + bộ lọc (giống PC).
  function openTongDetail(ma) {
    const rows = (state.xuatRows || []).filter((w) => w._ma === ma);
    if (!rows.length) return;
    const byKho = TONG_ORDER.filter((k) => rows.some((w) => w.src === k)).map((k) => {
      const x = rows.filter((w) => w.src === k);
      return { k, n: x.length, con: x.reduce((a, w) => a + Math.max(w.con, 0), 0), unit: commonUnit(x.map((w) => w.unit)), kg: x.reduce((a, w) => a + tongKgOf(w), 0) };
    });
    const kg = rows.reduce((a, w) => a + tongKgOf(w), 0);
    const tag = (rows.find((w) => w.sizeTag) || {}).sizeTag || '';
    const dts = [...new Set(rows.map((w) => w.subs[4][1]).filter(Boolean))];
    const qTxt = [state.q.xuat, state.q.xuat2].map((v) => String(v || '').trim()).filter(Boolean).join(' + ');
    openSheet(`
      <h2 class="td-code">${esc(rows[0].title)}</h2>
      <p class="lead">${qTxt ? `Chỉ các dòng khớp “${esc(qTxt)}”` : 'Các dòng đang hiện của mã này'}${cfCompile(state.colf.xuat.tong).length ? ' và bộ lọc cột' : ''}</p>
      <div class="td-tags">${tag ? `<span class="k-size">${esc(tag)}</span>` : ''}${dts.map((d) => `<span class="pill">${esc(d)}</span>`).join('')}</div>
      <div class="td-kho">${byKho.map((b) => `<div class="td-k"><span>${esc(KHO[b.k].name)}</span><b>${fmt(b.con)}${b.unit ? ' <small>' + esc(b.unit) + '</small>' : ''}</b>${b.kg ? `<small class="qty-kg">≈ ${esc(fmtKg(b.kg))} kg</small>` : ''}</div>`).join('')}</div>
      ${kg ? `<p class="td-sum">Tổng KL ≈ <b>${esc(fmtKg(kg))} kg</b></p>` : ''}
      <p class="lead">Vị trí / lô (${fmt(rows.length)}) — chạm 1 dòng để xem / xuất</p>
      <ul class="list td-list">${rows.map((w) => lotRowHtml(w.src, w.lot, KHO[w.src].name)).join('')}</ul>
      <button type="button" class="btn btn-ghost" data-close style="margin-top:10px">Đóng</button>`);
    setRowColWidths($('sheetBody'), rows.map((w) => [w.src, w.lot]));
    $('sheetBody').onclick = (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const b = e.target.closest('[data-lot]');
      if (!b) return;
      const lot = (state.lots[b.dataset.src] || []).find((l) => l.key === b.dataset.lot);
      if (lot) openQtySheet(lot);
    };
  }

  function emptyHtml(title, text) {
    return `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
  }

  // (Tab "Tồn kho" cũ đã gộp vào tab "Kho" — xem renderXuat(); không còn renderTon().)

  // ------------------------------------------------------------------ TRA CỨU KHÁNG SINH (tab "Tra cứu")
  // Giao diện riêng cho điện thoại, CHỈ XEM. Dữ liệu = sheet KhangSinh của Module 08 trên PC (bảng Meta
  // M08 đẩy lên): khóa "ksinhRulesData" (bảng quy định, nếu PC đã sửa) + các khóa "batch:…" (lô đã kiểm).
  // Chưa có bảng quy định từ PC → dùng bảng mặc định (ks-rules.js, chép từ khangsinh.html của PC).
  // Cách so khớp (parseCond / matchFieldDetail / findMatch) chép NGUYÊN từ khangsinh.html — sửa ở PC thì
  // sửa lại ở đây. Mã hóa SP / Dữ liệu tổng hợp / Báo cáo rã đông chỉ dùng trên PC nên đã bỏ khỏi điện thoại.
  const KS_FIELDS = [
    { key: 'enro', label: 'Enro' }, { key: 'cipro', label: 'Cipro' }, { key: 'oxy', label: 'Oxy' }, { key: 'doxy', label: 'Doxy' },
    { key: 'sulfo', label: 'Sulfo' }, { key: 'aoz', label: 'AOZ' }, { key: 'cap', label: 'CAP' },
  ];
  const KS_MARKETS = ['NHẬT', 'EU', 'ASC', 'MỸ', 'HQ', 'MKS'];
  const M8 = { ks: 'history', hsort: 'new', /* bản 1.8: mở luôn "Lô đã kiểm" (trang mặc định) */ inp: load('klanan.ksInput', {}), q: '', mk: '', hq: '', limit: PAGE, dataOf: null, rules: null, hist: null };
  // Mở rộng dòng rút gọn "~{...}" do PC 5.0 gửi về đúng khuôn bản ghi cũ (để phần hiển thị / tìm kiếm không phải đổi).
  function ksExpand(v) {
    if (typeof v !== 'string' || v.charAt(0) !== '~') return v;
    let o; try { o = JSON.parse(v.slice(1)); } catch (e) { return ''; }
    const F = ['enro', 'cipro', 'oxy', 'doxy', 'sulfo', 'aoz', 'cap'];
    const rec = { date: o.d, batch: o.b, note: o.n, dat: o.r, kyhieu: o.k, savedAt: o.s, mota: o.m, inputs: {} };
    F.forEach((f, i) => { rec.inputs[f] = (o.i || [])[i] || ''; });
    if (o.nk) rec.lan1Src = { ngayKiem: o.nk };
    if (o.L && o.L.length) {
      rec.lan2All = o.L.map((a) => ({ date: a[0], dat: a[1], kyhieu: a[2], ghichu: a[3], so: a[4], stt: a[5], mau: a[6], group: a[7] }));
      rec.lan2 = rec.lan2All.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).pop();
    }
    return JSON.stringify(rec);
  }
  function ksData() {
    const d = state.m08 && state.m08.data;
    const t0 = d && d.khangSinh;
    // Bảng kháng sinh tải riêng (state.ks) còn TRỐNG mà bản m08 có sẵn dữ liệu → dùng bản m08.
    const ksOk = state.ks && state.ks.rows && (Object.keys(state.ks.rows).length || !(t0 && t0.rows && t0.rows.length));
    const src = ksOk ? state.ks : d;
    if (M8.dataOf === src && M8.rules && src) return M8;
    const map = new Map();
    const t = d && d.khangSinh;
    if (ksOk) {
      Object.keys(state.ks.rows).forEach((k) => map.set(k, ksExpand(state.ks.rows[k])));
    } else if (t && t.headers) {
      const ik = t.headers.indexOf('key'), iv = t.headers.indexOf('value');
      (t.rows || []).forEach((r) => { if (r[ik] != null && r[ik] !== '') map.set(String(r[ik]), r[iv]); });
    }
    let rules = null;
    const raw = map.get('s:ksinhRulesData');
    if (raw) { try { const x = JSON.parse(raw); if (Array.isArray(x) && x.length) rules = x; } catch (e) { /* bảng lỗi → mặc định */ } }
    M8.fromPc = !!rules;
    M8.rules = rules || (window.KS_DEFAULT_RULES || []);
    const hist = [];
    map.forEach((v, k) => {
      if (!k.startsWith('s:batch:')) return;
      try { const rec = JSON.parse(v); if (rec && typeof rec === 'object') hist.push(rec); } catch (e) { /* bỏ bản ghi lỗi */ }
    });
    hist.sort((a, b) => String(b.savedAt || b.date || '').localeCompare(String(a.savedAt || a.date || '')));
    M8.hist = hist; M8.dataOf = src;
    return M8;
  }
  // ---- so khớp (chép từ khangsinh.html) ----
  function ksParseCond(cond) {
    if (typeof cond === 'number') return { type: '<', val: cond };
    const c = String(cond ?? '').trim();
    if (c.toUpperCase() === 'ND') return { type: 'ND' };
    const m = c.match(/^([<>])\s*([\d.,]+)/);
    return m ? { type: m[1], val: parseFloat(m[2].replace(',', '.')) } : { type: 'ND' };
  }
  const ksBlank = (raw) => raw == null || String(raw).trim() === '' || String(raw).trim().toUpperCase() === 'ND';
  function ksMatchField(raw, cond) {
    const c = ksParseCond(cond);
    if (c.type === 'ND') return { ok: ksBlank(raw), implicit: false };
    if (ksBlank(raw)) return { ok: c.type === '<', implicit: c.type === '<' };
    const v = parseFloat(String(raw).trim().replace(',', '.'));
    if (isNaN(v)) return { ok: false, implicit: false };
    if (c.type === '<') return { ok: v < c.val, implicit: false };
    if (c.type === '>') return { ok: v > c.val, implicit: false };
    return { ok: false, implicit: false };
  }
  function ksFindMatch(rules, inputs) {
    let best = null, bestScore = Infinity;
    for (const row of rules) {
      let ok = true, score = 0;
      for (const f of KS_FIELDS) {
        const dt = ksMatchField(inputs[f.key], row[f.key]);
        if (!dt.ok) { ok = false; break; }
        if (dt.implicit) score++;
      }
      if (ok && score < bestScore) { best = row; bestScore = score; if (!score) break; }
    }
    return best;
  }
  const ksFail = (row) => String(row && row.dat || '').toUpperCase().includes('KHÔNG ĐẠT');
  function ksMarkets(row) {
    const t = String(row && row.dat || '').toUpperCase().replace(/^ĐẠT\s*/, '');
    if (ksFail(row)) return [];
    // "ASC-A,B" là 1 thị trường (ASC loại A và B) → gộp mẩu 1 chữ cái vào mẩu trước
    const out = [];
    t.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => { if (x.length <= 1 && out.length) out[out.length - 1] += ',' + x; else out.push(x); });
    return out;
  }
  // 7 chỉ tiêu dạng ô nhỏ: chỉ tiêu có ngưỡng thì đậm, ND thì mờ
  function ksPills(row) {
    return `<div class="ks-pills">${KS_FIELDS.map((f) => { const v = String(row[f.key] ?? '').trim() || 'ND'; const nd = v.toUpperCase() === 'ND';
      return `<span class="ks-pill${nd ? ' nd' : v.startsWith('>') ? ' bad' : ''}"><small>${f.label}</small>${esc(v)}</span>`; }).join('')}</div>`;
  }
  function ksVerdict(row) {
    if (!row) return '<span class="ks-badge none">Không khớp</span>';
    return ksFail(row) ? '<span class="ks-badge fail">KHÔNG ĐẠT</span>' : '<span class="ks-badge pass">ĐẠT</span>';
  }

  function renderM8() {
    document.querySelectorAll('#m8KsSeg .seg').forEach((b) => b.classList.toggle('is-on', b.dataset.ks === M8.ks));
    const body = $('m8Body');
    const D = ksData();
    const src = M8.fromPc ? '' : `<p class="ks-note">Đang dùng bảng quy định mặc định (${fmt(D.rules.length)} trường hợp). Quy định thêm/sửa trên PC sẽ hiện ở đây sau khi PC đồng bộ “Tổng hợp (M08)”.</p>`;
    if (M8.ks === 'lookup') {
      body.innerHTML = `<div class="ks-card">
          <div class="ks-head"><b>Nhập kết quả kiểm</b><button type="button" class="linkbtn" id="ksClear">Xóa hết</button></div>
          <p class="ks-hint">Để trống = không phát hiện (ND). Gõ số đo, VD <b>5</b> hoặc <b>0.3</b>.</p>
          <div class="ks-grid">${KS_FIELDS.map((f) => `<label class="ks-in"><span>${f.label}</span>
            <input type="text" inputmode="decimal" data-ksf="${f.key}" value="${esc(M8.inp[f.key] || '')}" placeholder="ND" autocomplete="off"></label>`).join('')}</div>
        </div>
        <div id="ksResult"></div>${src}`;
      renderKsResult();
      return;
    }
    if (M8.ks === 'rules') {
      body.innerHTML = `<div class="search-row"><input type="search" class="search" id="ksRuleQ" placeholder="Tìm ký hiệu, thị trường, mô tả (VD 63, EU, Sul<10)" value="${esc(M8.q)}" autocomplete="off"></div>
        <div class="ks-chips">${['', ...KS_MARKETS, 'KĐ'].map((m) => `<button type="button" data-ksmk="${m}" class="${M8.mk === m ? 'is-on' : ''}">${m === '' ? 'Tất cả' : m === 'KĐ' ? 'Không đạt' : m}</button>`).join('')}</div>
        <div id="ksList"></div>${src}`;
      renderKsRules();
      return;
    }
    // SẮP XẾP (bản 1.8): ngày mới → cũ (mặc định) / ngày cũ → mới / theo số lô; trong cùng ngày luôn lô 1, 2, 3…
    body.innerHTML = `<div class="search-row"><input type="search" class="search" id="ksHistQ" placeholder="VD: L1 3/5/2026 · MKS2 9.9.26 · 46.EU" value="${esc(M8.hq)}" autocomplete="off"></div>
      <label class="sort-pick ks-sort"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>
        <select id="ksHistSort" aria-label="Sắp xếp lô đã kiểm">
          <option value="new"${M8.hsort === 'new' ? ' selected' : ''}>Ngày mới nhất trước</option>
          <option value="old"${M8.hsort === 'old' ? ' selected' : ''}>Ngày cũ nhất trước</option>
          <option value="lo"${M8.hsort === 'lo' ? ' selected' : ''}>Theo số lô (1, 2, 3…)</option>
        </select></label><div id="ksList"></div>`;
    renderKsHist();
  }
  function renderKsResult() {
    const box = $('ksResult'); if (!box) return;
    const D = ksData();
    const any = KS_FIELDS.some((f) => String(M8.inp[f.key] || '').trim() !== '');
    const row = ksFindMatch(D.rules, M8.inp);
    if (!row) {
      box.innerHTML = `<div class="ks-result none"><div class="ks-r-top">${ksVerdict(null)}</div>
        <p>Tổ hợp vừa nhập không khớp trường hợp nào trong ${fmt(D.rules.length)} quy định. Kiểm tra lại số đo hoặc xem tab <b>Quy định</b>.</p></div>`;
      return;
    }
    const notes = KS_FIELDS.filter((f) => ksParseCond(row[f.key]).type === '<' && ksBlank(M8.inp[f.key]))
      .map((f) => `${f.label} chưa phát hiện (ND) — mặc nhiên đạt ngưỡng ${esc(row[f.key])}`);
    const mk = ksMarkets(row);
    box.innerHTML = `<div class="ks-result ${ksFail(row) ? 'fail' : 'pass'}">
        <div class="ks-r-top">${ksVerdict(row)}<span class="ks-stt">Trường hợp ${esc(row.stt)}</span></div>
        <div class="ks-code">${esc(row.kyhieu)}</div>
        ${mk.length ? `<div class="ks-mk">${mk.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : `<div class="ks-dat">${esc(row.dat)}</div>`}
        <p class="ks-desc">${esc(row.mota)}</p>
        ${ksPills(row)}
        ${any && notes.length ? `<details class="ks-notes"><summary>Ghi chú (${notes.length})</summary>${notes.map((n) => `<div>${n}</div>`).join('')}</details>` : ''}
        ${any ? '' : '<p class="ks-hint" style="margin:8px 0 0">Chưa nhập số đo nào — kết quả trên là trường hợp “tất cả ND”.</p>'}
      </div>`;
  }
  function renderKsRules() {
    const box = $('ksList'); if (!box) return;
    const D = ksData();
    const words = norm(M8.q).trim().split(/\s+/).filter(Boolean);
    const rows = D.rules.filter((r) => {
      if (M8.mk === 'KĐ' && !ksFail(r)) return false;
      if (M8.mk && M8.mk !== 'KĐ' && !(ksMarkets(r).some((m) => m.startsWith(M8.mk)))) return false;
      if (!words.length) return true;
      const s = norm([r.stt, r.kyhieu, r.dat, r.mota].join(' '));
      return wordsHit(s, words, r);
    });
    box.innerHTML = rows.length ? `<p class="list-meta">${fmt(rows.length)} quy định</p><ul class="ks-rules">${rows.slice(0, M8.limit).map((r) => `<li class="ks-rule ${ksFail(r) ? 'fail' : ''}">
        <div class="ks-rule-top"><b>${esc(r.kyhieu)}</b>${ksVerdict(r)}</div>
        <div class="ks-rule-dat">${esc(r.dat)}</div>
        ${ksPills(r)}
      </li>`).join('')}</ul>${rows.length > M8.limit ? `<button type="button" class="more-btn" id="ksMore">Xem thêm (${fmt(rows.length - M8.limit)})</button>` : ''}`
      : emptyHtml('Không có quy định nào khớp', 'Thử từ khóa hoặc thị trường khác.');
  }
  // ---- Tìm lô đã kiểm "thông minh" (giống ô Tìm nhanh ở PC — sửa 1 bên thì sửa bên kia) ----
  // • Ngày: 3/5/2026, 3.5.2026, 3-5-26, 3/5, 3.5 (thiếu năm → mọi năm) — hiểu là NGÀY/THÁNG.
  // • Lô: "L1", "Lô 1", "lo1", "L01" → đúng lô "1" / "Lô 1" (không lẫn lô 10, 11…).
  // • Từ khác (ký hiệu, kết luận, ghi chú…): chứa là khớp. Các điều kiện ghép VÀ, thứ tự tùy ý.
  function ksParseDay(v) {
    const t = String(v ?? '').trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) return { d: +m[1], m: +m[2], y: +m[3] < 100 ? 2000 + +m[3] : +m[3] };
    return null;
  }
  const ksDmy = (v) => { const p = ksParseDay(v); return p ? String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + p.y : String(v || ''); };
  const ksLoKey = (v) => { const k = norm(v).replace(/\s+/g, '').replace(/^(lo|l)(?=[\w])[.\-:]?/, ''); return /^\d+$/.test(k) ? String(+k) : k; };
  // Bản 1.9 (đồng bộ PC 4.8): + MẪU CHỜ "MKS2" / "MCSKS2" / "MC2" / "MKS 2" / "MKS chờ 2"; ngày đi kèm MKS = ngày phân tích
  // của lần kiểm lại; đi kèm L = ngày nhập của lô; chỉ ngày = mọi loại ngày (nhập, kiểm lần 1, kiểm lại).
  const ksLan2List = (r) => (r && r.lan2All && r.lan2All.length ? r.lan2All : (r && r.lan2 ? [r.lan2] : []));
  // Bản 2.1: nhận diện MẪU CHỜ rộng hơn. Từ khóa: MKS / MCS / MKSC / MCKS / MCSKS / MC + số (MKS2, MCS3, MKSC2, MC2, "MKS chờ 2",
  // "MKS 2", "mẫu chờ 3", "mks-2"…). Số = SỐ MẪU chờ (2, 3, 4, 5…). Gõ \"mẫu chờ\" / \"MKS chờ\" không kèm số = mọi mẫu chờ.
  const KS_MK_WORD = '(?:mcsks|mcks|mkscho|mksc|mcs|mks|mc)';
  const KS_MK_ONLY = new RegExp('^' + KS_MK_WORD + '$');
  const KS_MK_NUM = new RegExp('^' + KS_MK_WORD + '[.\\-_:#]*(\\d+)$');
  // Đọc tên mẫu: trả { cho: true/false, no: số mẫu | null }. Mẫu chờ = tên có \"MKS chờ\", \"mẫu chờ\", \"MC 2\", \"MCS3\"… ở ĐẦU tên
  // hoặc có chữ \"chờ\" đi kèm MKS/MCS/MC. Không lấy số ở phần \"ngày 26.09 · LSX 073/09\" phía sau.
  function ksMauInfo(name) {
    const t = norm(name || '').replace(/\s+/g, ' ').trim();
    if (!t) return { cho: false, no: null };
    let m = t.match(new RegExp('(?:^|[\\s(\\[])(?:' + KS_MK_WORD.slice(3, -1) + '|mau)\\s*cho\\s*(?:so|mau|no|#)?\\s*[.\\-:]?\\s*(\\d+)'));
    if (m) return { cho: true, no: +m[1] };
    m = t.match(new RegExp('^' + KS_MK_WORD + '\\s*[.\\-_:#]?\\s*(?:so|mau|no)?\\s*[.\\-_:#]?\\s*(\\d+)(?!\\d|[./\\-]\\d)'));
    if (m) return { cho: true, no: +m[1] };
    m = t.match(new RegExp('(?:^|[\\s(\\[])(?:' + KS_MK_WORD.slice(3, -1) + '|mau)\\s*cho(?![a-z])'));
    if (m) return { cho: true, no: null };
    return { cho: false, no: null };
  }
  const ksMksNo = (mau) => { const i = ksMauInfo(mau); return i.no; };
  // Một lần kiểm lại l của lô r có phải mẫu chờ số no (null = bất kỳ)? Tên mẫu = l.mau, hoặc (mẫu không ghi lô) tên lô.
  // Mẫu chờ không ghi số trong tên → lấy số mẫu trên phiếu (l.stt).
  function ksLanIsMks(r, l, no) {
    // Có tên mẫu riêng (vd "Lô 9") thì chỉ xét tên đó; chỉ khi lần kiểm lại không ghi tên mẫu mới xét tên lô.
    const i = String(l.mau || '').trim() ? ksMauInfo(l.mau) : ksMauInfo(r.batch);
    if (!i.cho) return false;
    if (no == null) return true;
    const n = i.no != null ? i.no : (/^\d+$/.test(String(l.stt || '').trim()) ? +String(l.stt).trim() : null);
    return n === no;
  }
  function ksHistMatcher(q) {
    const toks = norm(q).trim().split(/\s+/).filter(Boolean);
    const conds = [], dates = [];
    let mks = null, mksAny = false, lotGiven = false;
    for (let i = 0; i < toks.length; i++) {
      let t = toks[i];
      let mm = t.match(KS_MK_NUM);
      if (mm) { mks = +mm[1]; continue; }
      // \"mks 2\" / \"mks cho 2\" / \"mks cho so 2\" / \"mau cho 3\" / \"mks cho\" (không số = mọi mẫu chờ)
      const isMk = KS_MK_ONLY.test(t), isMau = t === 'mau' && toks[i + 1] === 'cho';
      if (isMk || isMau) {
        let j = i + 1, sawCho = isMau;
        if (isMau) j = i + 2; else if (toks[j] === 'cho') { sawCho = true; j++; }
        if (toks[j] === 'so' || toks[j] === 'no') j++;
        if (toks[j] && /^\d+$/.test(toks[j])) { mks = +toks[j]; i = j; continue; }
        if (sawCho) { mksAny = true; i = j - 1; continue; }
      }
      if ((t === 'lo' || t === 'l') && toks[i + 1]) { t = t + toks[++i]; }
      const dm = t.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
      if (dm) { dates.push({ d: +dm[1], m: +dm[2], y: dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : null }); continue; }
      if (/^(lo|l)[.\-:]?[a-z0-9]/.test(t) && !/^lo?[a-z]{2,}/.test(t.replace(/^lo/, 'l'))) {
        const k = ksLoKey(t); lotGiven = true;
        conds.push((r) => ksLoKey(r.batch) === k);
        continue;
      }
      conds.push((r) => wordsHit(norm([r.batch, r.kyhieu, r.dat, r.note, ksDmy(r.date)].concat(ksLan2List(r).map((l) => [l.dat, l.kyhieu, l.ghichu, l.mau, 'lan 2', 'kiem lai'].join(' '))).join(' ')), [t], null));
    }
    const dOk = (iso) => { const p = ksParseDay(iso); return !!p && dates.every((x) => p.d === x.d && p.m === x.m && (x.y == null || p.y === x.y)); };
    const mksMode = mks != null || mksAny;
    // Chế độ MẪU CHỜ: chỉ lấy lô có lần kiểm lại là mẫu chờ khớp số + ngày (ngày = ngày phân tích của lần đó). Hàm pick(r) trả
    // về đúng lần kiểm lại khớp để thẻ hiện ĐÚNG kết quả đó (không hiện lần mới nhất khác).
    const lanOk = (r, l) => ksLanIsMks(r, l, mks) && (!dates.length || dOk(l.date));
    const fn = (r) => {
      if (!conds.every((c) => c(r))) return false;
      if (mksMode) return ksLan2List(r).some((l) => lanOk(r, l));
      if (!dates.length) return true;
      if (lotGiven) return dOk(r.date);
      return dOk(r.date) || ksLan2List(r).some((l) => dOk(l.date)) || !!(r.lan1Src && dOk(r.lan1Src.ngayKiem));
    };
    fn.mksMode = mksMode;
    fn.pick = (r) => {
      if (!mksMode) return null;
      const hits = ksLan2List(r).filter((l) => lanOk(r, l)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      return hits.length ? hits[hits.length - 1] : null;
    };
    return fn;
  }

  // KẾT QUẢ LẦN 2 (bản 1.6) — PC 3.4+ gắn rec.lan2 vào lô khi nhập phiếu "KẾT QUẢ LẦN 1 + LẦN 2" (Module 8). Kết quả lần 1
  // giữ nguyên ở trên; khối dưới chỉ hiện khi lô có lần 2. Mẫu không ghi lô (MKS chờ, mẫu kiểm…) có mã = cả tên mẫu.
  function ksBatchLabel(b) {
    const t = String(b || '').replace(/：/g, ':').trim();
    return !t ? 'Lô —' : (/^[0-9]+[A-Za-z]?$/.test(t) ? 'Lô ' + esc(t) : esc(t));
  }
  // Kết quả KIỂM LẠI mới nhất theo NGÀY (bản 1.9): "Lần N" = thứ tự ngày kiểm lại + 1; kiểm lại nhiều lần → "đã kiểm lại K lần".
  function ksLan2Html(r, pick) {
    const list = ksLan2List(r).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const l = (pick && list.indexOf(pick) >= 0 ? pick : null) || list[list.length - 1]; if (!l) return '';
    const days = Array.from(new Set(list.map((x) => x.date || ''))).sort();
    const lan = days.indexOf(l.date || '') + 2;
    const fail = /KHÔNG\s*ĐẠT/i.test(String(l.dat || ''));
    return `<div class="ks-lan2"><div class="ks-lan2-top"><span class="ks-lan2-tag">Lần ${lan}</span><span class="ks-badge ${fail ? 'fail' : 'pass'}">${esc(l.dat || '—')}</span>${l.kyhieu ? '<b>' + esc(l.kyhieu) + '</b>' : ''}</div>`
      + `<div class="ks-rule-dat">Kiểm ${esc(ksDmy(l.date))}${l.ghichu ? ' · ' + esc(l.ghichu) : ''}${l.so ? ' · Phiếu ' + esc(l.so) + (l.stt ? ' mẫu ' + esc(l.stt) : '') : ''}</div>`
      + (days.length > 1 ? `<div class="ks-rule-dat">Đã kiểm lại ${days.length} lần: ${list.map((x) => 'Lần ' + (days.indexOf(x.date || '') + 2) + ' ' + esc(ksDmy(x.date)) + ' ' + esc(x.dat || '')).join(' · ')}</div>` : '')
      + `</div>`;
  }

  function renderKsHist() {
    const box = $('ksList'); if (!box) return;
    const D = ksData();
    if (!D.hist.length && !(state.m08 && state.m08.data)) {
      const er = state.m08 && state.m08.error;
      box.innerHTML = er ? emptyHtml('Chưa tải được dữ liệu', er + ' — bấm nút tải lại ở góc trên để thử lại.') : emptyHtml('Đang tải dữ liệu…', 'Vui lòng đợi trong giây lát.');
      return;
    }
    if (!D.hist.length) {
      const nKs = state.ks && state.ks.rows ? Object.keys(state.ks.rows).length : 0;
      const nM8 = (state.m08.data.khangSinh && state.m08.data.khangSinh.rows || []).length;
      box.innerHTML = emptyHtml('Chưa có lô nào', 'Lô đã kiểm được nhập ở PC (Module 08 → Tra cứu kháng sinh → Nhập theo ngày, lô) và đồng bộ “Tổng hợp (M08)”.')
        + `<p class="ks-note">Chẩn đoán: máy nhận ${fmt(nKs)} dòng kháng sinh (máy chủ báo ${state.ks && state.ks.srvTotal != null ? fmt(state.ks.srvTotal) : '—'}), bảng m08 có ${fmt(nM8)} dòng${state.ksOff ? ' · Web App chưa cập nhật Code.gs' : ''}. Nếu đều là 0 thì PC chưa đẩy dữ liệu kháng sinh lên Google Sheet.</p>`;
      return;
    }
    const hit = ksHistMatcher(M8.hq);
    const loNum = (b) => { const n = parseInt(String(b || '').replace(/\D+/g, ''), 10); return isNaN(n) ? 1e9 : n; };
    const byLo = (a, b) => loNum(a.batch) - loNum(b.batch) || String(a.batch || '').localeCompare(String(b.batch || ''));
    const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
    const cmp = M8.hsort === 'old' ? (a, b) => byDate(a, b) || byLo(a, b)
      : M8.hsort === 'lo' ? (a, b) => byLo(a, b) || byDate(b, a)
      : (a, b) => byDate(b, a) || byLo(a, b);
    const rows = D.hist.filter(hit).sort(cmp);
    box.innerHTML = rows.length ? `<p class="list-meta">${fmt(rows.length)} lô</p><ul class="ks-rules">${rows.slice(0, M8.limit).map((r) => `<li class="ks-rule ${ksFail(r) ? 'fail' : ''}">
        <div class="ks-rule-top"><b>${ksBatchLabel(r.batch)}</b>${r.dat ? ksVerdict(r) : ''}</div>
        <div class="ks-rule-dat">${esc(ksDmy(r.date))}${r.kyhieu ? ' · ' + esc(r.kyhieu) : ''}${r.note ? ' · ' + esc(r.note) : ''}</div>
        ${r.inputs && Object.keys(r.inputs).length ? ksPills(Object.fromEntries(KS_FIELDS.map((f) => [f.key, ksBlank(r.inputs[f.key]) ? 'ND' : r.inputs[f.key]]))) : ''}
        ${ksLan2Html(r, hit.pick ? hit.pick(r) : null)}
      </li>`).join('')}</ul>${rows.length > M8.limit ? `<button type="button" class="more-btn" id="ksMore">Xem thêm (${fmt(rows.length - M8.limit)})</button>` : ''}`
      : emptyHtml('Không có lô nào khớp', 'Thử số lô hoặc ngày khác.');
  }

  // ------------------------------------------------------------------ màn hình Phiếu đã gửi
  const isHuy = (p) => String(p.trangThai || '').trim().startsWith('Lỗi - Đã hủy');
  // Chỉ sửa / xóa được khi PC CHƯA nhận (trạng thái trống hoặc "Chưa xử lý"; "Đang sửa" = lần sửa trước bị dở).
  const phieuEditable = (p) => { const tt = String(p.trangThai || '').trim(); return tt === '' || tt === 'Chưa xử lý' || tt.startsWith('Lỗi - Đang sửa'); };
  // Mốc PC đẩy tồn của ĐÚNG kho chứa phiếu (Meta.lastPushAt_<M01|M01VT|M01VTB|M02|M03|M04>); thiếu thì dùng mốc chung.
  // Trước đây mọi phiếu đều so với mốc chung — mốc này chỉ tiến khi PC đẩy ĐỦ mọi bảng, nên phiếu đã nhận
  // bị kẹt ở \"đang cập nhật tồn\" dù kho của phiếu đó đã được đẩy lại.
  function lastPushOfPhieu(p) {
    const meta = anyMeta();
    const mod = modOf(String(p.module || '').trim());
    return (meta && (meta['lastPushAt_' + mod] || meta.lastPushAt)) || '';
  }
  function phieuStatus(p, lastPushAt) {
    const tt = String(p.trangThai || '').trim();
    if (tt.startsWith('Lỗi - Đang sửa')) return { cls: 'wait', text: 'Đang sửa…' };
    if (tt.startsWith('Lỗi')) return { cls: 'err', text: tt };
    if (tt === 'Đã xử lý') {
      const xl = new Date(p.xuLyLuc).getTime();
      const lp = new Date(lastPushAt).getTime();
      if (xl && lp && xl > lp) return { cls: 'wait', text: 'PC đã nhận, đang cập nhật tồn' };
      return { cls: 'done', text: 'PC đã nhận' };
    }
    return { cls: 'wait', text: 'Đang chờ PC nhận' };
  }

  // ---- Tổng kg CHỈ để HIỂN THỊ trên thẻ phiếu / khung soạn phiếu (không đưa vào dữ liệu gửi đi, không vào file xuất) ----
  // M01VT: kg = SL × T.Lượng (kg/đơn vị). M02: kg = số kiện × (trọng lượng hiện có ÷ số kiện hiện có). Module khác: không có → null.
  function kgPerOf(mod, o) { return mod === 'M01VT' ? num(o && o.tl) : (mod === 'M02' || mod === 'M01') ? num(o && o.kgPer) : 0; }
  function sumKg(mod, list) { // list: [{ qty, per }]
    let kg = 0, miss = 0;
    list.forEach((x) => { if (x.per > 0) kg += x.qty * x.per; else if (x.qty > 0) miss++; });
    return kg > 0 ? { kg, miss } : null;
  }
  function kgText(k) { return k ? `${k.miss ? '≥ ' : '≈ '}${fmtKg(k.kg)} kg` : ''; }
  // Dòng tổng tính TẤN (1 tấn = 1,000 kg), 2 số lẻ — VD "≈ 1,478.63 tấn".
  function tanText(k) { return k && k.kg ? `${k.miss ? '≥ ' : '≈ '}${fmtKg(k.kg / 1000)} tấn` : ''; }
  function phieuKg(p) {
    const mod = modOf(String(p.module || '').trim());
    if (mod !== 'M01VT' && mod !== 'M02' && mod !== 'M01') return null;
    const snap = new Map(((sentDocs[p.id] && sentDocs[p.id].items) || []).map((x) => [x.key, x]));
    const byKey = new Map((state.lots[SRC_OF[mod]] || []).map((l) => [l.key, l]));
    return sumKg(mod, (p.items || []).map((it) => {
      const key = mod === 'M02' ? matchKey(it.maHang, it.soLo, it.size, it.phieuNhap)
        : (mod === 'M01' ? 'M01|' : 'VT|') + String(it.itemKey || '').trim();
      const sn = snap.get(key), lot = byKey.get(key);
      let per = sn ? kgPerOf(mod, sn) : 0;
      if (!(per > 0) && lot) per = kgPerOf(mod, lot.item);
      return { qty: num(it.soLuongXuat), per };
    }));
  }
  function cartKg(cart) {
    return sumKg(cart.module, (cart.items || []).map((it) => ({ qty: num(it.qty), per: kgPerOf(cart.module, it) })));
  }
  function renderPhieu() {
    const list = $('phieuList');
    const meta = $('phieuMeta');
    const src = state.phieu;
    // ---- 4 nhóm: Đang soạn (trên máy) / Chờ PC / Đã nhận / Đã hủy ----
    const g = phieuGroups();
    const soanN = state.cart && state.cart.items.length ? 1 : 0;
    const cnt = { soan: soanN, cho: g.cho.length, nhan: g.nhan.length, huy: g.huy.length };
    Object.keys(cnt).forEach((k) => { const el = $('pc-' + k); if (el) el.textContent = cnt[k] ? String(cnt[k]) : ''; });
    document.querySelectorAll('#phieuSeg [data-pseg]').forEach((b) => b.classList.toggle('is-on', b.dataset.pseg === state.phieuSeg));
    const seg = state.phieuSeg;
    $('onlyMine').closest('.toggle').hidden = seg === 'soan';
    if (seg === 'soan') {
      list.innerHTML = '';
      if (!soanN) {
        $('phieuDraft').innerHTML = '';
        meta.innerHTML = emptyHtml('Chưa có phiếu đang soạn', 'Vào tab Kho, chạm vào 1 dòng hàng để thêm vào phiếu.');
        return;
      }
      const c = state.cart;
      const tong = c.items.reduce((a, it) => a + num(it.qty), 0);
      meta.textContent = '';
      $('phieuDraft').innerHTML = `<div class="draft-card">
        <div class="dc-top"><div><b>${c.editOf ? 'Đang sửa phiếu ' + esc(c.editOf.maPhieu) : 'Phiếu đang soạn'}</b><div class="lead" style="margin:2px 0 0">${esc(SRC_LABEL[c.module] || '')} · lưu trên máy, chưa gửi</div></div>
          <div style="text-align:right"><div class="qty-num" style="font-size:22px">${fmt(tong)}</div><div class="qty-unit">${fmt(c.items.length)} dòng</div>${kgText(cartKg(c)) ? `<div class="qty-kg">${esc(kgText(cartKg(c)))}</div>` : ''}</div></div>
        <div class="dc-lines">${c.items.slice(0, 6).map((it) => `<div><span>${esc(noTpc(it.maHang || it.title))}${it.viTri ? ' · ' + esc(shortPlace(it.viTri)) : ''}</span><b>${fmt(num(it.qty))}</b></div>`).join('')}${c.items.length > 6 ? `<div><span>… và ${fmt(c.items.length - 6)} dòng nữa</span></div>` : ''}</div>
        <div class="dc-actions"><button type="button" class="btn btn-ghost" data-draft="kho">+ Thêm hàng</button><button type="button" class="btn btn-primary" data-draft="open">Xem &amp; gửi</button></div>
      </div>`;
      return;
    }
    $('phieuDraft').innerHTML = '';
    if (!src || !src.data) {
      list.innerHTML = '';
      meta.innerHTML = src && src.error ? emptyHtml('Chưa tải được', src.error) : emptyHtml('Đang tải…', '');
      return;
    }
    const lastPush = state.m02 && state.m02.data && state.m02.data.meta && state.m02.data.meta.lastPushAt;
    let rows = g[seg] || [];
    // LỊCH SỬ THEO THÁNG (bản 1.4): nhóm Đã nhận / Đã hủy có ô chọn tháng (theo lúc PC xử lý, chưa có thì lúc tạo).
    // Phiếu quá 90 ngày PC tự chuyển sang tab lưu trữ trên Sheet nên không còn trong danh sách này.
    const monthOf = (p) => { const d = new Date(p.xuLyLuc || p.ngayTao); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    let monthSel = '';
    if (seg === 'nhan' || seg === 'huy') {
      const months = Array.from(new Set(rows.map(monthOf).filter(Boolean))).sort().reverse();
      if (state.phieuMonth && months.indexOf(state.phieuMonth) < 0) state.phieuMonth = '';
      if (months.length > 1 || state.phieuMonth) {
        monthSel = `<select class="px-month" data-pxmonth="1" aria-label="Lọc theo tháng"><option value="">Tất cả tháng</option>${months.map((m) => `<option value="${m}"${m === state.phieuMonth ? ' selected' : ''}>Tháng ${Number(m.slice(5))}/${m.slice(0, 4)} (${fmt(rows.filter((p) => monthOf(p) === m).length)})</option>`).join('')}</select> `;
      }
      if (state.phieuMonth) rows = rows.filter((p) => monthOf(p) === state.phieuMonth);
    }
    const anN = seg === 'nhan' ? g.anNhan + g.cuNhan : seg === 'huy' ? g.anHuy : 0;
    meta.innerHTML = monthSel + `${fmt(rows.length)} phiếu`
      + (seg === 'nhan' && g.cuNhan ? ` · ${fmt(g.cuNhan)} phiếu thuộc tồn kho cũ đã ẩn` : '')
      + (anN ? ` · ${seg === 'nhan' && g.cuNhan && !g.anNhan ? '' : 'đã ẩn ' + fmt(anN) + ' '}<button type="button" class="linkbtn" data-anshow="1">hiện lại</button>` : '')
      + (state.showHidden && (seg === 'nhan' || seg === 'huy') ? ` · <button type="button" class="linkbtn" data-anshow="0">thôi hiện phiếu đã ẩn</button>` : '')
      + (seg === 'nhan' && rows.some((p) => !hiddenPhieu[p.id]) ? ` · <button type="button" class="linkbtn" data-anall="nhan">ẩn tất cả</button>` : '');
    if (!rows.length) {
      list.innerHTML = '';
      if (anN) return;
      meta.innerHTML = emptyHtml({ cho: 'Không có phiếu chờ PC', nhan: 'Chưa có phiếu PC đã nhận', huy: 'Không có phiếu đã hủy' }[seg],
        { cho: 'Phiếu vừa gửi sẽ nằm ở đây cho tới khi PC bấm đồng bộ và nhận phiếu.', nhan: 'Phiếu PC đã nhận (đã trừ tồn) sẽ hiện ở đây.', huy: 'Phiếu bạn xóa trên điện thoại hoặc bị lỗi sẽ hiện ở đây.' }[seg]);
      return;
    }
    list.innerHTML = rows.map((p) => {
      const st = phieuStatus(p, lastPushOfPhieu(p));
      const id = 'px:' + p.id;
      const open = !!state.open[id];
      const tong = (p.items || []).reduce((s, it) => s + num(it.soLuongXuat), 0);
      return `<li class="row">
        <button type="button" class="row-btn" data-open="${esc(id)}" aria-expanded="${open}">
          <div>
            <div class="row-title">${esc(p.maPhieu)}</div>
            <div class="row-sub">
              <span>${esc(fmtTime(p.ngayTao))}</span>
              <span>${esc(SRC_LABEL[modOf(String(p.module || '').trim())])}</span>
              ${p.nguoiTao ? `<span>${esc(p.nguoiTao)}</span>` : ''}
              <span class="status ${st.cls}">${esc(st.text)}</span>${seg === 'nhan' && isOldPeriod(p, anyMeta()) ? '<span class="status">thuộc tồn kho cũ</span>' : ''}
            </div>
          </div>
          <div class="qty"><div class="qty-num">${fmt(tong)}</div><div class="qty-unit">${modOf(String(p.module || '').trim()) === 'M02' ? 'kiện' : 'SL'} · ${fmt((p.items || []).length)} dòng</div>${kgText(phieuKg(p)) ? `<div class="qty-kg">${esc(kgText(phieuKg(p)))}</div>` : ''}</div>
        </button>
        ${open ? `<dl class="details">
          ${p.ghiChu ? `<dt>Ghi chú</dt><dd>${esc(p.ghiChu)}</dd>` : ''}
          <dt></dt><dd><button type="button" class="btn btn-ghost" data-export="${esc(p.id)}" style="min-height:44px;font-size:15px;margin:4px 0">📄 Xuất file (PDF / Excel / Ảnh)</button></dd>
          ${phieuEditable(p) && canEditPhieu(p)
            ? `<dt></dt><dd><button type="button" class="btn btn-ghost" data-edit="${esc(p.id)}" style="min-height:44px;font-size:15px;margin:4px 0">✏️ Sửa phiếu</button><button type="button" class="btn btn-danger" data-huy="${esc(p.id)}" style="min-height:44px;font-size:15px;margin:2px 0 4px">🗑 Xóa phiếu</button></dd>`
            : phieuEditable(p) ? `<dt></dt><dd style="color:var(--muted);font-size:13.5px">${canCreate() ? 'Phiếu của người khác — chỉ người tạo hoặc quản lý mới sửa / xóa được.' : 'Phiếu đang chờ PC nhận. Cần sửa / xóa: báo người quản lý.'}</dd>`
            : (seg === 'huy'
              ? `<dt></dt><dd style="color:var(--muted);font-size:13.5px">Phiếu đã hủy — không còn giữ hàng; PC sẽ bỏ qua phiếu này.</dd>`
              : `<dt></dt><dd style="color:var(--muted);font-size:13.5px">Phiếu đã vào PC nên không sửa/xóa được trên điện thoại. Xem / hủy trên PC: ${esc(SRC_DEST[modOf(String(p.module || '').trim())])}.</dd>`)
              + `<dt></dt><dd>${hiddenPhieu[p.id]
                ? `<button type="button" class="btn btn-ghost" data-unhide="${esc(p.id)}" style="min-height:44px;font-size:15px;margin:2px 0 4px">👁 Bỏ ẩn phiếu này</button>`
                : `<button type="button" class="btn btn-ghost" data-an="${esc(p.id)}" style="min-height:44px;font-size:15px;margin:2px 0 4px">🙈 Ẩn khỏi danh sách (chỉ trên máy này)</button>`}</dd>`}
          ${(p.items || []).map((it) => `<dt>${esc(fmt(num(it.soLuongXuat)))}</dt><dd>${it.viTri ? '[' + esc(shortPlace(it.viTri)) + '] ' : ''}${esc(noTpc(['M01VT', 'M01VTB'].includes(modOf(String(p.module || '').trim())) ? (it.maHang || it.tenHang) : (it.tenHang || it.maHang)))}${it.soLo && modOf(String(p.module || '').trim()) !== 'M01VT' ? (modOf(String(p.module || '').trim()) === 'M03' ? ' — LSX ' : modOf(String(p.module || '').trim()) === 'M04' ? ' — ' : modOf(String(p.module || '').trim()) === 'M01VTB' ? ' — NSX ' : ' — lô ') + esc(it.soLo) : ''}${it.hopDong ? ' — HĐ ' + esc(it.hopDong) : ''}${it.size !== '' && it.size !== undefined ? ', size ' + esc(it.size) : ''}</dd>`).join('')}
        </dl>` : ''}
      </li>`;
    }).join('');
  }

  // ------------------------------------------------------------------ thanh phiếu đang soạn
  function renderCartBar() {
    const bar = $('cartBar');
    if (!canCreate() || !state.cart || !state.cart.items.length || (state.tab !== 'xuat' && state.tab !== 'home')
      || (state.multi.on && state.tab === 'xuat')) { bar.hidden = true; return; }
    const tong = state.cart.items.reduce((s, it) => s + num(it.qty), 0);
    $('cartBarText').innerHTML = `${state.cart.editOf ? 'Đang sửa phiếu <b>' + esc(state.cart.editOf.maPhieu) + '</b>' : 'Phiếu ' + esc(SRC_LABEL[state.cart.module])}: <b>${fmt(state.cart.items.length)} dòng</b>, SL ${fmt(tong)}`;
    bar.hidden = false;
  }

  function renderAll() {
    renderFreshness();
    if (state.tab === 'home') renderHome();
    if (state.tab === 'xuat') renderXuat();
    if (state.tab === 'phieu') renderPhieu();
    if (state.tab === 'm8') renderM8();
    if (state.tab === 'baocao') renderBaoCao();
    if (state.tab !== 'xuat') updateTotalBar(null);
    renderCartBar();
    renderMultiBar();
    renderNavBadge();
  }

  // ------------------------------------------------------------------ bảng trượt
  let sheetOnClose = null;
  function openSheet(html, onClose) {
    $('sheetBody').onclick = null;
    $('sheetBody').onchange = null;
    $('sheetBody').innerHTML = html;
    $('scrim').hidden = false;
    $('sheet').hidden = false;
    sheetOnClose = onClose || null;
    const first = $('sheet').querySelector('[autofocus]');
    if (first) setTimeout(() => first.focus(), 60);
  }
  function closeSheet() {
    $('scrim').hidden = true;
    $('sheet').hidden = true;
    $('sheetBody').innerHTML = '';
    const cb = sheetOnClose; sheetOnClose = null;
    if (cb) cb();
  }

  // Chọn số lượng cho 1 lô
  // Chạm 1 dòng hàng → xem ĐỦ thông tin + nhập số lượng xuất (thay cho nút + riêng ở mỗi dòng).
  // Dòng hết hàng / khác kho với phiếu đang soạn vẫn mở để XEM, chỉ khóa phần xuất.
  function openQtySheet(lot) {
    const src = SRC_OF[lot.module] || state.xuatSrc;
    const d = state[src] && state[src].data;
    const headers = (d && d.headers) || [];
    const facts = (lot.sizeTag ? [['Size (theo mã)', lot.sizeTag]] : []).concat(lot.facts0 || []).concat(lot.raw ? headers.map((h, i) => [h, lot.raw[i]]).filter(([h, v]) => !isHiddenCol(h) && v !== '' && v !== null && v !== undefined) : []);
    const daSoan = cartQty(lot.key);
    const otherKho = state.cart && state.cart.items.length && state.cart.module !== lot.module;
    // Lô Module 03 có kg/kiện: nhập theo KIỆN nguyên (như form "Xuất sử dụng" trên PC), quy ra kg.
    const factor = lot.pack > 0 ? lot.pack : 1;
    const unitIn = lot.pack > 0 ? 'kiện' : lot.unit;
    const max = lot.pack > 0 ? Math.floor(Math.max(lot.con - daSoan, 0) / factor + 1e-9) : Math.max(lot.con - daSoan, 0);
    const conLay = Math.max(lot.con - daSoan, 0);
    const start = Math.min(1, max);
    const canAdd = canCreate() && !otherKho && max > 0;
    const why = !canCreate() ? 'Mã truy cập của bạn chỉ được xem tồn kho, không tạo phiếu.' : otherKho ? `Phiếu đang soạn thuộc ${SRC_LABEL[state.cart.module]}. Gửi hoặc hủy phiếu đó (tab Phiếu) trước khi xuất từ ${KHO[src].name}.`
      : daSoan && max <= 0 ? 'Dòng này đã đưa hết số còn lại vào phiếu đang soạn.' : max <= 0 ? 'Dòng này đã hết hàng để xuất.' : '';
    openSheet(`
      <h2>${esc(noTpc(lot.title))}</h2>
      <p class="lead">${esc(KHO[src].name)} · ${esc(KHO[src].mod)}</p>
      <dl class="facts">${facts.map(([h, v]) => `<div><dt>${esc(h)}</dt><dd>${esc(noTpc(typeof v === 'number' ? fmt(v) : v))}</dd></div>`).join('')}</dl>
      ${canCreate() ? `<div class="q3">
        <div><small>Tồn trên PC</small><b>${fmt(lot.soKien)}</b></div>
        <div class="q-wait"><small>Chờ PC${daSoan ? ' + đang soạn' : ''}</small><b>− ${fmt(lot.cho + daSoan)}</b></div>
        <div class="q-con"><small>Còn lấy được</small><b>${fmt(conLay)}</b></div>
      </div>` : ''}
      ${canAdd ? `
      <div class="stepper">
        <button type="button" data-step="-1" aria-label="Bớt 1">−</button>
        <input type="number" id="qtyInput" inputmode="decimal" min="0" max="${max}" value="${start}" aria-label="Số lượng xuất (${esc(unitIn)})">
        <button type="button" data-step="1" aria-label="Thêm 1">+</button>
      </div>
      <p class="lead" style="margin:-4px 0 10px;text-align:center">${esc(unitIn)}${lot.pack > 0 ? ` · ${fmt(lot.pack)} kg/kiện` : ''} · tối đa ${fmt(max)}</p>
      <div class="quick">
        ${max >= 10 ? '<button type="button" data-set="10">10</button>' : ''}
        ${max >= 50 ? '<button type="button" data-set="50">50</button>' : ''}
        <button type="button" data-set="${max}">Lấy hết ${fmt(max)}</button>
      </div>
      <div class="notice err" id="qtyErr" hidden></div>
      <button type="button" class="btn btn-primary" id="qtyAdd">Thêm vào phiếu</button>` : (canCreate() ? `<div class="notice err">${esc(why)}</div>` : '')}
      <button type="button" class="btn btn-ghost" data-close>Đóng</button>
    `);
    const input = $('qtyInput');
    const addBtn = $('qtyAdd');
    const syncLabel = () => { if (addBtn) addBtn.textContent = `Thêm ${fmt(num(input.value))} ${unitIn} vào phiếu`; };
    if (input) { input.addEventListener('input', syncLabel); syncLabel(); }
    $('sheetBody').onclick = (e) => {
      const step = e.target.closest('[data-step]');
      const set = e.target.closest('[data-set]');
      if (step && input) { input.value = Math.min(max, Math.max(0, num(input.value) + Number(step.dataset.step))); syncLabel(); }
      if (set && input) { input.value = set.dataset.set; syncLabel(); }
      if (e.target.closest('[data-close]')) closeSheet();
      if (e.target.id === 'qtyAdd') {
        const nhap = num(input.value);
        const err = $('qtyErr');
        if (!(nhap > 0)) { err.textContent = 'Nhập số lượng lớn hơn 0.'; err.hidden = false; return; }
        if (lot.pack > 0 && !Number.isInteger(nhap)) { err.textContent = 'Số kiện phải là số nguyên.'; err.hidden = false; return; }
        if (nhap > max) { err.textContent = `Chỉ còn lấy được ${fmt(max)} ${unitIn}.`; err.hidden = false; return; }
        const qty = nhap * factor;
        if (!state.cart || !state.cart.items.length) state.cart = { id: newId(), module: lot.module, ghiChu: '', items: [] };
        const existing = state.cart.items.find((it) => it.key === lot.key);
        if (existing) existing.qty = num(existing.qty) + qty;
        else state.cart.items.push(Object.assign({ key: lot.key, title: lot.title, subs: lot.subs, unit: lot.unit }, lot.item, { qty }));
        saveCart();
        closeSheet();
        renderAll();
        toast(`Đã thêm ${fmt(nhap)} ${unitIn} vào phiếu.`);
      }
    };
  }

  // Tổng số kg của cả 1 kho (cho thẻ Kho / bảng chọn kho). M03 vốn đã tính bằng kg (cột "Tổng (kg)")
  // nên cộng thẳng "con"; M01/M02/vitri/M04 nhân "con" với trọng lượng/đơn vị của từng dòng
  // (M01: kgPer = Tồn cuối (NET) × Trọng lượng ÷ Tồn cuối — khớp "Tổng KL (kg)" trên PC).
  const KHO_KG_PER = { m01: (it) => num(it.kgPer), m02: (it) => num(it.kgPer), vitri: (it) => num(it.tl), m04: (it) => num(it.weight) };
  function khoTotalKg(k) {
    const lots = state.lots[k] || [];
    if (!lots.length) return null;
    if (k === 'm03') {
      const kg = lots.reduce((a, l) => a + Math.max(l.con, 0), 0);
      return kg > 0 ? { kg, miss: 0 } : null;
    }
    // Tồn kho An An / Tồn kho gửi: tính ĐÚNG như PC — cộng kg của MỌI dòng (kể cả dòng số kiện 0 / âm, PC vẫn
    // cộng) rồi trừ phần "chờ PC" (phiếu điện thoại PC chưa nhận). Trước 3.44 bỏ qua dòng số kiện ≤ 0 và
    // làm tròn âm về 0 nên lệch với PC.
    if (k === 'm01' || k === 'm02') {
      let kg = 0;
      lots.forEach((l) => { const it = l.item || {}; kg += num(it.rawKg) - (l.cho > 0 ? l.cho * num(it.kgPer) : 0); });
      return kg ? { kg, miss: 0 } : null;
    }
    const perOf = KHO_KG_PER[k];
    if (!perOf) return null;
    return sumKg('KHOTILE', lots.map((l) => ({ qty: Math.max(l.con, 0), per: perOf(l.item || {}) })));
  }
  // Bảng chọn kho (thay hàng 5 nút vuốt ngang): tổng còn, số dòng, giờ PC cập nhật, số dòng chờ PC.
  function khoSummary(k) {
    const lots = state.lots[k] || [];
    const loaded = !!(state[k] && state[k].data);
    const unit = commonUnit(lots.map((l) => l.unit));
    return {
      loaded, rows: lots.length, unit,
      con: lots.reduce((a, l) => a + Math.max(l.con, 0), 0),
      cho: lots.filter((l) => l.cho > 0).length,
      kg: loaded && unit !== 'kg' ? khoTotalKg(k) : null,
      date: loaded ? dataDateIn(state[k].data.meta, k) : '',
      at: loaded ? stampIn(state[k].data.meta, k) : ''
    };
  }
  function openKhoPicker() {
    openSheet(`
      <h2>Chọn kho</h2>
      <p class="lead">Xem tồn và xuất hàng trong cùng một màn hình. Kho đã tải được lưu trên máy.</p>
      ${SOURCES.length > 1 ? (() => {
        const n = SOURCES.filter((k) => state[k] && state[k].data).length;
        const rows = SOURCES.reduce((a, k) => a + (state.lots[k] || []).length, 0);
        const on = state.xuatSrc === 'tong';
        return `<button type="button" class="kho-opt${on ? ' is-on' : ''}" data-kho="tong">
          <span class="ko-mark">${on ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>' : ''}</span>
          <span class="ko-body">
            <span class="ko-head"><b class="ko-name">Tổng — tất cả kho</b><small class="ko-qty">${fmt(rows)} dòng</small></span>
            <small class="ko-sub">Tìm mã / size / vị trí trong mọi kho cùng lúc · ${n}/${SOURCES.length} kho đã lưu</small>
          </span>
        </button>`;
      })() : ''}
      ${SOURCES.map((k) => {
        const m = khoSummary(k);
        return `<button type="button" class="kho-opt${k === state.xuatSrc ? ' is-on' : ''}" data-kho="${k}">
          <span class="ko-mark">${k === state.xuatSrc ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>' : ''}</span>
          <span class="ko-body">
            <span class="ko-head"><b class="ko-name">${esc(KHO[k].name)}</b>${m.loaded ? `<b class="ko-qty">${fmt(m.con)}${m.unit ? ' <small>' + esc(m.unit) + '</small>' : ''}</b>` : '<small class="ko-qty">chưa tải</small>'}</span>
            <small class="ko-sub">${esc(KHO[k].mod)} · ${esc(KHO[k].desc)}</small>
            ${m.loaded && kgText(m.kg) ? `<span class="ko-kg"><b class="qty-kg">${esc(kgText(m.kg))}</b><b class="qty-tan">${esc(tanText(m.kg))}</b></span>` : ''}
            ${m.loaded ? `<span class="ko-meta">${fmt(m.rows)} dòng${m.date ? ' · số liệu ' + esc(shortDate(m.date)) : ''}${m.at ? ' · PC ' + esc(fmtTime(m.at)) : ''}${m.cho ? ` <span class="pill wait">${fmt(m.cho)} chờ PC</span>` : ''}</span>` : ''}
          </span>
        </button>`;
      }).join('')}
      <button type="button" class="btn btn-ghost" data-close style="margin-top:10px">Đóng</button>
    `);
    $('sheetBody').onclick = (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const b = e.target.closest('[data-kho]');
      if (!b) return;
      closeSheet();
      selectKho(b.dataset.kho);
    };
  }
  function selectKho(k) {
    if (k !== 'tong' && !SOURCES.includes(k)) return;
    if (state.multi && state.multi.on && k !== state.xuatSrc) setMulti(false, true); // đổi kho → bỏ các dòng đã chọn
    state.xuatSrc = k;
    save('klanan.xuatSrc', k);
    state.limit.xuat = PAGE;
    if (state.tab !== 'xuat') switchTab('xuat'); else { renderAll(); autoRefresh(); }
  }

  // ------------------------------------------------------------------ Trang chủ
  // Mốc "nạp tồn kho mới" trên PC của từng kho (Meta do main.js ghi): phiếu PC nhận (xuLyLuc) trước mốc
  // này là của kỳ tồn CŨ. M03/M04 là sổ nhập–xuất cộng dồn (không nạp lại cả kho) nên không áp dụng.
  const IMPORT_AT_KEY = { M02: 'm02ImportedAt', M01: 'm01ImportedAt', M01VT: 'm01ViTriImportedAt', M01VTB: 'm01ViTriBotImportedAt' };
  function anyMeta() {
    for (const k of ['m02', 'm01', 'vitri', 'vitribot', 'm03', 'm04', 'm08']) { const m = state[k] && state[k].data && state[k].data.meta; if (m) return m; }
    return {};
  }
  function isOldPeriod(p, meta) {
    const key = IMPORT_AT_KEY[modOf(String(p.module || '').trim())];
    const imp = key && new Date(meta[key]).getTime();
    const xl = new Date(p.xuLyLuc || p.ngayTao).getTime();
    return !!(imp && xl && xl < imp);
  }
  function phieuGroups() {
    const list = (state.phieu && state.phieu.data && state.phieu.data.list) || [];
    const myId = String(state.cfg.user || '').trim().toLowerCase();
    const isMine = (p) => (p.nguoiDung && myId) ? String(p.nguoiDung).trim().toLowerCase() === myId : String(p.nguoiTao || '') === state.cfg.name;
    const mine = state.cfg.name && $('onlyMine') && $('onlyMine').checked ? list.filter(isMine) : list;
    const lastPush = state.m02 && state.m02.data && state.m02.data.meta && state.m02.data.meta.lastPushAt;
    const g = { cho: [], nhan: [], huy: [], anNhan: 0, anHuy: 0, cuNhan: 0 };
    const meta = anyMeta();
    mine.forEach((p) => {
      const grp = isHuy(p) ? 'huy' : (() => { const st = phieuStatus(p, lastPushOfPhieu(p)); return st.cls === 'done' ? 'nhan' : st.cls === 'err' ? 'huy' : 'cho'; })();
      // Phiếu PC đã nhận TRƯỚC lần nạp tồn kho mới trên PC → thuộc số liệu CŨ (tồn mới đã tính rồi) → tự ẩn.
      if (grp === 'nhan' && !state.showHidden && isOldPeriod(p, meta)) { g.cuNhan++; return; }
      // Chỉ phiếu Đã nhận / Đã hủy mới ẩn được (phiếu đang chờ vẫn giữ hàng → luôn hiện).
      if (grp !== 'cho' && hiddenPhieu[p.id]) { if (!state.showHidden) { g[grp === 'nhan' ? 'anNhan' : 'anHuy']++; return; } }
      g[grp].push(p);
    });
    const today = new Date().toDateString();
    g.nhanHomNay = g.nhan.filter((p) => new Date(p.xuLyLuc || p.ngayTao).toDateString() === today).length;
    return g;
  }
  function renderNavBadge() {
    const b = $('navBadge');
    if (!b) return;
    const n = phieuGroups().cho.length;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  }
  // ĐẾM NGÀY SỐ LIỆU (bản 1.7, mẫu A — giống trang chính PC): "● 01/10 · hôm qua" dưới tên kho.
  // Màu: xanh lá = hôm nay / hôm qua · cam = 2–3 ngày · đỏ = từ 4 ngày (số liệu cũ, nên đẩy bản mới từ PC).
  function ageBadge(dateText) {
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(dateText || ''));
    if (!m) return '';
    const d = new Date(+m[3], +m[2] - 1, +m[1]), t = new Date(); t.setHours(0, 0, 0, 0);
    const days = Math.round((t - d) / 86400000);
    const ago = days <= 0 ? 'hôm nay' : days === 1 ? 'hôm qua' : days + ' ngày';
    const tone = days <= 1 ? 'ok' : days <= 3 ? 'warn' : 'old';
    const tip = 'Số liệu ngày ' + m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3] + (days >= 2 ? ' — đã ' + days + ' ngày, nên đẩy bản mới từ PC' : '');
    return `<span class="kt-age ${tone}" title="${esc(tip)}"><i></i>${esc(m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0'))} · ${esc(ago)}</span>`;
  }
  function renderHome() {
    const g = phieuGroups();
    const soan = state.cart && state.cart.items.length ? state.cart.items.length : 0;
    $('homeTodoTitle').hidden = $('homeTodo').hidden = !canCreate(); // token chỉ xem: không có việc phiếu
    $('homeTodo').innerHTML = `
      <button type="button" class="todo t-soan" data-goseg="soan"><b>${fmt(soan)}</b><span>${soan ? 'dòng đang soạn' : 'Phiếu đang soạn'}</span></button>
      <button type="button" class="todo t-cho" data-goseg="cho"><b>${fmt(g.cho.length)}</b><span>Chờ PC nhận</span></button>
      <button type="button" class="todo t-nhan" data-goseg="nhan"><b>${fmt(g.nhanHomNay)}</b><span>PC nhận hôm nay</span></button>`;
    $('homeKho').innerHTML = SOURCES.map((k) => {
      const m = khoSummary(k);
      return `<button type="button" class="kho-tile${m.loaded ? '' : ' is-empty'}" data-kho="${k}">
        <span class="kt-top"><b>${esc(KHO[k].name)}</b><small>${esc(KHO[k].mod.replace('Module ', 'M'))}</small></span>
        ${m.loaded ? ageBadge(m.date) : ''}
        ${m.loaded ? `<span class="kt-num">${fmt(m.con)}${m.unit ? ' <small>' + esc(m.unit) + '</small>' : ''}</span><span class="kt-sub">${fmt(m.rows)} dòng</span>${kgText(m.kg) ? `<span class="qty-kg">${esc(kgText(m.kg))}</span><span class="qty-tan">${esc(tanText(m.kg))}</span>` : ''}`
          : '<span class="kt-num">Chưa tải</span><span class="kt-sub">chạm để mở kho</span>'}
        ${m.cho ? `<span class="pill wait">${fmt(m.cho)} dòng chờ PC</span>` : ''}
      </button>`;
    }).join('') + `<button type="button" class="kho-tile kt-tracuu" data-gotab="m8"${canView('m08') ? '' : ' hidden'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        <b>Tra cứu kháng sinh</b><span class="kt-sub">Kiểm tra kết quả · Quy định · Lô đã kiểm</span></button>`;
    renderHomeSearch();
  }
  // Tổng số lượng + KL của 1 tập dòng [kho, dòng] (Trang chủ › tìm, Kho › Tổng):
  //  - cộng RIÊNG theo đơn vị (SL, kiện, kg…; không phân biệt hoa/thường), không cộng lẫn đơn vị khác nhau;
  //  - số lượng = còn lại sau phiếu đang soạn (giống cột SL từng dòng);
  //  - KHÔNG cộng trùng: dòng "Tồn kho An An" (m01) có mã cũng có trong "Tồn vị trí" (vitri) là CÙNG 1 hàng →
  //    chỉ cộng bên Tồn vị trí (GIỐNG quy tắc popup "Tìm trong toàn kho" trên PC).
  function totalsOf(pairs) {
    const vtCodes = new Set((state.lots.vitri || []).map((l) => noTpc((l.item || {}).maHang || '').toUpperCase()).filter(Boolean));
    const units = new Map();
    let kg = 0, skipped = 0;
    pairs.forEach(([k, l]) => {
      if (k === 'm01' && vtCodes.has(noTpc((l.item || {}).maHang || '').toUpperCase())) { skipped++; return; }
      const q = l.con - cartQty(l.key);
      const u = String(l.unit || '').trim();
      const key = u.toLowerCase();
      const cur = units.get(key) || [u, 0];
      cur[1] += q; units.set(key, cur);
      if (k === 'm03') kg += Math.max(q, 0);
      else if (KHO_KG_PER[k]) kg += Math.max(q, 0) * (KHO_KG_PER[k](l.item || {}) || 0);
    });
    return { units: [...units.values()], kg: Math.round(kg * 100) / 100, skipped };
  }
  // Tìm mã trong TẤT CẢ kho đã lưu trên máy (không tải thêm gì) — hiện tối đa 40 dòng, kèm tên kho.
  function renderHomeSearch() {
    const box = $('homeResults');
    const qs = norm(state.q.home || '').trim().split(/\s+/).filter(Boolean);
    $('homeMain').hidden = qs.length > 0;
    if (!qs.length) { box.innerHTML = ''; return; }
    const hits = [];
    SOURCES.forEach((k) => { const lotHit = makeLotMatch(qs, state.lots[k]); (state.lots[k] || []).forEach((l) => { if (lotHit(l)) hits.push([k, l]); }); });
    const missing = SOURCES.filter((k) => !(state[k] && state[k].data)).map((k) => KHO[k].name);
    setRowColWidths(box, hits.slice(0, 40));
    // Tổng số lượng của TẤT CẢ dòng khớp (không chỉ 40 dòng đang hiện) — cộng riêng theo đơn vị (SL, kiện, kg…),
    // không cộng lẫn; kèm tổng KL nếu tính được. Số lượng = còn lại sau phiếu đang soạn (giống cột SL của từng dòng).
    const T = totalsOf(hits);
    const sumHtml = hits.length ? `<div class="home-sum">
        <div class="hs-cell"><small>Tổng số lượng</small><b>${T.units.map(([u, q]) => `${fmt(Math.round(q * 100) / 100)}${u ? ' <small>' + esc(u) + '</small>' : ''}`).join('<span class="hs-sep"> + </span>')}</b></div>
        ${T.kg > 0 ? `<div class="hs-cell"><small>Tổng KL</small><b>≈ ${esc(fmtKg(T.kg))} <small>kg</small></b></div>` : ''}
        ${T.skipped ? `<p class="hs-note">Không cộng ${fmt(T.skipped)} dòng Tồn kho An An trùng mã với Tồn vị trí (cùng 1 hàng).</p>` : ''}
      </div>` : '';
    box.innerHTML = `<div class="home-hint">${fmt(hits.length)} dòng khớp trong các kho đã lưu${hits.length > 40 ? ' · hiện 40 dòng đầu' : ''}${missing.length ? ` · chưa tải: ${esc(missing.join(', '))}` : ''}</div>` + sumHtml +
      (hits.length ? `<ul class="list">${hits.slice(0, 40).map(([k, l]) => lotRowHtml(k, l, KHO[k].name)).join('')}</ul>` : emptyHtml('Không tìm thấy', 'Thử vài ký tự cuối của mã hàng, hoặc mở kho chưa tải để tìm trong kho đó.'));
  }

  // Xem / sửa / gửi phiếu đang soạn
  function openCartSheet(message) {
    if (!state.cart || !state.cart.items.length) { closeSheet(); return; }
    const cartSrc = SRC_OF[state.cart.module] || 'm02';
    const byKey = new Map(state.lots[cartSrc].map((l) => [l.key, l]));
    let over = false;
    const itemsHtml = state.cart.items.map((it, i) => {
      const lot = byKey.get(it.key);
      const con = lot ? lot.con : 0;
      const bad = !lot ? 'Dòng này không còn trong tồn kho mới nhất.' : (num(it.qty) > con ? `Chỉ còn ${fmt(con)}.` : '');
      const subs = (it.subs || [['Mã', it.maHang], ['Lô', it.soLo], ['Size', it.size]])
        .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !(state.cart.module === 'M01VT' && k === 'Lô'));
      if (bad) over = true;
      return `<li class="cart-item${bad ? ' is-over' : ''}">
        <div>
          <div class="row-title">${esc(noTpc(it.title || it.tenHang || it.maHang))}</div>
          <div class="row-sub">${subs.map(([k, v]) => `<span>${esc(k)} <b>${esc(noTpc(v))}</b></span>`).join('')}</div>
        </div>
        <div class="ci-qty">
          <input type="number" inputmode="decimal" min="0" value="${esc(it.pack > 0 ? num(it.qty) / it.pack : it.qty)}" data-qty="${i}" aria-label="${it.pack > 0 ? 'Số kiện' : 'Số lượng'}">
          ${it.pack > 0 ? '<small style="color:var(--muted)">kiện</small>' : ''}
          <button type="button" class="ci-remove" data-remove="${i}" aria-label="Bỏ dòng này">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        ${bad ? `<div class="ci-warn">${esc(bad)}</div>` : ''}
      </li>`;
    }).join('');
    const tong = state.cart.items.reduce((s, it) => s + num(it.qty), 0);
    // Module 03: bắt buộc chọn "LSX xuất" (như form Xuất sử dụng trên PC).
    const needLsx = state.cart.module === 'M03';
    const lsxList = (state.m03 && state.m03.data && state.m03.data.lsx) || [];
    if (needLsx && state.cart.lsxXuat && !lsxList.some((l) => l.id === state.cart.lsxXuat)) state.cart.lsxXuat = '';
    const missLsx = needLsx && !state.cart.lsxXuat;
    const lsxField = needLsx ? `<label class="field"><span>LSX xuất (bắt buộc)</span>
        <select id="cartLsx"><option value="">— Chọn LSX —</option>${lsxList.map((l) => `<option value="${esc(l.id)}" ${l.id === state.cart.lsxXuat ? 'selected' : ''}>${esc(l.code)}${l.name ? ' — ' + esc(l.name) : ''}${l.khachHang ? ' (' + esc(l.khachHang) + ')' : ''}</option>`).join('')}</select>
      </label>` : '';
    const ed = state.cart.editOf;
    // Module 02 (Kho gửi): cho phép tự đặt tên phiếu + chọn ngày xuất, thay vì tự sinh mã/lấy giờ hiện tại.
    const isM02 = state.cart.module === 'M02';
    const tenNgayFields = isM02 ? `
      <label class="field"><span>Tên phiếu xuất (không bắt buộc)</span>
        <input type="text" id="cartTen" maxlength="60" placeholder="Để trống sẽ tự đặt mã phiếu" value="${esc(state.cart.tenPhieu || '')}">
      </label>
      <label class="field"><span>Ngày xuất phiếu</span>
        <input type="date" id="cartNgayXuat" value="${esc(state.cart.ngayXuat || todayISO())}">
      </label>` : '';
    openSheet(`
      <h2>${ed ? 'Sửa phiếu ' + esc(ed.maPhieu) : 'Phiếu xuất đang soạn'}</h2>
      <p class="lead">${ed
        ? `Phiếu <b>${esc(SRC_LABEL[state.cart.module])}</b> này PC chưa nhận. Sửa số lượng, bỏ hoặc thêm dòng rồi bấm <b>Lưu thay đổi</b> — PC sẽ nhận bản mới.`
        : `Xuất từ <b>${esc(SRC_LABEL[state.cart.module])}</b>. Gửi xong, PC nhận phiếu vào ${esc(SRC_DEST[state.cart.module])} ở lần đồng bộ kế tiếp và trừ tồn.`}</p>
      ${message ? `<div class="notice ${message.ok ? 'ok' : 'err'}">${esc(message.text)}</div>` : ''}
      <ul class="cart-items">${itemsHtml}</ul>
      <div class="cart-total"><span>Tổng</span><span>${state.cart.module === 'M03' ? fmtKg(tong) + ' kg' : fmt(tong)}${kgText(cartKg(state.cart)) ? `<small class="qty-kg" style="display:block;text-align:right">${esc(kgText(cartKg(state.cart)))}</small>` : ''}</span></div>
      ${lsxField}
      ${tenNgayFields}
      <label class="field"><span>Ghi chú (không bắt buộc)</span>
        <textarea id="cartNote" maxlength="300" placeholder="VD: xe 51C-123.45, giao khách X">${esc(state.cart.ghiChu || '')}</textarea>
      </label>
      <button type="button" class="btn btn-primary" id="cartSend" ${over || missLsx || !state.cfg.name ? 'disabled' : ''}>${ed ? 'Lưu thay đổi' : 'Gửi phiếu'}</button>
      ${missLsx ? '<p class="lead" style="margin-top:8px">Chọn LSX xuất trước khi gửi.</p>' : ''}
      ${!state.cfg.name ? '<p class="lead" style="margin-top:8px">Nhập tên người gửi trong Cài đặt trước khi gửi phiếu.</p>' : ''}
      ${over ? '<p class="lead" style="margin-top:8px">Sửa các dòng báo đỏ trước khi gửi.</p>' : ''}
      <button type="button" class="btn btn-ghost" data-close>Soạn tiếp</button>
      <button type="button" class="btn btn-danger" id="cartClear">${ed ? 'Bỏ chỉnh sửa (giữ phiếu như cũ)' : 'Hủy phiếu đang soạn'}</button>
    `);
    const body = $('sheetBody');
    body.onchange = (e) => {
      if (e.target.matches('[data-qty]')) {
        const i = Number(e.target.dataset.qty);
        const it = state.cart.items[i];
        const v = num(e.target.value) * (it.pack > 0 ? it.pack : 1);
        if (v > 0) it.qty = v; else state.cart.items.splice(i, 1);
        saveCart(); renderAll(); openCartSheet();
      }
      if (e.target.id === 'cartNote') { state.cart.ghiChu = e.target.value; saveCart(); }
      if (e.target.id === 'cartLsx') { state.cart.lsxXuat = e.target.value; saveCart(); openCartSheet(); }
      if (e.target.id === 'cartTen') { state.cart.tenPhieu = e.target.value; saveCart(); }
      if (e.target.id === 'cartNgayXuat') { state.cart.ngayXuat = e.target.value; saveCart(); }
    };
    body.onclick = async (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { state.cart.items.splice(Number(rm.dataset.remove), 1); saveCart(); renderAll(); openCartSheet(); return; }
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      if (e.target.id === 'cartClear') {
        if (confirm(ed ? 'Bỏ các chỉnh sửa? Phiếu trên hệ thống giữ nguyên như cũ.' : 'Hủy toàn bộ phiếu đang soạn?')) { state.cart = null; saveCart(); buildLots(); closeSheet(); renderAll(); }
        return;
      }
      if (e.target.id === 'cartSend') await sendCart(e.target);
    };
  }

  async function sendCart(btn) {
    state.cart.ghiChu = ($('cartNote') || {}).value || '';
    saveCart();
    btn.disabled = true;
    const ed = state.cart.editOf;
    btn.textContent = ed ? 'Đang lưu…' : 'Đang gửi…';
    const srcKey = SRC_OF[state.cart.module] || 'm02';
    // Module 02: nếu người dùng tự đặt tên phiếu thì dùng tên đó làm mã phiếu, không tự sinh mã nữa.
    const tenPhieu = state.cart.module === 'M02' ? String(state.cart.tenPhieu || '').trim() : '';
    const ngayXuat = state.cart.module === 'M02' ? String(state.cart.ngayXuat || '').trim() : '';
    const phieu = {
      id: state.cart.id,                       // giữ nguyên qua các lần bấm gửi lại -> không trùng
      maPhieu: state.cart.maPhieu || (state.cart.maPhieu = (tenPhieu || stamp())),
      ngayXuat,                                 // ngày xuất do người dùng chọn (PC/Sheet hiện chưa lưu cột này)
      nguoiTao: state.cfg.name,
      ghiChu: state.cart.ghiChu,
      module: state.cart.module,
      lsxXuat: state.cart.module === 'M03' ? (state.cart.lsxXuat || '') : '',
      items: state.cart.items.map((it) => (state.cart.module === 'M01'
        ? { itemKey: it.itemKey, rowIndex: it.rowIndex, maHang: it.maHang, tenHang: it.tenHang, size: it.size, hopDong: it.hopDong, soLuongXuat: num(it.qty) }
        : state.cart.module === 'M02'
          ? { maHang: it.maHang, tenHang: it.tenHang, soLo: it.soLo, size: it.size, phieuNhap: it.phieuNhap, soKien: it.soKien, soLuongXuat: num(it.qty) }
          : { itemKey: it.itemKey, maHang: it.maHang, tenHang: it.tenHang, soLo: it.soLo, viTri: it.viTri, soLuongXuat: num(it.qty) }))
    };
    saveCart();
    try {
      const res = await api(ed ? 'suaPhieu' : 'taoPhieu', { phieu });
      // Bản chụp đầy đủ để xuất file đúng mẫu (Sheet chỉ lưu các cột chính).
      const lsxObj = ((state.m03 && state.m03.data && state.m03.data.lsx) || []).find((l) => l.id === phieu.lsxXuat);
      // Ngày xuất người dùng chọn (nếu có) được ưu tiên dùng làm ngày của phiếu trên điện thoại này
      // (để xuất file / hiển thị đúng ngày thực xuất hàng, thay vì giờ bấm gửi tự động).
      const ngayXuatIso = ngayXuat ? new Date(ngayXuat + 'T12:00:00').toISOString() : '';
      const doc = {
        id: phieu.id, maPhieu: res.maPhieu || phieu.maPhieu, module: phieu.module, ngayTao: ngayXuatIso || (ed && ed.ngayTao) || new Date().toISOString(),
        nguoiTao: (ed && ed.nguoiTao) || phieu.nguoiTao, ghiChu: phieu.ghiChu, lsxXuatLabel: lsxObj ? lsxObj.code + (lsxObj.name ? ' — ' + lsxObj.name : '') : '',
        items: state.cart.items.map((it) => Object.assign({}, it, { subs: undefined }))
      };
      rememberSent(doc);
      state.cart = null;
      saveCart();
      if (ed) {
        buildLots();   // bỏ phần "cộng trả" của phiếu vừa sửa
        refresh(['phieu', srcKey]);
        openExportSheet(doc, `Đã lưu thay đổi phiếu ${doc.maPhieu}. Xuất lại file phiếu?`);
        return;
      }
      refresh(['phieu']);
      checkUpdates(true); // cập nhật "chờ PC" từ Web App, không tải lại cả bảng
      openExportSheet(doc, `Đã gửi phiếu ${doc.maPhieu}. Xuất file phiếu ngay trên điện thoại?`);
    } catch (e) {
      if (ed && (e.code === 'DA_XU_LY' || e.code === 'NOT_FOUND')) {
        // PC vừa nhận phiếu (hoặc phiếu không còn): bỏ bản đang sửa, tải lại để thấy đúng trạng thái.
        state.cart = null; saveCart(); buildLots(); closeSheet(); renderAll();
        toast(e.message, true);
        refresh(['phieu', srcKey]);
        return;
      }
      if (e.code === 'THIEU_HANG') {
        const k = SRC_OF[state.cart.module] || 'm02';
        try { await fetchInto(k, ACTION[k]); buildLots(); renderAll(); } catch (e2) { /* giữ số cũ */ }
      }
      openCartSheet({ ok: false, text: (ed ? 'Chưa lưu được. ' : 'Chưa gửi được. ') + e.message + (e.code === 'THIEU_HANG' ? '' : ed ? '\nChỉnh sửa vẫn được giữ trên máy — bấm Lưu thay đổi lại khi có mạng.' : '\nPhiếu vẫn được giữ trên máy — bấm Gửi phiếu lại khi có mạng.') });
    }
  }

  // ================================================================ SỬA / XÓA PHIẾU CHƯA ĐƯỢC PC NHẬN
  const findPhieu = (id) => ((state.phieu && state.phieu.data && state.phieu.data.list) || []).find((x) => String(x.id) === String(id));
  const LOT_PREFIX = { M01: 'M01|', M01VT: 'VT|', M01VTB: 'M01VTB|', M03: 'M03|', M04: 'M04|' };

  // Nạp phiếu vào khung "đang soạn" ở chế độ sửa (giữ nguyên id/mã phiếu; Web App thay toàn bộ dòng hàng).
  async function startEditPhieu(id) {
    const p0 = findPhieu(id);
    if (!p0) return;
    if (!canEditPhieu(p0)) { toast('Chỉ sửa được phiếu do chính bạn tạo.', true); return; }
    if (state.cart && state.cart.items.length && !(state.cart.editOf && state.cart.editOf.id === id)
        && !confirm(`Đang soạn một phiếu khác. Bỏ phiếu đang soạn để sửa phiếu ${p0.maPhieu}?`)) return;
    const module = modOf(String(p0.module || '').trim());
    const srcKey = SRC_OF[module];
    if (!SOURCES.includes(srcKey)) { toast(`Kho ${KHO[srcKey] ? KHO[srcKey].name : module} không dùng được trên tài khoản này — không sửa được phiếu này (vẫn xóa được).`, true); return; }
    toast('Đang kiểm tra phiếu…');
    try { await Promise.all([fetchInto('phieu', ACTION.phieu), fetchInto(srcKey, ACTION[srcKey])]); }
    catch (e) { toast('Chưa tải được số liệu mới nhất: ' + e.message, true); return; }
    const p = findPhieu(id);
    if (!p) { toast('Không thấy phiếu này trên Google Sheet.', true); renderAll(); return; }
    if (!phieuEditable(p)) { toast('PC vừa nhận phiếu này — không sửa được từ điện thoại.', true); buildLots(); renderAll(); return; }
    buildLots(); buildTonRows(srcKey);
    const byKey = new Map((state.lots[srcKey] || []).map((l) => [l.key, l]));
    const orig = {};
    const items = (p.items || []).map((it) => {
      const key = module === 'M02' ? matchKey(it.maHang, it.soLo, it.size, it.phieuNhap) : LOT_PREFIX[module] + String(it.itemKey || '').trim();
      const qty = num(it.soLuongXuat);
      orig[key] = (orig[key] || 0) + qty;
      const lot = byKey.get(key);
      if (lot) return Object.assign({ key, title: lot.title, subs: lot.subs, unit: lot.unit }, lot.item, { qty });
      // Dòng này không còn trong tồn mới nhất: vẫn hiện để người dùng thấy và bỏ đi (khung soạn sẽ báo đỏ).
      return { key, title: it.tenHang || it.maHang, subs: module === 'M01VT' ? [['Mã', it.maHang]] : [['Mã', it.maHang], ['Lô', it.soLo]], unit: '', itemKey: it.itemKey,
        maHang: it.maHang, tenHang: it.tenHang, soLo: it.soLo, size: it.size, phieuNhap: it.phieuNhap, viTri: it.viTri, hopDong: it.hopDong, qty };
    });
    state.cart = { id: p.id, module, ghiChu: String(p.ghiChu || ''), lsxXuat: String(p.lsxXuat || ''), maPhieu: String(p.maPhieu || ''), items,
      editOf: { id: p.id, maPhieu: String(p.maPhieu || ''), ngayTao: p.ngayTao, nguoiTao: p.nguoiTao, orig } };
    saveCart();
    buildLots();                                   // cộng trả số lượng của chính phiếu này vào "còn lấy được"
    state.xuatSrc = srcKey; save('klanan.xuatSrc', srcKey);
    switchTab('xuat');
    openCartSheet();
  }

  async function huyPhieu(id) {
    const p = findPhieu(id);
    if (!p) return;
    if (!canEditPhieu(p)) { toast('Chỉ xóa được phiếu do chính bạn tạo.', true); return; }
    if (!confirm(`Xóa phiếu ${p.maPhieu}?\nPhiếu chưa được PC nhận nên sẽ bị hủy hẳn; số hàng trong phiếu được trả lại tồn khả dụng.`)) return;
    toast('Đang xóa phiếu…');
    let ok = false;
    try {
      await api('huyPhieu', { id: p.id });
      ok = true;
      if (state.cart && state.cart.editOf && state.cart.editOf.id === p.id) { state.cart = null; saveCart(); }
      delete sentDocs[p.id]; save(LS_SENT, sentDocs);
      toast(`Đã xóa phiếu ${p.maPhieu}.`);
    } catch (e) {
      toast(e.message, true);
    }
    await refresh(['phieu', SRC_OF[modOf(String(p.module || '').trim())]]);
    if (!ok) renderPhieu();
  }

  // ================================================================ XUẤT FILE + LƯU / CHIA SẺ
  // Phiếu lấy từ danh sách "Phiếu đã gửi": ưu tiên bản chụp đầy đủ lúc gửi (đúng mẫu nhất); phiếu
  // gửi từ máy khác thì dựng lại từ các cột có trên Google Sheet.
  function docFromSheet(p) {
    if (sentDocs[p.id]) return Object.assign({}, sentDocs[p.id], { maPhieu: p.maPhieu || sentDocs[p.id].maPhieu });
    const module = modOf(String(p.module || '').trim());
    const lsxObj = ((state.m03 && state.m03.data && state.m03.data.lsx) || []).find((l) => l.id === p.lsxXuat);
    return {
      id: p.id, maPhieu: p.maPhieu, module, ngayTao: p.ngayTao, nguoiTao: p.nguoiTao, ghiChu: p.ghiChu,
      lsxXuatLabel: lsxObj ? lsxObj.code : (p.lsxXuat || ''),
      items: (p.items || []).map((it) => ({
        qty: num(it.soLuongXuat), maHang: it.maHang, tenHang: it.tenHang, phieuNhap: it.phieuNhap, soLo: it.soLo, size: it.size,
        viTri: it.viTri, hopDong: it.hopDong, loaiHang: it.tenHang, lsx: it.soLo, type: it.tenHang,
        nsx: module === 'M01VTB' ? it.soLo : '', ghiChu: module === 'M01VTB' ? it.tenHang : ''
      }))
    };
  }

  const Cap = (window.Capacitor && window.Capacitor.Plugins) || {};
  const isNativeApp = !!(Cap.Filesystem && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(new Error('Không đọc được file vừa tạo.'));
      r.readAsDataURL(blob);
    });
  }
  function browserDownload(file) {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  // Lưu vào bộ nhớ máy: Tài liệu (Documents)/KhoLanhAnAn — mở bằng app "Tệp"/"Quản lý file".
  async function saveToPhone(file) {
    if (!isNativeApp) { browserDownload(file); return 'thư mục Tải xuống (Download) của trình duyệt'; }
    const data = await blobToBase64(file.blob);
    const path = 'KhoLanhAnAn/' + file.name;
    try {
      await Cap.Filesystem.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true });
      return 'Bộ nhớ máy › Documents › KhoLanhAnAn › ' + file.name;
    } catch (e) {
      try { // Android cũ (≤ 10) cần xin quyền ghi bộ nhớ trước
        if (Cap.Filesystem.requestPermissions) await Cap.Filesystem.requestPermissions();
        await Cap.Filesystem.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true });
        return 'Bộ nhớ máy › Documents › KhoLanhAnAn › ' + file.name;
      } catch (e2) {
        await Cap.Filesystem.writeFile({ path, data, directory: 'EXTERNAL', recursive: true });
        return 'Bộ nhớ máy › Android › data › vn.anan.kholanh › files › KhoLanhAnAn › ' + file.name;
      }
    }
  }
  // Mở bảng chia sẻ của điện thoại — chọn Zalo, Gmail/Email, Google Drive, Messenger…
  async function shareFile(file) {
    if (isNativeApp && Cap.Share) {
      const data = await blobToBase64(file.blob);
      await Cap.Filesystem.writeFile({ path: file.name, data, directory: 'CACHE' });
      const { uri } = await Cap.Filesystem.getUri({ path: file.name, directory: 'CACHE' });
      await Cap.Share.share({ title: file.name, text: file.name, files: [uri], dialogTitle: 'Gửi phiếu qua…' });
      return true;
    }
    const f = new File([file.blob], file.name, { type: file.mime });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      await navigator.share({ files: [f], title: file.name });
      return true;
    }
    browserDownload(file);
    toast('Trình duyệt này không chia sẻ file được — đã tải file về máy.', true);
    return false;
  }

  function openExportSheet(doc, message) {
    let file = null;
    const render = (busy, notice) => {
      openSheet(`
        <h2>Xuất file phiếu ${esc(doc.maPhieu || '')}</h2>
        <p class="lead">${esc(SRC_LABEL[doc.module] || '')} · mẫu phiếu của bảng này trên PC.</p>
        ${message ? `<div class="notice ok">${esc(message)}</div>` : ''}
        ${notice ? `<div class="notice ${notice.ok ? 'ok' : 'err'}">${esc(notice.text)}</div>` : ''}
        ${file ? `
          <div class="file-name">📄 ${esc(file.name)}</div>
          <button type="button" class="btn btn-primary" data-act="save">💾 Lưu trên điện thoại</button>
          <button type="button" class="btn btn-primary" data-act="share">📤 Gửi qua Zalo / Email / Google Drive…</button>
          <p class="lead" style="margin:8px 0 0">"Gửi qua…" mở danh sách ứng dụng của điện thoại — chọn Zalo, Gmail, Drive hoặc ứng dụng khác.</p>
          <button type="button" class="btn btn-ghost" data-act="again">Xuất định dạng khác</button>
        ` : `
          <div class="fmt-grid">
            <button type="button" class="fmt-btn" data-fmt="pdf" ${busy ? 'disabled' : ''}>PDF<small>in, gửi</small></button>
            <button type="button" class="fmt-btn" data-fmt="xlsx" ${busy ? 'disabled' : ''}>Excel<small>.xlsx</small></button>
            <button type="button" class="fmt-btn" data-fmt="png" ${busy ? 'disabled' : ''}>Ảnh PNG<small>gửi Zalo</small></button>
          </div>
          ${busy ? '<p class="lead">Đang tạo file…</p>' : ''}
        `}
        <button type="button" class="btn btn-ghost" data-close>Đóng</button>
      `);
      $('sheetBody').onclick = async (e) => {
        if (e.target.closest('[data-close]')) { closeSheet(); return; }
        const f = e.target.closest('[data-fmt]');
        if (f && !busy) {
          message = '';
          render(true);
          try {
            file = await window.KLExport.build(doc, f.dataset.fmt);
            render(false);
          } catch (err) {
            file = null;
            render(false, { ok: false, text: 'Không tạo được file: ' + err.message });
          }
          return;
        }
        const act = e.target.closest('[data-act]');
        if (!act || !file) return;
        if (act.dataset.act === 'again') { file = null; render(false); return; }
        try {
          if (act.dataset.act === 'save') {
            const where = await saveToPhone(file);
            render(false, { ok: true, text: 'Đã lưu: ' + where });
          } else {
            await shareFile(file);
          }
        } catch (err) {
          if (!/cancel/i.test(String(err && err.message))) render(false, { ok: false, text: 'Không thực hiện được: ' + err.message });
        }
      };
    };
    render(false);
  }

  // ================================================================ BÁO CÁO EXCEL (M01 + M02)
  // File Excel do CHÍNH module trên PC dựng bằng đúng hàm của nút Xuất Excel (main.js → pushReportTab), gửi lên
  // Google Sheet dạng base64. Điện thoại chỉ tải về → Lưu / Gửi qua…, KHÔNG tự tính lại số.
  //   M01 (tab BaoCao_M01): "Báo Cáo Tổng Tồn" (sheet Tổng Tồn + 7 module) + "Bảng Tổng Hợp HLSO".
  //   M02 (tab BaoCao_M02): "Bảng Tổng Hợp" (tab Báo Cáo của Module 2).
  // Trang RIÊNG "Báo cáo" (tab dưới cùng), mỗi nguồn hiện theo quyền BC01 / BC02 của tài khoản (canReport).
  // Không lưu file trên máy (có thể vài trăm KB): tải khi mở trang, giữ trong phiên; quá 5 phút hoặc bấm nút
  // tải lại (góc trên) thì tải lại. Lưu / Gửi hỏi "Ngày báo cáo" trước (openReportDate).
  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ---- NGÀY BÁO CÁO khi Lưu / Gửi (giống hộp "Ngày báo cáo" của PC — js/report-date-dialog.js) ----
  // File PC gửi lên đã ghi sẵn "Ngày số liệu". Người dùng chọn ngày khác thì sửa đúng ô ngày trong file .xlsx:
  //   Tổng Tồn (M01, SheetJS): ô B1 "Ngày : dd/mm/yyyy" — nằm trong xl/worksheets/sheetN.xml (<v>…</v>)
  //   HLSO (M01, SheetJS) / Bảng Tổng Hợp (M02, ExcelJS): ô A1 "Ngày báo cáo: dd/mm/yyyy" (<v> hoặc sharedStrings <t>)
  // Chỉ thay ô có chữ BẮT ĐẦU bằng "Ngày :" / "Ngày báo cáo:" → dữ liệu dạng ngày khác trong file không bị đụng.
  // Đổi chữ tiêu đề ngày ở PC (TONGTON_EXPORT_TITLE…, buildHlsoSummaryWorkbook, buildBangTongHopBuffer) thì sửa REP_DATE_RE.
  // ---- XEM TRƯỚC BÁO CÁO (chạm vào thẻ) — đọc THẲNG file .xlsx PC gửi lên (JSZip + DOMParser), KHÔNG tính lại:
  // số trên màn hình chính là số trong file sẽ Lưu / Gửi. Chỉ đọc sheet ĐẦU TIÊN của file (Tổng Tồn / HLSO / Bảng Tổng
  // Hợp). "Báo cáo tổng tồn (AA)" chỉ hiện phần tổng (Bột + Sốt + Bếp, 7 module, Tổng An An, Kho Gửi, Tổng chung), dừng
  // ở khối chi tiết "Báo Cáo Tổng Hợp" (REP_PREVIEW_STOP — đổi tiêu đề khối đó ở PC buildBaoCaoAllModulesWorkbook thì sửa).
  const REP_PREVIEW_STOP = { tongton: /^báo cáo tổng hợp/i };
  const REP_PREVIEW_MAX = 300; // báo cáo dài: chỉ hiện chừng này dòng đầu (file đầy đủ vẫn Lưu / Gửi bình thường)
  const repPreviewCache = new Map();
  function xlsxColIndex(ref) {
    const m = String(ref || '').match(/^([A-Z]+)/); if (!m) return -1;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  async function readXlsxFirstSheet(b64) {
    await loadJsZip();
    const zip = await window.JSZip.loadAsync(b64, { base64: true });
    const dp = new DOMParser();
    const xml = async (p) => { const f = zip.file(p); return f ? dp.parseFromString(await f.async('string'), 'application/xml') : null; };
    const tags = (node, name) => node ? Array.from(node.getElementsByTagName(name)) : [];
    let sheetPath = 'xl/worksheets/sheet1.xml', sheetName = '';
    const wb = await xml('xl/workbook.xml');
    const first = tags(wb, 'sheet')[0];
    if (first) {
      sheetName = first.getAttribute('name') || '';
      const rid = first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = tags(await xml('xl/_rels/workbook.xml.rels'), 'Relationship').find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target') || ''; sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
    }
    const strs = tags(await xml('xl/sharedStrings.xml'), 'si').map((si) => tags(si, 't').filter((t) => !t.closest || !t.closest('rPh')).map((t) => t.textContent).join(''));
    const rows = [];
    tags(await xml(sheetPath), 'row').forEach((r) => {
      const cells = [];
      tags(r, 'c').forEach((c, i) => {
        const col = xlsxColIndex(c.getAttribute('r'));
        const vEl = tags(c, 'v')[0];
        const raw = vEl ? vEl.textContent : '';
        const t = c.getAttribute('t');
        let v;
        if (t === 's') v = strs[Number(raw)] ?? '';
        else if (t === 'inlineStr') v = tags(c, 't').map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'b' || t === 'e') v = raw;
        else v = raw === '' ? '' : Number(raw);
        cells[col >= 0 ? col : i] = v;
      });
      rows.push(Array.from(cells, (v) => (v === undefined ? '' : v)));
    });
    return { sheetName, rows };
  }
  // Báo cáo toàn số kg → luôn 2 số lẻ như PC (0.00, 361,623.58). Key lạ: số nguyên giữ nguyên.
  const REP_KG_KEYS = { tongton: 1, hlso: 1, tonghop: 1 };
  const isBlank = (v) => String(v ?? '').trim() === '';
  // Chuẩn bị dữ liệu xem trước: cắt khối chi tiết, tách dòng tiêu đề "Ngày …", nhận dạng bảng pivot
  // (Bảng Tổng Hợp HLSO / Bảng Tổng Hợp kho gửi: "Size | nhóm… | Tổng | Size" — cột cuối lặp cột đầu → bỏ).
  function repPreviewModel(f, data) {
    const stop = REP_PREVIEW_STOP[f.key];
    let rows = data.rows;
    const cut = stop ? rows.findIndex((r) => stop.test(String(r[0] ?? '').trim())) : -1;
    if (cut >= 0) rows = rows.slice(0, cut);
    let caption = '';
    if (rows.length && rows[0].some((v) => /ngày(?: báo cáo)?\s*:/i.test(String(v)))) {
      caption = rows[0].filter((v) => !isBlank(v)).join(' · ');
      rows = rows.slice(1);
    }
    while (rows.length && rows[0].every(isBlank)) rows = rows.slice(1);
    while (rows.length && rows[rows.length - 1].every(isBlank)) rows.pop();
    const hdr = rows[0] || [];
    const hdrTxt = hdr.map((v) => String(v ?? '').trim());
    const last = hdrTxt.length - 1;
    const pivot = hdrTxt.length >= 3 && hdrTxt[0] !== '' && hdrTxt[0] === hdrTxt[last] && hdr.every((v) => typeof v !== 'number');
    const width = pivot ? last : rows.reduce((m, r) => Math.max(m, r.length), 0);
    const tongIdx = pivot ? hdrTxt.findIndex((v, k) => k > 0 && k < last && /^tổng$/i.test(v)) : -1;
    return { rows, caption, cut, pivot, width, tongIdx };
  }
  function repPreviewTable(f, data) {
    const M = repPreviewModel(f, data);
    const kg = !!REP_KG_KEYS[f.key];
    const numTxt = (v) => (kg || !Number.isInteger(v) ? fmtKg(v) : fmt(v));
    const cell = (v, tag) => (typeof v === 'number'
      ? `<${tag} class="num">${esc(numTxt(v))}</${tag}>`
      : `<${tag}${tag === 'td' && isBlank(v) ? ' class="num"' : ''}>${esc(v)}</${tag}>`);
    let rows = M.rows;
    let more = 0;
    let html = '';
    let grandHtml = '';
    if (M.pivot) {
      // Bảng pivot (HLSO / Kho gửi): CHỈ hiện số TỔNG của từng nhóm — bỏ dòng size và các cột nhóm con cho gọn.
      // Dòng hiện: mục cấp trên cùng (VD "Thành phẩm chính", "Bột + Sốt + Bếp" — nằm TRƯỚC nhóm đầu tiên),
      // dòng nhóm (VIẾT HOA, không có chữ số: TÔM HLSO, TÔM GIÁM SÁT…), và TỔNG TỒN (1 lần, ở cuối).
      // Dòng sau 1 nhóm (tới nhóm kế tiếp) = size của nhóm đó → ẩn.
      const T = M.tongIdx > 0 ? M.tongIdx : M.width - 1;
      const items = []; let total = null, inGroup = false;
      rows.slice(1).forEach((r) => {
        if (r.every(isBlank)) return;
        const label = String(r[0] ?? '').trim();
        if (/^tổng/i.test(label)) { total = r; return; }
        const isGroup = label === label.toLocaleUpperCase('vi') && /\p{L}/u.test(label) && !/\d/.test(label);
        if (isGroup) { inGroup = true; items.push(r); } else if (!inGroup) items.push(r);
      });
      const val = (r) => (typeof r[T] === 'number' ? esc(numTxt(r[T])) + ' <small>kg</small>' : '<span class="rp-nil">—</span>');
      const niceLabel = (l) => String(l ?? '').trim(); // giữ đúng tên như file (TÔM HLSO, Tôm BM…)
      html = `<div class="rp-wrap"><table class="rp-table rp-sum">
        <tr class="rp-head"><td>Nhóm</td><td class="num">Tổng</td></tr>
        ${items.map((r) => `<tr><td>${esc(niceLabel(r[0]))}</td><td class="num">${val(r)}</td></tr>`).join('')}
        ${total ? `<tr class="rp-total"><td>Tổng tồn</td><td class="num">${val(total)}</td></tr>` : ''}
      </table></div>`;
    } else {
      // Tổng tồn (AA): tách dòng "TỔNG TỒN KHO AN AN + KHO GỬI" ra ô tổng nổi bật NGAY DƯỚI bảng (trước đây nằm
      // cuối khung cuộn → bị khuất). File PC cũ chưa có dòng này → tự cộng "TỔNG TỒN AN AN" + dòng kho gửi.
      if (f.key === 'tongton') {
        const lab = (r) => String(r[0] ?? '').trim();
        const num = (r) => (r && typeof r[1] === 'number' ? r[1] : null);
        const gi = rows.findIndex((r) => /^tổng/i.test(lab(r)) && /gửi|gởi/i.test(lab(r)));
        let grand = gi >= 0 ? num(rows[gi]) : null;
        if (gi >= 0) { rows = rows.slice(0, gi).concat(rows.slice(gi + 1)); }
        else {
          const aa = num(rows.find((r) => /^tổng/i.test(lab(r))));
          const kg = num(rows.find((r) => /kho (gửi|gởi)|transimex/i.test(lab(r)) && !/^tổng/i.test(lab(r))));
          grand = (aa === null && kg === null) ? null : (aa || 0) + (kg || 0);
        }
        while (rows.length && rows[rows.length - 1].every(isBlank)) rows.pop();
        grandHtml = `<div class="rp-grand"><span>Tổng tồn An An + Tồn gửi kho</span>
          <b>${grand === null ? '—' : esc(fmtKg(grand)) + ' <small>kg</small>'}</b></div>`;
      }
      if (rows.length > REP_PREVIEW_MAX) { more = rows.length - REP_PREVIEW_MAX; rows = rows.slice(0, REP_PREVIEW_MAX); }
      const body = rows.map((r) => {
        const filled = r.filter((v) => !isBlank(v));
        if (!filled.length) return `<tr class="rp-gap"><td colspan="${M.width}"></td></tr>`;
        const label = String(r[0] ?? '').trim();
        const isTotal = /^tổng/i.test(label);
        const isHead = !r.some((v) => typeof v === 'number') && (filled.length > 1 || r.length <= 2);
        const cls = isTotal ? 'rp-total' : (isHead ? 'rp-head' : '');
        const tds = [];
        for (let k = 0; k < M.width; k++) tds.push(cell(r[k] ?? '', 'td'));
        return `<tr class="${cls}">${tds.join('')}</tr>`;
      }).join('');
      html = `<div class="rp-wrap"><table class="rp-table">${body}</table></div>${grandHtml}`;
    }
    return `${M.caption ? `<p class="rp-cap">${esc(M.caption)}</p>` : ''}${html}
      ${more ? `<p class="bc-note">… còn ${esc(fmt(more))} dòng nữa — Lưu / Gửi file để xem đầy đủ.</p>` : ''}
      ${M.cut >= 0 ? '<p class="bc-note">Các sheet chi tiết từng module có trong file khi Lưu / Gửi.</p>' : ''}`;
  }
  let repPvSeq = 0; // lần mở xem trước gần nhất — file đọc xong mà người dùng đã mở thẻ khác thì bỏ qua
  async function openReportPreview(f) {
    const seq = ++repPvSeq;
    const head = `<h2>${esc(repTitle(f))}</h2>
      <p class="lead">Ngày số liệu <b>${esc(f.reportDate || '—')}</b> · PC lập lúc ${esc(fmtTime(f.generatedAt))}</p>`;
    const btns = `<div class="rep-btns rp-btns">
        <button type="button" class="btn btn-primary" data-pv="save">💾 Lưu</button>
        <button type="button" class="btn btn-primary" data-pv="share">📤 Gửi qua…</button></div>
      <button type="button" class="btn btn-ghost" data-pv="close">Đóng</button>`;
    const cacheKey = f.key + '|' + f.generatedAt + '|' + f.b64.length;
    const wire = () => {
      $('sheetBody').onclick = (e) => {
        const b = e.target.closest('[data-pv]'); if (!b) return;
        if (b.dataset.pv === 'close') { closeSheet(); return; }
        openReportDate(f, b.dataset.pv); // chuyển sang bước chọn ngày báo cáo như 2 nút ngoài thẻ
      };
    };
    const cached = repPreviewCache.get(cacheKey);
    openSheet(head + `<div id="rpBox">${cached ? repPreviewTable(f, cached) : '<p class="bc-note">Đang đọc file…</p>'}</div>` + btns); wire();
    if (cached) return;
    try {
      const data = await readXlsxFirstSheet(f.b64);
      if (repPreviewCache.size >= 4) repPreviewCache.delete(repPreviewCache.keys().next().value); // giữ tối đa 4 file
      repPreviewCache.set(cacheKey, data);
      if ($('sheet').hidden || seq !== repPvSeq) return; // đã đóng / đã mở thẻ khác trong lúc đọc
      openSheet(head + `<div id="rpBox">${repPreviewTable(f, data)}</div>` + btns); wire();
    } catch (ex) {
      if ($('sheet').hidden || seq !== repPvSeq) return;
      openSheet(head + `<div class="notice err">Không đọc được file để xem trước: ${esc(ex.message)}. Vẫn Lưu / Gửi được bình thường.</div>` + btns); wire();
    }
  }

  const REP_DATE_RE = /(>\s*Ngày(?: báo cáo)?\s*:\s*)(\d{1,2}\/\d{1,2}\/\d{4})(\s*<\/(?:v|t)>)/g;
  let jszipLoading = null;
  function loadJsZip() {
    if (window.JSZip) return Promise.resolve();
    if (!jszipLoading) {
      jszipLoading = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = 'lib/jszip.min.js'; sc.onload = res;
        sc.onerror = () => { jszipLoading = null; rej(new Error('Không tải được lib/jszip.min.js')); };
        document.head.appendChild(sc);
      });
    }
    return jszipLoading;
  }
  async function reportBlobWithDate(f, dateStr) {
    if (!dateStr || dateStr === f.reportDate) return { blob: b64ToBlob(f.b64, XLSX_MIME), changed: 0 };
    await loadJsZip();
    const zip = await window.JSZip.loadAsync(f.b64, { base64: true });
    let changed = 0;
    for (const p of Object.keys(zip.files)) {
      if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(p)) continue;
      const xml = await zip.file(p).async('string');
      const out = xml.replace(REP_DATE_RE, (m, a, b, c) => { changed++; return a + dateStr + c; });
      if (out !== xml) zip.file(p, out);
    }
    if (!changed) return { blob: b64ToBlob(f.b64, XLSX_MIME), changed: 0 };
    const blob = await zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
    return { blob, changed };
  }
  const p2d = (n) => String(n).padStart(2, '0');
  function isRealDate(d, m, y) { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d; }
  function repDateError(ds, ms, ys) {
    const d = Number(ds), m = Number(ms), y = Number(ys);
    if (!ds || !ms || !ys) return 'Vui lòng nhập đủ ngày, tháng và năm.';
    if (![d, m, y].every(Number.isInteger)) return 'Ngày, tháng, năm phải là số nguyên.';
    if (String(ys).length !== 4 || y < 2000 || y > 2100) return 'Năm phải gồm 4 chữ số (2000–2100).';
    if (m < 1 || m > 12) return 'Tháng phải từ 1 đến 12.';
    if (!isRealDate(d, m, y)) return `Tháng ${m}/${y} không có ngày ${d}.`;
    return '';
  }

  // repState[src] = { data, err, loading, at (ms lúc tải) }
  const repState = {};
  const REP_TTL = 5 * 60 * 1000;
  async function loadReports(force) {
    const srcs = REPORT_SRCS.filter((k) => canReport(k) && (force || !repState[k] || (!repState[k].loading && Date.now() - (repState[k].at || 0) > REP_TTL)));
    if (!srcs.length || !state.cfg.url) return;
    srcs.forEach((k) => { repState[k] = Object.assign({}, repState[k] || {}, { loading: true }); });
    if (state.tab === 'baocao') renderBaoCao();
    await Promise.all(srcs.map(async (k) => {
      try {
        const data = await api(REPORT_CFG[k].action);
        repState[k] = { data, err: '', loading: false, at: Date.now() };
      } catch (e) {
        repState[k] = { data: (repState[k] && repState[k].data) || null, err: e.message, loading: false, at: Date.now() };
        if (e.code === 'FORBIDDEN') fetchMe().then(renderAll).catch(() => {});
      }
    }));
    if (state.tab === 'baocao') { renderBaoCao(); renderFreshness(); }
  }
  function repFiles(k) { return ((repState[k] && repState[k].data && repState[k].data.files) || []).filter((f) => f.complete !== false && f.b64); }
  function renderBaoCao() {
    const box = $('bcBody');
    if (!box) return;
    const srcs = REPORT_SRCS.filter(canReport);
    if (!state.cfg.url) { box.innerHTML = emptyHtml('Chưa cài đặt kết nối', 'Mở Cài đặt để nhập đường dẫn Web App.'); return; }
    if (!srcs.length) { box.innerHTML = emptyHtml('Chưa được cấp báo cáo', 'Tài khoản này chưa được chọn báo cáo nào. Liên hệ người quản lý app PC.'); return; }
    box.innerHTML = srcs.map((k) => {
      const cfg = REPORT_CFG[k], st = repState[k] || {};
      const meta = (st.data && st.data.meta) || {};
      const all = (st.data && st.data.files) || [];
      const files = repFiles(k);
      const broken = all.filter((f) => f.complete === false || !f.b64);
      let body = '';
      if (st.loading && !st.data) body = '<p class="bc-note">Đang tải báo cáo…</p>';
      else if (st.err && !st.data) body = `<div class="notice err">${esc(st.err)}</div>`;
      else if (!files.length && !broken.length) body = emptyHtml('Chưa có báo cáo', `Trên PC: mở ${cfg.pc} (${cfg.need}), rồi bấm "🔄 Đồng bộ ngay" có tick ${cfg.kho}.`);
      else {
        if (st.err) body += `<div class="notice err">Chưa tải lại được (${esc(st.err)}) — đang xem bản đã tải trước đó.</div>`;
        if (meta[cfg.prefix + 'BaoCaoCu'] && files[0]) body += `<div class="notice err">Lúc đồng bộ, ${esc(cfg.pc)} trên PC đang đóng — đây là bản lập lúc ${esc(fmtTime(files[0].generatedAt))}, có thể chưa gồm thay đổi mới nhất.</div>`;
        if (meta[cfg.prefix + 'BaoCaoLoi']) body += `<div class="notice err">PC báo lỗi khi dựng báo cáo: ${esc(meta[cfg.prefix + 'BaoCaoLoi'])}</div>`;
        // Báo cáo lệch ngày với bảng tồn (bản 1.3): VD tồn kho đã là 30/09 mà báo cáo vẫn số liệu 27/09 → nói rõ, không để
        // người dùng tưởng đã cập nhật. (PC 2.6+ tự dựng lại khi lệch; cảnh báo này đỡ cho PC cũ / lúc PC dựng lại không được.)
        else {
          const dd = String(meta[DATA_DATE_KEY[cfg.prefix]] || '').trim(), rd = files[0] ? String(files[0].reportDate || '').trim() : '';
          if (dd && rd && dd !== rd) body += `<div class="notice err">Báo cáo đang là số liệu ngày <b>${esc(rd)}</b> nhưng tồn kho đã cập nhật ngày <b>${esc(dd)}</b>. Trên PC: mở ${esc(cfg.pc)}, bấm làm mới ↻ rồi bấm "Đẩy lên ĐT".</div>`;
        }
        if (broken.length) body += `<div class="notice err">File chưa đủ dữ liệu (PC đang đẩy dở?): ${esc(broken.map(repTitle).join(', '))} — thử tải lại sau ít phút.</div>`;
        body += files.map((f) => `
          <div class="rep-card" data-rview="${esc(k)}|${esc(f.key)}" role="button" tabindex="0">
            <h3>📊 ${esc(repTitle(f))} <span class="rep-peek">Xem ›</span></h3>
            <p class="rep-sub">Ngày số liệu <b>${esc(f.reportDate || '—')}</b> · PC lập lúc ${esc(fmtTime(f.generatedAt))} · ${esc(fmt(Math.round(f.b64.length * 0.75 / 1024)))} KB</p>
            <div class="rep-btns">
              <button type="button" class="btn btn-primary" data-rsave="${esc(k)}|${esc(f.key)}">💾 Lưu</button>
              <button type="button" class="btn btn-primary" data-rshare="${esc(k)}|${esc(f.key)}">📤 Gửi qua…</button>
            </div>
          </div>`).join('');
      }
      return `<section class="bc-group"><h3 class="sec-title">${esc(cfg.kho)} <small>${esc(cfg.pc.replace(/ ".*$/, ''))}</small></h3>${body}</section>`;
    }).join('');
  }
  // Chọn "Ngày báo cáo" (3 ô dd / mm / yyyy + "Hôm nay", giống hộp PC) trong bảng trượt → sửa ngày trong file → Lưu / Gửi.
  let repLastDate = ''; // ngày vừa chọn — file kế tiếp điền sẵn luôn ngày này
  // TÊN FILE mặc định = <tiền tố>_<dd-mm-yyyy theo NGÀY BÁO CÁO>.xlsx (VD BaoCao_TongTon_15-09-2026.xlsx) —
  // theo ngày người dùng chọn, không theo giờ PC lập file → lưu báo cáo nhiều ngày không ghi đè nhau.
  // Tiền tố theo key file (buildPhoneReportSnapshot / buildM2PhoneReportSnapshot); key lạ thì lấy tên PC bỏ giờ.
  // TÊN HIỂN THỊ từng báo cáo trên điện thoại (theo key file) — ưu tiên hơn title PC gửi lên, nên đổi tên ở đây
  // có hiệu lực ngay, không cần PC đồng bộ lại. Key lạ thì dùng title PC gửi.
  const REP_TITLE = { tongton: 'Báo cáo tổng tồn (AA)', hlso: 'Báo cáo tổng hợp HLSO (AA)', tonghop: 'Báo cáo kho gửi' };
  const repTitle = (f) => REP_TITLE[f.key] || f.title || f.key;
  const REP_NAME_PREFIX = { tongton: 'BaoCao_TongTon', hlso: 'BangTongHopHLSO', tonghop: 'BangTongHop' };
  function repDefaultName(f, dateStr) {
    const base = REP_NAME_PREFIX[f.key] || String(f.name || 'BaoCao').replace(/\.xlsx$/i, '').replace(/_\d{8}_\d{4}$/, '');
    return `${base}_${String(dateStr || '').replace(/\//g, '-')}.xlsx`;
  }
  // Bỏ ký tự Android / iOS / Windows không cho phép trong tên file, tự thêm đuôi .xlsx. '' = tên không dùng được.
  function repCleanName(name) {
    let n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim();
    n = n.replace(/\.xlsx$/i, '').replace(/[. ]+$/, '').trim();
    return n ? n.slice(0, 120) + '.xlsx' : '';
  }
  function openReportDate(f, act) {
    const init = String(repLastDate || f.reportDate || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const now = new Date();
    const ask = init ? { d: p2d(init[1]), m: p2d(init[2]), y: init[3] } : { d: p2d(now.getDate()), m: p2d(now.getMonth() + 1), y: String(now.getFullYear()) };
    // ask.name = tên file đang hiện; ask.nameTouched = người dùng đã tự sửa tên → thôi tự đổi theo ngày.
    const dateOf = () => (ask.d && ask.m && ask.y) ? `${p2d(Number(ask.d))}/${p2d(Number(ask.m))}/${ask.y}` : '';
    ask.name = repDefaultName(f, dateOf());
    const draw = () => {
      const preview = dateOf() || '—';
      openSheet(`
        <h2>Ngày báo cáo</h2>
        <p class="lead">${esc(repTitle(f))} — chọn đúng ngày của số liệu báo cáo. File Excel sẽ ghi ngày này (PC điền sẵn "Ngày số liệu": ${esc(f.reportDate || '—')}).</p>
        <div class="rep-date">
          <label><span>Ngày</span><input type="number" inputmode="numeric" id="repDD" min="1" max="31" placeholder="dd" value="${esc(ask.d)}"></label>
          <b>/</b>
          <label><span>Tháng</span><input type="number" inputmode="numeric" id="repMM" min="1" max="12" placeholder="mm" value="${esc(ask.m)}"></label>
          <b>/</b>
          <label class="rep-y"><span>Năm</span><input type="number" inputmode="numeric" id="repYY" min="2000" max="2100" placeholder="yyyy" value="${esc(ask.y)}"></label>
        </div>
        <div class="rep-date-meta"><span>Ghi vào file: <b id="repPreview">${esc(preview)}</b></span>
          <button type="button" class="rep-link" data-today>Hôm nay</button></div>
        <label class="field rep-name"><span>Tên file</span>
          <input type="text" id="repName" maxlength="130" value="${esc(ask.name)}" autocapitalize="none" autocomplete="off" spellcheck="false">
          <small>Tự đổi theo ngày báo cáo cho tới khi bạn sửa tên. Đuôi .xlsx tự thêm nếu thiếu. <button type="button" class="rep-link" data-rename${ask.nameTouched ? '' : ' hidden'}>Dùng tên mặc định</button></small></label>
        ${ask.err ? `<div class="notice ${ask.errOk ? 'ok' : 'err'}">${esc(ask.err)}</div>` : ''}
        ${ask.busy ? '<p class="lead">Đang tạo file…</p>' : ''}
        <button type="button" class="btn btn-primary" data-go ${ask.busy ? 'disabled' : ''}>${act === 'save' ? '💾 Lưu file' : '📤 Gửi file qua…'}</button>
        <button type="button" class="btn btn-ghost" data-back ${ask.busy ? 'disabled' : ''}>${ask.done ? 'Đóng' : 'Hủy'}</button>
      `);
      const dd = $('repDD'), mm = $('repMM'), yy = $('repYY'), nm = $('repName');
      const sync = () => {
        ask.d = String(dd.value || '').trim(); ask.m = String(mm.value || '').trim(); ask.y = String(yy.value || '').trim();
        $('repPreview').textContent = dateOf() || '—';
        if (!ask.nameTouched && dateOf()) { ask.name = repDefaultName(f, dateOf()); nm.value = ask.name; }
      };
      nm.oninput = () => {
        ask.name = nm.value;
        ask.nameTouched = true; // không vẽ lại cả bảng (giữ bàn phím), chỉ hiện nút "Dùng tên mặc định"
        const rb = $('sheetBody').querySelector('[data-rename]'); if (rb) rb.hidden = false;
      };
      dd.oninput = () => { sync(); if (dd.value.length >= 2) { mm.focus(); mm.select(); } };
      mm.oninput = () => { sync(); if (mm.value.length >= 2) { yy.focus(); yy.select(); } };
      yy.oninput = sync;
      [dd, mm, yy].forEach((i) => { i.onfocus = () => i.select(); });
      $('sheetBody').onclick = async (e) => {
        if (ask.busy) return;
        if (e.target.closest('[data-back]')) { closeSheet(); return; }
        if (e.target.closest('[data-today]')) {
          const n = new Date(); ask.d = p2d(n.getDate()); ask.m = p2d(n.getMonth() + 1); ask.y = String(n.getFullYear()); ask.err = '';
          if (!ask.nameTouched) ask.name = repDefaultName(f, dateOf());
          draw(); return;
        }
        if (e.target.closest('[data-rename]')) { ask.nameTouched = false; ask.name = repDefaultName(f, dateOf()); draw(); return; }
        if (!e.target.closest('[data-go]')) return;
        sync();
        ask.name = nm.value;
        const msg = repDateError(ask.d, ask.m, ask.y);
        if (msg) { ask.err = msg; ask.errOk = false; draw(); return; }
        const fileName = repCleanName(ask.name);
        if (!fileName) { ask.err = 'Nhập tên file.'; ask.errOk = false; draw(); return; }
        ask.name = fileName;
        const dateStr = dateOf();
        ask.err = ''; ask.busy = true; draw();
        try {
          const r = await reportBlobWithDate(f, dateStr);
          repLastDate = dateStr;
          const warn = (dateStr !== f.reportDate && !r.changed) ? ' — không tìm thấy ô ngày trong file, file giữ ngày ' + (f.reportDate || 'cũ') : '';
          const file = { blob: r.blob, name: fileName, mime: XLSX_MIME };
          if (act === 'save') {
            const where = await saveToPhone(file);
            ask.busy = false; ask.done = true; ask.errOk = !warn; ask.err = `Đã lưu (ngày báo cáo ${dateStr}): ${where}${warn}`;
            draw();
          } else {
            await shareFile(file);
            ask.busy = false;
            if (warn) { ask.done = true; ask.errOk = false; ask.err = 'Đã gửi' + warn; draw(); } else closeSheet();
          }
        } catch (ex) {
          ask.busy = false;
          if (!/cancel/i.test(String(ex && ex.message))) { ask.errOk = false; ask.err = 'Không thực hiện được: ' + ex.message; }
          draw();
        }
      };
    };
    draw();
  }

  // Cài đặt kết nối
  // ---- CHẾ ĐỘ GIAO DIỆN: Sáng (mặc định, mẫu H "Xanh da trời tươi") / Tối (mẫu D) / Theo máy ----
  // Lựa chọn lưu ở localStorage 'klanan.theme' = 'light' | 'dark' | 'auto'. 'auto' = theo chế độ Sáng/Tối
  // của điện thoại (prefers-color-scheme) và tự đổi khi máy đổi. index.html có đoạn script nhỏ trong <head>
  // đặt data-theme TRƯỚC khi trang hiện (tránh nháy trắng khi mở ở chế độ Tối) — giữ 2 nơi giống nhau.
  const LS_THEME = 'klanan.theme';
  const THEME_BAR = { light: '#1766C0', dark: '#0A1118' }; // màu thanh trạng thái Android = màu thanh trên
  const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function themeChoice() { try { const t = localStorage.getItem(LS_THEME); return t === 'dark' || t === 'auto' ? t : 'light'; } catch (e) { return 'light'; } }
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme(choice) {
    choice = choice === 'dark' || choice === 'auto' ? choice : 'light';
    const t = choice === 'auto' ? (darkMQ && darkMQ.matches ? 'dark' : 'light') : choice;
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', THEME_BAR[t]);
    try { localStorage.setItem(LS_THEME, choice); } catch (e) { /* bỏ qua */ }
  }
  applyTheme(themeChoice()); // đồng bộ màu thanh trạng thái lúc mở app
  // "Theo máy": điện thoại đổi Sáng/Tối (VD tự động theo giờ) → app đổi theo ngay.
  if (darkMQ) {
    const onSys = () => { if (themeChoice() === 'auto') applyTheme('auto'); };
    if (darkMQ.addEventListener) darkMQ.addEventListener('change', onSys); else if (darkMQ.addListener) darkMQ.addListener(onSys);
  }

  function openSettings(first) {
    const c = state.cfg;
    openSheet(`
      <h2>${first ? 'Kết nối với kho' : 'Cài đặt'}</h2>
      <p class="lead">${FIXED_URL ? 'Nhập ID và mật khẩu do người quản lý app PC cấp.' : 'Lấy đường dẫn Web App và mã truy cập từ người quản lý app PC.'}</p>
      ${FIXED_URL ? '' : `<label class="field"><span>Đường dẫn Web App</span>
        <input type="url" id="cfgUrl" value="${esc(c.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" ${first ? 'autofocus' : ''}>
      </label>`}
      <label class="field"><span>${FIXED_URL ? 'ID (tên người dùng)' : 'Tên người dùng'}</span>
        <input type="text" id="cfgUser" value="${esc(c.user || '')}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="VD: thang" ${first && FIXED_URL ? 'autofocus' : ''}>
        <small>Không phân biệt chữ hoa/thường. Mã chung của quản lý thì để trống.</small>
      </label>
      <label class="field"><span>${FIXED_URL ? 'Mật khẩu (mã truy cập)' : 'Mã truy cập'}</span>
        <input type="password" id="cfgToken" value="${esc(c.token)}" autocomplete="current-password">
      </label>
      ${state.me && !state.me.admin ? `<div class="me-card">Xin chào <b>${esc(state.me.hienThi || state.me.ten)}</b> <span style="opacity:.75">(${esc(state.me.ten)})</span><br>Quyền: <b>${esc(QUYEN_TEXT[state.me.quyen] || state.me.quyen)}${state.me.quanTri ? ' · Quản trị' : ''}</b><br>Kho: ${esc(SOURCES.map((k) => KHO[k].name).concat(canView('m08') ? ['Tra cứu kháng sinh'] : []).join(', ') || 'chưa được cấp kho nào')}</div>` : ''}
      <label class="field"${state.me && !state.me.admin ? ' hidden' : ''}><span>Tên người gửi phiếu</span>
        <input type="text" id="cfgName" value="${esc(c.name)}" maxlength="60" placeholder="VD: Tuấn - ca sáng">
        <small>Hiện trên phiếu xuất ở PC để biết ai tạo. (Mã truy cập riêng từng người thì tên lấy theo mã.)</small>
      </label>
      <div class="notice" id="cfgMsg" hidden></div>
      <button type="button" class="btn btn-primary" id="cfgSave">Lưu và kiểm tra</button>
      ${first || !canManage() ? '' : `<button type="button" class="btn btn-ghost" id="cfgUsers">👥 Quản lý người dùng &amp; phân quyền</button>`}
      ${first ? '' : `<button type="button" class="btn btn-ghost" data-close>Đóng</button>
        <p class="lead" style="margin:16px 0 4px">Số liệu tồn kho được lưu trên máy — mở app không phải tải lại, chỉ tải bảng nào PC vừa cập nhật.</p>
        <button type="button" class="btn btn-danger" id="cfgClearData">Xóa dữ liệu đã lưu trên máy</button>`}
      <div class="field theme-field"><span>Giao diện</span>
        <div class="segmented three" role="group" aria-label="Chế độ giao diện">
          <button type="button" class="seg${themeChoice() === 'light' ? ' is-on' : ''}" data-theme-pick="light">☀️ Sáng</button>
          <button type="button" class="seg${themeChoice() === 'dark' ? ' is-on' : ''}" data-theme-pick="dark">🌙 Tối</button>
          <button type="button" class="seg${themeChoice() === 'auto' ? ' is-on' : ''}" data-theme-pick="auto">📱 Theo máy</button>
        </div>
        <small>Tối: đỡ chói khi làm trong kho thiếu sáng. Theo máy: tự đổi theo chế độ Sáng/Tối của điện thoại.</small>
      </div>
      <p class="lead" style="margin:14px 0 0;text-align:center;font-size:12px">Phiên bản app: <b>${APP_VERSION}</b><span id="luVer"></span></p>
      ${window.KLLiveUpdate && window.KLLiveUpdate.isNative ? '<button type="button" class="btn btn-ghost" id="luCheck" style="margin-top:8px">⟳ Kiểm tra cập nhật app</button>' : ''}
    `);
    // Mã bản giao diện đang chạy (live-update.js) — để biết máy đã nhận bản mới từ GitHub chưa.
    if (window.KLLiveUpdate) window.KLLiveUpdate.localInfo().then((L) => { const el = $('luVer'); if (el && L.version) el.textContent = ' · gói ' + L.version; }).catch(() => {});
    $('sheetBody').onclick = async (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      if (e.target.closest('#luCheck')) {
        const b = $('luCheck'); b.disabled = true; b.textContent = 'Đang kiểm tra…';
        const r = await window.KLLiveUpdate.check(true);
        b.disabled = false; b.textContent = '⟳ Kiểm tra cập nhật app';
        if (r && r.msg) toast(r.msg, !r.ok && !r.needApk);
        return;
      }
      const tp = e.target.closest('[data-theme-pick]');
      if (tp) {
        applyTheme(tp.dataset.themePick);
        $('sheetBody').querySelectorAll('[data-theme-pick]').forEach((b) => b.classList.toggle('is-on', b === tp));
        return;
      }
      if (e.target.id === 'cfgUsers') { openUserAdmin(); return; }
      if (e.target.id === 'cfgClearData') {
        if (confirm('Xóa toàn bộ số liệu đã lưu trên máy? Lần tới app sẽ tải lại từ đầu.')) {
          await clearSavedData(); closeSheet(); toast('Đã xóa dữ liệu đã lưu.'); autoRefresh();
        }
        return;
      }
      if (e.target.id !== 'cfgSave') return;
      const btn = e.target;
      const msg = $('cfgMsg');
      const next = { url: FIXED_URL || $('cfgUrl').value.trim(), user: $('cfgUser').value.trim(), token: $('cfgToken').value.trim(), name: $('cfgName').value.trim() };
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(next.url)) {
        msg.className = 'notice err'; msg.textContent = 'Đường dẫn phải là link Web App của Apps Script, kết thúc bằng /exec.'; msg.hidden = false; return;
      }
      if (!next.token) { msg.className = 'notice err'; msg.textContent = 'Nhập mã truy cập.'; msg.hidden = false; return; }
      const prev = state.cfg, prevMe = state.me;
      state.cfg = next;
      btn.disabled = true; btn.textContent = 'Đang kiểm tra…';
      try {
        // 'toi' = kiểm tra kết nối + lấy quyền của mã. Web App bản cũ chưa có 'toi' → dùng 'ping' như trước.
        let me = null;
        try { const r = await api('toi'); me = r.user && !r.user.admin ? r.user : null; }
        catch (err) { if (/Không có chức năng/.test(err.message)) await api('ping'); else throw err; }
        if (me) next.name = me.hienThi || me.ten;   // tài khoản riêng: tên hiển thị theo tài khoản
        else if (!next.name) { state.cfg = prev; msg.className = 'notice err'; msg.textContent = 'Nhập tên người gửi phiếu.'; msg.hidden = false; btn.disabled = false; btn.textContent = 'Lưu và kiểm tra'; return; }
        state.me = me; save(LS_ME, me);
        applyPerms();
        save(LS_CFG, state.cfg);
        closeSheet();
        toast('Đã kết nối.');
        refresh();
      } catch (err) {
        state.cfg = prev; state.me = prevMe;
        msg.className = 'notice err'; msg.textContent = 'Chưa kết nối được: ' + err.message; msg.hidden = false;
        btn.disabled = false; btn.textContent = 'Lưu và kiểm tra';
      }
    };
  }


  // ------------------------------------------------------------------ quản lý người dùng (lệnh pq.* của Web App)
  const PQ_KHO = [['M01', 'Tồn kho An An'], ['M01VT', 'Tồn theo vị trí'], ['M01VTB', 'Vị trí Bột'], ['M02', 'Tồn kho gửi'],
    ['M08', 'Tra cứu kháng sinh'], ['BC01', 'Báo cáo Tồn kho An An'], ['BC02', 'Báo cáo Tồn kho gửi'],
    ['M03', 'NXT Bột/Sốt'], ['M04', 'NXT TNK/TGC']];
  const PQ_QUYEN = { xem: 'Chỉ xem', xuat: 'Tạo phiếu', quantri: 'Quản trị' };
  const pqNewToken = () => { // 16 ký tự, bỏ ký tự dễ nhầm — dạng K7QD-9MXP-2HTW-RZ4C (giống app PC)
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', buf = new Uint32Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((n, i) => A[n % A.length] + (i % 4 === 3 && i < 15 ? '-' : '')).join('');
  };
  const pqUserId = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9._-]/g, '').toLowerCase().slice(0, 40);

  async function openUserAdmin() {
    let list = [];
    const back = () => openSettings(false);
    const failView = (msg) => {
      openSheet(`<h2>Người dùng &amp; phân quyền</h2><div class="notice err">${esc(msg)}</div><button type="button" class="btn btn-ghost" data-back>Quay lại</button>`);
      $('sheetBody').onclick = (e) => { if (e.target.closest('[data-back]')) back(); };
    };
    const listView = () => {
      openSheet(`<h2>Người dùng &amp; phân quyền</h2>
        <p class="lead">Chạm 1 người để sửa quyền / kho / mã. Thay đổi có hiệu lực ngay; app PC tự cập nhật khi mở Cài Đặt → Điện Thoại.</p>
        ${list.length ? list.map((u, i) => `<button type="button" class="ua-item${u.bat ? '' : ' is-off'}" data-i="${i}"><b>${esc(u.tenHienThi || u.ten)}</b> <span class="ua-id">(${esc(u.ten)})</span><small>${esc(PQ_QUYEN[u.quyen] || u.quyen)} · ${u.kho.length} kho${u.bat ? '' : ' · ĐÃ KHÓA'}</small></button>`).join('') : '<p class="lead">Chưa có người dùng nào.</p>'}
        <button type="button" class="btn btn-primary" data-add>➕ Thêm người dùng</button>
        <button type="button" class="btn btn-ghost" data-back>Quay lại</button>`);
      $('sheetBody').onclick = (e) => {
        if (e.target.closest('[data-back]')) { back(); return; }
        if (e.target.closest('[data-add]')) { formView(null); return; }
        const it = e.target.closest('[data-i]'); if (it) formView(list[Number(it.dataset.i)]);
      };
    };
    const formView = (u) => {
      const isNew = !u;
      const d = u ? { ...u, kho: (u.kho || []).slice() } : { ten: '', tenHienThi: '', token: pqNewToken(), quyen: 'xuat', kho: ['M01', 'M01VT', 'M01VTB', 'M02', 'M08'], bat: true };
      const self = !!state.me && String(state.me.ten || '').toLowerCase() === String(d.ten).toLowerCase();
      openSheet(`<h2>${isNew ? 'Thêm người dùng' : esc(d.tenHienThi || d.ten)}</h2>
        <label class="field"><span>Tên hiển thị</span><input type="text" id="uaHien" maxlength="60" value="${esc(d.tenHienThi)}" placeholder="VD: Thắng"></label>
        <label class="field"><span>Tên người dùng (ID đăng nhập)</span><input type="text" id="uaTen" maxlength="40" value="${esc(d.ten)}" ${isNew ? '' : 'readonly'} autocapitalize="none" spellcheck="false" placeholder="VD: thang"><small>Chữ không dấu, số, . _ - — không đổi được sau khi tạo.</small></label>
        <label class="field"><span>Mã truy cập (như mật khẩu)</span><input type="text" id="uaToken" maxlength="64" value="${esc(d.token)}" autocapitalize="none" spellcheck="false" placeholder="Bấm Tạo mã"><small>Đổi mã thì người này phải nhập mã mới trên điện thoại.</small></label>
        <div class="ua-row"><button type="button" class="btn btn-ghost" data-gen>Tạo mã mới</button><button type="button" class="btn btn-ghost" data-copy>Copy mã</button></div>
        <label class="field"><span>Quyền</span><select id="uaQuyen" class="ua-select">${Object.keys(PQ_QUYEN).map((k) => `<option value="${k}"${d.quyen === k ? ' selected' : ''}>${{ xem: 'Chỉ xem tồn kho', xuat: 'Xem + tạo phiếu xuất', quantri: 'Quản trị (+ quản lý người dùng)' }[k]}</option>`).join('')}</select></label>
        <div class="field"><span>Kho được dùng</span><div class="ua-kho">${PQ_KHO.map(([k, l]) => `<label><input type="checkbox" data-kho="${k}"${d.kho.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
        <div class="ua-kho ua-bat"><label><input type="checkbox" id="uaBat"${d.bat ? ' checked' : ''}> Đang hoạt động (bỏ tick = khóa)</label></div>
        <div class="notice" id="uaMsg" hidden></div>
        <button type="button" class="btn btn-primary" data-save>Lưu</button>
        ${isNew || self ? '' : '<button type="button" class="btn btn-danger" data-del>Xóa người dùng</button>'}
        <button type="button" class="btn btn-ghost" data-cancel>Hủy</button>`);
      let tenTouched = !isNew;
      const msg = (t) => { const m = $('uaMsg'); m.className = 'notice err'; m.textContent = t; m.hidden = false; };
      const run = async (btn, action, extra, okText) => {
        btn.disabled = true;
        try {
          const r = await api(action, extra);
          list = r.list || [];
          if (self) { try { await fetchMe(); } catch (e) { /* bỏ qua */ } }
          toast(okText); listView();
        } catch (err) { msg(err.message); btn.disabled = false; }
      };
      $('sheetBody').oninput = (e) => {
        if (e.target.id === 'uaTen') tenTouched = true;
        if (e.target.id === 'uaHien' && isNew && !tenTouched) $('uaTen').value = pqUserId(e.target.value);
      };
      $('sheetBody').onclick = async (e) => {
        if (e.target.closest('[data-cancel]')) { listView(); return; }
        if (e.target.closest('[data-gen]')) { $('uaToken').value = pqNewToken(); return; }
        if (e.target.closest('[data-copy]')) {
          try { await navigator.clipboard.writeText($('uaToken').value); toast('Đã copy mã.'); } catch (err) { toast('Không copy được — hãy chép tay.', true); }
          return;
        }
        const del = e.target.closest('[data-del]');
        if (del) {
          if (confirm(`Xóa người dùng "${d.tenHienThi || d.ten}"?\nMã của họ không dùng được nữa; phiếu đã gửi vẫn giữ nguyên.`)) run(del, 'pq.xoa', { ten: d.ten }, 'Đã xóa người dùng.');
          return;
        }
        const sv = e.target.closest('[data-save]');
        if (!sv) return;
        const ten = $('uaTen').value.trim();
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(ten)) { msg('Tên người dùng: chỉ chữ không dấu, số, . _ - (không dấu cách).'); return; }
        const kho = Array.from($('sheetBody').querySelectorAll('[data-kho]:checked')).map((c) => c.dataset.kho);
        if ($('uaBat').checked && !kho.length && !confirm('Chưa chọn kho nào — người này sẽ không xem được gì. Vẫn lưu?')) return;
        run(sv, 'pq.luu', { u: { ten, tenHienThi: $('uaHien').value.trim(), token: $('uaToken').value.trim(), quyen: $('uaQuyen').value, kho, bat: $('uaBat').checked } }, 'Đã lưu.');
      };
    };
    openSheet('<h2>Người dùng &amp; phân quyền</h2><p class="lead">Đang tải…</p>');
    try { list = (await api('pq.list')).list || []; } catch (err) { failView(err.message); return; }
    listView();
  }

  // ------------------------------------------------------------------ thông báo nhanh
  let toastTimer = null;
  function toast(text, isErr) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('is-err', !!isErr);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 4500 : 2600);
  }

  // ------------------------------------------------------------------ tải dữ liệu
  const ACTION = { m02: 'tonKhoGui', m01: 'tonKho', vitri: 'viTri', vitribot: 'viTriBot', m03: 'tonKhoM03', m04: 'tonKhoM04', m08: 'm08', phieu: 'phieu' };
  function neededFor(tab) {
    // Trang chủ cần số liệu của MỌI kho được dùng (ô tổng tồn + tìm mã trong mọi kho): lần đầu tải đủ 5 kho
    // một lượt; từ đó dùng bản lưu trên máy, chỉ tải lại kho nào PC vừa đẩy bản mới.
    if (tab === 'home') return ['phieu'].concat(SOURCES);
    if (tab === 'xuat') return state.xuatSrc === 'tong' ? SOURCES.slice() : [state.xuatSrc]; // Tổng: cần mọi kho
    if (tab === 'ton') return [state.tonMode];
    if (tab === 'm8') return ['m08'];
    if (tab === 'baocao') return []; // file báo cáo tải riêng (loadReports), không cần bảng kho
    return ['phieu', 'm02'];
  }

  const queuedKeys = new Set();
  async function refresh(keys) {
    if (!cfgOk()) { openSettings(true); return; }
    const list = keys || neededFor(state.tab);
    // Đang tải dở (VD vừa mở app, đang tải Phiếu) mà người dùng chuyển sang màn khác → GHI NHỚ phần cần tải thêm,
    // tải ngay khi xong. (Trước đây bị bỏ qua → màn Tra cứu kẹt "Chưa có lô nào" dù dữ liệu chưa hề được tải.)
    if (state.busy) { list.forEach((k) => queuedKeys.add(k)); return; }
    state.busy = true;
    $('refreshBtn').classList.add('is-busy');
    const errors = [];
    await Promise.all(list.map((k) => fetchInto(k, ACTION[k]).catch((e) => errors.push(e))));
    if (list.some((k) => SOURCES.includes(k) || k === 'm08')) buildLots();
    list.filter((k) => SOURCES.includes(k)).forEach(buildTonRows);
    state.busy = false;
    $('refreshBtn').classList.remove('is-busy');
    renderAll();
    const more = Array.from(queuedKeys).filter((k) => !list.includes(k) && tabOk(state.tab));
    queuedKeys.clear();
    if (more.length) refresh(more);
    if (errors.length) {
      const e = errors[0];
      if (e.code === 'FORBIDDEN') { fetchMe().then(renderAll).catch(() => {}); }
      if (e.code === 'AUTH' || e.code === 'CFG') openSettings(false);
      toast(e.message, true);
    }
  }

  function switchTab(tab) {
    if (state.multi && state.multi.on && tab !== 'xuat') setMulti(false, true); // rời tab Kho → thôi chọn nhiều
    if (!tabOk(tab)) tab = firstTab();
    state.tab = tab;
    showTabUi();
    window.scrollTo(0, 0);
    renderAll();
    autoRefresh();
  }

  // Dùng dữ liệu đã lưu trên máy; chỉ tải khi: chưa có bản lưu, PC vừa đẩy bản mới hơn, hoặc danh
  // sách "Phiếu đã gửi" (nhỏ) đã cũ hơn 2 phút. Sau đó hỏi nhẹ Web App xem có gì mới không.
  function autoRefresh() {
    if (!cfgOk()) return;
    if (state.tab === 'baocao') loadReports(false);
    const need = neededFor(state.tab).filter((k) => !state[k] || !state[k].data || state.stale.has(k) ||
      (k === 'm08' && !state.ksOff && !(state.ks && state.ks.rows)) ||
      (k === 'phieu' && Date.now() - new Date(state[k].fetchedAt || 0).getTime() > 120000));
    if (need.length) refresh(need);
    checkUpdates(false);
  }

  // Hỏi Web App (rất nhẹ): mốc PC đẩy từng bảng + số đang chờ. Cập nhật "chờ PC" cho mọi bảng đang
  // lưu mà KHÔNG tải lại bảng; bảng nào PC đẩy bản mới hơn thì đánh dấu và tải lại (bảng đang xem
  // tải ngay, bảng khác tải khi mở tới). Tối đa 1 lần / phút trừ khi force.
  let lastPendingSig = null;
  async function checkUpdates(force) {
    if (!cfgOk()) return;
    if (!force && Date.now() - lastCheckAt < 60000) return;
    lastCheckAt = Date.now();
    let st;
    const meBefore = JSON.stringify(state.me || null);
    try { [st] = await Promise.all([api('trangThai'), fetchMe().catch(() => {})]); }
    catch (e) { if (e.code === 'AUTH') { toast(e.message, true); openSettings(false); } return; } // mất mạng / Web App bản cũ chưa có lệnh này → cứ dùng bản đã lưu
    // MƯỢT HƠN (bản 1.5): chỉ dựng lại danh sách + vẽ lại khi số "chờ PC" hoặc dấu bảng mới THẬT SỰ đổi — trước đây mỗi
    // lần quay lại app (≤ 1 lần/phút) đều dựng lại toàn bộ hàng nghìn dòng → giật nhẹ dù không có gì mới.
    const pendSig = JSON.stringify(st.pending || {});
    let changed = pendSig !== lastPendingSig || JSON.stringify(state.me || null) !== meBefore; // quyền đổi → vẽ lại
    lastPendingSig = pendSig;
    SOURCES.concat(['m08']).forEach((k) => {
      const d = state[k] && state[k].data;
      if (!d) return;
      d.pending = st.pending || {};
      const pc = stampIn(st.meta, k), mine = stampIn(d.meta, k);
      if (pc && pc > mine && !state.stale.has(k)) { state.stale.add(k); changed = true; }
    });
    if (changed) { buildLots(); renderAll(); }
    // + kho vừa được cấp quyền (chưa có số liệu trên máy)
    const now = neededFor(state.tab).filter((k) => state.stale.has(k) || !(state[k] && state[k].data));
    if (now.length) refresh(now);
  }

  // ------------------------------------------------------------------ sự kiện
  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    // Có phiếu soạn dở thì mở thẳng nhóm "Đang soạn" — việc cần làm tiếp nằm ở đó.
    if (b.dataset.tab === 'phieu' && state.cart && state.cart.items.length) state.phieuSeg = 'soan';
    switchTab(b.dataset.tab);
  });
  $('refreshBtn').addEventListener('click', () => { if (state.tab === 'baocao') loadReports(true); else refresh(); });
  $('bcBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rsave],[data-rshare]');
    if (!b) {
      // Chạm vào thẻ (ngoài 2 nút) → xem trước số liệu trong file trước khi Lưu / Gửi.
      const card = e.target.closest('[data-rview]');
      if (!card) return;
      const [vk, vkey] = String(card.dataset.rview).split('|');
      const vf = canReport(vk) && repFiles(vk).find((x) => x.key === vkey);
      if (vf) openReportPreview(vf);
      return;
    }
    const [k, key] = String(b.dataset.rsave || b.dataset.rshare).split('|');
    const f = canReport(k) && repFiles(k).find((x) => x.key === key);
    if (f) openReportDate(f, b.dataset.rsave ? 'save' : 'share');
  });
  $('settingsBtn').addEventListener('click', () => openSettings(false));
  $('scrim').addEventListener('click', () => { if (cfgOk()) closeSheet(); });
  $('cartBar').addEventListener('click', () => openCartSheet());

  let searchTimer = null;
  $('xuatSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q.xuat = e.target.value; state.limit.xuat = PAGE; renderXuat(); }, 150);
  });
  const onSortHead = (e) => {
    const el = e.target.closest('#xuatHead > [data-sort]');
    if (!el) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const key = el.dataset.sort, so = state.sort;
    state.sort = !so || so.key !== key ? { key, dir: 1 } : so.dir === 1 ? { key, dir: -1 } : null;
    save('klanan.xuatSort', state.sort);
    state.limit.xuat = PAGE;
    renderXuat();
  };
  $('xuatHead').addEventListener('click', onSortHead);
  $('xuatSort').addEventListener('change', (e) => {
    const [key, dir] = String(e.target.value || '').split(':');
    state.sort = key ? { key, dir: Number(dir) === -1 ? -1 : 1 } : null;
    save('klanan.xuatSort', state.sort);
    state.limit.xuat = PAGE;
    renderXuat();
  });
  $('xuatHead').addEventListener('keydown', onSortHead);
  $('xuatSearch2').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q.xuat2 = e.target.value; state.limit.xuat = PAGE; renderXuat(); }, 150);
  });
  $('homeSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q.home = e.target.value; renderHomeSearch(); }, 150);
  });
  $('xuatFilterBtn').addEventListener('click', () => openColFilterSheet('xuat'));

  $('xuatFilterChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cfdel]');
    if (!b) return;
    delete state.colf.xuat[state.xuatSrc][b.dataset.cfdel];
    state.limit.xuat = PAGE;
    renderXuat();
  });
  $('onlyAvail').addEventListener('change', () => { state.limit.xuat = PAGE; renderXuat(); });
  // Chọn kho (Tồn vị trí): GIỮ nguyên ô tìm / lọc cột — VD đã gõ "BTP 16" rồi chọn Kho 2 → còn BTP 16 ở TG2 để xuất phiếu.
  $('xuatKho').addEventListener('change', (e) => { state.xuatKho = e.target.value || ''; state.limit.xuat = PAGE; renderXuat(); });
  $('hsdQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hsdq]');
    if (!b) return;
    // Bấm lại nút đang bật = về "Tất cả"
    state.hsdQ = b.dataset.hsdq && state.hsdQ !== b.dataset.hsdq ? b.dataset.hsdq : '';
    save('klanan.hsdQ', state.hsdQ);
    state.limit.xuat = PAGE;
    renderXuat();
  });
  $('onlyMine').addEventListener('change', renderPhieu);
  $('xuatMore').addEventListener('click', () => { state.limit.xuat += PAGE; renderXuat(); });


  // Chạm 1 dòng hàng (ở Kho hoặc kết quả tìm ở Trang chủ) → màn chi tiết + nhập số lượng.
  const openLotFrom = (e) => {
    const b = e.target.closest('[data-lot]');
    if (!b) return;
    if (b.dataset.tong) { // Kho › Tổng: chạm dòng → bảng chi tiết mã (chỉ các dòng đang khớp)
      const w = (state.xuatRows || []).find((x) => x.key === b.dataset.lot && x.src === b.dataset.src);
      if (w) { openTongDetail(w._ma); return; }
    }
    const src = b.dataset.src || state.xuatSrc;
    const lot = (state.lots[src] || []).find((l) => l.key === b.dataset.lot);
    if (!lot) return;
    if (state.multi.on && e.currentTarget === $('xuatList')) {
      if (!canPick(lot)) { toast(pickWhy(lot)); return; }
      if (state.multi.sel.has(lot.key)) state.multi.sel.delete(lot.key); else state.multi.sel.add(lot.key);
      const li = b.closest('.row'); if (li) li.classList.toggle('picked', state.multi.sel.has(lot.key));
      renderMultiBar();
      return;
    }
    openQtySheet(lot);
  };
  // ---- Chọn nhiều ----
  function pickMax(l) { // số còn lấy được (M03: làm tròn xuống theo kiện nguyên)
    const left = Math.max(l.con - cartQty(l.key), 0);
    return l.pack > 0 ? Math.floor(left / l.pack + 1e-9) * l.pack : left;
  }
  function canPick(l) { return pickMax(l) > 0 && !(state.cart && state.cart.items.length && state.cart.module !== l.module); }
  function pickWhy(l) {
    if (state.cart && state.cart.items.length && state.cart.module !== l.module) return `Phiếu đang soạn thuộc ${SRC_LABEL[state.cart.module]} — gửi hoặc hủy phiếu đó trước.`;
    return 'Dòng này không còn số lượng để lấy.';
  }
  function pickedLots() {
    const lots = state.lots[state.xuatSrc] || [];
    return lots.filter((l) => state.multi.sel.has(l.key) && canPick(l));
  }
  function setMulti(on, noRender) {
    state.multi.on = !!on; state.multi.sel.clear();
    document.body.classList.toggle('multi', state.multi.on);
    $('xuatMulti').setAttribute('aria-pressed', String(state.multi.on));
    $('xuatMulti').querySelector('span').textContent = state.multi.on ? 'Thôi chọn' : 'Chọn nhiều';
    if (!noRender) renderAll();
  }
  function renderMultiBar() {
    const bar = $('multiBar');
    const show = state.multi.on && state.tab === 'xuat';
    bar.hidden = !show;
    if (show) $('cartBar').hidden = true;
    if (!show) return;
    const ls = pickedLots();
    const tong = ls.reduce((a, l) => a + pickMax(l), 0);
    const unit = commonUnit(ls.map((l) => l.unit));
    $('multiBarText').innerHTML = ls.length ? `<b>${fmt(ls.length)} dòng</b><span>SL ${fmt(tong)}${unit ? ' ' + esc(unit) : ''}</span>` : 'Chạm các dòng để chọn';
    $('multiAdd').disabled = !ls.length;
    const all = (state.xuatRows || []).filter(canPick);
    $('multiAll').textContent = all.length && all.every((l) => state.multi.sel.has(l.key)) ? 'Bỏ chọn hết' : `Chọn hết (${fmt(all.length)})`;
  }
  $('xuatMulti').addEventListener('click', () => setMulti(!state.multi.on));
  $('multiAll').addEventListener('click', () => {
    const all = (state.xuatRows || []).filter(canPick);
    const allOn = all.length && all.every((l) => state.multi.sel.has(l.key));
    all.forEach((l) => (allOn ? state.multi.sel.delete(l.key) : state.multi.sel.add(l.key)));
    renderXuat();
  });
  $('multiAdd').addEventListener('click', () => {
    const ls = pickedLots();
    if (!ls.length) return;
    if (!state.cart || !state.cart.items.length) state.cart = { id: newId(), module: ls[0].module, ghiChu: '', items: [] };
    let tong = 0;
    ls.forEach((lot) => {
      const qty = pickMax(lot);
      if (!(qty > 0)) return;
      tong += qty;
      const existing = state.cart.items.find((it) => it.key === lot.key);
      if (existing) existing.qty = num(existing.qty) + qty;
      else state.cart.items.push(Object.assign({ key: lot.key, title: lot.title, subs: lot.subs, unit: lot.unit }, lot.item, { qty }));
    });
    saveCart();
    const n = ls.length;
    setMulti(false);
    toast(`Đã thêm ${fmt(n)} dòng (SL ${fmt(tong)}) vào phiếu — sửa số lượng từng dòng trong phiếu nếu cần.`);
  });
  $('xuatList').addEventListener('click', openLotFrom);
  $('homeResults').addEventListener('click', openLotFrom);
  $('khoPicker').addEventListener('click', openKhoPicker);
  $('homeKho').addEventListener('click', (e) => {
    const k = e.target.closest('[data-kho]');
    if (k) { selectKho(k.dataset.kho); return; }
    if (e.target.closest('[data-gotab]')) switchTab('m8');
  });
  $('homeTodo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goseg]');
    if (!b) return;
    state.phieuSeg = b.dataset.goseg;
    switchTab('phieu');
  });
  $('phieuSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pseg]');
    if (!b) return;
    state.phieuSeg = b.dataset.pseg;
    renderPhieu();
  });
  $('phieuDraft').addEventListener('click', (e) => {
    const b = e.target.closest('[data-draft]');
    if (!b) return;
    if (b.dataset.draft === 'open') openCartSheet();
    else { const k = SRC_OF[state.cart && state.cart.module]; if (k) selectKho(k); else switchTab('xuat'); }
  });
  $('phieuMeta').addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('[data-pxmonth]')) { state.phieuMonth = e.target.value; renderPhieu(); }
  });
  $('phieuMeta').addEventListener('click', (e) => {
    const sh = e.target.closest('[data-anshow]');
    if (sh) { state.showHidden = sh.dataset.anshow === '1'; renderPhieu(); return; }
    const all = e.target.closest('[data-anall]');
    if (all) {
      const rows = (phieuGroups()[all.dataset.anall] || []).filter((p) => !hiddenPhieu[p.id]);
      if (!rows.length || !confirm(`Ẩn ${rows.length} phiếu PC đã nhận khỏi danh sách?\nChỉ ẩn trên điện thoại này — PC và Google Sheet không đổi.`)) return;
      const now = Date.now();
      rows.forEach((p) => { hiddenPhieu[p.id] = now; });
      save(LS_HIDDEN, hiddenPhieu); state.showHidden = false;
      toast(`Đã ẩn ${rows.length} phiếu.`); renderPhieu(); renderNavBadge();
    }
  });
  ['phieuList'].forEach((id) => $(id).addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { startEditPhieu(ed.dataset.edit); return; }
    const hu = e.target.closest('[data-huy]');
    if (hu) { huyPhieu(hu.dataset.huy); return; }
    const an = e.target.closest('[data-an]');
    if (an) {
      const p = findPhieu(an.dataset.an);
      if (!p || !confirm(`Ẩn phiếu ${p.maPhieu} khỏi danh sách?\nChỉ ẩn trên điện thoại này — số liệu trên PC và Google Sheet không đổi. Hiện lại được bằng nút "hiện lại" ở đầu danh sách.`)) return;
      hiddenPhieu[p.id] = Date.now(); save(LS_HIDDEN, hiddenPhieu);
      toast(`Đã ẩn phiếu ${p.maPhieu}.`); renderPhieu(); renderNavBadge(); return;
    }
    const un = e.target.closest('[data-unhide]');
    if (un) { delete hiddenPhieu[un.dataset.unhide]; save(LS_HIDDEN, hiddenPhieu); renderPhieu(); renderNavBadge(); return; }
    const ex = e.target.closest('[data-export]');
    if (ex) {
      const p = ((state.phieu && state.phieu.data && state.phieu.data.list) || []).find((x) => String(x.id) === ex.dataset.export);
      if (p) openExportSheet(docFromSheet(p));
      return;
    }
    const b = e.target.closest('[data-open]');
    if (!b) return;
    state.open[b.dataset.open] = !state.open[b.dataset.open];
    renderPhieu();
  }));
  // ---- sự kiện màn Tổng hợp ----
  $('m8KsSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ks]');
    if (!b || b.dataset.ks === M8.ks) return;
    M8.ks = b.dataset.ks; save('klanan.ksTab', M8.ks); M8.limit = PAGE; renderM8();
  });
  $('m8Body').addEventListener('click', (e) => {
    if (e.target.id === 'ksClear') { M8.inp = {}; save('klanan.ksInput', M8.inp); renderM8(); return; }
    if (e.target.id === 'ksMore') { M8.limit += PAGE; M8.ks === 'rules' ? renderKsRules() : renderKsHist(); return; }
    const mk = e.target.closest('[data-ksmk]');
    if (mk) { M8.mk = mk.dataset.ksmk; M8.limit = PAGE; document.querySelectorAll('[data-ksmk]').forEach((b) => b.classList.toggle('is-on', b === mk)); renderKsRules(); }
  });
  $('m8Body').addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.ksf;
    if (f) { M8.inp[f] = e.target.value; save('klanan.ksInput', M8.inp); renderKsResult(); return; }
    if (e.target.id === 'ksRuleQ') { M8.q = e.target.value; M8.limit = PAGE; clearTimeout(searchTimer); searchTimer = setTimeout(renderKsRules, 150); return; }
    if (e.target.id === 'ksHistSort') { M8.hsort = e.target.value; M8.limit = PAGE; renderKsHist(); return; }
    if (e.target.id === 'ksHistQ') { M8.hq = e.target.value; M8.limit = PAGE; clearTimeout(searchTimer); searchTimer = setTimeout(renderKsHist, 150); }
  });
  // Quay lại app sau khi để nền: tải lại màn hình đang xem nếu số liệu đã cũ.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefresh(); });

  // Giữ ô tìm kiếm dính ngay dưới thanh trên dù thanh trên cao bao nhiêu (tai thỏ, cỡ chữ lớn).
  const topbar = document.querySelector('.topbar');
  const setTop = () => document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(setTop).observe(topbar);
  setTop();

  // Nút Back của Android (chỉ có khi chạy trong app Capacitor, cần gói @capacitor/app):
  // đóng bảng trượt → về Trang chủ → thoát app.
  const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (CapApp) {
    CapApp.addListener('backButton', () => {
      if (!$('sheet').hidden) { if (cfgOk()) closeSheet(); return; }
      if (state.tab !== firstTab()) { switchTab(firstTab()); return; }
      CapApp.exitApp();
    });
  }

  // Cài đặt: xóa dữ liệu đã lưu trên máy (khi cần tải lại sạch từ đầu).
  async function clearSavedData() {
    for (const k of CACHE_KEYS) { await store.del(k); state[k] = null; }
    state.stale.clear();
    buildLots(); SOURCES.forEach(buildTonRows);
    renderAll();
  }
  window.__klClearSavedData = clearSavedData;

  // ------------------------------------------------------------------ khởi động
  (async () => {
    $('freshness').textContent = 'Đang mở dữ liệu đã lưu trên máy…';
    try { await loadCaches(); } catch (e) { /* không đọc được bản lưu → tải mới */ }
    applyPerms(); // quyền đã biết lần trước (lưu trên máy) — cập nhật lại từ Web App ở checkUpdates()
    // Chưa từng hỏi quyền (máy vừa cập nhật lên bản có phân quyền): hỏi TRƯỚC khi tải kho, để không gọi kho bị cấm.
    if (cfgOk() && localStorage.getItem(LS_ME) === null) { try { await fetchMe(); } catch (e) { /* AUTH: màn Cài đặt sẽ báo */ } }
    buildLots();
    SOURCES.forEach(buildTonRows);
    switchTab(firstTab());
    if (!cfgOk()) openSettings(true);
    // Báo cho live-update.js: giao diện đã khởi động xong → bản cập nhật vừa tải được CHỐT dùng tiếp.
    window.__KLANAN_READY = true;
  })();
})();
