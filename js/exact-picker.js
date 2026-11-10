/* The exact-time picker behind Schedule → More times → "Pick an exact time instead".
   Day chips for the coming week, "Other day" for the month, and a two-ring clock: hours inside, minutes outside,
   both live. The time box takes typing too ("3", "330p", "15:30"), and there are a few common times.
   The defaults: today is an hour from now, rounded up to the next 5 minutes; any later day is 8 AM. They hold until
   you set a time yourself; after that, changing the day keeps your time, and "Back to the default" brings it back.
   From spikes/schedule-picker (design C).

   ExactPicker.mount(el) draws it into el and returns { at(), past(), focus() }. The Schedule button inside it
   carries data-sched="exact-go", so the Triage panel's own click handler does the scheduling. */
(function () {
  var H = 3600000, DEFAULT_HOUR = 8, STEP = 5, WEEK = 7;
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var QUICK = [[8, 0, '8 AM'], [12, 0, 'Noon'], [13, 0, '1 PM'], [17, 0, '5 PM']];

  /* ---------- Dates ---------- */
  function now() { return new Date(); }
  function sod(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function key(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function fromKey(k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function h12(h) { return h % 12 || 12; }
  function fmtTime(h, m) { return h12(h) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function fmtDate(d) { return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate(); }
  function fmtLong(d) { return DOW_LONG[d.getDay()] + ', ' + MON_LONG[d.getMonth()] + ' ' + d.getDate(); }
  function rel(d) {
    var n = Math.round((sod(d) - sod(now())) / 86400000);
    if (n === 0) return 'today, ' + MON[d.getMonth()] + ' ' + d.getDate();
    if (n === 1) return 'tomorrow, ' + MON[d.getMonth()] + ' ' + d.getDate();
    if (n > 1 && n < 7) return DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
    return fmtDate(d);
  }

  /* ---------- The default rule ---------- */
  function defaultFor(day) {
    var n = now();
    if (!sameDay(day, n)) return { day: sod(day), h: DEFAULT_HOUR, m: 0, why: '8 AM, the start of the day' };
    var t = new Date(n.getTime() + H);
    t.setMinutes(Math.ceil((t.getMinutes() + (t.getSeconds() || t.getMilliseconds() ? 1 : 0)) / STEP) * STEP, 0, 0);   /* 60 rolls the hour */
    return { day: sod(t), h: t.getHours(), m: t.getMinutes(), why: sameDay(t, n) ? 'an hour from now' : 'an hour from now, which is just after midnight' };
  }

  /* ---------- The model: one picked day and time ---------- */
  function Model() {
    var s = { day: null, h: 0, m: 0, touched: false, why: '' }, fns = [];
    var api = {
      s: s,
      on: function (f) { fns.push(f); },
      emit: function () { fns.forEach(function (f) { f(s); }); },
      setDay: function (d) {
        if (!s.touched) { var df = defaultFor(d); s.day = df.day; s.h = df.h; s.m = df.m; s.why = df.why; }
        else s.day = sod(d);
        api.emit();
      },
      setTime: function (h, m) { s.h = (h + 24) % 24; s.m = (m + 60) % 60; s.touched = true; s.why = ''; api.emit(); },
      reset: function () { s.touched = false; api.setDay(s.day && s.day >= sod(now()) ? s.day : now()); },
      at: function () { return new Date(s.day.getFullYear(), s.day.getMonth(), s.day.getDate(), s.h, s.m); },
      past: function () { return api.at() <= now(); }
    };
    return api;
  }

  /* ---------- The month, behind "Other day" ---------- */
  function chev(d) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (d < 0 ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6') + '"/></svg>'; }
  function calendar(el, model) {
    var view = null;
    function render() {
      var s = model.s, today = sod(now());
      var focusKey = el.contains(document.activeElement) && document.activeElement.dataset.xpday ? key(s.day) : null;
      var navFocus = el.contains(document.activeElement) && document.activeElement.dataset.xpnav;
      var lead = view.getDay(), days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      var canPrev = view > new Date(today.getFullYear(), today.getMonth(), 1);
      var inView = s.day.getFullYear() === view.getFullYear() && s.day.getMonth() === view.getMonth();
      var h = '<div class="xp-cal-head"><span class="xp-cal-month" aria-live="polite">' + MON_LONG[view.getMonth()] + ' ' + view.getFullYear() + '</span>' +
        '<span><button type="button" class="xp-cal-arrow" data-xpnav="-1" aria-label="Previous month"' + (canPrev ? '' : ' disabled') + '>' + chev(-1) + '</button>' +
        '<button type="button" class="xp-cal-arrow" data-xpnav="1" aria-label="Next month">' + chev(1) + '</button></span></div>' +
        '<div class="xp-cal-grid">' + DOW.map(function (d) { return '<span class="xp-cal-dow" aria-hidden="true">' + d.charAt(0) + '</span>'; }).join('');
      for (var i = 0; i < lead; i++) h += '<span></span>';
      for (var d = 1; d <= days; d++) {
        var dt = new Date(view.getFullYear(), view.getMonth(), d), past = dt < today, sel = sameDay(dt, s.day), tod = sameDay(dt, today);
        var tab = inView ? sel : d === 1;   /* one day in the grid takes Tab */
        h += '<button type="button" class="xp-cal-day' + (sel ? ' sel' : '') + (tod ? ' today' : '') + '" data-xpday="' + key(dt) + '"' +
          (past ? ' disabled' : '') + ' tabindex="' + (tab ? 0 : -1) + '" aria-pressed="' + sel + '"' + (tod ? ' aria-current="date"' : '') +
          ' aria-label="' + fmtLong(dt) + (tod ? ', today' : '') + '">' + d + '</button>';
      }
      el.innerHTML = h + '</div>';
      if (focusKey) { var f = el.querySelector('[data-xpday="' + focusKey + '"]'); if (f) f.focus(); }
      else if (navFocus) { var n = el.querySelector('[data-xpnav="' + navFocus + '"]:not([disabled])') || el.querySelector('[data-xpnav]:not([disabled])'); if (n) n.focus(); }
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.xpnav) { view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.xpnav), 1); render(); return; }
      if (b.dataset.xpday) { b.focus(); model.setDay(fromKey(b.dataset.xpday)); }
    });
    el.addEventListener('keydown', function (e) {
      var b = e.target.closest('[data-xpday]'), mv = b && { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!mv) return;
      e.preventDefault();
      var to = addDays(fromKey(b.dataset.xpday), mv);
      if (to >= sod(now())) model.setDay(to);
    });
    /* The month shown follows the picked day; the arrows move it on their own */
    model.on(function (st) { view = new Date(st.day.getFullYear(), st.day.getMonth(), 1); render(); });
  }

  /* ---------- The two-ring clock ---------- */
  var NS = 'http://www.w3.org/2000/svg', RH = 58, RM = 100, SPLIT = 80;
  function pt(a, r) { var t = a * Math.PI / 180; return [128 + r * Math.sin(t), 128 - r * Math.cos(t)]; }
  function fix(n) { return Math.round(n * 10) / 10; }
  function dial(host, model) {
    var svg = document.createElementNS(NS, 'svg'), ring = null;
    svg.setAttribute('viewBox', '0 0 256 256'); svg.setAttribute('class', 'xp-dial'); svg.setAttribute('tabindex', '0');
    svg.setAttribute('role', 'slider'); svg.setAttribute('aria-label', 'Time. Up and down change the hour, left and right the minutes.');
    host.appendChild(svg);
    function render() {
      var s = model.s, ha = (s.h % 12) * 30 + s.m / 2, hk = pt((s.h % 12) * 30, RH), mk = pt(s.m * 6, RM), tip = pt(ha, RH - 18);
      var g = '<circle class="face" cx="128" cy="128" r="124"/><circle class="ring-in" cx="128" cy="128" r="' + SPLIT + '"/>';
      for (var t = 0; t < 60; t++) if (t % 5) { var a = pt(t * 6, 118), b = pt(t * 6, 114); g += '<line class="tick" x1="' + fix(a[0]) + '" y1="' + fix(a[1]) + '" x2="' + fix(b[0]) + '" y2="' + fix(b[1]) + '"/>'; }
      g += '<line class="hand minute-hand" x1="128" y1="128" x2="' + fix(mk[0]) + '" y2="' + fix(mk[1]) + '"/>' +
        '<line class="hand hour-hand" x1="128" y1="128" x2="' + fix(tip[0]) + '" y2="' + fix(tip[1]) + '"/><circle class="hub" cx="128" cy="128" r="5"/>' +
        '<circle class="knob knob-m" cx="' + fix(mk[0]) + '" cy="' + fix(mk[1]) + '" r="16"/>' + (s.m % STEP ? '<circle class="knob-dot" cx="' + fix(mk[0]) + '" cy="' + fix(mk[1]) + '" r="3"/>' : '') +
        '<circle class="knob knob-h" cx="' + fix(hk[0]) + '" cy="' + fix(hk[1]) + '" r="17"/>';
      for (var i = 0; i < 12; i++) {
        var hp = pt(i * 30, RH), mp = pt(i * 30, RM), hv = i || 12;
        g += '<text class="num hr' + (hv === h12(s.h) ? ' on' : '') + '" x="' + fix(hp[0]) + '" y="' + fix(hp[1]) + '">' + hv + '</text>';
        g += '<text class="num mn' + (i * 5 === s.m ? ' on' : '') + '" x="' + fix(mp[0]) + '" y="' + fix(mp[1]) + '">' + pad(i * 5) + '</text>';
      }
      svg.innerHTML = g;
      svg.setAttribute('aria-valuetext', fmtTime(s.h, s.m));
    }
    function pick(e) {
      var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 256 - 128, y = (e.clientY - r.top) / r.height * 256 - 128;
      var a = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360, s = model.s;
      if (!ring) ring = Math.sqrt(x * x + y * y) > SPLIT ? 'm' : 'h';   /* a drag stays on the ring it started on */
      if (ring === 'h') model.setTime(Math.round(a / 30) % 12 + (s.h >= 12 ? 12 : 0), s.m);
      else model.setTime(s.h, (Math.round(a / 6 / STEP) * STEP) % 60);
    }
    svg.addEventListener('pointerdown', function (e) { ring = null; svg.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); svg.focus(); });
    svg.addEventListener('pointermove', function (e) { if (ring) pick(e); });
    svg.addEventListener('pointerup', function () { ring = null; });
    svg.addEventListener('pointercancel', function () { ring = null; });
    svg.addEventListener('keydown', function (e) {
      var s = model.s;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); model.setTime(s.h + (e.key === 'ArrowUp' ? 1 : -1), s.m); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); model.setTime(s.h, (Math.round(s.m / STEP) * STEP + (e.key === 'ArrowRight' ? STEP : -STEP) + 60) % 60); }
    });
    model.on(render);
    return svg;
  }

  /* Typed time: "3", "330", "3:30p", "15:30", "330 pm". Without am/pm, the hour keeps the current half of the day. */
  function parse(v, cur) {
    var x = v.trim().toLowerCase().replace(/\s+/g, ''), ap = /p/.test(x) ? 'pm' : /a/.test(x) ? 'am' : null;
    var mm = /^(\d{1,2})(?::?(\d{2}))?$/.exec(x.replace(/[apm.]/g, '')); if (!mm) return null;
    var h = +mm[1], mi = mm[2] ? +mm[2] : 0; if (h > 23 || mi > 59) return null;
    if (h > 12 || h === 0) return { h: h, m: mi };
    if (ap) return { h: h % 12 + (ap === 'pm' ? 12 : 0), m: mi };
    return { h: h % 12 + (cur >= 12 ? 12 : 0), m: mi };
  }

  /* ---------- The whole picker ---------- */
  function mount(el) {
    var m = Model(), calOpen = false;
    el.innerHTML =
      '<div class="xp-days" role="group" aria-label="Day"></div>' +
      '<div class="xp-calwrap" hidden></div>' +
      '<div class="xp-body"><div class="xp-dialhost"></div>' +
        '<div class="xp-side">' +
          '<div class="xp-read"><input class="xp-time" type="text" autocomplete="off" spellcheck="false" aria-label="Time">' +
            '<div class="xp-ap" role="group" aria-label="AM or PM"></div></div>' +
          '<div class="xp-qts" role="group" aria-label="Common times"></div>' +
          '<p class="xp-why" aria-live="polite"></p>' +
        '</div></div>' +
      '<div class="xp-foot"><p class="xp-summary"></p><button type="button" class="btn primary" data-sched="exact-go">Schedule for this time</button></div>';
    var q = function (c) { return el.querySelector(c); };
    var daysEl = q('.xp-days'), calWrap = q('.xp-calwrap'), ti = q('.xp-time'), apEl = q('.xp-ap'), qts = q('.xp-qts'), why = q('.xp-why'), go = q('[data-sched="exact-go"]');
    calendar(calWrap, m);
    var svg = dial(q('.xp-dialhost'), m);

    daysEl.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.xpother) {
        calOpen = !calOpen; calWrap.hidden = !calOpen; m.emit();
        var f = calOpen ? calWrap.querySelector('.xp-cal-day.sel') : daysEl.querySelector('[data-xpother]'); if (f) f.focus();
        return;
      }
      m.setDay(fromKey(b.dataset.xpchip));
    });
    qts.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && !b.disabled) m.setTime(+b.dataset.h, +b.dataset.m); });
    apEl.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; var s = m.s;
      if (b.dataset.ap === 'am' && s.h >= 12) m.setTime(s.h - 12, s.m);
      if (b.dataset.ap === 'pm' && s.h < 12) m.setTime(s.h + 12, s.m);
      apEl.querySelector('[data-ap="' + b.dataset.ap + '"]').focus();
    });
    why.addEventListener('click', function (e) { if (e.target.closest('button')) m.reset(); });
    ti.addEventListener('change', function () { var t = parse(ti.value, m.s.h); if (t) m.setTime(t.h, t.m); else ti.value = h12(m.s.h) + ':' + pad(m.s.m); });
    ti.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ti.blur(); } });

    m.on(function (s) {
      /* Day chips: the coming week, then Other day */
      var t = sod(now()), inStrip = false, fk = daysEl.contains(document.activeElement) ? (document.activeElement.dataset.xpchip || (document.activeElement.dataset.xpother ? 'other' : '')) : '', h = '';
      for (var i = 0; i < WEEK; i++) {
        var d = addDays(t, i), sel = sameDay(d, s.day); if (sel) inStrip = true;
        h += '<button type="button" class="xp-chip" data-xpchip="' + key(d) + '" aria-pressed="' + sel + '" aria-label="' + fmtLong(d) + '"><b>' + (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DOW[d.getDay()]) + '</b><span>' + MON[d.getMonth()] + ' ' + d.getDate() + '</span></button>';
      }
      h += '<button type="button" class="xp-chip other" data-xpother="1" aria-expanded="' + calOpen + '" aria-pressed="' + !inStrip + '"><b>Other day</b><span>' + (inStrip ? 'Pick' : MON[s.day.getMonth()] + ' ' + s.day.getDate()) + '</span></button>';
      daysEl.innerHTML = h;
      if (fk) { var f = daysEl.querySelector(fk === 'other' ? '[data-xpother]' : '[data-xpchip="' + fk + '"]'); if (f) f.focus(); }

      if (document.activeElement !== ti) ti.value = h12(s.h) + ':' + pad(s.m);
      var pm = s.h >= 12;
      apEl.innerHTML = '<button type="button" data-ap="am" aria-pressed="' + !pm + '">AM</button><button type="button" data-ap="pm" aria-pressed="' + pm + '">PM</button>';
      var n = now(), today = sameDay(s.day, n);
      qts.innerHTML = QUICK.map(function (c) {
        var gone = today && new Date(s.day.getFullYear(), s.day.getMonth(), s.day.getDate(), c[0], c[1]) <= n;
        return '<button type="button" class="xp-qt" data-h="' + c[0] + '" data-m="' + c[1] + '"' + (gone ? ' disabled' : '') + ' aria-pressed="' + (s.h === c[0] && s.m === c[1]) + '">' + c[2] + '</button>';
      }).join('');

      var past = m.past(), back = '<button type="button" class="linkbtn">Back to the default</button>';
      why.innerHTML = past ? '<span class="xp-warn">That time has already gone by.</span>' + (s.touched ? ' ' + back : '')
        : s.touched ? 'Your time. ' + back : 'Default: ' + s.why + '.';
      q('.xp-summary').textContent = 'Comes back ' + rel(s.day) + ' at ' + fmtTime(s.h, s.m);
      go.disabled = past;
    });
    m.setDay(now());
    return { at: m.at, past: m.past, focus: function () { var c = daysEl.querySelector('[aria-pressed="true"]'); (c || svg).focus(); } };
  }

  window.ExactPicker = { mount: mount, defaultFor: defaultFor, parse: parse };
})();
