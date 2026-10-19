/* ÁNH XẠ TÊN HÀNG (PC 1.08 / ĐT 1.05; PC 1.40 / ĐT 1.11 thêm LOẠI QUY TẮC TỰ ĐỊNH NGHĨA + QUY TẮC KẾT HỢP)
   — bảng "mã → tên hiển thị" sửa được trong Tổng hợp › Ánh xạ tên hàng.
   Thay các bảng viết cứng trước đây: TAB3_PRODUCT_STAGE_MAP / TAB3_MARKET_CUSTOMER_MAP (tong-hop.js, Báo cáo rã đông),
   VT_GOP_PREFIX / VT_GOP_MARKET (ton-kho-an-an.js, nhãn gộp "BTP 50"), và bản chép trong size-label.js (PC + điện thoại).
   Dùng CHUNG: trình duyệt (window.KLAnhXa), main.js (require) và điện thoại (www/m8-anhxa.js — chép y nguyên).

   DỮ LIỆU = { rows, segs, combos, opts }
   ① segs — LOẠI QUY TẮC = 1 đoạn ký tự của mã 21 ký tự: { id, label, from, to } (from/to tính từ 1).
        3 loại MẶC ĐỊNH (không xoá được, sửa tên / vị trí được):
          SP = Tên sản phẩm (ký tự 1–4; "P" coi như "V": PRHL ≡ VRHL) · TT = Thị trường + Khách hàng (8–10) · MB = Mạ băng (11–13).
        Loại người dùng thêm có id tự sinh X1, X2… Thứ tự trong mảng = thứ tự GHI ĐÈ: SP là nền (luôn đứng đầu), các loại sau
        ghi đè lên nhau theo thứ tự (loại đứng sau thắng) — mặc định SP → TT → MB đúng như trước.
   ② rows — QUY TẮC ĐƠN LẺ: { pv, ma, full, short }, pv = id loại, ma dài đúng (to − from + 1) ký tự.
        full  tên ĐẦY ĐỦ  — Báo cáo rã đông (màn hình + file Excel gửi ban giám đốc). Trống → dùng tên viết tắt.
        short tên VIẾT TẮT — nhãn Size gọn ở Tồn kho An An ("TGC 41/50"), ô tìm chung và điện thoại. Trống → nơi đó KHÔNG đổi tên mã này.
   ③ combos — QUY TẮC KẾT HỢP: { when:{ SP:'VRHL', TT:'XTC' }, full, short } — chỉ khớp khi ĐỦ MỌI điều kiện (2 loại trở lên).
        Quy tắc kết hợp THẮNG quy tắc đơn lẻ; nhiều quy tắc kết hợp cùng khớp → nhiều điều kiện hơn thắng; bằng nhau → quy tắc đứng TRÊN
        (trong mảng) thắng. Nếu không quy tắc kết hợp nào khớp → ghép từ các quy tắc đơn như trước (dữ liệu cũ chạy y nguyên).
   ④ opts — TUỲ CHỌN theo từng nơi: ratd = Báo cáo rã đông, tk = Tồn kho An An / tìm kiếm / điện thoại; mỗi loại (trừ SP) có
        'tach'+id (tachTT, tachMB, tachX1…) = nơi đó có tách theo loại này không. Quy tắc kết hợp chỉ áp dụng ở nơi đang BẬT tách
        cho MỌI loại (trừ SP) trong điều kiện của nó.
   Mã không có các đoạn đó (XXX) → không bị tách: ra thẳng tên sản phẩm (BTP / NL). */
(function (root) {
  'use strict';
  const MAX_CODE = 21;
  const RESERVED = new Set(['CB', 'CFG', 'SEG']);   // pv đặc biệt trong bảng gửi điện thoại / sheet
  // 3 loại mặc định = đúng 3 đoạn cũ.
  const DEFAULT_SEGS = [
    { id: 'SP', label: 'Tên sản phẩm', from: 1, to: 4 },
    { id: 'TT', label: 'Thị trường + Khách hàng', from: 8, to: 10 },
    { id: 'MB', label: 'Mạ băng', from: 11, to: 13 },
  ];
  const BUILTIN = DEFAULT_SEGS.map((s) => s.id);
  // Dòng mặc định = đúng các bảng viết cứng trước đây (rã đông: tên đầy đủ · Tồn kho: viết tắt; VRPD chỉ có ở rã đông).
  const DEFAULT_ROWS = [
    { pv: 'SP', ma: 'VRHL', full: 'BTP', short: 'BTP' },
    { pv: 'SP', ma: 'VRHO', full: 'NL', short: 'NL' },
    { pv: 'SP', ma: 'VRPD', full: 'RAW PD', short: '' },
    { pv: 'TT', ma: 'XEC', full: 'ECUADOR', short: 'Ecuador' },
    { pv: 'TT', ma: 'XTC', full: 'TÔM GIA CÔNG', short: 'TGC' },
    { pv: 'TT', ma: 'XAI', full: 'ẤN ĐỘ', short: 'AĐ' },
    { pv: 'MB', ma: 'TGS', full: 'TGS', short: 'TGS' },
  ];
  const DEFAULT_OPTS = { ratd: { tachTT: true, tachMB: true }, tk: { tachTT: true, tachMB: true } };
  const up = (s) => String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const str = (v) => String(v == null ? '' : v).trim();

  // ---------- LOẠI QUY TẮC (đoạn ký tự) ----------
  const segText = (s) => s.label + ' (ký tự ' + s.from + (s.to > s.from ? '–' + s.to : '') + ')';
  const segLen = (s) => s.to - s.from + 1;
  function cleanSegs(list) {
    const seen = new Set(), out = [];
    (Array.isArray(list) ? list : []).forEach((s) => {
      if (!s) return;
      const id = String(s.id == null ? '' : s.id).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const from = parseInt(s.from, 10), to = parseInt(s.to, 10);
      if (!id || seen.has(id) || (RESERVED.has(id)) || !(from >= 1) || !(to >= from) || to > MAX_CODE) return;
      const def = DEFAULT_SEGS.find((d) => d.id === id);
      seen.add(id);
      out.push({ id, label: str(s.label) || (def ? def.label : id), from, to });
    });
    if (!out.length) return clone(DEFAULT_SEGS);
    // SP luôn có và luôn đứng đầu (là nền); TT / MB thiếu thì thêm lại ngay sau SP.
    const spIdx = out.findIndex((s) => s.id === 'SP');
    const sp = spIdx >= 0 ? out.splice(spIdx, 1)[0] : clone(DEFAULT_SEGS[0]);
    const missing = DEFAULT_SEGS.slice(1).filter((d) => !seen.has(d.id)).map((d) => clone(d));
    return [sp].concat(missing, out);
  }
  function segMap(segs) { return new Map(segs.map((s) => [s.id, s])); }
  function pvOf(segs) { const o = {}; segs.forEach((s) => { o[s.id] = { len: segLen(s), label: segText(s), from: s.from, to: s.to, name: s.label }; }); return o; }
  const normMa = (id, v) => { v = up(v); return id === 'SP' ? v.replace(/^P/, 'V') : v; };

  // ---------- QUY TẮC ĐƠN LẺ ----------
  function cleanRows(rows, segs) {
    segs = segs || DEFAULT_SEGS; const S = segMap(segs), m = new Map();
    (rows || []).forEach((r) => {
      if (!r) return;
      const pv = String(r.pv == null ? '' : r.pv).toUpperCase(), seg = S.get(pv);
      if (!seg) return;
      const ma = normMa(pv, r.ma);
      if (ma.length !== segLen(seg)) return;
      m.set(pv + '|' + ma, { pv, ma, full: str(r.full), short: str(r.short) });
    });
    return Array.from(m.values());
  }

  // ---------- QUY TẮC KẾT HỢP ----------
  const condKey = (when, segs) => segs.filter((s) => when[s.id]).map((s) => s.id + '=' + when[s.id]).join('&');
  function condToStr(when, segs) { return condKey(when, segs); }
  function strToCond(s) {
    const o = {};
    String(s == null ? '' : s).split('&').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim().toUpperCase()] = p.slice(i + 1); });
    return o;
  }
  // Điều kiện sai (loại không tồn tại / sai độ dài) → BỎ CẢ quy tắc (bỏ riêng điều kiện sẽ làm quy tắc khớp rộng hơn ý người dùng).
  function cleanCombos(list, segs) {
    segs = segs || DEFAULT_SEGS; const S = segMap(segs), seen = new Set(), out = [];
    (Array.isArray(list) ? list : []).forEach((c) => {
      if (!c || !c.when || typeof c.when !== 'object') return;
      const when = {}; let ok = true, n = 0;
      Object.keys(c.when).forEach((k) => {
        const id = String(k).toUpperCase(), seg = S.get(id), v = c.when[k];
        if (v === '' || v == null) return;                       // điều kiện trống = không có điều kiện
        if (!seg) { ok = false; return; }
        const ma = normMa(id, v);
        if (ma.length !== segLen(seg)) { ok = false; return; }
        when[id] = ma; n++;
      });
      if (!ok || n < 1) return;
      const key = condKey(when, segs);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ when, full: str(c.full), short: str(c.short) });
    });
    return out;
  }

  // ---------- TUỲ CHỌN ----------
  function cleanOpts(o, segs) {
    segs = segs || DEFAULT_SEGS;
    const d = { ratd: {}, tk: {} };
    segs.forEach((s) => { if (s.id !== 'SP') { d.ratd['tach' + s.id] = true; d.tk['tach' + s.id] = true; } });
    if (o && typeof o === 'object') ['ratd', 'tk'].forEach((k) => { if (o[k] && typeof o[k] === 'object') Object.keys(d[k]).forEach((f) => { if (typeof o[k][f] === 'boolean') d[k][f] = o[k][f]; }); });
    return d;
  }
  // Làm sạch cả bộ dữ liệu (dùng cho giao diện: sau khi đọc về, để chỉ số dòng khớp với bảng đang hiển thị)
  function normalize(d) {
    const segs = cleanSegs(d && d.segs);
    return { rows: cleanRows(d && d.rows, segs), segs, combos: cleanCombos(d && d.combos, segs), opts: cleanOpts(d && d.opts, segs) };
  }
  function defaults() { return { rows: clone(DEFAULT_ROWS), segs: clone(DEFAULT_SEGS), combos: [], opts: clone(DEFAULT_OPTS) }; }

  // data = { rows, segs, combos, opts } hoặc null (→ mặc định). Dữ liệu cũ (chỉ rows + opts) chạy y nguyên.
  function create(data) {
    const segs = cleanSegs(data && data.segs);
    const rows = cleanRows(data && Array.isArray(data.rows) ? data.rows : DEFAULT_ROWS, segs);
    const combos = cleanCombos(data && data.combos, segs), opts = cleanOpts(data && data.opts, segs);
    const S = segMap(segs), spSeg = segs[0], others = segs.slice(1);
    const idx = new Map(rows.map((r) => [r.pv + '|' + r.ma, r]));
    const get = (pv, ma) => idx.get(pv + '|' + normMa(pv, ma)) || null;
    const full = (r) => (r ? (r.full || r.short || '') : '');
    const short = (r) => (r ? r.short : '');
    const val = (code, seg) => (code.length < seg.to ? '' : code.slice(seg.from - 1, seg.to));
    const on = (target, seg) => seg.id === 'SP' || opts[target === 'full' ? 'ratd' : 'tk']['tach' + seg.id] !== false;   // full = Báo cáo rã đông, short = Tồn kho / tìm kiếm / điện thoại
    const nameOf = (target, r) => (target === 'full' ? full(r) : short(r));

    // Quy tắc kết hợp đang khớp mã (đã sắp: nhiều điều kiện trước, bằng nhau thì đứng trên trước).
    function comboHits(code, target) {
      const hits = [];
      combos.forEach((c, i) => {
        const name = target === 'full' ? (c.full || c.short) : c.short;
        if (!name) return;
        const ids = Object.keys(c.when);
        for (const id of ids) {
          const seg = S.get(id);
          if (!seg || !on(target, seg) || normMa(id, val(code, seg)) !== c.when[id]) return;
        }
        hits.push({ i, c, name, n: ids.length });
      });
      return hits.sort((a, b) => (b.n - a.n) || (a.i - b.i));
    }
    // Ghép từ quy tắc đơn: nền SP → ghi đè theo thứ tự các loại sau (nếu nơi đó bật tách). steps = các quy tắc đơn đã khớp.
    function chain(code, target, base) {
      const steps = [], v0 = normMa('SP', val(code, spSeg));
      let label = nameOf(target, get('SP', v0));
      if (label) steps.push({ id: 'SP', ma: v0, name: label });
      else if (target === 'short') return { label: '', steps };    // viết tắt: sản phẩm không có tên viết tắt → không đổi tên
      else label = base || '';
      others.forEach((seg) => {
        if (!on(target, seg)) return;
        const v = normMa(seg.id, val(code, seg)), n = nameOf(target, get(seg.id, v));
        if (n) { label = n; steps.push({ id: seg.id, ma: v, name: n }); }
      });
      return { label, steps };
    }
    function resolve(code, target, base) {
      code = String(code == null ? '' : code).trim().toUpperCase();
      const hits = comboHits(code, target), ch = chain(code, target, base);
      if (hits.length) {
        const top = hits[0];
        return { label: top.name, via: 'combo', combo: top.c, comboIndex: top.i, steps: ch.steps, conflicts: hits.filter((h) => h !== top && h.n === top.n && h.name !== top.name).map((h) => h.i) };
      }
      return { label: ch.label, via: ch.steps.length ? 'rules' : (target === 'full' ? 'base' : 'none'), combo: null, comboIndex: -1, steps: ch.steps, conflicts: [] };
    }
    // Cặp quy tắc kết hợp CÙNG số điều kiện, có thể cùng khớp 1 mã (không điều kiện nào mâu thuẫn) mà cho tên khác nhau → xung đột, thứ tự quyết định.
    function overlaps() {
      const out = [];
      for (let a = 0; a < combos.length; a++) for (let b = a + 1; b < combos.length; b++) {
        const A = combos[a], B = combos[b];
        if (Object.keys(A.when).length !== Object.keys(B.when).length) continue;
        if (Object.keys(A.when).some((k) => B.when[k] != null && B.when[k] !== A.when[k])) continue;
        if (A.full === B.full && A.short === B.short) continue;
        out.push([a, b]);
      }
      return out;
    }
    const o = {
      rows, segs, combos, opts, PV: pvOf(segs), overlaps, comboHits,
      // ---- tên ĐẦY ĐỦ (Báo cáo rã đông) theo từng đoạn — giữ tên cũ ----
      spFull: (c4) => full(get('SP', c4)), ttFull: (c3) => full(get('TT', c3)), mbFull: (c3) => full(get('MB', c3)),
      // ---- tên VIẾT TẮT (Tồn kho An An / tìm kiếm / điện thoại): chỉ dòng có tên viết tắt ----
      spShort: (c4) => short(get('SP', c4)), ttShort: (c3) => short(get('TT', c3)), mbShort: (c3) => short(get('MB', c3)),
      // Tên hiển thị cho mã (quy tắc kết hợp trước, rồi ghép từ quy tắc đơn). base = nhãn gốc khi SP chưa có tên đầy đủ (rã đông).
      fullLabel: (code, base) => resolve(code, 'full', base).label,
      // Tiền tố nhãn cho mã 21 ký tự ('' = không gộp / không đổi tên).
      shortPrefix: (ma) => resolve(up(ma), 'short').label,
      // Giải thích 1 mã: quy tắc nào đã khớp, ở từng nơi (cho ô "Thử một mã hàng").
      explain: (code, base) => { code = up(code); return { code, full: resolve(code, 'full', base), short: resolve(code, 'short') }; },
    };
    return o;
  }

  // ---- bản ghi phẳng {pv, ma, full, short}: quy tắc đơn (pv = id loại) + quy tắc kết hợp (pv = 'CB', ma = 'SP=VRHL&TT=XTC') ----
  function records(d) {
    const segs = cleanSegs(d && d.segs), out = [];
    cleanRows(d && d.rows, segs).forEach((r) => out.push({ pv: r.pv, ma: r.ma, full: r.full, short: r.short }));
    cleanCombos(d && d.combos, segs).forEach((c) => out.push({ pv: 'CB', ma: condToStr(c.when, segs), full: c.full, short: c.short }));
    return out;
  }
  function fromRecords(recs, segs, opts) {
    const rowsIn = [], combosIn = [];
    (recs || []).forEach((r) => {
      if (String(r.pv).toUpperCase() === 'CB') combosIn.push({ when: strToCond(r.ma), full: r.full, short: r.short });
      else rowsIn.push(r);
    });
    return { rows: cleanRows(rowsIn, segs), segs, combos: cleanCombos(combosIn, segs), opts: cleanOpts(opts, segs) };
  }

  // ---- Lưu / đọc trong database Excel (module8: sheet AnhXaTen + AnhXaCauHinh). Quy tắc kết hợp nằm CHUNG sheet AnhXaTen (Phạm vi = CB). ----
  function toSheets(ax) {
    const d = ax && Array.isArray(ax.rows) ? ax : defaults(), segs = cleanSegs(d.segs);
    return {
      AnhXaTen: records(d).map((r) => ({ 'Phạm vi': r.pv, 'Mã': r.ma, 'Tên đầy đủ': r.full, 'Tên viết tắt': r.short })),
      AnhXaCauHinh: [{ data: '__JSON__' + JSON.stringify({ opts: cleanOpts(d.opts, segs), segs }) }],
    };
  }
  // Sheet AnhXaCauHinh chưa có (chưa mở Tổng hợp bản 1.08) → null = dùng mặc định.
  function fromSheets(rowsSheet, cfgSheet) {
    const c = cfgSheet && cfgSheet[0] && cfgSheet[0].data; let cfg = null;
    if (typeof c === 'string' && c.indexOf('__JSON__') === 0) { try { cfg = JSON.parse(c.slice(8)); } catch (e) { cfg = null; } }
    if (!cfg) return null;
    const segs = cleanSegs(cfg.segs);
    return fromRecords((rowsSheet || []).map((r) => ({ pv: r['Phạm vi'], ma: r['Mã'], full: r['Tên đầy đủ'], short: r['Tên viết tắt'] })), segs, cfg.opts);
  }
  // read(tênSheet) → mảng dòng (hoặc Promise). Dùng ở các module khác (chỉ ĐỌC).
  async function load(read) {
    try { const a = await read('AnhXaTen'), b = await read('AnhXaCauHinh'); return create(fromSheets(a, b)); }
    catch (e) { return create(null); }
  }
  // ---- Bảng gửi điện thoại (tab Google Sheet M08_AnhXa: pv | ma | full | short) ----
  //   pv = id loại → quy tắc đơn · CB → quy tắc kết hợp (ma = "SP=VRHL&TT=XTC") · SEG → loại quy tắc (ma = id, full = tên, short = "từ-đến")
  //   · CFG → tuỳ chọn (ma = "ratd.tachTT", full = 1/0). Bản điện thoại CŨ bỏ qua pv lạ (SEG / CB / loại mới) nên không hỏng.
  function toTable(ax) {
    const d = ax && Array.isArray(ax.rows) ? ax : defaults(), segs = cleanSegs(d.segs), opts = cleanOpts(d.opts, segs), out = [];
    segs.forEach((s) => out.push({ pv: 'SEG', ma: s.id, full: s.label, short: s.from + '-' + s.to }));
    records(d).forEach((r) => out.push(r));
    ['ratd', 'tk'].forEach((k) => Object.keys(opts[k]).forEach((f) => out.push({ pv: 'CFG', ma: k + '.' + f, full: opts[k][f] ? '1' : '0', short: '' })));
    return out;
  }
  // headers: ['pv','ma','full','short'], rows: mảng mảng (kiểu điện thoại nhận từ Web App). Chưa có dòng nào → mặc định.
  function fromTable(headers, rows) {
    if (!Array.isArray(headers) || !Array.isArray(rows) || !rows.length) return create(null);
    const ix = (n) => headers.indexOf(n), iP = ix('pv'), iM = ix('ma'), iF = ix('full'), iS = ix('short');
    if (iP < 0 || iM < 0) return create(null);
    const recs = [], segsIn = [], optsIn = { ratd: {}, tk: {} };
    rows.forEach((r) => {
      const pv = String(r[iP] == null ? '' : r[iP]).toUpperCase(), ma = r[iM], f = iF >= 0 ? r[iF] : '', s = iS >= 0 ? r[iS] : '';
      if (pv === 'CFG') { const m = /^(ratd|tk)\.(tach[A-Z0-9]+)$/.exec(String(ma || '')); if (m) optsIn[m[1]][m[2]] = String(f) !== '0'; return; }
      if (pv === 'SEG') { const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(s == null ? '' : s).trim()); if (m) segsIn.push({ id: ma, label: f, from: m[1], to: m[2] }); return; }
      recs.push({ pv, ma, full: f, short: s });
    });
    const segs = cleanSegs(segsIn);   // chưa có dòng SEG (PC cũ) → 3 loại mặc định
    return create(fromRecords(recs, segs, optsIn));
  }
  const PV = pvOf(DEFAULT_SEGS);
  const api = { PV, BUILTIN, MAX_CODE, DEFAULT_SEGS, DEFAULT_ROWS, DEFAULT_OPTS, defaults, normalize, create, cleanRows, cleanSegs, cleanCombos, cleanOpts, segText, segLen, condKey, condToStr, strToCond, toSheets, fromSheets, load, toTable, fromTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KLAnhXa = api;
})(typeof window !== 'undefined' ? window : this);
