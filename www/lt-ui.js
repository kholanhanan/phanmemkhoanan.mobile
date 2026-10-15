/* LƯU TRỮ CÁ NHÂN (PC 1.03 / ĐT 1.02) — giao diện chat, CHUNG cho PC và điện thoại (chép y nguyên sang ban-dien-thoai/www/).
   Mọi truy cập dữ liệu đi qua window.LTB (lt-backend.js — mỗi nền tảng 1 bản: PC gọi ltAPI → tiến trình chính; điện thoại dùng IndexedDB + đồng bộ).
   Giao diện KHÔNG biết dữ liệu nằm ở đâu. Sửa giao diện ở app/html/ rồi chép sang www/. */
(function () {
  'use strict';
  var B = window.LTB, $ = function (id) { return document.getElementById(id); };
  var PHONE = B.platform === 'phone';
  var IC = {
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1 .5 7.97V16.5"/><path d="M8 18h9.5"/>',
    cloudok: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1 .5 7.97"/><path d="M9.5 15.5l2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V20a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.97 18.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 14a1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 7.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 3.14l.06.06A1.7 1.7 0 0 0 8.96 3.5 1.7 1.7 0 0 0 10 1.95V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V8.9a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 14z"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
    clip: '<path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.5 17.4a1.7 1.7 0 0 1-2.4-2.4L14.6 7.5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    pin: '<path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3z"/><path d="M12 14.5V20"/>',
    edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 6.5l3 3"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.2"/>',
    move: '<path d="M4 7h11M11 3l4 4-4 4M20 17H9M13 13l-4 4 4 4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    share: '<circle cx="6" cy="12" r="2.2"/><circle cx="17.5" cy="6" r="2.2"/><circle cx="17.5" cy="18" r="2.2"/><path d="M8 11l7.5-4M8 13l7.5 4"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    dots: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 5v4h4"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.5-3.5M4 5v4h4M4 13a8 8 0 0 0 14.5 3.5M20 19v-4h-4"/>',
    inbox: '<path d="M4 13l2-7h12l2 7v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>'
  };
  var svg = function (n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (IC[n] || '') + '</svg>'; };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var fmtT = function (ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  var dayKey = function (ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var dayLabel = function (ts) {
    var k = dayKey(ts), now = Date.now();
    if (k === dayKey(now)) return 'Hôm nay'; if (k === dayKey(now - 86400000)) return 'Hôm qua';
    var d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  };
  var fmtDT = function (ts) { var d = new Date(ts); return fmtT(ts) + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
  var fmtSize = function (n) { n = +n || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; };
  var URL_RX = /(https?:\/\/[^\s<>"']+)/gi;
  var linkify = function (t) { return esc(t).replace(URL_RX, function (u) { var m = /[.,;:!?)\]]+$/.exec(u), tail = m ? m[0] : '', core = m ? u.slice(0, -tail.length) : u; return '<a data-url="' + core + '">' + core + '</a>' + tail; }); };
  var extOf = function (n) { var m = /\.([A-Za-z0-9]{1,6})$/.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; };
  var kindOf = function (it) {
    var e = extOf(it.fn);
    if (it.t === 'image' || /^(png|jpe?g|gif|webp|bmp)$/.test(e)) return ['img', 'IMG'];
    if (e === 'pdf') return ['pdf', 'PDF']; if (/^(xlsx?|xlsm|csv)$/.test(e)) return ['xls', 'XLS']; if (/^docx?$/.test(e)) return ['doc', 'DOC']; if (/^pptx?$/.test(e)) return ['ppt', 'PPT'];
    if (/^(zip|rar|7z|gz|tar)$/.test(e)) return ['zip', 'ZIP']; return ['oth', (e || 'FILE').toUpperCase().slice(0, 4)];
  };
  var hueOf = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };

  // ------------------------------------------------------------------ trạng thái
  var S = { ngan: [], ng: 'mydocs', filter: 'all', q: '', all: false, items: [], counts: { all: 0, image: 0, file: 0, link: 0, pin: 0 }, hasMore: false, trash: 0,
    rev: -1, status: null, chat: false, ngq: '', busy: false, canCfg: false, thumbs: {}, loadSeq: 0, hl: '' };
  var app = $('app');

  function toast(msg, err) {
    var t = document.createElement('div'); t.className = 'lt-toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 4800 : 2400);
  }
  var fail = function (e) { toast((e && e.message) ? String(e.message).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'Có lỗi xảy ra.', true); };
  var cur = function () { for (var i = 0; i < S.ngan.length; i++) if (S.ngan[i].id === S.ng) return S.ngan[i]; return null; };

  // ------------------------------------------------------------------ khung
  function build() {
    app.innerHTML =
      '<div class="lt-app" id="ltApp">' +
      '<aside class="lt-side">' +
        '<div class="lt-sidehead"><div class="lt-logo">' + svg('cloud') + '</div><div class="lt-title"><b>Lưu trữ cá nhân</b><small id="ltSync">…</small></div>' +
          '<button class="lt-iconbtn" id="ltSyncBtn" title="Đồng bộ ngay">' + svg('sync') + '</button><button class="lt-iconbtn" id="ltGear" title="Cài đặt đồng bộ">' + svg('gear') + '</button></div>' +
        '<div class="lt-search">' + svg('search') + '<input id="ltNgq" type="text" placeholder="Tìm ngăn hoặc tin nhắn" autocomplete="off"></div>' +
        '<div class="lt-nglist" id="ltNgList"></div>' +
        '<div class="lt-sidefoot"><button class="lt-chipbtn" id="ltNewNg">' + svg('plus') + ' Ngăn mới</button><button class="lt-chipbtn" id="ltTrashBtn">' + svg('trash') + ' <span id="ltTrashTxt">Thùng rác</span></button></div>' +
      '</aside>' +
      '<section class="lt-main" id="ltMain">' +
        '<div class="lt-chead"><button class="lt-iconbtn lt-back" id="ltBack" title="Quay lại">' + svg('back') + '</button><div class="lt-av" id="ltCav"></div>' +
          '<div class="lt-cname"><b id="ltCname"></b><small id="ltCsub"></small></div><button class="lt-iconbtn" id="ltCmenu" title="Tùy chọn ngăn">' + svg('dots') + '</button></div>' +
        '<div class="lt-tabs" id="ltTabs"></div>' +
        '<div class="lt-scroll" id="ltScroll"></div>' +
        '<div id="ltCompWrap"></div>' +
        '<div class="lt-drop">Thả file vào đây để lưu</div>' +
      '</section></div>';
  }
  function compHtml() {
    if (S.filter === 'trash') return '<div class="lt-readonly">Đang xem Thùng rác — khôi phục tin về ngăn hoặc xóa hẳn.</div>';
    return '<div class="lt-comp"><div class="lt-ctool">' +
      '<button class="lt-iconbtn" id="ltAttach" title="Đính kèm file">' + svg('clip') + '</button>' +
      '<button class="lt-iconbtn" id="ltPickImg" title="Gửi ảnh">' + svg('image') + '</button>' +
      (PHONE ? '<button class="lt-iconbtn" id="ltCam" title="Chụp ảnh">' + svg('camera') + '</button>' : '') +
      '<button class="lt-iconbtn" id="ltEmoji" title="Biểu tượng cảm xúc">' + svg('smile') + '</button>' +
      '<span class="hint">' + (PHONE ? '' : 'Enter gửi · Shift+Enter xuống dòng · dán ảnh Ctrl+V · kéo thả file') + '</span></div>' +
      '<div class="lt-cbox"><textarea id="ltInput" rows="1" placeholder="Nhập tin nhắn để lưu…"></textarea><button class="lt-send" id="ltSend" title="Gửi" disabled>' + svg('send') + '</button></div></div>' +
      (PHONE ? '<input type="file" id="ltFile" multiple hidden><input type="file" id="ltFileImg" accept="image/*" multiple hidden><input type="file" id="ltFileCam" accept="image/*" capture="environment" hidden>' : '');
  }

  // ------------------------------------------------------------------ danh sách ngăn
  function avatar(n) {
    if (n.id === 'mydocs') return '<div class="lt-av cloud">' + svg('cloud') + '</div>';
    var txt = n.icon || (n.name || '?').trim().charAt(0).toUpperCase();
    return '<div class="lt-av" style="--h:' + hueOf(n.id) + '">' + esc(txt) + '</div>';
  }
  function renderNg() {
    var q = S.ngq.trim(), nq = noAcc(q), h = '';
    if (q.length >= 2) h += '<button class="lt-ng" data-gsearch="1"><div class="lt-av cloud">' + svg('search') + '</div><div class="lt-ngbody"><div class="lt-ngtop"><b>Tìm “' + esc(q) + '”</b></div><div class="lt-ngprev">trong tất cả các ngăn</div></div></button>';
    S.ngan.forEach(function (n) {
      if (nq && noAcc(n.name).indexOf(nq) < 0) return;
      h += '<button class="lt-ng' + (n.id === S.ng && S.filter !== 'trash' && !S.all ? ' on' : '') + '" data-ng="' + esc(n.id) + '">' + avatar(n) +
        '<div class="lt-ngbody"><div class="lt-ngtop"><b>' + esc(n.name) + '</b><span>' + (n.lastTs ? esc(dayLabel(n.lastTs) === 'Hôm nay' ? fmtT(n.lastTs) : dayLabel(n.lastTs)) : '') + '</span></div>' +
        '<div class="lt-ngprev">' + (n.lastText ? esc(n.lastText.replace(/\s+/g, ' ').slice(0, 60)) : (n.count ? '' : 'Chưa có gì — gửi tin đầu tiên')) + '</div></div></button>';
    });
    $('ltNgList').innerHTML = h || '<div class="lt-empty" style="margin:24px 10px">Không có ngăn nào khớp.</div>';
    var tt = $('ltTrashTxt'); tt.textContent = 'Thùng rác' + (S.trash ? ' (' + S.trash + ')' : '');
    $('ltTrashBtn').classList.toggle('on', S.filter === 'trash');
  }
  function noAcc(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }

  // ------------------------------------------------------------------ khung chat
  function renderHead() {
    var n = cur() || { id: 'mydocs', name: 'My Documents' }, trash = S.filter === 'trash', gs = S.all && S.q;
    $('ltCav').outerHTML = '<div class="lt-av' + (n.id === 'mydocs' || trash || gs ? ' cloud' : '') + '" id="ltCav"' + (n.id !== 'mydocs' && !trash && !gs ? ' style="--h:' + hueOf(n.id) + '"' : '') + '>' +
      (trash ? svg('trash') : gs ? svg('search') : n.id === 'mydocs' ? svg('cloud') : esc(n.icon || n.name.charAt(0).toUpperCase())) + '</div>';
    $('ltCname').textContent = trash ? 'Thùng rác' : gs ? 'Kết quả tìm “' + S.q + '”' : n.name;
    var st = S.status, sub;
    if (trash) sub = S.items.length + ' mục đã xóa';
    else if (gs) sub = S.items.length + ' kết quả trong tất cả ngăn';
    else sub = (S.counts.all || 0) + ' mục' + (st && st.pend ? ' · ' + st.pend + ' chờ đồng bộ' : ' · đã đồng bộ');
    $('ltCsub').textContent = sub;
    $('ltCmenu').style.display = trash || gs ? (trash && S.items.length ? '' : 'none') : '';
  }
  function renderTabs() {
    var c = S.counts || {}, h = '';
    if (S.filter === 'trash') { $('ltTabs').innerHTML = '<span class="lt-tab on">Thùng rác</span><span class="grow lt-tab"></span>' + (S.items.length ? '<button class="lt-tab" id="ltEmptyTrash" style="color:var(--lt-red)">Xóa hết thùng rác</button>' : '') + '<button class="lt-tab" data-tab="all">← Quay lại ngăn</button>'; return; }
    [['all', 'Tất cả'], ['image', 'Ảnh'], ['file', 'File'], ['link', 'Link'], ['pin', 'Đã ghim']].forEach(function (t) {
      h += '<button class="lt-tab' + (S.filter === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + (c[t[0]] ? '<em>' + c[t[0]] + '</em>' : '') + '</button>';
    });
    h += '<span class="grow"></span><div class="lt-find">' + svg('search') + '<input id="ltFind" type="text" placeholder="Tìm trong ngăn" value="' + esc(S.q) + '" autocomplete="off"><label title="Tìm trong tất cả các ngăn"><input type="checkbox" id="ltFindAll"' + (S.all ? ' checked' : '') + '> tất cả ngăn</label></div>';
    var keepFocus = document.activeElement && document.activeElement.id === 'ltFind';
    $('ltTabs').innerHTML = h;
    if (keepFocus) { var f = $('ltFind'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }
  function rowHtml(it, showNg) {
    var trash = S.filter === 'trash', k = kindOf(it), body = '';
    if (it.t === 'image') {
      var th = it.th || S.thumbs[it.id];
      body = (th ? '<img class="lt-img" data-view="' + it.id + '" src="' + th + '" alt="' + esc(it.fn) + '">' :
        (it.local ? '<div class="lt-imgwait" data-view="' + it.id + '" data-lazy="' + it.id + '">' + svg('image') + '</div>' : '<div class="lt-imgwait" data-view="' + it.id + '">' + svg('image') + '<br>' + (it.big ? 'Ảnh lớn — tải khi cùng mạng với PC' : 'Chạm để tải ảnh') + '</div>')) +
        '<div class="lt-meta" style="justify-content:flex-start;margin-top:4px">' + esc(it.fn) + ' · ' + fmtSize(it.fs) + '</div>';
      if (it.tx) body += '<div class="lt-txt" style="margin-top:4px">' + linkify(it.tx) + '</div>';
    } else if (it.t === 'file') {
      var state = it.local ? (it.pend ? 'Chờ đồng bộ' : 'Đã đồng bộ') : (it.big ? 'File lớn — tải khi cùng mạng với PC' : 'Chưa tải về máy này');
      body = '<div class="lt-file" data-view="' + it.id + '"><div class="lt-fic" data-k="' + k[0] + '">' + esc(k[1]) + '</div><div class="lt-finfo"><b>' + esc(it.fn) + '</b><small>' + fmtSize(it.fs) + ' · ' + state + '</small></div>' +
        '<div class="lt-facts">' + (PHONE ? '<button data-act="share" data-id="' + it.id + '" title="Chia sẻ">' + svg('share') + '</button><button data-act="save" data-id="' + it.id + '" title="Lưu vào máy">' + svg('down') + '</button>'
          : '<button data-act="show" data-id="' + it.id + '" title="Mở thư mục chứa file">' + svg('folder') + '</button><button data-act="save" data-id="' + it.id + '" title="Lưu ra nơi khác">' + svg('down') + '</button>') + '</div></div>';
      if (it.tx) body += '<div class="lt-txt" style="margin-top:6px">' + linkify(it.tx) + '</div>';
    } else body = '<div class="lt-txt">' + linkify(it.tx) + '</div>';
    var ng = '', meta = '';
    if (showNg) { var c = S.ngan.filter(function (n) { return n.id === it.ng; })[0]; ng = '<div class="lt-meta" style="justify-content:flex-start;margin:0 0 3px;font-weight:600">' + svg('folder') + (c ? esc(c.name) : 'Ngăn đã xóa') + '</div>'; }
    meta = '<div class="lt-meta">' + (it.pn ? '<span class="pin">' + svg('pin') + '</span>' : '') + (it.up > it.ts + 1500 ? '<span>đã sửa</span>' : '') + '<span>' + esc(fmtT(it.ts)) + '</span><span title="' + (it.pend ? 'Chờ đồng bộ' : 'Đã đồng bộ') + '">' + svg(it.pend ? 'clock' : 'cloudok') + '</span></div>';
    var tags = it.tg && it.tg.length ? '<div class="lt-tags">' + it.tg.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>' : '';
    var tools = trash ? '<button data-act="restore" data-id="' + it.id + '" title="Khôi phục">' + svg('restore') + '</button><button class="warn" data-act="purge" data-id="' + it.id + '" title="Xóa hẳn">' + svg('x') + '</button>' :
      '<button data-act="pin" data-id="' + it.id + '" title="' + (it.pn ? 'Bỏ ghim' : 'Ghim') + '">' + svg('pin') + '</button>' +
      '<button data-act="edit" data-id="' + it.id + '" title="' + (it.t === 'text' ? 'Sửa' : 'Ghi chú') + '">' + svg('edit') + '</button>' +
      '<button data-act="tag" data-id="' + it.id + '" title="Gắn nhãn">' + svg('tag') + '</button>' +
      (it.t === 'text' ? '<button data-act="copy" data-id="' + it.id + '" title="Sao chép">' + svg('copy') + '</button>' : '') +
      (S.ngan.length > 1 ? '<button data-act="move" data-id="' + it.id + '" title="Chuyển sang ngăn khác">' + svg('move') + '</button>' : '') +
      '<button class="warn" data-act="del" data-id="' + it.id + '" title="Xóa (vào thùng rác)">' + svg('trash') + '</button>';
    return '<div class="lt-row' + (S.hl === it.id ? ' hl' : '') + '" data-row="' + it.id + '"><div class="lt-tools">' + tools + '</div><div class="lt-bub">' + ng + body + tags + meta + '</div></div>';
  }
  function renderMsgs(keep) {
    var sc = $('ltScroll'), prevH = sc.scrollHeight, prevT = sc.scrollTop, nearEnd = prevH - sc.clientHeight - prevT < 120;
    var h = '', last = '', showNg = !!(S.all && S.q) || S.filter === 'trash';
    if (S.hasMore) h += '<div class="lt-more"><button id="ltMoreBtn">Xem tin cũ hơn</button></div>';
    S.items.forEach(function (it) {
      var dk = dayKey(it.ts); if (dk !== last) { last = dk; h += '<div class="lt-day"><span>' + esc(dayLabel(it.ts)) + '</span></div>'; }
      h += rowHtml(it, showNg);
    });
    if (!S.items.length) {
      var msg = S.filter === 'trash' ? 'Thùng rác trống.' : S.q ? 'Không tìm thấy kết quả nào.' : S.filter === 'all' ? 'Chưa có gì trong ngăn này.<br>Gõ tin nhắn, dán ảnh hoặc kéo file vào để lưu.' : 'Không có mục nào ở nhóm này.';
      h = '<div class="lt-empty">' + svg('inbox') + '<div>' + msg + '</div></div>';
    }
    sc.innerHTML = h;
    if (keep === 'bottom' || (keep === 'auto' && nearEnd)) sc.scrollTop = sc.scrollHeight;
    else if (keep === 'older') sc.scrollTop = sc.scrollHeight - prevH + prevT;
    else sc.scrollTop = prevT;
    lazyThumbs();
  }
  var lazyBusy = 0;
  function lazyThumbs() {
    var els = document.querySelectorAll('[data-lazy]'); 
    Array.prototype.slice.call(els, 0, 24).forEach(function (el) {
      var id = el.getAttribute('data-lazy'); el.removeAttribute('data-lazy');
      if (S.thumbs[id] || lazyBusy > 4) return; lazyBusy++;
      B.fileBlob(id).then(function (f) {
        var r = new FileReader(); r.onload = function () { S.thumbs[id] = r.result; var img = document.createElement('img'); img.className = 'lt-img'; img.setAttribute('data-view', id); img.src = r.result; if (el.parentNode) el.parentNode.replaceChild(img, el); };
        r.readAsDataURL(f.blob);
      }).catch(function () { /* để hiện ô chờ */ }).then(function () { lazyBusy--; });
    });
  }
  function renderStatus() {
    var st = S.status; if (!st) return;
    var txt = 'Đồng bộ…';
    if (PHONE) txt = st.busy ? 'Đang đồng bộ…' : st.err ? 'Chưa đồng bộ được' : st.mode === 'lan' ? 'Đã đồng bộ qua mạng LAN' : st.mode === 'drive' ? 'Đã đồng bộ qua Drive' : st.pend ? st.pend + ' chờ đồng bộ' : 'Sẵn sàng';
    else {
      var d = st.drive || {}, l = st.lan || {}, a = [];
      a.push(d.busy ? 'Drive: đang đồng bộ…' : !d.on ? 'Drive: tắt' : !d.ready ? 'Drive: chưa cài' : d.ok === false ? 'Drive: lỗi' : d.last ? 'Drive: ' + fmtT(d.last) : 'Drive: chưa chạy');
      a.push(l.up ? 'LAN: bật' : l.on ? 'LAN: lỗi' : 'LAN: tắt');
      txt = a.join(' · ');
    }
    $('ltSync').textContent = txt;
    S.status = st;
  }

  // ------------------------------------------------------------------ nạp dữ liệu
  function query(extra) {
    var o = { ng: S.ng, filter: S.filter, q: S.q, all: S.all, limit: 200 }; for (var k in extra) o[k] = extra[k]; return o;
  }
  function reload(keep) {
    var my = ++S.loadSeq;
    return Promise.all([B.list(query({})), B.ngan()]).then(function (r) {
      if (my !== S.loadSeq) return;
      S.items = r[0].items; S.hasMore = r[0].hasMore; S.trash = r[0].trash || 0; if (r[0].counts) S.counts = r[0].counts; S.ngan = r[1];
      if (!cur() && S.filter !== 'trash') S.ng = 'mydocs';
      renderNg(); renderHead(); renderTabs(); renderMsgs(keep || 'auto');
    }).catch(fail);
  }
  function older() {
    if (!S.items.length) return;
    B.list(query({ before: S.items[0].ts })).then(function (r) {
      S.items = r.items.concat(S.items); S.hasMore = r.hasMore; 
      // r.items chỉ là trang cũ hơn; nối thêm rồi vẽ lại giữ vị trí cuộn
      renderMsgs('older');
    }).catch(fail);
  }
  function poll() {
    if (document.hidden) return;
    B.status().then(function (st) { var ch = st.rev !== S.rev; S.status = st; if (ch && S.rev !== -1) { S.rev = st.rev; reload('auto'); } else S.rev = st.rev; renderStatus(); }).catch(function () { /* bỏ qua */ });
  }

  // ------------------------------------------------------------------ gửi
  function updSend() { var t = $('ltInput'), b = $('ltSend'); if (t && b) b.disabled = !t.value.trim(); }
  function grow() { var t = $('ltInput'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; }
  function sendText() {
    var t = $('ltInput'); if (!t || !t.value.trim() || S.busy) return;
    var v = t.value; S.busy = true;
    B.sendText(S.ng, v).then(function () { t.value = ''; grow(); updSend(); S.busy = false; reload('bottom'); }).catch(function (e) { S.busy = false; fail(e); });
  }
  function sendFiles(files) {
    files = Array.prototype.slice.call(files || []); if (!files.length || S.filter === 'trash') return;
    toast('Đang lưu ' + files.length + ' file…');
    B.sendFiles(S.ng, files).then(function () { reload('bottom'); toast('Đã lưu ' + files.length + ' file'); }).catch(fail);
  }
  function attach() {
    if (PHONE) { $('ltFile').click(); return; }
    B.pickFiles(S.ng).then(function (r) { if (r && r.length) { reload('bottom'); toast('Đã lưu ' + r.length + ' file'); } }).catch(fail);
  }

  // ------------------------------------------------------------------ hộp thoại
  function dialog(html, onMount) {
    var m = document.createElement('div'); m.className = 'lt-mask'; m.innerHTML = '<div class="lt-dlg">' + html + '</div>'; document.body.appendChild(m);
    var close = function () { m.remove(); };
    m.addEventListener('mousedown', function (e) { if (e.target === m) close(); });
    var first = m.querySelector('input[type=text], textarea'); if (first) setTimeout(function () { first.focus(); }, 30);
    if (onMount) onMount(m, close);
    return close;
  }
  var NG_ICONS = ['📁', '📄', '🧾', '📷', '💼', '🏠', '💡', '⭐', '❤️', '📌', '🛒', '✈️', '🎓', '💰', '🔧', '📚'];
  function nganDialog(n) {
    var icon = n ? n.icon : '';
    dialog('<h3>' + (n ? 'Đổi tên ngăn' : 'Ngăn mới') + '</h3><p class="sub">Ngăn giúp chia việc: Hợp đồng, Hóa đơn, Việc cá nhân…</p><label>Tên ngăn</label><input type="text" id="dgName" maxlength="60" value="' + esc(n ? n.name : '') + '">' +
      '<label>Biểu tượng (không bắt buộc)</label><div class="lt-emoji" id="dgIcons">' + NG_ICONS.map(function (e) { return '<button type="button" data-e="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
      '<div class="lt-dlgbtn"><button class="lt-btn" id="dgNo">Hủy</button><button class="lt-btn pri" id="dgOk">Lưu</button></div>', function (m, close) {
      m.querySelector('#dgIcons').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; icon = icon === b.dataset.e ? '' : b.dataset.e; Array.prototype.forEach.call(m.querySelectorAll('#dgIcons button'), function (x) { x.style.outline = x.dataset.e === icon ? '2px solid var(--lt-blue)' : ''; }); });
      if (icon) Array.prototype.forEach.call(m.querySelectorAll('#dgIcons button'), function (x) { x.style.outline = x.dataset.e === icon ? '2px solid var(--lt-blue)' : ''; });
      m.querySelector('#dgNo').onclick = close;
      var go = function () { var v = m.querySelector('#dgName').value.trim(); if (!v) { toast('Nhập tên ngăn.', true); return; } close();
        B.nganSave({ id: n ? n.id : '', name: v, icon: icon }).then(function (l) { S.ngan = l; if (!n) { var nn = l[l.length - 1]; if (nn) selectNg(nn.id); } reload('auto'); }).catch(fail); };
      m.querySelector('#dgOk').onclick = go; m.querySelector('#dgName').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
  }
  function confirmDlg(title, text, okTxt, danger, fn) {
    dialog('<h3>' + esc(title) + '</h3><p class="sub">' + esc(text) + '</p><div class="lt-dlgbtn"><button class="lt-btn" id="dgNo">Hủy</button><button class="lt-btn ' + (danger ? 'dan' : 'pri') + '" id="dgOk">' + esc(okTxt) + '</button></div>', function (m, close) {
      m.querySelector('#dgNo').onclick = close; m.querySelector('#dgOk').onclick = function () { close(); fn(); };
    });
  }
  function editDlg(it) {
    dialog('<h3>' + (it.t === 'text' ? 'Sửa tin nhắn' : 'Ghi chú cho file') + '</h3><div class="lt-edit"><textarea id="dgTx">' + esc(it.tx) + '</textarea></div><div class="lt-dlgbtn"><button class="lt-btn" id="dgNo">Hủy</button><button class="lt-btn pri" id="dgOk">Lưu</button></div>', function (m, close) {
      m.querySelector('#dgNo').onclick = close;
      m.querySelector('#dgOk').onclick = function () { var v = m.querySelector('#dgTx').value; if (it.t === 'text' && !v.trim()) { toast('Tin nhắn không được để trống.', true); return; } close(); B.edit(it.id, { tx: v }).then(function () { reload('keep'); }).catch(fail); };
    });
  }
  function tagDlg(it) {
    dialog('<h3>Gắn nhãn</h3><p class="sub">Ngăn cách bằng dấu phẩy, ví dụ: hợp đồng, 2026. Tìm kiếm cũng tìm theo nhãn.</p><input type="text" id="dgTag" value="' + esc((it.tg || []).join(', ')) + '"><div class="lt-dlgbtn"><button class="lt-btn" id="dgNo">Hủy</button><button class="lt-btn pri" id="dgOk">Lưu</button></div>', function (m, close) {
      m.querySelector('#dgNo').onclick = close;
      var go = function () { var tg = m.querySelector('#dgTag').value.split(',').map(function (x) { return x.replace(/^#/, '').trim(); }).filter(Boolean); close(); B.edit(it.id, { tg: tg }).then(function () { reload('keep'); }).catch(fail); };
      m.querySelector('#dgOk').onclick = go; m.querySelector('#dgTag').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
  }
  function moveDlg(it) {
    dialog('<h3>Chuyển sang ngăn khác</h3><select id="dgNg">' + S.ngan.filter(function (n) { return n.id !== it.ng; }).map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>'; }).join('') + '</select><div class="lt-dlgbtn"><button class="lt-btn" id="dgNo">Hủy</button><button class="lt-btn pri" id="dgOk">Chuyển</button></div>', function (m, close) {
      m.querySelector('#dgNo').onclick = close;
      m.querySelector('#dgOk').onclick = function () { var v = m.querySelector('#dgNg').value; close(); B.edit(it.id, { ng: v }).then(function () { reload('keep'); toast('Đã chuyển.'); }).catch(fail); };
    });
  }

  // ------------------------------------------------------------------ xem trước
  var viewUrl = '';
  function viewer(it) {
    var k = kindOf(it), canPdf = !PHONE && k[0] === 'pdf', isImg = it.t === 'image' || k[0] === 'img';
    var m = document.createElement('div'); m.className = 'lt-view';
    m.innerHTML = '<div class="lt-vbar"><b>' + esc(it.fn) + ' <span style="opacity:.6;font-weight:400">· ' + fmtSize(it.fs) + '</span></b>' +
      (PHONE ? '<button data-v="share">' + svg('share') + ' Chia sẻ</button><button data-v="save">' + svg('down') + ' Lưu</button>' :
        '<button data-v="open">' + svg('open') + ' Mở bằng ứng dụng</button><button data-v="show">' + svg('folder') + ' Thư mục</button><button data-v="save">' + svg('down') + ' Lưu ra…</button>') +
      '<button data-v="x" title="Đóng">' + svg('x') + '</button></div><div class="lt-vbody" id="ltVBody"><div class="lt-nopv">Đang tải…</div></div>';
    document.body.appendChild(m);
    var done = function () { if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; } m.remove(); document.removeEventListener('keydown', esc1); };
    var esc1 = function (e) { if (e.key === 'Escape') done(); }; document.addEventListener('keydown', esc1);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) { if (e.target === m || e.target.id === 'ltVBody') done(); return; }
      var v = b.dataset.v; if (v === 'x') done();
      else if (v === 'open') B.open(it.id).catch(fail); else if (v === 'show') B.show(it.id).catch(fail);
      else if (v === 'save') B.saveAs(it.id).then(function (r) { if (r) toast(typeof r === 'string' ? 'Đã lưu: ' + r : 'Đã lưu file.'); }).catch(fail);
      else if (v === 'share') B.share(it.id).catch(function (e) { if (!/cancel/i.test(String(e && e.message))) fail(e); });
    });
    var body = m.querySelector('#ltVBody');
    var noPv = function (msg) { body.innerHTML = '<div class="lt-nopv"><div class="lt-fic" data-k="' + k[0] + '" style="margin:0 auto 10px">' + esc(k[1]) + '</div>' + esc(msg) + '</div>'; };
    B.fileBlob(it.id).then(function (f) {
      if (!f || !f.blob) { noPv('Không đọc được file.'); return; }
      if (isImg) { viewUrl = URL.createObjectURL(f.blob); body.innerHTML = '<img alt="">'; body.firstChild.src = viewUrl; }
      else if (canPdf) { viewUrl = URL.createObjectURL(new Blob([f.blob], { type: 'application/pdf' })); body.innerHTML = '<iframe title="PDF"></iframe>'; body.firstChild.src = viewUrl; }
      else noPv(PHONE ? 'Không xem trực tiếp được loại file này — dùng Chia sẻ hoặc Lưu để mở bằng ứng dụng khác.' : 'Loại file này không xem trước được — dùng “Mở bằng ứng dụng”.');
    }).catch(function (e) { noPv(e && e.message ? e.message : 'Không mở được file.'); });
  }

  // ------------------------------------------------------------------ cài đặt đồng bộ
  function settings() {
    if (PHONE) return B.settingsDialog({ dialog: dialog, esc: esc, toast: toast, fail: fail, svg: svg, fmtDT: fmtDT, reload: function () { reload('keep'); poll(); } });
    B.cfgGet().then(function (c) {
      var lan = c.lan || {}, drv = c.drive || {}, st = c.status || {}, ds = st.drive || {}, ls = st.lan || {};
      var ro = !S.canCfg ? ' disabled' : '';
      dialog('<h3>Đồng bộ với điện thoại</h3><p class="sub">Dữ liệu luôn lưu đầy đủ trên máy này. Hai đường đồng bộ có thể bật cùng lúc — điện thoại tự chọn LAN khi ở cùng wifi, ra ngoài thì dùng Drive.' +
        (S.canCfg ? '' : ' <b>Chỉ tài khoản Quản lý trở lên được đổi cài đặt.</b>') + '</p>' +
        '<div class="lt-sec"><h4>' + svg('share') + ' Mạng LAN (cùng wifi)</h4><div class="sw"><input type="checkbox" id="cfLan"' + (lan.on ? ' checked' : '') + ro + '><label for="cfLan" style="margin:0">Cho điện thoại kết nối trực tiếp tới máy này</label></div>' +
        '<label>Cổng</label><input type="number" id="cfPort" min="1024" max="65535" value="' + esc(lan.port || 47821) + '"' + ro + '>' +
        '<p><span class="lt-dot ' + (ls.up ? 'ok' : ls.err ? 'err' : '') + '"></span> ' + (ls.up ? 'Đang chạy. Nhập một trong các địa chỉ này vào điện thoại (Lưu trữ › Cài đặt):' : ls.err ? esc(ls.err) : 'Đang tắt.') + '</p>' +
        (ls.up ? '<div>' + (ls.urls || []).map(function (u) { return '<span class="lt-url">' + esc(u) + '</span>'; }).join('') + '</div>' : '') +
        '<p>Lần đầu bật, Windows có thể hỏi về tường lửa — chọn <b>Cho phép</b> (mạng riêng / Private). Nên đặt IP cố định cho máy này. Dữ liệu chạy trong mạng nội bộ, không mã hóa HTTPS.</p></div>' +
        '<div class="lt-sec"><h4>' + svg('cloud') + ' Google Drive (mọi nơi có Internet)</h4><div class="sw"><input type="checkbox" id="cfDrv"' + (drv.on ? ' checked' : '') + ro + '><label for="cfDrv" style="margin:0">Đồng bộ tự động qua Drive</label></div>' +
        '<label>Chu kỳ</label><select id="cfMin"' + ro + '>' + [[0, 'Chỉ khi bấm Đồng bộ ngay'], [0.25, '15 giây'], [1, '1 phút'], [5, '5 phút'], [10, '10 phút'], [30, '30 phút'], [60, '1 giờ']].map(function (o) { return '<option value="' + o[0] + '"' + (+drv.min === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<p><span class="lt-dot ' + (ds.busy ? 'busy' : ds.ok === false ? 'err' : ds.ok ? 'ok' : '') + '"></span> ' + (!ds.ready ? 'Chưa cài Web App / PC_TOKEN (Cài đặt › Đồng bộ điện thoại).' : ds.busy ? 'Đang đồng bộ…' : ds.ok === false ? 'Lỗi: ' + esc(ds.err) : ds.last ? 'Lần gần nhất: ' + fmtDT(ds.last) : 'Chưa đồng bộ lần nào.') + '</p>' +
        '<p>File lớn hơn <b>' + (c.maxDriveMB || 15) + ' MB</b> không đi qua Drive (Apps Script giới hạn) — vẫn lưu trên PC và tải được qua LAN. Cần dán lại Code.gs vào Apps Script (có hướng dẫn trong README).</p>' +
        '<div class="lt-dlgbtn" style="margin-top:8px"><button class="lt-btn" id="cfSync">' + svg('sync') + ' Đồng bộ Drive ngay</button></div></div>' +
        '<div class="lt-dlgbtn"><button class="lt-btn" id="cfNo">Đóng</button>' + (S.canCfg ? '<button class="lt-btn pri" id="cfOk">Lưu cài đặt</button>' : '') + '</div>', function (m, close) {
        m.querySelector('#cfNo').onclick = close;
        m.querySelector('#cfSync').onclick = function () { var b = this; b.disabled = true; B.sync().then(function (r) { b.disabled = false; if (r && r.ok) toast('Đã đồng bộ Drive.'); else toast((r && r.error) || 'Không đồng bộ được.', true); poll(); }).catch(function (e) { b.disabled = false; fail(e); }); };
        var ok = m.querySelector('#cfOk');
        if (ok) ok.onclick = function () {
          B.cfgSet({ lan: { on: m.querySelector('#cfLan').checked, port: +m.querySelector('#cfPort').value }, drive: { on: m.querySelector('#cfDrv').checked, min: +m.querySelector('#cfMin').value } })
            .then(function () { close(); toast('Đã lưu cài đặt.'); poll(); }).catch(fail);
        };
      });
    }).catch(fail);
  }

  // ------------------------------------------------------------------ menu nhỏ
  function ctxMenu(x, y, items) {
    var old = document.querySelector('.lt-ctx'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'lt-ctx';
    m.innerHTML = items.map(function (i) { return i === '-' ? '<hr>' : '<button data-i="' + i.k + '"' + (i.warn ? ' style="color:var(--lt-red)"' : '') + '>' + svg(i.ic) + esc(i.t) + '</button>'; }).join('');
    document.body.appendChild(m);
    var w = m.offsetWidth, h = m.offsetHeight; m.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 6)) + 'px'; m.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 6)) + 'px';
    var off = function (e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(function () { document.addEventListener('mousedown', off, true); }, 0);
    m.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; m.remove(); document.removeEventListener('mousedown', off, true); var it = items.filter(function (i) { return i !== '-' && i.k === b.dataset.i; })[0]; if (it) it.fn(); });
  }

  // ------------------------------------------------------------------ chọn ngăn / lọc
  function selectNg(id) { S.ng = id; S.filter = 'all'; S.q = ''; S.all = false; S.chat = true; $('ltApp').classList.add('chat'); reload('bottom').then(function () { var i = $('ltInput'); if (i && !PHONE) i.focus(); }); mountComposer(); }
  function mountComposer() { $('ltCompWrap').innerHTML = compHtml(); updSend(); grow(); }
  var itemOf = function (id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; };

  // ------------------------------------------------------------------ sự kiện
  function bind() {
    var ngl = $('ltNgList');
    ngl.addEventListener('click', function (e) {
      var g = e.target.closest('[data-gsearch]'); if (g) { S.q = S.ngq.trim(); S.all = true; S.filter = 'all'; S.chat = true; $('ltApp').classList.add('chat'); mountComposer(); reload('bottom'); return; }
      var b = e.target.closest('[data-ng]'); if (b) selectNg(b.dataset.ng);
    });
    $('ltNgq').addEventListener('input', function () { S.ngq = this.value; renderNg(); });
    $('ltNewNg').onclick = function () { nganDialog(null); };
    $('ltTrashBtn').onclick = function () { S.filter = 'trash'; S.q = ''; S.all = false; S.chat = true; $('ltApp').classList.add('chat'); mountComposer(); reload('bottom'); };
    $('ltBack').onclick = function () { S.chat = false; $('ltApp').classList.remove('chat'); if (S.filter === 'trash' || S.all) { S.filter = 'all'; S.q = ''; S.all = false; mountComposer(); reload('keep'); } };
    $('ltGear').onclick = settings;
    $('ltSyncBtn').onclick = function () { var b = this; b.disabled = true; toast('Đang đồng bộ…'); B.sync().then(function (r) { b.disabled = false; if (r && r.ok === false) toast(r.error || 'Chưa đồng bộ được.', true); else toast('Đã đồng bộ.'); poll(); reload('keep'); }).catch(function (e) { b.disabled = false; fail(e); }); };
    $('ltCmenu').onclick = function (e) {
      if (S.filter === 'trash') return;
      var n = cur(), r = this.getBoundingClientRect(), items = [{ k: 'ren', t: 'Đổi tên / biểu tượng ngăn', ic: 'edit', fn: function () { nganDialog(n); } }];
      if (n && n.id !== 'mydocs') items.push('-', { k: 'del', t: 'Xóa ngăn (tin vào thùng rác)', ic: 'trash', warn: 1, fn: function () { confirmDlg('Xóa ngăn “' + n.name + '”?', 'Mọi tin trong ngăn chuyển vào Thùng rác, có thể khôi phục (về ngăn My Documents).', 'Xóa ngăn', true, function () { B.nganDel(n.id).then(function (l) { S.ngan = l; S.ng = 'mydocs'; reload('bottom'); }).catch(fail); }); } });
      ctxMenu(r.right - 200, r.bottom + 4, items);
    };
    var tabs = $('ltTabs');
    tabs.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]'); if (t) { S.filter = t.dataset.tab; if (S.filter !== 'all' || true) { mountComposer(); } reload('bottom'); return; }
      if (e.target.closest('#ltEmptyTrash')) confirmDlg('Xóa hết thùng rác?', 'Không khôi phục được nữa (file cũng bị xóa khỏi máy này).', 'Xóa hết', true, function () { B.emptyTrash().then(function (n) { toast('Đã xóa ' + n + ' mục.'); reload('top'); }).catch(fail); });
    });
    var findT = null;
    tabs.addEventListener('input', function (e) {
      if (e.target.id === 'ltFind') { var v = e.target.value; clearTimeout(findT); findT = setTimeout(function () { S.q = v; reload('bottom'); }, 250); }
    });
    tabs.addEventListener('change', function (e) { if (e.target.id === 'ltFindAll') { S.all = e.target.checked; if (S.q) reload('bottom'); } });
    var sc = $('ltScroll');
    sc.addEventListener('click', function (e) {
      if (e.target.closest('#ltMoreBtn')) { older(); return; }
      var a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); B.openUrl(a.getAttribute('data-url')); return; }
      var act = e.target.closest('[data-act]');
      if (act) { e.stopPropagation(); return doAct(act.dataset.act, act.dataset.id, act); }
      var v = e.target.closest('[data-view]'); if (v && S.filter !== 'trash') { var it = itemOf(v.getAttribute('data-view')); if (it) viewer(it); return; }
      var row = e.target.closest('.lt-row'); // điện thoại: chạm vào tin để hiện nút thao tác
      if (row && PHONE) { var was = row.classList.contains('touch'); Array.prototype.forEach.call(sc.querySelectorAll('.lt-row.touch'), function (r) { r.classList.remove('touch'); }); if (!was) row.classList.add('touch'); }
    });
    sc.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.lt-row'); if (!row || S.filter === 'trash') return; var it = itemOf(row.dataset.row); if (!it) return; e.preventDefault();
      var items = [{ k: 'pin', t: it.pn ? 'Bỏ ghim' : 'Ghim', ic: 'pin', fn: function () { doAct('pin', it.id); } }, { k: 'edit', t: it.t === 'text' ? 'Sửa' : 'Ghi chú', ic: 'edit', fn: function () { doAct('edit', it.id); } }, { k: 'tag', t: 'Gắn nhãn', ic: 'tag', fn: function () { doAct('tag', it.id); } }];
      if (it.t === 'text') items.push({ k: 'copy', t: 'Sao chép', ic: 'copy', fn: function () { doAct('copy', it.id); } });
      if (it.t !== 'text') items.push({ k: 'save', t: 'Lưu ra…', ic: 'down', fn: function () { doAct('save', it.id); } });
      items.push('-', { k: 'del', t: 'Xóa', ic: 'trash', warn: 1, fn: function () { doAct('del', it.id); } }); ctxMenu(e.clientX, e.clientY, items);
    });
    var main = $('ltMain'), dragN = 0;
    main.addEventListener('dragenter', function (e) { if (S.filter === 'trash' || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return; dragN++; main.classList.add('dragging'); });
    main.addEventListener('dragleave', function () { dragN = Math.max(0, dragN - 1); if (!dragN) main.classList.remove('dragging'); });
    main.addEventListener('dragover', function (e) { e.preventDefault(); });
    main.addEventListener('drop', function (e) { e.preventDefault(); dragN = 0; main.classList.remove('dragging'); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) sendFiles(e.dataTransfer.files); });
    document.addEventListener('paste', function (e) {
      if (S.filter === 'trash' || document.querySelector('.lt-mask')) return;
      var fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); sendFiles(fs); }
    });
    $('ltCompWrap').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'ltSend') sendText(); else if (b.id === 'ltAttach') attach();
      else if (b.id === 'ltPickImg') { if (PHONE) $('ltFileImg').click(); else attach(); } else if (b.id === 'ltCam') $('ltFileCam').click();
      else if (b.id === 'ltEmoji') { var r = b.getBoundingClientRect(); ctxMenuEmoji(r.left, r.top); }
    });
    $('ltCompWrap').addEventListener('input', function (e) { if (e.target.id === 'ltInput') { updSend(); grow(); } });
    $('ltCompWrap').addEventListener('keydown', function (e) { if (e.target.id === 'ltInput' && e.key === 'Enter' && !e.shiftKey && !PHONE && !e.isComposing) { e.preventDefault(); sendText(); } });
    $('ltCompWrap').addEventListener('change', function (e) { if (e.target.type === 'file') { sendFiles(e.target.files); e.target.value = ''; } });
    window.addEventListener('message', function (ev) { var d = ev.data; if (d && (d.type === 'kla-refresh' || d.type === 'kla-auth-refresh')) { poll(); reload('keep'); } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    setInterval(poll, 3000);
  }
  function ctxMenuEmoji(x, y) {
    var old = document.querySelector('.lt-ctx'); if (old) old.remove();
    var E = ['😀', '😂', '😍', '👍', '🙏', '🎉', '❤️', '🔥', '✅', '❌', '⭐', '📌', '📎', '💡', '⚠️', '📞', '📍', '🕐', '💰', '📦', '🚚', '❄️', '🐟', '🦐'];
    var m = document.createElement('div'); m.className = 'lt-ctx'; m.style.padding = '8px'; m.innerHTML = '<div class="lt-emoji" style="grid-template-columns:repeat(6,1fr)">' + E.map(function (e) { return '<button type="button" data-e="' + e + '" style="justify-content:center;padding:6px">' + e + '</button>'; }).join('') + '</div>';
    document.body.appendChild(m); m.style.left = Math.max(6, x) + 'px'; m.style.top = Math.max(6, y - m.offsetHeight - 6) + 'px';
    var off = function (e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(function () { document.addEventListener('mousedown', off, true); }, 0);
    m.addEventListener('click', function (e) { var b = e.target.closest('[data-e]'); if (!b) return; var t = $('ltInput'); if (t) { var p = t.selectionStart || t.value.length; t.value = t.value.slice(0, p) + b.dataset.e + t.value.slice(p); t.focus(); t.setSelectionRange(p + b.dataset.e.length, p + b.dataset.e.length); updSend(); grow(); } m.remove(); document.removeEventListener('mousedown', off, true); });
  }
  function doAct(act, id, el) {
    var it = itemOf(id); if (!it) return;
    if (act === 'pin') B.edit(id, { pn: it.pn ? 0 : 1 }).then(function () { reload('keep'); }).catch(fail);
    else if (act === 'edit') editDlg(it); else if (act === 'tag') tagDlg(it); else if (act === 'move') moveDlg(it);
    else if (act === 'copy') { try { navigator.clipboard.writeText(it.tx).then(function () { toast('Đã sao chép.'); }, function () { toast('Không sao chép được.', true); }); } catch (e) { toast('Không sao chép được.', true); } }
    else if (act === 'del') B.del(id).then(function () { reload('keep'); toast('Đã chuyển vào Thùng rác.'); }).catch(fail);
    else if (act === 'restore') B.restore(id).then(function () { reload('keep'); toast('Đã khôi phục.'); }).catch(fail);
    else if (act === 'purge') confirmDlg('Xóa hẳn mục này?', 'Không khôi phục được nữa.', 'Xóa hẳn', true, function () { B.purge(id).then(function () { reload('keep'); }).catch(fail); });
    else if (act === 'show') B.show(id).catch(fail);
    else if (act === 'save') B.saveAs(id).then(function (r) { if (r) toast(typeof r === 'string' ? 'Đã lưu: ' + r : 'Đã lưu file.'); }).catch(fail);
    else if (act === 'share') B.share(id).catch(function (e) { if (!/cancel/i.test(String(e && e.message))) fail(e); });
  }

  // ------------------------------------------------------------------ khởi động
  build(); bind();
  B.init().then(function (r) {
    S.ngan = r.ngan; S.status = r.status; S.canCfg = !!r.canCfg; S.rev = r.status ? r.status.rev : 0;
    if (PHONE) { S.chat = false; } else { S.chat = true; $('ltApp').classList.add('chat'); }
    mountComposer(); renderStatus(); return reload('bottom');
  }).catch(function (e) { app.innerHTML = '<div class="lt-empty" style="margin-top:80px">' + esc(e && e.message || 'Không mở được Lưu trữ cá nhân.') + '</div>'; });
  window.LTUI = { reload: function (k) { return reload(k || 'keep'); }, poll: poll, toast: toast };
})();
