/* Fuzz tucked into the card. Plain DOM, the real rig (js/fuzz-rig.js) and the app's card classes.

   Geometry: everything comes from one scale, s = Fuzz's width / 200 (the rig's viewBox is 200 by 222), and one
   line, T, the rig y where the card's top edge crosses him. Above T: his head, the antennas and his line,
   in the perch. Below T: his body, standing in the card's top-left corner. The card's first child is a left
   float the size of that lower part, and its shape-outside is traced from the drawn parts of the rig, so the
   headline and paragraphs wrap around his outline. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), card = $('card'), pwrap = $('pwrap'), frame = $('frame'), bubble = $('bubble');
  var RIG_W = 200, HEAD_L = 30, HEAD_R = 170, HEAD_MID = 64, TODAY_W = 160;
  var GAP = 8;          // px between his outline and the text
  var CORNER = 4;       // px from the card's left edge to his head's left edge, before Sideways
  var SLICE = 2;        // rig units per row of the traced outline

  /* ---------- Theme ---------- */
  var themeSel = $('themeSel'), modeSel = $('modeSel');
  Themes.list.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; themeSel.appendChild(o); });
  modeSel.value = Themes.resolveMode ? Themes.resolveMode('auto') : 'light';
  function theme() { Themes.apply(themeSel.value, modeSel.value, 'standard'); requestAnimationFrame(layout); }
  themeSel.onchange = modeSel.onchange = theme;

  /* ---------- Cards (the app's markup, trimmed) ---------- */
  function kbd(k) { return '<kbd aria-hidden="true">' + k + '</kbd>'; }
  var SVG = function (d, w) { return '<svg width="' + (w || 16) + '" height="' + (w || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var ARROW = SVG('<path d="M5 12h14M13 6l6 6-6 6"/>', 20), CHEV = SVG('<path d="M6 9l6 6 6-6"/>'),
    CLOCK = SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), CHECK = SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    SEND = SVG('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>', 20);
  function eyebrow(items) {
    return '<div class="tagrow"><p class="eyebrow">' + items.map(function (h, i) {
      return '<span class="eb-i"><span class="eb-sep" aria-hidden="true">' + (i ? '·' : '') + '</span>' + h + '</span>';
    }).join('') + '</p></div>';
  }
  function ask(t) { return '<h2 class="ask" tabindex="-1">' + t + '</h2>'; }
  function idTag(n) { return '<p class="taskid"><span class="taskid-txt">Task #' + n + '</span></p>'; }
  function details(text) {
    return '<details class="card-details"><summary>Details <span class="meta">where it came from, people, sources</span>' + kbd('I') + '</summary><p class="incoming">' + text + '</p></details>';
  }
  function split(cls, main, primary, label) {
    return '<div class="split ' + cls + '">' + main + '<button type="button" class="btn' + (primary ? ' primary' : '') + ' more-btn" aria-label="' + label + '">' + CHEV + '</button></div>';
  }
  function taskActions(assignPrimary) {
    return '<div id="actions"><div class="actions">' +
      split('split-assign', '<button type="button" class="btn split-main' + (assignPrimary ? ' primary' : '') + '">' + ARROW + 'Hand it to Fuzz' + kbd('A') + '</button>', assignPrimary, 'Ask Fuzz something else') +
      '<button type="button" class="btn">Work in Claude' + kbd('C') + '</button>' +
      split('split-later', '<button type="button" class="btn split-main">' + CLOCK + 'Later' + kbd('S') + '</button>', false, 'Book time instead') +
      split('split-done', '<button type="button" class="btn done-btn">' + CHECK + 'I did it' + kbd('D') + '</button>', false, 'Clear it another way') +
      '</div></div>';
  }
  function answers(list) {
    return '<div class="answers" role="group" aria-label="Answer and hand it to Fuzz">' + list.map(function (a, i) {
      return '<button type="button" class="ans' + (i === 0 ? ' primary' : '') + '"><span class="k" aria-hidden="true">' + (i + 1) + '</span><span><b>' + a[0] + '</b>' + (a[1] ? '<small>' + a[1] + '</small>' : '') + '</span></button>';
    }).join('') + '</div>';
  }
  var CARDS = {
    task: { say: 'Nothing to choose on this one. Want me to take it?', mood: 'eager', html: function () {
      return eyebrow(['<span class="src">Email · Ines Ortega</span>', '<span class="eb">2 days</span>', '<span class="eb">Small</span>', '<button type="button" class="eb eb-link">March offsite</button>']) +
        ask('Send Ines the shortlist of three venues for the March offsite') +
        '<div class="plan"><p class="lbl">I’ll do this</p><p class="plantext">Reply to Ines with the three venues from the planning doc, with prices and the dates each one has free in March. I’ll draft it for your OK first.</p>' +
        '<button type="button" class="linkbtn inline">Change what I’ll do' + kbd('E') + '</button></div>' +
        taskActions(true) + details('Ines asked on Tuesday: “Can you send me the venues you liked? I’d like to book this week.”') + idTag(214);
    } },
    question: { say: 'One question on this one. Pick an answer and I’ll take it from there.', mood: 'idle', html: function () {
      return eyebrow(['<span class="src">Slack · Marco Ruiz</span>', '<span class="eb">1 day</span>', '<span class="eb">Medium</span>']) +
        ask('Which day should the design review move to?') +
        '<div class="finding"><span class="finding-tag">What Fuzz found</span><img class="finding-av" src="../../assets/fuzz-mark.svg" alt=""><p>Marco can’t make Thursday. Priya is out Friday afternoon, and the review room is free Monday and Tuesday mornings.</p></div>' +
        answers([['Monday at 10', 'I’ll move it and tell the five people invited'], ['Tuesday at 9:30', 'Same, a day later'], ['Keep Thursday', 'Marco reads the notes after'], ['Something else', 'Tell me in your own words.']]) +
        '<button type="button" class="linkbtn inline addnote">Tell Fuzz something' + kbd('E') + '</button>' +
        taskActions(false) + details('Marco in #design: “Thursday’s out for me, can we shuffle the review?”') + idTag(198);
    } },
    stale: { say: 'This one’s been sitting a while. Still want it?', mood: 'caring', html: function () {
      return eyebrow(['<span class="tag">Back again</span>', '<span class="src">Meeting notes · Weekly planning</span>', '<span class="eb eb-warn">Sitting · 9 days</span>']) +
        ask('Does this still matter?') +
        '<div class="title-block"><h3 class="task-title">Write up the onboarding checklist for new contractors</h3></div>' +
        '<p class="incoming">From the planning meeting on the 4th: “Someone should write down what a contractor needs on day one: laptop, accounts, the repo tour, who to ask about invoices. Last time it took a week to get Sam set up.”</p>' +
        '<p class="incoming">It has come back twice since, and nobody has started it. Two new contractors start on the 1st, so if it still matters it needs a slot this week.</p>' +
        answers([['Yes, hand it to Fuzz', 'I’ll draft the checklist from the notes for your OK'], ['Yes, I’ll write it', 'Pick a time this week']]) +
        '<div class="actions"><button type="button" class="btn">It still matters' + kbd('K') + '</button><button type="button" class="btn">' + CLOCK + 'Later' + kbd('S') + '</button><button type="button" class="btn">Let it go' + kbd('L') + '</button></div>' +
        idTag(131);
    } },
    draft: { say: 'Here’s the reply. Nothing goes out until you say so.', mood: 'eager', html: function () {
      return eyebrow(['<span class="tag tag--ok">Needs your OK</span>', '<span class="src">Email · Ines Ortega</span>']) +
        ask('Send this to Ines?') +
        '<section class="draft"><div class="draft-to"><span>To</span> <strong>Ines Ortega</strong><span class="via">Email</span></div>' +
        '<label class="sr" for="draft">Message to Ines Ortega</label><textarea id="draft" rows="4">Hi Ines, here are the three venues I liked for March: the Foundry (free 10–12th), Harbour House (free 17–19th) and the Old Library (free any week but the last). Prices are in the planning doc. Happy to book whichever you prefer.</textarea></section>' +
        '<div id="actions"><div class="actions review">' + split('', '<button type="button" class="btn primary done-btn">' + SEND + 'Approve and send</button>', true, 'Finish it another way') +
        '<button type="button" class="btn">Ask Fuzz to change it' + kbd('E') + '</button><button type="button" class="btn">Not now' + kbd('S') + '</button></div>' +
        '<p class="sendnote">Fuzz sends exactly this once you approve. You can undo until it has gone out.</p></div>' + idTag(214);
    } }
  };

  /* ---------- Fuzz ---------- */
  var rig = FuzzRig.rig(pwrap);
  var POSES = ['idle', 'wave', 'point', 'thinking', 'working', 'proud', 'sulk', 'cheer', 'jazz', 'jog', 'listen', 'sleepy', 'chill', 'take', 'boop', 'twang', 'quickShrug', 'hop'];
  var poseSel = $('poseSel');
  POSES.forEach(function (n) {
    var r = FuzzRig.reactions[n]; if (!r) return;
    var o = document.createElement('option'); o.value = n; o.textContent = r.label + (r.once ? ' (once)' : ''); poseSel.appendChild(o);
  });
  poseSel.onchange = function () {
    var r = FuzzRig.reactions[poseSel.value];
    rig.play(poseSel.value);
    if (r && r.say) say(r.say);
  };
  pwrap.addEventListener('click', function () { rig.play('boop'); });
  function say(t) {
    $('say').textContent = t;
    bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
    requestAnimationFrame(placeBubble);
  }

  /* The drawn parts of the rig, as boxes in rig units. Rect boxes include every transform the pose applied. */
  var SKIP = 'defs,clipPath,pattern,mask,.dmic,.paper,.vhs,.zzz';
  function trace() {
    var svg = rig.svg, r = svg.getBoundingClientRect(), s = r.width / RIG_W, out = [];
    if (!s) return out;
    Array.prototype.forEach.call(svg.querySelectorAll('path,rect,circle,ellipse,polygon,line'), function (el) {
      if (el.closest(SKIP) || el.classList.contains('hit') || el.classList.contains('bshadow')) return;
      var b = el.getBoundingClientRect();
      if (!b.width && !b.height) return;   /* display: none */
      out.push([(b.left - r.left) / s, (b.right - r.left) / s, (b.top - r.top) / s, (b.bottom - r.top) / s]);
    });
    return out;
  }
  /* His resting outline: measured once, standing still, then the chosen reaction plays */
  rig.snap('idle'); rig.draw();
  var restBoxes = trace(), liveBoxes = null;
  say(CARDS.task.say);

  /* ---------- State ---------- */
  var st = { mode: 'tuck', shape: 'silhouette', size: 220, tuck: 120, side: 0, card: 'task', width: 720, live: false, show: false, autoOff: false, autoW: 440 };
  var form = $('controls');
  function read() {
    st.mode = form.mode.value; st.shape = form.shape.value;
    st.size = +$('size').value; st.tuck = +$('tuck').value; st.side = +$('side').value;
    st.width = +$('widthSel').value; st.live = $('live').checked; st.show = $('showShape').checked;
    st.autoOff = $('autoOff').checked; st.autoW = +$('autoW').value;
    $('sizeOut').textContent = st.size + ' px';
    $('tuckOut').textContent = st.tuck <= 106 ? 'chin (' + st.tuck + ')' : st.tuck <= 126 ? 'neck (' + st.tuck + ')' : st.tuck <= 166 ? 'waist (' + st.tuck + ')' : 'legs (' + st.tuck + ')';
    $('sideOut').textContent = (st.side > 0 ? '+' : '') + st.side + ' px';
  }
  form.addEventListener('input', function (e) {
    if (e.target.id === 'cardSel') return;
    read(); if (e.target.id === 'live') liveLoop(); layout();
  });
  $('cardSel').onchange = function () { showCard($('cardSel').value, true); };
  $('next').onclick = function () {
    var keys = Object.keys(CARDS), i = (keys.indexOf(st.card) + 1) % keys.length;
    $('cardSel').value = keys[i]; showCard(keys[i], true);
  };
  function showCard(k, animate) {
    st.card = k; var c = CARDS[k];
    card.className = 'card';
    card.innerHTML = c.html();
    if (animate) { void card.offsetWidth; card.classList.add('enter'); }
    rig.bot.dataset.mood = c.mood; say(c.say);
    layout();
  }

  /* ---------- Layout ---------- */
  var hole = null;
  function px(n) { return Math.round(n * 10) / 10 + 'px'; }
  /* Which layout actually applies: the tuck turns itself off on a card too narrow for text beside him */
  function effective(mode) {
    if (mode !== 'tuck' || !st.autoOff) return mode;
    stage.classList.remove('tuck');
    return card.clientWidth < st.autoW ? 'big' : 'tuck';
  }
  function apply(mode) {
    frame.style.width = st.width + 'px';
    stage.classList.toggle('show-shape', st.show);
    var m = effective(mode);
    if (m !== 'tuck') {
      stage.classList.remove('tuck');
      ['--perch-h', '--fuzz-x', '--fuzz-w', '--bubble-x', '--bubble-y', '--bubble-w'].forEach(function (k) { stage.style.removeProperty(k); });
      pwrap.style.width = (m === 'today' ? TODAY_W : st.size) + 'px';
      if (hole) { hole.remove(); hole = null; }
      return m;
    }
    var s = st.size / RIG_W, T = st.tuck, cs = getComputedStyle(card);
    var padL = parseFloat(cs.paddingLeft), padT = parseFloat(cs.paddingTop);
    var x0 = st.side + CORNER - HEAD_L * s;   /* where rig x 0 sits, from the card's left edge */
    stage.classList.add('tuck');
    pwrap.style.width = '';
    stage.style.setProperty('--fuzz-w', st.size + 'px');
    stage.style.setProperty('--fuzz-x', px(x0));
    stage.style.setProperty('--perch-h', px(T * s));

    /* The float: one row per slice of rig y below T, as wide as the furthest drawn part on that row,
       grown by GAP in every direction so text keeps its distance above and below a hand too. */
    var boxes = st.live && liveBoxes ? liveBoxes : restBoxes, g = GAP / s, bottom = 0;
    boxes.forEach(function (b) { if (b[3] > bottom) bottom = b[3]; });
    var fx = function (x) { return Math.max(0, x0 + x * s - padL + GAP); };
    var fy = function (y) { return Math.max(0, (y - T) * s - padT); };
    var pts = [], w = 0, prev = null;
    for (var y = T; y < bottom + g; y += SLICE) {
      var r = 0;
      boxes.forEach(function (b) { if (b[3] + g > y && b[2] - g < y + SLICE && b[1] > r) r = b[1]; });
      var xr = r ? fx(r) : 0, a = fy(y), z = fy(y + SLICE);
      if (z <= 0) { if (xr > w) w = xr; prev = Math.max(prev || 0, xr); continue; }
      if (prev !== null && pts.length === 0) { pts.push([0, 0], [prev, 0]); }
      pts.push([xr, a], [xr, z]); if (xr > w) w = xr;
    }
    var h = fy(bottom + g);
    if (!hole) { hole = document.createElement('div'); hole.className = 'tuck-hole'; hole.setAttribute('aria-hidden', 'true'); }
    if (card.firstChild !== hole) card.insertBefore(hole, card.firstChild);
    hole.classList.toggle('rect', st.shape === 'rect');
    if (w <= 0 || h <= 0) { hole.style.display = 'none'; }
    else {
      hole.style.display = '';
      if (!pts.length || pts[0][0] || pts[0][1]) pts.unshift([0, 0]);
      pts.push([0, h]);
      var poly = 'polygon(' + pts.map(function (p) { return px(p[0]) + ' ' + px(p[1]); }).join(',') + ')';
      stage.style.setProperty('--hole-shape', st.shape === 'rect' ? 'none' : poly);
      stage.style.setProperty('--hole-w', px(w + 1));
      stage.style.setProperty('--hole-h', px(h));
    }
    placeBubble();
    return m;
  }
  /* His line sits right of his head, centred on the screen, and never drops onto the card */
  function placeBubble() {
    if (!stage.classList.contains('tuck')) return;
    var s = st.size / RIG_W, x0 = st.side + CORNER - HEAD_L * s, bx = x0 + HEAD_R * s + 6;
    stage.style.setProperty('--bubble-x', px(bx));
    stage.style.setProperty('--bubble-w', px(Math.max(120, stage.clientWidth - bx)));
    var bh = bubble.offsetHeight, top = Math.min(HEAD_MID * s - bh / 2, st.tuck * s - bh - 10);
    stage.style.setProperty('--bubble-y', px(Math.max(0, top)));
  }

  /* ---------- Numbers: the three layouts, measured on this card at this width ---------- */
  function where() {
    var top = stage.getBoundingClientRect().top;
    var q = card.querySelector('.ask'), p = card.querySelector('.btn.primary, .ans.primary');
    return { card: card.getBoundingClientRect().top - top, ask: q ? q.getBoundingClientRect().top - top : 0, act: p ? p.getBoundingClientRect().top - top : 0, h: stage.offsetHeight };
  }
  function layout() {
    var rows = [['today', 'Today (160 px, on the card)'], ['big', 'Bigger (' + st.size + ' px), on the card'], ['tuck', 'Bigger (' + st.size + ' px), tucked in']].map(function (m) {
      apply(m[0]); return { id: m[0], label: m[1], at: where() };
    });
    var used = apply(st.mode), base = rows[0].at;
    $('metrics').innerHTML = '<table><thead><tr><th>Layout</th><th>Card top</th><th>Headline</th><th>Main button</th><th>Whole area</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var d = function (k) { var v = Math.round(r.at[k]), dv = Math.round(r.at[k] - base[k]); return v + ' px' + (r.id === 'today' ? '' : ' <span class="meta">(' + (dv > 0 ? '+' : '') + dv + ')</span>'); };
        return '<tr' + (r.id === st.mode ? ' class="on"' : '') + '><td>' + r.label + '</td><td>' + d('card') + '</td><td>' + d('ask') + '</td><td>' + d('act') + '</td><td>' + d('h') + '</td></tr>';
      }).join('') + '</tbody></table>';
    $('note').textContent = st.mode === 'tuck' && used !== 'tuck'
      ? 'The tuck is off: this card is ' + card.clientWidth + ' px wide, under ' + st.autoW + ' px, so Fuzz stands on the card instead.'
      : st.mode === 'tuck' && card.clientWidth < 440 ? 'Narrow card: the column beside Fuzz is ' + Math.max(0, Math.round(card.clientWidth - parseFloat(getComputedStyle(card).paddingRight) - (hole ? hole.offsetWidth + parseFloat(getComputedStyle(card).paddingLeft) : 0))) + ' px wide. Watch for words broken mid-word.' : '';
  }

  /* Follows his pose: re-trace a few times a second, so text moves out of the way of a reaching arm */
  var liveTimer = null;
  function liveLoop() {
    clearInterval(liveTimer); liveBoxes = null;
    if (!st.live) return;
    liveTimer = setInterval(function () { liveBoxes = trace(); if (st.mode === 'tuck') apply('tuck'); }, 200);
  }

  window.addEventListener('resize', function () { layout(); });
  theme(); read(); showCard('task', false);
  poseSel.value = 'idle'; rig.play('idle');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
})();
