/* ===========================================================================
   data.js — the in-memory model.

   Holds the three source files, builds the lookups the interface needs, and
   resolves variable references. Everything derived (usage counts, handoffs,
   the search index) is computed here rather than stored, so it can never fall
   out of step with the content.

   Derived values live in state.index, never on the content objects
   themselves. Anything written onto a process or a step would be carried out
   into processes.json by the next export, and the spec's rule is that derived
   data is never stored.
   =========================================================================== */

(function (global) {
  'use strict';

  var state = {
    processes: null,
    library: null,
    variables: null,
    index: {}
  };

  // ---- escaping ------------------------------------------------------------

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  // ---- variables -----------------------------------------------------------

  var VAR_PATTERN = /\{\{(var_[a-z0-9_]+)\}\}/gi;

  function variable(id) {
    return state.index.variables[id] || null;
  }

  function variableChip(id) {
    var v = variable(id);
    if (!v) {
      return '<span class="var-chip missing" title="No variable with the id ' +
        escapeHtml(id) + '">' + escapeHtml(id) + '</span>';
    }
    var classes = 'var-chip' + (v.internal ? ' internal' : '') +
      (v.status === 'pending' ? ' pending' : '');
    var tip = v.question || ('Value for ' + v.id);
    return '<span class="' + classes + '" data-var="' + escapeHtml(v.id) +
      '" title="' + escapeHtml(tip) + '">' + escapeHtml(v.value) + '</span>';
  }

  /** Plain text in, safe HTML out, with variables rendered as chips. */
  function resolveText(text) {
    return escapeHtml(text).replace(VAR_PATTERN, function (_, id) {
      return variableChip(id);
    });
  }

  /**
   * HTML in, HTML out, for article and FAQ bodies.
   *
   * Two reference styles have to be handled. Process text uses {{var_id}},
   * while content imported from the published FAQ uses the span form the
   * council site already renders. Both are refreshed from the variable table
   * so what you see is the current value rather than whatever was stored.
   */
  function resolveHtml(html) {
    return refreshSpans(toChips(html), 'view');
  }

  /** The form the rich text editor works in: chips the caret cannot enter. */
  function editableHtml(html) {
    return refreshSpans(toChips(html), 'edit');
  }

  /** The form that gets stored: values synced, editor scaffolding removed. */
  function canonicalHtml(html) {
    return refreshSpans(toChips(html), 'canonical');
  }

  function toChips(html) {
    return String(html == null ? '' : html)
      .replace(VAR_PATTERN, function (_, id) { return variableChip(id); });
  }

  /**
   * Update <span data-var> text and <a data-var-href> addresses in place.
   *
   *   view       chip styling, for reading
   *   edit       chip styling plus contenteditable="false", so the caret
   *              cannot land inside a value and break the reference
   *   canonical  the stored form: value synced, editor scaffolding removed
   *   bake       plain text, for anything leaving the app
   */
  function refreshSpans(html, mode) {
    if (html.indexOf('data-var') === -1) return html;
    var holder = document.createElement('div');
    holder.innerHTML = html;

    Array.prototype.forEach.call(holder.querySelectorAll('[data-var]'), function (node) {
      var v = variable(node.getAttribute('data-var'));
      if (!v) return;

      if (mode === 'bake') {
        node.replaceWith(document.createTextNode(v.value));
        return;
      }

      node.textContent = v.value;

      if (mode === 'canonical') {
        node.className = 'faq-var';
        node.removeAttribute('contenteditable');
        node.removeAttribute('title');
        return;
      }

      node.className = 'faq-var var-chip' +
        (v.internal ? ' internal' : '') +
        (v.status === 'pending' ? ' pending' : '');
      node.title = v.question || v.id;
      if (mode === 'edit') node.setAttribute('contenteditable', 'false');
      else node.removeAttribute('contenteditable');
    });

    Array.prototype.forEach.call(holder.querySelectorAll('[data-var-href]'), function (node) {
      var v = variable(node.getAttribute('data-var-href'));
      if (v) node.setAttribute('href', v.value);
      if (mode === 'bake') node.removeAttribute('data-var-href');
    });

    return holder.innerHTML;
  }

  /** Values baked in, for anything leaving the app (SVG, exports, email). */
  function freeze(text) {
    var plain = String(text == null ? '' : text).replace(VAR_PATTERN, function (whole, id) {
      var v = variable(id);
      return v ? v.value : whole;
    });
    return refreshSpans(plain, 'bake');
  }

  // ---- indexes -------------------------------------------------------------

  function buildIndexes() {
    var index = {
      taxonomy: {},
      children: {},
      processes: {},
      articles: {},
      faqs: {},
      variables: {},
      usage: {},
      flow: {},
      search: []
    };

    state.variables.variables.forEach(function (v) { index.variables[v.id] = v; });
    state.library.articles.forEach(function (a) { index.articles[a.id] = a; });
    state.library.faqs.forEach(function (f) { index.faqs[f.id] = f; });

    state.processes.taxonomy.forEach(function (node) {
      index.taxonomy[node.id] = node;
      var parent = node.parentId || '__root__';
      (index.children[parent] = index.children[parent] || []).push(node);
    });
    Object.keys(index.children).forEach(function (key) {
      index.children[key].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    });

    // Processes, plus everything derived from them.
    index.byTaxonomy = {};
    state.processes.processes.forEach(function (p) {
      index.processes[p.id] = p;
      (index.byTaxonomy[p.taxonomyId] = index.byTaxonomy[p.taxonomyId] || []).push(p);
      index.flow[p.id] = buildFlow(p);

      p.steps.forEach(function (step) {
        noteUsage(index, step.articleRefs, p, step);
        noteUsage(index, step.faqRefs, p, step);
        countVariables(index, [step.title, step.sop, step.script, step.completionTrigger].join('\n'), p, step);
        (step.checks || []).forEach(function (c) {
          countVariables(index, c.text, p, step);
        });
      });
      countVariables(index, [p.purpose, p.resolutionDefinition].join('\n'), p, null);
      (p.connections || []).forEach(function (c) {
        countVariables(index, c.condition, p, null);
      });
      noteUsage(index, p.articleRefs, p, null);
      noteUsage(index, p.faqRefs, p, null);
    });

    state.library.articles.forEach(function (a) {
      countVariables(index, a.body, a, null);
    });
    state.library.faqs.forEach(function (f) {
      countVariables(index, f.a, f, null);
    });

    Object.keys(index.byTaxonomy).forEach(function (key) {
      index.byTaxonomy[key].sort(function (a, b) { return a.name.localeCompare(b.name); });
    });

    index.search = buildSearchIndex(index);
    state.index = index;
    return index;
  }

  /**
   * The shape of a process as the arrows describe it.
   *
   * A handoff is an arrow whose two ends sit in different departments. That
   * follows the connections rather than the order of the step list, so a
   * decision that branches into two departments counts both branches.
   */
  function buildFlow(p) {
    var flow = {
      departments: [],
      handoffs: 0,
      handoffSteps: {},
      outgoing: {},
      incoming: {},
      branches: false,
      linear: true
    };
    var byId = {};
    p.steps.forEach(function (step) {
      byId[step.id] = step;
      if (flow.departments.indexOf(step.departmentId) === -1) {
        flow.departments.push(step.departmentId);
      }
    });

    (p.connections || []).forEach(function (c) {
      var from = byId[c.from], to = byId[c.to];
      if (!from || !to) return;
      (flow.outgoing[c.from] = flow.outgoing[c.from] || []).push(c);
      (flow.incoming[c.to] = flow.incoming[c.to] || []).push(c);
      if (from.departmentId !== to.departmentId) {
        flow.handoffs++;
        flow.handoffSteps[to.id] = from.departmentId;
      }
    });

    Object.keys(flow.outgoing).forEach(function (id) {
      if (flow.outgoing[id].length > 1) flow.branches = true;
    });
    flow.linear = isLinear(p);
    return flow;
  }

  /** True when the arrows run exactly down the step list, one to the next. */
  function isLinear(p) {
    var conns = p.connections || [];
    if (conns.length !== Math.max(0, p.steps.length - 1)) return false;
    var pairs = {};
    conns.forEach(function (c) { pairs[c.from + '>' + c.to] = true; });
    for (var i = 1; i < p.steps.length; i++) {
      if (!pairs[p.steps[i - 1].id + '>' + p.steps[i].id]) return false;
    }
    return true;
  }

  function flow(p) {
    if (!p) return null;
    return state.index.flow[p.id] || buildFlow(p);
  }

  function noteUsage(index, refs, owner, step) {
    (refs || []).forEach(function (id) {
      var entry = index.usage[id] = index.usage[id] || { processes: [], steps: 0 };
      if (entry.processes.indexOf(owner.id) === -1) entry.processes.push(owner.id);
      if (step) entry.steps++;
    });
  }

  var SPAN_PATTERN = /data-var(?:-href)?="(var_[a-z0-9_]+)"/gi;

  /**
   * Count both reference styles. Process text uses {{var_id}}; content from
   * the published FAQ uses the span form. Missing the second would understate
   * every FAQ variable as unused, which is exactly the figure the verification
   * email leans on.
   */
  function countVariables(index, text, owner, step) {
    if (!text) return;
    [VAR_PATTERN, SPAN_PATTERN].forEach(function (pattern) {
      var match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text))) {
        var entry = index.usage[match[1]] = index.usage[match[1]] || { processes: [], steps: 0 };
        if (entry.processes.indexOf(owner.id) === -1) entry.processes.push(owner.id);
        if (step) entry.steps++;
      }
    });
  }

  // ---- search --------------------------------------------------------------

  function buildSearchIndex(index) {
    var entries = [];

    state.processes.processes.forEach(function (p) {
      var stepText = p.steps.map(function (s) {
        return [s.title, s.sop, s.script].join(' ');
      }).join(' ');
      entries.push({
        kind: 'process', id: p.id, title: p.name,
        subtitle: taxonomyPath(index, p.taxonomyId),
        haystack: (p.name + ' ' + p.purpose + ' ' + stepText).toLowerCase(),
        route: '#/process/' + p.id
      });
    });

    state.library.articles.forEach(function (a) {
      entries.push({
        kind: 'article', id: a.id, title: a.title,
        subtitle: 'Knowledge base',
        haystack: (a.title + ' ' + stripTags(a.body)).toLowerCase(),
        route: '#/article/' + a.id
      });
    });

    state.library.faqs.forEach(function (f) {
      entries.push({
        kind: 'faq', id: f.id, title: f.q,
        subtitle: 'FAQ · ' + ((f.publish && f.publish.tabId) || 'not published'),
        haystack: (f.q + ' ' + stripTags(f.a)).toLowerCase(),
        route: '#/faq/' + f.id
      });
    });

    state.variables.variables.forEach(function (v) {
      // A raw web address makes a poor result title, so URL variables lead
      // with the question they answer instead.
      var title = (v.type === 'url' && v.question) ? v.question : v.value;
      entries.push({
        kind: 'variable', id: v.id, title: title,
        subtitle: (v.type === 'url' ? v.value : v.question),
        haystack: (v.value + ' ' + v.question + ' ' + v.id).toLowerCase(),
        route: '#/variable/' + v.id
      });
    });

    return entries;
  }

  function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  /**
   * Matches are ranked so a title hit always beats a body hit — typing "leak"
   * should surface the leak process, not every answer that mentions one.
   */
  function search(query, limit) {
    var raw = String(query || '').trim().toLowerCase();
    if (raw.length < 2) return [];
    var terms = raw.split(/\s+/).filter(Boolean);

    var results = [];
    state.index.search.forEach(function (entry) {
      var title = String(entry.title || '').toLowerCase();

      // Every term has to appear somewhere, so "water leak" finds the leak
      // process even though those two words are never adjacent in it.
      var everywhere = terms.every(function (t) {
        return title.indexOf(t) !== -1 || entry.haystack.indexOf(t) !== -1;
      });
      if (!everywhere) return;

      var inTitle = terms.filter(function (t) { return title.indexOf(t) !== -1; }).length;
      var rank;
      if (title.indexOf(raw) === 0) rank = 0;          // title starts with the phrase
      else if (title.indexOf(raw) > 0) rank = 1;        // phrase appears in the title
      else if (inTitle === terms.length) rank = 2;      // all terms in the title
      else if (inTitle) rank = 3;                       // some terms in the title
      else rank = 4;                                    // body only

      // A process is usually what someone wants; a variable almost never is,
      // since it is reference data rather than an answer. Nudge accordingly.
      rank += { process: 0, faq: 0.3, article: 0.5, variable: 1.5 }[entry.kind] || 0.5;
      results.push({ entry: entry, rank: rank });
    });

    results.sort(function (a, b) {
      return a.rank - b.rank || String(a.entry.title).length - String(b.entry.title).length;
    });
    return results.slice(0, limit || 40).map(function (r) { return r.entry; });
  }

  // ---- suggestions ---------------------------------------------------------
  // Shared by the editor's attach picker and the live call view: articles and
  // FAQ answers whose wording overlaps a step, scored on how rare the shared
  // words are.

  var STOPWORDS = ('the a an and or of to in on for with by at from is are was ' +
    'be been it its this that these those if then when where what which who how ' +
    'you your we our they their he she them can could should would may might must ' +
    'will shall do does did not no yes any all some more most other into out up ' +
    'down over under about after before during while also please note only both ' +
    'each every such than too very just own same so nor but customer council ' +
    'officer call caller provide check advise refer ' +
    // Words that carry no subject at all in council prose, and which were
    // otherwise pairing unrelated answers together.
    'make makes made making available need needs needed take takes taken give ' +
    'given put one two three way ways new old general information details ' +
    'contact further first second next following include includes including ' +
    'use used using within via per see back through around member letter ' +
    'template email phone form forms apply applying required require requires ' +
    'ensure must may relevant appropriate current existing').split(' ');

  var STOP = {};
  STOPWORDS.forEach(function (w) { STOP[w] = true; });

  function terms(text) {
    return String(text || '')
      // A {{var_sys_property}} reference counts as its value (TechOne), not
      // as the words "var", "sys" and "property" from its id.
      .replace(VAR_PATTERN, function (_, id) {
        var v = variable(id);
        return v ? ' ' + v.value + ' ' : ' ';
      })
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(function (w) { return w.length > 2 && !STOP[w]; });
  }

  function unique(list) {
    var seen = {};
    return list.filter(function (w) {
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    });
  }

  var suggestIndex = null;

  /**
   * Index the library once per load. Document frequency is kept so that a
   * word appearing in half the answers counts for much less than a rare one —
   * without it, "approval" matches everything and nothing useful surfaces.
   */
  function buildSuggestIndex() {
    var docs = [];
    state.library.articles.forEach(function (a) {
      docs.push({ kind: 'article', id: a.id, title: a.title, body: a.body });
    });
    state.library.faqs.forEach(function (f) {
      docs.push({ kind: 'faq', id: f.id, title: f.q, body: f.a });
    });

    var df = {};
    docs.forEach(function (doc) {
      doc.titleTerms = {};
      unique(terms(doc.title)).forEach(function (w) { doc.titleTerms[w] = true; });
      doc.allTerms = {};
      unique(terms(doc.title + ' ' + doc.body)).forEach(function (w) {
        doc.allTerms[w] = true;
        df[w] = (df[w] || 0) + 1;
      });
    });

    return { docs: docs, df: df, total: docs.length || 1 };
  }

  // A word in more than a fifth of the library tells you nothing about a
  // particular step. Without this cutoff, an Airbnb answer surfaces against a
  // water leak because both mention "sdrc", "lodge" and "whether".
  var COMMON_TERM_RATIO = 0.2;
  var RELATIVE_FLOOR = 0.45;

  /**
   * step may be null, in which case the process as a whole is the query.
   * kind is 'article' or 'faq'.
   */
  function suggest(step, process, kind, alreadyAttached) {
    if (!suggestIndex) suggestIndex = buildSuggestIndex();
    var source = step
      ? [step.title, step.sop, step.script, process.name]
      : [process.name, process.purpose, process.resolutionDefinition];
    var query = unique(terms(source.join(' ')));
    if (!query.length) return [];

    var taken = {};
    (alreadyAttached || []).forEach(function (id) { taken[id] = true; });

    var scored = [];
    suggestIndex.docs.forEach(function (doc) {
      if (doc.kind !== kind || taken[doc.id]) return;

      var score = 0;
      var hits = [];
      query.forEach(function (word) {
        if (!doc.allTerms[word]) return;
        var ratio = (suggestIndex.df[word] || 1) / suggestIndex.total;
        if (ratio > COMMON_TERM_RATIO) return;
        score += Math.log(1 / ratio) * (doc.titleTerms[word] ? 2.2 : 1);
        hits.push({ word: word, ratio: ratio });
      });

      if (hits.length < 2) return;
      hits.sort(function (a, b) { return a.ratio - b.ratio; });
      scored.push({ doc: doc, score: score, hits: hits.map(function (h) { return h.word; }) });
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    if (!scored.length) return [];

    // Keep only what is in the same league as the best match, so a thin tail
    // of half-relevant answers does not pad the list out to five.
    var floor = scored[0].score * RELATIVE_FLOOR;
    return scored.filter(function (s) { return s.score >= floor; }).slice(0, 5);
  }

  // ---- helpers -------------------------------------------------------------

  function taxonomyName(id) {
    var node = state.index.taxonomy[id];
    return node ? node.name : '—';
  }

  function taxonomyPath(index, id) {
    var idx = index || state.index;
    var node = idx.taxonomy[id];
    if (!node) return '';
    var parts = [node.name];
    var guard = 0;
    while (node && node.parentId && guard++ < 50) {
      node = idx.taxonomy[node.parentId];
      if (node) parts.unshift(node.name);
    }
    return parts.join(' › ');
  }

  /** The top-level department a taxonomy node sits under. */
  function topDepartment(id) {
    var node = state.index.taxonomy[id];
    var guard = 0;
    while (node && node.parentId && guard++ < 50) node = state.index.taxonomy[node.parentId];
    return node || null;
  }

  function processCount(taxonomyId) {
    var direct = (state.index.byTaxonomy[taxonomyId] || []).length;
    (state.index.children[taxonomyId] || []).forEach(function (child) {
      direct += processCount(child.id);
    });
    return direct;
  }

  function isOpen(issue) { return !issue.resolved; }

  /**
   * Recorded issues, worst first. Open ones only, unless opts.resolved is
   * 'include' (everything) or 'only' (the resolved history).
   */
  function allIssues(opts) {
    var mode = (opts && opts.resolved) || 'exclude';
    var out = [];
    state.processes.processes.forEach(function (p) {
      (p.issues || []).forEach(function (issue) {
        var open = isOpen(issue);
        if (mode === 'exclude' && !open) return;
        if (mode === 'only' && open) return;
        out.push({ issue: issue, process: p });
      });
    });
    var weight = { high: 0, medium: 1, low: 2 };
    out.sort(function (a, b) {
      if (mode === 'only') return String(b.issue.resolved).localeCompare(String(a.issue.resolved));
      return (weight[a.issue.severity] || 1) - (weight[b.issue.severity] || 1);
    });
    return out;
  }

  function openIssues(p) {
    return (p.issues || []).filter(isOpen);
  }

  // ---- coverage ------------------------------------------------------------

  var STATUSES = ['draft', 'mapped', 'reviewed', 'published', 'needs_rework'];

  /**
   * How far the mapping has got, department by department. Each row counts
   * the processes filed under that department and everything beneath it.
   * findingsByProcess, if given, maps a process id to its rule findings.
   */
  function coverage(findingsByProcess) {
    var index = state.index;
    var rows = [];

    function tally(list) {
      var out = { processes: list.length, steps: 0, handoffs: 0, issues: 0, high: 0, findings: 0,
        byStatus: {} };
      STATUSES.forEach(function (s) { out.byStatus[s] = 0; });
      list.forEach(function (p) {
        out.byStatus[p.status] = (out.byStatus[p.status] || 0) + 1;
        out.steps += p.steps.length;
        out.handoffs += flow(p).handoffs;
        var open = openIssues(p);
        out.issues += open.length;
        out.high += open.filter(function (i) { return i.severity === 'high'; }).length;
        out.findings += (findingsByProcess && findingsByProcess[p.id]) || 0;
      });
      return out;
    }

    function beneath(id) {
      var list = (index.byTaxonomy[id] || []).slice();
      (index.children[id] || []).forEach(function (child) {
        list = list.concat(beneath(child.id));
      });
      return list;
    }

    function walk(node, depth) {
      var list = beneath(node.id);
      var row = tally(list);
      row.node = node;
      row.depth = depth;
      rows.push(row);
      (index.children[node.id] || []).forEach(function (child) { walk(child, depth + 1); });
    }
    (index.children.__root__ || []).forEach(function (node) { walk(node, 0); });

    var total = tally(state.processes.processes);

    var owners = {};
    state.variables.variables.forEach(function (v) {
      var top = topDepartment(v.ownerId);
      var key = top ? top.id : '';
      var o = owners[key] = owners[key] || { ownerId: key, total: 0, current: 0, pending: 0, stale: 0 };
      o.total++;
      o[v.status] = (o[v.status] || 0) + 1;
    });

    return {
      statuses: STATUSES,
      rows: rows,
      total: total,
      variables: Object.keys(owners).map(function (k) { return owners[k]; })
        .sort(function (a, b) { return b.total - a.total; })
    };
  }

  /**
   * A readable id, unique within its kind: "art_" + "Which side of the
   * meter?" becomes art_which_side_of_the_meter. Readable ids matter because
   * they appear in HTML content and in git diffs.
   */
  function makeId(prefix, text, taken) {
    var slug = String(text || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
      .replace(/_+$/, '') || 'item';
    var id = prefix + slug;
    var n = 2;
    while (taken[id]) id = prefix + slug + '_' + n++;
    return id;
  }

  /**
   * Remove anything an older version of the app wrote onto the content by
   * mistake. Drafts saved before derived values moved into the index still
   * carry them, and they must not ride out on the next export.
   */
  function scrubDerived(processes) {
    (processes.processes || []).forEach(function (p) {
      delete p.departments;
      delete p.handoffs;
      (p.steps || []).forEach(function (s) { delete s.isHandoff; });
    });
  }

  function load(data) {
    state.processes = data.processes;
    // Older files predate rules, so normalise rather than assume.
    if (!Array.isArray(state.processes.rules)) state.processes.rules = [];
    scrubDerived(state.processes);
    state.library = data.library;
    state.variables = data.variables;
    suggestIndex = null;
    buildIndexes();
    return state;
  }

  function rebuild() {
    suggestIndex = null;
    return buildIndexes();
  }

  global.Data = {
    state: state,
    load: load,
    rebuild: rebuild,
    escapeHtml: escapeHtml,
    today: today,
    resolveText: resolveText,
    resolveHtml: resolveHtml,
    editableHtml: editableHtml,
    canonicalHtml: canonicalHtml,
    refreshSpans: refreshSpans,
    freeze: freeze,
    variable: variable,
    search: search,
    suggest: suggest,
    flow: flow,
    isLinear: isLinear,
    taxonomyName: taxonomyName,
    taxonomyPath: function (id) { return taxonomyPath(null, id); },
    topDepartment: topDepartment,
    processCount: processCount,
    allIssues: allIssues,
    openIssues: openIssues,
    coverage: coverage,
    STATUSES: STATUSES,
    makeId: makeId,
    stripTags: stripTags
  };
}(window));
