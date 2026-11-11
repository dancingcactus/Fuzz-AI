/* Deep Work spike: triage decides, Deep Work does. Everything is in memory; Reset starts over. */
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

  /* ---------- Demo tasks (invented) ---------- */
  function TASKS() {
    return [
      { id: 'launch', title: 'Propose a launch date to Elena', size: 'About 45 minutes',
        why: 'Support, docs and marketing are waiting on it. Elena needs a date by Monday.',
        prep: 'I read Elena’s two emails and Raj’s reply, checked the release calendar and started a draft.',
        sources: ['Elena Park · Email · Today', 'Raj Mehta · Email · Yesterday', 'Release calendar'],
        steps: [
          { t: 'Read my two-line summary of the thread', help: 'Elena needs one date by Monday. Raj says the large-table fix takes two weeks if it lands this sprint. The calendar has Oct 2 and Oct 9 open.', smaller: ['Read the first line of the summary', 'Read Raj’s estimate'] },
          { t: 'Pick a date: Oct 2 or Oct 9', help: 'I lean Oct 9: it leaves a week of slack after Raj’s fix. Oct 2 only works if the fix lands this week.', fuzz: 'My pick: Oct 9.\nWhy: Raj’s fix, plus a week for docs.' },
          { t: 'Write three reasons, one line each', help: 'Rough is fine. I can tidy the wording afterwards.', fuzz: '1. The large-table fix lands first.\n2. Docs get a full week after it.\n3. Support training fits the week before.', smaller: ['Write just the first reason', 'Write the other two'] },
          { t: 'Make my draft sound like you', help: 'Draft: “Hi Elena, I can commit to Oct 9. Here’s why…”', fuzz: 'Hi Elena,\nI can commit to Oct 9, and here’s why…' },
          { t: 'Hand the draft back to me for Approve and send', help: 'It waits in Triage as “Needs your OK”. Nothing goes out until you approve it.' }
        ] },
      { id: 'readout', title: 'Make the call on the A/B test readout', size: 'About 30 minutes',
        why: 'Priya briefs her team on Tuesday and wants a clear yes or no.',
        prep: 'I pulled the results dashboard, wrote a one-paragraph summary and listed the two caveats.',
        sources: ['Priya Raman · Email · Today', 'Experiment dashboard', 'Readout template'],
        steps: [
          { t: 'Skim the summary and the two caveats', help: 'Variant B: +3.1% conversion, 94% confidence. Caveats: one noisy day (the outage), and mobile is flat.' },
          { t: 'Decide: ship, don’t ship, or run longer', help: 'There’s no wrong answer here. Whichever you pick, I write it up.', fuzz: 'If it were me: ship to desktop, run mobile one more week.' },
          { t: 'Write the call and one reason in the template', help: 'One sentence each is plenty.', smaller: ['Write the call', 'Write one reason'] },
          { t: 'Send it to me to tidy and draft the reply to Priya', help: 'The reply waits in Triage for your OK.' }
        ] },
      { id: 'q3', title: 'Outline the Q3 planning doc', size: 'About an hour, 3 steps left',
        why: 'For the planning review. No hard date yet, but it keeps coming back.',
        prep: 'Last time I kept your bullets and lined up last quarter’s risks next to them.',
        resume: 'You stopped at the “Risks” heading, with two bullets written.',
        sources: ['Q2 planning doc', 'Your draft (3 of 6 sections)'],
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
        Hi('Today, 9:15 AM', 'You triaged it to Up next'),
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
        Hi('Today, 10:40 AM', 'You triaged it to Up next'),
        Hi('Today, 10:45 AM', 'Fuzz prepped it: pulled the dashboard, read Ken’s notes, wrote a summary')],
      suggest: ['What if we drop the outage day?', 'Why is mobile flat?', 'How sure is the result?'],
      qa: [Qa(/outage|noise|day 9|drop/i, 'Without day 9, B is still ahead: +2.8% instead of +3.1%. Ken thinks the result holds.', 'Ken’s analysis notes · Doc'),
        Qa(/mobile|phone/i, 'Mobile is flat at +0.2%, well inside the noise. Ken’s guess is that the mobile layout pushes the new button below the fold.', 'Ken’s analysis notes · Doc'),
        Qa(/sure|confiden|significan|users|long/i, '94% confidence after 21 days and 48k users. Your team usually ships at 90% or more.', 'Experiment dashboard'),
        Qa(/tuesday|priya|when|brief/i, 'Priya briefs her team on Tuesday. Monday afternoon gives her time to read it.', 'Priya’s ask · Email')]
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
        Hi('Over 2 weeks', 'Rescheduled three times'),
        Hi('Last Tuesday', 'You moved it to Up next'),
        Hi('Last Tuesday, 2:10 PM', 'Deep Work, 35 min: 3 steps done, stopped at Risks'),
        Hi('Last Tuesday, 2:50 PM', 'Fuzz kept your bullets and lined up last quarter’s risks next to them')],
      suggest: ['What were last quarter’s risks?', 'When do Dana’s numbers come?', 'When is the review?'],
      qa: [Qa(/last quarter|q2|risk/i, 'Q2’s risks were hiring lag and the vendor contract renewal. Hiring lag is already in your draft; the vendor contract renews again in August.', 'Q2 planning doc · Doc'),
        Qa(/budget|dana|number|20th/i, 'Dana said the 20th. You don’t need them yet: only Asks uses them, and a placeholder works for a rough outline.', 'Dana’s email · Email'),
        Qa(/review|when|meeting/i, 'The planning review is in three weeks: 90 minutes with Marcus and the leads. Marcus said rough is fine.', 'Planning review · Calendar')]
    }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o, function (k, v) { return v instanceof RegExp ? { re: v.source, f: v.flags } : v; }), function (k, v) { return v && v.re !== undefined ? new RegExp(v.re, v.f) : v; }); }

  var BLOCKS = [{ v: 0, l: 'Just the first step' }, { v: 10, l: '10 min' }, { v: 25, l: '25 min' }, { v: 50, l: '50 min' }, { v: -1, l: 'Until it’s done' }];
  var S;
  function reset() {
    S = { view: 'handoff', tasks: TASKS().map(function (t) { t.k = clone(KNOW[t.id]); t.thread = []; return t; }), finished: [],
      tab: null, asking: false, drafts: [], sel: 'launch', block: 25, hideClock: false, hold: true,
      task: null, elapsed: 0, blockEnd: 0, sheet: null, breakLeft: 0, wrapping: false, wellness: false,
      thoughts: [], doneNow: [], held: 0, nextHeld: 300, nextChat: 420, cleared: 11, busy: false };
    render();
  }
  function taskById(id) { return S.tasks.filter(function (t) { return t.id === id; })[0]; }
  function speed() { return +$('speed').value; }
  function chatty() { return $('fuzzmode').value === 'chatty'; }

  /* ---------- Views ---------- */
  var view = $('view'), dw = $('dw');
  function render() {
    dw.classList.toggle('focus', S.view === 'focus');
    dw.classList.toggle('quiet-fuzz', !chatty());
    $('modeName').textContent = { handoff: 'Triage › all clear', warmup: 'Deep Work › getting ready', focus: 'Deep Work', wrap: 'Deep Work › done for now', finished: 'Deep Work › finished', away: 'Triage › all clear', triage: 'Triage' }[S.view];
    heldPill();
    ({ handoff: vHandoff, warmup: vWarmup, focus: vFocus, wrap: vWrap, finished: vFinished, away: vAway, triage: vTriage })[S.view]();
  }
  function heldPill() {
    var on = S.hold && (S.view === 'focus' || S.view === 'warmup') && S.held > 0;
    $('held').hidden = !on;
    $('heldText').textContent = S.held + (S.held === 1 ? ' new card' : ' new cards') + ' held for later';
  }

  function vHandoff() {
    if (!S.tasks.length) { S.view = 'triage'; return vTriage(); }
    if (!taskById(S.sel)) S.sel = S.tasks[0].id;
    var first = taskById(S.sel);
    say(S.cleared ? 'Triage is clear, ' + S.cleared + ' cards done! You’ve got momentum. Want to spend it on “' + first.title + '”?' : 'Want to pick one up? I’ve got them ready.', 'eager');
    view.innerHTML = '<div class="panel"><h2>Up next</h2><p class="why">Fuzz has these ready to start. There are never more than three.</p>' +
      '<div class="upnext" role="group" aria-label="Up next">' + S.tasks.map(function (t, i) {
        return '<button type="button" class="pick" data-id="' + t.id + '" aria-pressed="' + (t.id === S.sel) + '"><span class="t">' + esc(t.title) + '</span>' +
          '<span class="pill ' + (t.resume ? 'pill--ok' : 'pill--accent') + '">' + (t.resume ? 'Pick up where you left off' : 'Ready to start') + '</span>' +
          '<span class="s">' + esc(t.size) + ' · ' + esc(t.why) + ' <kbd>' + (i + 1) + '</kbd></span></button>';
      }).join('') + '</div>' +
      '<p class="cap">When Up next is full, a new big task replaces one of these, and you choose which goes back to Lineup.</p>' +
      '<div class="row"><button type="button" class="btn primary" id="go">Start this one <kbd>Enter</kbd></button>' +
      '<button type="button" class="btn" id="notnow">Not today <kbd>N</kbd></button></div></div>';
    view.querySelectorAll('.pick').forEach(function (b) { b.onclick = function () { if (S.sel === b.dataset.id) return toWarmup(); S.sel = b.dataset.id; render(); }; });
    $('go').onclick = toWarmup;
    $('notnow').onclick = function () { S.view = 'away'; render(); };
  }

  function toWarmup() { S.view = 'warmup'; render(); }
  function vWarmup() {
    var t = taskById(S.sel), at = t.at || 0;
    say(t.resume ? 'Welcome back to this one. I kept your place.' : 'I got it ready for you. The first step is a small one.', 'happy');
    view.innerHTML = '<div class="panel"><h2>' + esc(t.title) + '</h2><p class="why">' + esc(t.why) + '</p>' +
      (t.resume ? '<div class="crumb"><div class="lbl">Where you left off</div>' + esc(t.resume) + '</div>' : '') +
      '<div class="prep"><p>' + esc(t.prep) + '</p><div class="chips">' + t.sources.map(function (s) { return '<span class="chip src">' + esc(s) + '</span>'; }).join('') + '</div></div>' +
      '<div class="first"><div class="lbl">' + (t.resume ? 'Next step' : 'First step') + '</div><div class="txt">' + esc(t.steps[at].t) + '</div></div>' +
      '<h3>How long do you have, roughly?</h3><div class="chips" role="group" aria-label="How long do you have">' + BLOCKS.map(function (b) {
        return '<button type="button" class="chip" data-v="' + b.v + '" aria-pressed="' + (b.v === S.block) + '">' + b.l + '</button>';
      }).join('') + '</div>' +
      '<div class="toggles"><label><input type="checkbox" id="hold"' + (S.hold ? ' checked' : '') + '> Hold new triage cards until I’m done (I’ll let anything urgent through)</label>' +
      '<label><input type="checkbox" id="hide"' + (S.hideClock ? ' checked' : '') + '> Hide the clock</label></div>' +
      '<div class="row"><button type="button" class="btn primary" id="go">Start <kbd>Enter</kbd></button>' +
      '<button type="button" class="btn" id="back">Back <kbd>Esc</kbd></button></div></div>';
    view.querySelectorAll('.chip[data-v]').forEach(function (b) { b.onclick = function () { S.block = +b.dataset.v; render(); }; });
    $('hold').onchange = function () { S.hold = this.checked; };
    $('hide').onchange = function () { S.hideClock = this.checked; };
    $('go').onclick = start;
    $('back').onclick = function () { S.view = 'handoff'; render(); };
  }

  function start() {
    var t = taskById(S.sel);
    S.task = t; t.at = t.at || 0;
    S.elapsed = 0; S.sheet = null; S.wrapping = false; S.wellness = false; S.doneNow = []; S.thoughts = []; S.held = 0;
    S.blockEnd = S.block > 0 ? S.block * 60 : Infinity;
    S.view = 'focus'; S.tab = null; S.asking = false;
    t.k.history.push(Hi('Just now', 'Deep Work started'));
    say(chatty() ? 'Okay, I’m right here. I’ll keep the sources tidy while you go.' : 'I’m here if you need me.', chatty() ? 'working' : 'chill');
    render();
    stepAnim();
  }

  function vFocus() {
    var t = S.task, st = t.steps[t.at];
    var dots = t.steps.map(function (_, i) { return '<i class="' + (i < t.at ? 'on' : i === t.at ? 'now' : '') + '"></i>'; }).join('');
    var help = st.help || st.fuzzDid ? '<div class="help">' + (st.fuzzDid ? '<b>Fuzz’s first pass, for you to check</b><div class="fuzzdid">' + esc(st.fuzzDid) + '</div>' : '<b>From Fuzz</b>' + esc(st.help)) + '</div>' : '';
    var rest = t.steps.length - t.at - 1;
    view.innerHTML = '<div class="panel"><p class="taskline"><span>' + esc(t.title) + '</span><span class="dots" aria-label="Step ' + (t.at + 1) + ' of ' + t.steps.length + '">' + dots + '</span></p>' +
      '<div class="step" id="step">' + esc(st.t) + '</div>' + help +
      (rest ? '<details class="later"><summary>' + rest + ' more ' + (rest === 1 ? 'step' : 'steps') + ' after this (folded away on purpose)</summary><ol start="' + (t.at + 2) + '">' +
        t.steps.slice(t.at + 1).map(function (s) { return '<li>' + esc(s.t) + '</li>'; }).join('') + '</ol></details>' : '<p class="later">This is the last step.</p>') +
      ctxHtml(t) +
      '<div class="clock' + (S.hideClock ? ' hidden-clock' : '') + '" id="clock"><span class="read" id="clockRead"></span><span class="bar"><span id="clockBar"></span></span>' +
      '<button type="button" class="btn small" id="clockToggle">' + (S.hideClock ? 'Show time' : 'Hide time') + '</button></div>' +
      '<form class="thought" id="thoughtForm"><input id="thought" placeholder="A stray thought? Park it here and keep going (T)" aria-label="Park a stray thought" autocomplete="off"><button class="btn" type="submit">Park it</button></form>' +
      (S.thoughts.length ? '<p class="parked">' + S.thoughts.length + ' parked for Triage: ' + S.thoughts.map(esc).join(' · ') + '</p>' : '') +
      '<div id="sheet"></div>' +
      '<div class="row" id="mainBtns"><button type="button" class="btn primary" id="stepDone">Done with this step <kbd>Enter</kbd></button>' +
      '<button type="button" class="btn" id="stuck">I’m stuck <kbd>S</kbd></button>' +
      '<button type="button" class="btn" id="brk">Break <kbd>B</kbd></button>' +
      '<button type="button" class="btn" id="later">Done for now <kbd>Esc</kbd></button></div></div>';
    $('stepDone').onclick = stepDone;
    $('stuck').onclick = function () { openSheet('stuck'); };
    $('brk').onclick = function () { openSheet('break'); };
    $('later').onclick = doneForNow;
    $('clockToggle').onclick = function () { S.hideClock = !S.hideClock; render(); };
    $('thoughtForm').onsubmit = function (e) {
      e.preventDefault(); var v = $('thought').value.trim(); if (!v) return;
      S.thoughts.push(v); render(); say('Parked. It’ll be in Triage when you’re done.', chatty() ? 'happy' : 'chill');
      setTimeout(function () { if (S.view === 'focus') bot.dataset.mood = chatty() ? 'working' : 'chill'; }, 1500);
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
    if (S.tab === 'people') h += '<ul class="plist">' + k.people.map(function (p) {
      return '<li><span class="av" aria-hidden="true">' + esc(p.name.split(' ').map(function (w) { return w[0]; }).join('')) + '</span><div><b>' + esc(p.name) + '</b> <span class="role">' + esc(p.role) + '</span>' +
        '<div class="did">' + esc(p.did) + '</div>' + (p.quote ? '<q>' + esc(p.quote) + '</q>' : '') + '</div></li>';
    }).join('') + '</ul>';
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
    var whereText = where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1];
    var m = { q: q, a: null, looking: 'Looking in ' + whereText + '…' };
    t.thread.push(m); S.asking = true; S.tab = 'ask'; render();
    say('Let me go find that.', 'thinking');
    setTimeout(function () {
      S.asking = false;
      if (hit) { m.a = hit.a; m.from = hit.from; }
      else {
        var who = t.k.people.filter(function (p) { return q.toLowerCase().indexOf(p.name.split(' ')[0].toLowerCase()) >= 0; })[0] || t.k.people[0];
        m.a = 'I looked through ' + whereText + ' and didn’t find that. ' + who.name.split(' ')[0] + ' would know. Want me to ask?';
        m.ask = who.name;
      }
      t.k.history.push(Hi('Just now', 'You asked Fuzz: “' + q + '”'));
      if (S.view === 'focus') { render(); var i = $('ask'); if (i) i.focus(); }
      say(hit ? 'Found it.' : 'Couldn’t find that one. I can ask for you.', hit ? 'proud' : 'sheepish');
      setTimeout(function () { if (S.view === 'focus' && !S.sheet && !S.asking) bot.dataset.mood = chatty() ? 'working' : 'chill'; }, 1600);
    }, 1800 + Math.random() * 800);
  }
  function stepAnim() { var el = $('step'); if (el) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); } }

  function stepDone() {
    if (S.sheet || S.busy) return;
    var t = S.task, st = t.steps[t.at];
    S.doneNow.push(st.t + (st.fuzzDid ? ' (with Fuzz’s first pass)' : ''));
    t.k.history.push(Hi('Just now', 'You finished: ' + st.t));
    t.at++;
    if (t.at >= t.steps.length) return finish();
    if (S.block === 0 && S.doneNow.length === 1) { render(); openSheet('firstDone'); return; }
    var cheers = ['Got it.', 'Nice. Next one is right there.', 'That’s another dot.', 'Look at you go.'];
    say(cheers[S.doneNow.length % cheers.length], 'happy');
    setTimeout(function () { if (S.view === 'focus' && !S.sheet) bot.dataset.mood = chatty() ? 'working' : 'chill'; }, 1400);
    render(); stepAnim();
  }

  /* ---------- Sheets: stuck, check-in, break ---------- */
  function openSheet(k) {
    S.sheet = k;
    if (k === 'stuck') say('Stuck is normal. Let’s make it easier, not harder.', 'caring');
    if (k === 'check') say(S.wrapping ? 'Time to wrap up. Good stretch.' : 'That was a block. How’s it going?', 'eager');
    if (k === 'firstDone') say('First step done, and that’s the hardest one. Keep going?', 'proud');
    if (k === 'wellness') say('Ninety minutes in. Hyperfocus is great, but water is too.', 'caring');
    if (k === 'break') { S.breakLeft = 5 * 60; say('Go stretch. I’ll hold your place.', 'sleepy'); }
    renderSheet();
  }
  function closeSheet() { S.sheet = null; render(); bot.dataset.mood = chatty() ? 'working' : 'chill'; }
  function opt(k, label, sub) { return '<button type="button" class="btn" data-k="' + k + '"><span class="k">' + k + '</span><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>'; }
  function renderSheet() {
    var el = $('sheet'); if (!el) return;
    var main = $('mainBtns'); if (main) main.hidden = !!S.sheet;
    if (!S.sheet) { el.innerHTML = ''; return; }
    var st = S.task.steps[S.task.at], h = '';
    if (S.sheet === 'stuck') h = '<h3>What would help?</h3><div class="opts">' +
      opt(1, 'Make this step smaller', 'Fuzz splits it into two tiny ones') +
      opt(2, 'Fuzz, take a first pass', 'You check it rather than start from blank') +
      opt(3, 'Skip it for now', 'It moves to the end') +
      opt(4, 'Switch to something lighter', 'Your place here is kept') +
      opt(5, 'Never mind', '') + '</div>';
    if (S.sheet === 'check') h = '<h3>' + (S.wrapping ? 'Time’s up for this block' : Math.round(S.elapsed / 60) + ' minutes in') + '</h3><div class="opts">' +
      opt(1, 'On a roll, keep going', 'Another ' + (S.block > 0 ? S.block : 25) + ' minutes') +
      (S.wrapping ? '' : opt(2, 'Wrap up in 5', 'Finish the thought, then stop')) +
      opt(3, 'Break, then more', '5 minutes') +
      opt(4, 'Done for now', 'Fuzz saves your place') + '</div>';
    if (S.sheet === 'firstDone') h = '<h3>You started. That was the hard part.</h3><div class="opts">' +
      opt(1, 'Keep going', 'No clock, check in at 25 minutes') + opt(4, 'Done for now', 'Fuzz saves your place') + '</div>';
    if (S.sheet === 'wellness') h = '<h3>Quick body check</h3><div class="opts">' +
      opt(1, 'I’m good, keep going', '') + opt(3, 'Break, then more', '5 minutes') + opt(4, 'Done for now', '') + '</div>';
    if (S.sheet === 'break') h = '<h3>On a break</h3><div class="bigtime" id="breakLeft"></div><p class="why">When you’re back: <b>' + esc(st.t) + '</b></p>' +
      '<div class="opts">' + opt(1, 'Back now', '') + opt(4, 'Done for now', 'Fuzz saves your place') + '</div>';
    el.innerHTML = '<div class="sheet" role="dialog" aria-label="Fuzz asks">' + h + '</div>';
    el.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { pickOpt(+b.dataset.k); }; });
    var f = el.querySelector('[data-k]'); if (f) f.focus();
    tickBreak();
  }
  function pickOpt(k) {
    var s = S.sheet, t = S.task, st = t.steps[t.at];
    if (s === 'stuck') {
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
          if (S.view === 'focus') { render(); stepAnim(); say('There, a first pass. Fixing beats starting from blank.', 'proud'); }
        }, 2200);
        return;
      }
      if (k === 3) {
        if (t.steps.length - t.at < 2) { say('This is the last one, so there’s nothing to skip to. Want me to take a first pass instead?', 'puzzled'); return; }
        t.steps.push(t.steps.splice(t.at, 1)[0]); S.sheet = null; render(); stepAnim(); say('Skipped. It’s waiting at the end.', 'chill'); return;
      }
      if (k === 4) { saveCrumb('You switched away at: ' + st.t); S.tasks.push(S.tasks.splice(S.tasks.indexOf(t), 1)[0]); S.cleared = 0; S.view = 'handoff'; S.sel = S.tasks[0].id; render(); say('Kept your place. Here’s something lighter.', 'caring'); return; }
      if (k === 5) return closeSheet();
    }
    if (s === 'check' || s === 'firstDone' || s === 'wellness') {
      if (k === 1) { S.wrapping = false; S.blockEnd = S.elapsed + (S.block > 0 ? S.block : 25) * 60; return closeSheet(); }
      if (k === 2 && s === 'check' && !S.wrapping) { S.wrapping = true; S.blockEnd = S.elapsed + 5 * 60; closeSheet(); say('Five more minutes. Finish the thought, not the task.', 'chill'); return; }
      if (k === 3) return openSheet('break');
      if (k === 4) return doneForNow();
    }
    if (s === 'break') {
      if (k === 1) { closeSheet(); say('Welcome back. Here’s where you were.', 'happy'); return; }
      if (k === 4) return doneForNow();
    }
  }

  /* ---------- Leaving ---------- */
  function saveCrumb(text) { S.task.resume = text; }
  function doneForNow() { S.sheet = null; S.view = 'wrap'; render(); }
  function vWrap() {
    var t = S.task, st = t.steps[t.at];
    say(S.doneNow.length ? 'Good session. I’ll keep your place warm.' : 'That’s okay. Opening it counts. I kept your place.', 'proud');
    view.innerHTML = '<div class="panel"><h2>Done for now</h2><p class="why">' + esc(t.title) + ' goes back to the top of Up next.</p>' +
      summary() +
      '<h3>Where you left off</h3><p class="why">Fuzz filled this in. Change it if you like, or leave it.</p>' +
      '<input class="field" id="crumb" value="' + esc('Next: ' + st.t) + '" aria-label="Where you left off">' +
      '<div class="row"><button type="button" class="btn primary" id="toTriage">Save and go to Triage <kbd>Enter</kbd></button>' +
      '<button type="button" class="btn" id="another">Start something else</button></div></div>';
    $('toTriage').onclick = function () { saveCrumb($('crumb').value); toFront(t); S.view = 'triage'; render(); };
    $('another').onclick = function () { saveCrumb($('crumb').value); toFront(t); S.cleared = 0; S.sel = (S.tasks[1] || t).id; S.view = 'handoff'; render(); };
  }
  function toFront(t) { S.tasks.splice(S.tasks.indexOf(t), 1); S.tasks.unshift(t); }
  function summary() {
    var mins = Math.max(1, Math.round(S.elapsed / 60));
    return '<div class="sum"><span class="stat"><b>' + mins + '</b> min in Deep Work</span><span class="stat"><b>' + S.doneNow.length + '</b> steps done</span>' +
      '<span class="stat"><b>' + S.thoughts.length + '</b> thoughts parked</span></div>' +
      (S.doneNow.length ? '<h3>Done so far</h3><ul class="log">' + S.doneNow.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '');
  }
  function finish() {
    S.sheet = null; S.view = 'finished';
    S.tasks.splice(S.tasks.indexOf(S.task), 1); S.finished.push(S.task);
    render();
  }
  function vFinished() {
    say('You finished it! The whole thing!', 'proud');
    view.innerHTML = '<div class="panel"><h2>Finished: ' + esc(S.task.title) + '</h2><p class="why">It moves to Finished in Lineup. Anything waiting on your OK is in Triage.</p>' + summary() +
      '<div class="row"><button type="button" class="btn primary" id="toTriage">Go to Triage <kbd>Enter</kbd></button>' +
      (S.tasks.length ? '<button type="button" class="btn" id="another">Start the next one</button>' : '') + '</div></div>';
    $('toTriage').onclick = function () { S.view = 'triage'; render(); };
    if ($('another')) $('another').onclick = function () { S.cleared = 0; S.view = 'handoff'; render(); };
  }
  function vAway() {
    say('Fair enough. Clearing triage was plenty. They’ll be ready next time.', 'chill');
    view.innerHTML = '<div class="panel"><h2>Nothing more today</h2><p class="why">Up next keeps its three tasks, and Fuzz keeps prepping them. Nothing counts against you.</p>' +
      '<div class="row"><button type="button" class="btn" id="back">Actually, let’s do one</button></div></div>';
    $('back').onclick = function () { S.view = 'handoff'; render(); };
  }
  function vTriage() {
    var n = S.thoughts.length + S.held + S.drafts.length;
    say(n ? 'Here’s what piled up while you were working. Short and sweet.' : 'All quiet. Nothing new came in.', 'idle');
    view.innerHTML = '<div class="panel"><h2>Back in Triage</h2><p class="why">This stands in for the Triage queue.</p>' +
      '<ul class="log">' + S.thoughts.map(function (x) { return '<li>Your parked thought: ' + esc(x) + '</li>'; }).join('') +
      S.drafts.map(function (x) { return '<li>Needs your OK: ' + esc(x) + '</li>'; }).join('') +
      (S.held ? '<li>' + S.held + ' new ' + (S.held === 1 ? 'card' : 'cards') + ' Fuzz held during Deep Work</li>' : '') +
      (n ? '' : '<li>Nothing waiting</li>') + '</ul>' +
      '<div class="row"><button type="button" class="btn primary" id="clear">Pretend triage is clear again <kbd>Enter</kbd></button></div></div>';
    $('clear').onclick = function () { S.cleared = n + 3; S.thoughts = []; S.held = 0; S.drafts = []; S.view = 'handoff'; render(); };
  }

  /* ---------- Time ---------- */
  function tickClock() {
    var r = $('clockRead'), b = $('clockBar'); if (!r) return;
    var m = Math.floor(S.elapsed / 60);
    r.textContent = S.elapsed < 60 ? 'Just started' : 'About ' + m + ' min in';
    var span = S.blockEnd === Infinity ? 90 * 60 : S.blockEnd;
    b.style.width = Math.min(100, S.elapsed / span * 100) + '%';
  }
  function tickBreak() { var el = $('breakLeft'); if (!el) return; var s = Math.max(0, Math.ceil(S.breakLeft)); el.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  setInterval(function () {
    if (S.view !== 'focus') return;
    var dt = 0.25 * speed();
    if (S.sheet === 'break') {
      S.breakLeft -= dt; tickBreak();
      if (S.breakLeft <= 0) { closeSheet(); say('Break’s over. Here’s where you were. No rush.', 'happy'); }
      return;
    }
    if (S.sheet || S.busy) return;
    S.elapsed += dt; tickClock();
    if (S.hold && S.elapsed >= S.nextHeld) { S.held = Math.min(6, S.held + 1); S.nextHeld = S.elapsed + 360; heldPill(); }
    if (chatty() && S.elapsed >= S.nextChat) {
      var lines = ['Still here.', 'I tidied the sources for the next step.', 'You’re doing the thing!', 'Quiet keyboard noises.'];
      say(lines[Math.floor(S.elapsed / 60) % lines.length], 'working'); S.nextChat = S.elapsed + 480;
    }
    if (S.elapsed >= S.blockEnd) { S.blockEnd = Infinity; openSheet('check'); }
    else if (S.block === -1 && !S.wellness && S.elapsed >= 90 * 60) { S.wellness = true; openSheet('wellness'); }
  }, 250);

  /* ---------- Keys ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (typing) {
      if (e.key === 'Escape') e.target.blur();
      if (e.key === 'Enter' && e.target.id === 'crumb') { e.preventDefault(); $('toTriage').click(); }
      return;
    }
    var k = e.key, v = S.view;
    if (v === 'handoff') {
      if (k === 'Enter' && !e.target.closest('.pick')) { e.preventDefault(); toWarmup(); }
      else if (/^[1-3]$/.test(k) && S.tasks[k - 1]) { S.sel = S.tasks[k - 1].id; render(); }
      else if (k === 'n' || k === 'N') { S.view = 'away'; render(); }
    } else if (v === 'warmup') {
      if (k === 'Enter' && !e.target.closest('.chip')) { e.preventDefault(); start(); }
      else if (k === 'Escape') { S.view = 'handoff'; render(); }
    } else if (v === 'focus') {
      if (S.sheet) { if (/^[1-5]$/.test(k)) { e.preventDefault(); pickOpt(+k); } else if (k === 'Escape' && S.sheet !== 'break') closeSheet(); return; }
      if (k === 'Enter' && !e.target.closest('button')) { e.preventDefault(); stepDone(); }
      else if (k === 's' || k === 'S') openSheet('stuck');
      else if (k === 'b' || k === 'B') openSheet('break');
      else if (k === 't' || k === 'T') { e.preventDefault(); $('thought').focus(); }
      else if (k === 'q' || k === 'Q') { e.preventDefault(); S.tab = 'ask'; render(); if ($('ask')) $('ask').focus(); }
      else if (k === 'Escape') doneForNow();
    } else if (k === 'Enter' && !e.target.closest('button')) {
      var p = view.querySelector('.btn.primary'); if (p) { e.preventDefault(); p.click(); }
    }
  });

  $('reset').onclick = reset;
  $('fuzzmode').onchange = function () { if (S.view === 'focus') { render(); bot.dataset.mood = chatty() ? 'working' : 'chill'; } };
  reset();
})();
