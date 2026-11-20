/* Usage: what Fuzz's role runs used, per day (core/fuzz/usage.py). Settings › App links here.
   Each client is said in its own unit and never added to the other: Copilot in AI credits (what GitHub bills),
   Claude Code in dollars (on a subscription, what the same tokens would cost on the API). Tokens for both.
   Only role runs count: evals, the focus pass and setup's connector discovery aren't measured. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, data = null, failed = null, days = 30;

  var RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
  var LABEL = { copilot: 'GitHub Copilot', 'claude-code': 'Claude Code' };
  var ROLE = { extractor: 'Reading', executor: 'Working', sender: 'Sending', ask: 'Answering', setup: 'Setup' };
  /* The headline unit per client: its bill, else tokens */
  var UNIT = {
    copilot: { key: 'credits', name: 'AI credits', fmt: function (v) { return num(v, 2); } },
    'claude-code': { key: 'cost_usd', name: 'API-equivalent cost', fmt: function (v) { return '$' + num(v, 2); } }
  };

  function num(v, dp) {
    v = +v || 0;
    return v.toLocaleString(undefined, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
  }
  function tok(v) {
    v = +v || 0;
    return v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : String(v);
  }
  function dayName(iso, today) {
    if (iso === today) return 'Today';
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function short(iso) { var d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function clients() {
    var have = Object.keys(data.totals || {}).filter(function (c) { return data.totals[c].runs; });
    return ['copilot', 'claude-code'].filter(function (c) { return have.indexOf(c) >= 0; });
  }
  function dayTotal(d, c) { return (d.clients[c] && d.clients[c].total) || null; }

  function load() {
    if (!Live.on()) { failed = 'Usage lives in the core’s store. Start Fuzz (fuzz start) to see it.'; return paint(); }
    Live.usage(days).then(function (r) { failed = null; data = r; }, function (e) {
      failed = e.status === 404 ? 'Fuzz’s server is running older code than this page. Restart fuzz serve to see usage.' : e.message;
    }).then(function () { if (root) paint(); });
  }

  /* One client's headline: the total over the range, and an average day */
  function tilesHTML() {
    return '<div class="us-tiles">' + clients().map(function (c) {
      var t = data.totals[c], u = UNIT[c], v = t[u.key];
      var active = data.days.filter(function (d) { var x = dayTotal(d, c); return x && x.runs; }).length;
      return '<div class="us-tile"><span class="meta">' + esc(LABEL[c]) + ' · ' + esc(u.name) + '</span>' +
        '<b class="us-big">' + esc(u.fmt(v)) + '</b>' +
        '<span class="meta">' + esc(num(t.runs)) + ' runs · ' + esc(tok(t['in'])) + ' in (' + esc(tok(t.cached)) + ' cached) · ' + esc(tok(t.out)) + ' out' +
        (active ? ' · ' + esc(u.fmt(v / active)) + ' a working day' : '') + '</span>' +
        (t.runs > t.measured ? '<span class="meta">' + esc(num(t.runs - t.measured)) + ' runs said nothing about what they used</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  /* One bar per day, oldest on the left: a single series, so the heading names it and there's no legend */
  function chartHTML(c) {
    var u = UNIT[c], rows = data.days.slice().reverse();
    var vals = rows.map(function (d) { var x = dayTotal(d, c); return x ? x[u.key] : 0; });
    var max = Math.max.apply(null, vals.concat([0]));
    var top = max > 0 ? max : 1;
    var bars = rows.map(function (d, i) {
      var x = dayTotal(d, c), v = vals[i], h = v > 0 ? Math.max(2, Math.round(v / top * 100)) : 0;
      var tip = dayName(d.date, data.today) + ': ' + u.fmt(v) + ' ' + u.name + (x ? ' · ' + x.runs + ' runs · ' + tok(x['in']) + ' in, ' + tok(x.out) + ' out' : ' · no runs');
      return '<div class="us-col" tabindex="0" role="img" aria-label="' + esc(tip) + '" data-tip="' + esc(tip) + '">' +
        '<span class="us-bar" style="height:' + h + '%"></span></div>';
    }).join('');
    var first = rows[0], last = rows[rows.length - 1];
    return '<figure class="us-chart"><figcaption><b>' + esc(LABEL[c]) + '</b> <span class="meta">' + esc(u.name) + ' per day · highest ' + esc(u.fmt(max)) + '</span></figcaption>' +
      '<div class="us-plot" style="--n:' + rows.length + '">' + bars + '<div class="us-tip" role="tooltip" hidden></div></div>' +
      '<div class="us-axis meta"><span>' + esc(short(first.date)) + '</span><span>' + esc(last.date === data.today ? 'Today' : short(last.date)) + '</span></div></figure>';
  }

  /* The same numbers as a table, with what each role used: also the chart's table view */
  function tableHTML() {
    var cs = clients();
    var head = '<tr><th>Day</th>' + cs.map(function (c) {
      return '<th>' + esc(LABEL[c]) + ' <span class="meta">' + esc(UNIT[c].name) + '</span></th><th>Runs</th><th>Tokens in / out</th>';
    }).join('') + '</tr>';
    var body = data.days.map(function (d) {
      var any = cs.some(function (c) { var x = dayTotal(d, c); return x && x.runs; });
      return '<tr' + (any ? '' : ' class="us-quiet"') + '><td>' + esc(dayName(d.date, data.today)) + '</td>' + cs.map(function (c) {
        var x = dayTotal(d, c), cl = d.clients[c];
        if (!x || !x.runs) return '<td class="meta">–</td><td class="meta">–</td><td class="meta">–</td>';
        var roles = Object.keys(cl.roles).map(function (r) {
          var x = cl.roles[r];   /* a role whose runs said nothing isn't a zero */
          return (ROLE[r] || r) + ' ' + (x.measured ? UNIT[c].fmt(x[UNIT[c].key]) : 'not reported') + ' (' + x.runs + ')';
        }).join(' · ');
        return '<td title="' + esc(roles) + '"><b>' + esc(UNIT[c].fmt(x[UNIT[c].key])) + '</b><small class="us-roles">' + esc(roles) + '</small></td>' +
          '<td>' + esc(num(x.runs)) + '</td><td>' + esc(tok(x['in'])) + ' / ' + esc(tok(x.out)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="ev-scroll"><table class="ev-table us-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function runsHTML() {
    var rs = (data.runs || []).slice(0, 25);
    if (!rs.length) return '';
    return '<h2 class="ev-h">Latest runs</h2><div class="ev-scroll"><table class="ev-table"><thead><tr><th>Run</th><th>Started</th><th>Role</th><th>App</th><th>Used</th><th>Tokens in / out</th><th>Time</th></tr></thead><tbody>' +
      rs.map(function (r) {
        var u = r.usage, unit = UNIT[r.client];
        return '<tr><td>#' + r.id + '</td><td>' + esc(new Date(r.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</td>' +
          '<td>' + esc(ROLE[r.role] || r.role) + '</td><td>' + esc(LABEL[r.client] || r.client) + '</td>' +
          (u ? '<td>' + esc(unit ? unit.fmt(u[unit.key]) + (r.client === 'copilot' ? ' credits' : '') : '') + '</td><td>' + esc(tok(u['in'])) + ' / ' + esc(tok(u.out)) + '</td><td>' + esc(u.seconds != null ? Math.round(u.seconds / 60 * 10) / 10 + ' min' : '') + '</td>'
            : '<td class="meta" colspan="3">' + (r.finished_at ? 'Not reported' : 'Running') + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function paint() {
    var seg = '<div class="segrow" role="group" aria-label="Range">' + RANGES.map(function (r) {
      return '<button type="button" class="seg" aria-pressed="' + (r[0] === days) + '" data-days="' + r[0] + '">' + r[1] + '</button>';
    }).join('') + '</div>';
    var head = '<div class="tasks-head"><h1>Usage</h1><p class="meta">What my runs used, per day, as each app reports it. ' +
      'Copilot counts AI credits, what GitHub bills. Claude Code counts dollars: on a subscription, that’s what the same tokens would cost on the API, not your bill. ' +
      'Evals, the focus pass and setup’s connector check aren’t counted, so your GitHub or Anthropic billing page can show more.' +
      (data && data.tz ? ' Days are in ' + esc(data.tz) + '.' : '') + '</p>' + seg + '</div>';
    if (failed) { root.innerHTML = head + '<p class="lempty">' + esc(failed) + '</p>'; return; }
    if (!data) { root.innerHTML = head + '<p class="lempty">Adding it up…</p>'; return; }
    if (!clients().length) { root.innerHTML = head + '<p class="lempty">No runs in the last ' + days + ' days.</p>'; return; }
    root.innerHTML = head + tilesHTML() + clients().map(chartHTML).join('') + '<h2 class="ev-h">Each day</h2>' + tableHTML() + runsHTML();
  }

  /* A bar's numbers on hover or focus, above it */
  function showTip(col) {
    var plot = col.closest('.us-plot'), tip = plot && plot.querySelector('.us-tip');
    if (!tip) return;
    tip.textContent = col.dataset.tip; tip.hidden = false;
    var pr = plot.getBoundingClientRect(), cr = col.getBoundingClientRect();
    var x = cr.left - pr.left + cr.width / 2;
    tip.style.left = Math.max(0, Math.min(pr.width - tip.offsetWidth, x - tip.offsetWidth / 2)) + 'px';
  }
  function hideTips() { if (root) [].forEach.call(root.querySelectorAll('.us-tip'), function (t) { t.hidden = true; }); }
  function onOver(e) { var col = e.target.closest && e.target.closest('.us-col'); if (col) showTip(col); else hideTips(); }
  function onClick(e) {
    var b = e.target.closest('[data-days]');
    if (b) { days = +b.dataset.days; data = null; paint(); load(); }
  }

  V.mount = function (el) {
    root = document.createElement('section'); root.className = 'lineup evals usage'; el.appendChild(root);
    data = null; failed = null;
    root.addEventListener('click', onClick);
    root.addEventListener('mouseover', onOver);
    root.addEventListener('focusin', onOver);
    root.addEventListener('mouseleave', hideTips);
    paint(); load();
  };
  V.unmount = function () {
    if (root) {
      root.removeEventListener('click', onClick); root.removeEventListener('mouseover', onOver);
      root.removeEventListener('focusin', onOver); root.removeEventListener('mouseleave', hideTips);
    }
    root = null;
  };

  window.UsageView = V;
})();
