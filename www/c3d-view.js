/* MODULE "CONTAINER LOADING 3D" — DỰNG HÌNH 3D bằng Three.js (PC 8.57). Chỉ vẽ + lọc hiển thị; mọi tính toán nằm ở c3d-engine.js.
   Toạ độ engine (mm): x dọc cont (0 = vách đầu, L = cửa), y ngang, z cao.  Toạ độ scene (m): X = x, Y = z (lên trên), Z = y; tâm cont đặt ở gốc.
   Vẽ theo yêu cầu: xoay / zoom / kéo (OrbitControls) · bật tắt từng vách · red line · kích thước cont + thùng · màu theo mặt hàng · lọc theo lớp / nhóm / thứ tự đóng
   · 4 góc nhìn (tổng thể, từ trên, nhìn ngang, từ cửa). Các thùng của mọi nhóm được gộp thành 1 mesh + 1 lưới cạnh → mượt với vài nghìn thùng. */
(function (root) {
  'use strict';
  const T = root.THREE;
  const SC = 0.001; // mm → m
  const fmtM = (mm) => (mm / 1000).toFixed(2) + ' m';

  function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0x4a90d9; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

  function View(host) {
    this.host = host;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'c3d-canvas'; host.appendChild(this.canvas);
    this.labelLayer = document.createElement('div'); this.labelLayer.className = 'c3d-labels'; host.appendChild(this.labelLayer);
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(36, 1, 0.05, 400);
    this.camera.position.set(9, 6, 9);
    this.controls = new T.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false; this.controls.screenSpacePanning = true; this.controls.maxPolarAngle = Math.PI * 0.499 + 0.0001;
    this.controls.addEventListener('change', () => this.invalidate());
    this.scene.add(new T.HemisphereLight(0xffffff, 0x8a97aa, 0.95));
    const dl = new T.DirectionalLight(0xffffff, 0.75); dl.position.set(6, 12, 8); this.scene.add(dl);
    const dl2 = new T.DirectionalLight(0xffffff, 0.35); dl2.position.set(-8, 6, -6); this.scene.add(dl2);
    this.gCont = new T.Group(); this.gCargo = new T.Group(); this.gHL = new T.Group(); this.scene.add(this.gCont, this.gCargo, this.gHL);
    this.labels = []; this.selLabels = [];
    this.plan = null; this.colors = []; this.filter = { tiers: null, groups: null, rows: null, seqMax: null };
    this.opt = { walls: { right: true, left: false, ceil: false, front: true }, redline: true, dims: true, glabels: true, rowlabels: false, wallOpacity: 0.16, usable: true };
    this.visible = []; this.selected = null; this.selRow = null; this.hover = null; this.onPick = null; this.onHover = null; this.onRowPick = null;
    this._dirty = true; this._raf = 0; this._pickReq = null;
    this.light = false;
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(host);
    this.canvas.addEventListener('pointermove', (e) => { this._pickReq = { e, click: false }; this.invalidate(); });
    this.canvas.addEventListener('pointerleave', () => { this.setHover(null); });
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    this.canvas.addEventListener('pointerup', (e) => { if (down && Math.abs(e.clientX - down.x) < 4 && Math.abs(e.clientY - down.y) < 4 && Date.now() - down.t < 500) { this._pickReq = { e, click: true }; this.invalidate(); } down = null; });
    this.ray = new T.Raycaster(); this.mouse = new T.Vector2();
    this.resize();
  }
  const P = View.prototype;

  P.invalidate = function () { if (this._dirty) return; this._dirty = true; this._raf = requestAnimationFrame(() => this.render()); };
  P.resize = function () {
    const w = Math.max(50, this.host.clientWidth), h = Math.max(50, this.host.clientHeight);
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this._dirty = false; this.invalidate();
  };
  P.setLight = function (light) { this.light = !!light; if (this.plan) this.buildContainer(); this.buildCargo(); };

  // ------------------------------------------------------------ container
  function clearGroup(g) { while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose()); } } }
  P.addLabel = function (text, v3, cls, bag) {
    const el = document.createElement('div'); el.className = 'c3d-lab ' + (cls || ''); el.textContent = text; this.labelLayer.appendChild(el);
    const o = { el, pos: v3.clone() }; (bag || this.labels).push(o); return o;
  };
  P.clearLabels = function (bag) { (bag || this.labels).forEach((o) => o.el.remove()); (bag || this.labels).length = 0; };

  P.buildContainer = function () {
    clearGroup(this.gCont); this.clearLabels(this.labels); if (this.cargoLabels) this.clearLabels(this.cargoLabels); this.cargoLabels = []; this.wall = {};
    const p = this.plan; if (!p) return;
    const c = p.container, sp = p.space, L = c.L * SC, W = c.W * SC, H = c.H * SC, light = this.light;
    const lineCol = light ? 0x3b4a63 : 0xb6c4da, wallCol = light ? 0x5a6b86 : 0xa9bddb;
    // sàn + rãnh chữ T
    const floor = new T.Mesh(new T.PlaneGeometry(L, W), new T.MeshLambertMaterial({ color: light ? 0xd8dfe9 : 0x3a4250 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; this.gCont.add(floor);
    const rails = []; for (let z = -W / 2 + 0.1; z < W / 2 - 0.05; z += 0.12) { rails.push(-L / 2, 0.001, z, L / 2, 0.001, z); }
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.Float32BufferAttribute(rails, 3));
    this.gCont.add(new T.LineSegments(rg, new T.LineBasicMaterial({ color: light ? 0xaab5c6 : 0x566073, transparent: true, opacity: 0.8 })));
    // vách
    const mkWall = (name, w, h, pos, rot) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: wallCol, transparent: true, opacity: this.opt.wallOpacity, side: T.DoubleSide, depthWrite: false }));
      m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.visible = !!this.opt.walls[name]; m.renderOrder = 5; this.wall[name] = m; this.gCont.add(m);
    };
    mkWall('right', L, H, [0, H / 2, -W / 2], null);
    mkWall('left', L, H, [0, H / 2, W / 2], null);
    mkWall('ceil', L, W, [0, H, 0], [-Math.PI / 2, 0, 0]);
    mkWall('front', W, H, [-L / 2, H / 2, 0], [0, Math.PI / 2, 0]);
    // khung thép
    const fe = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(L, H, W)), new T.LineBasicMaterial({ color: lineCol })); fe.position.y = H / 2; this.gCont.add(fe);
    // vùng chứa hàng (sau khi trừ khe hở + đến chiều cao cho phép)
    if (this.opt.usable) {
      const uL = sp.Lu * SC, uW = sp.Wu * SC, uH = sp.effH * SC;
      const ue = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(uL, uH, uW)), new T.LineDashedMaterial({ color: 0x22c3a6, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.8 }));
      ue.position.set((sp.x0 + sp.Lu / 2) * SC - L / 2, uH / 2, (sp.y0 + sp.Wu / 2) * SC - W / 2); ue.computeLineDistances(); this.gCont.add(ue);
    }
    // red line (đường tối đa xếp hàng — chừa khoảng thông gió lạnh phía trên)
    this.redGroup = new T.Group();
    const rl = sp.red * SC;
    const rg2 = new T.BufferGeometry(); rg2.setAttribute('position', new T.Float32BufferAttribute([-L / 2, rl, -W / 2, L / 2, rl, -W / 2, L / 2, rl, W / 2, -L / 2, rl, W / 2], 3));
    this.redGroup.add(new T.LineLoop(rg2, new T.LineBasicMaterial({ color: 0xef4444 })));
    const rp = new T.Mesh(new T.PlaneGeometry(L, W), new T.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.07, side: T.DoubleSide, depthWrite: false })); rp.rotation.x = -Math.PI / 2; rp.position.y = rl; this.redGroup.add(rp);
    if (sp.effH < sp.red - 1) {
      const eh = sp.effH * SC, g3 = new T.BufferGeometry(); g3.setAttribute('position', new T.Float32BufferAttribute([-L / 2, eh, -W / 2, L / 2, eh, -W / 2, L / 2, eh, W / 2, -L / 2, eh, W / 2], 3));
      this.redGroup.add(new T.LineLoop(g3, new T.LineBasicMaterial({ color: 0xf59e0b })));
    }
    this.redGroup.visible = !!this.opt.redline; this.gCont.add(this.redGroup);
    this.redLab = this.addLabel('Red line ' + fmtM(sp.red), new T.Vector3(-L / 2, rl, -W / 2), 'red', this.labels); this.redLab.el.style.display = this.opt.redline ? '' : 'none';
    // kích thước cont
    this.dimGroup = new T.Group(); this.dimLabs = [];
    const dl = (a, b, off, txt, cls) => {
      const pts = [a, b]; const geo = new T.BufferGeometry().setFromPoints(pts);
      this.dimGroup.add(new T.Line(geo, new T.LineBasicMaterial({ color: light ? 0x1d5fd1 : 0x7fb0ff })));
      const tk = new T.BufferGeometry().setFromPoints([a.clone().add(off.clone().multiplyScalar(-0.5)), a.clone().add(off.clone().multiplyScalar(0.5)), b.clone().add(off.clone().multiplyScalar(-0.5)), b.clone().add(off.clone().multiplyScalar(0.5))]);
      this.dimGroup.add(new T.LineSegments(tk, new T.LineBasicMaterial({ color: light ? 0x1d5fd1 : 0x7fb0ff })));
      const mid = a.clone().add(b).multiplyScalar(0.5); this.dimLabs.push(this.addLabel(txt, mid, cls || 'dim', this.labels));
    };
    const g = 0.28;
    dl(new T.Vector3(-L / 2, 0, -W / 2 - g), new T.Vector3(L / 2, 0, -W / 2 - g), new T.Vector3(0, 0, 0.12), 'Dài ' + fmtM(c.L));
    dl(new T.Vector3(L / 2 + g, 0, -W / 2), new T.Vector3(L / 2 + g, 0, W / 2), new T.Vector3(0.12, 0, 0), 'Rộng ' + fmtM(c.W));
    dl(new T.Vector3(-L / 2 - g * 0.6, 0, -W / 2 - g * 0.6), new T.Vector3(-L / 2 - g * 0.6, H, -W / 2 - g * 0.6), new T.Vector3(0.12, 0, 0), 'Cao ' + fmtM(c.H));
    this.doorLab = this.addLabel('Cửa ' + fmtM(c.doorW) + ' × ' + fmtM(c.doorH), new T.Vector3(L / 2, 0.02, 0), 'door', this.labels);
    this.gCont.add(this.dimGroup); this.dimGroup.visible = !!this.opt.dims; this.dimLabs.forEach((o) => { o.el.style.display = this.opt.dims ? '' : 'none'; }); this.doorLab.el.style.display = this.opt.dims ? '' : 'none';
    this.cent = new T.Vector3(0, H / 2, 0); this.rad = 0.5 * Math.sqrt(L * L + W * W + H * H);
    this.invalidate();
  };

  // ------------------------------------------------------------ hàng hoá
  P.setPlan = function (plan, colors) {
    const first = !this.plan; // chỉ đặt góc nhìn lần đầu; sau đó giữ nguyên góc người dùng đang xem (đổi cont thì bấm nút góc nhìn)
    this.plan = plan; this.colors = colors || []; this.selected = null;
    if (this.selRow != null && !((plan && plan.rows) || []).some((r) => r.row === this.selRow)) this.selRow = null; // giữ dãy đang chọn qua các lần tính lại
    this.filter = { tiers: null, groups: null, rows: null, seqMax: null };
    this.buildContainer(); this.buildCargo(); if (first) this.setPreset('iso');
  };
  P.updateColors = function (colors) { this.colors = colors || []; this.buildCargo(); };
  P.setFilter = function (f) { this.filter = Object.assign({}, this.filter, f); this.buildCargo(); };

  P.buildCargo = function () {
    clearGroup(this.gCargo); this.clearLabels(this.cargoLabels || (this.cargoLabels = []));
    this.visible = []; const p = this.plan; if (!p) { this.invalidate(); return; }
    const L = p.container.L * SC, W = p.container.W * SC, f = this.filter, colors = this.colors;
    const vis = []; p.boxes.forEach((b, i) => {
      if (f.tiers && !f.tiers.has(b.tier)) return; if (f.rows && !f.rows.has(b.row)) return; if (f.groups && !f.groups.has(b.group)) return; if (f.seqMax != null && b.seq > f.seqMax) return; vis.push(i);
    });
    this.visible = vis; const n = vis.length;
    if (n) {
      const pos = new Float32Array(n * 108), nor = new Float32Array(n * 108), col = new Float32Array(n * 108), ep = new Float32Array(n * 72);
      let o = 0, eo = 0;
      const F = [ // 6 mặt: pháp tuyến + 4 đỉnh (theo vòng)
        [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
        [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]],
        [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
      ];
      const E = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
      vis.forEach((bi) => {
        const b = p.boxes[bi], rgb = hexToRgb(colors[b.group]);
        const x0 = b.x * SC - L / 2, y0 = b.z * SC, z0 = b.y * SC - W / 2, sx = b.dx * SC, sy = b.dz * SC, sz = b.dy * SC; // KHÔNG chừa khe (mặt thùng khít nhau, viền phân tách)
        F.forEach((face) => {
          const nv = face[0], q = face[1];
          [0, 1, 2, 0, 2, 3].forEach((k) => {
            const v = q[k]; pos[o] = x0 + v[0] * sx; pos[o + 1] = y0 + v[1] * sy; pos[o + 2] = z0 + v[2] * sz;
            nor[o] = nv[0]; nor[o + 1] = nv[1]; nor[o + 2] = nv[2]; col[o] = rgb[0]; col[o + 1] = rgb[1]; col[o + 2] = rgb[2]; o += 3;
          });
        });
        E.forEach((e) => { ep[eo++] = x0 + e[0] * sx; ep[eo++] = y0 + e[1] * sy; ep[eo++] = z0 + e[2] * sz; ep[eo++] = x0 + e[3] * sx; ep[eo++] = y0 + e[4] * sy; ep[eo++] = z0 + e[5] * sz; });
      });
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeBoundingSphere(); g.computeBoundingBox();
      this.cargoMesh = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })); this.gCargo.add(this.cargoMesh);
      const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(ep, 3));
      this.gCargo.add(new T.LineSegments(eg, new T.LineBasicMaterial({ color: this.light ? 0x1b2433 : 0x0a0d12, transparent: true, opacity: 0.38 })));
    } else this.cargoMesh = null;
    this.refreshRowLabels(); this.drawGapDims();
    // nhãn nhóm (mã hàng · size · số thùng · kích thước thùng)
    const gb = {};
    vis.forEach((bi) => { const b = p.boxes[bi], gg = gb[b.group] = gb[b.group] || { n: 0, minx: 1e9, maxx: -1e9, miny: 1e9, maxy: -1e9, maxz: 0 }; gg.n++; gg.minx = Math.min(gg.minx, b.x); gg.maxx = Math.max(gg.maxx, b.x + b.dx); gg.miny = Math.min(gg.miny, b.y); gg.maxy = Math.max(gg.maxy, b.y + b.dy); gg.maxz = Math.max(gg.maxz, b.z + b.dz); });
    Object.keys(gb).forEach((k) => {
      const g = p.groups[+k], s = gb[k], sk = g.sku;
      const txt = (sk.code || 'Mặt hàng ' + (+k + 1)) + (sk.size ? ' · ' + sk.size : '') + (sk.date ? ' · ' + sk.date : '') + '\n' + s.n + ' thùng · ' + Math.round(sk.L) + '×' + Math.round(sk.W) + '×' + Math.round(sk.H) + ' mm';
      const v = new T.Vector3(((s.minx + s.maxx) / 2) * SC - L / 2, (s.maxz + 40) * SC, ((s.miny + s.maxy) / 2) * SC - W / 2);
      const o = this.addLabel(txt, v, 'grp', this.cargoLabels); o.el.style.borderColor = this.colors[+k] || '#888'; o.el.style.display = this.opt.glabels ? '' : 'none'; o.group = +k;
    });
    this.setHover(null, true); this.drawSelection();
    this.invalidate();
  };

  // KHOẢNG TRỐNG vẽ thẳng trong khung 3D (theo ô "Kích thước"): mặt hàng cao nhất → trần / red line · dãy cuối → cửa · thùng đầu → vách đầu
  P.drawGapDims = function () {
    const p = this.plan; if (!p || !p.totals || !p.totals.gaps) return; const g = p.totals.gaps, c = p.container, L = c.L * SC, W = c.W * SC, z = W / 2 - 0.02, col = 0xf59e0b;
    const mm = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' m' : Math.round(v) + ' mm');
    const line = (a, b, txt) => { const geo = new T.BufferGeometry().setFromPoints([a, b]); const ln = new T.Line(geo, new T.LineBasicMaterial({ color: col, depthTest: false })); ln.renderOrder = 9; this.gCargo.add(ln); const o = this.addLabel(txt, a.clone().add(b).multiplyScalar(0.5), 'gap', this.cargoLabels); o.el.style.display = this.opt.dims ? '' : 'none'; o.isGap = true; ln.visible = !!this.opt.dims; (this.gapLines || (this.gapLines = [])).push(ln); };
    this.gapLines = []; let xmax = 0, xmin = 1e18; p.boxes.forEach((b) => { xmax = Math.max(xmax, b.x + b.dx); xmin = Math.min(xmin, b.x); });
    const top = g.top * SC, H = c.H * SC;
    line(new T.Vector3(xmax * SC - L / 2 - 0.05, top, z), new T.Vector3(xmax * SC - L / 2 - 0.05, H, z), 'Trần còn ' + mm(g.ceiling) + ' · red line còn ' + mm(g.red));
    if (g.door > 20) line(new T.Vector3(xmax * SC - L / 2, 0.03, z), new T.Vector3(L / 2, 0.03, z), 'Dãy cuối → cửa ' + mm(g.door));
    if (g.front > 30) line(new T.Vector3(-L / 2, 0.03, z), new T.Vector3(xmin * SC - L / 2, 0.03, z), 'Vách đầu ' + mm(g.front));
  };
  // Số DÃY dọc mép sàn: MẶC ĐỊNH ẨN (đỡ rối mắt) — chỉ hiện dãy đang chọn; bật ô "Số dãy" mới hiện hết.
  P.refreshRowLabels = function () {
    const arr = this.cargoLabels || (this.cargoLabels = []);
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].isRow) { arr[i].el.remove(); arr.splice(i, 1); }
    const p = this.plan; if (!p) { this.invalidate(); return; }
    const L = p.container.L * SC, W = p.container.W * SC, vis = {}; this.visible.forEach((bi) => { vis[p.boxes[bi].row] = 1; });
    let list = (p.rows || []).filter((r) => vis[r.row]);
    if (this.opt.rowlabels) { const k = Math.max(1, Math.ceil(list.length / 18)); list = list.filter((r, i) => i % k === 0 || r.row === this.selRow); }
    else list = list.filter((r) => r.row === this.selRow);
    list.forEach((r) => { const o = this.addLabel((r.sample ? '🛃 ' : '') + 'Dãy ' + r.row, new T.Vector3(((r.x0 + r.x1) / 2) * SC - L / 2, 0.02, W / 2 + 0.16), 'row' + (r.sample ? ' samp' : '') + (r.row === this.selRow ? ' sel' : ''), arr); o.isRow = true; });
    this.invalidate();
  };
  P.setSelRow = function (r, silent) { this.selRow = r; this.refreshRowLabels(); this.drawSelection(); if (!silent && this.onRowPick) this.onRowPick(r); this.invalidate(); };

  // ------------------------------------------------------------ chọn / rê chuột
  P.pickAt = function (e) {
    if (!this.cargoMesh) return null;
    const r = this.canvas.getBoundingClientRect(); this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObject(this.cargoMesh, false)[0]; if (!hit) return null;
    const vi = Math.floor(hit.faceIndex / 12); return this.visible[vi] != null ? this.visible[vi] : null;
  };
  P.setHover = function (bi, silent) {
    if (this.hover === bi) return; this.hover = bi; this.canvas.style.cursor = bi != null ? 'pointer' : 'grab';
    if (!silent && this.onHover) this.onHover(bi, this._lastEv); this.drawSelection(); this.invalidate();
  };
  P.select = function (bi) { this.selected = bi; this.selRow = (bi != null && this.plan) ? this.plan.boxes[bi].row : null; this.refreshRowLabels(); this.drawSelection(); if (this.onPick) this.onPick(bi); if (this.onRowPick) this.onRowPick(this.selRow); this.invalidate(); };
  P.drawSelection = function () {
    clearGroup(this.gHL); this.clearLabels(this.selLabels); const p = this.plan; if (!p) return;
    const L = p.container.L * SC, W = p.container.W * SC;
    const mkBox = (bi, col, w) => {
      const b = p.boxes[bi]; if (!b) return; const g = new T.EdgesGeometry(new T.BoxGeometry(b.dx * SC * 1.003, b.dz * SC * 1.003, b.dy * SC * 1.003));
      const m = new T.LineSegments(g, new T.LineBasicMaterial({ color: col })); m.position.set((b.x + b.dx / 2) * SC - L / 2, (b.z + b.dz / 2) * SC, (b.y + b.dy / 2) * SC - W / 2); this.gHL.add(m);
      if (w) { const q = new T.Mesh(new T.BoxGeometry(b.dx * SC * 1.01, b.dz * SC * 1.01, b.dy * SC * 1.01), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })); q.position.copy(m.position); this.gHL.add(q); }
    };
    if (this.selRow != null) { // khung quanh DÃY đang chọn
      let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18, z1 = 0; p.boxes.forEach((b) => { if (b.row === this.selRow) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.dx); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.dy); z1 = Math.max(z1, b.z + b.dz); } });
      if (x1 > x0) { const fr = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry((x1 - x0) * SC * 1.004, z1 * SC * 1.004, (y1 - y0) * SC * 1.004)), new T.LineBasicMaterial({ color: 0x22e0a0 })); fr.position.set(((x0 + x1) / 2) * SC - L / 2, z1 * SC / 2, ((y0 + y1) / 2) * SC - W / 2); this.gHL.add(fr); }
    }
    if (this.hover != null && this.hover !== this.selected) mkBox(this.hover, 0xffffff, false);
    if (this.selected != null) {
      mkBox(this.selected, 0xffd60a, true);
      const b = p.boxes[this.selected]; if (b) {
        const cx = (b.x + b.dx / 2) * SC - L / 2, cy = (b.z + b.dz / 2) * SC, cz = (b.y + b.dy / 2) * SC - W / 2, x0 = b.x * SC - L / 2, x1 = (b.x + b.dx) * SC - L / 2, y1 = (b.z + b.dz) * SC, z0 = b.y * SC - W / 2, z1 = (b.y + b.dy) * SC - W / 2;
        this.addLabel(Math.round(b.dx) + ' mm', new T.Vector3(cx, y1, z0), 'bdim', this.selLabels); this.addLabel(Math.round(b.dy) + ' mm', new T.Vector3(x1, y1, cz), 'bdim', this.selLabels); this.addLabel(Math.round(b.dz) + ' mm', new T.Vector3(x1, cy, z1), 'bdim', this.selLabels);
      }
    }
  };

  // ------------------------------------------------------------ tuỳ chọn hiển thị
  P.setWall = function (name, on) { this.opt.walls[name] = !!on; if (this.wall && this.wall[name]) this.wall[name].visible = !!on; this.invalidate(); };
  P.setWallOpacity = function (v) { this.opt.wallOpacity = v; if (this.wall) Object.keys(this.wall).forEach((k) => { this.wall[k].material.opacity = v; }); this.invalidate(); };
  P.setOpt = function (k, on) {
    this.opt[k] = !!on;
    if (k === 'redline') { if (this.redGroup) this.redGroup.visible = !!on; if (this.redLab) this.redLab.el.style.display = on ? '' : 'none'; }
    if (k === 'dims') { (this.cargoLabels || []).forEach((o) => { if (o.isGap) o.el.style.display = on ? '' : 'none'; }); (this.gapLines || []).forEach((l) => { l.visible = !!on; }); if (this.dimGroup) this.dimGroup.visible = !!on; (this.dimLabs || []).forEach((o) => { o.el.style.display = on ? '' : 'none'; }); if (this.doorLab) this.doorLab.el.style.display = on ? '' : 'none'; }
    if (k === 'glabels') (this.cargoLabels || []).forEach((o) => { if (!o.isRow) o.el.style.display = on ? '' : 'none'; });
    if (k === 'rowlabels') this.refreshRowLabels();
    if (k === 'usable') { this.buildContainer(); this.buildCargo(); }
    this.invalidate();
  };

  // ------------------------------------------------------------ góc nhìn
  P.setPreset = function (name, keepWalls) {
    if (!this.plan) return;
    const R = this.rad, c = this.cent.clone(), cam = this.camera, cc = this.plan.container, Lm = cc.L * SC, Wm = cc.W * SC, Hm = cc.H * SC;
    const tanV = Math.tan(cam.fov * Math.PI / 360), asp = Math.max(0.6, cam.aspect), fit = (w, h) => Math.max(h / 2 / tanV, w / 2 / (tanV * asp));
    let dir, dist;
    if (name === 'top') { dir = new T.Vector3(0, 1, 0.001); dist = fit(Lm * 1.08, Wm * 1.2) + Hm / 2; }
    else if (name === 'side') { dir = new T.Vector3(0, 0.1, 1); dist = fit(Lm * 1.1, Hm * 1.35) + Wm / 2; }
    else if (name === 'door') { dir = new T.Vector3(1, 0.08, 0); dist = fit(Wm * 1.35, Hm * 1.45) + Lm / 2; }
    else { dir = new T.Vector3(0.78, 0.62, 0.62); dist = Math.max(R * 1.6, fit(1.42 * (Lm * 0.78 + Wm * 0.62), 1.45 * (Hm * 0.85 + 0.53 * (Lm * 0.62 + Wm * 0.78)))); }
    dir.normalize(); if (name !== 'top') c.y -= R * 0.09; // đẩy hình lên cao hơn 1 chút cho khỏi bị thanh "Thứ tự đóng" che
    cam.position.copy(c).add(dir.multiplyScalar(dist)); this.controls.target.copy(c); cam.lookAt(c); this.controls.update();
    if (!keepWalls) { // tự ẩn vách che tầm nhìn
      const w = { iso: { right: true, left: false, ceil: false, front: true }, top: { right: true, left: true, ceil: false, front: true }, side: { right: true, left: false, ceil: false, front: true }, door: { right: true, left: true, ceil: false, front: true } }[name];
      if (w) Object.keys(w).forEach((k) => this.setWall(k, w[k]));
      if (this.onWalls) this.onWalls(Object.assign({}, this.opt.walls));
    }
    this.invalidate();
  };

  // ------------------------------------------------------------ vẽ
  P.render = function () {
    this._dirty = false;
    if (this._pickReq) {
      const rq = this._pickReq; this._pickReq = null; this._lastEv = rq.e; const bi = this.pickAt(rq.e);
      if (rq.click) this.select(bi); else this.setHover(bi);
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new T.Vector3();
    const place = (o) => {
      v.copy(o.pos).project(this.camera);
      if (v.z > 1 || v.z < -1) { o.el.style.visibility = 'hidden'; return; }
      o.el.style.visibility = ''; o.el.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,-50%)';
    };
    this.labels.forEach(place); this.selLabels.forEach(place);
    // nhãn mặt hàng: dịch xuống nếu đè lên nhau (nhìn từ cửa / từ trên các nhóm thẳng hàng nên dễ chồng)
    const gl = (this.cargoLabels || []).filter((o) => o.el.style.display !== 'none' && !o.isRow); (this.cargoLabels || []).filter((o) => o.isRow && o.el.style.display !== 'none').forEach(place); gl.forEach(place);
    const rects = []; gl.map((o) => { v.copy(o.pos).project(this.camera); return { o, y: -v.y, vis: v.z > -1 && v.z < 1 }; }).sort((p, q) => p.y - q.y).forEach((it) => {
      if (!it.vis) return; const el = it.o.el, w2 = el.offsetWidth, h2 = el.offsetHeight; v.copy(it.o.pos).project(this.camera);
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h, n = 0;
      while (n++ < 14 && rects.some((r) => Math.abs(r.x - x) < (r.w + w2) / 2 && Math.abs(r.y - y) < (r.h + h2) / 2)) y += h2 + 2;
      rects.push({ x, y, w: w2, h: h2 }); el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
    });
  };
  P.screenshot = function (bg) {
    this.renderer.render(this.scene, this.camera); const src = this.canvas, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.fillStyle = bg || '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0); return c.toDataURL('image/png');
  };
  P.dispose = function () { cancelAnimationFrame(this._raf); this._ro.disconnect(); this.renderer.dispose(); };

  root.C3DView = { create: (host) => new View(host) };
})(typeof window !== 'undefined' ? window : this);
