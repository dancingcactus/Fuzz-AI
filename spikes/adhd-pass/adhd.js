/* ADHD pass mockups. Plain DOM, no store: each screen shows one fix from the review. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  /* ---------- Theme ---------- */
  var themeSel = $('themeSel'), modeSel = $('modeSel');
  Themes.list.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; themeSel.appendChild(o); });
  modeSel.value = Themes.resolveMode ? Themes.resolveMode('auto') : 'light';
  function theme() { Themes.apply(themeSel.value, modeSel.value, 'standard'); }
  themeSel.onchange = modeSel.onchange = theme; theme();

  /* ---------- Fuzz ---------- */
  $('pwrap').innerHTML = window.FUZZ_SVG;
  qa('.mini').forEach(function (m) { m.innerHTML = '<img src="../../assets/fuzz-mark.svg" alt="">'; });
  function say(line, mood) {
    $('say').textContent = line;
    var b = $('bot'); if (b) b.setAttribute('data-mood', mood || 'idle');
    var bub = document.querySelector('.bubble'); bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
  }

  /* ---------- Cleared ticks: they only grow, no empty slots ---------- */
  var cleared = 2;
  function ticks(fresh) {
    var h = '<span>✓ ' + cleared + '</span>';
    for (var i = 0; i < cleared; i++) h += '<i' + (fresh && i === cleared - 1 ? ' class="new"' : '') + '></i>';
    $('ticks').innerHTML = h;
  }
  ticks(false);

  /* ---------- Screens ---------- */
  var LINES = {
    arrive: ['Welcome back. Here’s what happened while you were away.', 'happy'],
    plain: ['Nothing to choose on this one. Want me to take it?', 'eager'],
    card: ['One question on this one. Pick an answer and I’ll take it from there.', 'idle'],
    draft: ['Here’s the reply. Nothing goes out until you say so.', 'eager'],
    handback: ['', 'idle'], comeback: ['', 'idle'], checkback: ['', 'idle'], entity: ['', 'idle'],
    lineup: ['Everything, by who has the ball.', 'idle'],
    keys: ['Each letter means one thing now.', 'idle'],
    capture: ['Get it out of your head. I’ll sort it later.', 'eager']
  };
  /* What the ways behind the arrows do, on the task and question cards */
  var OTHER = {
    book: ['Time booked.', 'I’ll hold time on your calendar. It doesn’t count as putting it off.'],
    donow: ['It’s your working card.', 'Okay, just this one. The rest is out of view.'],
    afterothers: ['After the others.', 'Okay. It comes back at the end of this session.'],
    park: ['Parked.', 'Parked. It waits until someone follows up, or you bring it back.'],
    waiting: ['Waiting on someone.', 'Okay. In the app I ask who, then I check back.'],
    theirs: ['Not yours.', 'Okay. I’ll bring it back if a new ask needs you.']
  };
  var KEYS_OTHER = { b: 'book', p: 'park', w: 'waiting', x: 'theirs' };
  /* No Find out mode: what you hand over decides it. A question gets looked up and the card comes back to
     you with the answer; anything else, Fuzz does. He says which, the moment you hand it over. */
  function isQuestion(t) {
    t = (t || '').trim().toLowerCase();
    return /\?$/.test(t) || /^(who|what|when|where|why|how|which|is|are|was|were|can|could|does|do|did|has|have|will|should)\b/.test(t) ||
      /^(find out|check whether|check if|look up|see if|see whether|ask (him|her|them)?\s*(if|whether))\b/.test(t);
  }
  var ASKED = ['Finding out.', 'That’s a question, so I’ll find out and bring this card back to you with the answer.', 'The card comes back to you with what I found. Undo is in the header.'];
  var screen = null;
  function go(name) {
    screen = name;
    qa('[data-screen]').forEach(function (s) { s.hidden = s.dataset.screen !== name; });
    qa('.screens [data-go]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.go === name)); });
    say(LINES[name][0], LINES[name][1]);
    if (name === 'capture') setTimeout(function () { $('capbox').focus(); }, 0);
    else if (document.activeElement && document.activeElement.matches('textarea,input')) document.activeElement.blur();
    if (isGen()) genShow(genVariant());
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); }
  });

  /* ---------- Arrival ---------- */
  function arriveAct(a) {
    if (a === 'start') { go('card'); say('Marcus’s headcount first. One question.', 'eager'); }
    if (a === 'other') { $('other').hidden = false; $('otherq').focus(); say('What do you feel like starting with?', 'idle'); }
  }

  /* ---------- Task card ---------- */
  var card = $('taskcard');
  function typing(on) {
    card.classList.toggle('typing-on', on);
    $('typinghint').hidden = !on;
  }
  function openBox() {
    $('instr').hidden = false; $('times').hidden = true;
    var box = $('instrbox'); box.focus();
    say('Tell me in your own words. ⌘ Enter when you’re done.', 'eager');
  }
  /* What you told Fuzz on a card goes along with whatever you pick next */
  function noteLine(note, n) {
    if (note && n) return 'Your note and ' + filesPhrase(n) + ' go with it: “' + note + '”. ';
    if (note) return 'Your note goes with it: “' + note + '”. ';
    return n ? (n === 1 ? '1 file goes with it. ' : filesPhrase(n) + ' go with it. ') : '';
  }
  function handOff(title, line, asIs) {
    var note = asIs ? '' : $('instrbox').value.trim(), n = fileCount($('instr'));
    card.hidden = true; $('upnext').hidden = true;
    $('donetitle').textContent = title; $('donecard').hidden = false;
    $('donemeta').textContent = noteLine(note, n) + 'You’ll hear from me if anything changes. Undo is in the header.';
    if (note || n) line += note ? ' I’ll follow your note.' : ' I’ll read what you dropped in.';
    cleared++; ticks(true);
    say(line, 'happy');
    $('donecard').querySelector('button').focus();
  }
  function answer(a) {
    if (a === '16') handOff('Telling the venue 16.', 'On it. I’ll tell the venue 16 and let Marcus know.');
    else if (a === '14') handOff('Telling the venue 14.', 'On it. 14 for now, and I’ll ask the two maybes.');
    else openBox();
  }
  function cardAct(a) {
    if (OTHER[a]) return handOff(OTHER[a][0], OTHER[a][1]);
    if (a === 'later') { var t = $('times'); t.hidden = !t.hidden; $('instr').hidden = true; if (!t.hidden) say('When should it come back? Pick a number.', 'idle'); }
    else if (a === 'done') handOff('Marked done.', 'Nice. One off the list.');
    else if (a === 'claude') handOff('Opening it in Claude.', 'It’s with you in Claude. It’ll be under Yours in Lineup.');
    else if (a === 'keys') { var k = $('keyspop'); k.hidden = !k.hidden; }
    else if (a === 'assignbox') {
      var v = $('instrbox').value.trim();
      if (!v) { $('instrbox').focus(); say('What should I do? A few words is plenty.', 'puzzled'); return; }
      typing(false);
      if (isQuestion(v)) { handOff(ASKED[0], ASKED[1], true); $('donemeta').textContent = ASKED[2]; }
      else handOff('Handed to Fuzz.', 'Got it. I’ll go with what you said.', true);
    }
    else if (a === 'note') openBox();
    else if (a === 'reset') resetCard();
    else if (a === 'draftback') {
      $('upnext').hidden = false;
      say('Marcus’s reply is ready. It’s next, after this card.', 'eager');
    }
  }
  function pickTime(t) {
    if (t === 'exact') { say('In the app this opens the exact-time picker.', 'idle'); return; }
    handOff('Back ' + t.charAt(0).toLowerCase() + t.slice(1) + '.', 'Okay. I’ll bring it back ' + t.charAt(0).toLowerCase() + t.slice(1) + '.');
  }
  function resetCard() {
    $('donecard').hidden = true; card.hidden = false;
    $('instr').hidden = true; $('times').hidden = true; $('keyspop').hidden = true; $('instrbox').value = '';
    qa('#instr .files').forEach(function (f) { f.innerHTML = ''; });
    $('more').open = false; typing(false);
    say(LINES.card[0], 'idle');
  }
  $('instrbox').addEventListener('focus', function () { typing(true); });
  $('instrbox').addEventListener('blur', function () { typing(false); });

  /* ---------- Plain task card ---------- */
  var pcard = $('plaincard');
  function pEditOpen() {
    $('plan').hidden = true; $('planedit').hidden = false; $('ptimes').hidden = true;
    var box = $('planbox'); box.value = $('plantext').textContent; box.focus();
    say('Change anything. ⌘ Enter hands it over.', 'eager');
  }
  function pEditClose() {
    var v = $('planbox').value.trim(); if (v) $('plantext').textContent = v;
    $('planedit').hidden = true; $('plan').hidden = false; pcard.classList.remove('typing-on');
  }
  var PLAN = 'Add the three naming rules from the retro to the guide, then share it in #experimentation.';
  function pHandOff(title, line, assigning) {
    var changed = $('plantext').textContent !== PLAN, n = fileCount($('planedit'));
    pcard.hidden = true; $('pdonetitle').textContent = title; $('pdonecard').hidden = false;
    $('pdonemeta').textContent = assigning ? 'I’ll bring you the draft before anything is shared. Undo is in the header.'
      : (changed ? 'What you told me is saved with it: “' + $('plantext').textContent + '”. ' : '') + 'Undo is in the header.';
    if (n) $('pdonemeta').textContent = noteLine('', n) + $('pdonemeta').textContent;
    if (changed && !assigning) line += ' Your note is saved with it.';
    cleared++; ticks(true); say(line, 'happy');
    $('pdonecard').querySelector('button').focus();
  }
  function pReset() {
    $('pdonecard').hidden = true; pcard.hidden = false; pEditClose();
    $('plantext').textContent = PLAN;
    $('ptimes').hidden = true; $('pkeyspop').hidden = true; $('pmore').open = false;
    qa('#planedit .files').forEach(function (f) { f.innerHTML = ''; });
    say(LINES.plain[0], LINES.plain[1]);
  }
  function plainAct(a) {
    if (OTHER[a]) return pHandOff(OTHER[a][0], OTHER[a][1]);
    if (a === 'assign') {
      if (!$('planedit').hidden) pEditClose();
      if (isQuestion($('plantext').textContent)) { pHandOff(ASKED[0], ASKED[1], true); $('pdonemeta').textContent = ASKED[2]; }
      else pHandOff('On the naming guide.', 'On it. I’ll bring you the draft before anything goes to the team.', true);
    }
    else if (a === 'edit') pEditOpen();
    else if (a === 'later') { var t = $('ptimes'); t.hidden = !t.hidden; if (!t.hidden) say('When should it come back? Pick a number.', 'idle'); }
    else if (a === 'done') pHandOff('Marked done.', 'Nice. One off the list.');
    else if (a === 'claude') pHandOff('Opening it in Claude.', 'It’s with you in Claude. It’ll be under Yours in Lineup.');
    else if (a === 'keys') { var k = $('pkeyspop'); k.hidden = !k.hidden; }
    else if (a === 'reset') pReset();
  }
  function pPickTime(t) {
    if (t === 'exact') { say('In the app this opens the exact-time picker.', 'idle'); return; }
    var w = t.charAt(0).toLowerCase() + t.slice(1);
    pHandOff('Back ' + w + '.', 'Okay. I’ll bring it back ' + w + '.');
  }
  $('planbox').addEventListener('focus', function () { pcard.classList.add('typing-on'); });
  $('planbox').addEventListener('blur', function () { pcard.classList.remove('typing-on'); });

  /* ---------- Shared engine: handed back, coming back, check-back, entity checks ----------
     Answers are numbered in order. A button with data-title finishes the card; data-open shows a panel
     in the card; data-key gives it a letter. Nothing starts in a text box. */
  function scrEl() { return document.querySelector('[data-screen="' + screen + '"]'); }
  function isGen() { var s = scrEl(); return !!s && s.classList.contains('genscr'); }
  function genCard() { return qa('.gen', scrEl()).filter(function (c) { return !c.hidden; })[0]; }
  function genVariant() { var p = scrEl().querySelector('.variants [aria-pressed="true"]'); return p ? p.dataset.v : null; }
  qa('.gen .answers').forEach(function (g) { qa('.ans .k', g).forEach(function (k, i) { k.textContent = i + 1; }); });
  qa('.gen-guess').forEach(function (g) { g.dataset.orig = g.textContent; });
  /* Every card gets Tell Fuzz (E): a note box that goes along with whatever you pick. A term card's
     guess is already what you tell Fuzz, so it keeps its own box. */
  qa('.gen').forEach(function (c) {
    if (c.querySelector('.gen-guessbox')) return;
    var box = c.querySelector('.gen-box');
    if (!box) {
      box = document.createElement('div'); box.className = 'instr gen-box'; box.hidden = true;
      box.innerHTML = '<label class="lbl">Tell Fuzz</label><textarea rows="2"></textarea><p class="typing"></p>';
      box.querySelector('textarea').placeholder = c.dataset.notePh || 'Anything I should know?';
      c.querySelector('.answers').after(box);
    }
    var sub = box.querySelector('[data-submit]');
    box.querySelector('.typing').innerHTML = 'You’re typing. ' + (sub ? '<kbd>⌘ Enter</kbd> hands it over as is. ' : '') +
      '<kbd>Esc</kbd> keeps your note, then any answer or action takes it along.';
    var link = c.querySelector('.addnote');
    if (!link) {
      link = document.createElement('button'); link.type = 'button'; link.className = 'linkbtn inline addnote';
      link.dataset.key = 'e'; link.dataset.open = '.gen-box';
      box.before(link);
    }
    link.innerHTML = 'Tell Fuzz something <kbd>E</kbd>';
  });
  function genNote(c) { var t = c.querySelector('.gen-box textarea:not(.gen-guessbox)'); return t ? t.value.trim() : ''; }
  function genClean(c) {
    qa('.gen-box, .nudge', c).forEach(function (p) { p.hidden = true; });
    qa('textarea', c).forEach(function (t) { t.value = t.defaultValue; });
    qa('.gen-guess', c).forEach(function (g) { g.textContent = g.dataset.orig; });
    qa('details', c).forEach(function (d) { d.open = false; });
    qa('.files', c).forEach(function (f) { f.innerHTML = ''; });
    c.classList.remove('typing-on');
  }
  function genShow(v) {
    var s = scrEl(), cards = qa('.gen', s);
    s.querySelector('.gen-done').hidden = true;
    cards.forEach(function (c, i) {
      var on = v ? c.dataset.v === v : i === 0;
      c.hidden = !on;
      if (on) { genClean(c); say(c.dataset.line, c.dataset.mood); }
    });
    qa('.variants button', s).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
  }
  function genOpen(b) {
    var c = b.closest('.gen'), p = c.querySelector(b.dataset.open); if (!p) return;
    p.hidden = false;
    var ta = p.querySelector('textarea');
    if (p.classList.contains('nudge')) { say('Here’s the nudge. Change anything, then approve it.', 'eager'); return; }
    var guess = c.querySelector('.gen-guess');
    if (guess && ta.classList.contains('gen-guessbox')) { ta.value = guess.textContent; guess.closest('.plan').hidden = true; }
    ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length;
    say('Go ahead, I’m listening.', 'eager');
  }
  function genClose(ta) {
    var c = ta.closest('.gen');
    ta.blur(); c.classList.remove('typing-on');
    var guess = c.querySelector('.gen-guess');
    if (guess && ta.classList.contains('gen-guessbox')) {
      if (ta.value.trim()) guess.textContent = ta.value.trim();
      ta.closest('.gen-box').hidden = true; guess.closest('.plan').hidden = false;
      say('Kept your change. Keys are back.', 'idle');
    } else say(ta.value.trim() ? 'Kept your note. Keys are back.' : 'Keys are back.', 'idle');
  }
  function genFinish(b) {
    var c = b.closest('.gen'), title = b.dataset.title, line = b.dataset.say, sub = b.dataset.sub;
    if (b.hasAttribute('data-submit')) {
      var ta = b.closest('.gen-box').querySelector('textarea');
      if (!ta.value.trim()) { ta.focus(); say('A few words is plenty.', 'puzzled'); return; }
      if (isQuestion(ta.value)) { title = ASKED[0]; line = ASKED[1]; sub = ASKED[2]; }
    }
    var d = scrEl().querySelector('.gen-done');
    var note = b.hasAttribute('data-submit') ? '' : genNote(c), n = fileCount(c.querySelector('.gen-box'));
    var guess = c.querySelector('.gen-guess'), guessed = guess && guess.textContent !== guess.dataset.orig;
    c.hidden = true; c.classList.remove('typing-on');
    d.querySelector('.gt').textContent = title;
    d.querySelector('.gm').textContent = noteLine(note, n) +
      (guessed ? 'With your wording: “' + guess.textContent + '”. ' : '') + (sub || 'Undo is in the header.');
    d.hidden = false;
    cleared++; ticks(true);
    say(line + (note ? ' I’ve got your note.' : n ? ' I’ll read what you dropped in.' : ''), title === 'Let go.' ? 'idle' : 'happy');
    d.querySelector('button').focus();
  }
  document.addEventListener('click', function (e) {
    if (!screen || !isGen()) return;
    var v = e.target.closest('.variants [data-v]'); if (v) { genShow(v.dataset.v); return; }
    var b = e.target.closest('button'); if (!b || !scrEl().contains(b)) return;
    if (b.dataset.gen === 'reset') genShow(genVariant());
    else if (b.dataset.open) genOpen(b);
    else if (b.dataset.title) genFinish(b);
  });
  document.addEventListener('focusin', function (e) { var c = e.target.closest && e.target.closest('.gen'); if (c && e.target.tagName === 'TEXTAREA' && e.target.closest('.gen-box')) c.classList.add('typing-on'); });
  document.addEventListener('focusout', function (e) { var c = e.target.closest && e.target.closest('.gen'); if (c && e.target.tagName === 'TEXTAREA') c.classList.remove('typing-on'); });
  function genKey(e, k, low) {
    var d = scrEl().querySelector('.gen-done');
    if (!d.hidden) { if (k === 'Enter') { e.preventDefault(); genShow(genVariant()); } return; }
    var c = genCard(); if (!c) return;
    if (/^[1-9]$/.test(k)) { var a = qa('.answers .ans', c)[+k - 1]; if (a) { e.preventDefault(); a.click(); } return; }
    if (low === 'i') { var det = c.querySelector('details'); if (det) { e.preventDefault(); det.open = !det.open; } return; }
    if (k === 'Escape') { qa('.nudge', c).forEach(function (p) { p.hidden = true; }); return; }
    if (low === 't') { e.preventDefault(); say('In the app this opens Park a stray thought, without leaving the card.', 'idle'); return; }
    var kb = low.length === 1 && c.querySelector('[data-key="' + low + '"]');
    if (kb && !kb.closest('[hidden]:not(.menu)')) { e.preventDefault(); kb.click(); }
  }

  /* ---------- Draft ---------- */
  function draftAct(a) {
    var ch = $('changeq').value.trim() || fileCount($('changebox'));
    if (a === 'send') say(ch ? 'I’ll make that change first, then bring it back for your OK.' : 'Sending. You can undo until it’s gone out.', 'happy');
    if (a === 'sentself') say('Marked done. You send it yourself, and I won’t send this draft.', 'happy');
    if (a === 'notnow') say(ch ? 'Okay. I’ll make that change while it waits under Yours.' : 'Okay. It’ll wait under Yours.', 'idle');
    if (a === 'change') { $('changebox').hidden = false; $('changeq').focus(); say('What should change?', 'eager'); }
  }

  /* ---------- Clicks ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act],[data-ans],[data-time]'); if (!b) return;
    if (b.dataset.ans) return answer(b.dataset.ans);
    if (b.dataset.time) return screen === 'plain' ? pPickTime(b.dataset.time) : pickTime(b.dataset.time);
    var a = b.dataset.act;
    if (screen === 'arrive') arriveAct(a);
    else if (screen === 'plain') plainAct(a);
    else if (screen === 'card') cardAct(a);
    else if (screen === 'draft') draftAct(a);
    else if (a === 'capture') capture();
    else if (a === 'pick') $('capfile').click();
  });

  /* ---------- Capture ---------- */
  function capture() {
    var v = $('capbox').value.trim(), n = fileCount($('capfiles'));
    if (!v && !n) { say('Type or say anything. Half a thought is fine.', 'idle'); $('capbox').focus(); return; }
    $('capbox').value = ''; $('capfiles').innerHTML = '';
    say(n ? 'Captured, with ' + filesPhrase(n) + '. It’s waiting in your triage queue.' : 'Captured. It’s waiting in your triage queue.', 'happy');
  }

  /* ---------- Keys ---------- */
  document.addEventListener('keydown', function (e) {
    var t = e.target, inBox = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
    var k = e.key, low = k.toLowerCase();
    var openMenu = qa('.split .menu').filter(function (m) { return !m.hidden; })[0];
    if (openMenu && k === 'Escape') { e.preventDefault(); var mb = openMenu.parentNode.querySelector('.more-btn'); closeMenus(); mb.focus(); return; }
    if (e.metaKey || e.ctrlKey) {
      if (k === 'Enter' && t && t.id === 'instrbox') { e.preventDefault(); cardAct('assignbox'); }
      if (k === 'Enter' && t && t.id === 'planbox') { e.preventDefault(); plainAct('assign'); }
      if (k === 'Enter' && t && t.closest && t.closest('.gen-box')) { var sb = t.closest('.gen-box').querySelector('[data-submit]'); if (sb) { e.preventDefault(); sb.click(); } }
      if (k === 'Enter' && t && t.id === 'capbox') { e.preventDefault(); capture(); }
      return;
    }
    if (inBox) {
      if (k === 'Escape' && t.closest('.gen')) { e.preventDefault(); genClose(t); return; }
      if (k === 'Escape' && t.id === 'planbox') { e.preventDefault(); t.blur(); pEditClose(); say('Kept your changes. Keys are back.', 'idle'); return; }
      if (k === 'Escape') { e.preventDefault(); t.blur(); if (t.id === 'otherq') $('other').hidden = true; say('Keys are back.', 'idle'); }
      if (k === 'Enter' && t.id === 'otherq') { e.preventDefault(); go('card'); say('Closest match: Marcus’s headcount.', 'eager'); }
      return;
    }
    if (isGen()) { genKey(e, k, low); return; }
    if (screen === 'arrive') {
      if (k === 'Enter') { e.preventDefault(); arriveAct('start'); }
      else if (low === 'o') { e.preventDefault(); arriveAct('other'); }
    } else if (screen === 'plain') {
      if (!$('pdonecard').hidden) { if (k === 'Enter') { e.preventDefault(); pReset(); } return; }
      if (!$('ptimes').hidden && /^[1-4]$/.test(k)) { e.preventDefault(); qa('#ptimes [data-time]')[+k - 1].click(); return; }
      if (k === 'Escape') { $('ptimes').hidden = true; $('pkeyspop').hidden = true; return; }
      if (low === 'a') { e.preventDefault(); plainAct('assign'); }
      else if (low === 'e') { e.preventDefault(); plainAct('edit'); }
      else if (low === 's') { e.preventDefault(); plainAct('later'); }
      else if (low === 'd') { e.preventDefault(); plainAct('done'); }
      else if (low === 'c') { e.preventDefault(); plainAct('claude'); }
      else if (KEYS_OTHER[low]) { e.preventDefault(); plainAct(KEYS_OTHER[low]); }
      else if (low === 'i') { e.preventDefault(); $('pmore').open = !$('pmore').open; }
      else if (k === '?') { e.preventDefault(); plainAct('keys'); }
      else if (low === 't') { e.preventDefault(); say('In the app this opens Park a stray thought, without leaving the card.', 'idle'); }
    } else if (screen === 'card') {
      if (!$('donecard').hidden) { if (k === 'Enter') { e.preventDefault(); resetCard(); } return; }
      if (!$('times').hidden && /^[1-4]$/.test(k)) { e.preventDefault(); qa('#times [data-time]')[+k - 1].click(); return; }
      if (k === 'Escape') { $('times').hidden = true; $('keyspop').hidden = true; return; }
      if (/^[1-3]$/.test(k)) { e.preventDefault(); answer(['16', '14', 'other'][+k - 1]); }
      else if (KEYS_OTHER[low]) { e.preventDefault(); cardAct(KEYS_OTHER[low]); }
      else if (low === 's') { e.preventDefault(); cardAct('later'); }
      else if (low === 'd') { e.preventDefault(); cardAct('done'); }
      else if (low === 'c') { e.preventDefault(); cardAct('claude'); }
      else if (low === 'e') { e.preventDefault(); cardAct('note'); }
      else if (low === 'i') { e.preventDefault(); $('more').open = !$('more').open; }
      else if (k === '?') { e.preventDefault(); cardAct('keys'); }
      else if (low === 't') { e.preventDefault(); say('In the app this opens Park a stray thought, without leaving the card.', 'idle'); }
    } else if (screen === 'draft') {
      if (low === 'e') { e.preventDefault(); draftAct('change'); }
      else if (low === 's') { e.preventDefault(); draftAct('notnow'); }
      else if (low === 'd') { e.preventDefault(); draftAct('sentself'); }
    }
  });

  /* ---------- Drop a file: New task and every Tell Fuzz box ----------
     While a file is dragged over the page, the visible card shows a drop zone where its Tell Fuzz link is.
     Dropping opens the box (as E would) and adds the file as a chip that goes along with your choice. */
  function zoneEl(text, sub) {
    var z = document.createElement('div'); z.className = 'dropzone';
    z.innerHTML = '<span>' + text + '</span><small>' + sub + '</small>'; return z;
  }
  function filesIn(box) {
    var f = box.querySelector('.files');
    if (!f) { f = document.createElement('div'); f.className = 'files'; var t = box.querySelector('.typing'); box.insertBefore(f, t || null); }
    return f;
  }
  function addChips(list, names) {
    names.forEach(function (n) {
      var c = document.createElement('span'); c.className = 'fchip';
      c.innerHTML = '<span></span><button type="button" aria-label="Remove">×</button>';
      c.firstChild.textContent = '📎 ' + n; c.title = n;
      c.lastChild.addEventListener('click', function () { c.remove(); });
      list.appendChild(c);
    });
  }
  function fileCount(el) { return el ? el.querySelectorAll('.fchip').length : 0; }
  function filesPhrase(n) { return n === 1 ? '1 file' : n + ' files'; }
  var zones = [];
  function addZone(before, opts) {
    var z = zoneEl(opts.text || 'Drop it here for Fuzz', opts.sub || 'He’ll read it along with your note.');
    before.parentNode.insertBefore(z, before);
    zones.push({ zone: z, open: opts.open, box: opts.box, say: opts.say });
  }
  /* New task: the zone covers the box */
  (function () {
    var z = zoneEl('Drop it here', 'Fuzz reads it along with your task.');
    $('capdrop').appendChild(z);
    zones.push({ zone: z, open: function () { $('capbox').focus(); }, box: function () { return $('capfiles'); }, say: 'I’ll read it along with your task.' });
  })();
  addZone($('taskcard').querySelector('.addnote'), { open: openBox, box: function () { return filesIn($('instr')); } });
  addZone($('plaincard').querySelector('.row'), { open: function () { if ($('planedit').hidden) pEditOpen(); }, box: function () { return filesIn($('planedit')); } });
  var dcard = document.querySelector('[data-screen="draft"] .card');
  addZone(dcard.querySelector('.others'), { sub: 'Fuzz uses it for the change.', open: function () { draftAct('change'); }, box: function () { return filesIn($('changebox')); } });
  qa('.gen').forEach(function (c) {
    var opener = c.querySelector('.addnote') || c.querySelector('.plan');
    var box = function () { return filesIn(c.querySelector('.gen-box')); };
    addZone(opener, { open: function () {
      var b = c.querySelector('.addnote') || c.querySelector('[data-key="e"]');
      if (c.querySelector('.gen-box').hidden && b) genOpen(b);
    }, box: box });
  });
  function zoneFor(target) { for (var i = 0; i < zones.length; i++) if (zones[i].zone.contains(target)) return zones[i]; return null; }
  var depth = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
  function endDrag() { depth = 0; document.body.classList.remove('dragging'); zones.forEach(function (z) { z.zone.classList.remove('hot'); }); }
  document.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; depth++; document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; if (--depth <= 0) endDrag(); });
  document.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    var z = zoneFor(e.target);
    e.dataTransfer.dropEffect = z ? 'copy' : 'none';
    zones.forEach(function (x) { x.zone.classList.toggle('hot', x === z); });
  });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    var z = zoneFor(e.target); endDrag();
    if (!z) { say('Drop it on the dashed box and I’ll keep it with this card.', 'idle'); return; }
    var names = Array.prototype.map.call(e.dataTransfer.files, function (f) { return f.name; });
    z.open(); addChips(z.box(), names);
    say('Got “' + names[0] + '”' + (names.length > 1 ? ' and ' + (names.length - 1) + ' more' : '') + '. ' + (z.say || 'I’ll read it along with your note.'), 'happy');
  });
  window.addEventListener('blur', endDrag);
  $('capfile').addEventListener('change', function () {
    var names = Array.prototype.map.call(this.files, function (f) { return f.name; });
    if (names.length) { addChips($('capfiles'), names); say('Got “' + names[0] + '”. I’ll read it along with your task.', 'happy'); }
    this.value = '';
  });

  /* ---------- Split buttons: the path for whatever doesn't fit the main moves ----------
     The arrow keeps the close cousins one step away, and each keeps its own key, so P, W, X, B and Q
     work without opening the menu. */
  var ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var WAYS = {
    book: ['B', 'Book time', 'Hold time on your calendar to do it. It doesn’t count as putting it off.'],
    donow: ['', 'Do it now', 'Open it as your working card, with the rest out of view.'],
    afterothers: ['', 'After the others', 'To the end of this session. No penalty.'],
    park: ['P', 'Park it', 'Out of triage with no date. It waits until someone follows up, or you bring it back.'],
    waiting: ['W', 'Waiting on someone', 'You’re blocked until they get back to you. I check back.'],
    theirs: ['X', 'Not mine', 'Someone else’s to do. I let it go, and bring it back if a new ask needs you.'],
    sentself: ['D', 'Mark done', 'You send it yourself. I won’t send this draft.']
  };
  function wrapSplit(btn, label, ways, primary) {
    if (!btn) return;
    var sp = document.createElement('div'); sp.className = 'split';
    btn.parentNode.insertBefore(sp, btn); sp.appendChild(btn); btn.classList.add('split-main');
    var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'btn more-btn' + (primary ? ' primary' : '');
    mb.setAttribute('aria-haspopup', 'menu'); mb.setAttribute('aria-expanded', 'false'); mb.setAttribute('aria-label', label); mb.title = label; mb.innerHTML = ARROW;
    var m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', label); m.hidden = true;
    m.innerHTML = '<p class="menu-h" aria-hidden="true">' + label + '</p>';
    ways.forEach(function (w) {
      var id = typeof w === 'string' ? w : w.id, d = WAYS[id], b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      if (typeof w === 'string') b.dataset.act = w;
      else { b.dataset.title = w.title; b.dataset.say = w.say; if (d[0]) b.dataset.key = d[0].toLowerCase(); }
      b.innerHTML = '<b>' + d[1] + (d[0] ? '<kbd>' + d[0] + '</kbd>' : '') + '</b><span>' + d[2] + '</span>';
      m.appendChild(b);
    });
    sp.appendChild(mb); sp.appendChild(m);
  }
  function closeMenus() { qa('.split .menu').forEach(function (m) { m.hidden = true; }); qa('.more-btn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); }
  document.addEventListener('click', function (e) {
    var mb = e.target.closest('.more-btn');
    if (mb) {
      var m = mb.parentNode.querySelector('.menu'), open = m.hidden;
      closeMenus(); m.hidden = !open; mb.setAttribute('aria-expanded', String(open));
      if (open) { var f = m.querySelector('button'); if (f) f.focus(); }
      return;
    }
    closeMenus();
  });
  var CLEAR = ['donow', 'afterothers', 'park', 'waiting', 'theirs'];
  /* Task card and question card: the app's three split buttons */
  wrapSplit($('plaincard').querySelector('[data-act="later"]'), 'Book time instead', ['book']);
  wrapSplit($('plaincard').querySelector('[data-act="done"]'), 'Clear it another way', CLEAR);
  wrapSplit($('taskcard').querySelector('[data-act="later"]'), 'Book time instead', ['book']);
  wrapSplit($('taskcard').querySelector('[data-act="done"]'), 'Clear it another way', CLEAR);
  /* Draft: Approve and send, with Mark done behind it */
  wrapSplit(document.querySelector('[data-screen="draft"] [data-act="send"]'), 'Finish it another way', ['sentself'], true);
  /* The newer cards: the same ways out, behind their Later */
  var G = {
    park: { id: 'park', title: 'Parked.', say: 'Parked. It waits until someone follows up, or you bring it back.' },
    waiting: { id: 'waiting', title: 'Waiting on someone.', say: 'Okay. In the app I ask who, then I check back.' },
    theirs: { id: 'theirs', title: 'Not yours.', say: 'Okay. I’ll bring it back if a new ask needs you.' },
    book: { id: 'book', title: 'Time booked.', say: 'I’ll hold time on your calendar. It doesn’t count as putting it off.' }
  };
  qa('[data-screen="handback"] .gen').forEach(function (c) { wrapSplit(c.querySelector('[data-key="s"]'), 'Clear it another way', [G.book, G.park, G.waiting, G.theirs]); });
  qa('[data-screen="comeback"] .gen').forEach(function (c) { wrapSplit(c.querySelector('[data-key="s"]'), 'Clear it another way', [G.book, G.park, G.theirs]); });
  qa('[data-screen="checkback"] .gen').forEach(function (c) { wrapSplit(c.querySelector('[data-key="s"]'), 'Clear it another way', [G.park, G.theirs]); });

  var start = location.hash.slice(1);
  go(LINES[start] ? start : 'arrive');
})();
