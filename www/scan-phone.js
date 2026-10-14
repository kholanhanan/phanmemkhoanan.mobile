// scan-phone.js — tab "Scan" trên điện thoại (ĐT 0.7): chụp / chọn ảnh hoặc PDF → tự cắt trang, khử bóng, làm trắng nền → lưu / chia sẻ PDF.
// Chỉ là phần nối: lõi + giao diện DÙNG CHUNG với PC (scan-core.js, scan-ui.js, scan.css — chép y nguyên từ app/html/).
// Nạp lười: lần đầu mở tab mới nạp scan-core.js + scan-ui.js; jsPDF / pdf.js nạp khi lưu PDF / chọn file PDF.
// Quyền: mã kho 'SCAN' (Cài đặt › Tài khoản › Kho điện thoại) — kiểm ở app.js › canScan.
(function () {
  'use strict';
  const V = '?v=1.01';
  const loading = {};
  function loadScript(src) {
    if (!loading[src]) {
      loading[src] = new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = src + V;
        s.onload = res; s.onerror = () => { delete loading[src]; rej(new Error('Không nạp được ' + src + ' — mở lại app khi có mạng để tải bản cập nhật.')); };
        document.head.appendChild(s);
      });
    }
    return loading[src];
  }
  async function ensure(name) {
    if (name === 'pdfjs') {
      if (!window.pdfjsLib) await loadScript('lib/pdf.min.js');
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js' + V; } catch (e) { /* bỏ qua */ }
      return;
    }
    if (name === 'jszip') { if (!window.JSZip) await loadScript('lib/jszip.min.js'); return; }
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript('lib/jspdf.umd.min.js');
  }
  const share = () => window.KLShare || {};
  let mounted = null, mounting = null;
  async function mount() {
    const root = document.getElementById('scanRoot'); if (!root) return;
    try {
      await loadScript('scan-core.js'); await loadScript('scan-ui.js');
      mounted = window.KLScanUI.mount(root, {
        platform: 'phone', camera: true, ensure,
        toast: (m, bad) => (share().toast ? share().toast(m, bad) : alert(m)),
        save: (blob, name) => share().saveToPhone({ blob, name, mime: blob.type || 'application/pdf' }),
        share: (blob, name) => share().shareFile({ blob, name, mime: blob.type || 'application/pdf' })
      });
    } catch (e) {
      root.innerHTML = '<p style="padding:16px;color:var(--red)">' + String(e.message || e).replace(/[<>&]/g, '') + '</p>';
    }
  }
  window.ScanPhone = {
    show() { if (!mounted && !mounting) mounting = mount().finally(() => { mounting = null; }); },
    hide() { /* giữ nguyên các trang đang làm khi chuyển tab */ },
    busy() { return !!(window.__klaBusy && window.__klaBusy()); }
  };
})();
