/* ===========================================================================
   ui-sidebar.js — the department tree, and the search that sits over it.

   The tree is the default view because it shows the shape of the work, which
   is what makes the coverage legible to someone reading over your shoulder.
   Search is one keystroke away for when you know what you are looking for.
   =========================================================================== */

(function (global) {
  'use strict';

  var el = {};
  var prefs = {};
  var onNavigate = function () {};

  function init(options) {
    el.search = document.getElementById('sidebarSearch');
    el.results = document.getElementById('searchResults');
    el.tree = document.getElementById('tree');
    el.count = document.getElementById('sidebarCount');
    prefs = options.prefs || {};
    onNavigate = options.onNavigate || onNavigate;

    if (!prefs.collapsed) prefs.collapsed = {};

    el.search.addEventListener('input', function () { renderSearch(); });
    el.search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        el.search.value = '';
        renderSearch();
        el.search.blur();
      }
      if (e.key === 'Enter') {
        var first = el.results.querySelector('.result');
        if (first) first.click();
      }
    });

    // "/" and Ctrl/Cmd+K both jump to search, unless you are already typing.
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) ||
        document.activeElement.isContentEditable;
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        el.search.focus();
        el.search.select();
      }
    });
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

    var matches = Data.search(query, 50);
    el.tree.hidden = true;
    el.results.hidden = false;

    if (!matches.length) {
      el.results.innerHTML = '<p class="empty">Nothing matches “' +
        Data.escapeHtml(query) + '”.</p>';
      return;
    }

    el.results.innerHTML = matches.map(function (m) {
      return '<button class="result" data-route="' + m.route + '">' +
        '<span class="kind kind-' + m.kind + '">' + KIND_LABEL[m.kind] + '</span>' +
        '<span class="result-body">' +
        '<span class="result-title">' + Data.escapeHtml(m.title) + '</span>' +
        (m.subtitle ? '<span class="result-sub">' + Data.escapeHtml(m.subtitle) + '</span>' : '') +
        '</span></button>';
    }).join('');

    Array.prototype.forEach.call(el.results.querySelectorAll('.result'), function (node) {
      node.addEventListener('click', function () {
        onNavigate(node.dataset.route);
      });
    });
  }

  // ---- the tree ------------------------------------------------------------

  function renderTree(activeId) {
    var index = Data.state.index;
    var roots = index.children.__root__ || [];
    el.tree.innerHTML = roots.map(function (node) {
      return renderNode(node, index, activeId, 0);
    }).join('') + renderLibraryLinks();

    Array.prototype.forEach.call(el.tree.querySelectorAll('[data-toggle]'), function (node) {
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = node.dataset.toggle;
        prefs.collapsed[id] = !prefs.collapsed[id];
        Storage.savePrefs(prefs);
        renderTree(activeId);
      });
    });
    Array.prototype.forEach.call(el.tree.querySelectorAll('[data-route]'), function (node) {
      node.addEventListener('click', function () { onNavigate(node.dataset.route); });
    });
    Array.prototype.forEach.call(el.tree.querySelectorAll('[data-new-process]'), function (node) {
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        var name = prompt('Name of the new process in ' + Data.taxonomyPath(node.dataset.newProcess) + ':', '');
        if (!name || !name.trim()) return;
        var id = Edit.createProcess(node.dataset.newProcess, name.trim());
        onNavigate('#/process/' + id);
      });
    });

    var total = Data.state.processes.processes.length;
    el.count.textContent = total + ' processes · ' +
      Data.state.library.articles.length + ' articles · ' +
      Data.state.library.faqs.length + ' FAQs';
  }

  function renderNode(node, index, activeId, depth) {
    var children = index.children[node.id] || [];
    var processes = index.byTaxonomy[node.id] || [];
    var count = Data.processCount(node.id);
    var collapsed = prefs.collapsed[node.id];
    var hasContent = children.length || processes.length;

    var html = '<div class="tree-node depth-' + depth + '">' +
      '<div class="tree-head' + (collapsed ? ' collapsed' : '') + '">' +
      (hasContent
        ? '<button class="caret" data-toggle="' + node.id + '" aria-label="Expand or collapse">' +
          (collapsed ? '▸' : '▾') + '</button>'
        : '<span class="caret empty"></span>') +
      '<span class="tree-label">' + Data.escapeHtml(node.name) + '</span>' +
      (count ? '<span class="tree-count">' + count + '</span>' : '') +
      '<button class="tree-add" data-new-process="' + Data.escapeHtml(node.id) + '" ' +
      'title="New process in ' + Data.escapeHtml(node.name) + '" aria-label="New process in ' +
      Data.escapeHtml(node.name) + '">+</button>' +
      '</div>';

    if (!collapsed) {
      html += '<div class="tree-children">';
      children.forEach(function (child) {
        html += renderNode(child, index, activeId, depth + 1);
      });
      processes.forEach(function (p) {
        html += renderProcessRow(p, activeId);
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  function renderProcessRow(p, activeId) {
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
    return '<button class="tree-process' + (p.id === activeId ? ' active' : '') +
      '" data-route="#/process/' + p.id + '">' +
      '<span class="status-dot status-' + Data.escapeHtml(p.status) + '" title="' +
      Data.escapeHtml(p.status) + '"></span>' +
      '<span class="tree-process-name">' + Data.escapeHtml(p.name) + '</span>' +
      flags + '</button>';
  }

  function renderLibraryLinks() {
    return '<div class="tree-extra">' +
      '<button class="tree-link" data-route="#/articles">Knowledge base articles</button>' +
      '<button class="tree-link" data-route="#/faqs">FAQ questions</button>' +
      '<button class="tree-link" data-route="#/variables">Variables</button>' +
      '<button class="tree-link" data-route="#/issues">Issues register</button>' +
      '<button class="tree-link" data-route="#/rules">Content rules</button>' +
      '<button class="tree-link" data-route="#/coverage">Coverage</button>' +
      '<button class="tree-link" data-route="#/departments">Departments</button>' +
      '</div>';
  }

  global.Sidebar = {
    init: init,
    render: renderTree,
    focusSearch: function () { el.search.focus(); el.search.select(); }
  };
}(window));
