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

    // -- the FAQ: order, tabs and step strips
    if (act === 'faq-up' || act === 'faq-down') {
      FaqOrder.nudge(d.tab || '', Number(d.index), act === 'faq-up' ? -1 : 1);
      refresh();
    }
    if (act === 'faq-add-question') {
      name = ask('The new question, as a customer would ask it:');
      if (name) onNavigate('#/faq/' + FaqOrder.addQuestion(d.tab || '', name));
    }
    if (act === 'faq-new-tab') {
      name = ask('Label for the new tab on the FAQ page:');
      if (name) onNavigate('#/tab/' + FaqOrder.createTab(name));
    }
    if (act === 'tab-up' || act === 'tab-down') {
      FaqOrder.moveTab(d.tab, act === 'tab-up' ? -1 : 1);
      refresh();
    }
    if (act === 'tab-delete') {
      var inTab = FaqOrder.questionsIn(d.tab).length;
      if (confirm('Delete this tab from the FAQ page?' + (inTab
          ? ' Its ' + plural(inTab, 'question') + ' move to "Not published" — nothing is lost.' : ''))) {
        FaqOrder.deleteTab(d.tab);
        onNavigate('#/faqs');
      }
    }
    if (act === 'tab-step-add') {
      var t1 = FaqOrder.tab(d.tab);
      if (t1) {
        t1.stepper = t1.stepper || [];
        t1.stepper.push({ label: 'STEP ' + (t1.stepper.length + 1), text: '' });
        Edit.touch();
        refresh();
      }
    }
    if (act === 'tab-step-del') {
      var t2 = FaqOrder.tab(d.tab);
      if (t2 && t2.stepper) {
        t2.stepper.splice(Number(d.index), 1);
        Edit.touch();
        refresh();
      }
    }

    // -- departments
    if (act === 'new-dept') {
      name = ask(d.parent ? 'Name of the new sub-department:' : 'Name of the new department:');
      if (name) {
        var newDept = Edit.createTaxonomy(d.parent || null, name);
        if (/^#\/department\//.test(location.hash)) onNavigate('#/department/' + newDept); else refresh();
      }
    }
    if (act === 'dept-up') { Edit.moveTaxonomy(d.dept, -1); refresh(); }
    if (act === 'dept-down') { Edit.moveTaxonomy(d.dept, 1); refresh(); }
    if (act === 'del-dept') {
      if (Edit.deleteTaxonomy(d.dept)) {
        if (/^#\/department\//.test(location.hash)) onNavigate('#/departments'); else refresh();
      }
      else alert('Only an empty department can be deleted — move its processes, ' +
        'steps, content and sub-departments elsewhere first.');
    }

    // -- variables
    if (act === 'verify') {
      var by = prompt('Verified by (name or department):', '');
      if (by !== null) { Edit.verifyVariable(d.variable, by); refresh(); }
    }
    if (act === 'source-seen') { Edit.sourceSeen(d.variable); refresh(); }
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
      onNavigate('#/rule/' + id);
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
        Rules.remove(d.rule);
        if (/^#\/rule\//.test(location.hash)) onNavigate('#/rules'); else refresh();
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
    var reuse = event.target.closest('select[data-use-source]');
    if (reuse) {
      var chosen = Data.sources().find(function (src) { return src.key === reuse.value; });
      if (chosen) Edit.useSource(reuse.dataset.useSource, chosen.title, chosen.url);
      refresh();
      return;
    }
    var mover = event.target.closest('select[data-move-faq]');
    if (mover) {
      FaqOrder.moveToTab(mover.dataset.moveFaq, mover.value);
      refresh();
      return;
    }
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

  var PUBLIC_FAQ = 'https://aaronunify2.github.io/UnifyVersion1/FAQ.html';

  function renderFaq(id) {
    var q = Data.state.index.faqs[id];
    if (!q) return paint(notFound('FAQ question', id));
    var usage = Data.state.index.usage[id] || { processes: [], steps: 0 };

    var tabId = (q.publish && q.publish.tabId) || '';
    var tab = tabId ? FaqOrder.tab(tabId) : null;
    var at = FaqOrder.indexOf(id);
    var rows = FaqOrder.rows(tabId);
    var questions = rows.filter(function (r) { return r.type === 'faq'; });
    var position = questions.findIndex(function (r) { return r.faq.id === id; }) + 1;
    var heading = tabId && q.publish && q.publish.groupTitle;

    var tabOptions = '<option value="">Not published</option>' +
      Data.state.library.publishTabs.map(function (t) {
        return '<option value="' + e(t.id) + '"' + (t.id === tabId ? ' selected' : '') + '>' +
          e(Data.plainText(t.label)) + '</option>';
      }).join('');

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs">FAQ · ' + (tab
        ? '<a href="#/tab/' + e(tabId) + '">' + e(Data.plainText(tab.label)) + '</a>' +
          (heading ? ' › ' + e(heading) : '')
        : 'not published') + '</div>' +
      '<h1 class="editable-h1">' + f('faq:' + id + ':q', { type: 'inlinehtml' }) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge status-' + e(q.status) + '">' + f('faq:' + id + ':status',
        { type: 'select', options: options(['draft', 'review', 'approved', 'published']) }) +
      '</span>' +
      '<span class="badge quiet">' + f('faq:' + id + ':ownerId',
        { type: 'select', options: departmentOptions('No owner yet'), placeholder: 'No owner yet' }) + '</span>' +
      (q.lastReviewed ? '<span class="badge quiet">' + e(q.lastReviewed) + '</span>' : '') +
      '</div>' + renderUsage(usage) +
      '<div class="row-actions">' +
      (tabId
        ? '<a class="btn small" href="' + e(PUBLIC_FAQ + '#' + tabId) + '" target="_blank" ' +
          'rel="noopener" title="Shows what is published, not your draft">View the public tab ↗</a>'
        : '') +
      '<span class="spacer"></span>' +
      btn('del-faq', { faq: id }, 'Delete question', 'small danger') + '</div>' +
      '</header>' +
      '<section class="block meta"><h2>Where it is published</h2><dl>' +
      '<dt>Tab on the FAQ page</dt><dd><select class="inline-select" data-move-faq="' + e(id) +
      '" aria-label="Tab on the FAQ page">' + tabOptions + '</select></dd>' +
      '<dt>Position</dt><dd class="faq-position">' +
      (position ? position + ' of ' + questions.length : '—') +
      (heading ? ', under <strong>' + e(heading) + '</strong>' : '') +
      (at && at.index !== -1
        ? ' ' + btn('faq-up', { tab: tabId, index: at.index }, '↑', 'tiny', 'Move up') +
          btn('faq-down', { tab: tabId, index: at.index }, '↓', 'tiny', 'Move down')
        : '') +
      '<span class="hint">Or drag it in the list on the left.</span></dd>' +
      '<dt>Internal only</dt><dd>' + f('faq:' + id + ':internal',
        { type: 'select', options: YES_NO }) + '</dd>' +
      '</dl></section>' +
      '<section class="block"><h2>Answer — public wording</h2><div id="richHost"></div></section>' +
      answerSources(q) +
      renderUsedIn(usage) + '</article>');

    RichText.mount(document.getElementById('richHost'), {
      html: q.a,
      headerHtml: q.q,
      onChange: function (html) { Edit.set('faq:' + id + ':a', html); }
    });
  }

  // ---- the FAQ dashboard ---------------------------------------------------

  function faqStats() {
    var faqs = Data.state.library.faqs;
    var findings = {};
    Rules.run().forEach(function (result) {
      if (result.skipped) return;
      result.findings.forEach(function (fd) {
        if (fd.kind === 'faq') (findings[fd.id] = findings[fd.id] || []).push(fd);
      });
    });

    return faqs.map(function (f) {
      var facts = Data.faqFacts(f);
      return {
        faq: f,
        tabId: (f.publish && f.publish.tabId) || '',
        ready: facts.ready,
        owned: !!f.ownerId,
        linked: facts.linked,
        unconfirmed: facts.unconfirmed,
        findings: findings[f.id] || []
      };
    });
  }

  function renderFaqDashboard() {
    var stats = faqStats();
    var tabs = Data.state.library.publishTabs;
    var count = function (test) { return stats.filter(test).length; };

    var total = stats.length;
    var unpublished = count(function (x) { return !x.tabId; });
    var notReady = count(function (x) { return !x.ready; });
    var noOwner = count(function (x) { return !x.owned; });
    var linked = count(function (x) { return x.linked; });
    var unconfirmed = count(function (x) { return x.unconfirmed; });
    var flagged = count(function (x) { return x.findings.length; });

    var html = '<div class="row-actions">' +
      btn('new-faq', {}, '+ New question') +
      btn('faq-new-tab', {}, '+ New tab') +
      '<span class="spacer"></span>' +
      '<a class="btn small" href="' + PUBLIC_FAQ + '" target="_blank" rel="noopener" ' +
      'title="Shows what is published, not your draft">Public FAQ page ↗</a>' +
      '</div>' +
      '<section class="tiles">' +
      tile(total, 'questions', 'across ' + plural(tabs.length, 'tab'), '') +
      tile(unpublished, 'not published', unpublished ? 'in no tab yet' : 'every question is placed', '') +
      tile(notReady, 'not yet approved', 'draft or in review', '') +
      tile(noOwner, 'without an owner', 'no department accountable', '') +
      tile(linked, 'linked to processes', (total - linked) + ' not attached to any step', '') +
      tile(unconfirmed, 'use unconfirmed values', 'a fee, time or link not yet verified', '#/variables') +
      '</section>';

    // --- by tab
    html += '<h2 class="group">By tab</h2>' +
      '<div class="cov-table faq-tabs" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Tab</span><span>Questions</span>' +
      '<span>Sections</span><span>Not approved</span><span>Linked</span><span>Last reviewed</span></div>' +
      tabs.map(function (tab) {
        var mine = stats.filter(function (x) { return x.tabId === tab.id; });
        var sections = FaqOrder.rows(tab.id).filter(function (r) { return r.type === 'group'; }).length;
        var waiting = mine.filter(function (x) { return !x.ready; }).length;
        var joined = mine.filter(function (x) { return x.linked; }).length;
        return '<button class="cov-row cov-link" role="row" data-route="#/tab/' + e(tab.id) + '">' +
          '<span class="cov-name">' + e(Data.plainText(tab.label)) + (tab['new'] ? ' <em class="faq-new">NEW</em>' : '') +
          '</span>' +
          '<span class="num">' + mine.length + '</span>' +
          '<span class="num">' + (sections || '—') + '</span>' +
          '<span class="num' + (waiting ? ' warn' : '') + '">' + waiting + '</span>' +
          '<span class="num">' + joined + '</span>' +
          '<span class="when">' + e(tab.lastReviewed || '—') + '</span></button>';
      }).join('') + '</div>';

    // --- needs attention
    var attention = stats.filter(function (x) {
      return !x.tabId || !x.ready || !x.owned || x.findings.length;
    }).slice(0, 12);
    html += '<h2 class="group">Needs attention <span>' +
      count(function (x) { return !x.tabId || !x.ready || !x.owned || x.findings.length; }) +
      '</span></h2>' +
      (attention.length
        ? attention.map(function (x) {
            var why = [];
            if (!x.tabId) why.push('not published');
            if (!x.ready) why.push(x.faq.status || 'no status');
            if (!x.owned) why.push('no owner');
            x.findings.forEach(function (fd) { why.push(fd.message); });
            var tab = x.tabId ? FaqOrder.tab(x.tabId) : null;
            return listRow('#/faq/' + x.faq.id, Data.plainText(x.faq.q),
              (tab ? Data.plainText(tab.label) + ' · ' : '') + why.join(' · '), '');
          }).join('')
        : '<p class="empty">Nothing outstanding.</p>') +
      (flagged ? '<p class="hint-block">' + plural(flagged, 'question') + ' flagged by content ' +
        'rules — see the <a href="#/issues">issues register</a>.</p>' : '');

    paint(listPane('FAQ', total + ' questions on the public FAQ page, in ' +
      plural(tabs.length, 'tab') + '. Pick a question on the left to edit it, or drag to reorder.',
      html));
  }

  // ---- a publish tab -------------------------------------------------------

  function renderTab(id) {
    var tab = FaqOrder.tab(id);
    if (!tab) return paint(notFound('FAQ tab', id));
    var tabs = Data.state.library.publishTabs;
    var at = tabs.indexOf(tab);
    var rows = FaqOrder.rows(id);
    var questions = rows.filter(function (r) { return r.type === 'faq'; });
    var spec = 'tab:' + id + ':';

    var processOptions = [{ value: '', label: 'Written by hand, below' }].concat(
      Data.state.processes.processes.map(function (p) {
        return { value: p.id, label: 'Generated from: ' + p.name };
      }).sort(function (a, b) { return a.label.localeCompare(b.label); }));

    var stepper;
    if (tab.stepperFrom) {
      var source = Data.state.index.processes[tab.stepperFrom];
      stepper = '<p class="hint-block">The steps are generated from the process map every time ' +
        'you publish, so they never drift from it.' +
        (source ? ' <a href="#/process/' + e(source.id) + '">Open ' + e(source.name) + '</a>' : '') +
        '</p><div class="stepper-preview">' +
        (source ? source.steps.filter(function (st) { return st.type !== 'decision'; })
          .map(function (st, i) {
            return '<span class="sp-step"><b>STEP ' + (i + 1) + '</b>' + e(Data.freeze(st.title)) + '</span>';
          }).join('') : '<p class="empty">That process no longer exists.</p>') + '</div>';
    } else {
      stepper = '<div class="stepper-rows">' + (tab.stepper || []).map(function (st, i) {
        return '<div class="stepper-row">' +
          '<span class="sr-label">' + f('tabstep:' + id + ':' + i + ':label', { placeholder: 'STEP ' + (i + 1) }) + '</span>' +
          '<span class="sr-text">' + f('tabstep:' + id + ':' + i + ':text', { placeholder: 'Short description' }) + '</span>' +
          btn('tab-step-del', { tab: id, index: i }, '×', 'tiny danger', 'Remove step') +
          '</div>';
      }).join('') + '</div>' +
        btn('tab-step-add', { tab: id }, '+ Step', 'tiny');
    }

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/faqs">FAQ</a> · tab ' + (at + 1) + ' of ' + tabs.length + '</div>' +
      '<h1 class="editable-h1">' + f(spec + 'label', { type: 'inlinehtml' }) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge quiet">' + plural(questions.length, 'question') + '</span>' +
      '<span class="badge quiet">NEW badge: ' + f(spec + 'new', { type: 'select', options: YES_NO }) + '</span>' +
      '<span class="badge quiet">Last reviewed: ' + f(spec + 'lastReviewed', { placeholder: 'e.g. October 2026' }) + '</span>' +
      '</div>' +
      '<p class="usage">Public link: <code>FAQ.html#' + e(id) + '</code></p>' +
      '<div class="row-actions">' +
      btn('faq-add-question', { tab: id }, '+ Question in this tab') +
      '<a class="btn small" href="' + e(PUBLIC_FAQ + '#' + id) + '" target="_blank" rel="noopener" ' +
      'title="Shows what is published, not your draft">View the public tab ↗</a>' +
      '<span class="spacer"></span>' +
      btn('tab-up', { tab: id }, '↑ Move tab up', 'small', '') +
      btn('tab-down', { tab: id }, '↓ Move tab down', 'small', '') +
      btn('tab-delete', { tab: id }, 'Delete tab', 'small danger') +
      '</div></header>' +

      '<section class="block"><h2>Intro box <span class="count">optional</span></h2>' +
      '<div id="tabIntro"></div></section>' +

      '<section class="block"><h2>Step strip <span class="count">optional</span></h2>' +
      '<div class="tab-stepper-source">' + f(spec + 'stepperFrom',
        { type: 'select', options: processOptions, placeholder: 'Written by hand, below' }) + '</div>' +
      stepper + '</section>' +

      '<section class="block"><h2>Footer links <span class="count">optional</span></h2>' +
      '<div id="tabFooter"></div></section>' +

      '<section class="block"><h2>Questions</h2>' +
      (rows.length
        ? rows.map(function (r) {
            if (r.type === 'group') return '<h3 class="tab-q-heading">' + e(r.title) + '</h3>';
            return listRow('#/faq/' + r.faq.id, Data.plainText(r.faq.q), '', '');
          }).join('') + '<p class="hint-block">Reorder them in the list on the left.</p>'
        : '<p class="empty">No questions yet.</p>') +
      '</section></article>');

    RichText.mount(document.getElementById('tabIntro'), {
      html: tab.intro || '',
      headerHtml: '',
      onChange: function (html) { Edit.set(spec + 'intro', html); }
    });
    RichText.mount(document.getElementById('tabFooter'), {
      html: tab.footer || '',
      headerHtml: '',
      onChange: function (html) { Edit.set(spec + 'footer', html); }
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

  /** Items grouped by owning department, "No owner" last. */
  function byOwner(items) {
    var groups = {};
    items.forEach(function (x) {
      var key = x.ownerId && Data.state.index.taxonomy[x.ownerId] ? x.ownerId : '';
      (groups[key] = groups[key] || []).push(x);
    });
    return Object.keys(groups).map(function (key) {
      return { ownerId: key, label: key ? Data.taxonomyPath(key) : 'No owner', items: groups[key] };
    }).sort(function (a, b) {
      if (!a.ownerId) return 1;
      if (!b.ownerId) return -1;
      return a.label.localeCompare(b.label);
    });
  }

  function usesOf(id) {
    var usage = Data.state.index.usage[id];
    return usage ? usage.processes.length : 0;
  }

  // ---- knowledge base dashboard --------------------------------------------

  function renderArticleDashboard() {
    var articles = Data.state.library.articles;
    var count = function (test) { return articles.filter(test).length; };
    var current = count(function (a) { return a.status === 'current'; });
    var notCurrent = articles.length - current;
    var unused = count(function (a) { return !usesOf(a.id); });
    var noOwner = count(function (a) { return !a.ownerId; });
    var publicOnes = count(function (a) { return a.audience === 'public' || a.audience === 'both'; });

    var html = '<div class="row-actions">' + btn('new-article', {}, '+ New article') + '</div>' +
      '<section class="tiles">' +
      tile(articles.length, 'articles', 'in the knowledge base', '') +
      tile(current, 'current', notCurrent + ' draft or in review', '') +
      tile(unused, 'not attached', 'no process step links to them', '') +
      tile(noOwner, 'without an owner', 'no department accountable', '') +
      tile(publicOnes, 'public-facing', (articles.length - publicOnes) + ' internal only', '') +
      '</section>';

    html += '<h2 class="group">By owning department</h2>' +
      '<div class="cov-table dash-table" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Articles</span>' +
      '<span>Current</span><span>Not attached</span></div>' +
      byOwner(articles).map(function (g) {
        return '<div class="cov-row" role="row"><span class="cov-name">' + e(g.label) + '</span>' +
          '<span class="num">' + g.items.length + '</span>' +
          '<span class="num">' + g.items.filter(function (a) { return a.status === 'current'; }).length + '</span>' +
          '<span class="num">' + g.items.filter(function (a) { return !usesOf(a.id); }).length + '</span></div>';
      }).join('') + '</div>';

    var attention = articles.filter(function (a) {
      return !usesOf(a.id) || !a.ownerId || a.status !== 'current';
    });
    html += '<h2 class="group">Needs attention <span>' + attention.length + '</span></h2>' +
      (attention.length
        ? attention.slice(0, 12).map(function (a) {
            var why = [];
            if (a.status !== 'current') why.push(a.status || 'no status');
            if (!usesOf(a.id)) why.push('not attached to any step');
            if (!a.ownerId) why.push('no owner');
            return listRow('#/article/' + a.id, a.title, why.join(' · '), '');
          }).join('') +
          (attention.length > 12 ? '<p class="hint-block">…and ' + (attention.length - 12) +
            ' more in the list on the left.</p>' : '')
        : '<p class="empty">Nothing outstanding.</p>');

    paint(listPane('Knowledge base', plural(articles.length, 'article') +
      ' for officers. Pick one on the left to edit it.', html));
  }

  // ---- variables dashboard -------------------------------------------------

  function renderVariableDashboard() {
    var vars = Data.state.variables.variables;
    var count = function (test) { return vars.filter(test).length; };
    var byStatus = function (st) { return count(function (v) { return v.status === st; }); };
    var unused = count(function (v) { return !usesOf(v.id); });
    var internal = count(function (v) { return v.internal === true; });
    var sourced = count(Data.hasSource);
    var unsourced = vars.filter(Data.needsSource);

    var html = '<div class="row-actions">' + btn('new-variable', {}, '+ New variable') +
      '<span class="spacer"></span>' +
      btn('sheet-verification', { owner: '' }, '⤓ Verification sheet (all)') + '</div>' +
      '<section class="tiles">' +
      tile(vars.length, 'variables', 'fees, phone numbers, links, system names', '') +
      tile(byStatus('current'), 'verified', 'confirmed by their department', '') +
      tile(byStatus('pending'), 'awaiting verification', 'not yet confirmed', '') +
      tile(byStatus('stale'), 'stale', 'known to need checking', '') +
      tile(internal, 'internal only', 'never published', '') +
      tile(unused, 'not used', 'nothing refers to them', '') +
      tile(sourced, 'backed by a source', 'a published document to point to', '') +
      tile(unsourced.length, 'need a source', 'public values with none yet', '') +
      '</section>';

    html += '<h2 class="group">By owning department</h2>' +
      '<div class="cov-table dash-table vars-dash" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Total</span>' +
      '<span>Verified</span><span>Pending</span><span>Stale</span><span>Ask them</span></div>' +
      byOwner(vars).map(function (g) {
        var n = function (st) { return g.items.filter(function (v) { return v.status === st; }).length; };
        return '<div class="cov-row" role="row"><span class="cov-name">' + e(g.label) + '</span>' +
          '<span class="num">' + g.items.length + '</span>' +
          '<span class="num">' + n('current') + '</span>' +
          '<span class="num' + (n('pending') ? ' warn' : '') + '">' + n('pending') + '</span>' +
          '<span class="num' + (n('stale') ? ' warn' : '') + '">' + n('stale') + '</span>' +
          // No owner means nobody to ask, so no email for that row.
          '<span class="dash-actions">' + (g.ownerId
            ? btn('copy-verification', { owner: g.ownerId }, '⧉ Email', 'tiny', 'Copy a verification email') +
              btn('sheet-verification', { owner: g.ownerId }, '⤓ Sheet', 'tiny', 'Download a verification sheet')
            : '<span class="hint">set owners first</span>') +
          '</span></div>';
      }).join('') + '</div>';

    // Two different jobs, kept apart: verifying clears the first list, but
    // only using (or deleting) a variable clears the second.
    var toVerify = vars.filter(function (v) { return v.status !== 'current'; })
      .sort(function (a, b) {
        // Stale first — those are known to be wrong — then the rest.
        return (a.status === 'stale' ? 0 : 1) - (b.status === 'stale' ? 0 : 1);
      });
    var SHOW = 15;
    html += '<h2 class="group">Waiting to be verified <span>' + toVerify.length + '</span></h2>' +
      (toVerify.length
        ? toVerify.slice(0, SHOW).map(function (v) {
            return '<div class="verify-row">' +
              '<button class="list-row" data-route="#/variable/' + e(v.id) + '">' +
              '<span class="list-title">' + e(v.value) + (v.internal === true ? ' <span class="lock">🔒</span>' : '') + '</span>' +
              '<span class="list-sub">' + e((v.status === 'stale' ? 'STALE · ' : '') +
                (v.question || '') + (v.ownerId ? ' · ' + Data.taxonomyName(v.ownerId) : '')) + '</span>' +
              '</button>' +
              btn('verify', { variable: v.id }, '✓ Verified', 'small', 'Mark this value as confirmed') +
              '</div>';
          }).join('') +
          (toVerify.length > SHOW ? '<p class="hint-block">…and ' + (toVerify.length - SHOW) +
            ' more. Verified ones drop off this list, and the next come up.</p>' : '')
        : '<p class="empty">Every variable is verified.</p>');

    // Sources: what still needs one, then every document already cited.
    html += '<h2 class="group">Needs a public source <span>' + unsourced.length + '</span></h2>' +
      (unsourced.length
        ? '<p class="hint-block">Public values that don\'t yet name the published document ' +
          'they come from. Add one on the variable\'s own page.</p>' +
          unsourced.slice(0, SHOW).map(function (v) {
            return listRow('#/variable/' + v.id, v.value,
              (v.question || '') + (v.ownerId ? ' · ' + Data.taxonomyName(v.ownerId) : ''), '');
          }).join('') +
          (unsourced.length > SHOW ? '<p class="hint-block">…and ' + (unsourced.length - SHOW) +
            ' more. Each drops off this list once it has a source.</p>' : '')
        : '<p class="empty">Every public value has a source.</p>');

    var cited = Data.sources();
    html += '<h2 class="group">Public sources <span>' + cited.length + '</span></h2>' +
      (cited.length
        ? cited.map(sourceCard).join('')
        : '<p class="empty">No sources recorded yet.</p>');

    var unusedList = vars.filter(function (v) { return !usesOf(v.id); });
    html += '<h2 class="group">Not used anywhere <span>' + unusedList.length + '</span></h2>' +
      (unusedList.length
        ? '<p class="hint-block">Nothing refers to these. Verifying them does not change that — ' +
          'either insert them where they belong (the + Variable button when editing), or ' +
          'delete them from their own page.</p>' +
          unusedList.map(function (v) {
            return listRow('#/variable/' + v.id, v.value, v.question || '', v.status);
          }).join('')
        : '<p class="empty">Every variable is in use.</p>');

    paint(listPane('Variables', plural(vars.length, 'variable') + ' — each fact written once and ' +
      'used everywhere. Pick one on the left to edit or verify it.', html));
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

      sourceBlock(v) +

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

  // ---- public sources ------------------------------------------------------

  /** A link that is safe to put in an href: web addresses only. */
  function webLink(url, label) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return '';
    return '<a class="btn tiny" href="' + e(url) + '" target="_blank" rel="noopener">' +
      e(label || 'Open ↗') + '</a>';
  }

  /** The published document behind one variable, on the variable's page. */
  function sourceBlock(v) {
    var id = v.id;
    var s = v.source || {};
    var mine = Data.hasSource(v) ? String(s.url || s.title || '').trim().toLowerCase() : '';
    var others = Data.sources().filter(function (src) { return src.key !== mine; });

    return '<section class="block meta source-block"><h2>Public source</h2>' +
      (v.internal === true
        ? '<p class="hint-block">This value is internal and never published, so it doesn\'t ' +
          'need a public source.</p>'
        : '<p class="hint-block">The published document this value comes from, so you can ' +
          'point to it if anyone asks.</p>') +
      '<dl>' +
      '<dt>Document</dt><dd>' + f('variable:' + id + ':source.title',
        { placeholder: 'e.g. Fees and Charges 2026–27' }) + '</dd>' +
      '<dt>Link</dt><dd class="source-link">' + f('variable:' + id + ':source.url',
        { placeholder: 'https://…' }) + webLink(s.url) + '</dd>' +
      '<dt>Where it says so</dt><dd>' + f('variable:' + id + ':source.excerpt',
        { type: 'multiline', placeholder: 'Page or section, or the words quoted' }) + '</dd>' +
      '<dt>Last checked</dt><dd class="source-link">' + f('variable:' + id + ':source.checked',
        { placeholder: 'YYYY-MM-DD' }) +
      (Data.hasSource(v)
        ? btn('source-seen', { variable: id }, '✓ Seen it today', 'tiny',
            'Record that the source still says this, today')
        : '') + '</dd>' +
      '</dl>' +
      (others.length
        ? '<label class="source-reuse">Or use a source already cited ' +
          '<select class="inline-select" data-use-source="' + e(id) + '">' +
          '<option value="">Choose a document…</option>' +
          others.map(function (src) {
            return '<option value="' + e(src.key) + '">' + e(src.title || src.url) +
              ' (' + src.variables.length + ')</option>';
          }).join('') + '</select></label>'
        : '') +
      '</section>';
  }

  /** One cited document on the variables dashboard, with what it backs. */
  function sourceCard(src) {
    return '<div class="source-card">' +
      '<div class="source-head"><span class="source-title">' + e(src.title || src.url) + '</span>' +
      webLink(src.url) +
      '<span class="hint">' + plural(src.variables.length, 'value') + '</span></div>' +
      '<div class="source-vars">' + src.variables.map(function (v) {
        return '<a class="source-var" href="#/variable/' + e(v.id) + '"' +
          (v.question ? ' title="' + e(v.question) + '"' : '') + '>' + e(v.value) + '</a>';
      }).join('') + '</div></div>';
  }

  /** On an FAQ page: each value in the answer and where it comes from. */
  function answerSources(q) {
    var vars = Data.variablesIn(q.a);
    if (!vars.length) return '';
    var missing = vars.filter(Data.needsSource).length;
    return '<section class="block"><h2>Where the values come from</h2>' +
      '<p class="hint-block">Each fee, time, number or link in this answer, and the published ' +
      'document behind it' + (missing ? ' — ' + missing + ' with no source yet' : '') + '.</p>' +
      vars.map(function (v) {
        var s = v.source || {};
        var why;
        if (v.internal === true) why = '<span class="hint">internal — not published</span>';
        else if (!Data.hasSource(v)) why = '<span class="source-missing">no source yet</span>';
        else {
          why = '<span class="source-title">' + e(s.title || s.url) + '</span>' + webLink(s.url) +
            (s.excerpt ? '<span class="source-excerpt">' + e(s.excerpt) + '</span>' : '');
        }
        return '<div class="source-cite"><a class="source-var" href="#/variable/' + e(v.id) + '">' +
          e(v.value) + '</a>' + why + '</div>';
      }).join('') + '</section>';
  }

  // ---- issues register -----------------------------------------------------

  var expanded = {};
  var opened = {};
  var SHOW_FIRST = 8;

  function issueRoute(entry) {
    return '#/issue/' + entry.process.id + '/' + entry.issue.id;
  }

  function renderIssueRegister() {
    var recorded = Data.allIssues();
    var resolved = Data.allIssues({ resolved: 'only' });
    var counts = { high: 0, medium: 0, low: 0 };
    recorded.forEach(function (x) { counts[x.issue.severity] = (counts[x.issue.severity] || 0) + 1; });
    var ruleTotals = Rules.totals();
    var affected = {};
    recorded.forEach(function (x) { affected[x.process.id] = true; });

    var html = '<div class="row-actions">' +
      btn('export-issues-html', {}, '⤓ Report (HTML)') +
      btn('export-issues-csv', {}, '⤓ CSV') +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/rules">⚙ Content rules</button>' +
      '</div>' +
      '<section class="tiles">' +
      tile(recorded.length, 'open issues', Object.keys(affected).length + ' processes affected', '') +
      tile(counts.high || 0, 'high severity', 'fix these first', '') +
      tile(counts.medium || 0, 'medium', '', '') +
      tile(counts.low || 0, 'low', '', '') +
      tile(resolved.length, 'resolved', 'kept as a record', '') +
      tile(ruleTotals.findings, 'flagged by rules', 'from ' + plural(ruleTotals.rules, 'content rule'), '#/rules') +
      '</section>';

    // --- by department
    var byDept = {};
    recorded.forEach(function (x) {
      var top = Data.topDepartment(x.process.taxonomyId);
      var key = top ? top.id : '';
      var row = byDept[key] = byDept[key] || { open: 0, high: 0, processes: {} };
      row.open++;
      if (x.issue.severity === 'high') row.high++;
      row.processes[x.process.id] = true;
    });
    html += '<h2 class="group">By department</h2>' +
      '<div class="cov-table dash-table" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Open</span>' +
      '<span>High</span><span>Processes</span></div>' +
      Object.keys(byDept).sort(function (a, b) { return byDept[b].open - byDept[a].open; })
        .map(function (key) {
          var r = byDept[key];
          return '<div class="cov-row" role="row"><span class="cov-name">' +
            e(key ? Data.taxonomyName(key) : 'Unfiled') + '</span>' +
            '<span class="num">' + r.open + '</span>' +
            '<span class="num' + (r.high ? ' warn' : '') + '">' + r.high + '</span>' +
            '<span class="num">' + Object.keys(r.processes).length + '</span></div>';
        }).join('') + '</div>';

    // --- recorded by people: these are judgements, so they come first
    html += '<h2 class="group">Recorded issues <span>' + recorded.length + ' open</span></h2>' +
      (recorded.length
        ? recorded.map(function (entry) {
            return '<button class="list-row issue-list sev-' + e(entry.issue.severity) + '"' +
              ' data-route="' + e(issueRoute(entry)) + '">' +
              '<span class="sev">' + e(entry.issue.severity) + '</span>' +
              '<span class="list-title">' + e(entry.process.name) + '</span>' +
              '<span class="list-sub">' + e(entry.issue.note) + '</span>' +
              '</button>';
          }).join('')
        : '<p class="empty">Nothing open. Raise one from any process with ⚑.</p>');

    if (resolved.length) {
      html += '<details class="resolved"><summary>' + plural(resolved.length, 'resolved issue') +
        '</summary>' + resolved.map(function (entry) {
          return '<button class="list-row issue-list" data-route="' + e(issueRoute(entry)) + '">' +
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

  // ---- a single issue ------------------------------------------------------

  function renderIssue(processId, issueId) {
    var p = Data.state.index.processes[processId];
    var issue = p && (p.issues || []).find(function (i) { return i.id === issueId; });
    if (!issue) return paint(notFound('issue', issueId));
    var spec = 'issue:' + p.id + ':' + issue.id + ':';
    var steps = [{ value: '', label: 'The process as a whole' }].concat(p.steps.map(function (st, i) {
      return { value: st.id, label: (i + 1) + '. ' + Data.freeze(st.title) };
    }));

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/issues">Issues register</a> · ' +
      (issue.resolved ? 'resolved ' + e(issue.resolved) : e(issue.severity) + ' severity') + '</div>' +
      '<h1>' + e(p.name) + '</h1>' +
      '<div class="badges">' +
      (issue.resolved
        ? '<span class="badge status-published">✓ resolved</span>'
        : '<span class="badge sev-badge sev-' + e(issue.severity) + '">' + f(spec + 'severity',
            { type: 'select', options: options(['high', 'medium', 'low']) }) + '</span>') +
      '<span class="badge quiet">Raised ' + e(issue.raised || '—') + '</span>' +
      '<span class="badge quiet">By ' + f(spec + 'raisedBy', { placeholder: 'who raised it' }) + '</span>' +
      '</div>' +
      '<div class="row-actions">' +
      '<button class="btn small" data-route="#/process/' + e(p.id) + '">Open the process →</button>' +
      '<span class="spacer"></span>' +
      (issue.resolved
        ? btn('reopen-issue', { process: p.id, issue: issue.id }, 'Reopen') +
          btn('del-issue', { process: p.id, issue: issue.id }, 'Delete', 'small danger')
        : btn('resolve-issue', { process: p.id, issue: issue.id }, '✓ Resolve')) +
      '</div></header>' +
      '<section class="block"><h2>The issue</h2>' +
      '<div class="issue-note">' + f(spec + 'note', { type: 'multiline', placeholder: 'What is wrong or missing' }) + '</div>' +
      (issue.resolution ? '<p class="hint-block">Resolved: ' + e(issue.resolution) + '</p>' : '') +
      '</section>' +
      '<section class="block meta"><h2>Details</h2><dl>' +
      '<dt>About</dt><dd>' + f(spec + 'stepId', { type: 'select', options: steps, placeholder: 'The process as a whole' }) + '</dd>' +
      '<dt>Process sits under</dt><dd>' + e(Data.taxonomyPath(p.taxonomyId)) + '</dd>' +
      '<dt>Process status</dt><dd>' + e(p.status) + '</dd>' +
      '</dl></section></article>');
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

  function ruleCard(rule, found) {
    var spec = 'rule:' + rule.id + ':';
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
  }

  function renderRules() {
    var all = Rules.list();
    var results = {};
    Rules.run().forEach(function (r) { results[r.rule.id] = r; });
    var totals = Rules.totals();
    var enabled = all.filter(function (r) { return r.enabled !== false; }).length;

    var html = '<div class="row-actions">' +
      btn('add-rule', {}, '+ New rule') +
      (all.length ? '' : btn('seed-rules', {}, 'Add a starting set')) +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/issues">Issues register →</button>' +
      '</div>' +
      '<section class="tiles">' +
      tile(all.length, 'rules', enabled + ' switched on', '') +
      tile(totals.findings, 'findings', 'across the whole corpus', '#/issues') +
      tile(totals.high || 0, 'high severity', '', '') +
      tile(totals.medium || 0, 'medium', '', '') +
      tile(totals.low || 0, 'low', '', '') +
      '</section>';

    if (!all.length) {
      html += '<p class="empty">No rules yet. A rule is a standing check across ' +
        'every process, article and FAQ — add one whenever something in the ' +
        'organisation changes.</p>';
    } else {
      html += '<h2 class="group">All rules</h2>' +
        '<div class="cov-table dash-table rules-dash" role="table">' +
        '<div class="cov-row cov-headrow" role="row"><span>Rule</span><span>Check</span>' +
        '<span>Severity</span><span>Found</span></div>' +
        all.map(function (rule) {
          var r = results[rule.id];
          var kind = RULE_KINDS.find(function (k) { return k.value === rule.kind; });
          var off = rule.enabled === false;
          return '<button class="cov-row cov-link' + (off ? ' off' : '') + '" role="row" data-route="#/rule/' +
            e(rule.id) + '"><span class="cov-name">' + e(rule.name) + '</span>' +
            '<span class="when">' + e(kind ? kind.label : rule.kind) + '</span>' +
            '<span class="when">' + e(rule.severity || 'medium') + '</span>' +
            '<span class="num">' + (off ? 'off' : (r ? r.findings.length : 0)) + '</span></button>';
        }).join('') + '</div>';
    }
    html += '<p class="hint-block">A rule is a standing check. When something in the organisation ' +
      'changes — a system renamed, a form retired — add a rule and everything now wrong shows up ' +
      'in the issues register. Findings disappear by themselves once the content is fixed.</p>';

    paint(listPane('Content rules',
      plural(all.length, 'rule') + ' · ' + totals.findings + ' findings across the corpus', html));
  }

  function renderRule(id) {
    var rule = Rules.get(id);
    if (!rule) return paint(notFound('rule', id));
    var result = Rules.run().find(function (r) { return r.rule.id === id; }) || { findings: [] };
    expanded[id] = true;
    opened[id] = true;

    paint('<article class="pane">' +
      '<header class="pane-head"><div class="crumbs"><a href="#/rules">Content rules</a></div>' +
      '<h1>' + e(rule.name) + '</h1>' +
      '<p class="lede">' + (rule.enabled === false ? 'Switched off.' :
        plural(result.findings.length, 'finding') + ' at the moment.') + '</p></header>' +
      ruleCard(rule, result.findings.length) +
      '<section class="block"><h2>What it finds</h2>' +
      (result.error ? '<p class="rule-error">' + e(result.error) + '</p>' : '') +
      (result.findings.length
        ? result.findings.map(function (fd) {
            return '<button class="list-row finding" data-route="' + e(fd.route) + '">' +
              '<span class="list-title">' + e(fd.label) + '</span>' +
              '<span class="list-sub">' + e(fd.where) + (fd.detail ? ' — ' + e(fd.detail) : '') +
              '</span></button>';
          }).join('')
        : '<p class="empty">Nothing found.</p>') +
      (result.draftsSkipped ? '<p class="rule-skipped">' + plural(result.draftsSkipped, 'draft') +
        ' not checked — this rule leaves drafts alone.</p>' : '') +
      '</section></article>');
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
      tile(t.faq.total, 'FAQ questions', t.faq.published + ' on the public page', '#/faqs') +
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

    html += '<h2 class="group">FAQ questions by owning department</h2>' +
      faqTable(cov.rows, t) +
      '<h2 class="group">Variables by owning department</h2>' +
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
      var lib = Data.state.library;
      var ownedFaqs = lib.faqs.filter(function (q) { return q.ownerId === node.id; }).length;
      var ownedOther = used.owned - ownedFaqs;
      if (ownedFaqs) bits.push(plural(ownedFaqs, 'FAQ'));
      if (ownedOther) bits.push(ownedOther + ' other owned');
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

  // ---- FAQ figures for Coverage and Departments ------------------------------

  /** The coverage row for a department, which carries its FAQ figures. */
  function faqRowFor(id) {
    var row = Data.coverage().rows.find(function (r) { return r.node.id === id; });
    return row ? row.faq : null;
  }

  /** A strip of FAQ tiles for a department (and everything under it). */
  function faqTiles(faq) {
    if (!faq) return '';
    if (!faq.total) {
      return '<p class="hint-block faq-none">This department owns no FAQ questions.</p>';
    }
    return '<h2 class="group">FAQ questions it owns</h2>' +
      '<section class="tiles faq-tiles">' +
      tile(faq.total, 'FAQ questions', 'owned here or below', '') +
      tile(faq.published, 'on the public page', (faq.total - faq.published) + ' not published', '') +
      tile(faq.notReady, 'not yet approved', 'draft or in review', '') +
      tile(faq.linked, 'linked to a step', (faq.total - faq.linked) + ' not attached', '') +
      tile(faq.unconfirmed, 'use unconfirmed values', 'a value not yet verified', '') +
      '</section>';
  }

  /** The FAQ questions a department and its sub-departments own, as links. */
  function faqList(id) {
    var ids = [id];
    (function walk(parent) {
      (Data.state.index.children[parent] || []).forEach(function (c) { ids.push(c.id); walk(c.id); });
    }(id));
    var mine = Data.state.library.faqs.filter(function (q) { return ids.indexOf(q.ownerId) !== -1; });
    if (!mine.length) return '';
    return '<h2 class="group">FAQ questions <span>' + mine.length + '</span></h2>' +
      mine.map(function (q) {
        var facts = Data.faqFacts(q);
        var tab = facts.published ? FaqOrder.tab(q.publish.tabId) : null;
        var bits = [tab ? Data.plainText(tab.label) : 'not published', q.status || 'no status'];
        if (!facts.linked) bits.push('not attached to a step');
        if (facts.unconfirmed) bits.push('uses an unconfirmed value');
        return listRow('#/faq/' + q.id, Data.plainText(q.q), bits.join(' · '), '');
      }).join('');
  }

  /** FAQ figures per department, as a table matching the coverage table. */
  function faqTable(rows, total) {
    var shown = rows.filter(function (r) { return r.faq.total; });
    return '<div class="cov-table faq-cov" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Questions</span>' +
      '<span>On the page</span><span>Not approved</span><span>Linked</span><span>Unconfirmed</span></div>' +
      shown.map(function (r) {
        return '<button class="cov-row cov-link depth-' + r.depth + '" role="row" data-route="#/coverage/' +
          e(r.node.id) + '"><span class="cov-name">' + e(r.node.name) + '</span>' +
          '<span class="num">' + r.faq.total + '</span>' +
          '<span class="num">' + r.faq.published + '</span>' +
          '<span class="num' + (r.faq.notReady ? ' warn' : '') + '">' + r.faq.notReady + '</span>' +
          '<span class="num">' + r.faq.linked + '</span>' +
          '<span class="num' + (r.faq.unconfirmed ? ' warn' : '') + '">' + r.faq.unconfirmed + '</span></button>';
      }).join('') +
      '</div>' +
      '<p class="hint-block">"Linked" counts questions a process step points to. "Unconfirmed" counts ' +
      'answers that use a fee, time or link nobody has verified yet.' +
      (total.faqUnowned ? ' ' + plural(total.faqUnowned, 'question has', 'questions have') +
        ' no owning department and are not counted above.' : '') + '</p>';
  }

  // ---- one department's coverage -------------------------------------------

  function processesUnder(taxId) {
    var list = (Data.state.index.byTaxonomy[taxId] || []).slice();
    (Data.state.index.children[taxId] || []).forEach(function (child) {
      list = list.concat(processesUnder(child.id));
    });
    return list;
  }

  function renderCoverageDept(id) {
    var node = Data.state.index.taxonomy[id];
    if (!node) return paint(notFound('department', id));
    var cov = Data.coverage(Rules.byProcess());
    var row = cov.rows.find(function (r) { return r.node.id === id; });
    var statuses = cov.statuses;
    var done = (row.byStatus.reviewed || 0) + (row.byStatus.published || 0);
    var findings = Rules.byProcess();

    var html = '<section class="tiles">' +
      tile(row.processes, 'processes', done + ' reviewed or published', '') +
      tile(row.byStatus.draft || 0, 'still draft', '', '') +
      tile(row.handoffs, 'handoffs', 'between departments', '') +
      tile(row.issues, 'open issues', row.high + ' high', '') +
      tile(row.findings, 'rule findings', '', '') +
      '</section>' +
      faqTiles(row.faq) +
      '<p class="cov-legend">' + statuses.map(function (st) {
        return '<span><i style="background:' + Exporter.STATUS_COLOUR[st] + '"></i>' +
          e(st.replace('_', ' ')) + ' ' + (row.byStatus[st] || 0) + '</span>';
      }).join('') + '</p>' + statusBar(row, statuses);

    var groups = [{ node: node, list: Data.state.index.byTaxonomy[id] || [] }];
    (function walk(parent) {
      (Data.state.index.children[parent] || []).forEach(function (child) {
        groups.push({ node: child, list: Data.state.index.byTaxonomy[child.id] || [] });
        walk(child.id);
      });
    }(id));

    html += groups.filter(function (g) { return g.list.length; }).map(function (g) {
      return '<h2 class="group">' + e(g.node.name) + ' <span>' + g.list.length + '</span></h2>' +
        g.list.map(function (p) {
          var fl = Data.flow(p);
          var open = Data.openIssues(p).length;
          var bits = [p.status, plural(p.steps.length, 'step')];
          if (fl.handoffs) bits.push(plural(fl.handoffs, 'handoff'));
          return listRow('#/process/' + p.id, p.name, bits.join(' · '),
            (open ? plural(open, 'open issue') : 'no open issues') +
            (findings[p.id] ? ' · ' + plural(findings[p.id], 'rule finding') : ''));
        }).join('');
    }).join('') || '<p class="empty">No processes filed here yet.</p>';

    html += faqList(id);

    paint(listPane(Data.taxonomyPath(id), 'Coverage for this department and everything under it', html));
  }

  // ---- one department ------------------------------------------------------

  function renderDepartment(id) {
    var node = Data.state.index.taxonomy[id];
    if (!node) return paint(notFound('department', id));
    var used = Edit.taxonomyUsage(id);
    var children = Data.state.index.children[id] || [];
    var filed = Data.state.index.byTaxonomy[id] || [];

    var performs = [];
    Data.state.processes.processes.forEach(function (p) {
      var n = p.steps.filter(function (st) { return st.departmentId === id; }).length;
      if (n && p.taxonomyId !== id) performs.push({ p: p, n: n });
    });
    var lib = Data.state.library;
    var owns = {
      articles: lib.articles.filter(function (a) { return a.ownerId === id; }),
      faqs: lib.faqs.filter(function (q) { return q.ownerId === id; }),
      variables: Data.state.variables.variables.filter(function (v) { return v.ownerId === id; })
    };

    var parentOptions = [{ value: '', label: 'Top level' }].concat(
      Data.state.processes.taxonomy.filter(function (n) {
        return n.id !== id && !Edit.wouldLoop(id, n.id);
      }).map(function (n) {
        return { value: n.id, label: Data.taxonomyPath(n.id) };
      }).sort(function (a, b) { return a.label.localeCompare(b.label); }));

    var section = function (title, items, render) {
      if (!items.length) return '';
      return '<section class="block"><h2>' + e(title) + ' <span class="count">' + items.length +
        '</span></h2>' + items.map(render).join('') + '</section>';
    };

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/departments">Departments</a>' +
      (node.parentId ? ' · ' + e(Data.taxonomyPath(node.parentId)) : '') + '</div>' +
      '<h1 class="editable-h1">' + f('taxonomy:' + id + ':name') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge quiet">Sits under: ' + f('taxonomy:' + id + ':parentId',
        { type: 'select', options: parentOptions, placeholder: 'Top level' }) + '</span>' +
      '<span class="badge quiet">' + plural(used.processes, 'process', 'processes') + ' filed here</span>' +
      '</div>' +
      '<div class="row-actions">' +
      btn('new-process', { taxonomy: id }, '+ Process here') +
      btn('new-dept', { parent: id }, '+ Sub-department') +
      '<button class="btn small" data-route="#/coverage/' + e(id) + '">Coverage →</button>' +
      '<span class="spacer"></span>' +
      btn('dept-up', { dept: id }, '↑', 'small', 'Move up') +
      btn('dept-down', { dept: id }, '↓', 'small', 'Move down') +
      (used.total
        ? '<span class="hint" title="Move everything that points at it elsewhere first">In use, so it cannot be deleted</span>'
        : btn('del-dept', { dept: id }, 'Delete department', 'small danger')) +
      '</div></header>' +
      faqTiles(faqRowFor(id)) +
      section('Sub-departments', children, function (c) {
        return listRow('#/department/' + c.id, c.name, plural(Data.processCount(c.id), 'process', 'processes'), '');
      }) +
      section('Processes filed here', filed, function (p) {
        return listRow('#/process/' + p.id, p.name, p.status + ' · ' + plural(p.steps.length, 'step'), '');
      }) +
      section('Also does steps in', performs, function (x) {
        return listRow('#/process/' + x.p.id, x.p.name, Data.taxonomyPath(x.p.taxonomyId),
          plural(x.n, 'step'));
      }) +
      section('Owns these articles', owns.articles, function (a) {
        return listRow('#/article/' + a.id, a.title, a.status, '');
      }) +
      section('Owns these FAQ questions', owns.faqs, function (q) {
        return listRow('#/faq/' + q.id, Data.plainText(q.q), '', '');
      }) +
      section('Owns these variables', owns.variables, function (v) {
        return listRow('#/variable/' + v.id, v.value, v.question, v.status);
      }) +
      (used.total ? '' : '<p class="empty">Nothing is filed under or owned by this department.</p>') +
      '</article>');
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
    articleList: renderArticleDashboard,
    faqDashboard: renderFaqDashboard,
    tab: renderTab,
    variableList: renderVariableDashboard,
    issue: renderIssue,
    rule: renderRule,
    coverageDept: renderCoverageDept,
    department: renderDepartment,
    variable: renderVariable,
    issues: renderIssueRegister,
    rules: renderRules,
    coverage: renderCoverage,
    departments: renderDepartments,
    home: renderHome,
    openAttach: openAttach
  };
}(window));
