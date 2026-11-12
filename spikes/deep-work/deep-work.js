/* Deep Work spike: triage decides, Deep Work does, and you enter it whenever you have time.
   Everything is in memory; Reset starts over. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- Theme ---------- */
  var themeSel = $('theme'), modeSel = $('mode');
  Themes.list.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; themeSel.appendChild(o); });
  modeSel.value = Themes.resolveMode ? Themes.resolveMode('auto') : 'light';
  function theme() { Themes.apply(themeSel.value, modeSel.value, 'standard'); }
  themeSel.onchange = modeSel.onchange = theme; theme();

  /* ---------- Fuzz ---------- */
  $('pwrap').innerHTML = window.FUZZ_SVG;
  var bot = document.getElementById('bot');
  function say(text, mood) { $('say').textContent = text; if (mood) bot.dataset.mood = mood; }
  function idleMood() { return chatty() ? 'working' : 'chill'; }
  function settle(ms) { setTimeout(function () { if (S.view === 'focus' && !S.sheet && !S.take && !S.asking) bot.dataset.mood = idleMood(); }, ms || 1500); }

  /* ---------- The deep work pool (invented). Each task needs you and takes real time. ---------- */
  function TASKS() {
    return [
      { id: 'launch', title: 'Propose a launch date to Elena', est: 45,
        why: 'Support, docs and marketing are waiting on it. Elena needs a date by Monday.',
        prep: 'I read Elena’s two emails and Raj’s reply, checked the release calendar and started a draft.',
        sources: ['Elena Park · Email · Today', 'Raj Mehta · Email · Yesterday', 'Release calendar'],
        split: [P('Pick the date: Oct 2 or Oct 9', 10, 'deep'), P('Draft the email to Elena from your pick', 0, 'fuzz'), P('Approve and send the email', 2, 'triage')],
        steps: [
          { t: 'Read my two-line summary of the thread', help: 'Elena needs one date by Monday. Raj says the large-table fix takes two weeks if it lands this sprint. The calendar has Oct 2 and Oct 9 open.', smaller: ['Read the first line of the summary', 'Read Raj’s estimate'] },
          { t: 'Pick a date: Oct 2 or Oct 9', help: 'I lean Oct 9: it leaves a week of slack after Raj’s fix. Oct 2 only works if the fix lands this week.', fuzz: 'My pick: Oct 9.\nWhy: Raj’s fix, plus a week for docs.' },
          { t: 'Write three reasons, one line each', help: 'Rough is fine. I can tidy the wording afterwards.', fuzz: '1. The large-table fix lands first.\n2. Docs get a full week after it.\n3. Support training fits the week before.', smaller: ['Write just the first reason', 'Write the other two'] },
          { t: 'Make my draft sound like you', help: 'Draft: “Hi Elena, I can commit to Oct 9. Here’s why…”', fuzz: 'Hi Elena,\nI can commit to Oct 9, and here’s why…' },
          { t: 'Hand the draft back to me for Approve and send', help: 'It waits in Triage as “Needs your OK”. Nothing goes out until you approve it.' }
        ] },
      { id: 'readout', title: 'Make the call on the A/B test readout', est: 30,
        why: 'Priya briefs her team on Tuesday and wants a clear yes or no.',
        prep: 'I pulled the results dashboard, wrote a one-paragraph summary and listed the two caveats.',
        sources: ['Priya Raman · Email · Today', 'Experiment dashboard', 'Readout template'],
        split: [P('Decide: ship, don’t ship, or run longer', 10, 'deep'), P('Write the readout from your call', 0, 'fuzz'), P('Approve the reply to Priya', 2, 'triage')],
        steps: [
          { t: 'Skim the summary and the two caveats', help: 'Variant B: +3.1% conversion, 94% confidence. Caveats: one noisy day (the outage), and mobile is flat.' },
          { t: 'Decide: ship, don’t ship, or run longer', help: 'There’s no wrong answer here. Whichever you pick, I write it up.', fuzz: 'If it were me: ship to desktop, run mobile one more week.' },
          { t: 'Write the call and one reason in the template', help: 'One sentence each is plenty.', smaller: ['Write the call', 'Write one reason'] },
          { t: 'Send it to me to tidy and draft the reply to Priya', help: 'The reply waits in Triage for your OK.' }
        ] },
      { id: 'rubric', title: 'Write the interview rubric for the staff role', est: 40, passed: 3,
        why: 'Hiring starts in two weeks. Sam asked for it three weeks ago.',
        prep: 'I pulled the job description and the rubric from the last staff hire, and marked what’s different this time.',
        sources: ['Sam Ortiz · Slack · 3 weeks ago', 'Job description', 'Last staff rubric'],
        steps: [
          { t: 'Read the four differences I marked', help: 'This role leads a team of five, owns on-call, works with design daily, and has no data science partner.' },
          { t: 'Pick the four things you’d hire for', help: 'Last time: system design, mentoring, writing, judgment. Swap any that don’t fit.', fuzz: 'System design · Leading through others · Writing · Judgment under pressure' },
          { t: 'Write one strong signal for each', smaller: ['Write the signal for the first one', 'Write the other three'] },
          { t: 'Send it to Sam', help: 'I’ll draft the note. It waits in Triage for your OK.' }
        ] },
      { id: 'q3', title: 'Outline the Q3 planning doc', est: 60, noProgress: 1,
        why: 'For the planning review. No hard date yet, but it keeps coming back.',
        prep: 'Last time I kept your bullets and lined up last quarter’s risks next to them.',
        resume: 'You stopped at the “Risks” heading, with two bullets written.',
        sources: ['Q2 planning doc', 'Your draft (3 of 6 sections)'],
        split: [P('Finish Risks: one more bullet', 10, 'deep'), P('Write the Asks with a budget placeholder', 15, 'deep'), P('Fill in the budget when Dana’s numbers come', 0, 'fuzz')],
        at: 3,
        steps: [
          { t: 'Paste in last quarter’s headings' },
          { t: 'Write one line under Goals' },
          { t: 'Write one line under Bets' },
          { t: 'Add a third bullet under Risks', help: 'Your two: hiring lag, the data migration. Last quarter also had “vendor contract renewal”.', fuzz: '3. The vendor contract renews in August, and nobody owns it yet.' },
          { t: 'Write one line under Asks', help: 'What do you need from leadership? One ask is enough.', smaller: ['Name who you’re asking', 'Write what you need from them'] },
          { t: 'Read it top to bottom once', help: 'Just read it. Don’t fix anything yet.' }
        ] }
    ];
  }
  function P(t, est, kind) { return { t: t, est: est, kind: kind }; }

  /* What Fuzz knows about each task: the people, the sources, its brief, the history, and the answers it can find. */
  function Pp(name, role, did, quote) { return { name: name, role: role, did: did, quote: quote || '' }; }
  function Sr(label, via, when, quote) { return { label: label, via: via, when: when, quote: quote }; }
  function Hi(when, text) { return { when: when, text: text }; }
  function Qa(m, a, from) { return { m: m, a: a, from: from }; }
  var KNOW = {
    launch: {
      people: [Pp('Elena Park', 'Product marketing', 'Asked for this', 'We need a launch date so support, docs and marketing can plan around it.'),
        Pp('Raj Mehta', 'Engineering lead', 'Owns the fix the date depends on', 'Two weeks if the large-table fix lands this sprint.'),
        Pp('Kim Alvarez', 'Support lead', 'Needs time to train the team', 'We need five working days once it’s feature complete.')],
      sources: [Sr('Elena’s follow-up', 'Email', 'Today, 11:20 AM', 'Monday is the latest I can give support and docs. Can you pick one?'),
        Sr('Elena’s ask', 'Email', 'Yesterday, 4:05 PM', 'We need a launch date so support, docs and marketing can plan around it.'),
        Sr('Raj’s reply', 'Email', 'Yesterday, 5:30 PM', 'The date depends on the performance fix for very large tables. Two weeks if it lands this sprint.'),
        Sr('#launch thread', 'Slack', 'Monday', 'Kim: we need five working days once it’s feature complete.'),
        Sr('Release calendar', 'Calendar', 'Checked today', 'Oct 2 and Oct 9 are open. Oct 16 is blocked for the conference.')],
      context: 'Elena needs one launch date by Monday so support, docs and marketing can plan. The date hangs on Raj’s fix for very large tables: two weeks if it lands this sprint, which ends Sept 22. Support needs five working days after that. Oct 9 covers both with a little slack; Oct 2 only works if everything goes right.',
      history: [Hi('Yesterday, 4:05 PM', 'Fuzz found the ask in Elena’s email and made it a task'),
        Hi('Yesterday, 5:30 PM', 'Fuzz linked Raj’s reply to it'),
        Hi('Today, 9:15 AM', 'Fuzz judged it big and yours, and put it in the deep work pool'),
        Hi('Today, 9:20 AM', 'Fuzz prepped it: read 4 messages, checked the release calendar, drafted an opening')],
      suggest: ['When does Raj’s fix land?', 'How long does support need?', 'Is anything else on Oct 9?'],
      qa: [Qa(/raj|fix|perf|large|table|sprint/i, 'Raj said two weeks if it lands this sprint. The sprint ends Sept 22, so the fix should be in around Sept 25.', 'Raj’s reply · Email'),
        Qa(/support|train|kim/i, 'Kim needs five working days after it’s feature complete. With the fix around Sept 25, that’s Oct 2 at the earliest, with no slack. Oct 9 gives a week.', '#launch thread · Slack'),
        Qa(/calendar|conflict|oct|open|else on|clash/i, 'Nothing else is on Oct 9. Oct 2 is open too. Oct 16 is blocked for the conference, so it isn’t a fallback.', 'Release calendar'),
        Qa(/monday|deadline|by when|due|docs|marketing/i, 'Elena needs it by Monday. She didn’t give a time, so end of day Monday is a fair read.', 'Elena’s follow-up · Email')]
    },
    readout: {
      people: [Pp('Priya Raman', 'Head of growth', 'Asked for this', 'Can you give me a clear call on whether the winner ships? I brief my team Tuesday.'),
        Pp('Ken Ito', 'Data scientist', 'Ran the test and wrote the notes', 'The outage on day 9 adds noise. Without it, B is +2.8%.')],
      sources: [Sr('Priya’s ask', 'Email', 'Today, 10:12 AM', 'Can you give me a clear call on whether the winner ships? I brief my team Tuesday.'),
        Sr('Experiment dashboard', 'Dashboard', 'Pulled today', 'Variant B: +3.1% conversion, 94% confidence, 21 days, 48k users.'),
        Sr('Ken’s analysis notes', 'Doc', 'Friday', 'Day 9 outage adds noise; excluding it, B is +2.8%. Mobile is flat (+0.2%).'),
        Sr('Readout template', 'Doc', '—', 'The call · Why · Caveats · Next step')],
      context: 'Priya wants a yes or no on shipping Variant B before she briefs her team on Tuesday. B is up 3.1% on conversion at 94% confidence over 21 days. Two caveats: an outage on day 9 adds noise (B is still +2.8% without it), and mobile is flat.',
      history: [Hi('Today, 10:12 AM', 'Fuzz found the ask in Priya’s email'),
        Hi('Today, 10:20 AM', 'Fuzz judged it big and yours, and put it in the deep work pool'),
        Hi('Today, 10:45 AM', 'Fuzz prepped it: pulled the dashboard, read Ken’s notes, wrote a summary')],
      suggest: ['What if we drop the outage day?', 'Why is mobile flat?', 'How sure is the result?'],
      qa: [Qa(/outage|noise|day 9|drop/i, 'Without day 9, B is still ahead: +2.8% instead of +3.1%. Ken thinks the result holds.', 'Ken’s analysis notes · Doc'),
        Qa(/mobile|phone/i, 'Mobile is flat at +0.2%, well inside the noise. Ken’s guess is that the mobile layout pushes the new button below the fold.', 'Ken’s analysis notes · Doc'),
        Qa(/sure|confiden|significan|users|long/i, '94% confidence after 21 days and 48k users. Your team usually ships at 90% or more.', 'Experiment dashboard'),
        Qa(/tuesday|priya|when|brief/i, 'Priya briefs her team on Tuesday. Monday afternoon gives her time to read it.', 'Priya’s ask · Email')]
    },
    rubric: {
      people: [Pp('Sam Ortiz', 'Recruiting partner', 'Asked for this', 'Could you put together the rubric for the staff role? Loops start on the 24th.'),
        Pp('Lena Fox', 'Hiring manager, last staff hire', 'Wrote the old rubric', '')],
      sources: [Sr('Sam’s ask', 'Slack', '3 weeks ago', 'Could you put together the rubric for the staff role? Loops start on the 24th.'),
        Sr('Job description', 'Doc', 'Last month', 'Leads a team of five. Owns on-call for the platform.'),
        Sr('Last staff rubric', 'Doc', 'Last year', 'System design · Mentoring · Writing · Judgment')],
      context: 'Sam needs a rubric before interview loops start on the 24th. Last year’s staff rubric is a fair base, but this role leads a team and owns on-call, so “mentoring” probably becomes “leading through others” and on-call judgment matters more.',
      history: [Hi('3 weeks ago', 'Fuzz found the ask in Slack'),
        Hi('3 weeks ago', 'Fuzz judged it big and yours, and put it in the deep work pool'),
        Hi('Over 2 weeks', 'Offered in Deep Work 3 times; you picked something else each time')],
      suggest: ['When do loops start?', 'What changed from last time?'],
      qa: [Qa(/loop|start|when|24/i, 'Loops start on the 24th. Sam will want the rubric a few days before to brief interviewers.', 'Sam’s ask · Slack'),
        Qa(/chang|differ|last/i, 'This role leads a team of five and owns on-call. Last time’s role did neither.', 'Job description · Doc')]
    },
    q3: {
      people: [Pp('Marcus Webb', 'Your manager', 'Asked for the outline', 'Bring a rough outline to the planning review. Rough is fine.'),
        Pp('Dana Reyes', 'Finance', 'Owes you the budget numbers', 'I’ll have the budget numbers to you by the 20th.')],
      sources: [Sr('Q2 planning doc', 'Doc', 'Last quarter', 'Goals · Bets · Risks · Asks. Risks: hiring lag, vendor contract renewal.'),
        Sr('Your draft', 'Doc', 'Tuesday', '3 of 6 sections written. Risks has two bullets.'),
        Sr('Planning review', 'Calendar', 'In 3 weeks', 'Planning review, 90 minutes, with Marcus and the leads.'),
        Sr('Dana’s email', 'Email', 'Last week', 'I’ll have the budget numbers to you by the 20th.')],
      context: 'A rough outline for the planning review in three weeks, in the same shape as Q2: Goals, Bets, Risks, Asks. Goals and Bets each have a line. Risks has two bullets. Budget numbers from Dana come on the 20th and only matter for Asks.',
      history: [Hi('3 weeks ago', 'Marcus asked for it in your one-on-one'),
        Hi('Last Tuesday, 2:10 PM', 'Deep Work, 35 min: 3 steps done, stopped at Risks'),
        Hi('Thursday, 10:00 AM', 'Deep Work, 12 min: opened it, no step done'),
        Hi('Thursday, 10:15 AM', 'Fuzz kept your bullets and lined up last quarter’s risks next to them')],
      suggest: ['What were last quarter’s risks?', 'When do Dana’s numbers come?', 'When is the review?'],
      qa: [Qa(/last quarter|q2|risk/i, 'Q2’s risks were hiring lag and the vendor contract renewal. Hiring lag is already in your draft; the vendor contract renews again in August.', 'Q2 planning doc · Doc'),
        Qa(/budget|dana|number|20th/i, 'Dana said the 20th. You don’t need them yet: only Asks uses them, and a placeholder works for a rough outline.', 'Dana’s email · Email'),
        Qa(/review|when|meeting/i, 'The planning review is in three weeks: 90 minutes with Marcus and the leads. Marcus said rough is fine.', 'Planning review · Calendar')]
    }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o, function (k, v) { return v instanceof RegExp ? { re: v.source, f: v.flags } : v; }), function (k, v) { return v && v.re !== undefined ? new RegExp(v.re, v.f) : v; }); }
  function genericKnow(title) {
    return { people: [], sources: [Sr('Search results', 'Fuzz', 'Just now', 'Two threads mention “' + title + '”.')],
      context: 'You asked for this one by name, so Fuzz warmed it up on the spot. It has less to go on than a task it prepped ahead of time.',
      history: [Hi('Just now', 'You asked for it in Deep Work; Fuzz searched your sources and made it a task')], suggest: [], qa: [] };
  }

  /* ---------- Time constants ---------- */
  var BUDGETS = [{ v: 25, l: '25 min' }, { v: 50, l: '50 min' }, { v: 90, l: '90 min' }, { v: -1, l: 'Until I stop' }];
  var WORK = 25 * 60, SHORT = 5 * 60, LONG = 15 * 60, GRACE = 5 * 60, BODY = 90 * 60, ARM_MS = 1000;
  var BREAK_IDEAS = ['Stand up and stretch your arms over your head.', 'Get a glass of water.', 'Look at something far away for a minute.', 'Walk to another room and back.'];

  var S;
  function reset() {
    S = { view: 'cleared', pool: TASKS().map(function (t) { t.k = clone(KNOW[t.id]); t.thread = []; t.at = t.at || 0; t.passed = t.passed || 0; t.noProgress = t.noProgress || 0; return t; }),
      budget: 50, sel: null, query: '', hold: true, hideClock: false, picking: false,
      task: null, intro: false, warming: false, clock: 0, workSince: 0, sinceRealBreak: 0, breaksTaken: 0,
      pending: null, pendingAt: 0, workClock: 0, forceAt: null, snoozed: 0, take: null, sheet: null, wrapping: false, busy: false, asking: false, tab: null,
      thoughts: [], drafts: [], held: 0, nextHeld: 300, nextChat: 420, log: [], between: null,
      sentBack: [], resolved: [], cleared: 11, freeN: 0 };
    closeTake();
    render();
  }
  function byId(id) { return S.pool.filter(function (t) { return t.id === id; })[0]; }
  function speed() { return +$('speed').value; }
  function chatty() { return $('fuzzmode').value === 'chatty'; }
  function inSession() { return S.view === 'focus' || S.view === 'between'; }
  function leftMin() { return S.budget > 0 ? Math.max(0, S.budget - S.clock / 60) : Infinity; }
  function remainingEst(t) { return Math.max(5, Math.round(t.est * (t.steps.length - t.at) / t.steps.length)); }
  function fitLabel(t) {
    var r = remainingEst(t), left = S.view === 'entry' ? (S.budget > 0 ? S.budget : Infinity) : leftMin();
    return r <= left ? '<span class="pill pill--ok">Fits</span>' : '<span class="pill pill--muted">First part fits</span>';
  }

  /* ---------- Plan: breaks are scheduled into the time you give ---------- */
  function plan(b) {
    if (b < 0) return 'No end time. A 5-minute break every 25 minutes, a longer one after three, and a body check if you skip them for 90.';
    var t = 0, blocks = 0, breaks = 0;
    while (t < b) {
      var w = Math.min(25, b - t); if (b - t - w < 10) w = b - t;
      blocks++; t += w; if (t < b) { breaks++; t += 5; }
    }
    return b + ' min: ' + blocks + ' work ' + (blocks === 1 ? 'block' : 'blocks') + (breaks ? ', ' + breaks + ' short ' + (breaks === 1 ? 'break' : 'breaks') : ', no break needed') + '. Breaks wait for the end of a step, up to 5 minutes.';
  }

  /* ---------- Views ---------- */
  var view = $('view'), dw = $('dw');
  function render() {
    dw.classList.toggle('focus', S.view === 'focus');
    dw.classList.toggle('quiet-fuzz', !chatty());
    $('modeName').textContent = { cleared: 'Triage › all clear', triage: 'Triage', entry: 'Deep Work › getting started', focus: 'Deep Work', between: 'Deep Work', wrap: 'Deep Work › done for now' }[S.view];
    $('enterDW').hidden = inSession() || S.view === 'entry' || S.view === 'wrap';
    heldPill();
    ({ cleared: vCleared, triage: vTriage, entry: vEntry, focus: vFocus, between: vBetween, wrap: vWrap })[S.view]();
  }
  function heldPill() {
    var on = S.hold && inSession() && S.held > 0;
    $('held').hidden = !on;
    $('heldText').textContent = S.held + (S.held === 1 ? ' new card' : ' new cards') + ' held for Triage';
  }

  /* Triage is clear: celebrate first, then one quiet line. */
  function vCleared() {
    say('Triage is clear! ' + S.cleared + ' cards, all decided. That’s the whole job done.', 'proud');
    view.innerHTML = '<div class="panel celebrate"><div class="burst" aria-hidden="true">' + confetti() + '</div>' +
      '<h2>Triage is clear</h2><p class="big">' + S.cleared + ' cards decided</p>' +
      '<p class="why">Nothing is waiting on you. Fuzz will collect what comes in until your next triage.</p></div>' +
      '<p class="quiet">You’ve got about 50 minutes before your 2pm. <button type="button" class="linkish" id="offer">Want to go deep on something? <kbd>D</kbd></button></p>';
    $('offer').onclick = toEntry;
  }
  function confetti() { var h = ''; for (var i = 0; i < 18; i++) h += '<i style="--i:' + i + ';--x:' + (Math.round(Math.random() * 200) - 100) + 'px;--r:' + Math.round(Math.random() * 360) + 'deg"></i>'; return h; }

  /* Enter Deep Work: how long, and where to start. */
  function toEntry() { S.view = 'entry'; S.picking = false; S.query = ''; S.sel = defaultPick(); render(); }
  function defaultPick() { var r = resumable()[0] || suggestions()[0]; return r ? r.id : null; }
  function resumable() { return S.pool.filter(function (t) { return t.resume && t !== S.task; }); }
  function suggestions() {
    var left = S.view === 'entry' ? (S.budget > 0 ? S.budget : Infinity) : leftMin();
    var c = S.pool.filter(function (t) { return !t.resume && t !== S.task; });
    var fit = c.filter(function (t) { return remainingEst(t) <= left; }), rest = c.filter(function (t) { return remainingEst(t) > left; });
    return fit.concat(rest).slice(0, 3);
  }
  function pickRow(t, kind) {
    var sub = kind === 'resume' ? esc(t.resume) : esc(t.why);
    return '<button type="button" class="pick" data-id="' + t.id + '" aria-pressed="' + (t.id === S.sel) + '"><span class="t">' + esc(t.title) + '</span>' +
      '<span class="meta">' + fitLabel(t) + '<span class="est">~' + remainingEst(t) + ' min</span></span><span class="s">' + sub + '</span></button>';
  }
  function pickerHtml() {
    var res = resumable(), sug = suggestions(), q = S.query.trim().toLowerCase();
    var h = '';
    if (res.length) h += '<h3>Pick up where you left off</h3><div class="upnext">' + res.map(function (t) { return pickRow(t, 'resume'); }).join('') + '</div>';
    if (sug.length) h += '<h3>Fuzz has these ready</h3><div class="upnext">' + sug.map(function (t) { return pickRow(t, 'sug'); }).join('') + '</div>';
    h += '<h3>Something else</h3><form class="thought" id="findForm"><input id="find" value="' + esc(S.query) + '" placeholder="Search your tasks, or name something new (/)" aria-label="Search tasks or name something new" autocomplete="off"><button class="btn" type="submit">Find</button></form>';
    if (q) {
      var hits = S.pool.filter(function (t) { return t !== S.task && t.title.toLowerCase().indexOf(q) >= 0; });
      h += '<div class="upnext">' + hits.map(function (t) { return pickRow(t, 'sug'); }).join('') +
        '<button type="button" class="pick free" id="freeform"><span class="t">“' + esc(S.query.trim()) + '”</span><span class="meta"><span class="pill pill--accent">New</span></span>' +
        '<span class="s">Fuzz warms it up now. It has less to go on than a task it prepped ahead of time.</span></button></div>';
    }
    return h;
  }
  function wirePicker(onPick) {
    view.querySelectorAll('.pick[data-id]').forEach(function (b) { b.onclick = function () { if (S.sel === b.dataset.id) return onPick(byId(b.dataset.id)); S.sel = b.dataset.id; render(); }; });
    $('findForm').onsubmit = function (e) { e.preventDefault(); S.query = $('find').value; render(); var f = $('find'); f.focus(); f.selectionStart = f.value.length; };
    if ($('freeform')) $('freeform').onclick = function () { onPick(freeTask(S.query.trim())); };
  }
  function freeTask(title) {
    var t = { id: 'free' + (++S.freeN), title: title, est: 30, at: 0, passed: 0, noProgress: 0, fresh: true, thread: [],
      why: 'You asked for this one by name.', prep: 'I searched your email, Slack and docs for it and found two related threads.',
      sources: ['Search results'], k: genericKnow(title),
      steps: [{ t: 'Write one line on what “done” looks like', help: 'Rough is fine. It’s for you, not anyone else.' }, { t: 'List the first three things you’d do' }, { t: 'Do the first one' }] };
    S.pool.push(t); return t;
  }
  function vEntry() {
    say('How long have you got? I’ll plan the breaks in for you.', 'eager');
    view.innerHTML = '<div class="panel"><h2>Deep Work</h2>' +
      '<h3>How long do you have?</h3><div class="chips" role="group" aria-label="How long do you have">' + BUDGETS.map(function (b) {
        return '<button type="button" class="chip" data-v="' + b.v + '" aria-pressed="' + (b.v === S.budget) + '">' + b.l + '</button>';
      }).join('') + '</div><p class="planline">' + esc(plan(S.budget)) + '</p>' +
      pickerHtml() +
      '<div class="toggles"><label><input type="checkbox" id="hold"' + (S.hold ? ' checked' : '') + '> Hold new triage cards until I’m done (anything urgent still gets through)</label>' +
      '<label><input type="checkbox" id="hide"' + (S.hideClock ? ' checked' : '') + '> Hide the clock (breaks still happen)</label></div>' +
      '<div class="row"><button type="button" class="btn primary" id="go"' + (S.sel ? '' : ' disabled') + '>' + (S.sel ? 'Start: ' + esc(byId(S.sel).title) : 'Pick something to start') + ' <kbd>Enter</kbd></button>' +
      '<button type="button" class="btn" id="back">Not now <kbd>Esc</kbd></button></div></div>';
    view.querySelectorAll('.chip[data-v]').forEach(function (b) { b.onclick = function () { S.budget = +b.dataset.v; S.sel = S.sel || defaultPick(); render(); }; });
    $('hold').onchange = function () { S.hold = this.checked; };
    $('hide').onchange = function () { S.hideClock = this.checked; };
    wirePicker(startSession);
    $('go').onclick = function () { if (S.sel) startSession(byId(S.sel)); };
    $('back').onclick = function () { S.view = S.log.length ? 'triage' : 'cleared'; render(); };
  }

  /* ---------- The session ---------- */
  function startSession(t) {
    S.pool.forEach(function (x) { if (x !== t && x.offered) x.passed++; x.offered = false; });
    suggestions().concat(resumable()).forEach(function (x) { if (x !== t) x.passed++; });
    S.clock = 0; S.workSince = 0; S.sinceRealBreak = 0; S.breaksTaken = 0; S.pending = null; S.forceAt = null; S.snoozed = 0; S.workClock = 0; S.hist = []; S.curStart = 0;
    S.wrapping = false; S.thoughts = []; S.held = 0; S.log = []; S.nextHeld = 300; S.nextChat = 420;
    S.planned = S.budget; S.budgetEnd = S.budget > 0 ? S.budget * 60 : Infinity;
    S.pool.forEach(function (x) { x.stuck = 0; x.switched = false; });
    beginTask(t);
  }
  function beginTask(t) {
    S.task = t; S.intro = true; S.view = 'focus'; S.tab = null; S.sheet = null; S.asking = false; S.picking = false; S.between = null;
    S.entry = { task: t, steps: [], finished: false };
    S.log.push(S.entry);
    t.k.history.push(Hi('Just now', 'Deep Work: started'));
    if (t.fresh) {
      S.warming = true; render(); say('Give me a moment. I’m looking for everything about it.', 'thinking');
      setTimeout(function () { S.warming = false; t.fresh = false; if (S.view === 'focus' && S.task === t) { render(); stepAnim(); say('Ready. Less to go on than usual, so the steps are general.', 'happy'); settle(2200); } }, 2400);
      return;
    }
    say(t.resume ? 'Welcome back to this one. I kept your place.' : (chatty() ? 'I got it ready. I’ll keep the sources tidy while you go.' : 'It’s ready. I’m here if you need me.'), t.resume ? 'happy' : idleMood());
    render(); stepAnim(); settle(2200);
  }

  function vFocus() {
    var t = S.task;
    if (S.warming) { view.innerHTML = '<div class="panel"><p class="taskline"><span>' + esc(t.title) + '</span></p><div class="warming"><span class="spin" aria-hidden="true"></span>Fuzz is warming this up: searching email, Slack and docs…</div></div>'; return; }
    var st = t.steps[t.at];
    var dots = t.steps.map(function (_, i) { return '<i class="' + (i < t.at ? 'on' : i === t.at ? 'now' : '') + '"></i>'; }).join('');
    var help = st.help || st.fuzzDid ? '<div class="help">' + (st.fuzzDid ? '<b>Fuzz’s first pass, for you to check</b><div class="fuzzdid">' + esc(st.fuzzDid) + '</div>' : '<b>From Fuzz</b>' + esc(st.help)) + '</div>' : '';
    var intro = S.intro ? '<div class="intro">' + (t.resume ? '<div class="crumb"><div class="lbl">Where you left off</div>' + esc(t.resume) + '</div>' : '') +
      '<div class="prep"><p>' + esc(t.prep) + '</p><div class="chips">' + t.sources.map(function (s) { return '<span class="chip src">' + esc(s) + '</span>'; }).join('') + '</div></div></div>' : '';
    var rest = t.steps.length - t.at - 1;
    var done = S.log.filter(function (e) { return e.finished; }).length;
    view.innerHTML = '<div class="panel"><p class="taskline"><span>' + esc(t.title) + (done ? ' <span class="pill pill--ok">' + done + ' finished this session</span>' : '') + '</span><span class="dots" aria-label="Step ' + (t.at + 1) + ' of ' + t.steps.length + '">' + dots + '</span></p>' +
      intro +
      '<div class="step" id="step">' + esc(st.t) + '</div>' + help +
      (rest ? '<details class="later"><summary>' + rest + ' more ' + (rest === 1 ? 'step' : 'steps') + ' after this (folded away on purpose)</summary><ol start="' + (t.at + 2) + '">' +
        t.steps.slice(t.at + 1).map(function (s) { return '<li>' + esc(s.t) + '</li>'; }).join('') + '</ol></details>' : '<p class="later">This is the last step.</p>') +
      ctxHtml(t) +
      '<div class="clock' + (S.hideClock ? ' hidden-clock' : '') + '" id="clock"><svg class="dial" id="clockDial" viewBox="0 0 100 100" aria-hidden="true"></svg><span class="read"><b id="clockBig"></b><span id="clockSmall"></span></span>' +
      '<button type="button" class="btn small" id="clockToggle">' + (S.hideClock ? 'Show time' : 'Hide time') + '</button></div>' +
      '<form class="thought" id="thoughtForm"><input id="thought" placeholder="A stray thought? Park it here and keep going (T)" aria-label="Park a stray thought" autocomplete="off"><button class="btn" type="submit">Park it</button></form>' +
      (S.thoughts.length ? '<p class="parked">' + S.thoughts.length + ' parked for Triage: ' + S.thoughts.map(esc).join(' · ') + '</p>' : '') +
      '<div id="sheet"></div>' +
      '<div class="row" id="mainBtns"><button type="button" class="btn primary" id="stepDone">Done with this step <kbd>Enter</kbd></button>' +
      '<button type="button" class="btn" id="stuck">I’m stuck <kbd>S</kbd></button>' +
      '<button type="button" class="btn" id="brk">Break now <kbd>B</kbd></button>' +
      '<button type="button" class="btn" id="later">Done for now <kbd>Esc</kbd></button></div></div>';
    $('stepDone').onclick = stepDone;
    $('stuck').onclick = function () { openSheet('stuck'); };
    $('brk').onclick = function () { startBreak(true); };
    $('later').onclick = doneForNow;
    $('clockToggle').onclick = function () { S.hideClock = !S.hideClock; render(); };
    $('thoughtForm').onsubmit = function (e) {
      e.preventDefault(); var v = $('thought').value.trim(); if (!v) return;
      S.thoughts.push(v); render(); say('Parked. It’ll be in Triage when you’re done.', chatty() ? 'happy' : 'chill'); settle();
    };
    wireCtx(t);
    renderSheet(); tickClock();
  }

  /* ---------- What Fuzz knows: ask, people, sources, context, history ---------- */
  var TABS = [['ask', 'Ask Fuzz'], ['people', 'People'], ['sources', 'Sources'], ['context', 'Context'], ['history', 'History']];
  function ctxHtml(t) {
    var k = t.k, counts = { people: k.people.length, sources: k.sources.length, history: k.history.length };
    var h = '<div class="ctx"><div class="tabs" role="tablist" aria-label="About this task">' + TABS.map(function (x) {
      return '<button type="button" role="tab" class="tab" data-tab="' + x[0] + '" aria-selected="' + (S.tab === x[0]) + '">' + x[1] +
        (counts[x[0]] ? ' <span class="n">' + counts[x[0]] + '</span>' : '') + (x[0] === 'ask' ? ' <kbd>Q</kbd>' : '') + '</button>';
    }).join('') + (S.tab ? '<button type="button" class="tab fold" id="fold" aria-label="Fold away">Fold away</button>' : '') + '</div>';
    if (!S.tab) return h + '</div>';
    h += '<div class="tabpanel' + (S.tab === 'ask' ? ' askpanel' : '') + '" role="tabpanel">';
    if (S.tab === 'ask') {
      h += '<div class="thread" id="thread">' + (t.thread.length ? '' : '<p class="why">Ask anything about this task. Fuzz looks through the sources and comes back with the answer and where it found it.</p>') +
        t.thread.map(function (m, i) {
          var a = m.a === null ? '<div class="a looking"><span class="spin" aria-hidden="true"></span>' + esc(m.looking) + '</div>'
            : '<div class="a">' + esc(m.a) + (m.from ? '<span class="from">Found in ' + esc(m.from) + '</span>' : '') +
              (m.ask ? (m.drafted ? '<span class="from">Drafted. It waits in Triage for your OK.</span>' : '<button type="button" class="btn small" data-draft="' + i + '">Draft the question to ' + esc(m.ask.split(' ')[0]) + '</button>') : '') + '</div>';
          return '<div class="q">' + esc(m.q) + '</div>' + a;
        }).join('') + '</div>' +
        '<div class="chips sugg">' + t.k.suggest.map(function (s) { return '<button type="button" class="chip" data-ask="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<form class="thought" id="askForm"><input id="ask" placeholder="Ask Fuzz about this task" aria-label="Ask Fuzz about this task" autocomplete="off"' + (S.asking ? ' disabled' : '') + '><button class="btn" type="submit"' + (S.asking ? ' disabled' : '') + '>Ask</button></form>';
    }
    if (S.tab === 'people') h += k.people.length ? '<ul class="plist">' + k.people.map(function (p) {
      return '<li><span class="av" aria-hidden="true">' + esc(p.name.split(' ').map(function (w) { return w[0]; }).join('')) + '</span><div><b>' + esc(p.name) + '</b> <span class="role">' + esc(p.role) + '</span>' +
        '<div class="did">' + esc(p.did) + '</div>' + (p.quote ? '<q>' + esc(p.quote) + '</q>' : '') + '</div></li>';
    }).join('') + '</ul>' : '<p class="why">Fuzz hasn’t found anyone involved yet.</p>';
    if (S.tab === 'sources') h += '<ul class="slist">' + k.sources.map(function (s) {
      return '<li><div><b>' + esc(s.label) + '</b> <span class="role">' + esc(s.via) + ' · ' + esc(s.when) + '</span></div><q>' + esc(s.quote) + '</q></li>';
    }).join('') + '</ul>';
    if (S.tab === 'context') h += '<p class="brief"><span class="lbl">Fuzz’s brief</span>' + esc(k.context) + '</p>';
    if (S.tab === 'history') h += '<ol class="hist">' + k.history.slice().reverse().map(function (x) {
      return '<li><span class="hwhen">' + esc(x.when) + '</span>' + esc(x.text) + '</li>';
    }).join('') + '</ol>';
    return h + '</div></div>';
  }
  function wireCtx(t) {
    view.querySelectorAll('.tab[data-tab]').forEach(function (b) { b.onclick = function () { S.tab = S.tab === b.dataset.tab ? null : b.dataset.tab; render(); if (S.tab === 'ask' && $('ask')) $('ask').focus(); }; });
    if ($('fold')) $('fold').onclick = function () { S.tab = null; render(); };
    view.querySelectorAll('[data-ask]').forEach(function (b) { b.onclick = function () { ask(t, b.dataset.ask); }; });
    view.querySelectorAll('[data-draft]').forEach(function (b) { b.onclick = function () {
      var m = t.thread[+b.dataset.draft]; m.drafted = true;
      S.drafts.push('Question to ' + m.ask + ': “' + m.q + '”');
      t.k.history.push(Hi('Just now', 'Fuzz drafted a question to ' + m.ask + ' for your OK'));
      render(); say('Drafted. It’ll be in Triage for your OK. Keep going, I’ll tell you when they answer.', 'happy');
    }; });
    var th = $('thread'); if (th) th.scrollTop = th.scrollHeight;
    if ($('askForm')) $('askForm').onsubmit = function (e) { e.preventDefault(); var v = $('ask').value.trim(); if (v) ask(t, v); };
  }
  function ask(t, q) {
    if (S.asking) return;
    var hit = t.k.qa.filter(function (x) { return x.m.test(q); })[0];
    var where = t.k.sources.slice(0, 3).map(function (s) { return s.label; });
    var whereText = where.length > 1 ? where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1] : where[0];
    var m = { q: q, a: null, looking: 'Looking in ' + whereText + '…' };
    t.thread.push(m); S.asking = true; S.tab = 'ask'; render();
    say('Let me go find that.', 'thinking');
    setTimeout(function () {
      S.asking = false;
      if (hit) { m.a = hit.a; m.from = hit.from; }
      else {
        var who = t.k.people.filter(function (p) { return q.toLowerCase().indexOf(p.name.split(' ')[0].toLowerCase()) >= 0; })[0] || t.k.people[0];
        if (who) { m.a = 'I looked through ' + whereText + ' and didn’t find that. ' + who.name.split(' ')[0] + ' would know. Want me to ask?'; m.ask = who.name; }
        else m.a = 'I looked through ' + whereText + ' and didn’t find that, and I don’t know who would yet.';
      }
      t.k.history.push(Hi('Just now', 'You asked Fuzz: “' + q + '”'));
      if (S.view === 'focus' && S.task === t) { render(); var i = $('ask'); if (i) i.focus(); }
      say(hit ? 'Found it.' : 'Couldn’t find that one.', hit ? 'proud' : 'sheepish'); settle(1600);
    }, 1800 + Math.random() * 800);
  }
  function stepAnim() { var el = $('step'); if (el) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); } }

  function stepDone() {
    if (S.sheet || S.busy || S.take || S.warming) return;
    var t = S.task, st = t.steps[t.at];
    S.entry.steps.push(st.t + (st.fuzzDid ? ' (with Fuzz’s first pass)' : ''));
    t.k.history.push(Hi('Just now', 'You finished: ' + st.t));
    t.at++; S.intro = false; t.resume = null;
    if (t.at >= t.steps.length) return finishTask();
    var cheers = ['Got it.', 'Nice. Next one is right there.', 'That’s another dot.', 'Look at you go.'];
    say(cheers[S.entry.steps.length % cheers.length], 'happy'); settle(1400);
    render(); stepAnim();
    if (S.pending) fire();  // a break or time-up was waiting for the end of this step
  }

  /* ---------- Stuck (you asked for it, so it stays in place, not a takeover) ---------- */
  function openSheet(k) { if (S.take || S.warming) return; S.sheet = k; say('Stuck is normal. Let’s make it easier, not harder.', 'caring'); S.task.stuck++; renderSheet(); }
  function closeSheet() { S.sheet = null; render(); bot.dataset.mood = idleMood(); }
  function opt(k, label, sub, cls) { return '<button type="button" class="btn' + (cls ? ' ' + cls : '') + '" data-k="' + k + '"><span class="k">' + k + '</span><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>'; }
  function renderSheet() {
    var el = $('sheet'); if (!el) return;
    var main = $('mainBtns'); if (main) main.hidden = !!S.sheet;
    if (!S.sheet) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="sheet" role="dialog" aria-label="What would help?"><h3>What would help?</h3><div class="opts">' +
      opt(1, 'Make this step smaller', 'Fuzz splits it into two tiny ones') +
      opt(2, 'Fuzz, take a first pass', 'You check it rather than start from blank') +
      opt(3, 'Skip it for now', 'It moves to the end') +
      opt(4, 'Switch to something else', 'Your place here is kept') +
      opt(5, 'Never mind', '') + '</div></div>';
    el.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { stuckOpt(+b.dataset.k); }; });
    var f = el.querySelector('[data-k]'); if (f) f.focus();
  }
  function stuckOpt(k) {
    var t = S.task, st = t.steps[t.at];
    if (k === 1) {
      var parts = st.smaller || ['Just open it and look at it for two minutes', st.t.replace(/^./, function (c) { return c.toLowerCase(); }).replace(/^/, 'Now ')];
      t.steps.splice(t.at, 1, { t: parts[0], help: st.help }, { t: parts[1], help: st.help, fuzz: st.fuzz });
      S.sheet = null; render(); stepAnim(); say('Smaller now. Just this bit.', 'happy'); return;
    }
    if (k === 2) {
      S.sheet = null; S.busy = true; render(); say('On it…', 'working');
      setTimeout(function () {
        S.busy = false; t.k.history.push(Hi('Just now', 'Fuzz took a first pass at: ' + st.t)); st.fuzzDid = st.fuzz || 'Here’s a rough start for “' + st.t + '”. Change anything.';
        st.t = 'Check Fuzz’s first pass: ' + st.t.charAt(0).toLowerCase() + st.t.slice(1);
        if (S.view === 'focus' && S.task === t) { render(); stepAnim(); say('There, a first pass. Fixing beats starting from blank.', 'proud'); }
      }, 2200);
      return;
    }
    if (k === 3) {
      if (t.steps.length - t.at < 2) { say('This is the last one, so there’s nothing to skip to. Want me to take a first pass instead?', 'puzzled'); return; }
      t.steps.push(t.steps.splice(t.at, 1)[0]); S.sheet = null; render(); stepAnim(); say('Skipped. It’s waiting at the end.', 'chill'); return;
    }
    if (k === 4) {
      t.resume = 'You switched away at: ' + st.t; t.switched = true; S.sheet = null;
      t.k.history.push(Hi('Just now', 'Deep Work: you switched away at “' + st.t + '”'));
      return toBetween('switched');
    }
    if (k === 5) { S.task.stuck--; return closeSheet(); }
  }

  /* ---------- Between tasks: a win beat, then one next thing ---------- */
  function finishTask() {
    var t = S.task; S.entry.finished = true;
    t.k.history.push(Hi('Just now', 'Deep Work: finished'));
    S.pool.splice(S.pool.indexOf(t), 1);
    toBetween('finished');
  }
  function nextOffer() {
    var left = leftMin();
    var c = S.pool.filter(function (x) { return x !== S.task; });
    if (S.between && S.between.kind === 'switched') c.sort(function (a, b) { return remainingEst(a) - remainingEst(b); });
    else c.sort(function (a, b) { return (b.resume ? 1 : 0) - (a.resume ? 1 : 0) || ((remainingEst(a) <= left ? 0 : 1) - (remainingEst(b) <= left ? 0 : 1)); });
    return c[0] || null;
  }
  function toBetween(kind) {
    S.between = { kind: kind, from: S.task }; S.view = 'between'; S.picking = false; S.query = '';
    var n = nextOffer(); S.between.offer = n; S.sel = n ? n.id : null; if (n) n.offered = true;
    say(kind === 'finished' ? 'Done! The whole thing!' : 'Kept your place. Here’s something lighter.', kind === 'finished' ? 'proud' : 'caring');
    render();
    if (S.pending) fire();
  }
  function vBetween() {
    var b = S.between, t = b.from, n = b.offer, left = leftMin();
    var head = b.kind === 'finished'
      ? '<div class="beat"><div class="check" aria-hidden="true">✓</div><h2>Done: ' + esc(t.title) + '</h2><p class="why">' + S.entry.steps.length + ' steps this time. It moves to Finished.</p></div>'
      : '<div class="beat soft"><h2>Switched away from “' + esc(t.title) + '”</h2><p class="why">Your place is kept. It’ll be first under “Pick up where you left off”.</p></div>';
    var timeLine = S.budget > 0 ? (left > 1 ? 'About ' + Math.round(left) + ' min left of your ' + S.budget + '.' : 'You’re at the end of your ' + S.budget + ' minutes.') : 'No end time set.';
    view.innerHTML = '<div class="panel">' + head + '<p class="cap">' + timeLine + '</p>' +
      (n ? '<div class="offer"><div class="lbl">Next, if you want it</div><div class="txt">' + esc(n.title) + '</div><p class="why">' + fitLabel(n) + ' ~' + remainingEst(n) + ' min · ' + esc(n.resume ? 'Picks up where you left off.' : n.why) + '</p></div>' : '<p class="why">That’s everything in the pool. Nice.</p>') +
      (S.picking ? pickerHtml() : '') +
      '<div class="row">' + (n ? '<button type="button" class="btn primary" id="go">Go <kbd>Enter</kbd></button><button type="button" class="btn" id="other">Something else <kbd>O</kbd></button>' : '') +
      '<button type="button" class="btn' + (n ? '' : ' primary') + '" id="stop">Stop here <kbd>Esc</kbd></button></div></div>';
    if (n) { $('go').onclick = function () { beginTask(S.picking && S.sel ? byId(S.sel) : n); }; $('other').onclick = function () { S.picking = !S.picking; render(); }; }
    $('stop').onclick = doneForNow;
    if (S.picking) wirePicker(beginTask);
  }

  /* ---------- Takeovers: anything about time covers the whole screen ---------- */
  function pend(kind) { if (!S.pending) { S.pending = kind; S.pendingAt = S.workClock; tickClock(); } }
  function fire() { var k = S.pending; S.pending = null; S.forceAt = null; if (k) take(k); }
  function take(kind, extra) {
    S.take = { kind: kind, armed: false }; for (var x in extra || {}) S.take[x] = extra[x];
    if (kind !== 'break') S.workSince = kind === 'timeup' ? 0 : S.workSince;
    renderTake();
    var me = S.take;
    setTimeout(function () { if (S.take === me) { me.armed = true; renderTake(); } }, kind === 'break' ? 0 : ARM_MS);
  }
  function closeTake() { S.take = null; var el = $('take'); el.hidden = true; el.innerHTML = ''; document.body.classList.remove('taken'); }
  function renderTake() {
    var el = $('take'), k = S.take; if (!k) return closeTake();
    var t = S.task, st = t && t.steps[Math.min(t.at, t.steps.length - 1)], h = '', o = '', tone = 'time';
    if (k.kind === 'breakdue') {
      h = '<p class="eyebrow">Break time</p><h2>You’ve been at it about 25 minutes.</h2><p class="lead">Step away for ' + (nextBreakLen() / 60) + ' minutes. Fuzz will hold your place.</p>';
      o = opt(1, 'Take the break', nextBreakLen() / 60 + ' minutes', 'primary') + (S.snoozed ? opt(2, 'Skip this one', 'Fuzz won’t ask again until the next break') : opt(2, 'Five more minutes', 'Then the break, no waiting for a step')) + opt(4, 'Done for now', 'Fuzz saves your place');
    }
    if (k.kind === 'break') {
      var back = S.view === 'between'
        ? (S.between.offer ? '<div class="backto"><div class="lbl">Next, if you want it</div><div class="txt">' + esc(S.between.offer.title) + '</div></div>' : '')
        : '<div class="backto"><div class="lbl">When you’re back</div><div class="txt">' + esc(st.t) + '</div>' + (st.fuzzDid || st.help ? '<p class="why">' + esc(st.fuzzDid || st.help) + '</p>' : '') + '<p class="why">' + esc(t.title) + '</p></div>';
      h = k.over
        ? '<p class="eyebrow">Break’s over</p><h2>Welcome back. No rush.</h2>' + back
        : '<p class="eyebrow">On a break</p><div class="bigtime" id="breakLeft"></div><p class="lead">' + esc(k.idea) + '</p>' + back;
      o = opt(1, k.over ? 'Back to it' : 'I’m back', '', 'primary') + opt(4, 'Done for now', 'Fuzz saves your place');
    }
    if (k.kind === 'timeup') {
      h = '<p class="eyebrow">' + (S.wrapping ? 'Time to stop' : 'Your ' + S.budget + ' minutes are up') + '</p><h2>' + (S.wrapping ? 'That’s the five. Nice stretch.' : 'How’s it going?') + '</h2>' +
        '<p class="lead">' + sessionLine() + '</p>';
      o = opt(1, 'On a roll, keep going', 'Another 25 minutes, breaks included', 'primary') + (S.wrapping ? '' : opt(2, 'Wrap up in 5', 'Finish the thought, then stop')) + opt(3, 'Break, then more', '5 minutes') + opt(4, 'Done for now', 'Fuzz saves your place');
    }
    if (k.kind === 'body') {
      h = '<p class="eyebrow">Body check</p><h2>90 minutes without a real break.</h2><p class="lead">Hyperfocus is great. Water is too. How are your shoulders?</p>';
      o = opt(1, 'I’m good, keep going', '') + opt(3, 'Take a break', '5 minutes', 'primary') + opt(4, 'Done for now', '');
    }
    if (k.kind === 'urgent') {
      tone = 'urgent';
      h = '<p class="eyebrow">Urgent, so it came through</p><h2>Elena: “Legal needs the launch date by 3pm today, not Monday.”</h2><p class="lead">Everything else is still held for Triage. This one has a deadline inside your session.</p>';
      o = opt(1, 'Pause and handle it', 'Fuzz saves your place here', 'primary') + opt(2, 'It can wait until I’m done', 'Fuzz will remind you at the end');
    }
    el.className = 'take ' + tone + (k.armed ? '' : ' arming');
    el.innerHTML = '<div class="take-in" role="alertdialog" aria-modal="true" aria-label="Fuzz">' + h + '<div class="opts">' + o + '</div>' +
      '<p class="guard">' + (k.armed ? '' : 'One moment, so a stray keystroke doesn’t pick for you…') + '</p></div>';
    el.hidden = false; document.body.classList.add('taken');
    el.querySelectorAll('[data-k]').forEach(function (b) { b.disabled = !k.armed; b.onclick = function () { takeOpt(+b.dataset.k); }; });
    if (k.armed) { var f = el.querySelector('.btn.primary') || el.querySelector('[data-k]'); if (f) f.focus(); }
    tickBreak();
  }
  function sessionLine() {
    var steps = S.log.reduce(function (n, e) { return n + e.steps.length; }, 0), fin = S.log.filter(function (e) { return e.finished; }).length;
    return steps + (steps === 1 ? ' step' : ' steps') + ' done' + (fin ? ', ' + fin + (fin === 1 ? ' task' : ' tasks') + ' finished' : '') + ', ' + S.breaksTaken + (S.breaksTaken === 1 ? ' break' : ' breaks') + ' taken.';
  }
  function nextBreakLen() { return S.breaksTaken % 3 === 2 ? LONG : SHORT; }
  function startBreak(manual) {
    if (S.warming) return;
    S.sheet = null; var len = nextBreakLen();
    S.hist.push({ k: 'work', s: S.curStart, e: S.clock }); S.brkStart = S.clock;
    take('break', { left: len, idea: BREAK_IDEAS[S.breaksTaken % BREAK_IDEAS.length] });
    S.take.armed = true; renderTake();
    say('Go on. I’ve got your place.', 'sleepy');
  }
  function countBreak() { if (S.take.counted) return; S.take.counted = true; S.hist.push({ k: 'brk', s: S.brkStart, e: S.clock }); S.curStart = S.clock; S.breaksTaken++; S.workSince = 0; S.sinceRealBreak = 0; S.snoozed = 0; }
  function endBreak() { countBreak(); S.take.over = true; renderTake(); say('Break’s over. Your place is right where you left it.', 'happy'); }
  function takeOpt(n) {
    var k = S.take; if (!k || !k.armed) return;
    var kind = k.kind;
    if (kind === 'breakdue') {
      if (n === 1) return startBreak();
      if (n === 2) {
        closeTake();
        if (S.snoozed) { S.snoozed = 0; S.workSince = 0; say('Skipped. Next one in 25.', 'chill'); }
        else { S.snoozed = 1; S.forceAt = S.workClock + GRACE; say('Five more. Then the break, no matter what step you’re on.', 'chill'); }
        return backToWork();
      }
      if (n === 4) { closeTake(); return doneForNow(); }
    }
    if (kind === 'break' && (n === 1 || n === 4)) { countBreak(); closeTake(); if (n === 4) return doneForNow(); say('Welcome back. Here’s where you were.', 'happy'); return backToWork(); }
    if (kind === 'timeup' || kind === 'body') {
      if (n === 1) { closeTake(); if (kind === 'timeup') { S.wrapping = false; S.budgetEnd = S.clock + 25 * 60; S.budget += 25; } else S.sinceRealBreak = 0; say('Keep going. I’ll still call the breaks.', 'happy'); return backToWork(); }
      if (n === 2 && kind === 'timeup' && !S.wrapping) { closeTake(); S.wrapping = true; S.budgetEnd = S.clock + 5 * 60; say('Five more minutes. Finish the thought, not the task.', 'chill'); return backToWork(); }
      if (n === 3) { if (kind === 'timeup') { S.budgetEnd = S.clock + (SHORT + 25 * 60); S.budget += 30; S.wrapping = false; } return startBreak(); }
      if (n === 4) { closeTake(); return doneForNow(); }
    }
    if (kind === 'urgent') {
      closeTake();
      if (n === 1) { S.urgent = 'now'; return doneForNow(); }
      S.urgent = 'later'; say('Okay. It’ll be the first thing in Triage.', 'chill'); return backToWork();
    }
  }
  function backToWork() { if (S.view === 'focus') { render(); settle(1600); } else render(); }

  /* ---------- Leaving ---------- */
  function doneForNow() {
    S.sheet = null; closeTake(); S.pending = null; S.forceAt = null;
    S.view = 'wrap'; render();
  }
  function vWrap() {
    var t = S.task, open = t && S.pool.indexOf(t) >= 0 && !(S.between && S.between.kind === 'switched');
    var st = open ? t.steps[t.at] : null;
    var fin = S.log.filter(function (e) { return e.finished; }), steps = S.log.reduce(function (n, e) { return n + e.steps.length; }, 0);
    say(steps ? 'Good session. I’ll keep your place warm.' : 'That’s okay. Opening it counts. I kept your place.', 'proud');
    view.innerHTML = '<div class="panel"><h2>Done for now</h2>' +
      '<div class="sum"><span class="stat"><b>' + Math.max(1, Math.round(S.clock / 60)) + '</b> min in Deep Work</span><span class="stat"><b>' + fin.length + '</b> finished</span>' +
      '<span class="stat"><b>' + steps + '</b> steps done</span><span class="stat"><b>' + S.breaksTaken + '</b> breaks taken</span><span class="stat"><b>' + S.thoughts.length + '</b> thoughts parked</span></div>' +
      '<h3>This session</h3><ul class="log">' + S.log.map(function (e) {
        return '<li><b>' + esc(e.task.title) + '</b>: ' + (e.finished ? 'finished' : e.steps.length ? e.steps.length + ' steps' : 'opened it') + '</li>';
      }).join('') + '</ul>' +
      (open ? '<h3>Where you left off on “' + esc(t.title) + '”</h3><p class="why">Fuzz filled this in. Change it if you like, or leave it.</p>' +
        '<input class="field" id="crumb" value="' + esc('Next: ' + st.t) + '" aria-label="Where you left off">' : '') +
      '<div class="row"><button type="button" class="btn primary" id="toTriage">Save and go to Triage <kbd>Enter</kbd></button></div></div>';
    $('toTriage').onclick = function () { if (open) t.resume = $('crumb').value; endSession(); };
  }
  function endSession() {
    var seen = [];
    S.log.forEach(function (e) {
      var t = e.task; if (S.pool.indexOf(t) < 0 || seen.indexOf(t) >= 0) return; seen.push(t);
      var did = S.log.filter(function (x) { return x.task === t; }).reduce(function (n, x) { return n + x.steps.length; }, 0);
      t.noProgress = did ? 0 : t.noProgress + 1;
      t.k.history.push(Hi('Just now', 'Deep Work: ' + (did ? did + ' steps done' : 'no step done')));
      var why = t.stuck >= 2 ? 'You hit Stuck ' + t.stuck + ' times on it this session.' : t.switched ? 'You switched away from it partway.' : t.noProgress >= 2 ? 'You’ve opened it ' + t.noProgress + ' sessions in a row without finishing a step.' : '';
      if (why && !sent(t)) S.sentBack.push({ kind: 'stalled', task: t, why: why });
    });
    S.pool.forEach(function (t) { if (t.passed >= 4 && !sent(t)) S.sentBack.push({ kind: 'avoided', task: t, why: 'Fuzz has offered it ' + t.passed + ' times, and you picked something else each time.' }); });
    S.budget = S.planned; S.resolvedMsg = []; S.task = null; S.between = null; S.view = 'triage'; render();
  }
  function sent(t) { return S.sentBack.some(function (c) { return c.task === t; }) || S.resolved.indexOf(t.id) >= 0; }

  /* ---------- Triage: decisions, including what Deep Work sent back ---------- */
  function vTriage() {
    var n = S.thoughts.length + S.held + S.drafts.length + S.sentBack.length + (S.urgent ? 1 : 0);
    say(S.sentBack.length ? 'A couple of these came back from Deep Work. I brought a fix for each.' : n ? 'Here’s what piled up while you were working.' : 'All quiet. Nothing new came in.', S.sentBack.length ? 'caring' : 'idle');
    view.innerHTML = '<div class="panel"><h2>Triage</h2><p class="why">This stands in for the Triage queue.</p>' +
      S.sentBack.map(sentCard).join('') +
      '<ul class="log">' + (S.urgent ? '<li><b>Urgent:</b> Elena needs the launch date by 3pm today' + (S.urgent === 'later' ? ' (you said it could wait until you were done)' : '') + '</li>' : '') +
      S.thoughts.map(function (x) { return '<li>Your parked thought: ' + esc(x) + '</li>'; }).join('') +
      S.drafts.map(function (x) { return '<li>Needs your OK: ' + esc(x) + '</li>'; }).join('') +
      (S.held ? '<li>' + S.held + ' new ' + (S.held === 1 ? 'card' : 'cards') + ' Fuzz held during Deep Work</li>' : '') +
      (S.resolvedMsg || []).map(function (m) { return '<li class="okline">' + esc(m) + '</li>'; }).join('') +
      '</ul>' +
      '<div class="row"><button type="button" class="btn primary" id="clear"' + (S.sentBack.length ? ' disabled' : '') + '>' + (S.sentBack.length ? 'Decide the cards above first' : 'Pretend the rest is decided <kbd>Enter</kbd>') + '</button></div></div>';
    view.querySelectorAll('[data-sb]').forEach(function (b) { b.onclick = function () { resolveSent(+b.dataset.sb, b.dataset.act); }; });
    $('clear').onclick = function () {
      if (S.sentBack.length) return;
      S.cleared = n + 4; S.thoughts = []; S.held = 0; S.drafts = []; S.urgent = null; S.resolvedMsg = []; S.view = 'cleared'; render();
    };
  }
  function sentCard(c, i) {
    var t = c.task;
    if (c.kind === 'stalled') {
      var split = t.split || [P('Write one line on what’s in the way', 5, 'triage'), P(t.steps[t.at].t, 15, 'deep'), P('Take a first pass at the rest', 0, 'fuzz')];
      return '<div class="sentback"><div class="sbhead"><span class="pill pill--warn">Stalled in Deep Work</span><b>' + esc(t.title) + '</b></div><p class="why">' + esc(c.why) + ' It stopped at “' + esc(t.steps[t.at].t) + '”.</p>' +
        '<div class="proposal"><div class="lbl">Fuzz’s split</div><ol>' + split.map(function (p) {
          return '<li>' + esc(p.t) + ' <span class="pill ' + (p.kind === 'deep' ? 'pill--accent">Deep work, ~' + p.est + ' min' : p.kind === 'fuzz' ? 'pill--ok">Fuzz does it' : 'pill--muted">Small, stays in Triage') + '</span></li>';
        }).join('') + '</ol></div>' +
        '<div class="row"><button type="button" class="btn primary" data-sb="' + i + '" data-act="split">Split it like that</button><button type="button" class="btn" data-sb="' + i + '" data-act="keep">Keep it as it is</button><button type="button" class="btn" data-sb="' + i + '" data-act="drop">Drop it</button></div></div>';
    }
    return '<div class="sentback"><div class="sbhead"><span class="pill pill--muted">Keeps getting passed over</span><b>' + esc(t.title) + '</b></div><p class="why">' + esc(c.why) + ' That’s information, not a failing. Something about it is off.</p>' +
      '<div class="proposal"><div class="lbl">Fuzz’s suggestion</div>A smaller first step: Fuzz drafts the rubric from last time with this role’s differences, and you mark what’s wrong. About 15 minutes, and you never start from blank.</div>' +
      '<div class="row"><button type="button" class="btn primary" data-sb="' + i + '" data-act="smaller">Yes, do that</button><button type="button" class="btn" data-sb="' + i + '" data-act="handoff">Ask Sam if someone else can own it</button>' +
      '<button type="button" class="btn" data-sb="' + i + '" data-act="drop">Drop it</button><button type="button" class="btn" data-sb="' + i + '" data-act="keep">Still mine, leave it</button></div></div>';
  }
  function resolveSent(i, act) {
    var c = S.sentBack.splice(i, 1)[0], t = c.task, idx = S.pool.indexOf(t);
    S.resolved.push(t.id); var say_ = function (m) { S.resolvedMsg = (S.resolvedMsg || []).concat(m); };
    if (act === 'split') {
      var split = t.split || [P('Write one line on what’s in the way', 5, 'triage'), P(t.steps[t.at].t, 15, 'deep'), P('Take a first pass at the rest', 0, 'fuzz')];
      var deep = split.filter(function (p) { return p.kind === 'deep'; });
      var pieces = deep.map(function (p, j) { return { id: t.id + '-' + j, title: p.t, est: p.est, at: 0, passed: 0, noProgress: 0, thread: [], k: t.k, why: 'Split from “' + t.title + '”.', prep: t.prep, sources: t.sources, steps: [{ t: p.t, help: (t.steps[t.at] || {}).help, fuzz: (t.steps[t.at] || {}).fuzz }] }; });
      S.pool.splice.apply(S.pool, [idx, 1].concat(pieces));
      say_('Split “' + t.title + '”: ' + deep.length + ' to deep work, ' + split.filter(function (p) { return p.kind === 'fuzz'; }).length + ' for Fuzz, ' + split.filter(function (p) { return p.kind === 'triage'; }).length + ' small enough for Triage.');
    } else if (act === 'smaller') {
      t.title = 'Mark up Fuzz’s draft rubric'; t.est = 15; t.passed = 0; t.at = 0;
      t.steps = [{ t: 'Read Fuzz’s draft once, top to bottom', help: 'Built from last year’s rubric, with this role’s four differences worked in.' }, { t: 'Mark anything that’s wrong for this role', fuzz: 'Swap “Mentoring” for “Leading through others”. Add on-call judgment under Judgment.' }, { t: 'Send it back to Fuzz to tidy and draft the note to Sam' }];
      say_('The rubric is now a 15-minute markup. Fuzz is drafting it.');
    } else if (act === 'handoff') { S.pool.splice(idx, 1); S.drafts.push('Note to Sam: “Could someone else own the staff rubric? Happy to review it.”'); say_('Fuzz drafted a note to Sam. It’s below for your OK.'); }
    else if (act === 'drop') { S.pool.splice(idx, 1); say_('Dropped “' + t.title + '”. No guilt.'); }
    else { t.passed = 0; t.noProgress = 0; say_('Kept “' + t.title + '” as it is.'); }
    render();
  }

  /* ---------- Time ---------- */
  /* ---------- The clock: a session dial ----------
     With an end time, the whole session is a pie eaten up to the hand: work is orange, breaks green.
     With no end time it fills up instead: one lap is an hour, and each finished hour adds a ring.
     It is drawn from what actually happened plus a projection of the plan, so snoozes and extra time show up. */
  function about(left) { left = Math.ceil(left); if (left <= 1) return 'Wrapping up'; if (left < 5) return 'Under 5 min'; return '~' + (Math.round(left / 5) * 5) + ' min'; }
  function inTxt(m) { var r = Math.round(m / 5) * 5; if (r < 5) return 'Just started'; if (r < 60) return '~' + r + ' min in'; var h = Math.floor(r / 60), mm = r % 60; return h + 'h' + (mm ? ' ' + mm + 'm' : '') + ' in'; }
  function tickClock() {
    var dial = $('clockDial'); if (!dial) return;
    var m = S.clock / 60, open = S.budget < 0, end = open ? Infinity : S.budgetEnd / 60, hrs = Math.floor(m / 60);
    var waiting = S.pending === 'breakdue' || S.pending === 'timeup';
    var toBreak = waiting ? 0 : S.forceAt != null ? Math.max(0, (S.forceAt - S.workClock) / 60) : Math.max(0, (WORK - S.workSince) / 60);
    var T = m + toBreak, cur = S.curStart / 60;
    var dNow = waiting ? m : Math.min(m + 5, Math.max(cur, T - Math.round(toBreak / 5) * 5));   // 5-minute steps, like the words
    var dS = open ? hrs * 60 : 0, span = open ? 60 : end, R = open ? 39 : 45;
    var proj = [{ k: 'work', s: cur, e: T, now: true }], t = T, nb = S.breaksTaken, lim = open ? dS + span : end;
    while (t < lim) { var bl = nb % 3 === 2 ? 15 : 5; proj.push({ k: 'brk', s: t, e: t + bl }); t += bl; nb++; proj.push({ k: 'work', s: t, e: t + 25 }); t += 25; }
    function pt(x, r) { var an = (x - dS) / span * 2 * Math.PI; return [50 + r * Math.sin(an), 50 - r * Math.cos(an)]; }
    function sector(a0, a1, cls) {
      a0 = Math.max(a0, dS); a1 = Math.min(a1, dS + span); if (a1 - a0 <= 0.01) return '';
      if (a1 - a0 >= span - 0.01) return '<circle class="' + cls + '" cx="50" cy="50" r="' + R + '"/>';
      var p0 = pt(a0, R), p1 = pt(a1, R);
      return '<path class="' + cls + '" d="M50 50 L' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + (a1 - a0 > span / 2 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) + ' Z"/>';
    }
    function gap(x) { if (x <= dS || x >= dS + span) return ''; var q = pt(x, R); return '<line class="gap" x1="50" y1="50" x2="' + q[0].toFixed(2) + '" y2="' + q[1].toFixed(2) + '"/>'; }
    var h = '<circle class="rim" cx="50" cy="50" r="' + (open ? 41 : 47) + '"/>';
    if (!open) {
      proj.forEach(function (x) { h += sector(Math.max(x.s, dNow), x.e, (x.k === 'brk' ? 'b' : 'w') + (x.now ? ' now' : '')); if (x.s > dNow) h += gap(x.s); });
    } else {
      S.hist.forEach(function (x) { h += sector(x.s / 60, x.e / 60, x.k === 'brk' ? 'b' : 'w'); h += gap(x.s / 60); });
      h += sector(cur, dNow, 'w now') + gap(cur);
      var nbk = proj[1]; if (nbk) h += sector(nbk.s, nbk.e, 'ahead');
      for (var k = 0; k < Math.min(hrs, 3); k++) h += '<circle class="ring" cx="50" cy="50" r="' + (44 + k * 2.6) + '"/>';
    }
    var hp = pt(dNow, R - 1);
    h += '<line class="hand" x1="50" y1="50" x2="' + hp[0].toFixed(2) + '" y2="' + hp[1].toFixed(2) + '"/><circle class="hub" cx="50" cy="50" r="5"/>';
    dial.innerHTML = h;
    var sessLeft = end - m;
    $('clockBig').textContent = S.pending === 'timeup' ? 'Time’s up after this step' : S.pending === 'breakdue' ? 'Break after this step'
      : !open && sessLeft <= toBreak ? 'Last block, ' + about(sessLeft).toLowerCase() + ' left' : 'Break in ' + about(toBreak).replace('Wrapping up', 'a moment');
    $('clockSmall').textContent = open ? inTxt(m) : sessLeft > 1 ? about(sessLeft) + ' left in the session' : 'Session’s up';
  }
  function tickBreak() { var el = $('breakLeft'); if (!el || !S.take || S.take.kind !== 'break') return; var s = Math.max(0, Math.ceil(S.take.left)); el.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  setInterval(function () {
    if (!S || !inSession()) return;
    var dt = 0.25 * speed();
    S.clock += dt;
    if (S.take) {
      if (S.take.kind === 'break' && !S.take.over) { S.take.left -= dt; tickBreak(); if (S.take.left <= 0) endBreak(); }
      return;
    }
    if (S.view !== 'focus' || S.sheet || S.busy || S.warming) return;
    S.workClock = (S.workClock || 0) + dt; S.workSince += dt; S.sinceRealBreak += dt;
    if (S.hold && S.clock >= S.nextHeld) { S.held = Math.min(6, S.held + 1); S.nextHeld = S.clock + 360; heldPill(); }
    if (chatty() && S.clock >= S.nextChat) {
      var lines = ['Still here.', 'I tidied the sources for the next step.', 'You’re doing the thing!', 'Quiet keyboard noises.'];
      say(lines[Math.floor(S.clock / 60) % lines.length], 'working'); S.nextChat = S.clock + 480;
    }
    if (S.forceAt != null && S.workClock >= S.forceAt) { S.forceAt = null; S.pending = null; take('breakdue'); return; }
    if (S.clock >= S.budgetEnd) pend('timeup');
    else if (S.workSince >= WORK && S.forceAt == null) pend('breakdue');
    if (S.sinceRealBreak >= BODY && !S.pending) { S.sinceRealBreak = 0; take('body'); return; }
    if (S.pending && S.workClock - S.pendingAt >= GRACE) { fire(); return; }
    tickClock();
  }, 250);

  /* ---------- Keys ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (S.take) {
      e.preventDefault();
      if (!S.take.armed) return;
      if (k === 'Enter') { var p = $('take').querySelector('.btn.primary') || $('take').querySelector('[data-k]'); if (p) takeOpt(+p.dataset.k); }
      else if (/^[1-4]$/.test(k)) takeOpt(+k);
      return;
    }
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (typing) {
      if (k === 'Escape') e.target.blur();
      if (k === 'Enter' && e.target.id === 'crumb') { e.preventDefault(); $('toTriage').click(); }
      return;
    }
    var v = S.view;
    if (v === 'cleared' || v === 'triage') {
      if (k === 'd' || k === 'D') { e.preventDefault(); toEntry(); }
      else if (k === 'Enter' && !e.target.closest('button') && v === 'triage') { e.preventDefault(); $('clear').click(); }
    } else if (v === 'entry') {
      if (k === 'Enter' && !e.target.closest('button')) { e.preventDefault(); if (S.sel) startSession(byId(S.sel)); }
      else if (k === 'Escape') $('back').click();
      else if (k === '/') { e.preventDefault(); $('find').focus(); }
    } else if (v === 'focus') {
      if (S.warming) return;
      if (S.sheet) { if (/^[1-5]$/.test(k)) { e.preventDefault(); stuckOpt(+k); } else if (k === 'Escape') { S.task.stuck--; closeSheet(); } return; }
      if (k === 'Enter' && !e.target.closest('button')) { e.preventDefault(); stepDone(); }
      else if (k === 's' || k === 'S') openSheet('stuck');
      else if (k === 'b' || k === 'B') startBreak(true);
      else if (k === 't' || k === 'T') { e.preventDefault(); $('thought').focus(); }
      else if (k === 'q' || k === 'Q') { e.preventDefault(); S.tab = 'ask'; render(); if ($('ask')) $('ask').focus(); }
      else if (k === 'Escape') doneForNow();
    } else if (v === 'between') {
      if (k === 'Enter' && !e.target.closest('button')) { e.preventDefault(); var g = $('go') || $('stop'); g.click(); }
      else if ((k === 'o' || k === 'O') && $('other')) $('other').click();
      else if (k === '/' && $('find')) { e.preventDefault(); $('find').focus(); }
      else if (k === 'Escape') doneForNow();
    } else if (k === 'Enter' && !e.target.closest('button')) {
      var pr = view.querySelector('.btn.primary'); if (pr) { e.preventDefault(); pr.click(); }
    }
  });

  $('enterDW').onclick = toEntry;
  $('urgent').onclick = function () { if (S.view === 'focus' && !S.take && !S.warming) take('urgent'); else say('Start a Deep Work session first, then send the urgent card.', 'puzzled'); };
  $('reset').onclick = reset;
  $('fuzzmode').onchange = function () { if (S.view === 'focus') { render(); bot.dataset.mood = idleMood(); } };
  reset();
})();
