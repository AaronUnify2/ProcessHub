/* ===========================================================================
   app.js — bootstrap, routing and the header controls.

   Loads the three published files, reconciles them against any saved draft,
   then wires the sidebar to the detail pane through the URL hash so that back,
   forward and a copied link all work.
   =========================================================================== */

(function (global) {
  'use strict';

  var prefs = Storage.loadPrefs();

  function e(text) { return Data.escapeHtml(text); }

  // ---- routing -------------------------------------------------------------

  // Each route names the sidebar section it belongs to and what to highlight.
  // A route with no section (articles, variables…) leaves the sidebar on
  // whichever section was showing.
  var ROUTES = [
    [/^#\/process\/(.+)$/, 'processes', function (id) { Detail.process(id); return id; }],
    [/^#\/faq\/(.+)$/, 'faq', function (id) { Detail.faq(id); return id; }],
    [/^#\/faqs$/, 'faq', function () { Detail.faqDashboard(); }],
    [/^#\/tab\/(.+)$/, 'faq', function (id) { Detail.tab(id); return 'tab:' + id; }],
    [/^#\/article\/(.+)$/, 'articles', function (id) { Detail.article(id); return id; }],
    [/^#\/articles$/, 'articles', function () { Detail.articleList(); }],
    [/^#\/variable\/(.+)$/, 'variables', function (id) { Detail.variable(id); return id; }],
    [/^#\/variables$/, 'variables', function () { Detail.variableList(); }],
    [/^#\/issue\/([^/]+)\/(.+)$/, 'issues', function (pid, iid) {
      Detail.issue(pid, iid); return 'issue:' + pid + ':' + iid;
    }],
    [/^#\/issues$/, 'issues', function () { Detail.issues(); }],
    [/^#\/rule\/(.+)$/, 'rules', function (id) { Detail.rule(id); return 'rule:' + id; }],
    [/^#\/rules$/, 'rules', function () { Detail.rules(); }],
    [/^#\/coverage\/(.+)$/, 'coverage', function (id) { Detail.coverageDept(id); return 'cov:' + id; }],
    [/^#\/coverage$/, 'coverage', function () { Detail.coverage(); }],
    [/^#\/department\/(.+)$/, 'departments', function (id) { Detail.department(id); return 'dept:' + id; }],
    [/^#\/departments$/, 'departments', function () { Detail.departments(); }]
  ];

  function route() {
    var hash = location.hash || '#/';
    for (var i = 0; i < ROUTES.length; i++) {
      var match = hash.match(ROUTES[i][0]);
      if (match) {
        var active = ROUTES[i][2](decodeURIComponent(match[1] || ''),
          decodeURIComponent(match[2] || ''));
        Sidebar.render({ section: ROUTES[i][1], active: active || null });
        closeDrawer();
        return;
      }
    }
    Detail.home();
    Sidebar.render({ section: 'processes', active: null });
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
  var STRUCTURAL = /:(departmentId|type|status|taxonomyId|ownerId|internal|publish\.tabId|parentId|name|severity|condition|stepperFrom|label|new)$/;

  function showDirty(count, spec) {
    if (!count) return;
    setStatus('draft', 'Draft · ' + count + ' change' + (count === 1 ? '' : 's'));
    // Every part of a rule changes what it finds, so any rule edit redraws.
    if (spec && (STRUCTURAL.test(spec) || spec.indexOf('rule:') === 0 ||
        spec.indexOf('taxonomy:') === 0)) route();
    else if (spec) Sidebar.render();
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

  // ---- connecting to GitHub ------------------------------------------------

  /** afterConnect, if given, runs once a token has been checked and saved. */
  function openConnect(afterConnect) {
    var modal = document.getElementById('ghConnectModal');
    var input = document.getElementById('ghToken');
    var result = document.getElementById('ghResult');
    var saved = document.getElementById('ghSaved');

    function showSaved() {
      saved.hidden = !GitHub.hasToken();
    }

    input.value = '';
    result.textContent = '';
    result.className = 'gh-result';
    showSaved();
    modal.hidden = false;
    input.focus();

    function report(kind, text) {
      result.className = 'gh-result ' + kind;
      result.textContent = text;
    }

    document.getElementById('ghCheck').onclick = function () {
      var token = input.value.trim();
      if (!token) { input.focus(); return; }
      report('busy', 'Checking with GitHub…');
      GitHub.check(token).then(function (who) {
        if (!GitHub.setToken(token)) {
          report('bad', 'This browser will not store the token (private window, or ' +
            'storage blocked). Publishing needs it to be stored.');
          return;
        }
        input.value = '';
        showSaved();
        report('good', 'Connected as ' + (who.login || 'you') + ' — the token can read ' +
          GitHub.DATA_REPO + '. Writing is confirmed the first time you publish.');
        if (afterConnect) {
          setTimeout(function () { modal.hidden = true; afterConnect(); }, 900);
        }
      }).catch(function (err) {
        report('bad', err.message);
      });
    };

    document.getElementById('ghTest').onclick = function () {
      report('busy', 'Checking the saved token…');
      GitHub.check(GitHub.getToken()).then(function (who) {
        report('good', 'The saved token works — connected as ' + (who.login || 'you') + '.');
      }).catch(function (err) { report('bad', err.message); });
    };

    // Signing out also deletes the local draft: it is a full copy of the
    // internal content, and should not stay on a computer nobody is signed
    // in to.
    document.getElementById('ghForget').onclick = function () {
      var changes = changesSinceBase();
      Gate.signOut(!changes || changes.length > 0);
    };

    document.getElementById('ghClose').onclick = function () { modal.hidden = true; };
  }

  // ---- publishing ----------------------------------------------------------

  var FRIENDLY_NOTE = { 'you changed it': 'changed', 'you added it': 'added', 'you deleted it': 'deleted' };

  /**
   * What has changed since the draft's base, item by item, reusing the merge
   * comparison: the draft against its own base is exactly "what I changed".
   */
  function changesSinceBase() {
    var base = Storage.getBase();
    if (!base) return null;
    return Merge.plan(currentData(), base, base).clean;
  }

  function summarise(changes) {
    if (!changes) return 'Process Hub: update content';
    var counts = {};
    changes.forEach(function (c) { counts[c.c.kind] = (counts[c.c.kind] || 0) + 1; });
    var NOUNS = {
      Process: ['process', 'processes'], Department: ['department', 'departments'],
      Rule: ['rule', 'rules'], Article: ['article', 'articles'],
      FAQ: ['FAQ question', 'FAQ questions'], 'Publish tab': ['publish tab', 'publish tabs'],
      Variable: ['variable', 'variables']
    };
    var parts = Object.keys(counts).map(function (kind) {
      var n = counts[kind];
      var noun = NOUNS[kind] || [kind, kind + 's'];
      return n + ' ' + noun[n === 1 ? 0 : 1];
    });
    return 'Process Hub: ' + (parts.join(', ') || 'no content changes');
  }

  function commitBody(changes) {
    if (!changes || !changes.length) return '';
    var lines = changes.slice(0, 30).map(function (c) {
      return '- ' + c.c.kind + ': ' + c.label + ' (' + (FRIENDLY_NOTE[c.note] || c.note) + ')';
    });
    if (changes.length > 30) lines.push('- and ' + (changes.length - 30) + ' more');
    return '\n\n' + lines.join('\n');
  }

  function openPublish() {
    Edit.commitActive();

    if (!document.getElementById('conflictBar').hidden) {
      alert('The published files changed since your draft started. Use "Review and merge" ' +
        'in the bar at the top first, then publish.');
      return;
    }
    if (!GitHub.hasToken()) {
      openConnect(openPublish);
      return;
    }

    var modal = document.getElementById('publishModal');
    var list = document.getElementById('pubChanges');
    var message = document.getElementById('pubMessage');
    var status = document.getElementById('pubStatus');
    var go = document.getElementById('pubGo');
    var changes = changesSinceBase();

    document.getElementById('pubWhere').textContent = GitHub.DATA_REPO;
    document.getElementById('pubSite').textContent = GitHub.SITE_REPO;

    if (changes && !changes.length) {
      list.innerHTML = '<p class="empty">Nothing has changed since the last publish.</p>';
    } else if (changes) {
      list.innerHTML = changes.map(function (c) {
        return '<div class="pub-row"><span class="merge-kind">' + e(c.c.kind) + '</span>' +
          '<span class="pub-label">' + e(c.label) + '</span>' +
          '<span class="pub-note">' + e(FRIENDLY_NOTE[c.note] || c.note) + '</span></div>';
      }).join('');
    } else {
      list.innerHTML = '<p class="modal-sub">This draft does not know what it started from, ' +
        'so the changes cannot be listed. Everything is published as it stands.</p>';
    }

    message.value = summarise(changes);
    status.textContent = '';
    status.className = 'gh-result';
    go.disabled = !!(changes && !changes.length);
    go.textContent = 'Publish';
    modal.hidden = false;

    document.getElementById('pubCancel').onclick = function () { modal.hidden = true; };
    document.getElementById('pubConnection').onclick = function () {
      modal.hidden = true;
      openConnect();
    };

    function showPublished(done) {
      var links = [];
      if (done.data && done.data.url) {
        links.push('<a href="' + e(done.data.url) + '" target="_blank" rel="noopener">content commit</a>');
      }
      if (done.site && done.site.url) {
        links.push('<a href="' + e(done.site.url) + '" target="_blank" rel="noopener">public FAQ commit</a>');
      }
      status.className = 'gh-result good';
      status.innerHTML = 'Published.' +
        (done.site && done.site.url
          ? ' The public FAQ page picks up the change within a minute or two.'
          : ' The public FAQ was already up to date.') +
        (links.length ? ' See the ' + links.join(' and the ') + '.' : '');
      go.textContent = 'Done';
      go.disabled = false;
      go.onclick = function () { modal.hidden = true; };
    }

    go.onclick = function () {
      var built = Exporter.buildFiles();
      go.disabled = true;
      status.className = 'gh-result busy';

      GitHub.publish({
        files: built.files,
        message: (message.value.trim() || summarise(changes)) + commitBody(changes),
        baseVersions: Storage.versionsOf(currentData()),
        onProgress: function (text) { status.textContent = text; }
      }).then(function (done) {
        return Exporter.adopt(built).then(function () { return done; });
      }).then(function (done) {
        setStatus('live', 'Published · v' + Data.state.processes.version);
        showPublished(done);
      }).catch(function (err) {
        if (err.partial) {
          // The content went, the public FAQ did not. The app takes on the
          // new versions — they are on GitHub now — and offers to send the
          // FAQ on its own.
          Exporter.adopt(built);
          setStatus('live', 'Published · v' + Data.state.processes.version);
          status.className = 'gh-result bad';
          status.textContent = err.message;
          go.disabled = false;
          go.textContent = 'Send the FAQ';
          go.onclick = function () {
            go.disabled = true;
            status.className = 'gh-result busy';
            GitHub.publishSite(built.files, message.value.trim() || summarise(changes),
              function (text) { status.textContent = text; })
              .then(function (site) { showPublished({ data: { skipped: true }, site: site }); })
              .catch(function (again) {
                status.className = 'gh-result bad';
                status.textContent = again.message;
                go.disabled = false;
              });
          };
          return;
        }
        status.className = 'gh-result bad';
        status.textContent = err.message;
        go.disabled = false;
        go.textContent = 'Try again';
        if (err.status === 401) {
          status.textContent += ' ';
          var fix = document.createElement('button');
          fix.className = 'btn small';
          fix.textContent = 'Connect again';
          fix.onclick = function () { modal.hidden = true; openConnect(openPublish); };
          status.appendChild(fix);
        }
      });
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

      if (action === 'publish') openPublish();
      if (action === 'connect') openConnect();
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
      '<p>The content is read from GitHub each time Process Hub opens. Check the ' +
      'connection and reload.</p>' +
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

  // Nothing is shown until the private content has been read with a token.
  // No token, or one GitHub refuses, means the sign-in screen. If GitHub
  // cannot be reached at all, a draft already on this computer (whose owner
  // was signed in to make it) is shown so work can carry on offline.
  var savedDraft = null;

  if (!GitHub.hasToken()) {
    Gate.show();
    return;
  }

  Storage.loadDraft()
    .then(function (draft) {
      savedDraft = draft;
      return Storage.fetchLive();
    })
    .catch(function (err) {
      if (err.signin) { Gate.show(err.message); throw null; }
      if (savedDraft && savedDraft.data) {
        Storage.setBase(savedDraft.base || null);
        start(savedDraft.data, 'draft');
        setStatus('error', 'Offline · local draft');
        throw null;
      }
      throw err;
    })
    .then(function (live) {
      var result = Storage.reconcile(live, savedDraft);
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
    .catch(function (err) { if (err) fail(err); });

  global.App = { route: route, navigate: navigate, publish: openPublish };
}(window));
