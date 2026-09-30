/* Kho Lạnh An An — xuất file phiếu xuất ngay trên điện thoại (Excel / PDF / ảnh PNG).
 *
 * Mỗi nguồn dùng MẪU của đúng bảng dữ liệu đó trên app PC:
 *   M02   Kho gửi          → "PHIẾU YÊU CẦU XUẤT HÀNG" (chép từ buildPxPhieuWorkbook() —
 *                            app/html/js/ton-kho-gui.js): logo, tiêu đề, dòng ghi chú đỏ,
 *                            STT | Mã hàng | Tên hàng | Số phiếu nhập | GHI CHÚ - LÔ | Size | Số lượng,
 *                            dòng TỔNG, ô ký "Người giao hàng".
 *   M01VT  Tồn vị trí An An → mẫu người dùng duyệt 27/09/2026: "PHIẾU XUẤT : dd/mm/yyyy", Mã hàng | Vị trí |
 *                            SL xuất | Đặc tính | Hợp đồng, dòng Tổng (xem tableOf, nhánh M01VT). Cột co
 *                            theo độ dài giá trị thực tế (layout.autoWidth), không kéo giãn hết trang.
 *   M01VTB Vị Trí Bột      → mẫu người dùng duyệt 27/09/2026: "PHIẾU XUẤT BỘT : dd/mm/yyyy", Mã hàng | Vị trí |
 *                            SL xuất, dòng Tổng; xếp theo Vị trí (xem tableOf, nhánh M01VTB). Cột co theo
 *                            độ dài giá trị thực tế (layout.autoWidth), không kéo giãn hết trang.
 *   M01   Tồn kho An An    → PC chưa có mẫu phiếu riêng: dùng CÙNG kiểu "PHIẾU XUẤT" của Module 01.
 *   M03   NXT Bột/Sốt      → PC chưa có mẫu phiếu riêng: kiểu Excel của Module 03 (Times New Roman
 *                            14, viền đen) — cột giống bảng "Chọn hàng xuất".
 *   M04   NXT TNK/TGC      → PC chưa có mẫu phiếu riêng: kiểu exportTableToExcel() của Module 04
 *                            (Times New Roman 15, viền đen, dòng "Tổng cộng").
 * PDF/PNG: dựng đúng bố cục đó bằng HTML rồi chụp (html2canvas) — font PDF mặc định không có dấu
 * tiếng Việt nên PDF cũng đi đường ảnh, giống cách app PC làm.
 * Thư viện (lib/*.js) chỉ tải khi bấm xuất lần đầu, không làm chậm lúc mở app.
 */
(function () {
  'use strict';

  const LIBS = {
    excel: ['lib/exceljs.min.js'],
    pdf: ['lib/html2canvas.min.js', 'lib/jspdf.umd.min.js'],
    png: ['lib/html2canvas.min.js'],
    logo: ['lib/logo.js'],
  };
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res;
        s.onerror = () => { delete loaded[src]; rej(new Error('Không tải được ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  async function need(kinds) { for (const k of kinds) for (const src of LIBS[k]) await loadScript(src); }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  const fmt = (n, d) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 3 : d });
  const p2 = (v) => String(v).padStart(2, '0');
  function stampOf(iso) {
    const d = iso ? new Date(iso) : new Date();
    const t = isNaN(d.getTime()) ? new Date() : d;
    return {
      date: `${p2(t.getDate())}/${p2(t.getMonth() + 1)}/${t.getFullYear()}`,
      label: `${p2(t.getDate())}/${p2(t.getMonth() + 1)}/${t.getFullYear()} ${p2(t.getHours())}:${p2(t.getMinutes())}`,
    };
  }
  // GIỐNG vtShortCode()/vtSplitName() ở Module 01 (Tồn theo vị trí).
  function vtShortCode(ma) {
    let s = String(ma ?? '').trim().replace(/^TPC-/i, '');
    if (s.length > 21 && s.includes('-')) s = s.slice(s.lastIndexOf('-') + 1);
    return s;
  }
  function vtSplitName(ten) {
    const p = String(ten ?? '').split(' - ');
    return p.length >= 3 ? [p[p.length - 2].trim(), p[p.length - 1].trim()] : ['', ''];
  }

  /* ---------------------------------------------------------------- mô tả bảng của từng nguồn
     Mỗi mẫu trả về { title, meta: [dòng thông tin], cols: [{label, num, dec}], rows: [[...]],
     totals: [...] } — dùng chung cho Excel (kiểu từng module) và HTML (PDF/PNG). */
  function tableOf(ph) {
    const items = ph.items || [];
    // Không in dòng "Mã phiếu | Người lập | Ngày lập" ở bất kỳ mẫu phiếu nào nữa (không cần thiết);
    // chỉ giữ lại Ghi chú (và LSX xuất riêng của Module 03) nếu có.
    const note = ph.ghiChu ? ['Ghi chú: ' + ph.ghiChu] : [];
    if (ph.module === 'M01VT') {
      // Mẫu "PhieuXuat_ViTri_DT260927-0843.xlsx" người dùng duyệt (27/09/2026): tiêu đề "PHIẾU XUẤT : ngày tạo
      // phiếu" (căn trái), 5 cột Mã hàng | Vị trí | SL xuất | Đặc tính | Hợp đồng (bỏ cột Net xuất), độ rộng cột
      // và chiều cao dòng cố định theo mẫu. Bản PC giống hệt: exportViTriPhieuXuat() trong ton-kho-an-an.js.
      let sq = 0;
      const rows = items.map((it) => {
        const q = num(it.qty);
        const [dt, hd] = vtSplitName(it.tenHang);
        sq += q;
        return [vtShortCode(it.maHang), it.viTri || '', q, dt, hd];
      });
      return {
        title: 'PHIẾU XUẤT : ' + stampOf(ph.ngayTao).date, meta: note,
        cols: [{ label: 'Mã hàng' }, { label: 'Vị trí' }, { label: 'SL xuất', num: true, dec: 2 }, { label: 'Đặc tính' }, { label: 'Hợp đồng' }],
        rows, totals: [`Tổng (${items.length} dòng)`, '', sq, '', ''], style: 'm1',
        // autoWidth: co cột theo độ dài giá trị thực tế (không kéo giãn hết trang) — xem autoWidths()
        // (Excel) và sheetHtml() (PDF/ảnh). Bản PC giống hệt: exportViTriPhieuXuat() trong ton-kho-an-an.js.
        layout: { titleAlign: 'left', autoWidth: true, headerH: 26.1, rowH: 37.5, totalH: 18.75 },
      };
    }
    if (ph.module === 'M01VTB') {
      let sq = 0;
      const byVt = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' }).compare;
      const sorted = items.slice().sort((a, b) => byVt(String(a.viTri || ''), String(b.viTri || '')));
      const rows = sorted.map((it) => {
        const q = num(it.qty); sq += q;
        return [it.maHang || '', it.viTri || '', q];
      });
      // Mẫu "PhieuXuat_ViTriBot_DT260927-0830.xlsx" người dùng duyệt (27/09/2026): "PHIẾU XUẤT BỘT : ngày"
      // (Times New Roman 16 đậm, căn trái, gộp A1:D1 — rộng hơn bảng 1 cột), 3 cột Mã hàng | Vị trí | SL xuất,
      // xếp theo vị trí, dòng dữ liệu cao 32.25. Bản PC giống hệt: exportVtbPhieuXuat() trong ton-kho-an-an.js.
      return {
        title: 'PHIẾU XUẤT BỘT : ' + stampOf(ph.ngayTao).date, meta: note,
        cols: [{ label: 'Mã hàng' }, { label: 'Vị trí' }, { label: 'SL xuất', num: true, dec: 2 }],
        rows, totals: [`Tổng (${items.length} dòng)`, '', sq], style: 'm1',
        // autoWidth: co cột theo độ dài giá trị thực tế — xem autoWidths()/sheetHtml(). Bản PC giống
        // hệt: exportVtbPhieuXuat() trong ton-kho-an-an.js.
        layout: { titleAlign: 'left', titleSize: 16, mergeCols: 4, autoWidth: true, headerH: 26.1, rowH: 32.25, totalH: 18.75 },
      };
    }
    if (ph.module === 'M01') {
      let sq = 0;
      const rows = items.map((it) => { const q = num(it.qty); sq += q; return [it.maHang, it.tenHang, it.hopDong || '', it.size || '', it.dvt || '', q]; });
      return {
        title: 'PHIẾU XUẤT', meta: note,
        cols: [{ label: 'Mã hàng' }, { label: 'Tên hàng' }, { label: 'Hợp đồng' }, { label: 'Size' }, { label: 'ĐVT' }, { label: 'SL xuất', num: true }],
        rows, totals: [`Tổng (${items.length} dòng)`, '', '', '', '', sq], style: 'm1',
      };
    }
    if (ph.module === 'M03') {
      let sk = 0, sb = 0;
      const rows = items.map((it) => {
        const kg = num(it.qty), net = num(it.pack);
        const kien = net > 0 ? kg / net : '';
        sk += kg; if (kien !== '') sb += kien;
        return [it.maPhieuLo || '', it.loaiHang || '', it.maHang || '', it.lsx || '', it.viTri || '', net || '', kien, kg];
      });
      return {
        title: 'PHIẾU XUẤT SỬ DỤNG', meta: ['LSX xuất: ' + (ph.lsxXuatLabel || '')].concat(note),
        cols: [{ label: 'Mã phiếu nhập' }, { label: 'Loại Hàng' }, { label: 'Mã Hàng' }, { label: 'LSX / Hợp đồng' }, { label: 'Vị trí' },
          { label: 'Trọng lượng (kg)', num: true, dec: 2 }, { label: 'Kiện/Bao', num: true }, { label: 'Tổng (kg)', num: true, dec: 2 }],
        rows, totals: ['Tổng cộng', '', '', '', '', '', sb, sk], style: 'm3',
      };
    }
    if (ph.module === 'M04') {
      let sq = 0, sn = 0;
      const rows = items.map((it) => {
        const q = num(it.qty), w = num(it.weight);
        sq += q; sn += q * w;
        return [it.type || '', it.supplier || '', it.inv || '', it.po || '', it.maHang || '', it.dacTinh || '', it.size || '', it.viTri || '', w, q, q * w];
      });
      return {
        title: 'PHIẾU XUẤT HÀNG', meta: note,
        cols: [{ label: 'Loại hàng' }, { label: 'Nhà cung cấp' }, { label: 'INV' }, { label: 'TP/PO' }, { label: 'Mã hàng' }, { label: 'Đặc tính' },
          { label: 'Size' }, { label: 'Vị trí' }, { label: 'Trọng lượng', num: true, dec: 2 }, { label: 'SL xuất', num: true }, { label: 'Net (kg)', num: true, dec: 2 }],
        rows, totals: ['Tổng cộng', '', '', '', '', '', '', '', '', sq, sn], style: 'm4',
      };
    }
    // M02 — Phiếu yêu cầu xuất hàng. Không in dòng "Mã phiếu | Người lập | Ngày lập" (không cần thiết,
    // và để khớp đúng mẫu bên PC — buildPxPhieuWorkbook() không có dòng này); chỉ giữ Ghi chú nếu có.
    let sq = 0;
    const rows = items.map((it, i) => { const q = num(it.qty); sq += q; return [i + 1, it.maHang, it.tenHang, it.phieuNhap || '', it.soLo || '', it.size || '', q]; });
    return {
      title: 'PHIẾU YÊU CẦU XUẤT HÀNG', meta: note,
      cols: [{ label: 'STT' }, { label: 'Mã hàng' }, { label: 'Tên hàng' }, { label: 'Số phiếu nhập' }, { label: 'GHI CHÚ - LÔ ( IN TRÊN THÙNG )' },
        { label: 'Kích cỡ/size' }, { label: 'Số lượng \n(thùng/bao)', num: true }],
      rows, totals: ['', '', 'TỔNG', '', '', '', sq], style: 'm2',
    };
  }

  /* ---------------------------------------------------------------- Excel */
  const THIN = { style: 'thin', color: { argb: 'FF000000' } };
  const GRID = { top: THIN, bottom: THIN, left: THIN, right: THIN };

  function autoWidths(ws, t, fontSize) {
    const f = fontSize / 11;
    const n = t.cols.length;
    t.cols.forEach((c, i) => {
      let len = String(c.label).split('\n').reduce((m, s) => Math.max(m, s.length), 0);
      t.rows.concat([t.totals]).forEach((r) => { const v = r[i]; len = Math.max(len, String(typeof v === 'number' ? fmt(v, c.dec) : (v ?? '')).length); });
      ws.getColumn(i + 1).width = Math.min(55, Math.max(6, len * f * 1.1 + 2));
    });
    // Cột thừa chỉ để gộp tiêu đề rộng hơn bảng dữ liệu (VD Vị Trí Bột, mergeCols > số cột dữ liệu):
    // chỉ nới rộng thêm nếu tổng độ rộng các cột dữ liệu chưa đủ chỗ cho tiêu đề, tránh tiêu đề bị
    // tràn ra ngoài vùng gộp — không thì giữ hẹp (không kéo giãn hết trang).
    const lay = t.layout || {};
    const mergeCols = lay.mergeCols || 0;
    if (mergeCols > n) {
      const titleLen = String(t.title || '').length;
      const titleF = (lay.titleSize || 20) / 11;
      const neededTotal = titleLen * titleF * 1.1 + 2;
      let sumSoFar = 0;
      for (let i = 0; i < n; i++) sumSoFar += ws.getColumn(i + 1).width;
      const extraCols = mergeCols - n;
      const perExtra = Math.max(6, (neededTotal - sumSoFar) / extraCols);
      for (let i = n; i < mergeCols; i++) ws.getColumn(i + 1).width = perExtra;
    }
  }

  async function buildExcel(ph) {
    await need(['excel']);
    const t = tableOf(ph);
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet(t.style === 'm2' ? 'PYC' : 'Phieu_Xuat', { pageSetup: { orientation: t.cols.length > 7 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1 } });
    const n = t.cols.length;
    const L = (i) => String.fromCharCode(65 + i);

    if (t.style === 'm2') {
      // ---- Mẫu PYC của Module 02 (giữ đúng bố cục: logo dòng 1-2, tiêu đề dòng 3, ghi chú đỏ dòng 6,
      // tiêu đề bảng dòng 7, dòng TỔNG, ô ký) ----
      await need(['logo']);
      const FONT = { name: 'Times New Roman', size: 16 };
      const QTY = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
      ws.getRow(1).height = 24; ws.getRow(2).height = 24;
      const logo = wb.addImage({ base64: window.KL_LOGO_BASE64, extension: 'png' });
      ws.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 230, height: 63 } });
      ws.mergeCells('A3:G3');
      Object.assign(ws.getCell('A3'), { value: t.title });
      ws.getCell('A3').font = { ...FONT, bold: true }; ws.getCell('A3').alignment = { horizontal: 'center' };
      if (t.meta.length) {
        ws.mergeCells('A4:G4');
        ws.getCell('A4').value = t.meta.join('    ');
        ws.getCell('A4').font = { ...FONT, size: 12, italic: true }; ws.getCell('A4').alignment = { horizontal: 'center' };
      }
      ws.mergeCells('A6:G6');
      ws.getCell('A6').value = 'XUẤT HÀNG THEO THỨ TỰ PHIẾU YÊU CẦU - GHI RÕ THÔNG TIN SIZE, QUY CÁCH, GHI CHÚ TRÊN CARGO';
      ws.getCell('A6').font = { ...FONT, bold: true, color: { argb: 'FFFF0000' } };
      ws.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle' };
      const hr = ws.getRow(7); hr.height = 37.5;
      t.cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.label; cell.font = { ...FONT, bold: true }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = GRID; });
      t.rows.forEach((r, k) => {
        const row = ws.getRow(8 + k);
        r.forEach((v, ci) => {
          const cell = row.getCell(ci + 1); cell.value = v; cell.font = FONT; cell.border = GRID;
          if (ci === 0) cell.alignment = { horizontal: 'center' };
          else if (ci === 6) cell.numFmt = QTY;
          else cell.alignment = { horizontal: 'left', wrapText: ci !== 4 };
        });
      });
      const tr = 8 + t.rows.length;
      const trow = ws.getRow(tr); trow.height = 22.5;
      for (let ci = 1; ci <= 7; ci++) { const c = trow.getCell(ci); c.border = GRID; c.font = { ...FONT, size: 18, bold: true }; }
      trow.getCell(3).value = 'TỔNG';
      trow.getCell(7).value = t.rows.length ? { formula: `SUM(G8:G${tr - 1})`, result: t.totals[6] } : 0;
      trow.getCell(7).numFmt = QTY;
      ws.mergeCells(`A${tr + 2}:C${tr + 2}`);
      ws.getCell(`A${tr + 2}`).value = 'Người giao hàng';
      ws.getCell(`A${tr + 2}`).font = { ...FONT, bold: true }; ws.getCell(`A${tr + 2}`).alignment = { horizontal: 'center' };
      ws.mergeCells(`A${tr + 3}:C${tr + 3}`);
      ws.getCell(`A${tr + 3}`).value = '(Ký và ghi rõ họ tên)';
      ws.getCell(`A${tr + 3}`).font = { ...FONT, italic: true }; ws.getCell(`A${tr + 3}`).alignment = { horizontal: 'center' };
      autoWidths(ws, t, 16);
      ws.getColumn(1).width = Math.max(ws.getColumn(1).width, 6);
    } else {
      // ---- Mẫu "PHIẾU XUẤT" dạng bảng: tiêu đề + dòng thông tin (gộp toàn bề rộng), tiêu đề cột,
      // dữ liệu, dòng tổng. Kiểu chữ/màu theo đúng module. ----
      const size = t.style === 'm4' ? 15 : 14;
      const FONT = { name: 'Times New Roman', size };
      const blueHeader = t.style === 'm1';
      const lay = t.layout || {};
      const mw = Math.max(n, lay.mergeCols || 0);            // tiêu đề / dòng ghi chú có thể gộp rộng hơn bảng
      ws.mergeCells(`A1:${L(mw - 1)}1`);
      ws.getCell('A1').value = t.title;
      ws.getCell('A1').font = { name: 'Times New Roman', size: lay.titleSize || 20, bold: true };
      ws.getCell('A1').alignment = { horizontal: lay.titleAlign || 'center', vertical: 'middle' };
      ws.getRow(1).height = 30;
      t.meta.forEach((m, k) => {
        const r = 2 + k;
        ws.mergeCells(`A${r}:${L(mw - 1)}${r}`);
        ws.getCell(`A${r}`).value = m;
        ws.getCell(`A${r}`).font = { name: 'Times New Roman', size: 13, bold: k === 0 };
      });
      const h = 2 + t.meta.length;
      const hr = ws.getRow(h); hr.height = lay.headerH || 26;
      t.cols.forEach((c, i) => {
        const cell = hr.getCell(i + 1);
        cell.value = c.label; cell.border = GRID;
        cell.font = blueHeader ? { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } } : { ...FONT, bold: true };
        if (blueHeader) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      const put = (rowIdx, vals, isTotal) => {
        const row = ws.getRow(rowIdx);
        vals.forEach((v, ci) => {
          const c = t.cols[ci], cell = row.getCell(ci + 1);
          cell.value = v === '' ? null : v;
          cell.font = { ...FONT, bold: !!isTotal };
          cell.border = isTotal && blueHeader ? { ...GRID, top: { style: 'medium', color: { argb: 'FF000000' } } } : GRID;
          cell.alignment = { horizontal: c.num ? 'right' : 'left', vertical: 'middle', wrapText: !c.num };
          if (c.num && typeof v === 'number') cell.numFmt = blueHeader ? '#,##0.00' : (c.dec ? '#,##0.00' : '#,##0.###');
          if (isTotal && blueHeader) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
        });
      };
      t.rows.forEach((r, k) => { put(h + 1 + k, r); if (lay.rowH) ws.getRow(h + 1 + k).height = lay.rowH; });
      put(h + 1 + t.rows.length, t.totals, true);
      if (lay.totalH) ws.getRow(h + 1 + t.rows.length).height = lay.totalH;
      ws.views = [{ state: 'frozen', ySplit: h }];
      if (lay.widths) lay.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      else autoWidths(ws, t, size);
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------------------------------------------------------------- HTML (cho PDF / PNG) */
  const ROWS_PER_PAGE = 20;
  // Độ rộng từng cột (px) khi layout.autoWidth — co theo độ dài giá trị thực tế của TOÀN BỘ dòng.
  // Dùng chung cho colgroup trong sheetHtml() VÀ để tính bề rộng khung render (renderCanvas) ở
  // buildPng()/buildPdf(), để ảnh/PDF chỉ chụp đúng phần bảng có dữ liệu, không còn khoảng trắng
  // thừa bên phải do khung render rộng hơn bảng thật (mẫu M01VT/M01VTB).
  function autoWidthPx(t) {
    const isM2 = t.style === 'm2';
    const charPx = (isM2 ? 15 : 13) * 0.62;
    return t.cols.map((c, i) => {
      let len = String(c.label).length;
      t.rows.concat([t.totals]).forEach((r) => { const v = r[i]; len = Math.max(len, String(typeof v === 'number' ? fmt(v, c.dec) : (v ?? '')).length); });
      return Math.round(len * charPx) + 24;
    });
  }
  // Bề rộng khung render (host) cho renderCanvas(): khớp với bảng autoWidth (+ padding 28px 32px của
  // div bọc ngoài) thay vì luôn dùng khổ cố định 1100/1123/1400px — tránh phần nền trắng thừa bên phải
  // khi bảng thật hẹp hơn nhiều (VD "PHIẾU XUẤT BỘT" chỉ 3 cột).
  function renderWidth(t, fallback) {
    if (t.layout && t.layout.autoWidth) {
      const tableW = autoWidthPx(t).reduce((a, b) => a + b, 0);
      return Math.max(tableW + 64, 380);
    }
    return fallback;
  }
  function sheetHtml(t, from, to, pageNo, pageCount, showTotal) {
    const isM2 = t.style === 'm2';
    const blue = t.style === 'm1';
    const font = "'Times New Roman',Times,'Noto Serif',serif";
    const th = `padding:8px 10px;border:1px solid ${blue ? '#444' : '#000'};${blue ? 'background:#1F4E78;color:#fff;' : 'background:#fff;color:#111;'}font-weight:700;font-size:${isM2 ? 15 : 13}px;white-space:pre-line;text-align:center;`;
    const td = `padding:4px 10px;height:28px;border:1px solid ${blue ? '#999' : '#000'};background:#fff;color:#111;font-size:${isM2 ? 15 : 13}px;`;
    const cell = (v, c, bold, bg) => `<td style="${td}${c.num ? 'text-align:right;white-space:nowrap;' : ''}${bold ? 'font-weight:700;' : ''}${bg ? 'background:' + bg + ';' : ''}">${typeof v === 'number' ? fmt(v, c.dec) : esc(v)}</td>`;
    const body = t.rows.slice(from, to).map((r) => `<tr>${r.map((v, i) => cell(v, t.cols[i])).join('')}</tr>`).join('');
    // Dòng Tổng mẫu xanh: nền #DDEBF7 + viền trên đậm (giống file Excel)
    const total = showTotal ? `<tr${blue ? ' style="border-top:2px solid #000"' : ''}>${t.totals.map((v, i) => cell(v, t.cols[i], true, blue ? '#DDEBF7;border-top:2px solid #000' : '')).join('')}</tr>` : '';
    // Mẫu có độ rộng cột cố định (layout.widths, nếu còn dùng ở mẫu khác): PDF/ảnh giữ đúng tỉ lệ cột
    // như file Excel; cột thừa bên phải (chỉ để gộp tiêu đề) làm bảng hẹp lại tương ứng.
    const lw = t.layout && t.layout.widths;
    let tblW = '100%', colg = '';
    if (lw) {
      const sumW = lw.reduce((a, b) => a + b, 0), tabW = lw.slice(0, t.cols.length).reduce((a, b) => a + b, 0);
      tblW = (tabW / sumW * 100).toFixed(1) + '%';
      colg = `<colgroup>${lw.slice(0, t.cols.length).map((w) => `<col style="width:${(w / tabW * 100).toFixed(2)}%">`).join('')}</colgroup>`;
    } else if (t.layout && t.layout.autoWidth) {
      // layout.autoWidth (VD phiếu Tồn vị trí, Vị trí Bột): co cột theo độ dài giá trị thực tế của
      // TOÀN BỘ dòng (không riêng trang này, để mọi trang PDF cùng độ rộng cột) — bảng lấy đúng tổng
      // độ rộng đó, không còn kéo giãn hết trang như width:100%. Bản PC giống hệt: vtColWidthsPx()
      // trong ton-kho-an-an.js.
      const colPx = autoWidthPx(t);
      tblW = colPx.reduce((a, b) => a + b, 0) + 'px';
      colg = `<colgroup>${colPx.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>`;
    }
    const logo = isM2 && window.KL_LOGO_BASE64 ? `<img src="data:image/png;base64,${window.KL_LOGO_BASE64}" style="height:63px;display:block;margin-bottom:6px;">` : '';
    const redNote = isM2 ? `<div style="text-align:center;color:#f00;font-weight:700;font-size:15px;margin:10px 0 8px;">XUẤT HÀNG THEO THỨ TỰ PHIẾU YÊU CẦU - GHI RÕ THÔNG TIN SIZE, QUY CÁCH, GHI CHÚ TRÊN CARGO</div>` : '';
    const sign = isM2 && showTotal ? `<div style="width:40%;text-align:center;margin-top:22px;font-size:15px;"><b>Người giao hàng</b><br><i>(Ký và ghi rõ họ tên)</i><div style="height:70px"></div></div>` : '';
    return `<div style="box-sizing:border-box;background:#fff;color:#111;font-family:${font};padding:28px 32px;">
      ${logo}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">
        <div style="flex:1;${isM2 ? 'text-align:center;' : ''}"><div style="font-size:22px;font-weight:800;">${esc(t.title)}</div>
          ${t.meta.map((m) => `<div style="font-size:13px;color:#333;margin-top:4px;">${esc(m)}</div>`).join('')}</div>
        ${pageCount > 1 ? `<div style="font-size:12px;color:#555;">Trang ${pageNo}/${pageCount}</div>` : ''}
      </div>
      ${redNote}
      <table style="border-collapse:collapse;width:${tblW};">${colg}<thead><tr>${t.cols.map((c) => `<th style="${th}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${body}${total}</tbody></table>${sign}</div>`;
  }
  async function renderCanvas(html, width) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;background:#fff;`;
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      await new Promise((r) => setTimeout(r, 60));
      return await window.html2canvas(host, { scale: 2, backgroundColor: '#ffffff', windowWidth: width });
    } finally { host.remove(); }
  }
  async function buildPng(ph) {
    await need(['png'].concat(ph.module === 'M02' ? ['logo'] : []));
    const t = tableOf(ph);
    const width = renderWidth(t, t.cols.length > 7 ? 1400 : 1100);
    const canvas = await renderCanvas(sheetHtml(t, 0, t.rows.length, 1, 1, true), width);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Không tạo được ảnh PNG.'))), 'image/png'));
  }
  async function buildPdf(ph) {
    await need(['pdf'].concat(ph.module === 'M02' ? ['logo'] : []));
    const t = tableOf(ph);
    const width = renderWidth(t, t.cols.length > 7 ? 1400 : 1123);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), phh = pdf.internal.pageSize.getHeight();
    const pages = Math.max(1, Math.ceil(t.rows.length / ROWS_PER_PAGE));
    for (let p = 0; p < pages; p++) {
      const from = p * ROWS_PER_PAGE, to = Math.min(t.rows.length, from + ROWS_PER_PAGE);
      const canvas = await renderCanvas(sheetHtml(t, from, to, p + 1, pages, p === pages - 1), width);
      let w = pw, h = canvas.height * pw / canvas.width;
      if (h > phh) { h = phh; w = canvas.width * phh / canvas.height; }
      if (p > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);
    }
    return pdf.output('blob');
  }

  const PREFIX = { M02: 'PYC', M01: 'PhieuXuat_TonKhoAnAn', M01VT: 'PhieuXuat_ViTri', M01VTB: 'PhieuXuat_ViTriBot', M03: 'PhieuXuat_BotSot', M04: 'PhieuXuat_TNK-TGC' };
  // Mã phiếu tự sinh (app.js stamp(): "DT260924-1419", có thể kèm "-2" nếu trùng) -> tên file có tiền tố theo module.
  // Phiếu do người dùng TỰ ĐẶT TÊN (VD "PYC_02") -> tên file GIỮ NGUYÊN đúng như đã đặt, không thêm tiền tố.
  const AUTO_MA = /^DT\d{6}-\d{4}(-\d+)?$/;
  function fileName(ph, ext) {
    const ma = String(ph.maPhieu || '').trim();
    if (ma && !AUTO_MA.test(ma)) {
      // chỉ thay các ký tự Windows/Android không cho phép trong tên file: \ / : * ? " < > |
      const own = ma.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '');
      if (own) return `${own}.${ext}`;
    }
    const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '_');
    return `${PREFIX[ph.module] || 'PhieuXuat'}_${safe(ma) || Date.now()}.${ext}`;
  }

  window.KLExport = {
    // format: 'xlsx' | 'pdf' | 'png' → { blob, name, mime }
    async build(ph, format) {
      const blob = format === 'pdf' ? await buildPdf(ph) : format === 'png' ? await buildPng(ph) : await buildExcel(ph);
      return { blob, name: fileName(ph, format), mime: blob.type };
    },
    tableOf, // để kiểm thử
  };
})();
