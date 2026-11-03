/* boundary-core.js — geometry + grading for the "draw boundary and classify" exercise.
   Pure functions, no DOM. Load in the browser (window.BoundaryCore) or run server-side
   (module.exports), so grading never needs the reference to reach the student.
   All coordinates are base-map units, in the SAME frame as the reference boundary. */
(function (root) {
  // Provisional values: calibrate with real student drawings (touch input) — change here only.
  const DEFAULTS = {
    tolFrac: 0.02,        // t = 2% of map width
    farFactor: 3,         // credit falls linearly to 0 at 3t
    oceanWeight: 0.5,     // weight of ocean-only reference segments
    idGate: 0.5,          // identification needs colouring agreement A >= this
    weights: { boundary: 50, colouring: 30, identification: 20 },
    sampleFrac: 0.004     // resampling step (fraction of map width)
  };

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function nearestOnLine(p, L) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      if (d < best) { best = d; bi = i; }
    }
    return { d: best, i: bi };
  }

  // Resample a polyline; vertex[2]===1 marks an ocean-only segment (starting at that vertex).
  function resample(L, step) {
    const out = [];
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1], n = Math.max(1, Math.ceil(dist(a, b) / step)), o = a[2] ? 1 : 0;
      for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, o]);
    }
    const last = L[L.length - 1];
    out.push([last[0], last[1], L.length > 1 && L[L.length - 2][2] ? 1 : 0]);
    return out;
  }

  function rayToFrame(p, d, f) {
    const tx = d[0] > 0 ? (f.x1 - p[0]) / d[0] : d[0] < 0 ? (f.x0 - p[0]) / d[0] : Infinity;
    const ty = d[1] > 0 ? (f.y1 - p[1]) / d[1] : d[1] < 0 ? (f.y0 - p[1]) / d[1] : Infinity;
    const t = Math.max(0, Math.min(tx, ty));
    return [p[0] + d[0] * t, p[1] + d[1] * t];
  }

  // Direction at an end of the line, measured against a point far enough away to be stable.
  function endDir(pts, atEnd, minLen) {
    const n = pts.length, p = atEnd ? pts[n - 1] : pts[0];
    for (let k = 1; k < n; k++) {
      const q = atEnd ? pts[n - 1 - k] : pts[k], d = dist(p, q);
      if (d >= minLen || k === n - 1) return d ? [(p[0] - q[0]) / d, (p[1] - q[1]) / d] : [1, 0];
    }
    return [1, 0];
  }

  // Extend both endpoints to the map frame along their end directions.
  function extend(pts, f) {
    if (!pts || pts.length < 2) return null;
    const W = f.x1 - f.x0, c = pts.map(p => [Math.min(f.x1, Math.max(f.x0, p[0])), Math.min(f.y1, Math.max(f.y0, p[1]))]);
    const s = rayToFrame(c[0], endDir(c, false, W * 0.01), f), e = rayToFrame(c[c.length - 1], endDir(c, true, W * 0.01), f);
    return [s, ...c, e];
  }

  const perim = (p, f) => {
    const W = f.x1 - f.x0, H = f.y1 - f.y0;
    const ds = [Math.abs(p[1] - f.y0), Math.abs(p[0] - f.x1), Math.abs(p[1] - f.y1), Math.abs(p[0] - f.x0)];
    const k = ds.indexOf(Math.min(...ds));
    return k === 0 ? p[0] - f.x0 : k === 1 ? W + p[1] - f.y0 : k === 2 ? W + H + f.x1 - p[0] : 2 * W + H + f.y1 - p[1];
  };

  function segCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  function isSimple(L) {
    for (let i = 0; i < L.length - 1; i++)
      for (let j = i + 2; j < L.length - 1; j++)
        if (segCross(L[i], L[i + 1], L[j], L[j + 1])) return false;
    return true;
  }

  // Region "A": the extended line closed clockwise along the frame from its end back to its start.
  // Region "B" is everything else in the frame.
  function regionA(ext, f) {
    const W = f.x1 - f.x0, H = f.y1 - f.y0, P = 2 * (W + H);
    const corners = [[0, [f.x0, f.y0]], [W, [f.x1, f.y0]], [W + H, [f.x1, f.y1]], [2 * W + H, [f.x0, f.y1]]];
    const pe = perim(ext[ext.length - 1], f), ps = perim(ext[0], f), span = (ps - pe + P) % P || P;
    const mids = corners.map(([c, pt]) => ({ off: (c - pe + P) % P, pt })).filter(o => o.off > 1e-9 && o.off < span - 1e-9).sort((a, b) => a.off - b.off).map(o => o.pt);
    return [...ext, ...mids];
  }

  function validate(pts, f) {
    if (!pts || pts.length < 2) return { ok: false, reason: 'short' };
    const W = f.x1 - f.x0;
    let total = 0; for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i], pts[i + 1]);
    if (total < W * 0.1) return { ok: false, reason: 'short' };
    const ext = extend(pts, f);
    if (!isSimple(ext)) return { ok: false, reason: 'self-cross' };
    if (dist(ext[0], ext[ext.length - 1]) < W * 0.02) return { ok: false, reason: 'no-split' };
    return { ok: true, ext, polyA: regionA(ext, f) };
  }

  function pip(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const sideOfPoint = (p, polyA) => (pip(p, polyA) ? 'A' : 'B');

  // Each unit goes to the side holding the majority of its land (sample points inside the unit).
  function unitSides(samples, polyA) {
    const out = {};
    for (const id in samples) {
      const pts = samples[id]; let a = 0;
      for (const p of pts) if (pip(p, polyA)) a++;
      out[id] = a * 2 >= pts.length ? 'A' : 'B';
    }
    return out;
  }

  function boundaryScore(line, refLine, f, P) {
    const t = (f.x1 - f.x0) * P.tolFrac, step = (f.x1 - f.x0) * P.sampleFrac;
    const credit = d => d <= t ? 1 : d >= t * P.farFactor ? 0 : 1 - (d - t) / (t * (P.farFactor - 1));
    const ref = resample(refLine, step), stu = resample(line, step);
    let cn = 0, cd = 0, pn = 0, pd = 0;
    for (const r of ref) { const w = r[2] ? P.oceanWeight : 1; cn += w * credit(nearestOnLine(r, line).d); cd += w; }
    for (const s of stu) { const n = nearestOnLine(s, refLine), w = refLine[n.i][2] ? P.oceanWeight : 1; pn += w * credit(n.d); pd += w; }
    const cov = cn / cd, prec = pn / pd;
    return { coverage: cov, precision: prec, ratio: (cov + prec) / 2 };
  }

  /* submission: { line:[[x,y]...], fills:{A:'#hex',B:'#hex'}, labels:{developed:'#hex', underdeveloped:'#hex'} }
     reference:  { frame:{x0,y0,x1,y1}, boundary:[[x,y,ocean?]...], classes:{unitId:'dev'|'under'}, samples:{unitId:[[x,y]...]} } */
  function grade(sub, ref, params) {
    const P = Object.assign({}, DEFAULTS, params || {}), Wt = Object.assign({}, DEFAULTS.weights, (params || {}).weights);
    const f = ref.frame, v = validate(sub.line, f), res = { valid: v.ok };
    const b = sub.line && sub.line.length > 1 ? boundaryScore(sub.line, ref.boundary, f, P) : { ratio: 0 };
    res.boundary = Wt.boundary * b.ratio; res.boundaryDetail = b;
    res.colouring = 0; res.identification = 0; res.A = 0;
    const norm = c => String(c || '').toLowerCase(), fa = norm(sub.fills && sub.fills.A), fb = norm(sub.fills && sub.fills.B);
    if (v.ok && fa && fb && fa !== fb) {
      const sides = unitSides(ref.samples, v.polyA), ids = Object.keys(ref.classes).filter(id => sides[id]);
      let m1 = 0; ids.forEach(id => { if ((sides[id] === 'A') === (ref.classes[id] === 'dev')) m1++; });
      const m = Math.max(m1, ids.length - m1); res.A = ids.length ? m / ids.length : 0;
      res.colouring = Wt.colouring * res.A;
      // side holding most reference-developed units
      let devA = 0, dev = 0; ids.forEach(id => { if (ref.classes[id] === 'dev') { dev++; if (sides[id] === 'A') devA++; } });
      const devSide = devA * 2 >= dev ? 'A' : 'B', devCol = devSide === 'A' ? fa : fb, undCol = devSide === 'A' ? fb : fa;
      if (res.A >= P.idGate && norm(sub.labels && sub.labels.developed) === devCol && norm(sub.labels && sub.labels.underdeveloped) === undCol)
        res.identification = Wt.identification;
    }
    res.total100 = res.boundary + res.colouring + res.identification;
    res.total20 = Math.round(res.total100 / 5 / 0.25) * 0.25;
    return res;
  }

  const api = { DEFAULTS, extend, validate, regionA, sideOfPoint, unitSides, boundaryScore, grade, isSimple, dist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BoundaryCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
