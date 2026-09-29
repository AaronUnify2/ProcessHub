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

   Search is one keystroke away in both, and in the FAQ section it searches
   FAQ questions only.
   =========================================================================== */

(function (global) {
  'use strict';

  var el = {};
  var prefs = {};
  var onNavigate = function () {};
  var view = { section: 'processes', active: null };

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
      onNavigate(button.dataset.section === 'faq' ? '#/faqs' : '#/');
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
    el.search.placeholder = view.section === 'faq' ? 'Search FAQ questions…' : 'Search everything…';

    // Keep the scroll position: the menu redraws on every edit.
    var top = el.body.scrollTop;
    if (view.section === 'faq') renderFaqTree();
    else renderTree();
    el.body.scrollTop = top;
    if (el.search.value.trim().length >= 2) renderSearch();
  }

  // ---- search results ------------------------------------------------------

  var KIND_LABEL = {
    process: 'Process', article: 'Article', faq: 'FAQ', variable: 'Variable'
  };

  function renderSearch() {
    var query = el.search.value.trim();
    if (query.length < 2) {
      el.results.hidden = true;
      el.tree.hidden = false;
      el.results.innerHTML = '';
      return;
    }

    var matches = Data.search(query, view.section === 'faq' ? 200 : 50);
    if (view.section === 'faq') {
      matches = matches.filter(function (m) { return m.kind === 'faq'; }).slice(0, 50);
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
    }).join('') + renderLibraryLinks();

    el.count.textContent = Data.state.processes.processes.length + ' processes · ' +
      Data.state.library.articles.length + ' articles · ' +
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
    el.tree.innerHTML = html + renderLibraryLinks();

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

  // ---- links to everything else --------------------------------------------

  function renderLibraryLinks() {
    return '<div class="tree-extra">' +
      '<button class="tree-link" data-route="#/articles">Knowledge base articles</button>' +
      '<button class="tree-link" data-route="#/variables">Variables</button>' +
      '<button class="tree-link" data-route="#/issues">Issues register</button>' +
      '<button class="tree-link" data-route="#/rules">Content rules</button>' +
      '<button class="tree-link" data-route="#/coverage">Coverage</button>' +
      '<button class="tree-link" data-route="#/departments">Departments</button>' +
      '</div>';
  }

  global.Sidebar = {
    init: init,
    render: render,
    section: function () { return view.section; },
    focusSearch: function () { el.search.focus(); el.search.select(); }
  };
}(window));
