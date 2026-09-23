/* ===========================================================================
   ui-detail.js — the right-hand pane.

   One render function per route. Fields are rendered through Edit.field, so
   anything shown here can be clicked and changed; structural actions (add a
   step, draw a route, attach an article, resolve an issue) go through Edit
   too.
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
    host.addEventListener('change', handleChange);
    wireIssueModal();
    wireAttachModal();
  }

  function e(text) { return Data.escapeHtml(text); }
  function f(spec, opts) { return Edit.field(spec, opts); }

  function paint(html) {
    if (global.RichText) RichText.flush();
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

  function plural(n, word, many) {
    return n + ' ' + (n === 1 ? word : (many || word + 's'));
  }

  // ---- option lists --------------------------------------------------------

  function departmentOptions(blankLabel) {
    var list = Data.state.processes.taxonomy.map(function (n) {
      return { value: n.id, label: Data.taxonomyPath(n.id) };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    if (blankLabel) list.unshift({ value: '', label: blankLabel });
    return list;
  }

  function options(values) {
    return values.map(function (v) { return { value: v, label: v }; });
  }

  var YES_NO = [{ value: false, label: 'No' }, { value: true, label: 'Yes' }];

  var STATUS = ['draft', 'mapped', 'reviewed', 'published', 'needs_rework'];
  var STEP_TYPES = ['entry', 'action', 'decision', 'resolution'];
  var STEP_LABEL = {
    entry: 'Entry', action: 'Action', decision: 'Decision', resolution: 'Resolution'
  };

  // ---- structural actions --------------------------------------------------

  function ask(question, fallback) {
    var answer = prompt(question, fallback || '');
    return answer === null ? null : answer.trim();
  }

  function handleAction(event) {
    var node = event.target.closest('[data-act]');
    if (!node) return;
    event.stopPropagation();
    // A field left open would otherwise lose what was typed when the pane
    // redraws underneath it.
    Edit.commitActive();
    var act = node.dataset.act;
    var d = node.dataset;
    var id, name;

    if (act === 'view') {
      processView = d.view;
      prefs.processView = processView;
      Storage.savePrefs(prefs);
      refresh();
      return;
    }

    // -- steps, routes and checks
    if (act === 'add-step') { Edit.addStep(d.process, d.step); refresh(); }
    if (act === 'del-step' && confirm('Delete this step? Whatever led into it will lead to where it went.')) {
      Edit.deleteStep(d.process, d.step); refresh();
    }
    if (act === 'up') { Edit.moveStep(d.process, d.step, -1); refresh(); }
    if (act === 'down') { Edit.moveStep(d.process, d.step, 1); refresh(); }
    if (act === 'del-route') { Edit.deleteConnection(d.process, d.conn); refresh(); }
    if (act === 'add-check') { Edit.addCheck(d.process, d.step); refresh(); }
    if (act === 'del-check') { Edit.deleteCheck(d.process, d.step, d.check); refresh(); }

    // -- issues
    if (act === 'raise-issue') openIssueModal(d.process, d.step || '');
    if (act === 'resolve-issue') {
      var how = ask('How was it resolved? (optional — leave blank to just close it)');
      if (how !== null) { Edit.resolveIssue(d.process, d.issue, how); refresh(); }
    }
    if (act === 'reopen-issue') { Edit.reopenIssue(d.process, d.issue); refresh(); }
    if (act === 'del-issue' && confirm('Delete this issue entirely? Resolving keeps a record; deleting does not.')) {
      Edit.deleteIssue(d.process, d.issue); refresh();
    }

    // -- attachments
    if (act === 'attach') openAttach(d.process, d.step || null, d.kind || 'article');
    if (act === 'detach') { Edit.detach(d.process, d.step || null, d.kind, d.ref); refresh(); }

    // -- creating and deleting
    if (act === 'new-process') {
      name = ask('Name of the new process:');
      if (name) {
        id = Edit.createProcess(d.taxonomy, name);
        onNavigate('#/process/' + id);
      }
    }
    if (act === 'del-process' && confirm('Delete this whole process, its steps and its issues? ' +
        'Nothing else is affected, and until you export this only changes your draft.')) {
      Edit.deleteProcess(d.process);
      onNavigate('#/');
    }
    if (act === 'new-article') {
      name = ask('Title of the new article:');
      if (name) onNavigate('#/article/' + Edit.createArticle(name));
    }
    if (act === 'del-article') {
      var aUse = Data.state.index.usage[d.article];
      if (confirm('Delete this article?' + (aUse && aUse.processes.length
          ? ' It is attached in ' + plural(aUse.processes.length, 'process', 'processes') +
            ', and will be detached from all of them.' : ''))) {
        Edit.deleteArticle(d.article);
        onNavigate('#/articles');
      }
    }
    if (act === 'new-faq') {
      name = ask('The new question, as a customer would ask it:');
      if (name) onNavigate('#/faq/' + Edit.createFaq(name));
    }
    if (act === 'del-faq') {
      var qUse = Data.state.index.usage[d.faq];
      if (confirm('Delete this FAQ question? It will disappear from the published FAQ at ' +
          'the next export.' + (qUse && qUse.processes.length
          ? ' It is also attached in ' + plural(qUse.processes.length, 'process', 'processes') + '.' : ''))) {
        Edit.deleteFaq(d.faq);
        onNavigate('#/faqs');
      }
    }
    if (act === 'new-variable') {
      name = ask('The value (for example $300, or a phone number):');
      if (name) onNavigate('#/variable/' + Edit.createVariable(name));
    }
    if (act === 'del-variable' && confirm('Delete this variable?')) {
      if (Edit.deleteVariable(d.variable)) onNavigate('#/variables');
      else alert('This variable is still used. Replace those references first.');
    }

    // -- departments
    if (act === 'new-dept') {
      name = ask(d.parent ? 'Name of the new sub-department:' : 'Name of the new department:');
      if (name) { Edit.createTaxonomy(d.parent || null, name); refresh(); }
    }
    if (act === 'dept-up') { Edit.moveTaxonomy(d.dept, -1); refresh(); }
    if (act === 'dept-down') { Edit.moveTaxonomy(d.dept, 1); refresh(); }
    if (act === 'del-dept') {
      if (Edit.deleteTaxonomy(d.dept)) refresh();
      else alert('Only an empty department can be deleted — move its processes, ' +
        'steps, content and sub-departments elsewhere first.');
    }

    // -- variables
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

    // -- exports
    if (act === 'export-process-json') Exporter.processJson(d.process);
    if (act === 'export-process-html') Exporter.processHtml(d.process);
    if (act === 'export-issues-html') Exporter.issuesHtml();
    if (act === 'export-issues-csv') Exporter.issuesCsv();
    if (act === 'export-coverage') Exporter.coverageHtml();

    // -- rules
    if (act === 'add-rule') {
      id = Rules.add({
        name: 'New rule', kind: 'text', match: { mode: 'phrase', value: '' },
        scope: ['process', 'step', 'article', 'faq'], severity: 'medium', message: ''
      });
      refresh();
      setTimeout(function () {
        var row = document.getElementById('rule-' + id);
        if (row) row.scrollIntoView({ block: 'center' });
      }, 30);
      return;
    }
    if (act === 'seed-rules') {
      Rules.defaults().forEach(function (r) { if (!Rules.get(r.id)) Rules.add(r); });
      refresh();
      return;
    }
    if (act === 'toggle-rule') { Rules.toggle(d.rule); refresh(); return; }
    if (act === 'scope') {
      var rule = Rules.get(d.rule);
      if (rule) {
        rule.scope = rule.scope || [];
        var at = rule.scope.indexOf(d.scope);
        if (at === -1) rule.scope.push(d.scope); else rule.scope.splice(at, 1);
        Edit.touch();
        refresh();
      }
      return;
    }
    if (act === 'del-rule') {
      if (confirm('Delete this rule? Its findings disappear with it.')) {
        Rules.remove(d.rule); refresh();
      }
      return;
    }
    if (act === 'show-all') {
      expanded[d.rule] = !expanded[d.rule];
      refresh();
      return;
    }
    if (act === 'toggle-rule-block') {
      opened[d.rule] = !opened[d.rule];
      refresh();
      return;
    }
  }

  /** The "+ route to…" menus on each step. */
  function handleChange(event) {
    var select = event.target.closest('select[data-add-route]');
    if (!select || !select.value) return;
    Edit.addConnection(select.dataset.process, select.dataset.addRoute, select.value, '');
    refresh();
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

  // ---- raising an issue ----------------------------------------------------

  var issueTarget = null;

  function openIssueModal(processId, stepId) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    issueTarget = processId;
    var modal = document.getElementById('issueModal');
    document.getElementById('imProcess').textContent = p.name;
    document.getElementById('imNote').value = '';
    document.getElementById('imSeverity').value = 'medium';
    var stepSelect = document.getElementById('imStep');
    stepSelect.innerHTML = '<option value="">The process as a whole</option>' +
      p.steps.map(function (s, i) {
        return '<option value="' + e(s.id) + '"' + (s.id === stepId ? ' selected' : '') + '>' +
          (i + 1) + '. ' + e(Data.freeze(s.title)) + '</option>';
      }).join('');
    modal.hidden = false;
    document.getElementById('imNote').focus();
  }

  function wireIssueModal() {
    var modal = document.getElementById('issueModal');
    if (!modal) return;
    document.getElementById('imCancel').addEventListener('click', function () { modal.hidden = true; });
    document.getElementById('imSave').addEventListener('click', function () {
      var note = document.getElementById('imNote').value.trim();
      if (!note) { document.getElementById('imNote').focus(); return; }
      Edit.raiseIssue(issueTarget, {
        note: note,
        severity: document.getElementById('imSeverity').value,
        stepId: document.getElementById('imStep').value || null,
        raisedBy: document.getElementById('imBy').value.trim()
      });
      prefs.raisedBy = document.getElementById('imBy').value.trim();
      Storage.savePrefs(prefs);
      modal.hidden = true;
      refresh();
    });
    document.getElementById('imBy').value = prefs.raisedBy || '';
  }

  // ---- attaching articles and FAQ answers ----------------------------------

  var attachTarget = null;

  function openAttach(processId, stepId, kind) {
    attachTarget = { processId: processId, stepId: stepId, kind: kind };
    var modal = document.getElementById('attachModal');
    var p = Data.state.index.processes[processId];
    var step = stepId ? p.steps.find(function (s) { return s.id === stepId; }) : null;
    document.getElementById('amWhere').textContent = step
      ? 'Step: ' + Data.freeze(step.title)
      : 'The process as a whole: ' + p.name;
    document.getElementById('amSearch').value = '';
    drawAttach();
    modal.hidden = false;
    document.getElementById('amSearch').focus();
  }

  function drawAttach() {
    var t = attachTarget;
    var p = Data.state.index.processes[t.processId];
    var owner = t.stepId ? p.steps.find(function (s) { return s.id === t.stepId; }) : p;
    var field = t.kind === 'article' ? 'articleRefs' : 'faqRefs';
    var attached = owner[field] || [];
    var q = document.getElementById('amSearch').value.trim();

    Array.prototype.forEach.call(document.querySelectorAll('#attachModal .am-tab'), function (b) {
      b.classList.toggle('on', b.dataset.kind === t.kind);
    });

    var rows = [];
    if (q.length >= 2) {
      rows = Data.search(q, 40).filter(function (m) {
        return m.kind === t.kind && attached.indexOf(m.id) === -1;
      }).map(function (m) { return { id: m.id, title: m.title, why: m.subtitle }; });
    } else {
      rows = Data.suggest(t.stepId ? owner : null, p, t.kind, attached).map(function (s) {
        return { id: s.doc.id, title: s.doc.title, why: 'suggested · ' + s.hits.slice(0, 4).join(' · ') };
      });
    }

    var list = document.getElementById('amList');
    list.innerHTML = rows.map(function (r) {
      return '<button class="pick-row" data-id="' + e(r.id) + '">' +
        '<span class="pick-value">' + e(r.title) + '</span>' +
        '<span class="pick-q">' + e(r.why || '') + '</span></button>';
    }).join('') || '<p class="empty">' + (q.length >= 2
      ? 'Nothing matches.'
      : 'No suggestions for this step — type to search.') + '</p>';

    Array.prototype.forEach.call(list.querySelectorAll('.pick-row'), function (row) {
      row.addEventListener('click', function () {
        Edit.attach(t.processId, t.stepId, t.kind, row.dataset.id);
        document.getElementById('attachModal').hidden = true;
        refresh();
      });
    });
  }

  function wireAttachModal() {
    var modal = document.getElementById('attachModal');
    if (!modal) return;
    document.getElementById('amClose').addEventListener('click', function () { modal.hidden = true; });
    document.getElementById('amSearch').addEventListener('input', drawAttach);
    Array.prototype.forEach.call(modal.querySelectorAll('.am-tab'), function (b) {
      b.addEventListener('click', function () {
        attachTarget.kind = b.dataset.kind;
        drawAttach();
      });
    });
  }

  // ---- process -------------------------------------------------------------

  function renderProcess(id) {
    var p = Data.state.index.processes[id];
    if (!p) return paint(notFound('process', id));
    var pid = p.id;
    var flow = Data.flow(p);

    // The map wants the whole window; the step list wants a reading width.
    var html = '<article class="pane' + (processView === 'map' ? ' wide' : '') + '">' +
      '<header class="pane-head">' +
      '<div class="crumbs">' + e(Data.taxonomyPath(p.taxonomyId)) + '</div>' +
      '<h1 class="editable-h1">' + f('process:' + pid + ':name') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(p.status) + '">' +
      f('process:' + pid + ':status', { type: 'select', options: options(STATUS) }) + '</span>' +
      (flow.handoffs
        ? '<span class="badge warn">⇄ ' + plural(flow.handoffs, 'handoff') +
          ' across ' + flow.departments.length + ' departments</span>'
        : '') +
      (flow.branches ? '<span class="badge quiet">⑂ branches</span>' : '') +
      '<span class="badge quiet">' + plural(p.steps.length, 'step') + '</span>' +
      '</div>' +
      '<div class="lede">' + f('process:' + pid + ':purpose',
        { placeholder: 'What this process is for' }) + '</div>' +
      '<div class="row-actions">' +
      btn('raise-issue', { process: pid }, '⚑ Raise issue') +
      btn('export-process-html', { process: pid }, '⤓ HTML') +
      btn('export-process-json', { process: pid }, '⤓ JSON') +
      '<span class="spacer"></span>' +
      btn('del-process', { process: pid }, 'Delete process', 'small danger') +
      '</div></header>';

    html += '<div class="view-toggle">' +
      '<button class="vt' + (processView === 'steps' ? ' on' : '') +
      '" data-act="view" data-view="steps">Steps</button>' +
      '<button class="vt' + (processView === 'map' ? ' on' : '') +
      '" data-act="view" data-view="map">Map</button></div>';

    html += renderIssues(p);

    if (processView === 'map') {
      html += '<section class="canvas-host" id="canvasHost"></section>';
    } else {
      if (!flow.linear) {
        html += '<p class="flow-note">This process branches, so the list below is reading ' +
          'order only. Each step shows where it leads; change the routes there or on the Map.</p>';
      }
      html += '<section class="flow">' +
        p.steps.map(function (step, i) { return renderStep(step, i, p, flow); }).join('') +
        '<div class="add-step-row">' +
        btn('add-step', { process: pid }, '+ Add step at the end') +
        '</div></section>';
    }

    html += '<section class="block"><h2>Attached to the whole process</h2>' +
      renderAttached(p, null) + '</section>';

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
      e(flow.departments.map(Data.taxonomyName).join(', ')) + '</dd>' +
      '</dl></section></article>';

    paint(html);

    if (processView === 'map') {
      Canvas.mount(pid, document.getElementById('canvasHost'), prefs, {
        // A card's ✎ opens that step in the list, where every field is.
        onOpenStep: function (stepId) {
          processView = 'steps';
          prefs.processView = processView;
          Storage.savePrefs(prefs);
          refresh();
          var target = document.getElementById('step-' + stepId);
          if (target) target.scrollIntoView({ block: 'center' });
        }
      });
    }
  }

  function renderStep(step, i, p, flow) {
    var spec = 'step:' + p.id + ':' + step.id + ':';
    var html = '';

    if (flow.handoffSteps[step.id]) {
      html += '<div class="handoff-marker">Handoff from ' +
        e(Data.taxonomyName(flow.handoffSteps[step.id])) + ' to ' +
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
      btn('up', { process: p.id, step: step.id }, '↑', 'small', 'Move up') +
      btn('down', { process: p.id, step: step.id }, '↓', 'small', 'Move down') +
      btn('add-step', { process: p.id, step: step.id }, '+', 'small', 'Add a step after this') +
      btn('raise-issue', { process: p.id, step: step.id }, '⚑', 'small', 'Raise an issue on this step') +
      btn('del-step', { process: p.id, step: step.id }, '×', 'small danger', 'Delete this step') +
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
      btn('add-check', { process: p.id, step: step.id }, '+', 'tiny', 'Add a check') + '</div>' +
      '<ul class="checks">' + (step.checks || []).map(function (c) {
        return '<li>' + Edit.field('check:' + p.id + ':' + step.id + ':' + c.id,
          { placeholder: 'Something to check' }) +
          btn('del-check', { process: p.id, step: step.id, check: c.id }, '×', 'tiny danger', 'Remove') +
          '</li>';
      }).join('') + '</ul>';

    html += '<div class="field-label">Attached</div>' + renderAttached(p, step);

    html += '<div class="trigger"><strong>Done when:</strong> ' +
      f(spec + 'completionTrigger', { placeholder: 'What signals this step is finished' }) +
      '</div>';

    html += renderRoutes(step, i, p, flow);

    return html + '</div>';
  }

  /**
   * Where a step leads. Each route's label is what the live call view shows
   * as a button, so a decision step reads as a question with answers.
   */
  function renderRoutes(step, i, p, flow) {
    var out = flow.outgoing[step.id] || [];
    var number = {};
    p.steps.forEach(function (s, n) { number[s.id] = n + 1; });

    var html = '<div class="routes"><span class="routes-label">Leads to</span>';
    if (!out.length) {
      html += '<span class="route-end">' +
        (step.type === 'resolution' ? 'Nothing — the process ends here.' : 'Nothing yet.') + '</span>';
    }
    html += out.map(function (c) {
      var to = p.steps[number[c.to] - 1];
      return '<div class="route">' +
        '<span class="route-cond">' + f('connection:' + p.id + ':' + c.id + ':condition',
          { placeholder: out.length > 1 ? 'Label, e.g. Yes' : 'Label (optional)' }) + '</span>' +
        '<button class="route-to" data-jump="step-' + e(c.to) + '">→ ' + number[c.to] + '. ' +
        e(to ? Data.freeze(to.title) : c.to) + '</button>' +
        btn('del-route', { process: p.id, conn: c.id }, '×', 'tiny danger', 'Remove this route') +
        '</div>';
    }).join('');

    var linked = {};
    out.forEach(function (c) { linked[c.to] = true; });
    var choices = p.steps.filter(function (s) { return s.id !== step.id && !linked[s.id]; });
    if (choices.length) {
      html += '<select class="route-add" data-add-route="' + e(step.id) + '" data-process="' +
        e(p.id) + '" aria-label="Add a route from this step">' +
        '<option value="">+ Add a route to…</option>' +
        choices.map(function (s) {
          return '<option value="' + e(s.id) + '">' + number[s.id] + '. ' +
            e(Data.freeze(s.title)) + '</option>';
        }).join('') + '</select>';
    }
    return html + '</div>';
  }

  /** Attached articles and FAQ answers, for a step or (step null) the process. */
  function renderAttached(p, step) {
    var owner = step || p;
    var base = { process: p.id, step: step ? step.id : '' };
    var chips = [];

    (owner.articleRefs || []).forEach(function (ref) {
      var a = Data.state.index.articles[ref];
      chips.push('<span class="chip"><button class="chip-link" data-route="#/article/' + e(ref) +
        '">📖 ' + e(a ? a.title : ref + ' (missing)') + '</button>' +
        btn('detach', Object.assign({ kind: 'article', ref: ref }, base), '×', 'chip-x', 'Detach') +
        '</span>');
    });
    (owner.faqRefs || []).forEach(function (ref) {
      var q = Data.state.index.faqs[ref];
      chips.push('<span class="chip"><button class="chip-link faq" data-route="#/faq/' + e(ref) +
        '">❓ ' + e(q ? q.q : ref + ' (missing)') + '</button>' +
        btn('detach', Object.assign({ kind: 'faq', ref: ref }, base), '×', 'chip-x', 'Detach') +
        '</span>');
    });

    return '<div class="attached">' + chips.join('') +
      btn('attach', Object.assign({ kind: 'article' }, base), '+ Article', 'tiny') +
      btn('attach', Object.assign({ kind: 'faq' }, base), '+ FAQ', 'tiny') +
      '</div>';
  }

  function renderIssues(p) {
    var open = Data.openIssues(p);
    var resolved = (p.issues || []).filter(function (i) { return i.resolved; });
    var stepTitle = function (issue) {
      var step = (p.steps || []).find(function (s) { return s.id === issue.stepId; });
      return step ? ' · step: ' + e(Data.freeze(step.title)) : '';
    };

    if (!open.length && !resolved.length) return '';

    var html = '<section class="block issues"><h2>Issues <span class="count">' +
      open.length + ' open</span></h2>';

    html += open.map(function (issue) {
      return '<div class="issue-row sev-' + e(issue.severity) + '">' +
        '<span class="sev">' + f('issue:' + p.id + ':' + issue.id + ':severity',
          { type: 'select', options: options(['high', 'medium', 'low']) }) + '</span>' +
        '<div class="issue-body">' + f('issue:' + p.id + ':' + issue.id + ':note',
          { type: 'multiline' }) +
        '<span class="issue-meta">' + e(issue.raisedBy || '—') + ' · ' + e(issue.raised) +
        stepTitle(issue) + '</span></div>' +
        btn('resolve-issue', { process: p.id, issue: issue.id }, '✓ Resolve', 'tiny') +
        '</div>';
    }).join('');

    if (resolved.length) {
      html += '<details class="resolved"><summary>' + plural(resolved.length, 'resolved issue') +
        '</summary>' + resolved.map(function (issue) {
          return '<div class="issue-row resolved-row">' +
            '<span class="sev">✓</span>' +
            '<div class="issue-body"><p>' + e(issue.note) + '</p>' +
            '<span class="issue-meta">Resolved ' + e(issue.resolved) +
            (issue.resolution ? ' — ' + e(issue.resolution) : '') +
            ' · raised ' + e(issue.raised) + stepTitle(issue) + '</span></div>' +
            btn('reopen-issue', { process: p.id, issue: issue.id }, 'Reopen', 'tiny') +
            btn('del-issue', { process: p.id, issue: issue.id }, '×', 'tiny danger', 'Delete') +
            '</div>';
        }).join('') + '</details>';
    }
    return html + '</section>';
  }

  function btn(act, data, label, extra, title) {
    var attrs = Object.keys(data || {}).map(function (k) {
      return ' data-' + k + '="' + e(data[k]) + '"';
    }).join('');
    return '<button class="btn ' + (extra || 'small') + '" data-act="' + act + '"' +
      attrs + (title ? ' title="' + e(title) + '" aria-label="' + e(title) + '"' : '') +
      '>' + e(label) + '</button>';
  }

  // Clicking a route's target scrolls to that step rather than navigating.
  document.addEventListener('click', function (event) {
    var jump = event.target.closest('[data-jump]');
    if (!jump) return;
    var target = document.getElementById(jump.dataset.jump);
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('flash-step');
      setTimeout(function () { target.classList.remove('flash-step'); }, 1200);
    }
  });

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
        { type: 'select', options: departmentOptions('No owner yet'), placeholder: 'No owner yet' }) + '</span>' +
      '<span class="badge quiet">🔒 Internal only: ' + f('article:' + id + ':internal',
        { type: 'select', options: YES_NO }) + '</span>' +
      '</div>' + renderUsage(usage) +
      '<div class="row-actions"><span class="spacer"></span>' +
      btn('del-article', { article: id }, 'Delete article', 'small danger') + '</div>' +
      '</header>' +
      '<section class="block"><h2>Body</h2><div id="richHost"></div></section>' +
      renderUsedIn(usage) + '</article>');

    RichText.mount(document.getElementById('richHost'), {
      html: a.body,
      headerHtml: '',
      onChange: function (html) { Edit.set('article:' + id + ':body', html); }
    });
  }

  function renderFaq(id) {
    var q = Data.state.index.faqs[id];
    if (!q) return paint(notFound('FAQ question', id));
    var usage = Data.state.index.usage[id] || { processes: [], steps: 0 };

    var tabs = [{ value: '', label: 'Not published' }].concat(
      Data.state.library.publishTabs.map(function (t) {
        return { value: t.id, label: t.label };
      }));
    var published = q.publish && q.publish.tabId;

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">FAQ · ' + (published ? 'published' : 'not published') + '</div>' +
      '<h1 class="editable-h1">' + f('faq:' + id + ':q') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(q.status) + '">' + f('faq:' + id + ':status',
        { type: 'select', options: options(['draft', 'review', 'approved', 'published']) }) +
      '</span>' +
      '<span class="badge quiet">' + f('faq:' + id + ':ownerId',
        { type: 'select', options: departmentOptions('No owner yet'), placeholder: 'No owner yet' }) + '</span>' +
      (q.lastReviewed ? '<span class="badge quiet">' + e(q.lastReviewed) + '</span>' : '') +
      '</div>' + renderUsage(usage) +
      '<div class="row-actions"><span class="spacer"></span>' +
      btn('del-faq', { faq: id }, 'Delete question', 'small danger') + '</div>' +
      '</header>' +
      '<section class="block meta"><h2>Where it is published</h2><dl>' +
      '<dt>Tab on the FAQ page</dt><dd>' + f('faq:' + id + ':publish.tabId',
        { type: 'select', options: tabs, placeholder: 'Not published' }) + '</dd>' +
      '<dt>Position in the tab</dt><dd>' + f('faq:' + id + ':publish.order',
        { placeholder: 'A number — lower comes first' }) + '</dd>' +
      '<dt>Group heading</dt><dd>' + f('faq:' + id + ':publish.groupTitle',
        { placeholder: 'Starts a new group when it differs from the question above' }) + '</dd>' +
      '<dt>Internal only</dt><dd>' + f('faq:' + id + ':internal',
        { type: 'select', options: YES_NO }) + '</dd>' +
      '</dl></section>' +
      '<section class="block"><h2>Answer — public wording</h2><div id="richHost"></div></section>' +
      renderUsedIn(usage) + '</article>');

    RichText.mount(document.getElementById('richHost'), {
      html: q.a,
      headerHtml: Data.escapeHtml(q.q),
      onChange: function (html) { Edit.set('faq:' + id + ':a', html); }
    });
  }

  function renderUsage(usage) {
    if (!usage.processes.length) {
      return '<p class="usage none">Not referenced by any process yet.</p>';
    }
    return '<p class="usage">Used in ' + plural(usage.processes.length, 'process', 'processes') +
      (usage.steps ? ', ' + plural(usage.steps, 'step') : '') +
      '. Editing it changes all of them.</p>';
  }

  function renderUsedIn(usage) {
    if (!usage.processes.length) return '';
    return '<section class="block"><h2>Used in</h2>' + usage.processes.map(function (ownerId) {
      var p = Data.state.index.processes[ownerId];
      return p ? listRow('#/process/' + p.id, p.name, Data.taxonomyPath(p.taxonomyId), '') : '';
    }).join('') + '</section>';
  }

  // ---- list views ----------------------------------------------------------

  function renderArticleList() {
    var items = Data.state.library.articles.slice().sort(function (a, b) {
      return a.title.localeCompare(b.title);
    });
    paint(listPane('Knowledge base articles', plural(items.length, 'article'),
      '<div class="row-actions">' + btn('new-article', {}, '+ New article') + '</div>' +
      items.map(function (a) {
        var usage = Data.state.index.usage[a.id] || { processes: [] };
        return listRow('#/article/' + a.id, a.title, Data.taxonomyPath(a.ownerId),
          usage.processes.length ? usage.processes.length + ' uses' : 'unused');
      }).join('')));
  }

  function renderFaqList() {
    var labels = {};
    Data.state.library.publishTabs.forEach(function (t) { labels[t.id] = t.label; });
    var byTab = {};
    Data.state.library.faqs.forEach(function (q) {
      var tab = (q.publish && q.publish.tabId) || '';
      (byTab[tab] = byTab[tab] || []).push(q);
    });
    // Published tabs in their published order, then anything not yet placed.
    var order = Data.state.library.publishTabs.map(function (t) { return t.id; })
      .filter(function (t) { return byTab[t]; });
    if (byTab['']) order.push('');

    var html = '<div class="row-actions">' + btn('new-faq', {}, '+ New question') + '</div>' +
      order.map(function (tab) {
        return '<h2 class="group">' + e(tab ? labels[tab] || tab : 'Not published') +
          ' <span>' + byTab[tab].length + '</span></h2>' +
          byTab[tab].slice().sort(function (a, b) {
            return ((a.publish || {}).order || 0) - ((b.publish || {}).order || 0);
          }).map(function (q) {
            return listRow('#/faq/' + q.id, q.q, q.ownerId ? Data.taxonomyName(q.ownerId) : '', '');
          }).join('');
      }).join('');
    paint(listPane('FAQ questions',
      plural(Data.state.library.faqs.length, 'question') + ' across ' +
      plural(Data.state.library.publishTabs.length, 'published tab'), html));
  }

  function renderVariableList() {
    var byOwner = {};
    Data.state.variables.variables.forEach(function (v) {
      (byOwner[v.ownerId || 'unassigned'] = byOwner[v.ownerId || 'unassigned'] || []).push(v);
    });

    var html = '<div class="row-actions">' + btn('new-variable', {}, '+ New variable') + '</div>' +
      Object.keys(byOwner).sort().map(function (owner) {
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
      plural(Data.state.variables.variables.length, 'variable') + ' · ' + pending +
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
        { type: 'select', options: departmentOptions('No owner yet'), placeholder: 'No owner yet' }) + '</span>' +
      (v.internal ? '<span class="badge lock">🔒 internal</span>' : '') +
      '</div>' +
      '<div class="lede">' + f('variable:' + id + ':question',
        { placeholder: 'What you would ask the department' }) + '</div>' +
      '<div class="note">' + f('variable:' + id + ':note',
        { placeholder: 'Optional context for the department' }) + '</div>' +
      '<div class="row-actions">' +
      btn('verify', { variable: id }, '✓ Mark verified') +
      btn('copy-verification', { owner: v.ownerId || '' }, '⧉ Copy verification email') +
      '<span class="spacer"></span>' +
      (usage.processes.length
        ? '<span class="hint">In use, so it cannot be deleted</span>'
        : btn('del-variable', { variable: id }, 'Delete variable', 'small danger')) +
      '</div></header>' +

      '<section class="block meta"><h2>Verification</h2><dl>' +
      '<dt>Last verified</dt><dd>' + e(v.lastVerified || '— never —') + '</dd>' +
      '<dt>Verified by</dt><dd>' + e(v.verifiedBy || '—') + '</dd>' +
      '<dt>Identifier</dt><dd><code>' + e(v.id) + '</code></dd>' +
      '<dt>Internal only</dt><dd>' + f('variable:' + id + ':internal',
        { type: 'select', options: [{ value: true, label: 'Yes — never publish' },
          { value: false, label: 'No — safe to publish' }] }) + '</dd>' +
      '</dl></section>' +

      '<section class="block"><h2>Used in ' + plural(usage.processes.length, 'place') + '</h2>' +
      (used || '<p class="empty">Not referenced anywhere yet.</p>') +
      '</section></article>');
  }

  // ---- issues register -----------------------------------------------------

  var expanded = {};
  var opened = {};
  var SHOW_FIRST = 8;

  function renderIssueRegister() {
    var recorded = Data.allIssues();
    var resolved = Data.allIssues({ resolved: 'only' });
    var counts = { high: 0, medium: 0, low: 0 };
    recorded.forEach(function (x) { counts[x.issue.severity] = (counts[x.issue.severity] || 0) + 1; });
    var ruleTotals = Rules.totals();

    var html = '<div class="row-actions">' +
      btn('export-issues-html', {}, '⤓ Report (HTML)') +
      btn('export-issues-csv', {}, '⤓ CSV') +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/rules">⚙ Content rules</button>' +
      '</div>';

    // --- recorded by people: these are judgements, so they come first
    html += '<h2 class="group">Recorded issues <span>' + recorded.length + ' open · ' +
      counts.high + ' high, ' + counts.medium + ' medium, ' + counts.low + ' low</span></h2>' +
      (recorded.length
        ? recorded.map(function (entry) {
            return '<button class="list-row issue-list sev-' + e(entry.issue.severity) + '"' +
              ' data-route="#/process/' + e(entry.process.id) + '">' +
              '<span class="sev">' + e(entry.issue.severity) + '</span>' +
              '<span class="list-title">' + e(entry.process.name) + '</span>' +
              '<span class="list-sub">' + e(entry.issue.note) + '</span>' +
              '</button>';
          }).join('')
        : '<p class="empty">Nothing open. Raise one from any process with ⚑.</p>');

    if (resolved.length) {
      html += '<details class="resolved"><summary>' + plural(resolved.length, 'resolved issue') +
        '</summary>' + resolved.map(function (entry) {
          return '<button class="list-row issue-list" data-route="#/process/' + e(entry.process.id) + '">' +
            '<span class="sev">✓ ' + e(entry.issue.resolved) + '</span>' +
            '<span class="list-title">' + e(entry.process.name) + '</span>' +
            '<span class="list-sub">' + e(entry.issue.note) +
            (entry.issue.resolution ? ' — ' + e(entry.issue.resolution) : '') + '</span>' +
            '</button>';
        }).join('') + '</details>';
    }

    // --- flagged by rules: computed, so collapsed until wanted
    html += '<h2 class="group">Flagged by rules <span>' +
      ruleTotals.findings + ' from ' + plural(ruleTotals.rules, 'rule') + '</span></h2>';

    var results = Rules.run().filter(function (r) { return !r.skipped; });
    if (!results.length) {
      html += '<p class="empty">No rules yet. ' +
        '<button class="btn tiny" data-act="seed-rules">Add a starting set</button></p>';
    } else {
      html += results.map(renderRuleFindings).join('');
    }

    paint(listPane('Issues register',
      recorded.length + ' open · ' + resolved.length + ' resolved · ' +
      ruleTotals.findings + ' flagged by rules', html));
  }

  function renderRuleFindings(result) {
    var rule = result.rule;
    var findings = result.findings;
    var isOpen = opened[rule.id];
    var showAll = expanded[rule.id];
    var shown = showAll ? findings : findings.slice(0, SHOW_FIRST);

    var head = '<div class="rule-block sev-' + e(rule.severity || 'medium') + '">' +
      '<button class="rule-head" data-act="toggle-rule-block" data-rule="' + e(rule.id) + '"' +
      (findings.length ? '' : ' disabled') + '>' +
      '<span class="caret">' + (findings.length ? (isOpen ? '▾' : '▸') : '') + '</span>' +
      '<span class="sev">' + e(rule.severity || 'medium') + '</span>' +
      '<span class="rule-name">' + e(rule.name) + '</span>' +
      '<span class="rule-count' + (findings.length ? '' : ' clear') + '">' +
      (findings.length ? findings.length + ' found' : 'nothing found') + '</span>' +
      '</button>';

    if (result.error) {
      return head + '<p class="rule-error">' + e(result.error) + '</p></div>';
    }
    var skipped = result.draftsSkipped
      ? '<p class="rule-skipped">' + plural(result.draftsSkipped, 'draft') +
        ' not checked yet — this rule leaves drafts alone.</p>'
      : '';
    if (!findings.length || !isOpen) return head + skipped + '</div>';

    var body = rule.message
      ? '<p class="rule-message">' + e(rule.message) + '</p>' : '';

    body += shown.map(function (f) {
      return '<button class="list-row finding" data-route="' + e(f.route) + '">' +
        '<span class="list-title">' + e(f.label) + '</span>' +
        '<span class="list-sub">' + e(f.where) +
        (f.detail ? ' — ' + e(f.detail) : '') + '</span></button>';
    }).join('');

    if (findings.length > SHOW_FIRST) {
      body += '<button class="btn tiny" data-act="show-all" data-rule="' + e(rule.id) + '">' +
        (showAll ? 'Show fewer' : 'Show all ' + findings.length) + '</button>';
    }

    return head + skipped + body + '</div>';
  }

  // ---- rules manager -------------------------------------------------------

  var RULE_KINDS = [
    { value: 'text', label: 'Text that should no longer appear' },
    { value: 'empty', label: 'A field that should be filled in' },
    { value: 'stale', label: 'A date not touched for a while' },
    { value: 'unused', label: 'Content nothing references' }
  ];

  var FIELD_HINTS = {
    empty: 'owner · responsibleRole · escalationPoint · timeframe · sop · ownerId',
    stale: 'lastReviewed · lastVerified'
  };

  function renderRules() {
    var all = Rules.list();
    var results = {};
    Rules.run().forEach(function (r) { results[r.rule.id] = r; });

    var html = '<div class="row-actions">' +
      btn('add-rule', {}, '+ New rule') +
      (all.length ? '' : btn('seed-rules', {}, 'Add a starting set')) +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/issues">← Issues register</button>' +
      '</div>';

    if (!all.length) {
      html += '<p class="empty">No rules yet. A rule is a standing check across ' +
        'every process, article and FAQ — add one whenever something in the ' +
        'organisation changes.</p>';
    }

    html += all.map(function (rule) {
      var spec = 'rule:' + rule.id + ':';
      var found = (results[rule.id] && results[rule.id].findings.length) || 0;
      var off = rule.enabled === false;

      var body = '';
      if (rule.kind === 'text') {
        body += field('Look for', f(spec + 'match:value',
          { placeholder: 'e.g. Merit' })) +
          field('Matching', f(spec + 'match:mode', { type: 'select', options: [
            { value: 'phrase', label: 'This exact wording' },
            { value: 'regex', label: 'A pattern (regular expression)' }] })) +
          field('Whole words only', f(spec + 'match:wholeWord',
            { type: 'select', options: YES_NO, placeholder: 'No' })) +
          field('Match capitals exactly', f(spec + 'match:caseSensitive',
            { type: 'select', options: YES_NO, placeholder: 'No' }));
      }
      if (rule.kind === 'empty' || rule.kind === 'stale') {
        body += field('Field', f(spec + 'field',
          { placeholder: FIELD_HINTS[rule.kind] }));
      }
      if (rule.kind === 'stale') {
        body += field('Older than (months)', f(spec + 'months', { placeholder: '12' }));
      }
      body += field('Leave drafts alone', f(spec + 'ignoreDraft',
        { type: 'select', options: YES_NO, placeholder: 'No' }));

      return '<div class="rule-card' + (off ? ' off' : '') + '" id="rule-' + e(rule.id) + '">' +
        '<div class="rule-card-head">' +
        '<span class="rule-name">' + f(spec + 'name') + '</span>' +
        '<span class="rule-count' + (found ? '' : ' clear') + '">' +
        (off ? 'disabled' : found + ' found') + '</span>' +
        btn('toggle-rule', { rule: rule.id }, off ? 'Enable' : 'Disable', 'tiny') +
        btn('del-rule', { rule: rule.id }, '×', 'tiny danger', 'Delete rule') +
        '</div>' +
        '<div class="rule-grid">' +
        field('Check', f(spec + 'kind', { type: 'select', options: RULE_KINDS })) +
        field('Severity', f(spec + 'severity', { type: 'select',
          options: options(['high', 'medium', 'low']) })) +
        body +
        field('Applies to', scopeEditor(rule)) +
        '</div>' +
        field('What to tell the reader', f(spec + 'message',
          { type: 'multiline', placeholder: 'Why this matters and what to do about it' })) +
        '</div>';
    }).join('');

    paint(listPane('Content rules',
      plural(all.length, 'rule') + ' · ' + Rules.totals().findings + ' findings across the corpus',
      html));
  }

  function field(label, control) {
    return '<div class="rule-field"><label>' + e(label) + '</label>' + control + '</div>';
  }

  function scopeEditor(rule) {
    var chosen = rule.scope || [];
    return '<div class="scope-row">' + Rules.SCOPES.map(function (scope) {
      var on = chosen.indexOf(scope) !== -1;
      return '<button class="scope-chip' + (on ? ' on' : '') +
        '" data-act="scope" data-rule="' + e(rule.id) + '" data-scope="' + e(scope) +
        '">' + e(scope) + '</button>';
    }).join('') + '</div>';
  }

  // ---- coverage ------------------------------------------------------------

  function statusBar(row, statuses) {
    if (!row.processes) return '<div class="cov-bar empty"></div>';
    return '<div class="cov-bar">' + statuses.map(function (s) {
      var n = row.byStatus[s] || 0;
      if (!n) return '';
      return '<span style="flex:' + n + ';background:' + Exporter.STATUS_COLOUR[s] +
        '" title="' + e(s.replace('_', ' ')) + ': ' + n + '"></span>';
    }).join('') + '</div>';
  }

  function renderCoverage() {
    var cov = Data.coverage(Rules.byProcess());
    var statuses = cov.statuses;
    var t = cov.total;
    var done = (t.byStatus.reviewed || 0) + (t.byStatus.published || 0);

    var html = '<div class="row-actions">' +
      btn('export-coverage', {}, '⤓ Report (HTML)') +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/departments">⚙ Departments</button></div>' +
      '<section class="tiles">' +
      tile(t.processes, 'processes', done + ' reviewed or published', '') +
      tile(t.byStatus.draft || 0, 'still draft', Math.round((t.byStatus.draft || 0) / Math.max(1, t.processes) * 100) + '% of the total', '') +
      tile(t.handoffs, 'handoffs', 'between departments', '') +
      tile(t.issues, 'open issues', t.high + ' high', '#/issues') +
      '</section>' +
      '<p class="cov-legend">' + statuses.map(function (s) {
        return '<span><i style="background:' + Exporter.STATUS_COLOUR[s] + '"></i>' +
          e(s.replace('_', ' ')) + ' ' + (t.byStatus[s] || 0) + '</span>';
      }).join('') + '</p>' +
      '<div class="cov-table" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Processes</span>' +
      '<span class="cov-barcol">Status</span><span>Handoffs</span><span>Issues</span>' +
      '<span>Findings</span></div>' +
      cov.rows.filter(function (r) { return r.processes; }).map(function (r) {
        return '<div class="cov-row depth-' + r.depth + '" role="row">' +
          '<span class="cov-name">' + e(r.node.name) + '</span>' +
          '<span class="num">' + r.processes + '</span>' +
          '<span class="cov-barcol">' + statusBar(r, statuses) + '</span>' +
          '<span class="num">' + r.handoffs + '</span>' +
          '<span class="num">' + r.issues + (r.high ? ' <em>' + r.high + ' high</em>' : '') + '</span>' +
          '<span class="num">' + r.findings + '</span></div>';
      }).join('') + '</div>';

    html += '<h2 class="group">Variables by owning department</h2>' +
      '<div class="cov-table vars" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Total</span>' +
      '<span>Current</span><span>Pending</span><span>Stale</span></div>' +
      cov.variables.map(function (v) {
        return '<div class="cov-row" role="row"><span class="cov-name">' +
          e(v.ownerId ? Data.taxonomyName(v.ownerId) : 'Unassigned') + '</span>' +
          '<span class="num">' + v.total + '</span><span class="num">' + (v.current || 0) + '</span>' +
          '<span class="num">' + (v.pending || 0) + '</span><span class="num">' + (v.stale || 0) +
          '</span></div>';
      }).join('') + '</div>';

    paint(listPane('Coverage', t.processes + ' processes identified, ' + done +
      ' reviewed or published', html));
  }

  // ---- departments ---------------------------------------------------------

  function renderDepartments() {
    var index = Data.state.index;

    function parentOptions(node) {
      return [{ value: '', label: 'Top level' }].concat(
        Data.state.processes.taxonomy.filter(function (n) {
          return n.id !== node.id && !Edit.wouldLoop(node.id, n.id);
        }).map(function (n) {
          return { value: n.id, label: Data.taxonomyPath(n.id) };
        }).sort(function (a, b) { return a.label.localeCompare(b.label); }));
    }

    function row(node, depth) {
      var used = Edit.taxonomyUsage(node.id);
      var bits = [];
      if (used.processes) bits.push(plural(used.processes, 'process', 'processes'));
      if (used.steps) bits.push(plural(used.steps, 'step'));
      if (used.owned) bits.push(used.owned + ' owned');
      var html = '<div class="dept-row depth-' + depth + '">' +
        '<span class="dept-name">' + f('taxonomy:' + node.id + ':name') + '</span>' +
        '<span class="dept-used">' + e(bits.join(' · ') || 'empty') + '</span>' +
        '<span class="dept-parent">' + f('taxonomy:' + node.id + ':parentId',
          { type: 'select', options: parentOptions(node), placeholder: 'Top level' }) + '</span>' +
        '<span class="dept-tools">' +
        btn('dept-up', { dept: node.id }, '↑', 'tiny', 'Move up') +
        btn('dept-down', { dept: node.id }, '↓', 'tiny', 'Move down') +
        btn('new-dept', { parent: node.id }, '+ Sub', 'tiny', 'Add a sub-department') +
        btn('new-process', { taxonomy: node.id }, '+ Process', 'tiny', 'Add a process here') +
        (used.total
          ? ''
          : btn('del-dept', { dept: node.id }, '×', 'tiny danger', 'Delete this empty department')) +
        '</span></div>';
      (index.children[node.id] || []).forEach(function (child) { html += row(child, depth + 1); });
      return html;
    }

    var html = '<div class="row-actions">' + btn('new-dept', {}, '+ New department') +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/coverage">Coverage →</button></div>' +
      '<p class="hint-block">Rename by clicking a name. Choose a new parent to move a ' +
      'department, along with everything under it. A department can only be deleted ' +
      'once nothing is filed under it and nothing names it as owner.</p>' +
      '<div class="dept-list">' +
      (index.children.__root__ || []).map(function (n) { return row(n, 0); }).join('') +
      '</div>';

    paint(listPane('Departments', plural(Data.state.processes.taxonomy.length, 'department') +
      ' and sub-departments', html));
  }

  // ---- home ----------------------------------------------------------------

  function renderHome() {
    var processes = Data.state.processes.processes;
    var crossing = processes.filter(function (p) { return Data.flow(p).handoffs > 0; });
    var drafts = processes.filter(function (p) { return p.status === 'draft'; });
    var pending = Data.state.variables.variables.filter(function (v) {
      return v.status === 'pending';
    });
    var open = Data.allIssues();
    var high = open.filter(function (x) { return x.issue.severity === 'high'; }).length;

    paint('<article class="pane">' +
      '<header class="pane-head"><h1>Process Hub</h1>' +
      '<p class="lede">Process maps, knowledge base articles and public FAQ ' +
      'content in one place. Pick a process from the tree, or press ' +
      '<kbd>/</kbd> to search. Click any field to edit it.</p></header>' +
      '<section class="tiles">' +
      tile(processes.length, 'processes', drafts.length + ' still draft', '#/coverage') +
      tile(crossing.length, 'cross departments',
        crossing.reduce(function (n, p) { return n + Data.flow(p).handoffs; }, 0) +
        ' handoffs total', '#/coverage') +
      tile(Data.state.library.articles.length, 'articles', 'knowledge base', '#/articles') +
      tile(Data.state.library.faqs.length, 'FAQ questions',
        plural(Data.state.library.publishTabs.length, 'published tab'), '#/faqs') +
      tile(Data.state.variables.variables.length, 'variables',
        pending.length + ' awaiting verification', '#/variables') +
      tile(open.length, 'open issues', high + ' high severity', '#/issues') +
      '</section>' +
      '<section class="block"><h2>Most handoffs</h2>' +
      crossing.slice().sort(function (a, b) { return Data.flow(b).handoffs - Data.flow(a).handoffs; })
        .slice(0, 8).map(function (p) {
          var fl = Data.flow(p);
          return listRow('#/process/' + p.id, p.name,
            fl.departments.map(Data.taxonomyName).join(' → '),
            plural(fl.handoffs, 'handoff'));
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
    rules: renderRules,
    coverage: renderCoverage,
    departments: renderDepartments,
    home: renderHome,
    openAttach: openAttach
  };
}(window));
