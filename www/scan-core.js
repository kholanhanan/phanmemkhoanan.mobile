// scan-core.js — LÕI "Scan tài liệu" (module M15, PC 0.21 / ĐT 0.5). DÙNG CHUNG PC + điện thoại (chép y nguyên sang
// ban-dien-thoai/www/scan-core.js). Không có giao diện — giao diện ở scan-ui.js.
// Dựa trên bản thử "Scan Trắng" (ScanTrang-Electron) nhưng:
//   • làm trắng nền THẬT: ước lượng màu nền giấy theo từng vùng rồi chia ra → khử bóng tay / bóng đèn / giấy ngả vàng
//     (bản thử chỉ tăng tương phản + độ sáng toàn ảnh nên chỗ tối vẫn xám);
//   • xử lý từng điểm ảnh bằng mã riêng, KHÔNG dùng ctx.filter (iPhone / Safari cũ không hỗ trợ → ảnh không đổi);
//   • đọc PDF thật (pdf.js), nhiều trang / tài liệu, xuất PDF khổ A4 hoặc theo ảnh.
// Mọi xử lý chạy trên máy, không gửi ảnh đi đâu.
(function (global) {
  'use strict';
  if (global.KLScan) return;

  var MAX_SIDE = 2000;      // ảnh nguồn giữ tối đa (cạnh dài, px) — đủ nét cho chữ khổ A4
  var PDF_MAX_PAGES = 60;   // PDF dài hơn: chỉ lấy 60 trang đầu (máy yếu / điện thoại)

  // 4 chế độ — giá trị mặc định của 2 thanh trượt
  var MODES = {
    bw:  { ten: 'Trắng đen', tip: 'Chữ đen trên nền trắng tuyệt đối — rõ nhất, file nhỏ nhất (phiếu, hóa đơn, chứng từ)', contrast: 1.6, bright: 20 },
    xam: { ten: 'Xám',       tip: 'Giữ nét mờ / chữ ký / con dấu dạng xám, nền trắng', contrast: 1.4, bright: 15 },
    mau: { ten: 'Màu',       tip: 'Giữ màu con dấu đỏ / bút xanh, nền trắng', contrast: 1.25, bright: 10 },
    goc: { ten: 'Gốc',       tip: 'Không xử lý — chỉ xoay', contrast: 1, bright: 0 }
  };
  var BW_THRESHOLD = 170;   // Trắng đen: sau khi làm trắng + tăng tương phản, điểm sáng hơn mức này thành trắng

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function fitSize(w, h, max) { var k = Math.min(1, max / Math.max(w, h)); return { w: Math.round(w * k), h: Math.round(h * k) }; }

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
  function pdfToCanvases(file, ensurePdfJs, onProgress) {
    return Promise.resolve(ensurePdfJs()).then(function () {
      if (!global.pdfjsLib) throw new Error('Thiếu thư viện đọc PDF (pdf.js).');
      return file.arrayBuffer();
    }).then(function (buf) {
      return global.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (doc) {
      var n = Math.min(doc.numPages, PDF_MAX_PAGES), out = [], i = 0;
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

  // Ước lượng ĐỘ SÁNG NỀN GIẤY tại mỗi điểm: chia ảnh thành ô, lấy mức sáng ở BÁCH PHÂN VỊ 90 của mỗi ô (giấy chiếm phần lớn ô,
  // chữ chỉ là phần nhỏ → mức này là màu giấy, kể cả chỗ có bóng), thay những ô TỐI BẤT THƯỜNG so với ô lân cận (logo, ảnh, mảng chữ
  // đậm) bằng trung bình ô lân cận sáng, làm mượt, rồi nội suy về từng điểm. Không nới rộng kiểu "max" — chỗ bóng chuyển dần sẽ
  // bị ước nền quá sáng → còn vệt xám (thử: vùng bóng 226 → nay ≥ 245).
  function backgroundMap(lum, W, H) {
    var b = Math.max(8, Math.round(Math.max(W, H) / 40));
    var gw = Math.ceil(W / b), gh = Math.ceil(H / b), g = new Float32Array(gw * gh), hist = new Uint32Array(256), gx, gy, x, y, i;
    for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) {
      hist.fill(0); var cnt = 0, x1 = Math.min(W, (gx + 1) * b), y1 = Math.min(H, (gy + 1) * b);
      for (y = gy * b; y < y1; y += 2) { var row = y * W; for (x = gx * b; x < x1; x += 2) { hist[lum[row + x]]++; cnt++; } }
      var need = cnt * 0.1, acc = 0, v = 255;
      for (; v > 0; v--) { acc += hist[v]; if (acc >= need) break; }
      g[gy * gw + gx] = v;
    }
    // ô tối bất thường (< 80% ô sáng nhất quanh nó) → lấy trung bình các ô lân cận "bình thường"; lặp để lấp vùng tối lớn
    for (var it = 0; it < 6; it++) {
      var out = new Float32Array(g), changed = 0;
      for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) {
        var mx = 0, dy, dx, X, Y;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) { X = gx + dx; Y = gy + dy; if (X >= 0 && Y >= 0 && X < gw && Y < gh && g[Y * gw + X] > mx) mx = g[Y * gw + X]; }
        var me = g[gy * gw + gx]; if (me >= mx * 0.8) continue;
        var sum = 0, n = 0;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) { X = gx + dx; Y = gy + dy; if (X >= 0 && Y >= 0 && X < gw && Y < gh) { var w2 = g[Y * gw + X]; if (w2 >= mx * 0.8) { sum += w2; n++; } } }
        if (n) { out[gy * gw + gx] = sum / n; changed++; }
      }
      g = out; if (!changed) break;
    }
    // làm mượt 3×3 (trung bình) 1 lượt
    var sm = new Float32Array(gw * gh);
    for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) {
      var s2 = 0, n2 = 0;
      for (var ey = -1; ey <= 1; ey++) for (var ex = -1; ex <= 1; ex++) { var XX = gx + ex, YY = gy + ey; if (XX >= 0 && YY >= 0 && XX < gw && YY < gh) { s2 += g[YY * gw + XX]; n2++; } }
      sm[gy * gw + gx] = s2 / n2;
    }
    g = sm;
    for (i = 0; i < g.length; i++) if (g[i] < 60) g[i] = 60; // vùng rất tối (ảnh chụp, viền đen): không khuếch đại quá tay
    return { g: g, gw: gw, gh: gh, b: b };
  }

  // Xử lý 1 trang → canvas mới. opt: { rot, mode, contrast, bright, maxSide }
  function process(src, opt) {
    opt = opt || {};
    var c = rotate(scale(src, opt.maxSide), opt.rot || 0);
    var mode = MODES[opt.mode] ? opt.mode : 'xam';
    if (mode === 'goc') { if (c === src) { var cp = canvasOf(src.width, src.height); cp.getContext('2d').drawImage(src, 0, 0); return cp; } return c; }
    if (c === src) { var cc = canvasOf(src.width, src.height); cc.getContext('2d').drawImage(src, 0, 0); c = cc; }
    var W = c.width, H = c.height, ctx = c.getContext('2d'), id = ctx.getImageData(0, 0, W, H), d = id.data, n = W * H;
    var contrast = +opt.contrast || MODES[mode].contrast, kb = 1 + (opt.bright == null ? MODES[mode].bright : +opt.bright) / 100;
    var lum = new Uint8ClampedArray(n), i, p;
    for (i = 0, p = 0; i < n; i++, p += 4) lum[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    var bg = backgroundMap(lum, W, H), g = bg.g, gw = bg.gw, gh = bg.gh, b = bg.b;
    var x, y, k, v, color = mode === 'mau', bw = mode === 'bw';
    // Màu: CÂN MÀU GIẤY — đo màu trung bình của phần sáng nhất (giấy) rồi chia riêng từng kênh, để giấy ngả vàng / ánh đèn vàng
    // thành trắng mà con dấu đỏ, bút xanh vẫn giữ màu.
    var wr = 1, wg = 1, wb = 1;
    if (color) {
      var hst = new Uint32Array(256); for (i = 0; i < n; i += 3) hst[lum[i]]++;
      var tot = 0, cut = 255, need = Math.ceil(n / 3) * 0.3; for (; cut > 0; cut--) { tot += hst[cut]; if (tot >= need) break; }
      var sr = 0, sg = 0, sb = 0, sl = 0;
      for (i = 0, p = 0; i < n; i += 3, p += 12) if (lum[i] >= cut) { sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; sl += lum[i]; }
      if (sl > 0) { var cl = function (r) { return r < 0.7 ? 0.7 : r > 1.3 ? 1.3 : r; }; wr = cl(sr / sl); wg = cl(sg / sl); wb = cl(sb / sl); }
    }
    var wbal = [wr, wg, wb];
    for (y = 0; y < H; y++) {
      // nội suy song tuyến theo tâm ô
      var fy = (y + 0.5) / b - 0.5; if (fy < 0) fy = 0; if (fy > gh - 1) fy = gh - 1;
      var y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0, r0 = y0 * gw, r1 = y1 * gw;
      for (x = 0; x < W; x++) {
        var fx = (x + 0.5) / b - 0.5; if (fx < 0) fx = 0; if (fx > gw - 1) fx = gw - 1;
        var x0 = fx | 0, x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        var top = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * tx, bot = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * tx;
        k = 255 / (top + (bot - top) * ty);
        i = y * W + x; p = i * 4;
        if (color) {
          for (var ch = 0; ch < 3; ch++) {
            v = d[p + ch] * k / wbal[ch]; if (v > 255) v = 255;
            v = (255 - (255 - v) * contrast) * kb;       // mực đậm hơn theo "Tương phản", phần sáng đẩy về trắng theo "Độ sáng"
            d[p + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        } else {
          v = lum[i] * k; if (v > 255) v = 255;
          v = (255 - (255 - v) * contrast) * kb;
          if (bw) v = v >= BW_THRESHOLD ? 255 : 0;
          d[p] = d[p + 1] = d[p + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  // Xuất PDF. pages: [{ getSource: () => Promise<canvas>, rot, mode, contrast, bright }]; opt.format: 'a4' | 'fit'
  function buildPdf(pages, opt, ensureJsPdf, onProgress) {
    opt = opt || {};
    return Promise.resolve(ensureJsPdf()).then(function () {
      var J = global.jspdf && global.jspdf.jsPDF; if (!J) throw new Error('Thiếu thư viện tạo PDF (jsPDF).');
      var doc = null, i = 0, a4 = opt.format !== 'fit';
      function next() {
        if (i >= pages.length) return doc;
        var pg = pages[i++]; if (onProgress) onProgress(i, pages.length);
        return Promise.resolve(pg.getSource()).then(function (src) {
          var c = process(src, { rot: pg.rot, mode: pg.mode, contrast: pg.contrast, bright: pg.bright, maxSide: MAX_SIDE });
          var land = c.width > c.height, q = pg.mode === 'bw' ? 0.8 : 0.85;
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

  global.KLScan = {
    MODES: MODES, MAX_SIDE: MAX_SIDE,
    isPdf: isPdf, decodeImage: decodeImage, pdfToCanvases: pdfToCanvases,
    process: process, rotate: rotate, scale: scale, toBlob: toBlob, buildPdf: buildPdf, canvasOf: canvasOf
  };
})(window);
