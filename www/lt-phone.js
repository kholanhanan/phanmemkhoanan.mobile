// lt-phone.js — màn "Lưu trữ cá nhân" trên điện thoại (ĐT 1.02): luu-tru.html chạy trong iframe #ltFrame, nạp lười lần đầu mở.
// Giao diện dùng chung với PC (lt-ui.js); dữ liệu + đồng bộ ở lt-backend.js (IndexedDB, LAN → Drive). Quyền: mã kho 'LT' (app.js › canLt). Kết nối lấy qua window.LTHost (app.js).
(function () {
  'use strict';
  const V = '?v=1.02-20261015';
  let loaded = false;
  function layout() { // iframe nằm giữa thanh trên và thanh tab dưới
    const f = document.getElementById('ltFrame'); if (!f) return;
    const t = document.querySelector('.topbar'), b = document.querySelector('.tabbar');
    f.style.top = (t ? t.getBoundingClientRect().bottom : 0) + 'px';
    f.style.bottom = (b ? Math.max(0, window.innerHeight - b.getBoundingClientRect().top) : 0) + 'px';
  }
  window.addEventListener('resize', layout);
  window.LtPhone = {
    show() {
      const f = document.getElementById('ltFrame'); if (!f) return;
      layout();
      if (!loaded) { loaded = true; f.src = 'luu-tru.html' + V; }
    },
    hide() { /* giữ nguyên trạng thái khi chuyển tab */ }
  };
})();
