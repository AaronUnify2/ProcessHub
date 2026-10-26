/* ===========================================================================
   ui-sidebar.js — the left-hand menu, and the search that sits over it.

   Two sections, switched at the top:

     Processes  the department tree. It shows the shape of the work, which is
                what makes the coverage legible to someone reading over your
                shoulder.
     FAQ        the publish tabs, each with its questions and section headings
                in published order — the public FAQ page, as a list you can
                rearrange. Drag a row to move it (into another tab too), or use
                ↑ ↓ on the open question, which also works on a phone.

   And one each for fact sheets, variables, the issues register, content
   rules, departments and Probe: a list to jump straight to anything,
   while the content area shows that section's dashboard. Probe's list is
   the questions probed lately and the content gaps still open. Variables nest
   department › sub-department › source document › value, so you can see
   where each figure comes from as well as who owns it.

   Search is one keystroke away everywhere. In the FAQ, fact sheets and
   variables sections it searches only that kind of content.
   =========================================================================== */

(function (global) {
  'use strict';

  var el = {};
  var prefs = {};
  var onNavigate = function () {};
  var view = { section: 'processes', active: null };

  // Where each section's button leads: its dashboard.
  var SECTION_HOME = {
    processes: '#/', faq: '#/faqs', factsheets: '#/factsheets', variables: '#/variables',
    issues: '#/issues', rules: '#/rules', departments: '#/departments', probe: '#/probe'
  };

  // Sections whose search looks at one kind of content only.
  var SEARCH_KIND = { faq: 'faq', factsheets: 'factsheet', variables: 'variable' };
  var PLACEHOLDER = {
    faq: 'Search FAQ questions…', factsheets: 'Search fact sheets…', variables: 'Search variables…'
  };

  function e(text) { return Data.escapeHtml(text); }

  function init(options) {
    el.search = document.getElementById('sidebarSearch');
    el.results = document.getElementById('searchResults');
    el.tree = document.getElementById('tree');
    el.count = document.getElementById('sidebarCount');
    el.body = document.querySelector('.sidebar-body');
    el.switcher = document.getElementById('sectionSwitch');
    prefs = options.prefs || {};
    onNavigate = options.onNavigate || onNavigate;

    if (!prefs.collapsed) prefs.collapsed = {};
    if (!prefs.faqCollapsed) prefs.faqCollapsed = {};
    if (!prefs.sideCollapsed) prefs.sideCollapsed = {};

    el.search.addEventListener('input', function () { renderSearch(); });
    el.search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        el.search.value = '';
        renderSearch();
        el.search.blur();
      }
      if (ev.key === 'Enter') {
        var first = el.results.querySelector('.result');
        if (first) first.click();
      }
    });

    // "/" and Ctrl/Cmd+K both jump to search, unless you are already typing.
    document.addEventListener('keydown', function (ev) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) ||
        document.activeElement.isContentEditable;
      if ((ev.key === '/' && !typing) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) {
        ev.preventDefault();
        el.search.focus();
        el.search.select();
      }
    });

    el.switcher.addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-section]');
      if (!button) return;
      onNavigate(SECTION_HOME[button.dataset.section] || '#/');
    });

    // One set of listeners for the whole tree, rather than one per row.
    el.tree.addEventListener('click', onTreeClick);
    el.tree.addEventListener('dragstart', onDragStart);
    el.tree.addEventListener('dragover', onDragOver);
    el.tree.addEventListener('dragleave', onDragLeave);
    el.tree.addEventListener('drop', onDrop);
    el.tree.addEventListener('dragend', onDragEnd);
  }

  /**
   * Draw the menu. state is { section, active } — the section to show and
   * the id of whatever is open, so it can be highlighted. With no state, the
   * last one is redrawn (after an edit, say).
   */
  function render(state) {
    if (state) {
      if (state.section) view.section = state.section;
      view.active = state.active || null;
    }
    Array.prototype.forEach.call(el.switcher.querySelectorAll('[data-section]'), function (b) {
      b.classList.toggle('on', b.dataset.section === view.section);
    });
    el.search.placeholder = PLACEHOLDER[view.section] || 'Search everything…';

    // Keep the scroll position: the menu redraws on every edit.
    var top = el.body.scrollTop;
    var draw = {
      faq: renderFaqTree,
      factsheets: renderFactSheetsTree,
      variables: renderVariablesTree,
      issues: renderIssuesTree,
      rules: renderRulesTree,
      departments: renderDepartmentsTree,
      probe: renderProbeTree
    }[view.section] || renderTree;
    draw();
    el.body.scrollTop = top;
    // Arriving somewhere new (a link, a breadcrumb), bring what is open into
    // view; a redraw after an edit leaves the menu where it was.
    if (state) {
      var shown = el.tree.querySelector('.side-row.active, .side-group-head.active');
      if (shown && shown.scrollIntoView) shown.scrollIntoView({ block: 'nearest' });
    }
    if (el.search.value.trim().length >= 2) renderSearch();
  }

  // ---- search results ------------------------------------------------------

  var KIND_LABEL = {
    process: 'Process', factsheet: 'Fact sheet', faq: 'FAQ', variable: 'Variable'
  };

  function renderSearch() {
    var query = el.search.value.trim();
    if (query.length < 2) {
      el.results.hidden = true;
      el.tree.hidden = false;
      el.results.innerHTML = '';
      return;
    }

    var only = SEARCH_KIND[view.section];
    var matches = Data.search(query, only ? 300 : 50);
    if (only) {
      matches = matches.filter(function (m) { return m.kind === only; }).slice(0, 50);
    }
    el.tree.hidden = true;
    el.results.hidden = false;

    if (!matches.length) {
      el.results.innerHTML = '<p class="empty">Nothing matches “' + e(query) + '”.</p>';
      return;
    }

    el.results.innerHTML = matches.map(function (m) {
      return '<button class="result" data-route="' + m.route + '">' +
        '<span class="kind kind-' + m.kind + '">' + KIND_LABEL[m.kind] + '</span>' +
        '<span class="result-body">' +
        '<span class="result-title">' + e(m.title) + '</span>' +
        (m.subtitle ? '<span class="result-sub">' + e(m.subtitle) + '</span>' : '') +
        '</span></button>';
    }).join('');

    Array.prototype.forEach.call(el.results.querySelectorAll('.result'), function (node) {
      node.addEventListener('click', function () {
        onNavigate(node.dataset.route);
      });
    });
  }

  // ---- clicks anywhere in the tree -----------------------------------------

  function onTreeClick(ev) {
    var node;

    if ((node = ev.target.closest('[data-toggle]'))) {
      ev.stopPropagation();
      var id = node.dataset.toggle;
      prefs.collapsed[id] = !prefs.collapsed[id];
      Storage.savePrefs(prefs);
      render();
      return;
    }
    if ((node = ev.target.closest('[data-faq-toggle]'))) {
      ev.stopPropagation();
      var key = node.dataset.faqToggle;
      prefs.faqCollapsed[key] = !prefs.faqCollapsed[key];
      Storage.savePrefs(prefs);
      render();
      return;
    }
    if ((node = ev.target.closest('[data-new-process]'))) {
      ev.stopPropagation();
      var name = prompt('Name of the new process in ' +
        Data.taxonomyPath(node.dataset.newProcess) + ':', '');
      if (!name || !name.trim()) return;
      onNavigate('#/process/' + Edit.createProcess(node.dataset.newProcess, name.trim()));
      return;
    }
    if ((node = ev.target.closest('[data-side-toggle]'))) {
      ev.stopPropagation();
      var sk = node.dataset.sideToggle;
      prefs.sideCollapsed[sk] = !isCollapsed(sk);
      Storage.savePrefs(prefs);
      render();
      return;
    }
    if ((node = ev.target.closest('[data-side-act]'))) {
      ev.stopPropagation();
      sideAction(node.dataset.sideAct);
      return;
    }
    if ((node = ev.target.closest('[data-faq-act]'))) {
      ev.stopPropagation();
      faqAction(node.dataset.faqAct, node.dataset);
      return;
    }
    if ((node = ev.target.closest('[data-route]'))) {
      onNavigate(node.dataset.route);
    }
  }

  // ---- the process tree ----------------------------------------------------

  function renderTree() {
    var index = Data.state.index;
    var roots = index.children.__root__ || [];
    el.tree.innerHTML = roots.map(function (node) {
      return renderNode(node, index, 0);
    }).join('');

    el.count.textContent = Data.state.processes.processes.length + ' processes · ' +
      Data.state.library.factSheets.length + ' fact sheets · ' +
      Data.state.library.faqs.length + ' FAQs';
  }

  function renderNode(node, index, depth) {
    var children = index.children[node.id] || [];
    var processes = index.byTaxonomy[node.id] || [];
    var count = Data.processCount(node.id);
    var collapsed = prefs.collapsed[node.id];
    var hasContent = children.length || processes.length;

    var html = '<div class="tree-node depth-' + depth + '">' +
      '<div class="tree-head' + (collapsed ? ' collapsed' : '') + '">' +
      (hasContent
        ? '<button class="caret" data-toggle="' + e(node.id) + '" aria-label="Expand or collapse">' +
          (collapsed ? '▸' : '▾') + '</button>'
        : '<span class="caret empty"></span>') +
      '<span class="tree-label">' + e(node.name) + '</span>' +
      (count ? '<span class="tree-count">' + count + '</span>' : '') +
      '<button class="tree-add" data-new-process="' + e(node.id) + '" ' +
      'title="New process in ' + e(node.name) + '" aria-label="New process in ' +
      e(node.name) + '">+</button>' +
      '</div>';

    if (!collapsed) {
      html += '<div class="tree-children">';
      children.forEach(function (child) { html += renderNode(child, index, depth + 1); });
      processes.forEach(function (p) { html += renderProcessRow(p); });
      html += '</div>';
    }
    return html + '</div>';
  }

  function renderProcessRow(p) {
    var flags = '';
    var handoffs = Data.flow(p).handoffs;
    if (handoffs) {
      flags += '<span class="flag handoff" title="' + handoffs +
        ' department handoff(s)">⇄ ' + handoffs + '</span>';
    }
    var high = Data.openIssues(p).filter(function (i) { return i.severity === 'high'; }).length;
    if (high) {
      flags += '<span class="flag issue" title="' + high +
        ' high severity issue(s)">● ' + high + '</span>';
    }
    return '<button class="tree-process' + (p.id === view.active ? ' active' : '') +
      '" data-route="#/process/' + e(p.id) + '">' +
      '<span class="status-dot status-' + e(p.status) + '" title="' + e(p.status) + '"></span>' +
      '<span class="tree-process-name">' + e(p.name) + '</span>' +
      flags + '</button>';
  }

  // ---- the FAQ tree --------------------------------------------------------

  function questionText(f) {
    return Data.plainText(f.q) || '(empty question)';
  }

  function renderFaqTree() {
    var tabs = Data.state.library.publishTabs;
    var unpublished = FaqOrder.questionsIn(FaqOrder.UNPUBLISHED);

    // The tab holding the open question is always expanded.
    var openTab = null;
    if (view.active && Data.state.index.faqs[view.active]) {
      openTab = (Data.state.index.faqs[view.active].publish || {}).tabId || FaqOrder.UNPUBLISHED;
    }

    var html = tabs.map(function (tab) {
      return renderFaqTab(tab.id, Data.plainText(tab.label), tab['new'], openTab);
    }).join('');
    html += renderFaqTab(FaqOrder.UNPUBLISHED, 'Not published', false, openTab);
    html += '<div class="faq-tree-foot">' +
      '<button class="btn tiny" data-faq-act="new-tab">+ New tab</button></div>';
    el.tree.innerHTML = html;

    var total = Data.state.library.faqs.length;
    el.count.textContent = tabs.length + ' tabs · ' + total + ' questions' +
      (unpublished.length ? ' · ' + unpublished.length + ' not published' : '');
  }

  function renderFaqTab(tabId, label, isNew, openTab) {
    var key = tabId || '_unpublished';
    var rows = FaqOrder.rows(tabId);
    var count = rows.filter(function (r) { return r.type === 'faq'; }).length;
    var collapsed = prefs.faqCollapsed[key] && openTab !== tabId;
    var activeTab = view.active === 'tab:' + tabId;

    var html = '<div class="faq-tab' + (tabId ? '' : ' unpublished') + '">' +
      '<div class="faq-tab-head' + (activeTab ? ' active' : '') + '" data-drop-tab="' + e(tabId) + '">' +
      '<button class="caret" data-faq-toggle="' + e(key) + '" aria-label="Expand or collapse">' +
      (collapsed ? '▸' : '▾') + '</button>' +
      (tabId
        ? '<button class="faq-tab-name" data-route="#/tab/' + e(tabId) + '" ' +
          'title="Tab settings: intro, footer, step strip">' + e(label) + '</button>'
        : '<span class="faq-tab-name quiet">' + e(label) + '</span>') +
      (isNew ? '<span class="faq-new">NEW</span>' : '') +
      '<span class="tree-count">' + count + '</span>' +
      '</div>';

    if (!collapsed) {
      html += '<div class="faq-rows" data-drop-tab="' + e(tabId) + '">' +
        rows.map(function (row, i) { return renderFaqRow(row, i, tabId, rows.length); }).join('') +
        (tabId || !count
          ? '<div class="faq-add" data-drop-tab="' + e(tabId) + '">' +
            '<button class="btn tiny" data-faq-act="add-question" data-tab="' + e(tabId) +
            '">+ Question</button>' +
            (tabId
              ? '<button class="btn tiny" data-faq-act="add-heading" data-tab="' + e(tabId) +
                '">+ Heading</button>'
              : '') +
            '</div>'
          : '') +
        '</div>';
    }
    return html + '</div>';
  }

  function renderFaqRow(row, index, tabId, total) {
    var attrs = ' draggable="true" data-row-tab="' + e(tabId) + '" data-row-index="' + index + '"';
    var nudge = function (show) {
      if (!show) return '';
      return '<span class="faq-nudge">' +
        '<button class="faq-mini" data-faq-act="up" data-tab="' + e(tabId) + '" data-index="' + index +
        '"' + (index === 0 ? ' disabled' : '') + ' aria-label="Move up" title="Move up">↑</button>' +
        '<button class="faq-mini" data-faq-act="down" data-tab="' + e(tabId) + '" data-index="' +
        index + '"' + (index >= total - 1 ? ' disabled' : '') +
        ' aria-label="Move down" title="Move down">↓</button></span>';
    };

    if (row.type === 'group') {
      return '<div class="faq-row faq-heading' + (row.pending ? ' pending' : '') + '"' + attrs +
        (row.pending ? ' title="Move a question under this heading to keep it"' : '') + '>' +
        '<span class="grip" aria-hidden="true">⋮⋮</span>' +
        '<span class="faq-heading-text">' + e(row.title) + '</span>' +
        nudge(true) +
        '<button class="faq-mini" data-faq-act="rename-heading" data-tab="' + e(tabId) +
        '" data-index="' + index + '" aria-label="Rename heading" title="Rename heading">✎</button>' +
        '<button class="faq-mini danger" data-faq-act="delete-heading" data-tab="' + e(tabId) +
        '" data-index="' + index + '" aria-label="Remove heading" title="Remove heading">×</button>' +
        '</div>';
    }

    var f = row.faq;
    var active = f.id === view.active;
    var draft = f.status && f.status !== 'published' && f.status !== 'approved';
    return '<div class="faq-row faq-question' + (active ? ' active' : '') + '"' + attrs +
      ' data-route="#/faq/' + e(f.id) + '">' +
      '<span class="grip" aria-hidden="true">⋮⋮</span>' +
      (draft ? '<span class="status-dot status-draft" title="' + e(f.status) + '"></span>' : '') +
      '<span class="faq-q-text">' + e(questionText(f)) + '</span>' +
      nudge(active) +
      '</div>';
  }

  function faqAction(act, d) {
    var tabId = d.tab || '';
    var index = Number(d.index);
    var name;

    if (act === 'up' || act === 'down') {
      FaqOrder.nudge(tabId, index, act === 'up' ? -1 : 1);
      if (global.App) App.route();
    }
    if (act === 'add-question') {
      name = prompt('The new question, as a customer would ask it:', '');
      if (name && name.trim()) onNavigate('#/faq/' + FaqOrder.addQuestion(tabId, name.trim()));
    }
    if (act === 'add-heading') {
      name = prompt('Section heading:', '');
      if (name && name.trim()) {
        FaqOrder.addHeading(tabId, name.trim());
        render();
      }
    }
    if (act === 'rename-heading') {
      var current = FaqOrder.rows(tabId)[index];
      name = prompt('Rename the heading:', current ? current.title : '');
      if (name && name.trim()) {
        FaqOrder.renameHeading(tabId, index, name.trim());
        if (global.App) App.route();
      }
    }
    if (act === 'delete-heading') {
      if (confirm('Remove this heading? Its questions stay where they are, under the heading above.')) {
        FaqOrder.deleteHeading(tabId, index);
        if (global.App) App.route();
      }
    }
    if (act === 'new-tab') {
      name = prompt('Label for the new tab on the FAQ page:', '');
      if (name && name.trim()) onNavigate('#/tab/' + FaqOrder.createTab(name.trim()));
    }
  }

  // ---- dragging FAQ rows ---------------------------------------------------

  var drag = null;

  function clearMarks() {
    Array.prototype.forEach.call(el.tree.querySelectorAll('.drop-before, .drop-after, .drop-into'),
      function (n) { n.classList.remove('drop-before', 'drop-after', 'drop-into'); });
  }

  function onDragStart(ev) {
    var row = ev.target.closest('[data-row-index]');
    if (!row) return;
    drag = { tab: row.dataset.rowTab, index: Number(row.dataset.rowIndex) };
    ev.dataTransfer.effectAllowed = 'move';
    // Firefox will not start a drag without some data.
    ev.dataTransfer.setData('text/plain', 'faq-row');
    row.classList.add('dragging');
  }

  /** Where a drop at this point would land: { tab, index, node, mark } or null. */
  function dropTarget(ev) {
    var row = ev.target.closest('[data-row-index]');
    if (row) {
      var box = row.getBoundingClientRect();
      var after = ev.clientY > box.top + box.height / 2;
      return {
        tab: row.dataset.rowTab,
        index: Number(row.dataset.rowIndex) + (after ? 1 : 0),
        node: row,
        mark: after ? 'drop-after' : 'drop-before'
      };
    }
    var zone = ev.target.closest('[data-drop-tab]');
    if (zone) {
      var tab = zone.dataset.dropTab;
      return { tab: tab, index: FaqOrder.rows(tab).length, node: zone, mark: 'drop-into' };
    }
    return null;
  }

  function onDragOver(ev) {
    if (!drag) return;
    var target = dropTarget(ev);
    if (!target) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    clearMarks();
    target.node.classList.add(target.mark);
  }

  function onDragLeave(ev) {
    if (ev.target.classList) ev.target.classList.remove('drop-before', 'drop-after', 'drop-into');
  }

  function onDrop(ev) {
    if (!drag) return;
    var target = dropTarget(ev);
    clearMarks();
    if (!target) return;
    ev.preventDefault();
    var index = target.index;
    // Within one list, everything below the row being moved shifts up by one
    // once it is lifted out.
    if (target.tab === drag.tab && index > drag.index) index--;
    var from = drag;
    drag = null;
    if (target.tab === from.tab && index === from.index) return;
    FaqOrder.move({ tab: from.tab, index: from.index }, { tab: target.tab, index: index });
    if (global.App) App.route();
  }

  function onDragEnd() {
    drag = null;
    clearMarks();
    Array.prototype.forEach.call(el.tree.querySelectorAll('.dragging'),
      function (n) { n.classList.remove('dragging'); });
  }

  // ---- the other sections -------------------------------------------------
  // Each is a list of groups, each group a list of rows that open an item.

  /**
   * Collapsed state. Resolved issues and each variable source begin
   * collapsed; everything else begins open.
   */
  function isCollapsed(key) {
    if (key in prefs.sideCollapsed) return prefs.sideCollapsed[key];
    return /:resolved$/.test(key) || key.indexOf('variables:src:') === 0;
  }

  function group(key, label, count, rowsHtml, open) {
    var collapsed = isCollapsed(key) && !open;
    return '<div class="side-group">' +
      '<div class="side-group-head">' +
      '<button class="caret" data-side-toggle="' + e(key) + '" aria-label="Expand or collapse">' +
      (collapsed ? '▸' : '▾') + '</button>' +
      '<span class="side-group-name">' + e(label) + '</span>' +
      '<span class="tree-count">' + count + '</span></div>' +
      (collapsed ? '' : '<div class="side-rows">' + rowsHtml + '</div>') +
      '</div>';
  }

  function row(route, active, label, extra, tail, title) {
    return '<button class="side-row' + (active ? ' active' : '') + '" data-route="' + e(route) + '"' +
      (title ? ' title="' + e(title) + '"' : '') + '>' +
      (extra || '') +
      '<span class="side-row-text">' + label + '</span>' +
      (tail ? '<span class="side-tail">' + tail + '</span>' : '') + '</button>';
  }

  function foot(buttons) {
    return '<div class="faq-tree-foot">' + buttons + '</div>';
  }

  function sideAction(act) {
    var name;
    if (act === 'new-factsheet') {
      name = prompt('Title of the new fact sheet:', '');
      if (name && name.trim()) onNavigate('#/factsheet/' + Edit.createFactSheet(name.trim()));
    }
    if (act === 'new-variable') {
      name = prompt('The value (for example $300, or a phone number):', '');
      if (name && name.trim()) onNavigate('#/variable/' + Edit.createVariable(name.trim()));
    }
    if (act === 'new-rule') {
      onNavigate('#/rule/' + Rules.add({
        name: 'New rule', match: { mode: 'phrase', value: '', wholeWord: true }, suggest: '',
        scope: ['process', 'step', 'factsheet', 'faq'], severity: 'medium', message: ''
      }));
    }
    if (act === 'new-dept') {
      name = prompt('Name of the new department:', '');
      if (name && name.trim()) onNavigate('#/department/' + Edit.createTaxonomy(null, name.trim()));
    }
  }

  function usesOf(id) {
    var usage = Data.state.index.usage[id];
    return usage ? usage.processes.length : 0;
  }

  // ---- fact sheets
  // Grouped by where each sheet is in its life rather than by owner: the
  // question this list answers is "what is waiting on whom".

  function renderFactSheetsTree() {
    var sheets = Data.state.library.factSheets;
    var html = Data.FACT_SHEET_STATUSES.map(function (status) {
      var list = sheets.filter(function (s) { return Data.factSheetFacts(s).status === status; })
        .sort(function (a, b) { return a.title.localeCompare(b.title); });
      if (!list.length) return '';
      var open = list.some(function (s) { return s.id === view.active; });
      return group('factsheets:' + status, Data.FACT_SHEET_STATUS_LABEL[status], list.length,
        list.map(function (s) {
          var facts = Data.factSheetFacts(s);
          var tail = facts.signers ? facts.approvedBy + '/' + facts.signers + ' signed' : '';
          return row('#/factsheet/' + s.id, s.id === view.active, e(s.title),
            '<span class="status-dot fs-' + e(facts.status) + '" title="' +
              e(Data.FACT_SHEET_STATUS_LABEL[facts.status]) + '"></span>',
            tail, s.summary || '');
        }).join(''), open);
    }).join('');
    el.tree.innerHTML = (html || '<p class="empty">No fact sheets yet.</p>') +
      foot('<button class="btn tiny" data-side-act="new-factsheet">+ New fact sheet</button>');
    var waiting = sheets.filter(function (s) { return s.status === 'signoff'; }).length;
    el.count.textContent = sheets.length + ' fact sheets' +
      (waiting ? ' · ' + waiting + ' in sign-off' : '');
  }

  // ---- variables

  /**
   * A web address makes a poor label, so URL variables show what they point
   * to — their verification question, less the "Is this still the correct
   * web address for" every one of them starts with.
   */
  function variableLabel(v) {
    if (v.type !== 'url' || !v.question) return String(v.value);
    return v.question
      .replace(/^is this (still )?the (correct|right) (web )?(address|url|link) for (the )?/i, '')
      .replace(/\?$/, '')
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /*
   * The variables tree: department › sub-department › source › value.
   * A department's own values sit under its sources after its
   * sub-departments; a source cited by two departments appears under each,
   * with that department's values only. Its name opens the source's page,
   * which lists all of them.
   */
  function renderVariablesTree() {
    var vars = Data.state.variables.variables;
    var index = Data.state.index;
    var owned = {};
    vars.forEach(function (v) {
      var key = v.ownerId && index.taxonomy[v.ownerId] ? v.ownerId : '';
      (owned[key] = owned[key] || []).push(v);
    });

    // The departments above the open variable stay open, so it can be seen.
    var openPath = {};
    var current = Data.variable(view.active);
    var node = current && index.taxonomy[current.ownerId];
    var guard = 0;
    while (node && guard++ < 50) {
      openPath[node.id] = true;
      node = node.parentId ? index.taxonomy[node.parentId] : null;
    }

    function total(id) {
      var n = (owned[id] || []).length;
      (index.children[id] || []).forEach(function (c) { n += total(c.id); });
      return n;
    }

    function department(dept, depth) {
      var n = total(dept.id);
      if (!n) return '';
      var inner = (index.children[dept.id] || []).map(function (c) {
        return department(c, depth + 1);
      }).join('') + sourceGroups(owned[dept.id] || [], dept.id);
      return branch({ key: 'variables:dept:' + dept.id, label: dept.name, count: n, inner: inner,
        open: openPath[dept.id], kind: depth ? 'sub' : 'dept' });
    }

    var html = (index.children.__root__ || []).map(function (d) { return department(d, 0); }).join('');
    if (owned['']) {
      html += branch({ key: 'variables:dept:', label: 'No owner', count: owned[''].length,
        inner: sourceGroups(owned[''], ''), open: owned[''].indexOf(current) !== -1,
        kind: 'dept' });
    }

    el.tree.innerHTML = html + foot('<button class="btn tiny" data-side-act="new-variable">+ New variable</button>');
    var pending = vars.filter(function (v) { return v.status !== 'current'; }).length;
    el.count.textContent = vars.length + ' variables · ' + Data.sources().length + ' sources · ' +
      pending + ' not yet verified';
  }

  /**
   * One department's own values, by the document each comes from: the
   * most-cited first, then those with no source yet, then the internal ones,
   * which never need one.
   */
  function sourceGroups(list, ownerKey) {
    var groups = {};
    var order = [];
    list.forEach(function (v) {
      var key = Data.sourceKey(v) || (v.internal === true ? ':internal' : ':none');
      if (!groups[key]) {
        groups[key] = { key: key, title: key.charAt(0) === ':' ? '' : (v.source.title || v.source.url), items: [] };
        order.push(groups[key]);
      }
      groups[key].items.push(v);
    });
    var rank = function (g) { return g.key === ':none' ? 1 : g.key === ':internal' ? 2 : 0; };
    order.sort(function (a, b) {
      return rank(a) - rank(b) || b.items.length - a.items.length ||
        String(a.title).localeCompare(String(b.title));
    });
    return order.map(function (g) {
      var sourced = g.key.charAt(0) !== ':';
      var rows = g.items.slice().sort(function (a, b) {
        return variableLabel(a).localeCompare(variableLabel(b));
      }).map(variableRow).join('');
      return branch({
        key: 'variables:src:' + ownerKey + ':' + g.key,
        label: sourced ? g.title : g.key === ':none' ? 'No source yet' : 'Internal — no source needed',
        count: g.items.length, inner: rows,
        open: view.active === 'source:' + g.key || g.items.some(function (v) { return v.id === view.active; }),
        kind: sourced ? 'source' : 'nosource',
        route: sourced ? '#/source/' + encodeURIComponent(g.key) : '',
        active: sourced && view.active === 'source:' + g.key
      });
    }).join('');
  }

  function variableRow(v) {
    var open = Data.openIssues(v).length;
    var tail = (open ? '<span class="side-flag" title="' + open + ' open issue' +
      (open === 1 ? '' : 's') + '">⚑</span>' : '') + (usesOf(v.id) ? '' : 'unused');
    return row('#/variable/' + v.id, v.id === view.active,
      e(variableLabel(v)) + (v.internal === true ? ' 🔒' : ''),
      '<span class="status-dot var-' + e(v.status) + '" title="' + e(v.status) + '"></span>',
      tail, v.question);
  }

  /**
   * A level of the variables tree. A department's name opens and closes it;
   * a source's name opens the source's own page, and its caret opens and
   * closes it.
   */
  function branch(o) {
    var collapsed = isCollapsed(o.key) && !o.open;
    var name = o.route
      ? '<button class="side-group-name side-group-link" data-route="' + e(o.route) + '" title="' +
        e(o.label) + ' — open this source">' + e(o.label) + '</button>'
      : '<button class="side-group-name side-group-link" data-side-toggle="' + e(o.key) + '">' +
        e(o.label) + '</button>';
    return '<div class="side-group var-' + o.kind + '">' +
      '<div class="side-group-head' + (o.active ? ' active' : '') + '">' +
      '<button class="caret" data-side-toggle="' + e(o.key) + '" aria-label="Expand or collapse">' +
      (collapsed ? '▸' : '▾') + '</button>' + name +
      '<span class="tree-count">' + o.count + '</span></div>' +
      (collapsed ? '' : '<div class="side-rows">' + o.inner + '</div>') +
      '</div>';
  }

  // ---- issues

  function renderIssuesTree() {
    var open = Data.allIssues();
    var resolved = Data.allIssues({ resolved: 'only' });
    var issueRow = function (x) {
      var key = 'issue:' + x.owner.id + ':' + x.issue.id;
      return row('#/issue/' + x.owner.id + '/' + x.issue.id, key === view.active,
        '<span class="side-row-title">' + e(x.owner.label) + '</span>' +
        '<span class="side-row-sub">' + e(Data.ISSUE_KINDS[x.owner.kind]) + ' · ' + e(x.issue.note) +
        '</span>', '', '', '');
    };
    var html = ['high', 'medium', 'low'].map(function (sev) {
      var list = open.filter(function (x) { return x.issue.severity === sev; });
      if (!list.length) return '';
      var isOpen = list.some(function (x) { return view.active === 'issue:' + x.owner.id + ':' + x.issue.id; });
      return group('issues:' + sev, sev.charAt(0).toUpperCase() + sev.slice(1) + ' severity',
        list.length, list.map(issueRow).join(''), isOpen);
    }).join('');
    if (resolved.length) {
      html += group('issues:resolved', 'Resolved', resolved.length, resolved.map(issueRow).join(''),
        resolved.some(function (x) { return view.active === 'issue:' + x.owner.id + ':' + x.issue.id; }));
    }
    el.tree.innerHTML = (html || '<p class="empty">No issues recorded.</p>') +
      foot('<button class="btn tiny" data-route="#/rules">Rule findings →</button>');
    el.count.textContent = open.length + ' open · ' + resolved.length + ' resolved';
  }

  // ---- probe

  function renderProbeTree() {
    var recent = prefs.probeRecent || [];
    var gaps = Data.state.library.contentGaps || [];
    var open = gaps.filter(function (g) { return !g.resolved; });
    var weight = { high: 0, medium: 1, low: 2 };
    var html = group('probe:recent', 'Recent questions', recent.length,
      recent.length
        ? recent.map(function (q) {
            return row('#/probe?q=' + encodeURIComponent(q), view.active === 'q:' + q,
              '<span class="side-row-title">' + e(q) + '</span>', '', '', '');
          }).join('')
        : '<p class="empty">Questions you probe are listed here.</p>',
      false);
    html += group('probe:gaps', 'Open content gaps', open.length,
      open.length
        ? open.slice().sort(function (a, b) {
            return (weight[a.severity] || 1) - (weight[b.severity] || 1);
          }).map(function (g) {
            return row('#/probe?gap=' + encodeURIComponent(g.id), view.active === 'gap:' + g.id,
              '<span class="side-row-title">' + e(g.q) + '</span>' +
              '<span class="side-row-sub">' + e(g.severity) + ' · ' +
              e(g.ownerId ? Data.taxonomyName(g.ownerId) : 'no department') + '</span>', '', '', '');
          }).join('')
        : '<p class="empty">None logged.</p>',
      false);
    el.tree.innerHTML = html;
    el.count.textContent = open.length + ' open content gap' + (open.length === 1 ? '' : 's');
  }

  // ---- content rules

  function renderRulesTree() {
    var rules = Rules.list();
    function line(rule) {
      var off = rule.enabled === false;
      var badge = Rules.isBuiltIn(rule)
        ? '<span class="side-sev builtin">B</span>'
        : '<span class="side-sev sev-' + e(rule.severity || 'medium') + '">' +
          e((rule.severity || 'medium').charAt(0).toUpperCase()) + '</span>';
      return row('#/rule/' + rule.id, view.active === 'rule:' + rule.id, e(rule.name), badge,
        off ? 'off' : String(Rules.count(rule))).replace('class="side-row', 'class="side-row' + (off ? ' off' : ''));
    }
    var writing = rules.filter(Rules.isWriting);
    var housekeeping = rules.filter(function (r) { return Rules.isBuiltIn(r) && !Rules.isWriting(r); });
    var mine = rules.filter(function (r) { return !Rules.isBuiltIn(r); });
    var html = '<div class="side-label">Writing</div>' + writing.map(line).join('') +
      '<div class="side-label">Housekeeping</div>' + housekeeping.map(line).join('') +
      '<div class="side-label">Your rules</div>' +
      (mine.map(line).join('') || '<p class="empty">No rules yet.</p>');
    el.tree.innerHTML = '<div class="side-rows flat">' + html + '</div>' +
      foot('<button class="btn tiny" data-side-act="new-rule">+ New rule</button>' +
        '<button class="btn tiny" data-route="#/rules">All rules →</button>');
    el.count.textContent = rules.length + ' rules · ' + Rules.totals().findings + ' findings';
  }

  // ---- departments

  function deptTree(renderRow, depthLimit) {
    var index = Data.state.index;
    function walk(node, depth) {
      var html = renderRow(node, depth);
      if (depth < depthLimit) {
        (index.children[node.id] || []).forEach(function (child) { html += walk(child, depth + 1); });
      }
      return html;
    }
    return (index.children.__root__ || []).map(function (n) { return walk(n, 0); }).join('');
  }

  function miniBar(row) {
    if (!row || !row.processes) return '<span class="mini-bar empty"></span>';
    return '<span class="mini-bar">' + Data.STATUSES.map(function (st) {
      var n = row.byStatus[st] || 0;
      return n ? '<i style="flex:' + n + ';background:' + Exporter.STATUS_COLOUR[st] + '"></i>' : '';
    }).join('') + '</span>';
  }

  function renderDepartmentsTree() {
    var cov = Data.coverage();
    var byId = {};
    cov.rows.forEach(function (r) { byId[r.node.id] = r; });
    el.tree.innerHTML = '<div class="side-rows flat">' + deptTree(function (node, depth) {
      var r = byId[node.id];
      return row('#/department/' + node.id, view.active === 'dept:' + node.id,
        e(node.name), '', (r ? r.processes : 0) + miniBar(r))
        .replace('class="side-row', 'class="side-row depth-' + depth);
    }, 9) + '</div>' +
      foot('<button class="btn tiny" data-side-act="new-dept">+ New department</button>');
    var t = cov.total;
    el.count.textContent = t.processes + ' processes · ' +
      ((t.byStatus.reviewed || 0) + (t.byStatus.published || 0)) + ' reviewed or published';
  }

  global.Sidebar = {
    init: init,
    render: render,
    section: function () { return view.section; },
    focusSearch: function () { el.search.focus(); el.search.select(); }
  };
}(window));
