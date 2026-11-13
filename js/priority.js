/* What a check-in decides (docs/energy-and-priority.md, #9): each card's categories, today's set for your
   energy, and its order. The same rules as the core's priority.py: live cards bring their categories from
   the core (it knows the senders and the VIP list); the demo works them out here. The names are internal:
   what the UI says follows docs/fuzz-tone.md. */
(function () {
  var DEFAULT_MINS = 15, QUICK_MINS = 5, DEEP_MINS = 30, WARM_UP = 2;
  var ORDER = {
    good: ['urgent', 'vip', 'returned', 'waiting', 'coming_back', 'goal'],
    okay: ['urgent', 'vip', 'returned', 'quick', 'waiting', 'goal', 'coming_back'],
    tired: ['urgent', 'vip', 'returned', 'waiting', 'quick', 'low'],
    overloaded: ['urgent', 'quick']
  };
  function has(c, k) { return c.indexOf(k) > -1; }
  function any(c, ks) { return ks.some(function (k) { return has(c, k); }); }

  /* Minutes for a card: a question or an approval takes seconds; a task with no estimate counts as 15 */
  function mins(it) { return it.kind !== 'task' ? 1 : (it.estMins || it.mins || DEFAULT_MINS); }

  /* The demo's VIPs: your manager and a few more, matched on the sender's name (a one-word entry matches a first name) */
  function isVip(who, vips) {
    who = String(who || '').trim().toLowerCase(); if (!who) return false;
    var first = who.split(' ')[0];
    return (vips || []).some(function (v) { v = String(v || '').trim().toLowerCase(); return v && (v === who || (v.indexOf(' ') < 0 && v === first)); });
  }

  function cats(it) {
    if (it.cats) return it.cats;   /* a live card: the core's */
    var st = Store.get(), fo = (st.focus && st.focus.task_ids) || [], v = st.vips || {};
    var c = [], m = mins(it);
    if (it.dueAt) c.push('urgent');
    if (isVip(it.who, [v.manager].concat(v.people || []))) c.push('vip');
    if (it.handedBack || it.result || it.foundOut || it.state === 'review' || it.needsPermission) c.push('returned');
    if (it.nudged || it.joinReply) c.push('waiting');
    if (fo.indexOf(it.coreId || it.id) > -1) c.push('goal');
    if (m <= QUICK_MINS) c.push('quick');
    if (it.energy === 'low') c.push('low');
    if (it.kind === 'task' && (it.energy === 'high' || m >= DEEP_MINS)) c.push('deep');
    if (it.putOff || it.stage === 'stale' || it.inTheWay || (it.returning && !it.checkinHold)) c.push('coming_back');
    return c;
  }

  /* Is the card in today's set for this energy? Urgent is never left out. */
  function included(level, c) {
    if (has(c, 'urgent') || !level || level === 'good' || level === 'okay') return true;
    if (has(c, 'coming_back')) return false;   /* the hardest cards for an ADHD brain: not when tired or overloaded */
    if (level === 'tired') return any(c, ['vip', 'returned', 'waiting', 'quick', 'low']);
    return has(c, 'quick') && any(c, ['vip', 'returned']);
  }
  function rank(level, c) {
    var order = ORDER[level];
    if (level === 'okay' && has(c, 'coming_back') && !has(c, 'urgent')) return order.indexOf('coming_back');   /* late on an okay day */
    var hits = c.map(function (k) { return order.indexOf(k); }).filter(function (i) { return i > -1; });
    return hits.length ? Math.min.apply(null, hits) : order.length;   /* Rest, and Deep work until there's a deep-work queue */
  }
  /* Due within the hour, or past its time: it goes ahead of the warm-up */
  function soon(it) { return !!it.dueAt && it.dueAt - Date.now() <= 3600000; }

  /* {id: [left out, place, minutes]}: the middle of the queue's sort key once you've answered a check-in */
  function keys(level, items) {
    var warm = {};
    if (level === 'tired' || level === 'overloaded') {
      items.filter(function (it) { var c = cats(it); return included(level, c) && !soon(it) && any(c, level === 'tired' ? ['quick', 'low'] : ['quick']); })
        .map(function (it, n) { return [mins(it), it.order || 0, n, it.id]; })
        .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; })
        .slice(0, WARM_UP).forEach(function (r) { warm[r[3]] = true; });
    }
    var out = {};
    items.forEach(function (it) {
      var c = cats(it);
      out[it.id] = !included(level, c) ? [1, 0, 0] : soon(it) ? [0, -2, 0] : warm[it.id] ? [0, -1, mins(it)] : [0, rank(level, c), level === 'overloaded' ? mins(it) : 0];
    });
    return out;
  }

  window.Prio = {
    LEVELS: ['good', 'okay', 'tired', 'overloaded'],
    MOMENT: { good: 'any', okay: 'any', tired: 'low', overloaded: 'quick' },
    /* cards between check-ins, and how many "a few more" brings back (the core's priority.STRETCH) */
    STRETCH: { good: 5, okay: 4, tired: 3, overloaded: 2 },
    cats: cats, included: included, keys: keys, mins: mins,
    up: function (l) { return { overloaded: 'tired', tired: 'okay' }[l] || l; },
    down: function (l) { return { good: 'okay', okay: 'tired', tired: 'overloaded' }[l] || l; }
  };
})();
