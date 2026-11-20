/* Evals: a debugging view of every eval run (docs/evals.md). Read-only: runs start from the terminal
   (fuzz eval run | dupes | senders | drafts | executor), since each takes minutes and costs model calls.
   #/evals lists the newest run of each surface and every run; #/evals/<id> opens one: what changed against the
   run it was gated on, every case, and why a case failed. Only what's in this store is shown. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, list = null, detail = null, failed = null, surface = 'all', onlyFailing = true, runId = null;

  var SURFACES = [['all', 'All'], ['extract', 'Extraction'], ['dupes', 'Duplicates'], ['senders', 'Senders'], ['draft', 'Drafts'], ['executor', 'Executor']];
  var NAME = { extract: 'Extraction', dupes: 'Duplicates', senders: 'Senders', draft: 'Drafts', executor: 'Executor' };
  var CMD = { extract: 'fuzz eval run', dupes: 'fuzz eval dupes', senders: 'fuzz eval senders', draft: 'fuzz eval drafts', executor: 'fuzz eval executor' };
  var CHANGE = { fixed: ['Fixed', 'ok'], broke: ['Broke', 'danger'], flaky: ['Flaky', 'warn'], unchanged: ['Same', 'muted'], 'new': ['New', 'accent'] };

  function when(ts) { return ts ? String(ts).replace('T', ' ').replace(/:\d\dZ$/, '') : ''; }
  function gate(g) { return UI.pill(g === 'pass' ? 'Gate passed' : 'Gate failed', g === 'pass' ? 'ok' : 'danger'); }
  /* How a score moved since the previous run of the same eval (not the gate's baseline, which can be older):
     up, down or level. Same number of cases compares counts; a different number compares the share passing. */
  function delta(cur, prev, prevId) {
    if (!cur || !prev || !cur.of || !prev.of) return '';
    var was = 'Run #' + prevId + ': ' + prev.passed + ' of ' + prev.of, d, txt;
    if (cur.of === prev.of) { d = cur.passed - prev.passed; txt = String(Math.abs(d)); }
    else { d = Math.round(100 * (cur.passed / cur.of - prev.passed / prev.of)); txt = Math.abs(d) + ' pts'; }
    return badge(d, txt, was);
  }
  function badge(d, txt, was) {
    var k = d > 0 ? 'up' : d < 0 ? 'down' : 'level';
    var say = d > 0 ? 'Up ' + txt : d < 0 ? 'Down ' + txt : 'No change';
    return ' <span class="ev-delta ' + k + '" title="' + esc(was) + '" aria-label="' + esc(say + ', ' + was) + '">' +
      (d > 0 ? '▲ ' + esc(txt) : d < 0 ? '▼ ' + esc(txt) : '=') + '</span>';
  }
  function scoreHTML(r, s) { return esc(r.passing[s]) + (r.prev ? delta(r.score && r.score[s], r.prev.score[s], r.prev.id) : ''); }

  /* The detail's side by side: each score in this run against the one before it */
  function sinceHTML(r) {
    var p = r.prev;
    if (!p) return '<p class="meta">No earlier ' + esc(NAME[r.surface] || r.surface) + ' run to compare scores with.</p>';
    var parts = [['global', 'Global'], ['personal', 'Yours']].filter(function (s) { return r.score[s[0]].of || p.score[s[0]].of; }).map(function (s) {
      var a = p.score[s[0]], b = r.score[s[0]];
      return '<span class="ev-since-item">' + s[1] + ' <span class="meta">' + a.passed + ' of ' + a.of + ' →</span> ' + b.passed + ' of ' + b.of +
        delta(b, a, p.id) + '</span>';
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
    return '<p class="ev-since"><span>Since the previous run <a href="#/evals/' + p.id + '">#' + p.id + '</a>' +
      (p.set !== r.set ? ' <span class="meta">(set ' + esc(p.set) + ')</span>' : '') + ':</span>' + parts.join('') + '</p>';
  }

  function pre(x) { return '<pre class="ev-pre">' + esc(typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '</pre>'; }

  function load() {
    if (!Live.on()) { failed = 'Evals live in the core’s store. Start Fuzz (fuzz start) to see them.'; return paint(); }
    var p = [Live.evals()];
    if (runId) p.push(Live.evalRun(runId));
    Promise.all(p).then(function (r) { failed = null; list = r[0]; detail = r[1] || null; })
      .catch(function (e) { failed = e.message; }).then(function () { if (root) { paint(); poll(); } });
  }

  /* What a run costs, said on the button: the matcher needs no model; the rest take minutes of model calls */
  var COST = { extract: 'model calls, a few minutes', dupes: 'no model, a few seconds', senders: 'no model, a second', draft: 'model calls, a few minutes', executor: 'model calls, a few minutes' };

  function running(s) { return (list.jobs || []).filter(function (j) { return j.status === 'running' && (!s || j.surface === s); })[0]; }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function latestHTML() {
    return '<div class="ev-latest">' + ['extract', 'dupes', 'senders', 'draft', 'executor'].map(function (s) {
      var r = (list.latest || {})[s], job = running(s);
      var head = '<b>' + esc(NAME[s]) + '</b> ' + (r ? gate(r.gate) : UI.pill('No runs yet', 'muted'));
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
      '<th>Set</th><th>Global</th><th>Yours</th><th>Gate</th><th>Against</th><th>Seconds</th></tr></thead><tbody>' +
      runs.map(function (r) {
        return '<tr class="ev-row' + (r.id === runId ? ' is-on' : '') + '" data-run="' + r.id + '" tabindex="0"><td>#' + r.id + '</td><td>' + esc(when(r.ts)) + '</td><td>' + esc(NAME[r.surface] || r.surface) + '</td>' +
          '<td>' + esc(r.skill || '') + (r.copy ? ' <span class="meta">' + esc(r.copy) + '</span>' : '') + '</td><td>' + esc(r.model || r.client || '') + '</td>' +
          '<td>' + esc(r.set) + '</td><td>' + scoreHTML(r, 'global') + '</td><td>' + scoreHTML(r, 'personal') + '</td>' +
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
    return '<section class="ev-detail" aria-labelledby="ev-run-h"><h2 id="ev-run-h">Run #' + r.id + ': ' + esc(NAME[r.surface] || r.surface) + ' ' + gate(r.gate) + '</h2>' +
      '<p class="meta">' + esc([when(r.ts), r.skill + (r.copy ? ' (' + r.copy + ')' : ''), r.model || r.client, r.repeats + (r.repeats === 1 ? ' repeat' : ' repeats'),
        r.lessons + (r.lessons === 1 ? ' lesson' : ' lessons'), 'set ' + r.set, r.commit ? 'cases at ' + r.commit : '', r.seconds != null ? r.seconds + 's' : ''].filter(Boolean).join(' · ')) + '</p>' +
      sinceHTML(r) + changed + sweepHTML(detail.meta) +
      '<h3>Cases <span class="meta">' + detail.cases.length + ' · global ' + esc(r.passing.global) + ' · yours ' + esc(r.passing.personal) + '</span></h3>' +
      '<label class="check"><input type="checkbox" id="ev-failing"' + (onlyFailing ? ' checked' : '') + '> <span>Only failing or changed</span></label>' +
      '<ul class="ev-cases">' + rows + '</ul></section>';
  }

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
    var head = '<div class="tasks-head"><h1>Evals</h1><p class="meta">A debugging view of every eval run in this store. Start one with Run now, ' +
      'or from the terminal (fuzz eval run, dupes, senders, drafts or executor). Times are UTC. What’s yours stays on this machine.</p></div>';
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
    Live.startEval(surface, 'all').then(function () { said = NAME[surface] + ' is running. This page updates when it’s done.'; load(); },
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
    var row = e.target.closest('[data-run]');
    if (row) return open(row.dataset.run);
  }
  function onKey(e) {
    var row = e.target.closest && e.target.closest('[data-run]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(row.dataset.run); }
  }
  function onChange(e) { if (e.target.id === 'ev-failing') { onlyFailing = e.target.checked; paint(); } }

  V.mount = function (el, info) {
    root = document.createElement('section'); root.className = 'lineup evals'; el.appendChild(root);
    runId = info && info.arg && /^\d+$/.test(info.arg) ? +info.arg : null;
    list = null; detail = null; failed = null;
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('change', onChange);
    paint(); load();
  };
  V.unmount = function () {
    clearTimeout(timer);
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); root.removeEventListener('change', onChange); }
    root = null;
  };

  window.EvalsView = V;
})();
