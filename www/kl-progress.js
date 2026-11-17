// js/kl-progress.js — POPUP TIẾN TRÌNH CHỜ DÙNG CHUNG (PC 2.56 / ĐT 1.17). Mẫu 1 anh đã chọn: hộp thoại giữa màn hình có thanh %, "Module x / n" và danh sách từng bước.
// KHÔNG phụ thuộc thư viện / css module — chỉ cần css/kl-progress.css. Bản PC (html/js) và bản điện thoại (www) GIỐNG HỆT nhau; sửa 1 nơi thì chép sang nơi kia.
//
// CÁCH DÙNG
//   const h = KLProgress.open({ title:'Đang khôi phục từ Drive…', sub:'Thư mục khoa', steps:[{key:'m1', label:'M01 · Tồn kho An An'}, …], note:'Đừng tắt app.', cancel: fn|null, delay:250 });
//   h.step('m1','run');  h.step('m1','ok','Đã xong');  h.step('m2','err','Lỗi mạng');   // 'wait' | 'run' | 'ok' | 'err'
//   h.set({ pct: 40, label:'6 / 15', sub:'…', title:'…' });   // pct = null → thanh chạy qua lại (chưa biết bao lâu). Có steps mà không đặt pct → tự tính theo số bước xong.
//   h.done({ ok:true, title:'Xong', text:'…', errors:['…'], keep:false, hold:2200 });   // ok + không có lỗi → hiện dải xanh "Hoàn thành" rồi tự đóng sau 2,2 giây (keep:true = giữ lại); có lỗi → giữ + hiện danh sách + nút Đóng
//   h.close();
//   Việc ngắn (< delay ms, mặc định 250) KHÔNG hiện popup → không nháy. h.close()/h.done() trước thời gian đó thì không vẽ gì.
//   KLProgress.busy('Đang đọc PDF trang 2/5…', 40) / KLProgress.idle() — kiểu bật / tắt đơn giản cho chỗ cũ dùng setBusy(on, text).
(function () {
  'use strict';
  if (window.KLProgress) return;
  var NS = 'http://www.w3.org/2000/svg';
  var ICON = {
    spin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3"/><path class="kp-spin" d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity=".16"/><path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity=".16"/><path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    wait: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/></svg>'
  };
  var STXT = { wait: 'Chờ', run: 'Đang xử lý…', ok: 'Đã xong', err: 'Lỗi' };
  var uid = 0;
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pctOf(n) { n = Number(n); return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; }

  function open(o) {
    o = o || {};
    var id = 'kp' + (++uid), delay = o.delay == null ? 250 : o.delay, shown = false, closed = false, finished = false, prevFocus = null, timer = 0, autoT = 0;
    var st = { title: o.title || 'Đang xử lý…', sub: o.sub || '', pct: o.pct == null ? null : pctOf(o.pct), label: o.label || '', steps: [], map: {}, note: o.note || '' };
    var ov = mk('div', 'kp-ov'), box = mk('div', 'kp-box');
    ov.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', id + 't'); box.tabIndex = -1;
    var ic = mk('span', 'kp-ic', ICON.spin), t = mk('div', 'kp-t'), s = mk('div', 'kp-s'), tt = mk('div', 'kp-tt'), hd = mk('div', 'kp-hd');
    t.id = id + 't'; tt.appendChild(t); tt.appendChild(s); hd.appendChild(ic); hd.appendChild(tt);
    var pg = mk('div', 'kp-pg'), bar = mk('div', 'kp-bar'), fill = mk('i'), nums = mk('div', 'kp-nums'), nl = mk('span'), np = mk('b');
    bar.appendChild(fill); nums.appendChild(nl); nums.appendChild(np); pg.appendChild(bar); pg.appendChild(nums);
    var steps = mk('div', 'kp-steps'), note = mk('div', 'kp-note'), fin = mk('div', 'kp-fin'), err = mk('ul', 'kp-err'), ft = mk('div', 'kp-ft');
    fin.hidden = true; fin.setAttribute('role', 'status');
    var bCancel = mk('button', 'kp-btn', 'Hủy'), bClose = mk('button', 'kp-btn pri', 'Đóng');
    bCancel.type = 'button'; bClose.type = 'button'; bClose.hidden = true; bCancel.hidden = typeof o.cancel !== 'function'; ft.hidden = bCancel.hidden;
    ft.appendChild(bCancel); ft.appendChild(bClose);
    [hd, pg, steps, note, fin, err, ft].forEach(function (e) { box.appendChild(e); }); ov.appendChild(box);

    function stepRow(k) { var r = st.map[k]; return r; }
    function paintStep(r) {
      r.el.className = 'kp-st ' + r.status;
      r.el.innerHTML = '<span>' + ICON[r.status === 'run' ? 'spin' : r.status] + '</span><span>' + esc(r.label) + '</span><em>' + esc(r.text || STXT[r.status]) + '</em>';
      r.el.firstChild.style.color = r.status === 'ok' ? 'var(--kp-ok)' : r.status === 'err' ? 'var(--kp-err)' : r.status === 'run' ? 'var(--kp-pr)' : 'var(--kp-t3)';
    }
    function counts() { var d = 0; st.steps.forEach(function (r) { if (r.status === 'ok' || r.status === 'err') d++; }); return { d: d, n: st.steps.length }; }
    function paint() {
      t.textContent = st.title; s.textContent = st.sub; note.textContent = st.note;
      var p = st.pct, c = counts();
      if (p == null && c.n) p = pctOf(c.d / c.n * 100);
      var ind = p == null && !finished;
      bar.className = 'kp-bar' + (ind ? ' ind' : ''); fill.style.width = ind ? '' : (p == null ? 0 : p) + '%';
      nl.textContent = st.label || (c.n ? 'Bước ' + Math.min(c.d + (finished ? 0 : 1), c.n) + ' / ' + c.n : '');
      np.textContent = (ind || p == null) ? '' : p + '%';
      pg.style.display = (!ind && p == null && !st.label) ? 'none' : '';
    }
    function show() {
      if (shown || closed) return; shown = true; prevFocus = document.activeElement;
      (document.body || document.documentElement).appendChild(ov); ov.hidden = false;
      try { (bCancel.hidden ? box : bCancel).focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
    }
    function remove() { clearTimeout(timer); clearTimeout(autoT); closed = true; document.removeEventListener('keydown', onKey, true); if (ov.parentNode) ov.parentNode.removeChild(ov); try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ } if (o.onClose) { try { o.onClose(); } catch (e) { /* bỏ qua */ } } }
    function onKey(e) {
      if (!shown || closed) return;
      if (e.key === 'Escape') { if (finished) { e.preventDefault(); remove(); } else if (!bCancel.hidden) { e.preventDefault(); bCancel.click(); } return; }
      if (e.key === 'Tab') { var f = Array.prototype.filter.call(box.querySelectorAll('button'), function (b) { return !b.hidden && !b.disabled; }); if (!f.length) { e.preventDefault(); box.focus(); return; }
        var i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    }
    bCancel.addEventListener('click', function () { bCancel.disabled = true; bCancel.textContent = 'Đang hủy…'; try { o.cancel(); } catch (e) { /* bỏ qua */ } });
    bClose.addEventListener('click', remove);
    document.addEventListener('keydown', onKey, true);

    (o.steps || []).forEach(function (x) { h_step(x.key, x.status || 'wait', x.text, x.label); });
    function h_step(k, status, text, label) {
      var r = st.map[k];
      if (!r) { r = st.map[k] = { key: k, label: label || String(k), status: 'wait', text: '', el: mk('div') }; st.steps.push(r); steps.appendChild(r.el); }
      if (label) r.label = label; r.status = status || r.status; r.text = text == null ? '' : text; paintStep(r);
      if (r.status === 'run') { try { r.el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* bỏ qua */ } }
    }
    paint();
    var h = {
      set: function (p) { if (closed || !p) return h; if (p.title != null) st.title = p.title; if (p.sub != null) st.sub = p.sub; if (p.note != null) st.note = p.note; if (p.label != null) st.label = p.label; if ('pct' in p) st.pct = p.pct == null ? null : pctOf(p.pct); paint(); return h; },
      step: function (k, status, text, label) { if (closed) return h; h_step(k, status, text, label); paint(); return h; },
      done: function (r) {
        if (closed) return h; r = r || {}; finished = true; clearTimeout(timer);
        var errs = (r.errors || []).filter(Boolean), ok = r.ok !== false && !errs.length;
        if (!shown && ok && !r.keep) { remove(); return h; }          // xong quá nhanh, popup chưa kịp hiện → không hiện gì (không nháy)
        if (!shown) show();
        st.title = r.title || (ok ? 'Hoàn tất' : 'Chưa trọn vẹn'); if (r.text != null) st.sub = r.text; st.pct = ok ? 100 : (st.pct == null ? counts().n ? null : 0 : st.pct);
        if (ok) st.label = r.label != null ? r.label : (counts().n ? counts().n + ' / ' + counts().n : '');
        ic.innerHTML = ok ? ICON.ok : ICON.err; ic.style.color = ok ? 'var(--kp-ok)' : 'var(--kp-err)';
        // Khi xong không lỗi: hiện dải xanh lá "Hoàn thành" (màu tự đổi theo giao diện sáng / tối) để người dùng biết chắc việc đã xong
        if (ok) { fin.innerHTML = ICON.ok + '<span>' + esc(r.doneText || 'Hoàn thành') + '</span>'; fin.hidden = false; box.className = 'kp-box kp-ok'; } else { fin.hidden = true; box.className = 'kp-box'; }
        err.innerHTML = errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
        bCancel.hidden = true; bClose.hidden = false; ft.hidden = false; paint();
        try { bClose.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
        if (ok && !r.keep) autoT = setTimeout(remove, r.hold == null ? 2200 : r.hold);   // giữ 2,2 giây cho kịp nhìn chữ Hoàn thành (bấm Đóng / Esc để tắt sớm)
        return h;
      },
      close: function () { if (!closed) remove(); },
      get shown() { return shown; }, get closed() { return closed; }
    };
    if (delay <= 0) show(); else timer = setTimeout(show, delay);
    return h;
  }

  // Bật / tắt đơn giản (thay cho setBusy(on, text) rải rác trong module). Một popup duy nhất; cập nhật chữ / % khi gọi lại.
  var single = null;
  function busy(text, pct, o) {
    if (!single || single.closed) { o = o || {}; single = open({ title: text || 'Đang xử lý…', pct: pct == null ? null : pct, sub: o.sub || '', note: o.note || '', delay: o.delay == null ? 200 : o.delay }); }
    else single.set({ title: text || 'Đang xử lý…', pct: pct == null ? null : pct });
    return single;
  }
  function idle() { if (single) { single.close(); single = null; } }

  window.KLProgress = { open: open, busy: busy, idle: idle };
})();
