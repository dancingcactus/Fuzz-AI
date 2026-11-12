/* Retro pals: a boombox and a rotary phone, each in two designs, on a shared shape (see pals.css).

     Pals.svg('boombox', 'speakers', { anim: 'groove' })
     Pals.play(el, 'bass')   // a one-shot restarts, then goes back to the loop he was in
*/
(function () {
  var VB = '0 0 160 160', GROUND = '80px 152px';
  function f(n) { return Math.round(n * 10) / 10; }
  function o(x, y) { return ' style="transform-origin:' + x + 'px ' + y + 'px"'; }

  /* The same face as Fuzz and Spike, drawn around (cx, cy) and scaled by s. glow: lit eyes on a dark screen. */
  function face(cx, cy, s, opts) {
    opts = opts || {};
    var ex = opts.ex || 7, ck = opts.ck || 12;
    function eye(x) { return '<g class="pl-eye"><rect x="' + (x - 3.4) + '" y="-5.6" width="6.8" height="11.2" rx="3.4"/><circle cx="' + (x - 1.1) + '" cy="-2.4" r="1.4"/></g>'; }
    function happy(x) { return '<path d="M' + (x - 3.8) + ' 1.5Q' + x + ' -5 ' + (x + 3.8) + ' 1.5"/>'; }
    var my = 8;
    return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + s + ')" class="' + (opts.glow ? 'pl-glowface' : '') + '">' +
      (opts.cheeks === false ? '' : '<circle class="pl-cheek" cx="' + -ck + '" cy="5.5" r="3.4"/><circle class="pl-cheek" cx="' + ck + '" cy="5.5" r="3.4"/>') +
      (opts.eyes === false ? '' : '<g class="pl-eyes"' + o(0, 0) + '>' + eye(-ex) + eye(ex) + '</g><g class="pl-happy">' + happy(-ex) + happy(ex) + '</g>') +
      '<path class="pl-m pl-m-smile" d="M-4.5 ' + my + 'Q0 ' + (my + 5) + ' 4.5 ' + my + '"/>' +
      '<path class="pl-m pl-m-flat" d="M-4 ' + (my + 2) + 'H4"/>' +
      '<g class="pl-m pl-m-open"><path d="M-5.5 ' + (my - 1) + 'Q0 ' + (my - 2) + ' 5.5 ' + (my - 1) + 'Q4.6 ' + (my + 8) + ' 0 ' + (my + 8) + 'Q-4.6 ' + (my + 8) + ' -5.5 ' + (my - 1) + 'Z"/>' +
      '<ellipse cx="0" cy="' + (my + 5.4) + '" rx="2.8" ry="1.7"/></g>' +
      '</g>';
  }

  function note(x, y, cls) {
    return '<g class="' + cls + '" transform="translate(' + x + ' ' + y + ')"><g fill="var(--pl-glow)" stroke="var(--pl-glow)">' +
      '<ellipse cx="0" cy="0" rx="3.4" ry="2.5" transform="rotate(-20)" stroke="none"/>' +
      '<path d="M3 -1V-13Q8.5 -11 8.5 -5.5" fill="none" stroke-width="1.8" stroke-linecap="round"/></g></g>';
  }

  /* =========================== BOOMBOX =========================== */

  function speaker(cx, cy, r, asEye) {
    var cone = '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .82) + '" fill="var(--bb-cone)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .6) + '" fill="none" stroke="var(--bb-cone-l)" stroke-width="1.6"/>';
    var cap = asEye
      ? '<g class="bb-pupil"><circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .4) + '" fill="#4A3A32"/><circle cx="' + f(cx - r * .14) + '" cy="' + f(cy - r * .14) + '" r="' + f(r * .15) + '" fill="#fff"/>' +
        '<circle cx="' + f(cx + r * .16) + '" cy="' + f(cy + r * .14) + '" r="' + f(r * .06) + '" fill="#fff" opacity=".7"/></g>'
      : '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .3) + '" fill="#4A3A32"/>';
    var bolts = [45, 135, 225, 315].map(function (a) {
      var rad = a * Math.PI / 180;
      return '<circle cx="' + f(cx + Math.cos(rad) * r * .91) + '" cy="' + f(cy + Math.sin(rad) * r * .91) + '" r="1.2" fill="var(--bb-chrome)"/>';
    }).join('');
    return '<g class="bb-spk"' + o(cx, cy) + '><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="var(--bb-ring)"/>' + bolts +
      (asEye ? '<g class="bb-blink">' + cone + cap + '</g>' : cone + cap) + '</g>' +
      '<circle class="bb-wave" cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + o(cx, cy) + '/>';
  }

  function deck(x, y, w, h) {
    var cy = y + h * .45, r = Math.min(h * .2, 4.2);
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="var(--bb-ring)"/>' +
      '<rect x="' + (x + 3) + '" y="' + f(cy - h * .26) + '" width="' + (w - 6) + '" height="' + f(h * .52) + '" rx="2" fill="#5A4A40"/>' +
      [x + w * .3, x + w * .7].map(function (rx) {
        return '<g class="bb-reel"><circle cx="' + f(rx) + '" cy="' + f(cy) + '" r="' + f(r) + '" fill="var(--pl-cream)"/>' +
          '<path d="M' + f(rx) + ' ' + f(cy - r) + 'V' + f(cy + r) + 'M' + f(rx - r) + ' ' + f(cy) + 'H' + f(rx + r) + '" stroke="var(--bb-ring)" stroke-width="1.3"/>' +
          '<circle cx="' + f(rx) + '" cy="' + f(cy) + '" r="' + f(r * .35) + '" fill="var(--bb-ring)"/></g>';
      }).join('');
  }

  /* ---- the second round: real boombox proportions (about 2:1), chrome, grilles, a tuner strip, piano keys ---- */

  /* A speaker grille: one path of round dots inside radius r. */
  function mesh(cx, cy, r, color) {
    var d = '', step = 3.1;
    for (var y = -r; y <= r; y += step) for (var x = -r; x <= r; x += step) {
      var ox = (Math.round((y + r) / step) % 2) * step / 2;
      if (Math.hypot(x + ox, y) < r - 1) d += 'M' + f(cx + x + ox) + ' ' + f(cy + y) + 'h0';
    }
    return '<path d="' + d + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" fill="none"/>';
  }

  function chromeRing(cx, cy, r) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="2"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r - 2.6) + '" fill="none" stroke="#fff" stroke-width=".9" opacity=".5"/>';
  }

  /* A woofer: chrome ring, black grille. asEye: a glossy dome pupil with a glint (blinks, looks). */
  function woofer(cx, cy, r, asEye) {
    var inner = '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r - 3.4) + '" fill="var(--bb-grille)"/>' + mesh(cx, cy, r - 4, '#4A423C');
    var dome = asEye
      ? '<g class="bb-pupil"><circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .4) + '" fill="#2E2824" stroke="#5A504A" stroke-width="1.4"/>' +
        '<circle cx="' + f(cx - r * .13) + '" cy="' + f(cy - r * .13) + '" r="' + f(r * .15) + '" fill="#fff"/>' +
        '<circle cx="' + f(cx + r * .15) + '" cy="' + f(cy + r * .13) + '" r="' + f(r * .06) + '" fill="#fff" opacity=".7"/></g>'
      : '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .26) + '" fill="#2E2824" stroke="#5A504A" stroke-width="1.2"/>';
    return '<g class="bb-spk"' + o(cx, cy) + '>' + chromeRing(cx, cy, r) + (asEye ? '<g class="bb-blink">' + inner + dome + '</g>' : inner + dome) + '</g>' +
      '<circle class="bb-wave" cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + o(cx, cy) + '/>';
  }

  function tuner(x, y, w, h) {
    var ticks = '';
    for (var tx = x + 6; tx < x + w - 4; tx += 5) ticks += 'M' + tx + ' ' + (y + h - 2) + 'v' + (((tx - x) % 15 === 6) ? -3.4 : -2);
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2" fill="var(--bb-grille)" stroke="var(--pl-line)" stroke-width="1.2"/>' +
      '<path d="' + ticks + '" stroke="var(--pl-cream)" stroke-width=".9" opacity=".75"/>' +
      '<g class="bb-tune"><path d="M' + (x + w * .38) + ' ' + (y + 1.2) + 'v' + (h - 2.4) + '" stroke="#E2563B" stroke-width="1.8" stroke-linecap="round"/></g>';
  }

  function topKeys(x0, y, n) {
    var cols = ['var(--bb-chrome-l)', 'var(--bb-chrome-l)', '#E2563B', 'var(--bb-chrome-l)', 'var(--bb-chrome-l)', 'var(--bb-chrome-l)', 'var(--bb-chrome-l)', 'var(--bb-chrome-l)'];
    var out = '';
    for (var i = 0; i < n; i++) out += '<rect class="bb-key" x="' + (x0 + i * 9) + '" y="' + y + '" width="8" height="7" rx="1.2" fill="' + cols[i] + '" stroke="var(--pl-line)" stroke-width="1.3"/>';
    return '<g>' + out + '</g>';
  }

  function reels(cx, cy, r) {
    return '<g class="bb-reel"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="1"/>' +
      [0, 60, 120].map(function (a) {
        var rad = a * Math.PI / 180;
        return '<path d="M' + f(cx - Math.cos(rad) * r * .75) + ' ' + f(cy - Math.sin(rad) * r * .75) + 'L' + f(cx + Math.cos(rad) * r * .75) + ' ' + f(cy + Math.sin(rad) * r * .75) + '" stroke="var(--pl-line)" stroke-width="1.2"/>';
      }).join('') + '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .32) + '" fill="var(--pl-line)"/></g>';
  }

  function boombox2(design) {
    var dark = design === 'door';
    var bodyFill = dark ? 'var(--bb-black)' : 'var(--bb-silver)';
    var handle = '<g class="bb-handle">' +
      '<rect x="20" y="57" width="12" height="9" rx="2" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/><rect x="128" y="57" width="12" height="9" rx="2" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<path d="M26 60V46Q26 38 34 38H126Q134 38 134 46V60" fill="none" stroke="var(--pl-line)" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M26 60V46Q26 38 34 38H126Q134 38 134 46V60" fill="none" stroke="var(--bb-chrome-l)" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M40 38.6H120" stroke="#fff" stroke-width="1" opacity=".6"/></g>';
    var ant = '<g class="bb-ant"' + o(144, 64) + '><path d="M144 64L156 14" stroke="var(--pl-line)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M144 64L156 14" stroke="var(--bb-chrome-l)" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="156" cy="14" r="2.8" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.2"/></g>';
    var feet = '<rect x="22" y="134" width="18" height="9" rx="2.5" fill="var(--pl-line)"/><rect x="120" y="134" width="18" height="9" rx="2.5" fill="var(--pl-line)"/>';
    var body = '<rect x="6" y="62" width="148" height="74" rx="9" fill="' + bodyFill + '" stroke="var(--pl-line)" stroke-width="2.4"/>' +
      (dark
        ? '<rect x="10" y="66" width="140" height="66" rx="6" fill="none" stroke="var(--bb-chrome)" stroke-width="1.1" opacity=".7"/>'
        : '<path d="M6.5 124H153.5V127Q153.5 135.5 145 135.5H15Q6.5 135.5 6.5 127Z" fill="var(--bb-silver-d)"/>' +
          '<path d="M14 66H146" stroke="#fff" stroke-width="1.2" opacity=".55"/>');
    var keys = topKeys(53, 56, 6);
    var notes = '<g>' + note(18, 54, 'bb-note') + note(140, 44, 'bb-note') + note(80, 26, 'bb-note') + '</g>';
    var rew = '<g class="bb-rew"><path d="M86 14L76 21L86 28ZM98 14L88 21L98 28Z" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1.4" stroke-linejoin="round"/></g>';
    var front;
    if (design === 'classic') {
      front = tuner(18, 68, 124, 8) +
        woofer(36, 104, 25, true) + woofer(124, 104, 25, true) +
        '<rect x="63" y="82" width="34" height="22" rx="3" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
        '<rect x="66" y="86" width="28" height="12" rx="2" fill="var(--bb-grille)"/>' + reels(73, 92, 4.2) + reels(87, 92, 4.2) +
        face(80, 108, .85, { eyes: false, ck: 11 }) +
        '<path d="M20 129.5H140" stroke="var(--pl-line)" stroke-width="1" opacity=".25"/>';
    } else if (design === 'door') {
      /* Tweeters are the eyes; the cassette door is the mouth. Closed, it smiles; it drops open to sing. */
      function tweeter(cx, cy) {
        return chromeRing(cx, cy, 8) + '<g class="bb-blink"><circle cx="' + cx + '" cy="' + cy + '" r="5.6" fill="var(--bb-grille)"/>' +
          '<g class="bb-pupil"><circle cx="' + cx + '" cy="' + cy + '" r="3.4" fill="#2E2824" stroke="#5A504A" stroke-width="1"/><circle cx="' + (cx - 1.2) + '" cy="' + (cy - 1.3) + '" r="1.4" fill="#fff"/></g></g>';
      }
      front = tuner(20, 68, 120, 7) +
        woofer(34, 108, 23, false) + woofer(126, 108, 23, false) +
        tweeter(69, 85) + tweeter(91, 85) +
        '<circle class="pl-cheek" cx="61" cy="97" r="3.2"/><circle class="pl-cheek" cx="99" cy="97" r="3.2"/>' +
        '<rect x="62" y="98" width="36" height="28" rx="4" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
        '<rect x="65" y="101" width="30" height="22" rx="3" fill="#6E2C25"/>' +
        '<rect x="67" y="106" width="26" height="14" rx="2" fill="var(--pl-cream)"/><rect x="69" y="108" width="22" height="3" fill="#E2563B" opacity=".8"/>' +
        reels(74.5, 115, 3) + reels(85.5, 115, 3) +
        '<g class="bb-door"' + o(80, 101) + '><rect x="65" y="101" width="30" height="22" rx="3" fill="#3A332E" stroke="var(--pl-line)" stroke-width="1"/>' +
        '<path d="M71 109Q80 117 89 109" stroke="var(--bb-chrome-l)" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
        '<path d="M68 104H78" stroke="#fff" stroke-width="1" opacity=".25"/></g>';
    } else {
      /* Reel eyes: twin cassette decks are the eyes, each with one big reel for a pupil; EQ sliders make the smile. */
      function deckEye(x) {
        var cx = x + 12;
        return '<rect x="' + x + '" y="72" width="24" height="22" rx="3" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
          '<g class="bb-blink"><rect x="' + (x + 2.5) + '" y="74.5" width="19" height="17" rx="3" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="1"/>' +
          '<g class="bb-pupil">' + reels(cx, 83, 6.2) + '</g>' +
          '<path d="M' + (x + 5) + ' 77.5H' + (x + 11) + '" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></g>';
      }
      var sliders = '';
      [[60, 104], [70, 108.5], [80, 110.5], [90, 108.5], [100, 104]].forEach(function (s) {
        sliders += '<path d="M' + s[0] + ' 100V118" stroke="var(--bb-grille)" stroke-width="2" stroke-linecap="round"/>' +
          '<rect class="bb-slide" x="' + (s[0] - 3.5) + '" y="' + (s[1] - 2.2) + '" width="7" height="4.4" rx="1" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.1"/>';
      });
      front = tuner(18, 64.5, 124, 5.5) +
        woofer(28, 108, 20, false) + woofer(132, 108, 20, false) +
        deckEye(54) + deckEye(82) +
        '<circle class="pl-cheek" cx="51" cy="101" r="3.4"/><circle class="pl-cheek" cx="109" cy="101" r="3.4"/>' +
        '<g class="bb-sliders">' + sliders + '</g>' +
        '<circle cx="66" cy="127" r="3" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.1"/><circle cx="94" cy="127" r="3" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.1"/>';
    }
    return {
      shadow: '<ellipse class="pl-shadow" cx="80" cy="145" rx="66" ry="4"/>',
      parts: feet + handle + ant + '<g class="pl-front">' + body + keys + front + '</g>',
      fx: notes + rew
    };
  }

  /* ---- the third round: extra wide (about 3:1) on a 220 x 150 canvas ---- */

  function vu(x, y) {
    var w = 18, h = 12, px = x + w / 2, py = y + h - 1.5;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="1.3"/>' +
      '<path d="M' + (x + 3.5) + ' ' + (y + 5.5) + 'Q' + px + ' ' + (y + 1.6) + ' ' + (x + w - 3.5) + ' ' + (y + 5.5) + '" fill="none" stroke="var(--pl-line)" stroke-width=".8" opacity=".6"/>' +
      '<path d="M' + (x + w - 6) + ' ' + (y + 3.6) + 'L' + (x + w - 3.5) + ' ' + (y + 5.5) + '" stroke="#E2563B" stroke-width="1.6"/>' +
      '<g class="bb-vu"' + o(px, py) + '><path d="M' + px + ' ' + py + 'L' + (px - 4) + ' ' + (y + 3) + '" stroke="var(--pl-line)" stroke-width="1.2" stroke-linecap="round"/></g>' +
      '<circle cx="' + px + '" cy="' + py + '" r="1.2" fill="var(--pl-line)"/>';
  }

  /* The tape-door mouth: closed it smiles, open it shows the tape. */
  function doorMouth(x, y, w, h) {
    var cx = x + w / 2;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<rect x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="3" fill="#6E2C25"/>' +
      '<rect x="' + (x + 5) + '" y="' + (y + h * .3) + '" width="' + (w - 10) + '" height="' + f(h * .55) + '" rx="2" fill="var(--pl-cream)"/>' +
      '<rect x="' + (x + 7) + '" y="' + f(y + h * .36) + '" width="' + (w - 14) + '" height="3" fill="#E2563B" opacity=".8"/>' +
      reels(f(cx - w * .17), f(y + h * .66), f(h * .12)) + reels(f(cx + w * .17), f(y + h * .66), f(h * .12)) +
      '<g class="bb-door"' + o(cx, y + 3) + '><rect x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="3" fill="#3A332E" stroke="var(--pl-line)" stroke-width="1"/>' +
      '<path d="M' + f(cx - w * .24) + ' ' + f(y + h * .38) + 'Q' + cx + ' ' + f(y + h * .7) + ' ' + f(cx + w * .24) + ' ' + f(y + h * .38) + '" stroke="var(--bb-chrome-l)" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M' + (x + 6) + ' ' + (y + 6) + 'H' + (x + 18) + '" stroke="#fff" stroke-width="1" opacity=".25"/></g>';
  }

  function tweeterEye(cx, cy, r) {
    return chromeRing(cx, cy, r) + '<g class="bb-blink"><circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .72) + '" fill="var(--bb-grille)"/>' +
      '<g class="bb-pupil"><circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .44) + '" fill="#2E2824" stroke="#5A504A" stroke-width="1"/>' +
      '<circle cx="' + f(cx - r * .16) + '" cy="' + f(cy - r * .17) + '" r="' + f(r * .18) + '" fill="#fff"/></g></g>';
  }

  /* A round porthole showing one reel: the reel is the pupil. */
  function reelPort(cx, cy, r) {
    return chromeRing(cx, cy, r) + '<g class="bb-blink"><circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .76) + '" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="1"/>' +
      '<g class="bb-pupil">' + reels(cx, cy, f(r * .52)) + '</g>' +
      '<path d="M' + f(cx - r * .5) + ' ' + f(cy - r * .38) + 'Q' + f(cx - r * .3) + ' ' + f(cy - r * .6) + ' ' + f(cx) + ' ' + f(cy - r * .62) + '" stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".85"/></g>';
  }

  function deckEyeW(x, y, w, h) {
    var cx = x + w / 2, cy = y + h / 2;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<g class="bb-blink"><rect x="' + (x + 2.5) + '" y="' + (y + 2.5) + '" width="' + (w - 5) + '" height="' + (h - 5) + '" rx="3" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="1"/>' +
      '<g class="bb-pupil">' + reels(cx, cy + .5, f(h * .3)) + '</g>' +
      '<path d="M' + (x + 5.5) + ' ' + (y + 5.5) + 'H' + (x + 12) + '" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></g>';
  }

  function sliderSmile(x0, step, n, top, bot, depth) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var x = x0 + i * step, t = (i / (n - 1)) * 2 - 1, ky = f(top + 4 + depth * (1 - t * t));
      out += '<path d="M' + x + ' ' + top + 'V' + bot + '" stroke="var(--bb-grille)" stroke-width="2" stroke-linecap="round"/>' +
        '<rect class="bb-slide" x="' + (x - 3.5) + '" y="' + f(ky - 2.2) + '" width="7" height="4.4" rx="1" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.1"/>';
    }
    return '<g class="bb-sliders">' + out + '</g>';
  }

  /* ---- moods (Reels + door only): eyelids in the reel windows, eye shapes, door mouths, fx ---- */
  var uid = 0;
  var BULB = '<g class="bfx bfx-bulb"><circle class="bfx-halo" cx="216" cy="12" r="7" fill="var(--pl-glow)" opacity=".45"/><circle cx="216" cy="12" r="3.4" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1.2"/></g>';

  /* A reel window with lids. Upper lid: --lid-* (0 open .. 1 shut) and --tilt-* (deg); lower lid: --low-*;
     the reel: --look-x/y (px) and --iris (scale). Eye shapes (heart, star, spiral, x, and shut happy/line/sad)
     swap in by data-eye-l / data-eye-r. The lids are clipped to the glass by one id per boombox. */
  function moodEye(side, cx, cy, r, id) {
    var ri = f(r * .76), w = f(ri * 2.4), cid = id + side;
    var heart = 'M0 3.6C-3.9 1 -5 -1.2 -5 -2.8C-5 -4.6 -3.6 -5.6 -2.4 -5.6C-1.3 -5.6 -.4 -5 0 -4C.4 -5 1.3 -5.6 2.4 -5.6C3.6 -5.6 5 -4.6 5 -2.8C5 -1.2 3.9 1 0 3.6Z';
    var star = 'M0 -6l1.8 3.7 4.1.5 -3 2.8 .8 4 -3.7 -2 -3.7 2 .8 -4 -3 -2.8 4.1 -.5z';
    var k = f(r / 11), es = function (k2, inner) { return '<g class="bb-es es-' + k2 + '" transform="translate(' + cx + ' ' + cy + ') scale(' + k + ')">' + inner + '</g>'; };
    var shut = function (k2, d) { return '<g class="bb-es es-' + k2 + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + ri + '" fill="var(--bb-silver)"/>' +
      '<path d="' + d + '" transform="translate(' + cx + ' ' + cy + ') scale(' + k + ')" fill="none" stroke="var(--pl-line)" stroke-width="2.2" stroke-linecap="round"/></g>'; };
    return '<g class="bb-eye-' + side + '" style="--ri:' + ri + 'px">' + chromeRing(cx, cy, r) +
      '<clipPath id="' + cid + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + ri + '"/></clipPath>' +
      '<g class="bb-blink bb-m"' + o(cx, cy) + '><circle cx="' + cx + '" cy="' + cy + '" r="' + ri + '" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="1"/>' +
      '<g class="bb-gaze bb-gaze-' + side + '"><g class="bb-glance"><g class="bb-iris bb-iris-' + side + '"' + o(cx, cy) + '><g class="bb-pupil">' +
        '<g class="bb-reelwrap">' + reels(cx, cy, f(r * .52)) + '</g>' +
        es('heart', '<path d="' + heart + '" transform="scale(1.15)" fill="#FF6F86" stroke="var(--pl-line)" stroke-width="1"/>') +
        es('star', '<path d="' + star + '" transform="scale(1.1)" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1" stroke-linejoin="round"/>') +
        es('spiral', '<g class="bb-swirl"><path d="M0 0c1 0 1.4 1 .9 1.8 -.8 1.3 -2.8 1 -3.4 -.3 -.9 -1.9 .5 -4 2.6 -4.2 2.8 -.3 4.8 2.2 4.4 4.9 -.5 3.3 -3.9 5.2 -7 4.4" fill="none" stroke="var(--pl-line)" stroke-width="1.4" stroke-linecap="round"/></g>') +
        es('x', '<path d="M-3.6 -3.6L3.6 3.6M3.6 -3.6L-3.6 3.6" stroke="var(--pl-line)" stroke-width="2" stroke-linecap="round"/>') +
      '</g></g></g></g>' +
      '<g clip-path="url(#' + cid + ')">' +
        '<g class="bb-low bb-low-' + side + '"' + o(cx, cy) + '><path d="M' + f(cx - w) + ' ' + f(cy + 3) + 'Q' + cx + ' ' + f(cy - 3) + ' ' + f(cx + w) + ' ' + f(cy + 3) + 'V' + f(cy + w + 6) + 'H' + f(cx - w) + 'Z" fill="var(--bb-silver)" stroke="var(--pl-line)" stroke-width="1.4"/></g>' +
        '<g class="bb-lid bb-lid-' + side + '"' + o(cx, cy) + '><path d="M' + f(cx - w) + ' ' + cy + 'H' + f(cx + w) + 'V' + f(cy - w - 6) + 'H' + f(cx - w) + 'Z" fill="var(--bb-silver)" stroke="var(--pl-line)" stroke-width="1.4"/></g>' +
        shut('happy', 'M-5 2Q0 -5 5 2') + shut('line', 'M-5 .5H5') + shut('sad', 'M-5 -1.5Q0 4.5 5 -1.5') +
      '</g>' +
      '<path class="bb-glint" d="M' + f(cx - r * .5) + ' ' + f(cy - r * .38) + 'Q' + f(cx - r * .3) + ' ' + f(cy - r * .6) + ' ' + f(cx) + ' ' + f(cy - r * .62) + '" stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".85"/></g></g>';
  }

  /* The tape door with mouth shapes drawn on it (data-mouth), hinged in a jaw that opens by --door. */
  function moodDoor(x, y, w, h) {
    var cx = x + w / 2, top = y + 3, L = 'stroke="var(--bb-chrome-l)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
    var m = function (k, inner) { return '<g class="bb-dm dm-' + k + '">' + inner + '</g>'; };
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<rect x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="3" fill="#6E2C25"/>' +
      '<rect x="' + (x + 5) + '" y="' + (y + h * .3) + '" width="' + (w - 10) + '" height="' + f(h * .55) + '" rx="2" fill="var(--pl-cream)"/>' +
      '<rect x="' + (x + 7) + '" y="' + f(y + h * .36) + '" width="' + (w - 14) + '" height="3" fill="#E2563B" opacity=".8"/>' +
      reels(f(cx - w * .17), f(y + h * .66), f(h * .12)) + reels(f(cx + w * .17), f(y + h * .66), f(h * .12)) +
      '<g class="bb-jaw"' + o(cx, top) + '><g class="bb-door"' + o(cx, top) + '><rect x="' + (x + 3) + '" y="' + top + '" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="3" fill="#3A332E" stroke="var(--pl-line)" stroke-width="1"/>' +
      m('smile', '<path d="M' + f(cx - 10.5) + ' 110Q' + cx + ' 119.5 ' + f(cx + 10.5) + ' 110" fill="none" ' + L + '/>') +
      m('grin', '<path d="M' + f(cx - 11) + ' 108.5H' + f(cx + 11) + 'Q' + f(cx + 10) + ' 121 ' + cx + ' 121Q' + f(cx - 10) + ' 121 ' + f(cx - 11) + ' 108.5Z" fill="var(--bb-chrome-l)" ' + L + '/>' +
        '<path d="M' + f(cx - 6) + ' 116.5Q' + cx + ' 113.5 ' + f(cx + 6) + ' 116.5Q' + cx + ' 120 ' + f(cx - 6) + ' 116.5Z" fill="var(--pl-cheek)"/>') +
      m('flat', '<path d="M' + f(cx - 7) + ' 114H' + f(cx + 7) + '" ' + L + '/>') +
      m('frown', '<path d="M' + f(cx - 8.5) + ' 118Q' + cx + ' 109 ' + f(cx + 8.5) + ' 118" fill="none" ' + L + '/>') +
      m('smirk', '<path d="M' + f(cx - 8.5) + ' 114.5Q' + f(cx + 2) + ' 118.5 ' + f(cx + 9) + ' 109.5" fill="none" ' + L + '/>') +
      m('wobble', '<path d="M' + f(cx - 10) + ' 115q2.5 -3.2 5 0t5 0t5 0t5 0" fill="none" ' + L + '/>') +
      m('o', '<ellipse cx="' + cx + '" cy="114" rx="4.2" ry="5" fill="#1E1A17" ' + L + '/>') +
      m('grit', '<rect x="' + f(cx - 10) + '" y="109.5" width="20" height="9" rx="3" fill="var(--bb-chrome-l)" ' + L + '/>' +
        '<path d="M' + f(cx - 10) + ' 114H' + f(cx + 10) + 'M' + f(cx - 3.5) + ' 110v8M' + f(cx + 3.5) + ' 110v8" stroke="var(--pl-line)" stroke-width="1"/>') +
      '<path d="M' + (x + 6) + ' ' + (y + 6) + 'H' + (x + 18) + '" stroke="#fff" stroke-width="1" opacity=".25"/></g></g>';
  }

  /* Mood fx, all hidden until data-fx names them. They live inside the pose, so they lean with him. */
  function moodFx() {
    var G = 'var(--pl-glow)', LN = 'stroke="var(--pl-line)" stroke-linejoin="round" stroke-linecap="round"';
    var z = function (x, y, s, i) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><g class="bfx-z" style="--i:' + i + '"><path d="M-4 -4H4L-4 4H4" fill="none" stroke="var(--pl-line)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M-4 -4H4L-4 4H4" fill="none" stroke="var(--pl-cream)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></g>'; };
    var heart = function (x, y, s, i) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><g class="bfx-heart" style="--i:' + i + '"><path d="M0 3.6C-3.9 1 -5 -1.2 -5 -2.8C-5 -4.6 -3.6 -5.6 -2.4 -5.6C-1.3 -5.6 -.4 -5 0 -4C.4 -5 1.3 -5.6 2.4 -5.6C3.6 -5.6 5 -4.6 5 -2.8C5 -1.2 3.9 1 0 3.6Z" fill="#FF6F86" ' + LN + ' stroke-width=".9"/></g></g>'; };
    var spark = function (x, y, s, i) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><g class="bfx-spark" style="--i:' + i + '"><path d="M0 -6Q.8 -.8 6 0Q.8 .8 0 6Q-.8 .8 -6 0Q-.8 -.8 0 -6Z" fill="' + G + '" ' + LN + ' stroke-width=".9"/></g></g>'; };
    var puff = function (x, y, i) { return '<g transform="translate(' + x + ' ' + y + ')"><g class="bfx-puff" style="--i:' + i + '"><path d="M-6 2a4 4 0 0 1 2 -7a5 5 0 0 1 8 0a4 4 0 0 1 2 7Z" fill="#fff" ' + LN + ' stroke-width="1.2"/></g></g>'; };
    var drop = function (x, y, cls, i) { return '<g transform="translate(' + x + ' ' + y + ')"><g class="' + cls + '" style="--i:' + i + '"><path d="M0 -4Q3 0 3 2A3 3 0 0 1 -3 2Q-3 0 0 -4Z" fill="#8FD3F4" ' + LN + ' stroke-width="1"/></g></g>'; };
    return '<g class="bb-fx">' +
      '<g class="bfx bfx-zzz">' + z(146, 50, .7, 0) + z(156, 38, .9, 1) + z(168, 24, 1.1, 2) + '</g>' +
      '<g class="bfx bfx-bang"><g transform="translate(150 26)"><g class="bfx-bang-in"><path d="M-2.6 -14H2.6L1.6 3H-1.6Z" fill="' + G + '" ' + LN + ' stroke-width="1.4"/><circle cy="8.5" r="2.6" fill="' + G + '" ' + LN + ' stroke-width="1.4"/></g></g></g>' +
      '<g class="bfx bfx-q"><g transform="translate(150 26)"><g class="bfx-q-in"><path d="M-5 -8Q-5 -14 0 -14Q5.5 -14 5.5 -9Q5.5 -5.5 1.5 -4Q0 -3.2 0 0" fill="none" stroke="var(--pl-line)" stroke-width="6" stroke-linecap="round"/><path d="M-5 -8Q-5 -14 0 -14Q5.5 -14 5.5 -9Q5.5 -5.5 1.5 -4Q0 -3.2 0 0" fill="none" stroke="' + G + '" stroke-width="3" stroke-linecap="round"/><circle cy="6.5" r="2.4" fill="' + G + '" ' + LN + ' stroke-width="1.3"/></g></g></g>' +
      '<g class="bfx bfx-dots">' + [0, 1, 2].map(function (i) { return '<circle class="bfx-dot" style="--i:' + i + '" cx="' + (100 + i * 10) + '" cy="27" r="3" fill="' + G + '" ' + LN + ' stroke-width="1.2"/>'; }).join('') + '</g>' +
      '<g class="bfx bfx-sweat">' + drop(141, 74, 'fx-drip', 0) + '</g>' +
      '<g class="bfx bfx-tears">' + drop(90, 95, 'fx-tear', 0) + drop(130, 95, 'fx-tear', 1) + drop(90, 95, 'fx-tear', 2) + drop(130, 95, 'fx-tear', 3) + '</g>' +
      '<g class="bfx bfx-hearts">' + heart(84, 44, 1, 0) + heart(110, 30, 1.3, 1) + heart(138, 42, .9, 2) + '</g>' +
      '<g class="bfx bfx-sparkle">' + spark(78, 72, .8, 0) + spark(144, 66, 1, 1) + spark(110, 30, .7, 2) + '</g>' +
      '<g class="bfx bfx-steam">' + puff(18, 56, 0) + puff(202, 56, 1) + puff(30, 50, 2) + puff(190, 50, 3) + '</g>' +
      '<g class="bfx bfx-vein"><g transform="translate(64 52)"><g class="bfx-vein-in"><path d="M-6 -2Q-2 -2 -2 -6M2 -6Q2 -2 6 -2M6 2Q2 2 2 6M-2 6Q-2 2 -6 2" fill="none" stroke="#E2563B" stroke-width="2.2" stroke-linecap="round"/></g></g></g>' +
      '<g class="bfx bfx-blush"><path d="M77 98l-2 4M81 98l-2 4M85 98l-2 4M135 98l-2 4M139 98l-2 4M143 98l-2 4" stroke="#E2563B" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></g>' +
      '<g class="bfx bfx-tape"><path d="M104 125.5C103 134 99 141 104 143C109 145 112 137 110 132C108 128 113 128 116 125.5" fill="none" stroke="var(--pl-line)" stroke-width="4" stroke-linecap="round"/><path d="M104 125.5C103 134 99 141 104 143C109 145 112 137 110 132C108 128 113 128 116 125.5" fill="none" stroke="#7A4E2E" stroke-width="2.2" stroke-linecap="round"/></g>' +
      '<g class="bfx bfx-rec"><circle cx="196" cy="70" r="2.6" fill="#E2563B" stroke="var(--pl-line)" stroke-width="1"/></g>' +
      '<g class="bfx bfx-stars">' + spark(84, 66, .7, 0) + spark(136, 64, .7, 1) + spark(110, 60, .6, 2) + '</g>' +
      '</g>';
  }

  function wideBox(design) {
    var dark = design === 'wdoor';
    var X = function (n) { return n; };
    var handle = '<g class="bb-handle">' +
      '<rect x="40" y="57" width="12" height="9" rx="2" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/><rect x="168" y="57" width="12" height="9" rx="2" fill="var(--bb-silver-d)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<path d="M46 60V46Q46 38 54 38H166Q174 38 174 46V60" fill="none" stroke="var(--pl-line)" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M46 60V46Q46 38 54 38H166Q174 38 174 46V60" fill="none" stroke="var(--bb-chrome-l)" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M60 38.6H160" stroke="#fff" stroke-width="1" opacity=".6"/></g>';
    var ant = '<g class="bb-ant"' + o(204, 64) + '><path d="M204 64L216 12" stroke="var(--pl-line)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M204 64L216 12" stroke="var(--bb-chrome-l)" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="216" cy="12" r="2.8" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.2"/></g>';
    var feet = '<rect x="26" y="132" width="20" height="9" rx="2.5" fill="var(--pl-line)"/><rect x="174" y="132" width="20" height="9" rx="2.5" fill="var(--pl-line)"/>';
    var body = '<rect x="4" y="62" width="212" height="72" rx="10" fill="' + (dark ? 'var(--bb-black)' : 'var(--bb-silver)') + '" stroke="var(--pl-line)" stroke-width="2.4"/>' +
      (dark
        ? '<rect x="8" y="66" width="204" height="64" rx="7" fill="none" stroke="var(--bb-chrome)" stroke-width="1.1" opacity=".7"/>'
        : '<path d="M4.5 122H215.5V125Q215.5 133.5 207 133.5H13Q4.5 133.5 4.5 125Z" fill="var(--bb-silver-d)"/><path d="M14 66H206" stroke="#fff" stroke-width="1.2" opacity=".55"/>');
    var keys = topKeys(74, 56, 8);
    var notes = '<g>' + note(16, 52, 'bb-note') + note(198, 40, 'bb-note') + note(110, 24, 'bb-note') + '</g>';
    var rew = '<g class="bb-rew"><path d="M116 14L106 21L116 28ZM128 14L118 21L128 28Z" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1.4" stroke-linejoin="round"/></g>';
    var front;
    if (design === 'wdoor') {
      front = tuner(22, 68, 176, 7) +
        woofer(40, 102, 28, false) + woofer(180, 102, 28, false) +
        vu(76, 80) + vu(126, 80) +
        tweeterEye(98, 88, 8.5) + tweeterEye(122, 88, 8.5) +
        '<circle class="pl-cheek" cx="86" cy="104" r="3.4"/><circle class="pl-cheek" cx="134" cy="104" r="3.4"/>' +
        doorMouth(90, 100, 40, 28);
    } else if (design === 'wreels') {
      front = tuner(22, 67, 176, 6) +
        woofer(38, 102, 28, false) + woofer(182, 102, 28, false) +
        deckEyeW(81, 74, 27, 24) + deckEyeW(112, 74, 27, 24) +
        '<circle class="pl-cheek" cx="78" cy="104" r="3.6"/><circle class="pl-cheek" cx="142" cy="104" r="3.6"/>' +
        sliderSmile(86, 8, 7, 103, 123, 6) +
        '<circle cx="76" cy="122" r="3.2" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.1"/><circle cx="144" cy="122" r="3.2" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.1"/>';
    } else {
      var id = 'bbc' + (++uid), L = design === 'wmixL';
      front = (L ? tuner(22, 65.5, 176, 5) : tuner(22, 67, 176, 6)) +
        woofer(38, 102, 28, false) + woofer(182, 102, 28, false) +
        (L ? moodEye('l', 94.5, 85.5, 14, id) + moodEye('r', 125.5, 85.5, 14, id) : moodEye('l', 96, 86, 11, id) + moodEye('r', 124, 86, 11, id)) +
        (L ? '<circle class="pl-cheek" cx="76" cy="104" r="4"/><circle class="pl-cheek" cx="144" cy="104" r="4"/>' : '<circle class="pl-cheek" cx="82" cy="102" r="3.6"/><circle class="pl-cheek" cx="138" cy="102" r="3.6"/>') +
        (L ? '<g transform="translate(0 2)">' + moodDoor(88, 99, 44, 29) + '</g>' : moodDoor(88, 99, 44, 29)) +
        '<path d="M72 80V124M148 80V124" stroke="var(--pl-line)" stroke-width="1" opacity=".18"/>';
      return {
        vb: '0 0 220 150', ground: [110, 141],
        shadow: '<ellipse class="pl-shadow" cx="110" cy="141" rx="94" ry="4"/>',
        parts: '<g class="bb-pose"' + o(110, 141) + '>' + feet + '<g class="bb-handle-pose">' + handle + '</g>' +
          '<g class="bb-ant-pose"' + o(204, 64) + '>' + ant + BULB + '</g><g class="pl-front">' + body + keys + front + '</g>' + moodFx() + '</g>',
        fx: notes + rew
      };
    }
    return {
      vb: '0 0 220 150', ground: [110, 141],
      shadow: '<ellipse class="pl-shadow" cx="110" cy="141" rx="94" ry="4"/>',
      parts: feet + handle + ant + '<g class="pl-front">' + body + keys + front + '</g>',
      fx: notes + rew
    };
  }

  function boombox(design) {
    if (design === 'wdoor' || design === 'wreels' || design === 'wmix' || design === 'wmixL') return wideBox(design);
    if (design !== 'speakers' && design !== 'display') return boombox2(design);
    var keys = '<g>' + [['#5F8F5A', 62], ['#C9663C', 73], ['#BDB8AC', 84], ['#BDB8AC', 95]].map(function (k) {
      return '<rect class="bb-key" x="' + k[1] + '" y="49" width="9" height="8" rx="1.5" fill="' + k[0] + '" stroke="var(--pl-line)" stroke-width="1.4"/>';
    }).join('') + '</g>';
    var handle = '<g class="bb-handle"><path d="M38 58V44Q38 33 49 33H111Q122 33 122 44V58" fill="none" stroke="var(--pl-line)" stroke-width="7.5" stroke-linecap="round"/>' +
      '<path d="M38 58V44Q38 33 49 33H111Q122 33 122 44V58" fill="none" stroke="#7B6455" stroke-width="3" stroke-linecap="round"/></g>';
    var ant = '<g class="bb-ant"' + o(132, 58) + '><path d="M132 58L148 16" stroke="var(--bb-chrome)" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M134.5 51.5L137 45" stroke="var(--pl-line)" stroke-width="1.4"/><circle cx="148" cy="16" r="3.4" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1.2"/></g>';
    var feet = '<rect x="30" y="134" width="18" height="10" rx="3" fill="var(--pl-line)"/><rect x="112" y="134" width="18" height="10" rx="3" fill="var(--pl-line)"/>';
    var body = '<rect class="pl-o" x="14" y="56" width="132" height="82" rx="14" fill="var(--bb-body)"/>' +
      '<path d="M14 72V70Q14 56 28 56H132Q146 56 146 70V72Z" fill="var(--bb-band)"/>' +
      '<rect x="14" y="56" width="132" height="82" rx="14" fill="none" stroke="var(--pl-line)" stroke-width="2.4"/>';
    var notes = '<g>' + note(26, 50, 'bb-note') + note(130, 46, 'bb-note') + note(80, 30, 'bb-note') + '</g>';
    var rew = '<g class="bb-rew"><path d="M86 18L76 25L86 32ZM98 18L88 25L98 32Z" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1.4" stroke-linejoin="round"/></g>';
    var front;
    if (design === 'display') {
      var eq = '<g class="bb-eq">' + [[69, 7], [73.5, 4.5], [78, 3.5], [82.5, 4.5], [87, 7]].map(function (b) {
        return '<rect x="' + b[0] + '" y="' + (103 - b[1]) + '" width="3.4" height="' + b[1] + '" rx="1" fill="var(--pl-green)"/>';
      }).join('') + '</g>';
      front = speaker(38, 102, 20, false) + speaker(122, 102, 20, false) +
        '<rect x="61" y="70" width="38" height="40" rx="7" fill="var(--pl-line)"/><rect x="63.5" y="72.5" width="33" height="35" rx="5.5" fill="var(--pl-ink)"/>' +
        face(80, 86, .8, { glow: true, cheeks: false, ex: 7.5 }) + eq +
        '<path d="M67 76Q70 73.5 76 73.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".2"/>' +
        deck(64, 114, 32, 17);
    } else {
      front = speaker(46, 98, 25, true) + speaker(114, 98, 25, true) + deck(68, 76, 24, 22) +
        face(80, 112, .9, { eyes: false, ck: 10 });
    }
    return {
      shadow: '<ellipse class="pl-shadow" cx="80" cy="150" rx="58" ry="4"/>',
      parts: feet + handle + ant + '<g class="pl-front">' + body + keys + front + '</g>',
      fx: notes + rew
    };
  }

  /* =========================== PHONE =========================== */

  function cord() {
    /* A coiled cord: a sine wave riding a curve from the handset down to the side of the body. */
    var d = '', n = 90, P0 = [36, 70], P1 = [2, 100], P2 = [34, 134];
    for (var i = 0; i <= n; i++) {
      var t = i / n, a = 1 - t;
      var x = a * a * P0[0] + 2 * a * t * P1[0] + t * t * P2[0], y = a * a * P0[1] + 2 * a * t * P1[1] + t * t * P2[1];
      var dx = 2 * a * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), dy = 2 * a * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
      var len = Math.hypot(dx, dy), w = Math.sin(t * Math.PI * 2 * 9) * 3;
      d += (i ? 'L' : 'M') + f(x - dy / len * w) + ' ' + f(y + dx / len * w);
    }
    return '<g class="ph-cord"' + o(34, 134) + '><path d="' + d + '" fill="none" stroke="var(--ph-hand)" stroke-width="2.2" stroke-linejoin="round"/></g>';
  }

  function dial(cx, cy, r, withFace) {
    var holes = '';
    for (var i = 0; i < 10; i++) {
      var a = (-120 + i * 27) * Math.PI / 180;
      holes += '<circle cx="' + f(cx + Math.cos(a) * r * .7) + '" cy="' + f(cy + Math.sin(a) * r * .7) + '" r="' + f(r * .13) + '" fill="var(--ph-body-d)" stroke="var(--pl-line)" stroke-width="1"/>';
    }
    var stopA = 62 * Math.PI / 180;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="var(--pl-cream)" stroke="var(--pl-line)" stroke-width="2.2"/>' +
      '<g class="ph-dial"' + o(cx, cy) + '>' + holes + '</g>' +
      '<path d="M' + f(cx + Math.cos(stopA) * r * .55) + ' ' + f(cy + Math.sin(stopA) * r * .55) + 'L' + f(cx + Math.cos(stopA) * r * .98) + ' ' + f(cy + Math.sin(stopA) * r * .98) + '" stroke="var(--bb-chrome)" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .44) + '" fill="#F6E3C8" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      (withFace ? face(cx, cy - 2, r * .44 / 15, { ex: 6.2, ck: 10.5 }) : '');
  }

  function phone(design) {
    var body = '<path class="pl-o" d="M28 146L37 92Q41 76 58 76H102Q119 76 123 92L132 146Q132 150 128 150H32Q28 150 28 146Z" fill="var(--ph-body)"/>' +
      '<path d="M30 140H130L131 146Q131 149 128 149H32Q29 149 29 146Z" fill="var(--ph-body-d)" opacity=".5"/>' +
      '<path d="M46 86Q50 80 60 80" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".35"/>';
    var cradle = '<rect x="44" y="66" width="14" height="13" rx="3.5" fill="var(--ph-body-d)" stroke="var(--pl-line)" stroke-width="1.8"/>' +
      '<rect x="102" y="66" width="14" height="13" rx="3.5" fill="var(--ph-body-d)" stroke="var(--pl-line)" stroke-width="1.8"/>';
    var hand = '<g class="ph-hand"' + o(80, 62) + '>' +
      '<path d="M44 66Q34 66 34 58Q34 52 42 52H118Q126 52 126 58Q126 66 116 66Q112 60 104 60H56Q48 60 44 66Z" fill="var(--ph-hand)" stroke="var(--pl-line)" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<ellipse cx="42" cy="66" rx="11" ry="5.5" fill="var(--ph-hand)"/><ellipse cx="118" cy="66" rx="11" ry="5.5" fill="var(--ph-hand)"/>' +
      '<path d="M50 55.5H110" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".22"/></g>';
    var ring = '<g class="ph-ring" fill="none" stroke="var(--pl-glow)" stroke-width="2.6" stroke-linecap="round">' +
      '<path d="M22 50Q16 58 22 66M14 46Q5 58 14 70"/><path d="M138 50Q144 58 138 66M146 46Q155 58 146 70"/></g>';
    var notes = '<g>' + note(26, 44, 'ph-note') + note(132, 40, 'ph-note') + '</g>';
    var front = design === 'belly'
      ? face(80, 94, 1.05, { ex: 9, ck: 16 }) + dial(80, 127, 18, false)
      : dial(80, 112, 30, true);
    return {
      shadow: '<ellipse class="pl-shadow" cx="80" cy="151" rx="54" ry="4"/>',
      parts: cord() + '<g class="pl-front">' + body + cradle + front + '</g>' + hand,
      fx: ring + notes
    };
  }

  var KINDS = {
    boombox: {
      name: 'Boombox', designs: [
        ['wdoor', 'Wide door', 'Extra wide and black. Tweeter eyes, the tape-door mouth, two big woofers, and VU meters whose needles swing to the beat.'],
        ['wmix', 'Reels + door', 'Both favourites at once: round reel windows for eyes (the reels are the pupils), above the tape-door mouth.'],
        ['wreels', 'Wide reel eyes', 'Extra wide and silver. Twin decks as eyes with big reel pupils, and a longer slider smile that bounces to the beat.'],
        ['classic', 'Classic silver', 'Real proportions: wide and short, chrome carry bar, tuner strip with a needle, piano keys on top. The woofers are his eyes.'],
        ['door', 'Tape-door mouth', 'Black and chrome. Two small tweeters are his eyes, and the cassette door is his mouth: it smiles shut and drops open to sing.'],
        ['reels', 'Reel eyes', 'Twin cassette decks are his eyes, each with one big reel for a pupil. A row of EQ sliders makes his smile.'],],
      moves: [['idle', 'Idle', 0], ['groove', 'Groove', 0], ['bass', 'Bass drop', 1], ['rewind', 'Rewind', 1], ['surprise', 'Surprise', 1]],
      build: boombox
    },
    bot: {
      name: 'Workshop bot', designs: [['claw', 'Claw arm', 'A 1950s mint-enamel appliance on casters, face on the front, with a three-jointed arm and a two-finger claw on a turret.'],
        ['roller', 'Roller', 'A butter-cream bell on one ball wheel, a beacon lamp on top, and a small claw arm on each side.']],
      moves: [['idle', 'Idle', 0], ['boogie', 'Boogie', 0], ['wave', 'Wave', 1], ['fetch', 'Fetch', 1], ['alarm', 'Alarm', 1]],
      build: bot
    },
    phone: {
      name: 'Rotary phone', designs: [['dial', 'Dial face', 'His face sits in the middle of the dial, ringed by the finger holes like freckles.'],
        ['belly', 'Dial belly', 'A face on the body like Spike’s, with the dial below as a belly.']],
      moves: [['idle', 'Idle', 0], ['bop', 'Bop', 0], ['ring', 'Ring', 0], ['dial', 'Dial', 1], ['tiphat', 'Tip hat', 1], ['hangup', 'Hang up', 1]],
      build: phone
    }
  };
  var ONCE = { wave: 1, fetch: 1, alarm: 1, bass: 1, rewind: 1, surprise: 1, dial: 1, tiphat: 1, hangup: 1 };

  /* =========================== WORKSHOP BOT =========================== */

  /* A tube from (x1,y1) to (x2,y2): a dark outline, then the fill, then a highlight. */
  function tube(x1, y1, x2, y2, w, fill) {
    var d = 'M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2;
    return '<path d="' + d + '" stroke="var(--pl-line)" stroke-width="' + (w + 4) + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" stroke="' + fill + '" stroke-width="' + w + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" stroke="#fff" stroke-width="' + f(w * .18) + '" stroke-linecap="round" opacity=".35" transform="translate(' + f(-w * .22) + ' ' + f(-w * .22) + ')"/>';
  }
  function joint(cx, cy, r) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.8"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r * .35) + '" fill="var(--pl-line)"/>';
  }
  /* A two-finger claw hanging from the wrist at (wx, wy), scaled by k. The fingers open by rotating at the wrist. */
  function claw(wx, wy, k, held) {
    var fa = 'M-2 2C-10 8 -11 16 -6 22L-2 20C-5 16 -5 10 1 5Z', fb = 'M2 2C10 8 11 16 6 22L2 20C5 16 5 10 -1 5Z';
    var t = ' transform="translate(' + wx + ' ' + wy + ') scale(' + k + ')"';
    var P = ' fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="' + f(1.6 / k) + '" stroke-linejoin="round"';
    return (held ? '<g class="bt-held"' + t + '>' + nut(0, 18) + '</g>' : '') +
      '<g class="bt-fa"' + o(wx, wy) + '><path d="' + fa + '"' + t + P + '/></g>' +
      '<g class="bt-fb"' + o(wx, wy) + '><path d="' + fb + '"' + t + P + '/></g>' +
      '<circle cx="' + wx + '" cy="' + wy + '" r="' + f(6 * k) + '" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.8"/>' +
      '<circle cx="' + wx + '" cy="' + wy + '" r="' + f(2 * k) + '" fill="var(--pl-line)"/>';
  }
  /* A hex nut, the thing he fetches. */
  function nut(cx, cy) {
    var pts = [0, 60, 120, 180, 240, 300].map(function (a) { var r = a * Math.PI / 180; return f(cx + 5 * Math.cos(r)) + ' ' + f(cy + 5 * Math.sin(r)); }).join('L');
    return '<path d="M' + pts + 'Z" fill="var(--pl-glow)" stroke="var(--pl-line)" stroke-width="1.4" stroke-linejoin="round"/><circle cx="' + cx + '" cy="' + cy + '" r="1.9" fill="var(--pl-line)"/>';
  }
  function caster(cx, cy) {
    return '<rect x="' + (cx - 4) + '" y="' + (cy - 10) + '" width="8" height="7" rx="1.5" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<g class="bt-wheel"' + o(cx, cy) + '><circle cx="' + cx + '" cy="' + cy + '" r="6" fill="var(--bb-grille)" stroke="var(--pl-line)" stroke-width="1.4"/>' +
      '<path d="M' + (cx - 4) + ' ' + cy + 'H' + (cx + 4) + '" stroke="var(--bb-chrome)" stroke-width="1.4"/><circle cx="' + cx + '" cy="' + cy + '" r="1.6" fill="var(--bb-chrome-l)"/></g>';
  }

  function bot(design) {
    var notes = '<g>' + note(22, 60, 'bt-note') + note(140, 30, 'bt-note') + '</g>';
    var bang = '<g class="bt-bang"><path d="M24 40L30 52M18 58L28 60M136 44L130 54" stroke="var(--pl-glow)" stroke-width="3" stroke-linecap="round"/></g>';
    if (design === 'roller') {
      var bodyD = 'M52 126Q48 72 80 68Q112 72 108 126Q108 133 100 133H60Q52 133 52 126Z';
      var ball = '<g class="bt-wheel"' + o(80, 140) + '><circle cx="80" cy="140" r="11.5" fill="var(--bb-grille)" stroke="var(--pl-line)" stroke-width="2"/>' +
        '<path d="M70 135Q80 131 90 135M70 145Q80 149 90 145" stroke="var(--bb-chrome)" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>';
      var collar = '<path d="M64 130H96L92 136H68Z" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.6" stroke-linejoin="round"/>';
      var body = '<path d="' + bodyD + '" fill="var(--bt-butter)"/>' +
        '<rect x="50" y="112" width="60" height="7" fill="var(--bt-mint)"/>' +
        '<path d="M50 112H110M50 119H110" stroke="var(--pl-line)" stroke-width="1.2"/>' +
        [58, 70, 90, 102].map(function (x) { return '<circle cx="' + x + '" cy="115.5" r="1.2" fill="var(--bb-chrome-l)"/>'; }).join('') +
        '<path d="' + bodyD + '" fill="none" stroke="var(--pl-line)" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M60 84Q62 75 72 72" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".45"/>';
      var beacon = '<g class="bt-beacon"' + o(80, 68) + '><rect x="71" y="62" width="18" height="7" rx="2" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.6"/>' +
        '<path class="bt-light" d="M73 62.5A7 7.5 0 0 1 87 62.5Z" stroke="var(--pl-line)" stroke-width="1.6"/>' +
        '<path d="M76 59Q77 57 79 56.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" fill="none" opacity=".8"/>' +
        '<circle cx="80" cy="53" r="1.8" fill="var(--bb-chrome-l)" stroke="var(--pl-line)" stroke-width="1.2"/></g>';
      var armR = '<g class="bt-sh"' + o(107, 102) + '>' + tube(107, 102, 124, 92, 6, 'var(--bt-mint)') +
        '<g class="bt-el"' + o(124, 92) + '>' + tube(124, 92, 133, 106, 5, 'var(--bt-mint)') + joint(124, 92, 4) +
        '<g class="bt-wr"' + o(133, 106) + '>' + claw(133, 106, .62, true) + '</g></g>' + joint(107, 102, 4.5) + '</g>';
      var armL = '<g class="bt-sh2"' + o(53, 102) + '>' + tube(53, 102, 37, 93, 6, 'var(--bt-mint)') + tube(37, 93, 29, 106, 5, 'var(--bt-mint)') + joint(37, 93, 4) +
        '<g class="bt-wr2"' + o(29, 106) + '>' + claw(29, 106, .62, false) + '</g>' + joint(53, 102, 4.5) + '</g>';
      return {
        shadow: '<ellipse class="pl-shadow" cx="80" cy="151" rx="30" ry="3.5"/>',
        parts: ball + collar + armL + '<g class="pl-front">' + body + face(80, 93, 1.12, { ex: 10, ck: 17 }) + '</g>' + beacon + armR,
        fx: '<g class="bt-floor">' + nut(125, 146) + '</g>' + notes + bang
      };
    }
    // claw arm
    var base = '<rect x="28" y="86" width="86" height="54" rx="14" fill="var(--bt-mint)" stroke="var(--pl-line)" stroke-width="2.4"/>' +
      '<path d="M29.2 122H112.8V126.4H29.2Z" fill="var(--bt-terra)"/><path d="M29.2 122H112.8M29.2 126.4H112.8" stroke="var(--pl-line)" stroke-width="1.1"/>' +
      '<path d="M40 90H100" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".4"/>' +
      '<rect x="40" y="95" width="62" height="24" rx="10" fill="var(--pl-cream)" stroke="var(--bb-chrome)" stroke-width="2.6"/>' +
      '<rect x="40" y="95" width="62" height="24" rx="10" fill="none" stroke="var(--pl-line)" stroke-width="1.1"/>' +
      [[34, 92], [108, 92], [34, 134], [108, 134]].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.4" fill="var(--bt-mint-d)"/>'; }).join('') +
      '<path d="M44 131H62M44 134.5H62" stroke="var(--bt-mint-d)" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle class="bt-light" cx="98" cy="132" r="3.2" stroke="var(--pl-line)" stroke-width="1.2"/>';
    var turret = '<path d="M57 87A14 13 0 0 1 85 87Z" fill="var(--bb-chrome)" stroke="var(--pl-line)" stroke-width="1.8" stroke-linejoin="round"/>';
    var arm = '<g class="bt-sh"' + o(71, 80) + '>' + tube(71, 80, 98, 44, 11, 'var(--bt-mint)') +
      '<path d="M78 76L96 52" stroke="var(--bb-chrome-l)" stroke-width="2" stroke-linecap="round"/>' +
      '<g class="bt-el"' + o(98, 44) + '>' + tube(98, 44, 128, 60, 9, 'var(--bt-mint)') + joint(98, 44, 7) +
      '<g class="bt-wr"' + o(128, 60) + '>' + claw(128, 60, 1, true) + '</g></g>' + joint(71, 80, 7.5) + '</g>';
    return {
      shadow: '<ellipse class="pl-shadow" cx="72" cy="151" rx="46" ry="4"/>',
      parts: caster(44, 146) + caster(98, 146) + '<g class="pl-front">' + base + face(71, 106, 1.05, { ex: 9, ck: 18 }) + '</g>' + turret + arm,
      fx: '<g class="bt-floor">' + nut(122, 146) + '</g>' + notes + bang
    };
  }

  /* ---- moods for Reels + door. Each is a few numbers (eased by registered custom properties) and a few switches.
     lid/low/tilt: [left, right]; look: [x, y] px; spin: reel seconds per turn while idle (0 stops them);
     reel: 'back' or 'split' (dizzy); eye: one shape for both, or [left, right]. The first 13 are Fuzz's moods. ---- */
  var MOOD0 = { lid: [.12, .12], tilt: [0, 0], low: [0, 0], look: [0, 0], iris: 1, door: 0, ant: 0, handle: 0, lean: 0, blush: .75, spin: 4, eye: 'reel', mouth: 'smile', fx: '', reel: '', act: '' };
  var MOODS = {
    idle:      { label: 'Idle', fuzz: 'idle' },
    happy:     { label: 'Happy', fuzz: 'happy', lid: [0, 0], low: [.5, .5], mouth: 'grin', blush: 1, ant: -12, spin: 1.6, act: 'buzz' },
    eager:     { label: 'Eager', fuzz: 'eager', lid: [0, 0], iris: 1.14, mouth: 'grin', handle: -5, ant: -14, spin: 1, fx: 'bulb', act: 'perk' },
    proud:     { label: 'Proud', fuzz: 'proud', eye: 'happy', mouth: 'grin', handle: -3, lean: -3, blush: .95, fx: 'sparkle', act: 'buzz' },
    thinking:  { label: 'Thinking', fuzz: 'thinking', lid: [.3, .22], look: [3, -3], mouth: 'flat', spin: 2.5, fx: 'dots', act: 'ponder' },
    working:   { label: 'Working', fuzz: 'working', lid: [.2, .2], mouth: 'smile', spin: 1.2, fx: 'rec', act: 'glance' },
    sleepy:    { label: 'Sleepy', fuzz: 'sleepy', lid: [.74, .74], low: [.12, .12], look: [0, 1.5], mouth: 'flat', ant: 75, spin: 10, fx: 'zzz', act: 'doze' },
    sheepish:  { label: 'Sheepish', fuzz: 'sheepish', lid: [.25, .25], tilt: [-10, 10], look: [-2.5, 2.5], mouth: 'wobble', blush: 1, ant: 35, lean: 3, fx: 'sweat blush' },
    worried:   { label: 'Worried', fuzz: 'worried', lid: [.08, .08], tilt: [-16, 16], iris: .82, mouth: 'grit', ant: 20, spin: 1.4, fx: 'sweat', act: 'shiver' },
    bored:     { label: 'Bored', fuzz: 'bored', lid: [.55, .55], look: [3, .5], mouth: 'flat', ant: 55, lean: -2, spin: 8 },
    grateful:  { label: 'Grateful', fuzz: 'grateful', eye: 'heart', mouth: 'smile', blush: 1, ant: -6, fx: 'hearts', act: 'sway' },
    boop:      { label: 'Boop', fuzz: 'boop', lid: [0, 0], iris: .75, mouth: 'o', handle: -6, ant: -10, act: 'boop' },
    chill:     { label: 'Off', fuzz: 'chill', eye: 'line', mouth: 'flat', ant: 100, spin: 0, blush: .35, fx: 'zzz' },
    surprised: { label: 'Surprised', lid: [0, 0], iris: .62, door: .8, mouth: 'o', handle: -8, ant: -14, fx: 'bang', act: 'startle' },
    sad:       { label: 'Sad', lid: [.32, .32], tilt: [-16, 16], look: [0, 2.5], mouth: 'frown', ant: 95, handle: 2, spin: 8, lean: 2 },
    crying:    { label: 'Crying', lid: [.3, .3], tilt: [-18, 18], low: [.25, .25], mouth: 'wobble', door: .3, ant: 95, spin: 8, fx: 'tears', act: 'sob' },
    grumpy:    { label: 'Grumpy', lid: [.42, .42], tilt: [18, -18], iris: .88, mouth: 'frown', handle: 2, ant: -4, spin: 2, fx: 'steam vein', act: 'fume' },
    dizzy:     { label: 'Dizzy', eye: 'spiral', mouth: 'wobble', door: .35, ant: 30, reel: 'split', fx: 'tape stars', act: 'woozy' },
    wink:      { label: 'Wink', eye: ['reel', 'happy'], low: [.3, 0], mouth: 'smirk', blush: 1, lean: -3, fx: 'sparkle' },
    smug:      { label: 'Smug', lid: [.48, .48], tilt: [6, -6], low: [.28, .28], look: [2.5, 0], mouth: 'smirk', lean: -3, handle: -1 },
    laugh:     { label: 'Laughing', eye: 'happy', door: .75, mouth: 'grin', blush: 1, ant: -10, spin: .8, act: 'laugh' },
    starstruck:{ label: 'Starstruck', eye: 'star', door: .55, mouth: 'o', blush: 1, handle: -4, ant: -12, fx: 'sparkle', act: 'buzz' }
  };

  function moodStyle(name) {
    var m = Object.assign({}, MOOD0, MOODS[name] || {});
    return '--lid-l:' + m.lid[0] + ';--lid-r:' + m.lid[1] + ';--tilt-l:' + m.tilt[0] + ';--tilt-r:' + m.tilt[1] +
      ';--low-l:' + m.low[0] + ';--low-r:' + m.low[1] + ';--look-x:' + m.look[0] + ';--look-y:' + m.look[1] +
      ';--iris:' + m.iris + ';--door:' + m.door + ';--ant:' + m.ant + ';--handle:' + m.handle + ';--lean:' + m.lean +
      ';--blush:' + m.blush + ';--spin:' + (m.spin || 4) + 's';
  }
  function moodAttrs(name) {
    var m = Object.assign({}, MOOD0, MOODS[name] || {}), e = Array.isArray(m.eye) ? m.eye : [m.eye, m.eye];
    return { 'data-mood': name, 'data-eye-l': e[0], 'data-eye-r': e[1], 'data-mouth': m.mouth, 'data-fx': m.fx,
      'data-reel': m.spin === 0 ? 'stop' : m.reel, 'data-act': m.act };
  }
  /* Set a mood on a Reels + door boombox. The face eases into it; moves keep playing on top. */
  function mood(el, name) {
    var a = moodAttrs(name);
    Object.keys(a).forEach(function (k) { el.setAttribute(k, a[k]); });
    moodStyle(name).split(';').forEach(function (kv) { var i = kv.indexOf(':'); el.style.setProperty(kv.slice(0, i), kv.slice(i + 1)); });
  }

  function moodHtml(name) {
    var a = moodAttrs(name);
    return Object.keys(a).map(function (k) { return ' ' + k + '="' + a[k] + '"'; }).join('') + ' style="' + moodStyle(name) + '"';
  }

  function svg(kind, design, opts) {
    opts = opts || {};
    var K = KINDS[kind], p = K.build(design);
    var vb = p.vb || VB, g = p.ground || [80, 152], wide = !!p.vb;
    var ratio = wide ? 220 / 150 : 1;
    var size = opts.size ? ' width="' + Math.round(opts.size * ratio) + '" height="' + opts.size + '"' : '';
    return '<svg class="rpal" viewBox="' + vb + '"' + size + (wide ? ' data-wide=""' : '') + ' data-kind="' + kind + '" data-design="' + design + '" data-anim="' + (opts.anim || 'idle') + '"' +
      ' role="img" aria-label="' + (opts.label || K.name) + '"' + (/^wmix/.test(design) ? moodHtml(opts.mood || 'idle') : '') + '>' + p.shadow +
      '<g class="pl-hop"' + o(g[0], g[1]) + '><g class="pl-tilt"' + o(g[0], g[1]) + '><g class="pl-body"' + o(g[0], g[1]) + '>' + p.parts + '</g></g></g>' + p.fx + '</svg>';
  }

  function play(el, anim) {
    var token = el._plTok = {};
    if (!ONCE[anim]) el._plLoop = anim;
    el.setAttribute('data-anim', 'none');
    void el.getBoundingClientRect();
    el.setAttribute('data-anim', anim);
    if (ONCE[anim]) {
      Promise.all(el.getAnimations({ subtree: true }).map(function (a) { return a.finished; })).then(function () {
        if (el._plTok !== token) return;
        el.dispatchEvent(new CustomEvent('pal:end', { detail: anim }));
        play(el, el._plLoop || 'idle');
      }, function () {});
    }
  }

  window.Pals = { kinds: KINDS, svg: svg, play: play, once: ONCE, mood: mood, moods: MOODS };
})();
