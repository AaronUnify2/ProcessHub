/* ===========================================================================
   spot-hint.js — "what question would go here?" for a spot on the meaning map.

   The language model only reads: it turns text into a fingerprint and cannot
   write any. So a hint for a spot is made in three steps:

     1. the spot's fingerprint is estimated from the answers around it
        (MeaningMap.spotVector)
     2. candidate questions are written from the phrases those answers use
        most and the rest of the FAQ uses least, set into everyday question
        shapes ("Do I need approval for …?", "Who do I contact about …?")
     3. the model reads every candidate, and the ones whose fingerprints point
        closest to the spot's are offered

   The wording is only ever built from the FAQ's own phrases, so it reads
   stiffly; a curiosity for map.html, not finished questions.

   SpotHint.suggest({ vec, near, corpus, embed, questionVec }) resolves to
     [{ text, fit, nearest: { item, s } | null }]  best first
   =========================================================================== */

(function (global) {
  'use strict';

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  var TEMPLATES = [
    'Do I need approval for {p}?',
    'What are the rules for {p}?',
    'Who do I contact about {p}?',
    'How do I report {p}?',
    'Is there a fee for {p}?',
    'Who is responsible for {p}?',
    'What can I do about {p}?',
    'Where can I find out about {p}?'
  ];
  var PAIR_TEMPLATES = [
    'What are the rules for {a} and {b}?'
  ];
  var PHRASES = 10;     // phrases taken from the answers around the spot
  var HINTS = 3;        // hints offered
  var ASKED = 0.85;     // a hint this close to an existing question is little news…
  var ASKED_PENALTY = 0.1;   // …so it ranks this much lower

  // Words that never start or end a phrase, and never stand alone.
  var STOP = {};
  ('a an and are as at be been by can could do does did for from had has have how i if in into is it its ' +
    'me my of on or our should so that the their them then there these they this those to was we were what ' +
    'when where which who why will with would you your yours am get got im ive dont cant about any some ' +
    'need needs want tell know please just much many also more most other than not no yes may must might ' +
    'only same such very each every all both own out up over under after before between while during ' +
    'within without per via etc eg ie make made use used using one two three first see call contact ' +
    'council councils sdrc qld information details usually generally typically new apply applies').split(' ')
    .forEach(function (w) { STOP[w] = true; });

  /**
   * The phrases in a text: runs of one to three words, none of them a stop
   * word — except "of" in the middle ("change of use").
   */
  function phrases(text) {
    var out = {};
    String(text).toLowerCase().replace(/[’']/g, '').split(/[.,;:!?()\[\]"“”—–\/]+| - /).forEach(function (part) {
      var words = part.match(/[a-z][a-z0-9-]*/g) || [];
      for (var i = 0; i < words.length; i++) {
        for (var len = 1; len <= 3 && i + len <= words.length; len++) {
          var run = words.slice(i, i + len);
          var ok = run.every(function (w, k) {
            if (w === 'of') return k > 0 && k < run.length - 1;
            return !STOP[w] && w.length > 1;
          });
          if (!ok || (len === 1 && run[0].length < 4)) continue;
          out[run.join(' ')] = true;
        }
      }
    });
    return out;
  }

  /** A phrase's words, singular, so "cemetery" and "cemeteries" count as one. */
  function sameKey(p) {
    return p.split(' ').map(function (w) {
      if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
      return w;
    }).join(' ');
  }

  // How many FAQ answers use each phrase, worked out once per version of the FAQ.
  var dfFor = null, df = {};
  function documentFrequency(corpus) {
    if (dfFor === corpus) return df;
    df = {};
    corpus.forEach(function (f) {
      Object.keys(phrases(f.q + '. ' + f.text)).forEach(function (p) { df[p] = (df[p] || 0) + 1; });
    });
    dfFor = corpus;
    return df;
  }

  /** The phrases that best describe the answers around the spot, best first. */
  function topPhrases(near, corpus) {
    var counts = documentFrequency(corpus);
    var n = corpus.length;
    var score = {};
    near.forEach(function (m) {
      var inQ = phrases(m.item.q);
      var inA = phrases(m.item.text.slice(0, 700));
      Object.keys(inA).concat(Object.keys(inQ)).forEach(function (p) {
        score[p] = (score[p] || 0) + m.w * (inQ[p] ? 2 : 1);
      });
    });
    var ranked = Object.keys(score).map(function (p) {
      var len = p.split(' ').length;
      return { p: p, s: score[p] * Math.log((n + 1) / ((counts[p] || 0) + 1)) * (1 + 0.35 * (len - 1)) };
    }).sort(function (a, b) { return b.s - a.s; });

    // Leave out a phrase inside one already chosen ("dog" once "barking dog"
    // is in), and the plural of one already chosen.
    var chosen = [];
    ranked.forEach(function (r) {
      if (chosen.length >= PHRASES) return;
      var key = sameKey(r.p);
      var inside = chosen.some(function (c) {
        var ck = sameKey(c);
        return (' ' + ck + ' ').indexOf(' ' + key + ' ') >= 0 || (' ' + key + ' ').indexOf(' ' + ck + ' ') >= 0;
      });
      if (!inside) chosen.push(r.p);
    });
    return chosen;
  }

  function fill(template, values) {
    return template.replace(/\{(\w)\}/g, function (all, k) { return values[k]; });
  }

  /**
   * Hints for a spot. options:
   *   vec          the spot's estimated fingerprint
   *   near         [{ item, w }] the answers around it, heaviest first
   *   corpus       every FAQ entry; each has q (the question) and text (the answer, plain)
   *   embed        function (texts) → a promise of their fingerprints, unit length
   *   questionVec  function (item) → the fingerprint of an entry's question
   */
  function suggest(options) {
    var picked = topPhrases(options.near.slice(0, 5), options.corpus);
    var texts = [];
    picked.forEach(function (p) {
      TEMPLATES.forEach(function (t) { texts.push({ text: fill(t, { p: p }), phrase: p, template: t }); });
    });
    for (var a = 0; a < Math.min(3, picked.length); a++) {
      for (var b = a + 1; b < Math.min(3, picked.length); b++) {
        PAIR_TEMPLATES.forEach(function (t) {
          texts.push({ text: fill(t, { a: picked[a], b: picked[b] }), phrase: picked[a] + '|' + picked[b], template: t });
        });
      }
    }
    if (!texts.length) return Promise.resolve([]);

    return options.embed(texts.map(function (c) { return c.text; })).then(function (vecs) {
      var questions = options.corpus.map(function (f) { return { item: f, vec: options.questionVec(f) }; })
        .filter(function (q) { return q.vec; });
      texts.forEach(function (c, i) {
        var v = vecs[i];
        c.vec = v;
        c.fit = v ? dot(options.vec, v) : -1;
        // How close it comes to a question the FAQ already has; one that is
        // nearly an existing question ranks a little lower.
        c.nearest = null;
        if (v) {
          questions.forEach(function (q) {
            var s = dot(v, q.vec);
            if (!c.nearest || s > c.nearest.s) c.nearest = { item: q.item, s: s };
          });
        }
        c.rank = c.fit - (c.nearest && c.nearest.s >= ASKED ? ASKED_PENALTY : 0);
      });
      texts.sort(function (x, y) { return y.rank - x.rank; });

      // The best few, each about a different phrase and in a different shape.
      var out = [], used = {}, shapes = {};
      texts.forEach(function (c) {
        if (out.length >= HINTS || !c.vec || shapes[c.template]) return;
        var parts = c.phrase.split('|');
        if (parts.some(function (p) { return used[p]; })) return;
        parts.forEach(function (p) { used[p] = true; });
        shapes[c.template] = true;
        out.push(c);
      });
      return out.map(function (c) {
        return { text: c.text.charAt(0).toUpperCase() + c.text.slice(1), fit: c.fit, nearest: c.nearest };
      });
    });
  }

  global.SpotHint = { suggest: suggest, phrases: phrases };
}(window));
