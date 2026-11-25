/* New (the screen used to be New task). Capture costs nothing (principle 8): type or dictate, no categories, triage happens later.
   Layout comes from the Triage Queue mockup's Capture board. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root, unsub = null, timer = 0, moodTimer = 0, boredTimer = 0, listening = false, attached = [], confirm = '', draft = '', escKey = null, unhold = null, docDrag = null;
  /* New task's +: Series, Person, Source, Artifact and Upload a file (docs/series.md, "Starting one yourself").
     serPick: the series this goes into ({id, name}), or {start: true} to start a new one from it. refs: who it's for
     or about, a message or page Fuzz should read, something Fuzz already made: they join the task's sources. */
  var serPick = null, refs = { people: [], links: [], artifacts: [] }, plusOpen = false, panel = null, panelQ = '', outsideClick = null;
  var found = { people: [], artifacts: null }, findAsk = 0;
  /* Dump mode (docs/dump-mode.md): a mode of this box. dump is the split in front of you ({id, state, items, say}); the
     offer is the quiet "This looks like a few things" line, shown at most once for a draft and never over what you're typing. */
  var dumpOn = false, dump = null, dumpPoll = 0, offerSeen = false;
  var DUMP_GROUPS = [['task', 'To do'], ['later', 'For later'], ['note', 'To keep'], ['done', 'Already done, or not yours']];
  function lineCount(t) { return String(t || '').split('\n').filter(function (l) { return l.trim(); }).length; }
  function looksLikeAFew(t) { return lineCount(t) >= 3; }
  var PLUS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var UP_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>';
  var PERSON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  var LINK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  var FILE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>';
  var X_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var PLUS_ITEMS = [['series', 'Series', 'Put it in one, or start a new one from this'], ['person', 'Person', 'Who it’s for, or who it’s about'],
    ['source', 'Source', 'An email, Slack thread or meeting Fuzz should read'], ['artifact', 'Artifact', 'Something Fuzz already made'],
    ['upload', 'Upload a file', 'Or drop it on the box']];
  function plusIcon(k) { return { series: SeriesView.ICON, person: PERSON_SVG, source: LINK_SVG, artifact: FILE_SVG, upload: UP_SVG }[k]; }
  /* Back to the + list, at the top of every panel; it stays put while the panel scrolls */
  var BACK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  function backHTML(what) { return '<button type="button" class="plusback" data-plusback aria-label="Back to the list">' + BACK_SVG + '<b>' + what + '</b></button>'; }
  function roleShort(s) { return s.role_label ? s.role_label.replace(/ it$/, '') : ''; }
  function emptyRefs() { return { people: [], links: [], artifacts: [] }; }
  /* The Series panel: find one, start a new one from this, one Fuzz has been watching, or one of yours */
  function seriesPanelHTML() {
    var all = Store.seriesList(), q = panelQ.trim().toLowerCase();
    var match = function (s) { return !q || s.name.toLowerCase().indexOf(q) > -1; };
    var watching = all.filter(function (s) { return s.section === 'watching' && match(s); });
    var yours = all.filter(function (s) { return ['new', 'going', 'quiet'].indexOf(s.section) > -1 && match(s); });
    var row = function (s, sub) { return '<button type="button" role="menuitem" class="opt" data-serpick="' + s.id + '"><span><b>' + esc(s.name) + '</b><small>' + esc(sub) + '</small></span></button>'; };
    return '<div class="cap-series" id="cap-series"><div class="cap-phead">' + backHTML('Series') + '<label class="sr" for="cap-q">Find a series</label><input id="cap-q" class="fld" type="search" autocomplete="off" placeholder="Find a series" value="' + esc(panelQ) + '"></div>' +
      '<button type="button" role="menuitem" class="opt" data-serstart><span><b>Start a new series from this</b><small>Fuzz gathers the tasks, people and places that go with it. You check them in Triage.</small></span></button>' +
      (watching.length ? '<p class="grp">Fuzz has been watching</p>' + watching.map(function (s) { return row(s, (s.open + s.done) + ' tasks look like the same thing. Start from these.'); }).join('') : '') +
      (yours.length ? '<p class="grp">Your series</p>' + yours.map(function (s) { return row(s, [roleShort(s), s.section === 'quiet' ? 'quiet' : s.section === 'new' ? 'waiting for your OK' : ''].filter(Boolean).join(' · ')); }).join('') : '') +
      (q && !watching.length && !yours.length ? '<p class="meta">No series called that. Start a new one from this?</p>' : '') + '</div>';
  }
  /* Person: someone Fuzz knows (or a name you type), and whether it's for them or about them */
  function personPanelHTML() {
    var q = panelQ.trim(), list = found.people || [];
    var row = function (p, i) {
      return '<div class="opt cap-person"><span><b>' + esc(p.name) + '</b>' + (p.email ? '<small>' + esc(p.email) + '</small>' : '') + '</span>' +
        '<span class="scard-acts"><button type="button" class="btn small" data-person="' + i + '" data-role="for">For them</button><button type="button" class="btn small" data-person="' + i + '" data-role="about">About them</button></span></div>';
    };
    return '<div class="cap-series" id="cap-series"><div class="cap-phead">' + backHTML('Person') + '<label class="sr" for="cap-q">Find a person</label><input id="cap-q" class="fld" type="search" autocomplete="off" placeholder="A name or an email" value="' + esc(panelQ) + '"></div>' +
      list.map(row).join('') + (q && !list.some(function (p) { return p.name.toLowerCase() === q.toLowerCase(); }) ? row({ name: q, email: /@/.test(q) ? q : '' }, -1) : '') +
      (!q && !list.length ? '<p class="meta">Type a name. Fuzz suggests the people it knows.</p>' : '') + '</div>';
  }
  /* Source: the link to an email, a Slack thread, a meeting's notes or a page */
  function sourcePanelHTML() {
    return '<form class="cap-series" id="cap-series" data-form="source"><div class="cap-phead">' + backHTML('Source') + '</div><label class="cap-flabel" for="cap-q">A link Fuzz should read</label><input id="cap-q" class="fld" type="url" autocomplete="off" placeholder="https://… (an email, a Slack thread, a meeting’s notes)" value="' + esc(panelQ) + '">' +
      '<p class="meta">Fuzz reads it with your task. Copy the link from Outlook, Slack or the notes.</p><button class="btn small primary">Add it</button></form>';
  }
  /* Artifact: something Fuzz already wrote, for this task to build on */
  function artifactPanelHTML() {
    var q = panelQ.trim().toLowerCase(), list = found.artifacts;
    var body = list === null ? '<p class="meta">Looking…</p>' : !list.length ? '<p class="meta">Fuzz hasn’t made anything yet.</p>' :
      list.filter(function (a) { return !q || (a.name + ' ' + a.task).toLowerCase().indexOf(q) > -1; }).slice(0, 8).map(function (a, i) {
        return '<button type="button" role="menuitem" class="opt" data-artifact="' + esc(a.id) + '"><span><b>' + esc(a.name) + '</b><small>For ' + esc(a.task || 'a task') + '</small></span></button>';
      }).join('');
    return '<div class="cap-series" id="cap-series"><div class="cap-phead">' + backHTML('Artifact') + '<label class="sr" for="cap-q">Find something Fuzz made</label><input id="cap-q" class="fld" type="search" autocomplete="off" placeholder="Find something Fuzz made" value="' + esc(panelQ) + '"></div>' + body + '</div>';
  }
  function plusHTML() {
    var body = panel === 'series' ? seriesPanelHTML() : panel === 'person' ? personPanelHTML() : panel === 'source' ? sourcePanelHTML()
      : panel === 'artifact' ? artifactPanelHTML() : PLUS_ITEMS.map(function (x) {
        return '<button type="button" role="menuitem" class="opt" data-plus="' + x[0] + '">' + plusIcon(x[0]) + '<span><b>' + x[1] + '</b><small>' + x[2] + '</small></span></button>';
      }).join('');
    return Composer.plus({ btnId: 'cap-plus', menuId: 'cap-plusmenu', cls: 'cap-plus', open: plusOpen, label: 'Add a series, a person, a source or a file', body: body });
  }
  function chip(icon, label, what, i) {
    return '<li class="file serpick">' + icon.replace(/width="20" height="20"/, 'width="16" height="16"') + '<span>' + esc(label) + '</span>' +
      '<button type="button" class="iconbtn" data-unpick="' + what + '" data-i="' + i + '" aria-label="Take off: ' + esc(label) + '">' + X_SVG + '</button></li>';
  }
  function pickHTML() {
    var h = serPick ? chip(SeriesView.ICON, serPick.start ? 'New series from this' : 'Part of ' + serPick.name, 'series', 0) : '';
    refs.people.forEach(function (p, i) { h += chip(PERSON_SVG, (p.role === 'about' ? 'About ' : 'For ') + p.name, 'people', i); });
    refs.links.forEach(function (l, i) { h += chip(LINK_SVG, l.replace(/^https?:\/\//, '').slice(0, 60), 'links', i); });
    refs.artifacts.forEach(function (a, i) { h += chip(FILE_SVG, a.name, 'artifacts', i); });
    return h;
  }
  var IDLE_LINE = 'Get it out of your head. I’ll sort it later.';

  function statusFor(c) {
    var it = c.ref ? Store.item(c.ref) : null;
    if (!it) return { text: c.status || 'Waiting in triage', tone: c.tone || 'muted' };
    var map = {
      triage: it.capturedAt && Date.now() - it.capturedAt < 6000 ? ['Fuzz is gathering context', 'accent'] : ['Waiting in triage', 'muted'],
      working: ['Fuzz is working on it', 'accent'], 'queued': ['Next up with Fuzz', 'muted'], review: ['Draft ready for your OK', 'warn'], mine: ['With you', 'muted'], session: ['Open in ' + Store.workIn, 'muted'],
      scheduled: ['Scheduled', 'muted'], parked: ['Parked', 'muted'], waiting: ['Waiting on others', 'warn'], done: ['Done', 'ok'], letgo: ['Let go', 'muted'], dropped: ['Dropped', 'muted'], resolved: ['Done', 'ok']
    };
    var m = it.gathering ? ['Fuzz is gathering context', 'accent'] : map[it.state] || ['Waiting in triage', 'muted'];
    if (c.doc && it.state === 'triage') m = ['Added to triage with the document', 'ok'];
    return { text: m[0], tone: m[1] };
  }

  function listHTML() {
    return Store.get().captured.map(function (c) {
      var s = statusFor(c);
      return '<li class="cap-item"><span class="cap-text">' + (c.doc ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>' : '') + esc(c.text) + '</span>' +
        '<span class="cap-meta">' + UI.pill(s.text, s.tone) + '<span>' + esc(c.time) + '</span></span></li>';
    }).join('');
  }
  function attachedHTML() {
    return attached.map(function (f, i) {
      var n = f.name;
      return '<li class="file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg><span>' + esc(n) + '</span>' +
        '<button type="button" class="iconbtn" data-rm="' + i + '" aria-label="Remove ' + esc(n) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>';
    }).join('');
  }

  V.mount = function (container, info) {
    root = container; listening = false; confirm = '';
    /* The Series page's Start a series: it opens with New series from this already picked */
    var startSeries = !!(info && info.params && info.params.series === 'start');
    if (startSeries) serPick = { start: true };
    /* The first New task screen teaches dictation; during the onboarding, Esc leads back to it */
    var ob = Onboard.onCapture();
    /* Same shape as Triage: the full Fuzz on a perch with his speech bubble, then one card.
       He's for looking at; the capture confirmation reaches screen readers through Say.announce. */
    root.innerHTML = '<section class="capture" aria-labelledby="cap-h"><div class="stage cap-stage" id="stage">' +
      '<div class="fx" id="fx"></div>' +
      '<div class="perch" id="perch"><div class="pwrap" id="pwrap" aria-hidden="true">' + window.FUZZ_SVG + '</div><div class="bubble" id="bubble"></div></div>' +
      '<div class="card cap-card">' +
        '<h1 id="cap-h" class="cap-title">What is on your mind?</h1>' +
        /* The same box as Tell Fuzz on a Triage card: the field, with + and the mic inside it and what you added
           beside them. The field has focus; while a file is dragged over the page, the box is the drop zone. */
        '<div id="cap-compose"><div class="cap-drop instr" id="drop"><label class="sr" for="cap-text">New</label>' +
          Composer.box({ id: 'cap-text', rows: 4, placeholder: 'For example: send Sam the slides from Tuesday', describedBy: ob && ob.tip ? 'cap-tip' : '',
            tools: Composer.bar({ plus: '<span class="cap-plusrow" id="cap-plusrow">' + plusHTML() + '</span>', mic: { for: 'cap-text', label: 'Dictate', id: 'cap-mic' },
              after: '<ul class="files" id="files" aria-label="Attached documents and the series"></ul>' }),
            typing: [['⌘ Enter', 'Capture'], ['Esc', 'Back']] }) +
          '<div class="cap-dropzone" aria-hidden="true"><b>Drop it here</b><small>Fuzz reads it along with your task.</small></div>' +
          '<input type="file" id="file" multiple hidden></div>' +
        /* The quiet offer: a reserved line, so it never moves what you're typing. Never takes focus. */
        '<p class="cap-offer" id="cap-offer" aria-live="polite"></p>' +
        (ob && ob.tip && Dictate.supported ? '<p class="cap-tip" id="cap-tip">' + Fuzz.mini('good', { cls: 'tip-fz' }) + '<span>' + esc(ob.tip) + '</span></p>' : '') +
        '<div class="actions cap-actions"><button type="button" class="btn primary" id="cap-go" disabled><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Capture</button>' +
          (Live.on() ? '<button type="button" role="switch" aria-checked="false" class="cap-switch" id="cap-dumpmode" title="Pour it all out: Fuzz splits it into a short list, and nothing is made until you keep it"><span class="cap-track" aria-hidden="true"><span class="cap-knob"></span></span><span>Dump mode</span></button>' : '') +
          '</div></div>' +
        '<div id="cap-review" class="cap-review" hidden></div>' +
      '</div></div>' +
      '<section class="recent"><h2>Captured recently</h2><ul class="cap-list" id="cap-list"></ul>' +
        '<p class="fine">Tasks from email, Slack and meetings arrive in triage on their own, so you only need to capture the ones that start in your head.</p></section></section>';
    var $ = function (s) { return root.querySelector(s); };
    var ta = $('#cap-text'), go = $('#cap-go');
    function sync() { go.disabled = ta.value.trim() === '' && attached.length === 0; }
    function paintFiles() { $('#files').innerHTML = pickHTML() + attachedHTML(); sync(); }
    function paintPlus() { $('#cap-plusrow').innerHTML = plusHTML(); }
    function closePlus(focus) { plusOpen = false; panel = null; panelQ = ''; paintPlus(); if (focus) $('#cap-plus').focus(); }
    function backToList() { panel = null; panelQ = ''; paintPlus(); var f = root.querySelector('#cap-plusmenu [data-plus="series"]'); if (f) f.focus(); }
    function picked(say) { closePlus(); paintFiles(); ta.focus(); if (say) Fuzz.say(say, { type: false }); }
    /* People and artifacts come from the core (live) or the demo's own */
    function findPeople() {
      var ask = ++findAsk, q = panelQ.trim();
      var done = function (list) { if (ask === findAsk && panel === 'person') { found.people = list; paintPanelKeepingFocus(); } };
      if (Live.on()) Live.people(q).then(function (r) { done(r.people || []); }, function () { done([]); });
      else {
        var seen = {}, out = [];
        Store.get().items.forEach(function (it) { (it.people || []).forEach(function (p) { if (!seen[p.name] && (!q || p.name.toLowerCase().indexOf(q.toLowerCase()) > -1)) { seen[p.name] = true; out.push({ name: p.name, email: p.email || '' }); } }); });
        done(out.slice(0, 6));
      }
    }
    function findArtifacts() {
      found.artifacts = null;
      if (!Live.on()) { found.artifacts = (window.Samples || []).map(function (s) { return { id: s.id, name: s.name, task: s.taskTitle || '' }; }); return; }
      Live.artifacts().then(function (r) {
        found.artifacts = (r.artifacts || []).filter(function (a) { return a.role !== 'memory' && /^\d+$/.test(String(a.source_id)); })
          .map(function (a) { return { id: a.source_id, name: a.name, task: a.task && a.task.title }; });
        if (panel === 'artifact') paintPanelKeepingFocus();
      }, function () { found.artifacts = []; if (panel === 'artifact') paintPanelKeepingFocus(); });
    }
    function paintPanelKeepingFocus() {
      var q = $('#cap-q'), had = q && document.activeElement === q, pos = q ? q.selectionStart : 0;
      paintPlus();
      var n = $('#cap-q'); if (n && had) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* a url field has no selection */ } }
    }
    /* New task's +: Series (pick one, or start one from this), Person, Source, Artifact and Upload a file */
    $('#cap-plusrow').addEventListener('click', function (e) {
      if (e.target.closest('#cap-plus')) { plusOpen = !plusOpen; panel = null; panelQ = ''; paintPlus(); var f = root.querySelector('#cap-plusmenu [role="menuitem"]'); if (plusOpen && f) f.focus(); return; }
      if (e.target.closest('[data-plusback]')) { backToList(); return; }
      var p = e.target.closest('[data-plus]');
      if (p && p.dataset.plus === 'upload') { closePlus(); $('#file').click(); return; }
      if (p) {
        panel = p.dataset.plus; panelQ = '';
        if (panel === 'person') { found.people = []; findPeople(); }
        if (panel === 'artifact') findArtifacts();
        paintPlus(); var q = $('#cap-q'); if (q) q.focus(); return;
      }
      if (e.target.closest('[data-serstart]')) { serPick = { start: true }; picked('Capture it and I’ll gather what goes with it. You check it in Triage.'); return; }
      var sp = e.target.closest('[data-serpick]');
      if (sp) { var s = Store.seriesById(+sp.dataset.serpick); if (s) serPick = { id: s.id, name: s.name }; picked(); return; }
      var pp = e.target.closest('[data-person]');
      if (pp) {
        var i = +pp.dataset.person, who = i < 0 ? { name: panelQ.trim(), email: /@/.test(panelQ) ? panelQ.trim() : '' } : found.people[i];
        if (who && who.name) refs.people.push({ name: who.name, email: who.email || '', role: pp.dataset.role });
        picked(); return;
      }
      var ap = e.target.closest('[data-artifact]');
      if (ap) {
        var a = (found.artifacts || []).filter(function (x) { return String(x.id) === ap.dataset.artifact; })[0];
        if (a && !refs.artifacts.some(function (x) { return x.id === a.id; })) refs.artifacts.push(a);
        picked('I’ll build on that one.'); return;
      }
    });
    $('#cap-plusrow').addEventListener('submit', function (e) {
      if (!e.target.closest('[data-form="source"]')) return;
      e.preventDefault();
      var url = ($('#cap-q').value || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { Fuzz.say('That needs to be a full link, starting with https://', { type: false }); $('#cap-q').focus(); return; }
      if (refs.links.indexOf(url) < 0) refs.links.push(url);
      picked('I’ll read that with your task.');
    });
    $('#cap-plusrow').addEventListener('input', function (e) {
      if (e.target.id !== 'cap-q') return;
      panelQ = e.target.value;
      if (panel === 'person') findPeople();
      else if (panel !== 'source') paintPanelKeepingFocus();
    });
    $('#files').addEventListener('click', function (e) {
      var u = e.target.closest('[data-unpick]'); if (!u) return;
      if (u.dataset.unpick === 'series') serPick = null; else refs[u.dataset.unpick].splice(+u.dataset.i, 1);
      paintFiles(); ta.focus();
    });
    outsideClick = function (e) { if (plusOpen && !e.target.closest('.cap-plus')) closePlus(); };
    document.addEventListener('click', outsideClick);
    function paintList() { $('#cap-list').innerHTML = listHTML(); }
    /* What you've typed survives leaving the page, so Esc never costs you a half-written thought. */
    ta.value = draft;
    ta.addEventListener('input', function (e) { draft = ta.value; sync(); nudge(); if (confirm) { confirm = ''; paintSay(); } maybeOffer(e); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    function paintSay() { Fuzz.say(confirm || (ob && ob.back ? 'One real thing on your plate. I’m listening.' : IDLE_LINE), { type: false }); }
    /* Mood for a moment, then back to idle (unless something else has changed it since). */
    function moodFor(m, ms) {
      clearTimeout(moodTimer); Fuzz.setMood(m);
      moodTimer = setTimeout(function () { if (Fuzz.mood() === m) Fuzz.setMood('idle'); }, ms);
    }
    /* Left alone with an empty field, he goes back to surfing channels. Any activity wakes him. */
    function nudge() {
      clearTimeout(boredTimer);
      if (Fuzz.mood() === 'bored') { Fuzz.setMood('idle'); paintSay(); }
      boredTimer = setTimeout(function () { if (Fuzz.mood() === 'idle' && !ta.value.trim() && !attached.length && !listening) Fuzz.startBored(); }, 30000);
    }
    function addFiles(list) {
      if (!list || !list.length) return;
      Array.prototype.forEach.call(list, function (f) { attached.push(f); }); paintFiles();
      nudge(); Fuzz.pAnim('gulp'); moodFor('eager', 1400);
      Fuzz.say(list.length === 1 ? 'Ooh, reading material. I’ll look at it with your task.' : 'A whole stack. I’ll read them with your task.', { type: false });
    }
    $('#file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    /* Drag a file anywhere over the page and the box turns into a drop zone; it lights up under the file */
    var drop = $('#drop'), depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
    function endDrag() { depth = 0; root.classList.remove('cap-dragging'); drop.classList.remove('over'); }
    docDrag = {
      dragenter: function (e) { if (!hasFiles(e)) return; e.preventDefault(); if (depth++ === 0) { root.classList.add('cap-dragging'); nudge(); Fuzz.setMood('eager'); } },
      dragover: function (e) { if (!hasFiles(e)) return; e.preventDefault(); var on = drop.contains(e.target); e.dataTransfer.dropEffect = on ? 'copy' : 'none'; drop.classList.toggle('over', on); },
      dragleave: function (e) { if (hasFiles(e) && --depth <= 0) endDrag(); },
      drop: function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault(); var on = drop.contains(e.target); endDrag();
        if (on) addFiles(e.dataTransfer.files);
        else Fuzz.say('Drop it on the box and I’ll read it with your task.', { type: false });
      }
    };
    Object.keys(docDrag).forEach(function (n) { window.addEventListener(n, docDrag[n]); });
    $('#files').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (!b) return; attached.splice(parseInt(b.dataset.rm, 10), 1); paintFiles(); });

    /* Dictation (dictate.js): the button starts and stops it, and holding Alt (Option) + Space listens
       only while held. What you say lands after what you'd typed, words appearing as you talk. */
    var mic = $('#cap-mic');
    function opts() {
      nudge(); clearTimeout(moodTimer);
      return { done: 'Got all of that. Capture it when you’re ready.', onChange: function (on) { if (!on) maybeOffer(); listening = on; mic.setAttribute('aria-pressed', String(on)); mic.setAttribute('aria-label', on ? 'Listening… (press to stop)' : 'Dictate'); } };
    }
    mic.addEventListener('click', function () { if (Dictate.active()) Dictate.stop(); else Dictate.start(ta, opts()); });
    unhold = Dictate.hold(function () { return ta; }, opts);

    /* ---- Dump mode */
    function paintOffer() {
      var o = $('#cap-offer'); if (!o) return;
      o.innerHTML = offerSeen && !dumpOn && !dump && ta.value.trim() ? '<span>This looks like a few things.</span> <button type="button" class="linkbtn inline" id="cap-split">Split it?</button>' : '';
    }
    /* It lands with a paste, a line break or dictation, never mid-word, and then it stays until you act or clear the box */
    function maybeOffer(e) {
      if (!Live.on() || dumpOn || dump) return;
      if (!ta.value.trim()) { offerSeen = false; paintOffer(); return; }
      if (offerSeen || !looksLikeAFew(ta.value)) return;
      if (e && e.inputType === 'insertText') return;
      offerSeen = true; paintOffer();
    }
    function paintMode() {
      var b = $('#cap-dumpmode'); if (b) b.setAttribute('aria-checked', String(dumpOn));
      go.lastChild.textContent = dumpOn ? 'Sort it out' : 'Capture';
      ta.placeholder = dumpOn ? 'Everything on your mind, in any order. I’ll sort it.' : 'For example: send Sam the slides from Tuesday';
      paintOffer();
    }
    function showReview(on) { $('#cap-compose').hidden = on; $('#cap-review').hidden = !on; }
    function stopDumpPoll() { clearInterval(dumpPoll); dumpPoll = 0; }
    function backToText() {
      stopDumpPoll();
      var old = dump; dump = null; showReview(false); paintMode();
      if (old && old.id) Live.dumpDiscard(old.id);
      ta.focus(); paintSay();
    }
    function reviewHTML() {
      var d = dump, back = '<button type="button" class="btn" data-dump="back">Back to my text</button>';
      if (d.state === 'splitting') return '<h1 class="cap-title">Reading it…</h1><p class="meta">Nothing is lost. Your words are kept just as you wrote them.</p><div class="actions">' + back + '</div>';
      if (d.state === 'failed') return '<h1 class="cap-title">I couldn’t sort that this time</h1><p class="meta">Your words are safe. ' + esc(d.error || '') + '</p><div class="actions"><button type="button" class="btn primary" data-dump="retry">Try again</button><button type="button" class="btn" data-dump="one">Add it as one task</button>' + back + '</div>';
      var items = d.items || [];
      var groups = DUMP_GROUPS.map(function (g) {
        var rows = items.filter(function (i) { return i.group === g[0]; });
        return !rows.length ? '' : '<section class="cap-group" aria-labelledby="cap-g-' + g[0] + '"><h2 id="cap-g-' + g[0] + '" class="grp">' + g[1] + '</h2><ul class="cap-ditems">' + rows.map(function (i) {
          return '<li><label class="cap-ditem"><input type="checkbox" data-item="' + i.id + '"' + (i.keep ? ' checked' : '') + '><span>' + esc(i.text) + '</span></label></li>';
        }).join('') + '</ul></section>';
      }).join('');
      return '<h1 class="cap-title" id="cap-rh" tabindex="-1">Here’s how I’d keep it</h1>' + (items.length ? groups : '<p class="meta">There was nothing to do in it, and it’s all kept.</p>') +
        '<div class="actions cap-ractions"><button type="button" class="btn primary" id="cap-keep" data-dump="keep">Keep these</button>' + back + '<button type="button" class="btn" data-dump="one">Add it as one task</button></div>' +
        Composer.field({ id: 'cap-change', label: 'Tell Fuzz to change it', rows: 2, placeholder: 'For example: make the dentist a note',
          tools: Composer.bar({ mic: { for: 'cap-change', label: 'Dictate', id: 'cap-change-mic' }, after: '<button type="button" class="btn small" data-dump="change">Change it</button>' }),
          typing: [['⌘ Enter', 'Change it'], ['Esc', 'Back to my text']] });
    }
    function paintReview() {
      showReview(true); $('#cap-review').innerHTML = reviewHTML();
      if (dump.state === 'ready') { Fuzz.say(dump.say || 'I’ve got all of it. Here’s how I’d keep it.', { type: false }); Fuzz.setMood('happy'); var k = $('#cap-keep'); if (k) k.focus(); }
      else if (dump.state === 'splitting') { Fuzz.setMood('thinking'); Fuzz.say('Reading it now. Nothing is lost.', { type: false }); }
      else Fuzz.say('I couldn’t sort that one. Your words are safe.', { type: false });
    }
    function pollDump() {
      stopDumpPoll();
      var id = dump && dump.id, deep = dump && dump.deep;
      dumpPoll = setInterval(function () {
        Live.dumpGet(id).then(function (r) {
          if (!dump || dump.id !== id) return;
          if (r.state === 'splitting') return;
          stopDumpPoll();
          if (deep) {   /* Focus time: no review, the items were made as it came back */
            dump = null; Live.sync();
            confirm = r.state === 'committed' ? 'Sorted. It’s in your Focus time.' : 'I couldn’t sort that one. Your words are safe.'; paintSay(); Say.announce(confirm); return;
          }
          dump = r; dump.deep = false; paintReview();
        }, function () { /* a blip: the next poll tries again */ });
      }, 1200);
    }
    function startDump(text) {
      var deep = !!(window.DeepWorkView && DeepWorkView.active && DeepWorkView.active());
      Live.dumpStart(text, deep).then(function (r) {
        offerSeen = false; Dictate.abort();
        if (deep) { ta.value = ''; draft = ''; sync(); dumpOn = false; paintMode(); dump = { id: r.dump_id, deep: true, state: 'splitting' }; confirm = 'Got it. I’ll put what I find straight into your Focus time.'; paintSay(); Say.announce(confirm); pollDump(); return; }
        dump = { id: r.dump_id, state: 'splitting', deep: false }; paintReview(); pollDump();
      }, function (e) { Fuzz.say(e.message, { type: false }); ta.focus(); });
    }
    function ticked() { return Array.prototype.map.call($('#cap-review').querySelectorAll('input[data-item]:checked'), function (c) { return +c.dataset.item; }); }
    function finishDump(r, one) {
      var n = (r.task_ids || []).length, id = dump && dump.id;
      dump = null; ta.value = ''; draft = ''; attached = []; dumpOn = false; offerSeen = false; sync(); showReview(false); paintFiles(); paintMode();
      confirm = one ? 'Captured. It’s waiting in your triage queue.' : n ? 'Kept. ' + (n === 1 ? 'It’s' : 'They’re') + ' waiting in Triage.' : 'Kept. There was nothing to do in it, and it’s all safe.';
      paintSay(); paintList(); Say.announce(confirm); Fuzz.pAnim('hop'); Fuzz.checkGlyph(1300); moodFor('happy', 1400); ta.focus();
      /* The onboarding's first capture can be a dump: the first task it made goes on to the wait, as a typed one does */
      var first = (r.task_ids || [])[0], made = first && Store.item('t' + first);
      if (made) Onboard.captured(made);
      return id;
    }
    function reviewClick(e) {
      var b = e.target.closest('[data-dump]'); if (!b || !dump) return;
      var what = b.dataset.dump, id = dump.id;
      if (what === 'back') backToText();
      else if (what === 'keep') { b.disabled = true; Live.dumpCommit(id, ticked()).then(function (r) { finishDump(r, false); }, function (er) { b.disabled = false; Fuzz.say(er.message, { type: false }); }); }
      else if (what === 'one') { b.disabled = true; Live.dumpOneTask(id).then(function (r) { finishDump(r, true); }, function (er) { b.disabled = false; Fuzz.say(er.message, { type: false }); }); }
      else if (what === 'retry' || what === 'change') {
        var said = what === 'retry' ? 'Try again.' : ($('#cap-change').value || '').trim();
        if (!said) { $('#cap-change').focus(); return; }
        Live.dumpRevise(id, said).then(function () { dump.state = 'splitting'; paintReview(); pollDump(); }, function (er) { Fuzz.say(er.message, { type: false }); });
      }
    }
    $('#cap-review').addEventListener('click', reviewClick);
    $('#cap-review').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'cap-change') { e.preventDefault(); reviewClick({ target: $('#cap-review [data-dump="change"]') }); } });
    var modeBtn = $('#cap-dumpmode');
    if (modeBtn) modeBtn.addEventListener('click', function (e) { dumpOn = !dumpOn; paintMode(); if (e.detail) ta.focus(); });   /* a mouse click goes back to the words; a key press stays on the switch, so Space flips it back */
    $('#cap-offer').addEventListener('click', function (e) {
      if (!e.target.closest('#cap-split')) return;
      dumpOn = true; paintMode(); submit();   /* taking it keeps your text and shows the split */
    });
    dumpOn = false; dump = null; offerSeen = false;

    function submit() {
      var text = ta.value.trim();
      if (!text && !attached.length) return;
      if (dumpOn && Live.on()) {
        if (!text || attached.length || serPick || refs.people.length || refs.links.length || refs.artifacts.length) {
          Fuzz.say('Dump mode takes only your words. Capture the files and links as a task.', { type: false }); ta.focus(); return;
        }
        return startDump(text);
      }
      var picked = attached.slice(), docs = picked.map(function (f) { return f.name; }), into = serPick, extra = refs;
      if (into && into.start && !text) { Fuzz.say('Say what the series is about first: that note is where Fuzz starts.', { type: false }); ta.focus(); return; }
      var it = Store.capture(text, docs, picked, into, extra);
      serPick = null; refs = emptyRefs();
      Dictate.abort();
      ta.value = ''; draft = ''; attached = []; paintFiles(); offerSeen = false; paintOffer();
      confirm = into && into.start ? 'Captured. I’m gathering the series: check it in Triage.' : into ? 'Captured, part of ' + into.name + '.'
        : docs.length ? 'Captured. I’m reading your ' + (docs.length === 1 ? 'document' : 'documents') + ' now.' : 'Captured. It’s waiting in your triage queue.';
      paintSay(); paintList(); ta.focus(); nudge();
      Say.announce(confirm);
      /* Same little celebration as a triage win: a hop, a check on his screen, a bit of confetti. */
      Fuzz.pAnim('hop'); Fuzz.checkGlyph(1300); Fuzz.confetti(go);
      moodFor(docs.length ? 'thinking' : 'happy', docs.length ? 2600 : 1400);
      /* The onboarding's first task goes on to the wait, where Fuzz says what he's doing with it */
      Onboard.captured(it);
    }
    go.addEventListener('click', submit);
    Fuzz.mount(root, {});
    paintFiles(); paintList(); paintSay(); nudge();
    if (startSeries) Fuzz.say('Say what the series is about. I’ll gather what goes with it, and you check it in Triage.', { type: false });
    unsub = Store.on(function () { paintList(); });
    timer = setInterval(paintList, 2000);
    /* Esc goes back to Triage (an open popover takes Escape first, in app.js). */
    escKey = function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (dump && !dump.deep) { backToText(); return; }   /* in the review, Esc is back to your words */
      if (plusOpen && panel) { backToList(); return; }   /* in a panel, Esc goes back to the list first */
      if (plusOpen) { closePlus(true); return; }
      /* Escape stops listening first, keeping what was heard */
      if (Dictate.active()) Dictate.stop(); else App.navigate(ob && ob.back && Onboard.active() ? ob.back : '#/guide');   /* back to the Guide, like the label says */
    };
    document.addEventListener('keydown', escKey);
    ta.focus();
  };
  V.unmount = function () {
    document.removeEventListener('keydown', escKey);
    if (outsideClick) document.removeEventListener('click', outsideClick); outsideClick = null;
    plusOpen = false; panel = null; panelQ = ''; clearInterval(dumpPoll); dumpPoll = 0;
    if (docDrag) Object.keys(docDrag).forEach(function (n) { window.removeEventListener(n, docDrag[n]); }); docDrag = null;
    if (unhold) unhold(); unhold = null; Dictate.abort(); listening = false;
    if (unsub) unsub(); unsub = null; clearInterval(timer); clearTimeout(moodTimer); clearTimeout(boredTimer);
    Fuzz.unmount(); root = null;
  };

  window.CaptureView = V;
})();
