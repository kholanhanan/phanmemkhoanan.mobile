/* TRANG "CÔNG CỤ" (PC 0.67) — vẽ bảng thẻ công cụ, bấm thẻ → mở module tương ứng ở trang chính.
   THÊM CÔNG CỤ MỚI: (1) khai báo module trong js/index.js › MODS (g:'gold'); (2) thêm mã quyền vào auth-gate.js › TOOL_CODES;
   (3) thêm 1 phần tử vào TOOLS bên dưới (module = key trong MODS, perm = mã quyền, hue = độ màu 0–360, icon = nội dung <svg> 24×24 nét 1.8). */
(function(){
  'use strict';
  var TOOLS = [
    { module:'module15', perm:'M15', code:'M15', hue:155, name:'Scan tài liệu',
      desc:'Chụp hoặc chọn ảnh / PDF, tự cắt trang, khử bóng, làm trắng nền rồi xuất PDF để in hoặc lưu.',
      icon:'<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9h8M8 12h8M8 15h5"/>' },
    { module:'module14', perm:'M14', code:'M14', hue:190, name:'Container 3D',
      desc:'Xếp hàng vào container trên mô hình 3D, chia dãy, chia hàng mẫu và xem sơ đồ chất hàng.',
      icon:'<path d="M12 2.5 21 7v10l-9 4.5L3 17V7z"/><path d="M3 7l9 4.5L21 7M12 11.5v10"/>' },
    { module:'module18', perm:'M17', code:'M17', hue:285, name:'Tạo mã QR',
      desc:'Tạo mã QR đơn lẻ (văn bản, liên kết, Wi-Fi…), hàng loạt từ Excel / CSV xuất ZIP, và in tem QR trên giấy A4. Chạy offline.',
      icon:'<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M7 7h.01M17 7h.01M7 17h.01M14 14h2.5v2.5M20 14v.01M14 20h.01M17.5 20H20v-3.5"/>' },
    { module:'module19', perm:'M18', code:'M18', hue:35, name:'Quản lý file',
      desc:'Đổi tên hàng loạt, sắp xếp file theo loại / ngày, tìm file trùng và chuyển vào thùng rác. Xem trước, hoàn tác được; chỉ làm trong thư mục bạn chọn.',
      icon:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8M8 16h5"/>' },
    { module:'module20', perm:'M19', code:'M19', hue:200, name:'Lưu trữ cá nhân',
      desc:'Khung chat riêng để lưu tin nhắn, ảnh, file và tài liệu của chính bạn, chia theo ngăn, tìm nhanh, đồng bộ lên điện thoại qua mạng LAN và Google Drive.',
      icon:'<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1 .5 7.97V16.5"/><path d="M8 18h9.5"/>' }
  ];

  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }

  // Quyền: hỏi trang chính (auth-gate.js › KLA_AUTH). Không hỏi được thì cứ hiện thẻ — trang chính vẫn chặn lúc mở.
  function can(code){
    try { var a = window.parent && window.parent !== window && window.parent.KLA_AUTH; if (a && typeof a.can === 'function') return !!a.can(code); } catch (e) {}
    return true;
  }

  function render(){
    var grid = document.getElementById('ccGrid'), list = TOOLS.filter(function(t){ return can(t.perm); });
    grid.innerHTML = list.map(function(t){
      return '<button type="button" class="cc-card" data-module="' + esc(t.module) + '" style="--h:' + t.hue + '" aria-label="Mở ' + esc(t.name) + '">'
        + '<span class="cc-top"><span class="cc-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.icon + '</svg></span>'
        + '<span class="cc-code">' + esc(t.code) + '</span></span>'
        + '<span><h2 class="cc-name">' + esc(t.name) + '</h2><p class="cc-desc">' + esc(t.desc) + '</p></span>'
        + '<span class="cc-go">Mở công cụ ' + ARROW + '</span></button>';
    }).join('') + (list.length ? '<div class="cc-soon">' + PLUS + '<span>Công cụ mới sẽ được thêm vào đây</span></div>' : '');
    document.getElementById('ccEmpty').hidden = list.length > 0;
  }

  document.getElementById('ccGrid').addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('.cc-card'); if (!b) return;
    try { window.parent.postMessage({ type:'openModule', module:b.dataset.module }, '*'); } catch (e) {}
  });
  // Đăng nhập xong / đổi quyền: trang chính gửi kla-refresh (module17 có refresh) → vẽ lại theo quyền mới.
  window.addEventListener('message', function(ev){ var d = ev.data; if (d && (d.type === 'kla-refresh' || d.type === 'kla-auth-refresh')) render(); });
  render();
})();
