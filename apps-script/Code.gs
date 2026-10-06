/**
 * Kho Lạnh An An — cầu nối giữa BẢN ĐIỆN THOẠI và Google Sheet đồng bộ.
 *
 * Dán toàn bộ file này vào Apps Script GẮN VỚI CHÍNH Google Sheet mà app PC đang đồng bộ
 * (mở Sheet → Tiện ích mở rộng → Apps Script). Cách triển khai: xem ../README.md.
 *
 * Đây là CỔNG DUY NHẤT vào Google Sheet — cả app PC lẫn điện thoại đều gọi Web App này, không
 * cần Google Cloud Console / Service Account / file Key. Có 2 mã truy cập riêng (Thuộc tính tập
 * lệnh):
 *   - APP_TOKEN (điện thoại): xem tồn kho, xem phiếu, tạo phiếu xuất mới, và SỬA / XÓA phiếu
 *                             còn "Chưa xử lý" (PC chưa nhận).
 *   - PC_TOKEN  (app PC):     thêm quyền ghi đè bảng tồn kho, đọc phiếu, đánh dấu đã xử lý
 *                             (các lệnh "pc.*"). KHÔNG đưa mã này cho điện thoại.
 *   - Token RIÊNG TỪNG NGƯỜI (09/2026): tạo/bật/tắt trong app PC → Cài Đặt → Điện Thoại → "Phân quyền".
 *     PC đẩy lên tab "PhanQuyen" (chỉ lưu MÃ BĂM SHA-256 của token, không lưu token gốc). Mỗi dòng có:
 *     tên người dùng (= ID đăng nhập, KHÔNG phân biệt hoa/thường), tên hiển thị (có dấu, VD "Thắng"),
 *     quyền 'xem' (chỉ xem tồn) hoặc 'xuat' (xem + tạo phiếu), danh sách kho được dùng.
 *     Điện thoại đăng nhập bằng Tên người dùng + Mã truy cập (như ID + mật khẩu). App điện thoại bản cũ
 *     (chưa gửi "nguoiDung") vẫn vào được bằng riêng mã truy cập cho tới khi cập nhật.
 *     Tài khoản "Tạo phiếu" tự sửa / xóa được phiếu CỦA CHÍNH MÌNH khi PC chưa nhận (không đụng phiếu người khác);
 *     tài khoản "Chỉ xem" không sửa / xóa. "Người tạo" trên phiếu = tên hiển thị (không tự gõ),
 *     cột "nguoiDung" của phiếu = tên người dùng (dùng để lọc "phiếu của tôi").
 *     APP_TOKEN chung (nếu còn đặt) = QUẢN TRỊ: đủ mọi quyền như trước — để máy cũ không bị gián đoạn.
 *     Quyền 'quantri' (Quản trị, 09/2026): như 'xuat' + thêm / sửa / khóa / xóa người dùng ngay trên app điện thoại
 *     (Cài đặt → Quản lý người dùng; lệnh pq.list / pq.luu / pq.xoa). Mọi tài khoản riêng tự đổi mật khẩu
 *     của mình ở Cài đặt (lệnh doiMa). Tab PhanQuyen giờ có thêm cột "maTruyCap"
 *     (mã dạng chữ, để xem lại được trên điện thoại + app PC) — CHỈ dùng nội bộ.
 *
 * Quy ước dữ liệu PHẢI khớp với app PC (main.js + sheets-webapp-client.js):
 *   - Tab TonKho_M02 / TonKho_M01 / TonKho_M01_ViTri / TonKho_M01_ViTriBot / Meta: PC ghi đè, file này chỉ ĐỌC.
 *   - Tab PhieuXuat / PhieuXuatItems: file này THÊM dòng (trangThai = "Chưa xử lý"), PC đổi
 *     trangThai thành "Đã xử lý" + ghi xuLyLuc sau khi đã nhập phiếu vào Module 02.
 *   - Ghi dòng hàng (PhieuXuatItems) TRƯỚC, đầu phiếu (PhieuXuat) SAU — PC không bao giờ thấy
 *     một đầu phiếu chưa có dòng hàng.
 */

var TAB = {
  M01: 'TonKho_M01', VITRI: 'TonKho_M01_ViTri', VITRIBOT: 'TonKho_M01_ViTriBot', M02: 'TonKho_M02',
  M03: 'TonKho_M03', M03_LSX: 'DanhMuc_M03_LSX', M04: 'TonKho_M04',
  M08_MAHOA: 'M08_MaHoa', M08_MADATAO: 'M08_MaDaTao', M08_TONGHOP: 'M08_TongHop',
  M08_RADONG: 'M08_RaDong', M08_SIZE: 'M08_SizeLabel', M08_KS: 'M08_KhangSinh', M08_KSXOA: 'M08_KhangSinhXoa',
  META: 'Meta', PX: 'PhieuXuat', PXI: 'PhieuXuatItems', PQ: 'PhanQuyen',
  M01_BAOCAO: 'BaoCao_M01', // file Excel "Báo Cáo Tổng Tồn" + "Bảng Tổng Hợp HLSO" (base64 cắt nhiều ô) do PC dựng
  LX: 'LichXuat_Cont', LX_THANG: 'LichXuat_Thang', // Lịch xuất nhập hàng (PC 7.31) — điện thoại XEM
  LX_YC: 'LichXuat_YeuCau', // (PC 7.63) hộp thư yêu cầu THÊM / CHUYỂN lịch từ điện thoại của Quản lý trở lên — PC kéo về xử lý (xem lxGui_)
  M02_BAOCAO: 'BaoCao_M02', // file Excel "Bảng Tổng Hợp" của Module 02 (cùng cách lưu)
  // LƯU TRỮ (pcArchive_): phiếu ĐÃ XONG quá N ngày chuyển khỏi 2 tab chính để tab không phình mãi
  PX_LUUTRU: 'PhieuXuat_LuuTru', PXI_LUUTRU: 'PhieuXuatItems_LuuTru'
};
// Kho (mã giống cột "module" của phiếu) mà từng lệnh đọc dữ liệu cần — dùng để chặn token không được xem kho đó.
var KHO_OF_ACTION = { tonKhoGui: 'M02', tonKho: 'M01', baoCaoM01: 'BC01', baoCaoM02: 'BC02', viTri: 'M01VT', viTriBot: 'M01VTB', tonKhoM03: 'M03', tonKhoM04: 'M04', m08: 'M08', ksSince: 'M08', lichXuat: 'LX', lichXuatGui: 'LX' };
// BC01 / BC02 = quyền xem trang "Báo cáo" trên điện thoại (file Excel Module 01 / Module 02) — KHÔNG phải kho hàng,
// độc lập với quyền xem kho M01 / M02. Khớp PQ_KHO (main.js), KHO (cai-dat.js), REPORT_CFG + PQ_KHO (www/app.js).
var ALL_KHO = ['M01', 'M01VT', 'M01VTB', 'M02', 'M03', 'M04', 'M08', 'BC01', 'BC02', 'LX'];
// PHÂN QUYỀN GIỐNG APP PC (main.js › PQ_PC / limitPcByRole / effectivePc) — sửa 1 bên thì sửa bên kia.
// Module mở được trên PC + quyền riêng từng mục Cài đặt. Cấp 1 / 2: không có CD_* và TAIKHOAN; Quản lý: có CD_*, TAIKHOAN chỉ khi Quản trị / admin cấp;
// Quản trị: luôn có CD_* + TAIKHOAN, chỉ module M* là bỏ tick được (danh sách trống = bản cũ → đủ).
var PQ_CD_ = ['CD_SAOLUU', 'CD_KHOIPHUC', 'CD_DONGBO'];
var PQ_PC_ = ['M01', 'M01VT', 'M01VTB', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09'].concat(PQ_CD_, ['TAIKHOAN']);
var PQ_FIXED_PC_ = ['TAIKHOAN'].concat(PQ_CD_);
function pcClean_(v) { // chuỗi "M01,M02" hoặc mảng → mảng mã hợp lệ, không trùng
  var a = Array.isArray(v) ? v.slice() : String(v || '').split(',');
  a = a.map(function (x) { return String(x).trim(); });
  if (a.indexOf('CAIDAT') >= 0) a = a.filter(function (m) { return m !== 'CAIDAT'; }).concat(PQ_CD_); // mã cũ (trước 6.7)
  if (a.indexOf('CD_SAOLUU') >= 0 && a.indexOf('CD_KHOIPHUC') < 0) a.push('CD_KHOIPHUC'); // toàn quyền Drive kéo theo khôi phục
  return a.filter(function (m, i, x) { return PQ_PC_.indexOf(m) >= 0 && x.indexOf(m) === i; });
}
function pcLimit_(mods, role) {
  if (role === 'quantri') {
    return mods.length ? PQ_PC_.filter(function (m) { return PQ_FIXED_PC_.indexOf(m) >= 0 || mods.indexOf(m) >= 0; }) : PQ_PC_.slice();
  }
  return mods.filter(function (m) { return (m !== 'TAIKHOAN' || role === 'quanly') && (role === 'quanly' || PQ_CD_.indexOf(m) < 0); });
}
// Cấp độ: 1 cấp 1 · 2 cấp 2 · 3 Quản lý · 4 Quản trị · 5 admin chính (APP_TOKEN chung hoặc tên "admin")
function roleLv_(vaiTro) { return { xem: 1, xuat: 2, quanly: 3, quantri: 4 }[vaiTro] || 1; }
function userLv_(u) { return (u.admin || isAdminTen_(u.ten)) ? 5 : roleLv_(u.vaiTro); }
// Được mở "Quản lý người dùng" trên điện thoại: admin / Quản trị, hoặc Quản lý được cấp quyền TAIKHOAN.
function pqAllowed_(u) { return !!(u.admin || u.quanTri || (u.vaiTro === 'quanly' && u.pc && u.pc.indexOf('TAIKHOAN') >= 0)); }

// SHA-256 dạng hex (chữ thường) — GIỐNG crypto.createHash('sha256') trong main.js của app PC.
function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}
// Xác định người gọi từ Tên người dùng + token điện thoại. Trả về null nếu sai / đã bị tắt.
// { admin: true } = APP_TOKEN chung; còn lại { ten (ID), hienThi, quyen: 'xem'|'xuat', kho: [...] } theo tab PhanQuyen.
// nguoiDung === undefined  → app điện thoại bản cũ (chưa có ô Tên người dùng): chỉ kiểm tra token.
// nguoiDung là chuỗi       → app bản mới: BẮT BUỘC khớp tên người dùng (không phân biệt hoa/thường).
function resolveUser_(token, appToken, nguoiDung) {
  token = String(token || '');
  if (!token) return null;
  if (appToken && token === appToken) return { admin: true, quanTri: true, quanLy: true, vaiTro: 'quantri', ten: '', quyen: 'xuat', kho: ALL_KHO.slice(), pc: PQ_PC_.slice() };
  var t = readTab_(TAB.PQ);
  if (!t.headers.length) return null;
  var h = t.headers, iH = h.indexOf('tokenHash'), iT = h.indexOf('ten'), iQ = h.indexOf('quyen'),
      iK = h.indexOf('kho'), iS = h.indexOf('trangThai'), iD = h.indexOf('tenHienThi');
  if (iH < 0) return null;
  var hash = sha256Hex_(token);
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    if (String(r[iH]).trim().toLowerCase() !== hash) continue;
    if (iS >= 0 && String(r[iS]).trim() !== 'Bật') return null; // đã khóa
    var ten = String(iT >= 0 ? r[iT] : '').trim();
    if (nguoiDung !== undefined && String(nguoiDung || '').trim().toLowerCase() !== ten.toLowerCase()) return null; // sai tên người dùng
    var kho = String(iK >= 0 ? r[iK] : '').split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return ALL_KHO.indexOf(x) >= 0; });
    var hienThi = String(iD >= 0 ? r[iD] : '').trim() || ten;
    var iP = h.indexOf('pcModules');
    // 10/2026 — 4 VAI TRÒ: 'xem' (Người dùng cấp 1: chỉ xem) | 'xuat' (cấp 2: xem + tạo phiếu, chỉ sửa / xóa phiếu của mình) |
    // 'quanly' (Quản lý: như cấp 2 nhưng sửa / xóa được MỌI phiếu trong kho được dùng) | 'quantri' (Quản trị: như Quản lý + quản lý người dùng).
    var q = String(r[iQ]).trim();
    var vt = (q === 'xuat' || q === 'quanly' || q === 'quantri') ? q : 'xem';
    if (vt === 'quantri' && !kho.length) kho = ALL_KHO.slice(); // giống PC: Quản trị chưa lưu kho = đủ kho
    var pc = isAdminTen_(ten) ? PQ_PC_.slice() : pcLimit_(pcClean_(iP >= 0 ? r[iP] : ''), vt);
    return { admin: false, quanTri: vt === 'quantri', quanLy: vt === 'quanly' || vt === 'quantri', vaiTro: vt, ten: ten, hienThi: hienThi, quyen: vt === 'xem' ? 'xem' : 'xuat', kho: kho, pc: pc };
  }
  return null;
}
function forbid_(msg) { return json_({ ok: false, code: 'FORBIDDEN', error: msg }); }
// module: 'M02' (Tồn Kho Gửi — mặc định, phiếu cũ để trống), 'M01' (Tồn Kho An An) hoặc
// 'M01VT' (Module 01 › Tồn theo vị trí).
// 'M01VTB' (Module 01 › Vị Trí Bột — dòng xác định bằng cột "_key", tồn = cột "SL").
// 'M03' (NXT Bột/Sốt — theo lô, cần lsxXuat), 'M04' (NXT TNK/TGC — theo lô nhập × vị trí).
var MODULES = ['M01', 'M01VT', 'M01VTB', 'M02', 'M03', 'M04'];
var PX_HEADERS = ['id', 'maPhieu', 'ngayTao', 'trangThai', 'nguoiTao', 'ghiChu', 'xuLyLuc', 'module', 'lsxXuat', 'nguoiDung'];
// itemKey/rowIndex/hopDong chỉ dùng cho phiếu Module 01 (dòng Load Data được xác định bằng cột
// "_key" mà app PC đẩy kèm lên tab TonKho_M01).
var PXI_HEADERS = ['phieuId', 'maHang', 'tenHang', 'phieuNhap', 'soLo', 'size', 'soKien', 'soLuongXuat', 'itemKey', 'rowIndex', 'hopDong', 'viTri'];
var PXI_NUMBER_COLS = ['soKien', 'soLuongXuat', 'rowIndex'];
var CHUA_XU_LY = 'Chưa xử lý';
var DA_XU_LY = 'Đã xử lý';
// Phiếu bị xóa / đang được sửa trên điện thoại: trạng thái bắt đầu bằng "Lỗi" nên app PC bỏ qua (PC chỉ
// nhận phiếu "Chưa xử lý") và tồn "chờ PC" không tính phiếu đó. KHÔNG xóa dòng đầu phiếu khỏi tab
// PhieuXuat vì app PC đánh dấu theo SỐ DÒNG — xóa dòng sẽ làm PC đánh dấu nhầm phiếu khác.
var HUY_PREFIX = 'Lỗi - Đã hủy';
var HUY = 'Lỗi - Đã hủy trên điện thoại';
var DANG_SUA = 'Lỗi - Đang sửa trên điện thoại';
var M2 = { maHang: 'Mã hàng', tenHang: 'Tên hàng', soLo: 'Số lô', size: 'Size', phieuNhap: 'Phiếu nhập/Voucher', soKien: 'Số kiện' };

function doGet() {
  return json_({ ok: true, app: 'Kho Lạnh An An', message: 'Web App đang chạy. Ứng dụng điện thoại gọi bằng POST.' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Yêu cầu không đúng định dạng.' });
  }
  var props = PropertiesService.getScriptProperties();
  var appToken = props.getProperty('APP_TOKEN');
  var pcToken = props.getProperty('PC_TOKEN');
  var action = String(req.action || '');
  var isPc = action.indexOf('pc.') === 0;
  var user = null;
  if (isPc) {
    if (!pcToken) return json_({ ok: false, error: 'Web App chưa đặt PC_TOKEN (Cài đặt dự án → Thuộc tính tập lệnh).' });
    if (String(req.token || '') !== pcToken) return json_({ ok: false, code: 'AUTH', error: 'Mã truy cập không đúng.' });
  } else {
    user = resolveUser_(req.token, appToken, req.nguoiDung);
    if (!user) return json_({ ok: false, code: 'AUTH', error: 'Tên người dùng hoặc mã truy cập không đúng, hoặc tài khoản đã bị khóa. Liên hệ người quản lý app PC.' });
    var needKho = KHO_OF_ACTION[action];
    if (needKho && user.kho.indexOf(needKho) < 0) return forbid_('Bạn không được cấp quyền');
    if ((action === 'taoPhieu') && user.quyen !== 'xuat') return forbid_('Bạn không được cấp quyền');
    // Sửa / xóa phiếu: quản lý = mọi phiếu; tài khoản "Tạo phiếu" = CHỈ phiếu do chính mình tạo, ở kho mình
    // được dùng (phieuVisibleTo_). Phiếu PC đã nhận thì editPhieu_/cancelPhieu_ tự chặn như mọi khi.
    if ((action === 'suaPhieu' || action === 'huyPhieu') && !user.admin) {
      if (user.quyen !== 'xuat') return forbid_('Bạn không được cấp quyền');
      var pid = String(action === 'suaPhieu' ? (req.phieu && req.phieu.id) : req.id || '').trim();
      var own = pid ? findPxRow_(pid) : null;
      if (own && !user.quanLy && !phieuVisibleTo_(own.cur, user)) return forbid_('Bạn không được cấp quyền'); // Quản lý / Quản trị: mọi phiếu
    }
    // Thêm nhanh / chuyển ngày Lịch xuất nhập hàng từ điện thoại: CHỈ Quản lý trở lên (và phải có quyền xem lịch 'LX').
    if (action === 'lichXuatGui' && !user.quanLy) return forbid_('Chỉ tài khoản Quản lý trở lên mới thêm / chuyển được lịch xuất nhập hàng.');
    if (action.indexOf('pq.') === 0 && !pqAllowed_(user)) return forbid_('Chỉ tài khoản Quản trị, hoặc Quản lý được cấp quyền Tài khoản, mới quản lý được người dùng.');
    if (action === 'taoPhieu' && req.phieu) {
      var mod = MODULES.indexOf(req.phieu.module) >= 0 ? req.phieu.module : 'M02';
      if (user.kho.indexOf(mod) < 0) return forbid_('Bạn không được cấp quyền');
      if (!user.admin) { req.phieu.nguoiTao = user.hienThi; req.phieu.nguoiDung = user.ten; } // theo tài khoản, không tự gõ
    }
  }

  try {
    switch (action) {
      case 'ping': return json_({ ok: true, meta: getMeta_() });
      // Điện thoại hỏi "tôi là ai, được làm gì" — để ẩn kho / nút không có quyền.
      case 'toi': return json_({ ok: true, user: { admin: !!user.admin, quanTri: !!user.quanTri, quanLy: !!user.quanLy, vaiTro: user.vaiTro || (user.admin ? 'quantri' : 'xem'), ten: user.ten, hienThi: user.hienThi || user.ten, quyen: user.quyen, kho: user.kho, pc: user.pc || [], canPq: pqAllowed_(user) } });
      // Quản lý người dùng ngay trên điện thoại (chỉ Quản trị / APP_TOKEN chung) — ghi thẳng tab PhanQuyen.
      case 'pq.list': return json_(pqList_(user));
      case 'pq.luu': return json_(pqSave_(user, req.u));
      case 'pq.xoa': return json_(pqDelete_(user, req.ten));
      // Tự đổi mật khẩu của CHÍNH MÌNH (mọi tài khoản riêng, không cần quyền Quản trị) — xem pqSelfPassword_.
      case 'doiMa': return json_(pqSelfPassword_(user, req.matKhauMoi));
      // Câu hỏi "nhẹ" lúc mở app: mốc PC đẩy từng bảng + số đang chờ — điện thoại dùng dữ liệu đã
      // lưu trên máy, chỉ tải lại bảng nào PC vừa cập nhật.
      case 'trangThai': return json_({ ok: true, meta: getMeta_(), pending: pendingByKey_() });
      case 'tonKhoGui': return json_(getTonKhoGui_());
      case 'tonKho': return json_(getTonKhoM01_());
      case 'viTri': return json_(getTableWithPending_(TAB.VITRI));
      case 'viTriBot': return json_(getTableWithPending_(TAB.VITRIBOT));
      case 'tonKhoM03': {
        var r3 = getTableWithPending_(TAB.M03);
        var lsx = readTab_(TAB.M03_LSX);
        r3.lsx = lsx.rows.map(function (x) { return { id: String(x[0]), code: String(x[1]), name: String(x[2] || ''), khachHang: String(x[3] || '') }; });
        return json_(r3);
      }
      case 'tonKhoM04': return json_(getTableWithPending_(TAB.M04));
      // Module 08 (Tổng Hợp) — chỉ xem: trả về trọn các tab nhỏ, điện thoại tự tính bảng gộp.
      case 'm08': {
        var pick = function (name) { var t = readTab_(name); return { headers: t.headers, rows: t.rows }; };
        return json_({ ok: true, meta: getMeta_(), maHoa: pick(TAB.M08_MAHOA), maDaTao: pick(TAB.M08_MADATAO),
          tongHop: pick(TAB.M08_TONGHOP), raDong: pick(TAB.M08_RADONG), sizeLabel: pick(TAB.M08_SIZE),
          // Điện thoại bản 2.0+ gửi noKs: tải kháng sinh riêng theo kiểu "chỉ phần mới" (ksSince) → không gửi lại cả bảng
          khangSinh: req.noKs ? { headers: [], rows: [] } : pick(TAB.M08_KS) });
      }
      case 'ksSince': return json_(ksSince_(req.since));
      // Lịch xuất container (PC 7.31) — chỉ xem: các lịch gần đây + tổng kết từng tháng.
      case 'lichXuat': {
        var lx = readTab_(TAB.LX), lt = readTab_(TAB.LX_THANG);
        return json_({ ok: true, meta: getMeta_(), cont: { headers: lx.headers, rows: lx.rows }, thang: { headers: lt.headers, rows: lt.rows }, yc: lxYcList_() });
      }
      // (PC 7.63) Quản lý trở lên gửi yêu cầu THÊM NHANH / CHUYỂN NGÀY lịch — ghi vào tab LichXuat_YeuCau, PC kéo về xử lý.
      case 'lichXuatGui': return json_(lxGui_(user, req.ops));
      case 'baoCaoM01': return json_(getBaoCao_(TAB.M01_BAOCAO));
      case 'baoCaoM02': return json_(getBaoCao_(TAB.M02_BAOCAO));
      case 'phieu': return json_(getPhieu_(user));
      case 'taoPhieu': return json_(createPhieu_(req.phieu));
      case 'suaPhieu': return json_(editPhieu_(req.phieu));
      case 'huyPhieu': return json_(cancelPhieu_(req.id));
      // ---- Chỉ app PC (PC_TOKEN) ----
      case 'pc.ping': return json_({ ok: true, title: ss_().getName(), sheetNames: ss_().getSheets().map(function (x) { return x.getName(); }) });
      case 'pc.ensureTabs': return json_(pcEnsureTabs_(req.tabs));
      case 'pc.writeTable': return json_(pcWriteTable_(req.name, req.columns, req.rows));
      case 'pc.readTable': return json_(pcReadTable_(req.name));
      case 'pc.markRows': return json_(pcMarkRows_(req.name, req.updates));
      case 'pc.archive': return json_(pcArchive_(req.days));
      case 'pc.ksUpsert': return json_(pcKsUpsert_(req.rows, req.dels, req.full));
      default: return json_({ ok: false, error: 'Không có chức năng "' + action + '".' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------------------------------------
// QUẢN LÝ NGƯỜI DÙNG TRÊN ĐIỆN THOẠI (09/2026) — đọc / ghi tab PhanQuyen. App PC ghi CÙNG định dạng này
// (main.js › PQ_COLUMNS) và khi mở Cài Đặt → Điện Thoại sẽ đọc tab này về để gộp thay đổi từ điện thoại.
// ---------------------------------------------------------------------------------------------
// pcModules (PC 5.7) = module được mở trên PC ("M01,M02,CD_DONGBO,TAIKHOAN"). Từ điện thoại 3.1 (PC 7.43) điện thoại cũng sửa cột này, cùng luật với app PC (xem pcLimit_ / pqSave_).
var PQ_COLS = ['tokenHash', 'ten', 'tenHienThi', 'quyen', 'kho', 'trangThai', 'capNhat', 'maTruyCap', 'pcModules'];
var PQ_USER_OK_ = /^[A-Za-z0-9._-]{1,40}$/;
var PQ_TOKEN_OK_ = /^[A-Za-z0-9\-_.@#!]+$/;

// ---------------------------------------------------------------------------------------------
// YÊU CẦU LỊCH XUẤT NHẬP HÀNG TỪ ĐIỆN THOẠI (PC 7.63) — điện thoại của Quản lý trở lên không ghi thẳng vào LichXuat_Cont (tab này do PC ghi đè
// toàn bộ mỗi lần đẩy), mà thêm dòng vào tab LichXuat_YeuCau. PC kéo các dòng chưa xử lý (trangThai trống) về, ghi vào lịch, đánh dấu
// 'Đã xử lý' / 'Lỗi - …' rồi đẩy lại LichXuat_Cont. Dòng đã xử lý quá 7 ngày được dọn bớt. Cột PHẢI khớp LX_YC_HEADERS (sheets-webapp-client.js).
//   hanhDong 'add'  : loai xuat|nhap, ngay yyyy-mm-dd, lsx (mã LSX / số chứng từ), trangThaiLich ok|run|plan|wait (tuỳ chọn)
//   hanhDong 'move' : targetId (id lịch trên PC), ngay = ngày mới
// ---------------------------------------------------------------------------------------------
var LX_YC_COLS = ['id', 'hanhDong', 'loai', 'targetId', 'ngay', 'lsx', 'trangThaiLich', 'nguoiTao', 'nguoiDung', 'taoLuc', 'trangThai', 'xuLyLuc'];
function lxGui_(user, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('Không có yêu cầu nào để gửi.');
  if (ops.length > 60) throw new Error('Mỗi lần gửi tối đa 60 dòng.');
  var reDay = /^\d{4}-\d{2}-\d{2}$/, now = new Date().toISOString(), clean = [];
  ops.forEach(function (o) {
    o = o || {};
    var id = String(o.id || '').trim();
    if (!/^[a-z0-9]{6,40}$/.test(id)) throw new Error('Mã yêu cầu không hợp lệ.');
    var hd = o.hanhDong === 'move' ? 'move' : 'add', ngay = String(o.ngay || '').trim();
    if (!reDay.test(ngay)) throw new Error('Ngày không hợp lệ: ' + ngay);
    var rec = { id: id, hanhDong: hd, loai: o.loai === 'nhap' ? 'nhap' : 'xuat', targetId: String(o.targetId || '').trim().slice(0, 60), ngay: ngay,
      lsx: String(o.lsx || '').trim().slice(0, 120), trangThaiLich: ['ok', 'run', 'plan', 'wait'].indexOf(o.trangThaiLich) >= 0 ? o.trangThaiLich : '',
      nguoiTao: user.hienThi || user.ten || 'Quản trị', nguoiDung: user.ten || '', taoLuc: now, trangThai: '', xuLyLuc: '' };
    if (hd === 'add' && !rec.lsx) throw new Error('Có dòng chưa có LSX / số chứng từ.');
    if (hd === 'move' && !rec.targetId) throw new Error('Thiếu lịch cần chuyển.');
    clean.push(rec);
  });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet đang bận, thử lại sau.');
  try {
    var info = ensureTab_(TAB.LX_YC, LX_YC_COLS), sh = info.sheet, have = {}, last = sh.getLastRow(), cId = info.headers.indexOf('id');
    if (last >= 2) sh.getRange(2, cId + 1, last - 1, 1).getValues().forEach(function (v) { have[String(v[0]).trim()] = true; });
    var fresh = clean.filter(function (r) { return !have[r.id]; }); // gửi lặp (mạng chập chờn) không tạo trùng
    appendObjects_(info, fresh);
    // dọn dòng đã xử lý (Đã xử lý / Lỗi) quá 7 ngày
    var iS = info.headers.indexOf('trangThai'), iX = info.headers.indexOf('xuLyLuc'), iT = info.headers.indexOf('taoLuc');
    if (iS >= 0 && last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, info.headers.length).getValues(), cut = Date.now() - 7 * 86400000, del = [];
      vals.forEach(function (r, i) {
        if (!String(r[iS]).trim()) return;
        var t = new Date(String(r[iX] || r[iT] || '')).getTime();
        if (t && t < cut) del.push(i + 2);
      });
      if (del.length) deleteRows_(sh, del);
    }
    SpreadsheetApp.flush();
    return { ok: true, daGui: fresh.length, boQua: clean.length - fresh.length };
  } finally {
    lock.releaseLock();
  }
}
// Yêu cầu đang chờ PC (trangThai trống) + yêu cầu lỗi trong 3 ngày gần đây → điện thoại hiện "Chờ PC" / báo lỗi.
function lxYcList_() {
  var t = readTab_(TAB.LX_YC);
  if (!t.headers.length) return { headers: [], rows: [] };
  var iS = t.headers.indexOf('trangThai'), iT = t.headers.indexOf('taoLuc'), cut = Date.now() - 3 * 86400000;
  var rows = t.rows.filter(function (r) {
    var st = String(iS >= 0 ? r[iS] : '').trim();
    if (!st) return true;
    if (st.indexOf('Lỗi') !== 0) return false;
    var c = new Date(String(iT >= 0 ? r[iT] : '')).getTime();
    return !c || c > cut;
  }).slice(-200);
  return { headers: t.headers, rows: rows };
}

function pqRead_() {
  var t = readTab_(TAB.PQ), h = t.headers, out = [];
  t.rows.forEach(function (r) {
    var o = {};
    PQ_COLS.forEach(function (c) { var i = h.indexOf(c); o[c] = (i >= 0 && r[i] !== null && r[i] !== undefined) ? String(r[i]).trim() : ''; });
    if (o.ten) out.push(o);
  });
  return out;
}
function pqWrite_(list) {
  var sh = ss_().getSheetByName(TAB.PQ) || ss_().insertSheet(TAB.PQ);
  var n = PQ_COLS.length;
  var values = [PQ_COLS].concat(list.map(function (o) { return PQ_COLS.map(function (c) { return o[c] || ''; }); }));
  if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  sh.getRange(1, 1, values.length, n).setNumberFormat('@').setValues(values);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow > values.length) sh.getRange(values.length + 1, 1, lastRow - values.length, Math.max(lastCol, 1)).clearContent();
  if (lastCol > n) sh.getRange(1, n + 1, Math.max(lastRow, 1), lastCol - n).clearContent();
  SpreadsheetApp.flush();
}
function pqMutate_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet đang bận, thử lại sau.');
  try { var list = pqRead_(); fn(list); pqWrite_(list); } finally { lock.releaseLock(); }
}
// Tài khoản "admin" (tài khoản chính của app PC, 10/2026): chỉ sửa / đổi mã / xóa trên máy PC. Điện thoại: người dùng khác
// (kể cả Quản trị) KHÔNG thấy dòng admin (và mã của nó) trong danh sách, không ai sửa / xóa / đổi mã admin từ điện thoại được.
function isAdminTen_(ten) { return String(ten || '').trim().toLowerCase() === 'admin'; }
// Vai trò của 1 dòng PhanQuyen (admin chính luôn là Quản trị) + cấp độ + quyền thao tác của người đang gọi (me) — GIỐNG app PC (main.js › perm-get / perm-save).
function pqRowRole_(o) { return isAdminTen_(o.ten) ? 'quantri' : ((o.quyen === 'xuat' || o.quyen === 'quanly' || o.quyen === 'quantri') ? o.quyen : 'xem'); }
function pqRowLv_(o) { return isAdminTen_(o.ten) ? 5 : roleLv_(pqRowRole_(o)); }
function pqIsSelf_(me, ten) { return !me.admin && !!me.ten && String(ten || '').trim().toLowerCase() === String(me.ten).toLowerCase(); }
// Không xem mã / sửa / xóa được người CÙNG CẤP hoặc CAO HƠN mình (Quản trị: khóa Quản trị khác + admin; Quản lý: khóa Quản lý + Quản trị + admin, kể cả chính mình).
// Riêng Quản trị (không phải admin) vẫn xem + sửa được CHÍNH MÌNH. admin (APP_TOKEN chung hoặc tài khoản "admin") sửa được mọi người trừ dòng admin.
function pqCanTouch_(me, o) {
  var meLv = userLv_(me);
  if (meLv >= 5) return true;
  if (meLv === 4 && pqIsSelf_(me, o.ten)) return true;
  return pqRowLv_(o) < Math.min(meLv, 4);
}
function pqList_(me) {
  var seeAdmin = !!(me && (me.admin || isAdminTen_(me.ten)));
  return {
    ok: true,
    me: { lv: userLv_(me), ten: me.ten || '' },
    list: pqRead_().filter(function (o) { return seeAdmin || !isAdminTen_(o.ten); }).map(function (o) {
      var role = pqRowRole_(o), ok = pqCanTouch_(me, o);
      var kho = o.kho.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return ALL_KHO.indexOf(x) >= 0; });
      if (role === 'quantri' && !kho.length) kho = ALL_KHO.slice(); // Quản trị chưa lưu kho = đủ kho (giống PC)
      return {
        ten: o.ten, tenHienThi: o.tenHienThi || o.ten, quyen: role,
        kho: kho, pc: isAdminTen_(o.ten) ? PQ_PC_.slice() : pcLimit_(pcClean_(o.pcModules), role),
        bat: o.trangThai === 'Bật', token: ok ? o.maTruyCap : '', khoa: !ok
      };
    })
  };
}
// u: { ten, tenHienThi, token, quyen: 'xem'|'xuat'|'quanly'|'quantri', kho: [...], pc: [...mã module PC], bat }. Tên đã có → sửa, chưa có → thêm.
// token để trống khi sửa = giữ mã cũ.
function pqSave_(me, u) {
  u = u || {};
  var ten = String(u.ten || '').trim();
  if (!PQ_USER_OK_.test(ten)) throw new Error('Tên người dùng: chỉ chữ không dấu, số và . _ - (tối đa 40 ký tự, không dấu cách).');
  var quyen = (u.quyen === 'quantri' || u.quyen === 'quanly' || u.quyen === 'xuat') ? u.quyen : 'xem';
  var bat = u.bat !== false;
  var kho = (Array.isArray(u.kho) ? u.kho : []).filter(function (k) { return ALL_KHO.indexOf(k) >= 0; });
  var pcIn = pcClean_(u.pc);
  var hienThi = String(u.tenHienThi || '').trim().slice(0, 60) || ten;
  var token = String(u.token || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (isAdminTen_(ten)) throw new Error('Tài khoản admin là tài khoản chính — chỉ sửa được trên máy PC (Cài đặt › Tài khoản).');
  var meLv = userLv_(me), self = pqIsSelf_(me, ten);
  if (self && userLv_(me) === 4 && (!bat || quyen !== 'quantri')) throw new Error('Không thể tự khóa hoặc hạ quyền của chính mình.');
  pqMutate_(function (list) {
    var idx = -1;
    list.forEach(function (o, i) { if (o.ten.toLowerCase() === ten.toLowerCase()) idx = i; });
    var cur = idx >= 0 ? list[idx] : null;
    if (meLv < 5) {
      // cùng cấp / cao hơn: không sửa được (Quản trị chỉ sửa được chính mình)
      if (cur && !pqCanTouch_(me, cur)) throw new Error(pqRowLv_(cur) >= 4 ? 'Tài khoản Quản trị chỉ admin mới sửa được.' : 'Tài khoản cùng cấp hoặc cao hơn bạn — không sửa được.');
      if (quyen === 'quantri' && !(cur && pqRowRole_(cur) === 'quantri')) throw new Error('Chỉ tài khoản admin mới được tạo / nâng tài khoản lên vai trò Quản trị.');
      if (meLv === 3 && quyen === 'quanly') throw new Error('Vai trò Quản lý chỉ được tạo / sửa tài khoản Người dùng cấp 1 và cấp 2.');
      if (meLv === 4 && quyen === 'quanly' && cur && pqRowRole_(cur) === 'quantri') throw new Error('Tài khoản Quản trị chỉ admin mới hạ vai trò được.');
    }
    var prevKho = cur ? cur.kho.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return ALL_KHO.indexOf(x) >= 0; }) : [];
    var prevPc = cur ? pcClean_(cur.pcModules) : [];
    if (meLv === 3) { // Quản lý: chỉ cấp được kho / module mà chính mình có; phần ngoài phạm vi của mình trên tài khoản đó thì giữ nguyên
      var inter = function (sub, prev, mine) { return mine.filter(function (m) { return sub.indexOf(m) >= 0; }).concat(prev.filter(function (m) { return mine.indexOf(m) < 0; })); };
      kho = inter(kho, prevKho, me.kho || []);
      pcIn = inter(pcIn, prevPc, me.pc || []);
    }
    if (quyen === 'quantri' && !kho.length) throw new Error('Tài khoản Quản trị cần giữ ít nhất 1 kho điện thoại.');
    var pcOut = pcLimit_(pcIn, quyen); // cấp 1 / 2 không có Cài đặt; Quản lý không có Tài khoản (trừ khi Quản trị / admin cấp); Quản trị luôn có Cài đặt + Tài khoản
    if (quyen === 'quanly' && pcOut.indexOf('TAIKHOAN') >= 0 && meLv < 4) { // quyền Tài khoản của Quản lý chỉ do Quản trị / admin chỉ định
      var had = !!(cur && pqRowRole_(cur) === 'quanly' && prevPc.indexOf('TAIKHOAN') >= 0);
      if (!had) pcOut = pcOut.filter(function (m) { return m !== 'TAIKHOAN'; });
    }
    if (!token) token = cur ? cur.maTruyCap : '';
    if (!token) throw new Error(cur ? 'Tài khoản này chưa lưu mã — bấm \"Tạo mã\" để đặt mã mới.' : 'Chưa có mã truy cập — bấm \"Tạo mã\".');
    if (token.length < 8 || token.length > 64 || !PQ_TOKEN_OK_.test(token)) throw new Error('Mã chỉ gồm chữ không dấu, số và - _ . @ # ! (8–64 ký tự, không dấu cách).');
    if (token === props.getProperty('PC_TOKEN') || token === props.getProperty('APP_TOKEN')) throw new Error('Mã trùng mã chung (PC_TOKEN / APP_TOKEN) — chọn mã khác.');
    list.forEach(function (o, i) {
      if (i !== idx && o.maTruyCap.toLowerCase() === token.toLowerCase()) throw new Error('Mã này đang là mã của \"' + (o.tenHienThi || o.ten) + '\" — chọn mã khác.');
    });
    var row = { tokenHash: sha256Hex_(token), ten: cur ? cur.ten : ten, tenHienThi: hienThi, quyen: quyen, kho: kho.join(','),
      trangThai: bat ? 'Bật' : 'Tắt', capNhat: new Date().toISOString(), maTruyCap: token,
      pcModules: pcOut.join(',') };
    if (idx >= 0) list[idx] = row; else list.push(row);
  });
  return pqList_(me);
}
function pqDelete_(me, ten) {
  ten = String(ten || '').trim().toLowerCase();
  if (!ten) throw new Error('Thiếu tên người dùng.');
  if (isAdminTen_(ten)) throw new Error('Tài khoản admin là tài khoản chính — không xóa được.');
  if (!me.admin && ten === String(me.ten || '').toLowerCase()) throw new Error('Không thể tự xóa tài khoản của chính mình.');
  var meLv = userLv_(me);
  pqMutate_(function (list) {
    var n = list.length;
    if (meLv < 5) list.forEach(function (o) {
      if (o.ten.toLowerCase() === ten && !pqCanTouch_(me, o)) throw new Error(pqRowLv_(o) >= 4 ? 'Tài khoản Quản trị chỉ admin mới xóa được.' : 'Tài khoản cùng cấp hoặc cao hơn bạn — không xóa được.');
    });
    for (var i = list.length - 1; i >= 0; i--) if (list[i].ten.toLowerCase() === ten) list.splice(i, 1);
    if (list.length === n) throw new Error('Không tìm thấy người dùng này.');
  });
  return pqList_(me);
}

// Tự đổi mật khẩu (mã truy cập) của chính tài khoản đang đăng nhập (10/2026). Người gọi đã được resolveUser_ xác thực bằng
// Tên người dùng + mật khẩu hiện tại nên không cần quyền Quản trị. Mã chung APP_TOKEN (admin) không có dòng riêng → không đổi ở đây.
// Ghi cả tokenHash + maTruyCap; app PC kéo mã mới về khi mở Cài Đặt → Điện Thoại (mergePermFromSheet: Sheet thắng ở mã).
function pqSelfPassword_(me, moi) {
  if (me.admin) throw new Error('Đang dùng mã chung của app — không đổi được ở đây. Nhờ người quản lý tạo tài khoản riêng.');
  if (isAdminTen_(me.ten)) throw new Error('Tài khoản admin chỉ đổi mã được trên máy PC (Cài đặt › Tài khoản).');
  var token = String(moi || '').trim();
  if (token.length < 8 || token.length > 64 || !PQ_TOKEN_OK_.test(token)) throw new Error('Mật khẩu mới chỉ gồm chữ không dấu, số và - _ . @ # ! (8–64 ký tự, không dấu cách).');
  var props = PropertiesService.getScriptProperties();
  if (token === props.getProperty('PC_TOKEN') || token === props.getProperty('APP_TOKEN')) throw new Error('Mật khẩu này không dùng được — chọn mật khẩu khác.');
  var hash = sha256Hex_(token), ten = String(me.ten || '').toLowerCase();
  pqMutate_(function (list) {
    var idx = -1;
    list.forEach(function (o, i) { if (o.ten.toLowerCase() === ten) idx = i; });
    if (idx < 0) throw new Error('Không tìm thấy tài khoản.');
    list.forEach(function (o, i) {
      if (i !== idx && (o.maTruyCap.toLowerCase() === token.toLowerCase() || String(o.tokenHash).toLowerCase() === hash)) throw new Error('Mật khẩu này không dùng được — chọn mật khẩu khác.');
    });
    list[idx].tokenHash = hash;
    list[idx].maTruyCap = token;
    list[idx].capNhat = new Date().toISOString();
  });
  return { ok: true };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function readTab_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return { headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h); });
  var rows = values.slice(1).filter(function (r) {
    return r.some(function (c) { return c !== '' && c !== null; });
  });
  return { headers: headers, rows: rows };
}

function getMeta_() {
  var t = readTab_(TAB.META);
  var meta = {};
  t.rows.forEach(function (r) { meta[String(r[0])] = r[1]; });
  return meta;
}

// Báo cáo Excel (tab BaoCao_M01 / BaoCao_M02): ghép lại các phần base64 (cột data, bỏ tiền tố "~") theo key + part.
// Cột: key | title | name | reportDate | generatedAt | part | parts | data — khớp M01_REPORT_COLUMNS (main.js).
function getBaoCao_(tabName) {
  var t = readTab_(tabName);
  var h = {}; t.headers.forEach(function (x, i) { h[x] = i; });
  var byKey = {}, order = [];
  if (h.key !== undefined && h.data !== undefined) {
    t.rows.forEach(function (r) {
      var key = String(r[h.key] || '');
      if (!key) return;
      if (!byKey[key]) {
        byKey[key] = { key: key, title: String(r[h.title] || key), name: String(r[h.name] || (key + '.xlsx')),
          reportDate: String(r[h.reportDate] || ''), generatedAt: String(r[h.generatedAt] || ''),
          parts: Number(r[h.parts]) || 0, chunks: [] };
        order.push(key);
      }
      byKey[key].chunks.push({ i: Number(r[h.part]) || 0, d: String(r[h.data] || '').replace(/^~/, '') });
    });
  }
  var files = order.map(function (k) {
    var f = byKey[k];
    f.chunks.sort(function (a, b) { return a.i - b.i; });
    var ok = !f.parts || f.chunks.length === f.parts;
    var out = { key: f.key, title: f.title, name: f.name, reportDate: f.reportDate, generatedAt: f.generatedAt,
      complete: ok, b64: ok ? f.chunks.map(function (c) { return c.d; }).join('') : '' };
    return out;
  });
  return { ok: true, meta: getMeta_(), files: files };
}

function getTable_(name) {
  var t = readTab_(name);
  return { ok: true, headers: t.headers, rows: t.rows, meta: getMeta_() };
}

// Khóa khớp 1 lô hàng — GIỐNG syncMatchKey() trong main.js và pxRowMatchKey() ở Module 02.
function matchKey_(maHang, soLo, size, phieuNhap) {
  return [maHang, soLo, size, phieuNhap].map(function (v) {
    return String(v === null || v === undefined ? '' : v).trim();
  }).join('|');
}

function toDate_(v) {
  if (v instanceof Date) return v;
  if (v === '' || v === null || v === undefined) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function col_(headers, name) { return headers.indexOf(name); }

// Số lượng ĐANG CHỜ trên từng lô: phiếu điện thoại PC chưa nhận, CỘNG phiếu PC đã nhận nhưng
// chưa có trong lần đẩy tồn kho gần nhất (xuLyLuc sau Meta.lastPushAt).
// Khóa: Module 02 = matchKey_(...); Module 01 = 'M01|' + itemKey; Vị trí = 'VT|' + itemKey;
// Vị Trí Bột = 'M01VTB|' + itemKey; M03/M04 = 'M03|' / 'M04|' + itemKey.
function pendingByKey_() {
  var meta = getMeta_();
  // Moc day ton RIENG tung bang (PC cho phep dong bo tung bang) — thieu thi dung moc chung.
  var lastPushOf = function (mod) { return toDate_(meta['lastPushAt_' + mod] || meta.lastPushAt); };
  var px = readTab_(TAB.PX);
  var cId = col_(px.headers, 'id'), cTT = col_(px.headers, 'trangThai'), cXL = col_(px.headers, 'xuLyLuc'),
      cMod = col_(px.headers, 'module');
  var pendingIds = {};
  px.rows.forEach(function (r) {
    var tt = String(r[cTT] || '').trim();
    var id = String(r[cId] || '').trim();
    if (!id || tt.indexOf('Lỗi') === 0) return;
    var m = cMod >= 0 ? String(r[cMod]).trim() : '';
    var mod = MODULES.indexOf(m) >= 0 ? m : 'M02';
    if (tt !== DA_XU_LY) { pendingIds[id] = mod; return; }
    var xl = cXL >= 0 ? toDate_(r[cXL]) : null;
    var lastPush = lastPushOf(mod);
    if (xl && (!lastPush || xl.getTime() > lastPush.getTime())) pendingIds[id] = mod;
  });
  var pxi = readTab_(TAB.PXI);
  var h = pxi.headers;
  var cP = col_(h, 'phieuId'), cMa = col_(h, 'maHang'), cLo = col_(h, 'soLo'), cSz = col_(h, 'size'),
      cPn = col_(h, 'phieuNhap'), cQ = col_(h, 'soLuongXuat'), cK = col_(h, 'itemKey');
  var map = {};
  pxi.rows.forEach(function (r) {
    var mod = pendingIds[String(r[cP]).trim()];
    if (!mod) return;
    var ik = String(cK >= 0 ? r[cK] : '').trim();
    var k = mod === 'M02' ? matchKey_(r[cMa], r[cLo], r[cSz], r[cPn]) : (mod === 'M01VT' ? 'VT' : mod) + '|' + ik;
    map[k] = (map[k] || 0) + (Number(r[cQ]) || 0);
  });
  return map;
}

function getTonKhoM01_() { return getTableWithPending_(TAB.M01); }
function getTableWithPending_(name) {
  var t = readTab_(name);
  return { ok: true, headers: t.headers, rows: t.rows, pending: pendingByKey_(), meta: getMeta_() };
}

// Chuẩn hóa tên cột để so khớp (bỏ dấu, thường, bỏ ký tự đặc biệt) — "Tồn cuối" == "ton cuoi".
function normHeader_(h) {
  return String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[.,()\/\\\-_:;]/g, ' ').replace(/\s+/g, ' ').trim();
}
function findHeader_(headers, name) {
  var i = headers.indexOf(name);
  if (i >= 0) return i;
  var n = normHeader_(name);
  for (var j = 0; j < headers.length; j++) if (normHeader_(headers[j]) === n) return j;
  return -1;
}
// Số kiểu "1,234.5" / "17." / "9.698,4" -> số (giống parseLooseNumber() ở Module 01).
function looseNum_(v) {
  if (typeof v === 'number') return v;
  var s = String(v === null || v === undefined ? '' : v).trim().replace(/[\u00A0\s]/g, '');
  if (!s) return 0;
  var hasComma = s.indexOf(',') >= 0, hasDot = s.indexOf('.') >= 0;
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^-?\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  var m = s.match(/^-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

function getTonKhoGui_() {
  var t = readTab_(TAB.M02);
  return { ok: true, headers: t.headers, rows: t.rows, pending: pendingByKey_(), meta: getMeta_() };
}

// Người dùng có token riêng chỉ thấy phiếu CỦA MÌNH (theo tên) ở các kho được phép; quản trị thấy tất cả.
function phieuVisibleTo_(p, user) {
  if (!user || user.admin) return true;
  var m = MODULES.indexOf(String(p.module || '').trim()) >= 0 ? String(p.module).trim() : 'M02';
  if (user.kho.indexOf(m) < 0) return false;
  var nd = String(p.nguoiDung || '').trim();
  if (nd) return nd.toLowerCase() === user.ten.toLowerCase();
  // Phiếu cũ (trước khi có cột nguoiDung): so theo tên đã ghi ở "Người tạo"
  var nt = String(p.nguoiTao || '').trim();
  return nt === user.ten || nt === user.hienThi;
}
function getPhieu_(user) {
  // Tab PhieuXuat / PhieuXuatItems lớn dần theo thời gian → CHỈ dựng object cho 150 phiếu mới nhất mà người
  // dùng được xem (lọc + cắt TRƯỚC), rồi mới gắn dòng hàng của đúng các phiếu đó (không dựng object cho mọi dòng).
  var px = readTab_(TAB.PX);
  var list = [];
  for (var i = px.rows.length - 1; i >= 0 && list.length < 150; i--) { // mới nhất lên đầu
    var o = {};
    var r = px.rows[i];
    px.headers.forEach(function (name, j) { o[name] = r[j] instanceof Date ? r[j].toISOString() : r[j]; });
    if (phieuVisibleTo_(o, user)) list.push(o);
  }
  var want = {};
  list.forEach(function (p) { p.items = []; want[String(p.id).trim()] = p; });
  var pxi = readTab_(TAB.PXI);
  var ih = pxi.headers, pidCol = ih.indexOf('phieuId');
  pxi.rows.forEach(function (r) {
    var p = want[String(pidCol >= 0 ? r[pidCol] : '').trim()];
    if (!p) return;
    var it = {};
    ih.forEach(function (name, j) { it[name] = r[j]; });
    p.items.push(it);
  });
  return { ok: true, list: list };
}

// Lấy tab theo tên, chưa có thì tạo; đảm bảo dòng tiêu đề có đủ các cột cần dùng.
function ensureTab_(name, headers) {
  var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var row1 = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (!row1.some(function (x) { return x; })) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return { sheet: sh, headers: headers.slice() };
  }
  var cur = row1.slice();
  while (cur.length && !cur[cur.length - 1]) cur.pop();
  var add = headers.filter(function (x) { return cur.indexOf(x) < 0; });
  if (add.length) {
    sh.getRange(1, cur.length + 1, 1, add.length).setValues([add]);
    cur = cur.concat(add);
  }
  return { sheet: sh, headers: cur };
}

// Ghi các dòng (mảng object) vào cuối tab, đúng theo vị trí cột tiêu đề. Ô chữ được định dạng
// "văn bản thuần" TRƯỚC khi ghi để Sheet không tự đổi "0012" thành 12 hay "31/40" thành ngày.
function appendObjects_(tabInfo, objects, numberCols) {
  if (!objects.length) return;
  var sh = tabInfo.sheet, headers = tabInfo.headers;
  var start = sh.getLastRow() + 1;
  var values = objects.map(function (o) {
    return headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; });
  });
  headers.forEach(function (h, i) {
    if ((numberCols || []).indexOf(h) < 0) sh.getRange(start, i + 1, values.length, 1).setNumberFormat('@');
  });
  sh.getRange(start, 1, values.length, headers.length).setValues(values);
}

function createPhieu_(p) {
  if (!p || typeof p !== 'object') throw new Error('Thiếu dữ liệu phiếu.');
  var id = String(p.id || '').trim();
  if (!/^dt_[A-Za-z0-9_-]{6,60}$/.test(id)) throw new Error('Mã nội bộ phiếu không hợp lệ.');
  if (!Array.isArray(p.items) || !p.items.length) throw new Error('Phiếu chưa có dòng hàng nào.');
  if (p.items.length > 300) throw new Error('Một phiếu tối đa 300 dòng hàng.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Hệ thống đang bận, vui lòng gửi lại sau ít giây.');
  try {
    var pxTab = ensureTab_(TAB.PX, PX_HEADERS);
    var pxiTab = ensureTab_(TAB.PXI, PXI_HEADERS);
    var px = readTab_(TAB.PX);
    var cId = col_(px.headers, 'id'), cMa = col_(px.headers, 'maPhieu');

    // Gửi lại cùng 1 phiếu (VD mất mạng lúc chờ phản hồi) -> không tạo trùng.
    for (var i = 0; i < px.rows.length; i++) {
      if (String(px.rows[i][cId]).trim() === id) {
        return { ok: true, duplicate: true, maPhieu: String(px.rows[i][cMa]) };
      }
    }

    var module = MODULES.indexOf(p.module) >= 0 ? p.module : 'M02';
    var lsxXuat = '';
    if (module === 'M03') {
      lsxXuat = String(p.lsxXuat || '').trim();
      if (!lsxXuat) throw new Error('Phiếu Module 03 phải chọn "LSX xuất".');
    }
    var pending = pendingByKey_();
    var built = module === 'M01' ? buildItemsM01_(id, p.items, pending)
      : module === 'M01VT' ? buildItemsVT_(id, p.items, pending)
      : module === 'M01VTB' ? buildItemsVTB_(id, p.items, pending)
      : module === 'M03' ? buildItemsKey_(id, p.items, pending, TAB.M03, 'M03', 'Tổng (kg)', ['Mã Hàng', 'Loại Hàng'], ['Vị trí', 'LSX / Hợp đồng'])
      : module === 'M04' ? buildItemsKey_(id, p.items, pending, TAB.M04, 'M04', 'SL tồn', ['Mã hàng', 'Loại hàng'], ['Vị trí', 'Size'])
      : buildItemsM02_(id, p.items, pending);
    if (built.error) return built.error;

    var maPhieu = String(p.maPhieu || '').trim() || id;
    var used = {};
    px.rows.forEach(function (r) { used[String(r[cMa])] = true; });
    if (used[maPhieu]) { var n = 2; while (used[maPhieu + '-' + n]) n++; maPhieu = maPhieu + '-' + n; }

    appendObjects_(pxiTab, built.items, PXI_NUMBER_COLS);   // dòng hàng TRƯỚC
    SpreadsheetApp.flush();
    appendObjects_(pxTab, [{
      id: id, maPhieu: maPhieu, ngayTao: new Date().toISOString(), trangThai: CHUA_XU_LY,
      nguoiTao: String(p.nguoiTao || '').slice(0, 60), ghiChu: String(p.ghiChu || '').slice(0, 300), xuLyLuc: '',
      module: module, lsxXuat: lsxXuat, nguoiDung: String(p.nguoiDung || '').slice(0, 40)
    }], []);                                           // đầu phiếu SAU
    SpreadsheetApp.flush();
    return { ok: true, maPhieu: maPhieu };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================================
// SỬA / XÓA PHIẾU từ điện thoại — chỉ khi PC CHƯA nhận (trangThai "Chưa xử lý").
// PC đã nhận thì tồn đã bị trừ trong file Excel trên PC: phải hủy/sửa ngay trên PC.
// ============================================================================================
function assertPhieuId_(id) {
  id = String(id || '').trim();
  if (!/^dt_[A-Za-z0-9_-]{6,60}$/.test(id)) throw new Error('Mã nội bộ phiếu không hợp lệ.');
  return id;
}

// Đọc thẳng từ Sheet để có SỐ DÒNG thật (readTab_ bỏ dòng trống nên số dòng bị lệch).
function findPxRow_(id) {
  var sh = ss_().getSheetByName(TAB.PX);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
  var h = vals[0].map(String);
  var cId = h.indexOf('id'), cTT = h.indexOf('trangThai');
  if (cId < 0 || cTT < 0) return null;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][cId]).trim() !== id) continue;
    var o = {};
    h.forEach(function (name, j) { o[name] = vals[i][j]; });
    return { sheet: sh, row: i + 1, headers: h, cur: o };
  }
  return null;
}

function setPxCell_(f, name, value) {
  var c = f.headers.indexOf(name);
  if (c < 0) return;
  f.sheet.getRange(f.row, c + 1).setNumberFormat('@').setValue(String(value));
}

function editableStatus_(tt) {
  tt = String(tt || '').trim();
  return tt === '' || tt === CHUA_XU_LY || tt === DANG_SUA;
}

function notEditableError_(tt) {
  tt = String(tt || '').trim();
  var msg = tt === DA_XU_LY
    ? 'PC đã nhận phiếu này rồi nên không sửa/xóa được từ điện thoại. Cần hủy thì làm trên app PC.'
    : (tt.indexOf(HUY_PREFIX) === 0 ? 'Phiếu này đã được hủy trước đó.' : 'Phiếu này không sửa được (trạng thái: ' + tt + ').');
  return { ok: false, code: 'DA_XU_LY', error: msg };
}

function findItemRows_(id) {
  var sh = ss_().getSheetByName(TAB.PXI);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
  var c = vals[0].map(String).indexOf('phieuId');
  if (c < 0) return [];
  var rows = [];
  for (var i = 1; i < vals.length; i++) if (String(vals[i][c]).trim() === id) rows.push(i + 1);
  return rows;
}

// rows: số dòng tăng dần. Xóa từ dưới lên, gộp các dòng liền nhau thành 1 lệnh.
function deleteRows_(sh, rows) {
  var i = rows.length - 1;
  while (i >= 0) {
    var end = rows[i], start = end;
    while (i > 0 && rows[i - 1] === start - 1) { i--; start = rows[i]; }
    sh.deleteRows(start, end - start + 1);
    i--;
  }
}

function buildItemsFor_(module, id, items, pending) {
  return module === 'M01' ? buildItemsM01_(id, items, pending)
    : module === 'M01VT' ? buildItemsVT_(id, items, pending)
    : module === 'M01VTB' ? buildItemsVTB_(id, items, pending)
    : module === 'M03' ? buildItemsKey_(id, items, pending, TAB.M03, 'M03', 'Tổng (kg)', ['Mã Hàng', 'Loại Hàng'], ['Vị trí', 'LSX / Hợp đồng'])
    : module === 'M04' ? buildItemsKey_(id, items, pending, TAB.M04, 'M04', 'SL tồn', ['Mã hàng', 'Loại hàng'], ['Vị trí', 'Size'])
    : buildItemsM02_(id, items, pending);
}

// Sửa phiếu: thay TOÀN BỘ dòng hàng + ghi chú (+ LSX xuất với M03). Giữ nguyên mã phiếu, ngày tạo, người tạo.
function editPhieu_(p) {
  if (!p || typeof p !== 'object') throw new Error('Thiếu dữ liệu phiếu.');
  var id = assertPhieuId_(p.id);
  if (!Array.isArray(p.items) || !p.items.length) throw new Error('Phiếu chưa có dòng hàng nào.');
  if (p.items.length > 300) throw new Error('Một phiếu tối đa 300 dòng hàng.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Hệ thống đang bận, vui lòng thử lại sau ít giây.');
  try {
    var f = findPxRow_(id);
    if (!f) return { ok: false, code: 'NOT_FOUND', error: 'Không tìm thấy phiếu trên Google Sheet (có thể đã bị xóa).' };
    var tt = String(f.cur.trangThai || '').trim();
    if (!editableStatus_(tt)) return notEditableError_(tt);

    var module = MODULES.indexOf(String(f.cur.module || '').trim()) >= 0 ? String(f.cur.module).trim() : 'M02';
    var lsxXuat = String(f.cur.lsxXuat || '').trim();
    if (module === 'M03') {
      lsxXuat = String(p.lsxXuat || lsxXuat).trim();
      if (!lsxXuat) throw new Error('Phiếu Module 03 phải chọn "LSX xuất".');
    }
    var pxiTab = ensureTab_(TAB.PXI, PXI_HEADERS);

    // "Giữ chỗ": trong lúc sửa, PC bỏ qua phiếu này và tồn "chờ PC" không tính dòng cũ của nó.
    var finalStatus = tt === DANG_SUA ? DANG_SUA : CHUA_XU_LY;   // phiếu kẹt "đang sửa" chỉ được nhả khi sửa xong
    var touched = false;
    setPxCell_(f, 'trangThai', DANG_SUA);
    SpreadsheetApp.flush();
    try {
      var built = buildItemsFor_(module, id, p.items, pendingByKey_());
      if (built.error) return built.error;                       // thiếu hàng: giữ nguyên phiếu cũ
      var oldRows = findItemRows_(id);                           // số dòng cũ, tính TRƯỚC khi thêm dòng mới
      touched = true;
      appendObjects_(pxiTab, built.items, PXI_NUMBER_COLS);      // dòng mới TRƯỚC, xóa dòng cũ SAU
      SpreadsheetApp.flush();
      deleteRows_(pxiTab.sheet, oldRows);
      setPxCell_(f, 'ghiChu', String(p.ghiChu || '').slice(0, 300));
      if (module === 'M03') setPxCell_(f, 'lsxXuat', lsxXuat);
      SpreadsheetApp.flush();
      finalStatus = CHUA_XU_LY;
      return { ok: true, maPhieu: String(f.cur.maPhieu) };
    } catch (err) {
      if (touched) finalStatus = DANG_SUA;                        // đã đụng vào dòng hàng mà lỗi giữa chừng: giữ khóa, sửa lại sẽ dọn sạch
      throw err;
    } finally {
      setPxCell_(f, 'trangThai', finalStatus);
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
}

// Xóa phiếu = HỦY MỀM: đổi trạng thái, không xóa dòng (giữ vết trên Sheet, và số dòng của PC không bị lệch).
function cancelPhieu_(id) {
  id = assertPhieuId_(id);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Hệ thống đang bận, vui lòng thử lại sau ít giây.');
  try {
    var f = findPxRow_(id);
    if (!f) return { ok: false, code: 'NOT_FOUND', error: 'Không tìm thấy phiếu trên Google Sheet (có thể đã bị xóa).' };
    var tt = String(f.cur.trangThai || '').trim();
    if (tt.indexOf(HUY_PREFIX) === 0) return { ok: true, already: true };
    if (!editableStatus_(tt)) return notEditableError_(tt);
    setPxCell_(f, 'trangThai', HUY);
    setPxCell_(f, 'xuLyLuc', new Date().toISOString());
    SpreadsheetApp.flush();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Phiếu Module 02: kiểm tra với TonKho_M02 (Số kiện − phiếu đang chờ), khóa = matchKey_.
function buildItemsM02_(id, reqItems, pending) {
    var ton = readTab_(TAB.M02);
    var h = ton.headers;
    var iMa = col_(h, M2.maHang), iLo = col_(h, M2.soLo), iSz = col_(h, M2.size), iPn = col_(h, M2.phieuNhap),
        iSk = col_(h, M2.soKien), iTen = col_(h, M2.tenHang);
    if (iMa < 0 || iSk < 0) throw new Error('Chưa có dữ liệu tồn kho gửi trên Sheet (PC chưa đồng bộ).');
    var rowByKey = {};
    ton.rows.forEach(function (r) { rowByKey[matchKey_(r[iMa], r[iLo], r[iSz], r[iPn])] = r; });

    var want = {};
    var items = reqItems.map(function (it) {
      var qty = Number(it.soLuongXuat);
      if (!(qty > 0)) throw new Error('Số lượng xuất phải lớn hơn 0 (mã ' + it.maHang + ').');
      var k = matchKey_(it.maHang, it.soLo, it.size, it.phieuNhap);
      var r = rowByKey[k];
      if (!r) throw new Error('Lô ' + it.maHang + ' / ' + it.soLo + ' không còn trong tồn kho mới nhất — tải lại danh sách.');
      want[k] = (want[k] || 0) + qty;
      return {
        phieuId: id, maHang: r[iMa], tenHang: iTen >= 0 ? r[iTen] : (it.tenHang || ''),
        phieuNhap: iPn >= 0 ? r[iPn] : '', soLo: iLo >= 0 ? r[iLo] : '', size: iSz >= 0 ? r[iSz] : '',
        soKien: Number(r[iSk]) || 0, soLuongXuat: qty
      };
    });
    var thieu = [];
    Object.keys(want).forEach(function (k) {
      var con = (Number(rowByKey[k][iSk]) || 0) - (pending[k] || 0);
      if (want[k] > con + 1e-9) thieu.push(rowByKey[k][iMa] + ' lô ' + rowByKey[k][iLo] + ': còn ' + con + ', xin xuất ' + want[k]);
    });
    if (thieu.length) return { error: { ok: false, code: 'THIEU_HANG', error: 'Không đủ hàng:\n' + thieu.join('\n') } };
    return { items: items };
}

// Phiếu Module 01: kiểm tra với TonKho_M01 ("Tồn cuối" − phiếu đang chờ), dòng xác định bằng cột
// "_key" (Item ID, hoặc số thứ tự dòng khi dữ liệu không có Item ID) do app PC đẩy lên.
function buildItemsM01_(id, reqItems, pending) {
  var ton = readTab_(TAB.M01);
  var h = ton.headers;
  var iKey = h.indexOf('_key'), iRow = h.indexOf('_row'), iTon = findHeader_(h, 'Tồn cuối'),
      iMa = findHeader_(h, 'Mã hàng'), iTen = findHeader_(h, 'Tên hàng'), iSz = findHeader_(h, 'Size'),
      iHd = findHeader_(h, 'Hợp đồng');
  if (iKey < 0 || iTon < 0) throw new Error('Tồn kho Module 01 trên Sheet chưa đúng định dạng — trên PC bấm "Đồng bộ ngay" rồi thử lại.');
  var rowByKey = {};
  ton.rows.forEach(function (r) { rowByKey[String(r[iKey]).trim()] = r; });

  var want = {};
  var items = reqItems.map(function (it) {
    var qty = Number(it.soLuongXuat);
    if (!(qty > 0)) throw new Error('Số lượng xuất phải lớn hơn 0 (mã ' + it.maHang + ').');
    var key = String(it.itemKey || '').trim();
    var r = rowByKey[key];
    if (!r) throw new Error('Dòng ' + it.maHang + ' không còn trong tồn kho mới nhất — tải lại danh sách.');
    want[key] = (want[key] || 0) + qty;
    return {
      phieuId: id, maHang: iMa >= 0 ? r[iMa] : (it.maHang || ''), tenHang: iTen >= 0 ? r[iTen] : (it.tenHang || ''),
      phieuNhap: '', soLo: '', size: iSz >= 0 ? r[iSz] : '', soKien: looseNum_(r[iTon]), soLuongXuat: qty,
      itemKey: key, rowIndex: iRow >= 0 ? r[iRow] : '', hopDong: iHd >= 0 ? r[iHd] : ''
    };
  });
  var thieu = [];
  Object.keys(want).forEach(function (key) {
    var r = rowByKey[key];
    var con = looseNum_(r[iTon]) - (pending['M01|' + key] || 0);
    if (want[key] > con + 1e-9) thieu.push((iMa >= 0 ? r[iMa] : key) + ': còn ' + con + ', xin xuất ' + want[key]);
  });
  if (thieu.length) return { error: { ok: false, code: 'THIEU_HANG', error: 'Không đủ hàng:\n' + thieu.join('\n') } };
  return { items: items };
}

// Phiếu Module 01 › Tồn theo vị trí: kiểm tra với TonKho_M01_ViTri ("SL Tồn" − phiếu đang chờ),
// dòng xác định bằng cột "_key" (Mã hàng|Lô|Vị trí#thứ tự trùng) do app PC đẩy lên.
function buildItemsVT_(id, reqItems, pending) {
  var ton = readTab_(TAB.VITRI);
  var h = ton.headers;
  var iKey = h.indexOf('_key'), iSl = findHeader_(h, 'SL Tồn'), iMa = findHeader_(h, 'Mã hàng'),
      iTen = findHeader_(h, 'Tên hàng'), iLo = findHeader_(h, 'Lô (Batch)'), iVt = findHeader_(h, 'Vị trí');
  if (iKey < 0 || iSl < 0) throw new Error('Tồn theo vị trí trên Sheet chưa đúng định dạng — trên PC bấm "Đồng bộ ngay" rồi thử lại.');
  var rowByKey = {};
  ton.rows.forEach(function (r) { rowByKey[String(r[iKey]).trim()] = r; });
  var want = {};
  var items = reqItems.map(function (it) {
    var qty = Number(it.soLuongXuat);
    if (!(qty > 0)) throw new Error('Số lượng xuất phải lớn hơn 0 (mã ' + it.maHang + ').');
    var key = String(it.itemKey || '').trim();
    var r = rowByKey[key];
    if (!r) throw new Error('Dòng ' + it.maHang + ' tại ' + (it.viTri || '') + ' không còn trong tồn theo vị trí mới nhất — tải lại danh sách.');
    want[key] = (want[key] || 0) + qty;
    return {
      phieuId: id, maHang: iMa >= 0 ? r[iMa] : (it.maHang || ''), tenHang: iTen >= 0 ? r[iTen] : (it.tenHang || ''),
      phieuNhap: '', soLo: iLo >= 0 ? r[iLo] : '', size: '', soKien: looseNum_(r[iSl]), soLuongXuat: qty,
      itemKey: key, rowIndex: '', hopDong: '', viTri: iVt >= 0 ? r[iVt] : ''
    };
  });
  var thieu = [];
  Object.keys(want).forEach(function (key) {
    var r = rowByKey[key];
    var con = looseNum_(r[iSl]) - (pending['VT|' + key] || 0);
    if (want[key] > con + 1e-9) thieu.push((iMa >= 0 ? r[iMa] : key) + ' @ ' + (iVt >= 0 ? r[iVt] : '') + ': còn ' + con + ', xin xuất ' + want[key]);
  });
  if (thieu.length) return { error: { ok: false, code: 'THIEU_HANG', error: 'Không đủ hàng:\n' + thieu.join('\n') } };
  return { items: items };
}

// Phiếu Module 03 / 04: dòng xác định bằng cột "_key" (M03: mã lô; M04: "<id lô nhập>::<vị trí>")
// do app PC đẩy lên; số lượng tồn ở cột qtyCol trừ phiếu đang chờ ('M03|key' / 'M04|key').
// nameCols: cột dùng làm Mã hàng / Tên hàng; extraCols: 2 cột ghi vào soLo / viTri để dễ đọc.
function buildItemsKey_(id, reqItems, pending, tab, mod, qtyCol, nameCols, extraCols) {
  var ton = readTab_(tab);
  var h = ton.headers;
  var iKey = h.indexOf('_key'), iQty = findHeader_(h, qtyCol), iMa = findHeader_(h, nameCols[0]),
      iTen = findHeader_(h, nameCols[1]), iX1 = findHeader_(h, extraCols[0]), iX2 = findHeader_(h, extraCols[1]);
  if (iKey < 0 || iQty < 0) throw new Error('Tồn kho ' + mod + ' trên Sheet chưa có — trên PC bấm "Đồng bộ ngay" rồi thử lại.');
  var rowByKey = {};
  ton.rows.forEach(function (r) { rowByKey[String(r[iKey]).trim()] = r; });
  var want = {};
  var items = reqItems.map(function (it) {
    var qty = Number(it.soLuongXuat);
    if (!(qty > 0)) throw new Error('Số lượng xuất phải lớn hơn 0 (mã ' + it.maHang + ').');
    var key = String(it.itemKey || '').trim();
    var r = rowByKey[key];
    if (!r) throw new Error('Dòng ' + (it.maHang || key) + ' không còn trong tồn kho mới nhất — tải lại danh sách.');
    want[key] = (want[key] || 0) + qty;
    return {
      phieuId: id, maHang: iMa >= 0 ? r[iMa] : (it.maHang || ''), tenHang: iTen >= 0 ? r[iTen] : (it.tenHang || ''),
      phieuNhap: '', soLo: iX2 >= 0 ? r[iX2] : '', size: '', soKien: looseNum_(r[iQty]), soLuongXuat: qty,
      itemKey: key, rowIndex: '', hopDong: '', viTri: iX1 >= 0 ? r[iX1] : ''
    };
  });
  var thieu = [];
  Object.keys(want).forEach(function (key) {
    var r = rowByKey[key];
    var con = looseNum_(r[iQty]) - (pending[mod + '|' + key] || 0);
    if (want[key] > con + 1e-6) thieu.push((iMa >= 0 ? r[iMa] : key) + (iX1 >= 0 ? ' @ ' + r[iX1] : '') + ': còn ' + con + ', xin xuất ' + want[key]);
  });
  if (thieu.length) return { error: { ok: false, code: 'THIEU_HANG', error: 'Không đủ hàng:\n' + thieu.join('\n') } };
  return { items: items };
}

// Phiếu Module 01 › Vị Trí Bột: tab TonKho_M01_ViTriBot (PC đẩy: Vị trí, Mã hàng, SL, NSX, HSD, Nhập,
// Ghi chú, _key). Khóa dòng "_key" = Mã hàng|Vị trí|NSX|HSD#thứ tự trùng — GIỐNG vtbRowKeys() trong main.js
// và vtbPhoneKeys() trong ton-kho-an-an.js. soLo = NSX, tenHang = Ghi chú (chỉ để đọc cho dễ trên Sheet).
function buildItemsVTB_(id, reqItems, pending) {
  return buildItemsKey_(id, reqItems, pending, TAB.VITRIBOT, 'M01VTB', 'SL', ['Mã hàng', 'Ghi chú'], ['Vị trí', 'NSX']);
}

// ============================================================================================
// CÁC LỆNH DÀNH RIÊNG CHO APP PC (PC_TOKEN) — xem app/sheets-webapp-client.js
// ============================================================================================
var PC_ALLOWED_TABS = [TAB.PQ, TAB.M01, TAB.VITRI, TAB.VITRIBOT, TAB.M02, TAB.M03, TAB.M03_LSX, TAB.M04, TAB.META, TAB.PX, TAB.PXI,
  TAB.M08_MAHOA, TAB.M08_MADATAO, TAB.M08_TONGHOP, TAB.M08_RADONG, TAB.M08_SIZE, TAB.M08_KS, TAB.M08_KSXOA, TAB.M01_BAOCAO, TAB.M02_BAOCAO, TAB.LX, TAB.LX_THANG, TAB.LX_YC, TAB.PX_LUUTRU, TAB.PXI_LUUTRU];
function assertPcTab_(name) {
  if (PC_ALLOWED_TABS.indexOf(name) < 0) throw new Error('Không được phép thao tác tab "' + name + '".');
}

// tabs: { tenTab: [tiêu đề...] | null }
function pcEnsureTabs_(tabs) {
  Object.keys(tabs || {}).forEach(function (name) {
    assertPcTab_(name);
    if (tabs[name] && tabs[name].length) ensureTab_(name, tabs[name]);
    else if (!ss_().getSheetByName(name)) ss_().insertSheet(name);
  });
  return { ok: true };
}

// Ghi đè toàn bộ 1 tab. Ghi dữ liệu mới TRƯỚC, xóa phần thừa SAU — điện thoại đọc giữa chừng
// không bao giờ thấy tab trống. Cột toàn số giữ kiểu số; cột có chữ được định dạng "văn bản
// thuần" để Sheet không tự đổi "0012" → 12 hay "31/40" → ngày tháng.
function pcWriteTable_(name, columns, rows) {
  assertPcTab_(name);
  if (!Array.isArray(columns) || !columns.length) columns = ['(không có dữ liệu)'];
  rows = Array.isArray(rows) ? rows : [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet đang bận, thử lại sau.');
  try {
    var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
    var nCols = columns.length;
    var values = [columns.map(String)].concat(rows.map(function (r) {
      var out = [];
      for (var j = 0; j < nCols; j++) out.push(r[j] === null || r[j] === undefined ? '' : r[j]);
      return out;
    }));
    // Đủ chỗ cho bảng mới (tab mới tạo chỉ có 1000 dòng x 26 cột).
    if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
    if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());

    if (values.length > 1) {
      for (var c = 0; c < nCols; c++) {
        var allNum = true;
        for (var i = 1; i < values.length; i++) {
          var v = values[i][c];
          if (v !== '' && typeof v !== 'number') { allNum = false; break; }
        }
        sh.getRange(2, c + 1, values.length - 1, 1).setNumberFormat(allNum ? 'General' : '@');
        if (!allNum) for (var k = 1; k < values.length; k++) values[k][c] = values[k][c] === '' ? '' : String(values[k][c]);
      }
    }
    sh.getRange(1, 1, 1, nCols).setNumberFormat('@');
    sh.getRange(1, 1, values.length, nCols).setValues(values);

    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow > values.length) sh.getRange(values.length + 1, 1, lastRow - values.length, Math.max(lastCol, 1)).clearContent();
    if (lastCol > nCols) sh.getRange(1, nCols + 1, Math.max(lastRow, 1), lastCol - nCols).clearContent();
    SpreadsheetApp.flush();
    return { ok: true, rows: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// Đọc 1 tab: { headers, rows } — rows là mảng giá trị, kèm số dòng thật trên Sheet (rowNumbers).
function pcReadTable_(name) {
  assertPcTab_(name);
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return { ok: true, headers: [], rows: [], rowNumbers: [] };
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var rows = [], rowNumbers = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r.some(function (c) { return c !== '' && c !== null; })) continue;
    rows.push(r.map(function (c) { return c instanceof Date ? c.toISOString() : c; }));
    rowNumbers.push(i + 1);
  }
  return { ok: true, headers: headers, rows: rows, rowNumbers: rowNumbers };
}

// updates: [{ rowNumber, values: { tenCot: giaTri } }] — tìm cột theo tên tiêu đề.
function pcMarkRows_(name, updates) {
  assertPcTab_(name);
  if (!Array.isArray(updates) || !updates.length) return { ok: true, updated: 0 };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet đang bận, thử lại sau.');
  try {
    var sh = ss_().getSheetByName(name);
    if (!sh) throw new Error('Không có tab "' + name + '".');
    var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    // AN TOÀN (09/2026): PC gửi kèm "id" phiếu → kiểm tra dòng rowNumber đúng là phiếu đó. Dòng đã dịch chuyển
    // (VD vừa lưu trữ phiếu cũ, xóa dòng) thì tìm lại theo id; không thấy thì BỎ QUA thay vì ghi nhầm phiếu khác.
    var cId = headers.indexOf('id'), idRow = null, skipped = 0;
    var rowOfId = function (id) {
      if (!idRow) {
        idRow = {};
        var last = sh.getLastRow();
        if (last >= 2) sh.getRange(2, cId + 1, last - 1, 1).getValues().forEach(function (v, i) { idRow[String(v[0]).trim()] = i + 2; });
      }
      return idRow[id] || 0;
    };
    updates.forEach(function (u) {
      var rowNumber = u.rowNumber;
      if (u.id && cId >= 0) {
        var want = String(u.id).trim();
        if (String(sh.getRange(rowNumber, cId + 1).getValue()).trim() !== want) rowNumber = rowOfId(want);
        if (!rowNumber) { skipped++; return; }
      }
      Object.keys(u.values || {}).forEach(function (col) {
        var idx = headers.indexOf(col);
        if (idx < 0) throw new Error('Tab "' + name + '" thiếu cột "' + col + '".');
        sh.getRange(rowNumber, idx + 1).setNumberFormat('@').setValue(String(u.values[col]));
      });
    });
    SpreadsheetApp.flush();
    return { ok: true, updated: updates.length - skipped, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------------------------
// LƯU TRỮ PHIẾU CŨ (09/2026) — tab PhieuXuat / PhieuXuatItems tăng mãi; mọi lần điện thoại hỏi tồn
// (pendingByKey_) và PC kéo phiếu đều đọc CẢ tab → càng dùng lâu càng chậm. PC gọi "pc.archive" (tối đa
// 1 lần/ngày, SAU khi kéo + đánh dấu phiếu xong, trong khóa đồng bộ của PC) để CHUYỂN (không xóa mất) phiếu:
//   - trạng thái "Đã xử lý" mà PC đã đẩy tồn SAU lúc xử lý (không còn tính "đang chờ" — đúng điều kiện
//     pendingByKey_), hoặc trạng thái bắt đầu bằng "Lỗi" (không bao giờ tính);
//   - và xử lý (xuLyLuc, thiếu thì ngayTao) cách đây hơn `days` ngày (mặc định 90, tối thiểu 30).
// Phiếu "Chưa xử lý" / "Đang sửa" KHÔNG BAO GIỜ bị chuyển. Ghi sang tab lưu trữ TRƯỚC, xóa ở tab chính SAU
// (lỗi giữa chừng chỉ có thể làm phiếu có mặt ở cả 2 nơi, không bao giờ mất). Giữ khóa script suốt quá trình
// → điện thoại tạo / sửa phiếu cùng lúc phải đợi, không chen ngang.
// ---------------------------------------------------------------------------------------------
function pcArchive_(days) {
  days = Math.max(30, Number(days) || 90);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet đang bận, thử lại sau.');
  try {
    var shPx = ss_().getSheetByName(TAB.PX);
    if (!shPx || shPx.getLastRow() < 2) return { ok: true, moved: 0, movedItems: 0 };
    var cutoff = Date.now() - days * 86400000;
    var meta = getMeta_();
    var lastPushOf = function (mod) { return toDate_(meta['lastPushAt_' + mod] || meta.lastPushAt); };
    var vals = shPx.getDataRange().getValues();
    var h = vals[0].map(String);
    var cId = h.indexOf('id'), cTT = h.indexOf('trangThai'), cXL = h.indexOf('xuLyLuc'), cNT = h.indexOf('ngayTao'), cMod = h.indexOf('module');
    if (cId < 0 || cTT < 0) return { ok: true, moved: 0, movedItems: 0 };
    var move = [], moveRows = [], ids = {};
    for (var i = 1; i < vals.length; i++) {
      var r = vals[i];
      var id = String(r[cId] || '').trim(), tt = String(r[cTT] || '').trim();
      if (!id) continue;
      var loi = tt.indexOf('Lỗi') === 0;
      if (tt !== DA_XU_LY && !loi) continue;                              // còn chờ / đang sửa: giữ
      if (tt === DANG_SUA) continue;
      var t = (cXL >= 0 ? toDate_(r[cXL]) : null) || (cNT >= 0 ? toDate_(r[cNT]) : null);
      if (!t || t.getTime() >= cutoff) continue;                          // chưa đủ cũ
      if (!loi) {
        var m = cMod >= 0 ? String(r[cMod]).trim() : '';
        var lp = lastPushOf(MODULES.indexOf(m) >= 0 ? m : 'M02');
        if (!lp || t.getTime() > lp.getTime()) continue;                  // pendingByKey_ vẫn tính: giữ
      }
      move.push(r); moveRows.push(i + 1); ids[id] = true;
    }
    if (!move.length) return { ok: true, moved: 0, movedItems: 0 };
    var shPxi = ss_().getSheetByName(TAB.PXI);
    var moveI = [], moveIRows = [], hI = [];
    if (shPxi && shPxi.getLastRow() >= 2) {
      var valsI = shPxi.getDataRange().getValues();
      hI = valsI[0].map(String);
      var cP = hI.indexOf('phieuId');
      for (var j = 1; j < valsI.length; j++) {
        if (cP >= 0 && ids[String(valsI[j][cP]).trim()]) { moveI.push(valsI[j]); moveIRows.push(j + 1); }
      }
    }
    var toObjs = function (headers, rows) {
      return rows.map(function (r) { var o = {}; headers.forEach(function (name, k) { if (name) o[name] = r[k] instanceof Date ? r[k].toISOString() : r[k]; }); return o; });
    };
    // 1) GHI sang tab lưu trữ (cùng tên cột, thiếu cột thì ensureTab_ tự thêm)
    appendObjects_(ensureTab_(TAB.PX_LUUTRU, h.filter(String)), toObjs(h, move), []);
    if (moveI.length) appendObjects_(ensureTab_(TAB.PXI_LUUTRU, hI.filter(String)), toObjs(hI, moveI), PXI_NUMBER_COLS);
    SpreadsheetApp.flush();
    // 2) XÓA ở tab chính (từ dưới lên, gộp dòng liền nhau)
    if (moveIRows.length) deleteRows_(shPxi, moveIRows);
    deleteRows_(shPx, moveRows);
    SpreadsheetApp.flush();
    return { ok: true, moved: move.length, movedItems: moveI.length };
  } finally {
    lock.releaseLock();
  }
}


// ===========================================================================================
// KHÁNG SINH — ĐỒNG BỘ "CHỈ PHẦN MỚI" (PC 5.0 / điện thoại 2.0)
// Tab M08_KhangSinh: key | u (lúc sửa cuối, ISO) | v (bản rút gọn JSON). Tab M08_KhangSinhXoa: key | u (lúc xoá).
// PC gửi pc.ksUpsert chỉ các dòng mới / vừa sửa / vừa xoá (lần đầu: full = true, gửi cả bảng theo từng đợt). Cột u do
// Apps Script gán = giờ máy chủ lúc nhận (luôn tăng) — điện thoại dùng làm mốc "kể từ".
// Điện thoại gọi ksSince(since): nhận dòng có u > since + danh sách xoá có u > since + TỔNG số dòng để tự kiểm khớp.
// ===========================================================================================
var KS_COLS = ['key', 'u', 'v'];
function ksTab_(name, cols) {
  var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  return sh;
}
function pcKsUpsert_(rows, dels, full) {
  rows = Array.isArray(rows) ? rows : []; dels = Array.isArray(dels) ? dels : [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet đang bận, thử lại sau.');
  try {
    var sh = ksTab_(TAB.M08_KS, KS_COLS);
    var data = full ? [] : (sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : []);
    var idx = {};
    data.forEach(function (r, i) { idx[String(r[0])] = i; });
    var nowU = new Date().toISOString(); // mốc do MÁY CHỦ gán (không tin đồng hồ máy PC)
    rows.forEach(function (r) {
      var k = String(r[0] || ''); if (!k) return;
      var line = [k, nowU, String(r[2] == null ? '' : r[2])];
      if (idx.hasOwnProperty(k)) data[idx[k]] = line; else { idx[k] = data.length; data.push(line); }
    });
    var delSet = {};
    dels.forEach(function (d) { delSet[String(d[0] || '')] = true; });
    if (dels.length) data = data.filter(function (r) { return !delSet[String(r[0])]; });
    // ghi lại cả tab (đơn giản, chắc chắn; 60.000 dòng × 3 ô vẫn trong vài giây)
    var values = [KS_COLS].concat(data);
    if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
    sh.getRange(1, 1, values.length, 3).setNumberFormat('@').setValues(values);
    var last = sh.getLastRow();
    if (last > values.length) sh.getRange(values.length + 1, 1, last - values.length, 3).clearContent();
    // danh sách xoá (để điện thoại xoá theo); lần full thì làm mới
    var xs = ksTab_(TAB.M08_KSXOA, ['key', 'u']);
    if (full && xs.getLastRow() > 1) xs.getRange(2, 1, xs.getLastRow() - 1, 2).clearContent();
    if (dels.length) {
      var start = Math.max(xs.getLastRow(), 1) + 1;
      var dv = dels.map(function (d) { return [String(d[0] || ''), nowU]; });
      if (xs.getMaxRows() < start + dv.length) xs.insertRowsAfter(xs.getMaxRows(), start + dv.length - xs.getMaxRows());
      xs.getRange(start, 1, dv.length, 2).setNumberFormat('@').setValues(dv);
    }
    SpreadsheetApp.flush();
    return { ok: true, total: data.length };
  } finally {
    lock.releaseLock();
  }
}
function ksSince_(since) {
  since = String(since || '');
  var sh = ss_().getSheetByName(TAB.M08_KS);
  var data = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  var rows = [], maxU = since;
  data.forEach(function (r) {
    var k = String(r[0] || ''); if (!k) return;
    var u = String(r[1] || '');
    if (u > maxU) maxU = u;
    if (!since || u > since) rows.push([k, u, String(r[2] == null ? '' : r[2])]);
  });
  var dels = [];
  if (since) {
    var xs = ss_().getSheetByName(TAB.M08_KSXOA);
    var xd = xs && xs.getLastRow() > 1 ? xs.getRange(2, 1, xs.getLastRow() - 1, 2).getValues() : [];
    xd.forEach(function (r) { var u = String(r[1] || ''); if (u > since) { dels.push(String(r[0] || '')); if (u > maxU) maxU = u; } });
  }
  return { ok: true, full: !since, rows: rows, dels: dels, total: data.filter(function (r) { return String(r[0] || ''); }).length, u: maxU };
}
