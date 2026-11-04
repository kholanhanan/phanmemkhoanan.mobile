/* QUÉT MÃ THÔNG MINH — LÕI NHẬN DẠNG NỘI DUNG (PC 4.51 / ĐT 1.30). KHÔNG đụng DOM / camera → chạy được trong Node (tests/kl-quet-core.test.js).
   Bản điện thoại: ban-dien-thoai/www/kl-quet-core.js GIỐNG HỆT (sửa 1 nơi thì chép sang nơi kia).
   classify(text, formatCode?) → { kind, label, fmt, fields, search, summary }:
     url · wifi · vcard · email · tel · sms · geo · event · gs1 · json · ean (EAN-13 / EAN-8 / UPC-A / UPC-E có kiểm tra số cuối) · code (mã vạch chữ-số) · text
   search = chuỗi gợi ý để TÌM MÃ HÀNG trong kho (JSON: trường ma / code…; GS1: số lô (10) hoặc GTIN (01); mã vạch / văn bản thường: dòng đầu). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KlQuetCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // mã định dạng của ZXing (BarcodeFormat) → tên hiển thị
  const FORMATS = { 0: 'Aztec', 1: 'Codabar', 2: 'Code 39', 3: 'Code 93', 4: 'Code 128', 5: 'Data Matrix', 6: 'EAN-8', 7: 'EAN-13', 8: 'ITF', 9: 'MaxiCode', 10: 'PDF417', 11: 'QR', 12: 'RSS-14', 13: 'RSS Expanded', 14: 'UPC-A', 15: 'UPC-E' };
  const fmtName = (f) => (f == null ? '' : FORMATS[f] || '');
  const is2D = (f) => [0, 5, 9, 10, 11].indexOf(f) >= 0;
  const first = (s) => String(s).split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';

  // số kiểm tra GS1 (EAN-13 / EAN-8 / UPC-A / GTIN-14): đúng khi tổng có trọng số 3-1 chia hết cho 10
  function gs1Ok(d) {
    if (!/^\d{8}$|^\d{12,14}$/.test(d)) return false; let s = 0;
    for (let i = 0; i < d.length - 1; i++) s += +d[d.length - 2 - i] * (i % 2 === 0 ? 3 : 1);
    return (10 - (s % 10)) % 10 === +d[d.length - 1];
  }
  const unesc = (s) => String(s).replace(/\\([\\;,:"])/g, '$1');
  function parseWifi(t) {
    const body = t.slice(5), f = {}; let key = '', val = '', inKey = true, esc = false;
    const put = () => { if (key) f[key] = val; key = ''; val = ''; inKey = true; };
    for (const c of body) {
      if (esc) { if (inKey) key += c; else val += c; esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (inKey && c === ':') { inKey = false; continue; }
      if (!inKey && c === ';') { put(); continue; }
      if (inKey) key += c; else val += c;
    }
    if (key) put();
    return { ssid: f.S || '', password: f.P || '', security: f.T || 'nopass', hidden: /^true$/i.test(f.H || '') };
  }
  function parseVcard(t) {
    const g = (k) => { const m = new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'im').exec(t); return m ? m[1].trim() : ''; };
    return { name: g('FN') || g('N').replace(/;+/g, ' ').trim(), tel: g('TEL'), email: g('EMAIL'), org: g('ORG').replace(/;+/g, ' ').trim() };
  }
  const GS1_LABEL = { '01': 'GTIN', '02': 'GTIN hàng bên trong', '10': 'Số lô', '11': 'Ngày SX', '13': 'Ngày đóng gói', '15': 'Hạn tốt nhất', '17': 'Hạn dùng', '21': 'Số seri', '30': 'Số lượng', '37': 'Số lượng', '310': 'Khối lượng tịnh (kg)' };
  function parseGs1(t) {
    const out = {}, re = /\((\d{2,4})\)([^(]*)/g; let m; while ((m = re.exec(t))) { const ai = m[1], v = m[2].trim(); out[ai] = v; }
    return out;
  }
  const fmtDate6 = (s) => (/^\d{6}$/.test(s) ? s.slice(4, 6) + '/' + s.slice(2, 4) + '/20' + s.slice(0, 2) : s);

  function classify(text, formatCode) {
    const raw = String(text == null ? '' : text), t = raw.trim(), fmt = fmtName(formatCode);
    const R = (kind, label, fields, search, summary) => ({ kind, label, fmt, fields: fields || {}, search: String(search == null ? '' : search).trim().slice(0, 120), summary: summary == null ? t.slice(0, 160) : summary });
    if (!t) return R('text', 'Trống', {}, '', '');
    if (/^WIFI:/i.test(t)) { const w = parseWifi(t); return R('wifi', 'Wi-Fi', w, w.ssid, 'Mạng: ' + (w.ssid || '(không tên)') + ' · ' + (w.security === 'nopass' ? 'không mật khẩu' : 'bảo mật ' + w.security)); }
    if (/^BEGIN:VCARD/i.test(t) || /^MECARD:/i.test(t)) { const v = /^MECARD:/i.test(t) ? { name: (/N:([^;]*)/i.exec(t) || [])[1] || '', tel: (/TEL:([^;]*)/i.exec(t) || [])[1] || '', email: (/EMAIL:([^;]*)/i.exec(t) || [])[1] || '', org: '' } : parseVcard(t); return R('vcard', 'Danh bạ', v, v.name, [v.name, v.tel, v.email].filter(Boolean).join(' · ')); }
    if (/^BEGIN:VEVENT|^BEGIN:VCALENDAR/i.test(t)) { const g = (k) => { const m = new RegExp('^' + k + '[^:\\n]*:(.*)$', 'im').exec(t); return m ? m[1].trim() : ''; }; return R('event', 'Sự kiện lịch', { title: g('SUMMARY'), start: g('DTSTART') }, g('SUMMARY'), g('SUMMARY') + ' · ' + g('DTSTART')); }
    if (/^mailto:/i.test(t)) { const m = /^mailto:([^?]*)(?:\?(.*))?$/i.exec(t), q = new URLSearchParams((m && m[2]) || ''); return R('email', 'Email', { to: decodeURIComponent((m && m[1]) || ''), subject: q.get('subject') || '', body: q.get('body') || '' }, '', decodeURIComponent((m && m[1]) || '')); }
    if (/^tel:/i.test(t)) return R('tel', 'Số điện thoại', { tel: t.slice(4) }, t.slice(4).replace(/[^\d+]/g, ''), t.slice(4));
    if (/^smsto?:/i.test(t)) { const m = /^smsto?:([^:]*)(?::([\s\S]*))?$/i.exec(t); return R('sms', 'Tin nhắn SMS', { tel: (m && m[1]) || '', body: (m && m[2]) || '' }, '', ((m && m[1]) || '') + (m && m[2] ? ' — ' + m[2] : '')); }
    if (/^geo:/i.test(t)) { const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(t); return R('geo', 'Vị trí', m ? { lat: +m[1], lng: +m[2] } : {}, '', m ? m[1] + ', ' + m[2] : t); }
    if (/^https?:\/\/\S+$/i.test(t) || /^www\.\S+\.\S+$/i.test(t)) return R('url', 'Liên kết', { url: /^www\./i.test(t) ? 'https://' + t : t }, t, t);
    if (/^\(\d{2,4}\)/.test(t)) { const g = parseGs1(t); if (Object.keys(g).length) { const sum = Object.keys(g).map((k) => (GS1_LABEL[k] || 'AI ' + k) + ': ' + (/^1[135]$|^17$/.test(k) ? fmtDate6(g[k]) : g[k])).join(' · '); return R('gs1', 'Mã GS1', g, g['10'] || g['01'] || '', sum); } }
    if (/^[{\[]/.test(t)) { try { const j = JSON.parse(t); const pick = (o) => { for (const k of ['ma', 'maHang', 'code', 'sku', 'id', 'Mã hàng', 'ma_hang']) if (o && o[k] != null && o[k] !== '') return String(o[k]); return ''; }; const s = Array.isArray(j) ? pick(j[0]) : pick(j); return R('json', 'Dữ liệu JSON', {}, s, t.slice(0, 160)); } catch (e) { /* không phải JSON hợp lệ → văn bản */ } }
    if (/^\d+$/.test(t) && [6, 7, 8, 14, 15].indexOf(formatCode) >= 0 || (/^\d{8}$|^\d{12,14}$/.test(t) && gs1Ok(t) && !is2D(formatCode))) {
      const ok = gs1Ok(t); return R('ean', fmt || 'Mã vạch số', { digits: t, checkOk: ok }, t, t + (ok ? '' : ' (số kiểm tra không khớp)'));
    }
    if (formatCode != null && !is2D(formatCode)) return R('code', 'Mã vạch ' + (fmt || ''), {}, first(t), t);
    return R('text', 'Văn bản', {}, first(t), t.slice(0, 160));
  }

  // gộp các lần quét liên tục: không thêm mã đã có (so theo nội dung), giữ thứ tự
  function addUnique(list, item) { if (list.some((x) => x.text === item.text)) return false; list.push(item); return true; }

  return { FORMATS, fmtName, is2D, gs1Ok, classify, parseWifi, addUnique };
});
