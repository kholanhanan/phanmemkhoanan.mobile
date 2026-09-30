/* Kho Lạnh An An — Module 08 (Tổng Hợp) trên điện thoại: phần TÍNH TOÁN.
 *
 * Toàn bộ các hằng số/hàm bên trong KLM8.create() được CHÉP NGUYÊN VĂN từ app PC
 * (app/html/js/tong-hop.js) bằng script — không viết lại — để Bảng 2 "Dữ liệu tổng hợp" và
 * Bảng 2 "Báo cáo rã đông" trên điện thoại ra ĐÚNG như trên PC. Sửa công thức trên PC thì chép lại
 * các hàm: segmentDefs, TAB3_*_MAP, stripDiacritics, normalizeCode, normalizeSearch,
 * tab2FindDateColumn, tab2FormatDate, roundFloatNoise, parseVNNumber, tab2SegOffset,
 * tab2ReadSegmentLabel, computeTab2Groups, tab3SegmentRaw, tab3LookupSegment1Name,
 * computeTab3Groups, tab3FormatSizeDisplay.
 * Dữ liệu vào: segmentData / tab2Data / tab3Data / tab3SizeLabelLearned dựng lại từ các tab
 * M08_* trên Google Sheet (xem buildM08Push() trong app/main.js).
 */
(function () {
  'use strict';
  // Thay cho thư viện XLSX của PC: chỉ cần đổi số serial ngày Excel -> ngày (theo UTC, như PC).
  const __XLSX = { SSF: { parse_date_code(v) {
    const d = new Date(Math.round((Number(v) - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  } } };
  window.KLM8 = {
    create(input) {
      const window = { XLSX: __XLSX };
      const XLSX = __XLSX;
      const segmentData = input.segmentData || {};
      const tab2Data = input.tab2Data || { headers: [], rows: [] };
      const tab3Data = input.tab3Data || { headers: [], rows: [] };
      const tab3SizeLabelLearned = input.tab3SizeLabelLearned || {};
      /* ======================= CHÉP TỪ tong-hop.js ======================= */
    const segmentDefs = [
      {seg:1,  length:4, range:'Ký tự 1–4',   name:'Tên sản phẩm'},
      {seg:2,  length:1, range:'Ký tự 5',     name:'Cấp đông'},
      {seg:3,  length:1, range:'Ký tự 6',     name:'Đóng gói'},
      {seg:4,  length:1, range:'Ký tự 7',     name:'Hóa chất/Phụ gia'},
      {seg:5,  length:1, range:'Ký tự 8',     name:'Thị trường'},
      {seg:6,  length:2, range:'Ký tự 9–10',  name:'Khách hàng'},
      {seg:7,  length:3, range:'Ký tự 11–13', name:'Mạ băng'},
      {seg:8,  length:4, range:'Ký tự 14–17', name:'Size'},
      {seg:9,  length:2, range:'Ký tự 18–19', name:'Trọng lượng'},
      {seg:10, length:2, range:'Ký tự 20–21', name:'Quy cách đóng thùng'},
    ];
    const TAB3_PRODUCT_STAGE_MAP = {
      'VRHL': 'BTP',
      'VRPD': 'RAW PD',
      'VRHO': 'NL'
    };
    const TAB3_MARKET_CUSTOMER_MAP = {
      'XEC': 'ECUADOR',
      'XTC': 'TÔM GIA CÔNG',
      'XAI': 'ẤN ĐỘ'
    };
    const TAB3_SIZE_DISPLAY_MAP = {
      '1003': '100/200'
    };
const segmentMap = Object.fromEntries(segmentDefs.map(s => [s.seg, s]));
    function stripDiacritics(str){
      return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
    }

    function normalizeCode(code){
      return String(code || '').trim().toLowerCase();
    }
    function normalizeSearch(str){
      return stripDiacritics(str).toLowerCase().trim();
    }
    function tab2FindDateColumn(headers){
      const idx = headers.findIndex(h => {
        const n = normalizeSearch(h);
        return n === 'ngay' || n.includes('ngay') || n === 'date' || n.includes('date');
      });
      return idx >= 0 ? headers[idx] : '';
    }
    function tab2FormatDate(val){
      if(val === undefined || val === null || val === '') return '';
      if(val instanceof Date && !isNaN(val)){
        const dd = String(val.getUTCDate()).padStart(2, '0');
        const mm = String(val.getUTCMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${val.getUTCFullYear()}`;
      }
      if(typeof val === 'number' && window.XLSX && XLSX.SSF && XLSX.SSF.parse_date_code){
        const parsed = XLSX.SSF.parse_date_code(val);
        if(parsed){
          const dd = String(parsed.d).padStart(2, '0');
          const mm = String(parsed.m).padStart(2, '0');
          return `${dd}/${mm}/${parsed.y}`;
        }
      }
      // Chuỗi ngày dạng ISO 8601, ví dụ "2026-09-02T16:59:30.000Z" hoặc
      // "2026-09-02" (một số file Excel lưu cột Ngày dưới dạng text thay
      // vì kiểu Date/serial). Lấy trực tiếp phần năm-tháng-ngày ở đầu
      // chuỗi, KHÔNG quy đổi qua múi giờ trình duyệt, để tránh lệch ngày
      // khi giờ UTC gần nửa đêm.
      if(typeof val === 'string'){
        const isoMatch = val.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if(isoMatch){
          const [, y, m, d] = isoMatch;
          return `${d}/${m}/${y}`;
        }
        // Trường hợp cột Ngày lưu số serial Excel nhưng bị đọc ra dạng
        // chuỗi (ví dụ "45903").
        const trimmed = val.trim();
        const asNum = Number(trimmed);
        if(trimmed !== '' && !isNaN(asNum) && window.XLSX && XLSX.SSF && XLSX.SSF.parse_date_code){
          const parsed = XLSX.SSF.parse_date_code(asNum);
          if(parsed){
            const dd = String(parsed.d).padStart(2, '0');
            const mm = String(parsed.m).padStart(2, '0');
            return `${dd}/${mm}/${parsed.y}`;
          }
        }
      }
      return String(val).trim();
    }
    function roundFloatNoise(num){
      return Math.round((num + Number.EPSILON) * 1e6) / 1e6;
    }
    function parseVNNumber(val){
      if(val === undefined || val === null || val === '') return null;
      if(typeof val === 'number') return isNaN(val) ? null : val;
      let s = String(val).trim();
      if(s === '') return null;
      s = s.replace(/\s/g, '');
      const lastComma = s.lastIndexOf(',');
      const lastDot = s.lastIndexOf('.');
      if(lastComma !== -1 && lastDot !== -1){
        if(lastComma > lastDot){
          s = s.replace(/\./g, '').replace(',', '.');
        }else{
          s = s.replace(/,/g, '');
        }
      }else if(lastComma !== -1){
        const decPart = s.length - lastComma - 1;
        s = (decPart > 0 && decPart <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
      }
      const num = parseFloat(s);
      return isNaN(num) ? null : num;
    }
    function tab2SegOffset(targetSeg){
      let offset = 0;
      for(const def of segmentDefs){
        if(def.seg === targetSeg) break;
        offset += def.length;
      }
      return offset;
    }
    function tab2ReadSegmentLabel(code, seg, missingLabel){
      const offset = tab2SegOffset(seg);
      const len = segmentMap[seg].length;
      if(code.length < offset + len) return missingLabel;
      const segCode = code.slice(offset, offset + len);
      const norm = normalizeCode(segCode);
      const menu = segmentData[seg] || [];
      const match = menu.find(e => normalizeCode(e.code) === norm);
      return (match && match.name) ? match.name : `${segCode} (chưa khai báo trong Menu ${segmentMap[seg].name})`;
    }
    function computeTab2Groups(){
      const { headers, codeCol, dateCol, rows } = tab2Data;
      const hasDate = !!dateCol;
      const numericCols = headers.filter(h => h !== codeCol && h !== dateCol && rows.some(r => parseVNNumber(r[h]) !== null));

      const groups = {};
      const order = [];

      rows.forEach(r => {
        const code = String(r[codeCol] || '').trim();
        const dateLabel = hasDate ? (tab2FormatDate(r[dateCol]) || '(Không có ngày)') : '';
        const productLabel = tab2ReadSegmentLabel(code, 1, '(Mã hàng thiếu ký tự Tên sản phẩm)');
        const sizeLabel = tab2ReadSegmentLabel(code, 8, '(Mã hàng thiếu ký tự Size)');
        const key = `${dateLabel}\u0001${productLabel}\u0001${sizeLabel}`;

        if(!groups[key]){
          groups[key] = { date: dateLabel, product: productLabel, size: sizeLabel, count: 0 };
          numericCols.forEach(c => groups[key][c] = 0);
          order.push(key);
        }
        groups[key].count++;
        numericCols.forEach(c => {
          const v = parseVNNumber(r[c]);
          if(v !== null) groups[key][c] += v;
        });
      });

      return { numericCols, order, groups, hasDate };
    }
    function tab3SegmentRaw(code, seg, missingLabel){
      const offset = tab2SegOffset(seg);
      const len = segmentMap[seg].length;
      if(!code || code.length < offset + len) return missingLabel;
      return code.slice(offset, offset + len);
    }
    function tab3LookupSegment1Name(code){
      const norm = normalizeCode(code);
      if(!norm) return '';
      const entry = (segmentData[1] || []).find(e => normalizeCode(e.code) === norm);
      return entry ? entry.name : '';
    }
    function computeTab3Groups(){
      const { headers, codeCol, rows } = tab3Data;
      const dateCol = tab2FindDateColumn(headers);
      const weightCol = headers.find(h => normalizeSearch(h) === 'trong luong' || normalizeSearch(h).includes('trong luong')) || '';
      const caCol = headers.find(h => normalizeSearch(h) === 'ca') || '';
      const hasDate = !!dateCol;

      const excluded = new Set([codeCol, dateCol, weightCol, caCol].filter(Boolean));
      const numericCols = headers.filter(h => !excluded.has(h) && rows.some(r => parseVNNumber(r[h]) !== null));

      const groups = {};
      const order = [];

      rows.forEach(r => {
        const code = r.__code || '';
        const rawProductLabel = tab3SegmentRaw(code, 1, '(Mã hàng thiếu ký tự Tên sản phẩm)');
        // Bước 1: đổi tên gợi nhớ cho 4 ký tự đầu nếu có trong bảng ánh xạ;
        // không có thì tra trong menu "Mã hóa sản phẩm" > "1. Tên sản
        // phẩm"; vẫn không có thì mới giữ nguyên mã gốc (hành vi cũ).
        let productLabel = TAB3_PRODUCT_STAGE_MAP[rawProductLabel] || tab3LookupSegment1Name(rawProductLabel) || rawProductLabel;

        // Bước 2: tổ hợp Thị trường (seg 5) + Khách hàng (seg 6) ghép lại —
        // nếu khớp bảng ánh xạ thì ghi đè tên ở bước 1.
        const marketLabel = tab3SegmentRaw(code, 5, '');
        const customerLabel = tab3SegmentRaw(code, 6, '');
        const marketCustomerKey = marketLabel + customerLabel;
        if(TAB3_MARKET_CUSTOMER_MAP[marketCustomerKey]){
          productLabel = TAB3_MARKET_CUSTOMER_MAP[marketCustomerKey];
        }

        // Bước 3: Mạ băng (tổ hợp 7, ký tự 11–13) = "TGS" -> ghi đè tất cả,
        // gộp riêng nhóm này theo nhãn "TGS".
        const glazeLabel = tab3SegmentRaw(code, 7, '');
        const isTGS = glazeLabel === 'TGS';
        if(isTGS) productLabel = 'TGS';

        const sizeLabel = tab3SegmentRaw(code, 8, '(Mã hàng thiếu ký tự Size)');
        // Ngày chứng từ giờ là 1 phần của khóa gộp (nếu file có cột Ngày),
        // nên mỗi nhóm chỉ ứng với đúng 1 ngày — tách báo cáo theo từng ngày.
        const dateLabel = hasDate ? (tab2FormatDate(r[dateCol]) || '(Không có ngày)') : '';
        const key = `${dateLabel}\u0001${productLabel}\u0001${sizeLabel}`;

        if(!groups[key]){
          groups[key] = { date: dateLabel, product: productLabel, size: sizeLabel, count: 0, weightValues: [] };
          numericCols.forEach(c => groups[key][c] = 0);
          order.push(key);
        }
        const g = groups[key];
        g.count++;
        numericCols.forEach(c => {
          const v = parseVNNumber(r[c]);
          if(v !== null) g[c] += v;
        });

        // Trọng lượng là thuộc tính của từng mã hàng, KHÔNG cộng dồn khi
        // gộp nhóm — chỉ ghi nhận các giá trị khác nhau xuất hiện trong
        // nhóm (không lặp lại giá trị trùng).
        if(weightCol){
          const wv = r[weightCol];
          const parsed = parseVNNumber(wv);
          const wLabel = parsed !== null ? String(roundFloatNoise(parsed)) : String(wv === undefined || wv === null ? '' : wv).trim();
          if(wLabel && !g.weightValues.includes(wLabel)) g.weightValues.push(wLabel);
        }
      });

      return { numericCols, order, groups, hasDate, dateCol, weightCol };
    }
    function tab3FormatSizeDisplay(raw){
      const trimmed = String(raw === undefined || raw === null ? '' : raw).trim();
      if(tab3SizeLabelLearned[trimmed]) return tab3SizeLabelLearned[trimmed];
      if(TAB3_SIZE_DISPLAY_MAP[trimmed]) return TAB3_SIZE_DISPLAY_MAP[trimmed];
      if(/^[0-9]{4}$/.test(trimmed) && trimmed[0] !== '0'){
        return trimmed.slice(0,2) + '/' + trimmed.slice(2);
      }
      if(/^[0-9]+$/.test(trimmed)){
        const n = parseInt(trimmed, 10);
        return isNaN(n) ? trimmed : String(n);
      }
      return trimmed;
    }
      /* ======================= HẾT PHẦN CHÉP ======================= */
      return { segmentDefs, segmentMap, segmentData, tab2Data, tab3Data, normalizeSearch, normalizeCode, parseVNNumber,
        roundFloatNoise, tab2FormatDate, tab2SegOffset, computeTab2Groups, computeTab3Groups, tab3FormatSizeDisplay };
    }
  };
})();
