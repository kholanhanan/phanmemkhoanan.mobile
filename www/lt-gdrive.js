/* LƯU TRỮ CÁ NHÂN — ĐĂNG NHẬP GMAIL / GOOGLE DRIVE CÁ NHÂN TRÊN ĐIỆN THOẠI (ĐT 1.25).
   Mục đích: lấy dữ liệu Lưu trữ cá nhân mà bản PC đã sao lưu lên Drive CÁ NHÂN của chính người dùng
   (Drive cá nhân › M19: KhoLanh_AnAn/<tài khoản>/LuuTruCaNhan/data.json + files/<YYYY-MM~mã__tên file>) về điện thoại.
   • ĐT 1.32: ĐỒNG BỘ 2 CHIỀU. Đọc: data.json + files/ do PC sao lưu (PC → điện thoại). Ghi: CHỈ trong LuuTruCaNhan/phone/ (outbox.json = các mục điện thoại đã thêm / sửa / xóa;
     pfiles/<mã>__<tên> = file đính kèm) — PC đọc thư mục này rồi trộn (điện thoại → PC). KHÔNG sửa / xóa data.json hay files/ của PC.
     Dữ liệu lấy về được trộn vào kho trên máy bằng luật `up` lớn hơn thắng (lt-backend.js › merge).
   • Đăng nhập GIỐNG PC: bấm "Đăng nhập Gmail" → trình duyệt mở trang Google → chọn email → Cho phép → quay lại app. Không nhập Client ID, không gõ mã.
     Google chuyển hướng về chính Web App (Apps Script, địa chỉ /exec) rồi app nhận kết quả qua Web App; Client secret chỉ nằm trong Thuộc tính tập lệnh của Web App
     (DRIVE_WEB_CLIENT_ID / DRIVE_WEB_CLIENT_SECRET — xem apps-script/Code.gs, khối gd*_). Quyền xin: drive.file + openid email.
   • Refresh token lưu trong localStorage của app (riêng từng tài khoản app) — Đăng xuất sẽ thu hồi + xóa token. */
(function () {
  'use strict';
  const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const ROOT_FOLDER = 'KhoLanh_AnAn';
  const LS_TOK = 'kl_lt_gtok_';
  const H = window.parent && window.parent !== window ? window.parent.LTHost : null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const coded = (code, msg, extra) => Object.assign(new Error(msg), { code }, extra || {});
  const need = () => { if (!H) throw new Error('Mở Lưu trữ cá nhân từ trong ứng dụng Kho Lạnh.'); return H; };
  const userKey = () => { try { return String(H && H.cfg().user || 'admin').trim().toLowerCase() || 'admin'; } catch (e) { return 'admin'; } };
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* bỏ qua */ } };
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(18))).map((b) => b.toString(16).padStart(2, '0')).join('');

  // ------------------------------------------------------------------ token (riêng từng tài khoản app)
  const tok = () => lsGet(LS_TOK + userKey());
  const saveTok = (t) => lsSet(LS_TOK + userKey(), t);

  // ------------------------------------------------------------------ đăng nhập (qua Web App)
  // ĐT 1.29: file này chạy trong iframe luu-tru.html — iframe KHÔNG nạp app-config.js nên window.KLANAN_CONFIG ở đây là rỗng (lỗi của 1.27/1.28: vẫn chuyển về script.google.com).
  // Lấy từ app mẹ (window.parent), không có thì dùng địa chỉ mặc định bên dưới (phải trùng "Authorized redirect URIs" của client kholanh-mobile).
  const LOGIN_REDIRECT_DEFAULT = 'https://kholanhanan.github.io/phanmemkhoanan.mobile/dang-nhap-xong.html';
  function loginRedirect() {
    try { const c = window.KLANAN_CONFIG || (window.parent && window.parent.KLANAN_CONFIG); if (c && c.loginRedirect) return String(c.loginRedirect); } catch (e) { /* khác nguồn → dùng mặc định */ }
    return LOGIN_REDIRECT_DEFAULT;
  }
  async function startLogin() {
    const h = need(), info = await h.api('ltGInfo', { readOnly: true });
    if (!info.ready) throw coded('NOSERVER', info.hint || 'Web App chưa cài liên kết Google Drive.');
    const redirect = loginRedirect() || String(h.cfg().url || ''); if (!redirect) throw new Error('Chưa có đường dẫn Web App.'); // ĐT 1.29: ưu tiên trang tĩnh dang-nhap-xong.html
    const state = rand();
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: info.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, state,
      access_type: 'offline', prompt: 'consent select_account' }).toString();
    return { state, url, redirect, expiresAt: Date.now() + 5 * 60 * 1000 };
  }
  // sig.cancel = true → dừng chờ. Thành công: lưu token, trả email.
  async function waitLogin(dev, sig) {
    const h = need();
    while (Date.now() < dev.expiresAt) {
      await sleep(2000); if (sig && sig.cancel) throw coded('CANCEL', 'Đã hủy đăng nhập.');
      let r; try { r = await h.api('ltGPoll', { state: dev.state, readOnly: true }); } catch (e) { if (e.code === 'AUTH' || e.code === 'FORBIDDEN') throw e; continue; } // mất mạng thoáng qua → chờ vòng sau
      if (r.status === 'error') throw new Error(r.error === 'access_denied' ? 'Bạn đã từ chối cấp quyền.' : 'Google báo lỗi: ' + r.error);
      if (r.status !== 'done') continue;
      const x = await h.api('ltGExchange', { state: dev.state, redirect: dev.redirect });
      if (x.scope && x.scope.indexOf('drive.file') < 0) { try { await h.api('ltGRevoke', { token: x.refresh || x.access }); } catch (e) { /* bỏ qua */ } throw coded('SCOPE', 'Google chưa cấp quyền Drive (ô quyền Drive chưa được tick). Đăng nhập lại và tick đủ các ô quyền.'); }
      if (!x.refresh) throw new Error('Google không trả khóa làm mới phiên. Thử đăng nhập lại.');
      const old = tok() || {};
      saveTok({ email: x.email || '', refresh: x.refresh, access: x.access, exp: Date.now() + (x.expiresIn || 3000) * 1000, acc: old.email === x.email ? old.acc || '' : '', at: Date.now() });
      return x.email || '';
    }
    throw new Error('Hết thời gian chờ (5 phút). Bấm đăng nhập lại.');
  }
  async function logout() { // thu hồi (best-effort) + xóa token trên máy
    const t = tok(); lsDel(LS_TOK + userKey()); delete cache.token; Object.keys(fcache).forEach((k) => delete fcache[k]);
    if (t && (t.refresh || t.access)) { try { await need().api('ltGRevoke', { token: t.refresh || t.access }); } catch (e) { /* offline vẫn coi là đã đăng xuất trên máy */ } }
  }

  // ------------------------------------------------------------------ access token
  const cache = {};
  async function accessToken(force) {
    const t = tok(); if (!t || !t.refresh) throw coded('NOLOGIN', 'Chưa đăng nhập Gmail.');
    if (!force && t.access && t.exp > Date.now() + 60000) return t.access;
    if (cache.token) return cache.token;
    cache.token = (async () => {
      let r; try { r = await need().api('ltGRefresh', { refresh: t.refresh }); } catch (e) { if (e.code === 'RELINK') throw e; throw new Error(e.message || 'Không làm mới được phiên Google.'); }
      const n = Object.assign({}, tok() || t, { access: r.access, exp: Date.now() + (r.expiresIn || 3000) * 1000 }); saveTok(n); return n.access;
    })();
    try { return await cache.token; } finally { delete cache.token; }
  }

  // ------------------------------------------------------------------ Drive REST (chỉ đọc)
  async function drive(url, init) {
    init = init || {};
    let auth = 0, retry = 0;
    for (;;) {
      const a = await accessToken(auth > 0);
      let r; try { r = await fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + a }) })); } catch (e) { if (retry++ < 2) { await sleep(1200 * retry); continue; } throw new Error('Không kết nối được Google Drive. Kiểm tra mạng.'); }
      if (r.status === 401 && auth === 0) { auth++; continue; }
      if ((r.status === 429 || r.status >= 500) && retry < 3) { retry++; await sleep(700 * retry); continue; }
      if (r.ok) return r;
      let msg = r.status; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.status)) || r.status; } catch (e) { /* bỏ qua */ }
      if (r.status === 403 && /insufficient authentication scopes/i.test(String(msg))) throw coded('SCOPE', 'Google chưa cấp quyền Drive cho app. Đăng xuất, đăng nhập lại và tick đủ các ô quyền.');
      if (r.status === 403 && /has not been used|disabled/i.test(String(msg))) throw new Error('Dự án Google Cloud chưa bật Google Drive API (APIs & Services › Library › Google Drive API › Enable).');
      throw Object.assign(new Error('Google Drive báo lỗi: ' + msg), { status: r.status });
    }
  }
  const qEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const API = 'https://www.googleapis.com/drive/v3/files';
  async function list(q, fields) {
    const out = []; let page = '';
    do {
      const j = await (await drive(API + '?pageSize=1000&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') + '&q=' + encodeURIComponent(q) + (page ? '&pageToken=' + encodeURIComponent(page) : ''))).json();
      (j.files || []).forEach((f) => out.push(f)); page = j.nextPageToken || '';
    } while (page);
    return out;
  }
  const findFolder = async (name, parent) => { const f = await list("name='" + qEsc(name) + "' and mimeType='" + FOLDER_MIME + "' and '" + parent + "' in parents and trashed=false", 'id,name'); return f[0] ? f[0].id : ''; };
  const findFile = async (name, parent) => { const f = await list("name='" + qEsc(name) + "' and '" + parent + "' in parents and trashed=false and mimeType!='" + FOLDER_MIME + "'", 'id,name'); return f[0] ? f[0].id : ''; };

  // Thư mục LuuTruCaNhan của tài khoản (PC tạo; điện thoại chỉ TÌM). Nhớ id trong bộ nhớ để mỗi lần hỏi chỉ tốn 1 lần gọi.
  const fcache = {};
  async function ltFolder(acc) {
    const t = tok(); if (!t) throw coded('NOLOGIN', 'Chưa đăng nhập Gmail.');
    const key = (t.email || '') + '|' + acc; if (fcache[key] && fcache[key].lt) return fcache[key];
    const root = await findFolder(ROOT_FOLDER, 'root');
    if (!root) throw coded('NOROOT', 'Không thấy thư mục “' + ROOT_FOLDER + '” trong Drive của ' + (t.email || 'email này') + '. Kiểm tra: (1) đăng nhập đúng Gmail đã liên kết Drive cá nhân trên PC; (2) Client ID thuộc CÙNG dự án Google Cloud với PC (quyền drive.file chỉ thấy file do chính dự án đó tạo); (3) PC đã sao lưu “M19 · Lưu trữ cá nhân”.');
    const accId = await findFolder(acc, root);
    if (!accId) {
      const subs = (await list("'" + root + "' in parents and mimeType='" + FOLDER_MIME + "' and trashed=false", 'id,name')).map((f) => f.name).sort();
      throw coded('ACCOUNT', 'Không thấy thư mục tài khoản “' + acc + '” trong ' + ROOT_FOLDER + (subs.length ? '. Chọn đúng tên tài khoản PC.' : '.'), { choices: subs });
    }
    const lt = await findFolder('LuuTruCaNhan', accId);
    if (!lt) throw coded('NOLT', 'Tài khoản “' + acc + '” chưa có thư mục LuuTruCaNhan. Trên PC: Drive cá nhân › bật sao lưu “M19 · Lưu trữ cá nhân” rồi bấm Sao lưu ngay.');
    return (fcache[key] = { lt });
  }
  // Lấy data.json + danh sách file của Lưu trữ cá nhân. account = tên thư mục tài khoản trên Drive (mặc định: tên người dùng của app).
  // opt.sinceMod: giờ sửa data.json lần trước — chưa đổi thì trả { unchanged: true } (không tải gì thêm).
  async function fetchData(account, opt) {
    const t = tok(); if (!t) throw coded('NOLOGIN', 'Chưa đăng nhập Gmail.');
    const acc = String(account || t.acc || userKey()).trim();
    let fc; try { fc = await ltFolder(acc); } catch (e) { Object.keys(fcache).forEach((k) => delete fcache[k]); throw e; }
    const lt = fc.lt;
    const df = (await list("name='data.json' and '" + lt + "' in parents and trashed=false and mimeType!='" + FOLDER_MIME + "'", 'id,name,modifiedTime'))[0];
    if (!df) throw coded('NODATA', 'Chưa có data.json trên Drive. Trên PC bấm Sao lưu ngay cho “M19 · Lưu trữ cá nhân”.');
    if (opt && opt.sinceMod && opt.sinceMod === df.modifiedTime) { if (t.acc !== acc) saveTok(Object.assign({}, tok() || t, { acc })); return { unchanged: true, mod: df.modifiedTime, account: acc }; }
    let obj; try { obj = JSON.parse(await (await drive(API + '/' + df.id + '?alt=media')).text()); } catch (e) { if (e && e.code) throw e; throw new Error('data.json trên Drive không đọc được.'); }
    if (!obj || typeof obj !== 'object' || !obj.recs || typeof obj.recs !== 'object') throw new Error('data.json trên Drive không đúng định dạng.');
    const fileMap = {}, fid = await findFolder('files', lt);
    if (fid) (await list("'" + fid + "' in parents and trashed=false and mimeType!='" + FOLDER_MIME + "'", 'id,name')).forEach((f) => { // tên: YYYY-MM~<mã>__<tên file>
      const n = String(f.name || ''), i = n.indexOf('~'), b = i >= 0 ? n.slice(i + 1) : n, j = b.indexOf('__'); if (j > 0) fileMap[b.slice(0, j)] = f.id;
    });
    if (t.acc !== acc) { const n = Object.assign({}, tok() || t, { acc }); saveTok(n); }
    return { obj, fileMap, account: acc, mod: df.modifiedTime };
  }

  // ------------------------------------------------------------------ GHI (ĐT 1.32) — chỉ trong LuuTruCaNhan/phone/
  const UP = 'https://www.googleapis.com/upload/drive/v3/files';
  async function ensureFolder(name, parent) {
    const f = await findFolder(name, parent); if (f) return f;
    const j = await (await drive(API + '?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }) })).json();
    return j.id;
  }
  async function phoneFolders(acc) {
    const fc = await ltFolder(acc);
    if (!fc.phone) fc.phone = await ensureFolder('phone', fc.lt);
    return fc;
  }
  async function pfilesFolder(acc) { const fc = await phoneFolders(acc); if (!fc.pfiles) fc.pfiles = await ensureFolder('pfiles', fc.phone); return fc.pfiles; }
  // Tải lên: ≤ 4 MB dùng multipart (1 lần gọi, không cần đọc header Location); lớn hơn dùng resumable 1 lần PUT. existingId có → ghi đè nội dung file đó.
  async function upload(name, parent, body, mime, existingId) {
    mime = mime || 'application/octet-stream';
    const size = body.size != null ? body.size : String(body).length;
    const fail404 = (e) => e && e.status === 404;
    if (size <= 4 * 1048576) {
      const bd = 'kl' + rand(), meta = JSON.stringify(existingId ? {} : { name, parents: [parent] });
      const blob = new Blob(['--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + bd + '\r\nContent-Type: ' + mime + '\r\n\r\n', body, '\r\n--' + bd + '--'], { type: 'multipart/related; boundary=' + bd });
      try {
        const r = await drive(UP + (existingId ? '/' + existingId : '') + '?uploadType=multipart&fields=id', { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + bd }, body: blob });
        return (await r.json()).id || existingId;
      } catch (e) { if (existingId && fail404(e)) return upload(name, parent, body, mime, ''); throw e; }
    }
    const hdr = { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
    let init;
    try { init = await drive(UP + (existingId ? '/' + existingId : '') + '?uploadType=resumable&fields=id', { method: existingId ? 'PATCH' : 'POST', headers: hdr, body: existingId ? '{}' : JSON.stringify({ name, parents: [parent] }) }); }
    catch (e) { if (existingId && fail404(e)) return upload(name, parent, body, mime, ''); throw e; }
    const loc = init.headers.get('location'); if (!loc) throw new Error('Google không trả địa chỉ tải lên.');
    const a = await accessToken(false), r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime, Authorization: 'Bearer ' + a }, body });
    if (!r.ok) throw new Error('Tải lên Drive lỗi (' + r.status + ').');
    return (await r.json()).id;
  }
  // Ghi outbox.json (toàn bộ các mục điện thoại đang chờ PC xác nhận).
  async function putOutbox(account, obj) {
    const acc = String(account || (tok() || {}).acc || userKey()).trim(), fc = await phoneFolders(acc);
    if (!fc.outboxId) { const f = await list("name='outbox.json' and '" + fc.phone + "' in parents and trashed=false and mimeType!='" + FOLDER_MIME + "'", 'id'); fc.outboxId = f[0] ? f[0].id : ''; }
    fc.outboxId = await upload('outbox.json', fc.phone, JSON.stringify(obj), 'application/json', fc.outboxId);
    return true;
  }
  // Ghi 1 file đính kèm: phone/pfiles/<mã>__<tên>. Đã có file cùng tên (cùng mã) thì dùng lại, không tải lại.
  async function putFile(account, id, name, blob, mime) {
    const acc = String(account || (tok() || {}).acc || userKey()).trim(), par = await pfilesFolder(acc), fname = id + '__' + String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const ex = await list("name='" + qEsc(fname) + "' and '" + par + "' in parents and trashed=false", 'id');
    if (ex[0]) return ex[0].id;
    return upload(fname, par, blob, mime || blob.type, '');
  }

  async function download(fileId, mime) {
    const r = await drive(API + '/' + encodeURIComponent(fileId) + '?alt=media'), b = await r.blob();
    return mime ? new Blob([b], { type: mime }) : b;
  }

  window.LTG = {
    linked: () => { const t = tok(); return !!(t && t.refresh); },
    email: () => { const t = tok(); return t && t.email || ''; },
    account: () => { const t = tok(); return t && t.acc || ''; },
    defaultAccount: userKey,
    setAccount: (a) => { const t = tok(); if (t && t.acc !== String(a || '').trim()) { saveTok(Object.assign({}, t, { acc: String(a || '').trim() })); Object.keys(fcache).forEach((k) => delete fcache[k]); } },
    startLogin, waitLogin, logout, fetchData, download, putOutbox, putFile
  };
})();
