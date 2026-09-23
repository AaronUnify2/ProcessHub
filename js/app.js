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

  function e(text) { return Data.escapeHtml(text); }

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
    [/^#\/rules$/, function () { Detail.rules(); }],
    [/^#\/coverage$/, function () { Detail.coverage(); }],
    [/^#\/departments$/, function () { Detail.departments(); }]
  ];

  function route() {
    var hash = location.hash || '#/';
    for (var i = 0; i < ROUTES.length; i++) {
      var match = hash.match(ROUTES[i][0]);
      if (match) {
        if (!/^#\/process\//.test(hash)) activeProcessId = null;
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
  // tree, a reparent moves the process, a publish tab moves an FAQ.
  var STRUCTURAL = /:(departmentId|type|status|taxonomyId|ownerId|internal|publish\.tabId|parentId|name|severity|condition)$/;

  function showDirty(count, spec) {
    if (!count) return;
    setStatus('draft', 'Draft · ' + count + ' change' + (count === 1 ? '' : 's'));
    // Every part of a rule changes what it finds, so any rule edit redraws.
    if (spec && (STRUCTURAL.test(spec) || spec.indexOf('rule:') === 0 ||
        spec.indexOf('taxonomy:') === 0)) route();
    else if (spec) Sidebar.render(activeProcessId);
  }

  function showSaved(count, err) {
    if (err) { setStatus('error', 'Save failed'); return; }
    setStatus('draft', 'Draft saved · ' + count + ' change' + (count === 1 ? '' : 's'));
  }

  function currentData() {
    return {
      processes: Data.state.processes,
      library: Data.state.library,
      variables: Data.state.variables
    };
  }

  // ---- the conflict bar ----------------------------------------------------

  function showConflict(result) {
    var bar = document.getElementById('conflictBar');
    var draftDate = (result.draft.savedAt || '').slice(0, 10);
    bar.innerHTML =
      '<span>The published content has been updated since your draft of ' +
      e(draftDate) + ' (' + e(result.stale.join(', ')) + '). You are looking at your draft.</span>' +
      '<button class="btn primary" id="reviewMerge">Review and merge…</button>' +
      '<button class="btn" id="keepMine">Keep my draft</button>' +
      '<button class="btn" id="takePublished">Take published</button>';
    bar.hidden = false;

    document.getElementById('reviewMerge').addEventListener('click', function () {
      openMerge(result);
    });

    document.getElementById('keepMine').addEventListener('click', function () {
      if (!confirm('Keep your draft as it is? The next export will replace the ' +
          'newer published files with your version, so anything changed there ' +
          'since your draft will be lost. "Review and merge" keeps both.')) return;
      // Record that the newer files have been seen, so the next export
      // numbers itself above them and this bar does not come back.
      Storage.adoptVersions(currentData(), result.live);
      Storage.setBase(result.live);
      bar.hidden = true;
      Edit.touch();
      route();
    });

    document.getElementById('takePublished').addEventListener('click', function () {
      if (!confirm('Throw your draft away and load the published content?')) return;
      Storage.clearDraft().then(function () {
        bar.hidden = true;
        Storage.setBase(result.live);
        Data.load(Storage.clone(result.live));
        Edit.resetDirty();
        route();
        setStatus('live', 'Published · v' + (result.live.processes.version || 1));
      });
    });
  }

  // ---- merging -------------------------------------------------------------

  function openMerge(result) {
    var modal = document.getElementById('mergeModal');
    var body = document.getElementById('mergeBody');
    var plan = Merge.plan(currentData(), result.live, Storage.getBase());

    function row(entry, i, isConflict) {
      var key = entry.c.key + ':' + entry.id;
      var who = entry.take === 'live' ? 'Published' : 'Yours';
      var html = '<div class="merge-row' + (isConflict ? ' conflict' : '') + '">' +
        '<span class="merge-kind">' + e(entry.c.kind) + '</span>' +
        '<span class="merge-label">' + e(entry.label) + '</span>' +
        '<span class="merge-note">' + e(entry.note) +
        (entry.fields.length ? ' · ' + e(entry.fields.slice(0, 5).join(', ')) : '') + '</span>';
      if (isConflict) {
        html += '<span class="merge-choice">' +
          '<label><input type="radio" name="m' + i + '" value="mine" data-key="' + e(key) +
          '" checked> Mine</label>' +
          '<label><input type="radio" name="m' + i + '" value="live" data-key="' + e(key) +
          '"> Published</label></span>';
      } else {
        html += '<span class="merge-who ' + (entry.take === 'live' ? 'live' : 'mine') + '">' +
          who + '</span>';
      }
      return html + '</div>';
    }

    var html = '';
    if (!plan.hasBase) {
      html += '<p class="modal-sub">This draft was saved by an older version of Process ' +
        'Hub, which did not keep a copy of what it started from, so every difference ' +
        'is listed for you to choose. Yours is selected by default.</p>';
    }
    if (plan.conflicts.length) {
      html += '<h4>Choose ' + plan.conflicts.length + '</h4>' +
        plan.conflicts.map(function (entry, i) { return row(entry, i, true); }).join('');
    }
    if (plan.clean.length) {
      html += '<h4>Combine automatically · ' + plan.clean.length + '</h4>' +
        plan.clean.map(function (entry, i) { return row(entry, i, false); }).join('');
    }
    if (!plan.conflicts.length && !plan.clean.length) {
      html += '<p class="empty">Your draft and the published files hold the same ' +
        'content. Merging just brings the version numbers up to date.</p>';
    }
    body.innerHTML = html;
    modal.hidden = false;

    document.getElementById('mergeCancel').onclick = function () { modal.hidden = true; };
    document.getElementById('mergeApply').onclick = function () {
      var choices = {};
      Array.prototype.forEach.call(body.querySelectorAll('input[type="radio"]:checked'), function (input) {
        choices[input.dataset.key] = input.value;
      });
      var merged = Merge.apply(currentData(), result.live, plan, choices);
      Storage.setBase(result.live);
      Data.load(merged);
      modal.hidden = true;
      document.getElementById('conflictBar').hidden = true;
      Edit.touch();
      route();
    };
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
      Edit.commitActive();

      if (action === 'github') {
        Exporter.exportForGitHub().then(function () {
          setStatus('live', 'Exported · v' + Data.state.processes.version);
        });
      }
      if (action === 'faq') Exporter.exportFaqOnly();
      if (action === 'issues') Exporter.issuesHtml();
      if (action === 'coverage') Exporter.coverageHtml();
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
    // Only ask when something typed has genuinely not reached the draft yet.
    // Once saved, a draft survives closing the tab, so there is nothing to
    // warn about.
    window.addEventListener('beforeunload', function (event) {
      if (Edit.unsaved()) {
        Edit.commitActive();
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
      var live = results[0];
      var result = Storage.reconcile(live, results[1]);
      if (result.state === 'conflict') {
        // Show the draft, not the published files: editing while the bar is
        // up must add to your work, never quietly replace it.
        Storage.setBase(result.draft.base || null);
        start(result.draft.data, 'draft');
        showConflict(result);
      } else if (result.state === 'draft') {
        // Same version numbers means the published files are exactly what
        // the draft started from, so they serve as its base when an older
        // draft did not keep one.
        Storage.setBase(result.draft.base || live);
        start(result.draft.data, 'draft');
      } else {
        Storage.setBase(live);
        start(Storage.clone(live), 'live');
      }
    })
    .catch(fail);

  global.App = { route: route, navigate: navigate };
}(window));
