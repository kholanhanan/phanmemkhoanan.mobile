/* LƯU TRỮ CÁ NHÂN — phần nối PC (PC 1.03): giao diện (lt-ui.js) gọi window.LTB; ở PC mọi thứ chạy ở tiến trình chính qua window.ltAPI (preload.js → core/luu-tru.js).
   Điện thoại có bản lt-backend.js riêng (IndexedDB + đồng bộ). Giữ cùng tên hàm giữa 2 bản. */
(function () {
  'use strict';
  var A = window.ltAPI;
  var asBytes = function (f) { return f.arrayBuffer().then(function (b) { return { name: f.name || ('dan-' + Date.now() + '.png'), mime: f.type || '', buf: new Uint8Array(b) }; }); };
  window.LTB = {
    platform: 'pc',
    init: function () { return A.init().then(function (r) { r.canCfg = true; return r; }); },
    ngan: function () { return A.ngan(); },
    list: function (q) { return A.list(q); },
    sendText: function (ng, t) { return A.sendText(ng, t); },
    sendFiles: function (ng, files) { return Promise.all(files.map(asBytes)).then(function (arr) { return A.sendFiles(ng, arr); }); },
    pickFiles: function (ng) { return A.pickSend(ng); },
    edit: function (id, p) { return A.edit(id, p); },
    del: function (id) { return A.del(id); }, restore: function (id) { return A.restore(id); }, purge: function (id) { return A.purge(id); }, emptyTrash: function () { return A.emptyTrash(); },
    nganSave: function (n) { return A.nganSave(n); }, nganDel: function (id) { return A.nganDel(id); },
    fileBlob: function (id) { return A.fileData(id).then(function (r) { return { blob: new Blob([r.buf], { type: r.mime || 'application/octet-stream' }), name: r.name, mime: r.mime }; }); },
    open: function (id) { return A.open(id); }, show: function (id) { return A.show(id); }, saveAs: function (id) { return A.saveAs(id); },
    share: function () { return Promise.reject(new Error('Chỉ dùng trên điện thoại.')); },
    openUrl: function (u) { return A.openUrl(u).catch(function (e) { window.LTUI && window.LTUI.toast(e.message, true); }); },
    status: function () { return A.status(); }, sync: function () { return A.sync(); },
    cfgGet: function () { return A.cfgGet(); }, cfgSet: function (p) { return A.cfgSet(p); }
  };
})();
