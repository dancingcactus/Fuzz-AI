/* Fuzz's memory in the app (docs/memory-layers.md):
   - Memory.askHTML / wireAsk: the ask box ("Who is Priya?"), answered by a headless read-only run, on the Artifacts
     page beside the Knowledge files and in the inspector.
   - InspectView (#/inspect, only with ?lab): a read-only view of everything memory holds and why, for building and
     debugging it. Every panel can be copied as JSON for a bug report or a test fixture. Without the core it shows
     js/demo-memory.js, a snapshot of the core's inspector, and leaves out what a snapshot can't answer: the ask
     box, trust as of another date and editing a fact. */
(function () {
  var esc = UI.esc;
  var M = {};
  var LAB = /[?&]lab(=|&|$)/.test(location.search);
  var LEVEL = { confirmed: 'Confirmed', authoritative: 'Official', reported: 'Reported', inferred: 'Fuzz’s guess', stale: 'May be out of date' };
  var TONE = { confirmed: 'ok', authoritative: 'ok', reported: 'muted', inferred: 'warn', stale: 'danger' };

  /* ---------- the ask box ---------- */
  M.askHTML = function () {
    return '<form class="memask" data-memask><label for="memq">Ask Fuzz’s memory</label>' +
      '<div class="memask-row"><input id="memq" type="text" autocomplete="off" maxlength="500" placeholder="Who is Priya? Why did we pick vendor B?">' +
      '<button class="btn small" type="submit">Ask</button></div><div class="memask-a" role="status" aria-live="polite"></div></form>';
  };
  M.wireAsk = function (root) {
    root.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-memask]'); if (!f) return;
      e.preventDefault();
      var q = f.querySelector('input').value.trim(), out = f.querySelector('.memask-a'); if (!q) return;
      out.innerHTML = '<p class="meta">Fuzz is looking…</p>';
      Live.ask(q).then(function (a) {
        var src = (a.sources || []).filter(function (s) { return s && (s.link || s.title); });
        out.innerHTML = '<p>' + esc(a.text) + '</p>' + (src.length ? '<p class="meta">Sources: ' + src.map(function (s) {
          return /^https?:/.test(s.link || '') ? '<a href="' + esc(s.link) + '" target="_blank" rel="noopener">' + esc(s.title || s.link) + '</a>' : esc(s.title || s.link);
        }).join(' · ') + '</p>' : '');
      }, function (err) {
        out.innerHTML = '<p class="meta">' + esc(err.status === 404 ? 'Fuzz’s server is running older code than this page. Restart fuzz serve, then try again.' : err.message) + '</p>';
      });
    });
  };

  /* ---------- the inspector ---------- */
  var V = {}, root = null, tab = 'entities', at = '', filt = { type: '', state: '', q: '' }, picked = null, run = null, panels = {};
  var TABS = [['entities', 'Entities'], ['knowledge', 'Knowledge'], ['decisions', 'Decisions'], ['runs', 'Runs'], ['whynot', 'Why not?'], ['briefs', 'Briefs']];

  /* The inspector reads the core, or in the demo the snapshot, answering the same paths */
  function demo() { return !(window.Live && Live.on()) && window.DemoMemory ? DemoMemory : null; }
  function inspect(path) {
    var D = demo();
    if (!D) return Live.inspect(path);
    var u = new URL(path || '/', location.origin), p = u.pathname, g = function (k) { return u.searchParams.get(k) || ''; }, m, r;
    if (p === '/') r = D.overview;
    else if (p === '/entities') {
      var want = g('q').toLowerCase();
      r = Object.assign({}, D.entities, { entities: D.entities.entities.filter(function (e) {
        var d = D.entity[e.id], hay = [e.name].concat(d.aliases, d.identifiers.map(function (i) { return i.value; })).join(' ').toLowerCase();
        return (!g('type') || e.type === g('type')) && (!g('state') || e.flags.indexOf(g('state')) > -1) && (!want || hay.indexOf(want) > -1);
      }) });
    }
    else if ((m = p.match(/^\/entities\/(\d+)$/))) r = D.entity[m[1]];
    else if (p === '/why_not') r = D.why_not[g('a') + '-' + g('b')];
    else if ((m = p.match(/^\/runs\/(\d+)$/))) r = D.run[m[1]];
    else r = { '/knowledge': D.knowledge, '/decisions': D.decisions, '/runs': D.runs, '/briefs': D.briefs }[p];
    if (!r) return Promise.reject(new Error(p === '/why_not' ? 'The demo has no two entities with those numbers.' : 'The demo has nothing for that.'));
    return Promise.resolve(JSON.parse(JSON.stringify(r)));
  }

  function q(o) { var p = Object.keys(o).filter(function (k) { return o[k]; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }); return p.length ? '?' + p.join('&') : ''; }
  function atIso() { return at ? at + 'T12:00:00Z' : ''; }
  function pill(level) { return '<span class="pill pill--' + (TONE[level] || 'muted') + '">' + esc(LEVEL[level] || level) + '</span>'; }
  function copyBtn(key) { return '<button type="button" class="btn small" data-copy="' + key + '">Copy as JSON</button>'; }
  function when(t) { return t ? esc(String(t).replace('T', ' ').replace(/(:\d\d)(\.\d+)?(Z|\+00:00)$/, '$1')) : ''; }
  function link(href, text) { return /^https?:/.test(href || '') ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text || 'source') + '</a>' : esc(text === 'link' ? '' : text || ''); }
  function fail(e) { return '<p class="lempty">' + esc(e.status === 404 ? 'This server has no inspector yet: it’s running older code than this page. Restart fuzz serve.' : e.message) + '</p>'; }

  function paint() {
    if (!root) return;
    root.innerHTML = '<div class="tasks-head"><h1>Inspector</h1><p class="meta">Everything Fuzz’s memory holds, and why. Looking here changes nothing.</p></div>' +
      '<div class="insp-top"><div class="insp-counts" id="insp-counts"></div>' +
      (demo() ? '<span class="meta">Demo: an invented first week. The ask box, trust as of another date and editing need Fuzz running.</span></div>'
        : '<label class="insp-at">Trust as of <input type="date" id="insp-at" value="' + esc(at) + '"></label></div>' + M.askHTML()) +
      '<div class="segrow" role="tablist" aria-label="Inspector">' + TABS.map(function (t) {
        return '<button type="button" class="seg" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '" aria-pressed="' + (t[0] === tab) + '">' + t[1] + '</button>';
      }).join('') + '</div><div id="insp-body" class="insp-body"><p class="lempty">Loading…</p></div>';
    inspect('').then(function (o) {
      var c = document.getElementById('insp-counts'); if (!c) return;
      c.innerHTML = [['entities', 'entities'], ['facts', 'live facts'], ['knowledge', 'knowledge'], ['decisions', 'decisions'], ['open_cards', 'cards open'], ['held_by_cap', 'held by the cap'], ['refusals', 'refused']]
        .map(function (k) { return '<span class="pill pill--muted">' + esc(String(o[k[0]])) + ' ' + k[1] + '</span>'; }).join('');
    }, function () {});
    body();
  }

  function setBody(html) { var b = document.getElementById('insp-body'); if (b) b.innerHTML = html; }

  function body() {
    if (tab === 'entities') return entities();
    if (tab === 'knowledge') return inspect('/knowledge').then(function (r) { panels.knowledge = r; setBody(copyBtn('knowledge') + knowledgeHTML(r.knowledge)); }, function (e) { setBody(fail(e)); });
    if (tab === 'decisions') return inspect('/decisions').then(function (r) { panels.decisions = r; setBody(copyBtn('decisions') + decisionsHTML(r.decisions)); }, function (e) { setBody(fail(e)); });
    if (tab === 'runs') return runs();
    if (tab === 'whynot') return setBody('<form class="insp-form" data-whynot><label>Entity <input name="a" inputmode="numeric" required></label><label>and entity <input name="b" inputmode="numeric" required></label>' +
      '<button class="btn small" type="submit">Why no “same person?” card</button></form><div id="insp-why"></div>');
    if (tab === 'briefs') return inspect('/briefs').then(function (r) { panels.briefs = r; setBody(copyBtn('briefs') + briefsHTML(r)); }, function (e) { setBody(fail(e)); });
  }

  /* Entities: a list with filters, and the one you picked in full */
  function entities() {
    var head = '<form class="insp-form" data-filter><label>Search <input name="q" value="' + esc(filt.q) + '" placeholder="Name, alias, email"></label>' +
      '<label>Type <select name="type">' + ['', 'person', 'org', 'tool', 'term', 'document', 'ticket'].map(function (t) { return '<option value="' + t + '"' + (t === filt.type ? ' selected' : '') + '>' + (t || 'Any') + '</option>'; }).join('') + '</select></label>' +
      '<label>Only <select name="state">' + ['', 'provisional', 'stale', 'disputed', 'merged', 'thin', 'undefined'].map(function (t) { return '<option value="' + t + '"' + (t === filt.state ? ' selected' : '') + '>' + (t || 'All') + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn small" type="submit">Show</button></form>';
    inspect('/entities' + q({ type: filt.type, state: filt.state, q: filt.q, at: atIso() })).then(function (r) {
      panels.entities = r;
      var list = r.entities.length ? '<ul class="insp-list">' + r.entities.map(function (e) {
        return '<li><button type="button" class="insp-row' + (picked === e.id ? ' on' : '') + '" data-entity="' + e.id + '"><span class="insp-name">' + esc(e.name) + '</span>' +
          '<span class="meta">#' + e.id + ' · ' + esc(e.type) + ' · ' + e.facts + ' facts · seen ' + e.sightings + '×</span>' +
          '<span class="insp-flags">' + e.flags.map(function (f) { return '<span class="pill pill--' + (f === 'disputed' ? 'danger' : f === 'stale' ? 'warn' : 'muted') + '">' + esc(f) + '</span>'; }).join('') + '</span></button></li>';
      }).join('') + '</ul>' : '<p class="lempty">Nothing matches.</p>';
      setBody(head + copyBtn('entities') + '<div class="insp-split"><div>' + list + '</div><div id="insp-detail">' + (picked ? '<p class="lempty">Loading…</p>' : '<p class="lempty">Pick one to see its facts, sources and history.</p>') + '</div></div>');
      if (picked) detail(picked);
    }, function (e) { setBody(head + fail(e)); });
  }

  function detail(id) {
    picked = id;
    inspect('/entities/' + id + q({ at: atIso() })).then(function (d) {
      panels.entity = d;
      var e = d.entity, el = document.getElementById('insp-detail'); if (!el) return;
      var h = '<div class="insp-card"><h2>' + esc(e.display_name) + ' <span class="meta">#' + e.id + ' · ' + esc(e.type) + (e.provisional ? ' · provisional' : '') + '</span></h2>' + copyBtn('entity');
      if (d.follows_to.length) h += '<p class="meta">Merged into #' + d.follows_to.join(' → #') + '</p>';
      if (d.merged_in.length) h += '<p class="meta">Holds the facts of #' + d.merged_in.join(', #') + ' (merged in)</p>';
      h += '<p class="meta">Aliases: ' + esc(d.aliases.join(', ') || 'none') + (d.identifiers.length ? ' · ' + d.identifiers.map(function (i) { return esc(i.type + ': ' + i.value); }).join(', ') : '') + '</p>';
      if (d.entity_links.length) h += '<p class="meta">Kept separate from #' + d.entity_links.map(function (l) { return l.a === e.id ? l.b : l.a; }).join(', #') + '</p>';
      h += '<h3>Facts</h3>' + (d.facts.length ? '<div class="insp-table" role="table">' + d.facts.map(factHTML).join('') + '</div>' : '<p class="meta">None yet.</p>');
      if (!demo()) h += '<form class="insp-form" data-edit="' + e.id + '"><label>Edit: attribute <input name="attr" required placeholder="role, team, definition…"></label><label>value <input name="value" required></label>' +
        '<button class="btn small" type="submit">Save as confirmed</button><span class="meta">This one writes: a fact you confirmed, which Undo takes back.</span></form>';
      if (d.knowledge.length || d.decisions.length) h += '<h3>Knowledge and decisions</h3>' + knowledgeHTML(d.knowledge) + decisionsHTML(d.decisions);
      h += '<h3>Where it came up</h3>' + (d.sightings.length ? '<ul class="insp-mini">' + d.sightings.map(function (s) {
        return '<li><span class="pill pill--muted">' + esc(s.role) + '</span> ' + when(s.ts) + ' ' + esc(s.source || '') + ' ' + link(s.link, s.quote || s.signal_key) + '</li>';
      }).join('') + '</ul>' : '<p class="meta">Nowhere yet.</p>');
      if (d.mentions.length) h += '<h3>On asks</h3><ul class="insp-mini">' + d.mentions.map(function (m) {
        return '<li><span class="pill pill--muted">' + esc(m.strength) + '</span> ' + esc(m.ask || '(an update)') + (m.task_id ? ' · task #' + m.task_id : '') + '</li>';
      }).join('') + '</ul>';
      if (d.cards.length) h += '<h3>Cards</h3><ul class="insp-mini">' + d.cards.map(function (c) {
        return '<li>#' + c.id + ' ' + esc(c.kind) + ' · ' + esc(c.status) + (c.answer ? ' · ' + esc(c.answer.option) : '') + ' · ' + when(c.created_at) + '</li>';
      }).join('') + '</ul>';
      h += '<h3>History</h3>' + (d.events.length ? '<ul class="insp-mini">' + d.events.map(function (v) {
        return '<li>' + when(v.ts) + ' <b>' + esc(v.type) + '</b> by ' + esc(v.actor) + (v.run_id ? ' (run ' + v.run_id + ')' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="meta">No events.</p>');
      el.innerHTML = h + '</div>';
    }, function (err) { var el = document.getElementById('insp-detail'); if (el) el.innerHTML = fail(err); });
  }

  function factHTML(f) {
    var t = f.trust || {}, src = (f.sources || [])[0] || {};
    return '<div class="insp-fact' + (f.state !== 'winner' ? ' dim' : '') + '" role="row">' +
      '<span class="insp-attr" role="cell">' + esc(f.attr) + '</span>' +
      '<span role="cell"><b>' + esc(f.value) + '</b> ' + pill(t.level) + (f.disputed ? ' <span class="pill pill--danger">disputed</span>' : '') +
      (f.state !== 'winner' ? ' <span class="pill pill--muted">' + esc(f.state) + '</span>' : '') + '</span>' +
      '<span class="meta" role="cell">#' + f.id + ' · ' + esc(f.how) + ' · ' + esc(f.authority) + (f.said_by_name ? ' · said by ' + esc(f.said_by_name) : '') +
      ' · ' + esc(src.source_kind || '') + ' ' + when(src.source_ts || f.captured_at) + ' ' + link(src.link, 'link') +
      (f.corroborated > 1 ? ' · ' + f.corroborated + ' sources' : '') + ' · shown ' + (f.views || []).length + '×</span>' +
      '<span class="meta insp-why" role="cell">' + esc(t.why || '') + '</span></div>';
  }

  function knowledgeHTML(list) {
    if (!list || !list.length) return '<p class="lempty">No knowledge yet.</p>';
    return '<ul class="insp-mini">' + list.map(function (k) {
      return '<li><span class="pill pill--muted">' + esc(k.kind) + '</span> <b>' + link(k.link, k.title || '(untitled)') + '</b> ' +
        '<span class="meta">#' + k.id + ' · ' + esc(k.status) + ' · ' + when(k.source_ts || k.captured_at) +
        (k.links && k.links.length ? ' · ' + k.links.map(function (l) { return esc(l.kind + ': ' + (l.name || l.target_type + ' #' + l.target_id)); }).join(', ') : '') + '</span>' +
        '<div class="insp-sum">' + esc(k.summary_md) + '</div></li>';
    }).join('') + '</ul>';
  }

  function decisionsHTML(list) {
    if (!list || !list.length) return '<p class="lempty">No decisions yet.</p>';
    return '<ul class="insp-mini">' + list.map(function (d) {
      var tone = d.status === 'recorded' ? 'ok' : d.status === 'proposed' ? 'warn' : 'muted';
      return '<li><span class="pill pill--' + tone + '">' + esc(d.status) + '</span> <b>' + link(d.link, d.what) + '</b> ' +
        '<span class="meta">#' + d.id + ' · ' + esc(d.how) + ' · ' + esc(d.authority) + (d.confidence != null ? ' · confidence ' + d.confidence : '') +
        (d.decided_by_name ? ' · by ' + esc(d.decided_by_name) : '') + ' · ' + when(d.decided_at || d.captured_at) +
        (d.reverses ? ' · reverses #' + d.reverses : '') + (d.reversed_by && d.reversed_by.length ? ' · reversed by #' + d.reversed_by.join(', #') : '') + '</span>' +
        (d.why ? '<div class="insp-sum">Why: ' + esc(d.why) + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function runs() {
    inspect('/runs').then(function (r) {
      panels.runs = r;
      var h = '<div class="insp-split"><div><ul class="insp-list">' + r.runs.map(function (x) {
        return '<li><button type="button" class="insp-row' + (run === x.id ? ' on' : '') + '" data-run="' + x.id + '"><span class="insp-name">Run ' + x.id + ' · ' + esc(x.role) + '</span>' +
          '<span class="meta">' + esc(x.client || '') + ' ' + esc(x.prompt_version || '') + ' · ' + when(x.started_at) + ' · ' + esc(x.outcome || 'running') + '</span></button></li>';
      }).join('') + '</ul></div><div id="insp-run">' + (run ? '' : '<p class="lempty">Pick a run to see what it handed memory.</p>') + '</div></div>';
      setBody(copyBtn('runs') + (r.runs.length ? h : '<p class="lempty">No extractor or recall runs yet.</p>'));
      if (run) runDetail(run);
    }, function (e) { setBody(fail(e)); });
  }

  function runDetail(id) {
    run = id;
    inspect('/runs/' + id).then(function (d) {
      panels.run = d;
      var el = document.getElementById('insp-run'); if (!el) return;
      var s = d.submitted;
      el.innerHTML = '<div class="insp-card"><h2>Run ' + id + '</h2>' + copyBtn('run') +
        '<p class="meta">' + d.signals + ' signals · submitted ' + s.facts.length + ' facts, ' + s.terms.length + ' terms, ' + s.decisions.length + ' decisions, ' + s.meetings.length + ' meeting summaries</p>' +
        '<h3>What the core wrote</h3><ul class="insp-mini">' + Object.keys(d.accepted).sort().map(function (k) { return '<li>' + esc(k) + ': ' + d.accepted[k] + '</li>'; }).join('') + '</ul>' +
        '<h3>Refused (' + d.refused.length + ')</h3>' + (d.refused.length ? '<ul class="insp-mini">' + d.refused.map(function (x) {
          return '<li><b>' + esc(x.reason) + '</b><div class="insp-sum">' + esc(JSON.stringify(x.item)) + '</div></li>';
        }).join('') + '</ul>' : '<p class="meta">Nothing.</p>') +
        '<h3>Cards raised</h3>' + (d.cards.length ? '<ul class="insp-mini">' + d.cards.map(function (c) { return '<li>#' + c.card_id + ' ' + esc(c.kind) + '</li>'; }).join('') + '</ul>' : '<p class="meta">None.</p>') +
        '<h3>Held back by today’s cap (' + d.held_by_cap.length + ')</h3>' + (d.held_by_cap.length ? '<ul class="insp-mini">' + d.held_by_cap.slice(0, 50).map(function (c) { return '<li>' + esc(c.kind + ' · ' + c.key) + '</li>'; }).join('') + '</ul>' : '<p class="meta">Nothing.</p>') + '</div>';
    }, function (err) { var el = document.getElementById('insp-run'); if (el) el.innerHTML = fail(err); });
  }

  function briefsHTML(r) {
    var h = '<p class="meta">Calendar read ' + (r.read_at ? when(r.read_at) : 'never') + (r.read_now ? ' · due for a re-read' : '') +
      ' · onboarding mode ' + (r.onboarding ? 'on (since ' + when(r.onboarding_from) + ')' : 'off') + ' · memory cards today ' + r.cards_today + ' of ' + r.card_cap + '</p>';
    h += '<h3>Meetings</h3>' + (r.meetings.length ? '<ul class="insp-mini">' + r.meetings.map(function (m) {
      return '<li><b>' + esc(m.meeting.title) + '</b> ' + when(m.meeting.start) + ' <span class="meta">· ' + (m.wants_brief ? 'brief at ' + when(m.fires_at) : 'no brief needed') +
        (m.fired ? ' · said ' + when(m.fired.ts) : '') + ' · ' + (m.meeting.attendees || []).length + ' people</span>' +
        (m.file ? ' <a href="' + esc(m.file.url) + '">Open the brief</a>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="meta">No meetings reported.</p>');
    h += '<h3>Knowledge files</h3>' + (r.files.length ? '<ul class="insp-mini">' + r.files.map(function (f) {
      return '<li><a href="' + esc(f.url) + '">' + esc(f.title || f.path) + '</a> <span class="meta">' + esc(f.kind) + ' · written ' + when(f.updated_at) + '</span></li>';
    }).join('') + '</ul>' : '<p class="meta">None written yet.</p>');
    return h;
  }

  function onClick(e) {
    var t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; return paint(); }
    var en = e.target.closest('[data-entity]');
    if (en) { root.querySelectorAll('.insp-row.on').forEach(function (r) { r.classList.remove('on'); }); en.classList.add('on'); return detail(+en.dataset.entity); }
    var rn = e.target.closest('[data-run]');
    if (rn) { root.querySelectorAll('.insp-row.on').forEach(function (r) { r.classList.remove('on'); }); rn.classList.add('on'); return runDetail(+rn.dataset.run); }
    var cp = e.target.closest('[data-copy]');
    if (cp) {
      var text = JSON.stringify(panels[cp.dataset.copy], null, 2);
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { cp.textContent = 'Copied'; }, function () { cp.textContent = 'Couldn’t copy'; });
      setTimeout(function () { cp.textContent = 'Copy as JSON'; }, 1500);
    }
  }
  function onSubmit(e) {
    var f = e.target;
    if (f.matches('[data-filter]')) { e.preventDefault(); filt = { q: f.q.value.trim(), type: f.type.value, state: f.state.value }; return entities(); }
    if (f.matches('[data-whynot]')) {
      e.preventDefault();
      inspect('/why_not' + q({ a: f.a.value.trim(), b: f.b.value.trim() })).then(function (r) {
        panels.whynot = r;
        document.getElementById('insp-why').innerHTML = copyBtn('whynot') + '<p><b>' + esc(r.a.name) + '</b> and <b>' + esc(r.b.name) + '</b></p><ul class="insp-mini">' + r.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      }, function (err) { document.getElementById('insp-why').innerHTML = fail(err); });
    }
    if (f.matches('[data-edit]')) {
      e.preventDefault();
      Live.editFact(+f.dataset.edit, f.attr.value.trim(), f.value.value.trim()).then(function () {
        Say.tell('Saved. Undo takes it back.'); detail(picked);
      }, function (err) { Say.tell('That didn’t save: ' + err.message); });
    }
  }
  function onChange(e) { if (e.target.id === 'insp-at') { at = e.target.value; body(); } }

  V.mount = function (el) {
    root = document.createElement('section'); root.className = 'lineup inspector'; el.appendChild(root);
    if (!demo() && !(window.Live && Live.on())) {
      root.innerHTML = '<div class="tasks-head"><h1>Inspector</h1></div><p class="lempty">The inspector shows your real memory. Open Fuzz from the link fuzz serve prints, with ?lab.</p>';
      return;
    }
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', onChange);
    M.wireAsk(root);
    paint();
  };
  V.unmount = function () {
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('submit', onSubmit); root.removeEventListener('change', onChange); }
    root = null;
  };

  M.lab = LAB;
  window.Memory = M;
  window.InspectView = V;
})();
