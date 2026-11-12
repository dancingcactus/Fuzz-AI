/* Spike, Fuzz's cactus friend. Builds one Spike as an SVG string in any of four looks, all on the same rig
   (see spike.css for the group contract). The only id is Potted's clip path, and it is numbered per Spike, so any
   number of Spikes can share a page with Fuzz.

     Spike.svg('saguaro', { size: 160, anim: 'dance', label: 'Spike' })
     Spike.play(el, 'hop')   // restarts a one-shot, then goes back to the loop he was in
     Spike.play(el, 'hop', { onEnd: fn })   // or calls fn instead; el also fires a 'spike:end' event
*/
(function () {
  var VB = '0 0 120 160';

  function f(n) { return Math.round(n * 10) / 10; }

  /* A prick: a tiny three-line asterisk sitting just outside the edge, pushed out along angle a
     (degrees, 0 = right, 180 = left, 270 = up). */
  function tuft(x, y, a) {
    var r0 = a * Math.PI / 180, cx = x + Math.cos(r0) * 2.2, cy = y + Math.sin(r0) * 2.2, d = '';
    [0, 60, 120].forEach(function (o) {
      var r = (a + o) * Math.PI / 180, l = 2.4;
      d += 'M' + f(cx - Math.cos(r) * l) + ' ' + f(cy - Math.sin(r) * l) + 'L' + f(cx + Math.cos(r) * l) + ' ' + f(cy + Math.sin(r) * l);
    });
    return '<path class="sp-spines" d="' + d + '"/>';
  }
  function tufts(list) { return list.map(function (t) { return tuft(t[0], t[1], t[2]); }).join(''); }

  /* An areole: a pale dot with spines, for the paddle look. */
  function areole(x, y, a) { return '<circle cx="' + x + '" cy="' + y + '" r="1.1" fill="var(--sp-spine)"/>' + tuft(x, y, a); }

  function face(cx, cy, o) {
    o = o || {};
    var ex = o.ex || 8, ck = o.ck || 13;
    function eye(x) {
      return '<g class="sp-eye"><rect x="' + f(x - 3.6) + '" y="' + f(cy - 6) + '" width="7.2" height="12" rx="3.6"/>' +
        '<circle cx="' + f(x - 1.2) + '" cy="' + f(cy - 2.6) + '" r="1.5"/></g>';
    }
    function shut(x) { return '<path d="M' + f(x - 4) + ' ' + f(cy + 1) + 'Q' + x + ' ' + f(cy + 4.5) + ' ' + f(x + 4) + ' ' + f(cy + 1) + '"/>'; }
    function happy(x) { return '<path d="M' + f(x - 4) + ' ' + f(cy + 1.5) + 'Q' + x + ' ' + f(cy - 5.5) + ' ' + f(x + 4) + ' ' + f(cy + 1.5) + '"/>'; }
    var my = cy + 8.5;
    return '<g class="sp-face">' +
      '<circle class="sp-cheek" cx="' + f(cx - ck) + '" cy="' + f(cy + 6) + '" r="3.6"/><circle class="sp-cheek" cx="' + f(cx + ck) + '" cy="' + f(cy + 6) + '" r="3.6"/>' +
      '<g class="sp-eyes">' + eye(cx - ex) + eye(cx + ex) + '</g>' +
      '<g class="sp-happy">' + happy(cx - ex) + happy(cx + ex) + '</g>' +
      '<g class="sp-shut">' + shut(cx - ex) + shut(cx + ex) + '</g>' +
      '<path class="sp-m sp-mouth-smile" d="M' + f(cx - 4.5) + ' ' + my + 'Q' + cx + ' ' + f(my + 5) + ' ' + f(cx + 4.5) + ' ' + my + '"/>' +
      '<g class="sp-mouth-open"><path class="sp-m-open" d="M' + f(cx - 6) + ' ' + f(my - 1) + 'Q' + cx + ' ' + f(my - 2) + ' ' + f(cx + 6) + ' ' + f(my - 1) + 'Q' + f(cx + 5) + ' ' + f(my + 8) + ' ' + cx + ' ' + f(my + 8) + 'Q' + f(cx - 5) + ' ' + f(my + 8) + ' ' + f(cx - 6) + ' ' + f(my - 1) + 'Z"/>' +
      '<ellipse class="sp-tongue" cx="' + cx + '" cy="' + f(my + 5.6) + '" rx="3" ry="1.8"/></g>' +
      '</g>';
  }

  /* A five-petal flower, drawn around its own centre so it can bloom in place. */
  function flower(x, y, s) {
    s = s || 1;
    var petals = '';
    for (var i = 0; i < 5; i++) {
      petals += '<ellipse class="sp-petal" cx="0" cy="-6" rx="4" ry="6.2" transform="rotate(' + (i * 72 - 10) + ')"/>';
    }
    var sparkle = function (sx, sy, r) {
      return '<path d="M' + sx + ' ' + (sy - r) + 'L' + f(sx + r * .3) + ' ' + f(sy - r * .3) + 'L' + (sx + r) + ' ' + sy + 'L' + f(sx + r * .3) + ' ' + f(sy + r * .3) +
        'L' + sx + ' ' + (sy + r) + 'L' + f(sx - r * .3) + ' ' + f(sy + r * .3) + 'L' + (sx - r) + ' ' + sy + 'L' + f(sx - r * .3) + ' ' + f(sy - r * .3) + 'Z"/>';
    };
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<g class="sp-sparkle">' + sparkle(-19, -8, 4) + sparkle(18, -12, 3.4) + sparkle(1, -24, 3) + '</g>' +
      '<g class="sp-flower">' + petals + '<circle class="sp-heart" r="3.6"/></g></g>';
  }

  function shoes(xl, xr, y) {
    return '<ellipse class="sp-shoe" cx="' + xl + '" cy="' + y + '" rx="10" ry="5.5"/><ellipse class="sp-shoe" cx="' + xr + '" cy="' + y + '" rx="10" ry="5.5"/>' +
      '<path d="M' + (xl - 6) + ' ' + (y - 2) + 'q4 -2.5 8 0M' + (xr - 2) + ' ' + (y - 2) + 'q4 -2.5 8 0" stroke="#FFF1DC" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>';
  }

  /* A tube arm: an outline drawn under the body and a fill drawn over it, so the joint has no seam. */
  function tubeArm(side, d, w, pricks) {
    var cls = 'sp-arm-' + side;
    return {
      under: '<g class="' + cls + '"><path class="sp-o" stroke-width="' + (w + 4.8) + '" d="' + d + '"/>' + '</g>',
      over: '<g class="' + cls + '"><path class="sp-f" stroke-width="' + w + '" d="' + d + '"/><path class="sp-rib" d="' + d + '" stroke-width="1.8"/>' +
        tufts(pricks || []) + '</g>'
    };
  }

  /* A tube arm with an elbow: the upper arm turns at the shoulder (.sp-arm-*), the forearm at the elbow (.sp-fore-*).
     Layers: the upper arm's outline goes under the body, so the shoulder has no seam. The forearm's outline goes over
     the body, so a hand on the hip or the chin still has an edge, but under the upper arm's fill, so the elbow has no
     seam either. */
  function elbowArm(side, S, E, T, w, pricks) {
    var a = 'sp-arm-' + side, fo = 'sp-fore-' + side;
    var up = 'M' + S[0] + ' ' + S[1] + 'L' + E[0] + ' ' + E[1], fore = 'M' + E[0] + ' ' + E[1] + 'L' + T[0] + ' ' + T[1];
    var ow = ' stroke-width="' + (w + 4.8) + '"', fw = ' stroke-width="' + w + '"';
    return {
      under: '<g class="' + a + '"><path class="sp-o"' + ow + ' d="' + up + '"/></g>',
      mid: '<g class="' + a + '"><g class="' + fo + '"><path class="sp-o"' + ow + ' d="' + fore + '"/></g></g>',
      over: '<g class="' + a + '"><path class="sp-f"' + fw + ' d="' + up + '"/><path class="sp-rib" stroke-width="1.8" d="' + up + '"/>' +
        '<g class="' + fo + '"><path class="sp-f"' + fw + ' d="' + fore + '"/><path class="sp-rib" stroke-width="1.8" d="' + fore + '"/>' + tufts(pricks || []) + '</g></g>'
    };
  }

  var LOOKS = {
    /* Classic saguaro: tall, two bent-up arms at different heights, little terracotta shoes. */
    saguaro: {
      name: 'Saguaro', blurb: 'Tall, two bent arms at different heights (like Fuzz’s antennas), dance shoes.',
      ground: [60, 152], waist: [60, 144], shl: [44, 100], shr: [76, 88],
      build: function () {
        var l = tubeArm('l', 'M46 100H31Q24 100 24 93V74', 13, [[24, 80, 180]]), r = tubeArm('r', 'M74 88H89Q96 88 96 81V60', 13, [[96, 66, 0]]);
        return {
          shadow: '<ellipse class="sp-shadow" cx="60" cy="152" rx="28" ry="4"/>',
          base: shoes(49, 71, 148),
          under: l.under + r.under,
          body: '<rect class="sp-skin" x="40" y="34" width="40" height="114" rx="20"/>',
          over: l.over + r.over +
            '<path class="sp-rib" d="M49 46V138M71 46V138M60 96V142"/>' +
            tufts([[40, 60, 180], [40, 124, 180], [80, 112, 0], [80, 134, 0], [52, 42, 230], [68, 42, 310]]),
          face: face(60, 68),
          top: flower(60, 34)
        };
      }
    },
    /* Barrel: round and squat with stubby nub arms. Reads as a ball at small sizes. */
    barrel: {
      name: 'Barrel', blurb: 'Round and squat with stubby nub arms. The most huggable; the arms are small.',
      ground: [60, 152], waist: [60, 146], shl: [34, 112], shr: [86, 112],
      build: function () {
        var l = tubeArm('l', 'M36 112Q23 110 19 97', 12, [[19, 97, 225]]), r = tubeArm('r', 'M84 112Q97 110 101 97', 12, [[101, 97, 315]]);
        return {
          shadow: '<ellipse class="sp-shadow" cx="60" cy="152" rx="34" ry="4"/>',
          base: shoes(47, 73, 149),
          under: l.under + r.under,
          body: '<ellipse class="sp-skin" cx="60" cy="110" rx="34" ry="38"/>',
          over: l.over + r.over +
            '<path class="sp-rib" d="M44 78Q34 110 44 143M76 78Q86 110 76 143M60 122V146"/>' +
            tufts([[26, 102, 180], [29, 126, 165], [94, 102, 0], [91, 126, 15], [44, 80, 235], [76, 80, 305]]),
          face: face(60, 102, { ex: 9, ck: 15 }),
          top: flower(60, 73, 1.05)
        };
      }
    },
    /* Potted: a slimmer saguaro in a terracotta pot, Fuzz's cabinet colour. The pot does the hopping. */
    potted: {
      name: 'Potted', blurb: 'A slimmer saguaro in a terracotta pot (Fuzz’s cabinet colour). No feet, so the pot dances.',
      ground: [60, 153], waist: [60, 122], shl: [47, 94], shr: [73, 82], ell: [30, 94], elr: [90, 82], clip: 124,
      build: function () {
        var l = elbowArm('l', [48, 94], [30, 94], [30, 72], 11, [[30, 78, 180]]), r = elbowArm('r', [72, 82], [90, 82], [90, 56], 11, [[90, 62, 0]]);
        return {
          shadow: '<ellipse class="sp-shadow" cx="60" cy="153" rx="24" ry="4"/>',
          base: '',
          under: l.under + r.under,
          body: '<rect class="sp-skin" x="44" y="44" width="32" height="86" rx="16"/>',
          over: l.mid + r.mid + l.over + r.over +
            '<path class="sp-rib" d="M52 54V122M68 54V122M60 92V122"/>' +
            tufts([[44, 62, 180], [44, 106, 180], [76, 98, 0], [76, 114, 0]]),
          front: '<path class="sp-pot" d="M38 124H82L77.5 150.5Q77 153 74.5 153H45.5Q43 153 42.5 150.5Z"/>' +
            '<rect class="sp-pot" x="34" y="116" width="52" height="11" rx="3.5"/>' +
            '<rect class="sp-pot-band" x="41" y="134" width="38" height="2.6" rx="1.3"/>',
          face: face(60, 70, { ex: 7.5, ck: 11.5 }),
          top: flower(60, 44, .9)
        };
      }
    },
    /* Prickly pear: an oval paddle with two paddle arms. Flatter, more graphic, the least "cactus emoji". */
    pear: {
      name: 'Paddle', blurb: 'A prickly-pear paddle with paddle arms and spine dots. Graphic, and least like the cactus emoji.',
      ground: [60, 152], waist: [60, 146], shl: [42, 98], shr: [78, 96],
      build: function () {
        return {
          shadow: '<ellipse class="sp-shadow" cx="60" cy="152" rx="28" ry="4"/>',
          base: shoes(49, 71, 149),
          under: '<g class="sp-arm-l"><ellipse class="sp-skin" cx="31" cy="80" rx="11.5" ry="18" transform="rotate(-28 31 80)"/>' +
              areole(29, 74, 200) + areole(34, 88, 190) + areole(26, 64, 240) + '</g>' +
            '<g class="sp-arm-r"><ellipse class="sp-skin" cx="89" cy="78" rx="11.5" ry="18" transform="rotate(28 89 78)"/>' +
              areole(91, 72, 340) + areole(86, 86, 350) + '<circle cx="96" cy="60" r="4" fill="var(--sp-petal)" stroke="var(--sp-petal-d)"/></g>',
          body: '<ellipse class="sp-skin" cx="60" cy="110" rx="27" ry="38"/>',
          over: areole(44, 126, 200) + areole(60, 138, 270) + areole(76, 126, 340) + areole(41, 92, 190) + areole(79, 92, 350) + areole(52, 80, 250) + areole(68, 80, 290),
          face: face(60, 104),
          top: flower(60, 74)
        };
      }
    }
  };

  var clipN = 0;

  function svg(look, opts) {
    opts = opts || {};
    var L = LOOKS[look] || LOOKS.saguaro, p = L.build();
    function px(v) { return v[0] + 'px ' + v[1] + 'px'; }
    var style = '--sp-ground:' + px(L.ground) + ';--sp-waist:' + px(L.waist) + ';--sp-shl:' + px(L.shl) + ';--sp-shr:' + px(L.shr) +
      (L.ell ? ';--sp-ell:' + px(L.ell) + ';--sp-elr:' + px(L.elr) : '');
    var size = opts.size ? ' width="' + Math.round(opts.size * .75) + '" height="' + opts.size + '"' : '';
    var vb = opts.square ? '-10 14 140 140' : VB;  // a square crop around the body, for icons
    if (opts.square && opts.size) size = ' width="' + opts.size + '" height="' + opts.size + '"';
    var plant = '<g class="sp-sink"><g class="sp-plant">' + p.under + p.body + p.over + p.face + p.top + '</g></g>';
    var defs = '';
    if (L.clip) {
      /* Potted: a static clip outside the moving groups hides whatever sinks below the soil line. */
      var id = 'sp-clip-' + (++clipN);
      defs = '<clipPath id="' + id + '"><rect x="-200" y="-400" width="520" height="' + (400 + L.clip) + '"/></clipPath>';
      plant = '<g clip-path="url(#' + id + ')">' + plant + '</g>';
    }
    return '<svg class="spike" viewBox="' + vb + '"' + size + ' data-look="' + look + '" data-anim="' + (opts.anim || 'idle') + '" style="' + style + '"' +
      ' role="img" aria-label="' + (opts.label || 'Spike, a cactus with a flower on his head') + '">' + defs +
      p.shadow +
      '<g class="sp-hop"><g class="sp-sway"><g class="sp-squash">' +
      p.base + plant + (p.front || '') +
      '</g></g></g></svg>';
  }

  var MOVES = {
    idles: [['idle', 'Idle'], ['look', 'Look around'], ['sleepy', 'Sleepy']],
    dances: [['dance', 'Dance'], ['groove', 'Groove'], ['shimmy', 'Shimmy'], ['disco', 'Disco'], ['bop', 'Bop']],
    gestures: [['wave', 'Wave'], ['hop', 'Hop'], ['bloom', 'Bloom'], ['tada', 'Ta-da'], ['peek', 'Peekaboo']],
    elbows: [['hips', 'Hands on hips'], ['shrug', 'Shrug'], ['think', 'Think'], ['flex', 'Flex'], ['clap', 'Clap']]
  };
  var ONCE = { wave: 1, hop: 1, bloom: 1, tada: 1, peek: 1, hips: 1, shrug: 1, think: 1, flex: 1 };

  /* Set a move. A one-shot restarts even if it is already showing. When every layer has finished, Spike fires
     'spike:end' and goes back to the loop he was in (or calls opts.onEnd instead). A move swapped in mid-play
     cancels the old one's ending. */
  function play(el, anim, opts) {
    opts = opts || {};
    var token = el._spTok = {};
    if (!ONCE[anim]) el._spLoop = anim;
    el.setAttribute('data-anim', 'none');
    void el.getBoundingClientRect();
    el.setAttribute('data-anim', anim);
    var anims = el.getAnimations({ subtree: true });
    if (el._spRate && el._spRate !== 1) anims.forEach(function (a) { a.playbackRate = el._spRate; });
    if (ONCE[anim]) {
      Promise.all(anims.map(function (a) { return a.finished; })).then(function () {
        if (el._spTok !== token) return;
        el.dispatchEvent(new CustomEvent('spike:end', { detail: anim }));
        if (opts.onEnd) opts.onEnd(anim);
        else play(el, el._spLoop || 'idle');
      }, function () { /* replaced mid-play */ });
    }
    return anims;
  }

  window.Spike = { looks: LOOKS, svg: svg, play: play, once: ONCE, moves: MOVES };
})();
