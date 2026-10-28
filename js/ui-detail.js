/* ===========================================================================
   ui-detail.js — the right-hand pane.

   One render function per route. Fields are rendered through Edit.field, so
   anything shown here can be clicked and changed; structural actions (add a
   step, draw a route, attach a fact sheet, resolve an issue) go through Edit
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
  var FS_STATUS_OPTIONS = Data.FACT_SHEET_STATUSES.map(function (st) {
    return { value: st, label: Data.FACT_SHEET_STATUS_LABEL[st] };
  });
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
    // An issue's owner is a process, FAQ answer, fact sheet or variable.
    if (act === 'raise-issue') openIssueModal(d.owner || d.process || '', d.step || '');
    if (act === 'resolve-issue') {
      var how = ask('How was it resolved? (optional — leave blank to just close it)');
      if (how !== null) { Edit.resolveIssue(d.owner, d.issue, how); refresh(); }
    }
    if (act === 'reopen-issue') { Edit.reopenIssue(d.owner, d.issue); refresh(); }
    if (act === 'del-issue' && confirm('Delete this issue entirely? Resolving keeps a record; deleting does not.')) {
      Edit.deleteIssue(d.owner, d.issue);
      if (/^#\/issue\//.test(location.hash)) onNavigate('#/issues'); else refresh();
    }

    // -- attachments
    if (act === 'attach') openAttach(d.process, d.step || null, d.kind || 'factsheet');
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
    if (act === 'new-factsheet') {
      name = ask('Title of the new fact sheet:');
      if (name) onNavigate('#/factsheet/' + Edit.createFactSheet(name));
    }
    if (act === 'del-factsheet') {
      var sUse = Data.state.index.usage[d.sheet];
      if (confirm('Delete this fact sheet, with its rationale and sign-off list?' +
          (sUse && sUse.processes.length
            ? ' It is attached in ' + plural(sUse.processes.length, 'process', 'processes') +
              ', and will be detached from all of them.' : ''))) {
        Edit.deleteFactSheet(d.sheet);
        onNavigate('#/factsheets');
      }
    }

    // -- a fact sheet: related FAQ answers, sign-off, exports
    if (act === 'fs-relate') openRelate(d.sheet);
    if (act === 'fs-relate-add') { Edit.relateFaq(d.sheet, d.faq); refresh(); }
    if (act === 'fs-unrelate') { Edit.unrelateFaq(d.sheet, d.faq); refresh(); }
    if (act === 'fs-add-signoff') {
      name = ask('Who has to sign it off? (name)');
      if (name) {
        var role = ask('Their role or team (optional):');
        Edit.addSignoff(d.sheet, name, role || '');
        refresh();
      }
    }
    if (act === 'fs-del-signoff' && confirm('Take this person off the sign-off list?')) {
      Edit.removeSignoff(d.sheet, d.person);
      refresh();
    }
    if (act === 'fs-word') FactSheetExport.word(d.sheet);
    if (act === 'fs-print') FactSheetExport.print(d.sheet);
    if (act === 'fs-pack-word') FactSheetExport.packWord(d.sheet);
    if (act === 'fs-pack-print') FactSheetExport.packPrint(d.sheet);
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
        name: 'New rule', match: { mode: 'phrase', value: '', wholeWord: true }, suggest: '',
        scope: ['process', 'step', 'factsheet', 'faq'], severity: 'medium', message: ''
      });
      onNavigate('#/rule/' + id);
      return;
    }
    if (act === 'toggle-rule') { Rules.toggle(d.rule); refresh(); return; }
    if (act === 'scope') {
      var rule = Rules.get(d.rule);
      if (rule && !Rules.isBuiltIn(rule)) {
        rule.scope = rule.scope || [];
        var at = rule.scope.indexOf(d.scope);
        if (at === -1) rule.scope.push(d.scope); else rule.scope.splice(at, 1);
        Edit.touch();
        refresh();
      }
      return;
    }
    if (act === 'del-rule') {
      if (Rules.isBuiltIn(Rules.get(d.rule))) return;
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
  }

  /** The "+ route to…" menus on each step, and the other in-page selects. */
  function handleChange(event) {
    var also = event.target.closest('textarea[data-also-asked]');
    if (also) {
      Edit.setAlsoAsked(also.dataset.alsoAsked, also.value);
      return;
    }
    var setting = event.target.closest('select[data-rule-setting]');
    if (setting) {
      var bits = setting.dataset.ruleSetting.split(':');
      Edit.set('rule:' + bits[0] + ':' + bits[1], Number(setting.value));
      refresh();
      return;
    }
    var filter = event.target.closest('select[data-rule-filter]');
    if (filter) {
      ruleFilters[filter.dataset.ruleFilter] = filter.value;
      refresh();
      return;
    }
    var decide = event.target.closest('select[data-decide]');
    if (decide) {
      var who = decide.dataset.decide.split(':');
      Edit.decideSignoff(who[0], who[1], decide.value);
      refresh();
      return;
    }
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
    var sectionMover = event.target.closest('select[data-move-section]');
    if (sectionMover) {
      FaqOrder.moveToSection(sectionMover.dataset.moveSection, Number(sectionMover.value));
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
  // From a page, the issue is about that page's process, FAQ answer, fact
  // sheet or variable. From the Issues tab, you search for what it is about.

  var issueTarget = null;

  function openIssueModal(ownerId, stepId) {
    var modal = document.getElementById('issueModal');
    var pick = document.getElementById('imPick');
    var find = document.getElementById('imFind');
    document.getElementById('imNote').value = '';
    document.getElementById('imSeverity').value = 'medium';
    find.value = '';
    document.getElementById('imFindList').innerHTML = '';
    pick.hidden = !!ownerId;
    setIssueTarget(ownerId || null, stepId);
    modal.hidden = false;
    (ownerId ? document.getElementById('imNote') : find).focus();
  }

  /** Show what the issue is about, and the step list when it is a process. */
  function setIssueTarget(ownerId, stepId) {
    issueTarget = ownerId;
    var owner = ownerId ? Data.issueOwner(ownerId) : null;
    document.getElementById('imProcess').textContent = owner
      ? Data.ISSUE_KINDS[owner.kind] + ' · ' + owner.label
      : 'Search for the process, FAQ answer, fact sheet or variable it is about.';
    var stepField = document.getElementById('imStepField');
    var stepSelect = document.getElementById('imStep');
    if (owner && owner.kind === 'process') {
      stepSelect.innerHTML = '<option value="">The process as a whole</option>' +
        owner.obj.steps.map(function (st, i) {
          return '<option value="' + e(st.id) + '"' + (st.id === stepId ? ' selected' : '') + '>' +
            (i + 1) + '. ' + e(Data.freeze(st.title)) + '</option>';
        }).join('');
      stepField.hidden = false;
    } else {
      stepSelect.innerHTML = '';
      stepField.hidden = true;
    }
  }

  function wireIssueModal() {
    var modal = document.getElementById('issueModal');
    if (!modal) return;
    var find = document.getElementById('imFind');
    var list = document.getElementById('imFindList');
    find.addEventListener('input', function () {
      var kinds = { process: 1, faq: 1, factsheet: 1, variable: 1 };
      var hits = Data.search(find.value, 30).filter(function (h) { return kinds[h.kind]; }).slice(0, 12);
      list.innerHTML = hits.map(function (h) {
        return '<button type="button" class="pick-row" data-id="' + e(h.id) + '">' +
          '<span class="pick-value">' + e(Data.plainText(h.title)) + '</span>' +
          '<span class="pick-q">' + e(Data.ISSUE_KINDS[h.kind]) +
          // Search subtitles can start with the kind again ("Fact sheet · Draft").
          (h.subtitle ? ' · ' + e(String(h.subtitle).replace(/^(FAQ|Fact sheet) · /, '')) : '') +
          '</span></button>';
      }).join('') || (find.value.trim().length > 1 ? '<p class="empty">Nothing matches.</p>' : '');
    });
    list.addEventListener('click', function (ev) {
      var row = ev.target.closest('.pick-row');
      if (!row) return;
      setIssueTarget(row.dataset.id, '');
      list.innerHTML = '';
      find.value = '';
      document.getElementById('imNote').focus();
    });
    document.getElementById('imCancel').addEventListener('click', function () { modal.hidden = true; });
    document.getElementById('imSave').addEventListener('click', function () {
      if (!issueTarget) { find.focus(); return; }
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

  // ---- attaching fact sheets and FAQ answers -------------------------------
  // The same picker serves two jobs: attaching content to a process step, and
  // naming the FAQ answers a fact sheet expands on (target.sheetId set).

  var attachTarget = null;

  function openAttach(processId, stepId, kind) {
    attachTarget = { processId: processId, stepId: stepId, kind: kind };
    var modal = document.getElementById('attachModal');
    var p = Data.state.index.processes[processId];
    var step = stepId ? p.steps.find(function (s) { return s.id === stepId; }) : null;
    document.getElementById('amWhere').textContent = step
      ? 'Step: ' + Data.freeze(step.title)
      : 'The process as a whole: ' + p.name;
    modal.querySelector('.am-tabs').hidden = false;
    document.getElementById('amSearch').value = '';
    drawAttach();
    modal.hidden = false;
    document.getElementById('amSearch').focus();
  }

  function openRelate(sheetId) {
    var sheet = Data.state.index.factSheets[sheetId];
    if (!sheet) return;
    attachTarget = { sheetId: sheetId, kind: 'faq' };
    var modal = document.getElementById('attachModal');
    document.getElementById('amWhere').textContent = 'FAQ answers related to the fact sheet: ' + sheet.title;
    modal.querySelector('.am-tabs').hidden = true;
    document.getElementById('amSearch').value = '';
    drawAttach();
    modal.hidden = false;
    document.getElementById('amSearch').focus();
  }

  /** The text a fact sheet is matched on when suggesting related FAQ answers. */
  function sheetText(sheet) {
    return [sheet.title, sheet.summary, Data.plainText(sheet.body)].join(' ');
  }

  function drawAttach() {
    var t = attachTarget;
    var sheet = t.sheetId ? Data.state.index.factSheets[t.sheetId] : null;
    var p = sheet ? null : Data.state.index.processes[t.processId];
    var owner = sheet || (t.stepId ? p.steps.find(function (s) { return s.id === t.stepId; }) : p);
    var field = t.kind === 'factsheet' ? 'factSheetRefs' : 'faqRefs';
    var attached = owner[field] || [];
    var q = document.getElementById('amSearch').value.trim();

    Array.prototype.forEach.call(document.querySelectorAll('#attachModal .am-tab'), function (b) {
      b.classList.toggle('on', b.dataset.kind === t.kind);
    });

    var found = sheet
      ? Data.suggestFor(sheetText(sheet), 'faq', attached)
      : Data.suggest(t.stepId ? owner : null, p, t.kind, attached);
    var rows = [];
    if (q.length >= 2) {
      rows = Data.search(q, 40).filter(function (m) {
        return m.kind === t.kind && attached.indexOf(m.id) === -1;
      }).map(function (m) { return { id: m.id, title: m.title, why: m.subtitle }; });
    } else {
      rows = found.map(function (s) {
        return { id: s.doc.id, title: Data.plainText(s.doc.title), why: 'suggested · ' + s.hits.slice(0, 4).join(' · ') };
      });
    }

    var list = document.getElementById('amList');
    list.innerHTML = rows.map(function (r) {
      return '<button class="pick-row" data-id="' + e(r.id) + '">' +
        '<span class="pick-value">' + e(r.title) + '</span>' +
        '<span class="pick-q">' + e(r.why || '') + '</span></button>';
    }).join('') || '<p class="empty">' + (q.length >= 2
      ? 'Nothing matches.'
      : (sheet ? 'No suggestions yet' : 'No suggestions for this step') + ' — type to search.') + '</p>';

    Array.prototype.forEach.call(list.querySelectorAll('.pick-row'), function (row) {
      row.addEventListener('click', function () {
        if (sheet) Edit.relateFaq(sheet.id, row.dataset.id);
        else Edit.attach(t.processId, t.stepId, t.kind, row.dataset.id);
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
      '</dl></section>' + issuesBlock(pid) + '</article>';

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

  /** Attached fact sheets and FAQ answers, for a step or (step null) the process. */
  function renderAttached(p, step) {
    var owner = step || p;
    var base = { process: p.id, step: step ? step.id : '' };
    var chips = [];

    (owner.factSheetRefs || []).forEach(function (ref) {
      var sh = Data.state.index.factSheets[ref];
      chips.push('<span class="chip"><button class="chip-link" data-route="#/factsheet/' + e(ref) +
        '">📄 ' + e(sh ? sh.title : ref + ' (missing)') + '</button>' +
        btn('detach', Object.assign({ kind: 'factsheet', ref: ref }, base), '×', 'chip-x', 'Detach') +
        '</span>');
    });
    (owner.faqRefs || []).forEach(function (ref) {
      var q = Data.state.index.faqs[ref];
      chips.push('<span class="chip"><button class="chip-link faq" data-route="#/faq/' + e(ref) +
        '">❓ ' + e(q ? Data.plainText(q.q) : ref + ' (missing)') + '</button>' +
        btn('detach', Object.assign({ kind: 'faq', ref: ref }, base), '×', 'chip-x', 'Detach') +
        '</span>');
    });

    return '<div class="attached">' + chips.join('') +
      btn('attach', Object.assign({ kind: 'factsheet' }, base), '+ Fact sheet', 'tiny') +
      btn('attach', Object.assign({ kind: 'faq' }, base), '+ FAQ', 'tiny') +
      '</div>';
  }

  /** "FAQ answer", "fact sheet" — an issue owner's kind, inside a sentence. */
  function kindInSentence(kind) {
    return { process: 'process', faq: 'FAQ answer', factsheet: 'fact sheet', variable: 'variable',
      gap: 'content gap' }[kind] || kind;
  }

  /**
   * The issues raised on a process, FAQ answer, fact sheet or variable,
   * at the foot of its page: open ones in full, resolved ones folded away.
   */
  function issuesBlock(ownerId) {
    var owner = Data.issueOwner(ownerId);
    if (!owner) return '';
    var holder = owner.obj;
    var open = Data.openIssues(holder);
    var resolved = (holder.issues || []).filter(function (i) { return i.resolved; });
    var stepTitle = function (issue) {
      if (owner.kind !== 'process') return '';
      var step = (holder.steps || []).find(function (st) { return st.id === issue.stepId; });
      return step ? ' · step: ' + e(Data.freeze(step.title)) : '';
    };
    var who = { owner: owner.id };

    var html = '<section class="block issues" id="issues"><h2>Issues <span class="count">' +
      (open.length ? open.length + ' open' : 'none open') + '</span>' +
      btn('raise-issue', who, '⚑ Raise issue', 'tiny') + '</h2>';

    if (!open.length && !resolved.length) {
      html += '<p class="empty">Nothing raised about this ' + kindInSentence(owner.kind) + '.</p>';
    }

    html += open.map(function (issue) {
      return '<div class="issue-row sev-' + e(issue.severity) + '">' +
        '<span class="sev">' + f('issue:' + owner.id + ':' + issue.id + ':severity',
          { type: 'select', options: options(['high', 'medium', 'low']) }) + '</span>' +
        '<div class="issue-body">' + f('issue:' + owner.id + ':' + issue.id + ':note',
          { type: 'multiline' }) +
        '<span class="issue-meta">' + e(issue.raisedBy || '—') + ' · ' + e(issue.raised) +
        stepTitle(issue) + '</span></div>' +
        btn('resolve-issue', { owner: owner.id, issue: issue.id }, '✓ Resolve', 'tiny') +
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
            btn('reopen-issue', { owner: owner.id, issue: issue.id }, 'Reopen', 'tiny') +
            btn('del-issue', { owner: owner.id, issue: issue.id }, '×', 'tiny danger', 'Delete') +
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

  // ---- fact sheet ----------------------------------------------------------

  function renderFactSheet(id) {
    var sheet = Data.state.index.factSheets[id];
    if (!sheet) return paint(notFound('fact sheet', id));
    var usage = Data.state.index.usage[id] || { processes: [], steps: 0 };
    var facts = Data.factSheetFacts(sheet);
    var spec = 'factsheet:' + id + ':';
    var current = sheet.current || {};

    var warnings = '';
    if (facts.internal) {
      warnings += '<div class="fs-alert bad">This fact sheet uses ' +
        plural(facts.internal, 'internal value') + ' — a system name, extension or intranet ' +
        'link that must not be published. It would be printed in every export. See <em>Where ' +
        'the values come from</em> below.</div>';
    }
    if (facts.changesFrom) {
      warnings += '<div class="fs-alert">' + plural(facts.changesFrom, 'reviewer has', 'reviewers have') +
        ' asked for changes — see <em>Sign-off</em> below.</div>';
    }

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/factsheets">Fact sheets</a>' +
      (sheet.ownerId ? ' · ' + e(Data.taxonomyPath(sheet.ownerId)) : '') + '</div>' +
      '<h1 class="editable-h1">' + f(spec + 'title') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge fs-badge fs-' + e(facts.status) + '">' + f(spec + 'status',
        { type: 'select', options: FS_STATUS_OPTIONS }) + '</span>' +
      '<span class="badge quiet">' + f(spec + 'ownerId',
        { type: 'select', options: departmentOptions('No owner yet'), placeholder: 'No owner yet' }) + '</span>' +
      '<span class="badge quiet">Last reviewed: ' + f(spec + 'lastReviewed',
        { placeholder: 'e.g. October 2026' }) + '</span>' +
      '</div>' +
      '<div class="lede">' + f(spec + 'summary',
        { placeholder: 'One line: what this sheet covers and who it is for' }) + '</div>' +
      renderUsage(usage) +
      '<div class="row-actions fs-actions">' +
      '<span class="action-group"><span class="action-label">Fact sheet</span>' +
      btn('fs-word', { sheet: id }, '⤓ Word', 'small', 'Download as a Word document for comms') +
      btn('fs-print', { sheet: id }, '⎙ PDF', 'small', 'Open a printable copy — choose Save as PDF') +
      '</span>' +
      '<span class="action-group"><span class="action-label">Review pack</span>' +
      btn('fs-pack-word', { sheet: id }, '⤓ Word', 'small',
        'The sheet with its rationale, the current FAQ answers, sources and a sign-off table') +
      btn('fs-pack-print', { sheet: id }, '⎙ PDF', 'small', 'The review pack, printable') +
      '</span>' +
      '<span class="spacer"></span>' +
      btn('del-factsheet', { sheet: id }, 'Delete fact sheet', 'small danger') +
      '</div></header>' +
      warnings +
      '<section class="block"><h2>The fact sheet</h2><div id="fsBody"></div></section>' +

      '<section class="block meta"><h2>What it replaces</h2>' +
      '<p class="hint-block">The version on the council website now, if there is one, so ' +
      'reviewers can compare. Leave it empty for a sheet that replaces nothing.</p><dl>' +
      '<dt>Current fact sheet</dt><dd>' + f(spec + 'current.title',
        { placeholder: 'Its title, as published' }) + '</dd>' +
      '<dt>Link</dt><dd class="source-link">' + f(spec + 'current.url',
        { placeholder: 'https://…' }) + webLink(current.url) + '</dd>' +
      '</dl></section>' +

      '<section class="block"><h2>Why replace it</h2>' +
      '<p class="hint-block">What this version does that the current one doesn\'t — the case ' +
      'for replacing it, which reviewers read first.</p><div id="fsRationale"></div></section>' +

      renderRelated(sheet) +
      renderSignoffs(sheet, facts) +
      valueSources(sheet.body, 'Each fee, time, number or link in this fact sheet, and the ' +
        'published document behind it') +
      renderUsedIn(usage) + issuesBlock(id) + '</article>');

    RichText.mount(document.getElementById('fsBody'), {
      html: sheet.body,
      headerHtml: e(sheet.title),
      document: true,
      previewFrame: 'faq-preview fs-preview',
      previewClass: 'fs-doc',
      previewLabel: 'Preview — how it reads when exported',
      check: 'factsheet',
      onChange: function (html) { Edit.set(spec + 'body', html); }
    });
    RichText.mount(document.getElementById('fsRationale'), {
      html: sheet.rationale || '',
      preview: false,
      onChange: function (html) { Edit.set(spec + 'rationale', html); }
    });
  }

  /** The FAQ answers a fact sheet expands on, and a few it probably should. */
  function renderRelated(sheet) {
    var refs = sheet.faqRefs || [];
    var suggestions = Data.suggestFor(sheetText(sheet), 'faq', refs);

    var html = '<section class="block"><h2>Related FAQ answers <span class="count">' +
      refs.length + '</span></h2>' +
      '<p class="hint-block">The FAQ questions this sheet expands on. The review pack prints ' +
      'their answers as they stand now beside the new sheet, so reviewers see both.</p>';

    html += refs.map(function (ref) {
      var q = Data.state.index.faqs[ref];
      var where = '';
      if (q) {
        var tab = q.publish && q.publish.tabId ? FaqOrder.tab(q.publish.tabId) : null;
        where = (tab ? Data.plainText(tab.label) : 'not published') + ' · ' + (q.status || 'no status');
      }
      return '<div class="verify-row">' +
        (q ? listRow('#/faq/' + ref, Data.plainText(q.q), where, '')
           : '<span class="list-row"><span class="list-title">' + e(ref) + ' (deleted)</span></span>') +
        btn('fs-unrelate', { sheet: sheet.id, faq: ref }, '×', 'small danger', 'Not related after all') +
        '</div>';
    }).join('');

    html += '<div class="row-actions">' + btn('fs-relate', { sheet: sheet.id }, '+ FAQ answer') + '</div>';

    if (suggestions.length) {
      html += '<div class="suggest-label">Possibly related</div>' +
        suggestions.map(function (sg) {
          return '<div class="verify-row">' +
            listRow('#/faq/' + sg.doc.id, Data.plainText(sg.doc.title), sg.hits.slice(0, 4).join(' · '), '') +
            btn('fs-relate-add', { sheet: sheet.id, faq: sg.doc.id }, '+ Add', 'small') +
            '</div>';
        }).join('');
    }
    return html + '</section>';
  }

  /** Everyone who has to agree to the sheet, and what each has said. */
  function renderSignoffs(sheet, facts) {
    var people = sheet.signoffs || [];
    var decisions = Object.keys(Data.SIGNOFF_LABEL);

    var html = '<section class="block"><h2>Sign-off <span class="count">' +
      (people.length ? facts.approvedBy + ' of ' + people.length + ' approved' : 'nobody listed yet') +
      '</span></h2>' +
      '<p class="hint-block">Everyone who has to agree before the sheet goes to comms. Choosing ' +
      'a decision dates it today. The review pack carries this list as a sign-off table.</p>';

    html += '<div class="signoffs">' + people.map(function (x) {
      var sp = 'signoff:' + sheet.id + ':' + x.id + ':';
      var decision = decisions.indexOf(x.decision) === -1 ? 'pending' : x.decision;
      return '<div class="signoff so-' + e(decision) + '">' +
        '<div class="so-head">' +
        '<span class="so-name">' + f(sp + 'name', { placeholder: 'Name' }) + '</span>' +
        '<span class="so-role">' + f(sp + 'role', { placeholder: 'Role or team' }) + '</span>' +
        '<select class="inline-select so-decision" data-decide="' + e(sheet.id + ':' + x.id) +
        '" aria-label="Decision">' + decisions.map(function (dc) {
          return '<option value="' + dc + '"' + (dc === decision ? ' selected' : '') + '>' +
            e(Data.SIGNOFF_LABEL[dc]) + '</option>';
        }).join('') + '</select>' +
        (x.date ? '<span class="so-date">' + e(x.date) + '</span>' : '') +
        btn('fs-del-signoff', { sheet: sheet.id, person: x.id }, '×', 'tiny danger', 'Remove from the list') +
        '</div>' +
        '<div class="so-note">' + f(sp + 'note',
          { type: 'multiline', placeholder: 'Their comments, or what they asked to change' }) + '</div>' +
        '</div>';
    }).join('') + '</div>';

    return html + '<div class="row-actions">' +
      btn('fs-add-signoff', { sheet: sheet.id }, '+ Person') + '</div></section>';
  }

  // ---- FAQ -----------------------------------------------------------------

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

    // The section headings in this tab, for moving without dragging. A
    // heading's value is its row index; -1 is the top of the tab, above the
    // first heading, where a question has no section.
    var section = FaqOrder.sectionOf(id);
    var headings = [];
    rows.forEach(function (r, i) { if (r.type === 'group') headings.push({ index: i, title: r.title }); });
    var sectionOptions = '<option value="-1"' + (section === -1 ? ' selected' : '') +
      '>No section (top of the tab)</option>' +
      headings.map(function (h) {
        return '<option value="' + h.index + '"' + (h.index === section ? ' selected' : '') + '>' +
          e(h.title) + '</option>';
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
      (tabId && headings.length
        ? '<dt>Section</dt><dd class="faq-section"><select class="inline-select" data-move-section="' + e(id) +
          '" aria-label="Section">' + sectionOptions + '</select>' +
          '<span class="hint">Moves it to the end of that section.</span></dd>'
        : '') +
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
      alsoAskedBlock(q) +
      valueSources(q.a, 'Each fee, time, number or link in this answer, and the published ' +
        'document behind it') +
      sheetsExpanding(id) +
      renderUsedIn(usage) + issuesBlock(id) + '</article>');

    RichText.mount(document.getElementById('richHost'), {
      html: q.a,
      headerHtml: q.q,
      check: 'faq',
      onChange: function (html) { Edit.set('faq:' + id + ':a', html); }
    });
  }

  /**
   * How people ask this question: other phrasings, and whether it is an
   * everyday question. Neither is published as text; both steer Probe and
   * the Ask page towards this answer.
   */
  function alsoAskedBlock(q) {
    var lines = (q.alsoAsked || []).join('\n');
    return '<section class="block also-asked-block"><h2>Also asked as <span class="count">' +
      plural((q.alsoAsked || []).length, 'phrasing') + '</span></h2>' +
      '<p class="hint-block">Other ways people ask this, one per line — in their words, not ours. ' +
      'They are never shown on the public page; they help <a href="#/probe">Probe</a> and the Ask ' +
      'page find this answer. When Probe lands on the wrong answer for a question, add that question ' +
      'here on the right one.</p>' +
      '<textarea class="also-asked" data-also-asked="' + e(q.id) + '" rows="' +
      Math.max(3, (q.alsoAsked || []).length + 1) + '" aria-label="Other ways people ask this" ' +
      'placeholder="e.g. can I build a house on my farm">' + e(lines) + '</textarea>' +
      '<dl class="also-common"><dt>Everyday question</dt><dd>' + f('faq:' + q.id + ':common',
        { type: 'select', options: YES_NO, placeholder: 'No' }) +
      '<span class="hint">Yes gives it a small lift when several answers match about equally — ' +
      'for the question most people mean, not the specialist one.</span></dd></dl>' +
      '</section>';
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

  /** On an FAQ page: the fact sheets that list this question as related. */
  function sheetsExpanding(faqId) {
    var list = Data.state.library.factSheets.filter(function (sh) {
      return (sh.faqRefs || []).indexOf(faqId) !== -1;
    });
    if (!list.length) return '';
    return '<section class="block"><h2>Expanded on in</h2>' + list.map(function (sh) {
      return listRow('#/factsheet/' + sh.id, sh.title, 'Fact sheet · ' +
        (Data.FACT_SHEET_STATUS_LABEL[sh.status] || sh.status), '');
    }).join('') + '</section>';
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

  // ---- fact sheets dashboard -----------------------------------------------

  function renderFactSheetDashboard() {
    var sheets = Data.state.library.factSheets;
    var rows = sheets.map(function (sh) { return { sheet: sh, facts: Data.factSheetFacts(sh) }; });
    var count = function (test) { return rows.filter(test).length; };
    var inStatus = function (st) { return count(function (x) { return x.facts.status === st; }); };
    var waitingOn = rows.reduce(function (n, x) {
      return x.facts.status === 'signoff' ? n + (x.facts.signers - x.facts.approvedBy) : n;
    }, 0);

    var html = '<div class="row-actions">' + btn('new-factsheet', {}, '+ New fact sheet') + '</div>' +
      '<p class="hint-block">A fact sheet is the longer public version of what the FAQ answers ' +
      'say, built from the same variables. Write it here, list who has to sign it off, send ' +
      'them the review pack, then hand the Word copy to comms. Nothing here publishes it.</p>' +
      '<section class="tiles">' +
      tile(sheets.length, 'fact sheets', '', '') +
      tile(inStatus('draft'), 'draft', 'being written', '') +
      tile(inStatus('signoff'), 'in sign-off', plural(waitingOn, 'decision') + ' still to come', '') +
      tile(inStatus('approved'), 'approved', 'ready for comms', '') +
      tile(inStatus('live'), 'live', 'on the council website', '') +
      tile(count(function (x) { return !x.facts.linked; }), 'not attached',
        'no process step links to them', '') +
      tile(count(function (x) { return x.facts.unconfirmed; }), 'use unconfirmed values',
        'a fee, time or link not yet verified', '#/variables') +
      '</section>';

    // --- sign-off, sheet by sheet
    var signing = rows.filter(function (x) { return x.facts.status === 'signoff'; });
    html += '<h2 class="group">In sign-off <span>' + signing.length + '</span></h2>' +
      (signing.length
        ? signing.map(function (x) {
            var people = x.sheet.signoffs || [];
            var waiting = people.filter(function (pp) { return pp.decision !== 'approved'; })
              .map(function (pp) {
                return pp.name + (pp.decision === 'changes' ? ' (changes requested)' : '');
              });
            return listRow('#/factsheet/' + x.sheet.id, x.sheet.title,
              people.length
                ? (waiting.length ? 'Waiting on ' + waiting.join(', ') : 'Everyone has approved — mark it approved')
                : 'Nobody on the sign-off list yet',
              x.facts.approvedBy + ' of ' + x.facts.signers);
          }).join('')
        : '<p class="empty">Nothing out for sign-off.</p>');

    // --- needs attention
    var attention = rows.map(function (x) {
      var why = [];
      if (x.facts.internal) why.push('uses an internal value');
      if (x.facts.changesFrom) why.push('changes requested');
      if (!x.sheet.ownerId) why.push('no owner');
      if (x.facts.replaces && !x.facts.rationale) why.push('no reason given for replacing the current sheet');
      if (!x.facts.faqs) why.push('no related FAQ answers');
      if (x.facts.status !== 'draft' && !x.facts.signers) why.push('nobody on the sign-off list');
      if (x.facts.unconfirmed) why.push(plural(x.facts.unconfirmed, 'unconfirmed value'));
      return { sheet: x.sheet, why: why };
    }).filter(function (x) { return x.why.length; });

    html += '<h2 class="group">Needs attention <span>' + attention.length + '</span></h2>' +
      (attention.length
        ? attention.slice(0, 15).map(function (x) {
            return listRow('#/factsheet/' + x.sheet.id, x.sheet.title, x.why.join(' · '), '');
          }).join('') +
          (attention.length > 15 ? '<p class="hint-block">…and ' + (attention.length - 15) +
            ' more in the list on the left.</p>' : '')
        : '<p class="empty">' + (sheets.length ? 'Nothing outstanding.' : 'No fact sheets yet.') + '</p>');

    // --- by owner
    if (sheets.length) {
      html += '<h2 class="group">By owning department</h2>' +
        '<div class="cov-table dash-table" role="table">' +
        '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Sheets</span>' +
        '<span>In sign-off</span><span>Approved or live</span></div>' +
        byOwner(sheets).map(function (g) {
          var n = function (test) { return g.items.filter(test).length; };
          return '<div class="cov-row" role="row"><span class="cov-name">' + e(g.label) + '</span>' +
            '<span class="num">' + g.items.length + '</span>' +
            '<span class="num">' + n(function (sh) { return sh.status === 'signoff'; }) + '</span>' +
            '<span class="num">' + n(function (sh) { return sh.status === 'approved' || sh.status === 'live'; }) +
            '</span></div>';
        }).join('') + '</div>';
    }

    paint(listPane('Fact sheets', plural(sheets.length, 'fact sheet') +
      '. Pick one on the left to edit it.', html));
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
    var verified = v.lastVerified
      ? 'Last verified ' + v.lastVerified + (v.verifiedBy ? ' by ' + v.verifiedBy : '')
      : 'Never verified';

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      variableCrumbs(v) +
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
      '<span class="hint">' + e(verified) + '</span>' +
      '</div>' +
      '<div class="lede">' + f('variable:' + id + ':question',
        { placeholder: 'What you would ask the department' }) + '</div>' +
      '<div class="note">' + f('variable:' + id + ':note',
        { placeholder: 'Optional context for the department' }) + '</div>' +
      '<div class="var-definition"><span class="var-definition-label">Definition shown on hover</span>' +
      f('variable:' + id + ':definition', { type: 'multiline',
        placeholder: v.internal === true
          ? 'Optional — shown to staff only, since this value is internal'
          : 'Optional — what this means, for readers who hover over it in an answer' }) + '</div>' +
      '<div class="row-actions">' +
      btn('verify', { variable: id }, '✓ Mark verified') +
      btn('copy-verification', { owner: v.ownerId || '' }, '⧉ Copy verification email') +
      (v.type === 'url' ? webLink(v.value, 'Open this link ↗', 'small') : '') +
      '<span class="spacer"></span>' +
      (usage.processes.length
        ? '<span class="hint">In use, so it cannot be deleted</span>'
        : btn('del-variable', { variable: id }, 'Delete variable', 'small danger')) +
      '</div></header>' +

      sourceBlock(v) +
      usedBlock(id, usage) +
      issuesBlock(id) +

      '<section class="block meta"><h2>Details</h2><dl>' +
      '<dt>Last verified</dt><dd>' + e(v.lastVerified || '— never —') + '</dd>' +
      '<dt>Verified by</dt><dd>' + e(v.verifiedBy || '—') + '</dd>' +
      '<dt>Identifier</dt><dd><code>' + e(v.id) + '</code></dd>' +
      '<dt>Internal only</dt><dd>' + f('variable:' + id + ':internal',
        { type: 'select', options: [{ value: true, label: 'Yes — never publish' },
          { value: false, label: 'No — safe to publish' }] }) + '</dd>' +
      '</dl></section></article>');
  }

  /** Variables › department › sub-department › source, each a link. */
  function variableCrumbs(v) {
    var parts = ['<a href="#/variables">Variables</a>'];
    var chain = [];
    var node = Data.state.index.taxonomy[v.ownerId];
    var guard = 0;
    while (node && guard++ < 50) {
      chain.unshift(node);
      node = node.parentId ? Data.state.index.taxonomy[node.parentId] : null;
    }
    chain.forEach(function (n) {
      parts.push('<a href="#/department/' + e(n.id) + '">' + e(n.name) + '</a>');
    });
    if (!chain.length) parts.push('No owner');
    var key = Data.sourceKey(v);
    if (key) parts.push(sourceLink(key, v.source.title || v.source.url));
    return '<div class="crumbs">' + parts.join(' › ') + '</div>';
  }

  function sourceRoute(key) {
    return '#/source/' + encodeURIComponent(key);
  }

  function sourceLink(key, label) {
    return '<a href="' + e(sourceRoute(key)) + '">' + e(label) + '</a>';
  }

  /**
   * Where a variable is used, by kind: fact sheets, processes (with the
   * steps that use it), then FAQ answers.
   */
  function usedBlock(id, usage) {
    var sheets = [], processes = [], faqs = [];
    usage.processes.forEach(function (ownerId) {
      var p = Data.state.index.processes[ownerId];
      if (p) return processes.push(p);
      var sh = Data.state.index.factSheets[ownerId];
      if (sh) return sheets.push(sh);
      var q = Data.state.index.faqs[ownerId];
      if (q) faqs.push(q);
    });
    var byName = function (key) { return function (a, b) { return a[key].localeCompare(b[key]); }; };
    sheets.sort(byName('title'));
    processes.sort(byName('name'));
    var total = sheets.length + processes.length + faqs.length;

    var part = function (title, list, render) {
      if (!list.length) return '';
      return '<h3 class="used-kind">' + e(title) + ' <span class="count">' + list.length + '</span></h3>' +
        list.map(render).join('');
    };

    return '<section class="block used-in"><h2>Where it\'s used <span class="count">' +
      (total ? plural(total, 'place') : 'nowhere yet') + '</span></h2>' +
      (total
        ? '<p class="hint-block">Change the value here and every one of these changes with it.</p>'
        : '<p class="empty">Not referenced anywhere yet.</p>') +
      part('Fact sheets', sheets, function (sh) {
        return listRow('#/factsheet/' + sh.id, sh.title,
          (Data.FACT_SHEET_STATUS_LABEL[sh.status] || sh.status) +
          (sh.ownerId ? ' · ' + Data.taxonomyPath(sh.ownerId) : ''), '');
      }) +
      part('Processes', processes, function (p) {
        return listRow('#/process/' + p.id, p.name,
          [stepsUsing(p, id), Data.taxonomyPath(p.taxonomyId)].filter(Boolean).join(' · '), '');
      }) +
      part('FAQ answers', faqs, function (q) {
        var tab = q.publish && q.publish.tabId ? FaqOrder.tab(q.publish.tabId) : null;
        return listRow('#/faq/' + q.id, Data.plainText(q.q),
          (tab ? Data.plainText(tab.label) + ' tab' : 'Not published') +
          (q.status ? ' · ' + q.status : ''), '');
      }) +
      '</section>';
  }

  /** "Steps 2, 5" — the steps of a process whose text uses a variable. */
  function stepsUsing(p, id) {
    var ref = new RegExp('(\\{\\{|data-var(-href)?=")' + id + '(\\}\\}|")');
    var numbers = [];
    p.steps.forEach(function (step, i) {
      var text = [step.title, step.sop, step.script, step.completionTrigger, step.timeframe]
        .concat((step.checks || []).map(function (c) { return c.text; })).join('\n');
      if (ref.test(text)) numbers.push(i + 1);
    });
    if (!numbers.length) return 'in the purpose or a route';
    return (numbers.length === 1 ? 'Step ' : 'Steps ') + numbers.join(', ');
  }

  // ---- public sources ------------------------------------------------------

  /** A link that is safe to put in an href: web addresses only. */
  function webLink(url, label, size) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return '';
    return '<a class="btn ' + (size || 'tiny') + '" href="' + e(url) + '" target="_blank" rel="noopener">' +
      e(label || 'Open ↗') + '</a>';
  }

  /**
   * Where one variable comes from, on the variable's page: the document,
   * a button to open it as it stands now, and the words that say so —
   * then the fields to change them.
   */
  function sourceBlock(v) {
    var id = v.id;
    var s = v.source || {};
    var mine = Data.sourceKey(v);
    var others = Data.sources().filter(function (src) { return src.key !== mine; });
    var shared = mine ? Data.sourceByKey(mine) : null;
    var siblings = shared ? shared.variables.length - 1 : 0;

    var summary;
    if (v.internal === true) {
      summary = '<p class="hint-block">This value is internal and never published, so it doesn\'t ' +
        'need a public source.</p>';
    } else if (mine) {
      summary = '<div class="source-summary">' +
        '<div class="source-summary-head">' +
        '<span class="source-icon" aria-hidden="true">📄</span>' +
        '<div class="source-summary-name">' + sourceLink(mine, s.title || s.url) +
        (s.url && s.title ? '<span class="source-url">' + e(s.url) + '</span>' : '') + '</div>' +
        webLink(s.url, 'View live page ↗', 'small primary') +
        '</div>' +
        (s.excerpt ? '<blockquote class="source-quote">' + e(s.excerpt) + '</blockquote>' : '') +
        '<div class="source-summary-foot">' +
        '<span>' + (s.checked ? 'Checked ' + e(s.checked) : 'Not yet checked') + '</span>' +
        (siblings
          ? '<a href="' + e(sourceRoute(mine)) + '">' + plural(siblings, 'other value') +
            ' from this document →</a>'
          : '<span>The only value from this document</span>') +
        '</div></div>';
    } else {
      summary = '<p class="source-missing">No source yet.</p>' +
        '<p class="hint-block">Name the published document this value comes from, so you can ' +
        'point to it if anyone asks.</p>';
    }

    return '<section class="block meta source-block"><h2>Where it comes from</h2>' + summary +
      '<h3 class="used-kind">Source details</h3>' +
      '<dl>' +
      '<dt>Document</dt><dd>' + f('variable:' + id + ':source.title',
        { placeholder: 'e.g. Fees and Charges 2026–27' }) + '</dd>' +
      '<dt>Link</dt><dd class="source-link">' + f('variable:' + id + ':source.url',
        { placeholder: 'https://…' }) + '</dd>' +
      '<dt>Where it says so</dt><dd>' + f('variable:' + id + ':source.excerpt',
        { type: 'multiline', placeholder: 'Page or section, or the words quoted' }) + '</dd>' +
      '<dt>Last checked</dt><dd class="source-link">' + f('variable:' + id + ':source.checked',
        { placeholder: 'YYYY-MM-DD' }) +
      (mine
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

  /**
   * One source document's page: every value it backs, split into those
   * still correct — carry them forward when the document is next updated —
   * and those that need attention first.
   */
  function renderSource(key) {
    var src = Data.sourceByKey(key);
    if (!src) return paint(notFound('source', key));

    var attention = [], fine = [];
    src.variables.forEach(function (v) {
      (Data.attentionReasons(v).length ? attention : fine).push(v);
    });
    var byLabel = function (a, b) { return String(a.value).localeCompare(String(b.value)); };
    attention.sort(byLabel);
    fine.sort(byLabel);

    var owners = {};
    src.variables.forEach(function (v) {
      var k = v.ownerId && Data.state.index.taxonomy[v.ownerId] ? v.ownerId : '';
      owners[k] = (owners[k] || 0) + 1;
    });
    var ownerList = Object.keys(owners).map(function (k) {
      return { id: k, label: k ? Data.taxonomyPath(k) : 'No owner', n: owners[k] };
    }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });

    var checked = src.variables.map(function (v) { return (v.source && v.source.checked) || ''; })
      .filter(Boolean).sort();
    var checkedLine = !checked.length ? 'Not yet checked'
      : checked[0] === checked[checked.length - 1] ? 'Checked ' + checked[0]
      : 'Checked between ' + checked[0] + ' and ' + checked[checked.length - 1];

    var varRow = function (v) {
      var reasons = Data.attentionReasons(v);
      var bits = [];
      if (v.source.excerpt) bits.push(v.source.excerpt);
      if (ownerList.length > 1) bits.push(v.ownerId ? Data.taxonomyPath(v.ownerId) : 'No owner');
      return listRow('#/variable/' + v.id, v.value, bits.join(' · '),
        reasons.length ? reasons.join(', ') : 'verified');
    };

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/variables">Variables</a> › Source</div>' +
      '<h1>' + e(src.title || src.url) + '</h1>' +
      (src.url ? '<p class="lede source-url">' + e(src.url) + '</p>' : '') +
      '<div class="row-actions">' + webLink(src.url, 'View live page ↗', 'small primary') +
      '<span class="hint">' + e(checkedLine) + '</span></div>' +
      '</header>' +
      '<section class="tiles">' +
      tile(src.variables.length, src.variables.length === 1 ? 'value' : 'values', 'taken from this document', '') +
      tile(fine.length, 'still correct', 'verified, no open issues', '') +
      tile(attention.length, 'need attention', 'unverified, stale or with an issue', '') +
      tile(ownerList.length, ownerList.length === 1 ? 'department' : 'departments', 'own these values', '') +
      '</section>' +
      '<p class="hint-block">When this document is next updated, the values under <strong>Still correct</strong> ' +
      'can be carried forward as they are; the ones under <strong>Needs attention</strong> want ' +
      'checking first.</p>' +
      '<section class="block"><h2>Needs attention <span class="count">' + attention.length + '</span></h2>' +
      (attention.length ? attention.map(varRow).join('') : '<p class="empty">Nothing — every value is verified.</p>') +
      '</section>' +
      '<section class="block"><h2>Still correct <span class="count">' + fine.length + '</span></h2>' +
      (fine.length ? fine.map(varRow).join('') : '<p class="empty">None verified yet.</p>') +
      '</section>' +
      '<section class="block"><h2>Departments <span class="count">' + ownerList.length + '</span></h2>' +
      ownerList.map(function (o) {
        return o.id
          ? listRow('#/department/' + o.id, o.label, plural(o.n, 'value') + ' from this document', '')
          : '<p class="empty">' + plural(o.n, 'value') + ' with no owner yet.</p>';
      }).join('') +
      '</section></article>');
  }

  /** One cited document on the variables dashboard, with what it backs. */
  function sourceCard(src) {
    return '<div class="source-card">' +
      '<div class="source-head"><a class="source-title" href="' + e(sourceRoute(src.key)) + '">' +
      e(src.title || src.url) + '</a>' +
      webLink(src.url) +
      '<span class="hint">' + plural(src.variables.length, 'value') + '</span></div>' +
      '<div class="source-vars">' + src.variables.map(function (v) {
        return '<a class="source-var" href="#/variable/' + e(v.id) + '"' +
          (v.question ? ' title="' + e(v.question) + '"' : '') + '>' + e(v.value) + '</a>';
      }).join('') + '</div></div>';
  }

  /**
   * On an FAQ answer or a fact sheet: each value in the text and where it
   * comes from. intro is the sentence above the list.
   */
  function valueSources(html, intro) {
    var vars = Data.variablesIn(html);
    if (!vars.length) return '';
    var missing = vars.filter(Data.needsSource).length;
    return '<section class="block"><h2>Where the values come from</h2>' +
      '<p class="hint-block">' + e(intro) + (missing ? ' — ' + missing + ' with no source yet' : '') + '.</p>' +
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

  function issueRoute(entry) {
    return '#/issue/' + entry.owner.id + '/' + entry.issue.id;
  }

  /** "FAQ answer · …" — what an issue is about, for a list row. */
  function aboutLine(entry) {
    return Data.ISSUE_KINDS[entry.owner.kind] + ' · ' + entry.owner.label;
  }

  // What each tile on the register shows when clicked.
  var ISSUE_FILTERS = {
    high: { label: 'High severity', test: function (x) { return x.issue.severity === 'high'; } },
    medium: { label: 'Medium severity', test: function (x) { return x.issue.severity === 'medium'; } },
    low: { label: 'Low severity', test: function (x) { return x.issue.severity === 'low'; } },
    gaps: { label: 'Content gaps', test: function (x) { return x.owner.kind === 'gap'; } }
  };

  function issueListRow(entry) {
    return '<button class="list-row issue-list sev-' + e(entry.issue.severity) + '"' +
      ' data-route="' + e(issueRoute(entry)) + '">' +
      '<span class="sev">' + e(entry.issue.severity) + '</span>' +
      '<span class="list-title">' + e(aboutLine(entry)) + '</span>' +
      '<span class="list-sub">' + e(entry.issue.note) + '</span>' +
      '</button>';
  }

  function resolvedListRow(entry) {
    return '<button class="list-row issue-list" data-route="' + e(issueRoute(entry)) + '">' +
      '<span class="sev">✓ ' + e(entry.issue.resolved) + '</span>' +
      '<span class="list-title">' + e(aboutLine(entry)) + '</span>' +
      '<span class="list-sub">' + e(entry.issue.note) +
      (entry.issue.resolution ? ' — ' + e(entry.issue.resolution) : '') + '</span>' +
      '</button>';
  }

  /**
   * The issues register. Each tile is a button: high, medium, low, content
   * gaps or resolved shows just those issues (#/issues?show=high), and the
   * open-issues tile shows them all again. Every row opens its issue.
   */
  function renderIssueRegister(show) {
    var recorded = Data.allIssues();
    var resolved = Data.allIssues({ resolved: 'only' });
    var counts = { high: 0, medium: 0, low: 0 };
    recorded.forEach(function (x) { counts[x.issue.severity] = (counts[x.issue.severity] || 0) + 1; });
    var gaps = recorded.filter(ISSUE_FILTERS.gaps.test).length;
    var affected = {};
    recorded.forEach(function (x) { affected[x.owner.id] = true; });
    if (show !== 'resolved' && !ISSUE_FILTERS[show]) show = '';

    var choice = function (key, n, label, sub) {
      var route = key ? '#/issues?show=' + key : '#/issues';
      return tile(n, label, sub, route).replace('class="tile"', 'class="tile' + (key === show ? ' on' : '') + '"' +
        ' aria-pressed="' + (key === show ? 'true' : 'false') + '"');
    };

    var html = '<div class="row-actions">' +
      btn('raise-issue', {}, '⚑ Raise an issue', 'small primary') +
      btn('export-issues-html', {}, '⤓ Report (HTML)') +
      btn('export-issues-csv', {}, '⤓ CSV') +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/probe">◎ Probe</button>' +
      '<button class="btn small" data-route="#/rules">⚙ Rules</button>' +
      '</div>' +
      '<section class="tiles issue-tiles">' +
      choice('', recorded.length, 'open issues', plural(Object.keys(affected).length, 'item') + ' affected') +
      choice('high', counts.high || 0, 'high severity', 'fix these first') +
      choice('medium', counts.medium || 0, 'medium', '') +
      choice('low', counts.low || 0, 'low', '') +
      choice('gaps', gaps, 'content gaps', 'questions the FAQ doesn\'t answer') +
      choice('resolved', resolved.length, 'resolved', 'kept as a record') +
      '</section>';

    // --- one tile chosen: just those issues
    if (show) {
      var list = show === 'resolved' ? resolved : recorded.filter(ISSUE_FILTERS[show].test);
      var title = show === 'resolved' ? 'Resolved' : ISSUE_FILTERS[show].label;
      html += '<h2 class="group">' + e(title) + ' <span>' + list.length +
        (show === 'resolved' ? '' : ' open') + '</span> ' +
        '<button class="btn tiny" data-route="#/issues">Show all</button></h2>' +
        (list.length
          ? list.map(show === 'resolved' ? resolvedListRow : issueListRow).join('')
          : '<p class="empty">' + (show === 'gaps'
            ? 'No open content gaps. Questions the FAQ can\'t answer are logged from <a href="#/probe">Probe</a>.'
            : 'None.') + '</p>');
      paint(listPane('Issues register',
        recorded.length + ' open · ' + resolved.length + ' resolved', html));
      return;
    }

    // --- by department
    var byDept = {};
    recorded.forEach(function (x) {
      var top = x.owner.taxonomyId ? Data.topDepartment(x.owner.taxonomyId) : null;
      var key = top ? top.id : '';
      var row = byDept[key] = byDept[key] || { open: 0, high: 0, processes: {} };
      row.open++;
      if (x.issue.severity === 'high') row.high++;
      row.processes[x.owner.id] = true;
    });
    html += '<h2 class="group">By department</h2>' +
      '<div class="cov-table dash-table" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Open</span>' +
      '<span>High</span><span>Items</span></div>' +
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
      (recorded.length ? recorded.map(issueListRow).join('') : '<p class="empty">Nothing open.</p>');

    if (resolved.length) {
      html += '<details class="resolved"><summary>' + plural(resolved.length, 'resolved issue') +
        '</summary>' + resolved.map(resolvedListRow).join('') + '</details>';
    }

    // What the software finds is on the Rules tab; this page is what people raise.
    html += '<p class="hint-block">Issues are what people raise — here, with ⚑ on any process, ' +
      'step, FAQ answer, fact sheet or variable, or from the live call view. Each one is listed ' +
      'at the foot of the page it is about. Content gaps — questions the FAQ doesn\'t answer — are ' +
      'logged from <a href="#/probe">Probe</a>. Click a tile above to see just those issues. What ' +
      'Process Hub finds by itself is on the <a href="#/rules">Rules tab</a>.</p>';

    paint(listPane('Issues register',
      recorded.length + ' open · ' + resolved.length + ' resolved', html));
  }

  // ---- a single issue ------------------------------------------------------

  function renderIssue(ownerId, issueId) {
    var owner = Data.issueOwner(ownerId);
    var issue = owner && (owner.obj.issues || []).find(function (i) { return i.id === issueId; });
    if (!issue) return paint(notFound('issue', issueId));
    var spec = 'issue:' + owner.id + ':' + issue.id + ':';
    var kind = Data.ISSUE_KINDS[owner.kind];
    var who = { owner: owner.id, issue: issue.id };

    var details = '';
    if (owner.kind === 'gap') return renderGap(owner, issue);
    if (owner.kind === 'process') {
      var p = owner.obj;
      var steps = [{ value: '', label: 'The process as a whole' }].concat(p.steps.map(function (st, i) {
        return { value: st.id, label: (i + 1) + '. ' + Data.freeze(st.title) };
      }));
      details = '<dt>About</dt><dd>' + f(spec + 'stepId', { type: 'select', options: steps,
          placeholder: 'The process as a whole' }) + '</dd>' +
        '<dt>Process sits under</dt><dd>' + e(Data.taxonomyPath(p.taxonomyId)) + '</dd>' +
        '<dt>Process status</dt><dd>' + e(p.status) + '</dd>';
    } else {
      details = '<dt>About</dt><dd>' + e(kind) + '</dd>' +
        '<dt>Owning department</dt><dd>' + e(owner.taxonomyId ? Data.taxonomyPath(owner.taxonomyId) : '—') + '</dd>' +
        (owner.obj.status ? '<dt>Status</dt><dd>' + e(owner.obj.status) + '</dd>' : '');
    }

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/issues">Issues register</a> · ' +
      (issue.resolved ? 'resolved ' + e(issue.resolved) : e(issue.severity) + ' severity') + '</div>' +
      '<h1>' + e(owner.label) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge quiet">' + e(kind) + '</span>' +
      (issue.resolved
        ? '<span class="badge status-published">✓ resolved</span>'
        : '<span class="badge sev-badge sev-' + e(issue.severity) + '">' + f(spec + 'severity',
            { type: 'select', options: options(['high', 'medium', 'low']) }) + '</span>') +
      '<span class="badge quiet">Raised ' + e(issue.raised || '—') + '</span>' +
      '<span class="badge quiet">By ' + f(spec + 'raisedBy', { placeholder: 'who raised it' }) + '</span>' +
      '</div>' +
      '<div class="row-actions">' +
      '<button class="btn small" data-route="' + e(owner.route) + '">Open the ' +
      e(kindInSentence(owner.kind)) + ' →</button>' +
      '<span class="spacer"></span>' +
      (issue.resolved
        ? btn('reopen-issue', who, 'Reopen') + btn('del-issue', who, 'Delete', 'small danger')
        : btn('resolve-issue', who, '✓ Resolve')) +
      '</div></header>' +
      '<section class="block"><h2>The issue</h2>' +
      '<div class="issue-note">' + f(spec + 'note', { type: 'multiline', placeholder: 'What is wrong or missing' }) + '</div>' +
      (issue.resolution ? '<p class="hint-block">Resolved: ' + e(issue.resolution) + '</p>' : '') +
      '</section>' +
      '<section class="block meta"><h2>Details</h2><dl>' + details + '</dl></section></article>');
  }

  /**
   * A content gap: a question the FAQ doesn't answer, logged from Probe. It
   * is its own issue, so the page is an issue page with the question at the
   * top, and what Probe found when it was logged.
   */
  function renderGap(owner, gap) {
    var spec = 'issue:' + gap.id + ':' + gap.id + ':';
    var who = { owner: gap.id, issue: gap.id };
    var faqLink = function (id, score) {
      var faq = Data.state.index.faqs[id];
      if (!faq) return '<span class="hint">an FAQ question since deleted</span>';
      return '<a href="#/faq/' + e(id) + '">' + e(Data.plainText(faq.q)) + '</a>' +
        (score != null ? ' <span class="hint">' + Math.round(score * 100) + '% match</span>' : '');
    };
    var tabs = [{ value: '', label: 'Not decided yet' }].concat(
      Data.state.library.publishTabs.map(function (t) { return { value: t.id, label: Data.plainText(t.label) }; }));

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/issues">Issues register</a> · content gap · ' +
      (gap.resolved ? 'resolved ' + e(gap.resolved) : e(gap.severity) + ' severity') + '</div>' +
      '<h1 class="editable-h1">' + f(spec + 'q', { placeholder: 'The question' }) + '</h1>' +
      '<div class="badges">' +
      '<span class="badge quiet">Content gap</span>' +
      (gap.resolved
        ? '<span class="badge status-published">✓ resolved</span>'
        : '<span class="badge sev-badge sev-' + e(gap.severity) + '">' + f(spec + 'severity',
            { type: 'select', options: options(['high', 'medium', 'low']) }) + '</span>') +
      '<span class="badge quiet">Raised ' + e(gap.raised || '—') + '</span>' +
      '<span class="badge quiet">By ' + f(spec + 'raisedBy', { placeholder: 'who raised it' }) + '</span>' +
      '</div>' +
      '<div class="row-actions">' +
      '<button class="btn small" data-route="' + e(owner.route) + '">Probe this question again →</button>' +
      '<span class="spacer"></span>' +
      (gap.resolved
        ? btn('reopen-issue', who, 'Reopen') + btn('del-issue', who, 'Delete', 'small danger')
        : btn('resolve-issue', who, '✓ Resolve') + btn('del-issue', who, 'Delete', 'small danger')) +
      '</div></header>' +
      '<section class="block"><h2>Note</h2>' +
      '<div class="issue-note">' + f(spec + 'note', { type: 'multiline', placeholder: 'What is missing' }) + '</div>' +
      (gap.resolution ? '<p class="hint-block">Resolved: ' + e(gap.resolution) + '</p>' : '') +
      '</section>' +
      '<section class="block meta"><h2>Details</h2><dl>' +
      '<dt>Department to answer it</dt><dd>' + f(spec + 'ownerId', { type: 'select',
        options: departmentOptions('Not decided yet'), placeholder: 'Not decided yet' }) + '</dd>' +
      '<dt>Tab it would belong on</dt><dd>' + f(spec + 'tabId', { type: 'select', options: tabs,
        placeholder: 'Not decided yet' }) + '</dd>' +
      '<dt>Nearest answer when logged</dt><dd>' +
      (gap.nearest ? faqLink(gap.nearest.faqId, gap.nearest.score) : '—') + '</dd>' +
      (gap.answeredBy ? '<dt>Answered by</dt><dd>' + faqLink(gap.answeredBy) + '</dd>' : '') +
      '</dl></section>' +
      '<p class="hint-block">Logged from <a href="#/probe">Probe</a>. Write or extend an FAQ answer ' +
      'that covers it, then probe it again: when an answer matches, Probe offers to resolve the gap.</p>' +
      '</article>');
  }

  // ---- rules ---------------------------------------------------------------

  // What a built-in rule's results are narrowed to. Kept while you move
  // between rules, so a department you are working through stays chosen.
  var ruleFilters = { type: '', dept: '' };

  var MATCH_MODES = [
    { value: 'phrase', label: 'This exact wording' },
    { value: 'regex', label: 'A pattern (regular expression)' }
  ];

  var SCOPE_LABEL = {
    process: 'processes', step: 'process steps', factsheet: 'fact sheets',
    faq: 'FAQ answers', variable: 'variables'
  };

  function scopeWords(rule) {
    var scope = rule.scope && rule.scope.length ? rule.scope : Rules.SCOPES;
    return scope.map(function (s) { return SCOPE_LABEL[s] || s; }).join(', ');
  }

  /** The editor for a text rule — the one kind of rule people add. */
  function ruleCard(rule, found) {
    var spec = 'rule:' + rule.id + ':';
    var off = rule.enabled === false;
    return '<div class="rule-card' + (off ? ' off' : '') + '" id="rule-' + e(rule.id) + '">' +
      '<div class="rule-card-head">' +
      '<span class="rule-name">' + f(spec + 'name') + '</span>' +
      '<span class="rule-count' + (found ? '' : ' clear') + '">' +
      (off ? 'disabled' : found + ' found') + '</span>' +
      btn('toggle-rule', { rule: rule.id }, off ? 'Enable' : 'Disable', 'tiny') +
      btn('del-rule', { rule: rule.id }, '×', 'tiny danger', 'Delete rule') +
      '</div>' +
      '<div class="rule-grid">' +
      field('Look for', f(spec + 'match:value', { placeholder: 'e.g. Merit' })) +
      field('Say instead (optional)', f(spec + 'suggest', { placeholder: 'e.g. the CRM' })) +
      field('Matching', f(spec + 'match:mode', { type: 'select', options: MATCH_MODES })) +
      field('Whole words only', f(spec + 'match:wholeWord',
        { type: 'select', options: YES_NO, placeholder: 'No' })) +
      field('Match capitals exactly', f(spec + 'match:caseSensitive',
        { type: 'select', options: YES_NO, placeholder: 'No' })) +
      field('Severity', f(spec + 'severity', { type: 'select',
        options: options(['high', 'medium', 'low']) })) +
      field('Leave drafts alone', f(spec + 'ignoreDraft',
        { type: 'select', options: YES_NO, placeholder: 'No' })) +
      field('Applies to', scopeEditor(rule)) +
      '</div>' +
      field('What to tell the reader', f(spec + 'message',
        { type: 'multiline', placeholder: 'Why this matters and what to do about it' })) +
      '<p class="hint-block">Found everywhere it applies, and listed in the issues register. ' +
      'Where it applies to FAQ answers or fact sheets, the editors also flag it as you type, ' +
      'with what to say instead.</p>' +
      '</div>';
  }

  function renderRules() {
    var builtIns = Rules.list().filter(Rules.isBuiltIn);
    var mine = Rules.textRules();
    var results = {};
    Rules.run().forEach(function (r) { results[r.rule.id] = r; });

    var card = function (rule) {
      var off = rule.enabled === false;
      var head = off ? null : Checks.headline(rule);
      return '<button class="chk-card' + (off ? ' off' : '') + '" data-route="#/rule/' + e(rule.id) + '">' +
        '<span class="chk-card-name">' + e(rule.name) + '</span>' +
        '<span class="chk-card-n">' + (off ? 'Off' : head.count) + '</span>' +
        '<span class="chk-card-words">' + (off ? 'Switched off' : e(head.words)) + '</span>' +
        '</button>';
    };
    var writing = builtIns.filter(Rules.isWriting);
    var housekeeping = builtIns.filter(function (r) { return !Rules.isWriting(r); });

    // Writing first: how the public wording reads is the day-to-day work.
    var html = '<p class="hint-block">The built-in checks each go through all of Process Hub at ' +
      'once. Open one to see what it finds, by type and department. They can be switched off, ' +
      'not changed.</p>' +
      '<h2 class="group">Writing</h2>' +
      '<p class="hint-block">How FAQ answers and fact sheets read: who does what, sentence length, ' +
      'and what the reader does next. The editors also flag these as you type.</p>' +
      '<div class="chk-cards">' + writing.map(card).join('') + '</div>' +
      '<h2 class="group">Housekeeping</h2>' +
      '<p class="hint-block">Loose ends across everything: empty fields, things nobody has looked ' +
      'at in a while, and content nothing uses.</p>' +
      '<div class="chk-cards">' + housekeeping.map(card).join('') + '</div>';

    html += '<h2 class="group">Your rules</h2>' +
      '<div class="row-actions">' +
      btn('add-rule', {}, '+ Text that should no longer appear') +
      '<span class="spacer"></span>' +
      '<button class="btn small" data-route="#/issues">Issues register →</button>' +
      '</div>';
    if (!mine.length) {
      html += '<p class="empty">No rules yet. Add one whenever something changes — a system ' +
        'renamed, a form retired, a team now called something else.</p>';
    } else {
      html += '<div class="cov-table dash-table rules-dash" role="table">' +
        '<div class="cov-row cov-headrow" role="row"><span>Rule</span><span>Looks for</span>' +
        '<span>Severity</span><span>Found</span></div>' +
        mine.map(function (rule) {
          var r = results[rule.id];
          var off = rule.enabled === false;
          var look = (rule.match && rule.match.value) || '—';
          return '<button class="cov-row cov-link' + (off ? ' off' : '') + '" role="row" data-route="#/rule/' +
            e(rule.id) + '"><span class="cov-name">' + e(rule.name) + '</span>' +
            '<span class="when">“' + e(look) + '”' + (rule.suggest ? ' → “' + e(rule.suggest) + '”' : '') + '</span>' +
            '<span class="when">' + e(rule.severity || 'medium') + '</span>' +
            '<span class="num">' + (off ? 'off' : (r ? r.findings.length : 0)) + '</span></button>';
        }).join('') + '</div>';
    }
    html += '<p class="hint-block">A rule is text that should no longer appear. Everything it ' +
      'finds is listed in the issues register, and it disappears by itself once the wording is ' +
      'fixed. Where a rule applies to FAQ answers or fact sheets, the editors flag it as you type.</p>';

    paint(listPane('Rules',
      plural(builtIns.length, 'built-in check') + ' · ' + plural(mine.length, 'rule'), html));
  }

  function renderRule(arg) {
    var parts = String(arg || '').split('/');
    var id = parts[0];
    var rule = Rules.get(id);
    if (!rule) return paint(notFound('rule', id));
    if (Rules.isBuiltIn(rule)) return renderBuiltIn(rule, parts.slice(1).join('/'));

    var result = Rules.run().find(function (r) { return r.rule.id === id; }) || { findings: [] };
    paint('<article class="pane">' +
      '<header class="pane-head"><div class="crumbs"><a href="#/rules">Rules</a> · text that ' +
      'should no longer appear</div>' +
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

  // ---- a built-in rule's page ------------------------------------------------

  var WORD_LIMITS = [12, 15, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 35, 40];

  /** How "Who does this?" decides, in plain words. */
  function passiveHowItWorks() {
    return '<details class="how-it-works" open><summary>How it works</summary>' +
      '<p>It reads each sentence a reader sees and looks for one pattern:</p>' +
      '<ol>' +
      '<li>a word that says something has to happen — <em>must</em>, <em>should</em>, ' +
      '<em>needs to</em>, <em>has to</em>, <em>is to</em> or <em>are to</em>;</li>' +
      '<li>then <em>be</em>;</li>' +
      '<li>then a verb like <em>completed</em>, <em>approved</em>, <em>paid</em> or <em>sent</em>.</li>' +
      '</ol>' +
      '<p>So it flags “The bond form <mark>must be completed</mark> in full” — completed by whom? ' +
      'It leaves alone:</p>' +
      '<ul>' +
      '<li>a sentence that says who, with “by”: “must be approved <strong>by Council</strong>”;</li>' +
      '<li>passives that ask nobody to do anything: “bins are collected weekly”;</li>' +
      '<li>“can be”, “may be” and “will be”, which are mostly fine;</li>' +
      '<li>anything in <strong>Never flag these</strong>, below.</li>' +
      '</ul>' +
      '<p>The fix is usually to start with the action — “Complete the bond form in full” — or ' +
      'to name who does it. It only ever flags; the call is yours.</p></details>';
  }

  function filterSelect(key, choices, allLabel) {
    var current = ruleFilters[key] || '';
    return '<label class="chk-filter"><span>' + e(key === 'type' ? 'Show' : 'Department') + '</span>' +
      '<select data-rule-filter="' + key + '">' +
      '<option value="">' + e(allLabel) + '</option>' +
      choices.map(function (c) {
        return '<option value="' + e(c.value) + '"' + (c.value === current ? ' selected' : '') + '>' +
          e(c.label) + '</option>';
      }).join('') + '</select></label>';
  }

  /** A built-in rule's one setting, as a dropdown that saves as soon as it changes. */
  function settingSelect(rule, key, label, choices, fallback) {
    var current = Number(rule[key]) || fallback;
    return '<label class="chk-filter"><span>' + e(label) + '</span>' +
      '<select data-rule-setting="' + e(rule.id + ':' + key) + '">' +
      choices.map(function (c) {
        return '<option value="' + c.value + '"' + (c.value === current ? ' selected' : '') + '>' +
          e(c.label) + '</option>';
      }).join('') + '</select></label>';
  }

  function typeChoices(types) {
    return Checks.TYPES.filter(function (t) { return !types || types.indexOf(t.value) !== -1; });
  }

  function deptChoices() {
    return Checks.departments().map(function (d) { return { value: d.id, label: d.name }; })
      .concat([{ value: '~none', label: 'No department' }]);
  }

  /** The filters as Checks.group takes them. */
  function activeFilters(types) {
    var type = ruleFilters.type;
    if (types && types.indexOf(type) === -1) type = '';
    return { type: type, dept: ruleFilters.dept === '~none' ? '' : ruleFilters.dept,
      noDept: ruleFilters.dept === '~none' };
  }

  function narrow(items, filters) {
    return items.filter(function (it) {
      if (filters.type && it.type !== filters.type) return false;
      if (filters.noDept) return !it.dept.id;
      return !filters.dept || it.dept.id === filters.dept;
    });
  }

  /** A list of items, by type in the standard order, then by department. */
  function resultsList(items, filters, key) {
    var list = narrow(items, filters);
    if (!list.length) return '<p class="empty">Nothing found' +
      (items.length ? ' with these filters.' : '.') + '</p>';
    return Checks.group(list, {}).map(function (g) {
      return '<section class="chk-group"><h3>' + e(g.label) + ' <span>' + g.count + '</span></h3>' +
        g.depts.map(function (d) {
          var groupKey = key + ':' + g.type + ':' + (d.dept.id || '~');
          var all = expanded[groupKey];
          var shown = all ? d.items : d.items.slice(0, 25);
          return '<div class="chk-dept"><div class="chk-dept-name">' + e(d.dept.name) +
            ' <span>' + d.items.length + '</span></div>' +
            shown.map(function (it) {
              return '<button class="list-row finding" data-route="' + e(it.route) + '">' +
                '<span class="list-title">' + e(it.label) + '</span>' +
                '<span class="list-sub">' + e(it.sub || '') +
                (it.detail ? ' — ' + e(it.detail) : '') + '</span></button>';
            }).join('') +
            (d.items.length > shown.length || all
              ? btn('show-all', { rule: groupKey }, all ? 'Show fewer' : 'Show all ' + d.items.length, 'tiny')
              : '') +
            '</div>';
        }).join('') + '</section>';
    }).join('');
  }

  /**
   * The table of fields (or dates, or kinds of unused content) a built-in
   * rule counts, each row opening its list below.
   */
  function countTable(rule, rows, columns, picked, filters) {
    return '<div class="cov-table dash-table chk-dash" role="table">' +
      '<div class="cov-row cov-headrow" role="row">' +
      columns.map(function (c) { return '<span>' + e(c.label) + '</span>'; }).join('') + '</div>' +
      rows.map(function (row) {
        var shown = narrow(row.items, { dept: filters.dept, noDept: filters.noDept });
        return '<button class="cov-row cov-link' + (row.id === picked ? ' picked' : '') +
          (shown.length ? '' : ' clear') + '" role="row" data-route="#/rule/' + e(rule.id) + '/' +
          e(row.id) + '">' + columns.map(function (c) { return c.cell(row, shown); }).join('') +
          '</button>';
      }).join('') + '</div>';
  }

  function renderBuiltIn(rule, picked) {
    var spec = 'rule:' + rule.id + ':';
    var off = rule.enabled === false;
    var writing = Writing.isWriting(rule);
    var types = writing ? (rule.kind === 'nextstep' ? ['faq'] : ['faq', 'factsheet']) : null;
    var filters = activeFilters(types);

    // Settings this rule has, and the filters for its results.
    var controls = '';
    if (rule.kind === 'stale') {
      controls += settingSelect(rule, 'months', 'Older than', Checks.PERIODS.map(function (n) {
        return { value: n, label: n + (n === 1 ? ' month' : ' months') };
      }), 12);
    }
    if (rule.kind === 'long') {
      controls += settingSelect(rule, 'words', 'Longer than', WORD_LIMITS.map(function (n) {
        return { value: n, label: n + ' words' };
      }), 25);
    }
    if (!(types && types.length === 1) && rule.kind !== 'unused' && rule.kind !== 'empty' && rule.kind !== 'stale') {
      controls += filterSelect('type', typeChoices(types), types ? 'FAQ answers and fact sheets' : 'Everything');
    }
    if (rule.kind === 'empty' || rule.kind === 'stale' || rule.kind === 'unused') {
      controls += filterSelect('type', typeChoices(), 'Everything');
    }
    controls += filterSelect('dept', deptChoices(), 'All departments');

    var body = '';
    if (off) {
      body = '<p class="empty">Switched off — nothing is checked. Switch it on to see what it finds.</p>';
    } else if (rule.kind === 'empty' || rule.kind === 'stale' || rule.kind === 'unused') {
      var rows = rule.kind === 'empty' ? Checks.emptyFields()
        : rule.kind === 'stale' ? Checks.staleDates(rule.months) : Checks.unused();
      rows = rows.filter(function (r) { return !filters.type || r.type === filters.type; });
      var columns = [
        { label: 'Content', cell: function (row) { return '<span class="when">' + e(row.what) + '</span>'; } },
        { label: rule.kind === 'stale' ? 'Date' : rule.kind === 'unused' ? 'Not used' : 'Field',
          cell: function (row) {
            // On a phone the Content column goes, so the field says what it belongs to.
            return '<span class="cov-name"><span class="chk-what">' + e(row.what) + ' · </span>' +
              e(row.label) + '</span>';
          } },
        { label: rule.kind === 'stale' ? 'Older' : rule.kind === 'unused' ? 'Found' : 'Empty',
          cell: function (row, shown) {
            return '<span class="num count' + (shown.length ? ' warn' : '') + '">' + shown.length + '</span>';
          } },
        { label: 'Out of', cell: function (row) { return '<span class="num">' + row.total + '</span>'; } }
      ];
      body += countTable(rule, rows, columns, picked, filters);
      var row = rows.find(function (r) { return r.id === picked; });
      if (row) {
        body += '<section class="block"><h2>' + e(row.what) + ' — ' + e(row.label) +
          (rule.kind === 'empty' ? ' is empty' : rule.kind === 'stale'
            ? ', older than ' + plural(Number(rule.months) || 12, 'month') : '') + '</h2>' +
          resultsList(row.items, { dept: filters.dept, noDept: filters.noDept }, rule.id + ':' + row.id) +
          '</section>';
      } else {
        body += '<p class="hint-block">Pick a row to list everything in it, by department.</p>';
      }
    } else {
      body += '<section class="block"><h2>What it finds</h2>' +
        resultsList(Checks.writing(rule), filters, rule.id) + '</section>';
    }

    var head = off ? null : Checks.headline(rule);
    paint('<article class="pane">' +
      '<header class="pane-head"><div class="crumbs"><a href="#/rules">Rules</a> · built-in check</div>' +
      '<h1>' + e(rule.name) + ' <span class="builtin-tag">Built in</span></h1>' +
      '<p class="lede">' + e(Rules.builtInSummary(rule)) + '</p></header>' +
      '<div class="chk-bar">' +
      '<span class="chk-headline">' + (off ? 'Switched off' : '<strong>' + head.count + '</strong> ' + e(head.words)) + '</span>' +
      '<span class="spacer"></span>' +
      btn('toggle-rule', { rule: rule.id }, off ? 'Switch on' : 'Switch off', 'small') +
      '</div>' +
      (rule.kind === 'passive' ? passiveHowItWorks() +
        '<div class="rule-field chk-allow"><label>Never flag these</label>' +
        f(spec + 'allow', { placeholder: 'words or phrases, separated by commas — e.g. required, must be approved' }) +
        '</div>' : '') +
      (writing && rule.message ? '<p class="hint-block">Shown with each flag in the editor: ' +
        '<em>' + e(rule.message) + '</em></p>' : '') +
      '<div class="chk-controls">' + controls + '</div>' +
      body + '</article>');
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
        '">' + e(SCOPE_LABEL[scope] || scope) + '</button>';
    }).join('') + '</div>';
  }


  // ---- departments ---------------------------------------------------------
  // One tab: how far each department has got across processes, FAQ answers,
  // fact sheets and variables, and — on each department's own page —
  // everything it owns and the controls to rename, move or add to it.

  function statusBar(row, statuses) {
    if (!row.processes) return '<div class="cov-bar empty"></div>';
    return '<div class="cov-bar">' + statuses.map(function (s) {
      var n = row.byStatus[s] || 0;
      if (!n) return '';
      return '<span style="flex:' + n + ';background:' + Exporter.STATUS_COLOUR[s] +
        '" title="' + e(s.replace('_', ' ')) + ': ' + n + '"></span>';
    }).join('') + '</div>';
  }

  /** A count, with the progress figure under it ("15 public"). */
  function twoLine(n, sub) {
    return '<span class="num">' + n + (n ? '<small>' + e(sub) + '</small>' : '') + '</span>';
  }

  function issueCell(r) {
    return '<span class="num' + (r.issues ? ' warn' : '') + '">' + r.issues +
      (r.high ? '<em>' + r.high + ' high</em>' : '') + '</span>';
  }

  /** The figures for a department, or for everything, as tiles. */
  function progressTiles(t, route) {
    var done = (t.byStatus.reviewed || 0) + (t.byStatus.published || 0);
    return '<section class="tiles">' +
      tile(t.processes, 'processes', done + ' reviewed or published', '') +
      tile(t.faq.total, 'FAQ answers', t.faq.published + ' on the public page', route ? '#/faqs' : '') +
      tile(t.sheets.total, 'fact sheets', t.sheets.approved + ' approved · ' + t.sheets.signoff + ' in sign-off',
        route ? '#/factsheets' : '') +
      tile(t.vars.total, 'variables', (t.vars.current || 0) + ' verified · ' + (t.vars.pending || 0) + ' pending',
        route ? '#/variables' : '') +
      tile(t.issues, 'open issues', t.high + ' high', route ? '#/issues' : '') +
      tile(t.handoffs, 'handoffs', 'between departments', '') +
      '</section>';
  }

  function statusLegend(t, statuses) {
    return '<p class="cov-legend">' + statuses.map(function (s) {
      return '<span><i style="background:' + Exporter.STATUS_COLOUR[s] + '"></i>' +
        e(s.replace('_', ' ')) + ' ' + (t.byStatus[s] || 0) + '</span>';
    }).join('') + '</p>';
  }

  function renderDepartments() {
    var cov = Data.coverage();
    var t = cov.total;
    var done = (t.byStatus.reviewed || 0) + (t.byStatus.published || 0);
    var rows = cov.rows.filter(function (r) {
      return r.processes || r.faq.total || r.sheets.total || r.vars.total || r.issues;
    });

    var html = '<div class="row-actions">' +
      btn('new-dept', {}, '+ New department') +
      '<span class="spacer"></span>' +
      btn('export-coverage', {}, '⤓ Report (HTML)') +
      '</div>' +
      progressTiles(t, true) +
      statusLegend(t, cov.statuses) +
      '<div class="cov-table dept-cov" role="table">' +
      '<div class="cov-row cov-headrow" role="row"><span>Department</span><span>Processes</span>' +
      '<span class="cov-barcol">Status</span><span>Handoffs</span><span>FAQs</span>' +
      '<span>Fact sheets</span><span>Variables</span><span>Issues</span></div>' +
      rows.map(function (r) {
        return '<button class="cov-row cov-link depth-' + r.depth + '" role="row" data-route="#/department/' +
          e(r.node.id) + '">' +
          '<span class="cov-name">' + e(r.node.name) + '</span>' +
          '<span class="num">' + r.processes + '</span>' +
          '<span class="cov-barcol">' + statusBar(r, cov.statuses) + '</span>' +
          '<span class="num">' + r.handoffs + '</span>' +
          twoLine(r.faq.total, r.faq.published + ' public') +
          twoLine(r.sheets.total, r.sheets.approved + ' approved') +
          twoLine(r.vars.total, (r.vars.current || 0) + ' verified') +
          issueCell(r) + '</button>';
      }).join('') + '</div>' +
      '<p class="hint-block">Each row counts the department and everything under it. FAQ answers, ' +
      'fact sheets and variables are counted by their owning department; issues count every open ' +
      'issue on its processes and on what it owns. Open a department to see all of it, rename ' +
      'it, move it, or add a sub-department or process.' +
      (t.faqUnowned ? ' ' + plural(t.faqUnowned, 'FAQ answer has', 'FAQ answers have') +
        ' no owning department and are not counted in a row.' : '') + '</p>';

    paint(listPane('Departments', plural(t.processes, 'process', 'processes') + ', ' + done +
      ' reviewed or published · ' +
      plural(Data.state.processes.taxonomy.length, 'department') + ' and sub-departments', html));
  }

  /** A department and every sub-department beneath it, as ids. */
  function subtreeIds(id) {
    var ids = [id];
    (function walk(parent) {
      (Data.state.index.children[parent] || []).forEach(function (c) { ids.push(c.id); walk(c.id); });
    }(id));
    return ids;
  }

  /** "· Water › Meters" when an item belongs to a sub-department, not the department itself. */
  function whereUnder(ownerId, id) {
    return ownerId && ownerId !== id ? Data.taxonomyName(ownerId) : '';
  }

  function renderDepartment(id) {
    var node = Data.state.index.taxonomy[id];
    if (!node) return paint(notFound('department', id));
    var cov = Data.coverage();
    var row = cov.rows.find(function (r) { return r.node.id === id; });
    var used = Edit.taxonomyUsage(id);
    var ids = subtreeIds(id);
    var lib = Data.state.library;
    var mine = function (item) { return ids.indexOf(item.ownerId) !== -1; };

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

    // Processes, by the sub-department they are filed under.
    var groups = ids.map(function (tid) {
      return { node: Data.state.index.taxonomy[tid], list: Data.state.index.byTaxonomy[tid] || [] };
    }).filter(function (g) { return g.list.length; });
    var processes = groups.length
      ? '<section class="block"><h2>Processes <span class="count">' + row.processes + '</span></h2>' +
        groups.map(function (g) {
          return (groups.length > 1 || g.node.id !== id
            ? '<div class="chk-dept-name">' + e(g.node.name) + ' <span>' + g.list.length + '</span></div>' : '') +
            g.list.map(function (p) {
              var fl = Data.flow(p);
              var open = Data.openIssues(p).length;
              var bits = [p.status, plural(p.steps.length, 'step')];
              if (fl.handoffs) bits.push(plural(fl.handoffs, 'handoff'));
              return listRow('#/process/' + p.id, p.name, bits.join(' · '),
                open ? plural(open, 'open issue') : '');
            }).join('');
        }).join('') + '</section>'
      : '';

    var performs = [];
    Data.state.processes.processes.forEach(function (p) {
      var n = p.steps.filter(function (st) { return st.departmentId === id; }).length;
      if (n && ids.indexOf(p.taxonomyId) === -1) performs.push({ p: p, n: n });
    });

    var faqs = lib.faqs.filter(mine);
    var sheets = lib.factSheets.filter(mine);
    var vars = Data.state.variables.variables.filter(mine);
    var deptSources = Data.sources().map(function (src) {
      return { src: src, n: src.variables.filter(mine).length };
    }).filter(function (x) { return x.n; });

    paint('<article class="pane">' +
      '<header class="pane-head">' +
      '<div class="crumbs"><a href="#/departments">Departments</a>' +
      (node.parentId ? ' · ' + e(Data.taxonomyPath(node.parentId)) : '') + '</div>' +
      '<h1 class="editable-h1">' + f('taxonomy:' + id + ':name') + '</h1>' +
      '<div class="badges">' +
      '<span class="badge quiet">Sits under: ' + f('taxonomy:' + id + ':parentId',
        { type: 'select', options: parentOptions, placeholder: 'Top level' }) + '</span>' +
      '</div>' +
      '<div class="row-actions">' +
      btn('new-process', { taxonomy: id }, '+ Process here') +
      btn('new-dept', { parent: id }, '+ Sub-department') +
      '<span class="spacer"></span>' +
      btn('dept-up', { dept: id }, '↑', 'small', 'Move up') +
      btn('dept-down', { dept: id }, '↓', 'small', 'Move down') +
      (used.total
        ? '<span class="hint" title="Move everything that points at it elsewhere first">In use, so it cannot be deleted</span>'
        : btn('del-dept', { dept: id }, 'Delete department', 'small danger')) +
      '</div></header>' +
      '<p class="hint-block">Figures for ' + e(node.name) +
      ((Data.state.index.children[id] || []).length ? ' and everything under it' : '') + '.</p>' +
      progressTiles(row, false) +
      (row.processes ? statusLegend(row, cov.statuses) +
        '<div class="dept-bar">' + statusBar(row, cov.statuses) + '</div>' : '') +
      section('Sub-departments', Data.state.index.children[id] || [], function (c) {
        return listRow('#/department/' + c.id, c.name, plural(Data.processCount(c.id), 'process', 'processes'), '');
      }) +
      processes +
      section('Also does steps in', performs, function (x) {
        return listRow('#/process/' + x.p.id, x.p.name, Data.taxonomyPath(x.p.taxonomyId),
          plural(x.n, 'step'));
      }) +
      section('FAQ answers', faqs, function (q) {
        var facts = Data.faqFacts(q);
        var tab = facts.published ? FaqOrder.tab(q.publish.tabId) : null;
        var bits = [tab ? Data.plainText(tab.label) : 'not published', q.status || 'no status'];
        if (!facts.linked) bits.push('not attached to a step');
        if (facts.unconfirmed) bits.push('uses an unconfirmed value');
        var under = whereUnder(q.ownerId, id);
        if (under) bits.unshift(under);
        return listRow('#/faq/' + q.id, Data.plainText(q.q), bits.join(' · '), '');
      }) +
      section('Fact sheets', sheets, function (sh) {
        var under = whereUnder(sh.ownerId, id);
        return listRow('#/factsheet/' + sh.id, sh.title,
          (under ? under + ' · ' : '') + (Data.FACT_SHEET_STATUS_LABEL[sh.status] || sh.status), '');
      }) +
      section('Variable sources', deptSources, function (x) {
        return listRow(sourceRoute(x.src.key), x.src.title || x.src.url,
          plural(x.n, 'value') + ' owned here' +
          (x.n < x.src.variables.length ? ' (of ' + x.src.variables.length + ' in all)' : ''), '');
      }) +
      section('Variables', vars, function (v) {
        var under = whereUnder(v.ownerId, id);
        return listRow('#/variable/' + v.id, v.value, (under ? under + ' · ' : '') + v.question,
          v.status === 'current' ? 'verified' : v.status);
      }) +
      (used.total || row.faq.total || row.sheets.total || row.vars.total ? ''
        : '<p class="empty">Nothing is filed under or owned by this department.</p>') +
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
      '<p class="lede">Process maps, public FAQ content and fact sheets, built from ' +
      'one set of variables. Pick a process from the tree, or press ' +
      '<kbd>/</kbd> to search. Click any field to edit it.</p></header>' +
      '<section class="tiles">' +
      tile(processes.length, 'processes', drafts.length + ' still draft', '#/departments') +
      tile(crossing.length, 'cross departments',
        crossing.reduce(function (n, p) { return n + Data.flow(p).handoffs; }, 0) +
        ' handoffs total', '#/departments') +
      tile(Data.state.library.factSheets.length, 'fact sheets',
        Data.state.library.factSheets.filter(function (sh) { return sh.status === 'signoff'; }).length +
        ' in sign-off', '#/factsheets') +
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
    factSheet: renderFactSheet,
    faq: renderFaq,
    factSheetList: renderFactSheetDashboard,
    faqDashboard: renderFaqDashboard,
    tab: renderTab,
    variableList: renderVariableDashboard,
    issue: renderIssue,
    rule: renderRule,
    department: renderDepartment,
    variable: renderVariable,
    source: renderSource,
    issues: renderIssueRegister,
    rules: renderRules,
    departments: renderDepartments,
    home: renderHome,
    openAttach: openAttach,
    paint: paint
  };
}(window));
