/* Label cases: a debugging page for the personal evals (docs/evals.md "Labelling cases by hand"). Lists the
   messages extraction read with what it made of each, least sure first; one tap says what each held, and that
   becomes a personal case. Below, the cases already made, to change or take back. Only the quote and who it
   was from are shown: the message's text is fetched later, kept on this machine for 90 days. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root = null, data = null, failed = null, source = '', saw = '', said = '', skipped = {};

  var SAW = { mine: 'Extraction: yours', unclear: 'Extraction: unclear whose', others: 'Extraction: someone else’s', none: 'Extraction: no ask' };
  var TONE = { mine: 'accent', unclear: 'warn', others: 'muted', none: 'muted' };
  var LABEL = { mine: 'An ask of mine', others: 'Someone else’s', nothing: 'Nothing here' };
  var SOURCES = [['', 'Any source'], ['email', 'Email'], ['slack', 'Slack'], ['meeting', 'Meetings']];
  var SAWS = [['', 'Anything'], ['unclear', 'Unclear'], ['others', 'Someone else’s'], ['none', 'No ask'], ['mine', 'Yours']];
  var STATUS = { pending: 'Waiting for the message’s text', unconfirmed: 'Waiting for your yes', active: 'Counting' };

  function opts(list, cur) {
    return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function when(ts) { return ts ? String(ts).replace('T', ' ').replace(/:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)?$/, '') : ''; }

  function itemHTML(m) {
    var asks = (m.asks || []).map(function (a) { return '<li>' + esc(a.ask || '') + ' <span class="meta">(' + esc(a.owner === 'me' ? 'yours' : a.owner) + ')</span></li>'; }).join('');
    return '<li class="lb-item" data-key="' + esc(m.key) + '">' +
      '<div class="lb-head">' + UI.pill(SAW[m.saw], TONE[m.saw]) + ' <b>' + esc(m.from || 'Someone') + '</b> ' +
      '<span class="meta">' + esc(m.source) + (m.title ? ' · ' + esc(m.title) : '') + ' · ' + esc(when(m.ts)) + '</span></div>' +
      (m.quote ? '<blockquote class="lb-quote">' + esc(m.quote) + '</blockquote>' : '') +
      (asks ? '<ul class="lb-asks">' + asks + '</ul>' : '') +
      '<div class="lb-ask" hidden><label>The ask, in your words <span class="meta">(optional)</span> ' +
      '<input type="text" class="lb-ask-in" maxlength="300" value="' + esc((m.asks && m.asks[0] && m.asks[0].ask) || '') + '"></label></div>' +
      '<div class="lb-actions"><button type="button" class="btn small primary" data-label="mine">' + LABEL.mine + '</button> ' +
      '<button type="button" class="btn small" data-label="others">' + LABEL.others + '</button> ' +
      '<button type="button" class="btn small" data-label="nothing">' + LABEL.nothing + '</button> ' +
      '<button type="button" class="btn small linklike" data-skip>Not now</button>' +
      (m.link ? ' <a class="meta" href="' + esc(m.link) + '" target="_blank" rel="noopener">Open it</a>' : '') + '</div></li>';
  }
  function caseHTML(c) {
    return '<li class="lb-case" data-case="' + c.id + '"><b>' + esc(LABEL[c.label]) + '</b> ' +
      '<span class="meta">' + esc(c.source || '') + (c.from ? ' · ' + esc(c.from) : '') + (c.title ? ' · ' + esc(c.title) : '') + ' · ' +
      esc(STATUS[c.status] || c.status) + (c.by_hand ? '' : ' · from a correction') + '</span>' +
      (c.ask ? '<div class="meta">Ask: ' + esc(c.ask) + '</div>' : '') +
      '<div class="lb-actions">' + (c.signal_key ? ['mine', 'others', 'nothing'].filter(function (l) { return l !== c.label; }).map(function (l) {
        return '<button type="button" class="btn small" data-relabel="' + l + '" data-sig="' + esc(c.signal_key) + '">Change to “' + esc(LABEL[l]) + '”</button>';
      }).join(' ') + ' ' : '') + '<button type="button" class="btn small linklike" data-remove="' + c.id + '">Take it back</button></div></li>';
  }

  function paint() {
    var head = '<a class="linkbtn set-back" href="#/settings"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Settings</a>' + '<div class="tasks-head"><h1>Label cases</h1><p class="meta">Say what each message Fuzz read held. Each answer becomes one of ' +
      'your own test cases: it never leaves this machine, and goes after 90 days. It scores Fuzz; it doesn’t teach it. ' +
      '<a href="#/evals">Back to the evals</a></p></div>';
    if (failed) { root.innerHTML = head + '<p class="lempty">' + esc(failed) + '</p>'; return; }
    if (!data) { root.innerHTML = head + '<p class="lempty">Loading messages…</p>'; return; }
    var q = data.queue.filter(function (m) { return !skipped[m.key]; });
    root.innerHTML = head +
      '<div class="lb-filters"><label>Source <select id="lb-source">' + opts(SOURCES, source) + '</select></label> ' +
      '<label>Extraction found <select id="lb-saw">' + opts(SAWS, saw) + '</select></label></div>' +
      (said ? '<p class="meta" role="status">' + esc(said) + '</p>' : '') +
      '<h2 class="ev-h">To label</h2>' + (q.length ? '<ul class="lb-list">' + q.map(itemHTML).join('') + '</ul>' : '<p class="lempty">Nothing left to label here.</p>') +
      '<h2 class="ev-h">Your labels</h2>' + (data.cases.length ? '<ul class="lb-list">' + data.cases.map(caseHTML).join('') + '</ul>' : '<p class="lempty">None yet.</p>');
  }

  function load() {
    Live.evalLabels({ source: source, saw: saw }).then(function (d) { data = d; failed = null; paint(); },
      function (e) { failed = 'Couldn’t load: ' + e.message; paint(); });
  }
  function act(p, ok) { p.then(function () { said = ok; load(); }, function (e) { said = 'That didn’t work: ' + e.message; paint(); }); }

  function onClick(e) {
    var b = e.target.closest('button'); if (!b) return;
    var item = b.closest('.lb-item');
    if (b.dataset.label && item) {
      /* Mine asks for the ask first, so it can be in your words; the second tap sends it */
      var box = item.querySelector('.lb-ask');
      if (b.dataset.label === 'mine' && box.hidden) { box.hidden = false; box.querySelector('input').focus(); b.textContent = 'Save it'; return; }
      b.disabled = true;
      return act(Live.evalLabel(item.dataset.key, b.dataset.label, b.dataset.label === 'mine' ? item.querySelector('.lb-ask-in').value : null),
        'Saved. It counts once Fuzz has read the message again.');
    }
    if (b.hasAttribute('data-skip') && item) { skipped[item.dataset.key] = true; return paint(); }
    if (b.dataset.relabel) { b.disabled = true; return act(Live.evalLabel(b.dataset.sig, b.dataset.relabel, null), 'Changed.'); }
    if (b.dataset.remove) { b.disabled = true; return act(Live.evalLabelRemove(+b.dataset.remove), 'Taken back.'); }
  }
  function onChange(e) {
    if (e.target.id === 'lb-source') { source = e.target.value; load(); }
    if (e.target.id === 'lb-saw') { saw = e.target.value; load(); }
  }

  V.mount = function (el) {
    root = document.createElement('section'); root.className = 'lineup evals labels'; el.appendChild(root);
    data = null; failed = null; said = ''; skipped = {};
    root.addEventListener('click', onClick); root.addEventListener('change', onChange);
    paint(); load();
  };
  V.unmount = function () {
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); }
    root = null;
  };
  window.LabelsView = V;
})();
