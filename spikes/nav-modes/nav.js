/* Nav modes spike: four ways to separate the two modes (Triage, Deep Work) from the two places (Lineup, Artifacts).
   One state, one set of page bodies; each option only draws its own bar and decides where the places live. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = { opt: 'A', view: 'triage', mode: 'triage', menu: false, lib: 'tasks', nowPicked: null,
    waiting: 6, urgent: 1, pool: 3, session: false, left: 14 };

  /* ---------- Icons ---------- */
  var I = {
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
    doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>'
  };

  /* ---------- What the dots say ---------- */
  /* In a session, Triage only lights up for what can't wait, so the toggle doesn't pull you out of focus */
  function triageDot() {
    if (S.session) return S.urgent ? '<span class="dot" aria-label="' + S.urgent + ' can\'t wait">' + S.urgent + '</span>' : '';
    return S.waiting ? '<span class="dot" aria-label="' + S.waiting + ' waiting">' + S.waiting + '</span>' : '';
  }
  function deepDot() { return S.pool ? '<span class="dot only" aria-label="something in the pool"></span>' : ''; }
  function sessionChip() {
    if (!S.session || S.view === 'deepwork') return '';
    var p = Math.round((25 - S.left) / 25 * 100);
    return '<button class="chip sess" data-go="deepwork" title="Back to your session"><span class="ring" style="--p:' + p + '"></span>' + S.left + ' min<span class="long">&nbsp;left · back to it</span></button>';
  }
  function right(extra) {
    return '<div class="right">' + (extra || '') +
      '<button class="iconbtn2 cta" title="New task (N)">' + I.plus + '<span class="lbl">New task</span></button>' +
      '<button class="iconbtn2" title="Undo">' + I.undo + '<span class="lbl">Undo</span></button>' +
      '<button class="iconbtn2" aria-label="Settings">' + I.gear + '</button></div>';
  }
  function brand() { return '<a class="brand" href="#" data-go="home"><img src="../../assets/fuzz-mark.svg" alt=""><span>Fuzz</span></a>'; }
  function link(view, label, extra) { return '<button data-go="' + view + '"' + (S.view === view ? ' aria-current="page"' : '') + '>' + label + (extra || '') + '</button>'; }
  function toggle(cls) {
    var away = S.view !== 'triage' && S.view !== 'deepwork';
    return '<div class="seg' + (away ? ' away' : '') + (cls ? ' ' + cls : '') + '" role="group" aria-label="Mode">' +
      '<button data-go="triage" aria-pressed="' + (S.mode === 'triage') + '">Triage' + triageDot() + '</button>' +
      '<button data-go="deepwork" aria-pressed="' + (S.mode === 'deepwork') + '">Deep Work' + deepDot() + '</button></div>';
  }
  function menu(items) {
    return '<button class="iconbtn2" id="menubtn" aria-haspopup="menu" aria-expanded="' + S.menu + '" title="Lineup and Artifacts (L)">' + I.more + '<span class="lbl">More</span></button>' +
      (S.menu ? '<div class="navmenu" role="menu">' + items + '</div>' : '');
  }
  function menuItems() {
    return '<button role="menuitem" data-go="lineup">' + I.list + '<span><b>Lineup</b><small>Who has the ball: 12 in motion, 4 waiting on others</small></span><span class="k">L</span></button>' +
      '<button role="menuitem" data-go="artifacts">' + I.file + '<span><b>Artifacts</b><small>What Fuzz made: 2 new since yesterday</small></span><span class="k">F</span></button>' +
      '<hr><button role="menuitem">' + I.gear + '<span><b>Settings</b></span></button>';
  }

  /* ---------- The four bars ---------- */
  var BARS = {
    /* A: the modes are a switch; the places are a menu */
    A: function () {
      return brand() + '<div class="navrow">' + toggle() + '</div>' + right(sessionChip() + menu(menuItems()));
    },
    /* B: each mode brings its own place: Lineup beside Triage, Artifacts beside Deep Work */
    B: function () {
      var place = S.mode === 'triage' ? link('lineup', 'Lineup') : link('artifacts', 'Artifacts');
      return brand() + '<div class="navrow links">' + toggle() + '<span class="sep" aria-hidden="true"></span>' + place + '</div>' + right(sessionChip());
    },
    /* C: three equal places; Lineup and Artifacts become one Library */
    C: function () {
      return brand() + '<div class="navrow links">' + link('triage', 'Triage', triageDot()) + link('deepwork', 'Deep Work', deepDot()) +
        '<span class="sep" aria-hidden="true"></span>' + link('library', 'Library') + '</div>' + right(sessionChip());
    },
    /* D: one home; Fuzz suggests the mode, you can switch it there */
    D: function () {
      var nowDot = S.session ? (S.urgent ? triageDot() : '') : (S.waiting || S.pool ? '<span class="dot only"></span>' : '');
      var onNow = S.view === 'now' || S.view === 'triage' || S.view === 'deepwork';
      return brand() + '<div class="navrow links"><button data-go="now"' + (onNow ? ' aria-current="page"' : '') + '>Now' + nowDot + '</button>' +
        '<span class="sep" aria-hidden="true"></span>' + link('lineup', 'Lineup') + link('artifacts', 'Artifacts') + '</div>' + right(sessionChip());
    }
  };

  /* ---------- Page bodies (shared by every option) ---------- */
  function perch(html) { return '<div class="perch2"><img src="../../assets/fuzz-mark.svg" alt=""><div class="say">' + html + '</div></div>'; }
  function card(urgent) {
    return urgent
      ? '<article class="card2 urgent"><div class="dw-eyebrow">Slack · Marcus · needs an answer by 2pm</div><h3>Can we push the vendor call to Thursday?</h3>' +
        '<div class="sugg">Fuzz: I can say yes and move it. Thursday 10am is free for both of you.</div>' +
        '<div class="acts"><button class="btn primary">Hand it to Fuzz</button><button class="btn">Later</button><button class="btn">I did it</button></div></article>'
      : '<article class="card2"><div class="dw-eyebrow">Email · Priya · from yesterday</div><h3>Send Priya the Q3 numbers before the planning review</h3>' +
        '<div class="sugg">Fuzz: I drafted a summary from the finance sheet. It needs your OK on the headcount line.</div>' +
        '<div class="files"><button class="chip" data-go="file">' + I.doc + 'Q3 summary.docx</button></div>' +
        '<div class="acts"><button class="btn primary">Hand it to Fuzz</button><button class="btn">Later</button><button class="btn">Deep Work</button><button class="btn">I did it</button></div></article>';
  }
  function triage() {
    if (S.session) {
      var head = '<div class="banner"><span class="grow"><b>You’re in a Deep Work session.</b> Triage only shows what can’t wait.</span><button class="btn" data-go="deepwork">Back to it · ' + S.left + ' min</button></div>';
      return head + (S.urgent ? perch('One thing can’t wait. Then back to it.') + card(true)
        : perch('Nothing here can’t wait. The other ' + S.waiting + ' will keep until after your session.'));
    }
    if (!S.waiting && !S.urgent) {
      return perch('<b>All clear.</b> Nothing is waiting on you.' + (S.pool ? ' ' + S.pool + ' tasks are in Deep Work for when you have time.' : '')) +
        (S.pool ? '<button class="btn primary" data-go="deepwork">Go deep on something</button>' : '');
    }
    var n = S.waiting + S.urgent;
    return perch((S.urgent ? 'This one has a time on it, so it’s first.' : 'Next one. Quick decisions, I’ll do the rest.') + ' <span class="meta">' + n + ' to go</span>') + card(!!S.urgent);
  }
  var POOL = [
    { t: 'Write the onboarding plan for the new analyst', m: '~50 min', s: 'You left off at “week two”' },
    { t: 'Review the pricing model before Tuesday', m: '~30 min', s: 'Fuzz pulled the three versions together' },
    { t: 'Outline the Q4 roadmap talk', m: '~45 min', s: 'Draft outline is ready' }
  ];
  function deepwork() {
    if (S.session) {
      var p = Math.round((25 - S.left) / 25 * 100);
      return '<div class="panel2"><div class="dw-eyebrow">Deep Work · block 2 of 3</div><div class="clock"><span class="big" style="--p:' + p + '"></span><div><b>' + S.left + ' min</b> left in this block<div class="meta">Then a 5 minute break</div></div></div>' +
        '<h3>' + POOL[0].t + '</h3><div class="step">Next step: list the three systems they need access to on day one.</div>' +
        '<div class="files"><button class="chip" data-go="file">' + I.doc + 'Onboarding plan draft.md</button><button class="chip" data-go="file">' + I.doc + 'Last hire’s checklist.pdf</button></div>' +
        '<div class="acts" style="margin-top:14px"><button class="btn primary">Next step</button><button class="btn">Done for now</button><button class="btn">Finished it</button></div></div>';
    }
    if (!S.pool) return perch('<b>Nothing in Deep Work.</b> When something needs you and takes real time, it waits here.');
    return perch('You’ve got until <b>2pm</b>. Want to go deep on something?') +
      '<div class="panel2"><h3>How long do you have?</h3><div class="times">' +
      '<button class="on"><b>Until 2pm</b><small>~45 min, then your meeting</small></button><button><b>A quick burst</b><small>25 min</small></button><button><b>Until I stop</b><small>Fuzz still stops you before 2pm</small></button></div>' +
      '<div class="group">Waiting for a session</div><ul class="rows">' + POOL.map(function (x) { return '<li><span class="t">' + x.t + '<small>' + x.s + '</small></span><span class="meta">' + x.m + '</span></li>'; }).join('') + '</ul>' +
      '<div class="acts" style="margin-top:14px"><button class="btn primary" data-act="start">Start</button></div></div>';
  }
  function placeHead(title, sub) {
    var back = (S.opt === 'A') ? '<button class="back" data-go="' + S.mode + '">← Back to ' + (S.mode === 'triage' ? 'Triage' : 'Deep Work') + '</button>' : '';
    return '<div class="pagehead"><div><h2>' + title + '</h2><p class="meta">' + sub + '</p></div>' + back + '</div>';
  }
  function lineupRows() {
    function row(t, s, st) { return '<li><span class="t">' + t + '<small>' + s + '</small></span><span class="meta">' + st + '</span></li>'; }
    return '<div class="group">To decide · ' + (S.waiting + S.urgent) + '</div><ul class="rows">' + row('Send Priya the Q3 numbers', 'Email · yesterday', 'In Triage') + '</ul>' +
      '<div class="group">With Fuzz</div><ul class="rows">' + row('Book the offsite venue', 'Comparing three quotes', 'Working') + row('Reply to Dana about the contract', 'Draft ready', 'Needs your OK') + '</ul>' +
      '<div class="group">In Deep Work · ' + S.pool + '</div><ul class="rows">' + POOL.slice(0, S.pool).map(function (x) { return row(x.t, x.s, x.m); }).join('') + '</ul>' +
      '<div class="group">Waiting on others</div><ul class="rows">' + row('Security review sign-off', 'Waiting on Lee · checks back Monday', '3 days') + '</ul>';
  }
  function artifactRows() {
    var F = [['DOC', 'Q3 summary.docx', 'For “Send Priya the Q3 numbers” · today'], ['MD', 'Onboarding plan draft.md', 'For “Write the onboarding plan” · today'],
      ['PDF', 'Venue quotes.pdf', 'For “Book the offsite venue” · yesterday'], ['PPT', 'Roadmap outline.pptx', 'For “Outline the Q4 roadmap talk” · Tuesday']];
    return '<ul class="rows">' + F.map(function (f) { return '<li><span class="ft">' + f[0] + '</span><span class="t">' + f[1] + '<small>' + f[2] + '</small></span></li>'; }).join('') + '</ul>';
  }
  function lineup() { return placeHead('Lineup', 'Who has the ball.') + lineupRows(); }
  function artifacts() { return placeHead('Artifacts', 'Everything Fuzz has written, newest first.') + artifactRows(); }
  function library() {
    return '<div class="pagehead"><div><h2>Library</h2><p class="meta">Every task and every file, in one place.</p></div></div>' +
      '<div class="tabs2" role="tablist"><button role="tab" data-lib="tasks" aria-selected="' + (S.lib === 'tasks') + '">Tasks</button><button role="tab" data-lib="files" aria-selected="' + (S.lib === 'files') + '">Files</button></div>' +
      (S.lib === 'tasks' ? lineupRows() : artifactRows());
  }
  /* D's home: Fuzz reads the moment and suggests a mode. Picking one shows it in place, with a small switch to change your mind. */
  function suggestion() {
    if (S.session) return { mode: 'deepwork', why: S.urgent ? 'One thing can’t wait. Deal with it, then back to your session.' : 'You’re mid-session with ' + S.left + ' minutes left. Nothing needs you in Triage.' };
    if (S.urgent) return { mode: 'triage', why: 'Something has a time on it. Let’s clear Triage first. It’s ' + (S.waiting + S.urgent) + ' quick ones.' };
    if (S.waiting >= 5) return { mode: 'triage', why: S.waiting + ' things are waiting. Ten minutes of Triage first, then you’ll have room to go deep.' };
    if (S.pool) return { mode: 'deepwork', why: 'You’ve got until 2pm and nothing urgent. Good time to go deep.' };
    return { mode: 'triage', why: 'Nothing big waiting. A quick look at Triage and you’re clear.' };
  }
  function now() {
    var g = suggestion();
    if (S.session && S.urgent && !S.nowPicked) S.nowPicked = 'triage';
    var picked = S.nowPicked;
    if (!picked) {
      function opt(m, title, sub) { return '<button data-pick="' + m + '"' + (g.mode === m ? ' class="rec"' : '') + '>' + (g.mode === m ? '<span class="tag2">Fuzz suggests</span>' : '') + '<b>' + title + '</b><small>' + sub + '</small></button>'; }
      return perch(g.why) + '<div class="now-pick">' +
        opt('triage', 'Keep things moving', (S.waiting + S.urgent) ? (S.waiting + S.urgent) + ' waiting in Triage' : 'Triage is clear') +
        opt('deepwork', 'Do my work', S.pool ? S.pool + ' tasks in Deep Work' : 'Nothing in the pool yet') + '</div>';
    }
    var sw = '<div class="pagehead"><div class="seg small" role="group" aria-label="Mode">' +
      '<button data-pick="triage" aria-pressed="' + (picked === 'triage') + '">Triage' + triageDot() + '</button>' +
      '<button data-pick="deepwork" aria-pressed="' + (picked === 'deepwork') + '">Deep Work' + deepDot() + '</button></div>' +
      '<span class="meta">' + (picked === g.mode ? 'Fuzz’s pick' : 'Your pick') + '</span></div>';
    return sw + (picked === 'triage' ? triage() : deepwork());
  }
  function file() {
    return '<div class="pagehead"><div><h2>Q3 summary.docx</h2><p class="meta">Opened from the task, in the viewer. The global Artifacts list is one way here; the task is the other.</p></div><button class="back" data-go="' + S.mode + '">← Back</button></div>' +
      '<div class="panel2"><p>Q3 revenue came in at 4% over plan, led by the enterprise tier…</p></div>';
  }
  var BODIES = { triage: triage, deepwork: deepwork, lineup: lineup, artifacts: artifacts, library: library, now: now, file: file };

  /* ---------- Notes ---------- */
  var NOTES = {
    A: ['A switch for the modes, a menu for the places.', 'The bar is one decision: which mode you’re in. The places are a menu away (or L and F).',
      ['Triage and Deep Work look like two sides of one coin', 'Mid-session, the Triage dot only counts what can’t wait', 'Leave the session and a clock chip in the bar takes you back', 'On a phone, the toggle gets its own row and stays big'],
      ['Lineup is one click deeper. It’s where you answer “where did that go?”', 'When you’re on a place, neither mode is “on”, so the toggle shows where you came from (outlined)']],
    B: ['Each mode brings its own place.', 'Lineup sits beside Triage (keeping things moving), Artifacts beside Deep Work (the files you open while working).',
      ['The least clutter: everything on screen serves the mode you’re in', 'Switching modes changes the whole context, which reinforces the two stances'],
      ['“Where did Artifacts go?” Try switching to Triage and looking for it', 'Approving drafts in Triage touches files, so cards need their own file links (see the chip on the card)', 'Lineup is invisible while you’re in Deep Work']],
    C: ['Lineup and Artifacts merge into one Library.', 'Three tabs instead of four. Library has Tasks and Files inside.',
      ['The smallest change from today, and the easiest to learn', 'Artifacts already belongs to tasks, so one place for both is natural', 'Can be combined with A or B'],
      ['The modes still look like places, so the two-stance idea isn’t in the nav', 'Library risks becoming the junk drawer for every future page']],
    D: ['One home. Fuzz suggests the mode.', 'Now reads the moment: what’s waiting, what can’t wait, your free time, whether you’re mid-session. Pick a side, or take Fuzz’s pick.',
      ['Fits “Match the moment”: you never have to decide which mode to be in', 'Change the toolbar (waiting, can’t wait, session) to see Fuzz’s pick change', 'Once picked, a small switch on the page lets you change your mind'],
      ['One extra step every time you open it, unless Fuzz’s pick is trusted enough to skip it', 'If Fuzz guesses wrong often, it’s more annoying than a plain toggle', 'Lineup and Artifacts are still full tabs here; could pair with A’s menu']]
  };
  function notes() {
    var n = NOTES[S.opt];
    $('notes').innerHTML = '<div class="lede"><h3>' + S.opt + '. ' + n[0] + '</h3><p>' + n[1] + '</p></div>' +
      '<div><h3>Try</h3><ul>' + n[2].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' +
      '<div><h3>Watch for</h3><ul>' + n[3].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>';
  }

  /* ---------- Render and events ---------- */
  function render() {
    if (S.opt === 'B' && S.view === 'lineup' && S.mode !== 'triage') S.mode = 'triage';
    if (S.opt === 'B' && S.view === 'artifacts' && S.mode !== 'deepwork') S.mode = 'deepwork';
    $('opts').innerHTML = ['A', 'B', 'C', 'D'].map(function (o) { return '<button role="radio" data-opt="' + o + '" aria-checked="' + (S.opt === o) + '">' + o + '</button>'; }).join('');
    $('bar').innerHTML = BARS[S.opt]();
    $('body').innerHTML = BODIES[S.view]();
    notes();
  }
  function go(v) {
    S.menu = false;
    if (v === 'home') v = S.opt === 'D' ? 'now' : 'triage';
    if (S.opt === 'D' && (v === 'triage' || v === 'deepwork')) { S.nowPicked = v; S.mode = v; S.view = 'now'; render(); return; }
    if (S.opt === 'C' && (v === 'lineup' || v === 'artifacts')) { S.lib = v === 'lineup' ? 'tasks' : 'files'; v = 'library'; }
    if (S.opt !== 'D' && v === 'now') v = S.mode;
    if (v === 'triage' || v === 'deepwork') S.mode = v;
    if (v === 'now') S.nowPicked = null;
    S.view = v; render();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-opt],[data-go],[data-lib],[data-pick],[data-act],#menubtn');
    if (!t) { if (S.menu) { S.menu = false; render(); } return; }
    e.preventDefault();
    if (t.dataset.opt) { S.opt = t.dataset.opt; S.menu = false; S.nowPicked = null; S.view = S.opt === 'D' ? 'now' : (S.view === 'now' ? S.mode : S.view); if (S.opt !== 'C' && S.view === 'library') S.view = S.lib === 'tasks' ? 'lineup' : 'artifacts'; if (S.opt === 'C' && (S.view === 'lineup' || S.view === 'artifacts')) { S.lib = S.view === 'lineup' ? 'tasks' : 'files'; S.view = 'library'; } if (S.opt === 'D' && (S.view === 'lineup' || S.view === 'artifacts')) S.view = 'now'; render(); return; }
    if (t.id === 'menubtn') { S.menu = !S.menu; render(); return; }
    if (t.dataset.lib) { S.lib = t.dataset.lib; render(); return; }
    if (t.dataset.pick) { S.nowPicked = t.dataset.pick; S.mode = t.dataset.pick; render(); return; }
    if (t.dataset.act === 'start') { S.session = true; $('session').checked = true; render(); return; }
    go(t.dataset.go);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('select,input')) return;
    if (e.key === 'Escape' && S.menu) { S.menu = false; render(); }
    if (e.key === 'l' || e.key === 'L') go('lineup');
    if (e.key === 'f' || e.key === 'F') go('artifacts');
  });
  ['waiting', 'urgent', 'pool'].forEach(function (k) { $(k).addEventListener('change', function () { S[k] = +this.value; if (S.opt === 'D') S.nowPicked = null; render(); }); });
  $('session').addEventListener('change', function () { S.session = this.checked; if (S.opt === 'D') S.nowPicked = null; render(); });
  $('width').addEventListener('change', function () { $('stage').classList.toggle('phone', this.value === 'phone'); });

  /* ---------- Theme ---------- */
  Themes.list.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; $('theme').appendChild(o); });
  $('mode').value = Themes.resolveMode ? Themes.resolveMode('auto') : 'light';
  function theme() { Themes.apply($('theme').value, $('mode').value, 'standard'); }
  $('theme').addEventListener('change', theme); $('mode').addEventListener('change', theme);
  theme(); render();
})();
