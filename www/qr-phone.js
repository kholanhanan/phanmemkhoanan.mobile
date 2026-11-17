// qr-phone.js — màn "Tạo mã QR" trên điện thoại (ĐT 0.17): trang tao-ma-qr.html chạy trong iframe #qrFrame, nạp lười lần đầu mở.
// Cùng lõi với app PC (app/html/tao-ma-qr.html, M17). Lưu / chia sẻ file đi qua window.KLShare của app.js (trang con đọc window.parent.KLShare).
// Quyền: mã kho 'QR' (Cài đặt › Tài khoản › Kho điện thoại) — kiểm ở app.js › canQr. Không tải gì từ Web App.
(function () {
  'use strict';
  const V = '?v=1.01';
  let loaded = false;
  function layout() { // iframe nằm giữa thanh trên và thanh tab dưới
    const f = document.getElementById('qrFrame'); if (!f) return;
    const t = document.querySelector('.topbar'), b = document.querySelector('.tabbar');
    // ĐT 1.06: iframe là phần tử "thay thế" — đặt top + bottom mà height:auto thì KHÔNG giãn (chỉ cao 150px, màn Tạo mã QR bị cắt) → đặt chiều cao cụ thể.
    const top = t ? t.getBoundingClientRect().bottom : 0, bot = b ? Math.max(0, window.innerHeight - b.getBoundingClientRect().top) : 0;
    f.style.top = top + 'px'; f.style.bottom = 'auto'; f.style.height = Math.max(240, window.innerHeight - top - bot) + 'px';
  }
  window.addEventListener('resize', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  window.QrPhone = {
    show() {
      const f = document.getElementById('qrFrame'); if (!f) return;
      layout(); setTimeout(layout, 250);
      if (!loaded) { loaded = true; f.src = 'tao-ma-qr.html' + V; }
    },
    hide() { /* giữ nguyên dữ liệu đang nhập khi chuyển tab */ }
  };
})();
