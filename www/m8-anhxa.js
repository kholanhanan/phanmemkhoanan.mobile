/* ÁNH XẠ TÊN HÀNG (PC 1.08 / ĐT 1.05) — bảng "mã → tên hiển thị" sửa được trong Tổng hợp › Ánh xạ tên hàng.
   Thay các bảng viết cứng trước đây: TAB3_PRODUCT_STAGE_MAP / TAB3_MARKET_CUSTOMER_MAP (tong-hop.js, Báo cáo rã đông),
   VT_GOP_PREFIX / VT_GOP_MARKET (ton-kho-an-an.js, nhãn gộp "BTP 50"), và bản chép trong size-label.js (PC + điện thoại).
   Dùng CHUNG: trình duyệt (window.KLAnhXa), main.js (require) và điện thoại (www/m8-anhxa.js — chép y nguyên).

   MỖI DÒNG = { pv, ma, full, short }:
     pv  'SP' = Tên sản phẩm (4 ký tự đầu của mã; "P" coi như "V": PRHL ≡ VRHL)
         'TT' = Thị trường + Khách hàng (ký tự 8–10, 3 ký tự: XTC, XEC, XAI…)
         'MB' = Mạ băng (ký tự 11–13, 3 ký tự: TGS…)
     full   tên ĐẦY ĐỦ  — Báo cáo rã đông (màn hình + file Excel gửi ban giám đốc). Để trống → dùng tên viết tắt.
     short  tên VIẾT TẮT — nhãn Size gọn ở Tồn kho An An ("TGC 41/50"), ô tìm chung và điện thoại. Để trống → nơi đó KHÔNG đổi tên mã này.
   TUỲ CHỌN theo từng nơi (opts): ratd = Báo cáo rã đông, tk = Tồn kho An An / tìm kiếm / điện thoại;
     tachTT = có tách theo Thị trường + Khách hàng không · tachMB = có tách theo Mạ băng không.
   Mã không có các đoạn đó (XXX) → không bị tách: ra thẳng tên sản phẩm (BTP / NL).
   Quy tắc ghi đè giữ ĐÚNG như trước: sản phẩm → bị ghi đè bởi Thị trường+Khách hàng → bị ghi đè bởi Mạ băng. */
(function (root) {
  'use strict';
  const PV = {
    SP: { len: 4, label: 'Tên sản phẩm (ký tự 1–4)' },
    TT: { len: 3, label: 'Thị trường + Khách hàng (ký tự 8–10)' },
    MB: { len: 3, label: 'Mạ băng (ký tự 11–13)' },
  };
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

  function cleanRows(rows) {
    const m = new Map();
    (rows || []).forEach((r) => {
      if (!r) return;
      const pv = String(r.pv == null ? '' : r.pv).toUpperCase();
      if (!PV[pv]) return;
      let ma = up(r.ma); if (pv === 'SP') ma = ma.replace(/^P/, 'V');
      if (ma.length !== PV[pv].len) return;
      m.set(pv + '|' + ma, { pv, ma, full: String(r.full == null ? '' : r.full).trim(), short: String(r.short == null ? '' : r.short).trim() });
    });
    return Array.from(m.values());
  }
  function cleanOpts(o) {
    const d = clone(DEFAULT_OPTS);
    if (o && typeof o === 'object') ['ratd', 'tk'].forEach((k) => { if (o[k] && typeof o[k] === 'object') ['tachTT', 'tachMB'].forEach((f) => { if (typeof o[k][f] === 'boolean') d[k][f] = o[k][f]; }); });
    return d;
  }
  function defaults() { return { rows: clone(DEFAULT_ROWS), opts: clone(DEFAULT_OPTS) }; }

  // data = { rows, opts } hoặc null (→ mặc định)
  function create(data) {
    const rows = cleanRows(data && Array.isArray(data.rows) ? data.rows : DEFAULT_ROWS), opts = cleanOpts(data && data.opts);
    const idx = new Map(rows.map((r) => [r.pv + '|' + r.ma, r]));
    const get = (pv, ma) => idx.get(pv + '|' + (pv === 'SP' ? up(ma).replace(/^P/, 'V') : up(ma))) || null;
    const full = (r) => (r ? (r.full || r.short || '') : '');
    const short = (r) => (r ? r.short : '');
    const o = {
      rows, opts, PV,
      // ---- tên ĐẦY ĐỦ (Báo cáo rã đông) ----
      spFull: (c4) => full(get('SP', c4)), ttFull: (c3) => full(get('TT', c3)), mbFull: (c3) => full(get('MB', c3)),
      // ---- tên VIẾT TẮT (Tồn kho An An / tìm kiếm / điện thoại): chỉ dòng có tên viết tắt ----
      spShort: (c4) => short(get('SP', c4)), ttShort: (c3) => short(get('TT', c3)), mbShort: (c3) => short(get('MB', c3)),
      // Tiền tố nhãn cho mã 21 ký tự ('' = không gộp / không đổi tên): sản phẩm → ghi đè bởi Thị trường+Khách hàng → ghi đè bởi Mạ băng.
      shortPrefix(ma) {
        ma = up(ma); let pre = o.spShort(ma.slice(0, 4));
        if (!pre) return '';
        if (opts.tk.tachTT) { const t = o.ttShort(ma.slice(7, 10)); if (t) pre = t; }
        if (opts.tk.tachMB) { const m = o.mbShort(ma.slice(10, 13)); if (m) pre = m; }
        return pre;
      },
    };
    return o;
  }

  // ---- Lưu / đọc trong database Excel (module8: sheet AnhXaTen + AnhXaCauHinh) ----
  function toSheets(ax) {
    const d = ax && Array.isArray(ax.rows) ? ax : defaults();
    return {
      AnhXaTen: cleanRows(d.rows).map((r) => ({ 'Phạm vi': r.pv, 'Mã': r.ma, 'Tên đầy đủ': r.full, 'Tên viết tắt': r.short })),
      AnhXaCauHinh: [{ data: '__JSON__' + JSON.stringify({ opts: cleanOpts(d.opts) }) }],
    };
  }
  // Sheet AnhXaCauHinh chưa có (chưa mở Tổng hợp bản 1.08) → null = dùng mặc định.
  function fromSheets(rowsSheet, cfgSheet) {
    const c = cfgSheet && cfgSheet[0] && cfgSheet[0].data; let cfg = null;
    if (typeof c === 'string' && c.indexOf('__JSON__') === 0) { try { cfg = JSON.parse(c.slice(8)); } catch (e) { cfg = null; } }
    if (!cfg) return null;
    return { rows: cleanRows((rowsSheet || []).map((r) => ({ pv: r['Phạm vi'], ma: r['Mã'], full: r['Tên đầy đủ'], short: r['Tên viết tắt'] }))), opts: cleanOpts(cfg.opts) };
  }
  // read(tênSheet) → mảng dòng (hoặc Promise). Dùng ở các module khác (chỉ ĐỌC).
  async function load(read) {
    try { const a = await read('AnhXaTen'), b = await read('AnhXaCauHinh'); return create(fromSheets(a, b)); }
    catch (e) { return create(null); }
  }
  // ---- Bảng gửi điện thoại (tab Google Sheet M08_AnhXa: pv | ma | full | short; dòng pv = CFG mang tuỳ chọn) ----
  function toTable(ax) {
    const d = ax && Array.isArray(ax.rows) ? ax : defaults(), opts = cleanOpts(d.opts), out = [];
    cleanRows(d.rows).forEach((r) => out.push({ pv: r.pv, ma: r.ma, full: r.full, short: r.short }));
    ['ratd', 'tk'].forEach((k) => ['tachTT', 'tachMB'].forEach((f) => out.push({ pv: 'CFG', ma: k + '.' + f, full: opts[k][f] ? '1' : '0', short: '' })));
    return out;
  }
  // headers: ['pv','ma','full','short'], rows: mảng mảng (kiểu điện thoại nhận từ Web App). Chưa có dòng nào → mặc định.
  function fromTable(headers, rows) {
    if (!Array.isArray(headers) || !Array.isArray(rows) || !rows.length) return create(null);
    const ix = (n) => headers.indexOf(n), iP = ix('pv'), iM = ix('ma'), iF = ix('full'), iS = ix('short');
    if (iP < 0 || iM < 0) return create(null);
    const list = [], opts = clone(DEFAULT_OPTS);
    rows.forEach((r) => {
      const pv = String(r[iP] == null ? '' : r[iP]).toUpperCase();
      if (pv === 'CFG') { const m = /^(ratd|tk)\.(tachTT|tachMB)$/.exec(String(r[iM] || '')); if (m) opts[m[1]][m[2]] = String(r[iF]) !== '0'; return; }
      list.push({ pv, ma: r[iM], full: iF >= 0 ? r[iF] : '', short: iS >= 0 ? r[iS] : '' });
    });
    return create({ rows: list, opts });
  }
  const api = { PV, DEFAULT_ROWS, DEFAULT_OPTS, defaults, create, cleanRows, cleanOpts, toSheets, fromSheets, load, toTable, fromTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KLAnhXa = api;
})(typeof window !== 'undefined' ? window : this);
