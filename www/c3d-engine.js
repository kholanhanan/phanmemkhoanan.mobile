/* MODULE "CONTAINER LOADING 3D" — LÕI THUẬT TOÁN XẾP HÀNG (PC 8.57, 10/2026). KHÔNG đụng DOM → chạy được trong Node để kiểm thử.
   Hệ toạ độ (mm): x = dọc cont, 0 ở VÁCH ĐẦU (phía máy lạnh) → L ở CỬA · y = ngang cont (0 = vách PHẢI khi đứng ở cửa nhìn vào, tăng dần sang trái) · z = cao (0 = sàn).
   Cách làm (xếp theo "vách" từ trong ra ngoài, giống cách công nhân đóng hàng thật):
   1. Mỗi dòng hàng (mã hàng · size · ngày) là 1 NHÓM, sắp theo mã hàng > size > ngày. Nhóm đầu vào SÂU NHẤT (sát vách đầu), nhóm cuối sát cửa.
   2. Mỗi nhóm được xếp thành các VÁCH liên tiếp (vách = 1 lát cắt ngang cont, từ sàn lên đường red line). Thử mọi hướng đặt hợp lệ
      (dựng / nằm / xoay), kiểu cột thẳng, kiểu trộn cột cùng chiều sâu, kiểu SOLE (tầng lẻ xoay 90° so với tầng chẵn) rồi chọn phương án
      xếp được nhiều nhất / tốn ít chiều dài cont nhất.
   3. Mọi thùng đều có số thứ tự đóng (seq). Sau khi xếp, hàm verify() KIỂM LẠI độc lập: nằm trong cont, không chồng nhau, không vượt red line,
      mỗi thùng được đỡ đủ bên dưới (và thùng đỡ phải được đóng TRƯỚC), và không thùng nào bị thùng đóng trước chắn đường trượt từ cửa vào.
   4. Tải trọng: nhóm nào quá tải thì giảm số thùng; báo số thùng rớt lại kho + lý do. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.C3DEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const EPS = 1e-6;

  // ---------------------------------------------------------------- danh sách container lạnh mẫu (THAM KHẢO — sửa theo cont thực tế)
  const PRESETS = [
    { id: 'rf20', name: "Cont lạnh 20' RF", type: '20RF', L: 5450, W: 2290, H: 2270, doorW: 2290, doorH: 2260, maxPayload: 27400, redLine: 2170, clearFront: 50, clearRear: 50, clearSide: 10, note: 'Thông số tham khảo hãng tàu — kiểm tra lại cont thực tế.' },
    { id: 'rf40', name: "Cont lạnh 40' RF (thấp)", type: '40RF', L: 11560, W: 2290, H: 2250, doorW: 2290, doorH: 2180, maxPayload: 29000, redLine: 2150, clearFront: 50, clearRear: 50, clearSide: 10, note: 'Thông số tham khảo hãng tàu — kiểm tra lại cont thực tế.' },
    { id: 'rf40hc', name: "Cont lạnh 40' HC RF (cao)", type: '40HC', L: 11560, W: 2290, H: 2550, doorW: 2290, doorH: 2500, maxPayload: 29500, redLine: 2450, clearFront: 50, clearRear: 50, clearSide: 10, note: 'Thông số tham khảo hãng tàu — kiểm tra lại cont thực tế.' },
  ];

  // ---------------------------------------------------------------- tiện ích
  const num = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : (d || 0); };
  const flag = (v, d) => (v === undefined || v === null || v === '' ? d : (v === true || v === 1 || v === '1' || v === 'true'));
  const natKey = (s) => String(s == null ? '' : s).toLowerCase().match(/\d+|\D+/g) || [];
  function natCmp(a, b) {
    const A = natKey(a), B = natKey(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i], y = B[i];
      if (x === undefined) return -1; if (y === undefined) return 1;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) { const d = parseInt(x, 10) - parseInt(y, 10); if (d) return d; } else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  // ngày dd/mm/yyyy · dd-mm-yyyy · dd.mm.yyyy · yyyy-mm-dd · dd/mm (không năm → năm hiện tại). Không đọc được → NaN.
  function dateVal(s) {
    const t = String(s == null ? '' : s).trim(); if (!t) return NaN;
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return Date.UTC(y, +m[2] - 1, +m[1]); }
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})$/);
    if (m) return Date.UTC(new Date().getFullYear(), +m[2] - 1, +m[1]);
    return NaN;
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  // Hướng đặt do người dùng chọn: 3 chữ = (dọc cont, ngang cont, đứng) lấy từ Dài (L) / Rộng (W) / Cao (H) của thùng
  const PERMS = ['LWH', 'WLH', 'LHW', 'HLW', 'WHL', 'HWL'];

  // ---------------------------------------------------------------- chuẩn hoá đầu vào
  function normContainer(c) {
    c = c || {};
    const L = num(c.L), W = num(c.W), H = num(c.H);
    const o = {
      id: String(c.id || ''), name: String(c.name || ''), type: String(c.type || ''), L, W, H,
      doorW: num(c.doorW, W) || W, doorH: num(c.doorH, H) || H,
      maxPayload: num(c.maxPayload), redLine: num(c.redLine), clearFront: Math.max(0, num(c.clearFront)), clearRear: Math.max(0, num(c.clearRear)), clearSide: Math.max(0, num(c.clearSide)),
      note: String(c.note || ''),
    };
    return o;
  }
  function makeSpace(c) {
    const red = c.redLine > 0 ? c.redLine : c.H;
    const effH = Math.min(c.H, red, c.doorH > 0 ? c.doorH : c.H);
    const x0 = c.clearFront, x1 = c.L - c.clearRear, y0 = c.clearSide, y1 = c.W - c.clearSide;
    return { x0, x1, y0, y1, Lu: x1 - x0, Wu: y1 - y0, effH, red, L: c.L, W: c.W, H: c.H };
  }
  function normSku(s, i) {
    s = s || {};
    const o = {
      id: String(s.id || ('s' + i)), code: String(s.code == null ? '' : s.code).trim(), name: String(s.name || '').trim(), size: String(s.size == null ? '' : s.size).trim(), date: String(s.date == null ? '' : s.date).trim(),
      qty: Math.max(0, Math.floor(num(s.qty))), L: num(s.L), W: num(s.W), H: num(s.H), kg: Math.max(0, num(s.kg)),
      allowRotate: flag(s.allowRotate, true), allowStand: flag(s.allowStand, true), allowLay: flag(s.allowLay, false), sole: flag(s.sole, false),
      maxLayers: Math.max(0, Math.floor(num(s.maxLayers))), orient: PERMS.includes(s.orient) ? s.orient : '', rowPlan: String(s.rowPlan || '').trim(), rowSet: (s.rowSet && typeof s.rowSet === 'object') ? s.rowSet : {}, note: String(s.note || ''), color: String(s.color || ''), _idx: i,
    };
    if (!o.allowStand && !o.allowLay) o.allowStand = true; // không chọn gì → mặc định dựng đứng
    return o;
  }

  // ---------------------------------------------------------------- hướng đặt hợp lệ của 1 loại thùng
  // dx = theo chiều DÀI cont, dy = theo chiều NGANG cont, dz = chiều CAO. L (dài) mặc định nằm dọc cont khi KHÔNG cho xoay.
  function orientationsOf(k, sp) {
    if (k.orient) { // người dùng đã chốt hướng đặt → chỉ dùng đúng hướng đó
      const m = { L: k.L, W: k.W, H: k.H }, p = k.orient.split(''), o = { dx: m[p[0]], dy: m[p[1]], dz: m[p[2]], kind: p[2] === 'H' ? 'dung' : 'nam', rot: ['WLH', 'HLW', 'HWL'].includes(k.orient) ? 1 : 0 };
      return (o.dx <= sp.Lu + EPS && o.dy <= sp.Wu + EPS && o.dz <= sp.effH + EPS) ? [o] : [];
    }
    const l = k.L, w = k.W, h = k.H, all = [];
    const add = (dx, dy, dz, kind, rot) => { if (!all.some((o) => Math.abs(o.dx - dx) < EPS && Math.abs(o.dy - dy) < EPS && Math.abs(o.dz - dz) < EPS)) all.push({ dx, dy, dz, kind, rot }); };
    if (k.allowStand) { add(l, w, h, 'dung', 0); if (k.allowRotate) add(w, l, h, 'dung', 1); }
    if (k.allowLay) {
      add(l, h, w, 'nam', 0); if (k.allowRotate) add(h, l, w, 'nam', 1);
      add(w, h, l, 'nam', 0); if (k.allowRotate) add(h, w, l, 'nam', 1);
    }
    return all.filter((o) => o.dx <= sp.Lu + EPS && o.dy <= sp.Wu + EPS && o.dz <= sp.effH + EPS);
  }
  // thùng có đưa lọt cửa cont (xoay tay khi khiêng) không
  function passDoor(k, c) {
    const s = [k.L, k.W, k.H].sort((a, b) => a - b), d = [Math.min(c.doorW, c.doorH), Math.max(c.doorW, c.doorH)];
    return s[0] <= d[0] + EPS && s[1] <= d[1] + EPS;
  }

  // ---------------------------------------------------------------- các kiểu xếp 1 "vách"
  const mk = (x, y, z, o, tier) => ({ x, y, z, dx: o.dx, dy: o.dy, dz: o.dz, tier, ori: o.kind, rot: o.rot });

  // CỘT THẲNG: cả vách cùng 1 hướng; vách dày đúng 1 thùng (dx). style 'wide' = lên từng tầng, 'tall' = từng cột đầy.
  function colPattern(o, T, Wu) {
    const nc = Math.floor((Wu + EPS) / o.dy); if (nc < 1 || T < 1) return null;
    return {
      kind: 'col', o, D: o.dx, cap: nc * T, nc, T,
      build(count, style, ox, oy) {
        const out = []; let k = 0;
        if (style === 'tall') { for (let c = 0; c < nc && k < count; c++) for (let t = 0; t < T && k < count; t++, k++) out.push(mk(ox, oy + c * o.dy, t * o.dz, o, t + 1)); }
        else { for (let t = 0; t < T && k < count; t++) for (let c = 0; c < nc && k < count; c++, k++) out.push(mk(ox, oy + c * o.dy, t * o.dz, o, t + 1)); }
        return out;
      },
    };
  }
  // TRỘN CỘT: các hướng cùng chiều sâu dx nhưng khác (dy, dz) trong cùng vách (VD nằm + dựng) — quy hoạch động theo bề ngang.
  function mixPattern(os, Tof, Wu) {
    const types = os.map((o) => ({ o, T: Tof(o) })).filter((t) => t.T >= 1 && t.o.dy <= Wu + EPS);
    if (types.length < 2) return null;
    const W = Math.floor(Wu + EPS), dp = new Array(W + 1).fill(0), ch = new Array(W + 1).fill(-1);
    for (let w = 1; w <= W; w++) {
      dp[w] = dp[w - 1]; ch[w] = -1;
      types.forEach((t, i) => { const d = Math.ceil(t.o.dy - EPS); if (w >= d && dp[w - d] + t.T > dp[w]) { dp[w] = dp[w - d] + t.T; ch[w] = i; } });
    }
    const cols = []; let w = W;
    while (w > 0) { if (ch[w] === -1) { w--; continue; } const t = types[ch[w]]; cols.push(t); w -= Math.ceil(t.o.dy - EPS); }
    if (new Set(cols.map((t) => t.o)).size < 2) return null;
    cols.sort((a, b) => (a.o.dz - b.o.dz) || (a.o.dy - b.o.dy)); // cột thấp-nhiều-tầng gom 1 phía cho gọn
    const cap = cols.reduce((s, t) => s + t.T, 0);
    return {
      kind: 'mix', o: cols[0].o, D: cols[0].o.dx, cap, cols, T: Math.max(...cols.map((c) => c.T)),
      build(count, style, ox, oy) {
        const out = []; let k = 0, y = oy; const pos = cols.map((c) => { const p = y; y += c.o.dy; return p; });
        if (style === 'tall') { cols.forEach((c, i) => { for (let t = 0; t < c.T && k < count; t++, k++) out.push(mk(ox, pos[i], t * c.o.dz, c.o, t + 1)); }); }
        else { const TT = Math.max(...cols.map((c) => c.T)); for (let t = 0; t < TT && k < count; t++) cols.forEach((c, i) => { if (t < c.T && k < count) { out.push(mk(ox, pos[i], t * c.o.dz, c.o, t + 1)); k++; } }); }
        return out;
      },
    };
  }
  // SOLE (so le trái / phải): trong 1 dãy, tầng lẻ dồn sát vách này chừa khe ở vách kia, tầng chẵn làm ngược lại → mỗi tầng có 1 đường trống sát vách
  // cho hơi lạnh chạy từ đầu cont xuống cuối cont. Độ lệch giữa 2 tầng d = min(khe dư, nửa thùng) → thùng đầu/cuối hàng được đỡ ≥ 50% (trọng tâm vẫn nằm trên điểm đỡ).
  // Hướng nhìn từ cửa vào: y = 0 là vách PHẢI. Tầng 1: khe nằm ở vách phải (thùng dồn sang trái); tầng 2: khe ở vách trái.
  function solePattern(o, T, Wu, allowDrop) {
    if (T < 2) return null;
    let n = Math.floor((Wu + EPS) / o.dy); if (n < 1) return null;
    let g = Wu - n * o.dy;
    if (g < 0.1 * o.dy) { if (allowDrop === false) return null; n -= 1; g += o.dy; } // vừa khít → bỏ 1 cột để có khe thoáng (tự động thì chỉ khi cont còn trống)
    if (n < 1) return null;
    const d = Math.min(g, o.dy / 2); if (d < 1) return null;
    return {
      kind: 'sole', o, D: o.dx, cap: n * T, nc: n, T, shift: d, gap: g,
      build(count, style, ox, oy) {
        const out = []; let k = 0;
        for (let t = 0; t < T && k < count; t++) for (let c = 0; c < n && k < count; c++, k++) { const b = mk(ox, oy + (t % 2 === 0 ? d : 0) + c * o.dy, t * o.dz, o, t + 1); b.sole = true; out.push(b); }
        return out;
      },
    };
  }

  // ---------------------------------------------------------------- dựng danh sách kiểu xếp cho 1 nhóm
  function buildPatterns(sku, ors, sp, Wu, info) {
    const Tof = (o) => Math.min(Math.floor((sp.effH + EPS) / o.dz), sku.maxLayers > 0 ? sku.maxLayers : Infinity);
    let pats = [];
    if (sku.sole || sku._auto) { // sole do người dùng chọn, hoặc TỰ ĐỘNG khi trống 1 bên (xem solveBest)
      ors.forEach((o) => { const p = solePattern(o, Tof(o), Wu, sku.sole ? true : !!sku._drop); if (p) pats.push(p); });
      if (!pats.length && info && sku.sole) info.soleFail = ors.every((o) => Tof(o) < 2) ? 'mot-tang' : 'khong-khe';
    }
    if (!pats.length) {
      ors.forEach((o) => { const p = colPattern(o, Tof(o), Wu); if (p) pats.push(p); });
      const byDx = {}; ors.forEach((o) => { (byDx[Math.round(o.dx * 2)] = byDx[Math.round(o.dx * 2)] || []).push(o); });
      Object.keys(byDx).forEach((key) => {
        const g = byDx[key]; if (g.length < 2) return; const p = mixPattern(g, Tof, Wu);
        if (p) { const bestCol = Math.max(0, ...pats.filter((q) => q.kind === 'col' && Math.abs(q.D - p.D) < EPS).map((q) => q.cap)); if (p.cap > bestCol) pats.push(p); }
      });
    }
    return pats;
  }

  // ---- DÃY MẪU do người dùng chọn: "6 nằm 2 đứng" = trong MỖI LỚP của 1 dãy xếp cạnh nhau 6 thùng NẰM + 2 thùng ĐỨNG (mỗi cột chồng lên tới red line).
  // "nằm / đứng / dựng cao" = chiều cao thùng khi đặt nhỏ nhất / vừa / lớn nhất. Có thể ghi số tầng từng nhóm cột: "6 nằm x10 2 đứng x8". Hoặc 1 trong 6 hướng (LWH…).
  // Dãy mẫu LẶP LẠI cho mọi dãy của mặt hàng; rowSet {thứ_tự_dãy_từ_0: "mẫu riêng" | nằm | đứng | dựng cao | hướng} chỉnh riêng từng dãy.
  const stripVn = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  function parseColPlan(str) {
    const out = [], t = stripVn(str), re = /(\d+)\s*(dung\s*cao|dung|nam|cao|[lwh]{3})(?:\s*(?:x|\*)\s*(\d+))?/g; let m;
    while ((m = re.exec(t))) { let tok = m[2].replace(/\s+/g, ''); tok = tok === 'dungcao' ? 'cao' : tok; tok = (tok === 'dung' || tok === 'nam' || tok === 'cao') ? tok : tok.toUpperCase(); if (tok === 'dung' || tok === 'nam' || tok === 'cao' || PERMS.includes(tok)) out.push({ tok, n: Math.min(60, +m[1]), t: m[3] ? +m[3] : 0 }); }
    return out;
  }
  const tokName = { nam: 'nằm', dung: 'đứng', cao: 'dựng cao' };
  // token → hướng đặt (ưu tiên cạnh DÀI nằm dọc cont để dãy sâu bằng nhau, cạnh ngắn ngang cont cho nhiều cột)
  function tokOrient(tok, sku, sp, Wu) {
    const m = { L: sku.L, W: sku.W, H: sku.H }, v = [sku.L, sku.W, sku.H].slice().sort((a, b) => a - b); let best = null;
    PERMS.forEach((pm) => {
      const c = pm.split(''), o = { dx: m[c[0]], dy: m[c[1]], dz: m[c[2]], kind: c[2] === 'H' ? 'dung' : 'nam', rot: ['WLH', 'HLW', 'HWL'].includes(pm) ? 1 : 0, perm: pm };
      const ok = PERMS.includes(tok) ? tok === pm : Math.abs(o.dz - v[{ nam: 0, dung: 1, cao: 2 }[tok]]) < 1e-6;
      if (!ok || o.dx > sp.Lu + EPS || o.dy > Wu + EPS || o.dz > sp.effH + EPS) return;
      if (!best || o.dx > best.dx + EPS || (Math.abs(o.dx - best.dx) <= EPS && o.dy < best.dy - EPS)) best = o;
    });
    return best;
  }
  // 1 dãy gồm nhiều cột, mỗi cột 1 hướng + số tầng riêng (cột trái → phải)
  function colsPattern(cols, label) {
    if (!cols.length) return null; const cap = cols.reduce((a, c) => a + c.T, 0), TT = Math.max(...cols.map((c) => c.T));
    return {
      kind: 'cols', label, o: cols[0].o, D: Math.max(...cols.map((c) => c.o.dx)), cap, cols, T: TT,
      build(count, style, ox, oy) {
        const out = []; let k = 0, y = oy; const pos = cols.map((c) => { const q = y; y += c.o.dy; return q; });
        if (style === 'tall') { cols.forEach((c, i) => { for (let t = 0; t < c.T && k < count; t++, k++) out.push(mk(ox, pos[i], t * c.o.dz, c.o, t + 1)); }); }
        else { for (let t = 0; t < TT && k < count; t++) cols.forEach((c, i) => { if (t < c.T && k < count) { out.push(mk(ox, pos[i], t * c.o.dz, c.o, t + 1)); k++; } }); }
        return out;
      },
    };
  }
  // dựng dãy từ chuỗi mẫu; trả { pat, info:{cols:[{tok,n,t,o,T,ok}], width, over, cap, top} }
  function buildTpl(str, sku, sp, Tmax, Wu) {
    const specs = parseColPlan(str); if (!specs.length) return null; const cols = [], det = []; let width = 0, over = false, top = 0;
    specs.forEach((sp0) => {
      const o = tokOrient(sp0.tok, sku, sp, Wu); const T = o ? Math.min(Tmax(o), sp0.t > 0 ? sp0.t : Infinity) : 0; let used = 0;
      if (o && T >= 1) for (let i = 0; i < sp0.n; i++) { if (width + o.dy > Wu + EPS) { over = true; break; } cols.push({ o, T }); width += o.dy; used++; top = Math.max(top, T * o.dz); }
      det.push({ tok: sp0.tok, n: sp0.n, t: sp0.t, o, T, used, ok: !!o && T >= 1 });
    });
    const label = specs.map((q) => q.n + ' ' + (tokName[q.tok] || q.tok) + (q.t ? ' x' + q.t : '')).join(' + ');
    return { pat: colsPattern(cols, label), info: { cols: det, width, over, cap: cols.reduce((a, c) => a + c.T, 0), top, Wu } };
  }
  function makeWallPat(sku, sp, Tof, Wu) {
    const set = sku.rowSet || {}, setKeys = Object.keys(set).filter((k) => set[k] !== '' && set[k] != null), hasTpl = !!parseColPlan(sku.rowPlan).length;
    if (!hasTpl && !setKeys.length) return null;
    const cache = {}, bestFull = (tok) => { // cả dãy 1 hướng: hướng nào cho nhiều thùng / sâu nhất
      const perms = PERMS.includes(tok) ? [tok] : PERMS.filter((pm) => { const o = tokOrient(pm, sku, sp, Wu); return o && Math.abs(o.dz - [sku.L, sku.W, sku.H].slice().sort((a, b) => a - b)[{ nam: 0, dung: 1, cao: 2 }[tok]]) < 1e-6; });
      let best = null; perms.forEach((pm) => { const o = tokOrient(pm, sku, sp, Wu); if (!o) return; const T = Tof(o), p = (sku.sole && T >= 2 && solePattern(o, T, Wu, true)) || colPattern(o, T, Wu); if (p && (!best || p.cap / p.D > best.cap / best.D + 1e-9)) best = p; });
      return best;
    };
    const resolve = (v) => {
      v = String(v); if (cache[v] !== undefined) return cache[v]; let p = null;
      if (/\d/.test(v)) { const r = buildTpl(v, sku, sp, Tof, Wu); p = r && r.pat; } else { const t = stripVn(v).replace(/\s+/g, ''); const tok = t === 'dungcao' ? 'cao' : (t === 'dung' || t === 'nam' || t === 'cao') ? t : v.toUpperCase(); p = bestFull(tok); }
      return (cache[v] = p);
    };
    const fn = (wi) => { if (set[wi] != null && set[wi] !== '') return resolve(set[wi]); return hasTpl ? resolve(sku.rowPlan) : null; };
    fn.K = hasTpl ? 1e9 : Math.max(...setKeys.map((k) => (+k) + 1), 0); // có dãy mẫu → áp cho MỌI dãy; chỉ chỉnh riêng → N dãy đầu rồi tự động
    return fn;
  }
  // xem trước dãy mẫu (cho bảng sắp dãy trên giao diện)
  function previewTpl(skuRaw, contRaw, str) {
    const c = normContainer(contRaw), sp = makeSpace(c), sku = normSku(skuRaw, 0);
    const Tmax = (o) => Math.min(Math.floor((sp.effH + EPS) / o.dz), sku.maxLayers > 0 ? sku.maxLayers : Infinity);
    const r = buildTpl(str, sku, sp, Tmax, sp.Wu); if (!r) return { cols: [], width: 0, Wu: sp.Wu, cap: 0, top: 0, effH: sp.effH, red: sp.red, H: c.H, over: false };
    return { cols: r.pat ? r.pat.cols.map((q) => ({ dy: q.o.dy, dz: q.o.dz, dx: q.o.dx, T: q.T, name: vName(q.o.dz, sku) })) : [], detail: r.info.cols, width: r.info.width, Wu: sp.Wu, cap: r.info.cap, top: r.info.top, effH: sp.effH, red: sp.red, H: c.H, over: r.info.over, depth: r.pat ? r.pat.D : 0, W: c.W, clearSide: c.clearSide };
  }

  // xếp liên tiếp các vách của 1 kiểu; vách cuối có thể thiếu thùng. ctx (tuỳ chọn): { wallPat(wi) → kiểu riêng cho dãy thứ wi của mặt hàng, wi, mark }
  function placeWalls(p0, n, x0, Lend, style, oy, dry, ctx) {
    let p = p0;
    let cur = x0, left = n, placed = 0, tail = null; const boxes = [];
    while (left > 0) {
      if (ctx && ctx.maxWalls != null && ctx.wi >= ctx.maxWalls) break;
      p = p0; if (ctx && ctx.wallPat) { const q = ctx.wallPat(ctx.wi); if (q) p = q; }
      if (cur + p.D > Lend + EPS) break;
      const take = Math.min(left, p.cap), part = take < p.cap, st = part ? style : 'wide';
      const bx = (dry && !part) ? null : p.build(take, st, cur, oy);
      let used = p.D;
      if (part) { let mx = cur; for (const b of bx) mx = Math.max(mx, b.x + b.dx); used = mx - cur; }
      if (cur + used > Lend + EPS) break;
      placed += take; left -= take;
      if (!dry && bx) for (const b of bx) { if (ctx && ctx.mark) b.wall = ctx.wi; boxes.push(b); }
      if (ctx) { ctx.wi++; if (ctx.used && !ctx.used.includes(p)) ctx.used.push(p); }
      if (part) tail = { x0: cur, used, count: take, cap: p.cap, style: st, boxes: dry ? null : bx, kind: p.kind, pat: p };
      cur += used;
    }
    return { boxes, placed, end: cur, tail, left };
  }
  const prefOf = (p) => (p.o.kind === 'dung' ? 0 : 1) * 2 + (p.kind === 'mix' ? 1 : 0);
  // Tên hướng đặt theo CHIỀU CAO THÙNG khi đặt (cách gọi ngoài kho): cao nhỏ nhất = NẰM (dẹt), cao vừa = ĐỨNG, cao lớn nhất = DỰNG CAO
  const vRank = (dz, k) => { const v = [k.L, k.W, k.H].slice().sort((a, b) => a - b); return Math.abs(dz - v[0]) < 1e-6 ? 0 : (Math.abs(dz - v[1]) < 1e-6 ? 1 : 2); };
  const vName = (dz, k) => ['nằm', 'đứng', 'dựng cao'][vRank(dz, k)];
  const orientText = (o, k) => vName(o.dz, k) + ' (cao ' + r1(o.dz) + ')' + (o.rot ? ' · xoay 90°' : '');

  // ---------------------------------------------------------------- xếp 1 nhóm vào cont
  function runGroup(S, g, nWant, opts, isLast) {
    const sp = S.sp, sku = g.sku, out = { boxes: [], placed: 0, info: { soleFail: '' }, patterns: [] };
    const ors = orientationsOf(sku, sp);
    if (!ors.length) { out.reason = 'khong-vua'; return out; }
    let left = nWant; const style = (opts.mergeTail && !isLast) ? 'tall' : 'wide';
    const note = (p) => { const tx = describe(p) + (sku._auto && p.kind === 'sole' ? ' [tự động]' : ''); if (!out.patterns.some((q) => q.text === tx)) out.patterns.push({ text: tx, kind: p.kind, o: p.o }); };
    const describe = (p) => p.kind === 'cols' ? 'dãy mẫu: ' + p.label + ' · sâu ' + r1(p.D) + ' mm' : orientText(p.o, sku) + ' · ' + r1(p.o.dx) + '×' + r1(p.o.dy) + '×' + r1(p.o.dz) + (p.kind === 'sole' ? ' · sole (so le trái/phải từng tầng, khe ' + r1(p.gap) + ' mm)' : (p.kind === 'mix' ? ' · trộn hướng cùng chiều sâu' : ''));
    let lastTail = null;
    // 1) lấp phần trống cạnh vách cuối của nhóm trước (nếu bật "ghép")
    if (opts.mergeTail && S.strip && !(sku.sole || sku._auto) && left > 0) {
      const st = S.strip;
      const pats = buildPatterns(sku, ors, sp, st.w, null).filter((p) => p.kind !== 'cross');
      pats.sort((a, b) => (b.cap / b.D) - (a.cap / a.D) || prefOf(a) - prefOf(b));
      const ps = pats[0];
      if (ps) {
        const D = ps.D, fl = Math.floor((st.depth + EPS) / D), ce = Math.ceil((st.depth - EPS) / D) || 1;
        const vFl = fl >= 1 ? (st.depth - fl * D) * st.w : Infinity, vCe = (ce * D - st.depth) * st.aW;
        let rows = (fl >= 1 && vFl <= vCe) ? fl : ce;
        while (rows > 0 && st.x0 + rows * D > sp.x1 + EPS) rows--;
        if (rows >= 1) {
          const want = Math.min(left, rows * ps.cap), res = placeWalls(ps, want, st.x0, st.x0 + rows * D, 'wide', st.y0, false);
          if (res.placed > 0) { out.boxes.push(...res.boxes); left -= res.placed; S.cursor = Math.max(S.cursor, res.end); note(ps); out.stripUsed = res.placed; }
        }
      }
    }
    // 1b) chồng lên khoảng trống phía trên vách cuối của nhóm trước (nếu cho phép)
    if (opts.stackTop && !opts.mergeTail && S.top && !(sku.sole || sku._auto) && left > 0) {
      const t = S.top, sp2 = Object.assign({}, sp, { Lu: t.depth, Wu: t.w, effH: sp.effH - t.z });
      const o2 = orientationsOf(sku, sp2), pats2 = o2.length ? buildPatterns(sku, o2, sp2, t.w, null).filter((p) => p.kind !== 'sole') : [];
      let bst = null;
      pats2.forEach((p) => { const rows = Math.floor((t.depth + EPS) / p.D); if (rows < 1) return; const r = placeWalls(p, Math.min(left, rows * p.cap), t.x0, t.x0 + rows * p.D, 'wide', t.y0, true); if (r.placed > 0 && (!bst || r.placed > bst.placed || (r.placed === bst.placed && prefOf(p) < prefOf(bst.p)))) bst = { p, rows, placed: r.placed }; });
      if (bst) {
        const res = placeWalls(bst.p, Math.min(left, bst.rows * bst.p.cap), t.x0, t.x0 + bst.rows * bst.p.D, 'wide', t.y0, false);
        res.boxes.forEach((b) => { b.z += t.z; b.tier += t.tiers; b.onPrev = true; });
        out.boxes.push(...res.boxes); left -= res.placed; out.stackedOn = res.placed; note(bst.p);
      }
    }
    // 2) các vách chính
    let used = 0;
    if (left > 0) {
      const pats = buildPatterns(sku, ors, sp, sp.Wu, out.info);
      const TofW = (o) => Math.min(Math.floor((sp.effH + EPS) / o.dz), sku.maxLayers > 0 ? sku.maxLayers : Infinity);
      const wallPat = makeWallPat(sku, sp, TofW, sp.Wu), ctx = { wallPat, wi: 0, mark: true, used: [], maxWalls: null };
      if (!pats.length && wallPat) { const q = wallPat(0); if (q) pats.push(q); }
      if (!pats.length) { if (!out.boxes.length) out.reason = 'khong-vua'; }
      else {
        const airy = !!opts._airflow; // cont còn trống nhiều: ưu tiên DỰNG ĐỨNG + thoáng khí trước, tiết kiệm chiều dài sau
        const pick = (cx) => { // kiểu xếp tốt nhất cho phần còn lại (mô phỏng khô)
          let best = null;
          pats.forEach((p) => {
            const r = placeWalls(p, left, S.cursor, sp.x1, style, sp.y0, true, cx ? { wallPat: cx.wallPat, wi: 0, maxWalls: cx.maxWalls } : null), cand = { p, placed: r.placed, end: r.end };
            if (!best || cand.placed > best.placed || (cand.placed === best.placed && (airy ? (prefOf(p) < prefOf(best.p) || (prefOf(p) === prefOf(best.p) && cand.end < best.end - EPS)) : (cand.end < best.end - EPS || (Math.abs(cand.end - best.end) <= EPS && prefOf(p) < prefOf(best.p)))))) best = cand;
          });
          return best;
        };
        const run = (p, count) => { // xếp 1 bước, cập nhật trạng thái
          const res = placeWalls(p, Math.min(left, count), S.cursor, sp.x1, style, sp.y0, false, ctx);
          out.boxes.push(...res.boxes); left -= res.placed; S.cursor = res.end; lastTail = res.tail; used += res.placed; return res;
        };
        // A) các dãy đầu do NGƯỜI DÙNG chọn hướng (kế hoạch "4 đứng 3 nằm…" / chỉnh riêng từng dãy); dãy chưa chỉ định trong đoạn này dùng kiểu tốt nhất
        if (wallPat && wallPat.K > 0) {
          ctx.maxWalls = wallPat.K; const bA = pick({ wallPat, maxWalls: wallPat.K });
          if (bA && bA.placed > 0) run(bA.p, left);
          ctx.maxWalls = null; ctx.wallPat = null; // từ đây TỰ ĐỘNG
        }
        // B) phần còn lại TỰ ĐỘNG. HÀNG NHIỀU (không đủ chỗ cho hết): thử TRỘN dãy kiểu A rồi dãy kiểu B (VD x dãy đứng + y dãy nằm) bằng quy hoạch chiều dài → thường đóng thêm được thùng
        if (left > 0) {
          const best = pick(null); let steps = best && best.placed > 0 ? [{ p: best.p, count: left }] : [];
          const seq = (!opts._sample && !wallPat && sku._tierSeq && sku._tierSeq.length) ? sku._tierSeq : null;
          if (seq && best && best.placed > 0) { // TRẢI ĐỀU: dãy thứ i chỉ chồng seq[i] tầng (số tầng các dãy chênh nhau ≤ 1, xếp bậc thang)
            const bp = best.p, cache = {}, Wu0 = sp.Wu;
            const limitT = (cap) => {
              cap = Math.max(1, cap); if (cap >= bp.T) return bp; if (cache[cap]) return cache[cap]; let q;
              if (bp.kind === 'col') q = colPattern(bp.o, cap, Wu0); else if (bp.kind === 'sole') q = solePattern(bp.o, cap, Wu0, true) || colPattern(bp.o, cap, Wu0); else if (bp.cols) q = colsPattern(bp.cols.map((c) => ({ o: c.o, T: Math.min(c.T, cap) })), bp.label); else q = bp;
              return (cache[cap] = q || bp);
            };
            ctx.wallPat = (wi) => limitT(seq[Math.min(wi, seq.length - 1)]);
          }
          if (best && !seq && best.placed < left && pats.length > 1) {
            const R0 = sp.x1 - S.cursor, cand = pats.filter((q) => q.kind === 'col' || q.kind === 'sole'); let bm = null;
            for (let i = 0; i < cand.length; i++) for (let j = 0; j < cand.length; j++) {
              if (i === j) continue; const A = cand[i], B = cand[j];
              for (let a = 1; a * A.D <= R0 + EPS; a++) { const b = Math.floor((R0 - a * A.D + EPS) / B.D), tot = a * A.cap + b * B.cap; if (b >= 1 && tot > best.placed && (!bm || tot > bm.total)) bm = { pi: A, pj: B, a, b, total: tot }; }
            }
            if (bm) steps = [{ p: bm.pi, count: bm.a * bm.pi.cap }, { p: bm.pj, count: left }];
          }
          steps.forEach((st0) => { if (left > 0) run(st0.p, st0.count); });
        }
        // C) phần còn dư ở cuối cont: thử kiểu khác có chiều sâu nhỏ hơn
        let guard = 0;
        while (left > 0 && guard++ < 4) {
          const R = sp.x1 - S.cursor; let b2 = null;
          pats.forEach((p) => { if (p.D > R + EPS) return; const r = placeWalls(p, left, S.cursor, sp.x1, 'wide', sp.y0, true, null); if (r.placed > 0 && (!b2 || r.placed > b2.placed || (r.placed === b2.placed && r.end < b2.end))) b2 = { p, placed: r.placed, end: r.end }; });
          if (!b2) break;
          const r2 = placeWalls(b2.p, left, S.cursor, sp.x1, 'wide', sp.y0, false, ctx);
          if (!r2.placed) break;
          out.boxes.push(...r2.boxes); left -= r2.placed; S.cursor = r2.end; lastTail = r2.tail; note(b2.p); used += r2.placed;
        }
        ctx.used.forEach(note);
      }
    }
    out.placed = nWant - left;
    // 3) ghi lại phần trống bên cạnh vách cuối để nhóm sau lấp (chỉ khi ghép + vách cuối đang xếp "cột đầy")
    S.strip = null;
    if (opts.mergeTail && !isLast && left === 0 && lastTail && lastTail.style === 'tall' && lastTail.boxes && lastTail.kind === 'col' && Math.abs(S.cursor - (lastTail.x0 + lastTail.used)) < EPS) {
      let yEnd = sp.y0; lastTail.boxes.forEach((b) => { yEnd = Math.max(yEnd, b.y + b.dy); });
      const w = sp.y1 - yEnd; if (w > 1) S.strip = { x0: lastTail.x0, depth: lastTail.used, y0: yEnd, w, aW: yEnd - sp.y0 };
    }
    // 4) ghi lại mặt phẳng trống phía trên vách cuối (chỉ khi vách cuối xếp "từng tầng" và ở chế độ tách riêng)
    S.top = null;
    if (opts.stackTop && !opts.mergeTail && !isLast && left === 0 && lastTail && lastTail.kind === 'col' && lastTail.boxes && Math.abs(S.cursor - (lastTail.x0 + lastTail.used)) < EPS) {
      const pt = lastTail.pat, tops = []; for (let c = 0; c < pt.nc; c++) tops.push(0);
      lastTail.boxes.forEach((b) => { const c = Math.round((b.y - sp.y0) / pt.o.dy); if (c >= 0 && c < pt.nc) tops[c] = Math.max(tops[c], b.z + b.dz); });
      const mn = Math.min(...tops); let bestRun = null, i0 = 0;
      while (i0 < tops.length) { if (Math.abs(tops[i0] - mn) > EPS) { i0++; continue; } let i1 = i0; while (i1 + 1 < tops.length && Math.abs(tops[i1 + 1] - mn) <= EPS) i1++; if (!bestRun || i1 - i0 > bestRun.i1 - bestRun.i0) bestRun = { i0, i1 }; i0 = i1 + 1; }
      if (bestRun && sp.effH - mn > 1) S.top = { x0: lastTail.x0, depth: lastTail.used, y0: sp.y0 + bestRun.i0 * pt.o.dy, w: (bestRun.i1 - bestRun.i0 + 1) * pt.o.dy, z: mn, tiers: Math.round(mn / pt.o.dz) };
    }
    out.soleFail = out.info.soleFail || '';
    return out;
  }

  // ---------------------------------------------------------------- KIỂM TRA ĐỘC LẬP phương án (chống "đúng trên hình nhưng không làm được")
  function verify(boxes, sp, opts) {
    const minSup = (opts && opts.minSupport) || 0.7, v = [], push = (type, i, msg) => { if (v.length < 200) v.push({ type, box: i, msg }); };
    boxes.forEach((b, i) => {
      if (b.x < sp.x0 - 1e-3 || b.x + b.dx > sp.x1 + 1e-3 || b.y < sp.y0 - 1e-3 || b.y + b.dy > sp.y1 + 1e-3) push('ngoai-cont', i, 'Thùng #' + b.seq + ' nằm ngoài vùng chứa hàng của cont.');
      if (b.z < -1e-3 || b.z + b.dz > sp.effH + 1e-3) push('vuot-redline', i, 'Thùng #' + b.seq + ' vượt chiều cao cho phép (red line).');
    });
    // chồng nhau
    const ix = boxes.map((_, i) => i).sort((p, q) => boxes[p].x - boxes[q].x);
    for (let a = 0; a < ix.length; a++) {
      const A = boxes[ix[a]];
      for (let b = a + 1; b < ix.length; b++) {
        const B = boxes[ix[b]]; if (B.x >= A.x + A.dx - 1e-3) break;
        if (B.y < A.y + A.dy - 1e-3 && A.y < B.y + B.dy - 1e-3 && B.z < A.z + A.dz - 1e-3 && A.z < B.z + B.dz - 1e-3) push('chong-nhau', ix[a], 'Thùng #' + A.seq + ' chồng lên thùng #' + B.seq + '.');
      }
    }
    // được đỡ bên dưới + thùng đỡ phải đóng trước
    const byTop = new Map();
    boxes.forEach((b, i) => { const k = Math.round((b.z + b.dz) * 100); if (!byTop.has(k)) byTop.set(k, []); byTop.get(k).push(i); });
    boxes.forEach((b, i) => {
      if (b.z < 1e-3) return;
      const cand = byTop.get(Math.round(b.z * 100)) || []; let area = 0, cx = 0, cy = 0, cover = false; const sup = [];
      cand.forEach((j) => {
        const c = boxes[j]; if (j === i) return;
        const ox = Math.min(b.x + b.dx, c.x + c.dx) - Math.max(b.x, c.x), oy = Math.min(b.y + b.dy, c.y + c.dy) - Math.max(b.y, c.y);
        if (ox > 1e-3 && oy > 1e-3) { area += ox * oy; sup.push(j); }
      });
      const ratio = area / (b.dx * b.dy); cx = b.x + b.dx / 2; cy = b.y + b.dy / 2;
      cover = sup.some((j) => { const c = boxes[j]; return cx >= c.x - 1e-3 && cx <= c.x + c.dx + 1e-3 && cy >= c.y - 1e-3 && cy <= c.y + c.dy + 1e-3; });
      if (ratio < (b.sole ? 0.5 : minSup) - 1e-6 || !cover) push('thieu-do', i, 'Thùng #' + b.seq + ' chỉ được đỡ ' + Math.round(ratio * 100) + '% bên dưới.');
      if (sup.some((j) => boxes[j].seq > b.seq)) push('thu-tu-do', i, 'Thùng #' + b.seq + ' được đóng trước thùng đỡ nó.');
    });
    // thùng đóng trước chắn đường trượt từ cửa vào
    const ord = boxes.map((_, i) => i).sort((p, q) => boxes[p].seq - boxes[q].seq);
    for (let a = 0; a < ord.length; a++) {
      const J = boxes[ord[a]];
      for (let b = 0; b < a; b++) {
        const I = boxes[ord[b]];
        if (I.x >= J.x + J.dx - 1e-3 && I.y < J.y + J.dy - 1e-3 && J.y < I.y + I.dy - 1e-3 && I.z < J.z + J.dz - 1e-3 && J.z < I.z + I.dz - 1e-3) { push('chan-duong', ord[a], 'Thùng #' + J.seq + ' không đưa vào được: thùng #' + I.seq + ' (đóng trước) chắn phía cửa.'); break; }
      }
    }
    return { ok: v.length === 0, violations: v };
  }

  // ---------------------------------------------------------------- GIẢI
  function solveOnce(input, opts) {
    const c = normContainer(input.container), sp = makeSpace(c);
    const warnings = [], errors = [];
    if (!(c.L > 0 && c.W > 0 && c.H > 0)) errors.push('Container chưa có kích thước bên trong (dài / rộng / cao).');
    if (sp.Lu <= 0 || sp.Wu <= 0 || sp.effH <= 0) errors.push('Khe hở đầu / cửa / hai bên lớn hơn kích thước cont — không còn chỗ chứa hàng.');
    const skus = (input.skus || []).map(normSku).filter((k) => k.qty > 0 || k.code || k.size);
    if (opts._auto) skus.forEach((k) => { if (!k.sole) { k._auto = true; k._drop = !!opts._drop; } });
    if (opts._tierSeqs) skus.forEach((k) => { if (opts._tierSeqs[k.id]) k._tierSeq = opts._tierSeqs[k.id]; }); // TRẢI ĐỀU: số tầng từng dãy (có thể khác nhau)
    if (opts._tierCap) skus.forEach((k) => { k.maxLayers = k.maxLayers > 0 ? Math.min(k.maxLayers, opts._tierCap) : opts._tierCap; }); // chế độ TRẢI ĐỀU: giới hạn số tầng mọi mặt hàng
    const groups = skus.map((k) => ({ sku: k }));
    // thứ tự đóng: mặt hàng > size > ngày (hoặc đúng thứ tự nhập)
    if (opts.sortMode !== 'manual') {
      const dir = opts.dateDir === 'desc' ? -1 : 1;
      groups.sort((a, b) => {
        const x = a.sku, y = b.sku; let d = natCmp(x.code, y.code); if (d) return d;
        d = natCmp(x.size, y.size); if (d) return d;
        const dx = dateVal(x.date), dy = dateVal(y.date), nx = Number.isNaN(dx), ny = Number.isNaN(dy);
        if (nx !== ny) return nx ? 1 : -1; if (!nx && dx !== dy) return (dx - dy) * dir;
        d = natCmp(x.date, y.date); if (d) return d * dir;
        return x._idx - y._idx;
      });
    }
    let weightLeft = c.maxPayload > 0 ? c.maxPayload : Infinity, loadedKg = 0;
    const sampleQ = Math.max(0, Math.floor(num(opts.sampleQty)));
    const SOLE_WHY = { 'mot-tang': 'chỉ xếp được 1 tầng', 'khong-khe': 'bề ngang không còn khe để so le' };
    groups.forEach((g, gi) => {
      const k = g.sku; g.index = gi; g.requested = k.qty; g.loaded = 0; g.left = k.qty; g.sample = 0; g.reasons = []; g.patterns = []; g.xStart = null; g.xEnd = null; g.kg = 0; g.ok = false;
      if (errors.length || k.qty <= 0) return;
      if (!(k.L > 0 && k.W > 0 && k.H > 0)) { g.reasons.push('Thiếu kích thước thùng.'); return; }
      if (!passDoor(k, c)) { g.reasons.push('Thùng quá lớn, không đưa lọt cửa cont (' + r1(c.doorW) + '×' + r1(c.doorH) + ' mm).'); return; }
      g.ok = true;
    });
    const boxes = [], mainBoxes = [], sampBoxes = [], wLimit = (k, n) => { if (k.kg > 0 && Number.isFinite(weightLeft)) return Math.min(n, Math.floor((weightLeft + 1e-6) / k.kg)); return n; };
    const addWhy = (g, t) => { if (!g.reasons.includes(t)) g.reasons.push(t); };
    // A) HÀNG MẪU HẢI QUAN: mỗi dòng (mã · size · ngày) giữ lại ~sampleQty thùng, gom thành 1–2 dãy ngay sát cửa (các nhóm đứng cạnh nhau trong cùng dãy)
    let Ds = 0;
    if (sampleQ > 0) {
      const S2 = { sp, cursor: sp.x0, strip: null, top: null };
      groups.forEach((g) => {
        if (!g.ok) return; const k = g.sku, want = wLimit(k, Math.min(sampleQ, k.qty)); if (want <= 0) return;
        const r = runGroup(S2, g, want, Object.assign({}, opts, { mergeTail: true, stackTop: false, _sample: true }), false);
        r.boxes.forEach((b) => { b.group = g.index; b.skuId = k.id; b.sample = true; }); sampBoxes.push(...r.boxes); g.sample = r.placed;
        if (Number.isFinite(weightLeft)) weightLeft -= r.placed * k.kg; if (r.placed < Math.min(sampleQ, k.qty)) addWhy(g, 'Không đủ chỗ / tải trọng cho ' + sampleQ + ' thùng mẫu hải quan.');
        if (r.soleFail) g.soleFail = r.soleFail;
      });
      if (sampBoxes.length) { Ds = S2.cursor - sp.x0; const delta = sp.x1 - S2.cursor; sampBoxes.forEach((b) => { b.x += delta; }); }
    }
    // B) HÀNG CHÍNH: từ vách đầu ra tới trước dãy mẫu
    const spM = Object.assign({}, sp, { x1: sp.x1 - Ds, Lu: sp.Lu - Ds }), S = { sp: spM, cursor: sp.x0, strip: null, top: null };
    const lastIdx = (() => { let li = -1; groups.forEach((g, i) => { if (g.ok && g.requested - g.sample > 0) li = i; }); return li; })();
    groups.forEach((g, gi) => {
      if (!g.ok) return; const k = g.sku; const n0 = k.qty - g.sample; if (n0 <= 0) return;
      let n = wLimit(k, n0); if (n < n0) addWhy(g, 'Hết tải trọng cho phép (' + Math.round(c.maxPayload) + ' kg).'); if (n <= 0) return;
      const r = runGroup(S, g, n, opts, gi === lastIdx);
      if (r.reason === 'khong-vua') { addWhy(g, k.orient ? 'Hướng đặt bạn chọn không vừa cont (so với bề ngang / red line). Đổi hướng hoặc chọn “Tự động”.' : 'Không có hướng đặt nào vừa trong cont (kích thước thùng so với bề ngang / red line). Thử bật xoay / đặt nằm.'); return; }
      r.boxes.forEach((b) => { b.group = gi; b.skuId = k.id; }); mainBoxes.push(...r.boxes);
      g.loaded = r.placed; g.patterns = r.patterns; g.soleFail = r.soleFail || g.soleFail; g.stripUsed = r.stripUsed || 0; g.stackedOn = r.stackedOn || 0;
      if (r.placed < n) addWhy(g, 'Hết chỗ trong cont (đã tới dãy mẫu / cửa / red line).');
      if (Number.isFinite(weightLeft)) weightLeft -= r.placed * k.kg;
    });
    groups.forEach((g) => {
      const mine = sampBoxes.filter((b) => b.group === g.index);
      g.loaded += g.sample; g.left = g.requested - g.loaded; g.kg = g.loaded * g.sku.kg; loadedKg += g.kg;
      g.volUnit = g.sku.L * g.sku.W * g.sku.H; g.volReq = g.volUnit * g.requested; g.volLoaded = g.volUnit * g.loaded; // mm³ (÷ 1e9 = m³)
      const all = mainBoxes.filter((b) => b.group === g.index).concat(mine);
      if (all.length) { g.xStart = Math.min(...all.map((b) => b.x)); g.xEnd = Math.max(...all.map((b) => b.x + b.dx)); }
      if (mine.length && !g.patterns.length) g.patterns = [{ text: 'chỉ có thùng mẫu hải quan', kind: 'col' }];
      if (g.soleFail) addWhy(g, 'Không xếp SOLE được: ' + (SOLE_WHY[g.soleFail] || '') + ' → xếp thẳng hàng.');
    });
    boxes.push(...mainBoxes, ...sampBoxes);
    boxes.forEach((b, i) => { b.seq = i + 1; });
    // đánh số DÃY: dãy = lát cắt liên tiếp theo chiều dài cont (từ vách đầu ra cửa); các thùng chồng lấn về chiều dọc thuộc cùng 1 dãy
    const rows = (() => {
      const ix = boxes.map((_, i) => i).sort((a, b) => boxes[a].x - boxes[b].x), info = []; let end = -1e18;
      ix.forEach((i) => { const b = boxes[i]; if (b.x >= end - 1e-3) { info.push({ row: info.length + 1, x0: b.x, x1: b.x + b.dx, n: 0, sample: false, gs: {}, ws: {}, y0: 1e18, y1: -1e18, top: 0 }); end = b.x + b.dx; } else end = Math.max(end, b.x + b.dx); const r = info[info.length - 1]; r.x1 = Math.max(r.x1, b.x + b.dx); r.n++; if (b.sample) r.sample = true; r.gs[b.group] = 1; r.ws[b.wall == null ? -1 : b.wall] = 1; r.y0 = Math.min(r.y0, b.y); r.y1 = Math.max(r.y1, b.y + b.dy); r.top = Math.max(r.top, b.z + b.dz); b.row = r.row; });
      info.forEach((r) => { const g = Object.keys(r.gs), w = Object.keys(r.ws); r.group = g.length === 1 ? +g[0] : -1; r.wall = (g.length === 1 && w.length === 1 && +w[0] >= 0 && !r.sample) ? +w[0] : -1; delete r.gs; delete r.ws; r.gaps = { right: r.y0, left: c.W - r.y1, top: r.top, ceiling: c.H - r.top, red: sp.red - r.top, eff: sp.effH - r.top }; }); // wall ≥ 0 → dãy này chỉnh được hướng (thuộc 1 mặt hàng, vách chính)
      return info;
    })();
    // tầng hiển thị ("lớp")
    const maxTier = boxes.reduce((m, b) => Math.max(m, b.tier), 0);
    const ver = verify(boxes, sp, opts);
    // tổng hợp
    const volBox = boxes.reduce((s, b) => s + b.dx * b.dy * b.dz, 0), volUse = sp.Lu * sp.Wu * sp.effH, volIn = c.L * c.W * c.H;
    let cx = 0, cy = 0, kgSum = 0;
    boxes.forEach((b) => { const k = skus.find((s) => s.id === b.skuId), w = k ? k.kg : 0; cx += w * (b.x + b.dx / 2); cy += w * (b.y + b.dy / 2); kgSum += w; });
    const cog = kgSum > 0 ? { x: cx / kgSum, y: cy / kgSum, xPct: cx / kgSum / c.L * 100, yPct: cy / kgSum / c.W * 100 } : null;
    // KHOẢNG TRỐNG CÒN LẠI (mm): thùng gần nhất → vách đầu / cửa / vách phải / vách trái, thùng CAO NHẤT → trần / red line / giới hạn xếp
    const gaps = boxes.length ? (() => { let mnx = 1e18, mxx = -1e18, mny = 1e18, mxy = -1e18, top = 0; boxes.forEach((b) => { mnx = Math.min(mnx, b.x); mxx = Math.max(mxx, b.x + b.dx); mny = Math.min(mny, b.y); mxy = Math.max(mxy, b.y + b.dy); top = Math.max(top, b.z + b.dz); }); return { front: mnx, door: c.L - mxx, right: mny, left: c.W - mxy, top, ceiling: c.H - top, red: sp.red - top, eff: sp.effH - top }; })() : null;
    const mainEnd = mainBoxes.length ? Math.max(...mainBoxes.map((b) => b.x + b.dx)) - sp.x0 : 0, usedLen = mainEnd + Ds, gapSample = (sampBoxes.length && mainBoxes.length) ? Math.max(0, (spM.x1 - sp.x0) - mainEnd) : 0;
    const reqTotal = groups.reduce((s, g) => s + g.requested, 0), loadTotal = groups.reduce((s, g) => s + g.loaded, 0);
    if (!ver.ok) errors.push('Kiểm tra độc lập phát hiện ' + ver.violations.length + ' lỗi trong phương án (xem chi tiết).');
    if (cog && (Math.abs(cog.xPct - 50) > 12)) warnings.push('Trọng tâm hàng lệch dọc cont: ' + cog.xPct.toFixed(0) + '% chiều dài tính từ vách đầu (nên 40–60%).');
    if (cog && (Math.abs(cog.yPct - 50) > 6)) warnings.push('Trọng tâm hàng lệch ngang cont: ' + cog.yPct.toFixed(0) + '% bề ngang (nên gần 50%).');
    if (c.maxPayload > 0 && loadedKg > c.maxPayload + 1e-6) errors.push('Vượt tải trọng cho phép.');
    if (!(c.redLine > 0)) warnings.push('Chưa nhập red line — đang lấy chiều cao trong của cont làm giới hạn.');
    if (c.redLine > 0 && c.doorH > 0 && c.doorH < c.redLine) warnings.push('Cao cửa (' + r1(c.doorH) + ' mm) thấp hơn red line (' + r1(c.redLine) + ' mm) → giới hạn chiều cao xếp lấy theo cao cửa.');
    groups.forEach((g) => { if (g.sku.note) g.note = g.sku.note; });
    return {
      ok: errors.length === 0, errors, warnings, container: c, space: sp, groups, boxes, skus, rows,
      verify: ver, maxTier,
      totals: { volReqAll: groups.reduce((a, g) => a + (g.volReq || 0), 0), volFreeInternal: volIn - volBox, volFreeUsable: volUse - volBox, gaps, rows: rows.length, gapSample, sample: sampBoxes.length, sampleDepth: Ds, requested: reqTotal, loaded: loadTotal, left: reqTotal - loadTotal, kg: loadedKg, payload: c.maxPayload, volBox, volUsable: volUse, volInternal: volIn, fillUsablePct: volUse > 0 ? volBox / volUse * 100 : 0, fillInternalPct: volIn > 0 ? volBox / volIn * 100 : 0, usedLength: usedLen, freeLength: sp.Lu - usedLen, effH: sp.effH, cog },
      options: { sampleQty: sampleQ, stackTop: !!opts.stackTop, mergeTail: !!opts.mergeTail, dateDir: opts.dateDir || 'asc', sortMode: opts.sortMode || 'auto', minSupport: opts.minSupport || 0.7 },
    };
  }
  // TỰ SẮP XẾP HỢP LÝ KHI TRỐNG MỘT BÊN: bề ngang cont thường dư 1 khe < 1 thùng (VD 275 mm) dồn hết về 1 vách → cả khối sát 1 bên.
  //  • khe không mất chỗ (≥ 10% thùng) → mọi mặt hàng không-sole tự đóng SO LE trái/phải từng tầng (cùng số thùng, có đường khí 2 bên + chống nghiêng);
  //  • cont còn trống nhiều (xếp đủ + còn ≥ 15% chiều dài) → cho phép bỏ 1 cột để có khe, ưu tiên DỰNG ĐỨNG;
  //  • hàng nhiều (sát sức chứa) → chỉ dùng cách so le nếu KHÔNG mất thùng và không dài hơn. Chỉ nhận phương án mới khi kiểm tra độc lập vẫn đạt.
  function solveBest(input, opts) {
    const p1 = solveOnce(input, opts);
    if (opts.autoLayout === false || !(p1.totals.requested > 0) || !p1.groups.some((g) => !g.sku.sole && g.loaded > 0)) return p1;
    const spare = p1.totals.left === 0 && p1.totals.freeLength >= 0.15 * p1.space.Lu;
    let p2; try { p2 = solveOnce(input, Object.assign({}, opts, { _auto: true, _airflow: spare, _drop: spare })); } catch (e) { return p1; }
    const applied = p2.groups.some((g) => g.sku._auto && g.patterns.some((q) => q.kind === 'sole'));
    if (!applied || !p2.verify.ok || p2.errors.length || p2.totals.loaded < p1.totals.loaded || (!spare && p2.totals.usedLength > p1.totals.usedLength + 1)) return p1;
    p2.layoutNote = spare ? 'Cont còn trống nhiều → tự đóng so le (sole) trái/phải từng tầng + ưu tiên dựng đứng để khí lạnh lưu thông hai bên.' : 'Khe dư bề ngang không xếp thêm được thùng → tự đóng so le trái/phải từng tầng (không mất chỗ) để có đường khí hai bên và chống nghiêng.';
    return p2;
  }
  // GỢI Ý ĐÓNG THÊM khi còn hàng rớt: thử (1) bỏ chốt hướng + cho đặt nằm, (2) giảm khe vách đầu / cửa về 0, (3) cả hai → báo số thùng đóng thêm được. Chỉ GỢI Ý — người dùng bấm "Áp dụng" mới đổi.
  function buildHints(input, opts, plan) {
    const out = [];
    // hàng ÍT (mới dùng < 50% chiều dài): gợi ý TRẢI ĐỀU thành nhiều dãy thấp thay vì ít dãy cao + trống phía sau
    if (!opts.spread && plan.totals.left === 0 && plan.totals.requested > 0 && plan.totals.usedLength < 0.5 * plan.space.Lu) {
      const sp = solveSpread(input, Object.assign({}, opts, { spread: true, compare: false }), plan);
      if (sp !== plan && sp.spreadNote) out.push({ id: 'spread', gain: 0, loaded: sp.totals.loaded, left: 0, text: 'Hàng ít (mới dùng ' + Math.round(plan.totals.usedLength / plan.space.Lu * 100) + '% chiều dài): trải đều thành ' + sp.totals.rows + ' dãy thấp thay vì ' + plan.totals.rows + ' dãy cao', note: sp.spreadNote, patch: { opts: { spread: true } } });
    }
    if (!(plan.totals.left > 0)) return out; const base = plan.totals.loaded, c = plan.container;
    const idsOK = (input.skus || []).every((k) => k && k.id != null && k.id !== ''); if (!idsOK) return out;
    const cl = () => JSON.parse(JSON.stringify(input)), tryRun = (inp) => { try { return solveOnce(inp, Object.assign({}, opts, { compare: false, _auto: false, _airflow: false, _drop: false })); } catch (e) { return null; } };
    const need = plan.groups.filter((g) => g.left > 0 && g.ok && (!g.sku.allowLay || g.sku.orient || g.sku.rowPlan || Object.keys(g.sku.rowSet || {}).length)).map((g) => g.sku.id);
    const skuPatch = { allowLay: true, allowRotate: true, allowStand: true, orient: '', rowPlan: '', rowSet: {} }, contPatch = {};
    const hasGap = c.clearFront > 0 || c.clearRear > 0; if (hasGap) { contPatch.clearFront = 0; contPatch.clearRear = 0; }
    const nm = (ids) => plan.groups.filter((g) => ids.includes(g.sku.id)).map((g) => (g.sku.code || 'mặt hàng') + (g.sku.size ? ' ' + g.sku.size : '')).join(', ');
    const variants = [];
    if (need.length) variants.push({ id: 'lay', skus: need, cont: {}, text: 'Bỏ chốt hướng + cho phép đặt nằm / xoay cho ' + nm(need) });
    if (hasGap) variants.push({ id: 'gap', skus: [], cont: contPatch, text: 'Giảm khe vách đầu / khe cửa từ ' + Math.round(c.clearFront) + ' / ' + Math.round(c.clearRear) + ' mm về 0 (đóng sát)' });
    if (need.length && hasGap) variants.push({ id: 'both', skus: need, cont: contPatch, text: 'Cả hai: bỏ chốt hướng + cho đặt nằm cho ' + nm(need) + ' và đóng sát đầu / cửa' });
    variants.forEach((v) => {
      const inp = cl(); inp.skus.forEach((k) => { if (v.skus.includes(k.id)) Object.assign(k, skuPatch); }); Object.assign(inp.container, v.cont);
      const r = tryRun(inp); if (!r || !r.verify.ok) return; const gain = r.totals.loaded - base;
      if (gain > 0) out.push({ id: v.id, gain, loaded: r.totals.loaded, left: r.totals.left, text: v.text, patch: { skus: Object.fromEntries(v.skus.map((id) => [id, skuPatch])), container: v.cont } });
    });
    return out.sort((a, b) => b.gain - a.gain).slice(0, 3);
  }
  // TRẢI ĐỀU (hàng ít): thay vì đóng đặc 10 dãy cao rồi để trống phía sau, hạ số tầng (thấp hơn, chắc hàng, không đổ) để hàng trải ra tới ~spreadPct % chiều dài cont.
  // Chọn số tầng NHỎ NHẤT mà vẫn đủ hàng và không dài quá mức cho phép.
  function solveSpread(input, opts, p1) {
    const Lu = p1.space.Lu, Ds = p1.totals.sampleDepth || 0, pct = Math.min(100, Math.max(20, num(opts.spreadPct, 70))), main = Lu - Ds, target = main * pct / 100;
    if (!(p1.totals.requested > 0) || p1.totals.left > 0 || p1.maxTier < 2) return p1;
    if (p1.totals.usedLength - Ds >= target - 1) return p1;
    const note = (p, extra) => {
      const rt = {}; p.boxes.forEach((b) => { if (!b.sample) rt[b.row] = Math.max(rt[b.row] || 0, b.tier); }); const ts = Object.keys(rt).map((k) => rt[k]), mn = Math.min(...ts), mx = Math.max(...ts), rws = ts.length;
      return 'Hàng ít nên trải đều: ' + rws + ' dãy (dùng ' + Math.round((p.totals.usedLength - Ds) / main * 100) + '% chiều dài chứa hàng), mỗi dãy ' + (mn === mx ? mx : mn + '–' + mx) + ' tầng (≈ ' + Math.round(p.totals.loaded / Math.max(1, rws)) + ' thùng/dãy) — thay vì ' + p1.totals.rows + ' dãy cao ' + p1.maxTier + ' tầng.' + (extra || '');
    };
    // CÁCH 1 (ưu tiên): trải ra ĐỦ số dãy vừa chiều dài; số tầng từng dãy chênh nhau tối đa 1 (VD 5 tầng, 4 tầng xen nhau; dãy cao đứng trước)
    try {
      const info = {};
      p1.boxes.forEach((b) => { if (b.sample || b.wall == null || b.wall < 0) return; const g = (info[b.group] = info[b.group] || { n: 0, walls: {}, t1: {} }); g.n++; const w = (g.walls[b.wall] = g.walls[b.wall] || { x0: 1e18, x1: -1e18 }); w.x0 = Math.min(w.x0, b.x); w.x1 = Math.max(w.x1, b.x + b.dx); if (b.tier === 1) g.t1[b.wall] = (g.t1[b.wall] || 0) + 1; });
      const gi = Object.keys(info); let totalLen = 0;
      gi.forEach((k) => { const g = info[k], ws = Object.keys(g.walls); g.wc = ws.length; g.D = Math.max(...ws.map((w) => g.walls[w].x1 - g.walls[w].x0)); g.capT = Math.max(1, ...Object.keys(g.t1).map((w) => g.t1[w])); g.Tsum = Math.ceil(g.n / g.capT); totalLen += g.wc * g.D; });
      if (gi.length && totalLen > 0) {
        const sc = target / totalLen, seqs = {};
        gi.forEach((k) => {
          const g = info[k], n = Math.min(g.Tsum, Math.max(g.wc, Math.floor(g.wc * sc + 1e-9))), base = Math.floor(g.Tsum / n), extra = g.Tsum - base * n;
          seqs[p1.groups[+k].sku.id] = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)); // BẬC THANG: các dãy nhiều tầng liền nhau ở phía vách đầu, hết rồi mới tới các dãy ít tầng hơn (KHÔNG xen kẽ)
        });
        const p2 = solveBest(input, Object.assign({}, opts, { _tierSeqs: seqs, spread: false, compare: false }));
        if (p2.totals.left === 0 && p2.verify.ok && !p2.errors.length && p2.totals.usedLength - (p2.totals.sampleDepth || 0) <= target + 1 && p2.totals.rows > p1.totals.rows) { p2.spreadNote = note(p2); return p2; }
      }
    } catch (e) { /* thử cách 2 */ }
    // CÁCH 2 (dự phòng): hạ ĐỀU số tầng của mọi dãy tới mức nhỏ nhất vẫn vừa mục tiêu
    for (let t = 1; t < p1.maxTier; t++) {
      let p; try { p = solveBest(input, Object.assign({}, opts, { _tierCap: t, spread: false, compare: false })); } catch (e) { continue; }
      if (p.totals.left === 0 && p.verify.ok && !p.errors.length && p.totals.usedLength - (p.totals.sampleDepth || 0) <= target + 1) { p.spreadNote = note(p); p.spreadTier = t; return p; }
    }
    return p1;
  }
  function solve(input, options) {
    const opts = Object.assign({ mergeTail: false, stackTop: true, sampleQty: 10, autoLayout: true, spread: false, spreadPct: 70, dateDir: 'asc', sortMode: 'auto', minSupport: 0.7, compare: true }, options || {});
    let plan = solveBest(input, opts);
    if (opts.spread) plan = solveSpread(input, opts, plan);
    if (opts.compare && plan.totals.requested > 0 && !plan.spreadNote) {
      try {
        const alt = solveBest(input, Object.assign({}, opts, { mergeTail: !opts.mergeTail }));
        plan.compare = { mergeTail: !opts.mergeTail, loaded: alt.totals.loaded, kg: alt.totals.kg, ok: alt.ok, usedLength: alt.totals.usedLength, delta: alt.totals.loaded - plan.totals.loaded };
      } catch (e) { /* bỏ qua */ }
    }
    if (opts.hints !== false) { try { plan.hints = buildHints(input, opts, plan); } catch (e) { plan.hints = []; } }
    return plan;
  }

  return { PERMS, previewTpl, parseColPlan, PRESETS, solve, verify, normContainer, makeSpace, normSku, orientationsOf, passDoor, natCmp, dateVal, num, EPS };
});
