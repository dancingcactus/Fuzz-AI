/* The card's action area, built once (docs/card-actions.md).
   A card describes WHAT it offers as plain data: one lead, then up to three sub-actions. This file decides how
   that looks, so no card lays out its own buttons.

     CardActions.render({
       line: 'One short, neutral line above the lead (rule 14), optional',
       lead: { verb: 'assign', menu: { theme: 'who', items: ['deepwork', 'donow'] } },
       row:  [ 'claude', { verb: 'schedule', menu: { theme: 'when', items: ['book', 'afterothers'] } }, ... up to 3 ]
     })

   A slot is a verb id, or { verb, label?, key?, primary?, menu? }, or { answer: { label, small, quick | act } }
   for a numbered answer. The registry below is the only place a verb's word, key, icon and theme are written
   (rule 3). render() records anything that breaks a rule in CardActions.violations and warns on the console;
   tests/ui/card-actions.test.mjs turns that into a failed test. */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function kbd(k) { return '<kbd aria-hidden="true">' + k + '</kbd>'; }

  /* Icons: only a verb that is the lead wears one (rule 3). Placeholders in the stroke style of the first two,
     to be redrawn by whoever owns the icon set (docs/card-actions.md, Part 5). */
  var SV = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    arrow: SV + '<path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    check: SV + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    play: SV + '<path d="M7 5l12 7-12 7z"/></svg>',
    step: SV + '<path d="M4 19h5v-5h5V9h6"/></svg>',
    cal: SV + '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    back: SV + '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/></svg>',
    leaf: SV + '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l7-7"/></svg>'
  };
  var CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  /* theme: who (who does it), when, clear (clear it from my plate). A menu holds one theme (rule 15). */
  var DEEP_WHAT = 'Yours, and it takes real time. It waits in My work, and Fuzz gets it ready for when you sit down to it.';
  var VERBS = {
    assign:       { label: 'Hand it to Fuzz', key: 'A', theme: 'who', icon: 'arrow', what: 'Fuzz does the work and brings it back.' },
    claude:       { label: 'Work in Claude', key: 'C', theme: 'who', what: 'Open it in Claude, with the task as the first message.' },
    deepwork:     { label: 'I’ll do it', key: 'G', theme: 'who', what: DEEP_WHAT },
    donow:        { label: 'Do it now', key: null, theme: 'who', icon: 'play', what: 'Open it as your working card, with the rest of the list out of view.' },
    helpstart:    { label: 'Help me start', key: 'H', theme: 'who', icon: 'step', what: 'Fuzz works out what it needs and a two-minute first step.' },
    schedule:     { label: 'Later', key: 'S', theme: 'when', what: 'Pick a rough time. It comes back then.' },
    book:         { label: 'Book time', key: 'B', theme: 'when', icon: 'cal', what: 'Hold time on your calendar to do it. It doesn’t count as putting it off.' },
    afterothers:  { label: 'After the others', key: null, theme: 'when', what: 'To the end of this session. No penalty.' },
    keepwaiting:  { label: 'Check again later', key: 'S', theme: 'when', what: 'Still waiting. Fuzz checks back in a few days.' },
    stillmatters: { label: 'It still matters', key: 'K', theme: 'when', what: 'Keep it on your list.' },
    keep:         { label: 'It still matters', key: 'K', theme: 'when', what: 'Keep it on your list.' },
    done:         { label: 'Done', key: 'D', theme: 'clear', icon: 'check', what: 'It’s finished.' },
    park:         { label: 'Park it', key: 'P', theme: 'clear', what: 'Out of triage with no date. It waits in Parked until someone follows up, or you bring it back.' },
    waiting:      { label: 'Waiting on someone', key: 'W', theme: 'clear', what: 'You’re blocked until they get back to you. Fuzz checks back.' },
    theirs:       { label: 'Not mine', key: 'X', theme: 'clear', what: 'It’s someone else’s to do. Fuzz lets it go, and brings it back if a new ask needs you.' },
    letgo:        { label: 'Let it go', key: 'L', theme: 'clear', icon: 'leaf', what: 'Off your list. You can bring it back from Let go.' },
    keepparked:   { label: 'Keep it parked', key: null, theme: 'when', what: 'Stays parked. Fuzz won’t ask again for a few weeks.' },
    clarify:      { label: 'Bring it back', key: null, theme: 'who', icon: 'back', what: 'It’s an ordinary card again, first in line.' },
    pause:        { label: 'Pause', key: 'Z', theme: 'when', what: 'Stop for now, with a line on where you left off.' },
    keepgoing:    { label: 'Keep going', key: 'K', theme: 'when', what: 'The block runs on a little, if your calendar is free.' },
    joinreply:    { label: 'Add to the reply', key: null, theme: 'who', icon: 'arrow', what: 'It goes into the reply that is waiting for your OK.' }
  };

  var violations = [];
  function flag(msg, spec) {
    violations.push(msg);
    try { console.warn('[card-actions] ' + msg, spec); } catch (e) { /* no console */ }
  }

  function verbOf(slot) {
    if (typeof slot === 'string') slot = { verb: slot };
    var base = VERBS[slot.verb] || {};
    if (slot.verb && !VERBS[slot.verb] && !slot.act) flag('unknown verb ' + slot.verb);
    var o = {}; Object.keys(base).forEach(function (k) { o[k] = base[k]; });
    Object.keys(slot).forEach(function (k) { o[k] = slot[k]; });
    o.act = o.act || o.verb;
    return o;
  }

  /* data-key is how a comeback card's keys find a button whose act the global key table doesn't know */
  function attrs(v) {
    return ' data-act="' + esc(v.act) + '"' + (v.key ? ' data-key="' + v.key.toLowerCase() + '" aria-keyshortcuts="' + v.key + '"' : '') + (v.attrs ? ' ' + v.attrs : '');
  }
  function label(v) { return esc(v.label) + (v.key ? kbd(v.key) : ''); }

  /* A numbered answer: the number is its key. It wears the number instead of an icon (rule 3). */
  function answerBtn(a, lead) {
    var body = '<span class="k" aria-hidden="true">' + a.n + '</span><span><b>' + esc(a.label) + '</b>' + (a.small ? '<small>' + esc(a.small) + '</small>' : '') + '</span>';
    var at = (a.quick != null ? ' data-quick="' + a.quick + '"' : ' data-act="' + esc(a.act) + '"') + ' data-num="' + a.n + '" aria-keyshortcuts="' + a.n + '"' + (a.attrs ? ' ' + a.attrs : '');
    return '<button type="button" class="ans ca-ans' + (lead ? ' primary' : '') + '"' + at + '>' + body + '</button>';
  }

  var MENU_IDS = { who: 'whomenu', when: 'whenmenu', clear: 'clearmenu', answers: 'answersmenu' };
  function menuHTML(m, host) {
    var items = (m.items || []).map(function (it) { return verbOf(it); });
    if (items.length > 4) flag('a menu holds at most four items: ' + (host.label || host.verb), m);
    if (m.theme !== 'answers') items.forEach(function (v) { if (v.theme !== m.theme) flag(v.label + ' is a ' + v.theme + ' move and does not belong in a ' + m.theme + ' menu', m); });
    var name = m.label || ({ who: 'Do it another way', when: 'Book time instead', clear: 'Clear it another way', answers: 'Other answers' })[m.theme];
    var id = MENU_IDS[m.theme] || 'moremenu';
    return { id: id, name: name, items: items, html: '<div class="menu" role="menu" id="' + id + '" hidden aria-label="' + esc(name) + '"><p class="menu-h" aria-hidden="true">' + esc(name) + '</p>' +
      items.map(function (v) {
        if (v.answer) return '<button type="button" role="menuitem"' + (v.answer.quick != null ? ' data-quick="' + v.answer.quick + '"' : ' data-act="' + esc(v.answer.act) + '"') + ' data-num="' + v.answer.n + '" aria-keyshortcuts="' + v.answer.n + '"><b>' + esc(v.answer.label) + kbd(v.answer.n) + '</b>' + (v.answer.small ? '<span>' + esc(v.answer.small) + '</span>' : '') + '</button>';
        return '<button type="button" role="menuitem"' + attrs(v) + '><b>' + esc(v.label) + (v.key ? kbd(v.key) : '') + '</b><span>' + esc(v.what || '') + '</span></button>';
      }).join('') + '</div>' };
  }

  /* One button, or a split: the button with its chevron and menu */
  function slotHTML(slot, role, seen) {
    var isAns = slot && slot.answer, v = isAns ? { answer: slot.answer, label: slot.answer.label } : verbOf(slot);
    var menu = slot && slot.menu ? menuHTML(slot.menu, v) : null, lead = role === 'lead';
    var main;
    if (isAns) main = answerBtn(slot.answer, lead);
    else {
      var primary = lead || v.primary;
      main = '<button type="button" class="btn' + (primary ? ' primary' : '') + (menu ? ' split-main' : '') + (lead ? ' ca-lead-btn' : '') + (v.cls ? ' ' + v.cls : '') + '"' + attrs(v) + '>' +
        (lead && v.icon ? ICON[v.icon] : '') + label(v) + '</button>';
      var id = v.verb + '|' + v.act; if (seen[id]) flag(v.label + ' appears twice on one card');
      seen[id] = true;
    }
    if (!menu) return main;
    return '<div class="split ca-split ' + (lead ? 'ca-lead' : 'ca-slot') + ' ca-' + (slot.menu.theme) + '">' + main +
      '<button type="button" class="btn more-btn' + (lead ? ' primary' : '') + '" data-act="more" data-menu="' + menu.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(menu.name) + '" title="' + esc(menu.name) + '">' + CHEVRON + '</button>' +
      menu.html + '</div>';
  }

  /* spec: { line?, lead, row?: [≤3 slots], cls? } */
  function render(spec) {
    var row = spec.row || [], seen = {};
    if (!spec.lead) flag('a card needs one lead', spec);
    if (row.length > 3) flag('a row holds at most three sub-actions, not ' + row.length, spec);
    var visible = 1 + row.length;
    if (visible > 4) flag('at most four visible choices, not ' + visible, spec);
    /* Rule 5: the row reads who does it, then when, then clear it from my plate. Answers have no theme. */
    var RANK = { who: 0, when: 1, clear: 2 }, last = -1;
    row.forEach(function (s) {
      if (!s || s.answer) return;
      var r = RANK[verbOf(s).theme];
      if (r == null) return;
      if (r < last) flag(verbOf(s).label + ' is out of order: who does it, then when, then clear it from my plate', spec);
      last = Math.max(last, r);
    });
    var keys = {};
    [spec.lead].concat(row).forEach(function (s) {
      if (!s) return;
      var all = [s].concat(s.menu ? (s.menu.items || []) : []);
      all.forEach(function (x) {
        var v = x.answer ? { key: String(x.answer.n), label: x.answer.label, act: x.answer.act || 'quick' + x.answer.quick } : verbOf(x);
        if (v.key) { if (keys[v.key] && keys[v.key] !== v.act) flag('key ' + v.key + ' means both ' + keys[v.key] + ' and ' + v.act, spec); keys[v.key] = v.act; }
      });
    });
    var h = '<div class="card-actions' + (spec.cls ? ' ' + spec.cls : '') + '">';
    if (spec.line) h += '<p class="ca-line">' + esc(spec.line) + '</p>';
    h += slotHTML(spec.lead, 'lead', seen);
    if (row.length) h += '<div class="ca-row ca-n' + row.length + '">' + row.map(function (s) { return slotHTML(s, 'row', seen); }).join('') + '</div>';
    return h + '</div>';
  }

  window.CardActions = {
    VERBS: VERBS, ICON: ICON, CHEVRON: CHEVRON, kbd: kbd, render: render, violations: violations
  };
})();
