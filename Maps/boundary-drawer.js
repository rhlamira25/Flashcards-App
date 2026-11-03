/* boundary-drawer.js (v2) — student-side drawing for "draw boundary and classify".
   Needs boundary-core.js. The <svg> holds the base map (paths with data-unit and public land sample points data-s).
   Never receives the reference answer. */
(function (root) {
  const C = root.BoundaryCore, NS = 'http://www.w3.org/2000/svg';
  const MSG = {
    short: 'الخط قصير جدًا. ارسم الحدّ الفاصل كاملًا.',
    'self-cross': 'الخط يقطع نفسه. امسح الجزء المتقاطع بالممحاة أو تراجع ثم أكمل.',
    'no-split': 'الخط لا يقسم الخريطة إلى منطقتين. مدّه عبر الخريطة.',
    parts: 'الخط مقطوع إلى أجزاء. صِل الجزأين برسم خط من نهاية أحدهما إلى نهاية الآخر.'
  };
  const copy = segs => segs.map(s => s.map(p => p.slice()));

  class BoundaryDrawer {
    /* opts: { frame, grabPx:40, joinPx:22, eraserPx:22, minMovePx:3, smooth:.35, pinchTrimMs:150, onChange(state) } */
    constructor(svg, opts) {
      this.svg = svg; this.f = opts.frame;
      this.o = Object.assign({ grabPx: 40, joinPx: 22, eraserPx: 22, minMovePx: 3, smooth: 0.35, pinchTrimMs: 150, onChange() {} }, opts);
      this.W = this.f.x1 - this.f.x0; this.H = this.f.y1 - this.f.y0;
      this.vb = { x: this.f.x0, y: this.f.y0, w: this.W, h: this.H };
      this.segs = []; this.hist = []; this.mode = 'draw'; this.stage = 'draw';
      this.fills = { A: null, B: null }; this.colour = null; this.ptrs = new Map(); this.stroke = null; this.erasing = null;
      this.units = {}; this.samples = {};
      svg.querySelectorAll('path[data-unit]').forEach(p => {
        const u = p.dataset.unit; this.units[u] = p;
        if (p.dataset.s) this.samples[u] = p.dataset.s.split(' ').map(s => s.split(',').map(Number));
      });
      svg.style.touchAction = 'none'; svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
      this.pl = el('path', { fill: 'none', stroke: '#1e1e1e', 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
      this.endsG = el('g', { 'pointer-events': 'none' });
      this.erc = el('circle', { fill: 'rgba(30,30,30,.12)', stroke: '#1e1e1e', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none', display: 'none' });
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(e => svg.addEventListener(e, ev => this['_' + e](ev)));
      svg.addEventListener('wheel', ev => { ev.preventDefault(); this.zoomAt(this._map(ev), ev.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
      this._apply();
    }
    get line() { return this.segs.length === 1 ? this.segs[0] : [].concat(...this.segs); }
    _total() { return this.segs.reduce((n, s) => n + s.length, 0); }
    _map(ev) { const p = this.svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const m = p.matrixTransform(this.svg.getScreenCTM().inverse()); return [m.x, m.y]; }
    _px() { return this.vb.w / this.svg.getBoundingClientRect().width; }

    _apply() {
      const v = this.vb; this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
      this.pl.setAttribute('d', this.segs.map(s => 'M' + s.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L')).join(''));
      this.endsG.textContent = '';
      if (this.stage === 'draw') for (const s of this.segs) for (const p of s.length > 1 ? [s[0], s[s.length - 1]] : [s[0]]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', 7 * this._px());
        c.setAttribute('fill', '#1e1e1e'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 2.5); c.setAttribute('vector-effect', 'non-scaling-stroke');
        this.endsG.appendChild(c);
      }
    }
    _emit(extra) { this.o.onChange(Object.assign({ points: this._total(), canUndo: this.hist.length > 0, stage: this.stage, mode: this.mode, parts: this.segs.length }, extra)); }

    zoomAt(pt, factor) {
      const v = this.vb, w = Math.min(this.W, Math.max(this.W / 12, v.w * factor)), k = w / v.w;
      v.x = pt[0] - (pt[0] - v.x) * k; v.y = pt[1] - (pt[1] - v.y) * k; v.w = w; v.h *= k; this._clamp(); this._apply();
    }
    pan(dx, dy) { this.vb.x -= dx; this.vb.y -= dy; this._clamp(); this._apply(); }
    zoomReset() { this.vb = { x: this.f.x0, y: this.f.y0, w: this.W, h: this.H }; this._apply(); }
    _clamp() { const v = this.vb; v.x = Math.max(this.f.x0, Math.min(this.f.x1 - v.w, v.x)); v.y = Math.max(this.f.y0, Math.min(this.f.y1 - v.h, v.y)); }

    // ---- gestures: every drawing or erasing gesture is one undo step
    _begin() { this._snap = copy(this.segs); this._changed = false; }
    _finish() {
      if (this._snap && this._changed) { this.hist.push(this._snap); if (this.hist.length > 60) this.hist.shift(); }
      this._snap = null; this.stroke = null; this.erasing = null; this.erc.setAttribute('display', 'none'); this._apply(); this._emit();
    }
    _nearEnd(p) {                                       // nearest end of ANY piece, within grabPx screen pixels
      let best = null, bd = this.o.grabPx * this._px();
      this.segs.forEach((s, si) => [[0, true], [s.length - 1, false]].forEach(([i, atStart]) => {
        const d = C.dist(p, s[i]); if (d < bd) { bd = d; best = { si, atStart }; }
      }));
      return best;
    }

    _pointerdown(ev) {
      this.svg.setPointerCapture(ev.pointerId); this.ptrs.set(ev.pointerId, { cx: ev.clientX, cy: ev.clientY });
      if (this.ptrs.size >= 2) { this._cancelGesture(true); this._pinchStart(); return; }
      if (this.stage === 'fill') { this._tapFill(this._map(ev)); return; }
      if (this.stage !== 'draw') return;
      const p = this._map(ev);
      if (this.mode === 'erase') { this._begin(); this._startErase(); this._eraseAt(p, null); return; }
      if (this.mode !== 'draw') return;
      if (!this.segs.length) {                           // very first point
        this._begin(); this.segs.push([[p[0], p[1], performance.now()]]); this._changed = true;
        this.stroke = { si: 0, start: 1, filt: p.slice(), lastPx: [ev.clientX, ev.clientY] }; this._apply(); return;
      }
      const hit = this._nearEnd(p);
      if (!hit) { this._emit({ hint: 'ابدأ من إحدى نهايتي الخط (النقطة الداكنة) لمتابعة الرسم.' }); return; }
      this._begin(); const s = this.segs[hit.si]; if (hit.atStart) s.reverse();   // continue from either end: work on the last point
      this.stroke = { si: hit.si, start: s.length, filt: s[s.length - 1].slice(0, 2), lastPx: [ev.clientX, ev.clientY] };
    }
    _pointermove(ev) {
      const rec = this.ptrs.get(ev.pointerId); if (!rec) return;
      const px = ev.clientX - rec.cx, py = ev.clientY - rec.cy; rec.cx = ev.clientX; rec.cy = ev.clientY;
      if (this.ptrs.size >= 2) { this._pinchMove(); return; }
      if (this.stage === 'draw' && this.mode === 'pan') { const s = this._px(); this.pan(px * s, py * s); return; }
      if (this.erasing) { this._eraseAt(this._map(ev), this.erasing.last); return; }
      if (!this.stroke) return;
      const seg = this.segs[this.stroke.si], evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const e of (evs.length ? evs : [ev])) {
        if (Math.hypot(e.clientX - this.stroke.lastPx[0], e.clientY - this.stroke.lastPx[1]) < this.o.minMovePx) continue;
        this.stroke.lastPx = [e.clientX, e.clientY];
        const p = this._map(e), q = this.stroke.filt, a = this.o.smooth;       // smoothing restarts at the stopping point
        q[0] += (p[0] - q[0]) * a; q[1] += (p[1] - q[1]) * a;
        const last = seg[seg.length - 1];
        if (C.dist(q, last) > this._px() * this.o.minMovePx) { seg.push([q[0], q[1], performance.now()]); this._changed = true; }
      }
      this._apply();
    }
    _pointerup(ev) {
      this.ptrs.delete(ev.pointerId);
      if (this.ptrs.size === 0) { this._endGesture(); this.pinch = null; } else if (this.ptrs.size === 1) this.pinch = null;
    }
    _pointercancel(ev) { this._pointerup(ev); }

    _endGesture() {
      if (this.stroke) this._joinActive();
      if (this.stroke || this.erasing || this._snap) this._finish();
    }
    _cancelGesture(becamePinch) {                          // a second finger cancels the stroke safely
      if (this.stroke && becamePinch) {
        const seg = this.segs[this.stroke.si], cut = performance.now() - this.o.pinchTrimMs; let n = seg.length;
        while (n > this.stroke.start && n > 1 && seg[n - 1][2] > cut) n--;
        seg.length = n; if (n <= 1 && this.stroke.start <= 1) this.segs.splice(this.stroke.si, 1);
        this._changed = this._changed || false;
      }
      if (this.erasing || this.stroke) this._finish();
    }
    _joinActive() {                                        // snap to the end of another piece if released near it
      const si = this.stroke.si, a = this.segs[si]; if (!a) return;
      const tol = this.o.joinPx * this._px(), end = a[a.length - 1];
      for (let j = 0; j < this.segs.length; j++) {
        if (j === si) continue; const b = this.segs[j];
        if (C.dist(end, b[0]) < tol) { a.pop(); a.push(...b); this.segs.splice(j, 1); this._changed = true; return; }
        if (C.dist(end, b[b.length - 1]) < tol) { a.pop(); a.push(...b.slice().reverse()); this.segs.splice(j, 1); this._changed = true; return; }
      }
    }

    // ---- eraser: removes only the part under the finger; the rest stays (the line may split into pieces)
    _startErase() {
      const r = this.o.eraserPx * this._px(), sp = Math.max(r / 2, 0.5);
      this.segs = this.segs.map(s => this._resample(s, sp)); this.erasing = { r, last: null };
    }
    _resample(s, sp) {
      const out = [s[0]];
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i], n = Math.max(1, Math.ceil(C.dist(a, b) / sp));
        for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, 0]);
      }
      return out;
    }
    _eraseAt(p, last) {
      const r = this.erasing.r, steps = last ? Math.max(1, Math.ceil(C.dist(p, last) / (r / 2))) : 1;
      for (let k = 1; k <= steps; k++) {
        const q = last ? [last[0] + (p[0] - last[0]) * k / steps, last[1] + (p[1] - last[1]) * k / steps] : p, out = [];
        for (const s of this.segs) {
          let cur = [];
          for (const pt of s) { if (C.dist(pt, q) < r) { if (cur.length > 1) out.push(cur); cur = []; this._changed = true; } else cur.push(pt); }
          if (cur.length > 1) out.push(cur);
        }
        this.segs = out;
      }
      this.erasing.last = p; this.erc.setAttribute('cx', p[0]); this.erc.setAttribute('cy', p[1]); this.erc.setAttribute('r', r); this.erc.setAttribute('display', 'block'); this._apply();
    }

    _pinchStart() { const r = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(r[0].cx - r[1].cx, r[0].cy - r[1].cy), mx: (r[0].cx + r[1].cx) / 2, my: (r[0].cy + r[1].cy) / 2 }; }
    _pinchMove() {
      if (!this.pinch) this._pinchStart();
      const r = [...this.ptrs.values()], d = Math.hypot(r[0].cx - r[1].cx, r[0].cy - r[1].cy), mx = (r[0].cx + r[1].cx) / 2, my = (r[0].cy + r[1].cy) / 2, s = this._px();
      this.pan((mx - this.pinch.mx) * s, (my - this.pinch.my) * s);
      if (d > 0 && this.pinch.d > 0) this.zoomAt(this._map({ clientX: mx, clientY: my }), this.pinch.d / d);
      this.pinch = { d, mx, my };
    }

    setMode(m) { this.mode = m; this._emit(); }
    undoLast() { if (!this.hist.length) return; this.segs = this.hist.pop(); this._apply(); this._emit(); }
    clear() { if (this.segs.length) { this.hist.push(copy(this.segs)); this.segs = []; this._apply(); this._emit(); } }

    // ---- stage 2: split the map and colour LAND only (each unit follows the side holding most of its land)
    toFillStage() {
      if (this.segs.length > 1) return { ok: false, message: MSG.parts };
      const v = C.validate(this.segs[0], this.f);
      if (!v.ok) return { ok: false, message: MSG[v.reason] };
      this.stage = 'fill'; this.regions = v; this.unitSide = C.unitSides(this.samples, v.polyA); this._apply(); this._emit(); return { ok: true };
    }
    _paint(side, colour) { for (const u in this.unitSide) if (this.unitSide[u] === side && this.units[u]) this.units[u].style.fill = colour || ''; }
    backToDraw() { this._paint('A'); this._paint('B'); this.fills = { A: null, B: null }; this.stage = 'draw'; this._apply(); this._emit(); }
    setColour(c) { this.colour = c; }
    _tapFill(pt) {
      if (!this.colour) { this._emit({ hint: 'اختر لونًا أولًا.' }); return; }
      const side = C.sideOfPoint(pt, this.regions.polyA); this.fills[side] = this.colour; this._paint(side, this.colour); this._emit();
    }
    usedColours() { return [...new Set([this.fills.A, this.fills.B].filter(Boolean))]; }

    getSubmission(labels) {
      const ok = this.stage === 'fill' && this.segs.length === 1 && this.fills.A && this.fills.B && this.fills.A !== this.fills.B && labels && labels.developed && labels.underdeveloped && labels.developed !== labels.underdeveloped;
      if (!ok) return { ok: false, message: 'أكمل المهام الثلاث: الخط، تلوين المنطقتين بلونين مختلفين، ثم تحديد كل لون.' };
      return { ok: true, submission: { exerciseType: 'draw_boundary_and_classify', line: this.segs[0].map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), fills: this.fills, labels } };
    }
  }
  root.BoundaryDrawer = BoundaryDrawer;
})(window);
