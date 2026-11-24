/* A calendar file (.ics) for the times Fuzz couldn't put on your calendar itself: the onboarding's check-in, and Focus time
   and Triage time when no calendar tool is set up (docs/book-then-work.md). Every event carries a link back to Fuzz, so
   opening it from the calendar starts the work: #/work?until=HH:MM for Focus time, #/triage?until=HH:MM for Triage.

     Ics.text([{ title, start, end, link, description?, rrule?, uid? }], { name? })   the file's text
     Ics.download(events, 'Focus time.ics', opts)                                    hands it to the browser
     Ics.forSlots(slots, skipped)                                                            a rhythm card's slots as events:
        each Focus time block is one event; the Triage slots are ONE event that repeats on working days, so a
        recurring habit is one entry in your calendar, not ten. A repeating event is written in your local time, so it
        stays at the same hour across a clock change. */
(function () {
  function two(n) { return ('0' + n).slice(-2); }
  function utc(d) { return d.getUTCFullYear() + two(d.getUTCMonth() + 1) + two(d.getUTCDate()) + 'T' + two(d.getUTCHours()) + two(d.getUTCMinutes()) + two(d.getUTCSeconds()) + 'Z'; }
  function local(d) { return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + 'T' + two(d.getHours()) + two(d.getMinutes()) + '00'; }
  function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  var DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  function text(events, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fuzz//' + (opts.name || 'Focus time') + '//EN', 'CALSCALE:GREGORIAN'];
    events.forEach(function (ev, i) {
      var s = new Date(ev.start), e = new Date(ev.end), rep = !!ev.rrule;
      out.push('BEGIN:VEVENT', 'UID:' + (ev.uid || 'fuzz-' + now.getTime() + '-' + i) + '@fuzz.local', 'DTSTAMP:' + utc(now),
        rep ? 'DTSTART:' + local(s) : 'DTSTART:' + utc(s), rep ? 'DTEND:' + local(e) : 'DTEND:' + utc(e));
      if (rep) out.push('RRULE:' + ev.rrule);
      if (rep && ev.exdates && ev.exdates.length) out.push('EXDATE:' + ev.exdates.join(','));   /* the days with no room: left out, not moved */
      out.push('SUMMARY:' + esc(ev.title), 'DESCRIPTION:' + esc((ev.description ? ev.description + '\n' : '') + 'Open Fuzz: ' + ev.link),
        'URL:' + ev.link, 'TRANSP:OPAQUE', 'END:VEVENT');
    });
    out.push('END:VCALENDAR');
    return out.join('\r\n') + '\r\n';
  }

  function forSlots(slots, skipped) {
    var evs = [], triage = (slots || []).filter(function (s) { return s.kind === 'triage'; });
    (slots || []).filter(function (s) { return s.kind !== 'triage'; }).forEach(function (s) {
      evs.push({ uid: 'fuzz-' + s.id, title: s.title, start: s.start, end: s.end, link: s.link, description: 'Your time to work. Fuzz has what you need ready.' });
    });
    if (triage.length) {
      var days = [], first = triage[0];
      triage.forEach(function (s) { var d = DAYS[new Date(s.start).getDay()]; if (days.indexOf(d) < 0) days.push(d); });
      evs.push({ uid: 'fuzz-triage-habit', title: first.title, start: first.start, end: first.end, link: first.link, rrule: 'FREQ=WEEKLY;BYDAY=' + days.join(','),
        description: 'A few minutes to decide what comes next. Fuzz does the rest.',
        exdates: (skipped || []).map(function (d) { var t = new Date(first.start); return String(d).replace(/-/g, '') + 'T' + two(t.getHours()) + two(t.getMinutes()) + '00'; }) });
    }
    return evs;
  }

  function download(events, filename, opts) {
    var blob = new Blob([text(events, opts)], { type: 'text/calendar' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'Fuzz.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  window.Ics = { text: text, download: download, forSlots: forSlots };
})();
