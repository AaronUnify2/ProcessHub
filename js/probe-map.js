/* ===========================================================================
   probe-map.js — the meaning map in the Probe section.

   The same map as map.html (meaning-map.js), drawn from the working draft:
   every FAQ question in Process Hub, published or not, laid out by what its
   answer means. Probe shows it between the search box and the closest
   answers, so you can see where a question lands and why:

     - a probed question is a star, with lines to the answers Probe ranked
       highest (the line's weight is the score), placed among them
     - when those answers sit in different parts of the map, the model can't
       tell what the question is about; that is when Ask's search goes wrong,
       and the caption says so
     - open content gaps are diamonds, placed among the answers they come
       closest to, so a patch of diamonds is a topic the FAQ is thin on
     - questions not on the public page are hollow rings
     - tapping empty space picks a spot (a target): the caption suggests
       questions that would sit there (spot-hint.js), each ready to probe

   The layout is worked out once for the FAQ text as it stands, and again
   only when an FAQ question or answer changes. It is seeded, so the same
   text always draws the same map.

   ProbeMap.html()          the block to put in the page, with an empty slot
   ProbeMap.attach(state)   move the map into the slot and show state:
                            { result, query, publicOnly, checks, gapIds }
   =========================================================================== */

(function (global) {
  'use strict';

  var S = global.Semantic;
  var MM = global.MeaningMap;

  var NOT_PUBLIC = '#8E8E93';
  var SHOWN = 6;              // lines to this many of Probe's best answers
  var SPOT_LINES = 5;         // lines from a picked spot to the answers it is read from
  var EMPTY = 4;              // a spot this many typical gaps from any dot is empty ground

  var widget = null;
  var built = null;           // { sig, items, vecs, index, groups, layout, tabColour }
  var building = null;        // the promise of a build in progress
  var stop = null;            // stops the layout running
  var state = {};             // what attach() was last asked to show
  var selected = -1;          // a dot picked on the map
  var spot = null;            // a spot picked: { x, y, reading, hints, failed, run }
  var spotRun = 0;
  var focusKey = null;        // a legend chip picked: a tab id, '_private', or 'c' + group
  var colourBy = 'tab';
  var lastReading = null;     // how the last probed question read, for testing in a console

  function e(text) { return Data.escapeHtml(text); }
  function pct(score) { return Math.max(0, Math.round(score * 100)) + '%'; }

  // ---- the block -----------------------------------------------------------

  function html() {
    return '<section class="block probe-map-block">' +
      '<h2>Meaning map <span class="count">every FAQ question, arranged by what its answer means</span></h2>' +
      '<div class="probe-map-tools">' +
      '<label>Colour by <select id="probeMapColour">' +
      '<option value="tab"' + (colourBy === 'tab' ? ' selected' : '') + '>Tab</option>' +
      '<option value="cluster"' + (colourBy === 'cluster' ? ' selected' : '') + '>Meaning group</option>' +
      '</select></label>' +
      '<a href="map.html" target="_blank" rel="noopener">Full-page map of the public FAQ ↗</a></div>' +
      '<div class="probe-map-slot" id="probeMapSlot"></div>' +
      '<div class="probe-map-caption" id="probeMapCaption"></div>' +
      '</section>';
  }

  function ensureWidget() {
    if (widget) return widget;
    widget = MM.create({
      info: function (i) {
        var f = built && built.items[i];
        if (!f) return null;
        return { title: f.q, sub: where(f) };
      },
      onSelect: function (i) {
        selected = i;
        spot = null;
        paint();
        caption();
      },
      onSpot: function (x, y) { pickSpot(x, y); },
      onMarker: function (m) {
        if (m.gapId) location.hash = '#/probe?gap=' + encodeURIComponent(m.gapId);
      },
      onLegend: function (key) {
        focusKey = focusKey === key ? null : key;
        selected = -1;
        spot = null;
        paint();
        caption();
      }
    });
    return widget;
  }

  function where(f) {
    if (f.isPublic) return f.tabLabel + (f.group ? ' › ' + f.group : '');
    return f.faq.internal ? 'Internal — not on the public page' : 'Not on the public page';
  }

  /** Put the map into the page just drawn, and show what it is asked to. */
  function attach(next) {
    var slot = document.getElementById('probeMapSlot');
    if (!slot) return;
    var w = ensureWidget();
    slot.appendChild(w.el);
    var sel = document.getElementById('probeMapColour');
    if (sel) {
      sel.addEventListener('change', function () {
        colourBy = sel.value;
        focusKey = null;
        paint();
        caption();
      });
    }
    var changed = (next.query || '') !== (state.query || '');
    state = next || {};
    if (changed) { selected = -1; focusKey = null; spot = null; }

    if (built && built.layout) { paint(); caption(); }
    else w.set({ message: 'Drawing the map once every answer has been read…' });

    build().then(function () {
      if (!document.getElementById('probeMapSlot')) return;
      paint();
      caption();
    }).catch(function (err) {
      console.warn('Meaning map not drawn:', err);
      w.set({ message: 'The map could not be drawn on this device.' });
    });
  }

  // ---- building the map ----------------------------------------------------

  /** Lay the FAQ out, unless it is already laid out for exactly this text. */
  function build() {
    if (building) return building;
    building = Probe.whenRead().then(function (c) {
      var sig = S.hash(c.faqs.map(function (f) {
        return f.id + ':' + f.qKey + ':' + f.cKeys.join(',') + (f.isPublic ? ':p' : '');
      }).join('|'));
      if (built && built.sig === sig) {
        // The same text; the newest corpus objects, in the same order.
        built.items = built.items.map(function (old) {
          return c.faqs.filter(function (f) { return f.id === old.id; })[0] || old;
        });
        return built;
      }
      if (stop) { stop(); stop = null; }
      spot = null;

      var items = c.faqs.filter(function (f) { return S.lookup(f.qKey); });
      var vecs = items.map(function (f) {
        return MM.blend(S.lookup(f.qKey), f.cKeys.map(S.lookup).filter(Boolean));
      });
      var index = {};
      items.forEach(function (f, i) { index[f.id] = i; });

      var tabColour = {};
      Data.state.library.publishTabs.forEach(function (t, n) { tabColour[t.id] = MM.PALETTE[n % MM.PALETTE.length]; });

      if (items.length < 5) throw new Error('Too few FAQ questions to map');
      var next = {
        sig: sig,
        items: items,
        vecs: vecs,
        index: index,
        tabColour: tabColour,
        groups: MM.groups(vecs, items.map(function (f) {
          return MM.words(f.q + ' ' + f.q + ' ' + f.group + ' ' + f.text.slice(0, 300));
        }), 1),
        layout: MM.layout(MM.similarities(vecs), items.length, 1)
      };
      built = next;

      return new Promise(function (resolve) {
        var first = true;
        stop = MM.run(next.layout, function (lay) {
          if (built !== next || !widget || !widget.el.isConnected) return;
          if (first) { widget.set({ pos: lay.Y }); first = false; }
          paint();
        }, function () {
          stop = null;
          resolve(next);
        });
      });
    });
    building.then(function () { building = null; }, function () { building = null; });
    return building;
  }

  // ---- a spot picked on the map --------------------------------------------

  /**
   * Read a spot: estimate its fingerprint from the answers around it, then
   * ask spot-hint.js for questions that would sit there.
   */
  function pickSpot(x, y) {
    if (!built || !built.layout || !built.layout.done) return;
    selected = -1;
    var reading = MM.spotVector(built.vecs, built.layout.Y, x, y);
    var run = ++spotRun;
    spot = { x: x, y: y, reading: reading, hints: null, failed: false, run: run };
    paint();
    caption();

    SpotHint.suggest({
      vec: reading.vec,
      near: reading.near.map(function (m) { return { item: built.items[m.i], w: m.w }; }),
      corpus: built.items
    }).then(function (hints) {
      if (!spot || spot.run !== run) return;
      spot.hints = hints;
      caption();
    }).catch(function (err) {
      console.warn('No hints for this spot:', err);
      if (!spot || spot.run !== run) return;
      spot.failed = true;
      caption();
    });
  }

  function spotHtml() {
    var r = spot.reading;
    var near = r.near.slice(0, 3);
    var html = '<div class="probe-map-spot">' +
      '<div class="probe-map-spot-head"><strong>What would go here?</strong>' +
      '<button class="btn tiny" type="button" id="probeMapSpotClear" aria-label="Clear the spot">×</button></div>' +
      '<p class="hint">' + (r.gap > EMPTY
        ? 'This is <strong>empty ground between topics</strong>, so these are a blend of the answers around it — ' +
          'questions here may be ones the FAQ doesn\'t answer yet.'
        : 'This spot is among existing answers; questions here are probably close to ones the FAQ already has.') +
      ' Read from: ' + near.map(function (m) {
        var f = built.items[m.i];
        return '<a href="#/faq/' + e(f.id) + '">“' + e(f.q) + '”</a>';
      }).join(', ') + '.</p>';

    if (spot.failed) {
      html += '<p class="hint">The suggestions couldn\'t be worked out on this device.</p>';
    } else if (!spot.hints) {
      html += '<p class="hint">Writing suggestions…</p>';
    } else if (!spot.hints.length) {
      html += '<p class="hint">The answers here don\'t give enough words to suggest a question.</p>';
    } else {
      html += '<ul class="probe-map-hints">' + spot.hints.map(function (h) {
        var close = h.nearest && h.nearest.s >= 0.8;
        return '<li><a class="probe-q" href="#/probe?q=' + encodeURIComponent(h.text) + '">' + e(h.text) + '</a>' +
          '<span class="probe-where">fits this spot ' + pct(h.fit) +
          (h.nearest ? ' · ' + (close ? 'close to' : 'nearest question:') +
            ' <a href="#/faq/' + e(h.nearest.item.id) + '">“' + e(h.nearest.item.q) + '”</a> ' + pct(h.nearest.s) : '') +
          '</span></li>';
      }).join('') + '</ul>' +
        '<p class="hint">Written from the words of the answers around the spot, and checked by the model — ' +
        'a hint at the wording, not an answer. Tap one to probe it; if the FAQ can\'t answer it, log it as a gap.</p>';
    }
    return html + '</div>';
  }

  // ---- drawing -------------------------------------------------------------

  function colourOf(f, i) {
    if (colourBy === 'cluster') return built.groups.list[built.groups.of[i]].colour;
    return f.isPublic ? (built.tabColour[f.faq.publish.tabId] || NOT_PUBLIC) : NOT_PUBLIC;
  }

  function keyOf(f, i) {
    if (colourBy === 'cluster') return 'c' + built.groups.of[i];
    return f.isPublic ? f.faq.publish.tabId : '_private';
  }

  /** Probe's best answers that are on the map, best first, as { i, s }. */
  function matches() {
    var r = state.result;
    if (!r || !built) return [];
    return r.faqs.filter(function (h) {
      return built.index[h.item.id] !== undefined && (!state.publicOnly || h.item.isPublic);
    }).slice(0, SHOWN).map(function (h) { return { i: built.index[h.item.id], s: h.score }; });
  }

  function markers() {
    var Y = built.layout.Y, out = [];
    (state.checks || []).forEach(function (chk) {
      if (state.gapIds && !state.gapIds[chk.gap.id]) return;
      var top = (chk.top || []).filter(function (h) { return built.index[h.item.id] !== undefined; })
        .map(function (h) { return { i: built.index[h.item.id], s: h.score }; });
      var at = MM.placeAmong(top, Y);
      if (!at) return;
      var sev = chk.gap.severity;
      out.push({
        x: at.x, y: at.y, gapId: chk.gap.id,
        colour: sev === 'high' ? '#C0392B' : sev === 'low' ? '#B08900' : '#E8590C',
        title: '⚑ ' + chk.gap.q,
        sub: 'Content gap · ' + (sev || 'medium') + ' · tap to probe it'
      });
    });
    return out;
  }

  function paint() {
    if (!widget || !built || !built.layout) return;
    var items = built.items;
    var m = matches();
    var focus = null, links = null, star = null;

    if (m.length) star = MM.placeAmong(m, built.layout.Y);

    if (spot) {
      // The answers the spot is read from, heavier lines for the nearer.
      var from = spot.reading.near.slice(0, SPOT_LINES);
      focus = {};
      from.forEach(function (x) { focus[x.i] = true; });
      links = { from: { x: spot.x, y: spot.y }, to: from.map(function (x) { return { i: x.i, s: 0.45 + x.w }; }) };
    } else if (m.length) {
      links = { from: star, to: m };
      focus = {};
      m.forEach(function (x) { focus[x.i] = true; });
      if (selected >= 0) focus[selected] = true;
    } else if (selected >= 0) {
      focus = {};
      focus[selected] = true;
    } else if (focusKey) {
      focus = {};
      items.forEach(function (f, i) { if (keyOf(f, i) === focusKey) focus[i] = true; });
    } else if (state.publicOnly) {
      focus = {};
      items.forEach(function (f, i) { if (f.isPublic) focus[i] = true; });
    }

    var legend;
    if (colourBy === 'cluster') {
      legend = built.groups.list.map(function (g, gi) {
        return { key: 'c' + gi, label: g.label, colour: g.colour, on: focusKey === 'c' + gi };
      });
    } else {
      var used = {};
      items.forEach(function (f) { if (f.isPublic) used[f.faq.publish.tabId] = true; });
      legend = Data.state.library.publishTabs.filter(function (t) { return used[t.id]; }).map(function (t) {
        return { key: t.id, label: Data.plainText(t.label), colour: built.tabColour[t.id], on: focusKey === t.id };
      });
      if (items.some(function (f) { return !f.isPublic; })) {
        legend.push({ key: '_private', label: 'Not public', colour: NOT_PUBLIC, on: focusKey === '_private' });
      }
    }

    var names = built.groups.list.map(function (g) {
      var h = MM.heart(g.members, built.layout.Y);
      return { x: h.x, y: h.y, label: g.label, colour: colourBy === 'cluster' ? g.colour : '#6E6E73', faint: colourBy !== 'cluster' };
    });

    widget.set({
      pos: built.layout.Y,
      refit: false,
      points: items.map(function (f, i) { return { colour: colourOf(f, i), hollow: !f.isPublic }; }),
      focus: focus,
      selected: selected,
      links: links,
      star: star,
      spot: spot ? { x: spot.x, y: spot.y } : null,
      markers: markers(),
      names: names,
      legend: legend,
      settling: !built.layout.done,
      message: ''
    });
  }

  // ---- the caption under the map ------------------------------------------

  function caption() {
    var el = document.getElementById('probeMapCaption');
    if (!el || !built || !built.layout || !built.layout.done) return;
    var parts = [];

    if (spot) parts.push(spotHtml());

    if (selected >= 0 && built.items[selected]) {
      var f = built.items[selected];
      var hit = state.result && state.result.faqs.filter(function (h) { return h.item.id === f.id; })[0];
      parts.push('<div class="probe-map-pick">' +
        '<a class="probe-q" href="#/faq/' + e(f.id) + '">' + e(f.q) + '</a>' +
        '<span class="probe-where">' + e(where(f)) +
        ' · <span class="badge status-' + e(f.faq.status) + '">' + e(f.faq.status || '—') + '</span>' +
        ' · meaning group: ' + e(built.groups.list[built.groups.of[selected]].label) +
        (hit ? ' · scores ' + pct(hit.score) + ' for this question' : '') + '</span></div>');
    }

    if (state.query) parts.push(readQuery());
    else if (state.checks && state.checks.length) {
      parts.push('<p>Open content gaps are the ◇ diamonds, each placed among the answers it comes closest to — ' +
        'a patch of them is a topic the FAQ is thin on. Tap one to probe it again.</p>');
    }
    if (!spot) {
      parts.push('<p class="hint">Tap empty space to see what question would go there. ' +
        (state.query ? '' : 'Hover or tap a dot to see its question; drag to move, scroll or pinch to zoom. ' +
          'Hollow rings are questions not on the public page. Nearness on the map means something; ' +
          'distance across it doesn\'t.') + '</p>');
    }
    el.innerHTML = parts.join('');

    var clear = document.getElementById('probeMapSpotClear');
    if (clear) {
      clear.addEventListener('click', function () {
        spot = null;
        paint();
        caption();
      });
    }
  }

  /**
   * What the map says about a probed question: do the answers it matches sit
   * together (the model knows what it is about), or are they scattered
   * across the map (it doesn't, and search will be unreliable)?
   */
  function readQuery() {
    var m = matches();
    var near = m.filter(function (x) { return x.s >= S.WEAK; }).slice(0, 5);
    if (!near.length) {
      return '<p>The ★ sits beside the nearest answers, but <strong>none of them is really about this question</strong>. ' +
        'Either the FAQ doesn\'t cover it, or it covers it in words the model doesn\'t connect with these.</p>';
    }
    if (near.length === 1) {
      lastReading = { groups: 1, spread: 0, best: near[0].s };
      var only = built.items[near[0].i];
      return '<p>Only one answer comes near: “' + e(only.q) + '” (' + pct(near[0].s) + ')' +
        (near[0].s >= S.STRONG
          ? ', and it matches well.</p>'
          : '. <strong>Nothing answers this closely</strong> — probably a gap, or the FAQ puts it in words ' +
            'the model doesn\'t connect with these.</p>');
    }
    var groupsSeen = [];
    near.forEach(function (x) {
      var g = built.groups.of[x.i];
      if (groupsSeen.indexOf(g) < 0) groupsSeen.push(g);
    });
    var Y = built.layout.Y;
    var spread = 0;
    near.slice(0, 3).forEach(function (a) {
      near.slice(0, 3).forEach(function (b) {
        spread = Math.max(spread, Math.hypot(Y[a.i * 2] - Y[b.i * 2], Y[a.i * 2 + 1] - Y[b.i * 2 + 1]));
      });
    });
    var size = extent();
    var labels = groupsSeen.map(function (g) { return '“' + e(built.groups.list[g].label) + '”'; });
    var strong = near[0].s >= S.STRONG;
    lastReading = { groups: groupsSeen.length, spread: spread / size, best: near[0].s };
    var together = groupsSeen.length === 1 && spread < size * 0.25;
    var across = '<strong>spread across ' +
      (groupsSeen.length > 1 ? groupsSeen.length + ' parts of the FAQ' : 'the map') + '</strong>' +
      (groupsSeen.length > 1 ? ' — ' + labels.join(', ') : '');

    if (together && strong) {
      return '<p>The closest answers sit together, in ' + labels[0] + '. ' +
        '<strong>The model is clear what this question is about</strong>, and the best answer matches it well.</p>';
    }
    if (together) {
      return '<p>The closest answers sit together, in ' + labels[0] + ', so the model knows where this question ' +
        'belongs — <strong>but none of them answers it well</strong> (best ' + pct(near[0].s) + '). ' +
        'That usually means a gap in that part of the FAQ.</p>';
    }
    if (strong) {
      return '<p>Probe found a strong answer, but the other close answers are ' + across + '. Similar ' +
        'questions worded a little differently may land on the wrong one in Ask; an <em>Also asked as</em> ' +
        'phrasing on the right answer will steady it.</p>';
    }
    return '<p>The closest answers are ' + across + '. <strong>The model can\'t tell which topic this question ' +
      'belongs to</strong>, which is when Ask picks the wrong answer. If one of them is the right answer, ' +
      'an <em>Also asked as</em> phrasing on it, in these words, will pull questions like this to it; ' +
      'if none is, it is a content gap.</p>';
  }

  /** The map's width or height, whichever is larger, in map units. */
  function extent() {
    var Y = built.layout.Y, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < Y.length / 2; i++) {
      x0 = Math.min(x0, Y[i * 2]); x1 = Math.max(x1, Y[i * 2]);
      y0 = Math.min(y0, Y[i * 2 + 1]); y1 = Math.max(y1, Y[i * 2 + 1]);
    }
    return Math.max(x1 - x0, y1 - y0) || 1;
  }

  global.ProbeMap = {
    html: html,
    attach: attach,
    lastReading: function () { return lastReading; },
    spot: function () { return spot; },          // for testing in a console
    pickSpot: function (x, y) { pickSpot(x, y); }
  };
}(window));
