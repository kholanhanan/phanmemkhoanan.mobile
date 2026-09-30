/* ==========================================================================
   TỰ CẬP NHẬT GIAO DIỆN APP ĐIỆN THOẠI (bản APK) — KHÔNG CẦN CÀI LẠI APK (09/2026, viết lại 30/09/2026)
   KHÔNG dùng plugin ngoài (bản trước dùng @capgo/capacitor-updater làm hỏng build APK). Chỉ dùng thứ CÓ SẴN:
     • Capacitor.Plugins.WebView (lõi Capacitor): setServerBasePath / persistServerBasePath — cho app chạy giao
       diện từ 1 thư mục trên máy thay cho bản đóng gói trong APK.
     • Capacitor.Plugins.Filesystem (@capacitor/filesystem, đã có sẵn) — ghi file vào bộ nhớ riêng của app.
   Luồng:
     1. GitHub Actions (web-preview.yml) đăng www/ lên GitHub Pages + update.json (mã bản, danh sách file + sha256).
     2. App mở ~4 giây: hỏi update.json; mã khác → tải từng file (file nào giống hệt bản đang chạy thì lấy luôn từ
        máy, không tải), KIỂM sha256 từng file → ghi vào DATA/bundles/<mã>/.
     3. "Cập nhật ngay" (hoặc tự làm ở lần mở app sau): setServerBasePath → app tải lại bằng bản mới NHƯNG CHƯA
        LƯU. Bản mới chạy tới khi app.js báo đã khởi động xong (window.__KLANAN_READY) → persistServerBasePath =
        CHỐT. Bản mới hỏng (không báo được) → không chốt → mở app lần sau tự về bản cũ; thử tối đa 2 lần rồi bỏ.
     4. Cài APK mới (versionCode khác) → Capacitor tự bỏ bản đã tải, chạy bản trong APK (Bridge.isNewBinary).
   Bản cần phần gốc Android mới hơn (nativeLevel > mức của APK) → không cập nhật, báo cài APK mới.
   Chạy trên trình duyệt (bản web) → không làm gì.
   ========================================================================== */
(function () {
  'use strict';
  const Cap = window.Capacitor;
  const P = (Cap && Cap.Plugins) || {};
  const WV = P.WebView, FS = P.Filesystem;
  const isNative = !!(WV && FS && Cap.isNativePlatform && Cap.isNativePlatform());
  const LS_NATIVE = 'klanan.nativeLevel';
  const LS_NEXT = 'klanan.lu.next';   // {version, path, tries} — bản đã tải xong, chờ áp dụng
  const LS_BAD = 'klanan.lu.bad';     // mã bản đã thử 2 lần không chạy được → bỏ qua
  const DIR = 'DATA';
  const state = { checking: false, local: null, lastMsg: '' };
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } };

  async function readJson(url, noCache) {
    const res = await fetch(url + (noCache ? (url.includes('?') ? '&' : '?') + 't=' + Date.now() : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  async function currentPath() { try { const r = await WV.getServerBasePath(); return (r && r.path) || ''; } catch (e) { return ''; } }
  async function localInfo() {
    if (state.local) return state.local;
    let v = {}, cfg = {};
    try { v = await readJson('bundle-version.json'); } catch (e) { /* bản chạy thử */ }
    try { cfg = await readJson('live-update-config.json'); } catch (e) { /* chưa cấu hình */ }
    const path = isNative ? await currentPath() : '';
    const builtin = !/\/bundles\//.test(path);
    // Mức phần gốc Android của APK: ghi lại lúc chạy bản gốc trong APK; bản tải về mang số của chính nó.
    if (builtin && v.nativeLevel) lsSet(LS_NATIVE, Number(v.nativeLevel));
    const nativeLevel = Number(lsGet(LS_NATIVE)) || Number(v.nativeLevel) || 1;
    state.local = { version: String(v.version || ''), date: v.date || '', message: v.message || '', nativeLevel, builtin, path,
      base: String(cfg.base || '').replace(/\/?$/, '/') };
    return state.local;
  }

  // ---------- thanh báo ----------
  function banner(text, actions) {
    let el = document.getElementById('luBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'luBanner'; el.className = 'lu-banner'; el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="lu-text"></span><span class="lu-acts"></span>';
    el.querySelector('.lu-text').textContent = text;
    const acts = el.querySelector('.lu-acts');
    (actions || []).forEach(([label, fn, primary]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lu-btn' + (primary ? ' pri' : ''); b.textContent = label;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    });
    el.hidden = false;
  }
  const hideBanner = () => { const el = document.getElementById('luBanner'); if (el) el.hidden = true; };
  const firstLine = (m) => String(m || '').split('\n')[0].slice(0, 90);

  // ---------- tiện ích file ----------
  async function sha256(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function toBase64(buf) {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function getBytes(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.arrayBuffer();
  }
  async function rmBundle(dir) { try { await FS.rmdir({ path: 'bundles/' + dir, directory: DIR, recursive: true }); } catch (e) { /* không có */ } }
  // Xoá các bản đã tải không còn dùng (giữ bản đang chạy + bản đang chờ áp dụng).
  async function cleanup(keep) {
    try {
      const r = await FS.readdir({ path: 'bundles', directory: DIR });
      for (const f of (r && r.files) || []) {
        const name = typeof f === 'string' ? f : f.name;
        if (name && !keep.includes(name)) await rmBundle(name);
      }
    } catch (e) { /* chưa có thư mục */ }
  }

  // Tải đủ file của bản R vào bundles/<mã>/ — file giống bản đang chạy thì lấy từ máy (không tải lại).
  async function downloadBundle(L, R, onProgress) {
    const dir = 'bundles/' + R.version;
    await rmBundle(R.version);
    const files = R.files || [];
    let done = 0;
    for (const f of files) {
      let buf = null;
      try { const b = await getBytes(new URL(f.p, location.origin + '/').href); if (await sha256(b) === f.s) buf = b; } catch (e) { /* không có ở bản đang chạy */ }
      if (!buf) {
        buf = await getBytes(L.base + f.p.split('/').map(encodeURIComponent).join('/') + '?v=' + R.version);
        if (await sha256(buf) !== f.s) throw new Error('File ' + f.p + ' tải về không khớp (GitHub đang cập nhật?) — thử lại sau ít phút.');
      }
      await FS.writeFile({ path: dir + '/' + f.p, data: toBase64(buf), directory: DIR, recursive: true });
      done++; if (onProgress) onProgress(done, files.length);
    }
    const uri = await FS.getUri({ path: dir, directory: DIR });
    return decodeURIComponent(String(uri.uri || '').replace(/^file:\/\//, ''));
  }

  // Áp dụng bản đã tải: chạy thử (chưa chốt) — bản mới tự chốt khi khởi động xong (commitIfReady).
  async function applyNext() {
    const nx = lsGet(LS_NEXT);
    if (!nx || !nx.path) return false;
    nx.tries = (nx.tries || 0) + 1;
    if (nx.tries > 2) { // đã thử 2 lần mà bản mới không chốt được → bản hỏng, bỏ
      lsSet(LS_BAD, nx.version); lsSet(LS_NEXT, null); await rmBundle(nx.version);
      banner('Bản cập nhật ' + nx.version + ' không chạy được trên máy này — vẫn dùng bản cũ.', [['Đóng', hideBanner]]);
      return false;
    }
    lsSet(LS_NEXT, nx);
    await WV.setServerBasePath({ path: nx.path }); // app tải lại ngay bằng bản mới
    return true;
  }
  async function commitIfReady() {
    const L = await localInfo();
    const nx = lsGet(LS_NEXT);
    if (!nx || L.builtin || nx.version !== L.version) return false;
    // Đợi app.js báo đã khởi động xong (tối đa 20 giây) rồi mới chốt.
    for (let i = 0; i < 40 && !window.__KLANAN_READY; i++) await new Promise((r) => setTimeout(r, 500));
    if (!window.__KLANAN_READY) return false;
    await WV.persistServerBasePath();
    lsSet(LS_NEXT, null);
    await cleanup([L.version]);
    return true;
  }

  // manual = nút "Kiểm tra cập nhật app" trong Cài đặt → luôn báo kết quả.
  async function check(manual) {
    if (!isNative) return manual ? { ok: false, msg: 'Chỉ app APK mới cần cập nhật. Bản web tự lấy code mới khi tải lại trang.' } : null;
    if (state.checking) return { ok: false, msg: 'Đang kiểm tra…' };
    state.checking = true;
    try {
      const L = await localInfo();
      if (!L.base || L.base === '/') return { ok: false, msg: 'APK này chưa có địa chỉ cập nhật — cần cài APK build từ GitHub bản mới.' };
      if (!navigator.onLine) return { ok: false, msg: 'Không có mạng.' };
      const R = await readJson(L.base + 'update.json', true);
      if (!R || !R.version || !Array.isArray(R.files) || !R.files.length) return { ok: false, msg: 'Chưa có bản cập nhật trên GitHub Pages.' };
      if (R.version === L.version) { hideBanner(); return { ok: true, latest: true, msg: 'Đang dùng bản mới nhất (' + L.version + ').' }; }
      if (!manual && lsGet(LS_BAD) === R.version) return null;
      if (Number(R.nativeLevel || 1) > L.nativeLevel) {
        const msg = 'Có bản mới nhưng cần cài APK mới (bản này đổi phần gốc Android).';
        if (manual || state.lastMsg !== msg) banner(msg, [['Đóng', hideBanner]]);
        state.lastMsg = msg;
        return { ok: false, needApk: true, msg };
      }
      let nx = lsGet(LS_NEXT);
      if (!nx || nx.version !== R.version) {
        if (manual) banner('Đang tải bản mới…', []);
        const path = await downloadBundle(L, R, manual ? (d, n) => banner('Đang tải bản mới… ' + d + '/' + n, []) : null);
        nx = { version: R.version, path, tries: 0, message: R.message || '' };
        lsSet(LS_NEXT, nx);
        lsSet(LS_BAD, null);
        await cleanup([L.version, R.version]);
      }
      banner('Có bản mới' + (R.message ? ': ' + firstLine(R.message) : '') + '. Tự áp dụng ở lần mở app sau.', [
        ['Để sau', hideBanner],
        ['Cập nhật ngay', () => { banner('Đang áp dụng bản mới…', []); applyNext().catch((e) => banner('Không áp dụng được: ' + (e.message || e), [['Đóng', hideBanner]])); }, true]
      ]);
      return { ok: true, downloaded: true, msg: 'Đã tải bản mới ' + R.version + '.' };
    } catch (e) {
      if (manual) hideBanner();
      return { ok: false, msg: 'Chưa kiểm tra được cập nhật: ' + (e && e.message ? e.message : e) };
    } finally { state.checking = false; }
  }

  window.KLLiveUpdate = { isNative, check, localInfo };

  if (isNative) {
    (async () => {
      try {
        const L = await localInfo();
        const nx = lsGet(LS_NEXT);
        if (nx && nx.version === L.version && !L.builtin) { await commitIfReady(); }          // bản mới vừa chạy → chốt
        else if (nx && nx.version !== L.version) { if (await applyNext()) return; }           // có bản đã tải → áp dụng khi mở app
      } catch (e) { /* không chặn app */ }
      let last = 0;
      const run = () => { if (Date.now() - last < 30 * 60 * 1000) return; last = Date.now(); check(false); };
      setTimeout(run, 4000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
    })();
  }
})();
