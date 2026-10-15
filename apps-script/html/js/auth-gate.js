/* ĐĂNG NHẬP + CHẶN MODULE THEO QUYỀN PC (PC 5.8) — trang chính (index.html).
   - Xác thực ở main.js (window.authAPI → auth:state / auth:login / auth:logout / auth:change-password); mã truy cập không về giao diện.
   - Quyền module PC = trường `pc` của người dùng: M01, M01VT, M01VTB, M02…M09, CD_SAOLUU, CD_DONGBO, TAIKHOAN (cùng danh sách PQ_PC trong main.js, PC trong tai-khoan.js). Từ 6.4 "Tài khoản" là tab trong Cài đặt. Từ 6.7 mọi tài khoản đều mở được Cài đặt (mục Giao diện); từng mục khác cần quyền CD_* riêng.
   - Chặn ở GIAO DIỆN: ẩn mục menu / thẻ trang chính, bọc showModuleN / showModuleSettings, lọc Tìm toàn kho + Trợ lý AI.
     (PC 7.18: các IPC ĐỌC database cũng bị chặn ở main.js khi chưa đăng nhập — PC_GUARD mã 'READ'. Mở file HTML bằng trình duyệt bị chặn bởi đoạn kiểm tra window.dbAPI đầu mỗi trang.)
   - PC 6.9: ô tài khoản nằm ở góc phải trên trang chính (cạnh nút làm mới #btnRefreshOverview), bấm sổ menu Đổi mật khẩu / Đăng xuất.
   - PHẢI nạp NGAY SAU js/index.js. Đăng xuất / đổi người = nạp lại cả trang để không lộ trạng thái module của người trước. */
(function(){
  'use strict';
  var FN = { showModule1:'M01', showModule2:'M02', showModule3:'M03', showModule4:'M04', showModule5:'M05', showModule6:'M06',
    showModule7:'M07', showModule8:'M08', showModuleRaDong:'M08RD', showModule9:'M09', showModule10:'CD_DONGBO', showModule11:'', showModule13:'M13', showModule14:'M14', showModule15:'M15', showModule16:'M16', showModule17:'', showModule18:'M17', showModule19:'M18', showModule20:'M19', showModuleSettings:'' }; // Cài đặt: không cần mã module (xem allowed)
  var NAV = { M01:'.m1', M02:'.m2', M03:'.m3', M04:'.m4', M05:'.m5', M06:'.m6', M07:'.m7', M08:'.m8', M08RD:'.mrd', M09:'.m9', M13:'.m13', M14:'.m14', M15:'.m15', M17:'.m17', M16:'.m16', CD_DONGBO:'.m10' };
  // PC 7.14 — 4 vai trò: cấp 1 (vàng) · cấp 2 (xanh lá) · Quản lý (xanh đậm) · Quản trị (đỏ). Màu ở css/index.css (.au-role-*).
  // PC 7.44: cấp 1 / cấp 2 cùng hiện "Người dùng" — phân biệt bằng MÀU (cấp 1 vàng · cấp 2 xanh lá), không ghi số cấp.
  var ROLE = { xem:'Người dùng', xuat:'Người dùng', quanly:'Quản lý', quantri:'Quản trị' };
  var ROLE_MINI = { xem:'Cấp 1 · Chỉ xem', xuat:'Cấp 2 · Xuất phiếu', quanly:'Quản lý', quantri:'Quản trị', admin:'Admin' }; // PC 8.52
  var RIC = { // PC 8.52: biểu tượng vai trò (cùng bộ với Cài đặt › Tài khoản)
    xem:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    xuat:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-5M9.5 14.5 12 12l2.5 2.5"/>',
    quanly:'<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    quantri:'<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    admin:'<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>' };
  var LAST_KEY = 'kla_login_last_user';
  var $ = function(id){ return document.getElementById(id); };
  var api = window.authAPI;
  var user = null;

  function can(code){ return !!(user && user.pc && user.pc.indexOf(code) !== -1); }
  // PC 0.67: trang "Công cụ" (showModule17) KHÔNG có quyền riêng — mở được khi có ÍT NHẤT 1 quyền công cụ trong TOOL_CODES (thêm công cụ mới → thêm mã quyền vào đây + vào TOOLS ở js/cong-cu.js).
  var TOOL_CODES = ['M14','M15','M17','M18','M19'];
  function canTools(){ return TOOL_CODES.some(can); }
  // PC 7.2: Module 01 có 3 quyền riêng (M01 = Tồn An An, M01VT = Tồn theo vị trí, M01VTB = Vị trí bột). Mở được module 01 khi có ÍT NHẤT 1 trong 3;
  // trong module, từng menu tự ẩn theo quyền (js/ton-kho-an-an.js › m1Can).
  function canM1(){ return can('M01') || can('M01VT') || can('M01VTB'); }
  // PC 6.7: Cài đặt mở được với MỌI tài khoản đã đăng nhập (mục Giao diện luôn dùng được); các mục nhạy cảm bên trong
  // (Sao lưu & Drive, Đồng bộ điện thoại, Tài khoản) tự ẩn theo quyền CD_* / TAIKHOAN; PC 7.3: Cập nhật, Trợ lý AI, Mạng LAN, Khôi phục không còn phân quyền — xem js/cai-dat.js › applyAuthTabs.
  function allowed(fn){ return fn === 'showModule17' ? canTools() : fn === 'showModuleSettings' ? !!user : (fn === 'showModule11' ? isQT() : (fn === 'showModule1' ? canM1() : can(FN[fn]))); }
  // PC 7.61: Module 11 "Lịch Sử" — CHỈ tài khoản Quản trị (user.isQuanTri từ main.js › publicUser); main.js cũng chặn thật history:query.
  function isQT(){ return !!(user && user.isQuanTri); }
  // src của dòng Tìm toàn kho: 'M01' | 'M01VT' | 'M01VTB' | 'M02' | 'M03' | 'M04' (thiếu thì lấy theo số module m)
  function canSrc(src, m){
    var c = src ? String(src) : (m ? 'M0' + m : '');
    if(c.length > 3 && c !== 'M01VT' && c !== 'M01VTB') c = c.substr(0, 3);
    return can(c);
  }
  window.KLA_AUTH = { can:can, canM1:canM1, canSrc:canSrc, user:function(){ return user; }, role:function(){ return user ? (user.vaiTro || user.quyen || '') : ''; } };

  function toast(t){
    var e = document.createElement('div'); e.className = 'au-toast'; e.textContent = t; document.body.appendChild(e);
    setTimeout(function(){ if(e.parentNode) e.parentNode.removeChild(e); }, 2600);
  }

  // Bọc các hàm mở module: không có quyền → báo, không mở.
  Object.keys(FN).forEach(function(fn){
    var orig = window[fn]; if(typeof orig !== 'function') return;
    window[fn] = function(){
      if(!allowed(fn)){ if(user) toast('Tài khoản của bạn không có quyền mở mục này.'); return; }
      return orig.apply(this, arguments);
    };
  });

  function applyUser(){
    var b = document.body;
    Object.keys(NAV).forEach(function(code){
      var el = document.querySelector('.module.nav-item' + NAV[code]); if(el) el.classList.toggle('kla-hide', code === 'M01' ? !canM1() : !can(code));
    });
    // PC 7.85: mục gộp "Đối chiếu số liệu" hiện khi có ÍT NHẤT 1 trong 2 quyền M05 / M07 (PC 0.63: M12 tách thành menu riêng M16 "Đối chiếu hàng ngày", quyền riêng)
    var m17 = document.querySelector('.module.nav-item.m17'); if(m17) m17.classList.toggle('kla-hide', !canTools()); // PC 0.67
    var dcg = document.querySelector('.module.nav-item.mdc'); if(dcg) dcg.classList.toggle('kla-hide', !(can('M05') || can('M07')));
    var st = $('btnHeaderSettings'); if(st) st.classList.toggle('kla-hide', !user);
    var m11 = document.querySelector('.module.nav-item.m11'); if(m11) m11.classList.toggle('kla-hide', !isQT());
    ['M01','M02','M03','M04'].forEach(function(c){ b.classList.toggle('kla-no-' + c, !can(c)); });
    b.classList.toggle('kla-no-total', !(can('M01') && can('M02')));
    var chip = $('authChip');
    if(user){
      var nm = user.tenHienThi || user.ten;
      var vt = user.vaiTro || user.quyen || 'xem';
      // PC 8.52: nút tài khoản theo VAI TRÒ — biểu tượng + màu riêng (cấp 1 mắt/vàng · cấp 2 tài liệu/xanh lá · Quản lý thanh trượt/xanh ngọc · Quản trị khiên/hồng đỏ · admin vương miện/vàng cam); css/dang-nhap.css › [data-role]
      var isAd = String(user.ten || '').toLowerCase() === 'admin', rk = isAd ? 'admin' : vt;
      $('authAv').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (RIC[rk] || RIC.xem) + '</svg>';
      $('authTrigger').setAttribute('data-role', rk); $('authTrigger').title = 'Tài khoản — ' + (ROLE_MINI[rk] || '');
      var rl = $('authRl'); if(rl) rl.textContent = ROLE_MINI[rk] || '';
      $('authName').textContent = nm; $('authPopName').textContent = nm;
      var small = $('authRole'); small.textContent = ROLE[vt] || vt; small.className = 'au-role-' + vt;
      $('authName').setAttribute('data-role', vt); $('authPopName').setAttribute('data-role', vt);
      if(user.matKhauMacDinh){ small.textContent = 'Nên đổi mật khẩu'; small.className = 'warn'; }
      chip.hidden = false;
    } else { chip.hidden = true; closePop(); }
  }

  // Ghi nhớ đăng nhập: mã thật nằm ở tiến trình chính (mã hóa DPAPI); ở đây chỉ hiện 8 dấu chấm giữ chỗ, và gửi mã RỖNG khi người dùng không sửa.
  var DUMMY = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  var usingSaved = false, savedName = '', autoTried = false;
  // Tự động đăng nhập cần có ghi nhớ: tick Tự động → tự tick Ghi nhớ; bỏ Ghi nhớ → bỏ luôn Tự động.
  $('auAuto').addEventListener('change', function(){ if(this.checked) $('auRemember').checked = true; });
  $('auRemember').addEventListener('change', function(){ if(!this.checked) $('auAuto').checked = false; });
  function clearSaved(){ if(usingSaved){ usingSaved = false; $('auPass').value = ''; } }
  // PC 7.95 — THIẾT LẬP MÁY MỚI (máy chưa có tài khoản): thay form đăng nhập. Chỉ gọi lệnh setup:* ở main.js (từ chối nếu máy đã có tài khoản).
  var suOffline = false;
  function suShow(id, on){ var e = $(id); if(e) e.hidden = !on; }
  function suErr(t){ var e = $('suErr'); e.textContent = t || ''; e.hidden = !t; if(t) suShow('suOk', false); }
  function suInfo(t){ var e = $('suOk'); e.textContent = t || ''; e.hidden = !t; if(t) suShow('suErr', false); }
  function showSetup(info){
    document.body.classList.add('kla-locked');
    suShow('authForm', false); suShow('authSetup', true);
    info = info || {};
    suShow('suUrlWrap', !info.hasUrl); suShow('suTokWrap', !info.hasToken);
    suShow('suMake', false); suShow('suOffline', false); suOffline = false; suErr(''); suInfo('');
    setTimeout(function(){ var f = (!info.hasUrl && $('suUrl')) || (!info.hasToken && $('suTok')) || $('suPull'); if(f) f.focus(); }, 30);
  }
  function toLogin(msg, name){
    suShow('authSetup', false); suShow('authForm', true);
    lock();
    var i = $('auInfo'); if(i){ i.textContent = msg || ''; i.hidden = !msg; }
    if(name) $('auUser').value = name;
    setTimeout(function(){ ($('auUser').value ? $('auPass') : $('auUser')).focus(); }, 60);
  }
  var suBusy = false;
  async function suRun(btn, label, fn){
    if(suBusy) return; suBusy = true; var old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try{ await fn(); }catch(x){ suErr('Lỗi: ' + (x && x.message || x)); }
    finally{ suBusy = false; btn.disabled = false; btn.textContent = old; }
  }
  $('suPull').addEventListener('click', function(){ suRun(this, 'Đang kéo từ Google Sheet…', async function(){
    suErr(''); suInfo('');
    var r = await api.setupPull({ url: $('suUrl').value, pcToken: $('suTok').value });
    if(!r || !r.ok){ suErr((r && r.error) || 'Không kéo được danh sách.'); suShow('suOffline', !!(r && r.network)); return; }
    if(r.count > 0){ toLogin('Đã kéo ' + r.count + ' tài khoản từ Google Sheet' + (r.skipped ? ' (bỏ qua ' + r.skipped + ' dòng không hợp lệ)' : '') + '. Đăng nhập bằng tài khoản đã được cấp.'); return; }
    if(r.sheetRows > 0){ suErr('Trên Google Sheet có ' + r.sheetRows + ' dòng tài khoản nhưng không đọc được mã truy cập (thiếu cột maTruyCap hoặc mã không hợp lệ). Dán lại Code.gs mới vào Apps Script, lưu lại tài khoản trên máy chính rồi thử lại.'); return; }
    suInfo('Kết nối Google Sheet thành công nhưng chưa có tài khoản nào. Hãy tạo tài khoản admin bên dưới.'); suShow('suMake', true); suOffline = false;
    setTimeout(function(){ $('suCode').focus(); }, 30);
  }); });
  async function suMakeAdmin(){
    var c1 = $('suCode').value.trim(), c2 = $('suCode2').value.trim();
    if(c1.length < 8 || c1.length > 64) { suErr('Mã admin phải từ 8 đến 64 ký tự.'); return; }
    if(!/^[A-Za-z0-9\-_.@#!]+$/.test(c1)) { suErr('Mã chỉ gồm chữ không dấu, số và - _ . @ # ! (không dấu cách).'); return; }
    if(c1.toLowerCase() === 'admin') { suErr('Không dùng chữ “admin” làm mã.'); return; }
    if(c1 !== c2) { suErr('Hai lần nhập mã không giống nhau.'); return; }
    var r = await api.setupCreateAdmin(c1, { offline: suOffline });
    if(!r || !r.ok){ suErr((r && r.error) || 'Không tạo được tài khoản.'); if(r && r.hasAccounts) suShow('suMake', false); suShow('suOffline', !!(r && r.network)); return; }
    $('suCode').value = ''; $('suCode2').value = '';
    toLogin('Đã tạo tài khoản admin' + (r.pushed ? ' và cập nhật lên Google Sheet' : '') + '. Đăng nhập bằng tên admin và mã vừa đặt.' + (r.warning ? ' ' + r.warning : ''), 'admin');
  }
  $('suMakeGo').addEventListener('click', function(){ suRun(this, 'Đang tạo…', suMakeAdmin); });
  $('suOffline').addEventListener('click', function(){
    if(!window.confirm('Tạo tài khoản admin TẠM trên máy này khi không có mạng?\n\nNếu Google Sheet đã có tài khoản, bạn phải vào Cài đặt › Tài khoản › “Kéo danh sách từ Sheet” sau khi có mạng.')) return;
    suOffline = true; suErr(''); suInfo('Tạo admin tạm (không dùng Google Sheet). Đặt mã admin:'); suShow('suMake', true); setTimeout(function(){ $('suCode').focus(); }, 30);
  });
  $('suFile').addEventListener('click', function(){ suRun(this, 'Đang nạp…', async function(){
    suErr('');
    var r = await api.setupImportFile();
    if(!r || !r.ok){ suErr((r && r.error) || 'Không nạp được file.'); return; }
    if(r.canceled) return;
    toLogin('Đã nạp ' + r.count + ' tài khoản từ file cấu hình. Đăng nhập bằng tài khoản đã được cấp.');
  }); });
  function lock(){
    suShow('authSetup', false); suShow('authForm', true); // PC 7.95: đang ở màn đăng nhập thường
    document.body.classList.add('kla-locked');
    $('auPass').value = ''; $('auErr').hidden = true; usingSaved = false; savedName = '';
    var last = ''; try{ last = localStorage.getItem(LAST_KEY) || ''; }catch(e){}
    $('auUser').value = last; $('auRemember').checked = false; $('auAuto').checked = false;
    setTimeout(function(){ (last ? $('auPass') : $('auUser')).focus(); }, 30);
    if(api && api.remembered){
      api.remembered().then(function(r){
        if(!r) return;
        $('auRememberWrap').hidden = !r.canRemember && !r.has; // máy không hỗ trợ mã hóa → ẩn ô tích
        $('auAutoWrap').hidden = $('auRememberWrap').hidden;
        if(!r.has || !document.body.classList.contains('kla-locked')) return;
        savedName = r.ten; usingSaved = true;
        $('auUser').value = r.ten; $('auPass').value = DUMMY; $('auRemember').checked = true; $('auAuto').checked = !!r.auto;
        // PC 7.33: đã bật tự động đăng nhập → tự gửi form 1 lần (sai mã / lỗi thì dừng ở màn đăng nhập, không lặp)
        if(r.auto && !autoTried){ autoTried = true; setTimeout(function(){ if(document.body.classList.contains('kla-locked') && !busy) $('authForm').requestSubmit(); }, 60); return; }
        setTimeout(function(){ $('auGo').focus(); }, 30);
      }, function(){});
    }
  }
  function unlock(u, reopen){
    user = u; applyUser();
    document.body.classList.remove('kla-locked');
    try{ window.dispatchEvent(new CustomEvent('kla-auth-unlocked')); }catch(e){} // PC 7.18: kênh ĐỌC database cần đăng nhập → trang chính tải lại số liệu sau khi đăng nhập
    // PC 8.82 — NẠP NỀN MODULE 01 / 02 SAU ĐĂNG NHẬP: báo cáo Excel đẩy lên điện thoại do CHÍNH trang module 01/02 dựng (main.js ›
    // getReportSnapshot). Trước đây trang chỉ nạp khi người dùng mở module lần đầu → chưa mở thì điện thoại luôn nhận "bản cũ
    // (module đang đóng)". Nay nạp ngầm (khung nằm trong view ẩn, dùng cùng cờ dataset.loaded như showModule1/showModule3 nên
    // mở sau đó không nạp lại). Chỉ nạp module tài khoản có quyền; trễ 4 giây cho trang chính vẽ xong trước.
    setTimeout(function(){
      try{
        [['module1Frame','ton-kho-an-an.html', canM1()], ['module2Frame','ton-kho-gui.html', can('M02')]].forEach(function(m){
          var f = document.getElementById(m[0]);
          if(m[2] && f && !f.dataset.loaded){
            f.src = m[1] + '?theme=' + (typeof KLA_getTheme === 'function' ? KLA_getTheme() : 'dark');
            f.dataset.loaded = '1';
          }
        });
      }catch(e){}
    }, 4000);
    if(u && u.matKhauMacDinh) openPwDialog(true); // PC 7.9: admin / admin → bắt buộc đổi mật khẩu ngay lần đầu
    var open = null; try{ open = sessionStorage.getItem('kla_open_module'); }catch(e){}
    // Mục đang xem (nhớ từ trước khi làm mới app, hoặc quyền vừa đổi) mà không còn quyền → về trang chính
    if(open && FN[open] && !allowed(open)){ if(typeof window.showDashboard === 'function') window.showDashboard(); return; }
    // Làm mới app (Ctrl+R) → mở lại đúng module đang xem (index.js bị chặn lúc chưa biết người dùng nên làm lại ở đây)
    if(reopen && open && typeof window[open] === 'function') { try{ window[open](); }catch(e){} }
  }

  async function refresh(){
    try{
      var r = await api.state();
      if(!r || !r.ok || !r.user){ user = null; applyUser(); if(r && r.ok && r.setup) showSetup(r.setupInfo); else lock(); if(typeof window.showDashboard === 'function') window.showDashboard(); return; }
      unlock(r.user, false);
    }catch(e){}
  }
  // Trang Tài khoản vừa lưu → quyền của người đang đăng nhập có thể đã đổi
  window.addEventListener('message', function(ev){ if(ev.data && ev.data.type === 'kla-auth-refresh') refresh(); });

  function logoutAndReload(){
    try{ sessionStorage.removeItem('kla_open_module'); }catch(e){}
    Promise.resolve(api.logout()).then(function(){ location.reload(); }, function(){ location.reload(); });
  }

  // ---- Đăng nhập ----
  var busy = false;
  $('auPass').addEventListener('input', function(){ usingSaved = false; });                 // gõ mã mới → bỏ mã đã nhớ
  $('auPass').addEventListener('focus', function(){ if(usingSaved) this.select(); });      // bấm vào ô → gõ là thay luôn
  $('auUser').addEventListener('input', function(){ if(usingSaved && this.value.trim().toLowerCase() !== savedName.toLowerCase()) clearSaved(); });
  $('auEye').addEventListener('click', function(){
    if(usingSaved) return; // mã đã nhớ không hiện lại được
    var p = $('auPass'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; this.textContent = show ? '🙈' : '👁';
  });
  $('authForm').addEventListener('submit', async function(e){
    e.preventDefault(); if(busy) return;
    var ten = $('auUser').value.trim(), pw = usingSaved ? '' : $('auPass').value;
    var err = $('auErr'); err.hidden = true;
    if(!ten || (!pw && !usingSaved)){ err.textContent = 'Nhập Tên người dùng và Mã truy cập.'; err.hidden = false; return; }
    busy = true; $('auGo').disabled = true; $('auGo').textContent = 'Đang kiểm tra…';
    try{
      var r = await api.login(ten, pw, $('auRemember').checked, $('auRemember').checked && $('auAuto').checked);
      if(r && r.setup){ refresh(); return; } // PC 7.95: máy chưa có tài khoản → màn Thiết lập máy mới
      if(!r || !r.ok){
        err.textContent = (r && r.error) || 'Đăng nhập thất bại.'; err.hidden = false;
        if(usingSaved){ usingSaved = false; $('auRemember').checked = false; $('auAuto').checked = false; } // mã đã nhớ bị từ chối → main đã xóa, bắt nhập lại
        $('auPass').value = ''; $('auPass').focus(); return;
      }
      try{ localStorage.setItem(LAST_KEY, ten); }catch(x){}
      $('auPass').value = ''; usingSaved = false;
      unlock(r.user, true);
    }catch(x){ err.textContent = 'Đăng nhập thất bại: ' + (x && x.message || x); err.hidden = false; }
    finally{ busy = false; $('auGo').disabled = false; $('auGo').textContent = 'Đăng nhập'; }
  });
  // Đang khóa: không cho Ctrl+K mở "Tìm trong toàn kho" đè lên màn đăng nhập
  document.addEventListener('keydown', function(e){
    if(document.body.classList.contains('kla-locked') && (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k'){ e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // ---- Menu tài khoản (góc phải trên, cạnh nút làm mới) ----
  function closePop(){ var p = $('authPop'); if(p) p.hidden = true; var t = $('authTrigger'); if(t) t.setAttribute('aria-expanded', 'false'); }
  $('authTrigger').addEventListener('click', function(e){
    e.stopPropagation();
    var p = $('authPop'), open = p.hidden;
    var st = $('authSettings'), sb = document.getElementById('btnHeaderSettings'); if(st) st.hidden = !sb || sb.hidden || sb.classList.contains('kla-hide'); // chỉ hiện "Cài đặt" khi tài khoản được dùng (theo nút Cài đặt ở menu trái)
    p.hidden = !open; this.setAttribute('aria-expanded', open ? 'true' : 'false');
    if(open){ var first = p.querySelector('button'); if(first) first.focus(); }
  });
  document.addEventListener('mousedown', function(e){ var m = $('authChip'); if(m && !m.contains(e.target)) closePop(); });
  $('authPop').addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ closePop(); $('authTrigger').focus(); }
    else if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      var b = Array.prototype.slice.call(this.querySelectorAll('button')), i = b.indexOf(document.activeElement);
      b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus(); e.preventDefault();
    }
  });
  $('authSettings').addEventListener('click', function(){ closePop(); if(typeof window.showModuleSettings === 'function') window.showModuleSettings(); });
  $('authOut').addEventListener('click', function(){ closePop(); if(window.confirm('Đăng xuất khỏi tài khoản này?')) logoutAndReload(); });

  // ---- Đổi mã của chính mình ----
  var TOKEN_OK = /^[A-Za-z0-9\-_.@#!]+$/;
  $('authPw').addEventListener('click', function(){ openPwDialog(false); });
  // forced = true: tài khoản đang dùng mật khẩu mặc định (admin / admin) → BẮT BUỘC đặt mã mới, không đóng được hộp thoại.
  function openPwDialog(forced){
    closePop();
    if(document.querySelector('.au-modal')) return;
    var m = document.createElement('div'); m.className = 'au-modal';
    m.innerHTML = '<form class="au-card" autocomplete="off"><h1>' + (forced ? 'Đặt mật khẩu mới' : 'Đổi mật khẩu') + '</h1>'
      + (forced ? '<p class="au-foot" style="margin:0">Bạn đang dùng mật khẩu mặc định <b>admin</b>. Vì lý do an toàn, hãy đặt mật khẩu mới trước khi sử dụng.</p>' : '')
      + '<label' + (forced ? ' hidden' : '') + '>Mật khẩu hiện tại<input type="password" id="pwOld" maxlength="64" autocomplete="off"' + (forced ? ' value="admin"' : '') + '></label>'
      + '<label>Mật khẩu mới (8–64 ký tự)<input type="password" id="pwNew" maxlength="64" autocomplete="off"></label>'
      + '<label>Nhập lại mật khẩu mới<input type="password" id="pwNew2" maxlength="64" autocomplete="off"></label>'
      + '<p class="au-foot">Chữ không dấu, số và - _ . @ # ! · không dấu cách. Cũng là mật khẩu đăng nhập trên điện thoại.</p>'
      + '<p class="au-err" id="pwErr" hidden></p><p class="au-ok" id="pwOk" hidden></p>'
      + '<div class="au-row">' + (forced ? '' : '<button type="button" class="au-btn au-ghost" id="pwCancel">Đóng</button>') + '<button type="submit" class="au-btn" id="pwGo">Đổi mật khẩu</button></div></form>';
    document.body.appendChild(m);
    var close = function(){ if(m.parentNode) m.parentNode.removeChild(m); };
    var q = function(id){ return m.querySelector('#' + id); };
    if(!forced){
      q('pwCancel').addEventListener('click', close);
      m.addEventListener('mousedown', function(e){ if(e.target === m) close(); });
      m.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
    }
    (forced ? q('pwNew') : q('pwOld')).focus();
    m.querySelector('form').addEventListener('submit', async function(e){
      e.preventDefault();
      var o = q('pwOld').value, n = q('pwNew').value.trim(), n2 = q('pwNew2').value.trim(), er = q('pwErr'), ok = q('pwOk');
      er.hidden = true; ok.hidden = true;
      var msg = !o ? 'Nhập mật khẩu hiện tại.' : n.length < 8 ? 'Mật khẩu mới quá ngắn — tối thiểu 8 ký tự.' : n.length > 64 ? 'Mật khẩu mới quá dài — tối đa 64 ký tự.'
        : !TOKEN_OK.test(n) ? 'Chỉ dùng chữ không dấu, số và - _ . @ # !' : n !== n2 ? 'Hai lần nhập mật khẩu mới không giống nhau.' : '';
      if(msg){ er.textContent = msg; er.hidden = false; return; }
      q('pwGo').disabled = true;
      try{
        var r = await api.changePassword(o, n);
        if(!r || !r.ok){ er.textContent = (r && r.error) || 'Đổi mật khẩu thất bại.'; er.hidden = false; q('pwGo').disabled = false; return; }
        if(r.user){ user = r.user; applyUser(); }
        ok.textContent = r.pushed ? 'Đã đổi mật khẩu và cập nhật lên Google Sheet.' : ('Đã đổi mật khẩu trên máy. ' + (r.warning || ''));
        ok.hidden = false;
        // báo cho trang Tài khoản (nếu đang mở) đọc lại danh sách
        try{ var f = $('moduleSettingsFrame'); if(f && f.contentWindow) f.contentWindow.postMessage({ type:'kla-reload-accounts' }, '*'); }catch(x){} // cai-dat.js chuyển tiếp xuống khung Tài khoản
        setTimeout(close, forced ? 900 : 1800);
      }catch(x){ er.textContent = 'Đổi mật khẩu thất bại: ' + (x && x.message || x); er.hidden = false; q('pwGo').disabled = false; }
    });
  }

  // ---- Khởi động ----
  if(!api){ // mở ngoài Electron (xem thử giao diện): không có đăng nhập thật → để mở, không khóa
    document.body.classList.remove('kla-locked');
    user = { ten:'khach', tenHienThi:'Khách', quyen:'xem', pc:['M01','M02','M03','M04','M05','M06','M07','M08','M08RD','M09','M13','M14','M15','M17','M18','M19','M16','CD_SAOLUU','CD_KHOIPHUC','CD_DONGBO','TAIKHOAN'] };
    return;
  }
  lock();
  api.state().then(function(r){
    if(r && r.ok && r.user) unlock(r.user, true);
    else if(r && r.ok && r.setup) showSetup(r.setupInfo); // PC 7.95: máy chưa có tài khoản → Thiết lập máy mới (không đăng nhập)
  }, function(){});

  // PC 7.52 — QUYỀN ĐỔI KHI ĐANG ĐĂNG NHẬP (Quản trị tăng / giảm quyền, tắt hoặc xóa tài khoản): main.js báo → tự áp dụng, KHÔNG cần đăng xuất.
  //  · Bị tắt / bị xóa → về màn đăng nhập ngay.  · Còn lại → hiện thông báo ngắn rồi tải lại trang (giữ nguyên module đang xem nếu vẫn còn quyền).
  var permReloading = false;
  if(typeof api.onPermChanged === 'function') api.onPermChanged(function(d){
    if(permReloading || !user) return;
    if(d && d.removed){ refresh(); return; }
    permReloading = true;
    // index.js đã nhớ module đang mở trong sessionStorage('kla_open_module') → sau khi tải lại, unlock() mở lại đúng module (nếu còn quyền)
    var b = document.createElement('div'); // PC 7.53: 1 dòng nhỏ ở góc dưới trái (không dùng .au-toast vì CSS của nó có bottom → kéo dài hộp khi thêm top)
    b.style.cssText = 'position:fixed;left:14px;bottom:14px;top:auto;right:auto;height:auto;width:auto;transform:none;z-index:2147483600;'
      + 'padding:6px 12px;border-radius:8px;font:600 12px/1.4 system-ui,sans-serif;white-space:nowrap;max-width:calc(100vw - 28px);overflow:hidden;text-overflow:ellipsis;'
      + 'color:#fde68a;background:rgba(17,24,39,.94);border:1px solid rgba(253,224,71,.45);box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none';
    b.textContent = 'Quyền vừa thay đổi — đang tải lại…';
    document.body.appendChild(b);
    setTimeout(function(){ location.reload(); }, 2500);
  });
})();

// PC 7.4 — CHIP TÀI KHOẢN Ở MỌI TRANG: chip (#authChip) nằm ở tiêu đề trang chính; mỗi trang module / Cài đặt là view toàn màn hình phủ lên nên che mất chip.
// Mỗi thanh trên của view có 1 chỗ trống .au-slot; khi view nào được mở (style.display khác 'none') thì chuyển CHÍNH chip đó vào slot (giữ nguyên menu
// Đổi mật khẩu / Đăng xuất + sự kiện), không có view nào mở thì trả về tiêu đề trang chính (.hero-right).
(function(){
  'use strict';
  var chip = document.getElementById('authChip'); if(!chip) return;
  var home = chip.parentNode; // .hero-right của trang chính
  var views = Array.prototype.slice.call(document.querySelectorAll('[id$="View"][style*="position:fixed"]'));
  function placeAuthChip(){
    var open = null;
    views.forEach(function(v){ if(v.style.display !== 'none' && v.style.display !== '' ) open = v; });
    var slot = open && open.querySelector('[data-au-slot]');
    var target = slot || home;
    if(chip.parentNode !== target) target.appendChild(chip);
    var pop = document.getElementById('authPop'); if(pop && !pop.hidden){ pop.hidden = true; var t = document.getElementById('authTrigger'); if(t) t.setAttribute('aria-expanded', 'false'); }
  }
  var mo = new MutationObserver(placeAuthChip);
  views.forEach(function(v){ mo.observe(v, { attributes:true, attributeFilter:['style'] }); });
  placeAuthChip();
})();

/* 1.10 — chưa đăng nhập: cửa sổ nhỏ; đăng nhập xong: cửa sổ lớn (main.js › 'win:mode'). Chỉ gửi khi trạng thái đổi. */
(function(){
  var last = null;
  function sync(){
    var locked = document.body.classList.contains('kla-locked');
    if(locked === last) return; last = locked;
    try{ if(window.authAPI && window.authAPI.winMode) window.authAPI.winMode(locked); }catch(e){}
  }
  new MutationObserver(sync).observe(document.body, { attributes:true, attributeFilter:['class'] });
  sync();
})();
