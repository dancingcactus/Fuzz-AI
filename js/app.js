/* App shell: hash router, header, settings popover, global notifications. */
(function () {
  var esc = UI.esc;
  /* The Guide is the one starting place: where do you want to start? It is Deep Work's entry screen with Triage
     added (js/view-deepwork.js), so the routes that land there (and the session, while one runs) share one view.
     #/work and #/work/<taskId> are the calendar links (docs/nav-guide.md); #/deepwork is the old route. */
  var ROUTES = {
    guide: { view: window.DeepWorkView, title: 'Guide', place: 'guide' },
    work: { view: window.DeepWorkView, title: 'Guide', place: 'guide' },
    deepwork: { view: window.DeepWorkView, title: 'Guide', place: 'guide' },
    triage: { view: window.TriageView, title: 'Triage' },
    tasks: { view: window.TasksView, title: 'Lineup' },
    /* the bigger things you're working on (docs/series.md); #/series/<id> opens one's sheet */
    series: { view: window.SeriesView, title: 'Series' },
    artifacts: { view: window.ArtifactsView, title: 'Artifacts' },
    capture: { view: window.CaptureView, title: 'New task' },
    welcome: { view: window.Onboard.view, title: 'Welcome' },
    settings: { view: window.SettingsView, title: 'Settings' },
    /* a debugging page, not in the menu: Settings, What I've learned, links to it */
    evals: { view: window.EvalsView, title: 'Evals' }
  };
  /* Memory's inspector is a developer tool, like the mood lab: only with ?lab, and not in the nav */
  if (window.Memory && Memory.lab && window.InspectView) ROUTES.inspect = { view: window.InspectView, title: 'Inspector' };
  var PREF_KEY = 'fuzz.prefs.v1';
  var prefs = { theme: 'terracotta', mode: 'auto', contrast: 'standard', codeFont: 'jetbrains', calm: false };
  var current = null, currentName = null, currentKey = null, tempCalm = false, reduce = false, here = { name: 'guide', arg: null, params: {} };
  /* The theme on screen: your pick, or with Random, today's pick */
  var shown = 'terracotta', backFrom = null;

  function load() {
    try { var p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); if (p) prefs = Object.assign(prefs, p); } catch (e) { /* storage can be blocked */ }
    if (prefs.theme !== 'random' && !Themes.list.some(function (t) { return t.id === prefs.theme; })) prefs.theme = 'terracotta';
    shown = prefs.theme === 'random' ? Themes.pickRandom() : prefs.theme;
  }
  function save() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }

  function paint() { Themes.apply(shown, prefs.mode, prefs.contrast, prefs.codeFont); save(); }

  var App = {
    /* Random shows today's pick (picking one if today has none yet) */
    setTheme: function (id) { prefs.theme = id; shown = id === 'random' ? Themes.pickRandom() : id; paint(); },
    shownTheme: function () { return shown; },
    themePicks: themePicks,
    setMode: function (m) { prefs.mode = m; paint(); },
    setContrast: function (c) { prefs.contrast = c; paint(); },
    setCodeFont: function (id) { prefs.codeFont = id; paint(); },
    setCalm: function (v) {
      prefs.calm = !!v; Fuzz.setCalm(prefs.calm || tempCalm); save();
    },
    /* The onboarding's intro is always calm, whatever the setting; the setting comes back after it */
    tempCalm: function (on) { tempCalm = !!on; Fuzz.setCalm(prefs.calm || tempCalm || reduce); },
    prefs: function () { return prefs; },
    navigate: function (hash) { location.hash = hash; },
    /* Leave Settings for whatever you were doing before it */
    leaveSettings: function () { App.navigate(backFrom && backFrom !== '#/settings' ? backFrom : '#/guide'); },
    refresh: function () {
      if (currentName === 'triage' && TriageView) TriageView.refresh();
      else if (current && ROUTES[currentName] && ROUTES[currentName].place === 'guide' && current.refresh) current.refresh();   /* keeps the pick and a link's time */
      else if (current && ROUTES[currentName]) route(true);
    },
    /* Where you are: the route, its id (#/work/<id>) and its query (?until=13:30&what=…) */
    here: function () { return here; },
    /* The route's name (Lineup, My work…) for the feedback button: never a task's or file's title */
    viewTitle: function () { return currentName && ROUTES[currentName] ? titleFor(currentName).replace(/ · Fuzz$/, '') : null; },
    paintLabel: function () { paintLabel(); },
    fmtUntil: function (s) { return fmtUntil(s); },
    resetDemo: function () {
      if (Live.on()) { Live.sync().then(function () { Say.tell('Up to date with Fuzz.'); }); return; }
      Store.reset(); TriageView.hardReset(); route(true); Say.tell('Demo data is back to the start.');
    }
  };
  window.App = App;

  /* ---------- Header ----------
     No tabs (docs/nav-guide.md). The logo opens the Guide; a label next to the wordmark says where you are and is
     the way back (to your session while one runs, else to the Guide); a dot on it means work is waiting that you
     can't see from here. Lineup, Artifacts and Settings live in the round menu with Fuzz's head on it. */
  var ICON = {
    /* a tiny line-drawn Fuzz: the TV head with its two antennas of different lengths */
    fuzz: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="9" width="17" height="12" rx="3"/><path d="M10 9 7 3M14 9l2-4"/><circle cx="9.5" cy="15" r=".9" fill="currentColor"/><circle cx="14.5" cy="15" r=".9" fill="currentColor"/></svg>',
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    /* a speech bubble with a pencil line: tell yourself what to fix */
    note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z"/><path d="M12 8v4M12 15.5h.01"/></svg>',
    keys: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>'
  };
  var XSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function buildHeader() {
    var h = document.getElementById('appbar');
    h.innerHTML =
      '<div class="appbar-left"><a class="brand" href="#/guide" aria-label="Fuzz: the Guide" title="The Guide: where do you want to start?">' + Fuzz.mini('good', { cls: 'brand-av' }) + '<span class="brand-name">Fuzz</span></a>' +
      /* The only nav element: where you are, and the way back. paintLabel() fills it. */
      '<nav class="wherenav" aria-label="Where you are"><a class="where" id="where" href="#/guide"></a></nav></div>' +
      '<div class="hprog" id="hprog" hidden><span class="left" id="left" aria-hidden="true"></span>' + Progress.html('prog') + '</div>' +
      /* Deep Work's session bar takes the same slot; js/view-deepwork.js shows and paints it */
      '<div class="hprog dwprog" id="dwprog" hidden><div class="dwbar" id="dwbar" aria-hidden="true"></div><span class="dwprog-t" id="dwprog-t"></span></div>' +
      /* On narrow screens these collapse to icons (New task moves to the floating #fab); .lbl stays for screen readers. */
      '<div class="appbar-right"><a href="#/capture" class="themebtn nav-cta" title="New task (N)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="lbl">New task</span></a>' +
        '<div class="undowrap"><button type="button" class="themebtn undobtn" id="undobtn" aria-expanded="false" aria-controls="undopop" aria-haspopup="dialog" disabled>' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg><span class="lbl">Undo</span><span class="navcount" id="undocount"></span></button>' +
        '<div class="themepop undopop" id="undopop" role="dialog" aria-label="Recent actions" hidden></div></div>' +
        /* Feedback: a new GitHub issue with this page's details filled in (js/feedback.js) */
        '<button type="button" class="themebtn iconbtn fbbtn" id="fbbtn" aria-label="Report a problem or idea (opens GitHub)" title="Report a problem or idea: opens a GitHub issue with this page’s details">' + ICON.note + '</button>' +
        /* The menu: the same small round button Settings used to be, with Fuzz's head on it */
        '<div class="menuwrap"><button type="button" class="themebtn iconbtn" id="menubtn" aria-haspopup="menu" aria-expanded="false" aria-controls="navmenu" aria-label="Lineup, Series, Artifacts and Settings" title="Lineup, Series, Artifacts and Settings">' + ICON.fuzz + '</button>' +
        '<div class="navmenu" id="navmenu" role="menu" aria-label="Lineup, Series, Artifacts and Settings" hidden>' +
          '<a role="menuitem" href="#/tasks" data-menu="tasks">' + ICON.list + '<span><b>Lineup</b><small id="menu-lineup">Who has the ball</small></span></a>' +
          '<a role="menuitem" href="#/series" data-menu="series">' + SeriesView.ICON + '<span><b>Series</b><small id="menu-series">What you’re in the middle of</small></span></a>' +
          '<a role="menuitem" href="#/artifacts" data-menu="artifacts">' + ICON.file + '<span><b>Artifacts</b><small id="menu-artifacts">What Fuzz made</small></span></a>' +
          '<hr>' +
          '<a role="menuitem" href="#/settings" data-menu="settings">' + ICON.gear + '<span><b>Settings</b><small>Themes, connections, how Fuzz works</small></span></a>' +
          '<button type="button" role="menuitem" data-menu="keys">' + ICON.keys + '<span><b>Keys and help</b></span><kbd aria-hidden="true">?</kbd></button>' +
        '</div></div></div>' +
      '<dialog class="dlg keys-dlg" id="appkeys" aria-labelledby="appkeys-h"><div class="dlg-in"><div class="dlg-top"><h2 id="appkeys-h">Keys and help</h2><button type="button" class="iconbtn" data-close aria-label="Close">' + XSVG + '</button></div>' +
        '<section><h3>Anywhere</h3><dl class="keylist"><div><dt><kbd>N</kbd></dt><dd>New task</dd></div><div><dt><kbd>?</kbd></dt><dd>The keys for where you are, in Triage, the Guide and My work</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Close a menu or a box</dd></div></dl></section>' +
        '<section><h3>Getting around</h3><p class="meta">The Fuzz logo opens the Guide, where you pick where to start. The label next to it says where you are; click it to go back. Lineup, Artifacts and Settings are in the menu with Fuzz’s head.</p></section></div></dialog>';
    document.getElementById('undobtn').addEventListener('click', function () { toggleMenu(false); toggleUndo(); });
    if (window.Feedback) Feedback.bind(document.getElementById('fbbtn'));
    document.getElementById('menubtn').addEventListener('click', function () { toggleUndo(false); toggleMenu(); });
    /* The label and the logo go back to the Guide. On a running session that's a way out: the wrap-up, then the Guide. */
    ['where', 'brand'].forEach(function (id) {
      var el = id === 'brand' ? document.querySelector('.brand') : document.getElementById(id);
      if (el) el.addEventListener('click', function (e) {
        if (currentName && ROUTES[currentName].place === 'guide' && window.DeepWork && DeepWork.leave && DeepWork.leave()) e.preventDefault();
      });
    });
    var menu = document.getElementById('navmenu');
    menu.addEventListener('click', function (e) {
      var it = e.target.closest('[data-menu]'); if (!it) return;
      toggleMenu(false);
      if (it.dataset.menu === 'keys') { e.preventDefault(); openKeys(); }
    });
    /* Arrow keys move through the menu */
    menu.addEventListener('keydown', function (e) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) < 0) return;
      var items = [].slice.call(menu.querySelectorAll('[role="menuitem"]')), i = items.indexOf(document.activeElement);
      e.preventDefault(); e.stopPropagation();
      var n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[n].focus();
    });
    var kd = document.getElementById('appkeys');
    kd.addEventListener('click', function (e) { if (e.target === e.currentTarget || e.target.closest('[data-close]')) kd.close(); });
    document.getElementById('undopop').addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('[data-undo]'); if (!b) return;
      var u = Say.undoList()[parseInt(b.dataset.undo, 10)]; toggleUndo(false);
      if (u) { u.run(); document.getElementById('undobtn').focus(); }
    });
    Say.onUndoChange(paintUndo); setInterval(paintUndo, 30000); paintUndo();
    /* Outside-click closes a popover, judged by where the press began: a text selection dragged out of
       the popover ends with a click on the page, and that isn't a click outside */
    var downAt = null;
    document.addEventListener('pointerdown', function (e) { downAt = e.target; }, true);
    document.addEventListener('click', function (e) {
      var t = downAt && downAt.isConnected ? downAt : e.target;
      if (!document.getElementById('undopop').hidden && !t.closest('#undopop') && !t.closest('#undobtn')) toggleUndo(false);
      if (!document.getElementById('navmenu').hidden && !t.closest('#navmenu') && !t.closest('#menubtn')) toggleMenu(false);
    });
    /* Escape closes an open popover wherever focus is, before any view sees the key. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = !document.getElementById('undopop').hidden ? ['undobtn', toggleUndo] : !document.getElementById('navmenu').hidden ? ['menubtn', toggleMenu] : null;
      if (!open) return;
      e.preventDefault(); e.stopPropagation(); open[1](false); document.getElementById(open[0]).focus();
    }, true);
    Progress.mount(document.getElementById('prog'));
  }
  function toggleMenu(force) {
    var pop = document.getElementById('navmenu'), btn = document.getElementById('menubtn'); if (!pop) return;
    var show = force === undefined ? pop.hidden : force;
    if (show) paintMenu();
    pop.hidden = !show; btn.setAttribute('aria-expanded', String(show));
    if (show) { var first = pop.querySelector('[role="menuitem"]'); if (first) first.focus(); }
  }
  /* A one-line summary under Lineup and Artifacts, in words */
  function paintMenu() {
    var withFuzz = Store.inState('working', 'queued', 'review', 'sending').length, waitOn = Store.inState('waiting').length, bits = [];
    if (withFuzz) bits.push(withFuzz + ' with Fuzz');
    if (waitOn) bits.push(waitOn + ' waiting on others');
    document.getElementById('menu-lineup').textContent = 'Who has the ball' + (bits.length ? ': ' + bits.join(', ') : '');
    var files = (window.ArtifactsView && ArtifactsView.count) ? ArtifactsView.count() : 0;
    document.getElementById('menu-artifacts').textContent = 'What Fuzz made' + (files ? ': ' + files + (files === 1 ? ' file' : ' files') : '');
    /* Series: what needs you there, in words ("1 new to check, Hiring’s quiet") */
    var ser = Store.series(), sc = ser.counts || {}, sb = [];
    if (!ser.demo) {
      if (sc['new']) sb.push(sc['new'] + ' new to check');
      var quiet = (ser.sections || {}).quiet || [];
      if (quiet.length === 1) sb.push(quiet[0].name + '’s quiet'); else if (quiet.length) sb.push(quiet.length + ' gone quiet');
    }
    document.getElementById('menu-series').textContent = 'What you’re in the middle of' + (sb.length ? ': ' + sb.join(', ') : '');
  }
  /* Keys and help: the page's own key guide where it has one (Triage, the Guide, Deep Work), else the short list */
  function openKeys() {
    var own = document.querySelector('#view .keys-link');
    if (own && own.offsetParent) { own.click(); return; }
    var d = document.getElementById('appkeys'); if (d && !d.open) d.showModal();
  }

  /* ---------- The label: where you are, and the way back ---------- */
  var PLACE = { triage: 'Triage', tasks: 'Lineup', series: 'Series', artifacts: 'Artifacts', capture: 'New task', settings: 'Settings', inspect: 'Inspector', evals: 'Evals' };
  var BACK = 'Back to the Guide';
  /* "13:30" (a calendar link's until) as "1:30pm"; null when it isn't a time */
  function fmtUntil(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); if (!m) return null;
    var h = +m[1], mm = +m[2]; if (h > 23 || mm > 59) return null;
    var ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return h + (mm ? ':' + ('0' + mm).slice(-2) : '') + ap;
  }
  /* The same, only while it's still ahead today: a link opened after its block ended shows no end time */
  function untilAhead(hhmm) {
    var f = fmtUntil(hhmm); if (!f) return null;
    var p = hhmm.split(':'), d = new Date(); d.setHours(+p[0], +p[1], 0, 0);
    return d > Date.now() ? f : null;
  }
  function triageHas() { return Store.get().queue.length > 0 || Onboard.hasQuestion(); }
  function urgentHas() { return Store.queue().some(function (it) { return !!it.dueAt; }); }
  /* Work you can't see from here. On the Guide the list shows it; in Triage you're clearing it. In a session only
     what can't wait counts, so ordinary work never pulls you out of focus. No numbers, ever. */
  function waitingSignal(onGuide, dw) {
    if (dw && dw.session) return urgentHas() ? 'urgent' : null;
    if (dw && dw.wrap) return null;
    if (onGuide || currentName === 'triage') return null;
    return triageHas() || Store.inState('deepwork').length ? 'waiting' : null;
  }
  function paintLabel() {
    var a = document.getElementById('where'); if (!a || !currentName) return;
    var name = currentName, onGuide = ROUTES[name].place === 'guide';
    a.hidden = name === 'welcome';   /* the onboarding has no nav */
    if (a.hidden) return;
    var dw = window.DeepWork && DeepWork.label ? DeepWork.label() : null;
    var k, sub = '', ring = null, cur = false;
    /* A session is a place like any other: "My work · Back to the Guide". Clicking it is a way out of the session
       (the wrap-up, then the Guide); the session's clock stays in the header bar. From other pages mid-session the
       label is theirs, and the Guide they lead back to is the session. */
    if (onGuide && dw && (dw.session || dw.wrap)) { k = 'My work'; sub = BACK; }
    else if (onGuide) { k = 'Guide'; cur = true; }
    else if (name === 'triage') { var u = untilAhead(here.params.until); k = 'Triage'; sub = (u ? 'Until ' + u + ' · ' : '') + BACK; }
    else { k = PLACE[name] || ROUTES[name].title; sub = BACK; }
    var sig = waitingSignal(onGuide, dw);
    var html = (ring != null ? '<span class="where-ring" style="--p:' + ring + '" aria-hidden="true"></span>' : '') + '<b>' + esc(k) + '</b>' +
      (sig ? '<span class="where-dot' + (sig === 'urgent' ? ' urgent' : '') + '" role="img" aria-label="' + (sig === 'urgent' ? 'something can’t wait' : 'things are waiting') + '"></span>' : '') +
      (sub ? '<span class="where-s">' + esc(sub) + '</span>' : '');
    if (a.dataset.h !== html) { a.dataset.h = html; a.innerHTML = html; }
    if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    var title = cur ? 'The Guide: where do you want to start?' : BACK;
    if (a.title !== title) a.title = title;
    if (onGuide) { var dt = titleFor(name); if (document.title !== dt) document.title = dt; }   /* Guide, or My work while a session runs */
  }
  function toggleUndo(force) {
    var pop = document.getElementById('undopop'), btn = document.getElementById('undobtn');
    var show = force === undefined ? pop.hidden : force;
    if (show && btn.disabled) show = false;
    pop.hidden = !show; btn.setAttribute('aria-expanded', String(show));
    if (show) { var first = pop.querySelector('button'); if (first) first.focus(); }
  }
  function ago(t) {
    var m = Math.floor((Date.now() - t) / 60000);
    return m < 1 ? 'Just now' : m + ' min ago';
  }
  function paintUndo() {
    var btn = document.getElementById('undobtn'), pop = document.getElementById('undopop'), cnt = document.getElementById('undocount'); if (!btn) return;
    var list = Say.undoList();
    var n = list.filter(function (u) { return !u.blocked(); }).length;   /* blocked ones stay listed with the reason, uncounted */
    btn.disabled = !list.length; cnt.textContent = n ? String(n) : '';
    if (!list.length) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); pop.innerHTML = ''; return; }
    /* Each one undoes on its own. One that can't any more stays listed, dimmed, with the reason. */
    pop.innerHTML = '<h2>Recent actions</h2><ul class="undolist">' + list.map(function (u, i) {
      var why = u.blocked();
      return '<li><button type="button" data-undo="' + i + '"' + (why ? ' aria-disabled="true" class="u-blocked"' : '') + '><span class="u-l">' + esc(u.label) + '</span><span class="u-m">' + (why ? esc(why) : ago(u.at)) + '</span></button></li>';
    }).join('') + '</ul>';
  }
  /* The theme choices on the Settings page: the eight, Random, then the specials */
  function themePicks(attr) {
    var mode = Themes.resolveMode(prefs.mode);
    function sw(p) { return '<span class="pal-sw" style="background:' + p.bg + ';border-color:' + p.line + '"><i style="background:' + p.accent + '"></i><i style="background:' + p.link + '"></i><i style="background:' + p.ink + '"></i></span>'; }
    function pick(t) {
      var on = t.id === prefs.theme;
      return '<button type="button" class="pal" ' + attr + '="' + t.id + '" aria-pressed="' + on + '">' + sw(Themes.palette(t.id, mode, prefs.contrast)) + '<span class="pal-n">' + esc(t.name) + '</span><span class="pal-f">' + esc(t.note) + '</span></button>';
    }
    var picks = Themes.list.filter(function (t) { return !t.special; }).map(pick);
    var rnd = prefs.theme === 'random', today = rnd && Themes.byId(shown);
    var mix = ['honey', 'lagoon', 'plum'].map(function (id) { return Themes.palette(id, mode, prefs.contrast).accent; });
    picks.push('<button type="button" class="pal" ' + attr + '="random" aria-pressed="' + rnd + '"><span class="pal-sw pal-rnd" style="background:' + Themes.palette('terracotta', mode, prefs.contrast).bg + ';border-color:' + Themes.palette('terracotta', mode, prefs.contrast).line + '">' +
      mix.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span><span class="pal-n">Random</span><span class="pal-f">' +
      (today ? 'Today: ' + esc(today.name) : 'A new one each day') + '</span></button>');
    /* The special ones on a line of their own, after a divider: Random never picks them */
    var special = Themes.list.filter(function (t) { return t.special; });
    if (special.length) picks.push('<div class="pal-divider" role="separator"><span>Specials</span><small>Random skips these</small></div>' + special.map(pick).join(''));
    return picks.join('');
  }
  /* ---------- Router ----------
     The hash is #/<route>[/<id>][?query]. The query comes off before the lookup, so #/work?until=15:00 is the work
     route, not an unknown name. Calendar holds already out there carry #tasks/<id>: that opens the task on the Guide. */
  function parse(hash) {
    var h = (hash || '').replace(/^#\/?/, ''), q = '', i = h.indexOf('?');
    if (i > -1) { q = h.slice(i + 1); h = h.slice(0, i); }
    var parts = h.split('/'), params = {};
    q.split('&').forEach(function (kv) {
      if (!kv) return; var j = kv.indexOf('='), k = j < 0 ? kv : kv.slice(0, j), v = j < 0 ? '' : kv.slice(j + 1);
      try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* a bad escape: skip it */ }
    });
    var name = parts[0] || 'guide', arg = parts[1] || null;
    if (name === 'tasks' && arg && /^\d+$/.test(arg)) name = 'work';
    if (!ROUTES[name]) { name = 'guide'; arg = null; }
    return { name: name, arg: arg, params: params };
  }
  function titleFor(name) {
    var dw = DeepWork.label && DeepWork.label();
    return (ROUTES[name].place === 'guide' && dw && (dw.session || dw.wrap) ? 'My work' : ROUTES[name].title) + ' · Fuzz';
  }
  function route(force) {
    var info = parse(location.hash), name = info.name, key = location.hash;
    if (!force && key === currentKey) return;
    var guideToGuide = current && ROUTES[currentName] && ROUTES[currentName].place === 'guide' && ROUTES[name].place === 'guide';
    here = info; currentKey = key;
    toggleUndo(false); toggleMenu(false);
    /* Between the Guide's own routes (the logo from a work link, one work link to another) the view stays mounted
       and takes in the new link; a deep link never ends a session that's running */
    if (!force && guideToGuide && current.arrive) { currentName = name; current.arrive(info); document.title = titleFor(name); paintLabel(); return; }
    /* #/triage → #/triage?until=…: the same page, only the label changes */
    if (!force && name === currentName && name === 'triage') { paintLabel(); return; }
    if (current) current.unmount();
    var main = document.getElementById('view');
    main.innerHTML = '';
    var cls = ROUTES[name].place || name;
    main.className = 'view view--' + cls;
    if (name === 'triage' || name === 'capture') Say.hideDock(); /* Fuzz speaks from the perch there */
    currentName = name; current = ROUTES[name].view;
    document.getElementById('hprog').hidden = name !== 'triage';
    if (cls !== 'guide') document.getElementById('dwprog').hidden = true;
    document.body.dataset.view = cls;
    /* No floating New task button on capture (you're there) or triage (its actions sit at the bottom on phones) */
    document.getElementById('fab').hidden = name !== 'tasks' && name !== 'artifacts';
    current.mount(main, info);
    document.title = titleFor(name);
    paintLabel();
    /* Focus the page heading, unless the view already put focus somewhere useful (New task focuses its field, so N then type just works) */
    if (!force) { var h1 = main.querySelector('h1'); if (h1 && !main.contains(document.activeElement)) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
  }

  /* Fuzz's background work never interrupts. Anything you need to know arrives as a card in the queue; the label's
     dot follows it. */
  Store.on(function () { paintLabel(); });
  /* On Triage, Fuzz celebrates from the perch; anywhere else, the small Fuzz says it */
  Store.on(function (e) { if (e.type === 'wrapped' && currentName !== 'triage') Say.tell('That wraps up ' + e.group.title + '. Every task in it is done.'); });

  /* Capture costs nothing: one key, from anywhere that isn't a text field. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT')) return;
    if (document.querySelector('dialog[open]')) return;
    if (Onboard.blocksCapture()) return;   /* on the onboarding's form, N would skip past what Fuzz needs */
    e.preventDefault(); App.navigate('#/capture');
  });

  /* ---------- Boot ---------- */
  load();
  Themes.apply(shown, prefs.mode, prefs.contrast, prefs.codeFont);
  Themes.onSystemChange(function () { if (prefs.mode === 'auto') Themes.apply(shown, prefs.mode, prefs.contrast, prefs.codeFont); });
  reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  Fuzz.setCalm(prefs.calm || reduce);
  if (reduce && !prefs.calm) prefs.calm = true;
  /* Me shows your real queue from `fuzz serve` (js/live.js), Demo the invented data; js/account.js asks which */
  Live.boot(function () {
    if (!Live.on()) { Store.reset(); Store.startWork(); }
    buildHeader();
    setInterval(paintLabel, 1000);   /* the session's minutes and ring follow the clock */
    /* The onboarding resumes where you left off; the old guided setup stays in Settings. The header
       waits out of sight until it knows, so the intro never flashes it. */
    document.body.classList.add('onb-wait');
    Onboard.start().then(function (hash) {
      if (hash && location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
      window.addEventListener('hashchange', function (e) {
        /* Remember where Settings was opened from, so leaving it goes back there */
        var from = (e.oldURL || '').split('#')[1];
        if (from && from.indexOf('/settings') !== 0) backFrom = '#' + from;
        route(false);
      });
      route(true);
    });
  });
})();
