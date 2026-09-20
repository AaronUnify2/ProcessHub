/* ===========================================================================
   ui-detail.js — the right-hand pane.

   One render function per route. Read-only for now: this pass is about being
   able to see the imported content and judge it. Editing and the draggable
   canvas come next.
   =========================================================================== */

(function (global) {
  'use strict';

  var host = null;
  var onNavigate = function () {};

  function init(options) {
    host = document.getElementById('detail');
    onNavigate = options.onNavigate || onNavigate;
  }

  function e(text) { return Data.escapeHtml(text); }

  function paint(html) {
    host.innerHTML = html;
    host.scrollTop = 0;
    Array.prototype.forEach.call(host.querySelectorAll('[data-route]'), function (node) {
      node.addEventListener('click', function () { onNavigate(node.dataset.route); });
    });
  }

  // ---- process -------------------------------------------------------------

  var STEP_LABEL = {
    entry: 'Entry', action: 'Action', decision: 'Decision', resolution: 'Resolution'
  };

  function renderProcess(id) {
    var p = Data.state.index.processes[id];
    if (!p) return paint(notFound('process', id));

    var departments = p.departments.map(Data.taxonomyName);

    var html = '<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">' + e(Data.taxonomyPath(p.taxonomyId)) + '</div>' +
      '<h1>' + e(p.name) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(p.status) + '">' + e(p.status) + '</span>' +
      (p.handoffs
        ? '<span class="badge warn">⇄ ' + p.handoffs + ' handoff' +
          (p.handoffs > 1 ? 's' : '') + ' across ' + departments.length + ' departments</span>'
        : '') +
      '<span class="badge quiet">' + p.steps.length + ' steps</span>' +
      (p.issues.length ? '<span class="badge issue">' + p.issues.length + ' issues</span>' : '') +
      '</div>' +
      (p.purpose ? '<p class="lede">' + Data.resolveText(p.purpose) + '</p>' : '') +
      '</header>';

    if (p.issues.length) html += renderIssues(p.issues, p);

    html += '<section class="flow">' + p.steps.map(renderStep).join('') + '</section>';

    var refs = p.custom && p.custom.references;
    if (refs && refs.length) {
      html += '<section class="block"><h2>References</h2><ul class="refs">' +
        refs.map(function (r) {
          return '<li>' + Data.resolveText(r) + '</li>';
        }).join('') + '</ul></section>';
    }

    html += '<section class="block meta"><h2>Details</h2><dl>' +
      row('Entry point', p.entryPoint) +
      row('Resolution', p.resolutionDefinition) +
      row('Owner', p.owner || '— not set —') +
      row('Last reviewed', p.lastReviewed || '— never —') +
      row('Departments', departments.join(', ')) +
      row('Source', p.custom ? p.custom.sourceNode + ' (' + p.custom.sourceSection + ')' : '') +
      '</dl></section></article>';

    paint(html);
  }

  function row(label, value) {
    if (!value) return '';
    return '<dt>' + e(label) + '</dt><dd>' + Data.resolveText(value) + '</dd>';
  }

  function renderStep(step, i) {
    var html = '';
    if (step.isHandoff) {
      html += '<div class="handoff-marker">Handoff to ' +
        e(Data.taxonomyName(step.departmentId)) + '</div>';
    }

    html += '<div class="step step-' + e(step.type) + '">' +
      '<div class="step-head">' +
      '<span class="step-n">' + (i + 1) + '</span>' +
      '<span class="step-type">' + e(STEP_LABEL[step.type] || step.type) + '</span>' +
      '<h3>' + e(step.title) + '</h3>' +
      '</div>' +
      '<div class="step-meta">' +
      '<span class="pill dept">' + e(Data.taxonomyName(step.departmentId)) + '</span>' +
      (step.responsibleRole ? '<span class="pill">' + e(step.responsibleRole) + '</span>' : '') +
      (step.timeframe ? '<span class="pill">' + e(step.timeframe) + '</span>' : '') +
      (step.escalationPoint ? '<span class="pill">↑ ' + e(step.escalationPoint) + '</span>' : '') +
      '</div>';

    if (step.script) {
      html += '<blockquote class="script">' + Data.resolveText(step.script) + '</blockquote>';
    }
    if (step.sop) {
      html += '<div class="sop">' + Data.resolveText(step.sop).replace(/\n/g, '<br>') + '</div>';
    }
    if (step.checks && step.checks.length) {
      html += '<ul class="checks">' + step.checks.map(function (c) {
        return '<li>' + Data.resolveText(c.text) + '</li>';
      }).join('') + '</ul>';
    }
    if (step.articleRefs && step.articleRefs.length) {
      html += '<div class="attached">' + step.articleRefs.map(function (ref) {
        var a = Data.state.index.articles[ref];
        return '<button class="chip-link" data-route="#/article/' + e(ref) + '">📖 ' +
          e(a ? a.title : ref) + '</button>';
      }).join('') + '</div>';
    }
    if (step.completionTrigger) {
      html += '<div class="trigger"><strong>Done when:</strong> ' +
        Data.resolveText(step.completionTrigger) + '</div>';
    }
    return html + '</div>';
  }

  function renderIssues(issues, p) {
    return '<section class="block issues"><h2>Issues</h2>' + issues.map(function (issue) {
      var step = (p.steps || []).find(function (s) { return s.id === issue.stepId; });
      return '<div class="issue-row sev-' + e(issue.severity) + '">' +
        '<span class="sev">' + e(issue.severity) + '</span>' +
        '<div><p>' + e(issue.note) + '</p>' +
        '<span class="issue-meta">' + e(issue.raisedBy) + ' · ' + e(issue.raised) +
        (step ? ' · step: ' + e(step.title) : '') + '</span></div></div>';
    }).join('') + '</section>';
  }

  // ---- article and FAQ -----------------------------------------------------

  function renderArticle(id) {
    var a = Data.state.index.articles[id];
    if (!a) return paint(notFound('article', id));
    var usage = Data.state.index.usage[id] || { processes: [], steps: 0 };

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">Knowledge base · ' + e(Data.taxonomyPath(a.ownerId)) + '</div>' +
      '<h1>' + e(a.title) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(a.status) + '">' + e(a.status) + '</span>' +
      '<span class="badge quiet">' + e(a.audience) + '</span>' +
      (a.internal ? '<span class="badge lock">🔒 internal</span>' : '') +
      '</div>' + renderUsage(usage) + '</header>' +
      '<section class="block prose">' + Data.resolveHtml(a.body) + '</section>' +
      '</article>');
  }

  function renderFaq(id) {
    var f = Data.state.index.faqs[id];
    if (!f) return paint(notFound('FAQ question', id));

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">FAQ · ' + e((f.publish && f.publish.tabId) || '') +
      (f.ownerId ? ' · ' + e(Data.taxonomyPath(f.ownerId)) : '') + '</div>' +
      '<h1>' + e(f.q) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(f.status) + '">' + e(f.status) + '</span>' +
      (f.publish && f.publish.groupTitle
        ? '<span class="badge quiet">' + e(f.publish.groupTitle) + '</span>' : '') +
      (f.lastReviewed ? '<span class="badge quiet">' + e(f.lastReviewed) + '</span>' : '') +
      '</div></header>' +
      '<section class="block prose">' + Data.resolveHtml(f.a) + '</section>' +
      '</article>');
  }

  function renderUsage(usage) {
    if (!usage.processes.length) {
      return '<p class="usage none">Not referenced by any process yet.</p>';
    }
    return '<p class="usage">Used in ' + usage.processes.length + ' process' +
      (usage.processes.length > 1 ? 'es' : '') +
      (usage.steps ? ', ' + usage.steps + ' step' + (usage.steps > 1 ? 's' : '') : '') +
      '. Editing it changes all of them.</p>';
  }

  // ---- list views ----------------------------------------------------------

  function renderArticleList() {
    var items = Data.state.library.articles.slice().sort(function (a, b) {
      return a.title.localeCompare(b.title);
    });
    paint(listPane('Knowledge base articles', items.length + ' articles', items.map(function (a) {
      var usage = Data.state.index.usage[a.id] || { processes: [] };
      return listRow('#/article/' + a.id, a.title,
        Data.taxonomyPath(a.ownerId),
        usage.processes.length ? usage.processes.length + ' uses' : 'unused');
    }).join('')));
  }

  function renderFaqList() {
    var byTab = {};
    Data.state.library.faqs.forEach(function (f) {
      var tab = (f.publish && f.publish.tabId) || 'unassigned';
      (byTab[tab] = byTab[tab] || []).push(f);
    });
    var html = Object.keys(byTab).map(function (tab) {
      return '<h2 class="group">' + e(tab) + ' <span>' + byTab[tab].length + '</span></h2>' +
        byTab[tab].map(function (f) {
          return listRow('#/faq/' + f.id, f.q,
            f.ownerId ? Data.taxonomyName(f.ownerId) : '', '');
        }).join('');
    }).join('');
    paint(listPane('FAQ questions',
      Data.state.library.faqs.length + ' questions across ' +
      Data.state.library.publishTabs.length + ' published tabs', html));
  }

  function renderVariableList() {
    var byOwner = {};
    Data.state.variables.variables.forEach(function (v) {
      var owner = v.ownerId || 'unassigned';
      (byOwner[owner] = byOwner[owner] || []).push(v);
    });
    var html = Object.keys(byOwner).sort().map(function (owner) {
      var list = byOwner[owner];
      return '<h2 class="group">' +
        e(owner === 'unassigned' ? 'Unassigned' : Data.taxonomyPath(owner)) +
        ' <span>' + list.length + '</span></h2>' +
        list.map(function (v) {
          var usage = Data.state.index.usage[v.id] || { processes: [] };
          return '<button class="list-row" data-route="#/variable/' + e(v.id) + '">' +
            '<span class="list-title">' + e(v.value) +
            (v.internal ? ' <span class="lock">🔒</span>' : '') + '</span>' +
            '<span class="list-sub">' + e(v.question) + '</span>' +
            '<span class="list-tail">' + (usage.processes.length || 0) + ' uses · ' +
            e(v.status) + '</span></button>';
        }).join('');
    }).join('');
    var pending = Data.state.variables.variables.filter(function (v) {
      return v.status === 'pending';
    }).length;
    paint(listPane('Variables',
      Data.state.variables.variables.length + ' variables · ' + pending +
      ' awaiting verification', html));
  }

  function renderVariable(id) {
    var v = Data.variable(id);
    if (!v) return paint(notFound('variable', id));
    var usage = Data.state.index.usage[id] || { processes: [], steps: 0 };

    var used = usage.processes.map(function (pid) {
      var p = Data.state.index.processes[pid];
      if (p) return listRow('#/process/' + p.id, p.name, Data.taxonomyPath(p.taxonomyId), '');
      var a = Data.state.index.articles[pid];
      if (a) return listRow('#/article/' + a.id, a.title, 'Knowledge base', '');
      var f = Data.state.index.faqs[pid];
      if (f) return listRow('#/faq/' + f.id, f.q, 'FAQ', '');
      return '';
    }).join('');

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">Variable · ' + e(Data.taxonomyPath(v.ownerId)) + '</div>' +
      '<h1>' + e(v.value) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(v.status) + '">' + e(v.status) + '</span>' +
      '<span class="badge quiet">' + e(v.type) + '</span>' +
      (v.internal ? '<span class="badge lock">🔒 internal</span>' : '') +
      '</div>' +
      '<p class="lede">' + e(v.question) + '</p>' +
      (v.note ? '<p class="note">' + e(v.note) + '</p>' : '') +
      '</header>' +
      '<section class="block meta"><h2>Verification</h2><dl>' +
      row('Owner', Data.taxonomyPath(v.ownerId)) +
      row('Last verified', v.lastVerified || '— never —') +
      row('Verified by', v.verifiedBy || '—') +
      row('Identifier', v.id) +
      '</dl></section>' +
      '<section class="block"><h2>Used in ' + usage.processes.length + ' place' +
      (usage.processes.length === 1 ? '' : 's') + '</h2>' +
      (used || '<p class="empty">Not referenced anywhere yet.</p>') +
      '</section></article>');
  }

  function renderIssueRegister() {
    var all = Data.allIssues();
    var html = all.map(function (entry) {
      return '<button class="list-row issue-list sev-' + e(entry.issue.severity) + '"' +
        ' data-route="#/process/' + e(entry.process.id) + '">' +
        '<span class="sev">' + e(entry.issue.severity) + '</span>' +
        '<span class="list-title">' + e(entry.process.name) + '</span>' +
        '<span class="list-sub">' + e(entry.issue.note) + '</span>' +
        '</button>';
    }).join('');
    var counts = { high: 0, medium: 0, low: 0 };
    all.forEach(function (x) { counts[x.issue.severity]++; });
    paint(listPane('Issues register',
      all.length + ' open · ' + counts.high + ' high, ' + counts.medium +
      ' medium, ' + counts.low + ' low', html));
  }

  function renderHome() {
    var processes = Data.state.processes.processes;
    var crossing = processes.filter(function (p) { return p.handoffs > 0; });
    var drafts = processes.filter(function (p) { return p.status === 'draft'; });
    var pending = Data.state.variables.variables.filter(function (v) {
      return v.status === 'pending';
    });

    paint('<article class="pane">' +
      '<header class="pane-head"><h1>Process Hub</h1>' +
      '<p class="lede">Process maps, knowledge base articles and public FAQ ' +
      'content in one place. Pick a process from the tree, or press ' +
      '<kbd>/</kbd> to search.</p></header>' +
      '<section class="tiles">' +
      tile(processes.length, 'processes', drafts.length + ' still draft', '#/issues') +
      tile(crossing.length, 'cross departments',
        crossing.reduce(function (n, p) { return n + p.handoffs; }, 0) + ' handoffs total', '') +
      tile(Data.state.library.articles.length, 'articles', 'all internal', '#/articles') +
      tile(Data.state.library.faqs.length, 'FAQ questions',
        Data.state.library.publishTabs.length + ' published tabs', '#/faqs') +
      tile(Data.state.variables.variables.length, 'variables',
        pending.length + ' awaiting verification', '#/variables') +
      tile(Data.allIssues().length, 'open issues', 'from the import', '#/issues') +
      '</section>' +
      '<section class="block"><h2>Most handoffs</h2>' +
      crossing.sort(function (a, b) { return b.handoffs - a.handoffs; })
        .slice(0, 8).map(function (p) {
          return listRow('#/process/' + p.id, p.name,
            p.departments.map(Data.taxonomyName).join(' → '),
            p.handoffs + ' handoff' + (p.handoffs > 1 ? 's' : ''));
        }).join('') +
      '</section></article>');
  }

  function tile(n, label, sub, route) {
    return '<' + (route ? 'button class="tile" data-route="' + route + '"' : 'div class="tile"') +
      '><span class="tile-n">' + n + '</span>' +
      '<span class="tile-label">' + e(label) + '</span>' +
      '<span class="tile-sub">' + e(sub) + '</span>' +
      '</' + (route ? 'button' : 'div') + '>';
  }

  function listPane(title, subtitle, body) {
    return '<article class="pane"><header class="pane-head"><h1>' + e(title) + '</h1>' +
      '<p class="lede">' + e(subtitle) + '</p></header>' +
      '<section class="block list">' + (body || '<p class="empty">Nothing here yet.</p>') +
      '</section></article>';
  }

  function listRow(route, title, sub, tail) {
    return '<button class="list-row" data-route="' + route + '">' +
      '<span class="list-title">' + e(title) + '</span>' +
      (sub ? '<span class="list-sub">' + e(sub) + '</span>' : '') +
      (tail ? '<span class="list-tail">' + e(tail) + '</span>' : '') +
      '</button>';
  }

  function notFound(kind, id) {
    return '<article class="pane"><header class="pane-head"><h1>Not found</h1>' +
      '<p class="lede">No ' + e(kind) + ' with the id <code>' + e(id) + '</code>.</p>' +
      '</header></article>';
  }

  global.Detail = {
    init: init,
    process: renderProcess,
    article: renderArticle,
    faq: renderFaq,
    articleList: renderArticleList,
    faqList: renderFaqList,
    variableList: renderVariableList,
    variable: renderVariable,
    issues: renderIssueRegister,
    home: renderHome
  };
}(window));
