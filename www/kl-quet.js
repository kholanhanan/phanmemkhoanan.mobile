/* QUÉT MÃ THÔNG MINH — MÀN HÌNH QUÉT DÙNG CHUNG (PC 4.51 / ĐT 1.30): camera trực tiếp (getUserMedia) + quét từ ảnh / dán / kéo thả.
   Đọc được: QR, Data Matrix, Aztec, PDF417, Code 128 / 39 / 93, EAN-8 / EAN-13, UPC-A / UPC-E, ITF, Codabar, RSS-14 (ZXing, chạy trong máy — KHÔNG gửi ảnh đi đâu).
   Nhận dạng loại nội dung (liên kết, Wi-Fi, danh bạ, GS1…): kl-quet-core.js. Bản điện thoại: www/kl-quet.js GIỐNG HỆT (sửa 1 nơi thì chép sang nơi kia).
   Dùng:  KlQuet.open({ title, mode: 'confirm' | 'fill', actionLabel, onPick(value, info, raw) })
     mode 'confirm' = hiện thẻ kết quả (loại · nội dung · ô sửa) để người dùng bấm xác nhận (ô tìm kiếm điện thoại).
     mode 'fill'    = quét được là trả ngay về onPick và đóng (ô nội dung trong công cụ Mã QR).
     Công tắc "Quét liên tục" (mặc định TẮT): không đóng, gom danh sách mã (bỏ trùng); mỗi dòng có nút chọn.
   Cấu hình đường dẫn thư viện:  KlQuet.config({ zx: 'đường-dẫn/zxing-library.js' }) (mặc định ../../lib/zxing-library.js so với file này (PC: html/js → lib)). */
(function () {
  'use strict';
  const Core = window.KlQuetCore;
  const SELF = (document.currentScript && document.currentScript.src) || location.href;
  let cfg = { zx: new URL('../../lib/zxing-library.js', SELF).href };
  const loadScript = (url) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => no(new Error('Không nạp được bộ đọc mã (' + url + ').')); document.head.appendChild(s); });
  let zxP = null; const ensureZX = () => { if (window.ZXing) return Promise.resolve(); if (!zxP) zxP = loadScript(cfg.zx).catch((e) => { zxP = null; throw e; }); return zxP; };

  // ---------------------------------------------------------------- giải mã 1 khung hình (ImageData → { text, format } | null)
  let reader = null;
  function getReader() {
    if (reader) return reader; const Z = window.ZXing, h = new Map(), F = Z.BarcodeFormat;
    h.set(Z.DecodeHintType.TRY_HARDER, true);
    h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.QR_CODE, F.DATA_MATRIX, F.AZTEC, F.PDF_417, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.RSS_14]);
    reader = new Z.MultiFormatReader(); reader.setHints(h); return reader;
  }
  function decodeImageData(id) {
    const Z = window.ZXing, r = getReader(), d = id.data, n = id.width * id.height, lum = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) lum[i] = (d[j] * 306 + d[j + 1] * 601 + d[j + 2] * 117) >> 10;
    const src = new Z.RGBLuminanceSource(lum, id.width, id.height);
    for (const s of [src, src.invert()]) { try { const res = r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(s))); return { text: res.getText(), format: res.getBarcodeFormat() }; } catch (e) { /* chưa thấy mã ở khung này */ } }
    return null;
  }
  // ảnh tĩnh: thử nhiều cỡ (mã nhỏ trong ảnh lớn / ảnh quá lớn làm chậm)
  async function decodeBitmap(bmp) {
    const w0 = bmp.width, h0 = bmp.height;
    for (const side of [1600, 1000, 2400, 640]) {
      const k = Math.min(1, side / Math.max(w0, h0)); if (side === 2400 && k >= 1 && Math.max(w0, h0) <= 1600) continue;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k)); const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      const r = decodeImageData(g.getImageData(0, 0, c.width, c.height)); if (r) return r; await new Promise((x) => setTimeout(x, 0));
    }
    return null;
  }
  async function decodeFile(file) {
    await ensureZX(); let bmp; try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('Không mở được ảnh "' + (file.name || '') + '".'); }
    try { return await decodeBitmap(bmp); } finally { if (bmp.close) bmp.close(); }
  }

  // ---------------------------------------------------------------- giao diện
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = `
.klq{position:fixed;inset:0;z-index:2147483000;background:#0e1013;color:#f1f3f5;display:flex;flex-direction:column;font:15px/1.4 system-ui,"Segoe UI",Roboto,Arial,sans-serif;padding-top:env(safe-area-inset-top,0);padding-bottom:env(safe-area-inset-bottom,0)}
.klq *{box-sizing:border-box}
.klq [hidden]{display:none!important}
.klq-top{display:flex;align-items:center;gap:10px;padding:10px 12px}.klq-top b{flex:1;font-size:16px}
.klq-x{border:0;background:#2a2f36;color:#fff;width:38px;height:38px;border-radius:50%;font-size:20px;cursor:pointer}
.klq-vw{position:relative;flex:1 1 40%;min-height:180px;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center}
.klq-vw video{width:100%;height:100%;object-fit:cover}
.klq-fr{position:absolute;left:50%;top:50%;width:min(62%,300px);aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none}
.klq-fr i{position:absolute;width:26px;height:26px;border:4px solid #5DCAA5}
.klq-fr i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.klq-fr i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}.klq-fr i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.klq-fr i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
.klq-fr u{position:absolute;left:8px;right:8px;top:50%;height:2px;background:#5DCAA5;opacity:.85;animation:klqs 2s ease-in-out infinite}
@keyframes klqs{0%,100%{top:12%}50%{top:88%}}
.klq-hint{position:absolute;left:0;right:0;bottom:10px;text-align:center;font-size:13px;color:#e4e6e8;text-shadow:0 1px 3px #000;padding:0 12px}
.klq-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#e4e6e8;background:#16191d}
.klq-bar{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;align-items:center}
.klq-bt{border:1px solid #3b424b;background:#20252b;color:#f1f3f5;border-radius:9px;padding:8px 12px;font-size:14px;cursor:pointer}
.klq-bt:disabled{opacity:.4}.klq-bt.on{background:#2F5FD0;border-color:#2F5FD0}.klq-bt.pri{background:#2F5FD0;border-color:#2F5FD0;font-weight:600}
.klq-sw{display:inline-flex;align-items:center;gap:7px;font-size:14px;margin-left:auto;cursor:pointer}.klq-sw input{width:18px;height:18px;accent-color:#5DCAA5}
.klq-pn{flex:0 1 auto;max-height:46%;overflow:auto;padding:0 12px 12px}
.klq-cd{background:#1b1f24;border:1px solid #333a43;border-radius:12px;padding:12px;margin-bottom:8px}
.klq-ch{display:inline-block;font-size:12px;background:#17382b;color:#7fe0b6;border-radius:6px;padding:2px 8px;margin-right:6px}
.klq-ch.f{background:#26303d;color:#a9c4f0}
.klq-tx{margin:8px 0;word-break:break-word;white-space:pre-wrap;font-size:14px;color:#e9ebed;max-height:7.5em;overflow:auto}
.klq-in{width:100%;border:1px solid #4a525c;background:#0e1013;color:#fff;border-radius:8px;padding:9px 10px;font-size:15px;margin:2px 0 8px}
.klq-ac{display:flex;gap:8px;flex-wrap:wrap}
.klq-ac .klq-bt{flex:0 0 auto}
.klq-ls .klq-cd{padding:9px 10px}.klq-ls .klq-tx{margin:4px 0 6px;max-height:3.6em}
.klq-no{color:#f0a0a0;font-size:13px;margin:4px 0}
@media (min-width:900px){.klq-vw{flex-basis:50%}.klq-pn{max-width:760px;width:100%;margin:0 auto}}
`; document.head.appendChild(s);
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function beep() { try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const c = new A(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1000; g.gain.value = 0.15; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 110); } catch (e) { /* bỏ qua */ } try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(60); } catch (e) { /* bỏ qua */ } }
  function copyText(t) { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;left:-999px'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* bỏ qua */ } ta.remove(); return ok; }

  let active = null;
  function open(opts) {
    if (active) return active; opts = opts || {}; css();
    const mode = opts.mode === 'fill' ? 'fill' : 'confirm', actionLabel = opts.actionLabel || (mode === 'fill' ? 'Dùng mã này' : 'Chọn');
    const ov = document.createElement('div'); ov.className = 'klq'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', opts.title || 'Quét mã');
    ov.innerHTML = '<div class="klq-top"><b>' + esc(opts.title || 'Quét mã') + '</b><button type="button" class="klq-x" data-a="close" aria-label="Đóng">✕</button></div>'
      + '<div class="klq-vw"><video playsinline muted autoplay></video><div class="klq-fr"><i></i><i></i><i></i><i></i><u></u></div><div class="klq-hint">Đưa mã QR hoặc mã vạch vào khung</div><div class="klq-msg" hidden></div></div>'
      + '<div class="klq-bar"><button type="button" class="klq-bt" data-a="torch" hidden>Đèn</button><button type="button" class="klq-bt" data-a="flip" hidden>Đổi camera</button><button type="button" class="klq-bt" data-a="img">Từ ảnh</button><label class="klq-sw"><input type="checkbox" data-a="multi"> Quét liên tục</label></div>'
      + '<div class="klq-pn" id="klqPn"></div><input type="file" accept="image/*" multiple hidden data-a="file">';
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s), video = $('video'), msg = $('.klq-msg'), hint = $('.klq-hint'), pn = $('#klqPn');
    const st = { stream: null, track: null, devs: [], di: -1, torch: false, multi: false, paused: false, closed: false, busy: false, list: [], raf: 0, last: 0, canvas: document.createElement('canvas') };
    const showMsg = (t) => { msg.hidden = !t; msg.textContent = t || ''; };

    function close() {
      if (st.closed) return; st.closed = true; cancelAnimationFrame(st.raf); try { if (st.stream) st.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* bỏ qua */ }
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('paste', onPaste, true); ov.remove(); active = null; if (opts.onClose) try { opts.onClose(); } catch (e) { /* bỏ qua */ }
    }
    function pick(value, info, raw) { close(); try { opts.onPick && opts.onPick(value, info, raw); } catch (e) { /* lỗi của bên gọi không làm treo màn hình */ } }
    function onKey(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);

    // ---- kết quả
    function addResult(res) {
      const info = Core.classify(res.text, res.format), item = { text: res.text, info };
      if (mode === 'fill' && !st.multi) { beep(); pick(res.text, info, res.text); return true; }
      if (st.multi) { if (!Core.addUnique(st.list, item)) return false; beep(); drawList(); return true; }
      beep(); st.paused = true; drawCard(item); return true;
    }
    const chips = (info) => '<span class="klq-ch">' + esc(info.label) + '</span>' + (info.fmt && info.fmt !== info.label ? '<span class="klq-ch f">' + esc(info.fmt) + '</span>' : '');
    function drawCard(item) {
      const v = mode === 'fill' ? item.text : (item.info.search || item.text.split(/\r?\n/)[0].trim());
      pn.innerHTML = '<div class="klq-cd">' + chips(item.info) + '<div class="klq-tx">' + esc(item.info.summary || item.text) + '</div>'
        + (item.info.fields && item.info.fields.checkOk === false ? '<div class="klq-no">Số kiểm tra không khớp — mã có thể in lỗi hoặc đọc sai.</div>' : '')
        + (mode === 'confirm' ? '<label style="font-size:13px;color:#aeb4bb">Giá trị dùng để tìm (có thể sửa)</label><input class="klq-in" data-a="val" value="' + esc(v) + '" autocomplete="off">' : '')
        + '<div class="klq-ac"><button type="button" class="klq-bt pri" data-a="use">' + esc(actionLabel) + '</button><button type="button" class="klq-bt" data-a="again">Quét lại</button><button type="button" class="klq-bt" data-a="copy">Chép</button></div></div>';
      pn._item = item; const inp = pn.querySelector('[data-a=val]'); if (inp) { inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pn.querySelector('[data-a=use]').click(); } }); }
    }
    function drawList() {
      pn.innerHTML = '<div class="klq-ls">' + st.list.map((it, i) => '<div class="klq-cd">' + chips(it.info) + '<div class="klq-tx">' + esc(it.info.summary || it.text) + '</div><div class="klq-ac"><button type="button" class="klq-bt pri" data-a="useI" data-i="' + i + '">' + esc(actionLabel) + '</button><button type="button" class="klq-bt" data-a="copyI" data-i="' + i + '">Chép</button><button type="button" class="klq-bt" data-a="delI" data-i="' + i + '">Bỏ</button></div></div>').reverse().join('') + '</div>'
        + '<div class="klq-ac" style="margin-top:4px"><span style="font-size:13px;color:#aeb4bb;align-self:center">Đã quét ' + st.list.length + ' mã</span><button type="button" class="klq-bt" data-a="clear">Xóa danh sách</button></div>';
    }
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, i = +b.dataset.i;
      if (a === 'close') close();
      else if (a === 'torch') setTorch(!st.torch);
      else if (a === 'flip') flip();
      else if (a === 'img') $('[data-a=file]').click();
      else if (a === 'again') { pn.innerHTML = ''; st.paused = false; }
      else if (a === 'copy') { const t = pn._item; if (t) { b.textContent = copyText(t.text) ? 'Đã chép' : 'Không chép được'; } }
      else if (a === 'use') { const t = pn._item; if (!t) return; const inp = pn.querySelector('[data-a=val]'); const v = inp ? inp.value.trim() : t.text; if (!v) { inp && inp.focus(); return; } pick(v, t.info, t.text); }
      else if (a === 'useI') { const t = st.list[i]; if (t) pick(mode === 'fill' ? t.text : (t.info.search || t.text.split(/\r?\n/)[0].trim()), t.info, t.text); }
      else if (a === 'copyI') { const t = st.list[i]; if (t) b.textContent = copyText(t.text) ? 'Đã chép' : 'Không chép được'; }
      else if (a === 'delI') { st.list.splice(i, 1); drawList(); }
      else if (a === 'clear') { st.list.length = 0; drawList(); }
    });
    ov.querySelector('[data-a=multi]').addEventListener('change', (e) => { st.multi = e.target.checked; pn.innerHTML = ''; st.paused = false; if (st.multi) drawList(); });
    $('[data-a=file]').addEventListener('change', (e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; fromFiles(fs); });
    ov.addEventListener('dragover', (e) => { e.preventDefault(); }); ov.addEventListener('drop', (e) => { e.preventDefault(); fromFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || [])); });
    function onPaste(e) { const fs = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); fromFiles(fs); } }
    document.addEventListener('paste', onPaste, true);
    async function fromFiles(fs) {
      fs = fs.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name)); if (!fs.length) return; hint.textContent = 'Đang đọc ảnh…'; let found = 0;
      for (const f of fs) { try { const r = await decodeFile(f); if (r) { found++; if (addResult(r) && !st.multi) break; } } catch (e) { hint.textContent = e.message; } }
      hint.textContent = found ? 'Đã đọc ' + found + ' mã từ ảnh' : 'Không tìm thấy mã trong ảnh — thử ảnh rõ và thẳng hơn.';
    }

    // ---- camera
    async function startCam(deviceId) {
      showMsg('Đang mở camera…'); stopCam();
      const tries = deviceId ? [{ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }] : [{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }, { video: true, audio: false }];
      let lastErr = null;
      for (const c of tries) { try { st.stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { lastErr = e; } }
      if (st.closed) { if (st.stream) st.stream.getTracks().forEach((t) => t.stop()); return; }
      if (!st.stream) { const n = lastErr && lastErr.name; showMsg(n === 'NotAllowedError' || n === 'SecurityError' ? 'App chưa được cấp quyền camera. Hãy cho phép camera trong cài đặt rồi mở lại, hoặc bấm "Từ ảnh" để quét từ ảnh.' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'Không tìm thấy camera. Bấm "Từ ảnh" để quét từ ảnh có sẵn.' : 'Không mở được camera' + (n ? ' (' + n + ')' : '') + '. Bấm "Từ ảnh" để quét từ ảnh.'); return; }
      st.track = st.stream.getVideoTracks()[0]; video.srcObject = st.stream; try { await video.play(); } catch (e) { /* tự phát */ } showMsg('');
      try { const caps = st.track.getCapabilities ? st.track.getCapabilities() : {}; $('[data-a=torch]').hidden = !caps.torch; } catch (e) { /* bỏ qua */ }
      try { const all = await navigator.mediaDevices.enumerateDevices(); st.devs = all.filter((d) => d.kind === 'videoinput'); const cur = st.track.getSettings && st.track.getSettings().deviceId; st.di = st.devs.findIndex((d) => d.deviceId === cur); $('[data-a=flip]').hidden = st.devs.length < 2; } catch (e) { /* bỏ qua */ }
      loop();
    }
    function stopCam() { cancelAnimationFrame(st.raf); if (st.stream) st.stream.getTracks().forEach((t) => t.stop()); st.stream = null; st.track = null; st.torch = false; const tb = $('[data-a=torch]'); if (tb) tb.classList.remove('on'); }
    async function setTorch(on) { try { await st.track.applyConstraints({ advanced: [{ torch: on }] }); st.torch = on; $('[data-a=torch]').classList.toggle('on', on); } catch (e) { hint.textContent = 'Máy không bật được đèn.'; } }
    function flip() { if (st.devs.length < 2) return; st.di = (st.di + 1) % st.devs.length; startCam(st.devs[st.di].deviceId); }
    function loop() {
      st.raf = requestAnimationFrame(async function tick(ts) {
        if (st.closed) return; st.raf = requestAnimationFrame(tick);
        if (st.paused || st.busy || ts - st.last < 130 || !video.videoWidth) return; st.last = ts; st.busy = true;
        try {
          const k = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight)), c = st.canvas; c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(video, 0, 0, c.width, c.height); const r = decodeImageData(g.getImageData(0, 0, c.width, c.height));
          if (r) addResult(r);
        } catch (e) { /* khung lỗi → bỏ qua */ } finally { st.busy = false; }
      });
    }
    // ---- khởi động
    showMsg('Đang nạp bộ đọc mã…');
    ensureZX().then(() => { if (st.closed) return; if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showMsg('Thiết bị không hỗ trợ camera trực tiếp. Bấm "Từ ảnh" để quét từ ảnh.'); return; } return startCam(); }).catch((e) => showMsg(e.message));
    active = { close, _st: st, _add: addResult };
    return active;
  }
  window.KlQuet = { open, config: (c) => { cfg = Object.assign(cfg, c || {}); }, decodeFile, decodeImageData, ensure: ensureZX, isOpen: () => !!active };
})();
