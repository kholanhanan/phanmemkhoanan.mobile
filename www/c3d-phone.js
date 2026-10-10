/* "XẾP CONT 3D" TRÊN ĐIỆN THOẠI (bản 4.13) — bản rút gọn của module Container Loading 3D trên PC (html/container-3d.html).
   • Tự chạy trên máy (không cần mạng, không gửi gì lên Web App): cont / hàng / phương án lưu trong localStorage.
   • Dùng CHUNG lõi với PC: c3d-engine.js (thuật toán) + c3d-view.js (Three.js) là BẢN CHÉP của app/html/js/ — sửa bên PC thì chép sang đây (xem CLAUDE.md).
   • Thư viện nặng (three.min.js ~600 KB) CHỈ nạp lần đầu mở tab này → không làm chậm lúc mở app.
   • Bố cục: khung 3D + bảng điều khiển. Điện thoại ĐỨNG: 3D phía trên, bảng bên dưới. Điện thoại NGANG: 3D bên trái (to), bảng bên phải, tự ẩn thanh trên/dưới (nút ⛶ bật/tắt). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = 'klanan.c3d.v1', LSP = 'klanan.c3d.plans.v1', LSPC = 'klanan.c3d.pc.v1'; // LSPC = cont + phương án PC đã đẩy (chỉ xem / mở)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const PAL = ['#3b82f6', '#f97316', '#22c55e', '#e11d48', '#a855f7', '#eab308', '#06b6d4', '#84cc16', '#ec4899', '#14b8a6', '#f43f5e', '#8b5cf6'];
  const TYPES = [['20RF', "20' RF"], ['40RF', "40' RF"], ['40HC', "40' HC RF"], ['KHAC', 'Khác']];
  const CK = ['L', 'W', 'H', 'doorW', 'doorH', 'redLine', 'clearFront', 'clearRear', 'clearSide'];
  let E = null, V = null, ready = null, S = null, calcT = 0, saveT = 0, lastMs = 0, skuSeq = 0;
  const toast = (t, err) => { if (window.KLShare && window.KLShare.toast) window.KLShare.toast(t, err); };

  // ------------------------------------------------------------------ nạp thư viện (lần đầu)
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src + '?v=4.15'; s.onload = res; s.onerror = () => rej(new Error('Không nạp được ' + src)); document.head.appendChild(s); });
  }
  function ensure() {
    if (!ready) ready = (async () => {
      for (const f of ['lib/three.min.js', 'lib/OrbitControls.js', 'c3d-engine.js', 'c3d-view.js']) await loadScript(f);
      E = window.C3DEngine; init();
    })().catch((e) => { ready = null; throw e; });
    return ready;
  }

  // ------------------------------------------------------------------ dữ liệu
  function loadLS(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function schedSave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify({ unit: S.unit, cid: S.cid, cont: S.cont, saved: S.saved, skus: S.skus, colors: S.colors, opts: S.opts })); } catch (e) { /* đầy bộ nhớ: bỏ qua */ } }, 700); }
  const u = () => (S.unit === 'cm' ? 10 : 1), toU = (mm) => String(Math.round(mm / u() * 100) / 100), fromU = (s) => E.num(s) * u();
  const unj = (s) => { try { return JSON.parse(String(s || '').replace(/^__JSON__/, '')); } catch (e) { return null; } };
  const pcData = () => loadLS(LSPC, { at: '', conts: [], plans: [] });
  function contList() {
    const ov = {}, pcv = {}; pcData().conts.forEach((c) => { pcv[c.id] = c.v; }); S.saved.forEach((c) => { ov[c.id] = c.v; });
    const out = E.PRESETS.map((p) => Object.assign({}, p, pcv[p.id] || {}, ov[p.id] || {}, { id: p.id, builtin: true, edited: !!(ov[p.id] || pcv[p.id]), fromPc: !!pcv[p.id] && !ov[p.id] }));
    const seen = new Set(E.PRESETS.map((p) => p.id));
    S.saved.filter((c) => !seen.has(c.id)).forEach((c) => { seen.add(c.id); out.push(Object.assign({}, c.v, { id: c.id, builtin: false })); });
    pcData().conts.filter((c) => !seen.has(c.id)).forEach((c) => { seen.add(c.id); out.push(Object.assign({}, c.v, { id: c.id, builtin: false, fromPc: true })); });
    return out;
  }
  // Tải cont + phương án mà PC đã đẩy lên (tab C3D_Data) — cần Web App bản mới (lệnh c3dData) và quyền M14.
  async function pullPc(manual) {
    const K = window.KLShare; if (!K || !K.cfgOk || !K.cfgOk()) { if (manual) toast('Chưa cài đặt kết nối với PC (Cài đặt).', true); return false; }
    try {
      const r = await K.api('c3dData'), h = r.headers || [], ix = (n) => h.indexOf(n), rows = r.rows || [], g = (row, n) => (ix(n) < 0 ? '' : row[ix(n)]);
      const conts = [], plans = [];
      rows.forEach((row) => { const d = unj(g(row, 'data')); if (!d) return; const id = String(g(row, 'id')); if (g(row, 'kind') === 'cont') conts.push({ id, v: d }); else if (g(row, 'kind') === 'plan') plans.push({ id, name: String(g(row, 'name')), at: String(g(row, 'capNhat')), contName: String(g(row, 'contName')), loaded: +g(row, 'loaded') || 0, requested: +g(row, 'requested') || 0, data: d }); });
      localStorage.setItem(LSPC, JSON.stringify({ at: new Date().toISOString(), conts, plans }));
      if (manual) toast('Đã tải từ PC: ' + conts.length + ' cont, ' + plans.length + ' phương án.');
      if (S && S.tab === 'cont') renderPane(); return true;
    } catch (e) { if (manual) toast(/Không có chức năng/.test(e.message) ? 'Web App chưa cập nhật (cần dán lại Code.gs trên PC).' : e.message, true); return false; }
  }
  function pick(id) { const c = contList().find((x) => x.id === id) || contList()[2]; S.cid = c.id; S.cont = clone(c); delete S.cont.builtin; delete S.cont.edited; delete S.cont.fromPc; }
  const newSku = (o) => Object.assign({ id: 's' + Date.now().toString(36) + (skuSeq++), code: '', name: '', size: '', date: '', qty: 100, L: 520, W: 280, H: 190, kg: 10, allowRotate: true, allowStand: true, allowLay: false, sole: false, maxLayers: 0, orient: '', note: '' }, o || {});
  function colorFor(code) { const k = String(code || '').trim() || '(trống)'; if (S.colors[k]) return S.colors[k]; const used = new Set(Object.values(S.colors)), free = PAL.find((c) => !used.has(c)); S.colors[k] = free || PAL[Object.keys(S.colors).length % PAL.length]; return S.colors[k]; }
  function shade(hex, d) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const n = parseInt(m[1], 16); const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { const dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h /= 6; }
    l = Math.min(0.82, Math.max(0.22, l + d));
    const q = (p, qq, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (qq - p) * 6 * t; if (t < 1 / 2) return qq; if (t < 2 / 3) return p + (qq - p) * (2 / 3 - t) * 6; return p; };
    let R, G, B; if (s === 0) R = G = B = l; else { const qq = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - qq; R = q(p, qq, h + 1 / 3); G = q(p, qq, h); B = q(p, qq, h - 1 / 3); }
    const x = (v) => ('0' + Math.round(v * 255).toString(16)).slice(-2); return '#' + x(R) + x(G) + x(B);
  }
  function groupColors(plan) { const seen = {}, VAR = [0, 0.1, -0.1, 0.18, -0.16]; return plan.groups.map((g) => { const k = String(g.sku.code || '').trim() || '(trống)'; seen[k] = seen[k] || 0; const v = VAR[seen[k] % VAR.length]; seen[k]++; return shade(colorFor(k), v); }); }
  const ONAME = { L: 'Dài', W: 'Rộng', H: 'Cao' };
  const oriLabel = (p) => ONAME[p[0]] + ' dọc cont · ' + ONAME[p[1]] + ' ngang · ' + ONAME[p[2]] + ' đứng';
  const oriOpts = (cur) => '<option value=""' + (!cur ? ' selected' : '') + '>Tự động (hệ thống chọn)</option>' + E.PERMS.map((p) => '<option value="' + p + '"' + (cur === p ? ' selected' : '') + '>' + oriLabel(p) + '</option>').join('');
  const permOfBox = (b, k) => { const m = { L: k.L, W: k.W, H: k.H }; return E.PERMS.find((p) => Math.abs(m[p[0]] - b.dx) < 0.01 && Math.abs(m[p[1]] - b.dy) < 0.01 && Math.abs(m[p[2]] - b.dz) < 0.01) || ''; };

  // ------------------------------------------------------------------ khởi tạo giao diện (1 lần)
  function init() {
    const st = loadLS(LS, null) || {};
    S = { unit: st.unit || 'mm', cid: st.cid || 'rf40hc', cont: st.cont || null, saved: st.saved || [], skus: st.skus || [], colors: st.colors || {}, opts: Object.assign({ mergeTail: false, stackTop: true, sampleQty: 10, dateDir: 'asc', sortMode: 'auto' }, st.opts || {}),
      plan: null, tab: 'hang', open: new Set(), hidden: { tiers: new Set(), groups: new Set(), rows: new Set() }, seqMax: null, playing: 0, full: false, viewName: 'iso', gcolors: [] };
    if (!S.cont || !(S.cont.L > 0)) pick(S.cid);
    const root = $('c3dRoot');
    root.innerHTML = '<div class="c3-stage" id="c3dStage"><div class="c3-vp" id="c3dVp"></div>' +
      '<div class="c3-top" id="c3dTop"><div class="c3-views" id="c3dViews"><button type="button" class="on" data-view="iso">3D</button><button type="button" data-view="top">Trên</button><button type="button" data-view="side">Ngang</button><button type="button" data-view="door">Cửa</button></div>' +
      '<button type="button" class="c3-ib" id="c3dFull" aria-label="Toàn màn hình">⛶</button></div>' +
      '<div class="c3-seq" id="c3dSeq"></div><div class="c3-sel" id="c3dSel" hidden></div></div>' +
      '<div class="c3-pane" id="c3dPane"><div class="c3-ptabs" id="c3dPTabs"><button type="button" data-pt="cont">Cont</button><button type="button" data-pt="hang" class="on">Hàng</button><button type="button" data-pt="kq">Kết quả</button><button type="button" data-pt="xem">Xem</button></div>' +
      '<div class="c3-stat" id="c3dStat"></div><div class="c3-pbody" id="c3dPBody"></div></div>';
    V = window.C3DView.create($('c3dVp'));
    V.opt.glabels = false; V.opt.rowlabels = false; V.opt.walls = { right: true, left: false, ceil: false, front: false };
    V.setHover = function () { /* cảm ứng: không có rê chuột */ };
    V.onPick = onPick; V.onWalls = () => { if (S.tab === 'xem') renderPane(); };
    const light = () => document.documentElement.getAttribute('data-theme') !== 'dark'; V.setLight(light());
    new MutationObserver(() => V.setLight(light())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    $('c3dViews').onclick = (e) => { const b = e.target.closest('[data-view]'); if (!b) return; S.viewName = b.dataset.view; document.querySelectorAll('#c3dViews button').forEach((x) => x.classList.toggle('on', x === b)); V.setPreset(S.viewName); };
    $('c3dFull').onclick = () => { S.full = !S.full; setTimeout(() => layout(true), 50); };
    $('c3dPTabs').onclick = (e) => { const b = e.target.closest('[data-pt]'); if (!b) return; S.tab = b.dataset.pt; document.querySelectorAll('#c3dPTabs button').forEach((x) => x.classList.toggle('on', x === b)); renderPane(); $('c3dPBody').scrollTop = 0; };
    const pb = $('c3dPBody'); pb.addEventListener('input', onInput); pb.addEventListener('change', onChange); pb.addEventListener('click', onClick);
    $('c3dSeq').onclick = onSeqClick; $('c3dSeq').oninput = (e) => { if (e.target.id === 'c3Range') { stopPlay(); setSeq(+e.target.value); } };
    const mq = window.matchMedia('(orientation: landscape)'); const onOri = () => { S.full = mq.matches; setTimeout(() => layout(true), 80); };
    if (mq.addEventListener) mq.addEventListener('change', onOri); else if (mq.addListener) mq.addListener(onOri);
    window.addEventListener('resize', () => { if (!$('view-c3d').hidden) layout(); });
    S.full = mq.matches; S.needFit = true; renderPane(); calc();
    const pc0 = pcData(); if (!pc0.at || Date.now() - new Date(pc0.at).getTime() > 30 * 60 * 1000) pullPc(false); // lặng lẽ lấy cont / phương án mới từ PC (nếu có kết nối + quyền)
  }

  // ------------------------------------------------------------------ bố cục (đứng / ngang)
  function layout(refit) {
    const root = $('c3dRoot'); if (!root) return; const full = !!S && S.full && !$('view-c3d').hidden;
    document.body.classList.toggle('c3d-full', full);
    const tb = document.querySelector('.topbar'), nav = document.querySelector('.tabbar');
    root.style.top = full ? '0px' : (tb ? tb.offsetHeight : 0) + 'px'; root.style.bottom = full ? '0px' : (nav ? nav.offsetHeight : 0) + 'px';
    root.classList.toggle('is-full', full); const f = $('c3dFull'); if (f) f.textContent = full ? '✕' : '⛶';
    if (V) { V.resize(); if (refit || S.needFit) { S.needFit = false; V.setPreset(S.viewName, true); } }
  }
  function show() {
    ensure().then(() => { $('c3dRoot').hidden = false; layout(); if (V) V.invalidate(); }).catch((e) => { $('c3dRoot').innerHTML = '<p class="c3-err">Không mở được Xếp cont 3D: ' + esc(e.message) + '<br>Kiểm tra bản app đã cập nhật đủ file (lib/three.min.js).</p>'; $('c3dRoot').hidden = false; });
    const r = $('c3dRoot'); const tb = document.querySelector('.topbar'), nav = document.querySelector('.tabbar'); r.style.top = (tb ? tb.offsetHeight : 0) + 'px'; r.style.bottom = (nav ? nav.offsetHeight : 0) + 'px';
  }
  function hide() { document.body.classList.remove('c3d-full'); stopPlay(); }

  // ------------------------------------------------------------------ bảng điều khiển
  const fld = (label, attrs, val, cls) => '<label class="c3-f ' + (cls || '') + '"><span>' + label + '</span><input type="text" inputmode="decimal" autocomplete="off" ' + attrs + ' value="' + esc(val) + '"></label>';
  function renderPane() {
    const b = $('c3dPBody'); if (!b || !S) return;
    b.innerHTML = { cont: paneCont, hang: paneHang, kq: paneKq, xem: paneXem }[S.tab]();
  }
  function paneCont() {
    const c = S.cont, lst = contList(), uu = S.unit, cur = lst.find((x) => x.id === S.cid);
    const red = c.redLine > 0 ? c.redLine : c.H, eff = Math.min(c.H, red, c.doorH > 0 ? c.doorH : c.H);
    return '<div class="c3-sec"><label class="c3-f"><span>Chọn container</span><select id="c3Sel">' + lst.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === S.cid ? ' selected' : '') + '>' + esc((x.fromPc ? '☁ ' : x.builtin ? '' : '★ ') + x.name + (x.fromPc ? ' (từ PC)' : x.edited ? ' (đã sửa)' : '')) + '</option>').join('') + '</select></label>' +
      '<div class="c3-g2"><label class="c3-f"><span>Đơn vị dài</span><select id="c3Unit"><option value="mm"' + (uu === 'mm' ? ' selected' : '') + '>mm</option><option value="cm"' + (uu === 'cm' ? ' selected' : '') + '>cm</option></select></label>' +
      '<label class="c3-f"><span>Loại</span><select data-c="type">' + TYPES.map((t) => '<option value="' + t[0] + '"' + (c.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></label></div>' +
      '<label class="c3-f"><span>Tên container</span><input type="text" data-c="name" value="' + esc(c.name) + '"></label>' +
      '<div class="c3-g3">' + fld('Dài trong (' + uu + ')', 'data-c="L"', toU(c.L)) + fld('Rộng trong', 'data-c="W"', toU(c.W)) + fld('Cao trong', 'data-c="H"', toU(c.H)) + fld('Rộng cửa', 'data-c="doorW"', toU(c.doorW)) + fld('Cao cửa', 'data-c="doorH"', toU(c.doorH)) + fld('Tải trọng (kg)', 'data-c="maxPayload"', String(c.maxPayload || '')) + '</div>' +
      fld('Red line — cao tối đa xếp (' + uu + ')', 'data-c="redLine"', toU(c.redLine)) +
      '<div class="c3-g3">' + fld('Khe vách đầu', 'data-c="clearFront"', toU(c.clearFront)) + fld('Khe cửa', 'data-c="clearRear"', toU(c.clearRear)) + fld('Khe hai bên', 'data-c="clearSide"', toU(c.clearSide)) + '</div>' +
      '<p class="c3-note">Thể tích trong <b>' + fmt(c.L * c.W * c.H / 1e9, 2) + ' m³</b> · cao xếp tối đa <b>' + fmt(eff / 1000, 2) + ' m</b> (nhỏ nhất của red line / cao cửa / cao trong). Thông số mẫu chỉ tham khảo — nhập theo cont thực tế.</p>' +
      '<div class="c3-btns"><button type="button" class="c3-b" data-act="cSave">Lưu thay đổi</button><button type="button" class="c3-b" data-act="cNew">Lưu thành cont mới</button><button type="button" class="c3-b dng" data-act="cDel">' + (cur && cur.builtin ? 'Khôi phục mẫu' : 'Xóa cont') + '</button></div></div>';
  }
  function skuCard(k, i) {
    const col = colorFor(k.code), a = 'data-s="' + esc(k.id) + '"', open = S.open.has(k.id), uu = S.unit;
    const head = '<button type="button" class="c3-sh" ' + a + ' data-act="sTog"><i style="background:' + col + '"></i><b>#' + (i + 1) + ' ' + esc(k.code || '(chưa có mã)') + '</b><span>' + esc(k.size || '') + (k.date ? ' · ' + esc(k.date) : '') + '</span><em>' + fmt(k.qty) + ' thùng</em><u>' + (open ? '▾' : '▸') + '</u></button>';
    if (!open) return '<div class="c3-sku">' + head + '</div>';
    const chk = (key, label) => '<label class="c3-chk"><input type="checkbox" ' + a + ' data-f="' + key + '"' + (k[key] ? ' checked' : '') + (k.orient && ['allowRotate', 'allowStand', 'allowLay'].includes(key) ? ' disabled' : '') + '> ' + label + '</label>';
    return '<div class="c3-sku open" style="--sk:' + col + '">' + head + '<div class="c3-sb">' +
      '<div class="c3-g2"><label class="c3-f"><span>Mã hàng</span><input type="text" ' + a + ' data-f="code" value="' + esc(k.code) + '"></label>' + fld('SL thùng', a + ' data-f="qty"', k.qty) +
      '<label class="c3-f"><span>Size</span><input type="text" ' + a + ' data-f="size" value="' + esc(k.size) + '" placeholder="31/40"></label><label class="c3-f"><span>Date</span><input type="text" ' + a + ' data-f="date" value="' + esc(k.date) + '" placeholder="dd/mm/yyyy"></label></div>' +
      '<div class="c3-g3">' + fld('Dài (' + uu + ')', a + ' data-f="L" data-len="1"', toU(k.L)) + fld('Rộng', a + ' data-f="W" data-len="1"', toU(k.W)) + fld('Cao', a + ' data-f="H" data-len="1"', toU(k.H)) + '</div>' +
      '<div class="c3-g2">' + fld('kg / thùng', a + ' data-f="kg"', k.kg) + fld('Chồng tối đa (tầng, 0 = không giới hạn)', a + ' data-f="maxLayers"', k.maxLayers || 0) + '</div>' +
      '<label class="c3-f"><span>Hướng đặt thùng (tự xoay cho khớp thực tế)</span><select ' + a + ' data-f="orient">' + oriOpts(k.orient) + '</select></label>' +
      '<div class="c3-flags">' + chk('allowRotate', 'Cho xoay') + chk('allowStand', 'Dựng đứng') + chk('allowLay', 'Đặt nằm') + chk('sole', 'Xếp sole') + '</div>' +
      '<label class="c3-f"><span>Ghi chú đóng hàng</span><input type="text" ' + a + ' data-f="note" value="' + esc(k.note) + '"></label>' +
      '<div class="c3-btns"><button type="button" class="c3-b" ' + a + ' data-act="sDup">Nhân bản</button><button type="button" class="c3-b dng" ' + a + ' data-act="sDel">Xóa dòng</button></div></div></div>';
  }
  function paneHang() {
    const o = S.opts;
    return '<div class="c3-btns top"><button type="button" class="c3-b pri" data-act="sAdd">+ Thêm mặt hàng</button><button type="button" class="c3-b" data-act="sDemo">Ví dụ mẫu</button><button type="button" class="c3-b" data-act="pOpen">Phương án đã lưu / từ PC</button><button type="button" class="c3-b dng" data-act="sClear">Xóa hết</button></div>' +
      (S.skus.length ? S.skus.map(skuCard).join('') : '<div class="c3-empty">Chưa có mặt hàng. Bấm “+ Thêm mặt hàng” hoặc “Ví dụ mẫu”.</div>') +
      '<details class="c3-opt"' + (S.skus.length ? '' : ' open') + '><summary>Cách xếp & hàng mẫu hải quan</summary><div class="c3-sec">' +
      '<label class="c3-chk big"><input type="checkbox" id="c3Merge"' + (o.mergeTail ? ' checked' : '') + '> Ghép lấp chỗ trống cạnh vách cuối (tiết kiệm chỗ)</label>' +
      '<label class="c3-chk big"><input type="checkbox" id="c3Auto"' + (o.autoLayout !== false ? ' checked' : '') + '> Tự sắp xếp hợp lý khi trống một bên (so le trái/phải, ưu tiên thoáng khí)</label>' +
      '<label class="c3-chk big"><input type="checkbox" id="c3Stack"' + (o.stackTop !== false ? ' checked' : '') + '> Cho mặt hàng sau chồng lên khoảng trống phía trên mặt hàng trước</label>' +
      fld('Hàng mẫu hải quan (thùng / mỗi loại, 0 = tắt)', 'id="c3Samp"', o.sampleQty == null ? 10 : o.sampleQty) +
      '<div class="c3-g2"><label class="c3-f"><span>Thứ tự đóng</span><select id="c3Sort"><option value="auto"' + (o.sortMode !== 'manual' ? ' selected' : '') + '>Mặt hàng › Size › Ngày</option><option value="manual"' + (o.sortMode === 'manual' ? ' selected' : '') + '>Đúng thứ tự nhập</option></select></label>' +
      '<label class="c3-f"><span>Ngày</span><select id="c3Date"><option value="asc"' + (o.dateDir !== 'desc' ? ' selected' : '') + '>Cũ vào trong</option><option value="desc"' + (o.dateDir === 'desc' ? ' selected' : '') + '>Mới vào trong</option></select></label></div></div></details>';
  }
  function paneKq() {
    const p = S.plan; if (!p || !p.totals.requested) return '<div class="c3-empty">Chưa có hàng để xếp. Thêm mặt hàng ở tab “Hàng”.</div>';
    const t = p.totals, pay = t.payload > 0 ? t.kg / t.payload * 100 : 0;
    const kp = (k, v, s, cls) => '<div class="c3-kpi ' + (cls || '') + '"><small>' + k + '</small><b>' + v + '</b>' + (s ? '<em>' + s + '</em>' : '') + '</div>';
    let h = '<div class="c3-kpis">' + kp('Đã xếp / yêu cầu', fmt(t.loaded) + ' / ' + fmt(t.requested), 'thùng', t.left ? '' : 'ok') + kp('Rớt lại kho', fmt(t.left), t.left ? 'thùng không đóng được' : 'đủ hàng', t.left ? 'bad' : 'ok') +
      kp('Khối lượng', fmt(t.kg, 0) + ' kg', t.payload > 0 ? fmt(pay, 1) + '% tải trọng' : '') + kp('Lấp đầy', fmt(t.fillUsablePct, 1) + '%', 'vùng chứa hàng') + kp('Số dãy', fmt(t.rows), 'dài đã dùng ' + fmt(t.usedLength / 1000, 2) + ' m') + kp('Mẫu hải quan', fmt(t.sample), t.sample ? 'dãy sát cửa' : 'tắt') + '</div>';
    const msg = (cls, tx) => '<div class="c3-msg ' + cls + '">' + tx + '</div>';
    p.errors.forEach((m) => { h += msg('err', '⛔ ' + esc(m)); });
    if (p.layoutNote) h += msg('tip', '🌬 ' + esc(p.layoutNote));
    if (p.verify.ok && t.loaded) h += msg('ok', '✔ <b>Đã kiểm tra độc lập ' + fmt(t.loaded) + ' thùng</b>: không chồng, trong cont, dưới red line, đủ điểm đỡ, thứ tự đóng không bị chắn.');
    p.warnings.forEach((m) => { h += msg('warn', '⚠ ' + esc(m)); });
    if (t.left > 0) h += msg('err', '📦 <b>Rớt lại kho ' + fmt(t.left) + ' thùng</b>: ' + p.groups.filter((g) => g.left > 0).map((g) => esc((g.sku.code || 'Mặt hàng') + ' ' + (g.sku.size || '')) + ' ' + fmt(g.left)).join(' · '));
    if (p.rows.some((r) => r.sample)) h += msg('tip', '🛃 Dãy mẫu hải quan: ' + p.rows.filter((r) => r.sample).map((r) => 'Dãy ' + r.row).join(', ') + '.');
    if (p.compare && p.compare.ok && p.compare.delta > 0) h += msg('tip', '💡 Đổi sang “' + (p.compare.mergeTail ? 'Ghép lấp chỗ trống' : 'Tách riêng') + '” xếp thêm ' + fmt(p.compare.delta) + ' thùng.');
    h += p.groups.map((g, i) => {
      const rs = p.boxes.filter((b) => b.group === i).map((b) => b.row), rr = rs.length ? 'Dãy ' + Math.min(...rs) + (Math.max(...rs) > Math.min(...rs) ? '–' + Math.max(...rs) : '') : '—';
      return '<div class="c3-gc" style="--sk:' + ((S.gcolors || [])[i] || '#888') + '"><b>' + (i + 1) + '. ' + esc(g.sku.code || '(chưa có mã)') + '</b> <span>' + esc(g.sku.size || '') + (g.sku.date ? ' · ' + esc(g.sku.date) : '') + '</span>' +
        '<div class="c3-gn"><span>Yêu cầu <b>' + fmt(g.requested) + '</b></span><span>Đã xếp <b>' + fmt(g.loaded) + '</b></span><span class="' + (g.left ? 'lf' : '') + '">Rớt kho <b>' + fmt(g.left) + '</b></span><span>' + rr + '</span></div>' +
        '<small>' + ((g.patterns || []).map((x) => esc(x.text)).join('; ') || '—') + (g.sample ? ' · gồm ' + g.sample + ' mẫu HQ' : '') + (g.stackedOn ? ' · ' + g.stackedOn + ' chồng lên hàng trước' : '') + '</small>' +
        (g.sku.note ? '<small>📝 ' + esc(g.sku.note) + '</small>' : '') + ((g.reasons || []).length ? '<small class="why">' + g.reasons.map(esc).join(' ') + '</small>' : '') + '</div>';
    }).join('');
    return h + '<div class="c3-btns"><button type="button" class="c3-b pri" data-act="xXlsx">Xuất Excel</button><button type="button" class="c3-b" data-act="xPng">Lưu ảnh 3D</button><button type="button" class="c3-b" data-act="pSave">Lưu phương án</button><button type="button" class="c3-b" data-act="pOpen">Phương án đã lưu</button></div>';
  }
  function paneXem() {
    const p = S.plan, w = V ? V.opt.walls : {}, o = V ? V.opt : {};
    const tg = (a, label, on) => '<label class="c3-chk"><input type="checkbox" ' + a + (on ? ' checked' : '') + '> ' + label + '</label>';
    let h = '<div class="c3-sec"><b class="c3-h">Vách container</b><div class="c3-flags">' + tg('data-wall="right"', 'Phải', w.right) + tg('data-wall="left"', 'Trái', w.left) + tg('data-wall="ceil"', 'Trần', w.ceil) + tg('data-wall="front"', 'Đầu', w.front) + '</div>' +
      '<b class="c3-h">Hiển thị</b><div class="c3-flags">' + tg('data-opt="redline"', 'Red line', o.redline) + tg('data-opt="dims"', 'Kích thước', o.dims) + tg('data-opt="glabels"', 'Nhãn hàng', o.glabels) + tg('data-opt="rowlabels"', 'Số dãy', o.rowlabels) + tg('data-opt="usable"', 'Vùng chứa hàng', o.usable) + '</div></div>';
    if (!p || !p.boxes.length) return h + '<div class="c3-empty">Tính toán xong sẽ có danh sách lớp / dãy / mặt hàng để bật tắt.</div>';
    const cnt = {}; p.boxes.forEach((b) => { cnt[b.tier] = (cnt[b.tier] || 0) + 1; });
    const row = (a, on, label, n, dot) => '<label class="c3-ly"><input type="checkbox" ' + a + (on ? ' checked' : '') + '>' + (dot ? '<i style="background:' + dot + '"></i>' : '') + '<span>' + label + '</span><em>' + fmt(n) + '</em></label>';
    h += '<div class="c3-sec"><b class="c3-h">Mặt hàng <span><button type="button" class="c3-mini" data-lyall="g1">Tất cả</button><button type="button" class="c3-mini" data-lyall="g0">Ẩn hết</button></span></b>' +
      p.groups.map((g, i) => g.loaded ? row('data-grp="' + i + '"', !S.hidden.groups.has(i), esc((g.sku.code || 'Mặt hàng') + ' ' + (g.sku.size || '')), g.loaded, (S.gcolors || [])[i]) : '').join('') + '</div>';
    let ly = ''; for (let t = 1; t <= p.maxTier; t++) ly += row('data-tier="' + t + '"', !S.hidden.tiers.has(t), 'Lớp ' + t, cnt[t] || 0);
    h += '<div class="c3-sec"><b class="c3-h">Lớp (tầng) <span><button type="button" class="c3-mini" data-lyall="t1">Tất cả</button><button type="button" class="c3-mini" data-lyall="t0">Ẩn hết</button></span></b><div class="c3-cols">' + ly + '</div></div>';
    h += '<div class="c3-sec"><b class="c3-h">Dãy (vách → cửa) <span><button type="button" class="c3-mini" data-lyall="r1">Tất cả</button><button type="button" class="c3-mini" data-lyall="r0">Ẩn hết</button></span></b><div class="c3-cols">' +
      p.rows.map((r) => row('data-row="' + r.row + '"', !S.hidden.rows.has(r.row), 'Dãy ' + r.row + (r.sample ? ' 🛃' : ''), r.n)).join('') + '</div></div>';
    return h;
  }

  // ------------------------------------------------------------------ sự kiện bảng điều khiển
  function onInput(e) {
    const t = e.target;
    if (t.dataset.c) { const k = t.dataset.c; if (k === 'name' || k === 'type') S.cont[k] = t.value; else if (k === 'maxPayload') S.cont[k] = E.num(t.value); else S.cont[k] = fromU(t.value); sched(); return; }
    if (t.id === 'c3Samp') { S.opts.sampleQty = Math.max(0, Math.floor(E.num(t.value))); sched(); return; }
    if (t.dataset.s && t.dataset.f) {
      const k = S.skus.find((x) => x.id === t.dataset.s); if (!k) return; const f = t.dataset.f;
      if (t.type === 'checkbox') k[f] = t.checked; else if (f === 'orient') k[f] = t.value; else if (t.dataset.len) k[f] = fromU(t.value); else if (['qty', 'maxLayers'].includes(f)) k[f] = Math.max(0, Math.floor(E.num(t.value))); else if (f === 'kg') k[f] = E.num(t.value); else k[f] = t.value;
      if (f === 'orient' || t.type === 'checkbox') return; sched();
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'c3Sel') { pick(t.value); renderPane(); sched(0); schedSave(); return; }
    if (t.id === 'c3Unit') { S.unit = t.value; renderPane(); schedSave(); return; }
    if (t.id === 'c3Auto') { S.opts.autoLayout = t.checked; sched(0); return; }
    if (t.id === 'c3Merge') { S.opts.mergeTail = t.checked; sched(0); return; } if (t.id === 'c3Stack') { S.opts.stackTop = t.checked; sched(0); return; }
    if (t.id === 'c3Sort') { S.opts.sortMode = t.value; sched(0); return; } if (t.id === 'c3Date') { S.opts.dateDir = t.value; sched(0); return; }
    if (t.dataset.s && t.dataset.f === 'orient') { const k = S.skus.find((x) => x.id === t.dataset.s); if (k) { k.orient = t.value; renderPane(); sched(0); } return; }
    if (t.dataset.s && t.type === 'checkbox') { const k = S.skus.find((x) => x.id === t.dataset.s); if (k) { k[t.dataset.f] = t.checked; sched(0); } return; }
    if (t.dataset.wall) { V.setWall(t.dataset.wall, t.checked); return; } if (t.dataset.opt) { V.setOpt(t.dataset.opt, t.checked); return; }
    if (t.dataset.tier) { const n = +t.dataset.tier; if (t.checked) S.hidden.tiers.delete(n); else S.hidden.tiers.add(n); applyFilter(); return; }
    if (t.dataset.grp) { const n = +t.dataset.grp; if (t.checked) S.hidden.groups.delete(n); else S.hidden.groups.add(n); applyFilter(); return; }
    if (t.dataset.row) { const n = +t.dataset.row; if (t.checked) S.hidden.rows.delete(n); else S.hidden.rows.add(n); applyFilter(); return; }
    // chuẩn hoá số TẠI Ô (không vẽ lại cả bảng → không nuốt cú chạm vào nút kế tiếp)
    if (t.dataset.c && CK.includes(t.dataset.c)) t.value = toU(S.cont[t.dataset.c]);
    else if (t.dataset.s && t.dataset.len) { const k = S.skus.find((x) => x.id === t.dataset.s); if (k) t.value = toU(k[t.dataset.f]); }
  }
  function onClick(e) {
    const ly = e.target.closest('[data-lyall]');
    if (ly && S.plan) { const k = ly.dataset.lyall, p = S.plan;
      if (k[0] === 'r') { S.hidden.rows = new Set(); if (k === 'r0') p.rows.forEach((r) => S.hidden.rows.add(r.row)); }
      else if (k[0] === 't') { S.hidden.tiers = new Set(); if (k === 't0') for (let i = 1; i <= p.maxTier; i++) S.hidden.tiers.add(i); }
      else { S.hidden.groups = new Set(); if (k === 'g0') p.groups.forEach((g, i) => S.hidden.groups.add(i)); }
      renderPane(); applyFilter(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act, id = b.dataset.s;
    if (act === 'sTog') { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); renderPane(); }
    else if (act === 'sAdd') { const k = newSku(); S.skus.push(k); S.open = new Set([k.id]); renderPane(); sched(0); schedSave(); $('c3dPBody').scrollTop = 1e6; }
    else if (act === 'sDel') { S.skus = S.skus.filter((x) => x.id !== id); renderPane(); sched(0); schedSave(); }
    else if (act === 'sDup') { const i = S.skus.findIndex((x) => x.id === id); if (i >= 0) { const c = clone(S.skus[i]); c.id = newSku().id; S.skus.splice(i + 1, 0, c); S.open = new Set([c.id]); renderPane(); sched(0); schedSave(); } }
    else if (act === 'sClear') { if (!S.skus.length || confirm('Xóa toàn bộ danh sách hàng?')) { S.skus = []; renderPane(); sched(0); schedSave(); } }
    else if (act === 'sDemo') { if (S.skus.length && !confirm('Thay danh sách hiện tại bằng ví dụ mẫu?')) return; S.skus = demo(); S.open = new Set(); renderPane(); sched(0); schedSave(); }
    else if (act === 'cSave') saveCont(false); else if (act === 'cNew') saveCont(true); else if (act === 'cDel') delCont();
    else if (act === 'xXlsx') exportXlsx(); else if (act === 'xPng') exportPng(); else if (act === 'pSave') savePlan(); else if (act === 'pOpen') openPlans();
  }
  function demo() { const mk = (o) => newSku(Object.assign({ L: 520, W: 280, H: 190, kg: 10 }, o)); return [mk({ code: 'VRHLCK', size: '31/40', date: '15/09/2026', qty: 420 }), mk({ code: 'VRHLCK', size: '41/50', date: '20/09/2026', qty: 480 }), mk({ code: 'VRPDTO', size: '51/60', date: '18/09/2026', qty: 300, L: 600, W: 400, H: 220, kg: 12, sole: true, note: 'Xếp sole' })]; }
  function saveCont(asNew) {
    const c = clone(S.cont); if (!String(c.name || '').trim()) { toast('Nhập tên container.', true); return; }
    let id = S.cid; const cur = contList().find((x) => x.id === S.cid);
    if (asNew || !cur) { id = 'cx' + Date.now().toString(36); if (contList().some((x) => x.name === c.name)) c.name += ' (bản sao)'; }
    c.id = id; delete c.builtin; delete c.edited; delete c.fromPc; const i = S.saved.findIndex((x) => x.id === id); if (i >= 0) S.saved[i] = { id, v: c }; else S.saved.push({ id, v: c });
    S.cid = id; S.cont = clone(c); schedSave(); renderPane(); toast(asNew ? 'Đã lưu thành container mới.' : 'Đã lưu thay đổi.');
  }
  function delCont() {
    const cur = contList().find((x) => x.id === S.cid); if (!cur) return;
    if (cur.fromPc) { toast('Cont này do PC đẩy sang — sửa / xóa ở PC rồi bấm “Tải mới từ PC”.', true); return; }
    if (cur.builtin) { if (!cur.edited) { toast('Đây là thông số mẫu gốc.'); return; } if (!confirm('Khôi phục "' + cur.name + '" về mẫu gốc?')) return; } else if (!confirm('Xóa container "' + cur.name + '"?')) return;
    S.saved = S.saved.filter((x) => x.id !== S.cid); pick(cur.builtin ? cur.id : 'rf40hc'); schedSave(); renderPane(); sched(0);
  }

  // ------------------------------------------------------------------ tính toán
  function sched(d) { clearTimeout(calcT); calcT = setTimeout(calc, d == null ? 500 : d); schedSave(); }
  function calc() {
    clearTimeout(calcT); const t0 = performance.now();
    try { S.plan = E.solve({ container: S.cont, skus: S.skus }, S.opts); } catch (err) { console.error(err); toast('Lỗi tính toán: ' + err.message, true); return; }
    lastMs = Math.round(performance.now() - t0); S.hidden = { tiers: new Set(), groups: new Set(), rows: new Set() }; S.seqMax = null; stopPlay();
    S.gcolors = groupColors(S.plan); V.setPlan(S.plan, S.gcolors);
    const t = S.plan.totals; $('c3dStat').innerHTML = t.requested ? '<b>' + fmt(t.loaded) + '</b>/' + fmt(t.requested) + ' thùng · <span class="' + (t.left ? 'bad' : 'ok') + '">rớt kho ' + fmt(t.left) + '</span> · ' + fmt(t.kg, 0) + ' kg · ' + fmt(t.rows) + ' dãy' : 'Chưa có hàng';
    if (S.tab === 'kq' || S.tab === 'xem') { const sc = $('c3dPBody').scrollTop; renderPane(); $('c3dPBody').scrollTop = sc; }
    $('c3dSel').hidden = true; renderSeq();
  }
  function applyFilter() {
    const p = S.plan; if (!p) return; const tiers = new Set(), groups = new Set(), rows = new Set();
    for (let t = 1; t <= p.maxTier; t++) if (!S.hidden.tiers.has(t)) tiers.add(t); p.groups.forEach((g, i) => { if (!S.hidden.groups.has(i)) groups.add(i); }); p.rows.forEach((r) => { if (!S.hidden.rows.has(r.row)) rows.add(r.row); });
    V.setFilter({ tiers: S.hidden.tiers.size ? tiers : null, groups: S.hidden.groups.size ? groups : null, rows: S.hidden.rows.size ? rows : null, seqMax: S.seqMax });
  }
  function renderSeq() {
    const p = S.plan, el = $('c3dSeq'); if (!p || !p.boxes.length) { el.hidden = true; return; } el.hidden = false; const n = p.boxes.length, cur = S.seqMax == null ? n : S.seqMax;
    el.innerHTML = '<button type="button" class="c3-ib sm" data-seq="play" id="c3Play">' + (S.playing ? '⏸' : '▶') + '</button><input type="range" id="c3Range" min="0" max="' + n + '" value="' + cur + '"><span id="c3SeqLab">' + cur + '/' + n + '</span>';
  }
  function setSeq(v) { const n = S.plan ? S.plan.boxes.length : 0; v = Math.max(0, Math.min(n, Math.round(v))); S.seqMax = v >= n ? null : v; const r = $('c3Range'); if (r) r.value = v; const l = $('c3SeqLab'); if (l) l.textContent = v + '/' + n; applyFilter(); }
  function stopPlay() { if (S && S.playing) { clearInterval(S.playing); S.playing = 0; } const b = $('c3Play'); if (b) b.textContent = '▶'; }
  function onSeqClick(e) {
    const b = e.target.closest('[data-seq]'); if (!b || !S.plan) return; const n = S.plan.boxes.length;
    if (S.playing) { stopPlay(); return; } if ((S.seqMax == null ? n : S.seqMax) >= n) setSeq(0); const step = Math.max(1, Math.round(n / 150)); b.textContent = '⏸';
    S.playing = setInterval(() => { const c = S.seqMax == null ? n : S.seqMax; if (c >= n) { stopPlay(); return; } setSeq(c + step); }, 40);
  }

  // ------------------------------------------------------------------ chọn thùng
  function onPick(bi) {
    const el = $('c3dSel'); if (bi == null || !S.plan) { el.hidden = true; return; }
    const p = S.plan, b = p.boxes[bi], sk = p.groups[b.group].sku, sp = p.space, cur = sk.orient || permOfBox(b, sk);
    el.innerHTML = '<button type="button" class="c3-x" id="c3SelX">✕</button><b>#' + b.seq + ' · ' + esc(sk.code || 'Mặt hàng') + '</b> ' + esc(sk.size || '') + (sk.date ? ' · ' + esc(sk.date) : '') + '<br>Dãy <b>' + b.row + '</b>' + (p.rows[b.row - 1] && p.rows[b.row - 1].sample ? ' (mẫu HQ)' : '') + ' · Lớp <b>' + b.tier + '</b> · ' + Math.round(b.dx) + '×' + Math.round(b.dy) + '×' + Math.round(b.dz) + ' mm' +
      '<br><small>cách vách đầu ' + fmt((b.x - sp.x0) / 1000, 2) + ' m · cao ' + fmt(b.z / 1000, 2) + ' m</small><select id="c3SelOri">' + oriOpts(sk.orient) + '</select><button type="button" class="c3-b sm" id="c3SelRot">↻ Xoay 90° trên sàn</button>';
    el.hidden = false; $('c3SelX').onclick = () => V.select(null);
    const setOri = (v, msg) => { const k = S.skus.find((x) => x.id === sk.id); if (!k) return; k.orient = v; calc(); schedSave(); toast(msg); };
    $('c3SelOri').onchange = (e) => setOri(e.target.value, e.target.value ? 'Đã chốt: ' + oriLabel(e.target.value) : 'Về tự động.');
    $('c3SelRot').onclick = () => { const q = cur || 'LWH', np = q[1] + q[0] + q[2]; setOri(np, 'Đã xoay: ' + oriLabel(np)); };
  }

  // ------------------------------------------------------------------ phương án / xuất file
  function modal(html) { let m = $('c3dModal'); if (!m) { m = document.createElement('div'); m.id = 'c3dModal'; m.className = 'c3-modal'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; }); } m.innerHTML = '<div class="c3-dlg">' + html + '</div>'; m.hidden = false; return m; }
  function savePlan() {
    if (!S.plan || !S.plan.totals.requested) { toast('Chưa có phương án để lưu.', true); return; }
    const d = new Date(), def = (S.cont.name || 'Cont') + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    const m = modal('<h3>Lưu phương án</h3><label class="c3-f"><span>Tên phương án</span><input type="text" id="c3PName" value="' + esc(def) + '"></label><div class="c3-btns"><button type="button" class="c3-b" id="c3PNo">Hủy</button><button type="button" class="c3-b pri" id="c3POk">Lưu</button></div>');
    $('c3PNo').onclick = () => { m.hidden = true; };
    $('c3POk').onclick = () => { const list = loadLS(LSP, []); list.unshift({ id: 'pl' + Date.now().toString(36), name: $('c3PName').value.trim() || def, at: new Date().toISOString(), contName: S.cont.name, loaded: S.plan.totals.loaded, requested: S.plan.totals.requested, data: { cont: clone(S.cont), cid: S.cid, skus: clone(S.skus), opts: clone(S.opts), colors: clone(S.colors), unit: S.unit } }); try { localStorage.setItem(LSP, JSON.stringify(list.slice(0, 40))); toast('Đã lưu phương án.'); } catch (e) { toast('Không lưu được (đầy bộ nhớ).', true); } m.hidden = true; };
  }
  function openPlans() {
    const list = loadLS(LSP, []);
    const pcp = pcData();
    const m = modal('<h3>Phương án đã lưu</h3>' + (list.length ? list.map((p) => '<div class="c3-plan"><div><b>' + esc(p.name) + '</b><small>' + esc(p.contName) + ' · ' + fmt(p.loaded) + '/' + fmt(p.requested) + ' thùng</small></div><button type="button" class="c3-b sm pri" data-o="' + esc(p.id) + '">Mở</button><button type="button" class="c3-b sm dng" data-d="' + esc(p.id) + '">Xóa</button></div>').join('') : '<div class="c3-empty">Chưa có phương án nào trên máy.</div>') +
      '<h3 style="margin-top:14px">☁ Từ PC <small style="font-weight:500;color:var(--muted)">' + (pcp.at ? 'tải lúc ' + new Date(pcp.at).toLocaleString('vi-VN') : 'chưa tải') + '</small></h3>' + (pcp.plans.length ? pcp.plans.map((p) => '<div class="c3-plan"><div><b>' + esc(p.name) + '</b><small>' + esc(p.contName) + ' · ' + fmt(p.loaded) + '/' + fmt(p.requested) + ' thùng</small></div><button type="button" class="c3-b sm pri" data-op="' + esc(p.id) + '">Mở</button></div>').join('') : '<div class="c3-empty">PC chưa đẩy phương án nào (trên PC: Xếp cont 3D → Lưu phương án → Đẩy lên điện thoại).</div>') +
      '<div class="c3-btns"><button type="button" class="c3-b pri" id="c3PPull">⟳ Tải mới từ PC</button><button type="button" class="c3-b" id="c3PClose">Đóng</button></div>');
    $('c3PPull').onclick = async () => { $('c3PPull').disabled = true; await pullPc(true); openPlans(); };
    $('c3PClose').onclick = () => { m.hidden = true; };
    m.onclick = (e) => {
      if (e.target === m) { m.hidden = true; return; } const o = e.target.closest('[data-o]'), d = e.target.closest('[data-d]');
      const op = e.target.closest('[data-op]');
      if (o || op) { const p = o ? list.find((x) => x.id === o.dataset.o) : pcp.plans.find((x) => x.id === op.dataset.op); if (!p) return; const dt = p.data; S.unit = dt.unit || 'mm'; S.cid = dt.cid || S.cid; S.cont = dt.cont; S.skus = dt.skus || []; S.opts = Object.assign({ mergeTail: false, stackTop: true, sampleQty: 10, dateDir: 'asc', sortMode: 'auto' }, dt.opts || {}); S.colors = dt.colors || {}; S.open = new Set(); m.hidden = true; renderPane(); calc(); schedSave(); toast('Đã mở “' + p.name + '”.'); }
      else if (d) { if (!confirm('Xóa phương án này?')) return; const nl = list.filter((x) => x.id !== d.dataset.d); localStorage.setItem(LSP, JSON.stringify(nl)); openPlans(); }
    };
  }
  function fileDialog(file) {
    const m = modal('<h3>' + esc(file.name) + '</h3><div class="c3-btns col"><button type="button" class="c3-b pri" id="c3Save">💾 Lưu trên điện thoại</button><button type="button" class="c3-b pri" id="c3Share">📤 Gửi qua Zalo / Email / Drive…</button><button type="button" class="c3-b" id="c3Cl">Đóng</button></div><p class="c3-note" id="c3FMsg"></p>');
    $('c3Cl').onclick = () => { m.hidden = true; };
    $('c3Save').onclick = async () => { try { $('c3FMsg').textContent = 'Đã lưu: ' + await window.KLShare.saveToPhone(file); } catch (e) { $('c3FMsg').textContent = 'Không lưu được: ' + e.message; } };
    $('c3Share').onclick = async () => { try { await window.KLShare.shareFile(file); } catch (e) { $('c3FMsg').textContent = 'Không gửi được: ' + e.message; } };
  }
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
  const ymd = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  async function exportXlsx() {
    const p = S.plan; if (!p || !p.totals.requested) { toast('Chưa có phương án để xuất.', true); return; } if (!window.KLShare) { toast('Chưa hỗ trợ xuất file.', true); return; }
    toast('Đang tạo file Excel…');
    try {
      if (!window.ExcelJS) await loadScript('lib/exceljs.min.js'); const wb = new window.ExcelJS.Workbook(), c = p.container, t = p.totals, sp = p.space;
      const w1 = wb.addWorksheet('Tổng quan'); [['BÁO CÁO XẾP HÀNG CONTAINER'], ['Ngày', ymd()], ['Container', c.name], ['Kích thước trong D×R×C (mm)', c.L + ' × ' + c.W + ' × ' + c.H], ['Cửa R×C (mm)', c.doorW + ' × ' + c.doorH], ['Tải trọng cho phép (kg)', c.maxPayload], ['Red line (mm)', c.redLine || ''], ['Chiều cao xếp tối đa (mm)', sp.effH], [], ['Số thùng yêu cầu', t.requested], ['Số thùng đã xếp', t.loaded], ['RỚT LẠI KHO', t.left], ['Khối lượng (kg)', Math.round(t.kg * 100) / 100], ['Số dãy', t.rows], ['Thùng mẫu hải quan', t.sample], ['Kiểm tra độc lập', p.verify.ok ? 'ĐẠT' : 'CÓ LỖI'], [], ['CẢNH BÁO']].concat(p.warnings.concat(p.errors).map((m) => [m])).forEach((r) => w1.addRow(r)); w1.getColumn(1).width = 34; w1.getColumn(2).width = 46; w1.getRow(1).font = { bold: true, size: 14 };
      const w2 = wb.addWorksheet('Theo mặt hàng'); w2.addRow(['STT', 'Mã hàng', 'Size', 'Date', 'Yêu cầu', 'Đã xếp', 'Rớt kho', 'Mẫu HQ', 'Kiểu xếp', 'KG', 'Ghi chú', 'Lý do']).font = { bold: true };
      p.groups.forEach((g, i) => w2.addRow([i + 1, g.sku.code, g.sku.size, g.sku.date, g.requested, g.loaded, g.left, g.sample || 0, (g.patterns || []).map((x) => x.text).join(' | '), Math.round(g.kg * 100) / 100, g.sku.note, (g.reasons || []).join(' ')])); [6, 16, 10, 12, 10, 10, 10, 9, 44, 12, 28, 40].forEach((w, i) => { w2.getColumn(i + 1).width = w; });
      const w3 = wb.addWorksheet('Trình tự đóng'); w3.addRow(['STT đóng', 'Dãy', 'Loại', 'Mã hàng', 'Size', 'Date', 'Lớp', 'Cách vách đầu (mm)', 'Cách vách phải (mm)', 'Cao (mm)', 'Dài', 'Ngang', 'Cao']).font = { bold: true };
      p.boxes.forEach((b) => { const sk = p.groups[b.group].sku; w3.addRow([b.seq, b.row, b.sample ? 'Mẫu hải quan' : 'Hàng chính', sk.code, sk.size, sk.date, b.tier, Math.round(b.x - sp.x0), Math.round(b.y - sp.y0), Math.round(b.z), Math.round(b.dx), Math.round(b.dy), Math.round(b.dz)]); });
      const w4 = wb.addWorksheet('Theo dãy'); w4.addRow(['Dãy', 'Từ (mm)', 'Đến (mm)', 'Số thùng', 'Mẫu HQ']).font = { bold: true }; p.rows.forEach((r) => w4.addRow([r.row, Math.round(r.x0 - sp.x0), Math.round(r.x1 - sp.x0), r.n, r.sample ? 'Có' : '']));
      const buf = await wb.xlsx.writeBuffer(); fileDialog({ blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name: 'XepContainer_' + safe(c.name) + '_' + ymd() + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    } catch (e) { toast('Không tạo được Excel: ' + e.message, true); }
  }
  function exportPng() {
    if (!V || !window.KLShare) return; const url = V.screenshot(document.documentElement.getAttribute('data-theme') === 'dark' ? '#14161a' : '#eef6fd'), bin = atob(url.split(',')[1]), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    fileDialog({ blob: new Blob([arr], { type: 'image/png' }), name: 'Container3D_' + safe(S.cont.name) + '_' + ymd() + '.png', mime: 'image/png' });
  }

  window.C3DPhone = { show, hide, layout };
})();
