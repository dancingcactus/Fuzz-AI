/* Series: the bigger things you're working on (docs/series.md, "Surfaces"). In the Fuzz-head menu, under Lineup.

   The list (#/series), in Lineup's column: New · Going · Gone quiet, then Fuzz is watching and Wrapped as folds.
   Each card: its name, your part and Edit; one line on what it's about (marked Fuzz's guess until you say so);
   a strip with a dot per task (past 20 tasks the done ones fold into one box holding their count in fives);
   Last and Next; Work on it. The card, its name or Edit opens the series.

   The series (#/series/<id>), shaped like the artifact viewer: a back pill, its name and a short line, Work on it
   and ⋯ for the rarer moves. Then the card opened up (about, strip, Last), Next in …, What Fuzz knows (each fact
   is a row you fix in place, or remove with Undo; the gaps are "+ Goal" chips), Tasks, Artifacts, People, How
   Fuzz spots it (with a preview before it saves), Deliverables, Decided, Also touches this.
   Split it into parts (in ⋯): name each part, pick where each task goes, one Undo. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, unsub = null, pageId = null, data = null, edit = null, pend = null, split = null;
  var anchorMode = 'in', anchorDraft = '';   /* How Fuzz spots it: the add field brings work in or keeps it out */
  var removed = null, tasksTab = 'open', peopleAll = false, filesAll = false;
  var SECTIONS = [
    ['new', 'New', 'Ones you asked Fuzz to start. Check what it gathered, here or in Triage.'],
    ['going', 'Going', ''],
    ['quiet', 'Gone quiet', 'Nothing moved for a while. New work wakes one up.']
  ];
  var FOLDS = [
    ['watching', 'Fuzz is watching', 'Work that keeps coming back together. Fuzz uses these quietly and asks you about one when it has something to suggest.'],
    ['wrapped', 'Wrapped', '']
  ];
  var ATTR = { goal: 'Goal', your_role: 'Your part', owner: 'Owner', 'for': 'For', status: 'Status', blocked_on: 'Blocked on',
    next_milestone: 'Next milestone', cadence: 'Rhythm', scope_out: 'Not part of it', done_when: 'Done when' };
  /* the gaps shown as chips, in this order; the rest wait behind "+ Something else" */
  var MAIN = ['goal', 'your_role', 'for', 'status', 'done_when', 'next_milestone'];
  /* "Not part of it" lives in How Fuzz spots it now, as Keeps work out; an old scope_out fact still shows */
  var MORE = ['owner', 'blocked_on', 'cadence'];
  /* several values, one row of chips: a series can be for, owned by and blocked on more than one */
  var MULTI = { 'for': true, owner: true, blocked_on: true };
  var picks = [], pickDraft = '';   /* the people picked in an open multi form, and what's typed but not added */
  /* One line on what each fact does. Only what Fuzz really does with it today. */
  var HELP = {
    goal: 'It becomes the line under the name on Series, so you can tell what this is at a glance.',
    your_role: 'Fuzz shapes what it suggests next to your part.',
    'for': 'Who the work serves: a customer, a team or people. Add as many as it’s for. Not the same as Owner.',
    status: 'Where it stands. Fuzz also picks this up from new messages.',
    done_when: 'Fuzz looks for this when it checks whether the series is done.',
    next_milestone: 'As the date gets close, Fuzz suggests getting ready for it.',
    owner: 'Who’s accountable for how it turns out, when that isn’t you (not who it’s for). People marks them Owner.',
    blocked_on: 'Fuzz keeps it with the series, so you can see what it’s waiting for.',
    cadence: 'Fuzz keeps it with the series, so the regular parts are written down.',
    scope_out: 'Fuzz keeps it with the series, so nearby work has a place to go.'
  };
  var PH = { goal: 'What this is trying to get done', 'for': 'A customer, team or person', status: 'Where it stands right now',
    done_when: 'A state, like “NW-342 is accepted”', next_milestone: 'The next date that matters, like “Pilot go-live, Jan 15”',
    owner: 'Who’s accountable for how it turns out', blocked_on: 'What it’s waiting for', cadence: 'Something that repeats, like “status note every Friday”',
    scope_out: 'Nearby work that belongs somewhere else' };
  var ROLE = { drive: 'Driving it', contribute: 'Helping', follow: 'Keeping up' };
  var ROLE_HELP = { drive: 'You own how it turns out.', contribute: 'Someone else owns it; you have a piece.', follow: 'You mostly need to know what happened.' };
  var BADGE = { markdown: 'MD', word: 'DOC', slides: 'PPT', pdf: 'PDF', table: 'CSV', image: 'IMG', html: 'WEB', text: 'TXT', other: 'FILE' };
  function svg(d, w, s) { return '<svg width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 2.4) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  var PLUS = svg('<path d="M12 5v14M5 12h14"/>', 2.6);
  var XSVG = svg('<path d="M6 6l12 12M18 6L6 18"/>');
  var CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6);
  /* where Work on it sits, when nothing in it is open: a quiet check, not a gap */
  var NOWORK = '<span class="pill pill--ok pill--icon sp-nowork">' + CHECK + 'No work</span>';
  var INSVG = svg('<path d="M4 12h11M11 7l5 5-5 5M20 4v16"/>');            /* brings work in: an arrow to a line */
  var OUTSVG = svg('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'); /* keeps work out: a circle struck through */
  var PEN = svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', 2.2, 15);
  var BACK = svg('<path d="M15 18l-6-6 6-6"/>');
  var DOTS = svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 2.4, 18);
  var GO = svg('<path d="M9 6l6 6-6 6"/>');
  /* A series is a clipboard with two list lines, wherever one shows */
  V.ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/></svg>';

  function first(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function initials(n) { return (n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  function said(e) { Say.tell('That didn’t work: ' + (e && e.message || e), { stay: true }); }
  /* "today", "yesterday", a weekday this week, else the date */
  function dayText(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function roleShort(s) { return ROLE[s.role] || null; }
  function guessTag(s) { return s.about_guess ? '<span class="ser-guess" title="Fuzz worked this out from its tasks. Open it to put it in your words.">Fuzz’s guess</span>' : ''; }
  var explainedKey = 'fuzz.series.explained';
  function explained() { try { return localStorage.getItem(explainedKey) === '1'; } catch (e) { return false; } }

  /* The strip: a dot per task. Past 20 tasks the done ones fold into one box holding their count in fives, then
     the leftover done dots, then the open ones; past 9 open, the rest are a number. */
  function strip(s) {
    var done = s.done || 0, open = s.open || 0, big = done + open > 20, d = done, h = '', i;
    if (big) { var fives = Math.floor(d / 5) * 5; if (fives) h += '<span class="sdot five">' + fives + '</span>'; d -= fives; }
    for (i = 0; i < d; i++) h += '<span class="sdot d"></span>';
    var shown = big ? Math.min(open, 9) : open;
    for (i = 0; i < shown; i++) h += '<span class="sdot ' + (i === 0 ? 'n' : 'o') + '"></span>';
    if (shown < open) h += '<span class="sdot-more">+' + (open - shown) + ' more</span>';
    return '<div class="sstrip" role="img" aria-label="' + done + ' tasks done, ' + open + ' to go">' + h +
      '<span class="meta">' + done + ' done · ' + open + ' to go</span></div>';
  }
  function lastNext(s, withNext) {
    var h = '';
    if (s.last) h += '<div class="sln"><b>Last</b><span>' + esc(s.last.title) + (s.last.at ? ' <span class="meta">· ' + esc(dayText(s.last.at)) + '</span>' : '') + '</span></div>';
    if (withNext && s.next) h += '<div class="sln next"><b>Next</b><span>' + esc(s.next.title) + '</span></div>';
    return h;
  }

  /* ---------- the list ---------- */
  function cardHTML(s) {
    var sec = s.section, href = '#/series/' + s.id;
    var h = '<li class="ep" data-series="' + s.id + '"><div class="ep-top"><span class="ep-t"><a class="ep-name" href="' + href + '">' + esc(s.name) + '</a>' + guessTag(s) + '</span>' +
      (sec === 'new' ? UI.pill('Check what Fuzz found', 'warn') : roleShort(s) ? UI.pill(roleShort(s), s.role === 'drive' ? 'accent' : 'muted') : '') +
      (s.muted ? UI.pill('Quiet', 'muted') : '') + ((s.season || 1) > 1 ? UI.pill('Season ' + s.season, 'muted') : '') +
      '<a class="ep-edit" href="' + href + '" aria-label="Edit ' + esc(s.name) + '">' + PEN + 'Edit</a></div>';
    if (s.about) h += '<p class="ep-about">' + esc(s.about) + '</p>';
    if (sec === 'new') return h + '<p class="meta">It’s waiting in Triage too. Approve it in either place.</p>' +
      '<div class="ep-acts"><a class="btn small linklike" href="#/triage">Check it in Triage</a></div></li>';
    if (sec === 'wrapped') return h + (s.evidence ? '<p class="meta">' + esc(s.evidence) + '</p>' : '') + '</li>';
    h += strip(s) + lastNext(s, true);
    if (sec === 'watching') return h + '<div class="ep-acts"><button type="button" class="btn small" data-keep="' + s.id + '">Keep it</button><button type="button" class="btn small" data-notseries="' + s.id + '">Not a series</button></div></li>';
    return h + '<div class="ep-acts">' + (s.open ? '<button type="button" class="btn small" data-workon="' + s.id + '">Work on it</button>' : NOWORK) + '</div></li>';
  }
  function listHTML() {
    var data0 = Store.series(), secs = data0.sections || {}, any = false, h = '';
    SECTIONS.forEach(function (x) {
      var list = secs[x[0]] || []; if (!list.length) return;
      any = true;
      h += '<section class="lsec" aria-labelledby="ser-' + x[0] + '"><h2 id="ser-' + x[0] + '">' + x[1] + ' <span class="lcount">' + list.length + '</span></h2>' +
        (x[2] ? '<p class="meta">' + x[2] + '</p>' : '') + '<ul class="lrows eps">' + list.map(cardHTML).join('') + '</ul></section>';
    });
    FOLDS.forEach(function (x) {
      var list = secs[x[0]] || []; if (!list.length) return;
      any = true;
      h += '<details class="lsec fold" id="ser-f-' + x[0] + '"' + (openFolds[x[0]] ? ' open' : '') + '><summary><h2 id="ser-' + x[0] + '">' + x[1] + ' <span class="lcount">' + list.length + '</span></h2></summary>' +
        (x[2] ? '<p class="meta">' + x[2] + '</p>' : '') + '<ul class="lrows eps">' + list.map(cardHTML).join('') + '</ul></details>';
    });
    if (!any) h = '<p class="lempty">Nothing yet. As your work comes in, Fuzz notices the bigger things it belongs to and shows them here. You can also start one from New task’s +.</p>';
    if (data0.demo) h = '<p class="meta demo-note">This is made-up demo work. With Fuzz running, your own series show here.</p>' + h;
    return h;
  }
  var openFolds = {};
  function sayHTML() {
    if (explained()) return '';
    return '<div class="ser-says">' + Fuzz.mini('good', { cls: 'ser-says-av' }) + '<p>A series is a bigger thing you’re in the middle of, like a launch, a hire or a customer pilot. ' +
      'I keep its tasks together so you can see where it stands and pick it back up. Open one to see what I know about it and fix anything I got wrong. ' +
      '<button type="button" class="linkbtn inline" data-explained>Got it</button></p></div>';
  }
  function renderList() {
    if (!root) return;
    var b = root.querySelector('#ser-board'); if (!b) return;
    b.innerHTML = listHTML();
  }

  V.mount = function (container, info) {
    root = container;
    pageId = info && info.arg && /^\d+$/.test(info.arg) ? +info.arg : null;
    edit = null; pend = null; split = null; removed = null; tasksTab = 'open'; peopleAll = false; filesAll = false; data = null;
    anchorMode = 'in'; anchorDraft = '';
    if (pageId) {
      root.innerHTML = '<section class="series-one" aria-live="off"><p class="meta">Opening…</p></section>';
      loadPage(pageId);
    } else {
      root.innerHTML = '<section class="lineup series-page" aria-labelledby="ser-h"><div class="tasks-head"><h1 id="ser-h">Series</h1>' +
        '<p class="meta">What you’re in the middle of. Fuzz picks these up from your work; you never have to set one up.</p>' +
        '<a class="btn small linklike" href="#/capture?series=start">' + PLUS + 'Start a series</a></div>' + sayHTML() + '<div class="board" id="ser-board"></div></section>';
      renderList();
    }
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    root.addEventListener('toggle', onToggle, true);
    unsub = Store.on(function () { if (pageId) loadPage(pageId); else renderList(); });
  };
  V.unmount = function () {
    if (unsub) unsub(); unsub = null;
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('submit', onSubmit); root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange); root.removeEventListener('keydown', onKey); root.removeEventListener('toggle', onToggle, true); }
    root = null; pageId = null; data = null;
  };
  V.refresh = function () { if (pageId) loadPage(pageId); else renderList(); };
  /* Elsewhere (a task's "Part of …", a Triage card): open the series' own page */
  V.open = function (id) { if (id) App.navigate('#/series/' + id); };

  function onToggle(e) { var f = e.target; if (f.classList && f.classList.contains('fold') && f.id) openFolds[f.id.replace('ser-f-', '')] = f.open; }

  /* Work on …: Focus is the series, then Triage with its tasks first */
  function workOn(id) {
    var s = Store.seriesById(id) || data || {};
    Store.seriesAction(id, 'work_on').then(function () {
      Say.tell('Focus: ' + (s.name || 'this series') + '. Its tasks come first.'); App.navigate('#/triage');
    }, said);
  }

  /* ---------- the series' page ---------- */
  function loadPage(id) {
    Store.seriesSheet(id).then(function (d) { if (pageId !== id || !root) return; data = d; paint(); },
      function (e) {
        if (!root || pageId !== id) return;
        root.innerHTML = '<section class="series-one"><div class="sp-bar"><a class="btn small sp-back" href="#/series">' + BACK + 'Series</a></div>' +
          '<p class="meta">That series wouldn’t open: ' + esc(e.message) + '</p></section>';
      });
  }
  /* A background refresh never wipes what you're typing; after your own action (force) it repaints anyway */
  function paint(force) {
    if (!root || !data) return;
    if (!force && root.contains(document.activeElement) && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    var y = window.scrollY;
    root.innerHTML = '<article class="series-one" aria-labelledby="sp-title">' + barHTML(data) + '<div class="sp-body">' + bodyHTML(data) + '</div></article>';
    window.scrollTo(0, y);
  }
  function sec(title, body, sub, cls) {
    return '<section class="sp-sec' + (cls ? ' ' + cls : '') + '"><div class="sp-sec-h"><h2>' + title + '</h2>' + (sub ? '<p class="meta">' + sub + '</p>' : '') + '</div>' + body + '</section>';
  }
  function peopleOf(d) { return (d.people || []).map(function (p) { return typeof p === 'string' ? { name: p, tasks: 0, how: '' } : p; }); }
  function metaLine(d) {
    var bits = [], ps = peopleOf(d);
    if (d.section === 'new') bits.push('Waiting for your OK');
    else if (d.section === 'watching') bits.push('Fuzz is watching');
    else if (d.section === 'wrapped') bits.push('Wrapped');
    else if (d.section === 'quiet') bits.push('Gone quiet');
    if (roleShort(d)) bits.push(roleShort(d));
    if (d.last_moved) bits.push('moved ' + dayText(d.last_moved));
    if (ps.length) bits.push('with ' + ps[0].name + (ps.length > 1 ? ' and ' + (ps.length - 1) + (ps.length === 2 ? ' other' : ' others') : ''));
    return bits.join(' · ');
  }
  function menuHTML(d) {
    var items = [];
    items.push(['rename', 'Rename', '']);
    if (d.section === 'wrapped') items.push(['reopen', 'Start season 2', 'It’s going again, with what it knew.']);
    else {
      items.push([d.muted ? 'unmute' : 'mute', d.muted ? 'Suggest next steps again' : 'Quiet the suggestions', 'It stays a series. Fuzz just stops suggesting.']);
      if (d.open + d.done > 1) items.push(['split', 'Split it into parts', 'It’s really a few things. Name each one and pick where its tasks go.']);
      items.push(null, ['wrap', 'It’s wrapped up', ''], ['check', 'Check if it’s done', 'Fuzz looks for its done-when on its next run.']);
    }
    items.push(null, ['drop', 'Not a series', 'Its tasks stay. They just aren’t grouped.'], ['ongoing', 'It’s ongoing, not a series', 'Part of your job with no finish line. Fuzz stops grouping it.']);
    return items.map(function (m) { return m ? '<button type="button" role="menuitem" data-act="' + m[0] + '"><b>' + m[1] + '</b>' + (m[2] ? '<span>' + m[2] + '</span>' : '') + '</button>' : '<hr class="menu-sep">'; }).join('');
  }
  function barHTML(d) {
    var work = d.open && d.section !== 'wrapped';
    /* Renaming takes the bar to itself: the field sits where the title was, in the title's type, with Save and
       Cancel at its height; the meta line and the actions step aside until it's done */
    if (edit === 'name') return '<div class="sp-bar sp-bar--rename"><a class="btn small sp-back" href="#/series">' + BACK + 'Series</a>' +
      '<form class="sp-rename" data-form="name" autocomplete="off" data-1p-ignore data-lpignore="true"><label class="sr" for="ss-name">Name of this series</label>' +
      '<input id="ss-name" class="fld" type="text" value="' + esc(d.name) + '" maxlength="80" autocomplete="off" data-1p-ignore data-lpignore="true">' +
      '<span class="sp-rename-acts"><button class="btn primary">Save</button><button type="button" class="btn" data-cancel>Cancel</button></span></form></div>';
    var title = '<h1 id="sp-title">' + esc(d.name) + '</h1>';
    return '<div class="sp-bar"><a class="btn small sp-back" href="#/series">' + BACK + 'Series</a><div class="sp-title">' + title + '<p class="meta">' + esc(metaLine(d)) + '</p></div>' +
      '<div class="sp-acts">' + (d.section === 'watching' ? '<button type="button" class="btn small" data-act="keep">Keep it</button>' : '') +
      (work ? '<button type="button" class="btn small primary" data-workon="' + d.id + '">Work on it</button>' : !d.open ? NOWORK : '') +
      '<button type="button" class="iconbtn small" data-more aria-haspopup="menu" aria-expanded="false" aria-controls="sp-menu" aria-label="More for ' + esc(d.name) + '" title="More">' + DOTS + '</button>' +
      '<div class="menu" role="menu" id="sp-menu" hidden aria-label="More for ' + esc(d.name) + '">' + menuHTML(d) + '</div></div></div>';
  }
  function bodyHTML(d) {
    if (edit === 'split') return splitHTML(d);
    var h = heroHTML(d);
    var sug = d.suggestions || [];
    if (sug.length) h += sec('Next in ' + esc(d.name), '<ul class="ss-next">' + sug.map(function (x) {
      return '<li><b>' + esc(x.title) + '</b><span class="meta">' + esc(x.why || '') + '</span>' + (x.card_id ? '<div class="scard-acts">' +
        '<button type="button" class="btn small primary" data-sug="add" data-card="' + x.card_id + '" data-title="' + esc(x.title) + '">Add it</button>' +
        '<button type="button" class="btn small" data-sug="mine" data-card="' + x.card_id + '" data-title="' + esc(x.title) + '">I’ll do it</button>' +
        '<button type="button" class="btn small" data-sug="not_needed" data-card="' + x.card_id + '">Not needed</button></div>' : '') + '</li>';
    }).join('') + '</ul>');
    h += knowsHTML(d) + tasksHTML(d) + filesHTML(d) + peopleHTML(d);
    h += sec('How Fuzz spots it', anchorsHTML(d), 'New work that matches what brings work in lands in ' + esc(d.name) + '; work that matches what keeps work out never does.');
    if ((d.deliverables || []).length) h += sec('Deliverables', '<ul class="ps-tasks">' + d.deliverables.map(function (x) {
      return '<li><span class="ps-main"><span class="ps-name">' + esc(x.title) + '</span><span class="ps-dw">Done when ' + esc(first(x.done_when)) + (x.due ? ' · ' + esc(String(x.due).slice(0, 10)) : '') + '</span></span><span class="ps-side">' +
        UI.pill(x.state !== 'open' ? (x.state === 'done' ? 'Done' : 'Let go') : x.tier === 'active' ? 'This week' : 'Background', x.state === 'done' ? 'ok' : x.tier === 'active' ? 'accent' : 'muted') + '</span></li>';
    }).join('') + '</ul>');
    if ((d.decided || []).length) h += sec('Decided', '<ul class="ps-tasks">' + d.decided.map(function (x) {
      return '<li><span class="ps-main"><span class="ps-name">' + esc(x.what) + '</span><span class="ps-dw">' + esc(String(x.at || '').slice(0, 10)) + (/^https?:/.test(x.link || '') ? ' · <a href="' + esc(x.link) + '" target="_blank" rel="noopener">Where it came from</a>' : '') + '</span></span></li>';
    }).join('') + '</ul>');
    if ((d.also_touches || []).length) h += sec('Also touches this', '<ul class="ps-tasks">' + d.also_touches.map(function (t) {
      return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span><span class="ps-dw">' + (t.series ? 'Part of ' + esc(t.series) : 'In no series') + '</span></span>' +
        '<span class="ps-side"><button type="button" class="btn small" data-move="' + t.id + '">Move it here</button></span></li>';
    }).join('') + '</ul>', 'Tasks filed elsewhere that touch this too. Fuzz counts them when it looks for what’s next.');
    return h;
  }
  function heroHTML(d) {
    var about = edit === 'about'
      ? '<form class="sp-edit" data-form="fact"><input type="hidden" name="attr" value="goal"><label for="sp-about">What it’s about</label>' +
        '<textarea id="sp-about" name="value" class="fld" maxlength="500" rows="2">' + esc(d.about_how === 'tasks' ? '' : d.about || '') + '</textarea>' +
        '<p class="meta">' + HELP.goal + '</p><div class="sp-edit-acts"><button class="btn small primary">Save</button><button type="button" class="btn small" data-cancel>Cancel</button></div></form>'
      : '<div class="sp-about"><p>' + esc(d.about || '') + guessTag(d) + '</p>' +
        (d.about_guess && d.about_fact_id ? '<button type="button" class="btn small" data-confirm="' + d.about_fact_id + '">Looks right</button>' : '') +
        '<button type="button" class="iconbtn small" data-edit="about" aria-label="Edit what it’s about" title="Edit">' + PEN + '</button></div>';
    var h = '<section class="sp-hero">' + about;
    if (d.section === 'new') h += '<p class="sp-note">Fuzz put this together from your note. It’s waiting in Triage too; approve it in either place. <a href="#/triage">Check it in Triage</a></p>';
    if (d.section === 'wrapped' && d.evidence) h += '<p class="sp-note">' + esc(d.evidence) + '</p>';
    if (d.section !== 'new') h += strip(d) + lastNext(d, false);
    return h + '</section>';
  }

  /* What Fuzz knows: the facts it has are rows you fix in place or remove; the gaps are chips */
  function factValue(f) { return f.attr === 'your_role' ? (ROLE[f.value] || f.value) : f.value; }
  function knowsHTML(d) {
    var knows = d.knows || [], have = knows.map(function (f) { return f.attr; });
    var adding = /^add:/.test(edit || '') ? edit.slice(4) : null;
    var multiDone = {};
    var rows = knows.map(function (f) {
      if (MULTI[f.attr]) {   /* one row for all of them: a chip each, with its own ×, and + Add someone */
        if (multiDone[f.attr]) return '';
        multiDone[f.attr] = true;
        var all = knows.filter(function (x) { return x.attr === f.attr; });
        /* no source line under the chips (a lone "you" read oddly): each chip says where it came from on hover,
           and one Fuzz found itself, not you, is dashed like Fuzz's other guesses */
        return '<li class="fact-row fact-multi"><div class="fact"><span class="fl">' + esc(ATTR[f.attr]) + '</span><span class="fv"><span class="fchips">' +
          all.map(function (x) {
            var fuzz = x.source && x.source !== 'you';
            return '<span class="fchip' + (fuzz ? ' fchip--found' : '') + '" title="' + esc((fuzz ? 'Fuzz found this: ' : 'You added this') + (fuzz ? x.source : '') + (x.trust_label && fuzz ? ' · ' + x.trust_label : '')) + '">' + esc(x.value) +
              (x.fact_id ? '<button type="button" data-wrong="' + x.fact_id + '" data-attr="' + x.attr + '" data-who="' + esc(x.value) + '" aria-label="Take ' + esc(x.value) + ' off ' + esc(ATTR[x.attr]) + '" title="Remove">' + XSVG + '</button>' : '') + '</span>';
          }).join('') + (adding === f.attr ? '' : '<button type="button" class="gchip small" data-edit="add:' + f.attr + '">' + PLUS + (f.attr === 'blocked_on' ? 'Add another' : 'Add someone') + '</button>') + '</span>' +
          '</span></div></li>' +
          (adding === f.attr ? '<li class="fact-edit fact-edit--under">' + factForm(d, f.attr, '', true) + '</li>' : '');   /* adding to this row: right under it */
      }
      if (edit === 'fact:' + f.attr) return '<li class="fact-edit">' + factForm(d, f.attr, f.value) + '</li>';
      return '<li class="fact-row"><button type="button" class="fact" data-edit="fact:' + f.attr + '" aria-label="Edit ' + esc(ATTR[f.attr] || f.attr) + '">' +
        '<span class="fl">' + esc(ATTR[f.attr] || f.attr) + '</span><span class="fv"><span class="v">' + esc(factValue(f)) + '</span>' +
        '<span class="s">' + esc(f.source) + (f.trust_label ? ' · ' + esc(f.trust_label) : '') + '</span></span><span class="fpen">' + PEN + '</span></button>' +
        (f.fact_id ? '<button type="button" class="frm" data-wrong="' + f.fact_id + '" data-attr="' + f.attr + '" aria-label="Remove ' + esc(ATTR[f.attr] || f.attr) + '" title="Remove">' + XSVG + '</button>' : '') + '</li>';
    });
    /* a fact it doesn't have yet has no row: its form goes at the end (one it has opens under its own row, above) */
    if (adding && have.indexOf(adding) < 0) rows.push('<li class="fact-edit">' + factForm(d, adding, '') + '</li>');
    var gaps = MAIN.filter(function (a) { return have.indexOf(a) < 0 && a !== adding; });
    var extras = MORE.filter(function (a) { return have.indexOf(a) < 0 && a !== adding; });
    var h = rows.length ? '<ul class="lrows sp-facts">' + rows.join('') + '</ul>' : '<p class="meta">Fuzz fills these in on its own as it reads your email, Slack and meetings. If you already know something, add it now.</p>';
    if (removed && removed.id === d.id) h += '<div class="sp-undo" role="status"><span>Removed “' + esc(removed.label) + '”. Fuzz won’t bring it back unless something new says it.</span>' +
      (removed.undo ? '<button type="button" class="btn small" data-factundo>Undo</button>' : '') + '</div>';
    if (gaps.length || extras.length) h += '<div class="sp-gaps"><span class="sp-gaps-l">' + (gaps.length ? 'Fuzz doesn’t know yet' : 'Add more') + '</span>' +
      gaps.map(function (a) { return '<button type="button" class="gchip" data-edit="add:' + a + '">' + PLUS + esc(ATTR[a]) + '</button>'; }).join('') +
      (extras.length ? '<span class="gmore"><button type="button" class="gchip" data-gmore aria-haspopup="menu" aria-expanded="false" aria-controls="sp-gmenu">' + PLUS + 'Something else</button>' +
        '<div class="menu" role="menu" id="sp-gmenu" hidden>' + extras.map(function (a) { return '<button type="button" role="menuitem" data-edit="add:' + a + '"><b>' + esc(ATTR[a]) + '</b><span>' + HELP[a] + '</span></button>'; }).join('') + '</div></span>' : '') + '</div>';
    return sec('What Fuzz knows', h, knows.length ? 'Click a line to fix it. Each one says where it came from.' : '');
  }
  /* Fuzz's ideas for a fact, from what the series already has: its people, its deliverables */
  function ideas(d, attr) {
    if (attr === 'for' || attr === 'owner' || attr === 'blocked_on') {
      var taken = (d.knows || []).filter(function (f) { return f.attr === attr; }).map(function (f) { return String(f.value).toLowerCase(); });
      return peopleOf(d).map(function (p) { return p.name; }).filter(function (n) { return taken.indexOf(n.toLowerCase()) < 0; }).slice(0, 6);
    }
    if (attr === 'done_when') return (d.deliverables || []).filter(function (x) { return x.done_when && x.state === 'open'; }).map(function (x) { return x.done_when; }).slice(0, 3);
    if (attr === 'next_milestone') return (d.deliverables || []).filter(function (x) { return x.due && x.state === 'open'; }).map(function (x) { return x.title + ', ' + new Date(x.due).toLocaleDateString([], { month: 'short', day: 'numeric' }); }).slice(0, 3);
    return [];
  }
  /* For, Owner, Blocked on: pick several at once. Click people in it to pick them (again to unpick), or type a
     name and press Enter; each becomes a chip. Save adds them all, one Undo. Add is the form's first button, so
     Enter adds what's typed instead of saving. */
  function multiForm(d, attr, under) {
    var ids = ideas(d, attr), low = picks.map(function (p) { return p.toLowerCase(); });
    var extra = picks.filter(function (p) { return ids.map(function (x) { return x.toLowerCase(); }).indexOf(p.toLowerCase()) < 0; });
    var n = picks.length + (pickDraft.trim() ? 1 : 0);
    return '<form class="sp-edit sp-multi" data-form="fact" autocomplete="off" data-1p-ignore><input type="hidden" name="attr" value="' + attr + '">' +
      /* under its own row the row already says what it is: the label keeps the name for screen readers only */
      '<label class="sp-edit-l" for="sp-val">' + (under ? '<span class="sr">Add to ' + esc(ATTR[attr]) + ': </span>' : esc(ATTR[attr]) + ' ') +
      '<span class="meta">Add as many as you like</span></label>' +
      (extra.length ? '<div class="fchips">' + extra.map(function (p) {
        return '<span class="fchip">' + esc(p) + '<button type="button" data-pick-rm="' + esc(p) + '" aria-label="Unpick ' + esc(p) + '">' + XSVG + '</button></span>'; }).join('') + '</div>' : '') +
      /* the people in it first, to pick with a click; the field under them is for anyone else */
      (ids.length ? '<div class="sp-ideas" role="group" aria-label="People in it"><span class="meta">People in it:</span>' + ids.map(function (x) {
        var on = low.indexOf(x.toLowerCase()) >= 0;
        return '<button type="button" class="gchip solid pick' + (on ? ' on' : '') + '" data-pick="' + esc(x) + '" aria-pressed="' + on + '">' + (on ? CHECK : PLUS) + esc(x) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="ss-inline"><input id="sp-val" name="value" class="fld" type="text" maxlength="200" autocomplete="off" data-1p-ignore value="' + esc(pickDraft) + '" placeholder="' +
      esc(ids.length ? 'Or type someone else, then Enter' : (PH[attr] || 'A name') + ', then Enter') + '">' +
      '<button class="btn small" data-addpick>Add</button></div>' +
      '<p class="meta">' + HELP[attr] + '</p><div class="sp-edit-acts"><button class="btn small primary" data-savepicks' + (n ? '' : ' disabled') + '>' +
      (n > 1 ? 'Add these ' + n : 'Save') + '</button><button type="button" class="btn small" data-cancel>Cancel</button></div></form>';
  }
  function factForm(d, attr, value, under) {
    if (MULTI[attr]) return multiForm(d, attr, under);
    var h = '<form class="sp-edit" data-form="fact"><input type="hidden" name="attr" value="' + attr + '">';
    if (attr === 'your_role') {
      return h + '<span class="sp-edit-l" id="sp-role-l">' + ATTR.your_role + '</span><div class="choices" role="group" aria-labelledby="sp-role-l">' +
        Object.keys(ROLE).map(function (r) { return '<button type="button" class="choice' + (r === value ? ' on' : '') + '" data-role="' + r + '" aria-pressed="' + (r === value) + '"><b>' + ROLE[r] + '</b><span>' + ROLE_HELP[r] + '</span></button>'; }).join('') +
        '</div><p class="meta">' + HELP.your_role + '</p><div class="sp-edit-acts"><button type="button" class="btn small" data-cancel>Cancel</button></div></form>';
    }
    var id = 'sp-val', ids = ideas(d, attr);
    h += '<label class="sp-edit-l" for="' + id + '">' + esc(ATTR[attr] || attr) + '</label><input id="' + id + '" name="value" class="fld" type="text" value="' + esc(value || '') + '" maxlength="500" autocomplete="off" placeholder="' + esc(PH[attr] || '') + '">';
    if (ids.length) h += '<div class="sp-ideas"><span class="meta">' + (attr === 'for' || attr === 'owner' || attr === 'blocked_on' ? 'People in it:' : 'From its deliverables:') + '</span>' +
      ids.map(function (x) { return '<button type="button" class="gchip solid" data-fill="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>';
    return h + '<p class="meta">' + HELP[attr] + '</p><div class="sp-edit-acts"><button class="btn small primary">Save</button><button type="button" class="btn small" data-cancel>Cancel</button></div></form>';
  }

  function tasksHTML(d) {
    var open = d.open_tasks || [], done = d.done_tasks || [];
    var seg = '<div class="segrow sp-seg" role="group" aria-label="Show"><button type="button" class="seg" data-tab="open" aria-pressed="' + (tasksTab === 'open') + '">Open ' + (d.open || open.length) + '</button>' +
      '<button type="button" class="seg" data-tab="done" aria-pressed="' + (tasksTab === 'done') + '">Done ' + (d.done || done.length) + '</button></div>';
    var h = '';
    if (tasksTab === 'open') {
      if (d.section !== 'wrapped') h += '<form class="ss-inline" data-form="task"><label class="sr" for="ss-task">Add a task to ' + esc(d.name) + '</label><input id="ss-task" class="fld" type="text" autocomplete="off" placeholder="Add a task to ' + esc(d.name) + '"><button class="btn small">Add</button></form>';
      h += open.length ? '<ul class="ps-tasks">' + open.map(function (t) { return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span></span><span class="ps-side">' + UI.pill.apply(null, UI.status(t.state)[0] ? UI.status(t.state) : [t.state, 'muted']) + '</span></li>'; }).join('') + '</ul>'
        : '<p class="meta">Nothing open.</p>';
    } else {
      h += done.length ? '<ul class="ps-tasks">' + done.map(function (t) { return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span>' + (t.summary ? '<span class="ps-dw">' + esc(t.summary) + '</span>' : '') + '</span><span class="ps-side">' + UI.pill(t.state === 'letgo' ? 'Let go' : 'Done', t.state === 'letgo' ? 'muted' : 'ok') + '</span></li>'; }).join('') + '</ul>' +
        ((d.done || 0) > done.length ? '<p class="meta">and ' + ((d.done || 0) - done.length) + ' more</p>' : '')
        : '<p class="meta">Nothing done yet.</p>';
    }
    return '<section class="sp-sec"><div class="sp-sec-h"><h2>Tasks</h2>' + seg + '</div>' + h + '</section>';
  }
  function filesHTML(d) {
    var fs = d.artifacts || [];
    if (!fs.length) return sec('Artifacts', '<p class="meta">Nothing yet. When Fuzz writes a document, a deck or a checklist for one of these tasks, it shows up here.</p>');
    var shown = filesAll ? fs : fs.slice(0, 4);
    return sec('Artifacts <span class="lcount">' + fs.length + '</span>', '<ul class="lrows">' + shown.map(function (a) {
      var url = a.url || 'artifact.html?id=' + a.source_id;
      return '<li><a class="lrow arow" href="' + esc(url) + '"><span class="afile afile--' + esc(a.kind) + '" aria-hidden="true">' + (BADGE[a.kind] || 'FILE') + '</span>' +
        '<span class="lrow-main"><span class="rt">' + esc(a.name) + '</span><span class="rs">For ' + esc((a.task && a.task.title) || 'a task') + (a.updated_at ? ' · ' + esc(dayText(a.updated_at)) : '') + '</span></span>' +
        '<span class="arow-go">' + GO + '</span></a></li>';
    }).join('') + '</ul>' + (fs.length > 4 ? '<button type="button" class="linkbtn inline" data-files>' + (filesAll ? 'Show fewer' : 'Show all ' + fs.length) + '</button>' : ''),
      'What Fuzz wrote for its tasks, newest first.');
  }
  function peopleHTML(d) {
    var ps = peopleOf(d); if (!ps.length) return '';
    var many = ps.length > 5, shown = many && !peopleAll ? ps.slice(0, 4) : ps;
    var h = (many && peopleAll ? '<label class="sr" for="sp-pq">Find someone</label><input id="sp-pq" class="fld sp-find" type="text" autocomplete="off" placeholder="Find someone">' : '') +
      '<ul class="lrows" id="sp-people">' + shown.map(function (p) {
        return '<li data-name="' + esc((p.name + ' ' + (p.how || '')).toLowerCase()) + '"><div class="lrow sp-person"><span class="sp-av" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
          '<span class="lrow-main"><span class="rt">' + esc(p.name) + '</span>' + (p.how ? '<span class="rs">' + esc(p.how) + '</span>' : '') + '</span>' +
          (p.tasks ? '<span class="lrow-side"><span class="lrow-sub">in ' + p.tasks + (p.tasks === 1 ? ' task' : ' tasks') + '</span></span>' : '') + '</div></li>';
      }).join('') + '</ul>' + (many ? '<button type="button" class="linkbtn inline" data-people>' + (peopleAll ? 'Show fewer' : 'Show all ' + ps.length + ' people') + '</button>' : '');
    return sec('People <span class="lcount">' + ps.length + '</span>', h, ps.length > 1 ? 'The ones in the most of its tasks first.' : '');
  }

  /* ---------- Split it into parts ---------- */
  function splitTasks(d) { return (d.open_tasks || []).concat(d.done_tasks || []); }
  function partLabel(i) { return (split.names[i] || '').trim() || 'Part ' + (i + 1); }
  function splitHTML(d) {
    var tasks = splitTasks(d);
    var opts = function (tid) {
      var v = split.pick[tid] == null ? -1 : split.pick[tid];
      return '<option value="-1"' + (v === -1 ? ' selected' : '') + '>Stays in ' + esc(d.name) + '</option>' + split.names.map(function (_, i) {
        return '<option value="' + i + '"' + (v === i ? ' selected' : '') + '>' + esc(partLabel(i)) + '</option>';
      }).join('');
    };
    return '<section class="sp-sec ss-splitter" aria-labelledby="ss-split-h"><div class="sp-sec-h"><h2 id="ss-split-h">Split ' + esc(d.name) + ' into parts</h2></div>' +
      '<p class="meta">Name each part, then pick where each task goes. A task whose title says a part’s name goes there by itself. Each part becomes its own series, and a short name becomes a way Fuzz spots it.</p>' +
      '<div class="ss-parts">' + split.names.map(function (n, i) {
        return '<div class="ss-part"><label for="ss-part-' + i + '">Part ' + (i + 1) + '</label><input id="ss-part-' + i + '" class="fld" type="text" maxlength="80" autocomplete="off" data-part="' + i + '" value="' + esc(n) + '" placeholder="A short name, like a customer">' +
          (split.names.length > 2 ? '<button type="button" class="iconbtn small" data-part-rm="' + i + '" aria-label="Remove part ' + (i + 1) + '" title="Remove">' + XSVG + '</button>' : '') + '</div>';
      }).join('') + (split.names.length < 8 ? '<button type="button" class="btn small linklike" data-part-add>' + PLUS + 'Add a part</button>' : '') + '</div>' +
      '<ul class="ps-tasks ss-split-tasks">' + tasks.map(function (t) {
        return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span>' + (t.state === 'done' || t.state === 'letgo' ? '<span class="ps-dw">Done</span>' : '') + '</span>' +
          '<span class="ps-side"><label class="sr" for="ss-pick-' + t.id + '">Where “' + esc(t.title) + '” goes</label><select id="ss-pick-' + t.id + '" class="fld" data-pick="' + t.id + '">' + opts(t.id) + '</select></span></li>';
      }).join('') + '</ul>' +
      '<p class="meta" id="ss-split-sum" aria-live="polite">' + splitSummary(d) + '</p>' +
      '<div class="sp-edit-acts"><button type="button" class="btn primary" data-split-ok>Split it</button><button type="button" class="btn" data-cancel>Cancel</button></div></section>';
  }
  function splitSummary(d) {
    var tasks = splitTasks(d), stay = tasks.filter(function (t) { return split.pick[t.id] == null || split.pick[t.id] < 0; }).length;
    var counts = split.names.map(function (_, i) { return tasks.filter(function (t) { return split.pick[t.id] === i; }).length; });
    var parts = counts.map(function (c, i) { return c ? esc(partLabel(i)) + ' gets ' + c : ''; }).filter(Boolean);
    return (parts.length ? parts.join(' · ') + '. ' : 'No tasks picked yet. ') +
      (stay ? (stay === 1 ? 'One task stays' : stay + ' tasks stay') + ' in ' + esc(d.name) + '.' : 'Nothing stays, so ' + esc(d.name) + ' goes away.');
  }
  /* A task whose title says a part's name goes to that part, unless you picked for it yourself */
  function autoPick(d) {
    splitTasks(d).forEach(function (t) {
      if (split.mine[t.id]) return;
      var title = t.title.toLowerCase(), hit = -1;
      split.names.forEach(function (n, i) { var w = n.trim().toLowerCase(); if (hit < 0 && w.length > 1 && title.indexOf(w) >= 0) hit = i; });
      if (hit >= 0) split.pick[t.id] = hit; else delete split.pick[t.id];
    });
  }
  /* While you type a part's name, only the pickers and the summary change: the field keeps its focus */
  function refreshSplit() {
    var d = data; if (!root || !d || !split) return;
    autoPick(d);
    root.querySelectorAll('select[data-pick]').forEach(function (sel) {
      var tid = +sel.dataset.pick;
      split.names.forEach(function (_, i) { var o = sel.querySelector('option[value="' + i + '"]'); if (o) o.textContent = partLabel(i); });
      sel.value = String(split.pick[tid] == null ? -1 : split.pick[tid]);
    });
    var sum = root.querySelector('#ss-split-sum'); if (sum) sum.innerHTML = splitSummary(d);
  }
  function doSplit() {
    var d = data, tasks = splitTasks(d), parts = [], problem = null;
    split.names.forEach(function (n, i) {
      var ids = tasks.filter(function (t) { return split.pick[t.id] === i; }).map(function (t) { return t.id; });
      if (!n.trim() && ids.length) problem = problem || 'Name part ' + (i + 1) + ' first.';
      else if (n.trim() && !ids.length) problem = problem || 'Pick at least one task for ' + n.trim() + '.';
      else if (n.trim()) parts.push({ name: n.trim(), task_ids: ids });
    });
    if (!problem && !parts.length) problem = 'Name a part and pick its tasks.';
    if (problem) { Say.tell(problem); return; }
    var names = parts.map(function (p) { return p.name; }).join(', ');
    Store.seriesAction(d.id, 'split', { parts: parts }, 'Split ' + d.name).then(function (r) {
      split = null; edit = null;
      if (r && r.state === 'dropped' && (r.split_into || []).length) {
        Say.tell('Split into ' + parts.length + ': ' + names + '. Undo puts it back together.');
        App.navigate('#/series/' + r.split_into[0]);
      } else {
        if (r && r.id === d.id) { data = r; paint(true); }
        Say.tell('Split out ' + names + '. The rest stays in ' + d.name + '. Undo puts it back together.');
      }
    }, said);
  }

  /* How Fuzz spots it: remove (after a preview of what would stop matching), put back, add (after a preview) */
  function anchorsHTML(d) {
    var ins = (d.anchors || []).length || (d.removed_anchors || []).length, outs = d.excluded_anchors || [];
    var h = '<h3 class="sp-sub">' + INSVG + 'Brings work in</h3>' + (ins ? inListHTML(d) : '<p class="meta">Nothing yet: it’s only the tasks you put in it.</p>');
    h += '<h3 class="sp-sub">' + OUTSVG + 'Keeps work out</h3>';
    h += outs.length ? '<ul class="ss-anchors">' + outs.map(function (a) {
      return '<li class="out"><span class="ps-main"><span class="ps-name">' + esc(a.label) + '</span><span class="ps-dw">' +
        (a.tasks ? a.tasks + (a.tasks === 1 ? ' task already in it says this. It stays.' : ' tasks already in it say this. They stay.') : 'New work that says this won’t join.') + '</span></span>' +
        '<span class="ps-side"><button type="button" class="iconbtn small" data-unexclude="' + esc(a.key) + '" aria-label="Stop keeping out ' + esc(a.label) + '" title="Stop keeping it out">' + XSVG + '</button></span></li>';
    }).join('') + '</ul>' : '<p class="meta">Nothing yet. Add words, a ticket or a #channel whose work belongs somewhere else.</p>';
    var out = anchorMode === 'out', typed = pend && pend.add || anchorDraft;
    h += '<div class="sp-anchor-add"><div class="segrow" role="group" aria-label="What it does">' +
      '<button type="button" class="seg" data-amode="in" aria-pressed="' + !out + '">' + INSVG + 'Bring in</button>' +
      '<button type="button" class="seg" data-amode="out" aria-pressed="' + out + '">' + OUTSVG + 'Keep out</button></div>' +
      '<form class="ss-inline" data-form="anchor"><label class="sr" for="ss-anchor">' + (out ? 'Keep work out that says' : 'Add a way to spot it') + '</label>' +
      '<input id="ss-anchor" class="fld" type="text" autocomplete="off" data-1p-ignore placeholder="A ticket key (NW-342), a #channel or words" value="' + esc(typed) + '">' +
      '<button class="btn small' + (pend && pend.add && pend.preview ? ' primary' : '') + '">' + (pend && pend.add && pend.preview ? (out ? 'Keep it out' : 'Add it') : 'Check it') + '</button>' +
      (pend && pend.add ? '<button type="button" class="btn small" data-cancel>Cancel</button>' : '') + '</form></div>';
    if (pend && pend.add) h += previewHTML(pend.preview, out ? 'exclude' : 'add');
    else h += '<p class="meta">Before it saves, Fuzz shows what it would have ' + (out ? 'kept out.' : 'caught.') + '</p>';
    return h;
  }
  function inListHTML(d) {
    return '<ul class="ss-anchors">' + (d.anchors || []).map(function (a) {
      var asking = pend && pend.remove === a.key;
      return '<li><span class="ps-main"><span class="ps-name">' + esc(a.label) + '</span><span class="ps-dw">' + (a.tasks ? 'Caught ' + a.tasks + ' · ' : '') + (a.yours ? 'You added it' : 'Fuzz found it') + '</span>' +
        (asking ? previewHTML(pend.preview, 'remove') : '') + '</span>' +
        '<span class="ps-side">' + (asking ? '' : '<button type="button" class="iconbtn small" data-anchor-rm="' + esc(a.key) + '" aria-label="Remove ' + esc(a.label) + '" title="Remove">' + XSVG + '</button>') + '</span></li>';
    }).join('') + (d.removed_anchors || []).map(function (a) {
      return '<li class="removed"><span class="ps-main"><span class="ps-name">' + esc(a.label) + '</span><span class="ps-dw">Removed. Fuzz stops using it, and won’t suggest it again.</span></span>' +
        '<span class="ps-side"><button type="button" class="btn small" data-anchor-back="' + esc(a.key) + '">Put it back</button></span></li>';
    }).join('') + '</ul>';
  }
  function previewHTML(p, how) {
    if (!p) return '<p class="meta">Checking…</p>';
    if (how === 'exclude') {
      var ko = p.would_keep_out || [], ai = p.already_in || [];
      return '<div class="ss-preview"><p class="meta">' + (ko.length ? 'This would keep out:' : 'Nothing waiting would be kept out by this.') + '</p>' +
        (ko.length ? '<ul>' + ko.slice(0, 6).map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('') + '</ul>' : '') +
        (ai.length ? '<p class="meta">Already in it, and staying (move them from Tasks if they belong elsewhere):</p><ul>' + ai.slice(0, 6).map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    }
    var list = how === 'add' ? p.would_join : p.would_stop_matching;
    var head = how === 'add' ? (list.length ? 'This would bring in:' : 'This wouldn’t bring in any tasks you have now.')
      : (list.length ? 'Without it, these would stop matching:' : 'Removing it wouldn’t change which tasks are in it now.');
    return '<div class="ss-preview"><p class="meta">' + head + '</p>' + (list.length ? '<ul>' + list.slice(0, 6).map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('') + '</ul>' : '') +
      (how === 'remove' ? '<div class="scard-acts"><button type="button" class="btn small primary" data-anchor-ok>Remove it</button><button type="button" class="btn small" data-cancel>Keep it</button></div>' : '') + '</div>';
  }

  /* ---------- doing things ---------- */
  /* undoLabel: the change as the header's Undo list names it */
  function act(what, body, msg, undoLabel) {
    var id = pageId;
    return Store.seriesAction(id, what, body, undoLabel).then(function (d) {
      if (d && d.id === id) { data = d; edit = null; pend = null; paint(true); }
      if (msg) Say.tell(msg);
      return d;
    }, said);
  }
  function closeMenus(keep) {
    if (!root) return false;
    var any = false;
    root.querySelectorAll('.menu:not([hidden])').forEach(function (m) {
      if (m === keep) return;
      m.hidden = true; any = true;
      var b = root.querySelector('[aria-controls="' + m.id + '"]'); if (b) b.setAttribute('aria-expanded', 'false');
    });
    return any;
  }
  function toggleMenu(btn, id) {
    var m = root.querySelector('#' + id); if (!m) return;
    closeMenus(m);
    m.hidden = !m.hidden; btn.setAttribute('aria-expanded', String(!m.hidden));
    if (!m.hidden) { var f0 = m.querySelector('button'); if (f0) f0.focus(); }
  }
  function keepDraft() { var f = root && root.querySelector('.sp-multi #sp-val'); if (f) pickDraft = f.value; }
  function focusIn(sel) { var f = root && root.querySelector(sel); if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); } }
  function onKey(e) {
    if (e.key !== 'Escape' || !pageId) return;
    if (closeMenus()) { e.preventDefault(); e.stopPropagation(); return; }
    if (edit && edit !== 'split') { e.preventDefault(); e.stopPropagation(); edit = null; pend = null; paint(true); }
  }

  function onClick(e) {
    if (e.target.closest('[data-explained]')) { try { localStorage.setItem(explainedKey, '1'); } catch (x) { /* fine */ } var sy = root.querySelector('.ser-says'); if (sy) sy.remove(); return; }
    var w = e.target.closest('[data-workon]'); if (w) { workOn(+w.dataset.workon); return; }
    if (!pageId) return onListClick(e);
    var d = data; if (!d) return;
    var mb = e.target.closest('[data-more]'); if (mb) { toggleMenu(mb, 'sp-menu'); return; }
    var gm = e.target.closest('[data-gmore]'); if (gm) { toggleMenu(gm, 'sp-gmenu'); return; }
    if (!e.target.closest('.menu')) closeMenus();
    if (split) {
      if (e.target.closest('[data-part-add]')) { split.names.push(''); paint(true); focusIn('#ss-part-' + (split.names.length - 1)); return; }
      var pr = e.target.closest('[data-part-rm]');
      if (pr) {
        var i = +pr.dataset.partRm; split.names.splice(i, 1);
        Object.keys(split.pick).forEach(function (t) { var v = split.pick[t]; if (v === i) { delete split.pick[t]; delete split.mine[t]; } else if (v > i) split.pick[t] = v - 1; });
        autoPick(d); paint(true); return;
      }
      if (e.target.closest('[data-split-ok]')) { doSplit(); return; }
    }
    if (e.target.closest('[data-cancel]')) { edit = null; pend = null; split = null; paint(true); return; }
    var ed = e.target.closest('[data-edit]');
    if (ed) { closeMenus(); edit = ed.dataset.edit === 'about' ? 'about' : ed.dataset.edit; picks = []; pickDraft = ''; paint(true); focusIn(edit === 'about' ? '#sp-about' : '#sp-val'); return; }
    var pk = e.target.closest('[data-pick]');
    if (pk) {   /* a person in it: pick or unpick; what's typed stays */
      keepDraft();
      var name = pk.dataset.pick, at = picks.map(function (p) { return p.toLowerCase(); }).indexOf(name.toLowerCase());
      if (at >= 0) picks.splice(at, 1); else picks.push(name);
      paint(true); focusIn('#sp-val'); return;
    }
    var pr = e.target.closest('[data-pick-rm]');
    if (pr) { keepDraft(); picks = picks.filter(function (p) { return p !== pr.dataset.pickRm; }); paint(true); focusIn('#sp-val'); return; }
    var fi = e.target.closest('[data-fill]'); if (fi) { var inp = root.querySelector('#sp-val'); if (inp) { inp.value = fi.dataset.fill; inp.focus(); } return; }
    var rl = e.target.closest('[data-role]'); if (rl) { act('role', { role: rl.dataset.role }, 'Saved. Fuzz shapes what it suggests to your part.', 'Your part in ' + d.name); return; }
    var cf = e.target.closest('[data-confirm]'); if (cf) { act('facts', { fact_id: +cf.dataset.confirm, confirm: true }, 'Thanks. That’s what it’s about now.', 'Confirmed what ' + d.name + ' is about'); return; }
    var wr = e.target.closest('[data-wrong]');
    if (wr) {
      var label = (ATTR[wr.dataset.attr] || wr.dataset.attr) + (wr.dataset.who ? ': ' + wr.dataset.who : ''), id = d.id;
      act('facts', { fact_id: +wr.dataset.wrong }, null, 'Removed ' + label + ' from ' + d.name).then(function (r) {
        if (!r) return;
        removed = { id: id, label: label, undo: Say.lastUndo() }; paint(true);
      });
      return;
    }
    if (e.target.closest('[data-factundo]') && removed) {
      var u = removed.undo; removed = null; paint(true);
      if (u && Say.undoList().indexOf(u) > -1) u.run(); else Say.tell('That can’t be undone from here any more. The header’s Undo has what can.');
      return;
    }
    var tb = e.target.closest('[data-tab]'); if (tb) { tasksTab = tb.dataset.tab; paint(true); return; }
    if (e.target.closest('[data-people]')) { peopleAll = !peopleAll; paint(true); if (peopleAll) focusIn('#sp-pq'); return; }
    if (e.target.closest('[data-files]')) { filesAll = !filesAll; paint(true); return; }
    var sg = e.target.closest('[data-sug]');
    if (sg) {
      var opt = sg.dataset.sug;
      Store.answerSeriesCard(+sg.dataset.card, opt, opt === 'not_needed' ? undefined : { title: sg.dataset.title }).then(function () {
        Say.tell(opt === 'add' ? 'Added to Triage, part of ' + d.name + '.' : opt === 'mine' ? 'Okay, it’s a task for you.' : 'Okay. Fuzz won’t suggest that again.');
        loadPage(d.id);
      }, said);
      return;
    }
    var rm = e.target.closest('[data-anchor-rm]');
    if (rm) {
      pend = { remove: rm.dataset.anchorRm, preview: null }; paint(true);
      Store.seriesPreview(d.id, { remove: [pend.remove] }).then(function (p) { if (pend && pend.remove) { pend.preview = p; paint(true); } });
      return;
    }
    if (e.target.closest('[data-anchor-ok]') && pend && pend.remove) { act('anchors', { remove: [pend.remove] }, 'Removed. Undo puts it back.', 'Removed a way Fuzz spots ' + d.name); return; }
    var am = e.target.closest('[data-amode]');
    if (am) {   /* Bring in / Keep out: what you typed stays, the preview starts over */
      var fld = root.querySelector('#ss-anchor'); anchorDraft = fld ? fld.value : anchorDraft;
      anchorMode = am.dataset.amode; pend = null; paint(true);
      var f2 = root.querySelector('#ss-anchor'); if (f2) f2.focus();
      return;
    }
    var ux = e.target.closest('[data-unexclude]');
    if (ux) { act('anchors', { unexclude: [ux.dataset.unexclude] }, 'Taken off. Work like this can join again.', 'Stopped keeping work out of ' + d.name); return; }
    var back = e.target.closest('[data-anchor-back]'); if (back) { act('anchors', { restore: [back.dataset.anchorBack] }, 'It’s back.', 'Put back a way Fuzz spots ' + d.name); return; }
    var mv = e.target.closest('[data-move]');
    if (mv) { Live.on() ? act('add_task', { task_id: +mv.dataset.move }, 'Moved here.', 'Moved a task into ' + d.name) : said('Moving tasks needs Fuzz running.'); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var what = a.dataset.act; closeMenus();
    if (what === 'split') { edit = 'split'; split = { names: ['', ''], pick: {}, mine: {} }; paint(true); focusIn('#ss-part-0'); return; }
    if (what === 'rename') { edit = 'name'; paint(true); var n = root.querySelector('#ss-name'); if (n) { n.focus(); n.select(); } return; }
    if (what === 'keep') { act('keep', {}, 'Kept. Fuzz asks your part in Triage.', 'Kept ' + d.name); return; }
    if (what === 'mute' || what === 'unmute') { act(what, {}, what === 'mute' ? 'Quiet. No more suggestions for it.' : 'Fuzz will suggest next steps again.', (what === 'mute' ? 'Quieted ' : 'Suggestions back for ') + d.name); return; }
    if (what === 'wrap') { act('wrap', {}, 'Wrapped. Undo if that was early.', 'Wrapped ' + d.name); return; }
    if (what === 'reopen') { act('reopen', {}, 'Season 2. It’s going again.', 'Season 2 of ' + d.name); return; }
    if (what === 'check') { act('check', {}, 'Fuzz checks its done-when on its next run.'); return; }
    if (what === 'drop' || what === 'ongoing') {
      Store.seriesAction(d.id, 'drop', what === 'ongoing' ? { why: 'ongoing' } : {}, (what === 'ongoing' ? 'Ongoing: ' : 'Not a series: ') + d.name).then(function () {
        Say.tell(what === 'ongoing' ? 'Got it: ongoing. Fuzz stops grouping it. Undo is in the header.' : 'Not a series. Its tasks stay where they are. Undo is in the header.');
        App.navigate('#/series');
      }, said);
    }
  }
  /* The list: the card opens the series; its own buttons and links do their own thing */
  function onListClick(e) {
    var k = e.target.closest('[data-keep]');
    if (k) { Store.seriesAction(+k.dataset.keep, 'keep', {}, 'Kept a series').then(function () { Say.tell('Kept. Fuzz asks your part in Triage.'); }, said); return; }
    var n = e.target.closest('[data-notseries]');
    if (n) { Store.seriesAction(+n.dataset.notseries, 'drop', {}, 'Not a series').then(function () { Say.tell('Not a series. Fuzz won’t group these again unless more turns up.'); }, said); return; }
    if (e.target.closest('a, button, summary, input')) return;
    if (window.getSelection && String(window.getSelection())) return;   /* selecting text isn't a click */
    var card = e.target.closest('.ep[data-series]'); if (card) App.navigate('#/series/' + card.dataset.series);
  }
  function onSubmit(e) {
    var f = e.target.closest('[data-form]'); if (!f || !data) return;
    e.preventDefault();
    var kind = f.dataset.form, d = data;
    if (kind === 'name') { var v = f.querySelector('#ss-name').value.trim(); if (v) act('name', { name: v }, 'Renamed.', 'Renamed ' + d.name); return; }
    if (kind === 'fact' && MULTI[f.querySelector('[name="attr"]').value]) {
      var mattr = f.querySelector('[name="attr"]').value, mfld = f.querySelector('#sp-val'), typed = (mfld.value || '').trim();
      var addIt = function (v) { if (v && picks.map(function (p) { return p.toLowerCase(); }).indexOf(v.toLowerCase()) < 0) picks.push(v); };
      if (!e.submitter || e.submitter.hasAttribute('data-addpick')) {   /* Enter or Add: what's typed becomes a chip */
        addIt(typed); pickDraft = ''; paint(true); focusIn('#sp-val'); return;
      }
      addIt(typed);
      if (!picks.length) { mfld.focus(); return; }
      var all = picks.slice(), label = ATTR[mattr];
      act('facts', { attr: mattr, values: all }, all.length > 1 ? 'Added ' + all.length + ' to ' + label + '.' : 'Added ' + all[0] + ' to ' + label + '.',
        label + ' for ' + d.name).then(function (r) { if (r) { picks = []; pickDraft = ''; } });
      return;
    }
    if (kind === 'fact') {
      var attr = f.querySelector('[name="attr"]').value, fld = f.querySelector('[name="value"]'), val = fld ? (fld.value || '').trim() : '';
      if (!val) { if (fld) fld.focus(); return; }
      act('facts', { attr: attr, value: val }, MULTI[attr] ? 'Added ' + val + ' to ' + ATTR[attr] + '.' : 'Saved. Fuzz takes your word over anything else.', (ATTR[attr] || 'A fact') + ' for ' + d.name);
      return;
    }
    if (kind === 'task') {
      var t = f.querySelector('#ss-task').value.trim(); if (!t) return;
      act('add_task', { text: t }, 'Added to Triage, part of ' + d.name + '.', 'Added a task to ' + d.name);
      return;
    }
    if (kind === 'anchor') {
      var text = f.querySelector('#ss-anchor').value.trim(); if (!text) return;
      var keepOut = anchorMode === 'out';
      if (pend && pend.add === text && pend.preview) {
        anchorDraft = '';
        if (keepOut) act('anchors', { exclude: [text] }, 'Kept out. Undo lets it back in.', 'Kept work out of ' + d.name);
        else act('anchors', { add: [text] }, 'Added. Undo takes it out.', 'Added a way Fuzz spots ' + d.name);
        return;
      }
      pend = { add: text, preview: null }; paint(true);
      Store.seriesPreview(d.id, keepOut ? { exclude: [text] } : { add: [text] }).then(function (p) { if (pend && pend.add === text) { pend.preview = p; paint(true); } },
        function (err) { pend = null; paint(true); said(err); });
    }
  }
  function onInput(e) {
    if (e.target.id === 'sp-val' && e.target.closest('.sp-multi')) {   /* typing a name: Save counts it, no repaint */
      pickDraft = e.target.value;
      var n = picks.length + (pickDraft.trim() ? 1 : 0), sv = root.querySelector('[data-savepicks]');
      if (sv) { sv.disabled = !n; sv.textContent = n > 1 ? 'Add these ' + n : 'Save'; }
      return;
    }
    if (e.target.id === 'sp-pq') {   /* Find someone: filters the rows as you type, without repainting */
      var q = e.target.value.trim().toLowerCase();
      root.querySelectorAll('#sp-people > li').forEach(function (li) { li.hidden = !!q && li.dataset.name.indexOf(q) < 0; });
      return;
    }
    var p = e.target.closest('[data-part]'); if (!p || !split) return;
    split.names[+p.dataset.part] = p.value; refreshSplit();
  }
  function onChange(e) {
    var sel = e.target.closest('[data-pick]'); if (!sel || !split) return;
    var tid = +sel.dataset.pick;
    split.mine[tid] = true; split.pick[tid] = +sel.value;
    var sum = root.querySelector('#ss-split-sum'); if (sum) sum.innerHTML = splitSummary(data);
  }
  /* A click outside an open menu closes it */
  document.addEventListener('click', function (e) { if (root && pageId && !e.target.closest('.menu, [data-more], [data-gmore]')) closeMenus(); });

  window.SeriesView = V;
})();
