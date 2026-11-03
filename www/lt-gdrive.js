/* LƯU TRỮ CÁ NHÂN — ĐĂNG NHẬP GMAIL / GOOGLE DRIVE CÁ NHÂN TRÊN ĐIỆN THOẠI (ĐT 1.19).
   Mục đích: lấy dữ liệu Lưu trữ cá nhân mà bản PC đã sao lưu lên Drive CÁ NHÂN của chính người dùng
   (Drive cá nhân › M19: KhoLanh_AnAn/<tài khoản>/LuuTruCaNhan/data.json + files/<YYYY-MM~mã__tên file>) về điện thoại.
   • CHỈ ĐỌC Drive (không ghi / không xóa gì trên Drive). Dữ liệu lấy về được trộn vào kho trên máy bằng đúng luật `up` lớn hơn thắng (lt-backend.js › merge).
   • Đăng nhập kiểu "thiết bị nhập hạn chế" (OAuth 2.0 device flow): app hiện MÃ → người dùng mở google.com/device, nhập mã, chọn Gmail, cho phép.
     Không cần chuyển hướng về app, không cần plugin gốc nào thêm. Quyền xin: drive.file + openid email.
   • Cần Client ID loại "TVs and Limited Input devices" (+ Client secret) tạo trong CÙNG dự án Google Cloud mà PC đang dùng cho Drive cá nhân
     (quyền drive.file chỉ thấy file do chính dự án đó tạo). Nhập 1 lần trên điện thoại.
   • Refresh token lưu trong localStorage của app (riêng từng tài khoản app) — Đăng xuất sẽ thu hồi + xóa token. */
(function () {
  'use strict';
  const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const ROOT_FOLDER = 'KhoLanh_AnAn';
  const LS_CLI = 'kl_lt_gcli', LS_TOK = 'kl_lt_gtok_';
  const H = window.parent && window.parent !== window ? window.parent.LTHost : null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const coded = (code, msg, extra) => Object.assign(new Error(msg), { code }, extra || {});
  const userKey = () => { try { return String(H && H.cfg().user || 'admin').trim().toLowerCase() || 'admin'; } catch (e) { return 'admin'; } };
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* bỏ qua */ } };

  // ------------------------------------------------------------------ Client ID (dùng chung mọi tài khoản trên máy này)
  const getCli = () => { const o = lsGet(LS_CLI) || {}; return { id: String(o.id || '').trim(), secret: String(o.secret || '').trim() }; };
  const setCli = (id, secret) => lsSet(LS_CLI, { id: String(id || '').trim(), secret: String(secret || '').trim() });

  // ------------------------------------------------------------------ token (riêng từng tài khoản app)
  const tok = () => lsGet(LS_TOK + userKey());
  const saveTok = (t) => lsSet(LS_TOK + userKey(), t);

  // ------------------------------------------------------------------ HTTP
  // Điểm cấp mã thiết bị của Google không chắc có CORS → ưu tiên HTTP gốc của Capacitor (không bị CORS), không có thì dùng fetch.
  const nativeHttp = () => { try { const c = window.Capacitor || (window.parent && window.parent.Capacitor); return c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.CapacitorHttp || null; } catch (e) { return null; } };
  async function oauthPost(url, params) {
    const h = nativeHttp();
    if (h) {
      try {
        const r = await h.post({ url, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: params });
        let j = r.data; if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { j = {}; } }
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: j || {} };
      } catch (e) { /* thử lại bằng fetch */ }
    }
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    let j = {}; try { j = await r.json(); } catch (e) { /* không phải JSON */ }
    return { ok: r.ok, status: r.status, json: j };
  }
  const idEmail = (t) => { try { const p = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(p + '='.repeat((4 - p.length % 4) % 4))))).email || ''; } catch (e) { return ''; } };
  const errText = (r) => (r.json && (r.json.error_description || r.json.error)) || r.status;

  // ------------------------------------------------------------------ đăng nhập (device flow)
  async function startLogin() {
    const c = getCli(); if (!c.id) throw coded('NOCLIENT', 'Chưa nhập Client ID.');
    let r; try { r = await oauthPost('https://oauth2.googleapis.com/device/code', { client_id: c.id, scope: SCOPE }); } catch (e) { throw new Error('Không kết nối được Google. Kiểm tra mạng.'); }
    if (!r.ok || !r.json.device_code) {
      const er = r.json && r.json.error;
      throw new Error(er === 'invalid_client' ? 'Client ID không đúng, hoặc không phải loại “TVs and Limited Input devices”.' : er === 'invalid_scope' || er === 'access_denied' ? 'Google không cho dùng quyền Drive với Client ID này.' : 'Google từ chối: ' + errText(r));
    }
    const j = r.json;
    return { deviceCode: j.device_code, userCode: j.user_code, url: j.verification_url || j.verification_uri || 'https://www.google.com/device', interval: Math.max(3, +j.interval || 5), expiresAt: Date.now() + (+j.expires_in || 1800) * 1000 };
  }
  // sig.cancel = true → dừng chờ. Thành công: lưu token, trả email.
  async function waitLogin(dev, sig) {
    const c = getCli(); let iv = dev.interval;
    while (Date.now() < dev.expiresAt) {
      await sleep(iv * 1000); if (sig && sig.cancel) throw coded('CANCEL', 'Đã hủy đăng nhập.');
      let r; try { r = await oauthPost('https://oauth2.googleapis.com/token', Object.assign({ client_id: c.id, device_code: dev.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, c.secret ? { client_secret: c.secret } : {})); } catch (e) { continue; } // mất mạng thoáng qua → chờ vòng sau
      if (r.ok && r.json.access_token) {
        const scope = String(r.json.scope || '');
        if (scope && scope.indexOf('drive.file') < 0) throw coded('SCOPE', 'Google chưa cấp quyền Drive (ô quyền Drive chưa được tick). Đăng nhập lại và tick đủ các ô quyền.');
        if (!r.json.refresh_token) throw new Error('Google không trả khóa làm mới phiên. Thử đăng nhập lại.');
        const old = tok() || {}, email = idEmail(r.json.id_token);
        saveTok({ email, refresh: r.json.refresh_token, access: r.json.access_token, exp: Date.now() + (+r.json.expires_in || 3000) * 1000, acc: old.email === email ? old.acc || '' : '', at: Date.now() });
        return email;
      }
      const er = r.json && r.json.error;
      if (er === 'authorization_pending') continue;
      if (er === 'slow_down') { iv += 5; continue; }
      if (er === 'access_denied') throw new Error('Bạn đã từ chối cấp quyền.');
      if (er === 'expired_token') throw new Error('Mã đã hết hạn. Bấm đăng nhập lại để lấy mã mới.');
      if (er === 'invalid_client' || er === 'unauthorized_client') throw new Error('Client ID / Client secret không đúng (cần loại “TVs and Limited Input devices”).');
      throw new Error('Google báo lỗi: ' + errText(r));
    }
    throw new Error('Mã đã hết hạn. Bấm đăng nhập lại để lấy mã mới.');
  }
  async function logout() { // thu hồi (best-effort) + xóa token trên máy
    const t = tok(); lsDel(LS_TOK + userKey()); delete cache.token;
    if (t && (t.refresh || t.access)) { try { await oauthPost('https://oauth2.googleapis.com/revoke', { token: t.refresh || t.access }); } catch (e) { /* offline vẫn coi là đã đăng xuất trên máy */ } }
  }

  // ------------------------------------------------------------------ access token
  const cache = {};
  async function accessToken(force) {
    const t = tok(); if (!t || !t.refresh) throw coded('NOLOGIN', 'Chưa đăng nhập Gmail.');
    if (!force && t.access && t.exp > Date.now() + 60000) return t.access;
    if (cache.token) return cache.token;
    const c = getCli(); if (!c.id) throw coded('NOCLIENT', 'Chưa nhập Client ID.');
    cache.token = (async () => {
      let r; try { r = await oauthPost('https://oauth2.googleapis.com/token', Object.assign({ client_id: c.id, refresh_token: t.refresh, grant_type: 'refresh_token' }, c.secret ? { client_secret: c.secret } : {})); } catch (e) { throw new Error('Không kết nối được Google. Kiểm tra mạng.'); }
      if (!r.ok || !r.json.access_token) {
        if (r.json && r.json.error === 'invalid_grant') throw coded('RELINK', 'Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi — hãy đăng xuất rồi đăng nhập lại.');
        throw new Error('Không làm mới được phiên Google: ' + errText(r));
      }
      const n = Object.assign({}, tok() || t, { access: r.json.access_token, exp: Date.now() + (+r.json.expires_in || 3000) * 1000 }); saveTok(n); return n.access;
    })();
    try { return await cache.token; } finally { delete cache.token; }
  }

  // ------------------------------------------------------------------ Drive REST (chỉ đọc)
  async function drive(url) {
    let auth = 0, retry = 0;
    for (;;) {
      const a = await accessToken(auth > 0);
      let r; try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + a } }); } catch (e) { if (retry++ < 2) { await sleep(1200 * retry); continue; } throw new Error('Không kết nối được Google Drive. Kiểm tra mạng.'); }
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

  // Lấy data.json + danh sách file của Lưu trữ cá nhân. account = tên thư mục tài khoản trên Drive (mặc định: tên người dùng của app).
  async function fetchData(account) {
    const t = tok(); if (!t) throw coded('NOLOGIN', 'Chưa đăng nhập Gmail.');
    const acc = String(account || t.acc || userKey()).trim();
    const root = await findFolder(ROOT_FOLDER, 'root');
    if (!root) throw coded('NOROOT', 'Không thấy thư mục “' + ROOT_FOLDER + '” trong Drive của ' + (t.email || 'email này') + '. Kiểm tra: (1) đăng nhập đúng Gmail đã liên kết Drive cá nhân trên PC; (2) Client ID thuộc CÙNG dự án Google Cloud với PC (quyền drive.file chỉ thấy file do chính dự án đó tạo); (3) PC đã sao lưu “M19 · Lưu trữ cá nhân”.');
    const accId = await findFolder(acc, root);
    if (!accId) {
      const subs = (await list("'" + root + "' in parents and mimeType='" + FOLDER_MIME + "' and trashed=false", 'id,name')).map((f) => f.name).sort();
      throw coded('ACCOUNT', 'Không thấy thư mục tài khoản “' + acc + '” trong ' + ROOT_FOLDER + (subs.length ? '. Chọn đúng tên tài khoản PC.' : '.'), { choices: subs });
    }
    const lt = await findFolder('LuuTruCaNhan', accId);
    if (!lt) throw coded('NOLT', 'Tài khoản “' + acc + '” chưa có thư mục LuuTruCaNhan. Trên PC: Drive cá nhân › bật sao lưu “M19 · Lưu trữ cá nhân” rồi bấm Sao lưu ngay.');
    const dataId = await findFile('data.json', lt);
    if (!dataId) throw coded('NODATA', 'Chưa có data.json trên Drive. Trên PC bấm Sao lưu ngay cho “M19 · Lưu trữ cá nhân”.');
    let obj; try { obj = JSON.parse(await (await drive(API + '/' + dataId + '?alt=media')).text()); } catch (e) { if (e && e.code) throw e; throw new Error('data.json trên Drive không đọc được.'); }
    if (!obj || typeof obj !== 'object' || !obj.recs || typeof obj.recs !== 'object') throw new Error('data.json trên Drive không đúng định dạng.');
    const fileMap = {}, fid = await findFolder('files', lt);
    if (fid) (await list("'" + fid + "' in parents and trashed=false and mimeType!='" + FOLDER_MIME + "'", 'id,name')).forEach((f) => { // tên: YYYY-MM~<mã>__<tên file>
      const n = String(f.name || ''), i = n.indexOf('~'), b = i >= 0 ? n.slice(i + 1) : n, j = b.indexOf('__'); if (j > 0) fileMap[b.slice(0, j)] = f.id;
    });
    if (t.acc !== acc) { const n = Object.assign({}, tok() || t, { acc }); saveTok(n); }
    return { obj, fileMap, account: acc };
  }
  async function download(fileId, mime) {
    const r = await drive(API + '/' + encodeURIComponent(fileId) + '?alt=media'), b = await r.blob();
    return mime ? new Blob([b], { type: mime }) : b;
  }

  window.LTG = {
    cli: getCli, setCli,
    configured: () => !!getCli().id,
    linked: () => { const t = tok(); return !!(t && t.refresh); },
    email: () => { const t = tok(); return t && t.email || ''; },
    account: () => { const t = tok(); return t && t.acc || ''; },
    defaultAccount: userKey,
    startLogin, waitLogin, logout, fetchData, download
  };
})();
