/* The feedback button in the header: opens a new GitHub issue with what the page knows filled in (version, view,
   live or demo, theme, screen, recent errors), so a note to self takes one click and a sentence.
   Loaded first in <head> so it hears errors from the very start. The repo is public: nothing here carries task
   text, only route names, ids, counts and settings. Query values are dropped (#/work?what=… can be a task title). */
(function () {
  var REPO = 'https://github.com/dancingcactus/Fuzz-AI';
  var MAX_ERRORS = 5;
  var errors = [], version = null, fetching = null;

  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function where(file, line) { return file ? ' (' + String(file).replace(location.origin, '') + (line ? ':' + line : '') + ')' : ''; }
  function keep(msg) {
    var t = new Date().toTimeString().slice(0, 8);
    errors.push(t + ' ' + clip(msg, 220));
    if (errors.length > MAX_ERRORS) errors.shift();
  }
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window) { keep('failed to load ' + (e.target.src || e.target.href || e.target.tagName)); return; }
    keep((e.message || 'error') + where(e.filename, e.lineno));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; keep('unhandled: ' + (r && r.message ? r.message : r));
  });
  var cerr = console.error;
  console.error = function () {
    try { keep('console: ' + Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === 'object' ? JSON.stringify(a) : a; }).join(' ')); } catch (x) { /* ignore */ }
    return cerr.apply(console, arguments);
  };

  /* /version is only there under `fuzz serve`; the static demo shows "not served". Kept fresh on hover/focus so the
     click itself can open the tab right away (a popup opened after an await gets blocked). */
  function refresh() {
    if (location.protocol === 'file:' || fetching) return;
    fetching = fetch('/version', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { version = v; }, function () { version = null; })
      .then(function () { fetching = null; });
  }

  function ago(sec) {
    var m = Math.round((Date.now() / 1000 - sec) / 60);
    return m < 60 ? m + 'm ago' : m < 2880 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
  }
  function gitLine(g) { return g && g.commit ? '`' + g.commit + '` (' + g.branch + (g.dirty ? ', uncommitted edits' : '') + ')' : 'not a git checkout'; }
  function versionLine() {
    if (!version) return 'not served by `fuzz serve` (static or file page)';
    var s = version.version + ' · tree ' + gitLine(version.tree) + ' · server ' + (version.server && version.server.commit ? '`' + version.server.commit + '`' : '?') + ' started ' + ago(version.started);
    if (version.server && version.tree && version.server.commit && version.server.commit !== version.tree.commit) s += ' · **server is behind the tree (restart serve)**';
    return s;
  }

  function context() {
    var h = (window.App && App.here && App.here()) || { name: '?', arg: null, params: {} };
    var keys = Object.keys(h.params || {});
    var route = '#/' + h.name + (h.arg ? '/' + h.arg : '') + (keys.length ? '?' + keys.join('&') : '');
    var title = document.title.replace(/ · Fuzz$/, '');
    var live = !!(window.Live && Live.on && Live.on());
    var data = [live ? 'Live' : 'Demo'];
    try {
      var st = Store.get();
      data.push(st.queue.length + ' in triage');
      var dw = window.DeepWork && DeepWork.label && DeepWork.label();
      if (dw && dw.session) data.push('My work session running');
    } catch (e) { /* the store isn't up yet */ }
    var p = (window.App && App.prefs && App.prefs()) || {};
    var look = [window.App && App.shownTheme ? App.shownTheme() : p.theme, p.theme === 'random' ? '(random)' : '', p.mode, 'contrast ' + p.contrast, p.calm ? 'calm' : ''].filter(Boolean).join(', ');
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var when = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + tz;
    return { title: title, lines: [
      '**View:** ' + title + ' (`' + route + '`) on ' + (location.host || 'file'),
      '**Fuzz:** ' + versionLine(),
      '**Data:** ' + data.join(' · '),
      '**Look:** ' + look,
      '**Screen:** ' + innerWidth + '×' + innerHeight + ' @' + (Math.round(devicePixelRatio * 100) / 100) + 'x · ' + clip(navigator.userAgent, 160),
      '**When:** ' + when,
      '**Recent errors:** ' + (errors.length ? '\n' + errors.map(function (e) { return '- `' + e.replace(/`/g, "'") + '`'; }).join('\n') : 'none')
    ] };
  }

  function issueUrl() {
    var c = context();
    var body = '<!-- What happened, and what you expected. This repo is public: check the details below before you submit. -->\n\n\n\n' +
      '<details open><summary>Page details</summary>\n\n' + c.lines.join('\n') + '\n\n</details>\n';
    return REPO + '/issues/new?title=' + encodeURIComponent('[' + c.title + '] ') + '&body=' + encodeURIComponent(body);
  }

  window.Feedback = {
    url: issueUrl,
    errors: function () { return errors.slice(); },
    /* wires the header button; called from js/app.js once the header exists */
    bind: function (btn) {
      refresh();
      ['pointerenter', 'focus'].forEach(function (ev) { btn.addEventListener(ev, refresh); });
      btn.addEventListener('click', function () { window.open(issueUrl(), '_blank', 'noopener'); });
    }
  };
})();
