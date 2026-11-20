/* One in-memory store shared by Triage, Lineup and New task.
   Principles it enforces:
   - assigned work runs in the background, MAX_RUNNING at a time (6, 1)
   - a handback is a normal state and goes to the end of the queue (2)
   - every change writes a line to the task's "done so far" log (3)
   - nothing is sent until the human approves the draft, and then Fuzz sends it with its own tools (6)
   - every change undoes on its own, the way the core's Undo works: not a stack. A change can't be
     undone once something else has changed the same task since (Fuzz started, it was sent, you moved
     it again), and you're told why (6, 11)
   - groups (tasks from the same email, meeting or Slack burst) are made by the core and are only ever a label on their tasks */
(function () {
  /* Fuzz's slots: how many tasks run at once in the demo. Live mode takes the core's budget.max_working. */
  var MAX_RUNNING = 2;
  var STEP_MS = 6500;
  var SEND_MS = 3500;
  var state, subs = [], timer = 0, captureN = 0, sentN = 0, deferFn = null;
  /* Not part of any group count: cleared cards and dropped tasks */
  var GONE = ['dropped', 'resolved'];
  /* The demo's Series page, shaped like GET /series (made-up work, as the rest of the demo) */
  var DEMO_SERIES = (function () {
    var DAY = 864e5, ago = function (d) { return new Date(Date.now() - d * DAY).toISOString(); };
    var nw = { id: 1, name: 'Northwind rollout', state: 'named', origin: 'inferred', section: 'going', role: 'drive', role_label: 'You’re driving it',
      about: 'Getting Northwind onto always-on testing, starting with a pilot.', about_how: 'goal', about_guess: false,
      status: { value: 'Waiting on Northwind legal’s review of the pilot plan', source: 'Priya Shah on Slack', trust_label: 'Reported' },
      done_when: 'NW-342 is accepted and Northwind confirms the pilot plan in writing', next_milestone: 'Pilot go-live, Jan 15',
      next: { title: 'Send Priya Friday’s status note', why: 'You’ve sent one every Friday for 5 weeks, and this week’s isn’t started.' },
      last: { title: 'You sent the pilot plan to legal', state: 'done', at: ago(2) }, last_moved: ago(2),
      open: 5, done: 9, people: ['Dana Ortiz', 'Priya Shah', 'Sam Lee'], season: 1 };
    var bill = { id: 6, name: 'Billing platform migration', state: 'named', origin: 'inferred', section: 'going', role: 'drive', role_label: 'You’re driving it',
      about: 'Moving invoicing off the old billing system, one customer group at a time.', about_how: 'goal', about_guess: false,
      status: { value: 'Group 4 of 6 moved over this week', source: 'the migration tracker', trust_label: 'From the owner' },
      next: { title: 'Confirm the Group 5 customer list with Ana Costa' },
      last: { title: 'Group 4 cut over cleanly', state: 'done', at: ago(1) }, last_moved: ago(1),
      open: 6, done: 37, people: ['Ana Costa', 'Ben Okafor', 'Dana Ortiz'], season: 1 };
    var rb = { id: 2, name: 'Report builder launch', state: 'named', origin: 'inferred', section: 'going', role: 'contribute', role_label: 'You’re helping',
      about: 'From 6 tasks with Marco Ruiz and Jen Wu, like “Update the release notes from Marco’s QA pass”.', about_how: 'tasks', about_guess: true,
      status: { value: 'REP-118 is in QA; release notes are drafted', source: 'the Jira ticket', trust_label: 'From the owner' },
      next: { title: 'Update the release notes from Marco’s QA pass' },
      last: { title: 'Fuzz drafted the release notes', state: 'review', at: ago(1) }, last_moved: ago(1),
      open: 2, done: 4, people: ['Marco Ruiz', 'Jen Wu'], season: 1 };
    var hire = { id: 3, name: 'Hiring a staff engineer', state: 'dormant', origin: 'inferred', section: 'quiet', role: 'drive', role_label: 'You’re driving it',
      about: 'Filling the staff engineer role on your team.', about_how: 'goal', about_guess: true, about_fact_id: 903,
      status: { value: 'Panel interviews done; waiting on feedback', source: 'email', trust_label: 'Reported' },
      next: { title: 'Ask Sam for the two missing panel write-ups', why: 'Nothing has moved for 16 days, and Sam owes you a reply.' },
      last: { title: 'The last panel interview finished', state: 'done', at: ago(16) }, last_moved: ago(16),
      open: 1, done: 6, people: ['Sam Lee'], season: 1 };
    var docs = { id: 4, name: 'Onboarding docs refresh', state: 'inferred', origin: 'inferred', section: 'watching',
      about: 'From 4 tasks with Jen Wu, like “Update the laptop setup page”.', about_how: 'tasks', about_guess: true,
      last: { title: 'Update the laptop setup page', state: 'triage', at: ago(3) }, last_moved: ago(3), open: 3, done: 1, people: ['Jen Wu'], season: 1 };
    var deck = { id: 5, name: 'Strategy deck', state: 'wrapped', origin: 'inferred', section: 'wrapped', about: 'The strategy deck for the January offsite.', about_how: 'goal', about_guess: false,
      evidence: 'The deck is in the Strategy folder and Priya replied to the review email', open: 0, done: 7, people: [], season: 1 };
    var s = { 'new': [], going: [nw, bill, rb], quiet: [hire], watching: [docs], wrapped: [deck] };
    return { sections: s, counts: { 'new': 0, going: 3, quiet: 1, watching: 1, wrapped: 1 }, demo: true };
  })();
  /* What each demo series' own page adds to its card: what Fuzz knows, its tasks, people and files */
  function demoSheet(s) {
    var known = function (attr, value, source, trust, id) { return { fact_id: id, attr: attr, value: value, source: source, trust_label: trust }; };
    var art = function (id, task) { var x = (window.Samples || []).filter(function (a) { return a.id === id; })[0]; return x ? { source_id: x.id, name: x.name, kind: x.kind, url: x.url, updated_at: new Date(x.updated).toISOString(), task: { title: task || x.taskTitle } } : null; };
    var EXTRA = {
      1: { knows: [known('goal', 'Get Northwind onto always-on testing', 'you', 'Confirmed', 101), known('your_role', 'drive', 'you', 'Confirmed', 102),
        known('for', 'Northwind', 'its tasks', 'Fuzz noticed', 103), known('status', 'Waiting on Northwind legal’s review of the pilot plan', 'Priya Shah on Slack', 'Reported', 104),
        known('done_when', 'NW-342 is accepted and Northwind confirms the pilot plan in writing', 'Priya Shah by email', 'Reported', 105)],
        open_tasks: [['Send Priya Friday’s status note', 'triage'], ['Chase Northwind legal on the pilot plan', 'waiting'], ['Draft the pilot kickoff agenda', 'working'], ['Set up the checkout team’s test accounts', 'scheduled'], ['Write the pilot success criteria', 'mine']],
        done_tasks: ['You sent the pilot plan to legal', 'Booked the pilot kickoff', 'Shared the test data plan'],
        people: [{ name: 'Priya Shah', tasks: 9, how: 'Owner · Sent 6 of its asks' }, { name: 'Dana Ortiz', tasks: 5, how: 'Sent 2 of its asks' }, { name: 'Sam Lee', tasks: 3, how: 'You’re waiting on them' }],
        artifacts: [art('retro-docx', 'Send the pilot plan to legal'), art('feedback-md', 'Summarize Northwind’s pilot feedback')],
        anchors: [{ key: 'proj:NW', label: 'NW tickets', tasks: 8 }, { key: 'chan:northwind', label: '#northwind-pilot', tasks: 5 }, { key: 'word:northwind', label: 'northwind', tasks: 11, yours: true }],
        decided: [{ what: 'Pilot starts with the checkout team only', at: '2026-11-04' }] },
      6: { knows: [known('goal', 'Every customer group bills from the new system by the end of Q1', 'Ana Costa by email', 'From the owner', 601), known('your_role', 'drive', 'you', 'Confirmed', 602),
        known('status', 'Group 4 of 6 moved over this week', 'the migration tracker', 'From the owner', 603), known('next_milestone', 'Group 5 cutover, Dec 12', 'the Billing cutover sync', 'Reported', 604)],
        open_tasks: [['Confirm the Group 5 customer list with Ana Costa', 'triage'], ['Draft the Group 5 cutover note to customers', 'working'], ['Check Group 4 invoices match the old system', 'review'],
          ['Ask Ben about the tax-rule edge cases', 'waiting'], ['Book the Group 6 dry run', 'scheduled'], ['Retire the old invoice export job', 'parked']],
        done_tasks: ['Group 4 cut over cleanly', 'Sent the Group 4 customer note', 'Fixed the rounding difference on Group 3 invoices', 'Walked Finance through the new reports'],
        people: [['Ana Costa', 22, 'Owner · Sent 14 of its asks'], ['Ben Okafor', 15, 'You’re waiting on them'], ['Dana Ortiz', 9, 'Sent 3 of its asks'], ['Marco Ruiz', 7, ''], ['Lena Park', 6, ''], ['Raj Mehta', 5, ''],
          ['Sofia Alvarez', 4, ''], ['Tom Becker', 3, 'Sent one of its asks'], ['Yuki Tanaka', 3, ''], ['Grace Liu', 2, ''], ['Omar Haddad', 2, ''], ['Nina Petrova', 1, ''], ['Chris Doyle', 1, ''], ['Priya Raman', 1, '']]
          .map(function (p) { return { name: p[0], tasks: p[1], how: p[2] }; }),
        artifacts: [art('budget-csv', 'Check Group 4 invoices match the old system'), art('readout-pptx', 'Walk Finance through the new reports'), art('agenda-pdf', 'Plan the Group 6 dry run'),
          art('feedback-md', 'Draft the Group 5 cutover note to customers'), art('retro-docx', 'Group 4 cutover retro')],
        deliverables: [{ title: 'Group 5 cutover', done_when: 'Group 5 bills from the new system', due: '2026-12-12', state: 'open', tier: 'active' }] },
      2: { knows: [known('your_role', 'contribute', 'you', 'Confirmed', 201), known('status', 'REP-118 is in QA; release notes are drafted', 'the Jira ticket', 'From the owner', 202)],
        open_tasks: [['Update the release notes from Marco’s QA pass', 'triage'], ['Review the launch email Jen drafted', 'review']],
        people: [{ name: 'Marco Ruiz', tasks: 4, how: 'Sent 3 of its asks' }, { name: 'Jen Wu', tasks: 2, how: '' }],
        deliverables: [{ title: 'Report builder release', done_when: 'REP-118 ships and the release notes are published', due: '2026-12-03', state: 'open', tier: 'active' }] },
      3: { knows: [known('goal', 'Filling the staff engineer role on your team', 'Sam Lee by email', 'Fuzz noticed', 903), known('your_role', 'drive', 'you', 'Confirmed', 301)],
        open_tasks: [['Ask Sam for the two missing panel write-ups', 'triage']], people: [{ name: 'Sam Lee', tasks: 5, how: 'You’re waiting on them' }] }
    };
    var e = EXTRA[s.id] || {};
    var task = function (t, i) { return { id: s.id * 100 + i, title: t[0] || t, state: t[1] || 'done' }; };
    return Object.assign({ knows: [], deliverables: [], decided: [], anchors: [], removed_anchors: [], also_touches: [], artifacts: [],
      suggestions: s.next ? [s.next] : [], people: (s.people || []).map(function (n) { return { name: n, tasks: 0, how: '' }; }) }, s,
      { knows: e.knows || [], open_tasks: (e.open_tasks || (s.next ? [[s.next.title, 'triage']] : [])).map(task), done_tasks: (e.done_tasks || []).map(task),
        people: e.people || (s.people || []).map(function (n) { return { name: n, tasks: 0, how: '' }; }), artifacts: (e.artifacts || []).filter(Boolean),
        anchors: e.anchors || [], decided: e.decided || [], deliverables: e.deliverables || [] });
  }
  /* Groups Fuzz has already celebrated, so a wrap-up is only cheered once */
  var celebrated = {};

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clock() { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function emit(evt) { subs.slice().forEach(function (fn) { fn(evt || { type: 'change' }); }); }

  var S = {
    slots: function () { return MAX_RUNNING; },
    setSlots: function (n) { if (n > 0) MAX_RUNNING = n; },
    clock: clock,
    /* The engine you work with yourself: Work in Claude, or Work in Copilot when Fuzz runs on Copilot */
    workIn: 'Claude',

    reset: function () {
      state = Demo.build();
      state.moment = 'any';
      state.maxOrder = state.items.length;
      state.minOrder = 0;
      captureN = 0; sentN = 0; celebrated = {}; state.checkins = []; state.energy = null; state.held = [];
      /* whose asks come first after anything urgent (Settings, in your real queue): the demo's manager */
      state.vips = state.vips || { manager: 'Priya Raman', people: [] };
      /* drafts already waiting for your OK start out in the queue too */
      S.inState('review').forEach(function (it) { S.queueUp(it, 'back'); });
      /* the demo's tasks show a size from their minutes */
      state.items.forEach(function (it) {
        if (it.kind === 'task' && !it.sizeLabel && it.mins) it.sizeLabel = it.mins < 60 ? '≈ ' + it.mins + ' min' : '≈ ' + Math.round(it.mins / 30) / 2 + ' h';
      });
      S.sortQueue();
      emit({ type: 'reset' });
    },
    get: function () { return state; },
    /* What Fuzz has sent for you this session, for the recap */
    sentCount: function () { return sentN; },
    on: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    emit: emit,

    /* Older finished tasks found by search aren't in the list; they're kept aside so a dialog can still open them */
    item: function (id) { return state.items.filter(function (i) { return i.id === id; })[0] || (state.archive && state.archive[id]); },
    keepAside: function (it) { (state.archive = state.archive || {})[it.id] = it; return it; },
    /* Done and let-go tasks older than the window: the core counts them, search finds them */
    finishedOlder: function () { return state.finishedOlder || 0; },
    /* Steps Fuzz has done out of those planned, for the progress dots in Lineup */
    progress: function (it) { var sc = it.script || generic(it); return { done: Math.min(it.workStep || 0, sc.steps.length), total: sc.steps.length }; },
    inState: function () {
      var want = Array.prototype.slice.call(arguments);
      return state.items.filter(function (i) { return want.indexOf(i.state) > -1; });
    },
    queue: function () { return state.queue.map(S.item).filter(Boolean); },
    front: function () { return S.item(state.queue[0]); },
    /* A triage session that has run long (js/view-triage.js) waits on its smaller cards: they go behind the rest,
       in the same order, and Triage counts itself clear when only they are left. The card on screen and one you
       picked from Lineup never wait. Not saved: a new session starts with none. */
    setDefer: function (fn) { deferFn = fn || null; if (deferFn) S.partition(); },
    isDeferred: function (it) { return !!(deferFn && it && it.id !== state.shown && !it.picked && deferFn(it)); },
    deferredCount: function () { return deferFn ? S.queue().filter(S.isDeferred).length : 0; },
    partition: function () {
      if (!deferFn) return;
      var wait = state.queue.filter(function (id) { return S.isDeferred(S.item(id)); });
      if (wait.length) state.queue = state.queue.filter(function (id) { return wait.indexOf(id) < 0; }).concat(wait);
    },
    running: function () { return S.inState('working').length; },

    stats: function () {
      return {
        waiting: state.queue.length,
        withFuzz: S.inState('working', 'queued').length,
        inClaude: S.inState('session').length,
        later: S.inState('scheduled').length,
        done: S.inState('done').length
      };
    },

    /* Run fn as one undoable change to these items. Returns { undo(), blocked() }: undo puts back what
       fn changed and returns null, or returns why it can't (something changed the same items since).
       Like the core: the log only grows, so undoing adds a line rather than removing fn's. */
    track: function (ids, fn) {
      ids = ids.filter(function (id, i) { return S.item(id) && ids.indexOf(id) === i; });
      var before = ids.map(function (id) { return { item: clone(S.item(id)), queued: S.inQueue(id), logAt: S.item(id).log.length }; });
      var m0 = state.moment, e0 = state.energy || null, n0 = state.items.length, p0 = groupsById();
      fn();
      var after, logAt, m1 = state.moment, e1 = state.energy || null;
      /* Tasks the change made and groups it touched undo with it */
      var made = state.items.slice(n0).map(function (i) { return i.id; }), madeAt, p1 = groupsById();
      var pids = Object.keys(Object.assign({}, p0, p1)).filter(function (k) { return p0[k] !== p1[k]; });
      function settle() {
        after = ids.map(function (id) { return fingerprint(S.item(id)); });
        logAt = ids.map(function (id) { return S.item(id).log.length; });
        madeAt = made.map(function (id) { return fingerprint(S.item(id)); });
        p1 = groupsById();
      }
      settle();
      var ch = {
        blocked: function () {
          for (var i = 0; i < ids.length; i++) {
            var it = S.item(ids[i]);
            if (fingerprint(it) === after[i]) continue;
            var newer = it.log.slice(0, it.log.length - logAt[i]);
            if (newer.some(function (l) { return l.kind === 'sent'; })) return 'It’s already been sent, so it can’t be undone.';
            if (['working', 'sending'].indexOf(it.state) > -1 || newer.some(function (l) { return ['research', 'action', 'blocked'].indexOf(l.kind) > -1; }))
              return 'Fuzz has already worked on this since, so it can’t be undone. Bring it back from Lineup instead.';
            return 'You changed this since. Undo that first.';
          }
          for (var j = 0; j < made.length; j++) if (S.item(made[j]) && fingerprint(S.item(made[j])) !== madeAt[j]) return 'You changed “' + S.item(made[j]).title + '” since. Undo that first.';
          var pn = groupsById();
          if (pids.some(function (k) { return pn[k] !== p1[k]; })) return 'You changed that group since. Undo that first.';
          if ((m1 !== m0 || e1 !== e0) && (state.moment !== m1 || (state.energy || null) !== e1)) return 'You answered another check-in since. Undo that first.';
          return null;
        },
        undo: function () {
          var why = ch.blocked(); if (why) return why;
          before.forEach(function (b, i) {
            var cur = S.item(b.item.id), log = cur.log, back = clone(b.item);
            /* the lines this change wrote stay, marked undone (newest first, so they sit above what came before) */
            log.slice(log.length - logAt[i], log.length - b.logAt).forEach(function (l) { l.undone = true; });
            back.log = log; Object.keys(cur).forEach(function (k) { delete cur[k]; }); Object.assign(cur, back);
            if (b.queued && !S.inQueue(cur.id)) state.queue.push(cur.id);
            if (!b.queued && S.inQueue(cur.id)) { S.leave(cur.id); state.totalEver--; }
            S.log(cur, 'status', 'You undid that.'); cur.log[0].undo = true;
          });
          made.forEach(function (id) { if (S.inQueue(id)) { S.leave(id); state.totalEver--; } state.items = state.items.filter(function (i) { return i.id !== id; }); });
          made = [];
          pids.forEach(function (k) {
            state.groups = state.groups.filter(function (g) { return g.id !== k; });
            if (p0[k]) state.groups.push(JSON.parse(p0[k]));
          });
          if (m1 !== m0) state.moment = m0;
          if (e1 !== e0) state.energy = e0;
          settle();
          state.shown = null;   /* the undone card comes back where it was, ahead of the one on screen */
          S.sortQueue(); emit({ type: 'restore' });
          return null;
        }
      };
      return ch;
    },

    log: function (item, kind, text) { item.log.unshift({ kind: kind, time: clock(), text: text }); },

    /* ---- queue ---- */
    /* The card on screen. It stays at the front of the queue until you act on it, so a draft or a deadline that
       arrives meanwhile waits behind it instead of taking the front while the old card is still showing (and
       its buttons acting on the newcomer). Moving it yourself (to the back, paused, another picked) lets go. */
    show: function (id) { state.shown = id || null; },
    /* You asked for a different order (a focus, a mood, a card brought to the front): the pin lets go */
    unpin: function () { state.shown = null; },
    shown: function () { return state.shown && S.inQueue(state.shown) ? state.shown : null; },
    sortQueue: function () {
      var m = state.moment;
      function fits(it) {
        if (m === 'quick') return (it.mins || 1) <= 5; /* entity, duplicate and review cards take seconds */
        if (m === 'low') return it.energy === 'low';
        return true;
      }
      var fo = (state.focus && state.focus.task_ids) || [];
      /* Once you've answered a check-in, the middle is the order for your energy (Prio; the core's priority.py) */
      var ek = state.energy ? Prio.keys(state.energy, S.queue()) : null;
      function key(x) {
        var inFocus = fo.indexOf(x.coreId || x.id) > -1 ? 0 : 1;
        var mid = ek ? ek[x.id].concat([inFocus, 0, 0]) : [x.dueAt ? 0 : 1, inFocus, x.handedBack ? 1 : 0, fits(x) ? 0 : 1, 0, 0];
        return [x.id === state.shown ? 0 : 1, x.picked ? 0 : 1, x.doing ? 0 : 1, x.atEnd ? 1 : 0].concat(mid, [x.order]);
      }
      state.queue.sort(function (a, b) {
        var x = S.item(a), y = S.item(b);
        /* the working card first; then deadlines; then this session's focus (the core orders live cards the same way) */
        var kx = key(x), ky = key(y);
        for (var i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i];
        return 0;
      });
      /* A group's cards come back to back, where its first one is; the group you're working through comes
         first, ahead of new arrivals and deadlines (one you picked from Lineup still goes first). The core
         orders live cards the same way. */
      var run = state.groupRun, out = [], used = {};
      function together(it) { return it.group && !it.atEnd; }
      function take(id) { if (!used[id]) { used[id] = true; out.push(id); } }
      if (state.shown && S.inQueue(state.shown)) take(state.shown);
      state.queue.forEach(function (id) { if (S.item(id).picked) take(id); });
      if (run) state.queue.forEach(function (id) { var it = S.item(id); if (it.group === run && together(it)) take(id); });
      state.queue.forEach(function (id) {
        if (used[id]) return;
        var it = S.item(id); take(id);
        if (together(it)) state.queue.forEach(function (o) { var x = S.item(o); if (x.group === it.group && together(x)) take(o); });
      });
      state.queue = out;
      S.partition();
    },
    /* The group you're working through in Triage (its id), or null once Fuzz has every answer */
    setRun: function (gid) { if (state.groupRun !== gid) { state.groupRun = gid || null; S.sortQueue(); } },
    groupRun: function () { return state.groupRun || null; },
    setMoment: function (m) { state.moment = m; state.shown = null; S.sortQueue(); emit({ type: 'moment' }); },
    /* End of the list: behind everything, deadlines too, until it next leaves triage */
    toBack: function (id, text) { var it = S.item(id); if (state.shown === id) state.shown = null; if (text != null) it.draft = text; if (it.kind === 'task') it.atEnd = true; it.order = ++state.maxOrder; S.sortQueue(); },
    enqueue: function (it, where) { it.state = 'triage'; S.queueUp(it, where); },
    /* Into the triage queue without changing state: a draft waiting for your OK stays "review". */
    queueUp: function (it, where) {
      if (where === 'front' && state.shown !== it.id) state.shown = null;   /* you put this one first */
      it.order = where === 'front' ? --state.minOrder : ++state.maxOrder;
      if (state.queue.indexOf(it.id) < 0) { state.queue.push(it.id); state.totalEver++; }
      S.sortQueue();
    },
    inQueue: function (id) { return state.queue.indexOf(id) > -1; },
    /* You picked this one from Lineup: it goes first, ahead of deadlines, until it leaves triage */
    pick: function (id) { var it = S.item(id); if (!it || !S.inQueue(id)) return; it.picked = true; state.shown = null; state.queue = [id].concat(state.queue.filter(function (q) { return q !== id; })); },
    leave: function (id) { var it = S.item(id); if (state.shown === id) state.shown = null; if (it) { it.atEnd = false; it.picked = false; it.putOff = false; it.checkinHold = false; } state.queue = state.queue.filter(function (q) { return q !== id; }); },

    /* ---- decisions from triage ---- */
    /* read: sources you pointed Fuzz to with this ask */
    assign: function (id, instructions, read) {
      var it = S.item(id);
      S.leave(id);
      if (instructions && instructions.trim() && instructions.trim() !== (it.hint || '').trim()) {
        S.log(it, 'guidance', 'You said: ' + instructions.trim());
      }
      if (read && read.length) S.log(it, 'guidance', 'Read these first: ' + read.map(function (s) { return '“' + s.title + '”'; }).join(', ') + '.');
      it.instr = instructions;
      it.handedBack = false; it.askBack = null;
      it.workStep = 0; it.nextAt = Date.now() + 4500;
      it.stage = 'fresh';
      var wait = S.running() >= MAX_RUNNING;
      it.state = wait ? 'queued' : 'working';
      it.queuedAt = Date.now();
      S.log(it, 'status', wait ? 'You assigned this to Fuzz. Five tasks are already running, so it is next up.' : 'You assigned this to Fuzz.');
      return wait;
    },
    /* You take it yourself (a handback answered "I'll find it"): it leaves triage and waits with you, under Yours in Lineup. */
    mine: function (id, note) {
      var it = S.item(id); S.leave(id);
      it.handedBack = false; it.askBack = null; it.state = 'mine'; it.now = 'Sources kept ready for you';
      S.log(it, 'guidance', 'You said: ' + note);
      S.log(it, 'status', 'You took this one yourself. Fuzz keeps the sources ready.');
    },
    done: function (id) { var it = S.item(id); S.leave(id); it.state = 'done'; it.doneAgo = 'Just now'; it.now = 'Marked done by you'; S.log(it, 'status', 'You marked this done.'); wrapCheck(it); },
    /* I'll do it: yours, and it takes real time. It leaves Triage for My work and waits for a Deep Work session. */
    deepWork: function (id) { var it = S.item(id); S.leave(id); it.state = 'deepwork'; it.doing = false; it.now = it.leftOff ? 'Left off: ' + it.leftOff : 'In My work, ready when you start'; S.log(it, 'status', 'You said you’ll do this. It’s in My work, and Fuzz gets it ready for when you sit down to it.'); },
    /* Done for now in a session: where you left off goes in its notes, and it moves to the back of the pool */
    deepWorkLeftOff: function (id, note) {
      var it = S.item(id); if (!it) return; note = (note || '').trim();
      if (note) { it.leftOff = note; it.now = 'Left off: ' + note; }
      state.items = state.items.filter(function (i) { return i !== it; }).concat([it]);
      S.log(it, note ? 'guidance' : 'status', note ? 'Done for now in My work. Where you left off: ' + note : 'Done for now in My work.');
    },
    session: function (id) { var it = S.item(id); S.leave(id); it.state = 'session'; it.now = 'Open in ' + S.workIn; S.log(it, 'status', 'You opened this in a working session with ' + S.workIn + '. Fuzz keeps the sources ready.'); },
    /* opt is one of S.scheduleOptions(it), or an exact time: the core's Schedule options, as the API sends them */
    /* instr: Fuzz looks into it meanwhile, and it still comes back at that time */
    schedule: function (id, opt, instr, text) {
      var it = S.item(id), when = lowerFirst(opt.label); S.leave(id);
      if (text != null) it.draft = text;   /* Not now on a draft: it comes back as you left it */
      it.state = instr ? 'queued' : 'scheduled'; it.gathering = !!instr;
      it.scheduleAnchor = opt.anchor; it.scheduledFor = when; it.now = 'Back ' + when;
      if (instr) S.log(it, 'guidance', 'You scheduled this: ' + when + '. You said: ' + instr);
      else S.log(it, 'status', 'You scheduled this: ' + when + '.');
    },
    scheduleOptions: function (it) { return Sched.options(it); },
    /* The UI decides when to ask how you're doing; the answer is kept (POST /checkin in the core) and sets
       the moment. hold_rest schedules what isn't time-sensitive for tomorrow morning, as one change. */
    checkin: function (answer, followUp) {
      var moment = followUp === 'quick_first' ? 'quick' : Prio.MOMENT[answer];
      /* Tired and overloaded: the task cards outside today's set wait for tomorrow morning; hold_rest: every
         task card that isn't time-sensitive. One change, so one Undo puts them all back (the core's checkins.record) */
      var held = S.queue().filter(function (i) {
        /* a card asking its own question would lose it if it moved: it stays, last (the core's KEEP_TAGS) */
        if (i.kind !== 'task' || i.doing || i.block || i.blockEnd || i.handedBack || i.result || i.foundOut || i.review || i.checkBack || i.putOff || i.inTheWay) return false;
        if (followUp === 'hold_rest') return !i.dueAt;
        return (answer === 'tired' || answer === 'overloaded') && !Prio.included(answer, Prio.cats(i));
      });
      /* Deep work waits in the Deep Work pool for a session with time, not for tomorrow morning */
      var deep = followUp === 'hold_rest' ? [] : held.filter(function (i) { return Prio.cats(i).indexOf('deep') > -1; });
      held = held.filter(function (i) { return deep.indexOf(i) < 0; });
      var ch = S.track(held.concat(deep).map(function (i) { return i.id; }), function () {
        state.checkins.unshift({ answer: answer, followUp: followUp || null, moment: moment, at: Date.now() });
        state.moment = moment; state.energy = answer; state.shown = null;
        held.forEach(function (i) { S.schedule(i.id, Sched.tomorrowMorning()); i.checkinHold = true; });
        deep.forEach(function (i) { S.deepWork(i.id); });
        state.held = (state.held || []).concat(held.map(function (i) { return i.id; }));
        S.sortQueue();
      });
      emit({ type: 'moment' });
      return { change: ch, held: held.length + deep.length, deep: deep.length };
    },
    /* Momentum ("Sure, just a few more"): one level up, and a few of what a check-in held come back: the new
       level's stretch, best placed first (never a card you scheduled yourself). The core's checkins.more. */
    more: function () {
      var from = state.energy || 'okay', to = Prio.up(from);
      var cand = (state.held || []).map(S.item).filter(function (i, n, all) { return i && all.indexOf(i) === n && i.state === 'scheduled' && i.checkinHold && Prio.included(to, Prio.cats(i)); });
      /* a few more, not the whole pile: the new level's stretch, the ones it would put first */
      var ek = Prio.keys(to, cand);
      var back = cand.slice().sort(function (a, b) {
        var x = ek[a.id].concat([a.order || 0]), y = ek[b.id].concat([b.order || 0]);
        for (var k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k];
        return 0;
      }).slice(0, Prio.STRETCH[to]);
      var ch = S.track(back.map(function (i) { return i.id; }), function () {
        state.energy = to; state.moment = Prio.MOMENT[to]; state.shown = null;
        back.forEach(function (i) { i.scheduledFor = null; i.scheduleAnchor = null; i.now = ''; S.enqueue(i, 'back'); S.log(i, 'status', 'Back from tomorrow: you had energy for a few more.'); });
        S.sortQueue();
      });
      emit({ type: 'moment' });
      return { change: ch, back: back.length, energy: to };
    },
    energy: function () { return state.energy || null; },
    park: function (id) { var it = S.item(id); S.leave(id); it.state = 'parked'; it.woke = false; it.parkedAgo = 'Today'; it.now = ''; S.log(it, 'status', 'You parked this from triage.'); },
    /* The parked review: a parked task came back to ask "Still want this?" */
    keepParked: function (id) { var it = S.item(id); S.leave(id); it.state = 'parked'; it.review = false; it.woke = false; it.parkedAgo = 'Today'; it.now = ''; S.log(it, 'status', 'You kept this parked.'); },
    /* You want it now: it stays first in triage as an ordinary card, so you decide what happens next */
    clarify: function (id) { var it = S.item(id); it.review = false; it.leansGo = false; it.ask = 'What should happen to this?'; S.queueUp(it, 'front'); S.log(it, 'status', 'You brought this back from Parked.'); },
    /* A task you keep giving a new time came back to ask what's in the way (put_off in the core) */
    unclear: function (id) {
      var it = S.item(id); S.leave(id); it.putOff = false;
      it.workStep = 0; it.nextAt = Date.now() + 4500; it.instr = 'Work out what this needs and the smallest first step.';
      it.state = S.running() >= MAX_RUNNING ? 'queued' : 'working'; it.queuedAt = Date.now();
      S.log(it, 'status', 'You asked Fuzz to work out the first step.');
    },
    /* Tell Fuzz (E on any card): a note that goes along with whatever you pick next. It's kept in the notes. */
    tell: function (id, text) {
      var it = S.item(id); text = (text || '').trim(); if (!it || !text) return;
      it.notes = ((it.notes || '') + '\nYou said: ' + text).trim();
      S.log(it, 'guidance', 'You said: ' + text);
    },
    stillMatters: function (id) { var it = S.item(id); it.putOff = false; it.ask = 'What should happen to this?'; S.queueUp(it, 'front'); S.log(it, 'status', 'You said this still matters.'); },
    /* Waiting means you're blocked until someone gets back to you, so it always names who, and Fuzz checks back */
    wait: function (id, who) { var it = S.item(id); S.leave(id); it.state = 'waiting'; it.checkBack = false; it.waitingOn = who || it.waitingOn || it.who || 'Someone'; it.waitedFor = 'Today'; it.nextCheck = 'In a few days'; S.log(it, 'status', 'You’re waiting on ' + it.waitingOn + '. Fuzz checks back in a few days, sooner if they reply.'); },
    /* A check-back: they got back to you, so it's yours to decide again, first in line */
    gotIt: function (id) { var it = S.item(id); it.checkBack = false; it.ask = 'What should happen to this?'; S.queueUp(it, 'front'); S.log(it, 'status', (it.waitingOn || 'They') + ' got back to you.'); },
    keepWaiting: function (id) { var it = S.item(id); S.leave(id); it.state = 'waiting'; it.checkBack = false; it.nextCheck = 'In a few days'; S.log(it, 'status', 'Still waiting on ' + (it.waitingOn || 'them') + '. Fuzz checks back in a few days.'); },
    nudgeThem: function (id) {
      var it = S.item(id); S.leave(id); it.checkBack = false;
      it.workStep = 0; it.nextAt = Date.now() + 4500; it.instr = 'Draft a short, friendly nudge to ' + (it.waitingOn || 'them') + '.';
      it.state = S.running() >= MAX_RUNNING ? 'queued' : 'working'; it.queuedAt = Date.now();
      S.log(it, 'status', 'You asked Fuzz to nudge ' + (it.waitingOn || 'them') + '.');
    },
    /* People you've waited on before, and whoever this task came from, for the "Waiting on whom?" box */
    waitNames: function (it) {
      var seen = {}, out = [];
      [it.waitingOn, it.who].concat((it.sources || []).map(function (src) { var m = /\bfrom (.+)$/.exec(src.title || ''); return m && m[1]; }))
        .concat(state.items.filter(function (i) { return i.waitingOn && i.waitingOn !== 'Someone'; }).map(function (i) { return i.waitingOn; }))
        .forEach(function (n) { n = (n || '').trim(); if (n && n !== 'Someone' && n !== 'You' && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } });
      return out.slice(0, 4);
    },
    theirs: function (id) { var it = S.item(id); S.leave(id); it.state = 'letgo'; it.theirs = true; it.doneAgo = 'Today'; it.now = 'Someone else’s'; S.log(it, 'status', 'You said this is someone else’s, not yours.'); wrapCheck(it); },
    letGo: function (id) { var it = S.item(id); S.leave(id); it.state = 'letgo'; it.doneAgo = 'Today'; it.now = 'Let go from triage'; S.log(it, 'status', 'You let this go.'); wrapCheck(it); },
    drop: function (id) { var it = S.item(id); S.leave(id); it.state = 'dropped'; S.log(it, 'status', 'You dropped this.'); wrapCheck(it); },
    /* A duplicate card's answers: primary, Merge; secondary, Keep separate */
    resolve: function (id, which) {
      var it = S.item(id); S.leave(id); it.state = 'resolved'; it.resolution = which;
      var t = it.kind === 'dup' && S.item(it.dupOf);
      if (t && which === 'primary') { S.log(t, 'status', 'Merged with a Slack message from ' + it.who + '. It is now a source on this task. Reason: same person and the same Q4 results doc.'); t.sources.push({ type: 'Slack', title: 'Priya: Q4 summary deck request' }); t.updated = true; }
    },
    /* ---- focus: what we're working on this session ----
       Live mode asks the core (its instant pass, then the AI's); the demo matches words in titles. */
    focusNow: function () { return (state && state.focus) || null; },
    focusChips: function () {
      var out = (state.focusChips || []).slice();
      if (!out.length) { var last = state.lastFocus; if (last) out.push({ label: last, text: last }); out.push({ label: 'Whatever’s next', skip: true }); }
      return out;
    },
    focusPreview: function (text) {
      var words = (text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
      if (/small things|quick ones|quick things/.test((text || '').toLowerCase())) return Promise.resolve({ tasks: [], quick: true });
      var ts = S.queue().filter(function (it) { var t = (it.title || '').toLowerCase(); return words.some(function (w) { return ['the', 'for', 'and', 'prep', 'stuff', 'things'].indexOf(w) < 0 && t.indexOf(w) > -1; }); });
      return Promise.resolve({ tasks: ts.map(function (it) { return { task_id: it.id, title: it.title, why: 'Says it in the title' }; }), quick: false });
    },
    setFocus: function (text, ids, skip) {
      state.shown = null;   /* what we're working on decides what's first */
      if (skip) { state.focus = { source: 'skip', text: null, task_ids: null }; S.sortQueue(); return; }
      if (/small things|quick ones|quick things/.test((text || '').toLowerCase())) { state.focus = { text: text, task_ids: null, quick: true }; S.setMoment('quick'); return; }
      state.focus = { text: text, task_ids: ids || [] }; state.lastFocus = text;
      S.sortQueue(); emit({ type: 'moment' });
    },
    /* ---- working sessions ---- */
    /* A task is big at 45 minutes or five steps (work.big_minutes, work.big_steps in the core), or when you say so */
    isBig: function (it) { return !!it && it.kind === 'task' && (!!it.forceBig || (it.size ? !!it.size.big : (it.mins || 0) >= 45 || (it.stepCount || 0) >= 5)); },
    workConfig: function () { var w = (state && state.work) || {}; return w.stuck_minutes || { sort: 3, work: 25 }; },
    /* The times Book time offers: the core's (live), or the demo's next working-hour starts */
    bookOptions: function (it) {
      if (it.bookOptions) return it.bookOptions;
      var mins = Math.min(it.mins || 30, 120), out = [], d = new Date();
      for (var i = 1; out.length < 3 && i < 8; i++) {
        var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
        if (day.getDay() === 0 || day.getDay() === 6) continue;
        [9, 14].forEach(function (h) {
          if (out.length >= 3) return;
          var s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h), e = new Date(s.getTime() + mins * 60000);
          var f = function (x) { return x.getHours() + ':' + ('0' + x.getMinutes()).slice(-2); };
          out.push({ anchor: { type: 'block', start: s.toISOString(), end: e.toISOString() }, label: (i === 1 ? 'Tomorrow' : s.toLocaleDateString([], { weekday: 'short' })) + ' ' + f(s) + '–' + f(e), focus: false });
        });
      }
      return out;
    },
    /* Book time: you'll do it then. It comes back first in the list, in work mode. */
    book: function (id, opt) {
      var it = S.item(id); if (!it) return;
      S.leave(id); it.state = 'scheduled'; it.booked = opt && opt.label; it.now = 'Booked ' + (opt ? opt.label : '');
      S.log(it, 'status', 'You booked time: ' + (opt ? opt.label : 'a block') + '.');
    },
    /* Do it now: the working card, first in the list */
    doNow: function (id) { var it = S.item(id); if (!it) return; it.doing = true; it.forceBig = false; S.pick(id); S.log(it, 'status', 'You started on this.'); },
    pause: function (id, note) {
      var it = S.item(id); if (!it) return;
      it.doing = false; it.firstStepMode = false; it.picked = false; it.order = ++state.maxOrder; if (state.shown === id) state.shown = null; S.sortQueue();
      S.log(it, note && note.trim() ? 'guidance' : 'status', note && note.trim() ? 'You paused. Where you left off: ' + note.trim() : 'You paused this.');
    },
    afterOthers: function (id) { var it = S.item(id); if (!it) return; it.afterOthers = true; it.doing = false; S.toBack(id); S.log(it, 'status', 'After the others: you’ll get to it once the rest are sorted.'); },
    firstStep: function (id) {
      var it = S.item(id); if (!it) return;
      S.log(it, 'status', 'Fuzz is writing the checklist. Step 1 comes back to you next.');
      if (S.live) { S.leave(id); it.state = 'queued'; it.gathering = true; return; }
      it.doing = true; it.firstStepMode = true; it.firstStep = it.firstStep || 'Open what you need and write the first line (two minutes).'; S.pick(id);
    },
    /* ---- deliverables ----
       Named outcomes served by many tasks. Live mode keeps the core's list in state.deliverables. */
    deliverables: function () { return (state && state.deliverables) || []; },
    deliverable: function (coreId) { return S.deliverables().filter(function (d) { return d.id === coreId; })[0] || null; },
    /* A deliverable card's answer (last week, this week's pick or steps, track a new one, part of …) */
    answerCard: function (id, opt) { var it = S.item(id); if (!it) return; S.leave(id); if (it.kind === 'deliv') it.state = 'resolved'; else it.cardKind = null; },
    deliverableAction: function () { return Promise.resolve(); },
    /* ---- series (docs/series.md) ----
       The bigger things you're working on. Live mode keeps the core's page in state.series; the demo has a
       small made-up one so the page isn't empty. */
    series: function () { return (state && state.series) || DEMO_SERIES; },
    seriesList: function () {
      var s = S.series().sections || {}, out = [];
      ['new', 'going', 'quiet', 'watching', 'wrapped'].forEach(function (k) { (s[k] || []).forEach(function (x) { out.push(x); }); });
      return out;
    },
    seriesById: function (coreId) { return S.seriesList().filter(function (x) { return x.id === +coreId; })[0] || null; },
    seriesSheet: function (coreId) {
      var s = S.seriesById(coreId);
      return s ? Promise.resolve(demoSheet(s)) : Promise.reject(new Error('No series ' + coreId));
    },
    seriesAction: function () { return Promise.reject(new Error('Series need Fuzz running: this is the demo.')); },
    seriesPreview: function () { return Promise.resolve({ would_join: [], would_stop_matching: [] }); },
    seriesChoices: function () { return Promise.resolve(S.seriesList().map(function (x) { return { series_id: x.id, name: x.name }; })); },
    taskSeries: function () { return Promise.resolve(); },
    answerSeriesCard: function () { return Promise.resolve(); },
    /* The end of a booked block: Keep going (the block runs on, if the calendar is free) */
    keepGoing: function (id) { var it = S.item(id); if (!it) return; it.blockEnd = false; S.log(it, 'status', 'You kept going.'); S.pick(id); },
    /* A hold on your calendar for booked time: approve, always allow, or skip (still booked in Fuzz) */
    answerHold: function (id, opt) { var it = S.item(id); if (!it) return; S.leave(id); it.cardKind = null; S.log(it, 'status', opt === 'skip' ? 'No change to your calendar.' : 'You approved the calendar hold.'); },
    /* I can't decide: Fuzz lays out the options; the task stays yours and its card comes back right after the one
       in front. Live mode does it in the core; the demo pretends, a few seconds later. */
    decideFor: function (id) {
      var it = S.item(id); if (!it) return;
      S.leave(id); it.state = 'queued'; it.gathering = true; it.now = 'Laying out the options';
      S.log(it, 'guidance', 'You asked Fuzz to lay out the options.');
      if (S.live) return;
      setTimeout(function () {
        if (it.state !== 'queued' || !it.gathering) return;
        it.state = 'triage'; it.gathering = false; it.foundOut = true; it.now = '';
        it.aiHeading = 'Your options'; it.aiNote = 'In this demo Fuzz doesn’t really look. With your engine set up, the options land here, with the one Fuzz suggests.';
        S.log(it, 'status', 'Fuzz laid out the options. It’s back for you.');
        if (!S.inQueue(id)) { state.queue.splice(Math.min(1, state.queue.length), 0, id); state.totalEver++; }
        emit({ type: 'review' });
      }, 4000);
    },
    draftIt: function (id) { var it = S.item(id); if (!it) return; S.leave(id); it.state = 'queued'; S.log(it, 'guidance', 'You said: draft it for my OK.'); },
    /* A late ask joins the thread's reply that's waiting for your OK: Fuzz rewrites the reply to cover it */
    joinReply: function (id) {
      var it = S.item(id); if (!it) return;
      S.leave(id); it.state = 'queued'; it.joinReply = false;
      S.log(it, 'status', 'You added this to the reply waiting for your OK. Fuzz rewrites it to cover this too.');
    },
    /* "Same as…" in task detail: this task is the one you picked, so it merges into it (the core matches;
       live mode only). other is the picked task's title, for the log. */
    sameAs: function (id, otherCoreId, otherTitle) {
      var it = S.item(id); if (!it) return;
      S.leave(id); it.state = 'resolved'; it.resolution = 'primary';
      S.log(it, 'status', 'You said this is the same as “' + (otherTitle || 'another task') + '”, so it merged into it.');
    },

    /* ---- groups ----
       The tasks that came from the same email thread, meeting or run of Slack messages. The core makes
       them; you never do. A group has no queue, no card and no progress bar of its own: it shows up as a
       "From …" line on its tasks, and is finished when none of them is still open. */
    group: function (id) { return (state.groups || []).filter(function (g) { return g.id === id; })[0] || null; },
    groupOf: function (it) { return it && it.group ? S.group(it.group) : null; },
    groupTasks: function (g) { return state.items.filter(function (i) { return i.group === g.id && GONE.indexOf(i.state) < 0; }); },
    /* Counts what's done, never what's left. Let-go tasks leave the count. */
    groupCount: function (g) {
      var all = S.groupTasks(g).filter(function (i) { return i.state !== 'letgo'; });
      /* The core lists every task in the group, older finished ones too, which aren't loaded here */
      (g.members || []).forEach(function (m) { if (m.state !== 'letgo' && GONE.indexOf(m.state) < 0 && !state.items.some(function (i) { return i.id === m.id; })) all.push(m); });
      return { done: all.filter(function (i) { return i.state === 'done'; }).length, total: all.length };
    },
    groupFinished: function (g) { var c = S.groupCount(g); return g.closed || (c.total > 0 && c.done === c.total); },
    /* A task's series, as its "Part of …" line (the noun stays out of sight) */
    seriesLine: function (it) { return it && it.series ? 'Part of ' + it.series.name : ''; },
    /* The line a card or row shows: "From Staff sync · 1 of 3 done" */
    partOf: function (it, withCount) {
      var g = S.groupOf(it); if (!g) return '';
      if (!withCount) return 'From ' + g.title;
      var c = S.groupCount(g);
      return 'From ' + g.title + ' · ' + (S.groupFinished(g) ? 'wrapped up' : c.done ? c.done + ' of ' + c.total + ' done' : c.total + ' tasks');
    },
    renameGroup: function (id, title) { var g = S.group(id); if (g && title && title.trim()) g.title = title.trim(); },
    /* Take a task out. A group of one isn't a group, so the last task left stands on its own. */
    takeOut: function (id) {
      var it = S.item(id), g = S.groupOf(it); if (!g) return;
      it.group = null; S.log(it, 'status', 'You took this out of ' + g.title + '.');
      var left = S.groupTasks(g);
      if (left.length === 1) { left[0].group = null; S.log(left[0], 'status', g.title + ' had only this task left, so it stands on its own now.'); g.closed = true; return 'dissolved'; }
    },
    wrapUp: function (id) {
      var g = S.group(id); if (!g) return;
      g.closed = true;
      S.groupTasks(g).forEach(function (i) { S.log(i, 'status', 'You said ' + g.title + ' is wrapped up.'); });
    },

    /* ---- movement between lists ---- */
    bringBack: function (id, where) { var it = S.item(id); S.log(it, 'status', where === 'front' ? 'Pulled back into triage.' : 'Moved back into triage, at the end of the queue.'); it.handedBack = false; S.enqueue(it, where); },
    handToFuzz: function (id) {
      var it = S.item(id);
      it.workStep = 0; it.nextAt = Date.now() + 4500; it.instr = it.instr || it.hint || '';
      it.state = S.running() >= MAX_RUNNING ? 'queued' : 'working'; it.queuedAt = Date.now();
      S.log(it, 'status', 'You handed this to Fuzz.');
    },
    /* Who a draft goes to and how. A draft for you alone (a finding, a parked thought) has no recipient. */
    recipient: function (it) {
      if (it.sendTo) return it.sendTo;
      if (!it.who || it.who === 'You' || ['Email', 'Slack'].indexOf(it.source) < 0) return null;
      return { to: it.who, via: it.source };
    },
    /* How the card, its button and the log say what approving does. A message is sent to someone; a wiki
       draft (r.verb) creates a page, edits one or comments on one. */
    wording: function (r) {
      var to = r ? r.to : 'its recipient', q = '“' + to + '”';
      switch (r && r.verb) {
        case 'create': return { ask: 'Create the page ' + q + (r.where ? ' in ' + r.where : '') + '?', toLabel: 'New page', btn: 'Approve and create', going: 'Creating ' + q, did: 'Created the page ' + q, will: 'Fuzz will create the page ' + q, field: 'The new page, ' + to, note: 'Fuzz creates exactly this page once you approve. You can undo until it’s made.' };
        case 'edit': return { ask: 'Make this change to ' + q + '?', toLabel: 'Page', btn: 'Approve and save', going: 'Saving ' + q, did: 'Changed ' + q, will: 'Fuzz will save the change to ' + q, field: q + ' as it will read', note: 'Fuzz replaces the page with exactly this once you approve. You can undo until it’s saved.' };
        case 'comment': return { ask: 'Comment on ' + q + '?', toLabel: 'On', btn: 'Approve and post', going: 'Commenting on ' + q, did: 'Commented on ' + q, will: 'Fuzz will post the comment on ' + q, field: 'Comment on ' + to, note: 'Fuzz posts exactly this once you approve. You can undo until it has gone out.' };
      }
      return { ask: 'Send this to ' + to + '?', toLabel: 'To', btn: 'Approve and send', going: 'Sending to ' + to, did: 'Sent to ' + to, will: 'Fuzz will send it to ' + to, field: 'Message to ' + to, note: 'Fuzz sends exactly this once you approve. You can undo until it has gone out.' };
    },
    editDraft: function (it, text) {
      if (text == null || text === it.draft) return;
      it.draft = text; S.log(it, 'guidance', 'You edited the draft.');
    },
    /* Approved: Fuzz's sender sends it with its own connector tools, in a moment. Until then it can be undone. */
    approve: function (id, text) {
      var it = S.item(id), r = S.recipient(it), w = S.wording(r);
      S.leave(id); S.editDraft(it, text);
      it.state = 'sending'; it.sendKind = 'draft'; it.sendAt = Date.now() + SEND_MS; it.now = w.going;
      S.log(it, 'status', 'You approved the draft. ' + (r ? w.will + ' (' + r.via + ')' : 'Fuzz will send it') + '.');
    },
    /* A draft that goes nowhere: approving it just files it, so it can be undone. */
    accept: function (id, text) {
      var it = S.item(id);
      S.leave(id); S.editDraft(it, text);
      /* Prep for a step still ahead files the note and waits for that step; the core says when */
      if (it.prep) { it.state = 'scheduled'; it.now = it.afterApprove || 'Waiting for the next step'; S.log(it, 'status', 'You approved the prep. ' + (it.afterApprove || '')); return; }
      it.state = 'done'; it.doneAgo = 'Just now'; it.now = 'Approved by you';
      S.log(it, 'status', 'You approved this.');
      wrapCheck(it);
    },
    revise: function (id, note, text) {
      var it = S.item(id);
      S.leave(id); S.editDraft(it, text);
      S.log(it, 'guidance', 'You asked for changes: ' + note); it.revisedNote = note;
      it.script = { steps: [['action', 'Reworked the draft: ' + note.replace(/[.!\s]*$/, '') + '.']], ending: { type: 'review' } };
      it.workStep = 0; it.nextAt = Date.now() + 4500; it.now = 'Changing the draft';
      it.state = S.running() >= MAX_RUNNING ? 'queued' : 'working'; it.queuedAt = Date.now();
    },
    markDone: function (id) { var it = S.item(id); it.state = 'done'; it.doneAgo = 'Just now'; it.now = 'Marked done by you'; S.log(it, 'status', 'You marked this done.'); wrapCheck(it); },
    replied: function (id) { var it = S.item(id); S.log(it, 'status', 'A reply came in. Back in triage with the reply attached.'); it.updated = true; S.enqueue(it, 'front'); },
    nudgeSent: function (id, text) {
      var it = S.item(id); S.editDraft(it, text);
      it.state = 'sending'; it.sendKind = 'nudge'; it.sendAt = Date.now() + SEND_MS; it.nudge = false; it.now = 'Sending the nudge';
      S.log(it, 'status', 'You approved the nudge. Fuzz will send it.');
    },
    reopen: function (id) { var it = S.item(id); S.log(it, 'status', 'You brought this back.'); S.enqueue(it, 'front'); },

    /* ---- capture ---- */
    capture: function (text, docs, picked, series, refs) {
      docs = docs || [];
      var t = (text || '').trim();
      var title = t || docs[0];
      var id = 'cap' + (++captureN);
      var it = {
        id: id, kind: 'task', state: 'triage', title: title, source: 'Captured by you', who: 'You',
        age: 'Just now', stage: 'fresh', mins: 5, energy: 'normal', capturedAt: Date.now(), isNew: true,
        incoming: docs.length ? 'You captured this with ' + docs.length + (docs.length === 1 ? ' document' : ' documents') + ' attached. Fuzz is reading ' + (docs.length === 1 ? 'it' : 'them') + ' with your note.' : 'You captured this a moment ago. Nothing else is known yet.',
        ask: 'Want Fuzz to start on this?',
        hint: 'Look into: ' + title + '. Gather what you need and show me what you found before doing anything.',
        aiHeading: 'What Fuzz did', aiNote: 'I tidied your note and suggested instructions. Edit anything.',
        firstStep: 'Write one sentence about what “done” looks like.',
        log: [], sources: docs.map(function (d) { return { type: 'Doc', title: d }; }), context: [], conversation: []
      };
      if (series && !series.start) it.series = { id: series.id, name: series.name };   /* New task's + → Series */
      if (refs) {   /* ...Person, Source, Artifact: they join its sources, and a person its People */
        refs.people.forEach(function (p) { it.sources.push({ type: 'Person', title: (p.role === 'about' ? 'About ' : 'For ') + p.name }); });
        refs.links.forEach(function (l) { it.sources.push({ type: 'Link', title: l, url: l }); });
        refs.artifacts.forEach(function (a) { it.sources.push({ type: 'Fuzz made', title: a.name }); });
        it.people = refs.people.map(function (p) { return { name: p.name, email: p.email || '', did: [{ text: p.role === 'about' ? 'You said it’s about them' : 'You said it’s for them' }] }; });
      }
      state.items.push(it);
      S.log(it, 'status', 'You captured this task.');
      S.enqueue(it, 'back');
      state.captured.unshift({ text: title, ref: id, doc: !t && docs.length > 0, time: 'Just now' });
      emit({ type: 'capture', item: it });
      return it;
    },
    /* Files you add to a task in triage: more for Fuzz to read. They join its Sources. */
    attach: function (id, files) {
      var it = S.item(id);
      /* With the core, a file can be removed once the core has it (live.js gives it its id then) */
      files.forEach(function (f) { it.sources.unshift({ type: 'File', title: f.name, mine: !S.live }); S.log(it, 'status', 'You attached ' + f.name + '.'); });
      emit({ type: 'attach', id: id });
    },
    /* A file you added by mistake comes off the task */
    removeSource: function (id, src) {
      var it = S.item(id); if (!it) return;
      it.sources = it.sources.filter(function (s) { return s !== src; });
      S.log(it, 'status', 'You removed ' + src.title + '.');
      emit({ type: 'attach', id: id });
    },
    /* Deep Work: something typed that isn't in the pool becomes a task that goes straight there, to work on now */
    captureDeep: function (text) {
      var id = 'deep' + (++captureN);
      var it = {
        id: id, kind: 'task', state: 'deepwork', title: text.trim(), source: 'Captured by you', who: 'You', age: 'Just now', stage: 'fresh', now: 'You’re working on it now', mins: 30, energy: 'normal', order: ++state.maxOrder,
        incoming: 'You asked for this one by name in My work.', aiNote: 'You started this in My work, so Fuzz hasn’t had time to gather anything for it yet.',
        log: [], sources: [], context: [], conversation: [], people: [], code: []
      };
      S.log(it, 'status', 'You started this in My work.');
      state.items.push(it);
      emit({ type: 'capture', item: it });
      return it;
    },
    parkThought: function (text) {
      var id = 'thought' + (++captureN);
      var it = {
        id: id, kind: 'task', state: 'parked', title: text.trim(), source: 'Parked thought', who: 'You', age: 'Just now', stage: 'fresh', parkedAgo: 'Just now', now: '', mins: 5, energy: 'normal', order: ++state.maxOrder,
        incoming: 'A stray thought you parked without leaving what you were doing.', aiNote: 'Parked with no date. Once it has sat a week, Fuzz may bring it back on a day you have room to ask if you still want it.',
        log: [], sources: [], context: [], conversation: []
      };
      S.log(it, 'status', 'You parked this thought.');
      state.items.push(it);
      emit({ type: 'park', item: it });
      return it;
    },

    /* ---- Fuzz working in the background ---- */
    startWork: function () { if (!timer) timer = setInterval(tick, 1000); },
    nowText: function (it) {
      if (it.gathering && it.scheduledFor) return 'Looking into it. Back ' + it.scheduledFor;
      if (it.gathering && it.state === 'queued') return 'Waiting to gather context';
      if (it.gathering && it.state === 'working') { var g = it.log[0]; return g && g.kind !== 'status' ? g.text : 'Gathering context'; }
      if (it.state === 'queued') return 'Next up, waiting for a free slot';
      if (it.state === 'sending') return it.now || 'Sending';
      if (it.state === 'working') { var l = it.log[0]; return l && l.kind !== 'status' ? l.text : (it.now || 'Getting started'); }
      return it.now || '';
    }
  };

  /* When the last open task in a group finishes, the group is finished and Fuzz celebrates.
     The event waits a moment so it lands after the card has left. */
  function wrapCheck(it) {
    var g = S.groupOf(it);
    if (!g || g.closed || celebrated[g.id] || !S.groupFinished(g)) return;
    celebrated[g.id] = true;
    setTimeout(function () { if (S.group(g.id) && S.groupFinished(S.group(g.id))) emit({ type: 'wrapped', group: S.group(g.id) }); }, 1800);
  }
  /* Each group as JSON, by id, so a change can tell which groups it touched */
  function groupsById() { var o = {}; (state.groups || []).forEach(function (g) { o[g.id] = JSON.stringify(g); }); return o; }

  function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  /* What decides whether a change still undoes: everything about the item but its log, plus whether it's in the queue. */
  function fingerprint(it) { var c = clone(it); delete c.log; c.queued = S.inQueue(it.id); return JSON.stringify(c); }

  /* Fuzz's sender: sends what you approved, with its own connector, then says so. Sent can't be undone. */
  function send(it) {
    var r = it.sendKind === 'nudge' ? { to: it.waitingOn || 'them', via: it.source } : S.recipient(it);
    if (it.sendKind === 'nudge') { it.state = 'waiting'; it.nextCheck = 'Nudge sent, checking tomorrow'; it.now = ''; }
    else { it.state = 'done'; it.doneAgo = 'Just now'; it.now = 'Sent with your OK'; }
    it.sendAt = 0; sentN++;
    S.log(it, 'sent', (it.sendKind === 'nudge' ? 'Sent the follow-up nudge' + (r ? ' to ' + r.to : '') : r ? S.wording(r).did : 'Sent') + (r ? ' (' + r.via + ')' : '') + ' after you approved it.');
    if (it.state === 'done') wrapCheck(it);
    emit({ type: 'sent', item: it });
  }

  function generic(it) {
    return {
      steps: [
        ['research', ['Email', 'Slack', 'Meeting'].indexOf(it.source) > -1 ? 'Read the original ' + (it.source === 'Meeting' ? 'meeting notes' : it.source === 'Email' ? 'email' : 'Slack thread') + ' and your instructions.' : 'Read your note and your instructions.'],
        ['research', 'Looked for related tasks, people and documents.' + (it.sources[0] ? ' Opened “' + it.sources[0].title + '”.' : '')],
        ['action', 'Drafted the next step from your instructions.']
      ],
      ending: { type: 'review' }
    };
  }

  function finish(it, end) {
    end = end || { type: 'review' };
    if (end.type === 'handback') {
      it.askBack = end.ask; it.quick = end.quick || null; it.handedBack = true;
      /* the earlier instructions may have guessed the answer; show the neutral version while you decide */
      if (end.hint) it.instr = end.hint;
      it.meta = (it.source || 'Task') + ' · handed back just now';
      S.log(it, 'blocked', end.log || 'Could not go further without you.');
      S.log(it, 'status', 'Handed back to you. It joined the end of your queue.');
      S.enqueue(it, 'back');
      emit({ type: 'handback', item: it });
    } else {
      it.state = 'review'; it.now = 'Draft ready to review';
      /* the in-progress note would freeze here; say what was done instead */
      it.aiHeading = 'What Fuzz did'; it.aiNote = it.doneNote || 'Worked through it from your instructions. Every step is under Done so far.';
      if (!it.draft) it.draft = 'Draft for “' + it.title + '”, based on your instructions: ' + (it.instr || it.hint || '') ;
      S.log(it, 'action', 'The draft is ready. Nothing is sent until you approve it.');
      /* It joins the triage queue as its own card, at the back, like a handback. */
      S.queueUp(it, 'back');
      emit({ type: 'review', item: it });
    }
  }

  function tick() {
    if (!state) return;
    var t = Date.now(), moved = false;
    state.items.forEach(function (it) { if (it.state === 'sending' && it.sendAt && t >= it.sendAt) { send(it); moved = true; } });
    state.items.forEach(function (it) {
      if (it.state !== 'working' || t < (it.nextAt || 0)) return;
      var sc = it.script || generic(it);
      var step = sc.steps[it.workStep || 0];
      if (step) {
        S.log(it, step[0], step[1]);
        it.workStep = (it.workStep || 0) + 1;
        it.nextAt = t + STEP_MS + Math.random() * 2500;
        moved = true;
      } else {
        finish(it, sc.ending);
        moved = true;
      }
    });
    state.items.filter(function (i) { return i.state === 'queued'; })
      .sort(function (a, b) { return a.queuedAt - b.queuedAt; })
      .forEach(function (it) {
        if (S.running() < MAX_RUNNING) { it.state = 'working'; it.nextAt = t + 4000; S.log(it, 'status', 'A slot opened up, so Fuzz started on this.'); moved = true; }
      });
    if (moved) emit({ type: 'work' });
  }

  window.Store = S;
})();
