/* The composer: the box every "tell Fuzz something" field is drawn in (New, Tell Fuzz, Ask Fuzz to change it).
   A label row with an optional hint, the textarea, and one toolbar under it: + (add a source), the mic, and what
   was added. This file draws the markup only. What + offers, and what happens when it is pressed, is the view's,
   because a new task, a card's note and a draft's changes each add different things. */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  var PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  /* The + button and its menu. o: { btnId?, act?, menuId, label, title?, open?, body, cls? }.
     body is the menu's inner HTML, which is the view's. The button carries data-act when act is given. */
  function plus(o) {
    var open = !!o.open;
    return '<div class="plus' + (o.cls ? ' ' + o.cls : '') + '"><button type="button" class="plusbtn' + (open ? ' on' : '') + '"' + (o.btnId ? ' id="' + o.btnId + '"' : '') + (o.act ? ' data-act="' + o.act + '"' : '') +
      ' aria-haspopup="menu" aria-expanded="' + open + '" aria-controls="' + o.menuId + '" aria-label="' + esc(o.label) + '" title="' + esc(o.title || o.label) + '">' + PLUS + '</button>' +
      '<div class="menu plusmenu" role="menu" id="' + o.menuId + '" aria-label="' + esc(o.menuLabel || o.label) + '"' + (open ? '' : ' hidden') + '>' + o.body + '</div></div>';
  }

  /* The toolbar. o: { plus: html, mic: { for, label, id? } | null, after: html } */
  function bar(o) {
    var mic = o.mic ? Dictate.button(o.mic.for, o.mic.label || 'Dictate', 'plusbtn') : '';
    if (mic && o.mic.id) mic = mic.replace('<button ', '<button id="' + o.mic.id + '" ');
    return '<div class="composer-bar">' + (o.plus || '') + mic + (o.after || '') + '</div>';
  }

  /* What the keys do in a box, as short pairs: [key, what it does]. Two to four words each. Where dictation works the
     component adds its own pair, so no view has to remember it. opts.dictate: false leaves it out. */
  function keyItems(items, opts) {
    var all = (items || []).slice();
    if (!(opts && opts.dictate === false) && window.Dictate && Dictate.supported) all.push(['Hold ' + Dictate.key, 'Dictate']);
    return all.map(function (i) { return '<span><kbd aria-hidden="true">' + i[0].replace('⌘ ', MAC ? 'Cmd + ' : 'Ctrl + ') + '</kbd>' + esc(i[1]) + '</span>'; }).join('');
  }
  /* The line under a box that shows while the box has focus */
  function typing(items, opts) { return '<p class="typing keysline">' + keyItems(items, opts) + '</p>'; }

  /* The boxed field. o: { id, rows, value?, placeholder?, describedBy?, tools: html, toolsId?, typing? }. The toolbar sits inside the box, and typing (see above) goes under it. Put the box in a .instr for the line to show only while it has focus. */
  function box(o) {
    return '<div class="composer"><textarea id="' + o.id + '" rows="' + (o.rows || 3) + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.describedBy ? ' aria-describedby="' + o.describedBy + '"' : '') + '>' + esc(o.value) + '</textarea>' +
      '<div class="refs"' + (o.toolsId ? ' id="' + o.toolsId + '"' : '') + (o.toolsFor ? ' data-for="' + o.toolsFor + '"' : '') + '>' + (o.tools || '') + '</div></div>' + (o.typing ? typing(o.typing, o.typingOpts) : '');
  }

  /* A labelled field: label and hint over the box. Same as box() with the row above it. o adds { label, hint? } */
  function field(o) {
    return '<div class="instr-top"><label for="' + o.id + '">' + esc(o.label) + '</label>' + (o.hint ? '<span>' + esc(o.hint) + '</span>' : '') + '</div>' + box(o);
  }

  window.Composer = { plus: plus, bar: bar, box: box, field: field, typing: typing, PLUS: PLUS };
})();
