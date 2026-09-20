/* ===========================================================================
   app.js — bootstrap, routing and the header controls.

   Loads the three published files, reconciles them against any saved draft,
   then wires the sidebar to the detail pane through the URL hash so that back,
   forward and a copied link all work.
   =========================================================================== */

(function (global) {
  'use strict';

  var prefs = Storage.loadPrefs();
  var activeProcessId = null;
  var source = 'live';

  // ---- routing -------------------------------------------------------------

  var ROUTES = [
    [/^#\/process\/(.+)$/, function (id) { activeProcessId = id; Detail.process(id); }],
    [/^#\/article\/(.+)$/, function (id) { Detail.article(id); }],
    [/^#\/faq\/(.+)$/, function (id) { Detail.faq(id); }],
    [/^#\/variable\/(.+)$/, function (id) { Detail.variable(id); }],
    [/^#\/articles$/, function () { Detail.articleList(); }],
    [/^#\/faqs$/, function () { Detail.faqList(); }],
    [/^#\/variables$/, function () { Detail.variableList(); }],
    [/^#\/issues$/, function () { Detail.issues(); }],
    [/^#\/rules$/, function () { Detail.rules(); }]
  ];

  function route() {
    var hash = location.hash || '#/';
    for (var i = 0; i < ROUTES.length; i++) {
      var match = hash.match(ROUTES[i][0]);
      if (match) {
        ROUTES[i][1](decodeURIComponent(match[1] || ''));
        Sidebar.render(activeProcessId);
        closeDrawer();
        return;
      }
    }
    activeProcessId = null;
    Detail.home();
    Sidebar.render(null);
    closeDrawer();
  }

  function navigate(target) {
    if (location.hash === target) { route(); return; }
    location.hash = target;
  }

  function closeDrawer() {
    document.body.classList.remove('drawer-open');
  }

  // ---- status --------------------------------------------------------------

  function setStatus(kind, text) {
    var pill = document.getElementById('statusPill');
    pill.className = 'pill-status ' + kind;
    pill.textContent = text;
  }

  // Fields whose value changes more than their own box: a department move
  // redraws the handoff markers, a status change redraws the badge and the
  // tree, a reparent moves the process.
  var STRUCTURAL = /:(departmentId|type|status|taxonomyId|ownerId|internal)$/;

  function showDirty(count, spec) {
    if (!count) return;
    source = 'draft';
    setStatus('draft', 'Draft · ' + count + ' change' + (count === 1 ? '' : 's'));
    // Every part of a rule changes what it finds, so any rule edit redraws.
    if (spec && (STRUCTURAL.test(spec) || spec.indexOf('rule:') === 0)) route();
    else if (spec) Sidebar.render(activeProcessId);
  }

  function showSaved(count, err) {
    if (err) { setStatus('error', 'Save failed'); return; }
    setStatus('draft', 'Draft saved · ' + count + ' change' + (count === 1 ? '' : 's'));
  }

  // ---- the conflict bar ----------------------------------------------------

  function showConflict(result) {
    var bar = document.getElementById('conflictBar');
    var draftDate = (result.draft.savedAt || '').slice(0, 10);
    bar.innerHTML =
      '<span>The published content was updated since your draft of ' +
      Data.escapeHtml(draftDate) + ' (' + result.stale.join(', ') + ').</span>' +
      '<button class="btn" id="keepMine">Keep my draft</button>' +
      '<button class="btn primary" id="takePublished">Take published</button>';
    bar.hidden = false;

    document.getElementById('keepMine').addEventListener('click', function () {
      bar.hidden = true;
      Data.load(result.draft.data);
      route();
      setStatus('draft', 'Local draft');
    });
    document.getElementById('takePublished').addEventListener('click', function () {
      Storage.clearDraft().then(function () {
        bar.hidden = true;
        Data.load(result.live);
        Edit.resetDirty();
        route();
        setStatus('live', 'Published · v' + (result.live.processes.version || 1));
      });
    });
  }

  // ---- export menu ---------------------------------------------------------

  function wireExportMenu() {
    var menu = document.getElementById('exportMenu');
    var button = document.getElementById('exportBtn');

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function (event) {
      if (!menu.hidden && !event.target.closest('#exportMenu')) menu.hidden = true;
    });

    menu.addEventListener('click', function (event) {
      // The buttons wrap a <strong> and a <span>, so the click usually lands
      // on a child rather than the button itself.
      var chosen = event.target.closest('[data-export]');
      if (!chosen) return;
      var action = chosen.dataset.export;
      menu.hidden = true;

      if (action === 'github') {
        Exporter.exportForGitHub().then(function () {
          setStatus('live', 'Exported · v' + Data.state.processes.version);
        });
      }
      if (action === 'faq') Exporter.exportFaqOnly();
      if (action === 'issues') Exporter.issuesHtml();
      if (action === 'verification') {
        Exporter.download('verification-all.html',
          Exporter.verificationHtml(''), 'text/html');
      }
      if (action === 'discard') {
        if (!confirm('Discard every local change and reload the published content?')) return;
        Storage.clearDraft().then(function () { location.reload(); });
      }
    });
  }

  // ---- start ---------------------------------------------------------------

  function start(data, from) {
    source = from;
    Data.load(data);
    Sidebar.init({ prefs: prefs, onNavigate: navigate });
    Detail.init({ onNavigate: navigate, prefs: prefs });
    Edit.init({ onChange: showDirty, onSaved: showSaved });
    wireExportMenu();

    if (from === 'draft') {
      setStatus('draft', 'Local draft');
    } else {
      setStatus('live', 'Published · v' + (data.processes.version || 1));
    }

    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', function (event) {
      if (Edit.dirtyCount() > 0) {
        Edit.save();
        event.preventDefault();
        event.returnValue = '';
      }
    });
    route();
  }

  function fail(err) {
    setStatus('error', 'Could not load');
    document.getElementById('detail').innerHTML =
      '<article class="pane"><header class="pane-head"><h1>Could not load the content</h1>' +
      '<p class="lede">' + Data.escapeHtml(err.message) + '</p>' +
      '<p>This page reads three JSON files from <code>data/</code>, which a browser ' +
      'will only fetch over http or https. Opening the file directly from disk ' +
      '(<code>file://</code>) will not work — use the published address instead.</p>' +
      '</header></article>';
    console.error(err);
  }

  document.getElementById('drawerToggle').addEventListener('click', function () {
    document.body.classList.toggle('drawer-open');
  });
  document.getElementById('varPickerClose').addEventListener('click', function () {
    document.getElementById('varPicker').hidden = true;
  });

  setStatus('loading', 'Loading…');

  Promise.all([Storage.fetchLive(), Storage.loadDraft()])
    .then(function (results) {
      var result = Storage.reconcile(results[0], results[1]);
      if (result.state === 'conflict') {
        start(result.live, 'live');
        showConflict(result);
      } else if (result.state === 'draft') {
        start(result.draft.data, 'draft');
      } else {
        start(result.live, 'live');
      }
    })
    .catch(fail);

  global.App = { route: route, navigate: navigate };
}(window));
