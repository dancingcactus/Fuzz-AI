/* Schedule picker spike: the parts the three designs share.
   - The clock: real time, or a pretend "now" so the defaults can be tried at any hour.
   - The default rule: today gets an hour from now (rounded up to the next 5 minutes); any later day gets 8 AM.
     The default holds until you set a time yourself. After that, changing the day keeps your time.
   - The model: one picked day and time, and who's listening.
   - The month calendar, the one-hand dial (hours, then minutes) and the two-ring dial. */
(function () {
  var P = {};
  var H = 3600000, DEFAULT_HOUR = 8, STEP = 5;

  /* ---------- The clock ---------- */
  var fake = null;   /* { at: Date pretended, setAt: real ms when set } */
  P.now = function () { return fake ? new Date(fake.at.getTime() + (Date.now() - fake.setAt)) : new Date(); };
  P.pretend = function (d) { fake = d ? { at: d, setAt: Date.now() } : null; };

  /* ---------- Dates ---------- */
  function sod(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  P.sod = sod;
  P.sameDay = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  P.addDays = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  P.key = function (d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  P.fromKey = function (k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  P.DOW = DOW; P.MON = MON; P.MON_LONG = MON_LONG;
  P.fmtDate = function (d) { return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate(); };
  P.fmtLong = function (d) { return DOW_LONG[d.getDay()] + ', ' + MON_LONG[d.getMonth()] + ' ' + d.getDate(); };
  P.rel = function (d) {
    var t = sod(P.now()), n = Math.round((sod(d) - t) / 86400000);
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow';
    if (n > 1 && n < 7) return DOW_LONG[d.getDay()];
    return P.fmtDate(d);
  };
  P.h12 = function (h) { return h % 12 || 12; };
  P.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  P.fmtTime = function (h, m) { return P.h12(h) + ':' + P.pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); };

  /* ---------- The default rule ---------- */
  P.defaultFor = function (day) {
    var now = P.now();
    if (!P.sameDay(day, now)) return { day: sod(day), h: DEFAULT_HOUR, m: 0, why: '8 AM, the start of the day' };
    var t = new Date(now.getTime() + H);
    var up = Math.ceil((t.getMinutes() + (t.getSeconds() || t.getMilliseconds() ? 1 : 0)) / STEP) * STEP;
    t.setMinutes(up, 0, 0);   /* 60 rolls the hour */
    return { day: sod(t), h: t.getHours(), m: t.getMinutes(),
      why: P.sameDay(t, now) ? 'An hour from now' : 'An hour from now, which is just after midnight' };
  };

  /* ---------- The model ---------- */
  P.Model = function () {
    var s = { day: null, h: 0, m: 0, touched: false, why: '' }, fns = [];
    var api = {
      s: s,
      on: function (f) { fns.push(f); },
      emit: function () { fns.forEach(function (f) { f(s); }); },
      setDay: function (d) {
        if (!s.touched) { var df = P.defaultFor(d); s.day = df.day; s.h = df.h; s.m = df.m; s.why = df.why; }
        else s.day = sod(d);
        api.emit();
      },
      setTime: function (h, m) { s.h = (h + 24) % 24; s.m = (m + 60) % 60; s.touched = true; s.why = ''; api.emit(); },
      reset: function () { s.touched = false; api.setDay(s.day && sod(s.day) >= sod(P.now()) ? s.day : P.now()); },
      start: function () { s.touched = false; api.setDay(P.now()); },
      at: function () { return new Date(s.day.getFullYear(), s.day.getMonth(), s.day.getDate(), s.h, s.m); },
      past: function () { return api.at() <= P.now(); },
      label: function () { return P.rel(s.day) + (P.rel(s.day).indexOf(',') > -1 ? '' : ', ' + P.fmtDate(s.day).split(', ')[1]) + ' at ' + P.fmtTime(s.h, s.m); }
    };
    return api;
  };

  /* ---------- The month calendar ---------- */
  var CHEV = function (d) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (d < 0 ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6') + '"/></svg>'; };
  P.calendar = function (el, model) {
    var view = null;
    el.classList.add('cal');
    function render() {
      var s = model.s, today = sod(P.now());
      var focusKey = el.contains(document.activeElement) && document.activeElement.dataset.day ? P.key(s.day) : null;
      var navFocus = el.contains(document.activeElement) && document.activeElement.dataset.nav;
      var lead = view.getDay(), days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      var canPrev = view > new Date(today.getFullYear(), today.getMonth(), 1);
      var inView = s.day.getFullYear() === view.getFullYear() && s.day.getMonth() === view.getMonth();
      var h = '<div class="cal-head"><span class="cal-month" aria-live="polite">' + MON_LONG[view.getMonth()] + ' ' + view.getFullYear() + '</span>' +
        '<span class="cal-nav"><button type="button" class="cal-arrow" data-nav="-1" aria-label="Previous month"' + (canPrev ? '' : ' disabled') + '>' + CHEV(-1) + '</button>' +
        '<button type="button" class="cal-arrow" data-nav="1" aria-label="Next month">' + CHEV(1) + '</button></span></div>' +
        '<div class="cal-grid">' + DOW.map(function (d) { return '<span class="cal-dow" aria-hidden="true">' + d.charAt(0) + '</span>'; }).join('');
      for (var i = 0; i < lead; i++) h += '<span></span>';
      for (var d = 1; d <= days; d++) {
        var dt = new Date(view.getFullYear(), view.getMonth(), d), past = dt < today, sel = P.sameDay(dt, s.day), tod = P.sameDay(dt, today);
        /* One day in the grid takes Tab: the picked one, or the 1st when it's in another month */
        var tab = inView ? sel : (d === 1);
        h += '<button type="button" class="cal-day' + (sel ? ' sel' : '') + (tod ? ' today' : '') + '" data-day="' + P.key(dt) + '"' +
          (past ? ' disabled' : '') + ' tabindex="' + (tab ? 0 : -1) + '" aria-pressed="' + sel + '"' + (tod ? ' aria-current="date"' : '') +
          ' aria-label="' + P.fmtLong(dt) + (tod ? ', today' : '') + '">' + d + '</button>';
      }
      el.innerHTML = h + '</div>';
      if (focusKey) { var f = el.querySelector('[data-day="' + focusKey + '"]'); if (f) f.focus(); }
      else if (navFocus) { var n = el.querySelector('[data-nav="' + navFocus + '"]'); if (n && !n.disabled) n.focus(); else { var nn = el.querySelector('[data-nav]:not([disabled])'); if (nn) nn.focus(); } }
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.nav), 1); render(); return; }
      if (b.dataset.day) { b.focus(); model.setDay(P.fromKey(b.dataset.day)); }
    });
    el.addEventListener('keydown', function (e) {
      var b = e.target.closest('[data-day]'); if (!b) return;
      var mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!mv) return;
      e.preventDefault();
      var to = P.addDays(P.fromKey(b.dataset.day), mv);
      if (to < sod(P.now())) return;
      model.setDay(to);
    });
    /* The month shown follows the picked day; the arrows move it on their own */
    model.on(function (st) { view = new Date(st.day.getFullYear(), st.day.getMonth(), 1); render(); });
    return { render: render };
  };

  /* ---------- The one-hand dial: hours, then minutes ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(cls, label) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 256 256'); svg.setAttribute('class', cls); svg.setAttribute('tabindex', '0');
    svg.setAttribute('role', 'slider'); svg.setAttribute('aria-label', label);
    return svg;
  }
  function angleOf(svg, e) {
    var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 256 - 128, y = (e.clientY - r.top) / r.height * 256 - 128;
    var a = Math.atan2(x, -y) * 180 / Math.PI; return { a: (a + 360) % 360, dist: Math.sqrt(x * x + y * y) };
  }
  function pt(a, r) { var t = a * Math.PI / 180; return [128 + r * Math.sin(t), 128 - r * Math.cos(t)]; }
  function fix(n) { return Math.round(n * 10) / 10; }

  /* ctl: { mode: 'hour' | 'minute', setMode(m) } */
  P.dial = function (host, model, ctl) {
    var svg = svgEl('dial', 'Time'), drag = false;
    host.appendChild(svg);
    function render() {
      var s = model.s, hr = ctl.mode === 'hour', R = 98;
      var val = hr ? P.h12(s.h) : s.m, ang = hr ? (val % 12) * 30 : val * 6, k = pt(ang, R), off = !hr && s.m % STEP;
      var g = '<circle class="face" cx="128" cy="128" r="124"/>' +
        '<line class="hand" x1="128" y1="128" x2="' + fix(k[0]) + '" y2="' + fix(k[1]) + '"/><circle class="hub" cx="128" cy="128" r="4"/>' +
        '<circle class="knob" cx="' + fix(k[0]) + '" cy="' + fix(k[1]) + '" r="20"/>' + (off ? '<circle class="knob-dot" cx="' + fix(k[0]) + '" cy="' + fix(k[1]) + '" r="3.5"/>' : '');
      for (var i = 0; i < 12; i++) {
        var v = hr ? (i || 12) : i * 5, p = pt(i * 30, R), on = hr ? v === val : v === val;
        g += '<text class="num' + (on ? ' on' : '') + '" x="' + fix(p[0]) + '" y="' + fix(p[1]) + '">' + (hr ? v : P.pad(v)) + '</text>';
      }
      svg.innerHTML = g;
      svg.setAttribute('aria-label', hr ? 'Hour' : 'Minutes');
      svg.setAttribute('aria-valuemin', hr ? 1 : 0); svg.setAttribute('aria-valuemax', hr ? 12 : 59);
      svg.setAttribute('aria-valuenow', val); svg.setAttribute('aria-valuetext', P.fmtTime(s.h, s.m));
      svg.classList.toggle('minutes', !hr);
    }
    function pick(e) {
      var a = angleOf(svg, e).a, s = model.s;
      if (ctl.mode === 'hour') { var h = Math.round(a / 30) % 12; model.setTime(h + (s.h >= 12 ? 12 : 0), s.m); }
      else model.setTime(s.h, (Math.round(a / 6 / STEP) * STEP) % 60);
    }
    svg.addEventListener('pointerdown', function (e) { drag = true; svg.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); });
    svg.addEventListener('pointermove', function (e) { if (drag) pick(e); });
    svg.addEventListener('pointerup', function () { if (!drag) return; drag = false; if (ctl.mode === 'hour') ctl.setMode('minute'); });
    svg.addEventListener('keydown', function (e) {
      var d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key], s = model.s; if (!d) return;
      e.preventDefault();
      if (ctl.mode === 'hour') { var h12 = (s.h % 12 + d + 12) % 12; model.setTime(h12 + (s.h >= 12 ? 12 : 0), s.m); }
      else model.setTime(s.h, (Math.round(s.m / STEP) * STEP + d * STEP + 60) % 60);
    });
    model.on(render);
    return { render: render, el: svg };
  };

  /* ---------- The two-ring dial: hours inside, minutes outside, both always live ---------- */
  P.dualDial = function (host, model) {
    var svg = svgEl('dial dual', 'Time'), ring = null;
    var RH = 58, RM = 100;
    host.appendChild(svg);
    function render() {
      var s = model.s, ha = (s.h % 12) * 30 + s.m / 2, ma = s.m * 6, hk = pt((s.h % 12) * 30, RH), mk = pt(ma, RM), hTip = pt(ha, RH - 18);
      var g = '<circle class="face" cx="128" cy="128" r="124"/><circle class="ring-in" cx="128" cy="128" r="80"/>';
      for (var t = 0; t < 60; t++) if (t % 5) { var a = pt(t * 6, 118), b = pt(t * 6, 114); g += '<line class="tick" x1="' + fix(a[0]) + '" y1="' + fix(a[1]) + '" x2="' + fix(b[0]) + '" y2="' + fix(b[1]) + '"/>'; }
      g += '<line class="hand minute-hand" x1="128" y1="128" x2="' + fix(mk[0]) + '" y2="' + fix(mk[1]) + '"/>' +
        '<line class="hand hour-hand" x1="128" y1="128" x2="' + fix(hTip[0]) + '" y2="' + fix(hTip[1]) + '"/><circle class="hub" cx="128" cy="128" r="5"/>' +
        '<circle class="knob knob-m" cx="' + fix(mk[0]) + '" cy="' + fix(mk[1]) + '" r="16"/>' + (s.m % STEP ? '<circle class="knob-dot" cx="' + fix(mk[0]) + '" cy="' + fix(mk[1]) + '" r="3"/>' : '') +
        '<circle class="knob knob-h" cx="' + fix(hk[0]) + '" cy="' + fix(hk[1]) + '" r="17"/>';
      for (var i = 0; i < 12; i++) {
        var hp = pt(i * 30, RH), mp = pt(i * 30, RM), hv = i || 12;
        g += '<text class="num hr' + (hv === P.h12(s.h) ? ' on' : '') + '" x="' + fix(hp[0]) + '" y="' + fix(hp[1]) + '">' + hv + '</text>';
        g += '<text class="num mn' + (i * 5 === s.m ? ' on' : '') + '" x="' + fix(mp[0]) + '" y="' + fix(mp[1]) + '">' + P.pad(i * 5) + '</text>';
      }
      svg.innerHTML = g;
      svg.setAttribute('aria-valuetext', P.fmtTime(s.h, s.m));
    }
    function pick(e) {
      var o = angleOf(svg, e), s = model.s;
      if (!ring) ring = o.dist > 80 ? 'm' : 'h';
      if (ring === 'h') model.setTime(Math.round(o.a / 30) % 12 + (s.h >= 12 ? 12 : 0), s.m);
      else model.setTime(s.h, (Math.round(o.a / 6 / STEP) * STEP) % 60);
    }
    svg.addEventListener('pointerdown', function (e) { ring = null; svg.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); });
    svg.addEventListener('pointermove', function (e) { if (ring) pick(e); });
    svg.addEventListener('pointerup', function () { ring = null; });
    svg.addEventListener('pointercancel', function () { ring = null; });
    /* Keys: up and down move the hour, left and right the minutes */
    svg.addEventListener('keydown', function (e) {
      var s = model.s;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); var d = e.key === 'ArrowUp' ? 1 : -1; model.setTime(s.h + d, s.m); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var dm = e.key === 'ArrowRight' ? STEP : -STEP; model.setTime(s.h, (Math.round(s.m / STEP) * STEP + dm + 60) % 60); }
    });
    svg.setAttribute('aria-label', 'Time. Up and down change the hour, left and right the minutes.');
    model.on(render);
    return { render: render, el: svg };
  };

  window.Picker = P;
})();
