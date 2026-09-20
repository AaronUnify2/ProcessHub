/* ===========================================================================
   data.js — the in-memory model.

   Holds the three source files, builds the lookups the interface needs, and
   resolves variable references. Everything derived (usage counts, handoffs,
   the search index) is computed here rather than stored, so it can never fall
   out of step with the content.
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
    var withChips = String(html == null ? '' : html)
      .replace(VAR_PATTERN, function (_, id) { return variableChip(id); });
    return refreshSpans(withChips, false);
  }

  /**
   * Update <span data-var> text and <a data-var-href> addresses in place.
   * `bake` strips the markup and leaves plain values behind, for exports.
   */
  function refreshSpans(html, bake) {
    if (html.indexOf('data-var') === -1) return html;
    var holder = document.createElement('div');
    holder.innerHTML = html;

    Array.prototype.forEach.call(holder.querySelectorAll('[data-var]'), function (node) {
      var v = variable(node.getAttribute('data-var'));
      if (!v) return;
      if (bake) {
        node.replaceWith(document.createTextNode(v.value));
      } else {
        node.textContent = v.value;
        node.classList.add('var-chip');
        if (v.internal) node.classList.add('internal');
        if (v.status === 'pending') node.classList.add('pending');
        node.title = v.question || v.id;
      }
    });

    Array.prototype.forEach.call(holder.querySelectorAll('[data-var-href]'), function (node) {
      var v = variable(node.getAttribute('data-var-href'));
      if (v) node.setAttribute('href', v.value);
      if (bake) node.removeAttribute('data-var-href');
    });

    return holder.innerHTML;
  }

  /** Values baked in, for anything leaving the app (SVG, exports, email). */
  function freeze(text) {
    var plain = String(text == null ? '' : text).replace(VAR_PATTERN, function (whole, id) {
      var v = variable(id);
      return v ? v.value : whole;
    });
    return refreshSpans(plain, true);
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

      p.departments = [];
      p.handoffs = 0;
      p.steps.forEach(function (step, i) {
        if (p.departments.indexOf(step.departmentId) === -1) {
          p.departments.push(step.departmentId);
        }
        if (i > 0 && p.steps[i - 1].departmentId !== step.departmentId) {
          p.handoffs++;
          step.isHandoff = true;
        } else {
          step.isHandoff = false;
        }
        noteUsage(index, step.articleRefs, p, step);
        noteUsage(index, step.faqRefs, p, step);
        countVariables(index, [step.sop, step.script].join('\n'), p, step);
        (step.checks || []).forEach(function (c) {
          countVariables(index, c.text, p, step);
        });
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
        subtitle: 'FAQ · ' + ((f.publish && f.publish.tabId) || ''),
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
      var title = entry.title.toLowerCase();

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
      return a.rank - b.rank || a.entry.title.length - b.entry.title.length;
    });
    return results.slice(0, limit || 40).map(function (r) { return r.entry; });
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
    while (node && node.parentId) {
      node = idx.taxonomy[node.parentId];
      if (node) parts.unshift(node.name);
    }
    return parts.join(' › ');
  }

  function processCount(taxonomyId) {
    var direct = (state.index.byTaxonomy[taxonomyId] || []).length;
    (state.index.children[taxonomyId] || []).forEach(function (child) {
      direct += processCount(child.id);
    });
    return direct;
  }

  function allIssues() {
    var out = [];
    state.processes.processes.forEach(function (p) {
      (p.issues || []).forEach(function (issue) {
        out.push({ issue: issue, process: p });
      });
    });
    var weight = { high: 0, medium: 1, low: 2 };
    out.sort(function (a, b) {
      return weight[a.issue.severity] - weight[b.issue.severity];
    });
    return out;
  }

  function load(data) {
    state.processes = data.processes;
    state.library = data.library;
    state.variables = data.variables;
    buildIndexes();
    return state;
  }

  global.Data = {
    state: state,
    load: load,
    rebuild: buildIndexes,
    escapeHtml: escapeHtml,
    resolveText: resolveText,
    resolveHtml: resolveHtml,
    refreshSpans: refreshSpans,
    freeze: freeze,
    variable: variable,
    search: search,
    taxonomyName: taxonomyName,
    taxonomyPath: function (id) { return taxonomyPath(null, id); },
    processCount: processCount,
    allIssues: allIssues
  };
}(window));
