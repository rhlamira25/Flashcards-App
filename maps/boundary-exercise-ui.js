/* boundary-exercise-ui.js — screen for the "draw boundary and classify" exercise.
   Usage (from the app):  MapBoundary.init({ db, supabaseUrl, base: 'maps/', onBack(){...} });  MapBoundary.open(exerciseId, 'practice');
   All grading happens in the Edge Function "grade-boundary-exercise"; this file never sees the reference answer before submitting. */
(function (root) {
  const MB = { cfg: null, assets: null, D: null, ex: null, ctx: 'practice' };
  const NAMES = { '#2b7bba': 'أزرق', '#e8913a': 'برتقالي', '#f2c230': 'أصفر', '#d64541': 'أحمر', '#1fa3a3': 'فيروزي', '#8d6e63': 'بني' };
  const ANSWER = { dev: '#4f8dc4', under: '#eca442' };
  const ERR = {
    unauthorized: 'انتهت الجلسة. أعد تسجيل الدخول.', rate_limited: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
    payload_too_large: 'حجم الإجابة كبير جدًا.', bad_request: 'تعذر قراءة الإجابة.', bad_line: 'الخط غير صالح.', bad_fills: 'ألوان التلوين غير صالحة.', bad_labels: 'تحديد المنطقتين غير صالح.',
    exercise_not_found: 'هذا التمرين غير متاح حاليًا.', not_entitled: 'ليس لديك صلاحية الوصول إلى هذا التمرين.', server_error: 'حدث خطأ في الخادم. حاول مرة أخرى.',
    plan_assessments_done: 'أنهيت تقييمات هذا المفهوم في الخطة.', concept_not_due: 'هذا المفهوم ليس مجدولًا الآن.', end_not_yet_available: 'التقييم الثاني لم يحن وقته بعد.',
    end_waiting_for_session_tests: 'أكمل اختبارات الجلسة أولًا.', not_due_for_review: 'هذا التمرين ليس مستحقًا للمراجعة الآن.', no_active_plan: 'لا توجد خطة دراسة نشطة.', not_in_plan: 'هذا التمرين غير مرتبط بخطتك.'
  };
  const REASON = { short: 'الخط قصير جدًا.', 'self-cross': 'الخط يقطع نفسه.', 'no-split': 'الخط لا يقسم الخريطة إلى منطقتين.' };
  const CSS = `
  .mb{max-width:1000px;margin:0 auto;padding:10px;color:var(--text,#1d2433);font-family:Cairo,system-ui,sans-serif}
  .mb *{box-sizing:border-box}.mb h2{font-size:1.05rem;margin:4px 0 8px}
  .mb-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .mb-steps{display:flex;gap:6px;margin-bottom:8px}.mb-steps span{flex:1;text-align:center;font-size:.78rem;padding:5px 2px;border:1px solid var(--border,#d7dce4);border-radius:8px;opacity:.65}
  .mb-steps .on{background:var(--accent,#2b6cb0);color:#fff;opacity:1;border-color:var(--accent,#2b6cb0)}
  .mb-map{background:#dfeaf2;border:1px solid var(--border,#d7dce4);border-radius:10px;overflow:hidden;aspect-ratio:2520/1300;width:100%}
  .mb-map svg{width:100%;height:100%;display:block;user-select:none;-webkit-user-select:none}
  .mb-msg{min-height:1.6em;margin:6px 0;opacity:.85;font-size:.9rem}.mb-msg.err{color:#c0392b;opacity:1}
  .mb-bar{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  .mb-btn{font:inherit;color:inherit;background:var(--card-bg,#fff);border:1px solid var(--border,#d7dce4);border-radius:8px;padding:8px 12px;min-height:44px;cursor:pointer}
  .mb-btn.on,.mb-btn.pri{background:var(--accent,#2b6cb0);color:#fff;border-color:var(--accent,#2b6cb0)}.mb-btn:disabled{opacity:.45;cursor:default}
  .mb-sw{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}.mb-sw button{width:48px;height:48px;border-radius:50%;border:3px solid var(--border,#d7dce4);cursor:pointer;padding:0}.mb-sw button.sel{border-color:var(--text,#222)}
  .mb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}.mb-row label{min-width:120px}.mb-row select{font:inherit;padding:8px;min-height:44px;border-radius:8px;border:1px solid var(--border,#d7dce4);background:var(--card-bg,#fff);color:inherit}
  .mb-score{font-size:1.6rem;font-weight:700;margin:6px 0}.mb-tbl{width:100%;border-collapse:collapse;margin:6px 0}.mb-tbl td{padding:6px 4px;border-bottom:1px solid var(--border,#d7dce4)}
  .mb-leg{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0;font-size:.9rem}.mb-leg i{display:inline-block;width:18px;height:18px;border-radius:4px;vertical-align:middle;margin-left:6px}
  .mb-hide{display:none}`;

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  }
  async function loadAssets() {
    if (MB.assets) return MB.assets;
    const base = (MB.cfg.base || 'maps/'), v = '?v=1';
    if (!root.BoundaryCore) await loadScript(base + 'boundary-core.js' + v);
    if (!root.BoundaryDrawer) await loadScript(base + 'boundary-drawer.js' + v);
    const r = await fetch(base + 'world-base.svg' + v); if (!r.ok) throw new Error('map');
    MB.assets = { svg: await r.text() }; return MB.assets;
  }
  const $ = (id) => document.getElementById('mb-' + id);

  MB.init = (cfg) => { MB.cfg = cfg; if (!document.getElementById('mb-css')) { const s = document.createElement('style'); s.id = 'mb-css'; s.textContent = CSS; document.head.appendChild(s); } };

  MB.open = async function (exerciseId, context) {
    const host = document.getElementById('mb-root'); MB.ctx = context || 'practice';
    host.innerHTML = '<div class="mb"><p>جارٍ التحميل…</p></div>';
    try {
      const [assets, ex] = await Promise.all([loadAssets(), MB.cfg.db.from('map_exercises').select('id,title,frame').eq('id', exerciseId).maybeSingle()]);
      if (ex.error || !ex.data) throw new Error('exercise');
      MB.ex = ex.data; build(host, assets.svg);
    } catch (e) { console.error('map exercise load', e); host.innerHTML = '<div class="mb"><p class="mb-msg err">تعذر تحميل التمرين. تحقق من الاتصال ثم أعد المحاولة.</p><button class="mb-btn" id="mb-x">رجوع</button></div>'; document.getElementById('mb-x').onclick = () => MB.cfg.onBack(); }
  };

  function build(host, svgText) {
    host.innerHTML = `<div class="mb">
      <div class="mb-top"><button class="mb-btn" id="mb-back">→ رجوع</button><h2>${MB.ex.title}</h2></div>
      <div class="mb-steps"><span id="mb-s1" class="on">١ · ارسم الخط</span><span id="mb-s2">٢ · لوّن المنطقتين</span><span id="mb-s3">٣ · حدّد المنطقتين</span></div>
      <div class="mb-map" id="mb-mapbox">${svgText}</div>
      <div class="mb-msg" id="mb-msg">ارسم الخط الفاصل بإصبعك، وتابع الرسم من أي من طرفيه. استعمل الممحاة لحذف جزء فقط، وإصبعين للتكبير.</div>
      <div id="mb-p1"><div class="mb-bar">
        <button class="mb-btn on" id="mb-draw">✏️ رسم</button><button class="mb-btn" id="mb-pan">✋ تحريك</button><button class="mb-btn" id="mb-erase">🧽 ممحاة</button>
        <button class="mb-btn" id="mb-undo" disabled>↩ تراجع</button><button class="mb-btn" id="mb-clear" disabled>🗑 مسح الخط</button>
        <button class="mb-btn" id="mb-in">＋</button><button class="mb-btn" id="mb-out">－</button><button class="mb-btn" id="mb-reset">⟲ كامل الخريطة</button></div>
        <button class="mb-btn pri" id="mb-next" disabled>التالي: تقسيم الخريطة</button></div>
      <div id="mb-p2" class="mb-hide"><p>اختر لونًا ثم المس كل منطقة لتلوينها بلونين مختلفين.</p><div class="mb-sw" id="mb-sw"></div>
        <div class="mb-bar"><button class="mb-btn" id="mb-back1">← تعديل الخط</button><button class="mb-btn pri" id="mb-go" disabled>التالي: تحديد المنطقتين</button></div></div>
      <div id="mb-p3" class="mb-hide"><div class="mb-row"><label>العالم المتقدم</label><select id="mb-dev"></select></div>
        <div class="mb-row"><label>العالم المتخلف</label><select id="mb-und"></select></div>
        <div class="mb-bar"><button class="mb-btn" id="mb-back2">← تعديل التلوين</button><button class="mb-btn pri" id="mb-send" disabled>إرسال</button></div></div>
      <div id="mb-p4" class="mb-hide"></div></div>`;
    const msg = (t, e) => { const m = $('msg'); m.textContent = t; m.className = 'mb-msg' + (e ? ' err' : ''); };
    const steps = n => { [1, 2, 3].forEach(i => { $('s' + i).classList.toggle('on', i === n); $('p' + i).classList.toggle('mb-hide', i !== n); }); };
    const f = MB.ex.frame, svg = $('mapbox').querySelector('svg');
    const D = MB.D = new root.BoundaryDrawer(svg, { frame: f, onChange: st => {
      if (st.hint) msg(st.hint, true);
      if (st.points !== undefined) { $('undo').disabled = !st.canUndo; $('clear').disabled = st.points === 0; $('next').disabled = st.points < 2; }
      $('draw').classList.toggle('on', st.mode === 'draw'); $('pan').classList.toggle('on', st.mode === 'pan'); $('erase').classList.toggle('on', st.mode === 'erase');
      if (st.stage === 'fill') $('go').disabled = !(D.fills.A && D.fills.B && D.fills.A !== D.fills.B);
    } });
    $('back').onclick = () => { if (!D.segs.length || confirm('الخروج وفقدان ما رسمته؟')) MB.cfg.onBack(); };
    $('draw').onclick = () => D.setMode('draw'); $('pan').onclick = () => D.setMode('pan'); $('erase').onclick = () => D.setMode('erase'); $('undo').onclick = () => D.undoLast();
    $('clear').onclick = () => { if (confirm('مسح الخط بالكامل؟')) D.clear(); };
    const mid = () => [D.vb.x + D.vb.w / 2, D.vb.y + D.vb.h / 2];
    $('in').onclick = () => D.zoomAt(mid(), 1 / 1.4); $('out').onclick = () => D.zoomAt(mid(), 1.4); $('reset').onclick = () => D.zoomReset();
    const sw = $('sw'); Object.keys(NAMES).forEach(c => { const b = document.createElement('button'); b.style.background = c; b.setAttribute('aria-label', NAMES[c]); b.title = NAMES[c];
      b.onclick = () => { D.setColour(c); [...sw.children].forEach(x => x.classList.remove('sel')); b.classList.add('sel'); msg('المس المنطقة التي تريد تلوينها.'); }; sw.appendChild(b); });
    $('next').onclick = () => { const r = D.toFillStage(); if (!r.ok) { msg(r.message, true); return; } D.zoomReset(); steps(2); msg('اختر لونًا ثم المس كل منطقة.'); };
    $('back1').onclick = () => { D.backToDraw(); steps(1); msg('عدّل الخط ثم اضغط التالي.'); };
    const labels = () => ({ developed: $('dev').value, underdeveloped: $('und').value });
    const chk = () => { const l = labels(); $('send').disabled = !(l.developed && l.underdeveloped && l.developed !== l.underdeveloped); };
    $('go').onclick = () => { const cols = D.usedColours(); [$('dev'), $('und')].forEach(s => { s.innerHTML = '<option value="">اختر اللون…</option>' + cols.map(c => `<option value="${c}">${NAMES[c] || c}</option>`).join(''); s.onchange = chk; }); steps(3); msg('حدّد اللون الذي يمثل كل منطقة.'); chk(); };
    $('back2').onclick = () => { steps(2); msg('المس منطقة لتغيير لونها.'); };
    $('send').onclick = async () => {
      const r = D.getSubmission(labels()); if (!r.ok) { msg(r.message, true); return; }
      $('send').disabled = true; msg('جارٍ التصحيح…');
      try {
        const { data: { session } } = await MB.cfg.db.auth.getSession(); if (!session) { msg(ERR.unauthorized, true); return; }
        const res = await fetch(`${MB.cfg.supabaseUrl}/functions/v1/grade-boundary-exercise`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ exerciseId: MB.ex.id, context: MB.ctx, submission: r.submission }) });
        const out = await res.json().catch(() => null);
        if (!res.ok || !out || out.error) { const code = out && out.error; msg((code === 'invalid_line' ? (REASON[out.reason] || 'الخط غير صالح.') : (ERR[code] || ERR.server_error)), true); $('send').disabled = false; return; }
        showResult(out, r.submission, svgText);
      } catch (e) { console.error('grade', e); msg(ERR.server_error, true); $('send').disabled = false; }
    };
  }

  function showResult(out, sub, svgText) {
    const host = document.getElementById('mb-root'), s = out.scores, f = MB.ex.frame, n = (v, d) => (Math.round(v * 10) / 10).toString();
    const wrap = host.querySelector('.mb');
    wrap.innerHTML = `<div class="mb-top"><h2>${MB.ex.title}</h2></div>
      <div class="mb-score">${s.total20} / 20</div>
      <table class="mb-tbl"><tr><td>دقة الخط الفاصل</td><td>${n(s.boundary)} / 50</td></tr><tr><td>تصنيف البلدان</td><td>${n(s.colouring)} / 30</td></tr><tr><td>تحديد المنطقتين</td><td>${n(s.identification)} / 20</td></tr><tr><td><b>المجموع</b></td><td><b>${n(s.total100)} / 100</b></td></tr></table>
      <h2>الإجابة الصحيحة</h2><div class="mb-map" id="mb-ans">${svgText}</div>
      <div class="mb-leg"><span><i style="background:${ANSWER.dev}"></i>العالم المتقدم</span><span><i style="background:${ANSWER.under}"></i>العالم المتخلف</span><span><i style="background:#1e1e1e"></i>الحدّ الصحيح</span><span><i style="background:#d64541"></i>خطّك</span></div>
      <div class="mb-bar"><button class="mb-btn pri" id="mb-again">إعادة المحاولة</button><button class="mb-btn" id="mb-done">العودة للقائمة</button></div>`;
    const svg = document.querySelector('#mb-ans svg');
    svg.querySelectorAll('path[data-unit]').forEach(p => { const c = out.correct.classes[p.dataset.unit]; if (c) p.style.fill = ANSWER[c]; });
    const mk = (pts, stroke, w) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M' + pts.map(q => q[0] + ' ' + q[1]).join('L')); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('vector-effect', 'non-scaling-stroke'); svg.appendChild(p); };
    mk(sub.line, '#d64541', 2.5); mk(out.correct.boundary, '#1e1e1e', 4);
    document.getElementById('mb-again').onclick = () => MB.open(MB.ex.id, MB.ctx); document.getElementById('mb-done').onclick = () => MB.cfg.onBack();
  }
  root.MapBoundary = MB;
})(window);
