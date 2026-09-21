/* ===========================================================================
   live.js — the live call view.

   A reading tool for working through a process while it is happening, and for
   finding out what the documentation is missing. It deliberately collects
   nothing: no call records, no timers, no counters. What it writes are content
   changes — an attachment, a note, a new step — and those go into the same
   draft Process Hub uses, so one export covers both.

   Three things it does that the editor cannot:
     - shows one step at a time, at speed
     - shows the public FAQ answer the customer is probably reading
     - suggests library content for a step and attaches it in one click, which
       is how the links get built in the first place
   =========================================================================== */

(function (global) {
  'use strict';

  var el = {};
  var prefs = {};
  var call = { processId: null, stepIndex: 0, ticked: {}, openPanels: {} };
  var suggestIndex = null;

  function e(text) { return Data.escapeHtml(text); }
  function today() { return new Date().toISOString().slice(0, 10); }

  // ---- term matching for suggestions ---------------------------------------

  var STOPWORDS = ('the a an and or of to in on for with by at from is are was ' +
    'be been it its this that these those if then when where what which who how ' +
    'you your we our they their he she them can could should would may might must ' +
    'will shall do does did not no yes any all some more most other into out up ' +
    'down over under about after before during while also please note only both ' +
    'each every such than too very just own same so nor but customer council ' +
    'officer call caller provide check advise refer ' +
    // Words that carry no subject at all in council prose, and which were
    // otherwise pairing unrelated answers together.
    'make makes made making available need needs needed take takes taken give ' +
    'given put one two three way ways new old general information details ' +
    'contact further first second next following include includes including ' +
    'use used using within via per see back through around member letter ' +
    'template email phone form forms apply applying required require requires ' +
    'ensure must may relevant appropriate current existing').split(' ');

  var STOP = {};
  STOPWORDS.forEach(function (w) { STOP[w] = true; });

  function terms(text) {
    return String(text || '')
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(function (w) { return w.length > 2 && !STOP[w]; });
  }

  function unique(list) {
    var seen = {};
    return list.filter(function (w) {
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    });
  }

  /**
   * Index the library once. Document frequency is kept so that a word
   * appearing in half the answers counts for much less than a rare one —
   * without it, "approval" matches everything and nothing useful surfaces.
   */
  function buildSuggestIndex() {
    var docs = [];
    Data.state.library.articles.forEach(function (a) {
      docs.push({ kind: 'article', id: a.id, title: a.title, body: a.body });
    });
    Data.state.library.faqs.forEach(function (f) {
      docs.push({ kind: 'faq', id: f.id, title: f.q, body: f.a });
    });

    var df = {};
    docs.forEach(function (doc) {
      doc.titleTerms = {};
      unique(terms(doc.title)).forEach(function (w) { doc.titleTerms[w] = true; });
      doc.allTerms = {};
      unique(terms(doc.title + ' ' + doc.body)).forEach(function (w) {
        doc.allTerms[w] = true;
        df[w] = (df[w] || 0) + 1;
      });
    });

    return { docs: docs, df: df, total: docs.length || 1 };
  }

  // A word in more than a fifth of the library tells you nothing about a
  // particular step. Without this cutoff, an Airbnb answer surfaces against a
  // water leak because both mention "sdrc", "lodge" and "whether".
  var COMMON_TERM_RATIO = 0.2;
  var RELATIVE_FLOOR = 0.45;

  function suggest(step, process, kind, alreadyAttached) {
    if (!suggestIndex) suggestIndex = buildSuggestIndex();
    var query = unique(terms([step.title, step.sop, step.script, process.name].join(' ')));
    if (!query.length) return [];

    var taken = {};
    (alreadyAttached || []).forEach(function (id) { taken[id] = true; });

    var scored = [];
    suggestIndex.docs.forEach(function (doc) {
      if (doc.kind !== kind || taken[doc.id]) return;

      var score = 0;
      var hits = [];
      query.forEach(function (word) {
        if (!doc.allTerms[word]) return;
        var ratio = (suggestIndex.df[word] || 1) / suggestIndex.total;
        if (ratio > COMMON_TERM_RATIO) return;
        score += Math.log(1 / ratio) * (doc.titleTerms[word] ? 2.2 : 1);
        hits.push({ word: word, ratio: ratio });
      });

      if (hits.length < 2) return;
      hits.sort(function (a, b) { return a.ratio - b.ratio; });
      scored.push({ doc: doc, score: score, hits: hits.map(function (h) { return h.word; }) });
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    if (!scored.length) return [];

    // Keep only what is in the same league as the best match, so a thin tail
    // of half-relevant answers does not pad the list out to five.
    var floor = scored[0].score * RELATIVE_FLOOR;
    return scored.filter(function (s) { return s.score >= floor; }).slice(0, 5);
  }

  // ---- state ---------------------------------------------------------------

  function process() { return Data.state.index.processes[call.processId] || null; }
  function currentStep() {
    var p = process();
    return p ? p.steps[call.stepIndex] : null;
  }

  function startCall(processId) {
    call = { processId: processId, stepIndex: 0, ticked: {}, openPanels: {} };
    location.hash = '#' + processId;
    render();
  }

  function endCall() {
    call = { processId: null, stepIndex: 0, ticked: {}, openPanels: {} };
    location.hash = '';
    render();
  }

  function goto(index) {
    var p = process();
    if (!p) return;
    call.stepIndex = Math.max(0, Math.min(p.steps.length - 1, index));
    render();
    var node = document.querySelector('.run-step.current');
    if (node) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---- the picker ----------------------------------------------------------

  function renderPicker() {
    var query = el.search.value.trim();

    if (query.length >= 2) {
      var matches = Data.search(query, 40).filter(function (m) { return m.kind === 'process'; });
      el.pickerBody.innerHTML = matches.length
        ? matches.map(function (m) {
            return pickerRow(Data.state.index.processes[m.id]);
          }).join('')
        : '<p class="pick-empty">No process matches “' + e(query) + '”.</p>';
      return;
    }

    var index = Data.state.index;
    var html = (index.children.__root__ || []).map(function (dept) {
      return pickerBranch(dept, index, 0);
    }).join('');
    el.pickerBody.innerHTML = html;
  }

  function pickerBranch(node, index, depth) {
    var children = index.children[node.id] || [];
    var processes = (index.byTaxonomy[node.id] || []);
    var count = Data.processCount(node.id);
    if (!count) return '';

    var collapsed = prefs.liveCollapsed && prefs.liveCollapsed[node.id];
    return '<div class="pick-branch depth-' + depth + '">' +
      '<button class="pick-head" data-branch="' + e(node.id) + '">' +
      '<span class="caret">' + (collapsed ? '▸' : '▾') + '</span>' +
      '<span class="pick-name">' + e(node.name) + '</span>' +
      '<span class="pick-count">' + count + '</span></button>' +
      (collapsed ? '' : '<div class="pick-children">' +
        children.map(function (child) { return pickerBranch(child, index, depth + 1); }).join('') +
        processes.map(pickerRow).join('') + '</div>') +
      '</div>';
  }

  function pickerRow(p) {
    if (!p) return '';
    return '<button class="pick-process" data-process="' + e(p.id) + '">' +
      '<span class="pick-process-name">' + e(p.name) + '</span>' +
      '<span class="pick-process-where">' + e(Data.taxonomyPath(p.taxonomyId)) + '</span>' +
      '</button>';
  }

  // ---- the run -------------------------------------------------------------

  function render() {
    renderPicker();
    var p = process();

    if (!p) {
      el.run.innerHTML = '<div class="run-empty">' +
        '<h1>Live call</h1>' +
        '<p>Pick a process on the left, or press <kbd>/</kbd> to search.</p>' +
        '<p class="run-empty-note">Nothing here is recorded. Notes, attachments ' +
        'and new steps go into the same draft as Process Hub — export when ' +
        'you are done.</p></div>';
      el.processName.textContent = '';
      el.stepCount.textContent = '';
      return;
    }

    el.processName.textContent = p.name;
    el.stepCount.textContent = (call.stepIndex + 1) + ' of ' + p.steps.length;

    el.run.innerHTML =
      '<div class="run-head">' +
      '<div class="run-where">' + e(Data.taxonomyPath(p.taxonomyId)) + '</div>' +
      '<h1>' + e(p.name) + '</h1>' +
      (p.purpose ? '<p class="run-purpose">' + Data.resolveText(p.purpose) + '</p>' : '') +
      '</div>' +
      p.steps.map(function (step, i) { return renderStep(step, i, p); }).join('') +
      '<div class="run-foot">' +
      '<button class="lbtn" data-act="add-step-end">+ Add a step at the end</button>' +
      '</div>';
  }

  function renderStep(step, i, p) {
    var isCurrent = i === call.stepIndex;
    var attachedArticles = step.articleRefs || [];
    var attachedFaqs = step.faqRefs || [];

    if (!isCurrent) {
      var ticks = (step.checks || []).filter(function (c) { return call.ticked[c.id]; }).length;
      return '<button class="run-step collapsed" data-goto="' + i + '">' +
        '<span class="run-n">' + (i + 1) + '</span>' +
        '<span class="run-title">' + e(Data.freeze(step.title)) + '</span>' +
        (attachedArticles.length + attachedFaqs.length
          ? '<span class="run-badge">' + (attachedArticles.length + attachedFaqs.length) + '</span>'
          : '') +
        (ticks ? '<span class="run-ticks">' + ticks + ' ✓</span>' : '') +
        '</button>';
    }

    var html = '<div class="run-step current" data-goto="' + i + '">' +
      '<div class="run-step-head">' +
      '<span class="run-n">' + (i + 1) + '</span>' +
      '<h2>' + e(Data.freeze(step.title)) + '</h2>' +
      '<span class="run-dept">' + e(Data.taxonomyName(step.departmentId)) + '</span>' +
      '</div>';

    if (step.script) {
      html += '<div class="run-label">Say this</div>' +
        '<blockquote class="run-script">' + Data.resolveText(step.script) + '</blockquote>';
    }

    html += '<div class="run-label">Do this</div>';
    html += step.sop
      ? '<div class="run-sop">' + Data.resolveText(step.sop).replace(/\n/g, '<br>') + '</div>'
      : '<div class="run-missing">Nothing recorded. What actually happens here? ' +
        '<button class="lbtn tiny" data-act="note">Add a note</button></div>';

    if ((step.checks || []).length) {
      html += '<div class="run-label">Check</div><ul class="run-checks">' +
        step.checks.map(function (c) {
          return '<li><label><input type="checkbox" data-tick="' + e(c.id) + '"' +
            (call.ticked[c.id] ? ' checked' : '') + '> ' +
            Data.resolveText(c.text) + '</label></li>';
        }).join('') + '</ul>';
    }

    html += renderPanel('article', 'Knowledge base', step, p, attachedArticles);
    html += renderPanel('faq', 'What the customer can read', step, p, attachedFaqs);

    html += '<div class="run-actions">' +
      '<button class="lbtn" data-act="note">✎ Note</button>' +
      '<button class="lbtn" data-act="add-step">+ Step after this</button>' +
      '<a class="lbtn" href="index.html#/process/' + e(p.id) + '" target="_blank">Open in Process Hub</a>' +
      '<span class="run-spacer"></span>' +
      '<button class="lbtn" data-act="prev"' + (call.stepIndex === 0 ? ' disabled' : '') + '>← Back</button>' +
      '<button class="lbtn primary" data-act="next"' +
      (call.stepIndex >= p.steps.length - 1 ? ' disabled' : '') + '>Next →</button>' +
      '</div>';

    html += '<div class="note-box" id="noteBox" hidden>' +
      '<textarea id="noteText" rows="2" placeholder="What is wrong or missing? ' +
      'Enter to save, Esc to cancel."></textarea></div>';

    return html + '</div>';
  }

  function renderPanel(kind, label, step, p, attached) {
    var key = step.id + ':' + kind;
    var open = call.openPanels[key];
    var suggestions = suggest(step, p, kind, attached);
    var lookup = kind === 'article' ? Data.state.index.articles : Data.state.index.faqs;

    var summary = attached.length
      ? attached.length + ' attached'
      : 'none attached';
    if (suggestions.length) summary += ' · ' + suggestions.length + ' suggested';

    var html = '<button class="panel-head' + (open ? ' open' : '') +
      '" data-panel="' + e(key) + '">' +
      '<span class="panel-caret">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="panel-label">' + e(label) + '</span>' +
      '<span class="panel-summary">' + e(summary) + '</span></button>';

    if (!open) return html;

    html += '<div class="panel-body">';

    if (!attached.length && !suggestions.length) {
      html += '<p class="panel-empty">Nothing attached and nothing obvious to suggest.</p>';
    }

    attached.forEach(function (id) {
      var item = lookup[id];
      if (!item) return;
      var title = kind === 'article' ? item.title : item.q;
      var body = kind === 'article' ? item.body : item.a;
      html += '<div class="content-card">' +
        '<div class="content-head"><strong>' + e(title) + '</strong>' +
        '<button class="lbtn tiny" data-detach="' + e(id) + '" data-kind="' + kind +
        '" data-step="' + e(step.id) + '">Detach</button></div>' +
        '<div class="content-body ' + (kind === 'faq' ? 'faq-preview' : '') + '">' +
        '<div class="' + (kind === 'faq' ? 'faq-a-inner' : '') + '">' +
        Data.resolveHtml(body) + '</div></div></div>';
    });

    if (suggestions.length) {
      html += '<div class="suggest-label">Possibly relevant</div>';
      suggestions.forEach(function (s) {
        html += '<div class="suggest-row">' +
          '<button class="lbtn tiny primary" data-attach="' + e(s.doc.id) +
          '" data-kind="' + kind + '" data-step="' + e(step.id) + '">Attach</button>' +
          '<span class="suggest-title">' + e(s.doc.title) + '</span>' +
          '<span class="suggest-why">' + e(s.hits.slice(0, 4).join(' · ')) + '</span>' +
          '</div>';
      });
    }

    return html + '</div>';
  }

  // ---- actions -------------------------------------------------------------

  function attach(stepId, kind, id) {
    var p = process();
    var step = p && p.steps.find(function (s) { return s.id === stepId; });
    if (!step) return;
    var field = kind === 'article' ? 'articleRefs' : 'faqRefs';
    step[field] = step[field] || [];
    if (step[field].indexOf(id) === -1) step[field].push(id);
    Edit.touch();
    render();
  }

  function detach(stepId, kind, id) {
    var p = process();
    var step = p && p.steps.find(function (s) { return s.id === stepId; });
    if (!step) return;
    var field = kind === 'article' ? 'articleRefs' : 'faqRefs';
    step[field] = (step[field] || []).filter(function (x) { return x !== id; });
    Edit.touch();
    render();
  }

  function saveNote(text) {
    var p = process();
    var step = currentStep();
    if (!p || !text.trim()) return;
    p.issues = p.issues || [];
    p.issues.push({
      id: 'iss_' + Math.random().toString(36).slice(2, 9),
      stepId: step ? step.id : null,
      note: text.trim(),
      severity: 'medium',
      raised: today(),
      raisedBy: 'Live call'
    });
    Edit.touch();
    flash('Note sent to the issues register');
    render();
  }

  function addStep(atEnd) {
    var p = process();
    if (!p) return;
    var after = atEnd ? null : (currentStep() || {}).id;
    var id = Edit.addStep(p.id, after);
    if (!id) return;
    var index = p.steps.findIndex(function (s) { return s.id === id; });
    call.stepIndex = index;
    render();
    var input = document.querySelector('.run-step.current h2');
    if (input) input.scrollIntoView({ block: 'center' });
    promptTitle(id);
  }

  function promptTitle(stepId) {
    var p = process();
    var step = p.steps.find(function (s) { return s.id === stepId; });
    if (!step) return;
    var value = window.prompt('What happens at this step?', '');
    if (value === null) return;
    step.title = value.trim() || 'New step';
    Edit.touch();
    render();
  }

  function flash(message) {
    el.flash.textContent = message;
    el.flash.hidden = false;
    clearTimeout(el.flashTimer);
    el.flashTimer = setTimeout(function () { el.flash.hidden = true; }, 2200);
  }

  // ---- wiring --------------------------------------------------------------

  function onClick(event) {
    var node;

    if ((node = event.target.closest('[data-process]'))) {
      startCall(node.dataset.process);
      document.body.classList.remove('picker-open');
      return;
    }
    if ((node = event.target.closest('[data-branch]'))) {
      prefs.liveCollapsed = prefs.liveCollapsed || {};
      var id = node.dataset.branch;
      prefs.liveCollapsed[id] = !prefs.liveCollapsed[id];
      Storage.savePrefs(prefs);
      renderPicker();
      return;
    }
    if ((node = event.target.closest('[data-panel]'))) {
      call.openPanels[node.dataset.panel] = !call.openPanels[node.dataset.panel];
      render();
      return;
    }
    if ((node = event.target.closest('[data-attach]'))) {
      attach(node.dataset.step, node.dataset.kind, node.dataset.attach);
      flash('Attached — it stays linked once you export');
      return;
    }
    if ((node = event.target.closest('[data-detach]'))) {
      detach(node.dataset.step, node.dataset.kind, node.dataset.detach);
      return;
    }
    if (event.target.matches('[data-tick]')) {
      call.ticked[event.target.dataset.tick] = event.target.checked;
      return;
    }

    var act = (event.target.closest('[data-act]') || {}).dataset;
    if (!act) {
      if ((node = event.target.closest('[data-goto]'))) goto(Number(node.dataset.goto));
      return;
    }
    if (act.act === 'next') goto(call.stepIndex + 1);
    if (act.act === 'prev') goto(call.stepIndex - 1);
    if (act.act === 'note') openNote();
    if (act.act === 'add-step') addStep(false);
    if (act.act === 'add-step-end') addStep(true);
  }

  function openNote() {
    var box = document.getElementById('noteBox');
    var text = document.getElementById('noteText');
    if (!box) return;
    box.hidden = false;
    text.value = '';
    text.focus();
    text.onkeydown = function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        saveNote(text.value);
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        box.hidden = true;
      }
    };
  }

  function onKey(event) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (event.key === '/' && !typing) {
      event.preventDefault();
      el.search.focus();
      el.search.select();
      return;
    }
    if (typing) return;
    if (!process()) return;

    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      goto(call.stepIndex + 1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goto(call.stepIndex - 1);
    }
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openNote();
    }
  }

  function setStatus(kind, text) {
    el.status.className = 'live-status ' + kind;
    el.status.textContent = text;
  }

  function start(data, source) {
    Data.load(data);
    suggestIndex = null;

    Edit.init({
      onChange: function (count) {
        setStatus('draft', count + ' unsaved change' + (count === 1 ? '' : 's'));
      },
      onSaved: function (count) {
        setStatus('draft', count + ' change' + (count === 1 ? '' : 's') + ' · saved locally');
      }
    });

    setStatus(source === 'draft' ? 'draft' : 'live',
      source === 'draft' ? 'Local draft' : 'Published · v' + (data.processes.version || 1));

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    el.search.addEventListener('input', renderPicker);
    el.search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { el.search.value = ''; renderPicker(); el.search.blur(); }
    });
    el.newCall.addEventListener('click', endCall);
    el.exportBtn.addEventListener('click', function () {
      Exporter.exportForGitHub().then(function () {
        flash('Four files downloaded — commit them to keep these changes');
      });
    });
    el.pickerToggle.addEventListener('click', function () {
      document.body.classList.toggle('picker-open');
    });

    window.addEventListener('hashchange', function () {
      var id = location.hash.replace(/^#/, '');
      if (id && id !== call.processId) startCall(id);
      if (!id && call.processId) endCall();
    });

    var initial = location.hash.replace(/^#/, '');
    if (initial && Data.state.index.processes[initial]) {
      startCall(initial);
    } else {
      render();
    }
  }

  function fail(err) {
    setStatus('error', 'Could not load');
    el.run.innerHTML = '<div class="run-empty"><h1>Could not load the content</h1>' +
      '<p>' + e(err.message) + '</p>' +
      '<p class="run-empty-note">This page reads the JSON files in <code>data/</code>, ' +
      'which a browser only fetches over http or https.</p></div>';
    console.error(err);
  }

  function init() {
    el.search = document.getElementById('liveSearch');
    el.pickerBody = document.getElementById('pickerBody');
    el.run = document.getElementById('run');
    el.processName = document.getElementById('processName');
    el.stepCount = document.getElementById('stepCount');
    el.status = document.getElementById('liveStatus');
    el.newCall = document.getElementById('newCall');
    el.exportBtn = document.getElementById('liveExport');
    el.pickerToggle = document.getElementById('pickerToggle');
    el.flash = document.getElementById('flash');

    prefs = Storage.loadPrefs();
    setStatus('loading', 'Loading…');

    Promise.all([Storage.fetchLive(), Storage.loadDraft()])
      .then(function (results) {
        var result = Storage.reconcile(results[0], results[1]);
        // The live view never arbitrates a conflict mid-call; it takes the
        // draft when there is one, and Process Hub handles reconciliation.
        if (result.state === 'draft' || result.state === 'conflict') {
          start(result.draft ? result.draft.data : result.live, 'draft');
        } else {
          start(result.live, 'live');
        }
      })
      .catch(fail);
  }

  global.Live = { init: init };
}(window));
