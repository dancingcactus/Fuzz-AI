/* Series: the bigger things you're working on (docs/series.md, "Surfaces"). In the Fuzz-head menu, under Lineup.
   Sections: New · Going · Gone quiet · Fuzz is watching · Wrapped. Each card: name, your part, status with its
   source, done-when, next milestone, one "Next in …" suggestion, counts, people, Work on …
   The sheet: Next in …, What Fuzz knows (editable), Open work with Add a task to …, Deliverables, Decided,
   People, How Fuzz spots it (editable, with a preview before it saves), Also touches this. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, unsub = null, sheet = null, sheetId = null, sheetData = null, edit = null, pend = null;
  var SECTIONS = [
    ['new', 'New', 'Ones you asked Fuzz to start. Check what it gathered, here or in Triage.'],
    ['going', 'Going', ''],
    ['quiet', 'Gone quiet', 'Nothing moved for a while. New work wakes one up.'],
    ['watching', 'Fuzz is watching', 'Work that keeps coming back together. Fuzz uses these quietly and asks you about one when it has something to suggest.'],
    ['wrapped', 'Wrapped', '']
  ];
  var ATTR = { goal: 'Goal', your_role: 'Your part', owner: 'Owner', 'for': 'For', status: 'Status', blocked_on: 'Blocked on',
    next_milestone: 'Next milestone', cadence: 'Rhythm', scope_out: 'Not part of it', done_when: 'Done when' };
  var ROLE = { drive: 'Driving it', contribute: 'Helping', follow: 'Keeping up' };
  var STATE = { triage: 'In Triage', queued: 'With Fuzz', working: 'With Fuzz', review: 'Needs your OK', sending: 'Sending', mine: 'With you',
    session: 'Open in Claude', deepwork: 'My work', scheduled: 'Later', waiting: 'Waiting on others', parked: 'Parked', done: 'Done', letgo: 'Let go' };
  var XSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  /* A series is a clipboard with two list lines, wherever one shows */
  V.ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/></svg>';

  function first(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function initials(n) { return (n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  function said(e) { Say.tell('That didn’t work: ' + (e && e.message || e), { stay: true }); }

  /* ---------- the page ---------- */
  function cardHTML(s) {
    var sec = s.section, h = '<li class="scard" data-series="' + s.id + '"><div class="scard-top"><button type="button" class="scard-name" data-open="' + s.id + '">' + esc(s.name) + '</button>';
    if (sec === 'new') h += UI.pill('Check what Fuzz found', 'warn');
    else if (s.role_label) h += UI.pill(s.role_label.replace(/ it$/, ''), s.role === 'drive' ? 'accent' : 'muted');
    if (s.muted) h += UI.pill('Quiet', 'muted');
    if ((s.season || 1) > 1) h += UI.pill('Season ' + s.season, 'muted');
    h += '</div>';
    if (sec === 'new') return h + '<p class="meta">Fuzz put this together from your note: ' + s.open + (s.open === 1 ? ' task' : ' tasks') + '. It’s waiting in Triage too. Approve it in either place.</p>' +
      '<div class="scard-acts"><a class="btn small" href="#/triage">Check it</a><button type="button" class="btn small" data-open="' + s.id + '">Adjust it</button></div></li>';
    if (sec === 'wrapped') return h + (s.evidence ? '<p class="meta">' + esc(s.evidence) + '</p>' : '') + '</li>';
    if (sec === 'watching') return h + '<p class="meta">' + (s.open + s.done) + ' tasks' + ((s.people || []).length ? ' · ' + esc(s.people.slice(0, 2).join(', ')) : '') + '</p>' +
      '<div class="scard-acts"><button type="button" class="btn small" data-keep="' + s.id + '">Keep it</button><button type="button" class="btn small" data-notseries="' + s.id + '">Not a series</button></div></li>';
    if (s.status) h += '<p class="scard-status">' + esc(s.status.value) + '<span class="meta"> · ' + esc(s.status.source) + '</span></p>';
    var dl = [];
    if (s.done_when) dl.push('<div><dt>Done when</dt><dd>' + esc(s.done_when) + '</dd></div>');
    if (s.next_milestone) dl.push('<div><dt>Next</dt><dd>' + esc(s.next_milestone) + '</dd></div>');
    if (dl.length) h += '<dl class="scard-dl">' + dl.join('') + '</dl>';
    if (s.next) h += '<p class="scard-next"><b>Next in ' + esc(s.name) + ':</b> ' + esc(first(s.next.title)) + '</p>';
    h += '<div class="scard-foot"><span class="meta">' + s.open + ' open · ' + s.done + ' done</span>' +
      '<span class="avs" aria-label="' + esc((s.people || []).join(', ')) + '">' + (s.people || []).slice(0, 3).map(function (p) { return '<span class="av" aria-hidden="true">' + esc(initials(p)) + '</span>'; }).join('') + '</span>' +
      (s.open ? '<button type="button" class="btn small" data-workon="' + s.id + '">Work on ' + esc(s.name) + '</button>' : '') + '</div>';
    return h + '</li>';
  }
  function render() {
    if (!root) return;
    var data = Store.series(), secs = data.sections || {}, any = false, h = '';
    SECTIONS.forEach(function (x) {
      var list = secs[x[0]] || []; if (!list.length) return;
      any = true;
      h += '<section class="lsec" aria-labelledby="ser-' + x[0] + '"><h2 id="ser-' + x[0] + '">' + x[1] + ' <span class="lcount">' + list.length + '</span></h2>' +
        (x[2] ? '<p class="meta">' + x[2] + '</p>' : '') + '<ul class="scards">' + list.map(cardHTML).join('') + '</ul></section>';
    });
    if (!any) h = '<p class="lempty">Nothing yet. As your work comes in, Fuzz notices the bigger things it belongs to and shows them here. You can also start one from New task’s +.</p>';
    if (data.demo) h = '<p class="meta demo-note">This is made-up demo work. With Fuzz running, your own series show here.</p>' + h;
    root.querySelector('#ser-board').innerHTML = h;
  }

  V.mount = function (container) {
    root = container;
    root.innerHTML = '<section class="lineup series-page" aria-labelledby="ser-h"><div class="tasks-head"><h1 id="ser-h">Series</h1>' +
      '<p class="meta">What you’re in the middle of. Fuzz picks these up from your work; you never have to set one up.</p>' +
      '<a class="btn small" href="#/capture?series=start">Start a series</a></div><div class="board" id="ser-board"></div></section>';
    root.addEventListener('click', onPageClick);
    render();
    unsub = Store.on(function () { render(); if (sheet && sheetId) loadSheet(sheetId); });
    var want = App.here().arg; if (want) V.open(want);
  };
  V.unmount = function () { if (unsub) unsub(); unsub = null; if (sheet) sheet.close(); root = null; };
  V.refresh = render;

  function onPageClick(e) {
    var o = e.target.closest('[data-open]'); if (o) { V.open(+o.dataset.open, o); return; }
    var k = e.target.closest('[data-keep]');
    if (k) { Store.seriesAction(+k.dataset.keep, 'keep').then(function () { Say.tell('Kept. Fuzz asks your part in Triage.'); }, said); return; }
    var n = e.target.closest('[data-notseries]');
    if (n) { Store.seriesAction(+n.dataset.notseries, 'drop').then(function () { Say.tell('Not a series. Fuzz won’t group these again unless more turns up.'); }, said); return; }
    var w = e.target.closest('[data-workon]'); if (w) workOn(+w.dataset.workon);
  }
  /* Work on …: Focus is the series, then Triage with its tasks first */
  function workOn(id) {
    var s = Store.seriesById(id) || sheetData || {};
    Store.seriesAction(id, 'work_on').then(function () {
      if (sheet) sheet.close();
      Say.tell('Focus: ' + (s.name || 'this series') + '. Its tasks come first.'); App.navigate('#/triage');
    }, said);
  }

  /* ---------- the sheet ---------- */
  V.open = function (id, trigger) {
    if (sheet) sheet.close();
    sheetId = +id; sheetData = null; edit = null; pend = null;
    var g = document.createElement('dialog');
    g.className = 'dlg series-sheet'; g.setAttribute('aria-labelledby', 'ss-title');
    g.innerHTML = '<div class="dlg-in" id="ss-in"><p class="meta">Loading…</p></div>';
    document.body.appendChild(g); sheet = g;
    g.addEventListener('close', function () { g.remove(); if (sheet === g) { sheet = null; sheetId = null; } if (trigger && document.body.contains(trigger)) trigger.focus(); });
    g.addEventListener('click', onSheetClick);
    g.addEventListener('submit', onSheetSubmit);
    g.showModal();
    loadSheet(sheetId);
  };
  function loadSheet(id) {
    Store.seriesSheet(id).then(function (d) { if (sheetId !== id || !sheet) return; sheetData = d; paintSheet(); },
      function (e) { if (sheet) sheet.querySelector('#ss-in').innerHTML = '<p class="meta">That series wouldn’t open: ' + esc(e.message) + '</p><div class="dlg-actions"><button type="button" class="btn" data-close>Close</button></div>'; });
  }
  /* A background refresh never wipes what you're typing; after your own action (force) it repaints anyway */
  function paintSheet(force) {
    var inner = sheet && sheet.querySelector('#ss-in'); if (!inner || !sheetData) return;
    if (!force && inner.contains(document.activeElement) && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    var st = inner.scrollTop; inner.innerHTML = sheetHTML(sheetData); inner.scrollTop = st;
  }
  function sectionHTML(title, body, sub) { return '<section class="ss-sec"><h3>' + title + '</h3>' + (sub ? '<p class="meta">' + sub + '</p>' : '') + body + '</section>'; }
  function sheetHTML(d) {
    var stateLabel = { 'new': 'Waiting for your OK', going: 'Going', quiet: 'Gone quiet', watching: 'Fuzz is watching', wrapped: 'Wrapped' }[d.section] || '';
    var h = '<div class="dlg-top"><div class="dlg-titles"><div class="dlg-chips">' + (d.role_label ? UI.pill(d.role_label, 'accent') : '') + UI.pill(stateLabel, d.section === 'wrapped' ? 'ok' : 'muted') +
      '<span class="meta">' + d.open + ' open · ' + d.done + ' done' + ((d.deliverables || []).length ? ' · ' + d.deliverables.length + (d.deliverables.length === 1 ? ' deliverable' : ' deliverables') : '') + '</span></div>' +
      (edit === 'name' ? '<form class="ss-inline" data-form="name"><label class="sr" for="ss-name">Name</label><input id="ss-name" class="fld" type="text" value="' + esc(d.name) + '" maxlength="80"><button class="btn small primary">Save</button><button type="button" class="btn small" data-cancel>Cancel</button></form>'
        : '<h2 id="ss-title">' + esc(d.name) + '</h2>') +
      (goal(d) ? '<p class="meta">' + esc(goal(d)) + '</p>' : '') + '</div>' +
      '<button type="button" class="iconbtn" data-close aria-label="Close">' + XSVG + '</button></div>';
    /* the actions: Work on … first, then Rename and More (quiet the suggestions, wrapped, not a series) */
    h += '<div class="dlg-actions">' + (d.open ? '<button type="button" class="btn primary" data-workon="' + d.id + '">Work on ' + esc(d.name) + '</button>' : '') +
      (d.section === 'watching' ? '<button type="button" class="btn" data-act="keep">Keep it</button>' : '') +
      '<button type="button" class="btn" data-act="rename">Rename</button>' +
      '<details class="ss-more"><summary class="btn">More</summary><div class="menu" role="menu">' +
      (d.section === 'wrapped' ? '<button type="button" role="menuitem" data-act="reopen"><b>Start season 2</b></button>'
        : '<button type="button" role="menuitem" data-act="' + (d.muted ? 'unmute' : 'mute') + '"><b>' + (d.muted ? 'Suggest next steps again' : 'Quiet the suggestions') + '</b><span>It stays a series. Fuzz just stops suggesting.</span></button>' +
          '<button type="button" role="menuitem" data-act="wrap"><b>It’s wrapped up</b></button>' +
          '<button type="button" role="menuitem" data-act="check"><b>Check if it’s done</b><span>Fuzz looks for its done-when on its next run.</span></button>') +
      '<button type="button" role="menuitem" data-act="drop"><b>Not a series</b><span>Its tasks stay. They just aren’t grouped.</span></button>' +
      '<button type="button" role="menuitem" data-act="ongoing"><b>It’s ongoing, not a series</b><span>Part of your job with no finish line. Fuzz stops grouping it.</span></button></div></details></div>';
    if (d.evidence) h += '<p class="meta">' + esc(d.evidence) + '</p>';
    var sug = d.suggestions || [];
    if (sug.length) h += sectionHTML('Next in ' + esc(d.name), '<ul class="ss-next">' + sug.map(function (x) {
      return '<li><b>' + esc(x.title) + '</b><span class="meta">' + esc(x.why || '') + '</span>' + (x.card_id ? '<div class="scard-acts">' +
        '<button type="button" class="btn small primary" data-sug="add" data-card="' + x.card_id + '" data-title="' + esc(x.title) + '">Add it</button>' +
        '<button type="button" class="btn small" data-sug="mine" data-card="' + x.card_id + '" data-title="' + esc(x.title) + '">I’ll do it</button>' +
        '<button type="button" class="btn small" data-sug="not_needed" data-card="' + x.card_id + '">Not needed</button></div>' : '') + '</li>';
    }).join('') + '</ul>');
    h += sectionHTML('What Fuzz knows', knowsHTML(d), 'Click a line to change it. Each one says where it came from.');
    var open = (d.open_tasks || []).map(function (t) { return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span></span><span class="ps-side">' + UI.pill(STATE[t.state] || t.state, 'muted') + '</span></li>'; }).join('');
    h += sectionHTML('Open work', '<form class="ss-inline" data-form="task"><label class="sr" for="ss-task">Add a task to ' + esc(d.name) + '</label><input id="ss-task" class="fld" type="text" autocomplete="off" placeholder="Add a task to ' + esc(d.name) + '"><button class="btn small">Add</button></form>' +
      '<p class="meta">It goes to Triage like any new task, already part of ' + esc(d.name) + '.</p>' + (open ? '<ul class="ps-tasks">' + open + '</ul>' : '<p class="meta">Nothing open.</p>'));
    if ((d.done_tasks || []).length) h += sectionHTML('Done so far', '<ul class="ps-tasks">' + d.done_tasks.slice(0, 8).map(function (t) { return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span>' + (t.summary ? '<span class="ps-dw">' + esc(t.summary) + '</span>' : '') + '</span></li>'; }).join('') + '</ul>');
    if ((d.deliverables || []).length) h += sectionHTML('Deliverables', '<ul class="ps-tasks">' + d.deliverables.map(function (x) {
      return '<li><span class="ps-main"><span class="ps-name">' + esc(x.title) + '</span><span class="ps-dw">Done when ' + esc(first(x.done_when)) + (x.due ? ' · ' + esc(String(x.due).slice(0, 10)) : '') + '</span></span><span class="ps-side">' + UI.pill(x.state !== 'open' ? (x.state === 'done' ? 'Done' : 'Let go') : x.tier === 'active' ? 'This week' : 'Background', x.tier === 'active' ? 'accent' : 'muted') + '</span></li>';
    }).join('') + '</ul>');
    if ((d.decided || []).length) h += sectionHTML('Decided', '<ul class="ps-tasks">' + d.decided.map(function (x) {
      return '<li><span class="ps-main"><span class="ps-name">' + esc(x.what) + '</span><span class="ps-dw">' + esc(String(x.at || '').slice(0, 10)) + (/^https?:/.test(x.link || '') ? ' · <a href="' + esc(x.link) + '" target="_blank" rel="noopener">Where it came from</a>' : '') + '</span></span></li>';
    }).join('') + '</ul>');
    if ((d.people || []).length) h += sectionHTML('People', '<p>' + d.people.map(esc).join(' · ') + '</p>');
    h += sectionHTML('How Fuzz spots it', anchorsHTML(d), 'New work that touches any of these lands in ' + esc(d.name) + '. Remove one that catches the wrong things; add one Fuzz missed.');
    if ((d.also_touches || []).length) h += sectionHTML('Also touches this', '<ul class="ps-tasks">' + d.also_touches.map(function (t) {
      return '<li><span class="ps-main"><span class="ps-name">' + esc(t.title) + '</span><span class="ps-dw">' + (t.series ? 'Part of ' + esc(t.series) : 'In no series') + '</span></span>' +
        '<span class="ps-side"><button type="button" class="btn small" data-move="' + t.id + '">Move it here</button></span></li>';
    }).join('') + '</ul>', 'Tasks filed elsewhere that touch this too. Fuzz counts them when it looks for what’s next.');
    return h;
  }
  function goal(d) { var g = (d.knows || []).filter(function (f) { return f.attr === 'goal'; })[0]; return g && g.value; }
  function knowsHTML(d) {
    var rows = (d.knows || []).map(function (f) {
      var val = f.attr === 'your_role' ? (ROLE[f.value] || f.value) : f.value;
      if (edit === 'fact:' + f.attr) return '<div class="fact">' + factForm(f.attr, f.value) + '</div>';
      return '<div class="fact"><dt>' + esc(ATTR[f.attr] || f.attr) + '</dt><dd><button type="button" class="linkbtn fact-v" data-edit="' + f.attr + '">' + esc(val) + '</button>' +
        '<span class="meta">' + esc(f.source) + (f.as_of ? ', ' + esc(String(f.as_of).slice(0, 10)) : '') + '</span></dd>' +
        '<span class="trust' + (f.trust === 'confirmed' ? ' conf' : '') + '">' + esc(f.trust_label) + '</span>' +
        (f.fact_id && f.trust !== 'confirmed' ? '<button type="button" class="iconbtn small" data-wrong="' + f.fact_id + '" aria-label="That’s wrong: ' + esc(ATTR[f.attr] || f.attr) + '" title="That’s wrong">' + XSVG + '</button>' : '') + '</div>';
    }).join('');
    var have = (d.knows || []).map(function (f) { return f.attr; });
    var missing = Object.keys(ATTR).filter(function (a) { return have.indexOf(a) < 0; });
    var add = edit === 'fact:new' ? '<div class="fact">' + factForm(null, '', missing) + '</div>'
      : missing.length ? '<button type="button" class="linkbtn" data-edit="new">Tell Fuzz something about it</button>' : '';
    return (rows ? '<dl class="facts">' + rows + '</dl>' : '<p class="meta">Nothing yet. Fuzz fills this in as messages mention it.</p>') + add;
  }
  function factForm(attr, value, choices) {
    var pick = attr ? '<span class="fact-k">' + esc(ATTR[attr]) + '</span><input type="hidden" name="attr" value="' + attr + '">'
      : '<label class="sr" for="ss-attr">What</label><select id="ss-attr" name="attr" class="fld">' + choices.map(function (a) { return '<option value="' + a + '">' + esc(ATTR[a]) + '</option>'; }).join('') + '</select>';
    var field = attr === 'your_role' ? '<label class="sr" for="ss-val">Your part</label><select id="ss-val" name="value" class="fld">' + Object.keys(ROLE).map(function (r) { return '<option value="' + r + '"' + (r === value ? ' selected' : '') + '>' + ROLE[r] + '</option>'; }).join('') + '</select>'
      : '<label class="sr" for="ss-val">Value</label><input id="ss-val" name="value" class="fld" type="text" value="' + esc(value || '') + '" maxlength="500"' + (attr === 'done_when' ? ' placeholder="A state: NW-342 is accepted"' : '') + '>';
    return '<form class="ss-inline" data-form="fact">' + pick + field + '<button class="btn small primary">Save</button><button type="button" class="btn small" data-cancel>Cancel</button></form>';
  }
  function anchorsHTML(d) {
    var h = '<ul class="ss-anchors">' + (d.anchors || []).map(function (a) {
      var asking = pend && pend.remove === a.key;
      return '<li><span class="ps-main"><span class="ps-name">' + esc(a.label) + '</span><span class="ps-dw">' + (a.tasks ? 'Caught ' + a.tasks + ' · ' : '') + (a.yours ? 'You added it' : 'Fuzz found it') + '</span>' +
        (asking ? previewHTML(pend.preview, 'remove') : '') + '</span>' +
        '<span class="ps-side">' + (asking ? '' : '<button type="button" class="iconbtn small" data-anchor-rm="' + esc(a.key) + '" aria-label="Remove ' + esc(a.label) + '" title="Remove">' + XSVG + '</button>') + '</span></li>';
    }).join('') + (d.removed_anchors || []).map(function (a) {
      return '<li class="removed"><span class="ps-main"><span class="ps-name">' + esc(a.label) + '</span><span class="ps-dw">Removed. Fuzz stops using it, and won’t suggest it again.</span></span>' +
        '<span class="ps-side"><button type="button" class="btn small" data-anchor-back="' + esc(a.key) + '">Put it back</button></span></li>';
    }).join('') + '</ul>';
    if (!(d.anchors || []).length && !(d.removed_anchors || []).length) h = '<p class="meta">Nothing yet: it’s only the tasks you put in it.</p>';
    h += '<form class="ss-inline" data-form="anchor"><label class="sr" for="ss-anchor">Add a way to spot it</label><input id="ss-anchor" class="fld" type="text" autocomplete="off" placeholder="A ticket key (NW-342), a #channel or words" value="' + esc(pend && pend.add || '') + '">' +
      '<button class="btn small">' + (pend && pend.add ? 'Add it' : 'Check it') + '</button>' + (pend && pend.add ? '<button type="button" class="btn small" data-cancel>Cancel</button>' : '') + '</form>';
    if (pend && pend.add) h += previewHTML(pend.preview, 'add');
    else h += '<p class="meta">Before it saves, Fuzz shows what it would have caught.</p>';
    return h;
  }
  function previewHTML(p, how) {
    if (!p) return '<p class="meta">Checking…</p>';
    var list = how === 'add' ? p.would_join : p.would_stop_matching;
    var head = how === 'add' ? (list.length ? 'This would bring in:' : 'This wouldn’t bring in any tasks you have now.')
      : (list.length ? 'Without it, these would stop matching:' : 'Removing it wouldn’t change which tasks are in it now.');
    return '<div class="ss-preview"><p class="meta">' + head + '</p>' + (list.length ? '<ul>' + list.slice(0, 6).map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('') + '</ul>' : '') +
      (how === 'remove' ? '<div class="scard-acts"><button type="button" class="btn small primary" data-anchor-ok>Remove it</button><button type="button" class="btn small" data-cancel>Keep it</button></div>' : '') + '</div>';
  }

  function act(what, body, msg) {
    var id = sheetId;
    return Store.seriesAction(id, what, body).then(function (d) {
      if (d && d.id === id) { sheetData = d; edit = null; pend = null; paintSheet(true); }
      if (msg) Say.tell(msg);
    }, said);
  }
  function onSheetClick(e) {
    var g = sheet; if (!g) return;
    if (e.target === g || e.target.closest('[data-close]')) { g.close(); return; }
    var d = sheetData; if (!d) return;
    var w = e.target.closest('[data-workon]'); if (w) { workOn(+w.dataset.workon); return; }
    if (e.target.closest('[data-cancel]')) { edit = null; pend = null; paintSheet(true); return; }
    var ed = e.target.closest('[data-edit]');
    if (ed) { edit = 'fact:' + ed.dataset.edit; paintSheet(true); var f = g.querySelector('#ss-val'); if (f) f.focus(); return; }
    var wr = e.target.closest('[data-wrong]'); if (wr) { act('facts', { fact_id: +wr.dataset.wrong }, 'Fuzz won’t use that any more.'); return; }
    var sg = e.target.closest('[data-sug]');
    if (sg) {
      var opt = sg.dataset.sug;
      Store.answerSeriesCard(+sg.dataset.card, opt, opt === 'not_needed' ? undefined : { title: sg.dataset.title }).then(function () {
        Say.tell(opt === 'add' ? 'Added to Triage, part of ' + d.name + '.' : opt === 'mine' ? 'It’s in My work.' : 'Okay. Fuzz won’t suggest that again.');
        loadSheet(d.id);
      }, said);
      return;
    }
    var rm = e.target.closest('[data-anchor-rm]');
    if (rm) {
      pend = { remove: rm.dataset.anchorRm, preview: null }; paintSheet(true);
      Store.seriesPreview(d.id, { remove: [pend.remove] }).then(function (p) { if (pend && pend.remove) { pend.preview = p; paintSheet(true); } });
      return;
    }
    if (e.target.closest('[data-anchor-ok]') && pend && pend.remove) { act('anchors', { remove: [pend.remove] }, 'Removed. Undo puts it back.'); return; }
    var back = e.target.closest('[data-anchor-back]'); if (back) { act('anchors', { restore: [back.dataset.anchorBack] }, 'It’s back.'); return; }
    var mv = e.target.closest('[data-move]');
    if (mv) { Live.on() ? act('add_task', { task_id: +mv.dataset.move }, 'Moved here.') : said('Moving tasks needs Fuzz running.'); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var what = a.dataset.act, det = g.querySelector('.ss-more'); if (det) det.open = false;
    if (what === 'rename') { edit = 'name'; paintSheet(true); var n = g.querySelector('#ss-name'); if (n) { n.focus(); n.select(); } return; }
    if (what === 'keep') { act('keep', {}, 'Kept. Fuzz asks your part in Triage.'); return; }
    if (what === 'mute' || what === 'unmute') { act(what, {}, what === 'mute' ? 'Quiet. No more suggestions for it.' : 'Fuzz will suggest next steps again.'); return; }
    if (what === 'wrap') { act('wrap', {}, 'Wrapped. Undo if that was early.'); return; }
    if (what === 'reopen') { act('reopen', {}, 'Season 2. It’s going again.'); return; }
    if (what === 'check') { act('check', {}, 'Fuzz checks its done-when on its next run.'); return; }
    if (what === 'drop' || what === 'ongoing') {
      Store.seriesAction(d.id, 'drop', what === 'ongoing' ? { why: 'ongoing' } : {}).then(function () {
        g.close(); Say.tell(what === 'ongoing' ? 'Got it: ongoing. Fuzz stops grouping it.' : 'Not a series. Its tasks stay where they are.');
      }, said);
    }
  }
  function onSheetSubmit(e) {
    var f = e.target.closest('[data-form]'); if (!f) return;
    e.preventDefault();
    var kind = f.dataset.form, d = sheetData;
    if (kind === 'name') { var v = f.querySelector('#ss-name').value.trim(); if (v) act('name', { name: v }, 'Renamed.'); return; }
    if (kind === 'fact') {
      var attr = f.querySelector('[name="attr"]').value, val = (f.querySelector('[name="value"]').value || '').trim();
      if (!val) return;
      act(attr === 'your_role' ? 'role' : 'facts', attr === 'your_role' ? { role: val } : { attr: attr, value: val }, 'Saved. Fuzz takes your word over anything else.');
      return;
    }
    if (kind === 'task') {
      var t = f.querySelector('#ss-task').value.trim(); if (!t) return;
      act('add_task', { text: t }, 'Added to Triage, part of ' + d.name + '.');
      return;
    }
    if (kind === 'anchor') {
      var text = f.querySelector('#ss-anchor').value.trim(); if (!text) return;
      if (pend && pend.add === text && pend.preview) { act('anchors', { add: [text] }, 'Added. Undo takes it out.'); return; }
      pend = { add: text, preview: null }; paintSheet(true);
      Store.seriesPreview(d.id, { add: [text] }).then(function (p) { if (pend && pend.add === text) { pend.preview = p; paintSheet(true); } },
        function (err) { pend = null; paintSheet(true); said(err); });
    }
  }

  window.SeriesView = V;
})();
