/* lan-guard.js — ĐT 1.16: CHỈ CHO PHÉP KẾT NỐI HTTP (không mã hóa) TỚI MÁY TÍNH TRONG MẠNG NỘI BỘ.
   Lý do: capacitor.config.json bật cleartext + allowMixedContent (bắt buộc để "Lưu trữ cá nhân" gọi máy chủ LAN của PC theo http://192.168.x.x:cổng,
   vì app chạy ở nguồn https). Android không cho giới hạn cleartext theo dải IP, nên giới hạn ở đây: địa chỉ do người dùng nhập phải là mạng nội bộ
   (10.x · 172.16–31.x · 192.168.x · 169.254.x · 127.x · localhost · tên *.local / *.lan / *.home.arpa · tên máy 1 nhãn như "may-tinh" · IPv6 ::1 / fe80 / fc / fd).
   Địa chỉ Internet công khai, có tài khoản trong địa chỉ (user:pass@), hoặc giao thức khác http / https → từ chối. Dùng cả lúc LƯU và lúc GỌI (cấu hình cũ đã lưu cũng bị chặn). */
(function (root) {
  'use strict';
  const PORT = 47821;
  function isPrivateHost(host) {
    let h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h) return false;
    let m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
      const a = +m[1], b = +m[2]; if ([+m[1], +m[2], +m[3], +m[4]].some((x) => x > 255)) return false;
      return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    if (h.indexOf(':') >= 0) return h === '::1' || /^fe[89ab][0-9a-f]:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h);   // IPv6 nội bộ
    if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return false;                                                   // dạng số / hex của IPv4 (vd 3232235777) — không đoán
    if (h === 'localhost' || /\.(local|lan|home\.arpa|internal)$/.test(h)) return /^[a-z0-9.-]+$/.test(h);
    return h.indexOf('.') < 0 && /^[a-z0-9-]+$/.test(h);                                                              // tên máy 1 nhãn (NetBIOS / mDNS)
  }
  // raw: chữ người dùng nhập. Trả { ok:true, url } (đã chuẩn hóa, có cổng, không "/" cuối) | { ok:true, url:'' } nếu để trống | { ok:false, error }
  function normalize(raw) {
    let v = String(raw == null ? '' : raw).trim(); if (!v) return { ok: true, url: '' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'http://' + v;
    let u; try { u = new URL(v); } catch (e) { return { ok: false, error: 'Địa chỉ không hợp lệ. Ví dụ: 192.168.1.50' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Chỉ dùng địa chỉ http hoặc https.' };
    if (u.username || u.password) return { ok: false, error: 'Không nhập tài khoản / mật khẩu vào địa chỉ.' };
    if (!isPrivateHost(u.hostname)) return { ok: false, error: 'Chỉ nhận địa chỉ trong mạng nội bộ (vd 192.168.x.x, 10.x.x.x). Địa chỉ Internet không được dùng cho kết nối LAN không mã hóa.' };
    return { ok: true, url: u.protocol + '//' + (u.hostname.indexOf(':') >= 0 ? '[' + u.hostname.replace(/^\[|\]$/g, '') + ']' : u.hostname) + ':' + (u.port || PORT) };
  }
  const isAllowedUrl = (url) => { const r = normalize(url); return r.ok && !!r.url; };
  const api = { isPrivateHost, normalize, isAllowedUrl, PORT };
  root.LanGuard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
