/* Evals: a debugging view of every eval run (docs/evals.md). Runs start from Run now (on the model picked here)
   or the terminal (fuzz eval run | dupes | senders | drafts | executor | send | recall | dump | series | priority).
   #/evals lists the newest run of each surface and every run; #/evals/<id> opens one: what changed against the
   run it was gated on, every case, and why a case failed. Only what's in this store is shown. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, list = null, detail = null, failed = null, surface = 'all', onlyFailing = true, runId = null, vs = null;

  var SURFACES = [['all', 'All'], ['extract', 'Extraction'], ['dupes', 'Duplicates'], ['senders', 'Senders'], ['draft', 'Drafts'], ['executor', 'Executor'],
    ['send', 'Sender'], ['recall', 'Recall'], ['dump', 'Dump'], ['series_suggest', 'Series'], ['priority', 'Priority']];
  var NAME = { extract: 'Extraction', dupes: 'Duplicates', senders: 'Senders', draft: 'Drafts', executor: 'Executor',
    send: 'Sender', recall: 'Recall', dump: 'Dump', series_suggest: 'Series', priority: 'Priority' };
  var CMD = { extract: 'fuzz eval run', dupes: 'fuzz eval dupes', senders: 'fuzz eval senders', draft: 'fuzz eval drafts', executor: 'fuzz eval executor',
    send: 'fuzz eval send', recall: 'fuzz eval recall', dump: 'fuzz eval dump', series_suggest: 'fuzz eval series', priority: 'fuzz eval priority' };
  var LATEST = ['extract', 'dupes', 'senders', 'draft', 'executor', 'send', 'recall', 'dump', 'series_suggest', 'priority'];
  var NO_MODEL = { dupes: 1, senders: 1, series_suggest: 1, priority: 1 };
  /* The model a run is on: none pinned is the client's default, which can change under it */
  function modelSaid(r) { return r.model || (r.client === 'stub' ? 'stub' : NO_MODEL[r.surface] ? '' : (r.client ? r.client + ' default (not pinned)' : '')); }
  var CHANGE = { fixed: ['Fixed', 'ok'], broke: ['Broke', 'danger'], flaky: ['Flaky', 'warn'], unchanged: ['Same', 'muted'], 'new': ['New', 'accent'] };

  function when(ts) { return ts ? String(ts).replace('T', ' ').replace(/:\d\dZ$/, '') : ''; }
  function gate(g) { return UI.pill(g === 'pass' ? 'Gate passed' : 'Gate failed', g === 'pass' ? 'ok' : 'danger'); }
  /* Two runs split by which side moved (issue 45, docs/evals.md "Changing the evals and the app"): the app's
     effect is its score on the cases both runs scored with the same fingerprint; a case added, relabelled or
     gone moves the whole score without the app doing anything, so it's said apart. */
  var SCOPES = [['global', 'Global'], ['personal', 'Yours']];
  function shared(a, s) { return a && a.scopes[s] && a.scopes[s].shared; }
  function appDelta(a, s) {
    var sh = shared(a, s);
    if (!sh || !sh.of) return '';
    var d = sh.after - sh.before;
    return badge(d, String(Math.abs(d)), 'On the ' + sh.of + ' cases run #' + a.before + ' also scored: ' + sh.before + ' → ' + sh.after + ' passing');
  }
  function setMoved(sc) { return sc && (sc.added.of || sc.removed.of || sc.relabelled.of); }
  function casesShort(sc) {
    return [sc.added.of ? '+' + sc.added.of : '', sc.removed.of ? '−' + sc.removed.of : '', sc.relabelled.of ? '~' + sc.relabelled.of : ''].filter(Boolean).join(' ');
  }
  function casesSaid(sc) {
    return [sc.added.of ? sc.added.of + ' added (' + sc.added.passed + ' pass)' : '',
      sc.relabelled.of ? sc.relabelled.of + ' relabelled (' + sc.relabelled.passed + ' pass)' : '',
      sc.removed.of ? sc.removed.of + ' gone (' + sc.removed.passed + ' passed then)' : ''].filter(Boolean).join(', ');
  }
  function short(v) { v = v == null ? '–' : String(v); return v.length > 40 ? v.slice(0, 39) + '…' : v; }
  function appSaid(a) { return a.app.map(function (c) { return c.what + ': ' + short(c.was) + ' → ' + short(c.now); }).join('; '); }
  /* One pill for which side moved since the run before: what to read the score as */
  function movedPill(a) {
    if (!a) return '';
    if (a.confounded) return '<span title="' + esc('The app (' + appSaid(a) + ') and the cases both changed: read the arrows, the score on the cases both runs scored') + '">' + UI.pill('Both changed', 'warn') + '</span>';
    if (a.app.length) return '<span title="' + esc(appSaid(a)) + '">' + UI.pill('App changed', 'accent') + '</span>';
    if (a.set_changed) return '<span title="' + esc(casesSaid(a.scopes.all)) + '">' + UI.pill('Cases changed', 'muted') + '</span>';
    if (a.unknown.indexOf('code') >= 0) return '<span title="' + esc('Run #' + a.before + ' predates recording its code: the same cases, but no way to say the app was the same') + '">' + UI.pill('Not recorded', 'muted') + '</span>';
    return '<span title="Same app, same cases: any change is noise">' + UI.pill('No change', 'muted') + '</span>';
  }
  function badge(d, txt, was) {
    var k = d > 0 ? 'up' : d < 0 ? 'down' : 'level';
    var say = d > 0 ? 'Up ' + txt : d < 0 ? 'Down ' + txt : 'No change';
    return ' <span class="ev-delta ' + k + '" title="' + esc(was) + '" aria-label="' + esc(say + ', ' + was) + '">' +
      (d > 0 ? '▲ ' + esc(txt) : d < 0 ? '▼ ' + esc(txt) : '=') + '</span>';
  }
  /* A score, its arrow (the app's effect since the run before) and how its cases moved, if they did */
  function scoreHTML(r, s) {
    var a = r.vs_prev, sc = a && a.scopes[s];
    return esc(r.passing[s]) + appDelta(a, s) +
      (setMoved(sc) ? ' <span class="meta ev-setmark" title="' + esc('Cases since run #' + a.before + ': ' + casesSaid(sc)) + '">' + esc(casesShort(sc)) + '</span>' : '');
  }

  /* The detail's side by side, against the run before or one you pick: which side moved, the app's score on
     the cases both scored, and how the cases changed */
  function sinceHTML(r) {
    var p = r.prev, a = detail.attribution;
    if (!p || !a) return '<p class="meta">No earlier ' + esc(NAME[r.surface] || r.surface) + ' run to compare scores with.</p>';
    var pick = '<label class="ev-vs">Compared with <select id="ev-vs">' + detail.others.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === detail.vs ? ' selected' : '') + '>#' + o.id + ' · ' + esc(when(o.ts)) + '</option>';
    }).join('') + '</select></label>' + (detail.vs_chosen ? ' <button type="button" class="btn small" data-vs-reset>The run before</button>' : ' <span class="meta">the run before</span>') +
      ' <a class="meta" href="#/evals/' + p.id + '">open #' + p.id + '</a>' + (p.set !== r.set ? ' <span class="meta">(set ' + esc(p.set) + ')</span>' : '');
    var warn = a.confounded ? '<p class="ev-warn">' + UI.pill('Both changed', 'warn') + ' The app and the cases both changed, so the whole score can’t say how the app did. ' +
      'The score on the cases both runs scored can. To keep them apart, see “Changing the evals and the app” in docs/evals.md.</p>' : '';
    var app = '<p class="ev-since"><span><b>App</b></span>' + (a.app.length ? a.app.map(function (c) {
      return '<span class="ev-since-item">' + esc(c.what) + ' <span class="meta">' + esc(short(c.was)) + ' →</span> ' + esc(short(c.now)) + '</span>';
    }).join('') : '<span class="meta">' + (a.unknown.length ? 'No change recorded.' : 'Same code, skill, model, lessons and judge.') + '</span>') +
      (a.unknown.length ? ' <span class="meta">(can’t be told: ' + esc(a.unknown.map(function (u) { return u === 'model' ? 'model, not pinned' : u + ', not recorded on one run'; }).join('; ')) + ')</span>' : '') + '</p>';
    var effect = SCOPES.filter(function (s) { return shared(a, s[0]).of; }).map(function (s) {
      var sh = shared(a, s[0]);
      return '<span class="ev-since-item">' + s[1] + ' <span class="meta">' + sh.before + ' of ' + sh.of + ' →</span> ' + sh.after + ' of ' + sh.of + appDelta(a, s[0]) + '</span>';
    });
    var shareLine = '<p class="ev-since"><span><b>On the cases both scored</b> <span class="meta">(the app’s effect)</span></span>' +
      (effect.length ? effect.join('') : '<span class="meta">None: the two runs share no case.</span>') + '</p>';
    var cases = '<p class="ev-since"><span><b>Cases</b></span>' + (a.set_changed ? SCOPES.filter(function (s) { return setMoved(a.scopes[s[0]]); }).map(function (s) {
      return '<span class="ev-since-item">' + s[1] + ' <span class="meta">' + esc(casesSaid(a.scopes[s[0]])) + '</span></span>';
    }).join('') : '<span class="meta">The same cases, with the same fingerprints.</span>') + '</p>';
    var parts = SCOPES.filter(function (s) { return r.score[s[0]].of || p.score[s[0]].of; }).map(function (s) {
      var x = p.score[s[0]], y = r.score[s[0]];
      return '<span class="ev-since-item">' + s[1] + ' <span class="meta">' + x.passed + ' of ' + x.of + ' →</span> ' + y.passed + ' of ' + y.of + '</span>';
    });
    ['global', 'personal'].forEach(function (scope) {
      var a = (p.metrics || {})[scope], b = (r.metrics || {})[scope];
      if (!a || !b) return;
      ['precision', 'recall', 'f1'].forEach(function (m) {
        if (a[m] == null || b[m] == null) return;
        var d = Math.round((b[m] - a[m]) * 1000) / 1000;
        parts.push('<span class="ev-since-item">' + (m === 'f1' ? 'F1' : m[0].toUpperCase() + m.slice(1)) + (scope === 'global' ? '' : ' (yours)') +
          ' <span class="meta">' + a[m] + ' →</span> ' + b[m] + badge(d, String(Math.abs(d)), 'Run #' + p.id + ': ' + a[m]) + '</span>');
      });
    });
    return '<section class="ev-attr" aria-label="Against another run"><p>' + pick + ' ' + movedPill(a) + '</p>' + warn + app + shareLine + cases +
      '<p class="ev-since"><span><b>Whole score</b> <span class="meta">(both sides)</span></span>' + parts.join('') + '</p></section>';
  }

  function pre(x) { return '<pre class="ev-pre">' + esc(typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '</pre>'; }

  function load() {
    if (!Live.on()) { failed = 'Evals live in the core’s store. Start Fuzz (fuzz start) to see them.'; return paint(); }
    var p = [Live.evals()];
    if (runId) p.push(Live.evalRun(runId, vs));
    Promise.all(p).then(function (r) { failed = null; list = r[0]; detail = r[1] || null; })
      .catch(function (e) { failed = e.message; }).then(function () { if (root) { paint(); poll(); } });
  }

  /* What a run costs, said on the button: the matcher needs no model; the rest take minutes of model calls */
  var COST = { extract: 'model calls, a few minutes', dupes: 'no model, a few seconds', senders: 'no model, a second', draft: 'model calls, a few minutes', executor: 'model calls, a few minutes',
    send: 'model calls, a few minutes', recall: 'model calls, a few minutes', dump: 'model calls, a few minutes', series_suggest: 'no model, a few seconds', priority: 'no model, a second' };

  /* Which model Run now uses: the one typed here, else evals.model, else the roles' engine (docs/evals.md) */
  var pick = null;
  function modelHTML() {
    var m = list.models || {};
    if (pick === null) pick = m.pinned || m.engine || '';
    var opts = [m.pinned, m.engine].concat(m.seen || []).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    return '<div class="ev-model"><label for="ev-model">Model for Run now</label> <input id="ev-model" class="input small" list="ev-models" value="' + esc(pick) +
      '" placeholder="' + esc((m.client || 'client') + ' default (not pinned)') + '" autocomplete="off" spellcheck="false">' +
      '<datalist id="ev-models">' + opts.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      ' <span class="meta">' + (m.pinned ? 'Pinned in config: ' + esc(m.pinned) + '.' : 'Pin one for every run: fuzz config set evals.model &lt;name&gt;.') +
      ' Comparisons only mean something on the same model.</span></div>';
  }

  function running(s) { return (list.jobs || []).filter(function (j) { return j.status === 'running' && (!s || j.surface === s); })[0]; }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function latestHTML() {
    return modelHTML() + '<div class="ev-latest">' + LATEST.map(function (s) {
      var r = (list.latest || {})[s], job = running(s);
      var head = '<b>' + esc(NAME[s]) + '</b> ' + (r ? gate(r.gate) + ' ' + movedPill(r.vs_prev) : UI.pill('No runs yet', 'muted'));
      var body = r ? '<a class="meta" href="#/evals/' + r.id + '">Global ' + scoreHTML(r, 'global') + ' · Yours ' + scoreHTML(r, 'personal') +
        ' · Run #' + r.id + ' · ' + esc(when(r.ts)) + '</a>' : '<span class="meta">' + esc(CMD[s]) + '</span>';
      var act = job ? '<span class="meta ev-busy">Running for ' + ago(job.started_at) + '…</span>'
        : '<button type="button" class="btn small" data-start="' + s + '" title="' + esc(COST[s]) + '">Run now</button><span class="meta">' + esc(COST[s]) + '</span>';
      return '<div class="ev-card">' + head + body + '<div class="ev-act">' + act + '</div></div>';
    }).join('') + '</div>';
  }

  function jobsHTML() {
    var jobs = list.jobs || [];
    var live = jobs.filter(function (j) { return j.status === 'running'; });
    var ended = jobs.filter(function (j) { return j.status !== 'running'; }).slice(0, 5);
    if (!jobs.length) return '';
    return '<section class="ev-jobs" aria-live="polite"><h2 class="ev-h">Started from here</h2><ul class="ev-joblist">' +
      live.concat(ended).map(function (j) {
        var tone = { running: 'accent', done: j.gate_ok === 0 ? 'danger' : 'ok', failed: 'danger', stopped: 'muted' }[j.status];
        var label = { running: 'Running', done: j.gate_ok === 0 ? 'Done, gate failed' : 'Done', failed: 'Failed', stopped: 'Stopped' }[j.status];
        return '<li class="ev-job">' + UI.pill(label, tone) + ' <b>' + esc(NAME[j.surface] || j.surface) + '</b> <span class="meta">' + esc(j.sets || 'all') +
          ' · started ' + esc(when(j.started_at)) + (j.status === 'running' ? ' · ' + ago(j.started_at) : '') + '</span>' +
          (j.status === 'running' ? ' <button type="button" class="btn small" data-stop="' + j.id + '">Stop</button>' : '') +
          (j.run_id ? ' <a href="#/evals/' + j.run_id + '">Run #' + j.run_id + '</a>' : '') +
          (j.status === 'failed' ? '<details data-k="job' + j.id + '"><summary class="meta">' + esc(j.error || 'Why') + '</summary>' + pre(j.log_tail || '(no log)') + '</details>' : '') + '</li>';
      }).join('') + '</ul></section>';
  }

  function runsHTML() {
    var runs = list.runs.filter(function (r) { return surface === 'all' || r.surface === surface; });
    var chips = '<div class="segrow" role="group" aria-label="Show">' + SURFACES.map(function (s) {
      return '<button type="button" class="seg" data-surface="' + s[0] + '" aria-pressed="' + (s[0] === surface) + '">' + s[1] + '</button>';
    }).join('') + '</div>';
    if (!runs.length) return chips + '<p class="lempty">No runs' + (surface === 'all' ? '' : ' of this kind') + ' yet. Run one from the terminal: ' +
      esc(surface === 'all' ? 'fuzz eval run' : CMD[surface]) + '.</p>';
    return chips + '<div class="ev-scroll"><table class="ev-table"><thead><tr><th>Run</th><th>When</th><th>Eval</th><th>Version</th><th>Model</th>' +
      '<th>Set</th><th>Global</th><th>Yours</th><th>Since the run before</th><th>Gate</th><th>Against</th><th>Seconds</th></tr></thead><tbody>' +
      runs.map(function (r) {
        return '<tr class="ev-row' + (r.id === runId ? ' is-on' : '') + '" data-run="' + r.id + '" tabindex="0"><td>#' + r.id + '</td><td>' + esc(when(r.ts)) + '</td><td>' + esc(NAME[r.surface] || r.surface) + rebaselined(r) + '</td>' +
          '<td>' + esc(r.skill || '') + (r.copy ? ' <span class="meta">' + esc(r.copy) + '</span>' : '') + '</td><td>' + esc(modelSaid(r)) + '</td>' +
          '<td>' + esc(r.set) + '</td><td>' + scoreHTML(r, 'global') + '</td><td>' + scoreHTML(r, 'personal') + '</td><td>' + movedPill(r.vs_prev) + '</td>' +
          '<td>' + gate(r.gate) + '</td><td>' + (r.against ? '#' + r.against : '') + '</td><td>' + (r.seconds == null ? '' : esc(r.seconds)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function sweepHTML(meta) {
    if (!meta || !meta.sweep) return '';
    return Object.keys(meta.sweep).map(function (scope) {
      return '<h3>Threshold sweep: ' + (scope === 'global' ? 'invented pairs' : 'your answers') + '</h3><div class="ev-scroll"><table class="ev-table"><thead><tr>' +
        '<th>Meaning threshold</th><th>Precision</th><th>Recall</th><th>F1</th><th>Asked, right</th><th>Asked, wrong</th><th>Missed</th></tr></thead><tbody>' +
        meta.sweep[scope].map(function (r) {
          return '<tr' + (r.current ? ' class="is-on"' : '') + '><td>' + r.dup_sem + (r.current ? ' (now)' : '') + '</td><td>' + (r.precision == null ? '–' : r.precision) +
            '</td><td>' + (r.recall == null ? '–' : r.recall) + '</td><td>' + r.f1 + '</td><td>' + r.tp + '</td><td>' + r.fp + '</td><td>' + r.fn + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
  }

  function detailHTML() {
    if (!runId) return '';
    if (!detail) return '<section class="ev-detail"><p class="lempty">Loading run #' + esc(runId) + '…</p></section>';
    var r = detail.run;
    var changed = detail.changed ? '<p class="ev-changed">Per case, against the gate’s baseline run #' + r.against + ': ' + ['fixed', 'broke', 'flaky', 'unchanged', 'new'].map(function (k) {
      return UI.pill(CHANGE[k][0] + ' ' + detail.changed[k], detail.changed[k] ? CHANGE[k][1] : 'muted');
    }).join(' ') + (detail.sign_test_p != null ? ' <span class="meta">sign test p = ' + detail.sign_test_p + '</span>' : '') + '</p>'
      : '<p class="meta">Nothing to compare with: no earlier run passed its gate.</p>';
    var cases = detail.cases.filter(function (c) { return !onlyFailing || !c.passed || (c.change && c.change !== 'unchanged') || moved(c); });
    var rows = cases.length ? cases.map(caseHTML).join('') : '<p class="lempty">Every case passed, and nothing changed.</p>';
    return '<section class="ev-detail" aria-labelledby="ev-run-h"><h2 id="ev-run-h">Run #' + r.id + ': ' + esc(NAME[r.surface] || r.surface) + ' ' + gate(r.gate) + rebaselined(r) + '</h2>' +
      '<p class="meta">' + esc([when(r.ts), r.skill + (r.copy ? ' (' + r.copy + ')' : ''), modelSaid(r), r.repeats + (r.repeats === 1 ? ' repeat' : ' repeats'),
        r.lessons + (r.lessons === 1 ? ' lesson' : ' lessons'), 'set ' + r.set, r.app_commit ? 'app at ' + r.app_commit : '', r.commit ? 'cases at ' + r.commit : '',
        r.set_hash ? 'case set ' + r.set_hash : '', r.judge ? 'judge ' + r.judge : '', r.seconds != null ? r.seconds + 's' : ''].filter(Boolean).join(' · ')) + '</p>' +
      sinceHTML(r) + changed + sweepHTML(detail.meta) +
      '<h3>Cases <span class="meta">' + detail.cases.length + ' · global ' + esc(r.passing.global) + ' · yours ' + esc(r.passing.personal) + '</span></h3>' +
      '<label class="check"><input type="checkbox" id="ev-failing"' + (onlyFailing ? ' checked' : '') + '> <span>Only failing or changed</span></label>' +
      '<ul class="ev-cases">' + rows + '</ul></section>';
  }

  /* A rebaseline: the baseline's app on today's cases, so its result is the cases' change alone */
  function rebaselined(r) { return r.rebaseline_of ? ' <span class="meta" title="The app run #' + r.rebaseline_of + ' scored, on today’s cases">rebaseline of #' + r.rebaseline_of + '</span>' : ''; }

  function moved(c) { return c.prev_score && c.prev_score !== c.score; }
  function caseHTML(c) {
    var ch = c.change && CHANGE[c.change];
    var body = (c.why || c.note ? '<p class="meta">' + esc(c.why || c.note) + '</p>' : '') +
      (c.moved ? '<p class="meta">This case changed since the run (relabelled or re-fetched): the run scored an older version.</p>' : '') +
      (c.input ? '<h4>The case</h4>' + pre(c.input) : '') + (c.expected ? '<h4>Expected</h4>' + pre(c.expected) : '') +
      (c.features ? '<h4>What the matcher saw</h4>' + pre(c.features) : '') +
      (c.stripped ? '<p class="meta">Its replies are gone: they expire with your cases after 90 days.</p>'
        : (c.replies || []).map(function (x, i) { return '<h4>Repeat ' + (i + 1) + ': ' + (x.passed ? 'passed' : 'failed') + '</h4>' + pre(x); }).join('')) +
      '<p class="meta">Fingerprint ' + esc(c.fp || '–') + '</p>';
    return '<li class="ev-case"><details data-k="' + esc(c.key) + '"><summary>' + UI.pill(c.passed ? 'Pass' : 'Fail', c.passed ? 'ok' : 'danger') + ' ' +
      '<b>' + esc(c.origin) + '</b> <span class="meta">' + esc(c.set === 'global' ? 'global' : 'yours') + ' · ' + esc(c.kind) + ' · ' + esc(c.score) + (moved(c) ? ' (was ' + esc(c.prev_score) + ')' : '') + '</span>' +
      (ch ? ' ' + UI.pill(ch[0], ch[1]) : '') + '</summary>' + body + '</details></li>';
  }

  function paint() {
    var head = '<a class="linkbtn set-back" href="#/settings"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Settings</a>' + '<div class="tasks-head"><h1>Evals</h1><p class="meta">A debugging view of every eval run in this store. Start one with Run now, ' +
      'or from the terminal (fuzz eval run, dupes, senders, drafts, executor, send, recall, dump, series or priority). Times are UTC. What’s yours stays on this machine. ' +
      'Thin spots? <a href="#/labels">Label cases</a> by hand.</p></div>';
    if (failed) { root.innerHTML = head + '<p class="lempty">' + esc(failed) + '</p>'; return; }
    if (!list) { root.innerHTML = head + '<p class="lempty">Loading runs…</p>'; return; }
    /* a <details> you opened stays open across the refresh while something runs */
    var opened = [].map.call(root.querySelectorAll('details[open]'), function (d) { return d.dataset.k; });
    root.innerHTML = head + latestHTML() + (said ? '<p class="meta ev-said" role="status">' + esc(said) + '</p>' : '') + jobsHTML() +
      detailHTML() + '<h2 class="ev-h">Every run</h2>' + (list.runs.length ? runsHTML() : '<p class="lempty">No runs yet.</p>');
    opened.forEach(function (k) { var d = root.querySelector('details[data-k="' + k + '"]'); if (d) d.open = true; });
  }

  /* While anything runs, look again every few seconds; a run that just finished opens, unless you've opened one */
  var said = '', timer = 0, wasRunning = {};
  function poll() {
    clearTimeout(timer);
    var jobs = (list && list.jobs) || [];
    jobs.forEach(function (j) {
      if (wasRunning[j.id] && j.status !== 'running') {
        said = (NAME[j.surface] || j.surface) + (j.status === 'done' ? ' finished.' : j.status === 'stopped' ? ' stopped.' : ' failed.');
        if (j.run_id && !runId) { delete wasRunning[j.id]; return open(j.run_id); }
      }
      if (j.status === 'running') wasRunning[j.id] = true; else delete wasRunning[j.id];
    });
    if (jobs.some(function (j) { return j.status === 'running'; })) timer = setTimeout(function () { if (root) load(); }, 4000);
  }
  function start(surface) {
    said = 'Starting ' + NAME[surface] + '…'; paint();
    Live.startEval(surface, 'all', NO_MODEL[surface] ? null : (pick || '').trim() || null).then(function () { said = NAME[surface] + ' is running. This page updates when it’s done.'; load(); },
      function (e) { said = 'It didn’t start: ' + e.message; paint(); });
  }
  function stop(id) {
    Live.stopEval(id).then(load, function (e) { said = 'It didn’t stop: ' + e.message; paint(); });
  }

  function open(id) { location.hash = '#/evals/' + id; }
  function onClick(e) {
    var go = e.target.closest('[data-start]');
    if (go) { go.disabled = true; return start(go.dataset.start); }
    var st = e.target.closest('[data-stop]');
    if (st) { st.disabled = true; return stop(+st.dataset.stop); }
    var s = e.target.closest('[data-surface]');
    if (s) { surface = s.dataset.surface; return paint(); }
    if (e.target.closest('[data-vs-reset]')) { vs = null; return load(); }
    var row = e.target.closest('[data-run]');
    if (row) return open(row.dataset.run);
  }
  function onKey(e) {
    var row = e.target.closest && e.target.closest('[data-run]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(row.dataset.run); }
  }
  function onChange(e) {
    if (e.target.id === 'ev-failing') { onlyFailing = e.target.checked; paint(); }
    if (e.target.id === 'ev-model') pick = e.target.value;
    if (e.target.id === 'ev-vs') { vs = +e.target.value; load(); }
  }

  V.mount = function (el, info) {
    root = document.createElement('section'); root.className = 'lineup evals'; el.appendChild(root);
    runId = info && info.arg && /^\d+$/.test(info.arg) ? +info.arg : null;
    list = null; detail = null; failed = null; vs = null;
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onChange);   /* the model typed survives the poll's repaint */
    pick = null;
    paint(); load();
  };
  V.unmount = function () {
    clearTimeout(timer);
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); root.removeEventListener('change', onChange); root.removeEventListener('input', onChange); }
    root = null;
  };

  window.EvalsView = V;
})();
