/* ===========================================================================
   ui-detail.js — the right-hand pane.

   One render function per route. Fields are rendered through Edit.field, so
   anything shown here can be clicked and changed; structural actions (add a
   step, resolve an issue, verify a variable) go through Edit too.
   =========================================================================== */

(function (global) {
  'use strict';

  var host = null;
  var onNavigate = function () {};
  var currentRoute = null;
  var prefs = null;
  var processView = 'steps';

  function init(options) {
    host = document.getElementById('detail');
    onNavigate = options.onNavigate || onNavigate;
    prefs = options.prefs || {};
    processView = prefs.processView || 'steps';
    host.addEventListener('click', handleAction);
  }

  function e(text) { return Data.escapeHtml(text); }
  function f(spec, opts) { return Edit.field(spec, opts); }

  function paint(html) {
    var top = host.scrollTop;
    host.innerHTML = html;
    host.scrollTop = currentRoute === location.hash ? top : 0;
    currentRoute = location.hash;
    Array.prototype.forEach.call(host.querySelectorAll('[data-route]'), function (node) {
      node.addEventListener('click', function () { onNavigate(node.dataset.route); });
    });
  }

  /** Re-render whatever is on screen, after a change that alters structure. */
  function refresh() {
    if (global.App) global.App.route();
  }

  // ---- option lists --------------------------------------------------------

  function departmentOptions() {
    return Data.state.processes.taxonomy.map(function (n) {
      return { value: n.id, label: Data.taxonomyPath(n.id) };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function options(values) {
    return values.map(function (v) { return { value: v, label: v }; });
  }

  var STATUS = ['draft', 'mapped', 'reviewed', 'published', 'needs_rework'];
  var STEP_TYPES = ['entry', 'action', 'decision', 'resolution'];
  var STEP_LABEL = {
    entry: 'Entry', action: 'Action', decision: 'Decision', resolution: 'Resolution'
  };

  // ---- structural actions --------------------------------------------------

  function handleAction(event) {
    var node = event.target.closest('[data-act]');
    if (!node) return;
    event.stopPropagation();
    var act = node.dataset.act;
    var d = node.dataset;

    if (act === 'view') {
      processView = d.view;
      prefs.processView = processView;
      Storage.savePrefs(prefs);
      refresh();
      return;
    }
    if (act === 'add-step') { Edit.addStep(d.process, d.step); refresh(); }
    if (act === 'del-step' && confirm('Delete this step?')) { Edit.deleteStep(d.process, d.step); refresh(); }
    if (act === 'up') { Edit.moveStep(d.process, d.step, -1); refresh(); }
    if (act === 'down') { Edit.moveStep(d.process, d.step, 1); refresh(); }
    if (act === 'add-check') { Edit.addCheck(d.process, d.step); refresh(); }
    if (act === 'del-check') { Edit.deleteCheck(d.process, d.step, d.check); refresh(); }
    if (act === 'resolve-issue') { Edit.resolveIssue(d.process, d.issue); refresh(); }
    if (act === 'verify') {
      var by = prompt('Verified by (name or department):', '');
      if (by !== null) { Edit.verifyVariable(d.variable, by); refresh(); }
    }
    if (act === 'copy-verification') {
      copy(Exporter.verificationText(d.owner || ''), node);
    }
    if (act === 'sheet-verification') Exporter.download(
      'verification-' + (d.owner || 'all') + '.html',
      Exporter.verificationHtml(d.owner || ''), 'text/html');
    if (act === 'export-process-json') Exporter.processJson(d.process);
    if (act === 'export-process-html') Exporter.processHtml(d.process);
    if (act === 'export-issues-html') Exporter.issuesHtml();
    if (act === 'export-issues-csv') Exporter.issuesCsv();
  }

  function copy(text, button) {
    var done = function () {
      var original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = original; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    try { document.execCommand('copy'); done(); } catch (err) { /* nothing to do */ }
    box.remove();
  }

  // ---- process -------------------------------------------------------------

  function renderProcess(id) {
    var p = Data.state.index.processes[id];
    if (!p) return paint(notFound('process', id));
    var pid = p.id;

    // The map wants the whole window; the step list wants a reading width.
    var html = '<article class="pane' + (processView === 'map' ? ' wide' : '') + '">' +
      '<header class="pane-head">' +
      '<div class="crumbs">' + e(Data.taxonomyPath(p.taxonomyId)) + '</div>' +
      '<h1 class="editable-h1">' + f('process:' + pid + ':name') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(p.status) + '">' +
      f('process:' + pid + ':status', { type: 'select', options: options(STATUS) }) + '</span>' +
      (p.handoffs
        ? '<span class="badge warn">⇄ ' + p.handoffs + ' handoff' +
          (p.handoffs > 1 ? 's' : '') + ' across ' + p.departments.length + ' departments</span>'
        : '') +
      '<span class="badge quiet">' + p.steps.length + ' steps</span>' +
      '</div>' +
      '<div class="lede">' + f('process:' + pid + ':purpose',
        { placeholder: 'What this process is for' }) + '</div>' +
      '<div class="row-actions">' +
      btn('export-process-html', { process: pid }, '⤓ HTML') +
      btn('export-process-json', { process: pid }, '⤓ JSON') +
      '</div></header>';

    html += '<div class="view-toggle">' +
      '<button class="vt' + (processView === 'steps' ? ' on' : '') +
      '" data-act="view" data-view="steps">Steps</button>' +
      '<button class="vt' + (processView === 'map' ? ' on' : '') +
      '" data-act="view" data-view="map">Map</button></div>';

    if (p.issues.length) html += renderIssues(p.issues, p);

    if (processView === 'map') {
      html += '<section class="canvas-host" id="canvasHost"></section>';
    } else {
      html += '<section class="flow">' +
        p.steps.map(function (step, i) { return renderStep(step, i, p); }).join('') +
        '<div class="add-step-row">' +
        btn('add-step', { process: pid }, '+ Add step at the end') +
        '</div></section>';
    }

    var refs = p.custom && p.custom.references;
    if (refs && refs.length) {
      html += '<section class="block"><h2>References</h2><ul class="refs">' +
        refs.map(function (r) { return '<li>' + Data.resolveText(r) + '</li>'; }).join('') +
        '</ul></section>';
    }

    html += '<section class="block meta"><h2>Details</h2><dl>' +
      '<dt>Entry point</dt><dd>' + f('process:' + pid + ':entryPoint',
        { placeholder: 'e.g. Phone, counter' }) + '</dd>' +
      '<dt>Definition of resolution</dt><dd>' + f('process:' + pid + ':resolutionDefinition',
        { type: 'multiline', placeholder: 'What does done look like?' }) + '</dd>' +
      '<dt>Process owner</dt><dd>' + f('process:' + pid + ':owner',
        { placeholder: 'Manager accountable' }) + '</dd>' +
      '<dt>Last reviewed</dt><dd>' + f('process:' + pid + ':lastReviewed',
        { placeholder: 'YYYY-MM-DD' }) + '</dd>' +
      '<dt>Sits under</dt><dd>' + f('process:' + pid + ':taxonomyId',
        { type: 'select', options: departmentOptions() }) + '</dd>' +
      '<dt>Departments involved</dt><dd>' +
      e(p.departments.map(Data.taxonomyName).join(', ')) + '</dd>' +
      '</dl></section></article>';

    paint(html);

    if (processView === 'map') {
      Canvas.mount(pid, document.getElementById('canvasHost'), prefs);
    }
  }

  function renderStep(step, i, p) {
    var spec = 'step:' + p.id + ':' + step.id + ':';
    var html = '';

    if (step.isHandoff) {
      html += '<div class="handoff-marker">Handoff to ' +
        e(Data.taxonomyName(step.departmentId)) + '</div>';
    }

    html += '<div class="step step-' + e(step.type) + '" id="step-' + e(step.id) + '">' +
      '<div class="step-head">' +
      '<span class="step-n">' + (i + 1) + '</span>' +
      '<span class="step-type">' + f(spec + 'type',
        { type: 'select', options: STEP_TYPES.map(function (t) {
          return { value: t, label: STEP_LABEL[t] }; }) }) + '</span>' +
      '<h3>' + f(spec + 'title', { placeholder: 'Step name' }) + '</h3>' +
      '<span class="step-tools">' +
      btn('up', { process: p.id, step: step.id }, '↑') +
      btn('down', { process: p.id, step: step.id }, '↓') +
      btn('add-step', { process: p.id, step: step.id }, '+') +
      btn('del-step', { process: p.id, step: step.id }, '×', 'danger') +
      '</span></div>' +

      '<div class="step-meta">' +
      '<span class="pill dept">' + f(spec + 'departmentId',
        { type: 'select', options: departmentOptions() }) + '</span>' +
      '<span class="pill">' + f(spec + 'responsibleRole', { placeholder: 'Role' }) + '</span>' +
      '<span class="pill">' + f(spec + 'timeframe', { placeholder: 'Timeframe' }) + '</span>' +
      '<span class="pill">↑ ' + f(spec + 'escalationPoint', { placeholder: 'Escalation' }) + '</span>' +
      '</div>' +

      '<div class="field-label">Say this</div>' +
      '<blockquote class="script">' + f(spec + 'script',
        { type: 'multiline', placeholder: 'What the officer says' }) + '</blockquote>' +

      '<div class="field-label">Do this</div>' +
      '<div class="sop">' + f(spec + 'sop',
        { type: 'multiline', placeholder: 'The procedure for this step' }) + '</div>' +

      '<div class="field-label">Check' +
      btn('add-check', { process: p.id, step: step.id }, '+', 'tiny') + '</div>' +
      '<ul class="checks">' + (step.checks || []).map(function (c) {
        return '<li>' + Edit.field('check:' + p.id + ':' + step.id + ':' + c.id,
          { placeholder: 'Something to check' }) +
          btn('del-check', { process: p.id, step: step.id, check: c.id }, '×', 'tiny danger') +
          '</li>';
      }).join('') + '</ul>';

    if (step.articleRefs && step.articleRefs.length) {
      html += '<div class="attached">' + step.articleRefs.map(function (ref) {
        var a = Data.state.index.articles[ref];
        return '<button class="chip-link" data-route="#/article/' + e(ref) + '">📖 ' +
          e(a ? a.title : ref) + '</button>';
      }).join('') + '</div>';
    }

    html += '<div class="trigger"><strong>Done when:</strong> ' +
      f(spec + 'completionTrigger', { placeholder: 'What signals this step is finished' }) +
      '</div></div>';

    return html;
  }

  function renderIssues(issues, p) {
    return '<section class="block issues"><h2>Issues</h2>' + issues.map(function (issue) {
      var step = (p.steps || []).find(function (s) { return s.id === issue.stepId; });
      return '<div class="issue-row sev-' + e(issue.severity) + '">' +
        '<span class="sev">' + e(issue.severity) + '</span>' +
        '<div class="issue-body"><p>' + e(issue.note) + '</p>' +
        '<span class="issue-meta">' + e(issue.raisedBy) + ' · ' + e(issue.raised) +
        (step ? ' · step: ' + e(step.title) : '') + '</span></div>' +
        btn('resolve-issue', { process: p.id, issue: issue.id }, 'Resolve', 'tiny') +
        '</div>';
    }).join('') + '</section>';
  }

  function btn(act, data, label, extra) {
    var attrs = Object.keys(data || {}).map(function (k) {
      return ' data-' + k + '="' + e(data[k]) + '"';
    }).join('');
    return '<button class="btn ' + (extra || 'small') + '" data-act="' + act + '"' +
      attrs + '>' + e(label) + '</button>';
  }

  // ---- article and FAQ -----------------------------------------------------

  function renderArticle(id) {
    var a = Data.state.index.articles[id];
    if (!a) return paint(notFound('article', id));
    var usage = Data.state.index.usage[id] || { processes: [], steps: 0 };

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">Knowledge base</div>' +
      '<h1 class="editable-h1">' + f('article:' + id + ':title') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(a.status) + '">' + f('article:' + id + ':status',
        { type: 'select', options: options(['draft', 'review', 'current']) }) + '</span>' +
      '<span class="badge quiet">' + f('article:' + id + ':audience',
        { type: 'select', options: options(['internal', 'public', 'both']) }) + '</span>' +
      '<span class="badge quiet">' + f('article:' + id + ':ownerId',
        { type: 'select', options: departmentOptions() }) + '</span>' +
      (a.internal ? '<span class="badge lock">🔒 internal</span>' : '') +
      '</div>' + renderUsage(usage) + '</header>' +
      '<section class="block"><h2>Body</h2>' +
      f('article:' + id + ':body', { type: 'html', placeholder: 'Write the article' }) +
      '</section></article>');
  }

  function renderFaq(id) {
    var q = Data.state.index.faqs[id];
    if (!q) return paint(notFound('FAQ question', id));

    var tabs = Data.state.library.publishTabs.map(function (t) {
      return { value: t.id, label: t.label };
    });

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">FAQ · published</div>' +
      '<h1 class="editable-h1">' + f('faq:' + id + ':q') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(q.status) + '">' + f('faq:' + id + ':status',
        { type: 'select', options: options(['draft', 'review', 'approved', 'published']) }) +
      '</span>' +
      '<span class="badge quiet">' + f('faq:' + id + ':ownerId',
        { type: 'select', options: departmentOptions() }) + '</span>' +
      (q.lastReviewed ? '<span class="badge quiet">' + e(q.lastReviewed) + '</span>' : '') +
      '</div></header>' +
      '<section class="block"><h2>Answer — public wording</h2>' +
      f('faq:' + id + ':a', { type: 'html', placeholder: 'Write the answer' }) +
      '</section></article>');
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
      return listRow('#/article/' + a.id, a.title, Data.taxonomyPath(a.ownerId),
        usage.processes.length ? usage.processes.length + ' uses' : 'unused');
    }).join('')));
  }

  function renderFaqList() {
    var byTab = {};
    Data.state.library.faqs.forEach(function (q) {
      var tab = (q.publish && q.publish.tabId) || 'unassigned';
      (byTab[tab] = byTab[tab] || []).push(q);
    });
    var html = Object.keys(byTab).map(function (tab) {
      return '<h2 class="group">' + e(tab) + ' <span>' + byTab[tab].length + '</span></h2>' +
        byTab[tab].map(function (q) {
          return listRow('#/faq/' + q.id, q.q, q.ownerId ? Data.taxonomyName(q.ownerId) : '', '');
        }).join('');
    }).join('');
    paint(listPane('FAQ questions',
      Data.state.library.faqs.length + ' questions across ' +
      Data.state.library.publishTabs.length + ' published tabs', html));
  }

  function renderVariableList() {
    var byOwner = {};
    Data.state.variables.variables.forEach(function (v) {
      (byOwner[v.ownerId || 'unassigned'] = byOwner[v.ownerId || 'unassigned'] || []).push(v);
    });

    var html = Object.keys(byOwner).sort().map(function (owner) {
      var list = byOwner[owner];
      var pending = list.filter(function (v) { return v.status === 'pending'; }).length;
      return '<div class="owner-group"><h2 class="group">' +
        e(owner === 'unassigned' ? 'Unassigned' : Data.taxonomyPath(owner)) +
        ' <span>' + list.length + (pending ? ' · ' + pending + ' pending' : '') + '</span>' +
        '<span class="group-actions">' +
        btn('copy-verification', { owner: owner === 'unassigned' ? '' : owner },
          '⧉ Copy verification email', 'tiny') +
        btn('sheet-verification', { owner: owner === 'unassigned' ? '' : owner },
          '⤓ Sheet', 'tiny') +
        '</span></h2>' +
        list.map(function (v) {
          var usage = Data.state.index.usage[v.id] || { processes: [] };
          return '<button class="list-row" data-route="#/variable/' + e(v.id) + '">' +
            '<span class="list-title">' + e(v.value) +
            (v.internal ? ' <span class="lock">🔒</span>' : '') + '</span>' +
            '<span class="list-sub">' + e(v.question) + '</span>' +
            '<span class="list-tail">' + (usage.processes.length || 0) + ' uses · ' +
            e(v.status) + '</span></button>';
        }).join('') + '</div>';
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

    var used = usage.processes.map(function (ownerId) {
      var p = Data.state.index.processes[ownerId];
      if (p) return listRow('#/process/' + p.id, p.name, Data.taxonomyPath(p.taxonomyId), '');
      var a = Data.state.index.articles[ownerId];
      if (a) return listRow('#/article/' + a.id, a.title, 'Knowledge base', '');
      var q = Data.state.index.faqs[ownerId];
      if (q) return listRow('#/faq/' + q.id, q.q, 'FAQ', '');
      return '';
    }).join('');

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">Variable</div>' +
      '<h1 class="editable-h1">' + f('variable:' + id + ':value') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(v.status) + '">' + f('variable:' + id + ':status',
        { type: 'select', options: options(['pending', 'current', 'stale']) }) + '</span>' +
      '<span class="badge quiet">' + f('variable:' + id + ':type',
        { type: 'select', options: options(
          ['text', 'money', 'url', 'phone', 'email', 'time', 'date', 'system', 'form', 'org']) }) +
      '</span>' +
      '<span class="badge quiet">' + f('variable:' + id + ':ownerId',
        { type: 'select', options: departmentOptions() }) + '</span>' +
      (v.internal ? '<span class="badge lock">🔒 internal</span>' : '') +
      '</div>' +
      '<div class="lede">' + f('variable:' + id + ':question',
        { placeholder: 'What you would ask the department' }) + '</div>' +
      '<div class="note">' + f('variable:' + id + ':note',
        { placeholder: 'Optional context for the department' }) + '</div>' +
      '<div class="row-actions">' +
      btn('verify', { variable: id }, '✓ Mark verified') +
      btn('copy-verification', { owner: v.ownerId || '' }, '⧉ Copy verification email') +
      '</div></header>' +

      '<section class="block meta"><h2>Verification</h2><dl>' +
      '<dt>Last verified</dt><dd>' + e(v.lastVerified || '— never —') + '</dd>' +
      '<dt>Verified by</dt><dd>' + e(v.verifiedBy || '—') + '</dd>' +
      '<dt>Identifier</dt><dd><code>' + e(v.id) + '</code></dd>' +
      '<dt>Internal only</dt><dd>' + f('variable:' + id + ':internal',
        { type: 'select', options: [{ value: true, label: 'Yes — never publish' },
          { value: false, label: 'No — safe to publish' }] }) + '</dd>' +
      '</dl></section>' +

      '<section class="block"><h2>Used in ' + usage.processes.length + ' place' +
      (usage.processes.length === 1 ? '' : 's') + '</h2>' +
      (used || '<p class="empty">Not referenced anywhere yet.</p>') +
      '</section></article>');
  }

  function renderIssueRegister() {
    var all = Data.allIssues();
    var counts = { high: 0, medium: 0, low: 0 };
    all.forEach(function (x) { counts[x.issue.severity]++; });

    var html = '<div class="row-actions">' +
      btn('export-issues-html', {}, '⤓ Report (HTML)') +
      btn('export-issues-csv', {}, '⤓ CSV') +
      '</div>' +
      all.map(function (entry) {
        return '<button class="list-row issue-list sev-' + e(entry.issue.severity) + '"' +
          ' data-route="#/process/' + e(entry.process.id) + '">' +
          '<span class="sev">' + e(entry.issue.severity) + '</span>' +
          '<span class="list-title">' + e(entry.process.name) + '</span>' +
          '<span class="list-sub">' + e(entry.issue.note) + '</span>' +
          '</button>';
      }).join('');

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
      '<kbd>/</kbd> to search. Click any field to edit it.</p></header>' +
      '<section class="tiles">' +
      tile(processes.length, 'processes', drafts.length + ' still draft', '') +
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
      crossing.slice().sort(function (a, b) { return b.handoffs - a.handoffs; })
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
