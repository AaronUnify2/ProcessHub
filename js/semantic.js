/* ===========================================================================
   semantic.js — matching questions by meaning, with a small language model.

   The model (all-MiniLM-L6-v2, self-hosted under vendor/) reads a piece of
   text and returns a fingerprint: 384 numbers that place it by meaning. Two
   texts that mean the same thing get fingerprints pointing the same way, so
   "my neighbour's dog won't shut up" lands next to "My neighbour's dog barks
   constantly", even though they share almost no words.

   This file is the plumbing shared by anything that matches by meaning:

     - the model, run in a worker (semantic-worker.js), loaded on first use
     - fingerprints, kept by a hash of the exact text they were made from:
         · seeded from ask.html, which carries them for the published FAQ
         · anything else worked out here, and kept in IndexedDB, so each
           text is read once per browser until it changes
     - the scoring helpers: plain text, passages, keywords, a short glossary

   It is the same matching ask.html does, so the two agree; keep them in step.
   =========================================================================== */

(function (global) {
  'use strict';

  var MODEL = 'Xenova/all-MiniLM-L6-v2';

  // How confident a match has to be. Scores blend the model's similarity with
  // a keyword score (see score()), roughly 0 to 1. Same as ask.html.
  var STRONG = 0.55;   // it answers the question
  var WEAK = 0.38;     // below this, nothing really matches
  var BOOST = 0.03;    // the lift for an everyday ("common") question: a tie-breaker
  // A match on one of a question's other phrasings counts a little below a
  // match on the question itself. Without it, more phrasings meant more
  // wrong ways in: unanswerable questions started scoring as answered.
  var ALIAS_DISCOUNT = 0.05;

  // ---- text ----------------------------------------------------------------

  // HTML to plain text, using the browser's own parser. Block elements get a
  // space after them, so words either side of a tag don't run together.
  // Must match ask.html exactly: fingerprints are keyed by the text it makes.
  function plain(html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    doc.querySelectorAll('td, th, li, p, div, br').forEach(function (el) {
      el.insertAdjacentText('afterend', ' ');
    });
    return doc.body.textContent.replace(/\s+/g, ' ').trim();
  }

  // Long answers are read in short passages, so one sentence deep in an
  // answer ("rentals, holiday houses, second homes") can still be found.
  function chunk(text) {
    var sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    var out = [], cur = '';
    sentences.forEach(function (s) {
      if (cur && (cur + s).length > 380) { out.push(cur.trim()); cur = ''; }
      cur += s;
    });
    if (cur.trim()) out.push(cur.trim());
    return out.slice(0, 16);
  }

  // A 53-bit string hash (cyrb53): the key a fingerprint is kept under.
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // ---- keywords ------------------------------------------------------------
  // The model knows general English, not Council's terms (NPPR, Form 16,
  // 1080). A light keyword score sits alongside it so exact terms still count.

  var STOP = {};
  ('a an and are as at be by can could do does for from had has have how i if in into is it its ' +
    'me my of on or our should so that the their them then there these they this to was we what when where ' +
    'which who why will with would you your yours am get got im ive dont cant about any some need want ' +
    'tell know please just much many also there').split(' ').forEach(function (w) { STOP[w] = true; });

  // Everyday words people type, and the words the FAQ uses for the same
  // thing. A match adds the FAQ's words to the question before it is
  // searched, so "where's the tip" finds the waste facilities.
  var GLOSSARY = [
    [/\b(the )?tip\b|\bdump\b|\btransfer station\b/i, 'waste facility'],
    [/\b(fridges?|freezers?|washing machines?|dryers?|dishwashers?|ovens?|stoves?)\b/i, 'whitegoods'],
    [/\bchooks?\b/i, 'chickens poultry livestock'],
    [/\brego\b/i, 'registration'],
    [/\b(holiday (house|home)|investment property|second home|rental property|beach house|weekender)\b/i,
      'NPPR non-principal place of residence rate category'],
    [/\bgranny flat\b/i, 'secondary dwelling'],
    [/\b(wheelie )?bins? (day|night)\b|\brubbish day\b/i, 'bin collection day'],
    [/\bin town\b|\bhouse block\b|\bsuburb/i, 'urban'],
    [/\b(farm|acreage|property out of town)\b/i, 'rural']
  ];

  function expand(question) {
    var extra = [];
    GLOSSARY.forEach(function (g) { if (g[0].test(question)) extra.push(g[1]); });
    return extra.length ? question + ' (' + extra.join('; ') + ')' : question;
  }

  function stem(w) {
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /** The distinct, stemmed content words in a text, as a set. */
  function terms(text) {
    var out = {};
    (String(text).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || []).forEach(function (w) {
      if (!STOP[w] && w.length > 1) out[stem(w)] = true;
    });
    return out;
  }

  /**
   * How much of the question's wording appears in an item, weighted so rare
   * words count for more. idf maps a term to its weight; titleTerms count in
   * full, bodyTerms (optional) count half.
   */
  function keywordScore(qTerms, idf, maxIdf, titleTerms, bodyTerms) {
    var total = 0, hit = 0;
    Object.keys(qTerms).forEach(function (t) {
      var w = idf[t] || maxIdf;
      total += w;
      if (titleTerms[t]) hit += w;
      else if (bodyTerms && bodyTerms[t]) hit += w * 0.5;
    });
    return total ? hit / total : 0;
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // ---- packing fingerprints ------------------------------------------------
  // Stored, each of the 384 numbers is squeezed into one byte (-127 to 127)
  // and the lot written as base64: about 0.5 KB each. Unpacked, it is scaled
  // back to length 1, which is all the matching needs.

  function pack(vec) {
    var max = 0;
    for (var i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]));
    var bytes = new Int8Array(vec.length);
    for (var j = 0; j < vec.length; j++) bytes[j] = Math.round(vec[j] / (max || 1) * 127);
    var s = '';
    var u = new Uint8Array(bytes.buffer);
    for (var k = 0; k < u.length; k++) s += String.fromCharCode(u[k]);
    return btoa(s);
  }

  function unpack(b64) {
    var s = atob(b64);
    var vec = new Float32Array(s.length);
    var len = 0;
    for (var i = 0; i < s.length; i++) {
      var b = s.charCodeAt(i);
      vec[i] = b > 127 ? b - 256 : b;
      len += vec[i] * vec[i];
    }
    len = Math.sqrt(len) || 1;
    for (var j = 0; j < vec.length; j++) vec[j] /= len;
    return vec;
  }

  // ---- the fingerprint store -----------------------------------------------

  var seeded = {};     // key -> packed, from ask.html
  var computed = {};   // key -> Float32Array, worked out in this browser
  var unpacked = {};   // key -> Float32Array, seeds unpacked on first use

  function lookup(key) {
    if (computed[key]) return computed[key];
    if (unpacked[key]) return unpacked[key];
    if (seeded[key]) return (unpacked[key] = unpack(seeded[key]));
    return null;
  }

  /**
   * ask.html carries fingerprints for every published FAQ question and
   * passage. Reading them saves this browser from working those out itself;
   * if the page can't be read, everything is simply worked out here instead.
   */
  function loadSeeds() {
    return fetch('ask.html', { cache: 'no-cache' }).then(function (res) {
      return res.ok ? res.text() : '';
    }).then(function (html) {
      var m = html.match(/<script type="application\/json" id="fingerprints">([\s\S]*?)<\/script>/);
      if (!m) return;
      var block = JSON.parse(m[1]);
      if (block.model === MODEL && block.items) seeded = block.items;
    }).catch(function (err) {
      console.warn('Fingerprints from ask.html unavailable:', err);
    });
  }

  // Fingerprints worked out here are kept in their own IndexedDB database,
  // apart from the draft: losing them costs only the time to redo them.
  var DB_NAME = 'processhub-vectors';
  var STORE = 'vectors';
  var RECORD = 'computed';

  function openDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function loadComputed() {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
      });
    }).then(function (saved) {
      if (saved && saved.model === MODEL && saved.items) {
        Object.keys(saved.items).forEach(function (k) { computed[k] = unpack(saved.items[k]); });
      }
    }).catch(function (err) {
      console.warn('Saved fingerprints unavailable:', err);
    });
  }

  /**
   * Keep what this browser worked out, but only what is still in use (keys),
   * and nothing ask.html already carries.
   */
  function saveComputed(keys) {
    var items = {};
    keys.forEach(function (k) {
      if (computed[k] && !seeded[k]) items[k] = pack(computed[k]);
    });
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ model: MODEL, items: items }, RECORD);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }).catch(function () { /* a cache: nothing is lost but time */ });
  }

  // ---- the model -----------------------------------------------------------

  var worker = null;
  var pending = {};
  var nextId = 1;
  var started = null;
  var onProgress = function () {};

  function send(msg) {
    return new Promise(function (resolve, reject) {
      msg.id = nextId++;
      pending[msg.id] = { resolve: resolve, reject: reject };
      worker.postMessage(msg);
    });
  }

  /**
   * Load the model (once) and the saved fingerprints. Resolves when ready.
   * progress(text) is told what is happening, for a status line.
   */
  function start(progress) {
    if (progress) onProgress = progress;
    if (started) return started;
    started = Promise.all([loadSeeds(), loadComputed()]).then(function () {
      onProgress('Loading the language model…');
      worker = new Worker('js/semantic-worker.js', { type: 'module' });
      worker.onmessage = function (ev) {
        var msg = ev.data;
        if (msg.type === 'progress') {
          if (msg.status === 'progress' && /onnx$/.test(msg.file)) {
            onProgress('Loading the language model… ' + Math.round(msg.progress) + '%');
          }
          return;
        }
        var p = pending[msg.id];
        delete pending[msg.id];
        if (p) { if (msg.ok) p.resolve(msg); else p.reject(new Error(msg.error)); }
      };
      worker.onerror = function (ev) {
        var err = new Error(ev.message || 'The language model could not start');
        Object.keys(pending).forEach(function (id) { pending[id].reject(err); delete pending[id]; });
      };
      return send({ type: 'load' });
    });
    started.catch(function () { started = null; });
    return started;
  }

  // The model runs one job at a time. Calls queue up here, so a question
  // typed while passages are being read waits for one small batch at most.
  var queue = Promise.resolve();

  function embed(texts) {
    var job = queue.then(function () {
      return send({ type: 'embed', texts: texts });
    }).then(function (out) {
      var dim = out.dims[out.dims.length - 1];
      var vecs = [];
      for (var i = 0; i < texts.length; i++) vecs.push(out.data.slice(i * dim, (i + 1) * dim));
      return vecs;
    });
    queue = job.catch(function () {});
    return job;
  }

  /**
   * Make sure every job ({ key, text }) has a fingerprint, reading the ones
   * that are missing in batches. progress(done, total) after each batch.
   */
  function ensure(jobs, batch, progress) {
    var missing = jobs.filter(function (j) { return !lookup(j.key); });
    var seen = {};
    missing = missing.filter(function (j) { return seen[j.key] ? false : (seen[j.key] = true); });
    var done = 0;
    var step = function (i) {
      if (i >= missing.length) return Promise.resolve(missing.length);
      var slice = missing.slice(i, i + batch);
      return embed(slice.map(function (j) { return j.text; })).then(function (vecs) {
        slice.forEach(function (j, n) { computed[j.key] = vecs[n]; });
        done += slice.length;
        if (progress) progress(done, missing.length);
        return step(i + batch);
      });
    };
    return step(0);
  }

  /** The fingerprint of one text, worked out now if it isn't known. */
  function vectorOf(text) {
    var key = hash(text);
    var known = lookup(key);
    if (known) return Promise.resolve(known);
    return embed([text]).then(function (vecs) { return vecs[0]; });
  }

  global.Semantic = {
    MODEL: MODEL,
    STRONG: STRONG,
    WEAK: WEAK,
    BOOST: BOOST,
    ALIAS_DISCOUNT: ALIAS_DISCOUNT,
    plain: plain,
    chunk: chunk,
    hash: hash,
    terms: terms,
    expand: expand,
    keywordScore: keywordScore,
    dot: dot,
    pack: pack,
    unpack: unpack,
    start: start,
    ensure: ensure,
    lookup: lookup,
    vectorOf: vectorOf,
    saveComputed: saveComputed
  };
}(window));
