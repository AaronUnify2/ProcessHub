/* ===========================================================================
   ask-engine.js — match a question typed in plain words to the published FAQ.

   Used by faq-ask.html. The matching is ask.html's, unchanged: a small
   sentence-embedding model (all-MiniLM-L6-v2, in js/ask-worker.js) reads the
   question, and each FAQ is scored on its question, its other phrasings, its
   best answer passage and the words they share. It never writes an answer: it
   only ranks the published ones.

   The fingerprints (the model's reading of every published question and
   passage) are read from the block inside ask.html, so there is one copy to
   refresh. Anything published since then is read once in this browser and
   kept in localStorage under the same key ask.html uses.

   Usage:
     var engine = AskEngine.create({ onStatus: function (text, state) {} });
     engine.start(faqJson);              // the parsed exports/FAQ.json
     engine.search('my bin was missed')  // resolves to [{ faq, score }], best first
     engine.ready                        // true once search answers by meaning

   Each result's faq carries tabId and itemIndex (its place in the tab's items
   in FAQ.json), so the page can find its own copy of the question.
   =========================================================================== */

(function (global) {
  'use strict';

  var MODEL = 'Xenova/all-MiniLM-L6-v2';
  var EXTRA_KEY = 'processhub.ask.extra';   // shared with ask.html

  // How confident a match has to be: cosine similarities blended with a
  // keyword score, roughly 0 to 1. The same values as ask.html.
  var STRONG = 0.55;
  var WEAK = 0.38;
  var BOOST = 0.03;
  var ALIAS_DISCOUNT = 0.05;

  // ---- utilities -----------------------------------------------------------

  // HTML to plain text, as ask.html makes it (the fingerprints are keyed by it).
  function plain(html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    doc.querySelectorAll('td, th, li, p, div, br').forEach(function (el) {
      el.insertAdjacentText('afterend', ' ');
    });
    return doc.body.textContent.replace(/\s+/g, ' ').trim();
  }

  // A 53-bit string hash (cyrb53), used to key fingerprints by their text.
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

  // Fingerprints are stored one byte per number, as base64.
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

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // ---- keyword score -------------------------------------------------------
  // The model knows general English, not Council's terms (NPPR, Form 16).
  // A light keyword score sits alongside it so exact terms still count.

  var STOPSET = {};
  ('a an and are as at be by can could do does for from had has have how i if in into is it its ' +
    'me my of on or our should so that the their them then there these they this to was we what when where ' +
    'which who why will with would you your yours am get got im ive dont cant about any some need want ' +
    'tell know please just much many also there').split(' ').forEach(function (w) { STOPSET[w] = true; });

  // Everyday words, and the words the FAQ uses for the same thing.
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

  function terms(text) {
    var out = {};
    (text.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || []).forEach(function (w) {
      if (!STOPSET[w] && w.length > 1) out[stem(w)] = true;
    });
    return out;
  }

  // ---- what the model reads ------------------------------------------------

  // Long answers are read in short passages.
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

  function questionText(f) { return f.tabLabel + (f.group ? ' — ' + f.group : '') + ': ' + f.q; }
  function chunkText(f, c) { return f.q + ' ' + c; }

  // ---- an engine -----------------------------------------------------------

  function create(options) {
    options = options || {};
    var onStatus = options.onStatus || function () {};

    var self = {
      faqs: [],
      ready: false,      // search answers by meaning
      complete: false,   // every passage has a fingerprint too
      failed: null
    };
    var idf = {}, maxIdf = 1;
    var baked = {}, extra = {}, aliases = {}, boost = {};
    var worker = null, pending = {}, nextId = 1, queue = Promise.resolve();
    var markReady, markFailed;
    self.whenReady = new Promise(function (resolve, reject) { markReady = resolve; markFailed = reject; });
    self.whenReady.catch(function () {});

    function lookup(key) { return baked[key] || extra[key] || null; }

    function buildFaqs(data) {
      var faqs = [];
      (data.tabs || []).forEach(function (tab) {
        var group = '';
        (tab.items || []).forEach(function (item, itemIndex) {
          if (item.type === 'group') { group = plain(item.title); return; }
          if (item.type !== 'faq') return;
          var q = plain(item.q);
          var text = plain(item.a);
          var f = {
            tabId: tab.id, itemIndex: itemIndex, tabLabel: plain(tab.label), group: group,
            q: q, text: text, chunks: chunk(text),
            terms: terms(q + ' ' + group + ' ' + tab.label + ' ' + text),
            qTerms: terms(q)
          };
          f.qKey = hash(questionText(f));
          f.cKeys = f.chunks.map(function (c) { return hash(chunkText(f, c)); });
          faqs.push(f);
        });
      });
      var df = {};
      faqs.forEach(function (f) { Object.keys(f.terms).forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });
      maxIdf = Math.log(faqs.length + 1);
      Object.keys(df).forEach(function (t) { idf[t] = Math.log((faqs.length + 1) / df[t]); });
      self.faqs = faqs;
    }

    // The fingerprints block lives in ask.html; read it from there.
    async function loadFingerprints() {
      try {
        var res = await fetch('ask.html', { cache: 'no-cache' });
        var html = res.ok ? await res.text() : '';
        var m = html.match(/<script type="application\/json" id="fingerprints">([\s\S]*?)<\/script>/);
        if (m) {
          var block = JSON.parse(m[1]);
          if (block.model === MODEL && block.items) {
            Object.keys(block.items).forEach(function (k) { baked[k] = unpack(block.items[k]); });
            aliases = block.aliases || {};
            (block.boost || []).forEach(function (k) { boost[k] = true; });
          }
        }
      } catch (err) {
        console.warn('Fingerprints from ask.html unavailable:', err);
      }
      try {
        var saved = JSON.parse(localStorage.getItem(EXTRA_KEY) || 'null');
        if (saved && saved.model === MODEL && saved.items) {
          Object.keys(saved.items).forEach(function (k) { extra[k] = unpack(saved.items[k]); });
        }
      } catch (err) { /* storage blocked: anything missing is worked out again */ }
    }

    function saveExtra() {
      try {
        var items = {};
        self.faqs.forEach(function (f) {
          [f.qKey].concat(f.cKeys).forEach(function (k) {
            if (extra[k] && !baked[k]) items[k] = pack(extra[k]);
          });
        });
        if (Object.keys(items).length) localStorage.setItem(EXTRA_KEY, JSON.stringify({ model: MODEL, items: items }));
        else localStorage.removeItem(EXTRA_KEY);
      } catch (err) { /* storage full or blocked: worked out again next time */ }
    }

    function attachFingerprints() {
      var questions = [], passages = [];
      self.faqs.forEach(function (f) {
        f.qVec = lookup(f.qKey);
        if (!f.qVec) questions.push({ key: f.qKey, text: questionText(f), faq: f });
        f.aliasVecs = (aliases[f.qKey] || []).map(lookup).filter(Boolean);
        f.common = !!boost[f.qKey];
        f.cVecs = [];
        f.cKeys.forEach(function (k, i) {
          var v = lookup(k);
          if (v) f.cVecs.push(v);
          else passages.push({ key: k, text: chunkText(f, f.chunks[i]), faq: f });
        });
      });
      return { questions: questions, passages: passages };
    }

    // ---- the worker ----

    function startWorker() {
      worker = new Worker(new URL('js/ask-worker.js', location.href), { type: 'module' });
      worker.onmessage = function (ev) {
        var msg = ev.data;
        if (msg.type === 'progress') {
          if (msg.status === 'progress' && /onnx$/.test(msg.file)) {
            onStatus('Loading the language model… ' + Math.round(msg.progress) + '%', 'loading');
          }
          return;
        }
        var p = pending[msg.id];
        delete pending[msg.id];
        if (p) msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error));
      };
      worker.onerror = function (ev) {
        var err = new Error(ev.message || 'The model could not start');
        Object.keys(pending).forEach(function (id) { pending[id].reject(err); delete pending[id]; });
      };
    }

    function send(msg) {
      return new Promise(function (resolve, reject) {
        msg.id = nextId++;
        pending[msg.id] = { resolve: resolve, reject: reject };
        worker.postMessage(msg);
      });
    }

    // One job at a time; a question waits for one small batch at most.
    function embed(texts) {
      var job = queue.then(async function () {
        var out = await send({ type: 'embed', texts: texts });
        var dim = out.dims[out.dims.length - 1];
        var vecs = [];
        for (var i = 0; i < texts.length; i++) vecs.push(out.data.slice(i * dim, (i + 1) * dim));
        return vecs;
      });
      queue = job.catch(function () {});
      return job;
    }

    async function readMissing(jobs, batch, label, state, put) {
      for (var i = 0; i < jobs.length; i += batch) {
        var slice = jobs.slice(i, i + batch);
        var vecs = await embed(slice.map(function (j) { return j.text; }));
        slice.forEach(function (j, n) { extra[j.key] = vecs[n]; put(j, vecs[n]); });
        onStatus(label + ' ' + Math.round(Math.min(i + batch, jobs.length) / jobs.length * 100) + '%', state);
      }
    }

    // ---- matching ----

    function keywordScore(qTerms, f) {
      var total = 0, hit = 0;
      Object.keys(qTerms).forEach(function (t) {
        var w = idf[t] || maxIdf;
        total += w;
        if (f.qTerms[t]) hit += w;
        else if (f.terms[t]) hit += w * 0.5;
      });
      return total ? hit / total : 0;
    }

    // A phrasing is also compared with the question exactly as typed, before the
    // glossary adds its words: "chooks in town" reads closer to the phrasing "How
    // many Chooks in Town?" than "chooks in town (chickens poultry livestock;
    // urban)" does. The better of the two counts.
    function score(f, qVec, qTerms, typedVec) {
      var sq = dot(qVec, f.qVec);
      var also = 0;
      f.aliasVecs.forEach(function (v) {
        var near = typedVec ? Math.max(dot(qVec, v), dot(typedVec, v)) : dot(qVec, v);
        also = Math.max(also, near - ALIAS_DISCOUNT);
      });
      var sa = 0;
      f.cVecs.forEach(function (v) { sa = Math.max(sa, dot(qVec, v)); });
      var sqAll = Math.max(sq, also);
      var sem = Math.max(sqAll, 0.5 * sqAll + 0.5 * sa);
      return 0.8 * sem + 0.2 * keywordScore(qTerms, f) + (f.common ? BOOST : 0);
    }

    self.search = async function (question, limit) {
      await self.whenReady;
      var asked = expand(question);
      var vecs = await embed(asked === question ? [asked] : [asked, question]);
      var vec = vecs[0], typed = vecs[1] || null;
      var qTerms = terms(asked);
      return self.faqs
        .map(function (f) { return { faq: f, score: score(f, vec, qTerms, typed) }; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, limit || 10);
    };

    self.start = async function (data) {
      try {
        onStatus('Getting the language model ready…', 'loading');
        buildFaqs(data);
        await loadFingerprints();
        var todo = attachFingerprints();
        self.missing = { questions: todo.questions.length, passages: todo.passages.length };

        onStatus('Loading the language model (about 23 MB, first time only)…', 'loading');
        startWorker();
        await send({ type: 'load', model: MODEL, base: new URL('.', location.href).href });

        await readMissing(todo.questions, 32, 'Reading new FAQ questions…', 'loading',
          function (j, v) { j.faq.qVec = v; });
        self.ready = true;
        markReady();
        onStatus('Ready · matching by meaning', 'ready');

        if (todo.passages.length) {
          await readMissing(todo.passages, 8, 'Ready · reading ' + todo.passages.length + ' new passages…', 'ready',
            function (j, v) { j.faq.cVecs.push(v); });
          onStatus('Ready · matching by meaning', 'ready');
        }
        if (todo.questions.length || todo.passages.length) saveExtra();
        self.complete = true;
      } catch (err) {
        console.error(err);
        self.failed = err;
        markFailed(err);
        onStatus('The language model could not start on this device, so the box matches words instead.', 'error');
      }
    };

    return self;
  }

  // terms() is shared so a page can match words while the model loads.
  global.AskEngine = { create: create, terms: terms, STRONG: STRONG, WEAK: WEAK, MODEL: MODEL };
})(window);
