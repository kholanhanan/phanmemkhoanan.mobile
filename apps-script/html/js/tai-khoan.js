/* Menu Tài khoản (PC 5.7) — NƠI DUY NHẤT quản lý người dùng PC + điện thoại (PC 6.6: đã bỏ trang "Phân quyền điện thoại"), đọc/ghi dữ liệu thật.
   Cấu trúc 1 tài khoản trên màn hình:
     { uid, id, ten, token, quyen:'xem'(Người dùng cấp 1)|'xuat'(cấp 2)|'quanly'(Quản lý)|'quantri'(Quản trị), kho:[mã kho điện thoại], pc:[mã module PC], trangThai:'Bật'|'Tắt' }
   Ánh xạ sang bản ghi phân quyền của main.js (sheets:perm-get / perm-save):
     uid→id nội bộ · id→ten (Tên người dùng) · ten→tenHienThi · trangThai→bat · pc→pcModules
   Quy tắc ID / mã: GIỐNG cleanPermList() trong main.js (sửa 1 bên thì sửa bên kia). */
(function(){
  'use strict';
  // Kho điện thoại — GIỐNG PQ_KHO trong main.js
  var KHO = [['M01','Tồn kho An An'],['M01VT','Tồn vị trí'],['M01VTB','Vị trí Bột'],['M02','Tồn kho gửi'],['M08','Tra cứu kháng sinh'],['BC01','Báo cáo Tồn kho An An'],['BC02','Báo cáo Tồn kho gửi'],['M03','NXT Bột/Sốt'],['M04','NXT TNK/TGC'],['LX','Lịch xuất nhập hàng'],['C3D','Xếp cont 3D (điện thoại)'],['SCAN','Scan tài liệu (điện thoại)'],['QR','Tạo mã QR (điện thoại)'],['LT','Lưu trữ cá nhân (điện thoại)']];
  // Module trên PC (menu trái) + quyền riêng từng mục Cài đặt (PC 6.7) — GIỐNG PQ_PC trong main.js. Mục Cài đặt › Giao diện: mọi tài khoản đều dùng được, không có ô tick.
  var PC = [['M01','01 · Tồn An An (Load Data chính, Phân Loại…)'],['M01VT','01 · Tồn theo vị trí'],['M01VTB','01 · Vị trí bột'],['M02','02 · Tồn Kho Gửi'],['M03','03 · NXT Bột/Sốt'],['M04','04 · NXT TNK/TGC'],['M13','05 · Phiếu nhập/xuất kho'],['M08RD','06 · Báo cáo rã đông'],['M05','07.1 · Đối chiếu số liệu › Số liệu kiểm kê'],['M07','07.2 · Đối chiếu số liệu › Số liệu cuối kỳ'],['M16','07.3 · Đối chiếu hàng ngày'],['M06','08 · In Chứng Từ Kho'],['M15','08.1 · Scan tài liệu (chụp / chọn ảnh, PDF → làm trắng → lưu PDF)'],['M08','09 · Tổng Hợp'],['M09','10 · Phiếu Xuất Toàn Hệ Thống'],['CD_DONGBO','11 · Đồng bộ điện thoại (menu Công cụ + Cài đặt chung › Kết nối & cấu hình) — chỉ đồng bộ module được phân quyền'],['M14','12 · Container Loading 3D (xếp hàng container lạnh 3D)'],['M17','08.2 · Tạo mã QR (đơn lẻ · hàng loạt từ Excel · in tem A4)'],['M18','08.3 · Quản lý file (đổi tên hàng loạt · sắp xếp · file trùng — chỉ trong thư mục chọn)'],['M19','08.4 · Lưu trữ cá nhân (khung chat lưu tin nhắn / ảnh / file riêng, đồng bộ điện thoại)'],['LX_EMAIL','Trang chính › Lịch xuất nhập hàng: duyệt email'],['CD_SAOLUU','Sao lưu Drive — TOÀN QUYỀN trong menu "Sao lưu & Drive" (sao lưu lên Drive, đổi thư mục / lịch, khôi phục cả cài đặt chung)'],['CD_KHOIPHUC','Khôi phục Drive — khôi phục database từ Google Drive (chỉ module được phân quyền), KHÔNG được sao lưu lên Drive'],['TAIKHOAN','Cài đặt › Tài khoản (quản lý người dùng)']];
  // Kho điện thoại → module PC tương ứng (nút "Lấy theo kho điện thoại")
  var KHO2PC = { M01:'M01', M01VT:'M01VT', M01VTB:'M01VTB', BC01:'M01', M02:'M02', BC02:'M02', M03:'M03', M04:'M04', M08:'M08', C3D:'M14', SCAN:'M15', QR:'M17', LT:'M19' };
  // PC 7.14 — 4 vai trò. Giá trị lưu giữ 'xem' / 'xuat' / 'quantri' (tương thích Sheet + điện thoại), thêm 'quanly'.
  var ROLE_TXT = { xem:'Người dùng', xuat:'Người dùng', quanly:'Quản lý', quantri:'Quản trị' };
  // PC 8.21 — biểu tượng riêng từng vai trò (huy hiệu mẫu A): mắt · tài liệu xuất · thanh trượt · khiên · vương miện (admin)
  var RIC = {
    xem:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    xuat:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-5M9.5 14.5 12 12l2.5 2.5"/>',
    quanly:'<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    quantri:'<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    admin:'<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>'
  };
  function roleIc(u, cls){ return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + (RIC[(u.id && String(u.id).toLowerCase() === 'admin') ? 'admin' : u.quyen] || RIC.xem) + '</svg>'; }
  var ROLE_TIP = { xem:'Người dùng cấp 1 — chỉ xem', xuat:'Người dùng cấp 2 — xem + xuất phiếu', quanly:'Quản lý — thao tác đủ theo module được cấp (có thể được Quản trị / admin cấp quyền quản lý tài khoản cấp 1 & 2)', quantri:'Quản trị — toàn quyền toàn hệ thống' };
  var ROLE_HINT = {
    xem:'Người dùng cấp 1: chỉ XEM dữ liệu trong module được cấp — không xóa / sửa / nhập / xuất. Không có mục Cài đặt nào.',
    xuat:'Người dùng cấp 2: XEM + XUẤT PHIẾU (module 08 In Chứng Từ Kho; điện thoại tạo phiếu) — không xóa / sửa / nhập. Không có mục Cài đặt nào.',
    quanly:'Quản lý: xóa / sửa / nhập / xuất đầy đủ trong module được cấp. Cài đặt: chỉ mục được tick. Mục Tài khoản chỉ hiện khi Quản trị / admin tick riêng — khi đó chỉ tạo / xem mã / sửa / xóa được tài khoản cấp 1 & 2.',
    quantri:'Quản trị: toàn quyền toàn hệ thống như admin. Được bỏ tick module PC / kho điện thoại không dùng để ẩn đi (tick lại là hiện); các ô Sao lưu, Khôi phục, Đồng bộ và Tài khoản luôn bật. Chỉ tài khoản admin mới tạo / sửa / xóa được tài khoản Quản trị.'
  };
  var esc = function(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var $ = function(id){ return document.getElementById(id); };

  /* ====== LỚP DỮ LIỆU (đã kết nối) ======
     Đọc : window.sheetsSyncAPI.permGet()  → IPC 'sheets:perm-get'  (danh sách + mã gốc, đã gộp tab PhanQuyen trên Sheet;
           luôn có tài khoản admin mặc định).
     Ghi : window.sheetsSyncAPI.permSave(list) → IPC 'sheets:perm-save' (lưu máy + đẩy tab PhanQuyen; mã yếu như admin/admin
           chỉ ở trên máy PC, không lên Sheet). Quy tắc kiểm tra nằm ở main.js › cleanPermList (trang này kiểm tra trước cho nhanh). */
  var API = window.sheetsSyncAPI;
  var mem = [];
  var loaded = false;
  // Bỏ dấu tiếng Việt + khoảng trắng → gợi ý tên người dùng: "Tuấn kho 2" → "tuankho2".
  function toUserId(t){ return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9._-]/g, '').toLowerCase().slice(0, 40); }
  var migrated = 0; // số tài khoản cũ (tên có dấu, chưa có Tên hiển thị) vừa được gợi ý Tên người dùng không dấu
  // Mã cũ "CAIDAT" (trước PC 6.7) = đủ 5 quyền con của Cài đặt → hiện đã tick từng ô; lưu lại thì main.js ghi dạng mới.
  var CD_ALL = ['CD_SAOLUU','CD_KHOIPHUC','CD_DONGBO']; // PC 7.3: mục cơ bản (Giao diện, Trợ lý AI, Cập nhật, Mạng LAN, Khôi phục) không còn phân quyền
  function expandPc(v){
    var a = Array.isArray(v) ? v.slice() : [];
    if(a.indexOf('CAIDAT') !== -1) a = a.filter(function(m){ return m !== 'CAIDAT'; }).concat(CD_ALL);
    return a.filter(function(m, i){ return a.indexOf(m) === i && PC.some(function(x){ return x[0] === m; }); }); // bỏ mã cũ không còn trong bảng (CD_KHOIPHUC…)
  }
  function toUI(p){
    // Tài khoản tạo trước khi có "Tên hiển thị": tên cũ → Tên hiển thị; tên cũ có dấu / dấu cách (không dùng làm ID được) → gợi ý ID không dấu.
    var ten = p.ten, hien = p.tenHienThi;
    if(!hien){ hien = ten; if(!/^[A-Za-z0-9._-]{1,40}$/.test(String(ten || ''))){ migrated++; ten = toUserId(ten) || ('user' + migrated); } }
    p = Object.assign({}, p, { ten:ten, tenHienThi:hien });
    return { uid:p.id, id:p.ten, ten:p.tenHienThi || p.ten, token:p.token || '', quyen:p.quyen || 'xem',
      kho:Array.isArray(p.kho) ? p.kho : [], pc:expandPc(p.pcModules),
      trangThai:p.bat === false ? 'Tắt' : 'Bật', tuDat:!!p.tuDat };
  }
  function toPerm(u){
    return { id:u.uid, ten:u.id, tenHienThi:u.ten, token:u.token, quyen:u.quyen, kho:u.kho, pcModules:u.pc,
      bat:u.trangThai === 'Bật', tuDat:!!u.tuDat };
  }
  var STORE = {
    list: function(){ return mem; },
    // Đọc lại từ máy + Sheet. Trả về { ok, error }.
    load: async function(){
      if(!API || !API.permGet) return { ok:false, error:'Không tìm thấy cầu nối dữ liệu (sheetsSyncAPI) — mở trang này trong app Kho Lạnh.' };
      var res = await API.permGet();
      if(!res || !res.ok) return { ok:false, error:(res && res.error) || 'Không đọc được danh sách tài khoản.' };
      migrated = 0; mem = (res.list || []).map(toUI); loaded = true;
      return { ok:true };
    },
    // Lưu cả danh sách. Trả về { ok, error, pushed, warning }; thành công thì mem = danh sách đã chuẩn hóa bởi main.js.
    // PC 7.95: confirmLost = người dùng đã xác nhận XÓA các tài khoản sẽ biến mất khỏi Google Sheet
    saveAll: async function(arr, confirmLost){
      if(!API || !API.permSave) return { ok:false, error:'Không tìm thấy cầu nối dữ liệu (sheetsSyncAPI).' };
      var res = await API.permSave(arr.map(toPerm), confirmLost ? { confirmLost:true } : undefined);
      if(res && res.needConfirm) return { ok:false, needConfirm:true, lost:res.lost || [], error:res.error || '' };
      if(!res || !res.ok) return { ok:false, error:(res && res.error) || 'Lưu thất bại.' };
      mem = (res.list || []).map(toUI); loaded = true;
      return { ok:true, pushed:!!res.pushed, warning:res.warning || '' };
    }
  };
  window.KLA_TK_STORE = STORE;

  /* ====== QUY TẮC ====== */
  function idError(v, cur){
    if(!v) return 'Nhập Tên người dùng.';
    if(!/^[A-Za-z0-9._-]{1,40}$/.test(v)) return 'Tên người dùng chỉ gồm chữ không dấu, số, . _ - (tối đa 40 ký tự).';
    var dup = STORE.list().find(function(u){ return u.id.toLowerCase() === v.toLowerCase() && u !== cur; });
    return dup ? 'Tên người dùng này đã có.' : '';
  }
  function tokError(t, cur){
    if(!t) return 'Nhập mã truy cập.';
    if(cur && t === cur.token && t.length < 8) return ''; // giữ nguyên mã mặc định cũ (admin) — chỉ cảnh báo, không chặn
    if(/\s/.test(t)) return 'Mã không được có dấu cách.';
    if(t.length < 8) return 'Mã quá ngắn (' + t.length + ' ký tự) — tối thiểu 8.';
    if(t.length > 64) return 'Mã quá dài — tối đa 64 ký tự.';
    if(!/^[A-Za-z0-9\-_.@#!]+$/.test(t)) return 'Mã chỉ dùng chữ không dấu, số và - _ . @ # !';
    var dup = STORE.list().find(function(u){ return String(u.token).toLowerCase() === t.toLowerCase() && u !== cur; });
    return dup ? 'Mã này đang là mã của "' + (dup.ten || dup.id) + '".' : '';
  }
  function genToken(){
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', s = '';
    try{ var r = new Uint32Array(14); crypto.getRandomValues(r); for(var i=0;i<14;i++) s += a[r[i] % a.length]; }
    catch(e){ for(var j=0;j<14;j++) s += a[Math.floor(Math.random()*a.length)]; }
    return s;
  }

  /* ====== BẢNG ====== */
  var shown = {}; // id → đang hiện mã
  // PC 8.52: MÀU RIÊNG từng nhóm quyền (ô tick + chip) — cùng nhóm cùng màu, khác nhóm khác màu, đỡ rối mắt. Số = góc màu HSL; css/tai-khoan.css › [style*="--hue"].
  var HUE = { M01:210, M01VT:210, M01VTB:210, M02:150, M03:38, M04:18, M05:265, M07:265, M16:265, M08RD:190, M06:330, M08:85, M09:235, CD_DONGBO:55, M13:350, M14:165, M15:155, M17:285, M18:35, M19:200, LT:200, SCAN:155, LX_EMAIL:200, CD_SAOLUU:0, CD_KHOIPHUC:0, TAIKHOAN:0, BC01:225, BC02:165, LX:200, C3D:165 };
  function hueAttr(code){ return HUE[code] != null ? ' style="--hue:' + HUE[code] + '"' : ''; }
  function chips(arr, all, cls){
    if(!arr || !arr.length) return '<span class="tk-chip none">không có</span>';
    if(arr.length === all.length) return '<span class="tk-chip ' + cls + '">Tất cả (' + all.length + ')</span>';
    return arr.map(function(c){ return '<span class="tk-chip ' + cls + '"' + hueAttr(c) + '>' + esc(c) + '</span>'; }).join('');
  }
  // Tài khoản "admin" mặc định: không có nút Xóa (main.js / trang này vẫn chặn xóa nếu bị gọi bằng cách khác).
  function isAdminId(id){ return String(id).toLowerCase() === 'admin'; }
  // PC 7.0: "admin" là tài khoản chính — người đăng nhập KHÔNG phải admin (kể cả Quản trị) không xem được mã, không sửa được dòng admin
  // (dòng bị làm mờ; main.js còn giấu mã admin khỏi danh sách và giữ nguyên bản ghi admin khi lưu).
  var viewerAdmin = false, viewerRole = '', viewerPc = [], viewerKho = [], viewerName = '';
  // PC 7.15 — CẤP ĐỘ: 1 cấp 1 · 2 cấp 2 · 3 Quản lý · 4 Quản trị · 5 admin chính. Không xem mã / sửa / xóa được tài khoản CÙNG CẤP hoặc CAO HƠN mình
  // (Quản trị: khóa admin + Quản trị như trước; Quản lý có quyền Tài khoản: khóa cả Quản lý, Quản trị, admin — kể cả chính mình; đổi mã của mình ở mục Đổi mã).
  var LV = { xem:1, xuat:2, quanly:3, quantri:4 };
  function lvOf(u){ return isAdminId(u.id) ? 5 : (LV[u.quyen] || 1); }
  function viewerLv(){ return viewerAdmin ? 5 : (LV[viewerRole] || 1); }
  // PC 7.17: tài khoản QUẢN TRỊ (không phải admin) được xem + đổi MÃ / TÊN HIỂN THỊ của chính mình (không đổi được vai trò / trạng thái / quyền, không xóa).
  function isSelfQT(u){ return !viewerAdmin && viewerLv() === 4 && !!viewerName && String(u.id).toLowerCase() === viewerName; }
  function locked(u){ return !viewerAdmin && !isSelfQT(u) && lvOf(u) >= Math.min(viewerLv(), 4); }
  function lockLabel(){ return viewerLv() >= 4 ? 'Chỉ admin' : 'Cấp cao hơn'; }
  function lockTip(u){ return isAdminId(u.id) ? 'Tài khoản chính — chỉ admin xem / sửa được' : (viewerLv() >= 4 ? 'Tài khoản Quản trị — chỉ admin sửa / xóa được' : 'Cùng cấp hoặc cao hơn bạn — không được xem mã / sửa / xóa'); }
  // Cột quyền (kho điện thoại / module PC) MẶC ĐỊNH THU GỌN: chỉ hiện nút "▸ Xem (n)"; bấm vào mới bung danh sách quyền của dòng đó.
  // Bấm tiêu đề cột = bung / thu cả cột. Trạng thái bung chỉ nằm trong trang (mở lại tab là thu gọn lại).
  var peeked = {};   // 'id|kho' | 'id|pc' → true
  var peekAll = { kho:false, pc:false };
  function peek(u, col, arr, all, cls){
    var key = u.id + '|' + col, open = peekAll[col] || !!peeked[key];
    var n = (arr && arr.length) || 0;
    var label = n === all.length ? 'Tất cả (' + n + ')' : (n ? n + ' quyền' : 'không có');
    return '<button type="button" class="tk-peek' + (open ? ' on' : '') + '" data-a="peek" data-col="' + col + '" title="Bấm để ' + (open ? 'thu gọn' : 'xem chi tiết') + '">' + (open ? '▾' : '▸') + ' ' + esc(label) + '</button>'
      + (open ? '<div class="tk-chipbox">' + chips(arr, all, cls) + '</div>' : '');
  }
  var IC = {
    eye:'<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff:'<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.3 6.3A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    edit:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
    trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    lock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };
  function render(){
    var q = $('fQ').value.trim().toLowerCase(), fr = $('fRole').value, fs = $('fState').value;
    var all = STORE.list();
    var rows = all.filter(function(u){
      return (!q || (u.id + ' ' + u.ten).toLowerCase().indexOf(q) !== -1) && (!fr || u.quyen === fr) && (!fs || u.trangThai === fs);
    });
    $('tkTable').querySelector('tbody').innerHTML = rows.map(function(u){
      var lk = locked(u), vis = !lk && !!shown[u.id], on = u.trangThai === 'Bật';
      var nm = String(u.ten || u.id || '?'), hue = 0, i;
      for(i = 0; i < String(u.id).length; i++) hue = (hue * 31 + String(u.id).charCodeAt(i)) % 360;
      var avatar = '<span class="tk-avatar r-' + esc(u.quyen) + '" style="--h:' + hue + '" aria-hidden="true">' + esc(nm.trim().charAt(0).toUpperCase()) + '<span class="tk-pin">' + roleIc(u, 'tk-ri') + '</span></span>';
      var tokBtn = lk ? '' : '<button type="button" class="tk-icon-btn" data-a="eye" title="' + (vis ? 'Ẩn mã' : 'Hiện mã') + '" aria-label="' + (vis ? 'Ẩn mã' : 'Hiện mã') + '">' + (vis ? IC.eyeOff : IC.eye) + '</button>';
      var acts = lk ? '<span class="tk-lock">' + IC.lock + ' ' + lockLabel() + '</span>'
        : '<button type="button" class="tk-icon-btn" data-a="edit" title="Sửa tài khoản" aria-label="Sửa">' + IC.edit + '</button>'
          + ((isAdminId(u.id) || isSelfQT(u)) ? '' : '<button type="button" class="tk-icon-btn tk-icon-danger" data-a="del" title="Xóa tài khoản" aria-label="Xóa">' + IC.trash + '</button>');
      return '<tr data-id="' + esc(u.id) + '"' + (lk ? ' class="tk-locked" title="' + lockTip(u) + '"' : '') + '>'
        + '<td><div class="tk-user">' + avatar + '<span class="tk-user-txt"><b>' + esc(u.ten || u.id) + '</b><small>@' + esc(u.id) + '</small></span></div></td>'
        + '<td><span class="tk-tokbox"><span class="tk-tok">' + (vis ? esc(u.token) : '••••••••') + '</span>' + tokBtn + '</span></td>'
        + '<td><span class="tk-role ' + esc(u.quyen) + '" title="' + esc(ROLE_TIP[u.quyen] || '') + '">' + roleIc(u, 'tk-ri') + esc(ROLE_TXT[u.quyen] || u.quyen) + '</span>' + (u.quyen === 'xem' || u.quyen === 'xuat' ? '<small class="tk-lv">cấp ' + (u.quyen === 'xem' ? '1' : '2') + '</small>' : '') + '</td>'
        + '<td>' + peek(u, 'kho', u.kho, KHO, '') + '</td><td>' + peek(u, 'pc', u.pc, PC, 'pc') + '</td>'
        + '<td><span class="tk-state ' + (on ? 'on' : 'off') + '"><i></i>' + esc(u.trangThai) + '</span></td>'
        + '<td class="tk-actions">' + acts + '</td></tr>';
    }).join('');
    $('tkEmpty').hidden = rows.length > 0;
    $('kTotal').textContent = all.length;
    $('kOn').textContent = all.filter(function(u){ return u.trangThai === 'Bật'; }).length;
    $('kOff').textContent = all.filter(function(u){ return u.trangThai !== 'Bật'; }).length;
    $('kAdmin').textContent = all.filter(function(u){ return u.quyen === 'quantri'; }).length;
    renderBanner();
  }
  var saveNote = null; // { kind:'ok'|'warn'|'err', text } — kết quả lần lưu gần nhất
  function weakUsers(){ return STORE.list().filter(function(u){ return !locked(u) && String(u.token).length < 8; }); }
  // PC 6.9: không còn khung "Đã kết nối dữ liệu thật" — khung này CHỈ hiện khi có điều cần chú ý (lưu chưa lên Sheet, lưu lỗi, tài khoản cũ, mã yếu).
  function renderBanner(){
    if(!loaded) return; // chưa đọc xong dữ liệu thì chưa hiện gì
    $('tkInfo').textContent = STORE.list().length + ' tài khoản';
    var weak = weakUsers(), el = $('tkBanner'), parts = [], title = '';
    if(saveNote && saveNote.kind === 'warn'){ title = '⚠ Đã lưu trên máy — chưa đẩy lên Sheet'; parts.push(esc(saveNote.text)); }
    if(saveNote && saveNote.kind === 'err'){ title = '⚠ Lưu không thành công'; parts.push(esc(saveNote.text)); }
    if(migrated){ parts.push('⚠ ' + migrated + ' tài khoản cũ có tên có dấu đã được gợi ý Tên người dùng không dấu — bấm Sửa từng tài khoản, kiểm tra rồi Lưu, và báo người đó nhập Tên người dùng mới khi đăng nhập.'); }
    if(weak.length){
      parts.push('🔑 <b>' + weak.map(function(u){ return esc(u.id); }).join(', ') + '</b> đang dùng mã mặc định/ngắn (dưới 8 ký tự): chỉ dùng được trên PC, <b>chưa đưa lên Sheet nên điện thoại chưa đăng nhập được</b>. Bấm Sửa và đổi sang mã ≥ 8 ký tự để dùng cả điện thoại.');
    }
    if(!parts.length){ el.hidden = true; el.innerHTML = ''; return; }
    el.className = 'tk-banner warn';
    el.innerHTML = (title ? '<b>' + title + '</b>' : '') + parts.map(function(t){ return '<span>' + t + '</span>'; }).join('');
    el.hidden = false;
  }
  function setNote(kind, text){ saveNote = text ? { kind:kind, text:text } : null; }
  function showFatal(msg){
    var el = $('tkBanner'); el.className = 'tk-banner err'; el.hidden = false;
    el.innerHTML = '<b>⛔ Không đọc được tài khoản</b><span>' + esc(msg) + '</span>';
  }

  /* ====== HỘP THÊM / SỬA ====== */
  var editing = null; // bản ghi đang sửa; null = thêm mới
  // PC 8.76 — Bảng ma trận phân quyền: mỗi dòng 1 chức năng, 2 cột Điện thoại / PC. Ô tick vẫn là input name="kho" / name="pc"
  // (picked / applyRoleRules / dCopy dùng nguyên). Ô "tick tất cả" (class tk-all, không có name) ở tiêu đề cột và đầu mỗi nhóm.
  // Mỗi dòng: [nhóm, tên hiển thị, mã kho ĐT hoặc '', mã module PC hoặc '', ghi chú nhỏ]
  // PC 0.25 — 4 NHÓM GIỐNG 4 MỤC MENU TRÁI của Tổng quan (Tồn kho · Chức năng · Công cụ · Hệ thống), thứ tự dòng theo menu.
  // Mục chỉ có trên điện thoại (BC01, BC02, M08 Tra cứu kháng sinh, LX) xếp vào nhóm gần nghĩa nhất; cột không áp dụng hiện "—".
  var MATRIX = [
    ['Tồn kho','Tồn kho An An','M01','M01','PC: Load Data chính, Phân Loại, Báo Cáo, Đặc Tính, Tổng Hợp'],
    ['Tồn kho','Tồn theo vị trí','M01VT','M01VT',''],
    ['Tồn kho','Vị trí Bột','M01VTB','M01VTB',''],
    ['Tồn kho','Tồn kho gửi','M02','M02',''],
    ['Tồn kho','NXT Bột/Sốt','M03','M03',''],
    ['Tồn kho','NXT TNK/TGC','M04','M04',''],
    ['Tồn kho','Báo cáo Tồn kho An An','BC01','',''],
    ['Tồn kho','Báo cáo Tồn kho gửi','BC02','',''],
    ['Chức năng','Phiếu nhập/xuất kho','','M13',''],
    ['Chức năng','Báo cáo rã đông','','M08RD',''],
    ['Chức năng','Số liệu kiểm kê','','M05','Đối chiếu số liệu'],
    ['Chức năng','Số liệu cuối kỳ','','M07','Đối chiếu số liệu'],
    ['Chức năng','Đối chiếu hàng ngày','','M16','Quyền riêng, database M16_DoiChieuHangNgay (trước là M12)'],
    ['Chức năng','In chứng từ kho','','M06',''],
    ['Chức năng','Tổng hợp','','M08',''],
    ['Chức năng','Tra cứu kháng sinh','M08','',''],
    ['Chức năng','Lịch xuất nhập hàng','LX','',''],
    ['Chức năng','Lịch xuất nhập hàng: duyệt email','','LX_EMAIL','Trang chính'],
    ['Công cụ','Scan tài liệu','SCAN','M15','Chụp / chọn ảnh, PDF → làm trắng nền → lưu PDF. Không ghi dữ liệu kho'],
    ['Công cụ','Container 3D (xếp cont)','C3D','M14',''],
    ['Công cụ','Tạo mã QR','QR','M17','Tạo mã QR đơn lẻ / hàng loạt từ Excel / in tem A4. Chạy offline, không ghi dữ liệu kho'],
    ['Công cụ','Quản lý file','','M18','Đổi tên hàng loạt, sắp xếp file, tìm file trùng — chỉ trong thư mục người dùng chọn trên máy này, không đụng dữ liệu kho'],
    ['Công cụ','Lưu trữ cá nhân','LT','M19','Khung chat riêng của từng tài khoản: lưu tin nhắn, ảnh, file; đồng bộ điện thoại qua LAN + Google Drive. Chỉ Quản lý trở lên bật / tắt máy chủ LAN'],
    ['Hệ thống','Phiếu xuất hệ thống','','M09',''],
    ['Hệ thống','Đồng bộ điện thoại','','CD_DONGBO','Menu Hệ thống + Cài đặt chung › Kết nối & cấu hình, chỉ đồng bộ module được phân quyền'],
    ['Hệ thống','Sao lưu Drive','','CD_SAOLUU','Toàn quyền trong menu \"Sao lưu & Drive\"'],
    ['Hệ thống','Khôi phục Drive','','CD_KHOIPHUC','Khôi phục database từ Drive (module được phân quyền), không được sao lưu lên Drive'],
    ['Hệ thống','Tài khoản','','TAIKHOAN','Cài đặt › Tài khoản (quản lý người dùng)']
  ];
  var MX_COLOR = { 'Tồn kho':'blue', 'Chức năng':'green', 'Công cụ':'gold', 'Hệ thống':'red' }; // cùng màu nhóm menu trái
  function pcNo(code){ var t = ''; PC.some(function(x){ if(x[0] === code){ var m = /^(\d+(?:\.\d+)?) · /.exec(x[1]); t = m ? m[1] : ''; return true; } return false; }); return t; }
  function buildMatrix(selKho, selPc){
    var cell = function(name, code, sel){
      if(!code) return '<td class="c"><span class="tk-mx-na">—</span></td>';
      return '<td class="c"><input type="checkbox" name="' + name + '" value="' + esc(code) + '"' + (sel.indexOf(code) !== -1 ? ' checked' : '') + ' aria-label="' + esc(code) + '"></td>';
    };
    var out = ['<thead><tr><th>Chức năng</th>',
      '<th class="c"><label class="tk-mx-th"><input type="checkbox" class="tk-all" data-all="kho" aria-label="Chọn tất cả điện thoại"><span>Điện thoại</span></label></th>',
      '<th class="c"><label class="tk-mx-th"><input type="checkbox" class="tk-all" data-all="pc" aria-label="Chọn tất cả PC"><span>PC</span></label></th></tr></thead><tbody>'];
    var last = '', gi = 0;
    MATRIX.forEach(function(r){
      if(r[0] !== last){
        last = r[0]; gi++;
        out.push('<tr class="tk-mx-g" data-g="' + gi + '" data-c="' + (MX_COLOR[r[0]] || '') + '"><td>' + esc(r[0]) + '</td>' +
          '<td class="c"><input type="checkbox" class="tk-all" data-all="kho" data-g="' + gi + '" aria-label="Tất cả điện thoại — ' + esc(r[0]) + '"></td>' +
          '<td class="c"><input type="checkbox" class="tk-all" data-all="pc" data-g="' + gi + '" aria-label="Tất cả PC — ' + esc(r[0]) + '"></td></tr>');
      }
      var codes = (r[2] && r[3] && r[2] !== r[3]) ? r[2] + ' · ' + r[3] : (r[2] || r[3]);
      var no = r[3] ? pcNo(r[3]) : '';
      out.push('<tr class="tk-mx-r" data-g="' + gi + '"' + (r[4] ? ' title="' + esc(r[4]) + '"' : '') + '><td><div class="tk-mx-n"><b>' + esc(codes) + '</b><span>' + esc(r[1]) + (no ? ' <i>' + esc(no) + '</i>' : '') + '' + '</span></div></td>' +
        cell('kho', r[2], selKho) + cell('pc', r[3], selPc) + '</tr>');
    });
    out.push('</tbody>');
    $('dMatrix').innerHTML = out.join('');
    syncAll();
  }
  // Cập nhật trạng thái các ô "tick tất cả" (đủ / một phần / không / khóa) theo các ô con đang mở được.
  function syncAll(){
    var tb = $('dMatrix'); if(!tb) return;
    Array.prototype.forEach.call(tb.querySelectorAll('input.tk-all'), function(a){
      var sel = 'tr.tk-mx-r' + (a.dataset.g ? '[data-g="' + a.dataset.g + '"]' : '') + ' input[name=' + a.dataset.all + ']';
      var boxes = Array.prototype.filter.call(tb.querySelectorAll(sel), function(c){ return !c.disabled; });
      var on = boxes.filter(function(c){ return c.checked; }).length;
      a.disabled = !boxes.length; a.checked = !!boxes.length && on === boxes.length; a.indeterminate = on > 0 && on < boxes.length;
    });
  }
  function onMatrixChange(e){
    var t = e.target; if(!t || t.type !== 'checkbox') return;
    if(t.classList.contains('tk-all')){
      var sel = 'tr.tk-mx-r' + (t.dataset.g ? '[data-g="' + t.dataset.g + '"]' : '') + ' input[name=' + t.dataset.all + ']';
      Array.prototype.forEach.call($('dMatrix').querySelectorAll(sel), function(c){ if(!c.disabled) c.checked = t.checked; });
    }
    syncAll();
  }
  function picked(name){ return Array.prototype.map.call(document.querySelectorAll('input[name=' + name + ']:checked'), function(c){ return c.value; }); }
  function openDlg(u){
    if(u && locked(u)) return; // không phải admin → không mở được hộp sửa của admin
    editing = u || null;
    $('tkDlgTitle').textContent = u ? 'Sửa tài khoản "' + u.id + '"' : 'Thêm tài khoản';
    $('dId').value = u ? u.id : ''; $('dName').value = u ? u.ten : '';
    $('dTok').value = u ? u.token : genToken(); $('dRole').value = u ? u.quyen : 'xem';
    $('dOn').checked = u ? u.trangThai === 'Bật' : true;
    buildMatrix(u ? u.kho : [], u ? u.pc : []);
    // Tài khoản "admin" mặc định: không đổi tên đăng nhập (luôn còn lối vào mục Tài khoản trong Cài đặt)
    $('dId').disabled = !!(u && (String(u.id).toLowerCase() === 'admin' || isSelfQT(u)));
    // PC 7.0: admin luôn Quản trị, luôn Bật, đủ mọi quyền — khóa các ô, chỉ cho đổi Tên hiển thị và mã truy cập
    var adm = !!(u && isAdminId(u.id));
    $('dRole').disabled = adm; $('dOn').disabled = adm;
    if(adm){
      $('dRole').value = 'quantri'; $('dOn').checked = true;
      buildMatrix(KHO.map(function(k){ return k[0]; }), PC.map(function(k){ return k[0]; }));
      Array.prototype.forEach.call(document.querySelectorAll('input[name=kho], input[name=pc]'), function(c){ c.disabled = true; });
      $('tkDlgTitle').textContent = 'Sửa tài khoản "admin" (tài khoản chính — toàn quyền, không đổi được quyền / trạng thái)';
    }
    $('dCopy').disabled = adm;
    var selfQT = !!(u && isSelfQT(u)); // Quản trị tự sửa mình: chỉ Tên hiển thị + mã truy cập
    if(selfQT){
      $('dRole').disabled = true; $('dOn').disabled = true; $('dOn').checked = u.trangThai === 'Bật';
      $('tkDlgTitle').textContent = 'Sửa tài khoản của bạn "' + u.id + '" (đổi được Tên hiển thị, mã truy cập và tick ẩn / hiện module, kho)';
    }
    Array.prototype.forEach.call($('dRole').options, function(o){
      if(o.value === 'quantri') o.disabled = !viewerAdmin && !(u && u.quyen === 'quantri'); // chỉ admin tạo / nâng lên Quản trị
      if(o.value === 'quanly') o.disabled = !viewerAdmin && viewerLv() < 4; // PC 7.15: Quản lý (có quyền Tài khoản) chỉ tạo được cấp 1 & 2
    });
    lastRole = u ? u.quyen : '';
    applyRoleRules();
    $('dErr').hidden = true; $('tkModal').hidden = false; ($('dId').disabled ? $('dName') : $('dId')).focus();
  }
  // PC 7.14: ô quyền theo vai trò — Quản trị: đủ kho + đủ module (khóa); cấp 1 / 2: không có mục Cài đặt; Quản lý: không có "Tài khoản".
  var lastRole = ''; // vai trò trước đó của hộp thoại (đổi sang Quản trị lần đầu thì tick đủ, sau đó giữ nguyên lựa chọn)
  var FIXED_PC = ['CD_SAOLUU', 'CD_KHOIPHUC', 'CD_DONGBO', 'TAIKHOAN', 'LX_EMAIL']; // Quản trị luôn có — Quản trị không tự khóa mình khỏi Cài đặt / Tài khoản
  function applyRoleRules(){
    var r = $('dRole').value;
    var adminRec = !!(editing && isAdminId(editing.id));
    $('dRole').title = ROLE_HINT[r] || '';
    Array.prototype.forEach.call(document.querySelectorAll('input[name=kho], input[name=pc]'), function(c){
      var isPc = c.name === 'pc', v = c.value;
      if(r === 'quantri'){
        // PC 7.43: admin chính khóa đủ; Quản trị khác tự bỏ tick module / kho được (ẩn), riêng quyền Cài đặt + Tài khoản luôn bật
        var fixed = isPc && FIXED_PC.indexOf(v) !== -1;
        if(adminRec || fixed){ c.checked = true; c.disabled = true; c.title = fixed && !adminRec ? 'Quản trị luôn có quyền này (không ẩn được)' : ''; return; }
        if(lastRole !== 'quantri') c.checked = true;
        c.disabled = false; c.title = 'Bỏ tick = ẩn, tick lại = hiện'; return;
      }
      if(isPc && v === 'TAIKHOAN'){ // PC 7.16: chỉ Quản lý mới được cấp; tài khoản Quản trị (hoặc admin) tick được
        if(r === 'quanly'){
          var canGrant = viewerLv() >= 4;
          if(!canGrant) c.checked = !!(editing && editing.quyen === 'quanly' && editing.pc.indexOf('TAIKHOAN') !== -1);
          c.disabled = !canGrant;
          c.title = canGrant ? 'Cho phép Quản lý này tạo / xem mã / sửa / xóa tài khoản người dùng cấp 1 & 2' : 'Chỉ tài khoản Quản trị / admin chỉ định quyền này';
          return;
        }
        c.checked = false; c.disabled = true; c.title = 'Chỉ vai trò Quản lý (do Quản trị / admin chỉ định) hoặc Quản trị'; return;
      }
      if(isPc && (v === 'CD_SAOLUU' || v === 'CD_KHOIPHUC' || v === 'CD_DONGBO') && r !== 'quanly'){ c.checked = false; c.disabled = true; c.title = 'Cần vai trò Quản lý trở lên'; return; }
      c.disabled = false; c.title = '';
    });
    if(viewerLv() === 3){ // Quản lý: chỉ cấp được kho / module mà chính mình có
      Array.prototype.forEach.call(document.querySelectorAll('input[name=kho], input[name=pc]'), function(c){
        var mine = c.name === 'pc' ? viewerPc : viewerKho;
        if(mine.indexOf(c.value) === -1){ c.disabled = true; c.title = 'Ngoài quyền của bạn — không cấp được'; }
      });
    }
    $('dCopy').disabled = (r === 'quantri' && adminRec);
    syncAll();
    lastRole = r;
  }
  function closeDlg(){ $('tkModal').hidden = true; editing = null; }
  // Luôn phải còn ít nhất 1 tài khoản Quản trị đang bật và được mở menu Tài khoản — không thì không ai quản lý được nữa.
  function guardAdmin(arr){
    var ok = arr.some(function(u){ return u.quyen === 'quantri' && u.trangThai === 'Bật'; });
    return ok ? '' : 'Phải còn ít nhất 1 tài khoản Quản trị đang bật.';
  }
  var busy = false;
  async function commit(arr, onFail){
    if(busy) return false; busy = true;
    try{
      var r = await STORE.saveAll(arr);
      if(r.needConfirm){ // PC 7.95: lần lưu này làm mất tài khoản khỏi Google Sheet → hỏi rõ trước khi xóa
        var ok = window.confirm('CẢNH BÁO — lần lưu này sẽ XÓA ' + r.lost.length + ' tài khoản khỏi Google Sheet:\n\n' + r.lost.slice(0, 12).join(', ') + (r.lost.length > 12 ? '…' : '')
          + '\n\nCác máy khác và điện thoại sẽ MẤT các tài khoản này.\nNếu bạn không chủ ý xóa (máy mới / danh sách chưa khớp) → bấm Hủy rồi dùng nút “Kéo từ Sheet”.\n\nVẫn xóa?');
        if(!ok){ setNote('warn', 'Đã hủy lưu — chưa thay đổi gì trên Google Sheet.'); if(onFail) onFail('Đã hủy lưu.'); render(); return false; }
        r = await STORE.saveAll(arr, true);
      }
      if(!r.ok){ setNote('err', r.error); if(onFail) onFail(r.error); render(); return false; }
      setNote(r.pushed ? '' : 'warn', r.pushed ? '' : r.warning);
      render();
      // PC 5.8: quyền của chính người đang đăng nhập có thể vừa đổi → trang chính đọc lại quyền (menu, đăng xuất nếu bị tắt)
      try{ window.parent.postMessage({ type:'kla-auth-refresh' }, '*'); }catch(e){}
      return true;
    }catch(e){
      var m = 'Lưu thất bại: ' + (e && e.message || e); setNote('err', m); if(onFail) onFail(m); render(); return false;
    }finally{ busy = false; }
  }
  async function saveDlg(){
    var id = $('dId').value.trim(), ten = $('dName').value.trim(), tok = $('dTok').value.trim();
    var err = idError(id, editing) || (!ten ? 'Nhập Tên hiển thị.' : '') || tokError(tok, editing);
    if(err){ $('dErr').textContent = err; $('dErr').hidden = false; return; }
    var rec = { uid:editing ? editing.uid : 'u' + Date.now().toString(36), id:id, ten:ten, token:tok, quyen:$('dRole').value, kho:picked('kho'), pc:picked('pc'),
      trangThai:$('dOn').checked ? 'Bật' : 'Tắt', tuDat:editing ? editing.tuDat : false };
    var arr = STORE.list().slice();
    if(editing){ arr[arr.indexOf(editing)] = rec; } else arr.push(rec);
    if(rec.quyen === 'quantri' && !rec.kho.length){ $('dErr').textContent = 'Tài khoản Quản trị cần giữ ít nhất 1 kho điện thoại.'; $('dErr').hidden = false; return; }
    var g = guardAdmin(arr);
    if(g){ $('dErr').textContent = g; $('dErr').hidden = false; return; }
    if(rec.trangThai === 'Bật' && !rec.kho.length && rec.quyen !== 'quantri' && !window.confirm('Tài khoản này chưa được chọn kho điện thoại nào — trên điện thoại sẽ không xem được gì. Vẫn lưu?')) return;
    $('dSave').disabled = true; $('dSave').textContent = 'Đang lưu…';
    var ok = await commit(arr, function(m){ $('dErr').textContent = m; $('dErr').hidden = false; });
    $('dSave').disabled = false; $('dSave').textContent = 'Lưu';
    if(ok) closeDlg();
  }

  /* ====== SỰ KIỆN ====== */
  $('tkAdd').addEventListener('click', function(){ openDlg(null); });
  $('tkReload').addEventListener('click', function(){ reload(); });
  // PC 7.95: kéo tài khoản có trên Google Sheet về máy này (không xóa tài khoản nào trên máy), rồi tải lại bảng
  $('tkPull').addEventListener('click', async function(){
    var b = this; if(!API || !API.permPull){ window.alert('Không tìm thấy cầu nối dữ liệu.'); return; }
    b.disabled = true; $('tkInfo').textContent = 'Đang kéo từ Google Sheet…';
    try{
      var res = await API.permPull();
      if(!res || !res.ok){ setNote('err', (res && res.error) || 'Không kéo được từ Sheet.'); render(); return; }
      await reload();
      setNote(res.added ? 'ok' : '', res.added ? ('Đã kéo thêm ' + res.added + ' tài khoản từ Google Sheet.') : '');
      if(!res.added){ $('tkInfo').textContent = 'Không có tài khoản mới trên Sheet (' + res.sheetRows + ' dòng).'; }
      render();
    }catch(e){ setNote('err', 'Kéo từ Sheet thất bại: ' + (e && e.message || e)); render(); }
    finally{ b.disabled = false; }
  });
  var renderTyping = KLAType.debounce(function(){ KLAType.keepFocus(render); }, 150); // PC 0.19: chờ ngừng gõ
  ['fQ','fRole','fState'].forEach(function(i){ $(i).addEventListener('input', renderTyping); });
  $('dCancel').addEventListener('click', closeDlg);
  $('dSave').addEventListener('click', saveDlg);
  $('dRole').addEventListener('change', applyRoleRules);
  $('dGen').addEventListener('click', function(){ $('dTok').value = genToken(); });
  $('dTokCopy').addEventListener('click', function(){
    var t = $('dTok').value, b = this;
    function done(ok){ var o = b.textContent; b.textContent = ok ? 'Đã chép' : 'Không chép được'; setTimeout(function(){ b.textContent = o; }, 1400); }
    if(!t){ done(false); return; }
    try{ navigator.clipboard.writeText(t).then(function(){ done(true); }, function(){ done(false); }); }catch(e){ done(false); }
  });
  $('dCopy').addEventListener('click', function(){
    var set = {}; picked('kho').forEach(function(k){ if(KHO2PC[k]) set[KHO2PC[k]] = 1; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=pc]'), function(c){ if(c.disabled || c.value === 'TAIKHOAN') return; c.checked = !!set[c.value]; });
    syncAll();
  });
  $('dMatrix').addEventListener('change', onMatrixChange);
  $('tkModal').addEventListener('mousedown', function(e){ if(e.target === this) closeDlg(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !$('tkModal').hidden) closeDlg(); });
  $('tkTable').addEventListener('click', function(e){
    var b = e.target.closest('button[data-a]'); if(!b) return;
    var id = b.closest('tr').dataset.id, u = STORE.list().find(function(x){ return x.id === id; }); if(!u || locked(u)) return;
    if(b.dataset.a === 'peek'){ var k = id + '|' + b.dataset.col; peeked[k] = !peeked[k]; render(); }
    else if(b.dataset.a === 'eye'){ shown[id] = !shown[id]; render(); }
    else if(b.dataset.a === 'edit') openDlg(u);
    else if(b.dataset.a === 'del'){
      if(String(u.id).toLowerCase() === 'admin'){ window.alert('Không thể xóa tài khoản "admin" mặc định.'); return; }
      if(isSelfQT(u)){ window.alert('Không thể tự xóa tài khoản của chính mình.'); return; }
      var rest = STORE.list().filter(function(x){ return x !== u; }), g = guardAdmin(rest);
      if(g){ window.alert(g); return; }
      if(!window.confirm('Xóa tài khoản "' + u.id + '"?\nMã của tài khoản này sẽ không dùng được nữa (cả điện thoại sau khi cập nhật lên Sheet).')) return;
      commit(rest, function(m){ window.alert(m); });
    }
  });
  // Bấm tiêu đề cột "Quyền điện thoại" / "Quyền trên PC" → bung / thu cả cột
  document.querySelectorAll('#tkTable th[data-peek]').forEach(function(th){
    th.addEventListener('click', function(){ var c = th.dataset.peek; peekAll[c] = !peekAll[c]; if(!peekAll[c]) Object.keys(peeked).forEach(function(k){ if(k.split('|')[1] === c) delete peeked[k]; }); th.classList.toggle('on', peekAll[c]); render(); });
  });
  async function reload(){
    $('tkReload').disabled = true; $('tkInfo').textContent = 'Đang tải…';
    try{
      try{ var st = window.authAPI && window.authAPI.state ? await window.authAPI.state() : null; var su = st && st.ok && st.user; viewerAdmin = !!(su && su.isAdmin); viewerRole = su ? (su.vaiTro || su.quyen || '') : ''; viewerName = su ? String(su.ten || '').toLowerCase() : ''; viewerPc = su && su.pc || []; viewerKho = su && su.kho || []; }catch(e){ viewerAdmin = false; viewerRole = ''; viewerPc = []; viewerKho = []; viewerName = ''; }
      var sub = document.querySelector('.tk-sub');
      if(sub){ if(!sub.getAttribute('data-def')) sub.setAttribute('data-def', sub.textContent); sub.textContent = viewerLv() === 3 ? 'Bạn đang quản lý với vai trò Quản lý: chỉ tạo / xem mã / sửa / xóa được tài khoản Người dùng cấp 1 và cấp 2.' : sub.getAttribute('data-def'); }
      var r = await STORE.load();
      if(!r.ok){ showFatal(r.error); return; }
      setNote('', ''); render();
    }catch(e){ showFatal(e && e.message || String(e)); }
    finally{ $('tkReload').disabled = false; }
  }
  window.addEventListener('message', function(ev){ if(ev.data && ev.data.type === 'kla-reload-accounts') reload(); });
  // PC 7.37: tick "Sao lưu Drive (toàn quyền)" → tự tick "Khôi phục Drive" (toàn quyền luôn kéo theo khôi phục).
  document.addEventListener('change', function(ev){
    var c = ev.target;
    if(c && c.name === 'pc' && c.value === 'CD_SAOLUU' && c.checked){
      var k = document.querySelector('input[name=pc][value=CD_KHOIPHUC]'); if(k && !k.disabled) k.checked = true;
    }
  });
  render();
  reload();
})();
