/* ===========================================================================
   probe.js — does the FAQ answer this question? The matching behind Probe.

   Probe takes a question typed the way a customer would ask it and ranks
   every FAQ answer in the working draft by how well it answers it, using the
   language model in semantic.js. It also ranks the open content gaps — the
   questions someone has already probed, found unanswered and logged — so a
   gap that is already known turns up instead of being logged twice.

   Everything comes from the draft as it stands, published or not; the page
   decides what to show. The index is rebuilt whenever the content changes,
   and only text that is new or edited needs the model to read it.

   Two things on an FAQ question steer the matching (both edited on its page,
   never published as text):
     alsoAsked  other ways people ask it. Each is matched like the question
                itself, and the best of them counts, a little discounted
                (Semantic.ALIAS_DISCOUNT).
     common     an everyday question. It gets a small lift (Semantic.BOOST),
                enough to win when several answers match about equally.

   ask.html matches the same way. Probe.exportFingerprints() makes the
   block of fingerprints it carries, phrasings and lifts included.
   =========================================================================== */

(function (global) {
  'use strict';

  var S = global.Semantic;

  var corpus = null;
  var status = { state: 'idle', text: '' };
  var listeners = [];
  var passagesRunning = null;

  // ---- status, for the page to show ---------------------------------------

  function setStatus(state, text) {
    status = { state: state, text: text || '' };
    listeners.forEach(function (fn) { fn(status); });
  }

  function onStatus(fn) { listeners.push(fn); }

  // ---- the index -----------------------------------------------------------

  /**
   * Every FAQ question and open-or-resolved content gap, ready to score.
   * A question on the public page is read with its tab and section around
   * it, exactly as ask.html reads it, so the fingerprints ask.html carries
   * fit it; one that isn't public is read as the question alone.
   */
  function build() {
    var index = Data.state.index;
    if (corpus && corpus.source === index) return corpus;

    var lib = Data.state.library;
    var tabLabel = {};
    lib.publishTabs.forEach(function (t) { tabLabel[t.id] = S.plain(t.label); });

    // The section heading each public question sits under, worked out the
    // way the FAQ export does: a heading carries on until the next one.
    var groupOf = {};
    var byTab = {};
    lib.faqs.forEach(function (f) {
      var tab = f.publish && f.publish.tabId;
      if (!f.internal && tab && tabLabel[tab] !== undefined) (byTab[tab] = byTab[tab] || []).push(f);
    });
    Object.keys(byTab).forEach(function (tab) {
      var group = null;
      byTab[tab].slice().sort(function (a, b) {
        return (a.publish.order || 0) - (b.publish.order || 0);
      }).forEach(function (f) {
        if (f.publish.groupTitle && f.publish.groupTitle !== group) group = f.publish.groupTitle;
        groupOf[f.id] = group;
      });
    });

    var faqs = lib.faqs.map(function (f) {
      var tab = f.publish && f.publish.tabId;
      var isPublic = !f.internal && !!tab && tabLabel[tab] !== undefined;
      var q = S.plain(f.q);
      var text = S.plain(f.a);
      var group = isPublic && groupOf[f.id] ? S.plain(groupOf[f.id]) : '';
      var qText = isPublic ? tabLabel[tab] + (group ? ' — ' + group : '') + ': ' + q : q;
      var chunks = S.chunk(text);
      var also = alsoAsked(f);
      return {
        kind: 'faq',
        id: f.id,
        faq: f,
        isPublic: isPublic,
        tabLabel: tab && tabLabel[tab] !== undefined ? tabLabel[tab] : '',
        group: group,
        q: q,
        text: text,
        qText: qText,
        qKey: S.hash(qText),
        chunkTexts: chunks.map(function (c) { return q + ' ' + c; }),
        cKeys: chunks.map(function (c) { return S.hash(q + ' ' + c); }),
        alsoTexts: also,
        alsoKeys: also.map(S.hash),
        common: !!f.common,
        terms: S.terms(q + ' ' + group + ' ' + (tabLabel[tab] || '') + ' ' + text),
        qTerms: S.terms(q)
      };
    });

    var gaps = (lib.contentGaps || []).map(function (g) {
      var q = String(g.q || '').trim();
      return { kind: 'gap', id: g.id, gap: g, q: q, qText: q, qKey: S.hash(q), qTerms: S.terms(q) };
    }).filter(function (g) { return g.q; });

    // Inverse document frequency over the FAQ, for the keyword score.
    var df = {};
    faqs.forEach(function (f) { Object.keys(f.terms).forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });
    var idf = {};
    Object.keys(df).forEach(function (t) { idf[t] = Math.log((faqs.length + 1) / df[t]); });

    corpus = { source: index, faqs: faqs, gaps: gaps, idf: idf, maxIdf: Math.log(faqs.length + 1) };
    return corpus;
  }

  /** An FAQ question's other phrasings, tidied: trimmed, no blanks, no repeats. */
  function alsoAsked(f) {
    var seen = {};
    return (Array.isArray(f.alsoAsked) ? f.alsoAsked : []).map(function (s) {
      return String(s || '').replace(/\s+/g, ' ').trim();
    }).filter(function (s) {
      var key = s.toLowerCase();
      if (!s || seen[key]) return false;
      return (seen[key] = true);
    });
  }

  function questionJobs(c) {
    var jobs = c.faqs.concat(c.gaps).map(function (x) { return { key: x.qKey, text: x.qText }; });
    c.faqs.forEach(function (f) {
      f.alsoKeys.forEach(function (k, i) { jobs.push({ key: k, text: f.alsoTexts[i] }); });
    });
    return jobs;
  }

  function passageJobs(c) {
    var jobs = [];
    c.faqs.forEach(function (f) {
      f.cKeys.forEach(function (k, i) { jobs.push({ key: k, text: f.chunkTexts[i] }); });
    });
    return jobs;
  }

  function allKeys(c) {
    return questionJobs(c).concat(passageJobs(c)).map(function (j) { return j.key; });
  }

  /**
   * Load the model and read whatever questions have no fingerprint yet.
   * Resolves once questions can be matched; passages that are missing are
   * then read in the background, which sharpens the matches.
   */
  function prepare() {
    if (status.state === 'idle' || status.state === 'failed') setStatus('loading', 'Starting…');
    return S.start(function (text) { if (status.state !== 'ready') setStatus('loading', text); })
      .then(function () {
        var c = build();
        return S.ensure(questionJobs(c), 32, function (done, total) {
          setStatus('loading', 'Reading FAQ questions… ' + Math.round(done / total * 100) + '%');
        }).then(function (read) {
          if (status.state !== 'ready') setStatus('ready', 'Ready');
          readPassages(c);
          return c;
        });
      })
      .catch(function (err) {
        console.error(err);
        setStatus('failed', 'The language model could not start: ' + err.message);
        throw err;
      });
  }

  function readPassages(c) {
    if (passagesRunning) return passagesRunning;
    var jobs = passageJobs(c);
    passagesRunning = S.ensure(jobs, 8, function (done, total) {
      setStatus('ready', 'Ready · reading ' + total + ' answer passages… ' +
        Math.round(done / total * 100) + '%');
    }).then(function (read) {
      passagesRunning = null;
      if (read) {
        S.saveComputed(allKeys(build()));
        setStatus('ready', 'Ready');
      }
      // The content may have changed while that ran; catch up if so.
      if (build() !== c) return readPassages(build());
    }).catch(function (err) {
      passagesRunning = null;
      console.warn('Passages not read:', err);
    });
    return passagesRunning;
  }

  // ---- scoring -------------------------------------------------------------

  /**
   * How well an FAQ answer answers a question: the question (or the closest
   * of its other phrasings), the best passage of the answer, and the words
   * they share — plus the lift for an everyday question. Same as ask.html.
   */
  function scoreFaq(c, f, vec, qTerms) {
    var best = function (keys) {
      var top = 0;
      keys.forEach(function (k) {
        var v = S.lookup(k);
        if (v) top = Math.max(top, S.dot(vec, v));
      });
      return top;
    };
    var sq = best([f.qKey]);
    var also = f.alsoKeys.length ? best(f.alsoKeys) - S.ALIAS_DISCOUNT : 0;
    var sa = best(f.cKeys);
    var sqAll = Math.max(sq, also);
    var sem = Math.max(sqAll, 0.5 * sqAll + 0.5 * sa);
    var total = 0.8 * sem + 0.2 * S.keywordScore(qTerms, c.idf, c.maxIdf, f.qTerms, f.terms) +
      (f.common ? S.BOOST : 0);
    return { item: f, score: total, sq: sq, also: also, sa: sa };
  }

  function scoreGap(c, g, vec, qTerms) {
    var gv = S.lookup(g.qKey);
    var sq = gv ? S.dot(vec, gv) : 0;
    var total = 0.8 * sq + 0.2 * S.keywordScore(qTerms, c.idf, c.maxIdf, g.qTerms);
    return { item: g, score: total, sq: sq };
  }

  function band(score) {
    if (score >= S.STRONG) return 'strong';
    if (score >= S.WEAK) return 'weak';
    return 'none';
  }

  /**
   * Rank the FAQ and the open content gaps against a question.
   * Resolves to { faqs: [...], gaps: [...] }, best first; each entry is
   * { item, score }. Gaps that have been resolved are left out.
   */
  function search(question) {
    return prepare().then(function () {
      var c = build();
      // Questions added or edited since the index was last read.
      return S.ensure(questionJobs(c), 32).then(function () {
        readPassages(c);
        var asked = S.expand(question);
        return S.vectorOf(asked).then(function (vec) {
          var qTerms = S.terms(asked);
          return {
            faqs: c.faqs.map(function (f) { return scoreFaq(c, f, vec, qTerms); })
              .sort(function (a, b) { return b.score - a.score; }),
            gaps: c.gaps.filter(function (g) { return !g.gap.resolved; })
              .map(function (g) { return scoreGap(c, g, vec, qTerms); })
              .sort(function (a, b) { return b.score - a.score; })
          };
        });
      });
    });
  }

  /**
   * For each open content gap, the FAQ answer that now matches it best (and
   * the best three, which place it on the meaning map). A gap whose best
   * match is strong has probably been answered since it was logged. Only
   * meaningful once prepare() has resolved.
   */
  function gapChecks() {
    var c = build();
    return c.gaps.filter(function (g) { return !g.gap.resolved; }).map(function (g) {
      var vec = S.lookup(g.qKey);
      if (!vec) return { gap: g.gap, best: null, top: [] };
      var qTerms = S.terms(S.expand(g.q));
      var top = c.faqs.map(function (f) { return scoreFaq(c, f, vec, qTerms); })
        .sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
      return { gap: g.gap, best: top[0] || null, top: top };
    });
  }

  /**
   * Resolves once every question and every answer passage has a
   * fingerprint — what the meaning map needs to draw whole answers.
   */
  function whenRead() {
    return prepare().then(function () {
      return readPassages(build()) || null;
    }).then(function () { return build(); });
  }

  /**
   * The fingerprints block ask.html carries, for the public FAQ only: each
   * question and answer passage, plus each question's other phrasings and
   * which questions get the everyday lift. Run it with the published content
   * loaded (no local changes), then paste the result into ask.html's
   * fingerprints block. Resolves to the JSON text.
   */
  function exportFingerprints() {
    return prepare().then(function () {
      return readPassages(build()) || null;
    }).then(function () {
      var c = build();
      var items = {}, aliases = {}, boost = [];
      var put = function (key) {
        var v = S.lookup(key);
        if (v) items[key] = S.pack(v);
      };
      c.faqs.filter(function (f) { return f.isPublic; }).forEach(function (f) {
        put(f.qKey);
        f.cKeys.forEach(put);
        if (f.alsoKeys.length) {
          f.alsoKeys.forEach(put);
          aliases[f.qKey] = f.alsoKeys;
        }
        if (f.common) boost.push(f.qKey);
      });
      var lines = Object.keys(items).map(function (k) {
        return JSON.stringify(k) + ':' + JSON.stringify(items[k]);
      });
      return '{"model":' + JSON.stringify(S.MODEL) + ',"made":"' + Data.today() + '",' +
        '"aliases":' + JSON.stringify(aliases) + ',"boost":' + JSON.stringify(boost) +
        ',"items":{\n' + lines.join(',\n') + '\n}}';
    });
  }

  global.Probe = {
    exportFingerprints: exportFingerprints,
    prepare: prepare,
    search: search,
    gapChecks: gapChecks,
    whenRead: whenRead,
    band: band,
    onStatus: onStatus,
    status: function () { return status; },
    corpus: build
  };
}(window));
