// scan-ui.js — GIAO DIỆN "Scan tài liệu" thông minh (M15, PC 0.22 / ĐT 0.7). DÙNG CHUNG PC + điện thoại (chép y nguyên sang ban-dien-thoai/www/).
// KLScanUI.mount(root, host) — host do nơi gọi cung cấp:
//   { platform: 'pc' | 'phone', ensure(name) → Promise  ('jspdf' | 'pdfjs'),
//     save(blob, name) → Promise<string mô tả nơi lưu>, share?(blob, name) → Promise, toast(msg, isError), camera: bool }
// PC 0.27 / ĐT 0.12: nút "Lưu" cất tài liệu vào bộ nhớ app (IndexedDB 'kl_scan_luu', kho 'docs' + 'docpages'); trang trống hiện danh sách tài liệu đã lưu để mở / chỉnh lại.
// Trang đang làm dở TỰ LƯU NHÁP (kho 'draft') nên tắt / mở lại app vẫn còn đúng trang đang làm — window.__klaBusy báo trang chính đừng tự nhả module khi còn thay đổi chưa Lưu.
(function (global) {
  'use strict';
  var S = global.KLScan;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var LS_DEF = 'kl_scan_mac_dinh', LS_HIST = 'kl_scan_lich_su';
  var lsGet = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* đầy / bị chặn: bỏ qua */ } };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var defaultName = function () { var d = new Date(); return 'Scan_' + p2(d.getDate()) + '-' + p2(d.getMonth() + 1) + '-' + d.getFullYear() + '_' + p2(d.getHours()) + p2(d.getMinutes()); };
  var cleanName = function (s) { s = String(s || '').replace(/\.(pdf|jpe?g)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim(); return s || defaultName(); };
  var fmtKb = function (b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };

  var IC = {
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    rl: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7"/><path d="M4 4v4.7h4.7"/>',
    rr: '<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    mvl: '<rect x="13" y="5" width="8" height="14" rx="1.5"/><path d="M9 12H3m3-3-3 3 3 3"/>', mvr: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><path d="M15 12h6m-3-3 3 3-3 3"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    save: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v3h16v-3"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    disk: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    zin: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2M11 8v6M8 11h6"/>', zout: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2M8 11h6"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>', plus: '<path d="M12 5v14M5 12h14"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC[k] + '</svg>'; };


  // ---- Bộ nhớ trong app (IndexedDB): 'draft' = trang đang làm (tự lưu nháp), 'docs' = thông tin tài liệu đã lưu (+ ảnh bìa), 'docpages' = các trang của tài liệu đó
  var DBN = 'kl_scan_luu', dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (!global.indexedDB) return rej(new Error('Máy này không hỗ trợ lưu trong app.'));
      var r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = function () { var d = r.result; ['draft', 'docs', 'docpages'].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('Không mở được bộ nhớ của app.')); };
    });
    dbP.catch(function () { dbP = null; });
    return dbP;
  }
  function tx(names, mode, fn) { // fn(transaction, box) — gán kết quả vào box.v
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(names, mode), box = {};
        t.oncomplete = function () { res(box.v); };
        t.onabort = t.onerror = function () { rej(t.error || new Error('Không ghi được vào bộ nhớ của app (đầy?)')); };
        fn(t, box);
      });
    });
  }
  var okQuad = function (q) {
    if (!Array.isArray(q) || q.length !== 4) return null;
    var o = q.map(function (c) { return { x: +c.x, y: +c.y }; });
    return o.every(function (c) { return isFinite(c.x) && isFinite(c.y); }) ? o : null;
  };
  var fmtWhen = function (t) { var d = new Date(t || Date.now()); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' ' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(); };

  function mount(root, host) {
    if (!S) { root.innerHTML = '<p>Thiếu scan-core.js</p>'; return; }
    host = host || {};
    var phone = host.platform === 'phone';
    var PREVIEW = phone ? 1100 : 1500;
    // Thiết lập nhớ lại: chế độ đang dùng, thông số riêng của chế độ Tùy chỉnh, khổ giấy. (Bản cũ lưu mode xam/goc/contrast/bright → đổi sang Tùy chỉnh.)
    var def = Object.assign({ mode: S.DEFAULT_MODE, pTuy: null, format: 'a4' }, lsGet(LS_DEF, {}));
    if (!S.MODES[def.mode]) { def.mode = (def.mode === 'xam' || def.mode === 'goc') ? 'tuy' : S.DEFAULT_MODE; def.pTuy = null; }
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    var presetP = function (m) { return (m === 'tuy' && def.pTuy) ? S.resolveParams('tuy', def.pTuy) : S.resolveParams(m, null); };
    var popt = function (pg, extra) { return Object.assign({ quad: pg.cropOn ? pg.quad : null, rot: pg.rot, mode: pg.mode, p: pg.p }, extra); };
    var st = { pages: [], cur: 0, dirty: false, busy: false, name: defaultName(), docId: null, docCreated: 0 };
    var ready = false, draftTimer = 0, draftBusy = false, draftAgain = false, draftWarned = false, libUrls = [];
    var cache = new Map(), seq = 0;
    var toast = function (m, bad) { if (host.toast) host.toast(m, bad); };
    var DONE = host.doneWord || 'Đã lưu'; // PC: 'Đã tạo' (Electron còn mở hộp thoại chọn nơi lưu)

    global.__klaBusy = function () { return st.pages.length > 0 && st.dirty; }; // trang chính: đừng tự nhả module khi còn trang chưa lưu

    root.classList.add('sc');
    root.innerHTML =
      '<div class="sc-head"><div class="sc-title"><b>Scan tài liệu</b><small>Chụp / chọn ảnh hoặc PDF → tự cắt trang, khử bóng, làm trắng nền → lưu PDF để in</small></div>' +
      '<div class="sc-add">' +
        (host.camera !== false ? '<button type="button" class="sc-btn sc-pri" data-act="pick-cam">' + svg('cam') + '<span>Chụp</span></button>' : '') +
        '<button type="button" class="sc-btn" data-act="pick-img">' + svg('img') + '<span>Ảnh</span></button>' +
        '<button type="button" class="sc-btn" data-act="pick-pdf">' + svg('pdf') + '<span>PDF</span></button>' +
        '<button type="button" class="sc-btn sc-save" data-act="save-local" id="scHeadSave" hidden>' + svg('disk') + '<span id="scHeadSaveTxt">Lưu</span></button>' +
      '</div></div>' +
      '<input type="file" id="scCam" accept="image/*" capture="environment" hidden>' +
      '<input type="file" id="scImg" accept="image/*" multiple hidden>' +
      '<input type="file" id="scPdf" accept="application/pdf,.pdf" multiple hidden>' +
      '<div class="sc-empty" id="scEmpty">' +
        '<div class="sc-drop">' + svg('pdf') + '<b>Chưa có trang nào</b>' +
        '<p>' + (phone ? 'Bấm <b>Chụp</b>, kéo 4 chấm vào 4 góc tờ giấy rồi bấm nút tròn để chụp (chỉ phần trong 4 chấm được giữ). Hoặc chọn ảnh, file PDF có sẵn. App khử bóng và làm trắng nền.' : 'Bấm <b>Chụp</b> để dùng camera máy tính, kéo thả ảnh / PDF vào đây, dán ảnh bằng <kbd>Ctrl</kbd>+<kbd>V</kbd>, hoặc dùng các nút ở trên.') + '</p>' +
        '<p class="sc-note">Ảnh được xử lý ngay trên máy, không gửi đi đâu. Nhiều ảnh = nhiều trang trong cùng 1 file PDF. Chỉnh xong bấm <b>Lưu</b> để cất vào máy — muốn sửa lại thì chọn ở danh sách bên dưới.</p></div>' +
        '<div class="sc-libbox" id="scLib"></div>' +
        '<div class="sc-hist" id="scHist"></div></div>' +
      '<div class="sc-work" id="scWork" hidden>' +
        '<div class="sc-stage"><div class="sc-cvwrap"><div class="sc-scroll" id="scScroll"><canvas class="sc-cv" id="scCv"></canvas></div><div class="sc-pageno" id="scPageNo"></div></div>' +
          '<div class="sc-tools">' +
            '<button type="button" class="sc-ic" data-act="prev" title="Xem trang trước (←)" aria-label="Xem trang trước">' + svg('left') + '</button>' +
            '<span class="sc-sep"></span>' +
            '<button type="button" class="sc-ic" data-act="rot-l" title="Xoay trái" aria-label="Xoay trái">' + svg('rl') + '</button>' +
            '<button type="button" class="sc-ic" data-act="rot-r" title="Xoay phải (R)" aria-label="Xoay phải">' + svg('rr') + '</button>' +
            '<button type="button" class="sc-ic" data-act="cmp" title="Giữ để xem ảnh gốc" aria-label="Giữ để xem ảnh gốc">' + svg('eye') + '</button>' +
            '<button type="button" class="sc-ic" data-act="crop" title="Chỉnh 4 góc trang giấy" aria-label="Chỉnh 4 góc trang giấy">' + svg('crop') + '</button>' +
            '<span class="sc-sep"></span>' +
            '<button type="button" class="sc-ic" data-act="zoom-out" title="Thu nhỏ (−)" aria-label="Thu nhỏ">' + svg('zout') + '</button>' +
            '<button type="button" class="sc-ic sc-zfit" data-act="zoom-fit" title="Vừa khung (0) · bấm đúp vào ảnh để phóng to / thu về" aria-label="Vừa khung" id="scZoomTxt">100%</button>' +
            '<button type="button" class="sc-ic" data-act="zoom-in" title="Phóng to (+) · lăn chuột, kéo để di chuyển" aria-label="Phóng to">' + svg('zin') + '</button>' +
            '<span class="sc-sep"></span>' +
            '<button type="button" class="sc-ic" data-act="mv-l" title="Chuyển trang này lên trước" aria-label="Chuyển trang lên trước">' + svg('mvl') + '</button>' +
            '<button type="button" class="sc-ic" data-act="mv-r" title="Chuyển trang này ra sau" aria-label="Chuyển trang ra sau">' + svg('mvr') + '</button>' +
            '<button type="button" class="sc-ic sc-danger" data-act="del" title="Xóa trang này (Delete)" aria-label="Xóa trang">' + svg('del') + '</button>' +
            '<span class="sc-sep"></span>' +
            '<button type="button" class="sc-ic" data-act="next" title="Xem trang sau (→)" aria-label="Xem trang sau">' + svg('right') + '</button>' +
          '</div></div>' +
        '<div class="sc-strip" id="scStrip"></div>' +
        '<div class="sc-panel">' +
          '<div class="sc-sec"><div class="sc-lb">Chế độ</div><div class="sc-seg" id="scModes">' +
            Object.keys(S.MODES).map(function (k) { return '<button type="button" data-mode="' + k + '" title="' + esc(S.MODES[k].full) + '">' + esc(S.MODES[k].ten) + '</button>'; }).join('') +
          '</div><p class="sc-tip" id="scModeTip"></p>' +
          '<div class="sc-seg sc-seg-kieu" id="scKieu" hidden>' + Object.keys(S.KIEU).map(function (k) { return '<button type="button" data-kieu="' + k + '">' + esc(S.KIEU[k]) + '</button>'; }).join('') + '</div></div>' +
          '<div class="sc-sec" id="scSliders">' +
            '<label class="sc-rg"><span>Khử bóng <b id="scSVal"></b></span><input type="range" id="scS" min="0" max="100" step="1"></label>' +
            '<label class="sc-rg"><span>Độ trắng nền <b id="scBVal"></b></span><input type="range" id="scB" min="0" max="100" step="1"></label>' +
            '<label class="sc-rg"><span>Độ đậm chữ <b id="scCVal"></b></span><input type="range" id="scC" min="0" max="100" step="1"></label>' +
            '<label class="sc-chk"><input type="checkbox" id="scLi"><span>Xóa ô li / dòng kẻ <small>(giữ nét chữ cắt ngang)</small></span></label>' +
            '<div class="sc-row"><button type="button" class="sc-link" data-act="apply-all">Áp dụng cho mọi trang</button><button type="button" class="sc-link" data-act="reset">' + svg('reset') + 'Mặc định</button></div>' +
          '</div>' +
          '<div class="sc-sec"><div class="sc-lb">Cắt trang giấy</div>' +
            '<label class="sc-chk"><input type="checkbox" id="scCrop"><span>Tự nhận 4 cạnh, nắn thẳng góc <small id="scCropTip"></small></span></label>' +
            '<div class="sc-row"><button type="button" class="sc-link" data-act="crop">' + svg('crop') + 'Chỉnh 4 góc</button><button type="button" class="sc-link" data-act="redetect">Tự tìm lại</button></div>' +
          '</div>' +
          '<div class="sc-sec sc-out"><div class="sc-lb">Lưu &amp; xuất</div>' +
            '<label class="sc-fld"><span>Tên tài liệu</span><input type="text" id="scName" maxlength="80" spellcheck="false"></label>' +
            '<button type="button" class="sc-btn sc-save sc-wide" data-act="save-local">' + svg('disk') + '<span id="scLocalTxt">Lưu vào máy</span></button>' +
            '<p class="sc-tip" id="scLocalTip">Lưu xong tài liệu được cất trong máy và màn hình về trang đầu; cần sửa thì chọn lại ở danh sách.</p>' +
            '<div class="sc-lb sc-lb2">Xuất file PDF / ảnh</div>' +
            '<div class="sc-seg sc-seg-sm" id="scFmt"><button type="button" data-fmt="a4">Khổ A4</button><button type="button" data-fmt="fit">Theo ảnh</button></div>' +
            '<button type="button" class="sc-btn sc-wide" data-act="save-pdf">' + svg('save') + '<span id="scSaveTxt">Xuất PDF</span></button>' +
            (host.share ? '<button type="button" class="sc-btn sc-wide" data-act="share-pdf">' + svg('share') + '<span>Chia sẻ PDF (Zalo, Email…)</span></button>' : '') +
            '<div class="sc-row"><button type="button" class="sc-link" data-act="save-jpg">Xuất trang này thành ảnh JPG</button><button type="button" class="sc-link sc-danger" data-act="clear">Tài liệu mới</button></div>' +
            '<div class="sc-row"><button type="button" class="sc-link" data-act="save-zip" id="scZipBtn">Xuất tất cả trang thành ảnh JPG (ZIP)</button></div>' +
          '</div>' +
      '</div>' +
      '<div class="sc-crop" id="scCropUi" hidden></div>' +
      '<div class="sc-live" id="scLive" hidden></div>' +
      '<div class="sc-busy" id="scBusy" hidden><div class="sc-spin"></div><span id="scBusyTxt">Đang xử lý…</span></div>';

    var $ = function (id) { return root.querySelector('#' + id); };
    var cv = $('scCv');
    $('scName').value = st.name;

    function setBusy(on, txt) { st.busy = !!on; $('scBusy').hidden = !on; if (txt) $('scBusyTxt').textContent = txt; }
    var curPage = function () { return st.pages[st.cur]; };

    // ---- nguồn ảnh: giữ dạng JPEG (Blob) cho nhẹ RAM, chỉ giải mã trang đang xem + 1 trang gần nhất
    function getSource(pg) {
      if (cache.has(pg.id)) { var c = cache.get(pg.id); cache.delete(pg.id); cache.set(pg.id, c); return Promise.resolve(c); }
      return S.decodeImage(pg.blob).then(function (c) {
        cache.set(pg.id, c);
        while (cache.size > 2) { var k = cache.keys().next().value, old = cache.get(k); cache.delete(k); old.width = old.height = 1; }
        return c;
      });
    }
    function detect(c) { try { return S.detectQuad(c); } catch (e) { return null; } }
    function addCanvas(c, noDetect, quad) { // quad: 4 góc 0–1 đã biết (camera trực tiếp) — không thì tự dò
      return S.toBlob(c, 'image/jpeg', 0.92).then(function (blob) {
        var q = quad || (noDetect ? null : detect(c)); // ảnh chụp / ảnh chọn: tự tìm 4 cạnh trang giấy; trang PDF: giữ nguyên
        if (!q && !quad && !noDetect) toast('Chưa nhận ra tờ giấy — bấm "Chỉnh 4 góc" rồi kéo 4 chấm vào 4 góc tờ giấy.', true);
        var pg = { id: ++seq, blob: blob, rot: 0, mode: def.mode, p: clone(presetP(def.mode)), quad: q, cropOn: !!q, thumb: '' };
        cache.set(pg.id, c); while (cache.size > 2) { var k = cache.keys().next().value; cache.get(k).width = 1; cache.delete(k); }
        st.pages.push(pg);
        return makeThumb(pg);
      });
    }
    function makeThumb(pg) {
      return getSource(pg).then(function (src) {
        var t = S.process(src, popt(pg, { maxSide: 220 }));
        return S.toBlob(t, 'image/jpeg', 0.8);
      }).then(function (b) { if (pg.thumb) URL.revokeObjectURL(pg.thumb); pg.thumb = URL.createObjectURL(b); });
    }

    function addFiles(files) {
      files = Array.prototype.slice.call(files || []).filter(Boolean);
      if (!files.length || st.busy) return;
      var start = st.pages.length, i = 0, skipped = [];
      setBusy(true, 'Đang đọc…');
      function next() {
        if (i >= files.length) return Promise.resolve();
        var f = files[i++];
        var tag = files.length > 1 ? ' (' + i + '/' + files.length + ')' : '';
        if (S.isPdf(f)) {
          return S.pdfToCanvases(f, function () { return host.ensure('pdfjs'); }, function (k, n) { setBusy(true, 'Đang đọc PDF trang ' + k + '/' + n + tag); }, host.maxPdfPages)
            .then(function (list) {
              if (list.cutoff) toast('PDF có ' + list.cutoff + ' trang — chỉ lấy ' + list.length + ' trang đầu.', true);
              var j = 0; function one() { if (j >= list.length) return Promise.resolve(); return addCanvas(list[j++], true).then(one); } return one();
            }).catch(function (e) { skipped.push(f.name + ': ' + e.message); }).then(next);
        }
        if (!/^image\//i.test(f.type || '') && !/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name || '')) { skipped.push(f.name + ': không phải ảnh / PDF'); return next(); }
        setBusy(true, 'Đang đọc ảnh' + tag);
        return S.decodeImage(f).then(addCanvas).catch(function (e) { skipped.push((f.name || 'ảnh') + ': ' + e.message); }).then(next);
      }
      next().then(function () {
        setBusy(false);
        if (st.pages.length > start) { st.cur = start; st.dirty = true; }
        if (skipped.length) toast('Bỏ qua: ' + skipped.join(' · '), true);
        renderAll();
      });
    }

    // ---- vẽ
    var drawTimer = 0, drawTok = 0, showOrig = false;
    // ---- thu phóng ảnh xem trước: lăn chuột / nút + − / bấm đúp / kẹp 2 ngón; kéo để di chuyển khi đang phóng
    var zoom = 1, zoomPg = 0, zoomHi = false, scroller = $('scScroll');
    function fitDims() {
      var aw = scroller.clientWidth, ah = scroller.clientHeight, asp = cv.width / cv.height;
      if (!aw || !ah || !(asp > 0)) return null;
      var w = Math.min(aw, ah * asp); return { w: w, h: w / asp };
    }
    function applyZoom() {
      var f = fitDims(); if (!f) return;
      cv.style.width = Math.round(f.w * zoom) + 'px'; cv.style.height = Math.round(f.h * zoom) + 'px';
      scroller.style.touchAction = zoom > 1 ? 'none' : 'pan-y';
      scroller.classList.toggle('is-zoom', zoom > 1);
      $('scZoomTxt').textContent = Math.round(zoom * 100) + '%';
    }
    function setZoom(nz, cx, cy) {
      nz = Math.min(6, Math.max(1, Math.round(nz * 100) / 100));
      if (nz === zoom) return;
      var r = cv.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
      if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
      var fx = r.width ? Math.min(1, Math.max(0, (cx - r.left) / r.width)) : .5, fy = r.height ? Math.min(1, Math.max(0, (cy - r.top) / r.height)) : .5;
      zoom = nz; applyZoom();
      var r2 = cv.getBoundingClientRect();
      scroller.scrollLeft += (r2.left + fx * r2.width) - cx; scroller.scrollTop += (r2.top + fy * r2.height) - cy;
      if (zoom === 1) { scroller.scrollLeft = 0; scroller.scrollTop = 0; }
      if ((zoom > 1) !== zoomHi) { zoomHi = zoom > 1; drawPreview(); } // phóng to → vẽ lại nét hơn
    }
    scroller.addEventListener('wheel', function (e) { if (!curPage()) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY); }, { passive: false });
    scroller.addEventListener('dblclick', function (e) { if (!curPage()) return; setZoom(zoom > 1 ? 1 : 2.5, e.clientX, e.clientY); });
    var ptrs = new Map(), pinch0 = 0, pz0 = 1;
    scroller.addEventListener('pointerdown', function (e) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { scroller.setPointerCapture(e.pointerId); } catch (x) { /* bỏ qua */ }
      if (ptrs.size === 2) { var a = Array.from(ptrs.values()); pinch0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); pz0 = zoom; }
    });
    scroller.addEventListener('pointermove', function (e) {
      var o = ptrs.get(e.pointerId); if (!o) return;
      var dx = e.clientX - o.x, dy = e.clientY - o.y; o.x = e.clientX; o.y = e.clientY;
      if (ptrs.size === 2 && pinch0) { var a = Array.from(ptrs.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); setZoom(pz0 * d / pinch0, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2); }
      else if (ptrs.size === 1 && zoom > 1) { scroller.scrollLeft -= dx; scroller.scrollTop -= dy; }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { scroller.addEventListener(ev, function (e) { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; }); });
    global.addEventListener('resize', function () { applyZoom(); });

    function drawPreview(now) {
      clearTimeout(drawTimer);
      var go = function () {
        var pg = curPage(); if (!pg) return;
        if (pg.id !== zoomPg) { zoomPg = pg.id; zoom = 1; zoomHi = false; }
        var tok = ++drawTok;
        getSource(pg).then(function (src) {
          if (tok !== drawTok) return;
          var out = S.process(src, popt(pg, { mode: showOrig ? 'tuy' : pg.mode, p: showOrig ? { kieu: 'goc' } : pg.p, quad: showOrig ? null : (pg.cropOn ? pg.quad : null), maxSide: zoom > 1 ? Math.min(S.MAX_SIDE, PREVIEW * 2) : PREVIEW }));
          cv.width = out.width; cv.height = out.height; cv.getContext('2d').drawImage(out, 0, 0);
          out.width = out.height = 1; applyZoom();
        }).catch(function (e) { toast('Không vẽ được trang: ' + e.message, true); });
      };
      if (now) go(); else drawTimer = setTimeout(go, 90);
    }
    var thumbTimer = 0;
    function refreshThumbSoon(pg) { clearTimeout(thumbTimer); thumbTimer = setTimeout(function () { makeThumb(pg).then(renderStrip); }, 350); }

    function renderStrip() {
      $('scStrip').innerHTML = st.pages.map(function (pg, i) {
        return '<button type="button" class="sc-th' + (i === st.cur ? ' is-on' : '') + '" data-pg="' + i + '" title="Trang ' + (i + 1) + '">' +
          (pg.thumb ? '<img src="' + pg.thumb + '" alt="">' : '<span class="sc-th-ph"></span>') + '<em>' + (i + 1) + '</em></button>';
      }).join('') + '<button type="button" class="sc-th sc-th-add" data-act="' + (phone && host.camera !== false ? 'pick-cam' : 'pick-img') + '" title="Thêm trang">' + svg('plus') + '<em>Thêm</em></button>';
      var on = $('scStrip').querySelector('.is-on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function renderPanel() {
      var pg = curPage(); if (!pg) return;
      root.querySelectorAll('#scModes button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.mode === pg.mode); });
      var p = pg.p;
      $('scModeTip').textContent = S.MODES[pg.mode].full + ' — ' + S.MODES[pg.mode].tip;
      $('scKieu').hidden = pg.mode !== 'tuy';
      root.querySelectorAll('#scKieu button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.kieu === p.kieu); });
      $('scSliders').classList.toggle('is-off', p.kieu === 'goc');
      $('scS').value = p.bong; $('scB').value = p.trang; $('scC').value = p.dam; $('scLi').checked = !!p.li;
      $('scSVal').textContent = Math.round(p.bong) + '%'; $('scBVal').textContent = Math.round(p.trang) + '%'; $('scCVal').textContent = Math.round(p.dam) + '%';
      $('scCrop').checked = !!pg.cropOn;
      $('scCropTip').textContent = pg.quad ? (pg.cropOn ? '— đã cắt theo 4 cạnh' : '— đang tắt') : '— chưa có khung cắt: bấm "Chỉnh 4 góc"';
      root.querySelectorAll('#scFmt button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.fmt === def.format); });
      $('scPageNo').textContent = 'Trang ' + (st.cur + 1) + ' / ' + st.pages.length;
      $('scSaveTxt').textContent = 'Xuất PDF (' + st.pages.length + ' trang)';
      $('scLocalTxt').textContent = st.docId ? 'Lưu thay đổi' : 'Lưu vào máy'; $('scHeadSaveTxt').textContent = st.docId ? 'Lưu thay đổi' : 'Lưu';
      var n = st.pages.length;
      root.querySelector('[data-act="prev"]').disabled = st.cur <= 0;
      root.querySelector('[data-act="next"]').disabled = st.cur >= n - 1;
      root.querySelector('[data-act="mv-l"]').disabled = st.cur <= 0;
      root.querySelector('[data-act="mv-r"]').disabled = st.cur >= n - 1;
      persistSoon();
    }
    function renderHist() {
      var h = lsGet(LS_HIST, []);
      $('scHist').innerHTML = h.length ? '<div class="sc-lb">Đã lưu gần đây</div><ul>' + h.map(function (x) {
        return '<li><b>' + esc(x.ten) + '</b><span>' + esc(x.trang) + ' trang · ' + esc(x.kb) + ' · ' + esc(x.luc) + '</span>' + (x.noi ? '<small>' + esc(x.noi) + '</small>' : '') + '</li>';
      }).join('') + '</ul><button type="button" class="sc-link" data-act="clear-hist">Xóa danh sách</button>' : '';
    }
    function renderLib() {
      var box = $('scLib'); if (!box) return Promise.resolve();
      return tx('docs', 'readonly', function (t, b) { var r = t.objectStore('docs').getAll(); r.onsuccess = function () { b.v = r.result; }; }).then(function (list) {
        libUrls.forEach(function (u) { URL.revokeObjectURL(u); }); libUrls = [];
        list = (list || []).sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
        if (!list.length) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="sc-lb">Tài liệu đã lưu trong máy (' + list.length + ')</div><div class="sc-lib">' + list.map(function (d) {
          var u = ''; if (d.cover) { u = URL.createObjectURL(d.cover); libUrls.push(u); }
          return '<div class="sc-doc"><button type="button" class="sc-doc-open" data-doc="' + esc(d.id) + '" title="Mở để xem / chỉnh sửa">' +
            (u ? '<img src="' + u + '" alt="">' : '<span class="sc-th-ph"></span>') +
            '<b>' + esc(d.name) + '</b><span>' + (d.count || 0) + ' trang · ' + fmtKb(d.size || 0) + '</span><small>' + esc(fmtWhen(d.updated)) + '</small></button>' +
            '<button type="button" class="sc-ic sc-danger sc-doc-del" data-docdel="' + esc(d.id) + '" title="Xóa tài liệu này khỏi máy" aria-label="Xóa tài liệu">' + svg('del') + '</button></div>';
        }).join('') + '</div>';
      }).catch(function () { box.innerHTML = ''; });
    }
    function renderAll() {
      var has = st.pages.length > 0;
      $('scEmpty').hidden = has; $('scWork').hidden = !has; $('scHeadSave').hidden = !has;
      if (!has) { st.docId = null; st.docCreated = 0; renderHist(); renderLib(); persistSoon(); return; }
      if (st.cur >= st.pages.length) st.cur = st.pages.length - 1;
      renderStrip(); renderPanel(); drawPreview(true);
    }

    // ---- thay đổi thiết lập trang
    function changed(pg) { st.dirty = true; renderPanel(); drawPreview(); refreshThumbSoon(pg); }
    function setMode(m) {
      var pg = curPage(); if (!pg || !S.MODES[m]) return;
      pg.mode = m; pg.p = clone(presetP(m)); def.mode = m; lsSet(LS_DEF, def);
      changed(pg);
    }
    function setParam(key, val) {
      var pg = curPage(); if (!pg) return;
      pg.p[key] = val;
      if (pg.mode === 'tuy') { def.pTuy = clone(pg.p); lsSet(LS_DEF, def); } // chế độ Tùy chỉnh nhớ lần chỉnh gần nhất
      changed(pg);
    }


    // ---- chỉnh tay 4 góc trang giấy: kéo 4 chấm tròn trên ảnh gốc (chưa xoay)
    function openCrop(pg) {
      var box = $('scCropUi'); st.busy = true;
      getSource(pg).then(function (src) {
        var q = (pg.quad || S.defaultQuad()).map(function (p) { return { x: p.x, y: p.y }; });
        var k = Math.min(1, 1000 / Math.max(src.width, src.height)), cw = Math.round(src.width * k), ch = Math.round(src.height * k), drag = -1;
        box.innerHTML = '<div class="sc-crop-top"><b>Kéo 4 chấm vào 4 góc trang giấy</b><small>Phần ngoài khung sẽ bị cắt bỏ, trang được nắn thẳng góc.</small></div>' +
          '<div class="sc-crop-stage"><canvas id="scCropCv" width="' + cw + '" height="' + ch + '"></canvas></div>' +
          '<div class="sc-crop-btns"><button type="button" class="sc-btn" data-c="cancel">Hủy</button><button type="button" class="sc-btn" data-c="auto">Tự tìm</button><button type="button" class="sc-btn" data-c="full">Cả ảnh</button><button type="button" class="sc-btn sc-pri" data-c="ok">Xong</button></div>';
        box.hidden = false; st.busy = false;
        var cv2 = box.querySelector('#scCropCv'), g = cv2.getContext('2d'), R = Math.max(12, Math.round(cw / 38));
        function draw() {
          g.clearRect(0, 0, cw, ch); g.drawImage(src, 0, 0, cw, ch);
          g.save(); g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.rect(0, 0, cw, ch);
          g.moveTo(q[0].x * cw, q[0].y * ch); q.slice(1).forEach(function (p) { g.lineTo(p.x * cw, p.y * ch); }); g.closePath(); g.fill('evenodd'); g.restore();
          g.lineWidth = Math.max(2, cw / 300); g.strokeStyle = '#2f80ff'; g.beginPath(); g.moveTo(q[0].x * cw, q[0].y * ch);
          q.slice(1).forEach(function (p) { g.lineTo(p.x * cw, p.y * ch); }); g.closePath(); g.stroke();
          q.forEach(function (p) { g.beginPath(); g.arc(p.x * cw, p.y * ch, R, 0, 7); g.fillStyle = 'rgba(47,128,255,.35)'; g.fill(); g.lineWidth = Math.max(2, cw / 260); g.strokeStyle = '#fff'; g.stroke(); });
        }
        function pos(e) { var r = cv2.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), sx: cw / r.width }; }
        cv2.addEventListener('pointerdown', function (e) {
          var m = pos(e), best = -1, bd = 1e9; e.preventDefault();
          q.forEach(function (p, i) { var d = Math.hypot((p.x - m.x) * cw, (p.y - m.y) * ch) / m.sx; if (d < bd) { bd = d; best = i; } });
          if (bd < 60) { drag = best; try { cv2.setPointerCapture(e.pointerId); } catch (x) {} }
        });
        cv2.addEventListener('pointermove', function (e) { if (drag < 0) return; var m = pos(e); q[drag].x = m.x; q[drag].y = m.y; draw(); });
        ['pointerup', 'pointercancel'].forEach(function (ev) { cv2.addEventListener(ev, function () { drag = -1; }); });
        draw();
        box.onclick = function (e) {
          var b = e.target.closest('[data-c]'); if (!b) return;
          if (b.dataset.c === 'cancel') { box.hidden = true; box.innerHTML = ''; return; }
          if (b.dataset.c === 'auto') { var a = detect(src); if (a) { q = a; draw(); } else toast('Không tìm thấy rìa trang giấy — hãy kéo tay.', true); return; }
          if (b.dataset.c === 'full') { q = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]; draw(); return; }
          pg.quad = q; pg.cropOn = true; box.hidden = true; box.innerHTML = ''; changed(pg);
        };
      });
    }

    // ---- CAMERA TRỰC TIẾP (PC 0.23 / ĐT 0.8): hình camera + 4 chấm canh góc tờ giấy → bấm nút tròn để chụp → xem trước → Chụp lại / Thêm trang / Xong.
    // Chỉ phần nằm trong 4 chấm được lấy (nắn thẳng góc). Ảnh gốc vẫn được giữ để sau này chỉnh lại 4 góc (nút "Chỉnh 4 góc").
    // Không có camera / không được cấp quyền → báo lỗi; điện thoại vẫn dùng được nút "Ảnh".
    var liveOK = host.live !== false && !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    function openLive() {
      if (st.busy) return;
      if (!liveOK) { if (phone) return $('scCam').click(); return toast('Máy này không mở được camera trong app.', true); }
      var box = $('scLive'), stream = null, track = null, alive = true, mode = 'live', added = 0, auto = true, drag = -1, miss = 0, found = null;
      var torchOn = false, lw = 0, lh = 0, detT = 0, raf = 0, result = null, cur = S.defaultQuad(), tgt = S.defaultQuad();
      st.busy = true;
      box.innerHTML =
        '<div class="sc-live-top"><div><b id="scLvT"></b><small id="scLvS">Đang mở camera…</small></div><button type="button" class="sc-lv-b" data-l="torch" id="scLvTorch" hidden>Đèn</button></div>' +
        '<div class="sc-live-stage" id="scLvStage"><div class="sc-live-box" id="scLvBox"><video id="scLvVid" playsinline muted autoplay></video><canvas id="scLvCv"></canvas></div><canvas class="sc-live-prev" id="scLvPrev" hidden></canvas></div>' +
        '<div class="sc-live-bar" id="scLvBar1"><button type="button" class="sc-lv-b" data-l="close" id="scLvClose">Đóng</button>' +
          '<button type="button" class="sc-shutter" data-l="shoot" aria-label="Chụp" title="Chụp (Space)"></button>' +
          '<button type="button" class="sc-lv-b on" data-l="auto" id="scLvAuto">Tự dò: Bật</button></div>' +
        '<div class="sc-live-bar" id="scLvBar2" hidden><button type="button" class="sc-lv-b" data-l="retake">Chụp lại</button>' +
          '<button type="button" class="sc-lv-b" data-l="more">Thêm trang</button><button type="button" class="sc-lv-b pri" data-l="done">Xong</button></div>';
      box.hidden = false;
      var q$ = function (id) { return box.querySelector('#' + id); };
      var vid = q$('scLvVid'), vbox = q$('scLvBox'), ov = q$('scLvCv'), prev = q$('scLvPrev'), stage = q$('scLvStage'), bar1 = q$('scLvBar1'), bar2 = q$('scLvBar2');
      vid.muted = true; vid.setAttribute('playsinline', ''); vid.setAttribute('webkit-playsinline', '');
      var tip = function (s) { q$('scLvS').textContent = s; };
      var HINT = 'Kéo 4 chấm vào 4 góc tờ giấy, rồi bấm nút tròn để chụp';
      function head(t) { q$('scLvT').textContent = t; }
      head('Chụp tài liệu');

      function setAuto(on) { auto = !!on; var b = q$('scLvAuto'); b.textContent = 'Tự dò: ' + (auto ? 'Bật' : 'Tắt'); b.classList.toggle('on', auto); if (auto) { miss = 0; } }

      function layout() { // khung hiển thị đúng tỉ lệ hình camera → 4 chấm (toạ độ 0–1) trùng khít với hình
        var vw = vid.videoWidth, vh = vid.videoHeight, sw = stage.clientWidth, sh = stage.clientHeight;
        if (!vw || !vh || !sw || !sh) return;
        var k = Math.min(sw / vw, sh / vh), w = Math.floor(vw * k), h = Math.floor(vh * k);
        if (w === lw && h === lh) return;
        lw = w; lh = h; vbox.style.width = w + 'px'; vbox.style.height = h + 'px';
        var dpr = Math.min(2, global.devicePixelRatio || 1); ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr);
      }
      function drawOv() {
        var w = ov.width, h = ov.height, g = ov.getContext('2d'), q = cur, i, R = Math.max(12, Math.round(w / 34));
        g.clearRect(0, 0, w, h);
        g.save(); g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.rect(0, 0, w, h);
        g.moveTo(q[0].x * w, q[0].y * h); for (i = 1; i < 4; i++) g.lineTo(q[i].x * w, q[i].y * h); g.closePath(); g.fill('evenodd'); g.restore();
        g.lineWidth = Math.max(2, w / 260); g.strokeStyle = found === false ? '#f5a524' : '#2f80ff'; g.beginPath(); g.moveTo(q[0].x * w, q[0].y * h);
        for (i = 1; i < 4; i++) g.lineTo(q[i].x * w, q[i].y * h); g.closePath(); g.stroke();
        for (i = 0; i < 4; i++) { g.beginPath(); g.arc(q[i].x * w, q[i].y * h, R, 0, 7); g.fillStyle = found === false ? 'rgba(245,165,36,.75)' : 'rgba(47,128,255,.8)'; g.fill(); g.lineWidth = Math.max(2, w / 200); g.strokeStyle = '#fff'; g.stroke(); }
      }
      function frame() { // vẽ lại liên tục; chấm trượt mượt về vị trí mới dò được
        raf = 0; if (!alive) return;
        if (mode === 'live') {
          layout();
          for (var i = 0; i < 4; i++) {
            var dx = tgt[i].x - cur[i].x, dy = tgt[i].y - cur[i].y;
            if (Math.abs(dx) + Math.abs(dy) > 0.0012) { cur[i].x += dx * 0.3; cur[i].y += dy * 0.3; } else { cur[i].x = tgt[i].x; cur[i].y = tgt[i].y; }
          }
          if (lw) drawOv();
        }
        raf = global.requestAnimationFrame(frame);
      }
      var small = document.createElement('canvas');
      function detectTick() {
        detT = 0; if (!alive) return;
        if (mode === 'live' && auto && drag < 0 && vid.videoWidth > 0 && vid.readyState >= 2) {
          try {
            var k = 360 / Math.max(vid.videoWidth, vid.videoHeight);
            small.width = Math.max(24, Math.round(vid.videoWidth * k)); small.height = Math.max(24, Math.round(vid.videoHeight * k));
            small.getContext('2d').drawImage(vid, 0, 0, small.width, small.height);
            var q = S.detectQuad(small);
            if (q) { miss = 0; tgt = q.map(function (p) { return { x: p.x, y: p.y }; }); if (found !== true) { found = true; tip('Đã bám 4 góc tờ giấy — bấm nút tròn để chụp'); } }
            else if (++miss > 6 && found !== false) { found = false; tip('Chưa thấy rìa tờ giấy — hãy kéo 4 chấm bằng tay (hoặc đặt giấy lên nền tối)'); }
          } catch (e) { /* bỏ qua khung hình lỗi */ }
        }
        detT = setTimeout(detectTick, 170);
      }

      // ---- kéo 4 chấm bằng tay (tự tắt "Tự dò" để chấm không bị giật về chỗ cũ)
      var clamp01 = function (v) { return Math.min(1, Math.max(0, v)); };
      ov.addEventListener('pointerdown', function (e) {
        if (mode !== 'live') return; e.preventDefault();
        var r = ov.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, best = -1, bd = 1e9;
        cur.forEach(function (p, i) { var d = Math.hypot(p.x * r.width - mx, p.y * r.height - my); if (d < bd) { bd = d; best = i; } });
        if (bd < 70) { drag = best; setAuto(false); found = null; tip(HINT); try { ov.setPointerCapture(e.pointerId); } catch (x) { /* bỏ qua */ } }
      });
      ov.addEventListener('pointermove', function (e) {
        if (drag < 0) return; var r = ov.getBoundingClientRect(), x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
        cur[drag].x = tgt[drag].x = x; cur[drag].y = tgt[drag].y = y;
      });
      ['pointerup', 'pointercancel'].forEach(function (ev) { ov.addEventListener(ev, function () { drag = -1; }); });

      // ---- camera
      function startStream() {
        var md = navigator.mediaDevices;
        return md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false })
          .catch(function (e) { if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e; return md.getUserMedia({ video: true, audio: false }); })
          .then(function (s) {
            if (!alive) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
            stream = s; track = s.getVideoTracks()[0]; vid.srcObject = s;
            var pl = vid.play(); if (pl && pl.catch) pl.catch(function () { /* iOS: chờ người dùng chạm */ });
            var caps = {}; try { caps = (track.getCapabilities && track.getCapabilities()) || {}; } catch (e) { /* bỏ qua */ }
            q$('scLvTorch').hidden = !caps.torch;
            try { if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* bỏ qua */ }
            head('Chụp tài liệu'); tip(HINT);
          });
      }
      function fail(e) {
        var n = e && e.name;
        var msg = (n === 'NotAllowedError' || n === 'SecurityError') ? 'Chưa được cấp quyền camera. Hãy cho phép camera cho app (Cài đặt › Ứng dụng › Quyền) rồi mở lại.'
          : (n === 'NotFoundError' || n === 'OverconstrainedError') ? 'Không tìm thấy camera trên máy này.'
          : 'Không mở được camera' + (e && e.message ? ': ' + e.message : '') + '.';
        close();
        // Bản điện thoại (APK có plugin NativeSettings): hỏi rồi mở thẳng trang "Thông tin ứng dụng" để bật quyền Camera.
        var NS = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.NativeSettings;
        if (phone && NS && (n === 'NotAllowedError' || n === 'SecurityError')) {
          var go = false; try { go = global.confirm('Chưa được cấp quyền camera.\n\nMở Cài đặt của app để bật? (Quyền › Camera › Cho phép)'); } catch (x) { /* bỏ qua */ }
          if (go) {
            var android = global.Capacitor.getPlatform && global.Capacitor.getPlatform() === 'android';
            var opt = android ? NS.openAndroid({ option: 'application_details' }) : NS.openIOS({ option: 'app' });
            if (opt && opt.catch) opt.catch(function () { toast('Không mở được Cài đặt. Vào Cài đặt › Ứng dụng › Kho Lạnh An An › Quyền.', true); });
            return;
          }
        }
        toast(msg + (phone ? ' Bạn vẫn có thể bấm "Ảnh" để chọn ảnh đã chụp.' : ''), true);
      }
      function toggleTorch() {
        if (!track) return;
        track.applyConstraints({ advanced: [{ torch: !torchOn }] }).then(function () { torchOn = !torchOn; q$('scLvTorch').classList.toggle('on', torchOn); }).catch(function () { toast('Máy không bật được đèn flash.', true); });
      }

      // ---- chụp: lấy ảnh nét nhất có thể (takePhoto nếu cùng khung hình với video, không thì chính khung hình video)
      function hiRes(vw, vh) {
        if (!(global.ImageCapture && track)) return Promise.resolve(null);
        return Promise.race([
          new global.ImageCapture(track).takePhoto().then(function (b) { return S.decodeImage(b); }).then(function (c) {
            var same = Math.abs((c.width / c.height) / (vw / vh) - 1) < 0.02, better = c.width * c.height > vw * vh * 1.2;
            if (same && better) return c; c.width = c.height = 1; return null;
          }),
          new Promise(function (r) { setTimeout(function () { r(null); }, 2500); })
        ]).catch(function () { return null; });
      }
      function shoot() {
        if (mode !== 'live' || !vid.videoWidth) return;
        mode = 'busy'; tip('Đang chụp…');
        var vw = vid.videoWidth, vh = vid.videoHeight, quad = cur.map(function (p) { return { x: p.x, y: p.y }; });
        var k = Math.min(1, S.MAX_SIDE / Math.max(vw, vh)), fr = document.createElement('canvas');
        fr.width = Math.round(vw * k); fr.height = Math.round(vh * k); fr.getContext('2d').drawImage(vid, 0, 0, fr.width, fr.height);
        hiRes(vw, vh).then(function (hi) {
          var src = hi || fr; if (hi) fr.width = fr.height = 1;
          if (!alive) { src.width = src.height = 1; return; }
          var out = S.process(src, { quad: quad, rot: 0, mode: def.mode, p: clone(presetP(def.mode)), maxSide: PREVIEW });
          prev.width = out.width; prev.height = out.height; prev.getContext('2d').drawImage(out, 0, 0); if (out !== src) out.width = out.height = 1;
          result = { src: src, quad: quad }; mode = 'review';
          vbox.hidden = true; prev.hidden = false; bar1.hidden = true; bar2.hidden = false;
          head('Xem trước trang vừa chụp'); tip('Chỉ phần trong 4 chấm được giữ lại, đã nắn thẳng và làm trắng nền' + (added ? ' · đã có ' + added + ' trang' : ''));
        }).catch(function (e) { toast('Không chụp được: ' + (e && e.message || e), true); backToLive(); });
      }
      function backToLive() {
        if (!alive) return;
        if (result) { result.src.width = result.src.height = 1; result = null; }
        mode = 'live'; prev.hidden = true; vbox.hidden = false; bar1.hidden = false; bar2.hidden = true; lw = 0; miss = 0; found = null;
        q$('scLvClose').textContent = added ? 'Xong (' + added + ')' : 'Đóng';
        head('Chụp tài liệu'); tip(added ? 'Đã có ' + added + ' trang — chụp tiếp hoặc bấm Xong' : HINT);
      }
      function keep(finish) {
        if (!result) return;
        var r = result; result = null; mode = 'busy'; tip('Đang thêm trang…');
        addCanvas(r.src, true, r.quad).then(function () { added++; if (finish) close(); else backToLive(); })
          .catch(function (e) { r.src.width = r.src.height = 1; toast('Không thêm được trang: ' + (e && e.message || e), true); backToLive(); });
      }
      function close() {
        if (!alive) return; alive = false;
        clearTimeout(detT); if (raf) global.cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis);
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* bỏ qua */ }
        try { vid.srcObject = null; } catch (e) { /* bỏ qua */ }
        if (result) { result.src.width = result.src.height = 1; result = null; }
        box.onclick = null; box.hidden = true; box.innerHTML = ''; st.busy = false;
        if (added) { st.cur = Math.max(0, st.pages.length - added); st.dirty = true; renderAll(); }
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); return mode === 'review' ? backToLive() : close(); }
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (mode === 'live') shoot(); else if (mode === 'review') keep(true); }
      }
      function onVis() { // quay lại app sau khi thoát ra ngoài: camera có thể đã bị hệ thống ngắt
        if (document.hidden || !alive || !track || track.readyState !== 'ended') return;
        startStream().catch(fail);
      }
      box.onclick = function (e) {
        var b = e.target.closest('[data-l]'); if (!b || mode === 'busy') return;
        var a = b.dataset.l;
        if (a === 'close') close(); else if (a === 'shoot') shoot(); else if (a === 'auto') setAuto(!auto);
        else if (a === 'torch') toggleTorch(); else if (a === 'retake') backToLive(); else if (a === 'more') keep(false); else if (a === 'done') keep(true);
      };
      document.addEventListener('keydown', onKey); document.addEventListener('visibilitychange', onVis);
      raf = global.requestAnimationFrame(frame); detT = setTimeout(detectTick, 400);
      startStream().catch(fail);
    }

    // ---- xuất
    function exportName() { st.name = cleanName($('scName').value); $('scName').value = st.name; return st.name; }
    function buildPdf() {
      var name = exportName();
      var list = st.pages.map(function (pg) { return { getSource: function () { return getSource(pg); }, quad: pg.cropOn ? pg.quad : null, rot: pg.rot, mode: pg.mode, p: pg.p }; });
      setBusy(true, 'Đang tạo PDF…');
      return S.buildPdf(list, { format: def.format, title: name }, function () { return host.ensure('jspdf'); }, function (k, n) { setBusy(true, 'Đang tạo PDF trang ' + k + '/' + n + '…'); })
        .then(function (blob) { return { blob: blob, name: name + '.pdf' }; });
    }
    function remember(file, noi) {
      var d = new Date(), h = lsGet(LS_HIST, []);
      h.unshift({ ten: file.name, trang: st.pages.length, kb: fmtKb(file.blob.size), luc: p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' ' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1), noi: noi || '' });
      lsSet(LS_HIST, h.slice(0, 20));
    }
    function savePdf(viaShare) {
      if (st.busy || !st.pages.length) return;
      buildPdf().then(function (f) {
        setBusy(true, viaShare ? 'Đang mở chia sẻ…' : 'Đang lưu…');
        return Promise.resolve(viaShare ? host.share(f.blob, f.name) : host.save(f.blob, f.name)).then(function (noi) {
          remember(f, viaShare ? 'Đã chia sẻ' : (typeof noi === 'string' ? noi : ''));
          if (!viaShare) toast(DONE + ' ' + f.name + ' (' + fmtKb(f.blob.size) + ')' + (typeof noi === 'string' && noi ? ' — ' + noi : ''));
        });
      }).catch(function (e) { if (e && /abort|cancel/i.test(e.name + e.message)) return; toast('Không lưu được: ' + (e && e.message || e), true); })
        .then(function () { setBusy(false); });
    }
    function saveJpg() {
      var pg = curPage(); if (!pg || st.busy) return;
      var name = exportName() + (st.pages.length > 1 ? '_trang' + (st.cur + 1) : '') + '.jpg';
      setBusy(true, 'Đang tạo ảnh…');
      getSource(pg).then(function (src) {
        var c = S.process(src, popt(pg, { maxSide: S.MAX_SIDE }));
        return S.toBlob(c, 'image/jpeg', 0.9);
      }).then(function (blob) { return Promise.resolve(host.save(blob, name)).then(function (noi) { toast(DONE + ' ' + name + (typeof noi === 'string' && noi ? ' — ' + noi : '')); }); })
        .catch(function (e) { toast('Không lưu được ảnh: ' + (e && e.message || e), true); })
        .then(function () { setBusy(false); });
    }
    // Xuất MỌI trang thành từng ảnh JPG riêng (mỗi trang 1 file) rồi gói trong 1 file ZIP. Xử lý lần lượt từng trang để đỡ tốn RAM.
    function saveZip() {
      if (st.busy || !st.pages.length) return;
      var name = exportName(), pages = st.pages.slice(), n = pages.length, pad = String(n).length, k = 0, zip;
      setBusy(true, 'Đang chuẩn bị ZIP…');
      Promise.resolve(host.ensure('jszip')).then(function () {
        if (!global.JSZip) throw new Error('Thiếu thư viện nén ZIP (JSZip).');
        zip = new global.JSZip();
        function one() {
          if (k >= n) return Promise.resolve();
          var pg = pages[k++], idx = k;
          setBusy(true, 'Đang tạo ảnh ' + idx + '/' + n + '…');
          return getSource(pg).then(function (src) {
            var c = S.process(src, popt(pg, { maxSide: S.MAX_SIDE }));
            return S.toBlob(c, 'image/jpeg', 0.9);
          }).then(function (b) {
            var num = String(idx); while (num.length < pad) num = '0' + num;
            zip.file(name + '_trang' + num + '.jpg', b);
          }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }).then(one);
        }
        return one();
      }).then(function () {
        setBusy(true, 'Đang nén ZIP…');
        return zip.generateAsync({ type: 'blob', compression: 'STORE' }); // JPG đã nén sẵn → không nén lại, nhanh hơn
      }).then(function (blob) {
        var fn = name + '_anh-JPG.zip';
        return Promise.resolve(host.save(blob, fn)).then(function (noi) { toast(DONE + ' ' + fn + ' (' + n + ' ảnh, ' + fmtKb(blob.size) + ')' + (typeof noi === 'string' && noi ? ' — ' + noi : '')); });
      }).catch(function (e) { if (e && /abort|cancel/i.test(e.name + e.message)) return; toast('Không xuất được ZIP: ' + (e && e.message || e), true); })
        .then(function () { setBusy(false); });
    }
    function clearAll(ask) {
      if (ask && st.dirty && !global.confirm('Bỏ ' + st.pages.length + ' trang đang làm (chưa bấm Lưu vào máy)?')) return;
      st.pages.forEach(function (pg) { if (pg.thumb) URL.revokeObjectURL(pg.thumb); });
      cache.forEach(function (c) { c.width = c.height = 1; }); cache.clear();
      st.pages = []; st.cur = 0; st.dirty = false; st.docId = null; st.docCreated = 0; st.name = defaultName(); $('scName').value = st.name;
      renderAll();
    }

    // ---- LƯU VÀO MÁY / mở lại / xóa / tự lưu nháp
    function mkPage(o, id) {
      var m = S.MODES[o.mode] ? o.mode : S.DEFAULT_MODE, q = okQuad(o.quad);
      return { id: id, blob: o.blob, rot: ((+o.rot || 0) % 360 + 360) % 360, mode: m, p: clone(S.resolveParams(m, o.p || null)), quad: q, cropOn: !!o.cropOn && !!q, thumb: '', inDraft: false };
    }
    function thumbsAll() {
      var j = 0, n = st.pages.length;
      return (function nx() { if (j >= n) return Promise.resolve(); setBusy(true, 'Đang mở trang ' + (j + 1) + '/' + n + '…'); return makeThumb(st.pages[j++]).then(nx); })();
    }
    function persistSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(persistNow, 700); }
    function persistNow() {
      clearTimeout(draftTimer);
      if (!ready) return Promise.resolve();
      if (draftBusy) { draftAgain = true; return Promise.resolve(); }
      draftBusy = true;
      var pages = st.pages.slice(), order = pages.map(function (pg) { return pg.id; }), mp = {};
      pages.forEach(function (pg) { mp[pg.id] = { rot: pg.rot, mode: pg.mode, p: clone(pg.p), quad: pg.quad ? clone(pg.quad) : null, cropOn: !!pg.cropOn }; });
      var meta = { order: order, pages: mp, cur: st.cur, name: st.name, docId: st.docId || null, docCreated: st.docCreated || 0, dirty: !!st.dirty };
      var fresh = pages.filter(function (pg) { return !pg.inDraft; });
      return tx('draft', 'readwrite', function (t) {
        var s = t.objectStore('draft');
        if (!pages.length) { s.clear(); return; }
        fresh.forEach(function (pg) { s.put({ blob: pg.blob }, 'p' + pg.id); });
        s.put(meta, 'meta');
        var keep = { meta: 1 }; order.forEach(function (id) { keep['p' + id] = 1; });
        var kr = s.getAllKeys(); kr.onsuccess = function () { kr.result.forEach(function (k) { if (!keep[k]) s.delete(k); }); };
      }).then(function () { fresh.forEach(function (pg) { pg.inDraft = true; }); })
        .catch(function () { if (!draftWarned) { draftWarned = true; toast('Không tự lưu nháp được — nếu tắt app, trang đang làm có thể mất. Hãy bấm Lưu vào máy (bộ nhớ có thể đã đầy).', true); } })
        .then(function () { draftBusy = false; if (draftAgain) { draftAgain = false; persistSoon(); } });
    }
    function saveLocal() {
      if (st.busy || !st.pages.length) return;
      var name = exportName(), now = Date.now(), id = st.docId || ('d' + now.toString(36) + Math.random().toString(36).slice(2, 6));
      var pages = st.pages.slice(), first = pages[0], created = st.docCreated || now, fmt = def.format;
      var recs = pages.map(function (pg) { return { blob: pg.blob, rot: pg.rot, mode: pg.mode, p: clone(pg.p), quad: pg.quad ? clone(pg.quad) : null, cropOn: !!pg.cropOn }; });
      var size = pages.reduce(function (a, pg) { return a + (pg.blob ? pg.blob.size : 0); }, 0);
      clearTimeout(thumbTimer);
      setBusy(true, 'Đang lưu vào máy…');
      getSource(first).then(function (src) { var t = S.process(src, popt(first, { maxSide: 320 })); return S.toBlob(t, 'image/jpeg', 0.8); })
        .then(function (cover) {
          return tx(['docs', 'docpages'], 'readwrite', function (t) {
            t.objectStore('docs').put({ id: id, name: name, count: recs.length, size: size, format: fmt, created: created, updated: now, cover: cover }, id);
            t.objectStore('docpages').put({ pages: recs }, id);
          });
        })
        .then(function () {
          st.dirty = false; clearAll(false);
          toast('Đã lưu "' + name + '" (' + recs.length + ' trang) vào máy. Muốn sửa lại: chọn ở danh sách bên dưới.');
        })
        .catch(function (e) { toast('Không lưu được vào máy: ' + (e && e.message || e), true); })
        .then(function () { setBusy(false); });
    }
    function openDoc(id) {
      if (st.busy || st.pages.length) return;
      setBusy(true, 'Đang mở tài liệu…');
      tx(['docs', 'docpages'], 'readonly', function (t, b) {
        var a = t.objectStore('docs').get(id), c = t.objectStore('docpages').get(id);
        a.onsuccess = function () { b.v = b.v || {}; b.v.meta = a.result; }; c.onsuccess = function () { b.v = b.v || {}; b.v.rec = c.result; };
      }).then(function (r) {
        var meta = r && r.meta, rec = r && r.rec;
        if (!meta || !rec || !rec.pages || !rec.pages.length) throw new Error('Tài liệu này không còn dữ liệu.');
        st.pages = rec.pages.filter(function (o) { return o && o.blob; }).map(function (o) { return mkPage(o, ++seq); });
        st.cur = 0; st.name = meta.name || defaultName(); $('scName').value = st.name; st.docId = id; st.docCreated = meta.created || 0; st.dirty = false;
        return thumbsAll();
      }).catch(function (e) { toast('Không mở được tài liệu: ' + (e && e.message || e), true); })
        .then(function () { setBusy(false); renderAll(); });
    }
    function delDoc(id) {
      if (st.busy) return;
      var nm = root.querySelector('.sc-doc-open[data-doc="' + id + '"] b');
      if (!global.confirm('Xóa tài liệu' + (nm ? ' "' + nm.textContent + '"' : '') + ' khỏi máy? Không khôi phục lại được.')) return;
      tx(['docs', 'docpages'], 'readwrite', function (t) { t.objectStore('docs').delete(id); t.objectStore('docpages').delete(id); })
        .catch(function (e) { toast('Không xóa được: ' + (e && e.message || e), true); })
        .then(renderLib);
    }
    function restore() { // mở app lại: dựng lại đúng trang đang làm lần trước
      var restored = false;
      setBusy(true, 'Đang mở lại trang đang làm…');
      return tx('draft', 'readonly', function (t, b) { var r = t.objectStore('draft').get('meta'); r.onsuccess = function () { b.v = r.result; }; })
        .then(function (meta) {
          if (!meta || !meta.order || !meta.order.length) return;
          return tx('draft', 'readonly', function (t, b) {
            b.v = {}; meta.order.forEach(function (id) { var r = t.objectStore('draft').get('p' + id); r.onsuccess = function () { b.v[id] = r.result; }; });
          }).then(function (blobs) {
            var list = [];
            meta.order.forEach(function (id) {
              var rec = blobs[id]; if (!rec || !rec.blob) return;
              var pg = mkPage(Object.assign({ blob: rec.blob }, (meta.pages || {})[id] || {}), +id); pg.inDraft = true; list.push(pg); seq = Math.max(seq, +id);
            });
            if (!list.length) return;
            st.pages = list; st.cur = Math.min(Math.max(0, +meta.cur || 0), list.length - 1);
            st.name = meta.name || st.name; $('scName').value = st.name; st.docId = meta.docId || null; st.docCreated = meta.docCreated || 0; st.dirty = meta.dirty !== false;
            restored = true;
            return thumbsAll();
          });
        })
        .catch(function () { /* nháp hỏng / không đọc được: bắt đầu trống */ })
        .then(function () { ready = true; setBusy(false); renderAll(); if (restored) toast('Đã mở lại trang đang làm dở lần trước.'); });
    }

    // ---- sự kiện
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-mode],[data-kieu],[data-fmt],[data-pg],[data-doc],[data-docdel]'); if (!t || t.disabled || st.busy) return;
      if (t.dataset.docdel) return delDoc(t.dataset.docdel);
      if (t.dataset.doc) return openDoc(t.dataset.doc);
      if (t.dataset.mode) return setMode(t.dataset.mode);
      if (t.dataset.kieu) return setParam('kieu', t.dataset.kieu);
      if (t.dataset.fmt) { def.format = t.dataset.fmt; lsSet(LS_DEF, def); return renderPanel(); }
      if (t.dataset.pg != null) { st.cur = +t.dataset.pg; renderStrip(); renderPanel(); return drawPreview(true); }
      var pg = curPage(), a = t.dataset.act, i = st.cur;
      if (a === 'pick-cam') return openLive();
      if (a === 'pick-img') return $('scImg').click();
      if (a === 'pick-pdf') return $('scPdf').click();
      if (a === 'clear-hist') { lsSet(LS_HIST, []); return renderHist(); }
      if (!pg) return;
      if (a === 'prev' && i > 0) { st.cur--; renderStrip(); renderPanel(); drawPreview(true); }
      else if (a === 'next' && i < st.pages.length - 1) { st.cur++; renderStrip(); renderPanel(); drawPreview(true); }
      else if (a === 'rot-l' || a === 'rot-r') { pg.rot = (pg.rot + (a === 'rot-r' ? 90 : 270)) % 360; changed(pg); drawPreview(true); }
      else if (a === 'mv-l' && i > 0) { st.pages.splice(i - 1, 0, st.pages.splice(i, 1)[0]); st.cur--; st.dirty = true; renderStrip(); renderPanel(); }
      else if (a === 'mv-r' && i < st.pages.length - 1) { st.pages.splice(i + 1, 0, st.pages.splice(i, 1)[0]); st.cur++; st.dirty = true; renderStrip(); renderPanel(); }
      else if (a === 'del') {
        if (st.pages.length > 1 && !global.confirm('Xóa trang ' + (i + 1) + '?')) return;
        var gone = st.pages.splice(i, 1)[0]; if (gone.thumb) URL.revokeObjectURL(gone.thumb); if (cache.has(gone.id)) { cache.get(gone.id).width = 1; cache.delete(gone.id); }
        if (!st.pages.length) st.dirty = false; renderAll();
      }
      else if (a === 'zoom-in') setZoom(zoom * 1.4);
      else if (a === 'zoom-out') setZoom(zoom / 1.4);
      else if (a === 'zoom-fit') setZoom(1);
      else if (a === 'crop') openCrop(pg);
      else if (a === 'redetect') {
        getSource(pg).then(function (src) {
          var q = detect(src);
          if (q) { pg.quad = q; pg.cropOn = true; changed(pg); toast('Đã tìm lại 4 cạnh trang giấy.'); }
          else toast('Không tìm thấy rìa trang giấy (bàn / nền quá giống màu giấy?). Bấm "Chỉnh 4 góc" để tự kéo.', true);
        });
      }
      else if (a === 'apply-all') {
        st.pages.forEach(function (p) { if (p !== pg) { p.mode = pg.mode; p.p = clone(pg.p); } });
        st.dirty = true; persistSoon(); toast('Đã áp dụng cho ' + st.pages.length + ' trang.');
        var j = 0; (function nx() { if (j >= st.pages.length) return renderStrip(); makeThumb(st.pages[j++]).then(nx); })();
      }
      else if (a === 'reset') { if (pg.mode === 'tuy') def.pTuy = null; setMode(pg.mode); }
      else if (a === 'save-local') saveLocal();
      else if (a === 'save-pdf') savePdf(false);
      else if (a === 'share-pdf') savePdf(true);
      else if (a === 'save-jpg') saveJpg();
      else if (a === 'save-zip') saveZip();
      else if (a === 'clear') clearAll(true);
    });
    // Giữ nút "con mắt" để so với ảnh gốc
    var cmp = root.querySelector('[data-act="cmp"]');
    var cmpOn = function (e) { if (e) e.preventDefault(); showOrig = true; drawPreview(true); }, cmpOff = function () { if (!showOrig) return; showOrig = false; drawPreview(true); };
    cmp.addEventListener('pointerdown', cmpOn); ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { cmp.addEventListener(ev, cmpOff); });

    function slider(id, key) { $(id).addEventListener('input', function () { setParam(key, +this.value); }); }
    slider('scS', 'bong'); slider('scB', 'trang'); slider('scC', 'dam');
    $('scLi').addEventListener('change', function () { setParam('li', this.checked); });
    $('scCrop').addEventListener('change', function () {
      var pg = curPage(); if (!pg) return;
      var on = this.checked;
      if (on && !pg.quad) { getSource(pg).then(function (src) { pg.quad = detect(src) || S.defaultQuad(); pg.cropOn = true; changed(pg); }); return; }
      pg.cropOn = on; changed(pg);
    });
    ['scCam', 'scImg', 'scPdf'].forEach(function (id) { $(id).addEventListener('change', function () { addFiles(this.files); this.value = ''; }); });
    $('scName').addEventListener('change', function () { exportName(); persistSoon(); });

    if (!phone) {
      // Kéo thả + dán ảnh (Ctrl+V) + phím tắt
      root.addEventListener('dragover', function (e) { e.preventDefault(); root.classList.add('is-drag'); });
      root.addEventListener('dragleave', function (e) { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('is-drag'); });
      root.addEventListener('drop', function (e) { e.preventDefault(); root.classList.remove('is-drag'); if (e.dataTransfer) addFiles(e.dataTransfer.files); });
      document.addEventListener('paste', function (e) {
        var items = (e.clipboardData && e.clipboardData.files) || []; if (!items.length) return;
        var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        e.preventDefault(); addFiles(items);
      });
      document.addEventListener('keydown', function (e) {
        var t = e.target; if (!st.pages.length || st.busy || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) || e.ctrlKey || e.altKey || e.metaKey) return;
        var map = { ArrowLeft: 'prev', ArrowRight: 'next', r: 'rot-r', R: 'rot-r', Delete: 'del', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-fit' }, a = map[e.key]; if (!a) return;
        var b = root.querySelector('[data-act="' + a + '"]'); if (b && !b.disabled) { e.preventDefault(); b.click(); }
      });
    }

    // ra khỏi app / chuyển sang app khác (điện thoại) → ghi nháp ngay
    global.addEventListener('pagehide', function () { persistNow(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) persistNow(); });
    renderAll();
    restore();
    return { addFiles: addFiles, clear: function () { clearAll(false); }, pages: function () { return st.pages.length; } };
  }

  global.KLScanUI = { mount: mount };
})(window);
