/* ui-scale.js — Cỡ chữ của app điện thoại, chỉnh theo % (Cài đặt › Cỡ chữ).
   Mọi cỡ chữ trong CSS là calc(Npx * var(--fs, 1)); file này chỉ việc đặt --fs = % / 100 lên <html>.
   Lưu ở localStorage 'klanan.fontScale' (số nguyên %, 80–150, mặc định 100). Nạp ĐẦU TIÊN trong <head> của mọi trang
   (index.html + các trang chạy trong iframe: luu-tru.html, tao-ma-qr.html) để chữ đúng cỡ ngay từ lúc vẽ trang, không nháy. */
(function () {
  var KEY = 'klanan.fontScale', MIN = 80, MAX = 150, DEF = 100;
  function clamp(v) { v = Math.round(Number(v)); return isFinite(v) ? Math.min(MAX, Math.max(MIN, v)) : DEF; }
  function read() { try { var v = localStorage.getItem(KEY); return v == null ? DEF : clamp(v); } catch (e) { return DEF; } }
  function paint(doc, pct) { try { doc.documentElement.style.setProperty('--fs', String(pct / 100)); } catch (e) { /* bỏ qua */ } }
  function paintAll(pct) {
    paint(document, pct);
    var fr = document.getElementsByTagName('iframe');
    for (var i = 0; i < fr.length; i++) { try { if (fr[i].contentDocument) paint(fr[i].contentDocument, pct); } catch (e) { /* khác nguồn: bỏ qua */ } }
  }
  var cur = read();
  paint(document, cur);
  window.KLFontScale = {
    MIN: MIN, MAX: MAX, DEF: DEF,
    get: function () { return cur; },
    set: function (v, save) {
      cur = clamp(v); paintAll(cur);
      if (save !== false) { try { localStorage.setItem(KEY, String(cur)); } catch (e) { /* bỏ qua */ } }
      try { window.dispatchEvent(new CustomEvent('klfontscale', { detail: cur })); } catch (e) { /* bỏ qua */ }
      return cur;
    }
  };
  // Trang con (iframe) mở sau: tự nhận cỡ hiện tại khi tải xong; trang khác đổi cỡ → cập nhật theo.
  window.addEventListener('storage', function (e) { if (e.key === KEY) { cur = read(); paintAll(cur); } });
  document.addEventListener('DOMContentLoaded', function () { paintAll(cur); });
})();
