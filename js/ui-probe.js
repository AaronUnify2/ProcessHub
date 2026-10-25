/* ===========================================================================
   ui-probe.js — the Probe section: is there an answer for this question?

   Type a question the way a customer would ask it. Probe ranks the FAQ
   answers in the draft by how well they answer it (probe.js does the
   matching) and says plainly whether the FAQ covers it:

     Answered       a strong match — the content is there
     Partly         related answers, but maybe not this question
     Not answered   nothing close

   A question that isn't answered can be logged as a content gap: an issue
   of its own kind, in the issues register with the rest. Open gaps are
   searched too, so asking a known-unanswered question again shows the gap
   that was logged for it, rather than inviting a second one. When an FAQ
   answer later covers a gap, Probe says so and offers to resolve it.

   Routes:  #/probe              the dashboard: open gaps, and which now look answered
            #/probe?q=<question> the results for a question
            #/probe?gap=<id>     a logged gap, probed again
   =========================================================================== */

(function (global) {
  'use strict';

  var host = null;
  var prefs = {};
  var onNavigate = function () {};

  // What is on screen. A redraw after an edit keeps the question, the open
  // form and what was just logged.
  var view = { query: '', gapId: '', result: null, logging: false, logged: null, run: 0 };

  var RECENT_MAX = 12;
  var SHOWN = 6;

  function e(text) { return Data.escapeHtml(text); }
  function pct(score) { return Math.max(0, Math.round(score * 100)) + '%'; }

  function init(options) {
    host = document.getElementById('detail');
    prefs = options.prefs || {};
    onNavigate = options.onNavigate || onNavigate;
    if (prefs.probeAll === undefined) prefs.probeAll = true;
    host.addEventListener('click', onClick);
    host.addEventListener('submit', onSubmit);
    host.addEventListener('change', onChange);
    Probe.onStatus(showStatus);
  }

  // ---- entry points --------------------------------------------------------

  /** Draw the Probe page. mode is 'q' (a question), 'gap' (a gap's question) or ''. */
  function render(mode, value) {
    var query = '';
    var gapId = '';
    if (mode === 'gap') {
      var gap = Data.state.index.gaps[value];
      gapId = value;
      query = gap ? gap.q : '';
    } else if (mode === 'q') {
      query = String(value || '').trim();
    }
    if (query !== view.query || gapId !== view.gapId) {
      view.logging = false;
      view.logged = null;
    }
    view.query = query;
    view.gapId = gapId;
    view.result = null;

    Detail.paint(page(query ? '<p class="empty probe-wait">Probing…</p>' : dashboardHtml(null)));

    var run = ++view.run;
    if (query) {
      remember(query);
      Probe.search(query).then(function (result) {
        if (run !== view.run) return;
        view.result = result;
        fill(resultsHtml());
      }).catch(function () {
        if (run === view.run) fill('<p class="empty">Probe could not run on this device.</p>');
      });
    } else {
      Probe.prepare().then(function () {
        if (run === view.run) fill(dashboardHtml(Probe.gapChecks()));
      }).catch(function () { /* the status line says why */ });
    }
  }

  function page(body) {
    return '<article class="pane probe">' +
      '<header class="pane-head"><h1>Probe</h1>' +
      '<p class="lede">Ask a question the way a customer would, and see whether the FAQ has an ' +
      'answer for it. Questions it can\'t answer can be logged as content gaps.</p>' +
      '<form class="probe-form" id="probeForm" autocomplete="off">' +
      '<input type="search" id="probeInput" value="' + e(view.query) + '" ' +
      'placeholder="e.g. can I keep chooks in town" aria-label="Question to probe" enterkeyhint="search">' +
      '<button class="btn primary" type="submit">Probe</button></form>' +
      '<div class="probe-opts">' +
      '<label><input type="checkbox" id="probeAll"' + (prefs.probeAll ? ' checked' : '') + '> ' +
      'Include questions not on the public page</label>' +
      '<span class="probe-status ' + e(Probe.status().state) + '" id="probeStatus">' +
      e(statusText(Probe.status())) + '</span></div>' +
      '</header><div id="probeBody">' + body + '</div></article>';
  }

  function fill(html) {
    var body = document.getElementById('probeBody');
    if (!body) return;
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll('[data-route]'), function (node) {
      node.addEventListener('click', function () { onNavigate(node.dataset.route); });
    });
  }

  function statusText(st) {
    if (st.state === 'idle') return 'The language model loads the first time you probe.';
    return st.text;
  }

  function showStatus(st) {
    var el = document.getElementById('probeStatus');
    if (!el) return;
    el.className = 'probe-status ' + st.state;
    el.textContent = statusText(st);
  }

  /** The last few questions probed, for the sidebar. A preference: losing it costs nothing. */
  function remember(query) {
    var list = (prefs.probeRecent || []).filter(function (q) { return q !== query; });
    list.unshift(query);
    prefs.probeRecent = list.slice(0, RECENT_MAX);
    Storage.savePrefs(prefs);
    if (global.Sidebar) Sidebar.render();
  }

  // ---- results -------------------------------------------------------------

  function visibleFaqs() {
    var list = view.result ? view.result.faqs : [];
    return prefs.probeAll ? list : list.filter(function (r) { return r.item.isPublic; });
  }

  function gapMatches() {
    var list = view.result ? view.result.gaps : [];
    return list.filter(function (r) {
      return r.score >= Semantic.STRONG || r.item.id === view.gapId;
    });
  }

  function resultsHtml() {
    var faqs = visibleFaqs();
    var best = faqs[0] || null;
    var verdict = best ? Probe.band(best.score) : 'none';
    var gaps = gapMatches();

    var html = verdictHtml(verdict, best);
    if (gaps.length) html += gapsHtml(gaps, verdict, best);
    html += logHtml(verdict, best, gaps);

    html += '<section class="block"><h2>Closest FAQ answers <span class="count">' +
      (prefs.probeAll ? 'all questions' : 'public page only') + '</span></h2>' +
      (faqs.length
        ? faqs.slice(0, SHOWN).map(hitHtml).join('')
        : '<p class="empty">No FAQ questions to compare with.</p>') +
      '</section>';
    return html;
  }

  function verdictHtml(verdict, best) {
    var words = {
      strong: ['✓ Answered', 'The FAQ has a strong match for this question.'],
      weak: ['~ Partly', 'The closest answers are related, but may not answer this question.'],
      none: ['✗ Not answered', 'Nothing in the FAQ comes close to answering this.']
    }[verdict];
    var unpublished = best && verdict === 'strong' && !best.item.isPublic
      ? ' The best match isn\'t on the public page yet.' : '';
    return '<section class="probe-verdict v-' + verdict + '"><strong>' + words[0] + '</strong>' +
      '<span>' + e(words[1] + unpublished) + '</span></section>';
  }

  function gapsHtml(gaps, verdict, best) {
    return '<section class="block probe-gaps"><h2>Already logged as a content gap</h2>' +
      gaps.map(function (r) {
        var g = r.item.gap;
        var answered = verdict === 'strong' && best;
        return '<div class="probe-gap sev-' + e(g.severity) + '">' +
          '<span class="probe-score" title="How closely it matches your question">' + pct(r.score) + '</span>' +
          '<div class="probe-gap-body">' + deleteButton(g) +
          '<a class="probe-q" href="#/issue/' + e(g.id) + '/' + e(g.id) + '">' + e(g.q) + '</a>' +
          '<span class="probe-where"><span class="sev">' + e(g.severity) + '</span> ' +
          e(gapMeta(g)) + '</span>' +
          (g.note ? '<p class="probe-snip">' + e(g.note) + '</p>' : '') +
          (answered
            ? '<p class="probe-answered">The FAQ now seems to answer this. ' +
              '<button class="btn small" data-probe="resolve" data-gap="' + e(g.id) + '" data-faq="' +
              e(best.item.id) + '">✓ Resolve — answered by “' + e(best.item.q) + '”</button></p>'
            : '') +
          '</div></div>';
      }).join('') + '</section>';
  }

  function gapMeta(g) {
    return [g.ownerId ? Data.taxonomyName(g.ownerId) : 'no department',
      'raised ' + (g.raised || '—') + (g.raisedBy ? ' by ' + g.raisedBy : '')].join(' · ');
  }

  function hitHtml(r) {
    var f = r.item;
    var band = Probe.band(r.score);
    var where = f.isPublic
      ? e(f.tabLabel) + (f.group ? ' › ' + e(f.group) : '')
      : (f.faq.internal ? 'Internal — not on the public page' : 'Not on the public page');
    var snip = f.text.length > 180 ? f.text.slice(0, 180).replace(/\s+\S*$/, '') + '…' : f.text;
    return '<div class="probe-hit band-' + band + '">' +
      '<span class="probe-score" title="How closely it matches">' + pct(r.score) + '</span>' +
      '<div class="probe-hit-body">' +
      '<a class="probe-q" href="#/faq/' + e(f.id) + '">' + e(f.q) + '</a>' +
      '<span class="probe-where">' + where +
      ' · <span class="badge status-' + e(f.faq.status) + '">' + e(f.faq.status || '—') + '</span></span>' +
      '<p class="probe-snip">' + e(snip) + '</p>' +
      '<details class="probe-answer"><summary>Show the answer</summary>' +
      '<div class="probe-answer-body">' + Data.freeze(f.faq.a) + '</div></details>' +
      '</div></div>';
  }

  // ---- logging a gap -------------------------------------------------------

  function logHtml(verdict, best, gaps) {
    if (view.logged) {
      var g = Data.state.index.gaps[view.logged];
      if (g) {
        return '<section class="probe-logged">✓ Logged as a content gap. ' +
          '<a href="#/issue/' + e(g.id) + '/' + e(g.id) + '">Open it in the issues register →</a></section>';
      }
    }
    if (view.logging) return formHtml(best);
    var lead = verdict !== 'strong' && !gaps.length;
    return '<div class="probe-log">' +
      '<button class="btn ' + (lead ? 'primary' : 'small') + '" data-probe="log">⚑ Log as a content gap</button>' +
      (lead ? '' : '<span class="hint">' + (gaps.length
        ? 'This looks like a gap already logged above.'
        : 'The FAQ seems to answer this, but you can log it if it doesn\'t.') + '</span>') +
      '</div>';
  }

  function formHtml(best) {
    var nearest = best ? best.item : null;
    var note = nearest
      ? 'No FAQ answer covers this. Nearest: “' + nearest.q + '” (' + pct(best.score) + ').'
      : 'No FAQ answer covers this.';
    var owner = nearest ? nearest.faq.ownerId || '' : '';
    var tab = nearest && nearest.isPublic ? nearest.faq.publish.tabId : '';

    var depts = Data.state.processes.taxonomy.map(function (n) {
      return { value: n.id, label: Data.taxonomyPath(n.id) };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    var tabs = Data.state.library.publishTabs.map(function (t) {
      return { value: t.id, label: Data.plainText(t.label) };
    });

    return '<section class="block probe-form-block"><h2>Log a content gap</h2>' +
      '<div class="probe-fields">' +
      field('The question', '<input type="text" id="pgQ" value="' + e(view.query) + '">') +
      field('Note', '<textarea id="pgNote" rows="3">' + e(note) + '</textarea>') +
      field('Department to answer it', select('pgOwner', depts, owner, 'Not decided yet')) +
      field('Tab it would belong on', select('pgTab', tabs, tab, 'Not decided yet')) +
      field('Severity', select('pgSeverity', [
        { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }
      ], 'medium')) +
      field('Raised by', '<input type="text" id="pgBy" value="' + e(prefs.raisedBy || '') + '">') +
      '</div><div class="row-actions">' +
      '<button class="btn primary small" data-probe="save">⚑ Log it</button>' +
      '<button class="btn small" data-probe="cancel">Cancel</button></div></section>';
  }

  function field(label, control) {
    return '<label class="probe-field"><span>' + e(label) + '</span>' + control + '</label>';
  }

  function select(id, choices, chosen, blank) {
    return '<select id="' + id + '">' +
      (blank !== undefined ? '<option value="">' + e(blank) + '</option>' : '') +
      choices.map(function (c) {
        return '<option value="' + e(c.value) + '"' + (c.value === chosen ? ' selected' : '') + '>' +
          e(c.label) + '</option>';
      }).join('') + '</select>';
  }

  function saveGap() {
    var q = document.getElementById('pgQ').value.trim();
    if (!q) { document.getElementById('pgQ').focus(); return; }
    var best = visibleFaqs()[0];
    var by = document.getElementById('pgBy').value.trim();
    var id = Edit.raiseGap({
      q: q,
      note: document.getElementById('pgNote').value,
      ownerId: document.getElementById('pgOwner').value,
      tabId: document.getElementById('pgTab').value,
      severity: document.getElementById('pgSeverity').value,
      nearest: best ? { faqId: best.item.id, score: best.score } : null,
      raisedBy: by
    });
    prefs.raisedBy = by;
    Storage.savePrefs(prefs);
    view.logging = false;
    view.logged = id;
    if (global.App) App.route();
  }

  // ---- the dashboard -------------------------------------------------------

  function dashboardHtml(checks) {
    var lib = Data.state.library;
    var gaps = lib.contentGaps || [];
    var open = gaps.filter(function (g) { return !g.resolved; });
    var resolved = gaps.filter(function (g) { return g.resolved; });
    var corpus = Probe.corpus();
    var publicCount = corpus.faqs.filter(function (f) { return f.isPublic; }).length;
    var byGap = {};
    (checks || []).forEach(function (c) { byGap[c.gap.id] = c; });
    var answered = (checks || []).filter(function (c) {
      return c.best && c.best.score >= Semantic.STRONG;
    }).length;

    var html = '<section class="tiles">' +
      tile(corpus.faqs.length, 'FAQ questions', publicCount + ' on the public page') +
      tile(open.length, 'open content gaps', 'questions with no answer yet') +
      tile(checks ? answered : '…', 'may be answered now', 'an FAQ answer matches them') +
      tile(resolved.length, 'resolved gaps', 'kept as a record') +
      '</section>';

    html += '<section class="block"><h2>Open content gaps <span class="count">' + open.length + '</span></h2>' +
      (open.length
        ? open.slice().sort(function (a, b) {
            var w = { high: 0, medium: 1, low: 2 };
            return (w[a.severity] || 1) - (w[b.severity] || 1) || String(b.raised).localeCompare(String(a.raised));
          }).map(function (g) { return gapRowHtml(g, byGap[g.id], checks); }).join('')
        : '<p class="empty">None logged. Probe a question; if the FAQ can\'t answer it, log it here.</p>') +
      '</section>';

    if (resolved.length) {
      html += '<details class="resolved"><summary>' + resolved.length + ' resolved content gap' +
        (resolved.length === 1 ? '' : 's') + '</summary>' +
        resolved.map(function (g) {
          return '<a class="list-row" href="#/issue/' + e(g.id) + '/' + e(g.id) + '">' +
            '<span class="list-title">' + e(g.q) + '</span>' +
            '<span class="list-sub">✓ ' + e(g.resolved) + (g.resolution ? ' — ' + e(g.resolution) : '') +
            '</span></a>';
        }).join('') + '</details>';
    }

    html += '<p class="hint-block">Probe compares questions by meaning, not just by words, using a ' +
      'small language model that runs in this browser — nothing you type leaves it. Scores are a guide: ' +
      Math.round(Semantic.STRONG * 100) + '% and over usually means the FAQ answers it; under ' +
      Math.round(Semantic.WEAK * 100) + '% means nothing comes close. Content gaps are issues, so they ' +
      'also appear in the <a href="#/issues">issues register</a> and its exports.</p>';
    return html;
  }

  function gapRowHtml(g, check, checks) {
    var nearNow = '';
    if (check && check.best) {
      var strong = check.best.score >= Semantic.STRONG;
      nearNow = '<span class="probe-near' + (strong ? ' strong' : '') + '">' +
        (strong ? '✓ May be answered by ' : 'Nearest now: ') +
        '<a href="#/faq/' + e(check.best.item.id) + '">“' + e(check.best.item.q) + '”</a> ' +
        pct(check.best.score) +
        (strong
          ? ' <button class="btn tiny" data-probe="resolve" data-gap="' + e(g.id) + '" data-faq="' +
            e(check.best.item.id) + '">✓ Resolve</button>'
          : '') + '</span>';
    } else if (!checks) {
      nearNow = '<span class="probe-near">Checking against the FAQ…</span>';
    }
    return '<div class="probe-gap-row sev-' + e(g.severity) + '">' +
      '<span class="sev">' + e(g.severity) + '</span>' +
      '<div class="probe-gap-body">' +
      '<a class="probe-q" href="#/probe?gap=' + encodeURIComponent(g.id) + '">' + e(g.q) + '</a>' +
      '<span class="probe-where">' + e(gapMeta(g)) + '</span>' + nearNow +
      '</div><span class="probe-gap-actions">' +
      '<a class="btn tiny" href="#/issue/' + e(g.id) + '/' + e(g.id) + '">Issue →</a>' +
      deleteButton(g) + '</span></div>';
  }

  /** Delete a content gap outright — for one logged by mistake. Resolving keeps a record; this doesn't. */
  function deleteButton(g) {
    return '<button class="btn tiny danger probe-del" data-probe="delete" data-gap="' + e(g.id) + '" ' +
      'title="Delete this content gap" aria-label="Delete this content gap">×</button>';
  }

  function tile(n, label, sub) {
    return '<div class="tile"><span class="tile-n">' + e(n) + '</span>' +
      '<span class="tile-label">' + e(label) + '</span>' +
      '<span class="tile-sub">' + e(sub) + '</span></div>';
  }

  // ---- events --------------------------------------------------------------

  function onSubmit(ev) {
    if (ev.target.id !== 'probeForm') return;
    ev.preventDefault();
    var q = document.getElementById('probeInput').value.trim();
    if (q) onNavigate('#/probe?q=' + encodeURIComponent(q));
  }

  function onChange(ev) {
    if (ev.target.id !== 'probeAll') return;
    prefs.probeAll = ev.target.checked;
    Storage.savePrefs(prefs);
    if (view.result) fill(resultsHtml());
  }

  function onClick(ev) {
    var node = ev.target.closest('[data-probe]');
    if (!node || !host.contains(node)) return;
    ev.preventDefault();
    var act = node.dataset.probe;
    if (act === 'log') {
      view.logging = true;
      fill(resultsHtml());
      var q = document.getElementById('pgQ');
      if (q) q.focus();
    }
    if (act === 'cancel') {
      view.logging = false;
      fill(resultsHtml());
    }
    if (act === 'save') saveGap();
    if (act === 'resolve') {
      Edit.resolveGap(node.dataset.gap, node.dataset.faq);
      if (global.App) App.route();
    }
    if (act === 'delete' && confirm('Delete this content gap entirely? Resolving keeps a record; ' +
        'deleting does not.')) {
      var id = node.dataset.gap;
      Edit.deleteIssue(id, id);
      if (view.logged === id) view.logged = null;
      // Deleting the gap this page was opened for leaves nothing to show.
      if (view.gapId === id) onNavigate('#/probe');
      else if (global.App) App.route();
    }
  }

  global.ProbePage = {
    init: init,
    render: render
  };
}(window));
