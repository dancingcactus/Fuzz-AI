/* New task. Capture costs nothing (principle 8): type or dictate, no categories, triage happens later.
   Layout comes from the Triage Queue mockup's Capture board. */
(function () {
  var V = {};
  var esc = UI.esc;
  var root, unsub = null, timer = 0, moodTimer = 0, boredTimer = 0, listening = false, attached = [], confirm = '', draft = '', escKey = null, unhold = null, docDrag = null;
  var IDLE_LINE = 'Get it out of your head. I’ll sort it later.';

  function statusFor(c) {
    var it = c.ref ? Store.item(c.ref) : null;
    if (!it) return { text: c.status || 'Waiting in triage', tone: c.tone || 'muted' };
    var map = {
      triage: it.capturedAt && Date.now() - it.capturedAt < 6000 ? ['Fuzz is gathering context', 'accent'] : ['Waiting in triage', 'muted'],
      working: ['Fuzz is working on it', 'accent'], 'queued': ['Next up with Fuzz', 'muted'], review: ['Draft ready for your OK', 'warn'], mine: ['With you', 'muted'], session: ['Open in ' + Store.workIn, 'muted'],
      scheduled: ['Scheduled', 'muted'], parked: ['Parked', 'muted'], waiting: ['Waiting on others', 'warn'], done: ['Done', 'ok'], letgo: ['Let go', 'muted'], dropped: ['Dropped', 'muted'], resolved: ['Done', 'ok']
    };
    var m = it.gathering ? ['Fuzz is gathering context', 'accent'] : map[it.state] || ['Waiting in triage', 'muted'];
    if (c.doc && it.state === 'triage') m = ['Added to triage with the document', 'ok'];
    return { text: m[0], tone: m[1] };
  }

  function listHTML() {
    return Store.get().captured.map(function (c) {
      var s = statusFor(c);
      return '<li class="cap-item"><span class="cap-text">' + (c.doc ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>' : '') + esc(c.text) + '</span>' +
        '<span class="cap-meta">' + UI.pill(s.text, s.tone) + '<span>' + esc(c.time) + '</span></span></li>';
    }).join('');
  }
  function attachedHTML() {
    return attached.map(function (f, i) {
      var n = f.name;
      return '<li class="file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg><span>' + esc(n) + '</span>' +
        '<button type="button" class="iconbtn" data-rm="' + i + '" aria-label="Remove ' + esc(n) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>';
    }).join('');
  }

  V.mount = function (container) {
    root = container; listening = false; confirm = '';
    /* The first New task screen teaches dictation; during the onboarding, Esc leads back to it */
    var ob = Onboard.onCapture();
    /* Same shape as Triage: the full Fuzz on a perch with his speech bubble, then one card.
       He's for looking at; the capture confirmation reaches screen readers through Say.announce. */
    root.innerHTML = '<section class="capture" aria-labelledby="cap-h"><div class="stage cap-stage" id="stage">' +
      '<div class="fx" id="fx"></div>' +
      '<div class="perch" id="perch"><div class="pwrap" id="pwrap" aria-hidden="true">' + window.FUZZ_SVG + '</div><div class="bubble" id="bubble"></div></div>' +
      '<div class="card cap-card">' +
        '<h1 id="cap-h" class="cap-title">What is on your mind?</h1>' +
        /* The field comes first and has focus. While a file is dragged over the page, the box is the drop zone. */
        '<div class="field cap-drop" id="drop"><label for="cap-text">New task</label><textarea id="cap-text" rows="4" placeholder="For example: send Sam the slides from Tuesday"' + (ob && ob.tip ? ' aria-describedby="cap-tip"' : '') + '></textarea>' +
          '<div class="cap-dropzone" aria-hidden="true"><b>Drop it here</b><small>Fuzz reads it along with your task.</small></div></div>' +
        '<ul class="files" id="files" aria-label="Attached documents"></ul>' +
        '<p class="cap-add"><button type="button" class="linkbtn inline" id="dropbtn">Add a document</button><span class="meta"> or drop one on the box. Fuzz reads it along with your task.</span>' +
          '<input type="file" id="file" multiple hidden></p>' +
        (ob && ob.tip && Dictate.supported ? '<p class="cap-tip" id="cap-tip">' + Fuzz.mini('good', { cls: 'tip-fz' }) + '<span>' + esc(ob.tip) + '</span></p>' : '') +
        '<div class="actions cap-actions"><button type="button" class="btn primary" id="cap-go" disabled><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Capture</button>' +
          '<button type="button" class="btn dictate" id="cap-mic" aria-pressed="false" aria-keyshortcuts="Alt+Space"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span id="mic-l">Dictate</span></button>' +
          /* Fuzz's tip already teaches dictation on the first visit, so the hint doesn't say it twice */
          '<span class="hint">Ctrl or Cmd + Enter to capture' + (ob && ob.tip && Dictate.supported ? '' : ' · Hold ' + Dictate.key + ' to dictate') + ' · Esc to go back</span></div>' +
      '</div></div>' +
      '<section class="recent"><h2>Captured recently</h2><ul class="cap-list" id="cap-list"></ul>' +
        '<p class="fine">Tasks from email, Slack and meetings arrive in triage on their own, so you only need to capture the ones that start in your head.</p></section></section>';
    var $ = function (s) { return root.querySelector(s); };
    var ta = $('#cap-text'), go = $('#cap-go');
    function sync() { go.disabled = ta.value.trim() === '' && attached.length === 0; }
    function paintFiles() { $('#files').innerHTML = attachedHTML(); sync(); }
    function paintList() { $('#cap-list').innerHTML = listHTML(); }
    /* What you've typed survives leaving the page, so Esc never costs you a half-written thought. */
    ta.value = draft;
    ta.addEventListener('input', function () { draft = ta.value; sync(); nudge(); if (confirm) { confirm = ''; paintSay(); } });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    function paintSay() { Fuzz.say(confirm || (ob && ob.back ? 'One real thing on your plate. I’m listening.' : IDLE_LINE), { type: false }); }
    /* Mood for a moment, then back to idle (unless something else has changed it since). */
    function moodFor(m, ms) {
      clearTimeout(moodTimer); Fuzz.setMood(m);
      moodTimer = setTimeout(function () { if (Fuzz.mood() === m) Fuzz.setMood('idle'); }, ms);
    }
    /* Left alone with an empty field, he goes back to surfing channels. Any activity wakes him. */
    function nudge() {
      clearTimeout(boredTimer);
      if (Fuzz.mood() === 'bored') { Fuzz.setMood('idle'); paintSay(); }
      boredTimer = setTimeout(function () { if (Fuzz.mood() === 'idle' && !ta.value.trim() && !attached.length && !listening) Fuzz.startBored(); }, 30000);
    }
    function addFiles(list) {
      if (!list || !list.length) return;
      Array.prototype.forEach.call(list, function (f) { attached.push(f); }); paintFiles();
      nudge(); Fuzz.pAnim('gulp'); moodFor('eager', 1400);
      Fuzz.say(list.length === 1 ? 'Ooh, reading material. I’ll look at it with your task.' : 'A whole stack. I’ll read them with your task.', { type: false });
    }
    $('#dropbtn').addEventListener('click', function () { $('#file').click(); });
    $('#file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    /* Drag a file anywhere over the page and the box turns into a drop zone; it lights up under the file */
    var drop = $('#drop'), depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
    function endDrag() { depth = 0; root.classList.remove('cap-dragging'); drop.classList.remove('over'); }
    docDrag = {
      dragenter: function (e) { if (!hasFiles(e)) return; e.preventDefault(); if (depth++ === 0) { root.classList.add('cap-dragging'); nudge(); Fuzz.setMood('eager'); } },
      dragover: function (e) { if (!hasFiles(e)) return; e.preventDefault(); var on = drop.contains(e.target); e.dataTransfer.dropEffect = on ? 'copy' : 'none'; drop.classList.toggle('over', on); },
      dragleave: function (e) { if (hasFiles(e) && --depth <= 0) endDrag(); },
      drop: function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault(); var on = drop.contains(e.target); endDrag();
        if (on) addFiles(e.dataTransfer.files);
        else Fuzz.say('Drop it on the box and I’ll read it with your task.', { type: false });
      }
    };
    Object.keys(docDrag).forEach(function (n) { window.addEventListener(n, docDrag[n]); });
    $('#files').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (!b) return; attached.splice(parseInt(b.dataset.rm, 10), 1); paintFiles(); });

    /* Dictation (dictate.js): the button starts and stops it, and holding Alt (Option) + Space listens
       only while held. What you say lands after what you'd typed, words appearing as you talk. */
    var mic = $('#cap-mic');
    function opts() {
      nudge(); clearTimeout(moodTimer);
      return { done: 'Got all of that. Capture it when you’re ready.', onChange: function (on) { listening = on; mic.setAttribute('aria-pressed', String(on)); $('#mic-l').textContent = on ? 'Listening…' : 'Dictate'; } };
    }
    mic.addEventListener('click', function () { if (Dictate.active()) Dictate.stop(); else Dictate.start(ta, opts()); });
    unhold = Dictate.hold(function () { return ta; }, opts);

    function submit() {
      var text = ta.value.trim();
      if (!text && !attached.length) return;
      var picked = attached.slice(), docs = picked.map(function (f) { return f.name; });
      var it = Store.capture(text, docs, picked);
      Dictate.abort();
      ta.value = ''; draft = ''; attached = []; paintFiles();
      confirm = docs.length ? 'Captured. I’m reading your ' + (docs.length === 1 ? 'document' : 'documents') + ' now.' : 'Captured. It’s waiting in your triage queue.';
      paintSay(); paintList(); ta.focus(); nudge();
      Say.announce(confirm);
      /* Same little celebration as a triage win: a hop, a check on his screen, a bit of confetti. */
      Fuzz.pAnim('hop'); Fuzz.checkGlyph(1300); Fuzz.confetti(go);
      moodFor(docs.length ? 'thinking' : 'happy', docs.length ? 2600 : 1400);
      /* The onboarding's first task goes on to the wait, where Fuzz says what he's doing with it */
      Onboard.captured(it);
    }
    go.addEventListener('click', submit);
    Fuzz.mount(root, {});
    paintFiles(); paintList(); paintSay(); nudge();
    unsub = Store.on(function () { paintList(); });
    timer = setInterval(paintList, 2000);
    /* Esc goes back to Triage (an open popover takes Escape first, in app.js). */
    escKey = function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      /* Escape stops listening first, keeping what was heard */
      if (Dictate.active()) Dictate.stop(); else App.navigate(ob && ob.back && Onboard.active() ? ob.back : '#/triage');
    };
    document.addEventListener('keydown', escKey);
    ta.focus();
  };
  V.unmount = function () {
    document.removeEventListener('keydown', escKey);
    if (docDrag) Object.keys(docDrag).forEach(function (n) { window.removeEventListener(n, docDrag[n]); }); docDrag = null;
    if (unhold) unhold(); unhold = null; Dictate.abort(); listening = false;
    if (unsub) unsub(); unsub = null; clearInterval(timer); clearTimeout(moodTimer); clearTimeout(boredTimer);
    Fuzz.unmount(); root = null;
  };

  window.CaptureView = V;
})();
