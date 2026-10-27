/* ===========================================================================
   meaning-map.js — the FAQ laid out on a page by meaning.

   Shared by map.html and the Probe section (probe-map.js). Given one
   fingerprint per FAQ answer (from the language model, see semantic.js), it

     - lays them out in two dimensions so answers that mean the same thing
       sit together (t-SNE, worked out here in the browser, seeded, so the
       same fingerprints always give the same map)
     - sorts them into meaning groups, ignoring tabs (k-means), each named
       after the words its answers use most and the rest use least
     - draws the map on a canvas the person can hover, tap, drag and zoom,
       with lines, a star for a typed question and markers for anything
       else placed on it

   Nearness on the map means something; distance across the page doesn't.

   MeaningMap.layout(sim, n, seed)        a layout to step:  .step(), .iter, .Y
   MeaningMap.run(layout, onFrame, done)  steps it a few at a time, per frame
   MeaningMap.groups(vecs, words, seed)   [{ members, label }], biggest first
   MeaningMap.create(options)             a map widget (see create())
   =========================================================================== */

(function (global) {
  'use strict';

  var PERPLEXITY = 12;        // roughly how many neighbours each answer tries to keep close
  var ITERATIONS = 900;       // the map has settled by then
  var STEPS_PER_FRAME = 8;

  // One colour per tab or meaning group; distinct enough side by side.
  var PALETTE = ['#0A66C2', '#D9480F', '#2B8A3E', '#AE3EC9', '#E8590C', '#1098AD', '#C2255C', '#5F3DC4',
    '#74B816', '#F08C00', '#364FC7', '#A61E4D', '#087F5B', '#862E9C', '#495057', '#B08900', '#0B7285', '#E64980'];

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // ---- small helpers -------------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function normalise(vec) {
    var len = 0;
    for (var i = 0; i < vec.length; i++) len += vec[i] * vec[i];
    len = Math.sqrt(len) || 1;
    for (var j = 0; j < vec.length; j++) vec[j] /= len;
    return vec;
  }

  /**
   * One fingerprint for a whole answer: its question and every passage of
   * it, averaged. The question counts double: it says what the answer is for.
   */
  function blend(qVec, cVecs) {
    if (!cVecs || !cVecs.length) return qVec;
    var v = new Float32Array(qVec.length);
    [qVec].concat(cVecs).forEach(function (p, n) {
      var w = n === 0 ? 2 : 1;
      for (var d = 0; d < v.length; d++) v[d] += p[d] * w;
    });
    return normalise(v);
  }

  /** How alike every pair is: an n × n table of cosine similarities. */
  function similarities(vecs) {
    var n = vecs.length;
    var sim = new Float32Array(n * n);
    for (var i = 0; i < n; i++) {
      sim[i * n + i] = 1;
      for (var j = i + 1; j < n; j++) sim[i * n + j] = sim[j * n + i] = dot(vecs[i], vecs[j]);
    }
    return sim;
  }

  // A small seeded random number generator (mulberry32), so the same seed
  // always draws the same map.
  function rng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---- words, for naming groups -------------------------------------------

  var STOP = {};
  ('a an and are as at be by can could do does for from had has have how i if in into is it its ' +
    'me my of on or our should so that the their them then there these they this to was we what when where ' +
    'which who why will with would you your yours am get got im ive dont cant about any some need want ' +
    'tell know please just much many also council make use out up one other more than not no new ' +
    'own sure work happen happens after before over whose').split(' ').forEach(function (w) { STOP[w] = true; });

  /** The distinct content words in a text, lightly de-pluralised, as a set. */
  function words(text) {
    var out = {};
    (String(text).toLowerCase().replace(/[’']/g, '').match(/[a-z][a-z0-9]+/g) || []).forEach(function (w) {
      if (STOP[w] || w.length < 3) return;
      if (/(sh|ch|x|ss)es$/.test(w)) w = w.slice(0, -2);
      else if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
      out[w] = true;
    });
    return out;
  }

  // ---- meaning groups (k-means) --------------------------------------------

  /**
   * Sort fingerprints into groups by meaning alone. wordSets[i] is the word
   * set of answer i, used to name each group. Returns the groups biggest
   * first: [{ members: [i…], label, colour }], and of[i] = its group.
   */
  function groups(vecs, wordSets, seed) {
    var n = vecs.length;
    var k = Math.max(2, Math.min(16, Math.round(Math.sqrt(n / 2))));
    var rand = rng(seed * 7919 + 13);

    // k-means++ start: each new centre is likely to be far from those chosen.
    var centres = [vecs[Math.floor(rand() * n)].slice()];
    while (centres.length < k) {
      var d = vecs.map(function (v) {
        var best = -1;
        centres.forEach(function (c) { best = Math.max(best, dot(v, c)); });
        return Math.max(0, 1 - best);
      });
      var total = d.reduce(function (a, b) { return a + b; }, 0), r = rand() * total, pick = 0;
      for (; pick < n - 1; pick++) { r -= d[pick]; if (r <= 0) break; }
      centres.push(vecs[pick].slice());
    }

    var assign = new Int32Array(n).fill(-1);
    for (var round = 0; round < 40; round++) {
      var moved = false;
      vecs.forEach(function (v, i) {
        var best = 0, bestS = -2;
        centres.forEach(function (c, ci) { var s = dot(v, c); if (s > bestS) { bestS = s; best = ci; } });
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      });
      if (!moved) break;
      centres = centres.map(function (c, ci) {
        var sum = new Float32Array(c.length), m = 0;
        vecs.forEach(function (v, i) {
          if (assign[i] !== ci) return;
          m++;
          for (var dd = 0; dd < sum.length; dd++) sum[dd] += v[dd];
        });
        return m ? normalise(sum) : c;
      });
    }

    var df = {};
    wordSets.forEach(function (ws) { Object.keys(ws).forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });

    var list = [];
    for (var ci = 0; ci < k; ci++) {
      var members = [];
      for (var i = 0; i < n; i++) if (assign[i] === ci) members.push(i);
      if (!members.length) continue;
      var tf = {};
      members.forEach(function (m) { Object.keys(wordSets[m]).forEach(function (w) { tf[w] = (tf[w] || 0) + 1; }); });
      var named = Object.keys(tf).filter(function (w) { return tf[w] >= Math.min(2, members.length); })
        .map(function (w) { return { w: w, s: (tf[w] / members.length) * Math.log(n / df[w]) }; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 3).map(function (x) { return x.w; });
      list.push({ members: members, label: named.join(' · ') || 'misc' });
    }
    list.sort(function (a, b) { return b.members.length - a.members.length; });
    var of = new Int32Array(n);
    list.forEach(function (g, gi) {
      g.colour = PALETTE[gi % PALETTE.length];
      g.members.forEach(function (m) { of[m] = gi; });
    });
    return { list: list, of: of };
  }

  // ---- the layout (t-SNE) --------------------------------------------------
  //
  // Answers close in meaning pull together, everything else pushes apart,
  // until the map settles. Exact (no shortcuts), which is quick for a few
  // hundred answers.

  function layout(sim, n, seed) {
    var P = new Float64Array(n * n);
    var row = new Float64Array(n);
    var target = Math.log(Math.max(2, Math.min(PERPLEXITY, (n - 1) / 3)));

    // For each answer, find the spread that gives it about PERPLEXITY neighbours.
    for (var i = 0; i < n; i++) {
      var beta = 1, lo = -Infinity, hi = Infinity, sum = 1;
      for (var tries = 0; tries < 60; tries++) {
        sum = 0;
        var h = 0, j;
        for (j = 0; j < n; j++) {
          row[j] = j === i ? 0 : Math.exp(-(2 - 2 * sim[i * n + j]) * beta);   // squared distance of unit vectors
          sum += row[j];
        }
        sum = sum || 1e-12;
        for (j = 0; j < n; j++) {
          var p = row[j] / sum;
          if (p > 1e-12) h -= p * Math.log(p);
        }
        if (Math.abs(h - target) < 1e-4) break;
        if (h > target) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; }
        else { hi = beta; beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2; }
      }
      for (var j2 = 0; j2 < n; j2++) P[i * n + j2] = row[j2] / sum;
    }
    // Symmetric, summing to 1.
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var v = Math.max((P[a * n + b] + P[b * n + a]) / (2 * n), 1e-12);
        P[a * n + b] = P[b * n + a] = v;
      }
      P[a * n + a] = 0;
    }

    var rand = rng(seed);
    var Y = new Float64Array(n * 2), gains = new Float64Array(n * 2).fill(1), vel = new Float64Array(n * 2);
    for (var y = 0; y < n * 2; y++) Y[y] = gaussian(rand) * 1e-2;
    var num = new Float64Array(n * n), grad = new Float64Array(n * 2);
    var out = { n: n, iter: 0, total: ITERATIONS, Y: Y, done: false };

    out.step = function () {
      if (out.iter >= ITERATIONS) { out.done = true; return; }
      var it = out.iter++;
      var exaggerate = it < 120 ? 8 : 1;
      var momentum = it < 120 ? 0.5 : 0.8;
      var rate = Math.max(n / 8, 40);
      var qsum = 0, i2, j3;
      for (i2 = 0; i2 < n; i2++) {
        for (j3 = i2 + 1; j3 < n; j3++) {
          var dx = Y[i2 * 2] - Y[j3 * 2], dy = Y[i2 * 2 + 1] - Y[j3 * 2 + 1];
          var q = 1 / (1 + dx * dx + dy * dy);
          num[i2 * n + j3] = num[j3 * n + i2] = q;
          qsum += 2 * q;
        }
      }
      grad.fill(0);
      for (i2 = 0; i2 < n; i2++) {
        for (j3 = 0; j3 < n; j3++) {
          if (i2 === j3) continue;
          var w = num[i2 * n + j3];
          var mult = 4 * (exaggerate * P[i2 * n + j3] - w / qsum) * w;
          grad[i2 * 2] += mult * (Y[i2 * 2] - Y[j3 * 2]);
          grad[i2 * 2 + 1] += mult * (Y[i2 * 2 + 1] - Y[j3 * 2 + 1]);
        }
      }
      var mx = 0, my = 0;
      for (var d = 0; d < n * 2; d++) {
        var same = (grad[d] > 0) === (vel[d] > 0);
        gains[d] = Math.max(same ? gains[d] * 0.8 : gains[d] + 0.2, 0.01);
        vel[d] = momentum * vel[d] - rate * gains[d] * grad[d];
        Y[d] += vel[d];
        if (d % 2) my += Y[d]; else mx += Y[d];
      }
      mx /= n; my /= n;
      for (var c = 0; c < n; c++) { Y[c * 2] -= mx; Y[c * 2 + 1] -= my; }
      if (out.iter >= ITERATIONS) out.done = true;
    };
    return out;
  }

  /**
   * Step a layout a few times each frame until it settles. onFrame(layout)
   * after each frame; done(layout) at the end. Returns a function that stops it.
   */
  function run(lay, onFrame, done) {
    var frame = null;
    var tick = function () {
      for (var s = 0; s < STEPS_PER_FRAME && !lay.done; s++) lay.step();
      if (onFrame) onFrame(lay);
      if (lay.done) { frame = null; if (done) done(lay); }
      else frame = requestAnimationFrame(tick);
    };
    tick();
    return function () { if (frame) cancelAnimationFrame(frame); frame = null; };
  }

  /** Where a group's name goes: the member with most of the group around it. */
  function heart(members, Y) {
    var best = members[0], bestD = Infinity;
    members.forEach(function (i) {
      var d = 0;
      members.forEach(function (j) {
        var dx = Y[i * 2] - Y[j * 2], dy = Y[i * 2 + 1] - Y[j * 2 + 1];
        d += Math.sqrt(dx * dx + dy * dy);
      });
      if (d < bestD) { bestD = d; best = i; }
    });
    return { x: Y[best * 2], y: Y[best * 2 + 1] };
  }

  /**
   * A spot for something that isn't on the map (a typed question, a content
   * gap) among the answers it matches best, pulled hardest towards the best.
   * matches: [{ i, s }] best first.
   */
  function placeAmong(matches, Y) {
    var top = matches.slice(0, 3);
    if (!top.length) return null;
    var x = 0, y = 0, wsum = 0;
    top.forEach(function (m) {
      var w = Math.exp((m.s - top[0].s) * 25);
      x += Y[m.i * 2] * w; y += Y[m.i * 2 + 1] * w; wsum += w;
    });
    return { x: x / wsum, y: y / wsum };
  }

  /**
   * The fingerprint a spot on the map would have, as near as can be told.
   * The layout can't be run backwards, so this blends the fingerprints of
   * the dots around the spot, the nearest counting most. vecs[i] is dot i's
   * fingerprint. Returns { vec, near: [{ i, w }] (heaviest first), gap }:
   * gap is how far the spot is from its nearest dot, in typical spaces
   * between neighbouring dots — over about 4, it is empty ground between
   * topics, and the blend is a guess.
   */
  function spotVector(vecs, Y, x, y) {
    var n = vecs.length;
    var dist = [];
    for (var i = 0; i < n; i++) dist.push({ i: i, d: Math.hypot(Y[i * 2] - x, Y[i * 2 + 1] - y) });
    dist.sort(function (a, b) { return a.d - b.d; });

    // The typical space between a dot and its nearest neighbour.
    var gaps = [];
    for (var a = 0; a < n; a++) {
      var best = Infinity;
      for (var b = 0; b < n; b++) {
        if (a !== b) best = Math.min(best, Math.hypot(Y[a * 2] - Y[b * 2], Y[a * 2 + 1] - Y[b * 2 + 1]));
      }
      gaps.push(best);
    }
    gaps.sort(function (p, q) { return p - q; });
    var typical = gaps[Math.floor(gaps.length / 2)] || 1;

    var near = dist.slice(0, 8);
    var sigma = Math.max(near[Math.min(2, near.length - 1)].d, typical);
    var v = new Float32Array(vecs[0].length), wsum = 0;
    var weighted = near.map(function (m) {
      var w = Math.exp(-(m.d * m.d) / (2 * sigma * sigma));
      for (var k = 0; k < v.length; k++) v[k] += vecs[m.i][k] * w;
      wsum += w;
      return { i: m.i, w: w };
    });
    weighted.forEach(function (m) { m.w /= wsum || 1; });
    return { vec: normalise(v), near: weighted, gap: dist[0].d / typical };
  }

  // ---- the widget ----------------------------------------------------------

  /**
   * A map on a canvas. options:
   *   info(i)        { title, sub } for a dot's tooltip and label
   *   onSelect(i)    a dot was tapped (-1: empty space, if there is no onSpot)
   *   onSpot(x, y)   empty space was tapped, at this spot in map units
   *   onMarker(m)    a marker was tapped
   *   onLegend(key)  a legend chip was tapped
   * Returns { el, set(state), fit(), redraw() }. state (all optional, merged):
   *   pos      Float64Array x0 y0 x1 y1 … in map units
   *   points   [{ colour, hollow }]
   *   focus    { i: true } dots kept at full strength, or null for all
   *   selected index or -1
   *   links    { from: { x, y } | index, to: [{ i, s }] }
   *   star     { x, y } or null
   *   spot     { x, y } or null — a spot picked on the map, drawn as a target
   *   markers  [{ x, y, colour, title, sub, ... }]
   *   names    [{ x, y, label, colour }] group names
   *   legend   [{ key, label, colour, on }]
   *   settling true while the layout is still moving (keeps it fitted)
   */
  function create(options) {
    options = options || {};
    var el = document.createElement('div');
    el.className = 'mmap';
    el.innerHTML =
      '<canvas class="mmap-canvas"></canvas>' +
      '<div class="mmap-overlay"></div>' +
      '<div class="mmap-tip"></div>' +
      '<div class="mmap-zoom">' +
      '<button type="button" data-z="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-z="fit" aria-label="Fit the map" title="Fit">⤢</button></div>' +
      '<div class="mmap-legend"></div>';
    var canvas = el.querySelector('canvas');
    var ctx = canvas.getContext('2d');
    var tip = el.querySelector('.mmap-tip');
    var legendEl = el.querySelector('.mmap-legend');
    var overlay = el.querySelector('.mmap-overlay');

    var st = { pos: null, points: [], focus: null, selected: -1, links: null, star: null, spot: null,
      markers: [], names: [], legend: [], settling: false, message: '' };
    var view = { scale: 1, tx: 0, ty: 0 };
    var bounds = { x: 0, y: 0, w: 1, h: 1 };
    var userMoved = false;
    var hover = -1;
    var queued = false;
    var size = { w: 0, h: 0 };

    function n() { return st.pos ? st.pos.length / 2 : 0; }

    function set(next) {
      var legendChanged = false;
      Object.keys(next).forEach(function (k) {
        if (k === 'legend') legendChanged = true;
        st[k] = next[k];
      });
      if (next.pos && !st.settling && next.refit !== false) userMoved = false;
      if (legendChanged) renderLegend();
      overlay.textContent = st.message || '';
      overlay.style.display = st.message ? '' : 'none';
      if (!userMoved) fit();
      redraw();
    }

    function renderLegend() {
      legendEl.innerHTML = (st.legend || []).map(function (it) {
        return '<button type="button" data-key="' + esc(it.key) + '" class="' + (it.on ? 'on' : '') + '">' +
          '<i style="background:' + esc(it.colour) + '"></i>' + esc(it.label) + '</button>';
      }).join('');
    }

    function measureSize() {
      var r = canvas.getBoundingClientRect();
      size = { w: r.width, h: r.height };
      var dpr = global.devicePixelRatio || 1;
      var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function fit() {
      measureSize();
      if (!n()) return;
      var Y = st.pos, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var i = 0; i < n(); i++) {
        x0 = Math.min(x0, Y[i * 2]); x1 = Math.max(x1, Y[i * 2]);
        y0 = Math.min(y0, Y[i * 2 + 1]); y1 = Math.max(y1, Y[i * 2 + 1]);
      }
      bounds = { x: x0, y: y0, w: Math.max(x1 - x0, 1e-6), h: Math.max(y1 - y0, 1e-6) };
      var pad = 30;
      var below = legendEl.offsetHeight + 10;   // keep the dots clear of the legend
      var s = Math.min((size.w - pad * 2) / bounds.w, (size.h - pad * 2 - below) / bounds.h);
      view.scale = Math.max(s, 1e-6);
      view.tx = size.w / 2 - (bounds.x + bounds.w / 2) * view.scale;
      view.ty = (size.h - below) / 2 - (bounds.y + bounds.h / 2) * view.scale;
    }

    function toScreen(x, y) { return [x * view.scale + view.tx, y * view.scale + view.ty]; }
    function toMap(sx, sy) { return [(sx - view.tx) / view.scale, (sy - view.ty) / view.scale]; }
    function at(i) { return toScreen(st.pos[i * 2], st.pos[i * 2 + 1]); }

    function redraw() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; draw(); });
    }

    function draw() {
      measureSize();
      ctx.clearRect(0, 0, size.w, size.h);
      if (!n()) return;
      var count = n(), i;

      // Lines from the chosen answer or the typed question to its matches.
      if (st.links && st.links.to) {
        var f = typeof st.links.from === 'number' ? at(st.links.from)
          : toScreen(st.links.from.x, st.links.from.y);
        st.links.to.forEach(function (m) {
          var t = at(m.i);
          ctx.strokeStyle = 'rgba(29, 29, 31, ' + Math.max(0.15, Math.min(0.6, (m.s - 0.3) * 1.2)).toFixed(2) + ')';
          ctx.lineWidth = 1 + Math.max(0, (m.s - 0.5) * 4);
          ctx.beginPath(); ctx.moveTo(f[0], f[1]); ctx.lineTo(t[0], t[1]); ctx.stroke();
        });
      }

      var radius = 4.5;
      for (i = 0; i < count; i++) {
        var p = at(i), pt = st.points[i] || {};
        var r = i === hover || i === st.selected ? radius + 3 : radius;
        ctx.globalAlpha = st.focus && !st.focus[i] ? 0.15 : 0.9;
        ctx.beginPath();
        ctx.arc(p[0], p[1], pt.hollow ? r - 0.8 : r, 0, Math.PI * 2);
        if (pt.hollow) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = pt.colour || '#888';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else {
          ctx.fillStyle = pt.colour || '#888';
          ctx.fill();
        }
        if (i === st.selected) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#1D1D1F';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Group names, once the map has settled enough to read them. Biggest
      // groups first; a name that would sit on top of one already drawn is
      // left out (zoom in and it will find room).
      if (!st.settling && st.names) {
        ctx.font = '600 12px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var taken = [];
        st.names.forEach(function (nm) {
          var q = toScreen(nm.x, nm.y);
          var w = ctx.measureText(nm.label).width + 8;
          var box = { x0: q[0] - w / 2, x1: q[0] + w / 2, y0: q[1] - 23, y1: q[1] - 5 };
          var clash = taken.some(function (b) {
            return box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0;
          });
          if (clash) return;
          taken.push(box);
          ctx.globalAlpha = nm.faint ? 0.55 : 1;
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.strokeText(nm.label, q[0], q[1] - 14);
          ctx.fillStyle = nm.colour || '#495057';
          ctx.fillText(nm.label, q[0], q[1] - 14);
        });
        ctx.globalAlpha = 1;
      }

      (st.markers || []).forEach(function (m) {
        var q = toScreen(m.x, m.y);
        ctx.save();
        ctx.translate(q[0], q[1]);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = m.colour || '#C0392B';
        ctx.lineWidth = 2;
        ctx.fillRect(-5, -5, 10, 10);
        ctx.strokeRect(-5, -5, 10, 10);
        ctx.restore();
      });

      if (st.star) {
        var s = toScreen(st.star.x, st.star.y);
        star(s[0], s[1], 11, 5);
      }

      if (st.spot) {
        var t = toScreen(st.spot.x, st.spot.y);
        ctx.strokeStyle = '#1D1D1F';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t[0], t[1], 9, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(t[0] - 14, t[1]); ctx.lineTo(t[0] - 5, t[1]);
        ctx.moveTo(t[0] + 5, t[1]); ctx.lineTo(t[0] + 14, t[1]);
        ctx.moveTo(t[0], t[1] - 14); ctx.lineTo(t[0], t[1] - 5);
        ctx.moveTo(t[0], t[1] + 5); ctx.lineTo(t[0], t[1] + 14);
        ctx.stroke();
      }

      if (st.selected >= 0) label(st.selected, true);
      if (hover >= 0 && hover !== st.selected) label(hover, false);
    }

    function star(x, y, outer, points) {
      var inner = outer * 0.45;
      ctx.beginPath();
      for (var k = 0; k < points * 2; k++) {
        var rad = k % 2 ? inner : outer;
        var ang = Math.PI / points * k - Math.PI / 2;
        ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
      }
      ctx.closePath();
      ctx.fillStyle = '#FFD43B';
      ctx.strokeStyle = '#1D1D1F';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }

    function label(i, bold) {
      var info = options.info ? options.info(i) : null;
      if (!info) return;
      var p = at(i);
      var text = info.title.length > 60 ? info.title.slice(0, 58).replace(/\s+\S*$/, '') + '…' : info.title;
      ctx.font = (bold ? '600 ' : '') + '12px ' + FONT;
      ctx.textAlign = p[0] > size.w / 2 ? 'right' : 'left';   // the side with more room
      ctx.textBaseline = 'middle';
      var x = ctx.textAlign === 'right' ? p[0] - 11 : p[0] + 11;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.strokeText(text, x, p[1]);
      ctx.fillStyle = '#1D1D1F';
      ctx.fillText(text, x, p[1]);
    }

    // ---- zoom, pan, hover, tap --------------------------------------------

    function zoomAt(factor, sx, sy) {
      var before = toMap(sx, sy);
      view.scale *= factor;
      view.tx = sx - before[0] * view.scale;
      view.ty = sy - before[1] * view.scale;
      userMoved = true;
      redraw();
    }

    /** Pan just enough to bring a spot into view. */
    function reveal(x, y) {
      var p = toScreen(x, y), m = 40;
      if (p[0] < m || p[0] > size.w - m || p[1] < m || p[1] > size.h - m) {
        view.tx += size.w / 2 - p[0];
        view.ty += size.h / 2 - p[1];
        userMoved = true;
        redraw();
      }
    }

    el.querySelector('.mmap-zoom').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.z === 'fit') { userMoved = false; fit(); redraw(); return; }
      zoomAt(b.dataset.z === 'in' ? 1.4 : 1 / 1.4, size.w / 2, size.h / 2);
    });

    legendEl.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (b && options.onLegend) options.onLegend(b.dataset.key);
    });

    function local(ev) {
      var r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    }

    /** The dot or marker under a point: { dot: i } or { marker: m } or null. */
    function hit(sx, sy) {
      var best = null, bestD = 14 * 14;
      (st.markers || []).forEach(function (m) {
        var q = toScreen(m.x, m.y);
        var d = (q[0] - sx) * (q[0] - sx) + (q[1] - sy) * (q[1] - sy);
        if (d < bestD) { bestD = d; best = { marker: m }; }
      });
      for (var i = 0; i < n(); i++) {
        var p = at(i);
        var d2 = (p[0] - sx) * (p[0] - sx) + (p[1] - sy) * (p[1] - sy);
        if (d2 < bestD) { bestD = d2; best = { dot: i }; }
      }
      return best;
    }

    function showTip(h, sx, sy) {
      var info = h && (h.marker ? h.marker : (options.info ? options.info(h.dot) : null));
      if (!info) { tip.style.display = 'none'; return; }
      tip.innerHTML = esc(info.title) + (info.sub ? '<small>' + esc(info.sub) + '</small>' : '');
      tip.style.display = 'block';
      var w = tip.offsetWidth, ht = tip.offsetHeight;
      tip.style.left = Math.max(6, Math.min(sx + 14, size.w - w - 6)) + 'px';
      tip.style.top = Math.max(6, Math.min(sy + 14, size.h - ht - 6)) + 'px';
    }

    var pointers = {}, drag = null, pinch = null;

    canvas.addEventListener('pointerdown', function (ev) {
      canvas.setPointerCapture(ev.pointerId);
      var p = local(ev);
      pointers[ev.pointerId] = { x: p[0], y: p[1] };
      var ids = Object.keys(pointers);
      if (ids.length === 1) drag = { x: p[0], y: p[1], start: p, moved: false };
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        drag = null;
      }
    });

    canvas.addEventListener('pointermove', function (ev) {
      var p = local(ev);
      if (pointers[ev.pointerId]) pointers[ev.pointerId] = { x: p[0], y: p[1] };
      var ids = Object.keys(pointers);
      if (pinch && ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        view.tx += cx - pinch.cx; view.ty += cy - pinch.cy;
        if (pinch.dist > 0) zoomAt(dist / pinch.dist, cx, cy);
        pinch = { dist: dist, cx: cx, cy: cy };
        return;
      }
      if (drag) {
        if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 4) drag.moved = true;
        if (drag.moved) {
          view.tx += p[0] - drag.x; view.ty += p[1] - drag.y;
          drag.x = p[0]; drag.y = p[1];
          userMoved = true;
          canvas.classList.add('dragging');
          showTip(null);
          redraw();
          return;
        }
      }
      if (ev.pointerType === 'mouse') {
        var h = hit(p[0], p[1]);
        var i = h && h.dot != null ? h.dot : -1;
        if (i !== hover) { hover = i; redraw(); }
        canvas.classList.toggle('pointing', !!h);
        showTip(h, p[0], p[1]);
      }
    });

    function endPointer(ev) {
      var p = local(ev);
      var wasTap = drag && !drag.moved && Object.keys(pointers).length === 1;
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      canvas.classList.remove('dragging');
      if (wasTap && ev.type === 'pointerup') {
        var h = hit(p[0], p[1]);
        if (h && h.marker) { if (options.onMarker) options.onMarker(h.marker); }
        else if (!h && options.onSpot) {
          var m = toMap(p[0], p[1]);
          options.onSpot(m[0], m[1]);
        }
        else if (options.onSelect) options.onSelect(h ? h.dot : -1);
        if (ev.pointerType !== 'mouse') showTip(null);
      }
      if (!Object.keys(pointers).length) drag = null;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () {
      if (hover >= 0) { hover = -1; redraw(); }
      showTip(null);
    });
    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = local(ev);
      zoomAt(Math.exp(-ev.deltaY * 0.0015), p[0], p[1]);
    }, { passive: false });

    // Redraw when the map changes size — including when it is moved into a
    // page that has just been drawn.
    if (global.ResizeObserver) {
      new ResizeObserver(function () {
        if (!el.isConnected) return;
        if (!userMoved) fit();
        draw();
      }).observe(el);
    } else {
      global.addEventListener('resize', function () { if (!userMoved) fit(); draw(); });
    }

    return {
      el: el,
      set: set,
      fit: function () { userMoved = false; fit(); redraw(); },
      redraw: redraw,
      reveal: reveal,
      revealDot: function (i) { if (st.pos) reveal(st.pos[i * 2], st.pos[i * 2 + 1]); }
    };
  }

  global.MeaningMap = {
    PALETTE: PALETTE,
    dot: dot,
    normalise: normalise,
    blend: blend,
    similarities: similarities,
    words: words,
    groups: groups,
    layout: layout,
    run: run,
    heart: heart,
    placeAmong: placeAmong,
    spotVector: spotVector,
    create: create
  };
}(window));
