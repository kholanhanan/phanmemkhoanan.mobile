// core/luu-tru.js — CÔNG CỤ "LƯU TRỮ CÁ NHÂN" (M19, PC 1.03): khung chat riêng của từng tài khoản để lưu tin nhắn, ảnh, file.
// Chạy ở tiến trình chính. Dữ liệu nằm ở config/luu-tru/<tài khoản>/ (data.json + files/YYYY-MM/…) — KHÔNG vào database Excel,
// KHÔNG qua Mạng LAN nhiều PC, KHÔNG bị cập nhật đè. Mỗi tài khoản chỉ đọc / ghi dữ liệu của chính mình (tên lấy từ phiên đăng nhập,
// giao diện không được tự chọn tài khoản).
//
// ĐỒNG BỘ ĐIỆN THOẠI — phương án C (LAN trước, Drive khi ra ngoài):
//   - Máy chủ LAN nhỏ (HTTP, cổng mặc định 47821) bật / tắt trong module: điện thoại cùng wifi gọi /lt/pull, /lt/push, /lt/file/<id>.
//     Xác thực bằng Tên người dùng + Mã truy cập của chính tài khoản đó (header X-LT-User / X-LT-Token), cần quyền kho điện thoại 'LT'.
//   - Google Drive qua Apps Script (Code.gs › lệnh pc.ltPull / pc.ltPush / pc.ltFilePut / pc.ltFileGet): PC đẩy / kéo định kỳ,
//     điện thoại dùng khi không ở cùng mạng PC. Tin nhắn nằm ở tab LT_<tài khoản> của Google Sheet, file nằm ở thư mục Drive KhoLanh_LuuTru/<tài khoản>.
//   - Mô hình: mỗi tin / ngăn là 1 bản ghi có id duy nhất; bản ghi có `up` (giờ sửa) lớn hơn thắng; xóa = đánh dấu (dl: 1 thùng rác · 2 xóa hẳn).
//     Kéo thay đổi theo số thứ tự `sq` do nơi lưu cấp (không phụ thuộc đồng hồ máy).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const LAN_PORT_DEFAULT = 47821;
const MAX_LOCAL = 500 * 1048576;        // file lớn nhất lưu được trên PC
const MAX_DRIVE = 15 * 1048576;         // file lớn nhất đẩy qua Drive (Apps Script giới hạn thân yêu cầu) — lớn hơn chỉ đi qua LAN
const IMG_RE = /^image\/(png|jpe?g|gif|webp|bmp)$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TK_RE = /^[a-z0-9._-]{1,40}$/;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;
const WIRE = ['id', 'k', 'ng', 't', 'tx', 'fn', 'fs', 'mt', 'th', 'fid', 'bg', 'ts', 'up', 'dl', 'pn', 'tg', 'src'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  mp4: 'video/mp4', mp3: 'audio/mpeg', json: 'application/json' };

const noAcc = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
const tkOf = (ten) => String(ten || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 40);
const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

// ============================================================================================ KHO DỮ LIỆU CỦA 1 TÀI KHOẢN
class Store {
  constructor(dir, tk) {
    this.dir = dir; this.tk = tk;
    this.file = path.join(dir, 'data.json');
    this.filesDir = path.join(dir, 'files');
    this.rev = 1; this._t = null; this.lastErr = '';
    this.d = { v: 1, seq: 0, recs: {}, cur: { drv: 0 } };
    fs.mkdirSync(this.filesDir, { recursive: true });
    this._load();
  }
  _load() {
    try { const o = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (o && o.recs) this.d = Object.assign(this.d, o); }
    catch (e) { if (e.code !== 'ENOENT') { try { fs.copyFileSync(this.file, this.file + '.loi-' + Date.now()); } catch (x) { /* bỏ qua */ } } }
    if (!this.d.cur) this.d.cur = { drv: 0 };
    if (!this.d.recs.mydocs) this.d.recs.mydocs = { id: 'mydocs', k: 'n', tx: 'My Documents', fn: '', ts: 1, up: 1, dl: 0, pn: 0, tg: [], src: 'pc', sq: 0, pd: 0, lf: '' };
  }
  save() { this.rev++; clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 400); }
  flush() {
    clearTimeout(this._t); this._t = null;
    const tmp = this.file + '.tam';
    try { fs.writeFileSync(tmp, JSON.stringify(this.d)); fs.renameSync(tmp, this.file); this.lastErr = ''; } catch (e) { this.lastErr = e.message; }
  }
  _bump(r) { r.sq = ++this.d.seq; }
  wire(r) { const o = {}; WIRE.forEach((k) => { if (r[k] !== undefined && r[k] !== null && r[k] !== '') o[k] = r[k]; }); if (!o.tg) o.tg = []; return o; }
  relOf(r) { const d = new Date(r.ts || Date.now()); return path.join(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), r.id + '__' + safeName(r.fn)); }
  abs(r) { return r && r.lf ? path.join(this.filesDir, r.lf) : ''; }
  _rmFile(r) { try { if (r.lf) fs.unlinkSync(path.join(this.filesDir, r.lf)); } catch (e) { /* đã mất */ } r.lf = ''; }
  // File điện thoại gửi lên TRƯỚC bản ghi (files/_in/<id>) → gắn vào bản ghi khi bản ghi tới.
  adopt(r) {
    if (r.k !== 'm' || r.t === 'text' || r.lf || r.dl === 2) return;
    const inp = path.join(this.filesDir, '_in', r.id);
    if (!fs.existsSync(inp)) return;
    const rel = this.relOf(r), abs = path.join(this.filesDir, rel);
    try { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.renameSync(inp, abs); r.lf = rel; } catch (e) { /* thử lại lần sau */ }
  }
  // Nhận 1 bản ghi từ nơi khác (LAN / Drive). Trả true nếu có thay đổi. from: 'lan' → PC phải đẩy tiếp lên Drive (pd = 1).
  merge(w, from) {
    if (!w || typeof w.id !== 'string' || !ID_RE.test(w.id)) return false;
    const cur = this.d.recs[w.id], up = +w.up || 0;
    if (cur && (up < cur.up || (up === cur.up && (+w.dl || 0) <= (cur.dl || 0)))) return false;
    const r = {};
    WIRE.forEach((k) => { if (w[k] !== undefined) r[k] = w[k]; });
    r.k = r.k === 'n' ? 'n' : 'm';
    r.t = r.k === 'n' ? '' : (['text', 'image', 'file'].includes(r.t) ? r.t : 'text');
    r.ng = String(r.ng || ''); r.tx = String(r.tx || '').slice(0, 20000); r.fn = String(r.fn || '').slice(0, 200); r.mt = String(r.mt || '').slice(0, 100);
    r.fs = +r.fs || 0; r.ts = +r.ts || up; r.up = up; r.dl = [1, 2].includes(+r.dl) ? +r.dl : 0; r.pn = +r.pn ? 1 : 0; r.bg = +r.bg ? 1 : 0;
    r.fid = String(r.fid || '').slice(0, 120);
    r.th = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{0,24000}$/.test(String(r.th || '')) ? r.th : '';
    r.tg = Array.isArray(r.tg) ? r.tg.map((x) => String(x).slice(0, 40)).slice(0, 20) : [];
    r.src = r.src === 'dt' ? 'dt' : 'pc';
    r.lf = cur ? cur.lf : '';
    r.pd = from === 'lan' ? 1 : 0;
    if (r.dl === 2) { this._rmFile(r); r.tx = ''; r.th = ''; }
    this._bump(r); this.d.recs[r.id] = r; this.adopt(r);
    return true;
  }
  _newMsg(ng, over) {
    const now = Date.now();
    const ch = this.d.recs[ng];
    return Object.assign({ id: newId(), k: 'm', ng: ch && ch.k === 'n' && ch.dl === 0 ? ng : 'mydocs', t: 'text', tx: '', ts: now, up: now, dl: 0, pn: 0, tg: [], src: 'pc', pd: 1, lf: '' }, over);
  }
  addText(ng, text) {
    const tx = String(text || '').replace(/\r\n/g, '\n').slice(0, 20000);
    if (!tx.trim()) return null;
    const r = this._newMsg(ng, { tx }); this._bump(r); this.d.recs[r.id] = r; this.save(); return r;
  }
  // src = { buf } hoặc { path }. makeThumb(buf) → dataURL nhỏ (chỉ ảnh).
  addFile(ng, name, mime, src, makeThumb) {
    const fnm = safeName(name), mt = mime || mimeOf(fnm);
    const r = this._newMsg(ng, { t: IMG_RE.test(mt) ? 'image' : 'file', fn: fnm, mt });
    r.lf = this.relOf(r);
    const abs = path.join(this.filesDir, r.lf);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let buf = null;
    if (src.buf) { buf = Buffer.from(src.buf); fs.writeFileSync(abs, buf); r.fs = buf.length; }
    else { fs.copyFileSync(src.path, abs); r.fs = fs.statSync(abs).size; if (r.t === 'image' && r.fs <= 30 * 1048576) buf = fs.readFileSync(abs); }
    if (r.t === 'image' && buf && makeThumb) r.th = makeThumb(buf) || '';
    this._bump(r); this.d.recs[r.id] = r; this.save(); return r;
  }
  edit(id, p) {
    const r = this.d.recs[id]; if (!r || r.dl === 2) return null;
    if (typeof p.tx === 'string') { r.tx = p.tx.replace(/\r\n/g, '\n').slice(0, r.k === 'n' ? 60 : 20000); if (r.k === 'n' && !r.tx.trim()) return null; }
    if (r.k === 'n' && typeof p.icon === 'string') r.fn = p.icon.slice(0, 8);
    if (p.pn !== undefined) r.pn = p.pn ? 1 : 0;
    if (Array.isArray(p.tg)) r.tg = p.tg.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    if (typeof p.ng === 'string' && r.k === 'm') { const c = this.d.recs[p.ng]; if (c && c.k === 'n' && c.dl === 0) r.ng = p.ng; }
    r.up = Math.max(Date.now(), r.up + 1); r.pd = 1; this._bump(r); this.save(); return r;
  }
  setDl(id, dl) {
    const r = this.d.recs[id]; if (!r || r.dl === 2 || id === 'mydocs') return null;
    if (dl === 0 && r.k === 'm') { const c = this.d.recs[r.ng]; if (!c || c.dl !== 0) r.ng = 'mydocs'; } // ngăn đã xóa → trả về ngăn mặc định
    if (dl === 2) { this._rmFile(r); r.tx = ''; r.th = ''; }
    r.dl = dl; r.up = Math.max(Date.now(), r.up + 1); r.pd = 1; this._bump(r); this.save(); return r;
  }
  delNgan(id) {
    if (id === 'mydocs') return false;
    const c = this.d.recs[id]; if (!c || c.k !== 'n' || c.dl !== 0) return false;
    Object.values(this.d.recs).forEach((r) => { if (r.k === 'm' && r.ng === id && r.dl === 0) this.setDl(r.id, 1); });
    this.setDl(id, 1); return true;
  }
  addNgan(name, icon) {
    const tx = String(name || '').trim().slice(0, 60); if (!tx) return null;
    const now = Date.now();
    const r = { id: newId(), k: 'n', tx, fn: String(icon || '').slice(0, 8), ts: now, up: now, dl: 0, pn: 0, tg: [], src: 'pc', pd: 1, lf: '' };
    this._bump(r); this.d.recs[r.id] = r; this.save(); return r;
  }
  view(r) {
    return { id: r.id, k: r.k, ng: r.ng, t: r.t, tx: r.tx, fn: r.fn, fs: r.fs, mt: r.mt, th: r.th || '', ts: r.ts, up: r.up, pn: r.pn, tg: r.tg || [], dl: r.dl, src: r.src,
      local: !!r.lf, wait: r.k === 'm' && r.t !== 'text' && !r.lf, pend: r.pd ? 1 : 0, big: r.bg ? 1 : 0 };
  }
  nganList() {
    const cnt = {}, last = {};
    const all = Object.values(this.d.recs);
    all.forEach((r) => { if (r.k === 'm' && r.dl === 0) { cnt[r.ng] = (cnt[r.ng] || 0) + 1; if (!last[r.ng] || r.ts > last[r.ng].ts) last[r.ng] = r; } });
    return all.filter((r) => r.k === 'n' && r.dl === 0).sort((a, b) => (a.id === 'mydocs' ? -1 : b.id === 'mydocs' ? 1 : a.ts - b.ts))
      .map((r) => { const l = last[r.id]; return { id: r.id, name: r.tx, icon: r.fn || '', count: cnt[r.id] || 0, lastTs: l ? l.ts : 0, lastText: l ? (l.t === 'text' ? l.tx : (l.t === 'image' ? '🖼 ' : '📎 ') + (l.fn || '')) : '' }; });
  }
  trashCount() { let n = 0; Object.values(this.d.recs).forEach((r) => { if (r.k === 'm' && r.dl === 1) n++; }); return n; }
  list(o) {
    o = o || {};
    const limit = Math.min(Math.max(+o.limit || 200, 20), 1000), nq = o.q ? noAcc(o.q) : '', f = o.filter || 'all';
    const hit = (r) => !nq || noAcc(r.tx + ' ' + r.fn + ' ' + (r.tg || []).join(' ')).includes(nq);
    const inCh = (r) => (o.all && nq) ? true : r.ng === o.ng;
    let counts = null;
    const msgs = Object.values(this.d.recs).filter((r) => r.k === 'm');
    if (f !== 'trash') {
      counts = { all: 0, image: 0, file: 0, link: 0, pin: 0 };
      msgs.forEach((r) => {
        if (r.dl !== 0 || r.ng !== o.ng) return;
        counts.all++; if (r.t === 'image') counts.image++; else if (r.t === 'file') counts.file++;
        if (r.t === 'text' && URL_RE.test(r.tx)) counts.link++; if (r.pn) counts.pin++;
      });
    }
    let arr = msgs.filter((r) => {
      if (f === 'trash') return r.dl === 1 && hit(r);
      if (r.dl !== 0 || !inCh(r) || !hit(r)) return false;
      if (f === 'image') return r.t === 'image';
      if (f === 'file') return r.t === 'file';
      if (f === 'link') return r.t === 'text' && URL_RE.test(r.tx);
      if (f === 'pin') return !!r.pn;
      return true;
    }).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    if (o.before) arr = arr.filter((r) => r.ts < +o.before);
    const hasMore = arr.length > limit, items = arr.slice(-limit).map((r) => this.view(r));
    return { items, hasMore, counts, trash: this.trashCount() };
  }
  since(sq, limit) {
    const rows = Object.values(this.d.recs).filter((r) => r.sq > sq).sort((a, b) => a.sq - b.sq);
    const part = rows.slice(0, limit), more = rows.length > part.length;
    return { rows: part.map((r) => this.wire(r)), seq: part.length ? part[part.length - 1].sq : this.d.seq, more };
  }
  pending() { return Object.values(this.d.recs).filter((r) => r.pd === 1).sort((a, b) => a.up - b.up); }
  needFiles() { return Object.values(this.d.recs).filter((r) => r.k === 'm' && r.t !== 'text' && r.dl === 0 && !r.lf && !r.fid).map((r) => r.id); }
}

// ============================================================================================ CÀI ĐẶT + CÀI ĐẶT ĐỒNG BỘ
function install(o) {
  const { ipcMain, dialog, shell, app, nativeImage, getWindow, getUser, baseDir, call, getSheetsCfg, verify, logError } = o;
  const root = path.join(baseDir, 'luu-tru');
  const cfgFile = path.join(baseDir, 'luu-tru-cfg.json');
  const stores = new Map();
  let cfg = { lan: { on: false, port: LAN_PORT_DEFAULT }, drive: { on: true, min: 5 } };
  try { const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); cfg = { lan: Object.assign(cfg.lan, c.lan), drive: Object.assign(cfg.drive, c.drive) }; } catch (e) { /* mặc định */ }
  const saveCfg = () => { try { fs.mkdirSync(baseDir, { recursive: true }); fs.writeFileSync(cfgFile + '.tam', JSON.stringify(cfg, null, 2)); fs.renameSync(cfgFile + '.tam', cfgFile); } catch (e) { logError && logError('Lưu cài đặt Lưu trữ', e); } };

  function getStore(tk) {
    if (!TK_RE.test(tk)) throw new Error('Tên tài khoản không hợp lệ.');
    let s = stores.get(tk);
    if (!s) { s = new Store(path.join(root, tk), tk); stores.set(tk, s); }
    return s;
  }
  const knownAccounts = () => { try { return fs.readdirSync(root).filter((d) => TK_RE.test(d) && fs.existsSync(path.join(root, d, 'data.json'))); } catch (e) { return []; } };
  const flushAll = () => stores.forEach((s) => { if (s._t) s.flush(); });
  if (app) app.on('before-quit', flushAll);

  const makeThumb = (buf) => {
    try {
      const im = nativeImage.createFromBuffer(buf); if (im.isEmpty()) return '';
      const sz = im.getSize(), k = Math.min(1, 240 / Math.max(sz.width, sz.height, 1));
      const t = k < 1 ? im.resize({ width: Math.max(1, Math.round(sz.width * k)), height: Math.max(1, Math.round(sz.height * k)), quality: 'good' }) : im;
      const j = t.toJPEG(62); return j.length > 18000 ? '' : 'data:image/jpeg;base64,' + j.toString('base64');
    } catch (e) { return ''; }
  };

  // -------------------------------------------------------------------------------------- GOOGLE DRIVE (qua Apps Script)
  const drv = { busy: false, last: 0, ok: null, err: '', tk: '' };
  const driveReady = () => { const c = getSheetsCfg(); return !!(c && c.webAppUrl && c.pcToken); };
  async function driveFileGet(st, r) { // tải file từ Drive về PC (khi chưa có bản trên máy)
    if (!r || r.lf || !r.fid || r.dl !== 0 || !driveReady()) return false;
    const res = await call(getSheetsCfg(), 'pc.ltFileGet', { tk: st.tk, fid: r.fid }, 300000);
    const buf = Buffer.from(res.b64 || '', 'base64');
    if (!buf.length) return false;
    r.lf = st.relOf(r); const abs = path.join(st.filesDir, r.lf);
    fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf); st.save();
    return true;
  }
  async function driveSync(tk) {
    if (drv.busy) return { ok: false, error: 'Đang đồng bộ, chờ một lát.' };
    if (!driveReady()) return { ok: false, error: 'Chưa cài Web App / PC_TOKEN (Cài đặt › Đồng bộ điện thoại).' };
    drv.busy = true; drv.tk = tk;
    const st = getStore(tk), conf = getSheetsCfg();
    try {
      // 1) ĐẨY bản ghi đang chờ
      let guard = 0;
      for (;;) {
        const pend = st.pending().slice(0, 40);
        if (!pend.length || ++guard > 200) break;
        const sent = [];
        for (const r of pend) {
          if (r.k === 'm' && r.t !== 'text' && r.dl === 0 && !r.fid && !r.bg) {
            const abs = st.abs(r);
            if (!abs || !fs.existsSync(abs)) { sent.push(r); continue; } // file chưa về PC — đẩy tin trước
            if (fs.statSync(abs).size > MAX_DRIVE) { r.bg = 1; }
            else { const up = await call(conf, 'pc.ltFilePut', { tk, id: r.id, name: r.fn, mime: r.mt, b64: fs.readFileSync(abs).toString('base64') }, 300000); r.fid = up.fid; }
          }
          sent.push(r);
        }
        const upSnap = sent.map((r) => r.up);
        await call(conf, 'pc.ltPush', { tk, rows: sent.map((r) => st.wire(r)) }, 300000);
        sent.forEach((r, i) => { if (r.up === upSnap[i]) r.pd = 0; });
        st.save();
      }
      // 2) KÉO bản ghi mới
      let since = st.d.cur.drv || 0, loops = 0;
      for (;;) {
        const res = await call(conf, 'pc.ltPull', { tk, since, limit: 300 }, 300000);
        (res.rows || []).forEach((w) => st.merge(w, 'drv'));
        since = +res.seq || since; st.d.cur.drv = since; st.save();
        if (!res.more || ++loops > 100) break;
      }
      // 3) TẢI file mới (tối đa 8 file mỗi lượt, file còn lại lượt sau / khi mở)
      let n = 0;
      for (const r of Object.values(st.d.recs)) {
        if (n >= 8) break;
        if (r.k === 'm' && r.t !== 'text' && r.dl === 0 && !r.lf && r.fid && (r.fs || 0) <= MAX_DRIVE) { try { await driveFileGet(st, r); n++; } catch (e) { break; } }
      }
      drv.ok = true; drv.err = ''; drv.last = Date.now();
      return { ok: true };
    } catch (e) { drv.ok = false; drv.err = e.message; return { ok: false, error: e.message }; }
    finally { drv.busy = false; }
  }
  let kickT = null;
  const kick = (tk) => { if (!cfg.drive.on || !driveReady()) return; clearTimeout(kickT); kickT = setTimeout(() => { driveSync(tk).catch(() => {}); }, 2000); }; // PC 1.04: đẩy lên Drive sau 2 giây
  setInterval(async () => {
    if (!cfg.drive.on || !(cfg.drive.min > 0) || !driveReady() || drv.busy) return;
    if (Date.now() - drv.last < cfg.drive.min * 60000) return;
    drv.last = Date.now() - cfg.drive.min * 60000 + 30000; // lỗi thì thử lại sau ~30 giây thay vì mỗi phút
    for (const tk of knownAccounts()) { const r = await driveSync(tk); if (!r.ok) break; }
  }, 15000).unref(); // PC 1.04: kiểm tra mỗi 15 giây (chu kỳ chọn trong cài đặt quyết định có chạy hay không)

  // -------------------------------------------------------------------------------------- MÁY CHỦ LAN CHO ĐIỆN THOẠI
  let lanSrv = null, lanUp = false, lanErr = '';
  const fails = new Map();
  const blocked = (ip) => { const f = fails.get(ip); return !!(f && f.n >= 8 && Date.now() < f.until); };
  const failed = (ip) => { const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 60000; fails.set(ip, f); };
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-LT-User, X-LT-Token',
    'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' };
  const sendJson = (res, code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length }, CORS)); res.end(b); };
  const readBody = (req, max) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('Dữ liệu quá lớn.'), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  async function lanHandle(req, res) {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      const u = new URL(req.url, 'http://x'), p = u.pathname;
      if (p === '/lt/ping') return sendJson(res, 200, { ok: true, app: 'kholanh-lt', v: 1 });
      const ip = req.socket.remoteAddress || '';
      if (blocked(ip)) return sendJson(res, 429, { ok: false, error: 'Thử sai nhiều lần — chờ 1 phút.' });
      const au = verify(req.headers['x-lt-user'], req.headers['x-lt-token']);
      if (!au) { failed(ip); return sendJson(res, 401, { ok: false, code: 'AUTH', error: 'Sai tên người dùng hoặc mã truy cập.' }); }
      if (au.denied) return sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Tài khoản chưa được cấp quyền “Lưu trữ cá nhân” cho điện thoại.' });
      fails.delete(ip);
      const st = getStore(tkOf(au.ten));
      if (req.method === 'POST' && p === '/lt/pull') {
        const b = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
        const r = st.since(+b.since || 0, 300);
        return sendJson(res, 200, { ok: true, rows: r.rows, seq: r.seq, more: r.more });
      }
      if (req.method === 'POST' && p === '/lt/push') {
        const b = JSON.parse((await readBody(req, 8 * 1048576)).toString('utf8') || '{}');
        let n = 0;
        (Array.isArray(b.rows) ? b.rows.slice(0, 300) : []).forEach((w) => { if (st.merge(w, 'lan')) n++; });
        if (n) { st.save(); kick(st.tk); }
        return sendJson(res, 200, { ok: true, n, need: st.needFiles().slice(0, 200) });
      }
      const m = /^\/lt\/file\/([A-Za-z0-9_-]{1,64})$/.exec(p);
      if (m && req.method === 'PUT') {
        const len = +req.headers['content-length'] || 0;
        if (len > MAX_LOCAL) return sendJson(res, 413, { ok: false, error: 'File quá lớn (tối đa ' + Math.round(MAX_LOCAL / 1048576) + ' MB).' });
        const dir = path.join(st.filesDir, '_in'); fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, m[1] + '.part'); const ws = fs.createWriteStream(tmp); let n = 0, bad = false;
        req.on('data', (c) => { n += c.length; if (n > MAX_LOCAL && !bad) { bad = true; req.destroy(); ws.destroy(); } });
        req.pipe(ws);
        ws.on('finish', () => {
          try { fs.renameSync(tmp, path.join(dir, m[1])); const r = st.d.recs[m[1]]; if (r) { if (r.lf) { try { fs.unlinkSync(path.join(dir, m[1])); } catch (x) { /* không có */ } } else { st.adopt(r); st.save(); } } } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
          sendJson(res, 200, { ok: true });
        });
        ws.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (x) { /* không có */ } sendJson(res, 500, { ok: false, error: e.message }); });
        return;
      }
      if (m && req.method === 'GET') {
        const r = st.d.recs[m[1]];
        if (!r || r.k !== 'm' || r.dl === 2) return sendJson(res, 404, { ok: false, code: 'NOFILE', error: 'Không có file.' });
        if (!r.lf) { try { await driveFileGet(st, r); } catch (e) { /* báo bên dưới */ } }
        const abs = st.abs(r);
        if (!abs || !fs.existsSync(abs)) return sendJson(res, 404, { ok: false, code: 'NOFILE', error: 'File chưa có trên PC.' });
        const size = fs.statSync(abs).size;
        res.writeHead(200, Object.assign({ 'Content-Type': r.mt || 'application/octet-stream', 'Content-Length': size }, CORS));
        return fs.createReadStream(abs).pipe(res);
      }
      return sendJson(res, 404, { ok: false, error: 'Không có chức năng.' });
    } catch (e) {
      const code = e && e.code === 413 ? 413 : 500;
      try { sendJson(res, code, { ok: false, error: code === 413 ? e.message : 'Lỗi máy chủ: ' + e.message }); } catch (x) { /* đã đóng */ }
    }
  }
  function lanStop() { try { if (lanSrv) lanSrv.close(); } catch (e) { /* đã đóng */ } lanSrv = null; lanUp = false; }
  function lanStart() {
    lanStop(); lanErr = '';
    if (!cfg.lan.on) return;
    const port = Math.min(65535, Math.max(1024, +cfg.lan.port || LAN_PORT_DEFAULT));
    const srv = http.createServer((req, res) => { lanHandle(req, res); });
    srv.requestTimeout = 0; srv.headersTimeout = 30000;
    srv.on('error', (e) => { lanUp = false; lanErr = e.code === 'EADDRINUSE' ? 'Cổng ' + port + ' đang được dùng — đổi cổng khác.' : e.message; });
    srv.listen(port, '0.0.0.0', () => { lanUp = true; lanErr = ''; });
    lanSrv = srv;
  }
  const lanUrls = () => {
    const out = [], port = +cfg.lan.port || LAN_PORT_DEFAULT;
    Object.values(os.networkInterfaces()).forEach((a) => (a || []).forEach((i) => { if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + port); }));
    return out;
  };
  lanStart();
  if (app) app.on('before-quit', lanStop);

  // -------------------------------------------------------------------------------------- IPC cho giao diện
  const curStore = () => { const u = getUser(); if (!u) throw new Error('Chưa đăng nhập.'); return getStore(tkOf(u)); };
  const H = (ch, fn) => ipcMain.handle('lt:' + ch, async (e, ...a) => {
    if (!e.senderFrame || !String(e.senderFrame.url).startsWith('file://')) throw new Error('Nguồn gọi không hợp lệ.');
    try { return await fn(e, ...a); } catch (err) { throw new Error(err && err.message || String(err)); }
  });
  const status = (st) => ({
    rev: st.rev, pend: st.pending().length,
    drive: { on: !!cfg.drive.on, min: cfg.drive.min, ready: driveReady(), busy: drv.busy, last: drv.last, ok: drv.ok, err: drv.err },
    lan: { on: !!cfg.lan.on, up: lanUp, port: +cfg.lan.port || LAN_PORT_DEFAULT, urls: lanUp ? lanUrls() : [], err: lanErr },
    err: st.lastErr
  });
  const need = (st, id) => { const r = st.d.recs[id]; if (!r) throw new Error('Không tìm thấy mục này.'); return r; };

  H('init', () => { const st = curStore(); return { user: getUser(), ngan: st.nganList(), status: status(st), maxDriveMB: Math.round(MAX_DRIVE / 1048576), platform: 'pc' }; });
  H('ngan', () => curStore().nganList());
  H('list', (e, q) => curStore().list(q));
  H('send-text', (e, ng, text) => { const st = curStore(), r = st.addText(ng, text); if (!r) throw new Error('Tin nhắn trống.'); kick(st.tk); return st.view(r); });
  H('send-files', (e, ng, files) => {
    const st = curStore(), out = [];
    (Array.isArray(files) ? files : []).slice(0, 50).forEach((f) => {
      const buf = Buffer.from(f.buf || []);
      if (!buf.length) return; if (buf.length > MAX_LOCAL) throw new Error('File “' + f.name + '” quá lớn (tối đa ' + Math.round(MAX_LOCAL / 1048576) + ' MB).');
      out.push(st.view(st.addFile(ng, f.name || 'file', f.mime, { buf }, makeThumb)));
    });
    kick(st.tk); return out;
  });
  H('pick-send', async (e, ng) => {
    const st = curStore();
    const r = await dialog.showOpenDialog(getWindow() || undefined, { title: 'Chọn file để lưu', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return [];
    const out = [];
    for (const p of r.filePaths.slice(0, 50)) {
      const size = fs.statSync(p).size;
      if (size > MAX_LOCAL) throw new Error('File “' + path.basename(p) + '” quá lớn (tối đa ' + Math.round(MAX_LOCAL / 1048576) + ' MB).');
      out.push(st.view(st.addFile(ng, path.basename(p), mimeOf(p), { path: p }, makeThumb)));
    }
    kick(st.tk); return out;
  });
  H('edit', (e, id, patch) => { const st = curStore(); need(st, id); const r = st.edit(id, patch || {}); if (!r) throw new Error('Không sửa được.'); kick(st.tk); return st.view(r); });
  H('del', (e, id) => { const st = curStore(); need(st, id); st.setDl(id, 1); kick(st.tk); return true; });
  H('restore', (e, id) => { const st = curStore(); need(st, id); st.setDl(id, 0); kick(st.tk); return true; });
  H('purge', (e, id) => { const st = curStore(); need(st, id); st.setDl(id, 2); kick(st.tk); return true; });
  H('empty-trash', () => { const st = curStore(); let n = 0; Object.values(st.d.recs).forEach((r) => { if (r.k === 'm' && r.dl === 1) { st.setDl(r.id, 2); n++; } }); kick(st.tk); return n; });
  H('ngan-save', (e, ng) => {
    const st = curStore(); ng = ng || {};
    if (ng.id) { need(st, ng.id); const r = st.edit(ng.id, { tx: ng.name, icon: ng.icon }); if (!r) throw new Error('Tên ngăn trống.'); kick(st.tk); return st.nganList(); }
    if (!st.addNgan(ng.name, ng.icon)) throw new Error('Tên ngăn trống.'); kick(st.tk); return st.nganList();
  });
  H('ngan-del', (e, id) => { const st = curStore(); if (!st.delNgan(id)) throw new Error('Không xóa được ngăn này.'); kick(st.tk); return st.nganList(); });
  H('file-data', async (e, id) => {
    const st = curStore(), r = need(st, id);
    if (r.t === 'text') throw new Error('Mục này không có file.');
    if (!r.lf) { try { await driveFileGet(st, r); } catch (x) { throw new Error('File chưa có trên PC và không tải được từ Drive: ' + x.message); } }
    const abs = st.abs(r); if (!abs || !fs.existsSync(abs)) throw new Error('File chưa có trên PC — chờ đồng bộ (hoặc file lớn chỉ tải được qua LAN từ điện thoại).');
    if (fs.statSync(abs).size > 80 * 1048576) throw new Error('File lớn hơn 80 MB — dùng “Mở bằng ứng dụng” để xem.');
    return { name: r.fn, mime: r.mt, buf: fs.readFileSync(abs) };
  });
  const localAbs = async (st, r) => { if (!r.lf) { try { await driveFileGet(st, r); } catch (x) { /* báo dưới */ } } const a = st.abs(r); if (!a || !fs.existsSync(a)) throw new Error('File chưa có trên PC.'); return a; };
  H('open', async (e, id) => { const st = curStore(), r = need(st, id); const err = await shell.openPath(await localAbs(st, r)); if (err) throw new Error(err); return true; });
  H('show', async (e, id) => { const st = curStore(), r = need(st, id); shell.showItemInFolder(await localAbs(st, r)); return true; });
  H('save-as', async (e, id) => {
    const st = curStore(), r = need(st, id), src = await localAbs(st, r);
    const d = await dialog.showSaveDialog(getWindow() || undefined, { title: 'Lưu file', defaultPath: r.fn || 'file' });
    if (d.canceled || !d.filePath) return false;
    fs.copyFileSync(src, d.filePath); return true;
  });
  H('open-url', async (e, u) => { u = String(u || ''); if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 2000) throw new Error('Liên kết không hợp lệ.'); await shell.openExternal(u); return true; });
  H('status', () => status(curStore()));
  H('sync', async () => { const st = curStore(); const r = await driveSync(st.tk); return Object.assign({}, r, { status: status(st) }); });
  H('cfg-get', () => ({ lan: cfg.lan, drive: cfg.drive, maxDriveMB: Math.round(MAX_DRIVE / 1048576), urls: lanUrls(), status: status(curStore()) }));
  H('cfg-set', (e, p) => {
    p = p || {};
    if (p.lan) { if (p.lan.on !== undefined) cfg.lan.on = !!p.lan.on; if (p.lan.port !== undefined) cfg.lan.port = Math.min(65535, Math.max(1024, +p.lan.port || LAN_PORT_DEFAULT)); }
    if (p.drive) { if (p.drive.on !== undefined) cfg.drive.on = !!p.drive.on; if (p.drive.min !== undefined) cfg.drive.min = [0, 0.25, 1, 5, 10, 30, 60].includes(+p.drive.min) ? +p.drive.min : 5; }
    saveCfg(); lanStart();
    return new Promise((r) => setTimeout(() => r({ lan: cfg.lan, drive: cfg.drive, urls: lanUrls(), status: status(curStore()) }), 400));
  });
  return { getStore, flushAll, tkOf, Store };
}

module.exports = { install, Store, tkOf, noAcc, safeName, mimeOf };
