/* =====================================================================================================
   KHO LẠNH 1.0 — KHUNG ỨNG DỤNG (trang chính index.html)
   -----------------------------------------------------------------------------------------------------
   • Menu trái LUÔN hiện; mỗi module là 1 <iframe> trong vùng nội dung (#moduleNView / #moduleNFrame — giữ nguyên id cũ
     vì auth-gate.js, lan-status.js, main.js, global-search.js… tham chiếu). iframe chỉ nạp lần đầu mở (dataset.loaded),
     sau đó ẩn bằng display:none để giữ nguyên trạng thái khi quay lại.
   • Mọi module khai báo 1 lần trong MODS (mã M.., tên, nhóm màu, trang html). Hàm công khai giữ nguyên tên:
     showModule1…16, showModuleRaDong, showDoiChieu, showModuleSettings, showDashboard, filterModules.
   • Mã hiển thị = mã nội bộ = tiền tố tên file database (M01_…xlsx) — không còn "số menu" khác "số nội bộ".
   • auth-gate.js nạp NGAY SAU file này và bọc các hàm show* theo quyền → nút menu luôn gọi window[fn] lúc bấm.
   ===================================================================================================== */
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };

  var GROUP = { blue:'Tồn kho', green:'Chức năng', gold:'Công cụ', red:'Hệ thống' };
  // key = tiền tố id view/frame; db = dbKey (main.js › DB_FILES); push = cho phép "Đẩy lên điện thoại"
  var MODS = {
    module1:  { fn:'showModule1',  code:'M01', name:'Tồn kho An An',            g:'blue',  src:'ton-kho-an-an.html',       db:'module1', push:'Tồn kho An An, Tồn theo vị trí, Vị trí Bột (kèm báo cáo)' },
    module2:  { fn:'showModule2',  code:'M02', name:'Tồn kho gửi',              g:'blue',  src:'ton-kho-gui.html',         db:'module2', push:'Tồn kho gửi (kèm báo cáo)' },
    module3:  { fn:'showModule3',  code:'M03', name:'NXT Bột/Sốt',              g:'blue',  src:'nxt-bot-sot.html',         db:'module3', push:'NXT Bột/Sốt' },
    module4:  { fn:'showModule4',  code:'M04', name:'NXT TNK/TGC',              g:'blue',  src:'nxt-hang-nhap-khau.html',  db:'module4', push:'NXT TNK/TGC' },
    module13: { fn:'showModule13', code:'M13', name:'Phiếu nhập/xuất kho',      g:'green', src:'phieu-nhap-xuat.html' },
    module6:  { fn:'showModule6',  code:'M06', name:'In chứng từ kho',          g:'green', src:'chung-tu-xuat-kho.html' },
    module9:  { fn:'showModule9',  code:'M09', name:'Phiếu xuất hệ thống', g:'red', src:'phieu-xuat-he-thong.html', refresh:true },
    module14: { fn:'showModule14', code:'M14', name:'Container 3D',             g:'gold', src:'container-3d.html' },
    module15: { fn:'showModule15', code:'M15', name:'Scan tài liệu',            g:'gold', src:'scan-tai-lieu.html' }, // PC 0.21
    module18: { fn:'showModule18', code:'M17', name:'Tạo mã QR',                g:'gold', src:'tao-ma-qr.html' }, // PC 0.69: công cụ mới (thẻ trong trang Công cụ)
    module19: { fn:'showModule19', code:'M18', name:'Quản lý file',             g:'gold', src:'quan-ly-file.html' }, // PC 1.02: công cụ mới (thẻ trong trang Công cụ)
    module20: { fn:'showModule20', code:'M19', name:'Lưu trữ cá nhân',          g:'gold', src:'luu-tru.html' }, // PC 1.03: công cụ mới (thẻ trong trang Công cụ)
    module5:  { fn:'showModule5',  code:'M05', name:'Số liệu kiểm kê',          g:'green',  src:'doi-chieu-kho-hang.html',  dc:true },
    module7:  { fn:'showModule7',  code:'M07', name:'Số liệu cuối kỳ',          g:'green',  src:'quan-ly-kho/index.html',   dc:true },
    module17: { fn:'showModule17', code:'CC',  name:'Công cụ',                  g:'gold',  src:'cong-cu.html', nogroup:true, refresh:true }, // PC 0.67: trang chứa các thẻ công cụ (Scan tài liệu M15, Container 3D M14, công cụ thêm sau)
    module16: { fn:'showModule16', code:'M16', name:'Đối chiếu hàng ngày',      g:'green',  src:'doi-chieu-xuong-kho.html' }, // PC 0.63: module riêng (trước là M12 · Số liệu kho/xưởng trong nhóm Đối chiếu số liệu)
    module8:  { fn:'showModule8',  code:'M08', name:'Tổng hợp',                 g:'green',  src:'tong-hop.html',            db:'module8', push:'Mã hóa, Tổng hợp, Rã đông, Size, Kháng sinh' },
    module10: { fn:'showModule10', code:'M10', name:'Đồng bộ điện thoại',       g:'red',   src:'dong-bo-dien-thoai.html',  refresh:true },
    module11: { fn:'showModule11', code:'M11', name:'Lịch sử thao tác',         g:'red',   src:'lich-su.html',             refresh:true },
    moduleSettings: { fn:'showModuleSettings', code:'CD', name:'Cài đặt',       g:'red',   src:'cai-dat.html' }
  };
  var KEYS = Object.keys(MODS);
  var current = '';           // key module đang mở ('' = Tổng quan)
  var currentFn = 'showDashboard';

  function theme(){ return (typeof window.KLA_getTheme === 'function') ? window.KLA_getTheme() : 'light'; }
  function histCtx(name){ try { if (window.historyAPI) { var p = window.historyAPI.setContext(name); if (p && p.catch) p.catch(function(){}); } } catch (e) {} }

  // ---------- thanh tải 4 màu (chỉ khi một module nạp lần đầu) ----------
  var loadT = null;
  function loading(on){
    var el = $('klLoad'); if (!el) return;
    clearTimeout(loadT);
    if (on) el.classList.add('on'); else loadT = setTimeout(function(){ el.classList.remove('on'); }, 180);
  }

  // ---------- đường dẫn trang + mục menu đang chọn ----------
  function setCrumb(m, label){
    var g = $('klCrumbG'), t = $('klCrumbT'), c = $('klCrumbC');
    if (!m){ g.hidden = true; c.hidden = true; t.textContent = 'Tổng quan'; document.title = 'Kho Lạnh'; crumbLink(g, false); crumbLink(t, false); return; }
    g.hidden = !!m.nogroup; g.textContent = GROUP[m.g]; g.setAttribute('data-g', m.g);
    t.textContent = label || m.name;
    c.hidden = false; c.textContent = m.code;
    document.title = (label || m.name) + ' — Kho Lạnh';
    // PC 0.68: bấm tiêu đề = về trang chính của module; bấm tên nhóm "Công cụ" (khi đang ở Scan / Container 3D…) = về trang Công cụ
    crumbLink(t, true);
    crumbLink(g, !m.nogroup && m.g === 'gold');
  }
  function crumbLink(el, on){
    if (!el) return;
    el.classList.toggle('is-link', !!on);
    if (on){ el.setAttribute('role', 'link'); el.tabIndex = 0; } else { el.removeAttribute('role'); el.removeAttribute('tabindex'); }
  }
  function setActive(fn){
    var navFn = (fn === 'showModule5' || fn === 'showModule7') ? 'showDoiChieu' : (fn === 'showModule14' || fn === 'showModule15' || fn === 'showModule18' || fn === 'showModule19' || fn === 'showModule20') ? 'showModule17' : fn; // PC 0.67: mở Scan / Container 3D từ trang Công cụ → sáng mục menu "Công cụ"
    document.querySelectorAll('#dashboardGrid [data-fn]').forEach(function(b){
      var on = b.getAttribute('data-fn') === navFn;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function setPush(m){
    var b = $('klPush'); if (!b) return;
    var show = !!(m && m.push && window.sheetsSyncAPI);
    b.hidden = !show;
    if (show){ b.dataset.key = current; b.title = 'Đẩy số liệu ' + m.name + ' lên điện thoại (' + m.push + ')'; }
  }

  // ---------- mở / đóng ----------
  function hideAll(){
    var d = $('dashboardView'); if (d) d.style.display = 'none';
    KEYS.forEach(function(k){ var v = $(k + 'View'); if (v) v.style.display = 'none'; });
  }
  function open(key, opts){
    opts = opts || {};
    var m = MODS[key]; if (!m) return;
    hideAll();
    var view = $(key + 'View'), frame = $(key + 'Frame');
    view.style.display = 'flex';
    var first = !frame.dataset.loaded;
    if (first){
      loading(true);
      frame.addEventListener('load', function(){ loading(false); }, { once:true });
      setTimeout(function(){ loading(false); }, 8000);
      frame.src = m.src + '?theme=' + theme() + (opts.query || '');
      frame.dataset.loaded = '1';
      frame.title = m.name;
    } else if (m.refresh && frame.contentWindow){
      try { frame.contentWindow.postMessage({ type:'kla-refresh' }, '*'); } catch (e) {}
    }
    current = key;
    setCrumb(m, opts.label);
    setPush(m);
    document.body.classList.add('in-module');
    var st = $('klStage'); if (st) st.scrollTop = 0;
    return frame;
  }
  function mark(fn, ctx){
    currentFn = fn;
    setActive(fn);
    histCtx(ctx);
    try { sessionStorage.setItem('kla_open_module', fn); } catch (e) {}
    if (window.__dcSubShown) window.__dcSubShown(fn);
  }
  function def(key){
    var m = MODS[key];
    window[m.fn] = function(){ open(key); mark(m.fn, m.dc ? 'Đối chiếu số liệu › ' + m.name : m.name); };
  }
  KEYS.forEach(function(k){ if (k !== 'module8') def(k); });

  // Tổng hợp & Báo cáo rã đông dùng CHUNG trang tong-hop.html (1 bản dữ liệu), chế độ gửi qua URL lần đầu / message các lần sau.
  function openTongHop(mode){
    var frame = $('module8Frame'), first = !frame.dataset.loaded;
    open('module8', { query:'&mode=' + mode, label: mode === 'radong' ? 'Báo cáo rã đông' : 'Tổng hợp' });
    if (!first && frame.contentWindow){ try { frame.contentWindow.postMessage({ type:'kla-th-mode', mode:mode }, '*'); } catch (e) {} }
    frame.dataset.mode = mode;
    $('klCrumbC').textContent = mode === 'radong' ? 'M08RD' : 'M08';
  }
  window.showModule8 = function(){ openTongHop('tonghop'); mark('showModule8', 'Tổng hợp'); };
  window.showModuleRaDong = function(){ openTongHop('radong'); mark('showModuleRaDong', 'Báo cáo rã đông'); };

  window.showDashboard = function(){
    hideAll();
    $('dashboardView').style.display = '';
    current = ''; currentFn = 'showDashboard';
    setCrumb(null); setPush(null); setActive('showDashboard');
    document.body.classList.remove('in-module');
    histCtx('Trang chính');
    try { sessionStorage.removeItem('kla_open_module'); } catch (e) {}
  };

  // ---------- nhóm "Đối chiếu số liệu" (M05 · M07) — thanh tab trong vùng nội dung (PC 0.63: M12 đã tách thành module riêng M16 "Đối chiếu hàng ngày") ----------
  var DC_SUBS = [
    { fn:'showModule5',  code:'M05', label:'Số liệu kiểm kê' },
    { fn:'showModule7',  code:'M07', label:'Số liệu cuối kỳ' }
  ];
  function dcCan(code){ return !(window.KLA_AUTH && typeof window.KLA_AUTH.can === 'function') || window.KLA_AUTH.can(code); }
  function dcAllowed(){ return DC_SUBS.filter(function(s){ return dcCan(s.code); }); }
  window.__dcSubShown = function(fn){
    var s = DC_SUBS.filter(function(x){ return x.fn === fn; })[0]; if (!s) return;
    try { sessionStorage.setItem('kla_dc_last', fn); } catch (e) {}
    var list = dcAllowed();
    document.querySelectorAll('[data-dc-subtabs]').forEach(function(host){
      host.innerHTML = list.map(function(x){
        return '<button type="button" class="kl-subtab' + (x.fn === fn ? ' is-on' : '') + '" data-fn="' + x.fn + '"' + (x.fn === fn ? ' aria-current="page"' : '') + '>'
          + '<span>' + x.label + '</span><small>' + x.code + '</small></button>';
      }).join('');
      host.querySelectorAll('.kl-subtab').forEach(function(b){
        b.onclick = function(){ if (!b.classList.contains('is-on') && typeof window[b.dataset.fn] === 'function') window[b.dataset.fn](); };
      });
    });
  };
  window.showDoiChieu = function(){
    var list = dcAllowed(); if (!list.length) return;
    var last = ''; try { last = sessionStorage.getItem('kla_dc_last') || ''; } catch (e) {}
    var pick = list.filter(function(s){ return s.fn === last; })[0] || list[0];
    if (typeof window[pick.fn] === 'function') window[pick.fn]();
  };

  // ---------- PC 0.68: bấm đường dẫn trên cùng (dùng chung cho MỌI module) ----------
  // Tiêu đề (VD "Scan tài liệu") → nạp lại module về TRANG CHÍNH của nó (đúng địa chỉ trang đã mở lần đầu, kể cả chế độ Tổng hợp / Rã đông).
  // Còn phần đang làm dở chưa lưu (busy) thì hỏi trước. Tên nhóm "Công cụ" → mở trang Công cụ.
  function crumbHome(){
    var m = MODS[current]; if (!m) return;
    var frame = $(current + 'Frame'); if (!frame || !frame.dataset.loaded) return;
    var label = $('klCrumbT').textContent;
    var busy = window.__klaFrameBusy;
    if (typeof busy === 'function' && busy(frame) && !window.confirm('Quay về trang chính của "' + label + '"?\n\nPhần đang nhập dở mà chưa lưu sẽ mất.')) return;
    loading(true);
    frame.addEventListener('load', function(){ loading(false); }, { once:true });
    setTimeout(function(){ loading(false); }, 8000);
    frame.src = frame.getAttribute('src');
    var st = $('klStage'); if (st) st.scrollTop = 0;
  }
  function crumbClick(ev){
    var el = ev.target.closest && ev.target.closest('.is-link'); if (!el) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    if (el.id === 'klCrumbT') crumbHome();
    else if (el.id === 'klCrumbG' && typeof window.showModule17 === 'function') window.showModule17();
  }
  $('klCrumb').addEventListener('click', crumbClick);
  $('klCrumb').addEventListener('keydown', crumbClick);

  // ---------- menu trái ----------
  document.querySelectorAll('#dashboardGrid [data-fn]').forEach(function(b){
    b.addEventListener('click', function(){ var f = window[b.getAttribute('data-fn')]; if (typeof f === 'function') f(); });
  });
  // Lọc menu theo chữ (giữ tên hàm cũ cho các script khác)
  window.filterModules = function(query){
    var q = String(query || '').trim().toLowerCase(), n = 0;
    document.querySelectorAll('#dashboardGrid .kl-nav__item:not(.nav-merged):not(.kl-nav__home)').forEach(function(b){
      var hay = (b.getAttribute('data-name') || '') + ' ' + b.textContent.toLowerCase();
      var hit = !q || hay.indexOf(q) !== -1; b.classList.toggle('is-filtered', !hit); if (hit) n++;
    });
    document.querySelectorAll('#dashboardGrid .kl-nav__group').forEach(function(g){
      g.classList.toggle('is-filtered', !g.querySelector('.kl-nav__item:not(.nav-merged):not(.is-filtered):not(.kla-hide)'));
    });
    var e = $('noResults'); if (e) e.hidden = n > 0;
  };
  // ---------- chú thích tên mục khi menu THU GỌN: hiện ngay khi rê chuột (không dùng title mặc định — có độ trễ) ----------
  (function navTip(){
    var app = $('klApp'), tip = document.createElement('div');
    tip.className = 'kl-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    tip.innerHTML = '<span class="kl-tip__num"></span><span class="kl-tip__txt"></span>';
    document.body.appendChild(tip);
    function mini(){ var l = document.querySelector('#dashboardGrid .kl-nav__label'); return !!l && getComputedStyle(l).display === 'none'; }
    function show(el){
      if (!mini()) return hide();
      var lab = el.getAttribute('aria-label') || el.getAttribute('data-tip') || ''; if (!lab) return hide();
      var g = el.closest('.kl-nav__group'), num = el.getAttribute('data-num') || '';
      tip.setAttribute('data-g', g ? g.getAttribute('data-g') : '');
      tip.querySelector('.kl-tip__num').textContent = num; tip.querySelector('.kl-tip__num').hidden = !num;
      tip.querySelector('.kl-tip__txt').textContent = lab;
      var r = el.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = (r.right + 10) + 'px';
      tip.style.top = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
      tip.classList.add('on');
    }
    function hide(){ tip.classList.remove('on'); tip.hidden = true; }
    var side = $('klSide');
    side.addEventListener('mouseover', function(e){ var el = e.target.closest('.kl-nav__item, .kl-side__toggle, .kl-brand'); if (el) show(el); else hide(); });
    side.addEventListener('mouseleave', hide);
    side.addEventListener('focusin', function(e){ var el = e.target.closest('.kl-nav__item, .kl-side__toggle'); if (el) show(el); });
    side.addEventListener('focusout', hide);
    side.addEventListener('click', hide);
    $('klSide').querySelector('.kl-nav').addEventListener('scroll', hide, { passive:true });
  })();

  // Thu gọn menu (nhớ trên máy)
  (function(){
    var app = $('klApp'), btn = $('klSideToggle');
    function apply(mini){ app.classList.toggle('is-mini', mini); btn.setAttribute('aria-label', mini ? 'Mở rộng menu' : 'Thu gọn menu'); btn.querySelector('span').textContent = mini ? 'Mở rộng' : 'Thu gọn'; }
    var saved = false; try { saved = localStorage.getItem('kl_side') === 'mini'; } catch (e) {}
    apply(saved);
    btn.addEventListener('click', function(){ var m = !app.classList.contains('is-mini'); apply(m); try { localStorage.setItem('kl_side', m ? 'mini' : 'full'); } catch (e) {} });
  })();

  // ---------- Sáng / Tối: đổi ở trang chính rồi báo xuống mọi module ----------
  function broadcast(msg){
    KEYS.forEach(function(k){ var f = $(k + 'Frame'); if (f && f.contentWindow && f.dataset.loaded){ try { f.contentWindow.postMessage(msg, '*'); } catch (e) {} } });
  }
  $('klTheme').addEventListener('click', function(){
    var t = theme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('kla_theme', t); } catch (e) {}
    broadcast({ type:'kla-theme-change', theme:t });
  });

  // ---------- tin nhắn từ các module ----------
  window.addEventListener('message', function(ev){
    var d = ev.data; if (!d || !d.type) return;
    if (d.type === 'openModule'){
      var key = String(d.module || '');
      var fn = 'showModule' + key.replace('module', '');
      if (typeof window[fn] === 'function') window[fn]();
      if (d.view) sendOpenView(key, d.view, d.slipId || '');
    } else if (d.type === 'kla-theme-change'){
      if (d.theme === 'light' || d.theme === 'dark') document.documentElement.setAttribute('data-theme', d.theme);
      broadcast({ type:'kla-theme-change', theme:d.theme });
    } else if (d.type === 'kla-ai-config-change'){
      broadcast({ type:'kla-ai-config-change' });
    }
  });
  function sendOpenView(moduleKey, view, slipId){
    var frame = $(moduleKey + 'Frame'); if (!frame) return;
    var msg = { type:'kla-open-view', view:view, slipId:slipId, reqId: Date.now() + '-' + Math.random().toString(36).slice(2, 7) };
    var post = function(){ try { if (frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); } catch (e) {} };
    post(); frame.addEventListener('load', post, { once:true });
    [300, 900, 2000, 4000].forEach(function(ms){ setTimeout(post, ms); });
  }

  // ---------- đồng hồ + ngày ----------
  var DAYS = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
  function p2(n){ return String(n).padStart(2, '0'); }
  // PC 0.19: cửa sổ đang ẩn / thu nhỏ / máy chủ LAN chạy dưới khay → KHÔNG vẽ đồng hồ (đỡ CPU); hiện lại thì vẽ ngay.
  var clockEls = null, lastDay = '';
  function tick(){
    if (document.hidden) return;
    var d = new Date();
    var t = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    var day = DAYS[d.getDay()] + ', ' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
    if (!clockEls || !clockEls.length || !clockEls[0].isConnected) clockEls = document.querySelectorAll('.appClockText');
    clockEls.forEach(function(el){ if (el.textContent !== t) el.textContent = t; });
    if (day !== lastDay){
      lastDay = day;
      clockEls.forEach(function(el){ el.parentNode.title = day; });
      var td = $('klToday'); if (td && td.textContent !== day) td.textContent = day;
    }
  }
  tick(); setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden){ clockEls = null; lastDay = ''; tick(); } });

  // ---------- tải lại trang đang xem ----------
  $('btnRefreshOverview').addEventListener('click', function(){
    var btn = this;
    if (!current){ if (typeof window.loadDashboardOverview === 'function') window.loadDashboardOverview(); if (typeof window.loadLichXuatCont === 'function') window.loadLichXuatCont(); return; }
    var frame = $(current + 'Frame'); if (!frame || !frame.dataset.loaded) return;
    if (!window.confirm('Tải lại "' + $('klCrumbT').textContent + '"?\n\nPhần đang nhập dở mà chưa lưu sẽ mất.')) return;
    btn.classList.add('is-spin'); loading(true);
    var done = function(){ btn.classList.remove('is-spin'); loading(false); };
    frame.addEventListener('load', done, { once:true }); setTimeout(done, 6000);
    try { frame.contentWindow.location.reload(); } catch (e) { frame.src = frame.src; }
  });

  // ---------- thông báo nhỏ ----------
  var toastEl = null, toastT = null;
  function toast(msg, bad){
    if (!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'kl-toast module-push-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.toggle('bad', !!bad); toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function(){ toastEl.classList.remove('show'); }, bad ? 7000 : 4000);
  }
  window.KL_toast = toast;

  // ---------- Đẩy lên điện thoại (M01–M04, M08) ----------
  var pushing = false;
  $('klPush').addEventListener('click', async function(){
    var m = MODS[this.dataset.key || '']; if (!m || !m.push || pushing) return;
    var api = window.sheetsSyncAPI, btn = this, label = btn.querySelector('span');
    if (!api || typeof api.pushModule !== 'function'){ toast('Bản này chưa hỗ trợ đẩy số liệu lên điện thoại.', true); return; }
    if (!window.confirm('Đẩy số liệu "' + m.name + '" lên điện thoại?\n\nGồm: ' + m.push + '.\nSố liệu trên điện thoại sẽ được thay bằng số liệu hiện tại của máy này.')) return;
    pushing = true; btn.disabled = true; label.textContent = 'Đang đẩy…';
    try {
      var res = await api.pushModule(m.db);
      if (res && res.ok) toast('Đã đẩy "' + m.name + '" lên điện thoại.');
      else if (res && res.needConfig) toast('Chưa kết nối điện thoại: vào Cài đặt › Cài đặt chung › Kết nối & cấu hình.', true);
      else toast('Chưa đẩy được: ' + ((res && res.error) || 'không rõ lỗi'), true);
    } catch (e) { toast('Chưa đẩy được: ' + (e && e.message ? e.message : e), true); }
    finally { pushing = false; btn.disabled = false; label.textContent = 'Đẩy lên điện thoại'; }
  });

  // ---------- phím tắt: Alt+0 về Tổng quan ----------
  document.addEventListener('keydown', function(e){
    if (e.altKey && !e.ctrlKey && e.key === '0'){ e.preventDefault(); window.showDashboard(); }
  });

  // ---------- bấm logo / tiêu đề "Kho Lạnh" (góc trên trái) → về Tổng quan (giống Alt+0) ----------
  (function brandHome(){
    var b = document.querySelector('.kl-brand'); if (!b) return;
    b.setAttribute('role', 'button'); b.setAttribute('tabindex', '0'); b.setAttribute('aria-label', 'Về Tổng quan');
    function go(){ if (typeof window.showDashboard === 'function') window.showDashboard(); }
    b.addEventListener('click', go);
    b.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } });
  })();

  // ---------- PC 0.19 — nút "Giải phóng bộ nhớ" (menu tài khoản): nhả NGAY mọi module đang ẩn (kể cả Tồn kho An An / Tồn kho gửi),
  // trừ module đang xem và module còn dở (đang mở hộp thoại / có ô nhập chưa lưu — cùng quy tắc với nhả tự động 30 phút).
  // Mở lại module nào thì module đó nạp lại từ database như lần đầu.
  (function memRelease(){
    var b = $('authMem'); if (!b) return;
    b.addEventListener('click', function(){
      var pop = $('authPop'); if (pop) pop.hidden = true;
      var tr = $('authTrigger'); if (tr) tr.setAttribute('aria-expanded', 'false');
      var busy = window.__klaFrameBusy || function(){ return true; };
      var freed = 0, kept = [];
      KEYS.forEach(function(k){
        var view = $(k + 'View'), frame = $(k + 'Frame');
        if (!view || !frame || !frame.dataset.loaded || k === current && view.style.display !== 'none') return;
        if (busy(frame)){ kept.push((MODS[k] && MODS[k].name) || k); return; }
        frame.src = 'about:blank'; delete frame.dataset.loaded; delete frame.dataset.hiddenAt; freed++;
      });
      var api = window.appWindowAPI && window.appWindowAPI.giaiPhongBoNho;
      var done = function(){
        var msg = freed ? ('Đã đóng ' + freed + ' module đang ẩn.') : 'Không có module ẩn nào cần đóng.';
        if (kept.length) msg += ' Giữ lại (đang làm dở): ' + kept.join(', ') + '.';
        toast(msg);
      };
      if (api) api().then(done, done); else done();
    });
  })();

  // ---------- nhả bộ nhớ: module ẩn liên tục ≥ 30 phút → iframe về about:blank (M01, M02, Cài đặt không nhả) ----------
  (function idleUnload(){
    var IDLE_MS = 30 * 60 * 1000;
    var FRAMES = ['module3', 'module4', 'module5', 'module6', 'module7', 'module8', 'module9', 'module13', 'module14', 'module15', 'module16', 'module17', 'module18', 'module19', 'module20'];
    window.__klaFrameBusy = busy; // PC 0.19 — dùng chung cho nút "Giải phóng bộ nhớ"
    function busy(frame){
      try {
        var d = frame.contentDocument; if (!d || !d.body) return true;
        if (frame.contentWindow && typeof frame.contentWindow.__klaBusy === 'function' && frame.contentWindow.__klaBusy()) return true; // PC 0.21: module tự báo còn việc chưa lưu (Scan tài liệu)
        if (d.querySelector('dialog[open], .modal.show, .modal.open, .modal-overlay.show, .popup.show, [aria-modal="true"]:not([hidden])')) return true;
        var els = d.querySelectorAll('textarea, input:not([type]), input[type=text], input[type=number]');
        for (var i = 0; i < els.length; i++){
          var el = els[i];
          if (el.value !== el.defaultValue && !/search|tim|loc|filter|q$/i.test((el.id || '') + ' ' + (el.className || '') + ' ' + (el.placeholder || ''))) return true;
        }
        return false;
      } catch (e) { return true; }
    }
    setInterval(function(){
      var now = Date.now();
      FRAMES.forEach(function(k){
        var view = $(k + 'View'), frame = $(k + 'Frame');
        if (!view || !frame || !frame.dataset.loaded) return;
        if (view.style.display !== 'none'){ delete frame.dataset.hiddenAt; return; }
        if (!frame.dataset.hiddenAt){ frame.dataset.hiddenAt = String(now); return; }
        if (now - Number(frame.dataset.hiddenAt) < IDLE_MS || busy(frame)) return;
        frame.src = 'about:blank'; delete frame.dataset.loaded; delete frame.dataset.hiddenAt;
      });
    }, 60 * 1000);
  })();

  // ---------- phiên bản trên menu ----------
  try {
    if (window.updateAPI && typeof window.updateAPI.getInfo === 'function'){
      Promise.resolve(window.updateAPI.getInfo()).then(function(r){ var v = r && ((r.local && r.local.version) || r.version || (r.info && r.info.version));  }).catch(function(){});
    }
  } catch (e) {}

  // Làm mới cả app (Ctrl+R) → mở lại đúng module đang xem (auth-gate.js cũng mở lại sau khi đăng nhập)
  try {
    var reopen = sessionStorage.getItem('kla_open_module');
    if (reopen && typeof window[reopen] === 'function') setTimeout(function(){ try { window[reopen](); } catch (e) {} }, 0);
  } catch (e) {}
})();
