/* ==========================================================================
   TỰ CẬP NHẬT GIAO DIỆN APP ĐIỆN THOẠI (bản APK) — KHÔNG CẦN CÀI LẠI APK (09/2026)
   Plugin @capgo/capacitor-updater, chế độ TỰ QUẢN (autoUpdate: false, không dùng dịch vụ Capgo):
     - GitHub Actions (web-preview.yml) đăng lên GitHub Pages: update.json + bundle-<mã>.zip (= thư mục www).
     - App mở lên: báo "đã chạy tốt" (notifyAppReady — KHÔNG gọi thì plugin tự quay về bản trước sau vài giây),
       rồi hỏi update.json; có bản mới → tải về → đặt làm bản cho LẦN MỞ SAU (next) và hiện thanh
       "Cập nhật ngay" (set = áp dụng + tải lại app ngay).
     - Bản cần phần gốc Android mới hơn (nativeLevel lớn hơn APK đang cài) → KHÔNG cập nhật, báo cài APK mới.
   www/bundle-version.json và www/live-update-config.json do GitHub Actions ghi lúc build (APK và Pages) —
   trong repo là bản mặc định (chạy thử trên máy / trình duyệt thì bỏ qua cập nhật).
   Chạy trên trình duyệt (bản web) → không làm gì: bản web tự lấy code mới khi tải lại trang.
   ========================================================================== */
(function () {
  'use strict';
  const Cap = window.Capacitor;
  const U = Cap && Cap.Plugins && Cap.Plugins.CapacitorUpdater;
  const isNative = !!(U && Cap.isNativePlatform && Cap.isNativePlatform());
  // Gọi NGAY (trước mọi việc khác) — xác nhận bản giao diện hiện tại khởi động được.
  if (isNative) { try { U.notifyAppReady(); } catch (e) { /* plugin chưa có trong APK cũ */ } }

  const LS_NATIVE = 'klanan.nativeLevel';
  const state = { checking: false, ready: null, local: null, lastMsg: '' };

  async function readJson(url, noCache) {
    const res = await fetch(url + (noCache ? (url.includes('?') ? '&' : '?') + 't=' + Date.now() : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  async function localInfo() {
    if (state.local) return state.local;
    let v = {}, cfg = {};
    try { v = await readJson('bundle-version.json'); } catch (e) { /* bản chạy thử */ }
    try { cfg = await readJson('live-update-config.json'); } catch (e) { /* chưa cấu hình */ }
    let bundleId = 'builtin';
    if (isNative) { try { const c = await U.current(); bundleId = (c && c.bundle && c.bundle.id) || 'builtin'; } catch (e) { /* bỏ qua */ } }
    // Mức phần gốc Android của APK đang cài: ghi lại lúc chạy bản gốc trong APK (builtin); bản tải về sau đó
    // mang nativeLevel của CHÍNH NÓ nên không dùng được — đọc lại số đã ghi.
    if (bundleId === 'builtin' && v.nativeLevel) { try { localStorage.setItem(LS_NATIVE, String(v.nativeLevel)); } catch (e) { /* bỏ qua */ } }
    let nativeLevel = Number(v.nativeLevel || 1);
    try { nativeLevel = Number(localStorage.getItem(LS_NATIVE)) || nativeLevel; } catch (e) { /* bỏ qua */ }
    state.local = { version: String(v.version || ''), date: v.date || '', message: v.message || '', nativeLevel, bundleId,
      base: String(cfg.base || '').replace(/\/?$/, '/') };
    return state.local;
  }

  function banner(text, actions) {
    let el = document.getElementById('luBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'luBanner'; el.className = 'lu-banner'; el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = `<span class="lu-text"></span><span class="lu-acts"></span>`;
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

  // manual = bấm nút "Kiểm tra cập nhật" trong Cài đặt → luôn báo kết quả.
  async function check(manual) {
    if (!isNative) { if (manual) return { ok: false, msg: 'Chỉ app APK mới cần cập nhật. Bản web tự lấy code mới khi tải lại trang.' }; return null; }
    if (state.checking) return { ok: false, msg: 'Đang kiểm tra…' };
    state.checking = true;
    try {
      const L = await localInfo();
      if (!L.base || L.base === '/') return { ok: false, msg: 'APK này chưa có địa chỉ cập nhật — cần cài APK build từ GitHub bản mới.' };
      if (!navigator.onLine) return { ok: false, msg: 'Không có mạng.' };
      const R = await readJson(L.base + 'update.json', true);
      if (!R || !R.version || !R.file) return { ok: false, msg: 'Chưa có bản cập nhật trên GitHub Pages.' };
      if (R.version === L.version) { hideBanner(); return { ok: true, latest: true, msg: 'Đang dùng bản mới nhất (' + L.version + ').' }; }
      if (Number(R.nativeLevel || 1) > L.nativeLevel) {
        const msg = 'Có bản mới nhưng cần cài APK mới (bản này đổi phần gốc Android).';
        if (manual || state.lastMsg !== msg) banner(msg, [['Đóng', hideBanner]]);
        state.lastMsg = msg;
        return { ok: false, needApk: true, msg };
      }
      // Đã tải sẵn bản này trước đó (chưa áp dụng) → dùng lại, không tải lại.
      let bundle = null;
      try {
        const lst = await U.list();
        bundle = ((lst && lst.bundles) || []).find((b) => b.version === R.version && b.status !== 'error' && b.status !== 'deleted') || null;
      } catch (e) { /* bỏ qua */ }
      if (!bundle) bundle = await U.download({ url: L.base + R.file, version: R.version });
      try { await U.next({ id: bundle.id }); } catch (e) { /* vẫn cho bấm cập nhật ngay */ }
      state.ready = { bundle, remote: R };
      banner('Có bản mới' + (R.message ? ': ' + firstLine(R.message) : '') + '. Tự áp dụng ở lần mở app sau.', [
        ['Để sau', hideBanner],
        ['Cập nhật ngay', () => applyNow(), true]
      ]);
      return { ok: true, downloaded: true, msg: 'Đã tải bản mới ' + R.version + '.' };
    } catch (e) {
      return { ok: false, msg: 'Chưa kiểm tra được cập nhật: ' + (e && e.message ? e.message : e) };
    } finally { state.checking = false; }
  }
  async function applyNow() {
    if (!state.ready) return;
    banner('Đang áp dụng bản mới…', []);
    try { await U.set({ id: state.ready.bundle.id }); } // tải lại app ngay — code sau dòng này không chạy
    catch (e) { banner('Không áp dụng được: ' + (e && e.message ? e.message : e), [['Đóng', hideBanner]]); }
  }

  window.KLLiveUpdate = { isNative, check, localInfo, applyNow };
  // Mở app 4 giây sau thì kiểm tra 1 lần; quay lại app sau ≥ 30 phút thì kiểm tra lại.
  if (isNative) {
    let last = 0;
    const run = () => { if (Date.now() - last < 30 * 60 * 1000) return; last = Date.now(); check(false); };
    setTimeout(run, 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  }
})();
