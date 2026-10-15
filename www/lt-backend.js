/* LƯU TRỮ CÁ NHÂN — phần nối ĐIỆN THOẠI (ĐT 1.02): giao diện (lt-ui.js, dùng chung với PC) gọi window.LTB.
   Dữ liệu lưu TRÊN MÁY bằng IndexedDB (kl_luutru_<tài khoản>): bảng recs (tin / ngăn), blobs (file đã có trên máy), meta (mốc đồng bộ).
   Đồng bộ — phương án C: ưu tiên LAN (PC bật "máy chủ LAN" trong Lưu trữ cá nhân), không tới được PC thì dùng Google Drive qua Web App (lệnh ltPull / ltPush / ltFilePut / ltFileGet).
   Quy tắc bản ghi GIỐNG HỆT PC (core/luu-tru.js): bản ghi có `up` lớn hơn thắng; dl 0 bình thường · 1 thùng rác · 2 xóa hẳn; kéo theo số thứ tự `sq` do nơi lưu cấp.
   Cờ riêng của điện thoại trên mỗi bản ghi: pl = còn phải đẩy cho PC qua LAN · pd = còn phải đẩy lên Drive · lb = file đã có trên máy · lu = file đã gửi PC. */
(function () {
  'use strict';
  const H = window.parent && window.parent !== window && window.parent.LTHost;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;
  const WIRE = ['id', 'k', 'ng', 't', 'tx', 'fn', 'fs', 'mt', 'th', 'fid', 'bg', 'ts', 'up', 'dl', 'pn', 'tg', 'src'];
  const MAX_DRIVE = 15 * 1048576, MAX_LOCAL = 500 * 1048576;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip' };
  const noAcc = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
  const newId = () => Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const mimeOf = (n) => MIME[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';
  const need = () => { if (!H) throw new Error('Mở Lưu trữ cá nhân từ trong ứng dụng Kho Lạnh.'); return H; };
  const cfg = () => need().cfg();
  const tk = () => String(cfg().user || 'admin').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 40) || 'admin';

  // ------------------------------------------------------------------ IndexedDB
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('kl_luutru_' + tk(), 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('recs', { keyPath: 'id' }); d.createObjectStore('blobs'); d.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('Không mở được bộ nhớ trên máy.'));
  }));
  const idb = (store, mode, fn) => db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const dbAll = () => db().then((d) => reqP(d.transaction('recs').objectStore('recs').getAll()));
  const dbPut = (r) => idb('recs', 'readwrite', (s) => s.put(r));
  const dbPutMany = (rs) => idb('recs', 'readwrite', (s) => { rs.forEach((r) => s.put(r)); });
  const blobGet = (id) => db().then((d) => reqP(d.transaction('blobs').objectStore('blobs').get(id)));
  const blobPut = (id, b) => idb('blobs', 'readwrite', (s) => s.put(b, id));
  const blobDel = (id) => idb('blobs', 'readwrite', (s) => s.delete(id));
  const metaGet = (k) => db().then((d) => reqP(d.transaction('meta').objectStore('meta').get(k)));
  const metaPut = (k, v) => idb('meta', 'readwrite', (s) => s.put(v, k));

  // ------------------------------------------------------------------ dữ liệu trong bộ nhớ
  const R = new Map(); let rev = 1, loaded = false;
  const meta = { lanSince: 0, drvSince: 0 };
  const sync = { busy: false, err: '', mode: '', last: 0 };
  const bump = () => { rev++; };
  const wire = (r) => { const o = {}; WIRE.forEach((k) => { if (r[k] !== undefined && r[k] !== null && r[k] !== '') o[k] = r[k]; }); if (!o.tg) o.tg = []; return o; };
  const view = (r) => ({ id: r.id, k: r.k, ng: r.ng, t: r.t, tx: r.tx, fn: r.fn, fs: r.fs, mt: r.mt, th: r.th || '', ts: r.ts, up: r.up, pn: r.pn, tg: r.tg || [], dl: r.dl, src: r.src,
    local: !!r.lb, wait: r.k === 'm' && r.t !== 'text' && !r.lb, pend: (r.pd || (r.pl && lanCfg().on)) ? 1 : 0, big: r.bg ? 1 : 0 }); // pl chỉ tính là "chờ" khi có cấu hình LAN
  const pendCount = () => { let n = 0; const lan = lanCfg().on; R.forEach((r) => { if (r.pd || (r.pl && lan)) n++; }); return n; };

  async function load() {
    if (loaded) return; loaded = true;
    (await dbAll()).forEach((r) => R.set(r.id, r));
    const m = await metaGet('m'); if (m) Object.assign(meta, m);
    if (!R.has('mydocs')) { const d = { id: 'mydocs', k: 'n', tx: 'My Documents', fn: '', ts: 1, up: 1, dl: 0, pn: 0, tg: [], src: 'pc', pl: 0, pd: 0 }; R.set('mydocs', d); await dbPut(d); }
  }
  const saveMeta = () => metaPut('m', meta);

  function merge(w, from) { // nhận bản ghi từ PC / Drive — cùng luật với Store.merge ở PC
    if (!w || typeof w.id !== 'string' || !ID_RE.test(w.id)) return null;
    const cur = R.get(w.id), up = +w.up || 0;
    if (cur && (up < cur.up || (up === cur.up && (+w.dl || 0) <= (cur.dl || 0)))) return null;
    const r = {}; WIRE.forEach((k) => { if (w[k] !== undefined) r[k] = w[k]; });
    r.k = r.k === 'n' ? 'n' : 'm'; r.t = r.k === 'n' ? '' : (['text', 'image', 'file'].includes(r.t) ? r.t : 'text');
    r.ng = String(r.ng || ''); r.tx = String(r.tx || '').slice(0, 20000); r.fn = String(r.fn || '').slice(0, 200); r.mt = String(r.mt || '').slice(0, 100);
    r.fs = +r.fs || 0; r.ts = +r.ts || up; r.up = up; r.dl = [1, 2].includes(+r.dl) ? +r.dl : 0; r.pn = +r.pn ? 1 : 0; r.bg = +r.bg ? 1 : 0; r.fid = String(r.fid || '').slice(0, 120);
    r.th = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{0,24000}$/.test(String(r.th || '')) ? r.th : '';
    r.tg = Array.isArray(r.tg) ? r.tg.map((x) => String(x).slice(0, 40)).slice(0, 20) : []; r.src = r.src === 'dt' ? 'dt' : 'pc';
    r.lb = cur ? cur.lb : 0; r.lu = cur ? cur.lu : 0; r.pl = 0; r.pd = 0;
    if (r.dl === 2) { r.tx = ''; r.th = ''; if (r.lb) { blobDel(r.id).catch(() => {}); r.lb = 0; } }
    R.set(r.id, r); return r;
  }
  function touch(r) { r.up = Math.max(Date.now(), (r.up || 0) + 1); r.pl = 1; r.pd = 1; R.set(r.id, r); bump(); return dbPut(r).then(() => { schedule(); return r; }); }

  // ------------------------------------------------------------------ danh sách (cùng luật với Store.list ở PC)
  function nganList() {
    const cnt = {}, last = {};
    R.forEach((r) => { if (r.k === 'm' && r.dl === 0) { cnt[r.ng] = (cnt[r.ng] || 0) + 1; if (!last[r.ng] || r.ts > last[r.ng].ts) last[r.ng] = r; } });
    return Array.from(R.values()).filter((r) => r.k === 'n' && r.dl === 0).sort((a, b) => (a.id === 'mydocs' ? -1 : b.id === 'mydocs' ? 1 : a.ts - b.ts))
      .map((r) => { const l = last[r.id]; return { id: r.id, name: r.tx, icon: r.fn || '', count: cnt[r.id] || 0, lastTs: l ? l.ts : 0, lastText: l ? (l.t === 'text' ? l.tx : (l.t === 'image' ? '🖼 ' : '📎 ') + (l.fn || '')) : '' }; });
  }
  function list(o) {
    o = o || {};
    const limit = Math.min(Math.max(+o.limit || 200, 20), 1000), nq = o.q ? noAcc(o.q) : '', f = o.filter || 'all';
    const hit = (r) => !nq || noAcc(r.tx + ' ' + r.fn + ' ' + (r.tg || []).join(' ')).includes(nq);
    const msgs = Array.from(R.values()).filter((r) => r.k === 'm');
    let counts = null, trash = 0;
    msgs.forEach((r) => { if (r.dl === 1) trash++; });
    if (f !== 'trash') {
      counts = { all: 0, image: 0, file: 0, link: 0, pin: 0 };
      msgs.forEach((r) => { if (r.dl !== 0 || r.ng !== o.ng) return; counts.all++; if (r.t === 'image') counts.image++; else if (r.t === 'file') counts.file++; if (r.t === 'text' && URL_RE.test(r.tx)) counts.link++; if (r.pn) counts.pin++; });
    }
    let arr = msgs.filter((r) => {
      if (f === 'trash') return r.dl === 1 && hit(r);
      if (r.dl !== 0 || !((o.all && nq) ? true : r.ng === o.ng) || !hit(r)) return false;
      if (f === 'image') return r.t === 'image'; if (f === 'file') return r.t === 'file';
      if (f === 'link') return r.t === 'text' && URL_RE.test(r.tx); if (f === 'pin') return !!r.pn; return true;
    }).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    if (o.before) arr = arr.filter((r) => r.ts < +o.before);
    return { items: arr.slice(-limit).map(view), hasMore: arr.length > limit, counts, trash };
  }

  // ------------------------------------------------------------------ thao tác tại chỗ
  const newMsg = (ng, over) => { const now = Date.now(), c = R.get(ng); return Object.assign({ id: newId(), k: 'm', ng: c && c.k === 'n' && c.dl === 0 ? ng : 'mydocs', t: 'text', tx: '', ts: now, up: now, dl: 0, pn: 0, tg: [], src: 'dt', pl: 1, pd: 1, lb: 0, lu: 0 }, over); };
  function thumbOf(blob) {
    return new Promise((res) => {
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => {
        try {
          const k = Math.min(1, 240 / Math.max(im.naturalWidth, im.naturalHeight, 1)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          let q = 0.62, d = c.toDataURL('image/jpeg', q); while (d.length > 18000 && q > 0.3) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
          res(d.length > 18000 ? '' : d);
        } catch (e) { res(''); } URL.revokeObjectURL(u);
      };
      im.onerror = () => { URL.revokeObjectURL(u); res(''); }; im.src = u;
    });
  }
  const blobToB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });

  // ------------------------------------------------------------------ đồng bộ
  const lanCfg = () => { try { const o = JSON.parse(localStorage.getItem('kl_lt_lan') || '{}'); return { on: o.on !== false && !!o.url, url: String(o.url || '').replace(/\/+$/, '') }; } catch (e) { return { on: false, url: '' }; } };
  const driveOk = () => { try { const c = cfg(); return !!(c.url && c.token); } catch (e) { return false; } };
  async function lanFetch(path, opt, timeout) {
    const L = lanCfg(), c = cfg(), ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout || 10000);
    try {
      return await fetch(L.url + path, { method: (opt && opt.method) || 'GET', headers: Object.assign({ 'X-LT-User': String(c.user || ''), 'X-LT-Token': String(c.token || '') }, (opt && opt.headers) || {}), body: opt && opt.body, signal: ctl.signal });
    } finally { clearTimeout(t); }
  }
  async function lanJson(path, body, timeout) {
    const r = await lanFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, timeout);
    const j = await r.json().catch(() => ({ ok: false, error: 'PC trả về dữ liệu lạ.' }));
    if (!j.ok) throw Object.assign(new Error(j.error || 'PC báo lỗi.'), { code: j.code, http: r.status });
    return j;
  }
  async function lanUp() { // PC có đang trả lời không?
    const L = lanCfg(); if (!L.on) return false;
    try { const r = await lanFetch('/lt/ping', {}, 1800); const j = await r.json(); return !!(j && j.app === 'kholanh-lt'); } catch (e) { return false; }
  }
  async function syncLan() {
    // 1) đẩy
    for (let guard = 0; guard < 100; guard++) {
      const pend = Array.from(R.values()).filter((r) => r.pl && r.id !== 'mydocs').sort((a, b) => a.up - b.up).slice(0, 40);
      if (!pend.length) break;
      const snap = pend.map((r) => r.up);
      for (const r of pend) {
        if (r.k === 'm' && r.t !== 'text' && r.dl === 0 && r.lb && !r.lu) {
          const b = await blobGet(r.id); if (!b) continue;
          const res = await lanFetch('/lt/file/' + r.id, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: b }, 600000);
          const j = await res.json().catch(() => ({ ok: false })); if (!j.ok) throw new Error(j.error || 'PC không nhận được file.'); r.lu = 1;
        }
      }
      await lanJson('/lt/push', { rows: pend.map(wire) }, 60000);
      pend.forEach((r, i) => { if (r.up === snap[i]) { r.pl = 0; r.pd = 0; } }); // PC giữ phần đẩy lên Drive
      await dbPutMany(pend);
    }
    // 2) kéo
    for (let loops = 0; loops < 100; loops++) {
      const j = await lanJson('/lt/pull', { since: meta.lanSince }, 30000), ch = [];
      (j.rows || []).forEach((w) => { const r = merge(w, 'lan'); if (r) ch.push(r); });
      if (ch.length) { await dbPutMany(ch); bump(); }
      meta.lanSince = +j.seq || meta.lanSince; await saveMeta();
      if (!j.more) break;
    }
  }
  async function syncDrive() {
    const api = (a, x) => need().api(a, x);
    for (let guard = 0; guard < 100; guard++) {
      const pend = Array.from(R.values()).filter((r) => r.pd && r.id !== 'mydocs').sort((a, b) => a.up - b.up).slice(0, 30);
      if (!pend.length) break;
      const snap = pend.map((r) => r.up);
      for (const r of pend) {
        if (r.k === 'm' && r.t !== 'text' && r.dl === 0 && !r.fid && !r.bg && r.lb) {
          if (r.fs > MAX_DRIVE) { r.bg = 1; continue; }
          const b = await blobGet(r.id); if (!b) continue;
          const up = await api('ltFilePut', { id: r.id, name: r.fn, mime: r.mt, b64: await blobToB64(b) }); r.fid = up.fid;
        }
      }
      await api('ltPush', { rows: pend.map(wire) });
      pend.forEach((r, i) => { if (r.up === snap[i]) r.pd = 0; }); // pl giữ nguyên: khi tới được PC qua LAN vẫn đẩy để PC có file
      await dbPutMany(pend);
    }
    for (let loops = 0; loops < 100; loops++) {
      const j = await api('ltPull', { since: meta.drvSince, limit: 300, readOnly: true }), ch = [];
      (j.rows || []).forEach((w) => { const r = merge(w, 'drv'); if (r) ch.push(r); });
      if (ch.length) { await dbPutMany(ch); bump(); }
      meta.drvSince = +j.seq || meta.drvSince; await saveMeta();
      if (!j.more) break;
    }
  }
  async function runSync() {
    if (sync.busy) return { ok: false, error: 'Đang đồng bộ, chờ một lát.' };
    await load(); sync.busy = true; sync.err = '';
    try {
      const L = lanCfg(); let lanErr = '';
      if (L.on && await lanUp()) {
        try { await syncLan(); sync.mode = 'lan'; sync.last = Date.now(); return { ok: true, mode: 'lan' }; }
        catch (e) { if (e.code === 'AUTH' || e.code === 'FORBIDDEN') throw e; lanErr = e.message; } // lỗi giữa chừng → thử Drive
      }
      if (driveOk()) { await syncDrive(); sync.mode = 'drive'; sync.last = Date.now(); return { ok: true, mode: 'drive' }; }
      throw new Error(lanErr || (L.on ? 'Không tới được PC qua LAN và chưa cài kết nối Drive.' : 'Chưa cài đặt kết nối (LAN hoặc Drive).'));
    } catch (e) {
      sync.err = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Không kết nối được mạng.' : e.message; return { ok: false, error: sync.err };
    } finally { sync.busy = false; bump(); }
  }
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden) runSync(); }, 3000); }
  setInterval(() => { if (loaded && !document.hidden && !sync.busy) runSync(); }, 60000); // Drive / thử lại: 60 giây, hoặc bấm tay
  // ĐT 1.04 — đang nối được PC qua LAN thì hỏi PC mỗi 3 giây (nhẹ: không có gì mới thì PC trả rỗng) → tin mới tới gần như tức thì. Mất LAN thì tự về 60 giây.
  setInterval(() => { if (loaded && !document.hidden && !sync.busy && sync.mode === 'lan' && lanCfg().on) runSync(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loaded) runSync(); });

  // ------------------------------------------------------------------ lấy file về máy khi mở
  async function fetchBlob(r) {
    const L = lanCfg(), b = await blobGet(r.id); if (b) return b;
    let blob = null, lastErr = '';
    if (L.on && await lanUp()) {
      try { const res = await lanFetch('/lt/file/' + r.id, {}, 600000); if (res.ok) blob = await res.blob(); else lastErr = (await res.json().catch(() => ({}))).error || ''; } catch (e) { lastErr = e.message; }
    }
    if (!blob && r.fid && driveOk() && r.fs <= MAX_DRIVE) {
      const j = await need().api('ltFileGet', { fid: r.fid, readOnly: true });
      const bin = atob(j.b64 || ''), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      blob = new Blob([u8], { type: r.mt || j.mime || 'application/octet-stream' });
    }
    if (!blob) throw new Error(r.bg || r.fs > MAX_DRIVE ? 'File lớn — chỉ tải được khi điện thoại cùng mạng với PC (bật máy chủ LAN).' : (lastErr || 'Chưa tải được file — kiểm tra mạng rồi thử lại.'));
    r.lb = 1; await blobPut(r.id, blob); await dbPut(r); bump();
    return blob;
  }

  // ------------------------------------------------------------------ giao diện gọi
  const mustRec = (id) => { const r = R.get(id); if (!r) throw new Error('Không tìm thấy mục này.'); return r; };
  window.LTB = {
    platform: 'phone',
    init: async function () { need(); await load(); setTimeout(runSync, 400); return { ngan: nganList(), status: this._st(), canCfg: true }; },
    _st: () => ({ rev, busy: sync.busy, err: sync.err, mode: sync.mode, last: sync.last, pend: pendCount() }),
    status: async () => ({ rev, busy: sync.busy, err: sync.err, mode: sync.mode, last: sync.last, pend: pendCount() }),
    ngan: async () => nganList(),
    list: async (q) => list(q),
    sendText: async (ng, text) => {
      const tx = String(text || '').replace(/\r\n/g, '\n').slice(0, 20000); if (!tx.trim()) throw new Error('Tin nhắn trống.');
      const r = newMsg(ng, { tx }); R.set(r.id, r); bump(); await dbPut(r); schedule(); return view(r);
    },
    sendFiles: async (ng, files) => {
      const out = [];
      for (const f of files.slice(0, 30)) {
        if (f.size > MAX_LOCAL) throw new Error('File “' + f.name + '” quá lớn (tối đa ' + Math.round(MAX_LOCAL / 1048576) + ' MB).');
        const mt = f.type || mimeOf(f.name), r = newMsg(ng, { t: /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mt) ? 'image' : 'file', fn: safeName(f.name || ('anh-' + Date.now() + '.jpg')), mt, fs: f.size });
        if (r.t === 'image') r.th = await thumbOf(f);
        await blobPut(r.id, f); r.lb = 1; R.set(r.id, r); await dbPut(r); out.push(view(r));
      }
      bump(); schedule(); return out;
    },
    pickFiles: async () => [],
    edit: async (id, p) => {
      const r = mustRec(id); if (r.dl === 2) throw new Error('Mục này đã xóa hẳn.'); p = p || {};
      if (typeof p.tx === 'string') { r.tx = p.tx.replace(/\r\n/g, '\n').slice(0, r.k === 'n' ? 60 : 20000); if (r.k === 'n' && !r.tx.trim()) throw new Error('Tên ngăn trống.'); }
      if (r.k === 'n' && typeof p.icon === 'string') r.fn = p.icon.slice(0, 8);
      if (p.pn !== undefined) r.pn = p.pn ? 1 : 0;
      if (Array.isArray(p.tg)) r.tg = p.tg.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
      if (typeof p.ng === 'string' && r.k === 'm') { const c = R.get(p.ng); if (c && c.k === 'n' && c.dl === 0) r.ng = p.ng; }
      await touch(r); return view(r);
    },
    del: async (id) => { const r = mustRec(id); if (id === 'mydocs') return true; r.dl = 1; await touch(r); return true; },
    restore: async (id) => { const r = mustRec(id); if (r.k === 'm') { const c = R.get(r.ng); if (!c || c.dl !== 0) r.ng = 'mydocs'; } r.dl = 0; await touch(r); return true; },
    purge: async (id) => { const r = mustRec(id); r.dl = 2; r.tx = ''; r.th = ''; if (r.lb) { await blobDel(id); r.lb = 0; } await touch(r); return true; },
    emptyTrash: async () => { let n = 0; for (const r of Array.from(R.values())) if (r.k === 'm' && r.dl === 1) { r.dl = 2; r.tx = ''; r.th = ''; if (r.lb) { await blobDel(r.id); r.lb = 0; } await touch(r); n++; } return n; },
    nganSave: async (n) => {
      n = n || {}; const name = String(n.name || '').trim().slice(0, 60); if (!name) throw new Error('Tên ngăn trống.');
      if (n.id) { const r = mustRec(n.id); r.tx = name; r.fn = String(n.icon || '').slice(0, 8); await touch(r); }
      else { const now = Date.now(), r = { id: newId(), k: 'n', tx: name, fn: String(n.icon || '').slice(0, 8), ts: now, up: now, dl: 0, pn: 0, tg: [], src: 'dt', pl: 1, pd: 1 }; R.set(r.id, r); bump(); await dbPut(r); schedule(); }
      return nganList();
    },
    nganDel: async (id) => {
      if (id === 'mydocs') throw new Error('Không xóa được ngăn mặc định.'); const c = R.get(id); if (!c || c.k !== 'n') throw new Error('Không có ngăn này.');
      for (const r of Array.from(R.values())) if (r.k === 'm' && r.ng === id && r.dl === 0) { r.dl = 1; await touch(r); }
      c.dl = 1; await touch(c); return nganList();
    },
    fileBlob: async (id) => { const r = mustRec(id); if (r.t === 'text') throw new Error('Mục này không có file.'); const blob = await fetchBlob(r); return { blob, name: r.fn, mime: r.mt }; },
    open: async () => { throw new Error('Dùng Lưu hoặc Chia sẻ để mở bằng ứng dụng khác.'); },
    show: async () => { throw new Error('Chỉ dùng trên PC.'); },
    saveAs: async (id) => { const r = mustRec(id), blob = await fetchBlob(r); return need().KLShare.saveToPhone({ name: r.fn, blob, mime: r.mt }); },
    share: async (id) => { const r = mustRec(id), blob = await fetchBlob(r); return need().KLShare.shareFile({ name: r.fn, blob, mime: r.mt }); },
    openUrl: async (u) => { if (/^https?:\/\//i.test(u)) { try { window.open(u, '_blank'); } catch (e) { window.location.href = u; } } },
    sync: async () => { const r = await runSync(); bump(); return r; },

    // Hộp thoại cài đặt đồng bộ của điện thoại (lt-ui.js gọi khi bấm bánh răng)
    settingsDialog: function (u) {
      const L = lanCfg(), c = cfg(), est = pendCount();
      u.dialog('<h3>Đồng bộ Lưu trữ cá nhân</h3><p class="sub">Dữ liệu luôn lưu trên điện thoại. Khi cùng wifi với PC, app đồng bộ thẳng với PC (nhanh, không giới hạn dung lượng); ra ngoài thì đồng bộ qua Google Drive.</p>' +
        '<div class="lt-sec"><h4>' + u.svg('share') + ' Kết nối PC qua mạng LAN</h4><label>Địa chỉ PC (xem trong Lưu trữ cá nhân trên PC › Cài đặt)</label>' +
        '<input type="text" id="stLan" placeholder="http://192.168.1.50:47821" value="' + u.esc(L.url) + '" autocapitalize="none" autocorrect="off" spellcheck="false">' +
        '<p id="stLanMsg">Để trống nếu không dùng LAN. PC phải bật “máy chủ LAN” và tài khoản này cần quyền Lưu trữ cá nhân.</p>' +
        '<div class="lt-dlgbtn" style="margin-top:6px"><button class="lt-btn" id="stTest">Kiểm tra kết nối</button></div></div>' +
        '<div class="lt-sec"><h4>' + u.svg('cloud') + ' Google Drive</h4><p>' + (driveOk() ? 'Dùng chung kết nối Web App của app (đã đăng nhập). File lớn hơn <b>15 MB</b> không đi qua Drive — chỉ tải được qua LAN.' : 'Chưa có kết nối Web App — vào Cài đặt của app để nhập.') + '</p>' +
        '<p>Trạng thái: ' + (sync.busy ? 'đang đồng bộ…' : sync.err ? 'lỗi — ' + u.esc(sync.err) : sync.last ? 'lần gần nhất ' + u.fmtDT(sync.last) + ' (' + (sync.mode === 'lan' ? 'LAN' : 'Drive') + ')' : 'chưa đồng bộ') + ' · ' + est + ' mục chờ gửi</p></div>' +
        '<div class="lt-sec"><h4>' + u.svg('trash') + ' Bộ nhớ trên máy</h4><p>Giải phóng chỗ: xóa file đã tải về máy nhưng vẫn còn trên PC / Drive (tin nhắn và ảnh thu nhỏ giữ nguyên, mở lại sẽ tải lại).</p>' +
        '<div class="lt-dlgbtn" style="margin-top:6px"><button class="lt-btn" id="stFree">Giải phóng file đã đồng bộ</button></div></div>' +
        '<div class="lt-dlgbtn"><button class="lt-btn" id="stNo">Đóng</button><button class="lt-btn" id="stNow">' + u.svg('sync') + ' Đồng bộ ngay</button><button class="lt-btn pri" id="stOk">Lưu</button></div>', function (m, close) {
        const norm = () => { let v = m.querySelector('#stLan').value.trim(); if (!v) return ''; if (!/^https?:\/\//i.test(v)) v = 'http://' + v; if (!/:\d+$/.test(v)) v += ':47821'; return v.replace(/\/+$/, ''); };
        const msg = (t, bad) => { const p = m.querySelector('#stLanMsg'); p.textContent = t; p.style.color = bad ? 'var(--lt-red)' : ''; };
        const save = () => { const v = norm(); localStorage.setItem('kl_lt_lan', JSON.stringify({ on: !!v, url: v })); return v; };
        m.querySelector('#stNo').onclick = close;
        m.querySelector('#stOk').onclick = () => { save(); close(); u.toast('Đã lưu.'); runSync().then(u.reload); };
        m.querySelector('#stNow').onclick = () => { save(); close(); u.toast('Đang đồng bộ…'); runSync().then((r) => { if (r.ok) u.toast('Đã đồng bộ qua ' + (r.mode === 'lan' ? 'mạng LAN' : 'Drive') + '.'); else u.toast(r.error, true); u.reload(); }); };
        m.querySelector('#stTest').onclick = async () => {
          const v = save(); if (!v) { msg('Nhập địa chỉ PC trước.', true); return; } msg('Đang kiểm tra…');
          if (!(await lanUp())) { msg('Không tới được PC. Kiểm tra: cùng wifi, PC đang bật Lưu trữ cá nhân › Cài đặt › máy chủ LAN, địa chỉ + cổng đúng, tường lửa cho phép.', true); return; }
          try { await lanJson('/lt/pull', { since: 2147483647000 }, 8000); msg('✔ Kết nối PC thành công, tài khoản hợp lệ.'); } catch (e) { msg(e.code === 'AUTH' ? 'PC từ chối: sai tên người dùng / mã truy cập.' : e.code === 'FORBIDDEN' ? 'Tài khoản chưa được cấp quyền “Lưu trữ cá nhân” (kho LT).' : 'Lỗi: ' + e.message, true); }
        };
        m.querySelector('#stFree').onclick = async () => {
          let n = 0; for (const r of Array.from(R.values())) if (r.lb && !r.pl && !r.pd && (r.fid || r.lu)) { await blobDel(r.id); r.lb = 0; await dbPut(r); n++; }
          bump(); u.toast('Đã giải phóng ' + n + ' file.'); u.reload();
        };
      });
    }
  };
})();
