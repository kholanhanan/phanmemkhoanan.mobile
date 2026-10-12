// scan-core.js — LÕI "Scan tài liệu" (M15, PC 0.22 / ĐT 0.7). DÙNG CHUNG PC + điện thoại (chép y nguyên sang
// ban-dien-thoai/www/scan-core.js). Không có giao diện — giao diện ở scan-ui.js.
// "Chụp tài liệu thông minh" gồm 3 bước, mọi xử lý chạy trên máy (không gửi ảnh đi đâu), không dùng ctx.filter / OpenCV:
//   Bước 1 — TỰ TÌM VÀ CẮT TRANG GIẤY (detectQuad → warp): tìm vùng giấy sáng lớn nhất, dò 4 cạnh bằng đường thẳng khớp theo
//            biên, nắn thẳng góc (phép biến đổi phối cảnh), loại bàn / nền đen / vật bên ngoài, cắt nốt mép tối (gáy lò xo, viền đen).
//   Bước 2 — KHỬ BÓNG + LÀM TRẮNG NỀN (backgroundMap → enhance): ước lượng độ sáng nền giấy bằng phép "đóng" hình thái học
//            (xóa nét chữ / ô li mảnh nhưng GIỮ nguyên mép bóng đổ) rồi chia ra → nền giấy xám / vùng bóng về trắng, nét chữ còn nguyên.
//   Bước 3 — BẢN IN: đưa nền về trắng, chữ về đen, tăng tương phản; có thể xóa ô li / dòng kẻ (giữ nét chữ cắt ngang); xuất ảnh / PDF.
// 4 chế độ: Màu · Trắng đen (ưu tiên, để photo) · Chữ tay · Tùy chỉnh (Gốc / Màu / Xám / Đen trắng + các thanh trượt).
(function (global) {
  'use strict';
  if (global.KLScan) return;

  var MAX_SIDE = 2600;      // ảnh nguồn giữ tối đa (cạnh dài, px) — nét cho chữ khổ A4 (PC 0.26 / ĐT 0.11: 2000 → 2600)
  var PDF_MAX_PAGES = 60;   // PDF dài hơn: chỉ lấy 60 trang đầu (máy yếu / điện thoại)

  // Thông số xử lý (mỗi trang có bản riêng): kieu = mau | xam | bw | goc · bong 0–100 (khử bóng) · trang 0–100 (độ trắng nền)
  // · dam 0–100 (độ đậm chữ) · li = xóa ô li / dòng kẻ · gam = độ đậm vùng chữ mờ (<1 đậm hơn).
  var MODES = {
    mau: { ten: 'Màu', full: 'Chế độ tài liệu màu', tip: 'Tài liệu màu: khử bóng, làm trắng nền, giữ màu con dấu đỏ / bút xanh / hình ảnh.',
           p: { kieu: 'mau', bong: 100, trang: 50, dam: 35, li: false, gam: 1 } },
    bw:  { ten: 'Trắng đen', full: 'Chế độ trắng đen để photo (ưu tiên)', tip: 'Ưu tiên để in / photo: nền trắng tuyệt đối, chữ đen đậm, tiết kiệm mực, file PDF nhỏ.',
           p: { kieu: 'bw', bong: 100, trang: 55, dam: 50, li: false, gam: 1 } },
    muc: { ten: 'Màu mực', full: 'Chế độ giữ màu mực', tip: 'Nền trắng tuyệt đối, chữ giữ ĐÚNG MÀU bút (đen / xanh / đỏ) và đậm, rõ nét — hợp phiếu viết nhiều màu mực.',
           p: { kieu: 'muc', bong: 100, trang: 55, dam: 50, li: false, gam: 1 } },
    tay: { ten: 'Chữ tay', full: 'Chế độ giữ nét chữ viết tay', tip: 'Vở / giấy ghi tay: giữ nét bút (cả nét mờ, bút chì), nền trắng, tự xóa ô li để chữ nổi rõ.',
           p: { kieu: 'xam', bong: 100, trang: 60, dam: 60, li: true, gam: 0.8 } },
    tuy: { ten: 'Tùy chỉnh', full: 'Chế độ tùy chỉnh', tip: 'Tự chọn kiểu (Gốc / Màu / Xám / Đen trắng) và chỉnh từng thanh trượt.',
           p: { kieu: 'xam', bong: 80, trang: 50, dam: 50, li: false, gam: 1 } }
  };
  var KIEU = { goc: 'Gốc', mau: 'Màu', muc: 'Màu mực', xam: 'Xám', bw: 'Đen trắng' };
  var DEFAULT_MODE = 'bw';

  function clampN(v, a, b) { v = +v; if (!(v === v)) v = a; return v < a ? a : v > b ? b : v; }
  // Thông số đầy đủ của 1 trang: mặc định của chế độ, đè bằng p (đã lưu / người dùng chỉnh). Tên chế độ cũ (xam, goc) tự đổi sang Tùy chỉnh.
  function resolveParams(mode, p) {
    var m = MODES[mode] ? mode : (mode === 'xam' || mode === 'goc' ? 'tuy' : DEFAULT_MODE), b = MODES[m].p, o = {}, k;
    if (mode === 'goc' && !(p && p.kieu)) p = Object.assign({}, p, { kieu: 'goc' });
    for (k in b) o[k] = (p && p[k] != null) ? p[k] : b[k];
    o.kieu = KIEU[o.kieu] ? o.kieu : b.kieu;
    o.bong = clampN(o.bong, 0, 100); o.trang = clampN(o.trang, 0, 100); o.dam = clampN(o.dam, 0, 100);
    o.gam = clampN(o.gam, 0.4, 1.6); o.li = !!o.li;
    return o;
  }

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function fitSize(w, h, max) { var k = Math.min(1, max / Math.max(w, h)); return { w: Math.round(w * k), h: Math.round(h * k) }; }
  function copyCanvas(src) { var c = canvasOf(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }

  function drawScaled(srcEl, w, h, max) {
    var s = fitSize(w, h, max || MAX_SIDE), c = canvasOf(s.w, s.h), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); // ảnh PNG trong suốt → nền trắng
    x.imageSmoothingQuality = 'high';
    x.drawImage(srcEl, 0, 0, c.width, c.height);
    return c;
  }
  // File ảnh → canvas (đã xoay đúng chiều theo EXIF, thu về ≤ MAX_SIDE)
  function decodeImage(blob) {
    if (global.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' }).then(function (bmp) {
        var c = drawScaled(bmp, bmp.width, bmp.height); try { bmp.close(); } catch (e) {} return c;
      }, function () { return decodeViaImg(blob); });
    }
    return decodeViaImg(blob);
  }
  function decodeViaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { var c = drawScaled(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); resolve(c); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh này (định dạng không hỗ trợ?).')); };
      img.src = url;
    });
  }

  function isPdf(file) { return /pdf$/i.test(file.type || '') || /\.pdf$/i.test(file.name || ''); }

  // PDF → mảng canvas (mỗi trang 1 canvas). ensurePdfJs: hàm của nơi gọi, nạp pdf.js (nạp lười).
  function pdfToCanvases(file, ensurePdfJs, onProgress, maxPages) {
    return Promise.resolve(ensurePdfJs()).then(function () {
      if (!global.pdfjsLib) throw new Error('Thiếu thư viện đọc PDF (pdf.js).');
      return file.arrayBuffer();
    }).then(function (buf) {
      return global.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (doc) {
      var n = Math.min(doc.numPages, maxPages > 0 ? maxPages : PDF_MAX_PAGES), out = [], i = 0;
      function next() {
        if (i >= n) return out;
        i++;
        if (onProgress) onProgress(i, n);
        return doc.getPage(i).then(function (page) {
          var vp1 = page.getViewport({ scale: 1 });
          var scale = Math.min(3, MAX_SIDE / Math.max(vp1.width, vp1.height));
          var vp = page.getViewport({ scale: scale }), c = canvasOf(vp.width, vp.height), x = c.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
          return page.render({ canvasContext: x, viewport: vp }).promise.then(function () { out.push(c); try { page.cleanup(); } catch (e) {} return next(); });
        });
      }
      return Promise.resolve(next()).then(function (r) { r.cutoff = doc.numPages > n ? doc.numPages : 0; try { doc.destroy(); } catch (e) {} return r; });
    });
  }

  function toBlob(canvas, type, q) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Không tạo được ảnh.')); }, type || 'image/jpeg', q == null ? 0.92 : q);
      else { try { var d = canvas.toDataURL(type || 'image/jpeg', q == null ? 0.92 : q); fetch(d).then(function (r) { return r.blob(); }).then(resolve, reject); } catch (e) { reject(e); } }
    });
  }

  function rotate(src, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (!deg) return src;
    var swap = deg === 90 || deg === 270, c = canvasOf(swap ? src.height : src.width, swap ? src.width : src.height), x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180);
    x.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }
  function scale(src, max) {
    if (!max || Math.max(src.width, src.height) <= max) return src;
    return drawScaled(src, src.width, src.height, max);
  }

  // ================================================================== bộ lọc dùng chung (ảnh nhỏ, Float32)
  // Làm mờ hộp (cửa sổ 2r+1, mép nhân đôi). Trả mảng mới.
  function boxBlur(a, w, h, r) {
    var t = new Float32Array(a.length), o = new Float32Array(a.length), x, y, s, win = 2 * r + 1, row;
    for (y = 0; y < h; y++) {
      row = y * w; s = 0;
      for (x = -r; x <= r; x++) s += a[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) { t[row + x] = s / win; s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) { o[y * w + x] = s / win; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
    }
    return o;
  }
  // Lọc cực đại / cực tiểu cửa sổ vuông bán kính R (mép nhân đôi).
  function rankFilter(a, w, h, R, isMax) {
    var t = new Float32Array(a.length), o = new Float32Array(a.length), x, y, k, v, m, q;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      m = a[y * w + x];
      for (k = -R; k <= R; k++) { q = x + k; q = q < 0 ? 0 : q >= w ? w - 1 : q; v = a[y * w + q]; if (isMax ? v > m : v < m) m = v; }
      t[y * w + x] = m;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      m = t[y * w + x];
      for (k = -R; k <= R; k++) { q = y + k; q = q < 0 ? 0 : q >= h ? h - 1 : q; v = t[q * w + x]; if (isMax ? v > m : v < m) m = v; }
      o[y * w + x] = m;
    }
    return o;
  }
  function lumOfData(d, n) {
    var lum = new Uint8ClampedArray(n), i, p;
    for (i = 0, p = 0; i < n; i += 1, p += 4) lum[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    return lum;
  }

  // ================================================================== BƯỚC 1 — tự tìm 4 góc trang giấy
  // Trả về 4 góc [TL, TR, BR, BL] dạng tỉ lệ 0–1 theo ảnh nguồn, hoặc null (không thấy rìa giấy: ảnh đã là trang giấy / bàn trắng cùng
  // màu giấy → người dùng chỉnh tay). Chỉ dựa vào độ sáng: giấy sáng hơn bàn / nền tối.
  // Với ngưỡng T: mặt nạ sáng → thành phần liên thông lớn nhất → bao lồi + 4 góc thô. Trả về null nếu không hợp lệ.
  function analyzePaper(f, w, h, T) {
    var n = w * h, i, x, y, mask = new Uint8Array(n), bright = 0;
    for (i = 0; i < n; i++) if (f[i] > T) { mask[i] = 1; bright++; }
    if (bright > n * 0.985 || bright < n * 0.12) return null;
    var lab = new Int32Array(n), stack = new Int32Array(n), bestLab = 0, bestSize = 0, cur = 0, sp, size, q, cx, cy;
    for (i = 0; i < n; i++) {
      if (!mask[i] || lab[i]) continue;
      cur++; sp = 0; size = 0; stack[sp++] = i; lab[i] = cur;
      while (sp) {
        q = stack[--sp]; size++; cx = q % w; cy = (q / w) | 0;
        if (cx > 0 && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = cur; stack[sp++] = q - 1; }
        if (cx < w - 1 && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = cur; stack[sp++] = q + 1; }
        if (cy > 0 && mask[q - w] && !lab[q - w]) { lab[q - w] = cur; stack[sp++] = q - w; }
        if (cy < h - 1 && mask[q + w] && !lab[q + w]) { lab[q + w] = cur; stack[sp++] = q + w; }
      }
      if (size > bestSize) { bestSize = size; bestLab = cur; }
    }
    if (bestSize < n * 0.12) return null;
    var pts = [];
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (lab[i] !== bestLab) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[i - 1] !== bestLab || lab[i + 1] !== bestLab || lab[i - w] !== bestLab || lab[i + w] !== bestLab) pts.push([x + 0.5, y + 0.5]);
    }
    var hull = convexHull(pts); if (hull.length < 4) return null;
    var hullArea = polyArea(hull), tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0], k, P;
    for (k = 1; k < hull.length; k++) { // 4 góc thô: cực trị theo 2 đường chéo
      P = hull[k];
      if (P[0] + P[1] < tl[0] + tl[1]) tl = P;
      if (P[0] - P[1] > tr[0] - tr[1]) tr = P;
      if (P[0] + P[1] > br[0] + br[1]) br = P;
      if (P[0] - P[1] < bl[0] - bl[1]) bl = P;
    }
    var rough = [tl, tr, br, bl], qa = polyArea(rough);
    if (!qa) return null;
    return { hull: hull, hullArea: hullArea, rough: rough, R: Math.min(1, qa / hullArea), A: hullArea / n, T: T };
  }
  // Dò giấy theo MÀU (PC 0.26 / ĐT 0.11): giấy gần như không có màu (độ bão hòa thấp) còn bàn gỗ / vải / da có màu rõ — tách được cả khi
  // bàn sáng gần bằng giấy hoặc ảnh có thêm vùng đen (một ngưỡng độ sáng như cách cũ sẽ coi bàn là giấy). Mốc so sánh = vùng GIỮA ảnh.
  // Bàn trắng / xám (cũng không màu) → vùng ra quá lớn → trả null để dùng cách theo độ sáng.
  function paperByColor(sd, lum, w, h) {
    var n = w * h, i, p, S = new Float32Array(n), L = new Float32Array(n), mx, mn;
    for (i = 0, p = 0; i < n; i++, p += 4) {
      mx = Math.max(sd[p], sd[p + 1], sd[p + 2]); mn = Math.min(sd[p], sd[p + 1], sd[p + 2]);
      S[i] = mx > 0 ? (mx - mn) / mx * 255 : 0; L[i] = lum[i];
    }
    S = boxBlur(boxBlur(S, w, h, 2), w, h, 2); L = boxBlur(boxBlur(L, w, h, 2), w, h, 2);
    var hs = new Uint32Array(256), hl = new Uint32Array(256), cnt = 0, x, y, v;
    for (y = Math.floor(h * 0.3); y < Math.ceil(h * 0.7); y++) for (x = Math.floor(w * 0.3); x < Math.ceil(w * 0.7); x++) { i = y * w + x; hs[Math.min(255, S[i] | 0)]++; hl[Math.min(255, L[i] | 0)]++; cnt++; }
    var acc = 0, sMed = 0, lMed = 0; for (v = 0; v < 256; v++) { acc += hs[v]; if (acc >= cnt / 2) { sMed = v; break; } }
    acc = 0; for (v = 0; v < 256; v++) { acc += hl[v]; if (acc >= cnt / 2) { lMed = v; break; } }
    if (sMed > 70 || lMed < 60) return null; // giữa ảnh không phải giấy trắng (màu / tối) → không dùng cách này
    var sT = Math.min(75, Math.max(30, sMed + 26)), lT = lMed * 0.55, f = new Float32Array(n), bright = 0;
    for (i = 0; i < n; i++) { f[i] = (S[i] < sT && L[i] > lT) ? 255 : 0; if (f[i]) bright++; }
    if (bright > n * 0.93 || bright < n * 0.15) return null;
    var cd = analyzePaper(f, w, h, 128);
    return (cd && cd.R >= 0.93 && cd.A < 0.93) ? cd : null;
  }
  // Dò giấy theo ĐỘ SÁNG (cách cũ): Otsu 2 lớp nền tối / giấy sáng — chỉ đúng khi nền chỉ có MỘT mức sáng (bàn trắng / đen).
  function paperByLum(f, w, h, n) {
    var i, t;
    // Otsu 2 lớp: nền tối / giấy sáng
    var hist = new Uint32Array(256);
    for (i = 0; i < n; i++) hist[f[i] | 0]++;
    var sumAll = 0; for (t = 0; t < 256; t++) sumAll += t * hist[t];
    var wB = 0, sumB = 0, best = -1, mBest = 0, mFbest = 0, mB, mF, wF, v;
    for (t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; wF = n - wB; if (!wF) break;
      sumB += t * hist[t]; mB = sumB / wB; mF = (sumAll - sumB) / wF;
      v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; mBest = mB; mFbest = mF; }
    }
    if (mFbest - mBest < 30) return null; // 2 lớp quá gần nhau → không phân biệt được giấy và nền
    // Thử nhiều mức ngưỡng (từ thấp → cao) rồi chọn mức cho tờ giấy "vuông vức" nhất: ngưỡng cao có thể loại mất phần giấy nằm trong
    // bóng đổ (hình thành đa giác méo), ngưỡng thấp có thể ăn lan sang bàn. Điểm = độ lấp đầy của bao lồi trong tứ giác 4 góc + diện tích.
    var fr = [0.04, 0.1, 0.18, 0.26, 0.34, 0.42], bestC = null, bestScore = -1, fi, T;
    for (fi = 0; fi < fr.length; fi++) {
      T = mBest + (mFbest - mBest) * fr[fi];
      var cd = analyzePaper(f, w, h, T);
      if (!cd) continue;
      var sc = cd.R * cd.R * cd.R + 0.3 * cd.A;
      if (cd.R >= 0.93 && sc > bestScore) { bestScore = sc; bestC = cd; }
    }
    return bestC;
  }
  function detectQuad(src) {
    var sm = drawScaled(src, src.width, src.height, 360), w = sm.width, h = sm.height, n = w * h, i, x, y;
    if (w < 24 || h < 24) return null;
    var sd = sm.getContext('2d').getImageData(0, 0, w, h).data, lum0 = lumOfData(sd, n), f = new Float32Array(n);
    for (i = 0; i < n; i++) f[i] = lum0[i];
    f = boxBlur(boxBlur(f, w, h, 2), w, h, 2); // xóa ô li, chữ, nhiễu → giấy thành mảng sáng liền
    var bestC = paperByColor(sd, lum0, w, h) || paperByLum(f, w, h, n);
    if (!bestC) return null;
    var hull = bestC.hull, hullArea = bestC.hullArea, rough = bestC.rough;
    var diag = Math.max(w, h), lines = [], s, fitted = true, k;
    // tinh chỉnh: mỗi cạnh = đường thẳng khớp (bình phương tối thiểu) các điểm biên nằm giữa cạnh → khôi phục cả góc bị bóng "ăn" mất
    var samples = [];
    for (k = 0; k < hull.length; k++) {
      var A = hull[k], B = hull[(k + 1) % hull.length], len = Math.max(1, Math.hypot(B[0] - A[0], B[1] - A[1])), steps = Math.ceil(len), u;
      for (u = 0; u < steps; u++) samples.push([A[0] + (B[0] - A[0]) * u / steps, A[1] + (B[1] - A[1]) * u / steps]);
    }
    for (s = 0; s < 4; s++) {
      var S0 = rough[s], S1 = rough[(s + 1) % 4], dx = S1[0] - S0[0], dy = S1[1] - S0[1], L = Math.hypot(dx, dy);
      if (L < 8) { fitted = false; break; }
      var ux = dx / L, uy = dy / L, sel = [];
      for (k = 0; k < samples.length; k++) {
        var px = samples[k][0] - S0[0], py = samples[k][1] - S0[1], tt = (px * ux + py * uy) / L, dd = Math.abs(px * uy - py * ux);
        if (tt > 0.15 && tt < 0.85 && dd < diag * 0.05) sel.push(samples[k]);
      }
      if (sel.length < 8) { fitted = false; break; }
      var mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
      for (k = 0; k < sel.length; k++) { mx += sel[k][0]; my += sel[k][1]; } mx /= sel.length; my /= sel.length;
      for (k = 0; k < sel.length; k++) { var ex = sel[k][0] - mx, ey = sel[k][1] - my; sxx += ex * ex; syy += ey * ey; sxy += ex * ey; }
      var ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      lines.push({ x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) });
    }
    var quad = rough;
    if (fitted && lines.length === 4) {
      var cand = [], ok = true;
      for (s = 0; s < 4; s++) {
        var l1 = lines[(s + 3) % 4], l2 = lines[s], den = l1.dx * l2.dy - l1.dy * l2.dx;
        if (Math.abs(den) < 1e-3) { ok = false; break; }
        var tq = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / den;
        cand.push([l1.x + l1.dx * tq, l1.y + l1.dy * tq]);
      }
      if (ok) {
        var ar = polyArea(cand);
        if (ar > hullArea * 0.85 && ar < hullArea * 1.3) quad = cand;
      }
    }
    quad = quad.map(function (p) { return [Math.min(w, Math.max(0, p[0])), Math.min(h, Math.max(0, p[1]))]; });
    var qa = polyArea(quad);
    if (qa < n * 0.15 || qa > n * 0.985 || !isConvex(quad)) return null;
    var q0 = quad.map(function (p) { return { x: p[0] / w, y: p[1] / h }; });
    var qt = trimDarkEdges(src, q0), m = 0.008; // co thêm 0,8% vào trong: bỏ mép giấy / viền bàn còn sót
    return [quadPoint(qt, m, m), quadPoint(qt, 1 - m, m), quadPoint(qt, 1 - m, 1 - m), quadPoint(qt, m, 1 - m)];
  }
  function polyArea(p) { var a = 0, i, j; for (i = 0; i < p.length; i++) { j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a) / 2; }
  function isConvex(p) {
    var sg = 0, i;
    for (i = 0; i < 4; i++) {
      var a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (!z) return false; if (!sg) sg = z > 0 ? 1 : -1; else if ((z > 0 ? 1 : -1) !== sg) return false;
    }
    return true;
  }
  function convexHull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var u = [], i, cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    for (i = 0; i < pts.length; i++) { while (u.length >= 2 && cross(u[u.length - 2], u[u.length - 1], pts[i]) <= 0) u.pop(); u.push(pts[i]); }
    var l = [];
    for (i = pts.length - 1; i >= 0; i--) { while (l.length >= 2 && cross(l[l.length - 2], l[l.length - 1], pts[i]) <= 0) l.pop(); l.push(pts[i]); }
    u.pop(); l.pop(); return u.concat(l);
  }
  // Điểm (u, v) ∈ [0,1]² của hình tứ giác q (nội suy song tuyến giữa 4 góc)
  function quadPoint(q, u, v) {
    var t = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u }, b = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    return { x: t.x + (b.x - t.x) * v, y: t.y + (b.y - t.y) * v };
  }
  // Cắt nốt các mép còn tối (gáy lò xo, viền bàn / nền đen sót lại): nắn thử ở độ phân giải thấp, bỏ dần từng hàng / cột sát mép
  // khi hàng đó phần lớn là điểm tối (so với độ sáng giấy ở giữa trang). Tối đa 12% mỗi cạnh; luôn chừa ~0.4% vào trong.
  function trimDarkEdges(src, q) {
    var sm = warp(src, q, 240), w = sm.width, h = sm.height, n = w * h;
    if (w < 40 || h < 40) return q;
    var lum = lumOfData(sm.getContext('2d').getImageData(0, 0, w, h).data, n), hist = new Uint32Array(256), cnt = 0, x, y;
    for (y = Math.floor(h * 0.25); y < Math.ceil(h * 0.75); y++) for (x = Math.floor(w * 0.25); x < Math.ceil(w * 0.75); x++) { hist[lum[y * w + x]]++; cnt++; }
    var acc = 0, med = 255, half = cnt / 2; for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= half) { med = v; break; } }
    var dk = med * 0.3, FR = 0.4; // chỉ coi là "đen" khi tối hơn hẳn giấy (bóng đổ ~50% độ sáng không bị cắt)
    var rowDark = function (yy) { var c = 0, xx; for (xx = 0; xx < w; xx++) if (lum[yy * w + xx] < dk) c++; return c / w; };
    var colDark = function (xx) { var c = 0, yy; for (yy = 0; yy < h; yy++) if (lum[yy * w + xx] < dk) c++; return c / h; };
    var t = 0, b = 0, l = 0, r = 0, mh = Math.floor(h * 0.12), mw = Math.floor(w * 0.12);
    while (t < mh && rowDark(t) > FR) t++;
    while (b < mh && rowDark(h - 1 - b) > FR) b++;
    while (l < mw && colDark(l) > FR) l++;
    while (r < mw && colDark(w - 1 - r) > FR) r++;
    t += 1; b += 1; l += 1; r += 1;
    var u0 = l / w, u1 = 1 - r / w, v0 = t / h, v1 = 1 - b / h;
    return [quadPoint(q, u0, v0), quadPoint(q, u1, v0), quadPoint(q, u1, v1), quadPoint(q, u0, v1)];
  }

  // Nắn thẳng góc: cắt tứ giác q (4 góc 0–1 theo ảnh nguồn: TL, TR, BR, BL) thành ảnh chữ nhật (phép biến đổi phối cảnh, nội suy song tuyến).
  function warp(src, q, maxSide) {
    var W0 = src.width, H0 = src.height, P = q.map(function (p) { return { x: p.x * W0, y: p.y * H0 }; });
    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
    var ow = (dist(P[0], P[1]) + dist(P[3], P[2])) / 2, oh = (dist(P[0], P[3]) + dist(P[1], P[2])) / 2;
    var k = Math.min(1, (maxSide || MAX_SIDE) / Math.max(ow, oh, 1));
    ow = Math.max(2, Math.round(ow * k)); oh = Math.max(2, Math.round(oh * k));
    var out = canvasOf(ow, oh), octx = out.getContext('2d'), od = octx.createImageData(ow, oh), o = od.data;
    var sd = src.getContext('2d').getImageData(0, 0, W0, H0).data;
    // giải 8 ẩn h0..h7: (x, y) trong ảnh ra → (X, Y) trong ảnh nguồn
    var dst = [[0, 0], [ow, 0], [ow, oh], [0, oh]], A = [], i, j, c;
    for (i = 0; i < 4; i++) {
      var x = dst[i][0], y = dst[i][1], X = P[i].x, Y = P[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]); A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
    }
    for (i = 0; i < 8; i++) {
      var piv = i; for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      var dv = A[i][i]; if (Math.abs(dv) < 1e-12) { return scale(src, maxSide); }
      for (c = i; c < 9; c++) A[i][c] /= dv;
      for (j = 0; j < 8; j++) if (j !== i) { var fct = A[j][i]; if (fct) for (c = i; c < 9; c++) A[j][c] -= fct * A[i][c]; }
    }
    var h0 = A[0][8], h1 = A[1][8], h2 = A[2][8], h3 = A[3][8], h4 = A[4][8], h5 = A[5][8], h6 = A[6][8], h7 = A[7][8];
    var yy, xx, p4 = 0;
    for (yy = 0; yy < oh; yy++) {
      var py = yy + 0.5;
      for (xx = 0; xx < ow; xx++, p4 += 4) {
        var px = xx + 0.5, den = h6 * px + h7 * py + 1, sx = (h0 * px + h1 * py + h2) / den - 0.5, sy = (h3 * px + h4 * py + h5) / den - 0.5;
        if (sx < 0) sx = 0; else if (sx > W0 - 1) sx = W0 - 1; if (sy < 0) sy = 0; else if (sy > H0 - 1) sy = H0 - 1;
        var x0 = sx | 0, y0 = sy | 0, x1 = x0 + 1 < W0 ? x0 + 1 : x0, y1 = y0 + 1 < H0 ? y0 + 1 : y0, tx = sx - x0, ty = sy - y0;
        var i00 = (y0 * W0 + x0) * 4, i10 = (y0 * W0 + x1) * 4, i01 = (y1 * W0 + x0) * 4, i11 = (y1 * W0 + x1) * 4;
        for (c = 0; c < 3; c++) {
          var a0 = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * tx, a1 = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * tx;
          o[p4 + c] = a0 + (a1 - a0) * ty;
        }
        o[p4 + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  // ================================================================== BƯỚC 2 — khử bóng, làm trắng nền
  // Ước lượng ĐỘ SÁNG NỀN GIẤY tại mỗi điểm (ảnh thu nhỏ ~600px): trung bình theo ô → phép "đóng" (cực đại rồi cực tiểu, cửa sổ ≈ 1.2%
  // cạnh ảnh) xóa mọi nét tối mảnh hơn cửa sổ (chữ, ô li) nhưng GIỮ NGUYÊN vị trí mép bóng đổ → không còn quầng tối viền bóng → làm mượt
  // nhẹ. Chia từng điểm cho mức này = nền giấy về đúng 255 dù bóng tay / bóng đèn / giấy ngả vàng / chụp lệch sáng.
  function backgroundMap(lum, W, H) {
    var M = Math.max(W, H), f = Math.max(1, Math.round(M / 600)), gw = Math.ceil(W / f), gh = Math.ceil(H / f);
    var g = new Float32Array(gw * gh), cn = new Float32Array(gw * gh), x, y, gi;
    for (y = 0; y < H; y++) { var gr = ((y / f) | 0) * gw; for (x = 0; x < W; x++) { gi = gr + ((x / f) | 0); g[gi] += lum[y * W + x]; cn[gi]++; } }
    for (gi = 0; gi < g.length; gi++) g[gi] /= cn[gi];
    var R = Math.max(2, Math.round(0.006 * M / f));
    g = rankFilter(rankFilter(g, gw, gh, R, true), gw, gh, R, false);
    g = boxBlur(g, gw, gh, 1);
    for (gi = 0; gi < g.length; gi++) if (g[gi] < 40) g[gi] = 40; // vùng rất tối (nền đen sót lại): không khuếch đại quá tay
    return { g: g, gw: gw, gh: gh, f: f };
  }

  // Mặt nạ Ô LI / DÒNG KẺ: đoạn thẳng ngang / dọc dài ≥ 5% cạnh ảnh và MẢNH (không phải mảng đen lớn) → bị xóa; điểm ảnh của đoạn
  // đó nằm sát nét chữ (chữ cắt ngang dòng kẻ) thì GIỮ LẠI để nét chữ không bị đứt. nv = độ sáng đã chuẩn hóa; thr = dưới mức này là "có mực".
  function lineMask(nv, W, H, thr) {
    var n = W * H, ink = new Uint8Array(n), lm = new Uint8Array(n), i, x, y;
    for (i = 0; i < n; i++) ink[i] = nv[i] < thr ? 1 : 0;
    var T = Math.max(3, Math.round(Math.max(W, H) * 0.004)), Lh = Math.max(40, Math.round(W * 0.05)), Lv = Math.max(40, Math.round(H * 0.05));
    var run = function (get, len, stride, lineLen, nbA, nbB, set) {
      // quét 1 hàng / cột: get(k) = có mực; chỉ ghi những đoạn dài ≥ lineLen và không nằm trong mảng dày
      var k = 0, st, en, gap, thick, j;
      while (k < len) {
        if (!get(k)) { k++; continue; }
        st = k; en = k; gap = 0; k++;
        while (k < len) { if (get(k)) { en = k; gap = 0; } else if (++gap > 4) break; k++; }
        if (en - st + 1 >= lineLen) {
          thick = 0; for (j = st; j <= en; j++) if (nbA(j) || nbB(j)) thick++;
          if (thick < (en - st + 1) * 0.4) for (j = st; j <= en; j++) set(j);
        }
        k = en + 1;
      }
    };
    for (y = 0; y < H; y++) (function (yy) {
      var row = yy * W, ya = yy - (T + 1), yb = yy + (T + 1);
      run(function (k) { return ink[row + k]; }, W, 1, Lh,
        function (k) { return ya >= 0 && ink[ya * W + k]; }, function (k) { return yb < H && ink[yb * W + k]; },
        function (k) { lm[row + k] = 1; });
    })(y);
    for (x = 0; x < W; x++) (function (xx) {
      var xa = xx - (T + 1), xb = xx + (T + 1);
      run(function (k) { return ink[k * W + xx]; }, H, W, Lv,
        function (k) { return xa >= 0 && ink[k * W + xa]; }, function (k) { return xb < W && ink[k * W + xb]; },
        function (k) { lm[k * W + xx] = 1; });
    })(x);
    // khôi phục điểm đường kẻ nằm sát nét chữ thật (mực không thuộc đường kẻ)
    var rm = new Uint8Array(lm);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      i = y * W + x; if (!lm[i]) continue;
      if ((x > 0 && ink[i - 1] && !lm[i - 1]) || (x < W - 1 && ink[i + 1] && !lm[i + 1]) || (y > 0 && ink[i - W] && !lm[i - W]) || (y < H - 1 && ink[i + W] && !lm[i + W])) rm[i] = 0;
    }
    return rm;
  }

  // ================================================================== BƯỚC 3 — bản in (làm trắng nền, chữ đen, tăng tương phản)
  function enhance(c, p) {
    var W = c.width, H = c.height, ctx = c.getContext('2d'), id = ctx.getImageData(0, 0, W, H), d = id.data, n = W * H;
    var i, x, y, ch, v, lum = lumOfData(d, n), mui = p.kieu === 'muc', color = p.kieu === 'mau' || mui, bw = p.kieu === 'bw';
    var s = p.bong / 100, bg = s > 0 ? backgroundMap(lum, W, H) : null;
    var nv = new Uint8ClampedArray(n), kk = color ? new Float32Array(n) : null;
    // chuẩn hóa độ sáng: nền giấy → 255 (bong = mức khử bóng 0–100%)
    for (y = 0; y < H; y++) {
      var r0, r1, ty = 0;
      if (bg) {
        var fy = (y + 0.5) / bg.f - 0.5; if (fy < 0) fy = 0; if (fy > bg.gh - 1) fy = bg.gh - 1;
        var y0 = fy | 0, y1 = Math.min(bg.gh - 1, y0 + 1); ty = fy - y0; r0 = y0 * bg.gw; r1 = y1 * bg.gw;
      }
      for (x = 0; x < W; x++) {
        var k = 1;
        if (bg) {
          var fx = (x + 0.5) / bg.f - 0.5; if (fx < 0) fx = 0; if (fx > bg.gw - 1) fx = bg.gw - 1;
          var x0 = fx | 0, x1 = Math.min(bg.gw - 1, x0 + 1), tx = fx - x0, g = bg.g;
          var top = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * tx, bot = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * tx, b = top + (bot - top) * ty;
          b = 255 + (b - 255) * s; k = 255 / b;
        }
        i = y * W + x; v = lum[i] * k; nv[i] = v > 255 ? 255 : v;
        if (kk) kk[i] = k;
      }
    }
    // điểm trắng (hi) / điểm đen (lo) / độ đậm vùng mờ (gam)
    var hi = 250 - 0.6 * p.trang, lo = 30 + 1.1 * p.dam; if (lo > hi - 12) lo = hi - 12;
    var lut = new Uint8Array(256), lutc = new Uint8Array(256), th = lo + 0.68 * (hi - lo), sw = 0.16 * (hi - lo), loC = lo * 0.45, t;
    var m0 = 1 - hi / 255, m1 = 1 - (lo + 0.45 * (hi - lo)) / 255; if (m1 < m0 + 0.05) m1 = m0 + 0.05; // chế độ Màu mực: mật độ mực dưới m0 → trắng, trên m1 → đậm hết
    for (v = 0; v < 256; v++) {
      t = (v - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t; if (p.gam !== 1) t = Math.pow(t, p.gam);
      if (bw) { t = (v - (th - sw)) / (2 * sw); t = t < 0 ? 0 : t > 1 ? 1 : t; lut[v] = Math.round(255 * t * t * (3 - 2 * t)); } // gần như đen / trắng nhưng mép nét mượt (không răng cưa, nét mảnh không đứt)
      else lut[v] = Math.round(255 * t);
      t = (v - loC) / (hi - loC); t = t < 0 ? 0 : t > 1 ? 1 : t; lutc[v] = Math.round(255 * t);
    }
    var rm = p.li ? lineMask(nv, W, H, Math.min(250, hi + 22)) : null;
    var wbal = [1, 1, 1];
    if (color) { // CÂN MÀU GIẤY: chia riêng từng kênh theo màu phần sáng nhất (giấy ngả vàng / đèn vàng → trắng; con dấu đỏ, bút xanh giữ màu)
      var hst = new Uint32Array(256); for (i = 0; i < n; i += 3) hst[nv[i]]++;
      var tot = 0, cut = 255, need = Math.ceil(n / 3) * 0.3; for (; cut > 0; cut--) { tot += hst[cut]; if (tot >= need) break; }
      var sr = 0, sg = 0, sb = 0, sl = 0, p4;
      for (i = 0, p4 = 0; i < n; i += 3, p4 += 12) if (nv[i] >= cut) { sr += d[p4] * kk[i]; sg += d[p4 + 1] * kk[i]; sb += d[p4 + 2] * kk[i]; sl += nv[i]; }
      if (sl > 0) { var cl = function (q) { return q < 0.7 ? 0.7 : q > 1.3 ? 1.3 : q; }; wbal = [cl(sr / sl), cl(sg / sl), cl(sb / sl)]; }
    }
    var o4;
    for (i = 0, o4 = 0; i < n; i++, o4 += 4) {
      if (rm && rm[i]) { d[o4] = d[o4 + 1] = d[o4 + 2] = 255; continue; }
      if (mui) { // MÀU MỰC: mật độ mực từng kênh D = 1 − sáng/255; giữ TỈ LỆ giữa 3 kênh (= màu bút), chỉ kéo mật độ chung lên đậm / xuống trắng
        var D0 = 1 - Math.min(255, d[o4] * kk[i] / wbal[0]) / 255, D1 = 1 - Math.min(255, d[o4 + 1] * kk[i] / wbal[1]) / 255, D2 = 1 - Math.min(255, d[o4 + 2] * kk[i] / wbal[2]) / 255;
        if (D0 < 0) D0 = 0; if (D1 < 0) D1 = 0; if (D2 < 0) D2 = 0;
        var dm = Math.max(D0, D1, D2), gn = 0;
        if (dm > m0) { t = (dm - m0) / (m1 - m0); t = t > 1 ? 1 : t; if (p.gam !== 1) t = Math.pow(t, p.gam); gn = t * t * (3 - 2 * t); gn /= dm; }
        D0 *= gn; D1 *= gn; D2 *= gn;
        d[o4] = Math.round(255 * (1 - (D0 > 1 ? 1 : D0))); d[o4 + 1] = Math.round(255 * (1 - (D1 > 1 ? 1 : D1))); d[o4 + 2] = Math.round(255 * (1 - (D2 > 1 ? 1 : D2)));
      } else if (color) {
        for (ch = 0; ch < 3; ch++) { v = d[o4 + ch] * kk[i] / wbal[ch]; v = v > 255 ? 255 : v < 0 ? 0 : v; d[o4 + ch] = lutc[v | 0]; }
      } else { v = lut[nv[i]]; d[o4] = d[o4 + 1] = d[o4 + 2] = v; }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  // Xử lý 1 trang → canvas mới. opt: { quad, rot, mode, p, maxSide } — quad: 4 góc cắt (0–1) hoặc rỗng = cả ảnh.
  function process(src, opt) {
    opt = opt || {};
    var maxSide = opt.maxSide || MAX_SIDE;
    var c = opt.quad ? warp(src, opt.quad, maxSide) : scale(src, maxSide);
    c = rotate(c, opt.rot || 0);
    if (c === src) c = copyCanvas(src);
    var p = resolveParams(opt.mode, opt.p);
    if (p.kieu === 'goc') return c;
    return enhance(c, p);
  }

  // Xuất PDF. pages: [{ getSource: () => Promise<canvas>, quad, rot, mode, p }]; opt.format: 'a4' | 'fit'
  function buildPdf(pages, opt, ensureJsPdf, onProgress) {
    opt = opt || {};
    return Promise.resolve(ensureJsPdf()).then(function () {
      var J = global.jspdf && global.jspdf.jsPDF; if (!J) throw new Error('Thiếu thư viện tạo PDF (jsPDF).');
      var doc = null, i = 0, a4 = opt.format !== 'fit';
      function next() {
        if (i >= pages.length) return doc;
        var pg = pages[i++]; if (onProgress) onProgress(i, pages.length);
        return Promise.resolve(pg.getSource()).then(function (src) {
          var c = process(src, { quad: pg.quad, rot: pg.rot, mode: pg.mode, p: pg.p, maxSide: MAX_SIDE });
          var land = c.width > c.height, q = resolveParams(pg.mode, pg.p).kieu === 'bw' ? 0.8 : 0.85;
          var url = c.toDataURL('image/jpeg', q);
          var pw, ph, w, h, x0, y0;
          if (a4) { pw = land ? 297 : 210; ph = land ? 210 : 297; var k = Math.min(pw / c.width, ph / c.height); w = c.width * k; h = c.height * k; x0 = (pw - w) / 2; y0 = (ph - h) / 2; }
          else { pw = c.width * 0.75; ph = c.height * 0.75; w = pw; h = ph; x0 = 0; y0 = 0; }
          var unit = a4 ? 'mm' : 'pt', orient = land ? 'l' : 'p';
          if (!doc) doc = new J({ orientation: orient, unit: unit, format: a4 ? 'a4' : [pw, ph], compress: true });
          else doc.addPage(a4 ? 'a4' : [pw, ph], orient);
          doc.addImage(url, 'JPEG', x0, y0, w, h, undefined, 'FAST');
          c.width = c.height = 1; // nhả bộ nhớ sớm (điện thoại)
          return next();
        });
      }
      return next();
    }).then(function (doc) {
      if (opt.title) try { doc.setProperties({ title: opt.title, creator: 'Kho Lạnh — Scan tài liệu' }); } catch (e) {}
      return doc.output('blob');
    });
  }

  // Khung cắt mặc định để người dùng tự kéo 4 góc (khi không tự tìm được trang): chừa 6% mỗi cạnh.
  function defaultQuad() { return [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }]; }

  global.KLScan = {
    MODES: MODES, KIEU: KIEU, DEFAULT_MODE: DEFAULT_MODE, MAX_SIDE: MAX_SIDE, resolveParams: resolveParams,
    isPdf: isPdf, decodeImage: decodeImage, pdfToCanvases: pdfToCanvases,
    detectQuad: detectQuad, defaultQuad: defaultQuad, warp: warp,
    process: process, rotate: rotate, scale: scale, toBlob: toBlob, buildPdf: buildPdf, canvasOf: canvasOf,
    _t: { backgroundMap: backgroundMap, lineMask: lineMask, enhance: enhance } // dùng cho kiểm thử
  };
})(window);
