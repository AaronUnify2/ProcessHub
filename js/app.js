/* ===========================================================================
   app.js — bootstrap and routing.

   Loads the three published files, reconciles them against any saved draft,
   then wires the sidebar to the detail pane through the URL hash so that back,
   forward and a copied link all work.
   =========================================================================== */

(function () {
  'use strict';

  var prefs = Storage.loadPrefs();
  var activeProcessId = null;

  // ---- routing -------------------------------------------------------------

  var ROUTES = [
    [/^#\/process\/(.+)$/, function (id) { activeProcessId = id; Detail.process(id); }],
    [/^#\/article\/(.+)$/, function (id) { Detail.article(id); }],
    [/^#\/faq\/(.+)$/, function (id) { Detail.faq(id); }],
    [/^#\/variable\/(.+)$/, function (id) { Detail.variable(id); }],
    [/^#\/articles$/, function () { Detail.articleList(); }],
    [/^#\/faqs$/, function () { Detail.faqList(); }],
    [/^#\/variables$/, function () { Detail.variableList(); }],
    [/^#\/issues$/, function () { Detail.issues(); }]
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

  // ---- the narrow-screen drawer -------------------------------------------

  function closeDrawer() {
    document.body.classList.remove('drawer-open');
  }

  // ---- status pill ---------------------------------------------------------

  function setStatus(kind, text) {
    var pill = document.getElementById('statusPill');
    pill.className = 'pill-status ' + kind;
    pill.textContent = text;
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
      start(result.draft.data, 'draft');
    });
    document.getElementById('takePublished').addEventListener('click', function () {
      Storage.clearDraft().then(function () {
        bar.hidden = true;
        start(result.live, 'live');
      });
    });
  }

  // ---- start ---------------------------------------------------------------

  function start(data, source) {
    Data.load(data);
    Sidebar.init({ prefs: prefs, onNavigate: navigate });
    Detail.init({ onNavigate: navigate });

    if (source === 'draft') {
      setStatus('draft', 'Local draft');
    } else {
      setStatus('live', 'Published · v' + (data.processes.version || 1));
    }

    window.addEventListener('hashchange', route);
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

  setStatus('loading', 'Loading…');

  Promise.all([Storage.fetchLive(), Storage.loadDraft()])
    .then(function (results) {
      var result = Storage.reconcile(results[0], results[1]);
      if (result.state === 'conflict') {
        showConflict(result);
        start(result.live, 'live');
      } else if (result.state === 'draft') {
        start(result.draft.data, 'draft');
      } else {
        start(result.live, 'live');
      }
    })
    .catch(fail);
}());
