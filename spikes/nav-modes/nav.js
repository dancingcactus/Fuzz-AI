/* Nav modes spike: four ways to separate the two modes (Triage, Deep Work) from the two places (Lineup, Artifacts).
   One state, one set of page bodies; each option only draws its own bar and decides where the places live.

   Round 2: the places live under the settings button (A, and D by default), the Triage count is a dot, and a Deep
   Work session has a real way in and every way out. The session is one small state machine shared by all four:
     none → setup → focus ⇄ break, focus → paused (urgent / walked away) → focus, any of them → wrap → none */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = { opt: 'A', view: 'triage', mode: 'triage', menu: false, lib: 'tasks', nowPicked: null,
    waiting: 6, urgent: 1, pool: 3, menuBtn: 'you', dPlaces: 'menu', recap: null, choice: null, startLayout: 'list' };
  /* the session */
  var D = { phase: 'none', task: 0, budget: 'cal', left: 14, steps: 1, why: null, after: 'keep', other: false, came: 0 };
  function session() { return D.phase === 'focus' || D.phase === 'break' || D.phase === 'paused'; }

  /* ---------- Icons ---------- */
  var I = {
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    person: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    grid: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
    doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
    keys: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>'
  };

  /* ---------- The dots: no numbers, nothing counting at you ---------- */
  /* In a session, Triage only lights up for what can't wait, so the toggle doesn't pull you out of focus */
  function triageDot() {
    var on = session() ? S.urgent : (S.waiting + S.urgent);
    return on ? '<span class="dot only" aria-label="' + (session() ? 'something can\'t wait' : 'things waiting') + '"></span>' : '';
  }
  function deepDot() { return S.pool ? '<span class="dot only" aria-label="something in the pool"></span>' : ''; }
  function sessionChip() {
    if (!session()) return '';
    var onIt = S.opt === 'D' ? (S.view === 'now' && !(D.phase === 'paused' && D.why === 'urgent')) : S.view === 'deepwork';
    if (onIt) return '';
    var p = Math.round((25 - D.left) / 25 * 100);
    var txt = D.phase === 'paused' ? 'Paused<span class="long">&nbsp;· back to it</span>' : D.phase === 'break' ? 'On a break' : D.left + ' min<span class="long">&nbsp;left · back to it</span>';
    return '<button class="chip sess" data-act="resume" title="Back to your session"><span class="ring" style="--p:' + p + '"></span>' + txt + '</button>';
  }

  /* ---------- The menu that used to be Settings ---------- */
  function menuItems() {
    return '<button role="menuitem" data-go="lineup">' + I.list + '<span><b>Lineup</b><small>Who has the ball: 12 in motion, 4 waiting on others</small></span><span class="k">L</span></button>' +
      '<button role="menuitem" data-go="artifacts">' + I.file + '<span><b>Artifacts</b><small>What Fuzz made: 2 new since yesterday</small></span><span class="k">F</span></button>' +
      '<hr><button role="menuitem">' + I.gear + '<span><b>Settings</b><small>Themes, connections, how Fuzz works</small></span></button>' +
      '<button role="menuitem">' + I.keys + '<span><b>Keys and help</b></span><span class="k">?</span></button>';
  }
  /* The button sits where Settings was, the same small round icon button, no label. Three faces to try. */
  var FACE = { you: I.person, grid: I.grid,
    dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>' };
  function menuButton() {
    return '<span class="wrapmenu"><button class="iconbtn2" id="menubtn" aria-haspopup="menu" aria-expanded="' + S.menu + '" aria-label="Lineup, Artifacts and Settings" title="Lineup, Artifacts and Settings (L, F)">' + FACE[S.menuBtn] +
      '</button>' + (S.menu ? '<div class="navmenu" role="menu">' + menuItems() + '</div>' : '') + '</span>';
  }
  function brand() { return '<a class="brand" href="#" data-go="home"><img src="../../assets/fuzz-mark.svg" alt=""><span>Fuzz</span></a>'; }
  function right(extra, withMenu) {
    return '<div class="right">' + (extra || '') +
      '<button class="iconbtn2 cta" title="New task (N)">' + I.plus + '<span class="lbl">New task</span></button>' +
      '<button class="iconbtn2" title="Undo">' + I.undo + '<span class="lbl">Undo</span></button>' +
      (withMenu ? menuButton() : '<button class="iconbtn2" aria-label="Settings">' + I.gear + '</button>') + '</div>';
  }
  function link(view, label, extra) { return '<button data-go="' + view + '"' + (S.view === view ? ' aria-current="page"' : '') + '>' + label + (extra || '') + '</button>'; }
  function toggle(cls, attr) {
    attr = attr || 'go';
    var away = S.view !== 'triage' && S.view !== 'deepwork' && S.view !== 'now';
    var m = S.opt === 'D' ? S.nowPicked : S.mode;
    return '<div class="seg' + (away ? ' away' : '') + (cls ? ' ' + cls : '') + '" role="group" aria-label="Mode">' +
      '<button data-' + attr + '="triage" aria-pressed="' + (m === 'triage') + '">Triage' + triageDot() + '</button>' +
      '<button data-' + attr + '="deepwork" aria-pressed="' + (m === 'deepwork') + '">Deep Work' + deepDot() + '</button></div>';
  }

  /* ---------- The four bars ---------- */
  var BARS = {
    /* A: the modes are a switch; the places live in the menu that used to be Settings */
    A: function () { return brand() + '<div class="navrow">' + toggle() + '</div>' + right(sessionChip(), true); },
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
    /* D: one home; Fuzz suggests the mode. The places are in the menu, or tabs. */
    D: function () {
      var lit = session() ? S.urgent : (S.waiting || S.urgent || S.pool);
      var tabs = S.dPlaces === 'tabs';
      return brand(!tabs) + '<div class="navrow links"><button data-go="now"' + (S.view === 'now' ? ' aria-current="page"' : '') + '>Now' + (lit ? '<span class="dot only"></span>' : '') + '</button>' +
        (tabs ? '<span class="sep" aria-hidden="true"></span>' + link('lineup', 'Lineup') + link('artifacts', 'Artifacts') : '') + '</div>' + right(sessionChip(), !tabs);
    }
  };

  /* ---------- Shared pieces ---------- */
  function perch(html) { return '<div class="perch2"><img src="../../assets/fuzz-mark.svg" alt=""><div class="say">' + html + '</div></div>'; }
  var POOL = [
    { t: 'Write the onboarding plan for the new analyst', m: 50, s: 'You left off at “week two”', step: ['List the systems they need on day one', 'Draft week one: who they meet', 'Draft week two: first real task', 'Send it to Sam for a look'], file: 'Onboarding plan draft.md' },
    { t: 'Review the pricing model before Tuesday', m: 30, s: 'Fuzz pulled the three versions together', step: ['Read Fuzz’s summary of the three versions', 'Check the enterprise tier numbers', 'Write your three comments'], file: 'Pricing v3.xlsx' },
    { t: 'Outline the Q4 roadmap talk', m: 45, s: 'Draft outline is ready', step: ['Read the draft outline', 'Pick the three themes', 'Rough the opening'], file: 'Roadmap outline.pptx' }
  ];
  var BUDGET = { cal: { l: 'Until 2pm', s: '~45 min, then your meeting', m: 45 }, burst: { l: 'A quick burst', s: '25 min', m: 25 }, open: { l: 'Until I stop', s: 'Fuzz still stops you before 2pm', m: 45 } };
  function card(urgent, inSession) {
    var h = inSession ? ' data-act="handled"' : '';
    return urgent
      ? '<article class="card2 urgent"><div class="dw-eyebrow">Slack · Marcus · needs an answer by 2pm</div><h3>Can we push the vendor call to Thursday?</h3>' +
        '<div class="sugg">Fuzz: I can say yes and move it. Thursday 10am is free for both of you.</div>' +
        '<div class="acts"><button class="btn primary"' + h + '>Hand it to Fuzz</button><button class="btn"' + h + '>Later</button><button class="btn"' + h + '>I did it</button></div></article>'
      : '<article class="card2"><div class="dw-eyebrow">Email · Priya · from yesterday</div><h3>Send Priya the Q3 numbers before the planning review</h3>' +
        '<div class="sugg">Fuzz: I drafted a summary from the finance sheet. It needs your OK on the headcount line.</div>' +
        '<div class="files"><button class="chip" data-go="file">' + I.doc + 'Q3 summary.docx</button></div>' +
        '<div class="acts"><button class="btn primary">Hand it to Fuzz</button><button class="btn">Later</button><button class="btn">Deep Work</button><button class="btn">I did it</button></div></article>';
  }
  function recapLine() {
    if (!S.recap) return '';
    var r = S.recap;
    return r.finished ? '<b>You finished “' + r.t + '”.</b> ' : '<b>Nice: ' + r.mins + ' minutes on “' + r.t + '”.</b> I saved where you left off. ';
  }

  /* ---------- Triage ---------- */
  function triage() {
    if (session()) {
      var paused = D.phase === 'paused' && D.why === 'urgent';
      var head = '<div class="banner"><span class="grow"><b>' + (paused ? 'Your session is paused.' : 'You’re in a Deep Work session.') + '</b> ' +
        (paused ? 'The clock waits while you deal with this.' : 'Triage only shows what can’t wait.') + '</span><button class="btn" data-act="resume">Back to it</button></div>';
      return head + (S.urgent ? perch('One thing can’t wait. Then straight back to it.') + card(true, true)
        : perch('Nothing here can’t wait. The rest keeps until after your session.'));
    }
    var n = S.waiting + S.urgent;
    if (!n) {
      return perch(recapLine() + '<b>All clear.</b> Nothing is waiting on you.' + (S.pool ? '<span class="sub">' + S.pool + ' tasks are in Deep Work for when you have time.</span>' : '')) +
        (S.pool ? '<button class="btn primary" data-go="deepwork">Go deep on something</button>' : '');
    }
    return perch(recapLine() + (S.urgent ? 'This one has a time on it, so it’s first.' : 'Next one. Quick decisions, I’ll do the rest.')) + card(!!S.urgent);
  }

  /* ---------- Deep Work: one flow for every option ---------- */
  function deepwork() { return ({ setup: setup, focus: focus, break: brk, paused: paused, wrap: wrap }[D.phase] || setup)(); }
  /* Way in: how long, then Fuzz's pick. One task, not a list to choose from (the pool is one tap away). */
  function setup() {
    if (!S.pool) return perch('<b>Nothing in Deep Work.</b> When something needs you and takes real time, it waits here.');
    var t = POOL[D.task];
    var times = Object.keys(BUDGET).map(function (k) { var b = BUDGET[k]; return '<button data-budget="' + k + '" class="' + (D.budget === k ? 'on' : '') + '"><b>' + b.l + '</b><small>' + b.s + '</small></button>'; }).join('');
    var other = D.other ? '<ul class="rows" style="margin-bottom:10px">' + POOL.map(function (x, i) {
      return '<li class="' + (i === D.task ? 'sel' : '') + '"><span class="t">' + x.t + '<small>' + x.s + '</small></span><button class="go" data-task="' + i + '">' + (i === D.task ? 'Picked' : 'This one') + '</button></li>'; }).join('') + '</ul>' : '';
    var fits = t.m <= BUDGET[D.budget].m ? 'Fits in your time.' : 'Won’t fit in one go. I’ll stop you at a good place.';
    return perch('You’ve got until <b>2pm</b>. Want to go deep on something?<span class="sub">Nothing in Triage needs you before then.</span>') +
      '<div class="panel2"><h3>How long do you have?</h3><div class="times">' + times + '</div>' +
      '<h3>Start with</h3><div class="pick"><span class="t"><b>' + t.t + '</b><small>' + t.s + ' · ~' + t.m + ' min · ' + fits + '</small></span></div>' +
      '<button class="linkbtn" data-act="other">' + (D.other ? 'Hide the others' : 'Something else (' + (S.pool - 1) + ' more)') + '</button>' + other +
      '<div class="acts" style="margin-top:10px"><button class="btn primary" data-act="start">Start</button><button class="btn" data-act="notnow">Not now</button></div></div>';
  }
  function focus() {
    var t = POOL[D.task], p = Math.round((25 - D.left) / 25 * 100), st = t.step[Math.min(D.steps, t.step.length - 1)];
    return '<div class="panel2"><div class="dw-eyebrow">Deep Work · block 2 of 3 · Fuzz stops you at 1:55 for your 2pm</div>' +
      '<div class="clock"><span class="big" style="--p:' + p + '"></span><div><b>' + D.left + ' min</b> left in this block<div class="meta">Then a 5 minute break</div></div></div>' +
      '<h3>' + t.t + '</h3><div class="step">Now: ' + st + '</div>' +
      '<div class="files"><button class="chip" data-go="file">' + I.doc + t.file + '</button></div>' +
      '<div class="acts" style="margin-top:14px"><button class="btn primary" data-act="step">Done with this step</button><button class="btn" data-act="finished">Finished the task</button><button class="btn" data-act="stop">Stop for now</button></div></div>';
  }
  function brk() {
    return '<div class="panel2 breakp"><span class="big" style="display:block;width:64px;height:64px;border-radius:50%;background:conic-gradient(var(--ok) 30%, var(--field) 0)"></span>' +
      '<h3>Break · 5 min</h3><p class="meta">Stand up and stretch your arms over your head. I’ve got your place.</p>' +
      '<div class="acts" style="justify-content:center;margin-top:14px"><button class="btn" data-act="resume">Back to it</button><button class="btn" data-act="stop">Stop here</button></div></div>';
  }
  /* Walked away: no guilt, just where you were */
  function paused() {
    if (D.why === 'urgent') return triage();
    var t = POOL[D.task];
    return perch('<b>Welcome back.</b> You stepped away for a bit, so I paused the clock.') +
      '<div class="panel2"><div class="dw-eyebrow">Where you were</div><h3>' + t.t + '</h3><div class="step">Next: ' + t.step[Math.min(D.steps, t.step.length - 1)] + '</div>' +
      '<div class="acts"><button class="btn primary" data-act="resume">Pick up where I left off</button><button class="btn" data-act="stop">Stop here</button></div></div>';
  }
  /* Way out: every exit lands here. Save the place, decide what happens to the task, then home. */
  var WHY = {
    stop: ['Stopping here.', 'Good place to pause.'],
    time: ['That’s your time.', 'Wrap it here and it’ll be easy to pick up.'],
    meeting: ['Your 2pm is in 5 minutes.', 'Let’s save your place so you can go.'],
    away: ['Let’s close this one out.', 'You can pick it up any time.'],
    finished: ['You finished it.', 'That one’s done.']
  };
  function wrap() {
    var t = POOL[D.task], w = WHY[D.why] || WHY.stop, done = t.step.slice(0, D.steps), nxt = POOL[(D.task + 1) % 3];
    var next = t.step[Math.min(D.steps, t.step.length - 1)], room = S.pool > 1 && D.left > 10;
    var body = D.why === 'finished'
      ? '<span class="lbl2">What you did</span><ul class="did">' + t.step.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
        (room ? '<p class="meta">You’ve still got ' + D.left + ' minutes. “' + nxt.t + '” is about ' + nxt.m + ' min.</p>' : '') +
        '<div class="acts" style="margin-top:12px"><button class="btn primary" data-act="wrapdone">Done for now</button>' + (room ? '<button class="btn" data-act="nexttask">Start the next one</button>' : '') + '</div>'
      : '<span class="lbl2">What you did</span><ul class="did">' + (done.length ? done.map(function (s) { return '<li>' + s + '</li>'; }).join('') : '<li>Got started, and that counts</li>') + '</ul>' +
        '<label class="lbl2" for="leftoff">Where you left off</label><textarea id="leftoff">Next: ' + next.charAt(0).toLowerCase() + next.slice(1) + '.</textarea>' +
        '<span class="lbl2">Then what?</span><div class="choices">' +
          [['keep', 'Back in Deep Work'], ['fuzz', 'Hand the rest to Fuzz'], ['book', 'Book time to finish']].map(function (c) { return '<button data-after="' + c[0] + '" aria-pressed="' + (D.after === c[0]) + '">' + c[1] + '</button>'; }).join('') + '</div>' +
        '<div class="acts"><button class="btn primary" data-act="wrapdone">' + (D.why === 'meeting' ? 'Save it and go' : 'Wrap up') + '</button>' + (D.why === 'stop' ? '<button class="btn" data-act="resume">Actually, keep going</button>' : '') + '</div>';
    return perch('<b>' + w[0] + '</b> ' + w[1]) + '<div class="panel2"><h3>' + t.t + '</h3>' + body + '</div>';
  }

  /* ---------- The places ---------- */
  function placeHead(title, sub) {
    var back = (S.opt === 'A' || (S.opt === 'D' && S.dPlaces === 'menu')) ? '<button class="back" data-go="home">← Back to ' + (S.opt === 'D' ? 'Now' : S.mode === 'triage' ? 'Triage' : 'Deep Work') + '</button>' : '';
    return '<div class="pagehead"><div><h2>' + title + '</h2><p class="meta">' + sub + '</p></div>' + back + '</div>';
  }
  function lineupRows() {
    function row(t, s, st) { return '<li><span class="t">' + t + '<small>' + s + '</small></span><span class="meta">' + st + '</span></li>'; }
    return '<div class="group">To decide</div><ul class="rows">' + row('Send Priya the Q3 numbers', 'Email · yesterday', 'In Triage') + '</ul>' +
      '<div class="group">With Fuzz</div><ul class="rows">' + row('Book the offsite venue', 'Comparing three quotes', 'Working') + row('Reply to Dana about the contract', 'Draft ready', 'Needs your OK') + '</ul>' +
      '<div class="group">In Deep Work</div><ul class="rows">' + POOL.slice(0, S.pool).map(function (x, i) {
        return '<li><span class="t">' + x.t + '<small>' + x.s + ' · ~' + x.m + ' min</small></span>' + (session() ? '' : '<button class="go" data-deep="' + i + '">Go deep on this</button>') + '</li>'; }).join('') + '</ul>' +
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
  function file() {
    return '<div class="pagehead"><div><h2>Q3 summary.docx</h2><p class="meta">Opened from the task, in the viewer.</p></div><button class="back" data-go="home">← Back</button></div>' +
      '<div class="panel2"><p>Q3 revenue came in at 4% over plan, led by the enterprise tier…</p></div>';
  }

  /* ---------- D's home ---------- */
  /* Fuzz reads the moment and suggests a mode. While a session runs, Now is the session. */
  function suggestion() {
    /* how the last session ended changes what's next */
    if (S.recap && S.recap.why === 'meeting') return { mode: 'triage', why: 'Go, your 2pm is starting. Triage will be here when you’re back.' };
    if (S.recap && S.recap.why === 'time') return { mode: 'triage', why: 'Good stretch. Take a break, then a quick look at Triage.' };
    if (S.urgent) return { mode: 'triage', why: 'Something has a time on it. Let’s clear Triage first. It’s quick.' };
    if (S.waiting >= 5) return { mode: 'triage', why: 'A few things are waiting. Ten minutes of Triage first, then you’ll have room to go deep.' };
    if (S.pool) return { mode: 'deepwork', why: 'You’ve got until 2pm and nothing urgent. Good time to go deep.' };
    return { mode: 'triage', why: 'Nothing big waiting. A quick look at Triage and you’re clear.' };
  }
  /* The start screen: clicking Now always asks "What do you want to work on?". Triage is one of the answers,
     beside the Deep Work tasks, so there's no mode to toggle: you pick a thing to do, and Start. */
  var TRIAGE_TITLES = ['Send Priya the Q3 numbers', 'Approve the venue deposit', 'Reply to Dana about the contract', 'Is “Project Wren” the same as “Wren rollout”?', 'Lunch with Ana: Tuesday or Thursday?', 'Sign the expense report'];
  function triageN() { return S.waiting + S.urgent; }
  function triageMins() { return Math.max(3, Math.round(triageN() * 1.5)); }
  function suggested() { var g = suggestion(); return g.mode === 'triage' || !S.pool ? (triageN() ? 'triage' : (S.pool ? 0 : null)) : 0; }
  function chosen() { return S.choice != null ? S.choice : suggested(); }
  function fuzzTag(on) { return on ? '<span class="tag2 inline">Fuzz suggests</span>' : ''; }
  function triageRow(c, sug) {
    var n = triageN();
    return '<button data-choice="triage" aria-pressed="' + (c === 'triage') + '"' + (n ? '' : ' disabled') + '><span class="radio"></span><span class="t"><b>Triage' + fuzzTag(sug === 'triage') + '</b><small>' +
      (n ? (S.urgent ? 'One has a time on it. ' : '') + 'Quick decisions, I do the rest' : 'Nothing is waiting on you') + '</small></span><span class="m">' + (n ? '~' + triageMins() + ' min' : 'Clear') + '</span></button>';
  }
  function taskRows(c, sug) {
    return POOL.slice(0, S.pool).map(function (x, i) {
      return '<li><button data-choice="' + i + '" aria-pressed="' + (c === i) + '"><span class="radio"></span><span class="t"><b>' + x.t + fuzzTag(sug === i) + '</b><small>' + x.s + '</small></span><span class="m">~' + x.m + ' min</span></button></li>';
    }).join('');
  }
  function timeChips(task) {
    var times = Object.keys(BUDGET).map(function (k) { var b = BUDGET[k]; return '<button data-budget="' + k + '" class="' + (D.budget === k ? 'on' : '') + '"><b>' + b.l + '</b><small>' + b.s + '</small></button>'; }).join('');
    var fits = POOL[task].m <= BUDGET[D.budget].m ? 'Fits in your time.' : 'Won’t fit in one go. I’ll stop you at a good place.';
    return '<div class="times">' + times + '</div><p class="meta" style="margin-top:-6px">' + fits + '</p>';
  }
  function startList(c, sug) {
    var deep = c !== 'triage' && c != null;
    return '<div class="panel2 start"><h3>What do you want to work on?</h3><ul class="choose">' +
      '<li class="grp">Keep things moving</li><li>' + triageRow(c, sug) + '</li>' +
      (S.pool ? '<li class="grp">Do my work</li>' + taskRows(c, sug) : '') + '</ul>' +
      (deep ? '<h3 class="q2">How long do you have?</h3>' + timeChips(c) : '') +
      '<div class="startbtn"><button class="btn primary" data-act="go"' + (c == null ? ' disabled' : '') + '>' +
        (c === 'triage' ? 'Start Triage' : deep ? 'Start: ' + POOL[c].t.split(' ').slice(0, 4).join(' ') + '…' : 'Nothing to start') + '</button></div></div>';
  }
  function startSides(c, sug) {
    var n = triageN(), task = typeof c === 'number' ? c : (typeof sug === 'number' ? sug : 0);
    var titles = (S.urgent ? ['Can we push the vendor call to Thursday?'] : []).concat(TRIAGE_TITLES).slice(0, Math.min(3, n));
    var left = '<section class="side' + (sug === 'triage' ? ' rec' : '') + '">' + fuzzTag(sug === 'triage').replace(' inline', '') +
      '<h3>Keep things moving</h3><p class="meta">' + (n ? n + ' waiting · about ' + triageMins() + ' min. Quick decisions; I do the rest.' : 'Nothing is waiting on you.') + '</p>' +
      (n ? '<ul class="triage-sum">' + titles.map(function (t) { return '<li>' + t + '</li>'; }).join('') + (n > 3 ? '<li class="meta">and ' + (n - 3) + ' more</li>' : '') + '</ul>' +
        '<button class="btn primary" style="width:100%;min-height:48px" data-act="gotriage">Start Triage</button>' : '') + '</section>';
    var right = '<section class="side' + (typeof sug === 'number' ? ' rec' : '') + '">' + (typeof sug === 'number' ? '<span class="tag2">Fuzz suggests</span>' : '') +
      '<h3>Do my work</h3><p class="meta">' + (S.pool ? 'You’ve got until 2pm.' : 'Nothing in Deep Work yet.') + '</p>' +
      (S.pool ? '<div class="q">What do you want to work on?</div><ul class="choose">' + taskRows(task, sug) + '</ul>' +
        '<div class="q">How long do you have?</div>' + timeChips(task) +
        '<button class="btn primary" style="width:100%;min-height:48px" data-act="godeep" data-task-start="' + task + '">Start</button>' : '') + '</section>';
    return '<div class="sides">' + left + right + '</div>';
  }
  function now() {
    if (session() || D.phase === 'wrap') return deepwork();
    if (S.nowPicked === 'triage') {
      return '<div class="backline"><span>Keeping things moving</span><button class="linkbtn" data-go="now">Pick something else</button></div>' + triage();
    }
    var g = suggestion(), sug = suggested(), c = chosen();
    var say = S.recap ? recapLine() + (D.came ? '<span class="sub">While you were in it: ' + D.came + ' new in Triage, nothing urgent.</span>' : '') + '<span class="sub">' + g.why + '</span>' : g.why;
    return perch(say) + (S.startLayout === 'sides' ? startSides(c, sug) : startList(c, sug));
  }
  var BODIES = { triage: triage, deepwork: deepwork, lineup: lineup, artifacts: artifacts, library: library, now: now, file: file };

  /* ---------- Notes ---------- */
  var NOTES = {
    A: ['A switch for the modes. Everything else is under one button.', 'The settings button becomes the menu for Lineup, Artifacts and Settings. Try its three faces in the toolbar: You, the Fuzz logo, or Everything.',
      ['The bar is down to one decision: which mode you’re in', '“You” reads as “your stuff and your settings”, the common pattern', 'The Fuzz logo as the menu frees a button, but logos usually mean “home”', 'Mid-session, the Triage dot only lights for what can’t wait'],
      ['Lineup is one click deeper. It’s where you answer “where did that go?”', 'Settings and Lineup in one menu mixes “configure” with “look things up”']],
    B: ['Each mode brings its own place.', 'Lineup sits beside Triage (keeping things moving), Artifacts beside Deep Work (the files you open while working).',
      ['The least clutter: everything on screen serves the mode you’re in', 'Switching modes changes the whole context, which reinforces the two stances'],
      ['“Where did Artifacts go?” Try switching to Triage and looking for it', 'Approving drafts in Triage touches files, so cards need their own file links', 'Lineup is invisible while you’re in Deep Work']],
    C: ['Lineup and Artifacts merge into one Library.', 'Three tabs instead of four. Library has Tasks and Files inside.',
      ['The smallest change from today, and the easiest to learn', 'Artifacts already belongs to tasks, so one place for both is natural'],
      ['The modes still look like places, so the two-stance idea isn’t in the nav', 'Library risks becoming the junk drawer for every future page']],
    D: ['One home. Now always asks “What do you want to work on?”', 'No mode toggle: Triage is one of the answers, beside the Deep Work tasks. Fuzz pre-picks one. While a session runs, Now is the session. Try both layouts with Start screen in the toolbar, and use “During a session” to try each way out.',
      ['One list: Triage and the tasks as one choice, then how long, then Start', 'Two sides: Keep things moving and Do my work side by side, each with its own Start', 'Change what’s waiting and watch Fuzz’s pick move', 'In Triage, Now or “Pick something else” brings the start screen back', 'Stop for now, Time’s up and Meeting in 5 all land on one wrap-up', 'Something urgent pauses the clock and shows only that card', 'Walked away: “Welcome back”, with the next step', 'After wrap-up, Now says what you did and suggests what’s next'],
      ['One extra step every time you open it, unless Fuzz’s pick is trusted enough to skip it', 'If Fuzz guesses wrong often, it’s more annoying than a plain toggle', 'Is the wrap-up one screen too many when you’re rushing to a meeting?']]
  };
  var FLOW = '<div class="flowmap"><h3>Ways in and out of Deep Work</h3><ul>' +
    '<li><b>In (D):</b> Now’s start screen. “Go deep on something” when Triage is clear and “Go deep on this” in Lineup open the same screen with that task already picked.</li>' +
    '<li><b>In (A, B, C):</b> the Deep Work page asks how long, shows Fuzz’s one pick with the rest a tap away, then Start or Not now.</li>' +
    '<li><b>Out, on purpose:</b> Stop for now · Finished the task (offers the next one if there’s time)</li>' +
    '<li><b>Out, by the clock:</b> Time’s up · Meeting in 5 (Fuzz stops you 5 min early)</li>' +
    '<li><b>Paused, not out:</b> Something urgent (clock waits, one card, Back to it) · Walked away (Welcome back, or Stop here) · Break (Back to it, or Stop here)</li>' +
    '<li><b>Every way out</b> lands on one wrap-up: what you did, where you left off (Fuzz pre-fills it), what happens to the task. Then Now, with a recap.</li></ul></div>';
  function notes() {
    var n = NOTES[S.opt];
    $('notes').innerHTML = '<div class="lede"><h3>' + S.opt + '. ' + n[0] + '</h3><p>' + n[1] + '</p></div>' +
      '<div><h3>Try</h3><ul>' + n[2].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' +
      '<div><h3>Watch for</h3><ul>' + n[3].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' + FLOW;
  }

  /* ---------- Render ---------- */
  function render() {
    if (S.opt === 'B' && S.view === 'lineup') S.mode = 'triage';
    if (S.opt === 'B' && S.view === 'artifacts') S.mode = 'deepwork';
    document.body.dataset.opt = S.opt;
    $('opts').innerHTML = ['A', 'B', 'C', 'D'].map(function (o) { return '<button role="radio" data-opt="' + o + '" aria-checked="' + (S.opt === o) + '">' + o + '</button>'; }).join('');
    $('bar').innerHTML = BARS[S.opt]();
    $('body').innerHTML = BODIES[S.view]();
    $('session').checked = session();
    document.querySelectorAll('[data-ev]').forEach(function (b) { b.disabled = !session(); });
    notes();
  }
  /* Where the session shows: Now in D, the Deep Work page elsewhere */
  function showSession() { if (S.opt === 'D') { S.view = 'now'; S.nowPicked = null; } else { S.mode = 'deepwork'; S.view = 'deepwork'; } }
  function showHome() { if (S.opt === 'D') { S.view = 'now'; S.nowPicked = null; } else { S.mode = 'triage'; S.view = 'triage'; } }
  function go(v) {
    S.menu = false;
    if (v === 'home') v = S.opt === 'D' ? 'now' : S.mode;
    if (S.opt === 'D') {
      /* in D, every way into Deep Work is the start screen with a task already picked */
      if (v === 'deepwork') { if (!session() && D.phase !== 'wrap') { D.phase = 'none'; S.choice = S.pool ? D.task : null; } S.view = 'now'; S.nowPicked = null; render(); return; }
      if (v === 'triage') { S.nowPicked = 'triage'; v = 'now'; }
      else if (v === 'now') { S.nowPicked = null; S.choice = null; }
    } else {
      if (v === 'now') v = S.mode;
      if (v === 'deepwork' && D.phase === 'none') D.phase = 'setup';
      if (S.opt === 'C' && (v === 'lineup' || v === 'artifacts')) { S.lib = v === 'lineup' ? 'tasks' : 'files'; v = 'library'; }
      if (v === 'triage' || v === 'deepwork') S.mode = v;
    }
    if (v !== 'now' && v !== 'triage') S.recap = null;
    S.view = v; render();
  }
  function start() { D.phase = 'focus'; D.left = 14; D.steps = 0; D.came = 0; D.after = 'keep'; S.recap = null; showSession(); }
  function wrapUp(why) { D.why = why; D.phase = 'wrap'; showSession(); }
  function done() {
    S.recap = { t: POOL[D.task].t, mins: 25 - D.left + 25, finished: D.why === 'finished', why: D.why };
    D.came = 2; S.waiting = Math.max(S.waiting, 2); $('waiting').value = String(S.waiting);
    D.phase = 'none'; D.why = null; D.other = false;
    showHome();
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-opt],[data-go],[data-lib],[data-pick],[data-act],[data-budget],[data-task],[data-after],[data-deep],[data-choice],[data-ev],#menubtn');
    if (!t) { if (S.menu && !e.target.closest('.navmenu')) { S.menu = false; render(); } return; }
    e.preventDefault();
    var ds = t.dataset;
    if (ds.opt) {
      S.opt = ds.opt; S.menu = false; S.nowPicked = null;
      var inFlow = D.phase !== 'none';
      if (S.opt === 'D') S.view = 'now';
      else if (S.view === 'now') S.view = inFlow ? 'deepwork' : 'triage';
      if (S.opt !== 'C' && S.view === 'library') S.view = S.lib === 'tasks' ? 'lineup' : 'artifacts';
      if (S.opt === 'C' && (S.view === 'lineup' || S.view === 'artifacts')) { S.lib = S.view === 'lineup' ? 'tasks' : 'files'; S.view = 'library'; }
      if (S.view === 'triage' || S.view === 'deepwork') S.mode = S.view;
      render(); return;
    }
    if (t.id === 'menubtn') { S.menu = !S.menu; render(); return; }
    if (ds.lib) { S.lib = ds.lib; render(); return; }
    if (ds.budget) { D.budget = ds.budget; render(); return; }
    if (ds.task) { D.task = +ds.task; D.other = false; render(); return; }
    if (ds.after) { D.after = ds.after; render(); return; }
    if (ds.deep) {
      D.task = +ds.deep; S.menu = false;
      if (S.opt === 'D') { D.phase = 'none'; S.choice = D.task; S.view = 'now'; S.nowPicked = null; } else { D.phase = 'setup'; showSession(); }
      render(); return;
    }
    if (ds.choice) { S.choice = ds.choice === 'triage' ? 'triage' : +ds.choice; if (S.choice !== 'triage') D.task = S.choice; render(); return; }
    if (ds.pick) {
      if (ds.pick === 'deepwork') { if (D.phase === 'none') D.phase = 'setup'; showSession(); }
      else { S.nowPicked = 'triage'; S.view = 'now'; }
      render(); return;
    }
    if (ds.ev) {
      if (ds.ev === 'meeting') { D.left = 5; wrapUp('meeting'); }
      else if (ds.ev === 'time') { D.left = 0; wrapUp('time'); }
      else {
        if (ds.ev === 'brk') D.phase = 'break';
        if (ds.ev === 'urgent') { D.phase = 'paused'; D.why = 'urgent'; S.urgent = 1; $('urgent').value = '1'; }
        if (ds.ev === 'away') { D.phase = 'paused'; D.why = 'away'; }
        if (S.opt === 'D') showSession(); else if (ds.ev === 'urgent') { S.mode = 'triage'; S.view = 'triage'; } else showSession();
      }
      render(); return;
    }
    if (ds.act) {
      var a = ds.act;
      if (a === 'start') start();
      else if (a === 'go' || a === 'gotriage' || a === 'godeep') {
        var c = a === 'gotriage' ? 'triage' : a === 'godeep' ? +ds.taskStart : chosen();
        if (c === 'triage') { S.nowPicked = 'triage'; S.recap = null; } else { D.task = c; start(); }
      }
      else if (a === 'notnow') { D.phase = 'none'; D.other = false; showHome(); }
      else if (a === 'other') D.other = !D.other;
      else if (a === 'step') { D.steps = Math.min(D.steps + 1, POOL[D.task].step.length - 1); D.left = Math.max(2, D.left - 4); }
      else if (a === 'finished') wrapUp('finished');
      else if (a === 'stop') wrapUp('stop');
      else if (a === 'resume' || a === 'handled') {
        if (a === 'handled') { S.urgent = 0; $('urgent').value = '0'; }
        if (D.phase === 'paused' || D.phase === 'break' || D.phase === 'wrap') { D.phase = 'focus'; D.why = null; }
        S.menu = false; showSession();
      }
      else if (a === 'wrapdone') done();
      else if (a === 'nexttask') { D.task = (D.task + 1) % S.pool; start(); }
      render(); return;
    }
    go(ds.go);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('select,input,textarea')) return;
    if (e.key === 'Escape' && S.menu) { S.menu = false; render(); }
    if (e.key === 'l' || e.key === 'L') go('lineup');
    if (e.key === 'f' || e.key === 'F') go('artifacts');
  });
  ['waiting', 'urgent', 'pool'].forEach(function (k) { $(k).addEventListener('change', function () { S[k] = +this.value; render(); }); });
  $('session').addEventListener('change', function () { if (this.checked) start(); else { D.phase = 'none'; showHome(); } render(); });
  $('width').addEventListener('change', function () { $('stage').classList.toggle('phone', this.value === 'phone'); });
  $('menubtnstyle').addEventListener('change', function () { S.menuBtn = this.value; S.menu = false; render(); });
  $('dplaces').addEventListener('change', function () { S.dPlaces = this.value; S.menu = false; render(); });
  $('startlayout').addEventListener('change', function () { S.startLayout = this.value; render(); });

  /* ---------- Theme ---------- */
  Themes.list.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; $('theme').appendChild(o); });
  $('mode').value = Themes.resolveMode ? Themes.resolveMode('auto') : 'light';
  function theme() { Themes.apply($('theme').value, $('mode').value, 'standard'); }
  $('theme').addEventListener('change', theme); $('mode').addEventListener('change', theme);
  theme(); render();
})();
