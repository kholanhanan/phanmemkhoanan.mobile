// scan-ui.js — GIAO DIỆN "Scan tài liệu" thông minh (M15, PC 0.22 / ĐT 0.7). DÙNG CHUNG PC + điện thoại (chép y nguyên sang ban-dien-thoai/www/).
// KLScanUI.mount(root, host) — host do nơi gọi cung cấp:
//   { platform: 'pc' | 'phone', ensure(name) → Promise  ('jspdf' | 'pdfjs'),
//     save(blob, name) → Promise<string mô tả nơi lưu>, share?(blob, name) → Promise, toast(msg, isError), camera: bool }
// Trang đang làm dở KHÔNG lưu lại khi đóng app (ảnh có thể nặng) — window.__klaBusy báo cho trang chính đừng tự nhả module.
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
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>', plus: '<path d="M12 5v14M5 12h14"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC[k] + '</svg>'; };

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
    var st = { pages: [], cur: 0, dirty: false, busy: false, name: defaultName() };
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
      '</div></div>' +
      '<input type="file" id="scCam" accept="image/*" capture="environment" hidden>' +
      '<input type="file" id="scImg" accept="image/*" multiple hidden>' +
      '<input type="file" id="scPdf" accept="application/pdf,.pdf" multiple hidden>' +
      '<div class="sc-empty" id="scEmpty">' +
        '<div class="sc-drop">' + svg('pdf') + '<b>Chưa có trang nào</b>' +
        '<p>' + (phone ? 'Bấm <b>Chụp</b> để chụp phiếu / chứng từ / trang vở, hoặc chọn ảnh, file PDF có sẵn. App tự tìm 4 cạnh trang giấy, bỏ bàn và nền đen, khử bóng và làm trắng nền.' : 'Kéo thả ảnh / PDF vào đây, dán ảnh bằng <kbd>Ctrl</kbd>+<kbd>V</kbd>, hoặc dùng các nút ở trên.') + '</p>' +
        '<p class="sc-note">Ảnh được xử lý ngay trên máy, không gửi đi đâu. Nhiều ảnh = nhiều trang trong cùng 1 file PDF.</p></div>' +
        '<div class="sc-hist" id="scHist"></div></div>' +
      '<div class="sc-work" id="scWork" hidden>' +
        '<div class="sc-stage"><div class="sc-cvwrap"><canvas class="sc-cv" id="scCv"></canvas><div class="sc-pageno" id="scPageNo"></div></div>' +
          '<div class="sc-tools">' +
            '<button type="button" class="sc-ic" data-act="prev" title="Xem trang trước (←)" aria-label="Xem trang trước">' + svg('left') + '</button>' +
            '<span class="sc-sep"></span>' +
            '<button type="button" class="sc-ic" data-act="rot-l" title="Xoay trái" aria-label="Xoay trái">' + svg('rl') + '</button>' +
            '<button type="button" class="sc-ic" data-act="rot-r" title="Xoay phải (R)" aria-label="Xoay phải">' + svg('rr') + '</button>' +
            '<button type="button" class="sc-ic" data-act="cmp" title="Giữ để xem ảnh gốc" aria-label="Giữ để xem ảnh gốc">' + svg('eye') + '</button>' +
            '<button type="button" class="sc-ic" data-act="crop" title="Chỉnh 4 góc trang giấy" aria-label="Chỉnh 4 góc trang giấy">' + svg('crop') + '</button>' +
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
          '<div class="sc-sec sc-out"><div class="sc-lb">Lưu file</div>' +
            '<label class="sc-fld"><span>Tên file</span><input type="text" id="scName" maxlength="80" spellcheck="false"></label>' +
            '<div class="sc-seg sc-seg-sm" id="scFmt"><button type="button" data-fmt="a4">Khổ A4</button><button type="button" data-fmt="fit">Theo ảnh</button></div>' +
            '<button type="button" class="sc-btn sc-pri sc-wide" data-act="save-pdf">' + svg('save') + '<span id="scSaveTxt">Lưu PDF</span></button>' +
            (host.share ? '<button type="button" class="sc-btn sc-wide" data-act="share-pdf">' + svg('share') + '<span>Chia sẻ PDF (Zalo, Email…)</span></button>' : '') +
            '<div class="sc-row"><button type="button" class="sc-link" data-act="save-jpg">Lưu trang này thành ảnh JPG</button><button type="button" class="sc-link sc-danger" data-act="clear">Tài liệu mới</button></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sc-crop" id="scCropUi" hidden></div>' +
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
    function addCanvas(c, noDetect) {
      return S.toBlob(c, 'image/jpeg', 0.92).then(function (blob) {
        var q = noDetect ? null : detect(c); // ảnh chụp / ảnh chọn: tự tìm 4 cạnh trang giấy; trang PDF: giữ nguyên
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
          return S.pdfToCanvases(f, function () { return host.ensure('pdfjs'); }, function (k, n) { setBusy(true, 'Đang đọc PDF trang ' + k + '/' + n + tag); })
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
    function drawPreview(now) {
      clearTimeout(drawTimer);
      var go = function () {
        var pg = curPage(); if (!pg) return;
        var tok = ++drawTok;
        getSource(pg).then(function (src) {
          if (tok !== drawTok) return;
          var out = S.process(src, popt(pg, { mode: showOrig ? 'tuy' : pg.mode, p: showOrig ? { kieu: 'goc' } : pg.p, quad: showOrig ? null : (pg.cropOn ? pg.quad : null), maxSide: PREVIEW }));
          cv.width = out.width; cv.height = out.height; cv.getContext('2d').drawImage(out, 0, 0);
          out.width = out.height = 1;
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
      $('scSaveTxt').textContent = 'Lưu PDF (' + st.pages.length + ' trang)';
      var n = st.pages.length;
      root.querySelector('[data-act="prev"]').disabled = st.cur <= 0;
      root.querySelector('[data-act="next"]').disabled = st.cur >= n - 1;
      root.querySelector('[data-act="mv-l"]').disabled = st.cur <= 0;
      root.querySelector('[data-act="mv-r"]').disabled = st.cur >= n - 1;
    }
    function renderHist() {
      var h = lsGet(LS_HIST, []);
      $('scHist').innerHTML = h.length ? '<div class="sc-lb">Đã lưu gần đây</div><ul>' + h.map(function (x) {
        return '<li><b>' + esc(x.ten) + '</b><span>' + esc(x.trang) + ' trang · ' + esc(x.kb) + ' · ' + esc(x.luc) + '</span>' + (x.noi ? '<small>' + esc(x.noi) + '</small>' : '') + '</li>';
      }).join('') + '</ul><button type="button" class="sc-link" data-act="clear-hist">Xóa danh sách</button>' : '';
    }
    function renderAll() {
      var has = st.pages.length > 0;
      $('scEmpty').hidden = has; $('scWork').hidden = !has;
      if (!has) { renderHist(); return; }
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
          st.dirty = false; remember(f, viaShare ? 'Đã chia sẻ' : (typeof noi === 'string' ? noi : ''));
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
    function clearAll(ask) {
      if (ask && st.dirty && !global.confirm('Bỏ ' + st.pages.length + ' trang đang làm (chưa lưu PDF)?')) return;
      st.pages.forEach(function (pg) { if (pg.thumb) URL.revokeObjectURL(pg.thumb); });
      cache.forEach(function (c) { c.width = c.height = 1; }); cache.clear();
      st.pages = []; st.cur = 0; st.dirty = false; st.name = defaultName(); $('scName').value = st.name;
      renderAll();
    }

    // ---- sự kiện
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-mode],[data-kieu],[data-fmt],[data-pg]'); if (!t || t.disabled || st.busy) return;
      if (t.dataset.mode) return setMode(t.dataset.mode);
      if (t.dataset.kieu) return setParam('kieu', t.dataset.kieu);
      if (t.dataset.fmt) { def.format = t.dataset.fmt; lsSet(LS_DEF, def); return renderPanel(); }
      if (t.dataset.pg != null) { st.cur = +t.dataset.pg; renderStrip(); renderPanel(); return drawPreview(true); }
      var pg = curPage(), a = t.dataset.act, i = st.cur;
      if (a === 'pick-cam') return $('scCam').click();
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
        st.dirty = true; toast('Đã áp dụng cho ' + st.pages.length + ' trang.');
        var j = 0; (function nx() { if (j >= st.pages.length) return renderStrip(); makeThumb(st.pages[j++]).then(nx); })();
      }
      else if (a === 'reset') { if (pg.mode === 'tuy') def.pTuy = null; setMode(pg.mode); }
      else if (a === 'save-pdf') savePdf(false);
      else if (a === 'share-pdf') savePdf(true);
      else if (a === 'save-jpg') saveJpg();
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
    $('scName').addEventListener('change', function () { exportName(); });

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
        var map = { ArrowLeft: 'prev', ArrowRight: 'next', r: 'rot-r', R: 'rot-r', Delete: 'del' }, a = map[e.key]; if (!a) return;
        var b = root.querySelector('[data-act="' + a + '"]'); if (b && !b.disabled) { e.preventDefault(); b.click(); }
      });
    }

    renderAll();
    return { addFiles: addFiles, clear: function () { clearAll(false); }, pages: function () { return st.pages.length; } };
  }

  global.KLScanUI = { mount: mount };
})(window);
