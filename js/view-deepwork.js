/* Deep Work: a mode for doing, separate from Triage (spikes/deep-work). Triage only decides; tasks that need
   you and take real time go to the Deep Work pool (state deepwork), and you start a session from the Guide whenever
   you have time. Say how long and what for, then one task at a time until you stop. Breaks are planned in
   (25 on, 5 off, 15 after three), and every time interruption takes over the screen.

   The session lives here, in the page: the clock, breaks and the plan. What happens to a task is the core's:
   finishing it marks it done, Done for now keeps where you left off, and a stuck one goes back to Triage. */
(function () {
  var V = {}, esc = UI.esc;
  var root = null, view = null, unsub = null, keyFn = null, timer = 0;

  /* ---------- Time ---------- */
  var WORK = 25 * 60, SHORT = 5 * 60, LONG = 15 * 60, GRACE = 5 * 60, BODY = 90 * 60, ARM_MS = 1000, BUFFER = 5;
  var BREAK_IDEAS = ['Stand up and stretch your arms over your head.', 'Get a glass of water.', 'Look at something far away for a minute.', 'Walk to another room and back.'];
  /* ?dwspeed=60 runs the session clock faster, to see breaks and takeovers without waiting */
  var SPEED = (function () { var m = /[?&]dwspeed=(\d+)/.exec(location.search); return m ? Math.max(1, +m[1]) : 1; })();

  function dur(min) {
    min = Math.round(min);
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;   /* "1 h", "1½ h", "2 h": to the nearest half hour */
    return m >= 45 ? (h + 1) + ' h' : h + (m >= 15 ? '½' : '') + ' h';
  }
  function fmt(d) { var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (m ? ':' + ('0' + m).slice(-2) : '') + ap; }

  /* ---------- The session ---------- */
  var S = null;        /* the session, kept while you visit other pages */
  var E = fresh();     /* the Guide: where to start, how long */
  /* pick: what's picked on the Guide ('triage', a task id, 'typed', or null for Fuzz's suggestion); typed: Something
     else's text; link: what a calendar link set (docs/nav-guide.md); recap: how the last session went, said once */
  function fresh() { return { choice: null, budget: 50, query: '', alt: 0, want: null, hideClock: false, until: null, asked: false, pick: null, typed: '', link: null, linkUntil: false, gone: null, recap: null, next: null, more: false }; }
  function inSession() { return !!S && (S.view === 'focus' || S.view === 'between'); }

  /* The pool, in Fuzz's order: where you left off first, then what fits the time, then the rest */
  function pool() { return Store.inState('deepwork'); }
  var CLOSED = ['done', 'dropped', 'letgo', 'resolved'];
  function isOpen(it) { return !!it && CLOSED.indexOf(it.state) < 0; }
  /* What a link can start Deep Work on: already in My work, or one the core can move there (in Triage, or booked
     and scheduled). One Fuzz is working on, or waiting on someone, isn't yours to start. */
  var STARTABLE = ['deepwork', 'triage', 'scheduled'];
  /* How long it takes: the core's estimate; the demo's minutes; else about half an hour (a live task with no estimate) */
  function est(it) { return Math.max(5, it.effortMins || (it.coreId == null && it.mins) || 30); }
  function task() { return S && S.task ? Store.item(S.task.id) || S.task : null; }

  /* ---------- Your next meeting: when the free time you're in ends ---------- */
  function loadUntil() {
    if (E.linkUntil) return Promise.resolve();   /* a calendar link already said when the block ends */
    if (Live.on()) {
      return Live.deepWorkInfo().then(function (r) { E.until = r && r.free_until ? new Date(r.free_until) : null; }, function () { E.until = null; });
    }
    /* The demo pretends your next meeting is on the next hour at least 45 minutes away */
    var d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    if (d - Date.now() < 45 * 60000) d.setHours(d.getHours() + 1);
    E.until = d; return Promise.resolve();
  }
  function minsTo(d) { return d ? (d - Date.now()) / 60000 : null; }
  function meetingIn() { var m = minsTo(E.until); return m != null && m > 0 ? m : null; }

  /* Time choices people think in: "until 2pm", "a quick burst". The minutes stay underneath. */
  function chips() {
    var out = [], mt = meetingIn();
    if (mt != null && mt > 15) { var mm = Math.floor((mt - BUFFER) / 5) * 5; out.push({ v: 'cal', min: mm, l: 'Until ' + fmt(E.until), sub: '~' + dur(mm) + (E.linkUntil ? ' · your calendar block' : ', then your next meeting') }); }
    [{ v: 25, l: 'A quick burst' }, { v: 50, l: 'A real chunk' }, { v: 90, l: 'A long haul' }].forEach(function (c) {
      if (mt != null && c.v > mt - BUFFER) return;                                   /* would run into the meeting */
      if (out[0] && out[0].v === 'cal' && Math.abs(out[0].min - c.v) <= 10) return;  /* too close to "until 2pm" */
      out.push({ v: c.v, min: c.v, l: c.l, sub: c.v + ' min' });
    });
    out.push({ v: -1, min: -1, l: 'Until I stop', sub: mt != null ? 'Fuzz still stops you before ' + fmt(E.until) : 'No end time' });
    return out;
  }
  function setChoice(v) {
    var cs = chips(), pick = function (x) { return cs.filter(function (c) { return c.v === x; })[0]; };
    var c = pick(v) || pick('cal') || pick(50) || cs[0];
    E.choice = c.v; E.budget = c.min;
  }
  /* Breaks are planned into the time you give, in one line */
  function plan(b) {
    var mt = meetingIn();
    if (b < 0) return 'No end time. A short break every 25 minutes' + (mt != null ? ', and Fuzz stops you 5 minutes before ' + fmt(E.until) + '.' : '.');
    var t = 0, blocks = 0, breaks = 0;
    while (t < b) {
      var w = Math.min(25, b - t); if (b - t - w < 10) w = b - t;
      blocks++; t += w; if (t < b) { breaks++; t += 5; }
    }
    return blocks + ' work ' + (blocks === 1 ? 'block' : 'blocks') + (breaks ? ' and ' + breaks + ' short ' + (breaks === 1 ? 'break' : 'breaks') : ', no break needed') +
      ', done by ' + fmt(new Date(Date.now() + b * 60000)) + '.';
  }
  function leftMin() { return S && isFinite(S.budgetEnd) ? Math.max(0, (S.budgetEnd - S.clock) / 60) : Infinity; }
  function fits(it) {
    var left = S && inSession() ? leftMin() : (E.budget > 0 ? E.budget : Infinity);
    return est(it) <= left ? UI.pill('Fits', 'ok') : UI.pill('First part fits', 'muted');
  }

  /* ---------- What to work on: one box, Fuzz's pick in the placeholder ---------- */
  function ready(exclude) {
    var left = S && inSession() ? leftMin() : (E.budget > 0 ? E.budget : Infinity);
    var c = pool().filter(function (it) { return !exclude || it.id !== exclude.id; });
    /* the one you came for (a calendar link, Work on this) goes first, whatever its open state: a booked task
       is scheduled, or back in Triage, when its block starts */
    var w = E.want && Store.item(E.want), want = w && STARTABLE.indexOf(w.state) > -1 && (!exclude || w.id !== exclude.id) ? [w] : [];
    c = c.filter(function (it) { return want.indexOf(it) < 0; });
    var res = c.filter(function (it) { return it.leftOff; }), rest = c.filter(function (it) { return !it.leftOff; });
    var fit = rest.filter(function (it) { return est(it) <= left; }), big = rest.filter(function (it) { return est(it) > left; });
    return want.concat(res, fit, big);
  }
  var MOODS = [[/^(something )?(light|easy|quick|small|short)( one| thing)?$/i, 'light'], [/^(anything|any|you pick|whatever|surprise me|idk|dunno|fuzz'?s pick)$/i, 'any']];
  var STOP = ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'some', 'work', 'doc'];
  function candidates(q) {
    q = (q || '').trim();
    var ex = S && S.task, all = ready(ex);
    if (!q) return all.map(function (it, i) { return { t: it, why: it.id === E.want ? 'The one you picked' : it.leftOff ? 'Pick up where you left off' : i === 0 ? 'Fuzz’s pick' : 'Also ready' }; });
    var mood = MOODS.filter(function (m) { return m[0].test(q); })[0];
    if (mood && mood[1] === 'light') return all.slice().sort(function (a, b) { return est(a) - est(b); }).map(function (it, i) { return { t: it, why: i ? 'Also light' : 'The lightest one' }; });
    if (mood) return all.map(function (it, i) { return { t: it, why: i ? 'Also ready' : 'Fuzz’s pick' }; });
    /* A match needs at least half of what you typed, so something new isn't mistaken for a task that shares a word */
    var words = q.toLowerCase().split(/\W+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; });
    var need = Math.max(1, Math.ceil(words.length / 2));
    var hits = all.map(function (it) {
      var hay = (it.title + ' ' + (it.nextStep || '')).toLowerCase();
      return { t: it, score: words.filter(function (w) { return new RegExp('\\b' + w).test(hay); }).length };
    }).filter(function (x) { return x.score >= need; }).sort(function (a, b) { return b.score - a.score; })
      .map(function (x) { return { t: x.t, why: x.t.leftOff ? 'Picks up where you left off' : 'In My work' }; });
    return hits.concat([{ free: q, why: 'A new task, started now' }]);
  }
  function current() { var c = candidates(E.query); return c.length ? c[((E.alt % c.length) + c.length) % c.length] : null; }
  function boxHTML() {
    var d = candidates('')[0];
    var ph = d ? (d.t.leftOff ? 'Pick up “' + d.t.title + '”? Or type anything…' : '“' + d.t.title + '”? Or type anything…') : 'Type what you want to work on…';
    return '<label class="dw-askwhat" for="dw-what">What do you want to work on?</label>' +
      '<input class="dw-what" id="dw-what" value="' + esc(E.query) + '" placeholder="' + esc(ph) + '" autocomplete="off" aria-describedby="dw-match">' +
      '<div class="dw-match" id="dw-match" aria-live="polite">' + matchHTML() + '</div>';
  }
  function matchHTML() {
    var c = candidates(E.query), it = current(); if (!it) return '<p class="dw-msub">Nothing is in My work yet. Type anything to start on it, or say “I’ll do it” to a task in Triage (G).</p>';
    var i = ((E.alt % c.length) + c.length) % c.length;
    var more = c.length > 1 ? '<span class="dw-cycle">↓ another · ' + (i + 1) + ' of ' + c.length + '</span>' : '';
    if (it.free) return '<button type="button" class="dw-mrow" id="dw-mrow"><span class="dw-mt">“' + esc(it.free) + '”</span>' + UI.pill('New', 'accent') + '</button><div class="dw-msub">' + esc(it.why) + more + '</div>';
    return '<button type="button" class="dw-mrow" id="dw-mrow"><span class="dw-mt">' + esc(it.t.title) + '</span>' + fits(it.t) + '<span class="dw-est">~' + dur(est(it.t)) + '</span></button>' +
      '<div class="dw-msub">' + esc(it.why) + (it.t.leftOff && /^Pick/.test(it.why) ? ': ' + esc(it.t.leftOff) : '') + more + '</div>';
  }
  function pickCurrent(onPick) {
    var it = current(); if (!it) { var w = $('#dw-what'); if (w) w.focus(); return; }
    onPick(it.free ? Store.captureDeep(it.free) : it.t);
  }
  function wireBox(onPick) {
    var input = $('#dw-what'); if (!input) return;
    function refresh() { $('#dw-match').innerHTML = matchHTML(); var m = $('#dw-mrow'); if (m) m.onclick = function () { pickCurrent(onPick); }; }
    input.oninput = function () { E.query = input.value; E.alt = 0; refresh(); };
    input.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); E.alt++; refresh(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); E.alt--; refresh(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pickCurrent(onPick); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.blur(); }
    };
    refresh();
  }

  /* ---------- Fuzz ---------- */
  var settleT = 0;
  /* Only from this page's perch: a break that ends while you're on Triage mustn't talk through its Fuzz */
  function say(text, mood) { if (!root) return; Fuzz.say(text, { type: false }); if (mood) Fuzz.setMood(mood); }
  function settle(ms) { clearTimeout(settleT); settleT = setTimeout(function () { if (root && S && S.view === 'focus' && !S.sheet && !S.take) Fuzz.setMood('idle'); }, ms || 1500); }
  function paintPool() { var p = $('.dw-pool'), n = pool().length + ' in My work'; if (p && p.textContent !== n) p.textContent = n; }
  function $(s) { return root ? root.querySelector(s) : null; }

  /* ---------- Views ---------- */
  function render() {
    if (!root) return;
    if (!task() && S && S.view === 'focus') S.view = 'between';
    var v = S ? S.view : 'entry';
    root.querySelector('.dw').classList.toggle('dw-focus', v === 'focus');
    root.querySelector('.dw').classList.toggle('dw-guide', v === 'entry');
    $('#dw-mode').textContent = { entry: 'Guide', focus: 'My work', between: 'My work', wrap: 'My work: wrapping up' }[v];
    ({ entry: vGuide, focus: vFocus, between: vBetween, wrap: vWrap })[v]();
    if (window.App && App.paintLabel) App.paintLabel();
    paintFoot(v === 'focus');
    paintPool(); paintBar();
    if (S && S.take) renderTake();
  }

  /* ---------- The key guide (? anywhere in Deep Work), like Triage's: it opens on the keys for where you
     are, and All keys is one tap further. Kept by hand next to onKey, which is what they describe. ---------- */
  var KEYS = [
    ['entry', 'The Guide', [['↑ ↓', 'Move through the list'], ['1 – 9', 'Pick a row'], ['Enter', 'Start what’s picked'], ['/', 'Something else: tell me what']]],
    ['focus', 'Working on a task', [['D', 'Finished it'], ['S', 'I’m stuck: options to make it easier'], ['B', 'Break now'], ['E', 'Tell Fuzz (Enter hands it over with your note)'], ['T', 'Park a stray thought (Esc closes it)'], ['Esc', 'Done for now']]],
    ['stuck', 'When you’re stuck', [['1', 'Show me the sources'], ['2', 'Switch to something else (your place is kept)'], ['3', 'Hand it to Fuzz'], ['4', 'Send it back to Triage'], ['Esc', 'Never mind']]],
    ['between', 'Between tasks', [['Enter', 'Go on to the next one (or Stop here, when it’s the only choice)'], ['O', 'Something else'], ['Esc', 'Stop here (or close the box)']]],
    ['wrap', 'Wrapping up', [['Enter', 'Wrap up and go to the Guide'], ['Esc', 'Actually, keep going']]],
    ['take', 'Breaks and time’s up', [['1 – 4', 'The choices on screen'], ['Enter', 'The highlighted one']]],
    ['any', 'Anywhere', [['?', 'This list']]]
  ];
  function keyRows(list) { return '<dl class="keylist">' + list.map(function (k) { return '<div><dt><kbd>' + k[0] + '</kbd></dt><dd>' + esc(k[1]) + '</dd></div>'; }).join('') + '</dl>'; }
  function openKeys() {
    var d = $('#dw-keysdlg'); if (!d || d.open) return;
    var where = !S ? 'entry' : S.view === 'focus' && S.sheet ? 'stuck' : S.view;
    var g = KEYS.filter(function (x) { return x[0] === where; })[0];
    $('#dw-keys-now').innerHTML = g ? '<h3>Right now</h3>' + keyRows(g[2]) : '';
    d.querySelector('.keys-all').open = !g;
    d.showModal();
  }

  /* ---------- Under the card: Tell Fuzz, park a thought, the clock on or off (like Triage's links) ---------- */
  function footHTML() {
    return '<div class="triage-foot dw-foot" id="dw-foot"><span class="dw-footfocus" id="dw-footfocus" hidden>' +
      '<button type="button" class="linkbtn" id="dw-tellbtn" aria-expanded="false" aria-controls="dw-tellform" aria-keyshortcuts="E">Tell Fuzz<kbd aria-hidden="true">E</kbd></button><span aria-hidden="true">·</span>' +
      '<button type="button" class="linkbtn" id="dw-parkbtn" aria-expanded="false" aria-controls="dw-parkform" aria-keyshortcuts="T">Park a stray thought<kbd aria-hidden="true">T</kbd></button><span aria-hidden="true">·</span>' +
      '<button type="button" class="linkbtn" id="dw-clocktoggle"></button>' +
      '<span class="dw-parked" id="dw-parked" role="status"></span><span class="keys-sep" aria-hidden="true">·</span></span>' +
      '<button type="button" class="linkbtn keys-link" id="dw-keysbtn" aria-keyshortcuts="?">Keys</button></div>' +
      '<dialog class="dlg keys-dlg" id="dw-keysdlg" aria-labelledby="dw-keys-h"><div class="dlg-in"><div class="dlg-top"><h2 id="dw-keys-h">Keys</h2><button type="button" class="iconbtn" data-close aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<section id="dw-keys-now"></section><details class="keys-all"><summary>All keys</summary>' + KEYS.map(function (g) { return '<section><h3>' + g[1] + '</h3>' + keyRows(g[2]) + '</section>'; }).join('') + '</details>' +
        '<p class="meta">Nothing is sent or finished by accident: a time screen waits a moment before its keys work.</p></div></dialog>' +
      '<form class="parkform" id="dw-tellform" hidden><label for="dw-telltext">Tell Fuzz about this task</label>' +
        '<div class="parkrow"><input id="dw-telltext" type="text" autocomplete="off" aria-describedby="dw-tellhint" placeholder="What you want done, or what Fuzz should know"></div>' +
        '<div class="parkrow dw-tellrow"><button class="btn primary" type="submit" id="dw-handit">Hand it to Fuzz</button><button class="btn" type="button" id="dw-noteit">Just save the note</button></div>' +
        '<p class="parkhint" id="dw-tellhint">Hand it over and Fuzz takes it from here with what you wrote, and you go on to the next one. Or save the note on the task and keep working.</p></form>' +
      '<form class="parkform" id="dw-parkform" hidden><label for="dw-parktext">Park it without leaving this task</label><div class="parkrow"><input id="dw-parktext" type="text" autocomplete="off" aria-describedby="dw-parkhint" placeholder="A stray thought, in a few words"><button class="btn" type="submit">Park</button></div>' +
        '<p class="parkhint" id="dw-parkhint">It goes to Parked and you stay on this task.</p></form>';
  }
  function paintFoot(on) {
    var f = $('#dw-footfocus'); if (!f) return;
    f.hidden = !on;
    if (!on) { closeForm('dw-tellform', 'dw-tellbtn', true); closeForm('dw-parkform', 'dw-parkbtn', true); }
    $('#dw-clocktoggle').textContent = S && S.hideClock ? 'Show time' : 'Hide time';
    $('#dw-parked').textContent = S && S.thoughts ? S.thoughts + ' parked ✓' : '';
  }
  function openForm(form, btn, input) {
    var other = form === 'dw-tellform' ? ['dw-parkform', 'dw-parkbtn'] : ['dw-tellform', 'dw-tellbtn'];
    closeForm(other[0], other[1], true);
    $('#' + form).hidden = false; $('#' + btn).setAttribute('aria-expanded', 'true'); $('#' + input).focus();
  }
  function closeForm(form, btn, quiet) {
    var f = $('#' + form), b = $('#' + btn); if (!f || f.hidden) return;
    f.hidden = true; b.setAttribute('aria-expanded', 'false'); if (!quiet) b.focus();
  }
  function wireFoot() {
    $('#dw-tellbtn').onclick = function () { if ($('#dw-tellform').hidden) openForm('dw-tellform', 'dw-tellbtn', 'dw-telltext'); else closeForm('dw-tellform', 'dw-tellbtn'); };
    $('#dw-parkbtn').onclick = function () { if ($('#dw-parkform').hidden) openForm('dw-parkform', 'dw-parkbtn', 'dw-parktext'); else closeForm('dw-parkform', 'dw-parkbtn'); };
    $('#dw-keysbtn').onclick = openKeys;
    var kd = $('#dw-keysdlg');
    kd.addEventListener('click', function (e) { if (e.target === e.currentTarget || e.target.closest('[data-close]')) kd.close(); });
    kd.addEventListener('close', function () { var b = $('#dw-keysbtn'); if (b && b.offsetParent) b.focus(); });
    $('#dw-clocktoggle').onclick = function () { if (!S) return; S.hideClock = !S.hideClock; paintFoot(inSession() && S.view === 'focus'); paintBar(); };
    $('#dw-parkform').onsubmit = function (e) {
      e.preventDefault(); var inp = $('#dw-parktext'), v = inp.value.trim(); if (!v || !S) return;
      Store.parkThought(v); S.thoughts++; inp.value = '';
      closeForm('dw-parkform', 'dw-parkbtn'); paintFoot(true);
      say('Parked. It’s in Parked when you’re done.', 'happy'); settle();
    };
    /* Hand it to Fuzz with what you wrote (the note goes first, so Fuzz reads it), or only save the note */
    $('#dw-tellform').onsubmit = function (e) {
      e.preventDefault(); var it = task(); if (!it || S.take) return;
      var note = $('#dw-telltext').value.trim(); $('#dw-telltext').value = '';
      closeForm('dw-tellform', 'dw-tellbtn', true); S.sheet = null;
      var ch = Store.track([it.id], function () { if (note) Store.tell(it.id, note); Store.handToFuzz(it.id); });
      Say.offerUndo('Handed “' + it.title + '” to Fuzz from My work.', function () { return ch.undo(); }, null, ch.blocked);
      toBetween('handed');
    };
    $('#dw-noteit').onclick = function () {
      var it = task(), inp = $('#dw-telltext'), note = inp.value.trim();
      if (!it) return; if (!note) { inp.focus(); return; }
      Store.tell(it.id, note); inp.value = '';
      closeForm('dw-tellform', 'dw-tellbtn');
      say('Noted. It’s on the task for whoever picks it up next.', 'happy'); settle();
    };
  }

  /* ---------- The Guide: the one starting place (docs/nav-guide.md) ----------
     Fuzz's line on top suggests where to start; then one question, "Where do you want to start?", over one list:
     Triage, the top of My work, and Something else, with the rest of My work behind a button. Picking a task or
     Something else asks how long. */
  var GUIDE_ROWS = 3;   /* rows before Something else, Triage included */
  function triageN() { return Store.get().queue.length + (Onboard.hasQuestion() && !Store.get().queue.length ? 1 : 0); }
  function triageUrgent() { return Store.queue().some(function (it) { return !!it.dueAt; }); }
  function triageMins() { return Math.max(2, Math.round(triageN() * 1.5)); }
  function short(t) { var w = (t || '').split(/\s+/); return w.length > 5 ? w.slice(0, 5).join(' ') + '…' : t; }
  /* The rows under My work, in Fuzz's order: the one you came for, where you left off, then what fits the time */
  function guideTasks() { return ready(null); }
  /* Fuzz reads the moment and suggests where to start */
  function suggestion() {
    var n = triageN(), urgent = triageUrgent(), tasks = guideTasks(), r = E.recap || E.ended;   /* how the last session ended, until you leave the Guide */
    var top = tasks[0] ? tasks[0].id : null, triage = n ? 'triage' : top || 'typed';
    var deep = top || (n ? 'triage' : 'typed');
    if (r && r.why === 'meeting') return { pick: triage, why: 'Go, your ' + (r.at || 'meeting') + ' is starting. Triage will be here when you’re back.' };
    if (r && r.why === 'time') return { pick: triage, why: 'Good stretch. Take a break, then a quick look at Triage.' };
    if (urgent) return { pick: 'triage', why: 'Something has a time on it. Let’s clear Triage first. It’s quick.' };
    if (n >= 5) return { pick: 'triage', why: 'A few things are waiting. Ten minutes of Triage first, then you’ll have room to get into your work.' };
    if (top) return { pick: top, why: (meetingIn() != null ? 'You’ve got until ' + fmt(E.until) + ' and nothing urgent.' : 'Nothing urgent.') + ' Good time to get into your work.' };
    if (n) return { pick: 'triage', why: 'Nothing big waiting. A quick look at Triage and you’re clear.' };
    return { pick: deep, why: 'Nothing is waiting on you. What do you want to work on? Tell me and I’ll make it a task.' };
  }
  function picked(sug) {
    var p = E.pick;
    if (p === 'none') return null;   /* a work link with no task: the time is set, and nothing is picked */
    if (p === 'triage' && !triageN()) p = null;   /* Triage cleared while you were looking */
    if (p && p !== 'triage' && p !== 'typed' && !guideTasks().some(function (it) { return it.id === p; })) p = null;
    return p || (sug || suggestion()).pick;
  }
  function pickedTask(p) { return p && p !== 'triage' && p !== 'typed' ? Store.item(p) : null; }
  function tag(on) { return on ? '<span class="g-tag">Fuzz suggests</span>' : ''; }
  function radio(id, on, inner, attrs) {
    return '<li role="none"><div role="radio" class="g-row" tabindex="' + (on ? 0 : -1) + '" aria-checked="' + on + '" data-pick="' + esc(id) + '"' + (attrs || '') + '><span class="g-radio" aria-hidden="true"></span>' + inner + '</div></li>';
  }
  function typedMatch(txt) {
    if (!txt.trim()) return null;
    var hit = candidates(txt).filter(function (c) { return c.t; })[0];
    return hit ? hit.t : null;
  }
  function typedHint(txt) {
    var m = typedMatch(txt);
    if (m) return 'That sounds like “' + esc(m.title) + '”, and it’s ready. <button type="button" class="linkbtn" data-use="' + esc(m.id) + '">Use that</button>';
    return txt.trim() ? 'New. I’ll make it a task and pull in anything that goes with it.' : 'Not on the list? Tell me';
  }
  function startLabel(p) {
    if (p === 'triage') return 'Start Triage';
    if (p === 'typed') return E.typed.trim() ? 'Start: ' + short(E.typed.trim()) : 'Tell me what first';
    var it = pickedTask(p); return it ? 'Start: ' + short(it.title) : 'Pick where to start';
  }
  function fitLine(p) {
    var it = pickedTask(p), mins = it ? est(it) : 30, left = E.budget > 0 ? E.budget : Infinity;
    return (mins <= left ? 'Fits in your time.' : 'Won’t fit in one go. I’ll stop you at a good place.') + ' ' + plan(E.budget);
  }
  function guideLine(sug, p) {
    var L = E.link, r = E.recap;
    if (E.gone) return E.gone;
    if (L && L.until) {
      var it = pickedTask(p);
      if (p === 'typed' && L.what) return 'Your calendar has this time for “' + L.what + '”, until ' + fmt(E.until) + '. It’s new, so I’ll set it up as you start.';
      if (it && L.task) return 'Your calendar has this time for “' + it.title + '”, until ' + fmt(E.until) + '. Everything’s ready.';
      return 'This is your work time, until ' + fmt(E.until) + '. Where do you want to start?';
    }
    /* a link with no time: what it was for, in Fuzz's words */
    if (L && L.task && pickedTask(p) && p === L.pick) return 'Here’s “' + pickedTask(p).title + '”. Everything’s ready when you are.';
    if (L && L.what && p === 'typed') return 'Here’s what you wanted to work on. It’s new, so I’ll set it up as you start.';
    if (r) {
      var head = r.finished ? 'You finished “' + r.title + '”.' : 'Nice: ' + dur(Math.max(1, r.mins)) + ' on “' + r.title + '”. ' + (r.booked ? 'It’s booked to finish ' + r.booked + '.' : 'I saved where you left off.');
      var came = r.came ? ' While you were in it: ' + r.came + ' new in Triage, ' + (r.urgent ? 'and one has a time on it.' : 'nothing urgent.') : '';
      return head + came + ' ' + sug.why;
    }
    return sug.why;
  }
  function vGuide() {
    var sug = suggestion(), n = triageN(), tasks = guideTasks();
    if (E.link && E.link.pick && (E.link.pick === 'typed' || tasks.some(function (it) { return it.id === E.link.pick; }))) sug = { pick: E.link.pick, why: sug.why };   /* what your calendar booked the time for */
    var p = picked(sug), deep = p && p !== 'triage';
    if (!E.asked) { say(guideLine(sug, p), E.recap && !E.recap.finished ? 'proud' : 'eager'); E.recap = null; E.gone = null; }
    E.asked = true;
    var typedOn = p === 'typed', txt = E.typed.trim();
    var triageRow = radio('triage', p === 'triage', '<span class="g-t"><b>Triage' + tag(sug.pick === 'triage') + '</b><small>' +
      (n ? (triageUrgent() ? 'One has a time on it. ' : '') + 'Quick decisions, I do the rest' : 'Nothing is waiting on you') + '</small></span><span class="g-m">' + (n ? '~' + triageMins() + ' min' : 'Clear') + '</span>',
      n ? '' : ' aria-disabled="true"');
    /* The top of My work, so the list stays short; what's picked always shows (a link or Work on this can pick
       one further down), in place of the last one */
    var shown = tasks;
    if (!E.more && tasks.length > GUIDE_ROWS - 1) {
      shown = tasks.slice(0, GUIDE_ROWS - 1);
      var byId = function (id) { return function (it) { return it.id === id; }; };
      if (p && !shown.some(byId(p))) { var further = tasks.filter(byId(p))[0]; if (further) shown[shown.length - 1] = further; }
    }
    var hidden = tasks.length - shown.length;
    var taskRows = shown.map(function (it) {
      var sub = it.leftOff ? 'Where you left off: ' + it.leftOff : it.state !== 'deepwork' ? (it.state === 'scheduled' ? 'Booked for this time' : 'Ready when you are') : it.aiNote ? 'Fuzz got it ready' : it.nextStep ? 'Next: ' + it.nextStep : 'Fuzz gets it ready as you start';
      return radio(it.id, p === it.id, '<span class="g-t"><b>' + esc(it.title) + tag(sug.pick === it.id) + '</b><small>' + esc(sub) + '</small></span><span class="g-m">~' + dur(est(it)) + '</span>');
    }).join('');
    /* Something else: picked, its title becomes the field, so you type right where "Something else" was */
    var typedRow = typedOn
      ? '<li role="none"><div role="radio" class="g-row g-typed" tabindex="-1" aria-checked="true" data-pick="typed"><span class="g-radio" aria-hidden="true"></span><span class="g-t">' +
        '<input type="text" class="g-field" id="g-typed" autocomplete="off" aria-label="Tell me what you want to work on" placeholder="Tell me what you want to work on" value="' + esc(E.typed) + '" aria-describedby="g-hint">' +
        '<small class="g-hint" id="g-hint" aria-live="polite">' + typedHint(E.typed) + '</small></span></div></li>'
      : radio('typed', false, '<span class="g-t"><b>' + (txt ? esc(txt) : 'Something else') + tag(sug.pick === 'typed') + '</b><small>' + (txt ? 'Something else, in your words' : 'Not on the list? Tell me') + '</small></span>');
    var can = p && (p !== 'typed' || txt);
    view.innerHTML = '<div class="dw-panel g-panel"><h1 class="dw-title g-q" id="g-q">Where do you want to start?</h1>' +
      '<ul class="g-list" role="radiogroup" aria-labelledby="g-q">' +
        '<li class="g-grp" role="presentation">Keep things moving</li>' + triageRow +
        '<li class="g-grp" role="presentation">My work</li>' + taskRows + typedRow + '</ul>' +
      (hidden ? '<button type="button" class="linkbtn g-more" id="g-more" aria-expanded="false">More from My work (' + hidden + ')</button>' : '') +
      (deep ? '<h2 class="dw-q">How long do you have?</h2><div class="dw-times" role="group" aria-label="How long do you have">' + chips().map(function (c) {
        return '<button type="button" class="dw-time" data-v="' + c.v + '" aria-pressed="' + (c.v === E.choice) + '"><b>' + esc(c.l) + '</b><span>' + esc(c.sub) + '</span></button>';
      }).join('') + '</div><p class="dw-planline" id="g-fit">' + esc(fitLine(p)) + '</p>' : '') +
      '<div class="dw-row"><button type="button" class="btn primary" id="dw-go"' + (can ? '' : ' disabled') + '>' + esc(startLabel(p)) + '<kbd aria-hidden="true">Enter</kbd></button></div>' +
      (deep ? '<details class="dw-optfold"><summary>Options</summary><label class="dw-toggle"><input type="checkbox" id="dw-hide"' + (E.hideClock ? ' checked' : '') + '> Hide the clock (breaks still happen)</label></details>' : '') + '</div>';
    wireGuide(p);
  }
  function choose(id, focus) {
    if (id === 'triage' && !triageN()) return;
    E.pick = id; E.gone = null; render();
    if (id === 'typed') { var f = $('#g-typed'); if (f) { f.focus(); f.selectionStart = f.value.length; } return; }
    if (focus !== false) { var r = view.querySelector('.g-row[aria-checked="true"]'); if (r) r.focus(); }
  }
  function rows() { return [].slice.call(view.querySelectorAll('.g-row')).filter(function (r) { return r.getAttribute('aria-disabled') !== 'true'; }); }
  function moveBy(d) {
    var rs = rows(), at = rs.indexOf(view.querySelector('.g-row[aria-checked="true"]'));
    var nx = rs[Math.max(0, Math.min(rs.length - 1, at + d))]; if (nx) choose(nx.dataset.pick);
  }
  function wireGuide(p) {
    var list = view.querySelector('.g-list');
    if (!p) { var first = rows()[0]; if (first) first.tabIndex = 0; }   /* nothing picked: Tab still reaches the list */
    list.addEventListener('click', function (e) {
      var u = e.target.closest('[data-use]'); if (u) { e.stopPropagation(); return choose(u.dataset.use); }
      if (e.target.closest('#g-typed')) return;
      var r = e.target.closest('.g-row'); if (r) choose(r.dataset.pick);
    });
    list.addEventListener('keydown', function (e) {
      if (e.target.id === 'g-typed') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); moveBy(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); moveBy(-1); }
      else if (e.key === ' ') { e.preventDefault(); var r = e.target.closest('.g-row'); if (r) choose(r.dataset.pick); }
    });
    var f = $('#g-typed');
    if (f) {
      f.oninput = function () {
        E.typed = f.value;
        $('#g-hint').innerHTML = typedHint(E.typed);   /* only the hint and the button: the field stays as you type */
        var btn = $('#dw-go'); btn.disabled = !E.typed.trim(); btn.firstChild.textContent = startLabel('typed');
        var fit = $('#g-fit'); if (fit) fit.textContent = fitLine('typed');
      };
      f.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveBy(-1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.blur(); var r = view.querySelector('.g-row[aria-checked="true"]'); if (r) r.focus(); }
      };
    }
    view.querySelectorAll('.dw-time[data-v]').forEach(function (b) { b.onclick = function () { setChoice(b.dataset.v === 'cal' ? 'cal' : +b.dataset.v); render(); var t = view.querySelector('.dw-time[aria-pressed="true"]'); if (t) t.focus(); }; });
    var hide = $('#dw-hide'); if (hide) hide.onchange = function () { E.hideClock = this.checked; };
    $('#dw-go').onclick = go;
    var more = $('#g-more');
    if (more) more.onclick = function () {
      var seen = [].map.call(view.querySelectorAll('.g-row'), function (r) { return r.dataset.pick; });
      E.more = true; render();
      var nx = rows().filter(function (r) { return seen.indexOf(r.dataset.pick) < 0; })[0];
      if (nx) { nx.tabIndex = 0; nx.focus(); }
    };
  }
  /* Start what's picked: Triage, a task (moved into My work first, if a link brought one from elsewhere), or what
     you typed (a new task, started now; Fuzz gathers in the background) */
  function go() {
    var p = picked();
    if (p === 'triage') { E.pick = null; if (window.TriageView && TriageView.fromGuide) TriageView.fromGuide(); return App.navigate('#/triage'); }
    if (p === 'typed') { var t = E.typed.trim(); if (!t) { var f = $('#g-typed'); if (f) f.focus(); return; } E.typed = ''; return startSession(Store.captureDeep(t)); }
    var it = pickedTask(p); if (!it) return;
    if (it.state !== 'deepwork') { Store.deepWork(it.id); it = Store.item(it.id) || it; }
    startSession(it);
  }
  /* Take in where you came from: the plain Guide, the old #/deepwork (the top of My work picked), Work on this,
     or a calendar link (#/work[/<taskId>]?until=HH:MM&what=…) */
  function arrive(info) {
    info = info || { name: 'guide', arg: null, params: {} };
    var next = E.next; E.next = null;
    E.pick = null; E.want = null; E.link = null; E.gone = null; E.asked = false; E.more = false;
    if (E.linkUntil) { E.linkUntil = false; E.until = null; E.choice = null; }
    if (next) { E.want = next; E.pick = next; }
    if (info.name === 'deepwork') { var top = guideTasks()[0]; if (top) E.pick = top.id; }
    if (info.name !== 'work') return;
    var q = info.params || {}, L = { task: info.arg, what: (q.what || '').trim(), until: null };
    var m = /^(\d{1,2}):(\d{2})$/.exec(q.until || '');
    if (m && +m[1] < 24 && +m[2] < 60) {
      var d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
      if (d > Date.now()) { L.until = d; E.until = d; E.linkUntil = true; E.choice = 'cal'; }   /* a time already past is ignored */
    }
    if (L.task) {
      var it = Store.item('t' + L.task) || Store.item(L.task);
      if (it && STARTABLE.indexOf(it.state) > -1) { E.want = it.id; E.pick = it.id; }
      else if (it && isOpen(it)) E.gone = 'That one isn’t yours to start right now: ' + (it.now ? it.now.replace(/\.$/, '').replace(/^./, function (c) { return c.toLowerCase(); }) : 'it’s in Lineup') + '. Where do you want to start?';
      else E.gone = it ? (it.state === 'done' ? 'That one’s already done.' : 'That one’s been let go.') + ' Where do you want to start?' : 'I can’t find that task any more. Where do you want to start?';
    } else if (L.what) { E.typed = L.what; E.pick = 'typed'; }
    else if (L.until) E.pick = 'none';
    if (!L.task) L.task = null;
    L.pick = E.pick && E.pick !== 'none' ? E.pick : null;
    E.link = L;
  }

  function startSession(it) {
    var mt = meetingIn();
    S = { view: 'focus', task: null, clock: 0, workClock: 0, workSince: 0, sinceRealBreak: 0, breaksTaken: 0, pending: null, pendingAt: 0, forceAt: null,
      snoozed: 0, take: null, sheet: null, wrapping: false, extensions: 0, hist: [], curStart: 0, log: [], thoughts: 0, between: null, tab: null,
      hideClock: E.hideClock, budget: E.budget, hardStop: mt != null ? (mt - BUFFER) * 60 : Infinity,
      /* for the Guide's recap afterwards: what was in Triage when you sat down */
      triageAt: Store.get().queue.slice(), wrapWhy: null };
    S.budgetEnd = Math.min(E.budget > 0 ? E.budget * 60 : Infinity, S.hardStop);
    E.want = null; E.query = ''; E.alt = 0; E.pick = null; E.link = null; E.ended = null;
    clearInterval(timer); timer = setInterval(tick, 250);
    beginTask(it);
  }
  function beginTask(it) {
    S.task = it; S.view = 'focus'; S.sheet = null; S.between = null; S.tab = null; S.picking = false;
    S.entry = { task: it, finished: false }; S.log.push(S.entry);
    say(it.leftOff ? 'Welcome back to this one. I kept your place.' : 'It’s ready. I’m here if you need me.', it.leftOff ? 'happy' : 'idle');
    render(); stepAnim(); settle(2200);
  }

  /* ---------- Working on one task ---------- */
  function vFocus() {
    var it = task();
    var lead = it.nextStep || it.title;
    var done = S.log.filter(function (e) { return e.finished; }).length;
    var brief = it.aiNote || it.incoming || '';
    view.innerHTML = '<div class="dw-panel"><p class="dw-taskline"><span>' + esc(it.title) + '</span>' + (done ? UI.pill(done + ' finished this session', 'ok') : '') + '</p>' +
      '<h1 class="dw-step" id="dw-step" tabindex="-1">' + esc(lead) + '</h1>' +
      (it.leftOff ? '<p class="dw-crumb"><b>Where you left off:</b> ' + esc(it.leftOff) + '</p>' : '') +
      (brief ? '<details class="dw-prepfold"><summary>What Fuzz got ready</summary><div class="dw-prep">' + UI.text(brief) + '</div></details>' : '') +
      '<div id="dw-sheet"></div>' +
      '<div class="dw-row" id="dw-main"><button type="button" class="btn primary" id="dw-done">Finished it<kbd aria-hidden="true">D</kbd></button>' +
      '<button type="button" class="btn" id="dw-stuck">I’m stuck<kbd aria-hidden="true">S</kbd></button>' +
      '<button type="button" class="btn" id="dw-brk">Break now<kbd aria-hidden="true">B</kbd></button>' +
      '<button type="button" class="btn" id="dw-later">Done for now<kbd aria-hidden="true">Esc</kbd></button></div>' +
      '<section class="rich dw-rich" id="dw-rich">' + richHTML(it) + '</section>' + UI.idTag(it) + '</div>';
    $('#dw-done').onclick = finishTask;
    $('#dw-stuck').onclick = function () { openSheet('stuck'); };
    $('#dw-brk').onclick = function () { startBreak(); };
    $('#dw-later').onclick = doneForNow;
    view.querySelector('#dw-rich').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; $('#dw-rich').innerHTML = richHTML(task()); var tb = $('#dwtab-' + S.tab); if (tb) tb.focus(); });
    renderSheet();
  }
  /* The tabs you use to finish it, like the task card: one is always open */
  function richHTML(it) {
    var a = [];
    if (it.contextMd || (it.context && it.context.length)) a.push(['context', 'Context', null]);
    if (it.people && it.people.length) a.push(['people', 'People', it.people.length]);
    if (it.log && it.log.length) a.push(['done', 'Done so far', it.log.length]);
    if (it.sources && it.sources.length) a.push(['sources', 'Sources', it.sources.length]);
    if (!a.length) return '<p class="meta">Fuzz hasn’t gathered anything for this one yet.</p>';
    var t = a.some(function (x) { return x[0] === S.tab; }) ? S.tab : a[0][0]; S.tab = t;
    var tabs = a.map(function (x) { var on = x[0] === t; return '<button type="button" role="tab" class="tabbtn" id="dwtab-' + x[0] + '" data-tab="' + x[0] + '" aria-selected="' + on + '" aria-controls="dw-tabpanel" tabindex="' + (on ? 0 : -1) + '">' + x[1] + (x[2] == null ? '' : '<span>' + x[2] + '</span>') + '</button>'; }).join('');
    var body = t === 'context' ? (it.contextMd ? '<div class="md">' + UI.md(it.contextMd) + '</div>' : '<ul class="ctx">' + it.context.map(function (c) { return '<li><i aria-hidden="true"></i><span>' + esc(c) + '</span></li>'; }).join('') + '</ul>')
      : t === 'people' ? UI.peopleHTML(it.people) : t === 'done' ? UI.logHTML(it.log) : UI.sourcesHTML(it.sources);
    return '<div class="tabs" role="tablist" aria-label="About this task">' + tabs + '</div><div class="tabbody dw-tabpanel" id="dw-tabpanel" role="tabpanel" aria-labelledby="dwtab-' + t + '" tabindex="0">' + body + '</div>';
  }
  function stepAnim() { var el = $('#dw-step'); if (el) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); el.focus({ preventScroll: true }); } }

  /* Finished it: done in the core, with Undo in the header, then a win beat and one next thing */
  function finishTask() {
    if (S.sheet || S.take) return;
    var it = task(); if (!it) return;
    var ch = Store.track([it.id], function () { Store.markDone(it.id); });
    Say.offerUndo('Finished “' + it.title + '” in My work.', function () { return ch.undo(); }, null, ch.blocked);
    S.entry.finished = true;
    toBetween('finished');
  }

  /* ---------- Stuck: you asked, so it stays in place, not a takeover ---------- */
  function openSheet(k) { if (S.take) return; S.sheet = k; if (k === 'stuck') say('Stuck is normal. Let’s make it easier, not harder.', 'caring'); renderSheet(); }
  function closeSheet() { S.sheet = null; render(); Fuzz.setMood('idle'); }
  function opt(k, label, sub, cls) { return '<button type="button" class="btn' + (cls ? ' ' + cls : '') + '" data-k="' + k + '"><span class="dw-k">' + k + '</span><span>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button>'; }
  function escBtn(label) { return '<button type="button" class="btn" data-k="0"><span class="dw-k">Esc</span><span>' + esc(label) + '</span></button>'; }
  function renderSheet() {
    var el = $('#dw-sheet'); if (!el) return;
    var main = $('#dw-main'); if (main) main.hidden = !!S.sheet;
    if (!S.sheet) { el.innerHTML = ''; return; }
    var hasSrc = (task().sources || []).length;
    el.innerHTML = '<div class="dw-sheet" role="group" aria-labelledby="dw-sheet-h"><h2 id="dw-sheet-h">What would help?</h2><div class="dw-opts">' +
      (hasSrc ? opt(1, 'Show me the sources', 'Opens the Sources tab below') : '') +
      opt(2, 'Switch to something else', 'Your place here is kept') +
      opt(3, 'Hand it to Fuzz', 'Fuzz takes it from here and brings back what it did') +
      opt(4, 'Send it back to Triage', 'To decide again: split it, book it, or let it go') +
      escBtn('Never mind') + '</div></div>';
    el.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { sheetOpt(+b.dataset.k); }; });
    var f = el.querySelector('[data-k]'); if (f) f.focus();
  }
  function sheetOpt(k) {
    var it = task();
    if (k === 0) return closeSheet();
    if (k === 1 && (it.sources || []).length) { S.sheet = null; S.tab = 'sources'; render(); var tp = $('#dw-tabpanel'); if (tp) tp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); say('Here’s what I found. Take what helps.', 'happy'); return; }
    if (k === 2) { S.sheet = null; S.between = null; Store.deepWorkLeftOff(it.id, ''); return toBetween('switched'); }
    if (k === 3) {
      S.sheet = null;
      var ch = Store.track([it.id], function () { Store.handToFuzz(it.id); });
      Say.offerUndo('Handed “' + it.title + '” to Fuzz from My work.', function () { return ch.undo(); }, null, ch.blocked);
      return toBetween('handed');
    }
    if (k === 4) {
      S.sheet = null;
      var cb = Store.track([it.id], function () { Store.bringBack(it.id, 'front'); });
      Say.offerUndo('Sent “' + it.title + '” back to Triage from My work.', function () { return cb.undo(); }, null, cb.blocked);
      return toBetween('sentback');
    }
  }

  /* ---------- Between tasks: a win beat, then one next thing ---------- */
  function nextOffer() {
    var left = leftMin(), from = S.between && S.between.from;
    var c = pool().filter(function (it) { return !from || it.id !== from.id; });
    if (S.between && S.between.kind === 'switched') c.sort(function (a, b) { return est(a) - est(b); });
    else c.sort(function (a, b) { return (b.leftOff ? 1 : 0) - (a.leftOff ? 1 : 0) || ((est(a) <= left ? 0 : 1) - (est(b) <= left ? 0 : 1)); });
    return c[0] || null;
  }
  function toBetween(kind) {
    S.between = { kind: kind, from: task() || S.task }; S.task = null; S.view = 'between'; S.picking = false; E.query = ''; E.alt = 0;
    S.between.offer = nextOffer();
    say({ finished: 'Done! The whole thing!', switched: 'Kept your place. Here’s something lighter.', handed: 'I’ve got it. You keep going.', sentback: 'It’s in Triage to decide again. No harm done.' }[kind],
      kind === 'finished' ? 'proud' : kind === 'handed' ? 'eager' : 'caring');
    if (kind === 'finished' && !Fuzz.isCalm()) Fuzz.pAnim('hop');
    render();
    if (S.pending) fire();
  }
  function vBetween() {
    var b = S.between, t = b.from, n = b.offer && Store.item(b.offer.id) && Store.item(b.offer.id).state === 'deepwork' ? Store.item(b.offer.id) : nextOffer(), left = leftMin();
    b.offer = n;
    var head = {
      finished: '<div class="dw-beat"><div class="dw-check" aria-hidden="true">✓</div><h1 class="dw-title" tabindex="-1">Done: ' + esc(t.title) + '</h1><p class="meta">It moves to Finished. Undo is in the header if it isn’t really done.</p></div>',
      switched: '<div class="dw-beat soft"><h1 class="dw-title" tabindex="-1">Switched away from “' + esc(t.title) + '”</h1><p class="meta">Your place is kept. It waits in My work.</p></div>',
      handed: '<div class="dw-beat soft"><h1 class="dw-title" tabindex="-1">Fuzz has “' + esc(t.title) + '”</h1><p class="meta">Find it in Lineup, under With Fuzz.</p></div>',
      sentback: '<div class="dw-beat soft"><h1 class="dw-title" tabindex="-1">“' + esc(t.title) + '” is back in Triage</h1><p class="meta">It’s first there, to decide again.</p></div>'
    }[b.kind];
    var out = isFinite(left) && left <= 1;
    var timeLine = isFinite(left) ? (left > 1 ? 'About ' + dur(Math.round(left / 5) * 5) + ' left.' : 'You’re out of time for this session.') : 'No end time set.';
    view.innerHTML = '<div class="dw-panel">' + head + '<p class="dw-cap">' + timeLine + '</p>' +
      (n ? '<div class="dw-offer"><div class="dw-lbl">Next, if you want it</div><div class="dw-txt">' + esc(n.title) + '</div><p class="meta">' + fits(n) + ' ~' + dur(est(n)) + (n.leftOff ? ' · Picks up where you left off.' : '') + '</p></div>' : '<p class="meta">That’s everything in My work. Nice.</p>') +
      (S.picking ? '<div class="dw-otherbox">' + boxHTML() + '</div>' : '') +
      '<div class="dw-row">' + (n && !S.picking ? '<button type="button" class="btn' + (out ? '' : ' primary') + '" id="dw-go">Go' + (out ? '' : '<kbd aria-hidden="true">Enter</kbd>') + '</button><button type="button" class="btn" id="dw-other">Something else<kbd aria-hidden="true">O</kbd></button>' : '') +
      (!n && !S.picking ? '<button type="button" class="btn" id="dw-other">Something new<kbd aria-hidden="true">O</kbd></button>' : '') +
      '<button type="button" class="btn' + (n && !out ? '' : ' primary') + '" id="dw-stop">Stop here<kbd aria-hidden="true">' + (n && !out ? 'Esc' : 'Enter') + '</kbd></button></div></div>';
    if ($('#dw-go')) $('#dw-go').onclick = function () { beginTask(n); };
    if ($('#dw-other')) $('#dw-other').onclick = function () { S.picking = true; E.query = ''; E.alt = 0; render(); $('#dw-what').focus(); };
    $('#dw-stop').onclick = doneForNow;
    if (S.picking) wireBox(beginTask);
    else { var h = view.querySelector('.dw-title'); if (h) h.focus({ preventScroll: true }); }
  }

  /* ---------- Takeovers: anything about time covers the whole screen ---------- */
  function takeEl() {
    var el = document.getElementById('dw-take');
    if (!el) { el = document.createElement('div'); el.id = 'dw-take'; el.className = 'dw-take'; el.hidden = true; document.body.appendChild(el); }
    return el;
  }
  function pend(kind) { if (!S.pending) { S.pending = kind; S.pendingAt = S.workClock; paintBar(); } }
  function fire() { var k = S.pending; S.pending = null; S.forceAt = null; if (k) take(k); }
  function take(kind, extra) {
    S.take = { kind: kind, armed: false }; for (var x in extra || {}) S.take[x] = extra[x];
    if (kind === 'timeup') S.workSince = 0;
    renderTake();
    var me = S.take;
    setTimeout(function () { if (S && S.take === me) { me.armed = true; renderTake(); } }, kind === 'break' ? 0 : ARM_MS);
    Say.announce({ breakdue: 'Break time.', timeup: 'Your time is up.', meeting: 'Your next meeting is in 5 minutes.', body: 'Body check: 90 minutes without a real break.', break: 'On a break.' }[kind] || '');
  }
  function closeTake() { if (S) S.take = null; var el = document.getElementById('dw-take'); if (el) { el.hidden = true; el.innerHTML = ''; } document.body.classList.remove('dw-taken'); }
  function sessionLine() {
    var fin = S.log.filter(function (e) { return e.finished; }).length, bits = [];
    if (fin) bits.push(fin + (fin === 1 ? ' task' : ' tasks') + ' finished');   /* no zeros: say what did happen */
    if (S.breaksTaken) bits.push(S.breaksTaken + (S.breaksTaken === 1 ? ' break' : ' breaks') + ' taken');
    var mins = Math.round(S.clock / 60); if (mins >= 5) bits.unshift(dur(mins) + ' of work');
    return bits.length ? bits.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.' : 'You showed up and opened it. That counts.';
  }
  function renderTake() {
    if (!root || !S || !S.take) return;
    var el = takeEl(), k = S.take, it = task(), h = '', o = '';
    var stopAt = isFinite(S.hardStop) && E.until ? fmt(new Date(E.until - BUFFER * 60000)) : null;
    if (k.kind === 'breakdue') {
      h = '<p class="dw-eyebrow">Break time</p><h2>You’ve been at it about 25 minutes.</h2><p class="dw-lead">Step away for ' + (nextBreakLen() / 60) + ' minutes. Fuzz will hold your place.</p>';
      o = opt(1, 'Take the break', nextBreakLen() / 60 + ' minutes', 'primary') + (S.snoozed ? opt(2, 'Skip this one', 'Fuzz won’t ask again until the next break') : opt(2, 'Five more minutes', 'Then the break, no waiting')) + opt(4, 'Done for now', 'Fuzz saves your place');
    }
    if (k.kind === 'break') {
      var back = S.view === 'between'
        ? (S.between && S.between.offer ? '<div class="dw-backto"><div class="dw-lbl">Next, if you want it</div><div class="dw-txt">' + esc(S.between.offer.title) + '</div></div>' : '')
        : it ? '<div class="dw-backto"><div class="dw-lbl">When you’re back</div><div class="dw-txt">' + esc(it.nextStep || it.title) + '</div>' + (it.nextStep ? '<p class="meta">' + esc(it.title) + '</p>' : '') + '</div>' : '';
      h = k.over ? '<p class="dw-eyebrow">Break’s over</p><h2>Welcome back. No rush.</h2>' + back
        : '<p class="dw-eyebrow">On a break</p><div class="dw-breakdial"><svg viewBox="0 0 100 100" aria-hidden="true" id="dw-breakdial"></svg><span class="dw-breaktime" id="dw-breakleft"></span></div><p class="dw-lead">' + esc(k.idea) + '</p>' + back;
      o = opt(1, k.over ? 'Back to it' : 'I’m back', '', 'primary') + opt(4, 'Done for now', 'Fuzz saves your place');
    }
    if (k.kind === 'timeup') {
      var toHard = (S.hardStop - S.clock) / 60, near = toHard < 30, flip = S.extensions >= 2;   /* after two extensions, Fuzz suggests wrapping up */
      h = '<p class="dw-eyebrow">' + (S.wrapping ? 'Time to stop' : 'Your time is up') + '</p><h2>' + (S.wrapping ? 'That’s the five. Nice stretch.' : flip ? 'You’ve been going a while.' : 'How’s it going?') + '</h2><p class="dw-lead">' + sessionLine() + '</p>';
      o = opt(1, near && stopAt ? 'Keep going until ' + stopAt : 'On a roll, keep going', near && E.until ? 'Then your ' + fmt(E.until) : 'Another 25 minutes, breaks included', flip || S.wrapping ? '' : 'primary') +
        (S.wrapping ? '' : opt(2, 'Wrap up in 5', 'Finish the thought, then stop', flip ? 'primary' : '')) + (near ? '' : opt(3, 'Break, then more', '5 minutes')) + opt(4, 'Done for now', 'Fuzz saves your place', S.wrapping ? 'primary' : '');
    }
    if (k.kind === 'meeting') {
      h = '<p class="dw-eyebrow">Your ' + (E.until ? fmt(E.until) : 'next meeting') + ' is in 5 minutes</p><h2>Time to wrap up.</h2><p class="dw-lead">' + sessionLine() + '</p>';
      o = opt(1, 'Stop here', 'Fuzz saves your place', 'primary') + opt(2, 'I’m skipping the meeting', 'Another 25 minutes, and no more meeting reminders');
    }
    if (k.kind === 'body') {
      h = '<p class="dw-eyebrow">Body check</p><h2>90 minutes without a real break.</h2><p class="dw-lead">Hyperfocus is great. Water is too. How are your shoulders?</p>';
      o = opt(1, 'I’m good, keep going', '') + opt(3, 'Take a break', '5 minutes', 'primary') + opt(4, 'Done for now', '');
    }
    el.className = 'dw-take' + (k.kind === 'break' ? ' dw-take--break' : '') + (k.armed ? '' : ' arming');
    el.innerHTML = '<div class="dw-take-in" role="alertdialog" aria-modal="true" aria-label="My work">' + h + '<div class="dw-opts">' + o + '</div>' +
      '<p class="dw-guard">' + (k.armed ? '' : 'One moment, so a stray keystroke doesn’t pick for you…') + '</p></div>';
    el.hidden = false; document.body.classList.add('dw-taken');
    el.querySelectorAll('[data-k]').forEach(function (b) { b.disabled = !k.armed; b.onclick = function () { takeOpt(+b.dataset.k); }; });
    if (k.armed) { var f = el.querySelector('.btn.primary') || el.querySelector('[data-k]'); if (f) f.focus(); }
    tickBreak();
  }
  function nextBreakLen() { return S.breaksTaken % 3 === 2 ? LONG : SHORT; }
  function startBreak() {
    S.sheet = null; var len = nextBreakLen();
    S.hist.push({ k: 'work', s: S.curStart, e: S.clock }); S.brkStart = S.clock;
    take('break', { left: len, len: len, idea: BREAK_IDEAS[S.breaksTaken % BREAK_IDEAS.length] });
    S.take.armed = true; renderTake();
    say('Go on. I’ve got your place.', 'sleepy');
  }
  function countBreak() { if (S.take.counted) return; S.take.counted = true; S.hist.push({ k: 'brk', s: S.brkStart, e: S.clock }); S.curStart = S.clock; S.breaksTaken++; S.workSince = 0; S.sinceRealBreak = 0; S.snoozed = 0; }
  function endBreak() { countBreak(); S.take.over = true; renderTake(); say('Break’s over. Your place is right where you left it.', 'happy'); }
  function backToWork() { render(); if (S.view === 'focus') settle(1600); }
  function takeOpt(n) {
    var k = S.take; if (!k || !k.armed) return;
    var kind = k.kind;
    if (kind === 'breakdue') {
      if (n === 1) return startBreak();
      if (n === 2) {
        closeTake();
        if (S.snoozed) { S.snoozed = 0; S.workSince = 0; say('Skipped. Next one in 25.', 'idle'); }
        else { S.snoozed = 1; S.forceAt = S.workClock + GRACE; say('Five more. Then the break.', 'idle'); }
        return backToWork();
      }
      if (n === 4) { closeTake(); return doneForNow(); }
    }
    if (kind === 'break' && (n === 1 || n === 4)) { countBreak(); closeTake(); if (n === 4) return doneForNow(); say('Welcome back. Here’s where you were.', 'happy'); return backToWork(); }
    if (kind === 'timeup' || kind === 'body') {
      if (n === 1) { closeTake(); if (kind === 'timeup') { S.wrapping = false; S.extensions++; S.budgetEnd = Math.min(S.clock + 25 * 60, S.hardStop); } else S.sinceRealBreak = 0; say('Keep going. I’ll still call the breaks.', 'happy'); return backToWork(); }
      if (n === 2 && kind === 'timeup' && !S.wrapping) { closeTake(); S.wrapping = true; S.budgetEnd = S.clock + 5 * 60; say('Five more minutes. Finish the thought, not the task.', 'idle'); return backToWork(); }
      if (n === 3) { if (kind === 'timeup') { S.budgetEnd = Math.min(S.clock + SHORT + 25 * 60, S.hardStop); S.extensions++; S.wrapping = false; } return startBreak(); }
      if (n === 4) { closeTake(); return doneForNow(kind === 'timeup' ? 'time' : 'stop'); }
    }
    if (kind === 'meeting') {
      closeTake();
      if (n === 1) return doneForNow('meeting');
      S.hardStop = Infinity; S.budgetEnd = S.clock + 25 * 60; S.extensions++; say('Okay. No more meeting reminders this session.', 'idle'); return backToWork();
    }
  }

  /* ---------- Leaving ---------- */
  /* Every way out lands on one wrap-up, then the Guide: Stop for now, Time's up, a meeting in 5 */
  function doneForNow(why) {
    S.wrapWhy = typeof why === 'string' ? why : 'stop';
    S.after = 'keep';
    S.wrapFrom = S.view === 'between' ? 'between' : 'focus';
    S.sheet = null; closeTake(); S.pending = null; S.forceAt = null;
    S.view = 'wrap'; render();
  }
  function vWrap() {
    var it = S.wrapFrom === 'focus' ? task() : null, open = it && it.state === 'deepwork';
    var fin = S.log.filter(function (e) { return e.finished; });
    say(fin.length ? 'Good session. I’ll keep your place warm.' : 'That’s okay. Opening it counts. I kept your place.', 'proud');
    var seen = [], rows = S.log.filter(function (e) { if (seen.indexOf(e.task.id) > -1) return false; seen.push(e.task.id); return true; });
    var head = { meeting: 'Your ' + (E.until ? fmt(E.until) : 'meeting') + ' is in 5 minutes', time: 'That’s your time', stop: 'Stopping here' }[S.wrapWhy] || 'Done for now';
    /* What happens to the task you were on: back in My work (with your place kept), the rest to Fuzz, or booked
       time to finish it (Book time's slots, opened right here) */
    var then = open ? '<h2 class="dw-q" id="dw-then-h">Then what?</h2><div class="dw-then" role="radiogroup" aria-labelledby="dw-then-h">' +
      [['keep', 'Back in my work'], ['fuzz', 'Hand the rest to Fuzz'], ['book', 'Book time to finish']].map(function (c) { return '<button type="button" role="radio" class="dw-time" data-after="' + c[0] + '" aria-checked="' + (S.after === c[0]) + '"><b>' + c[1] + '</b></button>'; }).join('') + '</div>' +
      '<div id="dw-book"></div>' : '';
    view.innerHTML = '<div class="dw-panel"><h1 class="dw-title" id="dw-wrap-h" tabindex="-1">' + esc(head) + '</h1>' +
      '<p class="dw-lead">' + sessionLine() + '</p>' +
      (rows.length ? '<h2 class="dw-q">This session</h2><ul class="dw-log">' + rows.map(function (e) {
        var done = S.log.some(function (x) { return x.task.id === e.task.id && x.finished; });
        return '<li><b>' + esc(e.task.title) + '</b>: ' + (done ? 'finished' : 'worked on it') + '</li>';
      }).join('') + '</ul>' : '') +
      (open ? '<h2 class="dw-q"><label for="dw-crumb">Where you left off on “' + esc(it.title) + '”</label></h2><p class="meta">So picking it up next time is quick. Change it, or leave it.</p>' +
        '<input class="dw-field" id="dw-crumb" autocomplete="off" value="' + esc(it.leftOff || (it.nextStep ? 'Next: ' + it.nextStep : '')) + '" placeholder="Drafted the intro; numbers next">' : '') +
      then +
      '<div class="dw-row"><button type="button" class="btn primary" id="dw-save">' + (S.wrapWhy === 'meeting' ? 'Save it and go' : 'Wrap up') + '<kbd aria-hidden="true">Enter</kbd></button>' +
      '<button type="button" class="btn" id="dw-backwork">Actually, keep going<kbd aria-hidden="true">Esc</kbd></button></div></div>';
    view.querySelectorAll('[data-after]').forEach(function (b) { b.onclick = function () {
      S.after = b.dataset.after; view.querySelectorAll('[data-after]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      paintBook(it);
    }; });
    paintBook(it);
    $('#dw-save').onclick = function () {
      var slot = S.after === 'book' && S.bookOpts ? S.bookOpts[S.bookPick] : null;
      if (open && S.after === 'book' && !slot) {   /* Book time to finish needs a time first */
        var first = view.querySelector('#dw-book [data-slot]'); if (first) first.focus();
        say(S.bookOpts && !S.bookOpts.length ? 'No free time before it’s due. Back in my work keeps it ready.' : 'Pick a time first.', 'idle'); return;
      }
      if (open) {
        var note = $('#dw-crumb').value.trim(); if (note !== (it.leftOff || '')) Store.deepWorkLeftOff(it.id, note);
        if (S.after === 'fuzz') {
          var ch = Store.track([it.id], function () { Store.handToFuzz(it.id); });
          Say.offerUndo('Handed the rest of “' + it.title + '” to Fuzz.', function () { return ch.undo(); }, null, ch.blocked);
        }
        if (slot) {
          var cb = Store.track([it.id], function () { Store.book(it.id, slot); });
          Say.offerUndo('Booked time to finish “' + it.title + '”: ' + slot.label + '.', function () { return cb.undo(); }, null, cb.blocked);
        }
      }
      /* The Guide says how it went, once: the recap, and what came into Triage meanwhile */
      var main = (it || (rows[rows.length - 1] || {}).task), before = S.triageAt || [];
      var came = Store.queue().filter(function (q) { return before.indexOf(q.id) < 0; });
      E.recap = main ? { title: main.title, mins: Math.round(S.clock / 60), finished: fin.length > 0 && !open, why: S.wrapWhy, at: E.until ? fmt(E.until) : null, booked: slot ? slot.label : null,
        came: came.length, urgent: came.some(function (q) { return !!q.dueAt; }) } : null;
      var recap = E.recap;
      endSession();
      E.recap = recap; E.ended = recap ? { why: recap.why, at: recap.at } : null;
      toGuide();
    };
    $('#dw-backwork').onclick = function () { S.view = S.wrapFrom || 'focus'; render(); if (S.view === 'focus') { stepAnim(); settle(); } say('Back at it. Nothing was lost.', 'happy'); };
    var c = $('#dw-crumb'); if (c) { c.focus(); c.select(); } else { var h = $('#dw-wrap-h'); if (h) h.focus(); }
  }
  /* Book time to finish: Book time's slots under the choice, loaded once (the core's for a task with no card, or the
     demo's). Painted on its own, so what you typed in Where you left off stays. */
  function paintBook(it) {
    var el = $('#dw-book'); if (!el) return;
    if (S.after !== 'book' || !it) { el.innerHTML = ''; return; }
    if (!S.bookOpts) {
      el.innerHTML = '<p class="meta">Finding a time…</p>';
      if (!S.bookLoading) {
        S.bookLoading = true;
        var load = window.Live && Live.on() && it.coreId != null ? Live.bookOptions(it.coreId) : Promise.resolve(Store.bookOptions(it));
        load.then(function (opts) { if (!S) return; S.bookOpts = opts || []; S.bookPick = S.bookOpts.length ? 0 : -1; paintBook(it); });
      }
      return;
    }
    if (!S.bookOpts.length) { el.innerHTML = '<p class="meta">No free time before it’s due. Back in my work keeps it ready for your next session.</p>'; return; }
    el.innerHTML = '<h2 class="dw-q" id="dw-book-h">When will you finish it?</h2><div class="dw-then" role="radiogroup" aria-labelledby="dw-book-h">' +
      S.bookOpts.map(function (o, n) {
        return '<button type="button" role="radio" class="dw-time" data-slot="' + n + '" aria-checked="' + (n === S.bookPick) + '"><b>' + esc(o.label) + '</b><span>' + esc(o.focus ? 'In a Focus time slot' : o.note || 'Not a focus slot') + '</span></button>';
      }).join('') + '</div><p class="meta">Fuzz holds the time, and it opens first in Triage when it starts.</p>';
    el.querySelectorAll('[data-slot]').forEach(function (b) { b.onclick = function () {
      S.bookPick = +b.dataset.slot; el.querySelectorAll('[data-slot]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
    }; });
  }
  function endSession() { clearInterval(timer); timer = 0; closeTake(); S = null; E.asked = false; }
  function toGuide() {
    if (location.hash === '#/guide') V.arrive({ name: 'guide', arg: null, params: {} });   /* the same hash fires no hashchange */
    else App.navigate('#/guide');
  }
  /* What the header's label says while a session runs (js/app.js paintLabel): Deep Work · the task · the time */
  function label() {
    if (!S) return null;
    if (S.view === 'wrap') return { wrap: true, sub: 'Wrapping up', ring: null };
    var it = task(), left = leftMin(), sub;
    if (S.take && S.take.kind === 'break') sub = 'On a break';
    else {
      var mins = isFinite(left) ? Math.max(1, Math.ceil(left)) + ' min' : Math.max(1, Math.round(S.clock / 60)) + ' min in';
      sub = (S.view === 'between' ? 'Between tasks' : it ? short(it.title) : 'My work') + ' · ' + mins;
    }
    var ring = isFinite(S.budgetEnd) && S.budgetEnd > 0 ? Math.min(100, Math.round(S.clock / S.budgetEnd * 100)) : Math.min(100, Math.round(S.workSince / WORK * 100));
    return { session: true, sub: sub, ring: ring };
  }

  /* ---------- The clock: a session bar in the header, where Triage keeps its progress ----------
     It's the session's time, not the task's, so it sits above everything. With an end time the whole
     session runs left to right: work in the accent, breaks green, filled up to now. With no end time it
     shows the hour you're in (each finished hour starts a new one). It is drawn from what actually
     happened plus the plan ahead, so snoozes and extra time show up. */
  function about(left) { left = Math.ceil(left); if (left <= 1) return 'Wrapping up'; if (left < 5) return 'Under 5 min'; return '~' + (Math.round(left / 5) * 5) + ' min'; }
  function inTxt(m) { var r = Math.round(m / 5) * 5; if (r < 5) return 'Just started'; if (r < 60) return '~' + r + ' min in'; var h = Math.floor(r / 60), mm = r % 60; return h + 'h' + (mm ? ' ' + mm + 'm' : '') + ' in'; }
  function barEl(id) { return document.getElementById(id); }
  function paintBar() {
    var wrap = barEl('dwprog'); if (!wrap) return;
    var on = !!(root && S && inSession() && !S.hideClock);
    if (wrap.hidden === on) wrap.hidden = !on;
    if (!on) return;
    var m = S.clock / 60, open = !isFinite(S.budgetEnd), hrs = Math.floor(m / 60);
    var waiting = S.pending === 'breakdue' || S.pending === 'timeup';
    /* Between tasks the work clock stands still, so the next break stays where it was */
    var toBreak = waiting ? 0 : S.forceAt != null ? Math.max(0, (S.forceAt - S.workClock) / 60) : Math.max(0, (WORK - S.workSince) / 60);
    var T = m + toBreak, cur = S.curStart / 60;
    var dS = open ? hrs * 60 : 0, span = open ? 60 : Math.max(S.budgetEnd / 60, m), lim = dS + span;
    var segs = S.hist.map(function (x) { return { k: x.k, s: x.s / 60, e: x.e / 60 }; });
    segs.push({ k: 'work', s: cur, e: T });
    var t = T, nb = S.breaksTaken;
    while (t < lim) { var bl = nb % 3 === 2 ? 15 : 5; segs.push({ k: 'brk', s: t, e: t + bl }); t += bl; nb++; segs.push({ k: 'work', s: t, e: t + 25 }); t += 25; }
    function pc(x) { return (Math.max(0, Math.min(1, (x - dS) / span)) * 100).toFixed(1); }
    var h = '';
    segs.forEach(function (x) {
      var a = Math.max(x.s, dS), b = Math.min(x.e, lim); if (b - a <= 0.05) return;
      var cls = x.k === 'brk' ? 'b' : 'w';
      h += '<i class="' + cls + '" style="left:' + pc(a) + '%;width:' + (pc(b) - pc(a)).toFixed(1) + '%"></i>';
      if (m > a) h += '<i class="' + cls + ' past" style="left:' + pc(a) + '%;width:' + (pc(Math.min(b, m)) - pc(a)).toFixed(1) + '%"></i>';
    });
    h += '<i class="now" style="left:' + pc(m) + '%"></i>';
    var endB = S.budgetEnd / 60, sessLeft = endB - m, stopAt = isFinite(S.hardStop) && E.until ? ' · stop at ' + fmt(new Date(E.until - BUFFER * 60000)) : '';
    var big = S.pending === 'timeup' ? 'Time’s up after this' : S.pending === 'breakdue' ? 'Break in a moment'
      : !open && sessLeft <= toBreak ? 'Last block' : 'Break in ' + about(toBreak).replace('Wrapping up', 'a moment').replace('Under', 'under');
    var small = open ? inTxt(m) + stopAt : sessLeft > 1 ? about(sessLeft) + ' left' : 'Session’s up';
    var txt = big + ' · ' + small;
    /* Redraw only when it changes, so the bar doesn't flicker */
    var bar = barEl('dwbar'), te = barEl('dwprog-t');
    if (bar.dataset.h !== h) { bar.dataset.h = h; bar.innerHTML = h; }
    if (te.textContent !== txt) { te.textContent = txt; wrap.title = 'This session: ' + txt; }
  }
  function breakText(sec) { return sec > 90 ? 'About ' + Math.round(sec / 60) + ' minutes' : sec > 40 ? 'About a minute' : 'Less than a minute'; }
  function wedge(f, r, cls) {
    if (f <= 0.001) return ''; if (f >= 0.999) return '<circle class="' + cls + '" cx="50" cy="50" r="' + r + '"/>';
    var a = f * 2 * Math.PI, x = 50 + r * Math.sin(a), y = 50 - r * Math.cos(a);
    return '<path class="' + cls + '" d="M50 50 L50 ' + (50 - r) + ' A' + r + ' ' + r + ' 0 ' + (f > .5 ? 1 : 0) + ' 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Z"/>';
  }
  function tickBreak() {
    var el = document.getElementById('dw-breakleft'); if (!el || !S || !S.take || S.take.kind !== 'break') return;
    var txt = breakText(Math.max(0, S.take.left)); if (el.textContent !== txt) el.textContent = txt;
    var d = document.getElementById('dw-breakdial'), h = '<circle class="rim" cx="50" cy="50" r="47"/>' + wedge(Math.max(0, S.take.left) / (S.take.len || SHORT), 45, 'b');
    if (d && d.dataset.h !== h) { d.dataset.h = h; d.innerHTML = h; }
  }

  /* The session keeps time while you look at another page; a takeover that comes due waits until you're back */
  var lastTick = 0;
  function tick() {
    /* Real elapsed time, not a count of ticks: a background tab's timers slow down, and the meeting won't */
    var now = Date.now(), dt = lastTick ? Math.min(600, (now - lastTick) / 1000) * SPEED : 0;
    lastTick = now;
    if (!S || !inSession()) return;
    S.clock += dt;
    paintBar();   /* between tasks and with the stuck options open too: the session's time runs on */
    if (S.take) {
      if (S.take.kind === 'break' && !S.take.over) { S.take.left -= dt; tickBreak(); if (S.take.left <= 0) endBreak(); }
      return;
    }
    if (S.view !== 'focus' || S.sheet || !root) return;
    S.workClock += dt; S.workSince += dt; S.sinceRealBreak += dt;
    if (S.forceAt != null && S.workClock >= S.forceAt) { S.forceAt = null; S.pending = null; take('breakdue'); return; }
    if (S.clock >= S.hardStop) { S.pending = null; S.forceAt = null; take('meeting'); return; }   /* the meeting won't wait */
    if (S.clock >= S.budgetEnd) pend('timeup');
    else if (S.workSince >= WORK && S.forceAt == null) pend('breakdue');
    if (S.sinceRealBreak >= BODY && !S.pending) { S.sinceRealBreak = 0; take('body'); return; }
    /* With no steps to wait for, a pending break or time's up comes after a short grace */
    if (S.pending && S.workClock - S.pendingAt >= 60) { fire(); return; }
  }

  /* ---------- Keys ---------- */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !root) return;
    var k = e.key;
    if (S && S.take) {
      e.preventDefault(); e.stopPropagation();
      if (!S.take.armed) return;
      var el = document.getElementById('dw-take');
      if (k === 'Enter') { var p = el.querySelector('.btn.primary') || el.querySelector('[data-k]'); if (p) takeOpt(+p.dataset.k); }
      else if (/^[1-4]$/.test(k)) takeOpt(+k);
      return;
    }
    if (document.querySelector('dialog[open]') || e.defaultPrevented) return;
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (typing) {
      /* Esc in a footer box closes it, back to its link, as in Triage */
      if (k === 'Escape' && e.target.id === 'dw-telltext') { e.preventDefault(); closeForm('dw-tellform', 'dw-tellbtn'); return; }
      if (k === 'Escape' && e.target.id === 'dw-parktext') { e.preventDefault(); closeForm('dw-parkform', 'dw-parkbtn'); return; }
      if (k === 'Escape' && e.target.id !== 'dw-what' && e.target.id !== 'g-typed') e.target.blur();
      if (k === 'Enter' && e.target.id === 'dw-crumb') { e.preventDefault(); $('#dw-save').click(); }
      return;
    }
    if (k === '?') { e.preventDefault(); openKeys(); return; }
    var v = S ? S.view : 'entry', onBtn = e.target.closest && e.target.closest('button, a, summary');
    if (v === 'entry') {
      /* The Guide: Enter starts what's picked, a number picks a row (like Triage's choices), / is Something else */
      if (k === 'Enter' && !onBtn) { e.preventDefault(); go(); }
      else if (/^[1-9]$/.test(k)) { var r = rows()[+k - 1]; if (r) { e.preventDefault(); choose(r.dataset.pick); } }
      else if (k === '/') { e.preventDefault(); choose('typed'); }
    } else if (v === 'focus') {
      if (S.sheet) {
        if (/^[0-4]$/.test(k)) { var sb = $('#dw-sheet [data-k="' + k + '"]'); if (sb) { e.preventDefault(); sheetOpt(+k); } }
        else if (k === 'Escape') { e.preventDefault(); sheetOpt(0); }
        return;
      }
      var lk = k.toLowerCase();
      if (lk === 'd') { e.preventDefault(); finishTask(); }
      else if (lk === 's') { e.preventDefault(); openSheet('stuck'); }
      else if (lk === 'b') { e.preventDefault(); startBreak(); }
      else if (lk === 't') { e.preventDefault(); openForm('dw-parkform', 'dw-parkbtn', 'dw-parktext'); }
      else if (lk === 'e') { e.preventDefault(); openForm('dw-tellform', 'dw-tellbtn', 'dw-telltext'); }
      else if (k === 'Escape') { e.preventDefault(); doneForNow(); }
    } else if (v === 'between') {
      if (k === 'Enter' && !onBtn) { e.preventDefault(); var g = view.querySelector('.dw-row .btn.primary'); if (g) g.click(); }
      else if ((k === 'o' || k === 'O') && $('#dw-other')) { e.preventDefault(); $('#dw-other').click(); }
      else if (k === 'Escape') { e.preventDefault(); if (S.picking) { S.picking = false; render(); } else doneForNow(); }
    } else if (v === 'wrap') {
      if (k === 'Escape') { e.preventDefault(); $('#dw-backwork').click(); }
      else if (k === 'Enter' && !onBtn) { e.preventDefault(); $('#dw-save').click(); }
    }
  }

  /* ---------- Mounting ---------- */
  /* What the Guide shows, in short, so a sync that changes nothing on it doesn't redraw it under you */
  function guideSig() { return [triageN(), triageUrgent(), guideTasks().map(function (it) { return it.id + (it.leftOff ? '*' : ''); }).join(',')].join('|'); }
  var lastSig = '';
  V.mount = function (container, info) {
    root = container;
    root.innerHTML = '<section class="dw" aria-labelledby="dw-mode"><div class="dw-top"><span class="dw-mode sr" id="dw-mode">My work</span>' +
      '<a class="dw-pool" href="#/tasks">' + pool().length + ' in My work</a></div>' +
      '<div class="stage dw-stage" id="stage"><div class="fx" id="fx"></div>' +
      '<div class="perch" id="perch"><div class="pwrap" id="pwrap" aria-hidden="true">' + window.FUZZ_SVG + '</div><div class="bubble" id="bubble"></div></div>' +
      '<div id="dw-view"></div></div>' + footHTML() + '</section>';
    view = root.querySelector('#dw-view');
    wireFoot();
    Fuzz.mount(root, {});
    keyFn = onKey; document.addEventListener('keydown', keyFn, true);
    unsub = Store.on(function (e) {
      if (!root) return;
      paintPool();
      if (e.type === 'change') return;
      /* The Guide follows the queue as Fuzz's sync lands, but never redraws under the Something else field;
         a session view doesn't re-render under you */
      if (S) return;
      var a = document.activeElement, sig = guideSig();
      if (sig === lastSig || (a && a.id === 'g-typed')) return;
      lastSig = sig;
      var hadFocus = a && view && view.contains(a);
      render();
      if (hadFocus) { var r = view.querySelector('.g-row[aria-checked="true"]'); if (r) r.focus({ preventScroll: true }); }
    });
    if (S) {
      /* Back to a session in progress. A link (a calendar invite, the old #/deepwork) never ends or changes it. */
      E.next = null;
      render(); if (S.view === 'focus') stepAnim();
      if (!S.take) say('Back to it. Here’s where you were.', 'happy');
      return;
    }
    arrive(info || (window.App && App.here()));
    setChoice(E.choice);
    lastSig = guideSig();
    render();
    loadUntil().then(function () { if (root && !S) { setChoice(E.choice); if (!(document.activeElement && document.activeElement.id === 'g-typed')) render(); } });
  };
  /* A new link while the Guide is on screen (the logo from a work link, one work link to another) */
  V.arrive = function (info) {
    if (!root) return;
    if (S) { if (S.view !== 'wrap' && S.take == null) render(); return; }
    arrive(info); setChoice(E.choice); lastSig = guideSig(); render();
    var h = $('#g-q'); if (h) h.focus({ preventScroll: true });
    loadUntil().then(function () { if (root && !S) { setChoice(E.choice); render(); } });
  };
  V.label = label;
  /* The header's label (and the logo) on the session: a way out like Done for now, through the wrap-up */
  V.leave = function () { if (inSession()) { doneForNow('stop'); return true; } return !!S; };
  /* The core restarted (js/live.js): redraw with what's picked kept, never under the Something else field */
  V.refresh = function () {
    if (!root) return;
    if (S) { if (S.view !== 'wrap' && !S.take) render(); return; }
    if (document.activeElement && document.activeElement.id === 'g-typed') return;
    lastSig = guideSig(); render();
  };
  V.unmount = function () {
    if (keyFn) document.removeEventListener('keydown', keyFn, true); keyFn = null;
    if (unsub) unsub(); unsub = null;
    clearTimeout(settleT);
    var el = document.getElementById('dw-take'); if (el) { el.hidden = true; el.innerHTML = ''; } document.body.classList.remove('dw-taken');
    Fuzz.unmount(); root = null; view = null; E.ended = null;
    var bar = document.getElementById('dwprog'); if (bar) bar.hidden = true;
  };
  /* From Lineup's Work on this: the Guide, with this task picked, one tap from Start. Never mid-session. */
  V.start = function (id) {
    if (inSession()) return App.navigate('#/guide');
    E.next = id; E.query = ''; E.alt = 0;
    if (location.hash === '#/guide' && root) V.arrive({ name: 'guide', arg: null, params: {} }); else App.navigate('#/guide');
  };
  V.active = function () { return inSession(); };
  V.dur = dur;
  V.est = est;

  window.DeepWorkView = V;
  window.DeepWork = V;
})();
