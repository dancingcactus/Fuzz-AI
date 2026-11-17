/* Evals: a debugging view of every eval run (docs/evals.md). Read-only: runs start from the terminal
   (fuzz eval run | dupes | drafts | executor), since each takes minutes and costs model calls.
   #/evals lists the newest run of each surface and every run; #/evals/<id> opens one: what changed against the
   run it was gated on, every case, and why a case failed. Only what's in this store is shown. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, list = null, detail = null, failed = null, surface = 'all', onlyFailing = true, runId = null;

  var SURFACES = [['all', 'All'], ['extract', 'Extraction'], ['dupes', 'Duplicates'], ['draft', 'Drafts'], ['executor', 'Executor']];
  var NAME = { extract: 'Extraction', dupes: 'Duplicates', draft: 'Drafts', executor: 'Executor' };
  var CMD = { extract: 'fuzz eval run', dupes: 'fuzz eval dupes', draft: 'fuzz eval drafts', executor: 'fuzz eval executor' };
  var CHANGE = { fixed: ['Fixed', 'ok'], broke: ['Broke', 'danger'], flaky: ['Flaky', 'warn'], unchanged: ['Same', 'muted'], 'new': ['New', 'accent'] };

  function when(ts) { return ts ? String(ts).replace('T', ' ').replace(/:\d\dZ$/, '') : ''; }
  function gate(g) { return UI.pill(g === 'pass' ? 'Gate passed' : 'Gate failed', g === 'pass' ? 'ok' : 'danger'); }
  function pre(x) { return '<pre class="ev-pre">' + esc(typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '</pre>'; }

  function load() {
    if (!Live.on()) { failed = 'Evals live in the core’s store. Start Fuzz (fuzz start) to see them.'; return paint(); }
    var p = [Live.evals()];
    if (runId) p.push(Live.evalRun(runId));
    Promise.all(p).then(function (r) { failed = null; list = r[0]; detail = r[1] || null; })
      .catch(function (e) { failed = e.message; }).then(function () { if (root) paint(); });
  }

  function latestHTML() {
    var keys = Object.keys(list.latest || {});
    if (!keys.length) return '';
    return '<div class="ev-latest">' + ['extract', 'dupes', 'draft', 'executor'].filter(function (s) { return list.latest[s]; }).map(function (s) {
      var r = list.latest[s];
      return '<a class="ev-card" href="#/evals/' + r.id + '"><b>' + esc(NAME[s] || s) + '</b> ' + gate(r.gate) +
        '<span class="meta">Global ' + esc(r.passing.global) + ' · Yours ' + esc(r.passing.personal) + '</span>' +
        '<span class="meta">Run #' + r.id + ' · ' + esc(when(r.ts)) + '</span></a>';
    }).join('') + '</div>';
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
          '<td>' + esc(r.set) + '</td><td>' + esc(r.passing.global) + '</td><td>' + esc(r.passing.personal) + '</td>' +
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
    var changed = detail.changed ? '<p class="ev-changed">Against run #' + r.against + ': ' + ['fixed', 'broke', 'flaky', 'unchanged', 'new'].map(function (k) {
      return UI.pill(CHANGE[k][0] + ' ' + detail.changed[k], detail.changed[k] ? CHANGE[k][1] : 'muted');
    }).join(' ') + (detail.sign_test_p != null ? ' <span class="meta">sign test p = ' + detail.sign_test_p + '</span>' : '') + '</p>'
      : '<p class="meta">Nothing to compare with: no earlier run passed its gate.</p>';
    var cases = detail.cases.filter(function (c) { return !onlyFailing || !c.passed || (c.change && c.change !== 'unchanged'); });
    var rows = cases.length ? cases.map(caseHTML).join('') : '<p class="lempty">Every case passed, and nothing changed.</p>';
    return '<section class="ev-detail" aria-labelledby="ev-run-h"><h2 id="ev-run-h">Run #' + r.id + ': ' + esc(NAME[r.surface] || r.surface) + ' ' + gate(r.gate) + '</h2>' +
      '<p class="meta">' + esc([when(r.ts), r.skill + (r.copy ? ' (' + r.copy + ')' : ''), r.model || r.client, r.repeats + (r.repeats === 1 ? ' repeat' : ' repeats'),
        r.lessons + (r.lessons === 1 ? ' lesson' : ' lessons'), 'set ' + r.set, r.commit ? 'cases at ' + r.commit : '', r.seconds != null ? r.seconds + 's' : ''].filter(Boolean).join(' · ')) + '</p>' +
      changed + sweepHTML(detail.meta) +
      '<h3>Cases <span class="meta">' + detail.cases.length + ' · global ' + esc(r.passing.global) + ' · yours ' + esc(r.passing.personal) + '</span></h3>' +
      '<label class="check"><input type="checkbox" id="ev-failing"' + (onlyFailing ? ' checked' : '') + '> <span>Only failing or changed</span></label>' +
      '<ul class="ev-cases">' + rows + '</ul></section>';
  }

  function caseHTML(c) {
    var ch = c.change && CHANGE[c.change];
    var body = (c.why || c.note ? '<p class="meta">' + esc(c.why || c.note) + '</p>' : '') +
      (c.moved ? '<p class="meta">This case changed since the run (relabelled or re-fetched): the run scored an older version.</p>' : '') +
      (c.input ? '<h4>The case</h4>' + pre(c.input) : '') + (c.expected ? '<h4>Expected</h4>' + pre(c.expected) : '') +
      (c.features ? '<h4>What the matcher saw</h4>' + pre(c.features) : '') +
      (c.stripped ? '<p class="meta">Its replies are gone: they expire with your cases after 90 days.</p>'
        : (c.replies || []).map(function (x, i) { return '<h4>Repeat ' + (i + 1) + ': ' + (x.passed ? 'passed' : 'failed') + '</h4>' + pre(x); }).join('')) +
      '<p class="meta">Fingerprint ' + esc(c.fp || '–') + '</p>';
    return '<li class="ev-case"><details><summary>' + UI.pill(c.passed ? 'Pass' : 'Fail', c.passed ? 'ok' : 'danger') + ' ' +
      '<b>' + esc(c.origin) + '</b> <span class="meta">' + esc(c.set === 'global' ? 'global' : 'yours') + ' · ' + esc(c.kind) + ' · ' + esc(c.score) + '</span>' +
      (ch ? ' ' + UI.pill(ch[0], ch[1]) : '') + '</summary>' + body + '</details></li>';
  }

  function paint() {
    var head = '<div class="tasks-head"><h1>Evals</h1><p class="meta">A debugging view of every eval run in this store. Start one from the terminal: ' +
      'fuzz eval run, dupes, drafts or executor. What’s yours stays on this machine.</p></div>';
    if (failed) { root.innerHTML = head + '<p class="lempty">' + esc(failed) + '</p>'; return; }
    if (!list) { root.innerHTML = head + '<p class="lempty">Loading runs…</p>'; return; }
    if (!list.runs.length) { root.innerHTML = head + '<p class="lempty">No runs yet. Try fuzz eval run in the terminal.</p>'; return; }
    root.innerHTML = head + latestHTML() + detailHTML() + '<h2 class="ev-h">Every run</h2>' + runsHTML();
  }

  function open(id) { location.hash = '#/evals/' + id; }
  function onClick(e) {
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
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); root.removeEventListener('change', onChange); }
    root = null;
  };

  window.EvalsView = V;
})();
