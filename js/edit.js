/* ===========================================================================
   edit.js — in-place editing, and every change to the content.

   Fields are rendered read-only and become inputs when clicked. Each one
   carries a data-edit descriptor saying what it points at, so the binding
   survives a re-render without a registry to keep in step.

   Descriptor forms:
     process:<pid>:<key>
     step:<pid>:<sid>:<key>
     check:<pid>:<sid>:<cid>
     connection:<pid>:<cid>:<key>
     issue:<owner>:<iid>:<key>   (owner: a process, FAQ answer, fact sheet or variable id;
                                  for a content gap, owner and issue are both the gap's id)
     rule:<rid>:<key>  ·  rule:<rid>:match:<key>
     taxonomy:<tid>:<key>
     factsheet:<fsid>:<key> (key may be dotted, e.g. current.url)
     signoff:<fsid>:<sid>:<key>  one person on a fact sheet's sign-off list
     faq:<fid>:<key>        (key may be dotted, e.g. publish.tabId)
     tab:<tabid>:<key>      a publish tab on the FAQ page
     tabstep:<tabid>:<n>:<key>  one step of a tab's step strip
     variable:<vid>:<key>   (key may be dotted, e.g. source.url)

   Structural changes (adding a step, deleting a fact sheet, drawing an arrow)
   are functions further down. All of them end in touch(), which rebuilds the
   indexes and schedules the draft save.
   =========================================================================== */

(function (global) {
  'use strict';

  var dirty = 0;
  var saveTimer = null;
  var saving = false;
  var lastSaveFailed = false;
  var onChange = function () {};
  var onSaved = function () {};

  function init(options) {
    onChange = options.onChange || onChange;
    onSaved = options.onSaved || onSaved;
    document.addEventListener('click', handleClick);
  }

  function today() { return new Date().toISOString().slice(0, 10); }
  function shortId(prefix) { return prefix + Math.random().toString(36).slice(2, 9); }

  // ---- resolving a descriptor to an object and key -------------------------

  function findIn(list, id) {
    return (list || []).find(function (x) { return x.id === id; }) || null;
  }

  function target(spec) {
    var parts = String(spec).split(':');
    var index = Data.state.index;
    var kind = parts[0];
    var p;

    if (kind === 'process') {
      p = index.processes[parts[1]];
      return p ? { obj: p, key: parts[2], process: p } : null;
    }
    if (kind === 'step') {
      p = index.processes[parts[1]];
      var step = p && findIn(p.steps, parts[2]);
      return step ? { obj: step, key: parts[3], process: p } : null;
    }
    if (kind === 'check') {
      p = index.processes[parts[1]];
      var owner = p && findIn(p.steps, parts[2]);
      var check = owner && findIn(owner.checks, parts[3]);
      return check ? { obj: check, key: 'text', process: p } : null;
    }
    if (kind === 'connection') {
      p = index.processes[parts[1]];
      var conn = p && findIn(p.connections, parts[2]);
      return conn ? { obj: conn, key: parts[3], process: p } : null;
    }
    if (kind === 'issue') {
      // issue:<owner id>:<issue id>:<key> — the owner can be a process, an
      // FAQ answer, a fact sheet or a variable.
      var about = Data.issueOwner(parts[1]);
      var found = about && findIn(about.obj.issues, parts[2]);
      if (!found) return null;
      return about.kind === 'process'
        ? { obj: found, key: parts[3], process: about.obj }
        : { obj: found, key: parts[3] };
    }
    if (kind === 'rule') {
      var rule = findIn(Data.state.processes.rules, parts[1]);
      if (!rule) return null;
      // rule:<id>:match:<key> reaches into the match object.
      if (parts[2] === 'match') {
        rule.match = rule.match || {};
        return { obj: rule.match, key: parts[3] };
      }
      return { obj: rule, key: parts[2] };
    }
    if (kind === 'taxonomy') {
      var node = index.taxonomy[parts[1]];
      return node ? { obj: node, key: parts[2] } : null;
    }
    if (kind === 'tab') {
      var tab = findIn(Data.state.library.publishTabs, parts[1]);
      return tab ? { obj: tab, key: parts[2] } : null;
    }
    if (kind === 'tabstep') {
      var owning = findIn(Data.state.library.publishTabs, parts[1]);
      var stepItem = owning && (owning.stepper || [])[Number(parts[2])];
      return stepItem ? { obj: stepItem, key: parts[3] } : null;
    }
    if (kind === 'factsheet') return index.factSheets[parts[1]] ? { obj: index.factSheets[parts[1]], key: parts[2] } : null;
    if (kind === 'signoff') {
      var sheet = index.factSheets[parts[1]];
      var person = sheet && findIn(sheet.signoffs, parts[2]);
      return person ? { obj: person, key: parts[3] } : null;
    }
    if (kind === 'faq') return index.faqs[parts[1]] ? { obj: index.faqs[parts[1]], key: parts[2] } : null;
    if (kind === 'variable') return index.variables[parts[1]] ? { obj: index.variables[parts[1]], key: parts[2] } : null;
    return null;
  }

  /** Follow a dotted key such as publish.tabId, creating objects on the way. */
  function holder(t, create) {
    var keys = t.key.split('.');
    var obj = t.obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null || typeof obj[keys[i]] !== 'object') {
        if (!create) return null;
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    return { obj: obj, key: keys[keys.length - 1] };
  }

  function get(spec) {
    var t = target(spec);
    if (!t || !t.obj) return '';
    var h = holder(t, false);
    return h ? h.obj[h.key] : '';
  }

  /**
   * Inputs and selects only ever give back strings. Where the stored value
   * is a boolean, a number or null, convert back, or "false" is stored as a
   * string — which is truthy, and would withhold a public variable from
   * every export.
   */
  function coerce(current, value) {
    if (typeof current === 'boolean' || current == null) {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    if (typeof current === 'number' && value !== '' && !isNaN(Number(value))) return Number(value);
    if (value === '' && current === null) return null;
    return value;
  }

  function set(spec, value) {
    var t = target(spec);
    if (!t || !t.obj) return false;
    var h = holder(t, true);
    var current = h.obj[h.key];
    value = coerce(current, value);
    if (String(current == null ? '' : current) === String(value == null ? '' : value) &&
        typeof current === typeof value) return false;
    h.obj[h.key] = value;
    if (t.process) t.process.updated = today();
    touch();
    return true;
  }

  function touch() {
    dirty++;
    Data.rebuild();
    onChange(dirty);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }

  function currentData() {
    return {
      processes: Data.state.processes,
      library: Data.state.library,
      variables: Data.state.variables
    };
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = true;
    var data = currentData();
    var draft = {
      baseVersions: Storage.versionsOf(data),
      base: Storage.getBase(),
      data: data,
      changeCount: dirty
    };
    return Storage.saveDraft(draft).then(function () {
      saving = false;
      lastSaveFailed = false;
      onSaved(dirty);
    }).catch(function (err) {
      saving = false;
      lastSaveFailed = true;
      console.error('Could not save the draft:', err);
      onSaved(dirty, err);
    });
  }

  /** True while something typed has not yet reached the draft. */
  function unsaved() {
    return !!saveTimer || saving || lastSaveFailed || !!active;
  }

  // ---- rendering an editable field -----------------------------------------

  /**
   * opts.type  'text' (default) | 'multiline' | 'select' | 'html'
   *            | 'inlinehtml' — a short piece of HTML (a tab label, an FAQ
   *              question) shown rendered and edited on one line
   * opts.options  [{value,label}] for a select
   * opts.placeholder  shown when the value is empty
   */
  function display(value, opts) {
    value = value == null ? '' : String(value);
    if (!value) return placeholder(opts);
    if (opts.type === 'html' || opts.type === 'inlinehtml') return Data.resolveHtml(value);
    if (opts.type === 'select') {
      var chosen = (opts.options || []).find(function (o) {
        return String(o.value) === value;
      });
      return Data.escapeHtml(chosen ? chosen.label : value);
    }
    return Data.resolveText(value).replace(/\n/g, '<br>');
  }

  function field(spec, opts) {
    opts = opts || {};
    var raw = get(spec);
    var value = raw == null ? '' : String(raw);
    var shown = display(value, opts);

    return '<div class="editable' + (opts.type === 'html' ? ' rich' : '') +
      (value ? '' : ' is-empty') + '"' +
      ' data-edit="' + Data.escapeHtml(spec) + '"' +
      ' data-type="' + (opts.type || 'text') + '"' +
      (opts.options ? ' data-options="' + Data.escapeHtml(JSON.stringify(opts.options)) + '"' : '') +
      (opts.placeholder ? ' data-placeholder="' + Data.escapeHtml(opts.placeholder) + '"' : '') +
      ' tabindex="0" role="textbox" title="Click to edit">' + shown + '</div>';
  }

  function placeholder(opts) {
    return '<span class="ph">' + Data.escapeHtml(opts.placeholder || 'Empty — click to add') + '</span>';
  }

  // ---- switching a field into edit mode ------------------------------------

  var active = null;

  function handleClick(event) {
    var node = event.target.closest('[data-edit]');
    if (node && node !== active && !event.target.closest('.var-chip')) {
      beginEdit(node);
      return;
    }
    // Clicking inside the variable picker is part of editing, not a click away
    // from it, so it must not commit and tear down the field being edited.
    if (active && !event.target.closest('.edit-shell') && !event.target.closest('.modal')) {
      commit();
    }
  }

  function beginEdit(node) {
    if (active) commit();

    var spec = node.dataset.edit;
    var type = node.dataset.type || 'text';
    var value = String(get(spec) == null ? '' : get(spec));

    var shell = document.createElement('div');
    shell.className = 'edit-shell';

    var input;
    if (type === 'select') {
      input = document.createElement('select');
      JSON.parse(node.dataset.options || '[]').forEach(function (o) {
        var option = document.createElement('option');
        option.value = o.value;
        option.textContent = o.label;
        if (String(o.value) === value) option.selected = true;
        input.appendChild(option);
      });
      input.addEventListener('change', commit);
    } else if (type === 'multiline' || type === 'html') {
      input = document.createElement('textarea');
      input.value = value;
      input.rows = Math.min(24, Math.max(3, value.split('\n').length + 1));
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = value;
    }
    input.className = 'edit-input';
    if (node.dataset.placeholder) input.placeholder = node.dataset.placeholder;

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if (e.key === 'Enter' && (type === 'text' || type === 'inlinehtml' || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    });

    shell.appendChild(input);
    if (type !== 'select') {
      var bar = document.createElement('div');
      bar.className = 'edit-bar';
      bar.innerHTML = '<button class="btn small" data-act="var">+ Variable</button>' +
        '<span class="edit-hint">' +
        (type === 'text' || type === 'inlinehtml' ? 'Enter to save' : 'Ctrl+Enter to save') +
        ' · Esc to cancel</span>' +
        '<button class="btn small primary" data-act="save">Save</button>';
      bar.addEventListener('click', function (e) {
        // The detail pane listens for data-act too; this bar's buttons are
        // its own business.
        e.stopPropagation();
        var act = e.target.dataset.act;
        if (act === 'save') commit();
        if (act === 'var') insertVariable(input);
      });
      shell.appendChild(bar);
    }

    active = { node: node, input: input, shell: shell, spec: spec, original: value };
    node.replaceWith(shell);
    input.focus();
    if (input.select) input.select();
  }

  function finish(value) {
    if (!active) return;
    var current = active;
    active = null;
    var changed = value !== null && set(current.spec, value);

    if (changed) repaintNode(current.node);
    current.shell.replaceWith(current.node);
    if (changed) onChange(dirty, current.spec);
  }

  /**
   * Redraw one field in place. Without this the node put back after an edit
   * still carries the markup built before it, so the model changes and the
   * screen does not.
   */
  function repaintNode(node) {
    var value = get(node.dataset.edit);
    var opts = {
      type: node.dataset.type || 'text',
      placeholder: node.dataset.placeholder,
      options: node.dataset.options ? JSON.parse(node.dataset.options) : null
    };
    node.innerHTML = display(value, opts);
    node.classList.toggle('is-empty', !(value == null ? '' : String(value)));
  }

  function commit() { if (active) finish(active.input.value); }
  function cancel() { if (active) finish(null); }

  // ---- inserting a variable reference --------------------------------------

  function insertVariable(input) {
    var picker = document.getElementById('varPicker');
    var list = document.getElementById('varPickerList');
    var search = document.getElementById('varPickerSearch');

    function draw() {
      var q = search.value.trim().toLowerCase();
      var matches = Data.state.variables.variables.filter(function (v) {
        return !q || (v.value + ' ' + v.question).toLowerCase().indexOf(q) !== -1;
      }).slice(0, 60);
      list.innerHTML = matches.map(function (v) {
        return '<button class="pick-row" data-id="' + Data.escapeHtml(v.id) + '">' +
          '<span class="pick-value">' + Data.escapeHtml(v.value) +
          (v.internal ? ' 🔒' : '') + '</span>' +
          '<span class="pick-q">' + Data.escapeHtml(v.question) + '</span></button>';
      }).join('') || '<p class="empty">No variable matches.</p>';

      Array.prototype.forEach.call(list.querySelectorAll('.pick-row'), function (row) {
        row.addEventListener('click', function () {
          var token = '{{' + row.dataset.id + '}}';
          var at = input.selectionStart == null ? input.value.length : input.selectionStart;
          input.value = input.value.slice(0, at) + token + input.value.slice(input.selectionEnd || at);
          picker.hidden = true;
          input.focus();
          input.setSelectionRange(at + token.length, at + token.length);
        });
      });
    }

    search.value = '';
    search.oninput = draw;
    draw();
    picker.hidden = false;
    search.focus();
  }

  // ---- steps and arrows ----------------------------------------------------
  // The map is laid out by hand and may branch, so no step change ever
  // rebuilds the arrows or moves cards wholesale. Each change patches only
  // what it touches.

  var CARD_GAP_X = 320;
  var CARD_GAP_Y = 180;

  function proc(id) { return Data.state.index.processes[id] || null; }
  function stepOf(p, id) { return p ? findIn(p.steps, id) : null; }

  /** Is a card already sitting at (roughly) this spot? */
  function occupied(p, x, y, except) {
    return p.steps.some(function (s) {
      return s !== except && Math.abs((s.x || 0) - x) < 200 && Math.abs((s.y || 0) - y) < 120;
    });
  }

  /** The nearest free spot to the right of a card, dropping down a row at a time. */
  function freeSpot(p, near) {
    var x = near ? (near.x || 0) + CARD_GAP_X : 80;
    var y = near ? (near.y || 0) : 80;
    if (!near && p.steps.length) {
      // No anchor: after the right-most card on the top row.
      x = 80 + p.steps.reduce(function (m, s) { return Math.max(m, (s.x || 0) + CARD_GAP_X - 80); }, 0);
    }
    var guard = 0;
    while (occupied(p, x, y) && guard++ < 40) y += CARD_GAP_Y;
    return { x: x, y: y };
  }

  function newStep(type, title, departmentId) {
    return {
      id: shortId('step_'), type: type || 'action', x: 0, y: 0, title: title || 'New step',
      departmentId: departmentId || '',
      responsibleRole: '', escalationPoint: '', timeframe: '', sop: '',
      completionTrigger: '', script: '', checks: [], systems: [],
      factSheetRefs: [], faqRefs: [], custom: {}
    };
  }

  /**
   * Insert a step after another. The new step takes over where the previous
   * one led, and the previous one now leads to it — so a branch that left
   * the previous step still leaves it, now from the new one.
   */
  function addStep(processId, afterStepId) {
    var p = proc(processId);
    if (!p) return null;
    var previous = afterStepId ? stepOf(p, afterStepId) : p.steps[p.steps.length - 1];
    var step = newStep('action', 'New step',
      previous ? previous.departmentId : (p.steps[0] || {}).departmentId);

    var spot = freeSpot(p, previous);
    step.x = spot.x;
    step.y = spot.y;

    var at = previous ? p.steps.indexOf(previous) + 1 : p.steps.length;
    p.steps.splice(at, 0, step);

    p.connections = p.connections || [];
    if (previous) {
      p.connections.forEach(function (c) {
        if (c.from === previous.id) c.from = step.id;
      });
      p.connections.push({ id: shortId('conn_'), from: previous.id, to: step.id, condition: '' });
    }
    p.updated = today();
    touch();
    return step.id;
  }

  /**
   * Remove a step and close the gap: whatever led into it now leads to
   * wherever it led, keeping the labels on the way in. Nothing else moves.
   */
  function deleteStep(processId, stepId) {
    var p = proc(processId);
    if (!p) return;
    var conns = p.connections || [];
    var incoming = conns.filter(function (c) { return c.to === stepId; });
    var outgoing = conns.filter(function (c) { return c.from === stepId; });

    var kept = conns.filter(function (c) { return c.from !== stepId && c.to !== stepId; });
    incoming.forEach(function (inc) {
      outgoing.forEach(function (out) {
        if (inc.from === out.to) return;
        var exists = kept.some(function (c) { return c.from === inc.from && c.to === out.to; });
        if (!exists) {
          kept.push({
            id: shortId('conn_'), from: inc.from, to: out.to,
            condition: inc.condition || out.condition || ''
          });
        }
      });
    });

    p.connections = kept;
    p.steps = p.steps.filter(function (s) { return s.id !== stepId; });
    (p.issues || []).forEach(function (i) { if (i.stepId === stepId) i.stepId = null; });
    p.updated = today();
    touch();
  }

  /**
   * Move a step up or down the list.
   *
   * In a straight-line process the list is the flow, so the arrows follow
   * and the two cards swap places on the map. Once a process branches, the
   * list is only reading order: the step moves in the list and the arrows,
   * which you drew, are left alone.
   */
  function moveStep(processId, stepId, direction) {
    var p = proc(processId);
    if (!p) return;
    var at = p.steps.findIndex(function (s) { return s.id === stepId; });
    var to = at + direction;
    if (at < 0 || to < 0 || to >= p.steps.length) return;

    var linear = Data.isLinear(p);
    var a = p.steps[at], b = p.steps[to];
    p.steps.splice(to, 0, p.steps.splice(at, 1)[0]);

    if (linear) {
      var ax = a.x, ay = a.y;
      a.x = b.x; a.y = b.y;
      b.x = ax; b.y = ay;
      relink(p);
    }
    p.updated = today();
    touch();
  }

  /** Rewire a straight-line process down its list, keeping existing labels and ids. */
  function relink(p) {
    var old = {};
    (p.connections || []).forEach(function (c) { old[c.from + '>' + c.to] = c; });
    p.connections = p.steps.slice(0, -1).map(function (s, i) {
      var next = p.steps[i + 1];
      var prior = old[s.id + '>' + next.id] || old[next.id + '>' + s.id];
      return {
        id: prior ? prior.id : shortId('conn_'), from: s.id, to: next.id,
        condition: prior ? prior.condition || '' : ''
      };
    });
  }

  /** Draw an arrow. Returns the new connection's id, or null if it already exists. */
  function addConnection(processId, fromId, toId, condition) {
    var p = proc(processId);
    if (!p || !fromId || !toId || fromId === toId) return null;
    if (!stepOf(p, fromId) || !stepOf(p, toId)) return null;
    p.connections = p.connections || [];
    var exists = p.connections.some(function (c) { return c.from === fromId && c.to === toId; });
    if (exists) return null;
    var id = shortId('conn_');
    p.connections.push({ id: id, from: fromId, to: toId, condition: condition || '' });
    p.updated = today();
    touch();
    return id;
  }

  function deleteConnection(processId, connId) {
    var p = proc(processId);
    if (!p) return;
    p.connections = (p.connections || []).filter(function (c) { return c.id !== connId; });
    p.updated = today();
    touch();
  }

  /** Record a card's new position after a drag, as one change rather than many. */
  function moveCard(processId, stepId, x, y) {
    var step = stepOf(proc(processId), stepId);
    if (!step) return;
    if (step.x === x && step.y === y) return;
    step.x = x;
    step.y = y;
    touch();
  }

  function addCheck(processId, stepId) {
    var step = stepOf(proc(processId), stepId);
    if (!step) return;
    step.checks = step.checks || [];
    step.checks.push({ id: shortId('chk_'), text: '' });
    touch();
  }

  function deleteCheck(processId, stepId, checkId) {
    var step = stepOf(proc(processId), stepId);
    if (!step) return;
    step.checks = (step.checks || []).filter(function (c) { return c.id !== checkId; });
    touch();
  }

  // ---- issues --------------------------------------------------------------

  /** The item an issue sits on, or null. */
  function issueHolder(ownerId) {
    var owner = Data.issueOwner(ownerId);
    return owner ? owner.obj : null;
  }

  /**
   * Raise an issue on a process (optionally one of its steps), an FAQ
   * answer, a fact sheet or a variable.
   */
  function raiseIssue(ownerId, fields) {
    var holder = issueHolder(ownerId);
    if (!holder || !fields || !String(fields.note || '').trim()) return null;
    holder.issues = holder.issues || [];
    var issue = {
      id: shortId('iss_'),
      note: String(fields.note).trim(),
      severity: fields.severity || 'medium',
      raised: today(),
      raisedBy: fields.raisedBy || ''
    };
    // Only a process has steps for an issue to be about.
    if (Data.issueOwner(ownerId).kind === 'process') issue.stepId = fields.stepId || null;
    holder.issues.push(issue);
    touch();
    return issue.id;
  }

  /**
   * Resolving keeps the issue, stamped with when and how. The register is a
   * record for the consultants as well as a to-do list, and "what did we
   * fix" is half of what they will ask.
   */
  function resolveIssue(ownerId, issueId, note) {
    var issue = findIn((issueHolder(ownerId) || {}).issues, issueId);
    if (!issue) return;
    issue.resolved = today();
    if (note) issue.resolution = note;
    touch();
  }

  function reopenIssue(ownerId, issueId) {
    var issue = findIn((issueHolder(ownerId) || {}).issues, issueId);
    if (!issue) return;
    delete issue.resolved;
    delete issue.resolution;
    delete issue.answeredBy;
    touch();
  }

  function deleteIssue(ownerId, issueId) {
    var owner = Data.issueOwner(ownerId);
    if (!owner) return;
    // A content gap is its own issue: deleting it removes the gap.
    if (owner.kind === 'gap') {
      var lib = Data.state.library;
      lib.contentGaps = (lib.contentGaps || []).filter(function (g) { return g.id !== issueId; });
      touch();
      return;
    }
    var holder = owner.obj;
    holder.issues = (holder.issues || []).filter(function (i) { return i.id !== issueId; });
    if (!holder.issues.length && owner.kind !== 'process') delete holder.issues;
    touch();
  }

  // ---- content gaps --------------------------------------------------------
  // A question the FAQ doesn't answer yet, logged from Probe. Each is an
  // issue in its own right (see Data.ISSUE_KINDS): it has a severity, can be
  // resolved and reopened, and sits in the issues register with the rest.

  /**
   * Log a content gap. fields: { q, note, severity, ownerId, tabId,
   * nearest: { faqId, score }, raisedBy }. Returns the new gap's id.
   */
  function raiseGap(fields) {
    var q = String((fields && fields.q) || '').trim();
    if (!q) return null;
    var lib = Data.state.library;
    lib.contentGaps = lib.contentGaps || [];
    var gap = {
      id: shortId('gap_'),
      q: q,
      note: String(fields.note || '').trim() || 'No FAQ answer covers this question.',
      severity: fields.severity || 'medium',
      ownerId: fields.ownerId || '',
      tabId: fields.tabId || '',
      nearest: fields.nearest && fields.nearest.faqId
        ? { faqId: fields.nearest.faqId, score: Math.round(fields.nearest.score * 100) / 100 }
        : null,
      raised: today(),
      raisedBy: fields.raisedBy || ''
    };
    lib.contentGaps.push(gap);
    touch();
    return gap.id;
  }

  /** Close a gap because an FAQ answer now covers it, naming the answer. */
  function resolveGap(gapId, faqId) {
    var gap = (Data.state.library.contentGaps || []).find(function (g) { return g.id === gapId; });
    var faq = Data.state.index.faqs[faqId];
    if (!gap || !faq) return;
    gap.resolved = today();
    gap.resolution = 'Answered by: ' + Data.plainText(faq.q);
    gap.answeredBy = faqId;
    touch();
  }

  function verifyVariable(id, by) {
    var v = Data.variable(id);
    if (!v) return;
    v.status = 'current';
    v.lastVerified = today();
    v.verifiedBy = by || '';
    touch();
  }

  /**
   * Give a variable the same source document as other variables already
   * cite (a Data.sources() entry). Only the document is copied: where in it
   * this value appears is this variable's own business.
   */
  function useSource(id, title, url) {
    var v = Data.variable(id);
    if (!v) return;
    v.source = v.source || {};
    v.source.title = title || '';
    v.source.url = url || '';
    v.source.checked = v.source.checked || today();
    touch();
  }

  /** Record that someone has just seen the source say this value. */
  function sourceSeen(id) {
    var v = Data.variable(id);
    if (!v || !Data.hasSource(v)) return;
    v.source.checked = today();
    touch();
  }

  // ---- attaching library content -------------------------------------------

  function refField(kind) { return kind === 'factsheet' ? 'factSheetRefs' : 'faqRefs'; }

  /** stepId null attaches to the process as a whole. */
  function attach(processId, stepId, kind, id) {
    var p = proc(processId);
    var owner = stepId ? stepOf(p, stepId) : p;
    if (!owner) return;
    var key = refField(kind);
    owner[key] = owner[key] || [];
    if (owner[key].indexOf(id) !== -1) return;
    owner[key].push(id);
    p.updated = today();
    touch();
  }

  function detach(processId, stepId, kind, id) {
    var p = proc(processId);
    var owner = stepId ? stepOf(p, stepId) : p;
    if (!owner) return;
    var key = refField(kind);
    owner[key] = (owner[key] || []).filter(function (x) { return x !== id; });
    p.updated = today();
    touch();
  }

  /**
   * Strip every reference to a library item, from steps and processes alike
   * — and, for an FAQ question, from the fact sheets that list it as related.
   */
  function dropRefs(kind, id) {
    var key = refField(kind);
    var owners = [];
    Data.state.processes.processes.forEach(function (p) {
      owners = owners.concat([p], p.steps);
    });
    if (kind === 'faq') owners = owners.concat(Data.state.library.factSheets);
    owners.forEach(function (owner) {
      if (owner[key] && owner[key].indexOf(id) !== -1) {
        owner[key] = owner[key].filter(function (x) { return x !== id; });
      }
    });
  }

  // ---- fact sheets: related FAQ answers and sign-off -----------------------

  function sheet(id) { return Data.state.index.factSheets[id] || null; }

  /** An FAQ question this fact sheet expands on, carried into its review pack. */
  function relateFaq(sheetId, faqId) {
    var s = sheet(sheetId);
    if (!s || !Data.state.index.faqs[faqId]) return;
    s.faqRefs = s.faqRefs || [];
    if (s.faqRefs.indexOf(faqId) !== -1) return;
    s.faqRefs.push(faqId);
    touch();
  }

  function unrelateFaq(sheetId, faqId) {
    var s = sheet(sheetId);
    if (!s) return;
    s.faqRefs = (s.faqRefs || []).filter(function (x) { return x !== faqId; });
    touch();
  }

  /** Someone who has to agree to the fact sheet before it goes to comms. */
  function addSignoff(sheetId, name, role) {
    var s = sheet(sheetId);
    if (!s) return null;
    s.signoffs = s.signoffs || [];
    var person = {
      id: shortId('so_'), name: name || '', role: role || '',
      decision: 'pending', date: '', note: ''
    };
    s.signoffs.push(person);
    touch();
    return person.id;
  }

  function removeSignoff(sheetId, personId) {
    var s = sheet(sheetId);
    if (!s) return;
    s.signoffs = (s.signoffs || []).filter(function (x) { return x.id !== personId; });
    touch();
  }

  /**
   * Record a decision, dated today. Going back to "waiting" clears the date,
   * since nobody has decided anything yet.
   */
  function decideSignoff(sheetId, personId, decision) {
    var s = sheet(sheetId);
    var person = s && findIn(s.signoffs, personId);
    if (!person) return;
    person.decision = decision;
    person.date = decision === 'pending' ? '' : today();
    touch();
  }

  // ---- creating and deleting -----------------------------------------------

  function takenIds(list) {
    var taken = {};
    (list || []).forEach(function (x) { taken[x.id] = true; });
    return taken;
  }

  /** A new process starts as an entry step joined to a resolution step. */
  function createProcess(taxonomyId, name) {
    var file = Data.state.processes;
    var id = Data.makeId('proc_', name, takenIds(file.processes));
    var entry = newStep('entry', 'Customer makes contact', taxonomyId);
    var done = newStep('resolution', 'Resolved', taxonomyId);
    entry.x = 80; entry.y = 80;
    done.x = 80 + CARD_GAP_X; done.y = 80;
    file.processes.push({
      id: id,
      name: name,
      taxonomyId: taxonomyId,
      status: 'draft',
      owner: '',
      lastReviewed: '',
      purpose: '',
      entryPoint: '',
      resolutionDefinition: '',
      steps: [entry, done],
      connections: [{ id: shortId('conn_'), from: entry.id, to: done.id, condition: '' }],
      issues: [],
      factSheetRefs: [],
      faqRefs: [],
      canvas: { cardDetail: 'default' },
      created: today(),
      updated: today()
    });
    touch();
    return id;
  }

  function deleteProcess(id) {
    var file = Data.state.processes;
    file.processes = file.processes.filter(function (p) { return p.id !== id; });
    // A publish tab generating its stepper from this process falls back to
    // its own literal stepper rather than pointing at nothing.
    Data.state.library.publishTabs.forEach(function (t) {
      if (t.stepperFrom === id) t.stepperFrom = null;
    });
    touch();
  }

  /**
   * A new fact sheet starts as a draft. current is the version on the
   * council site it would replace (left empty for a sheet that replaces
   * nothing), and rationale the case for replacing it.
   */
  function createFactSheet(title) {
    var lib = Data.state.library;
    var id = Data.makeId('fs_', title, takenIds(lib.factSheets));
    lib.factSheets.push({
      id: id, title: title, summary: '', body: '<p></p>',
      ownerId: '', status: 'draft', lastReviewed: '',
      current: { title: '', url: '' },
      rationale: '',
      faqRefs: [],
      signoffs: []
    });
    touch();
    return id;
  }

  function deleteFactSheet(id) {
    var lib = Data.state.library;
    lib.factSheets = lib.factSheets.filter(function (s) { return s.id !== id; });
    dropRefs('factsheet', id);
    touch();
  }

  function createFaq(question) {
    var lib = Data.state.library;
    var id = Data.makeId('faq_', question, takenIds(lib.faqs));
    // Last in whichever tab it is given, until someone says otherwise.
    var last = lib.faqs.reduce(function (m, f) {
      return Math.max(m, Number((f.publish || {}).order) || 0);
    }, 0);
    lib.faqs.push({
      id: id, q: question, a: '<p></p>',
      publish: { tabId: null, order: last + 1, groupTitle: null },
      ownerId: '', status: 'draft', lastReviewed: '', internal: false
    });
    touch();
    return id;
  }

  /**
   * The other ways people ask an FAQ question, one per line of text. Kept as
   * a list on the question (alsoAsked); an empty list is removed altogether.
   * Never published as text — Probe and ask.html match against them.
   */
  function setAlsoAsked(id, text) {
    var f = Data.state.index.faqs[id];
    if (!f) return;
    var seen = {};
    var list = String(text || '').split('\n').map(function (s) {
      return s.replace(/\s+/g, ' ').trim();
    }).filter(function (s) {
      var key = s.toLowerCase();
      if (!s || seen[key]) return false;
      return (seen[key] = true);
    });
    var before = JSON.stringify(f.alsoAsked || []);
    if (JSON.stringify(list) === before) return;
    if (list.length) f.alsoAsked = list;
    else delete f.alsoAsked;
    touch();
  }

  function deleteFaq(id) {
    var lib = Data.state.library;
    lib.faqs = lib.faqs.filter(function (f) { return f.id !== id; });
    dropRefs('faq', id);
    touch();
  }

  function createVariable(value) {
    var file = Data.state.variables;
    var id = Data.makeId('var_', value, takenIds(file.variables));
    file.variables.push({
      id: id, question: '', value: value, type: 'text', ownerId: '', note: '',
      internal: false, status: 'pending', lastVerified: '', verifiedBy: ''
    });
    touch();
    return id;
  }

  /**
   * Only an unused variable can be deleted. Deleting one still referenced
   * would leave every mention of it showing a bare id, in content that may
   * already be published.
   */
  function deleteVariable(id) {
    var usage = Data.state.index.usage[id];
    if (usage && usage.processes.length) return false;
    var file = Data.state.variables;
    file.variables = file.variables.filter(function (v) { return v.id !== id; });
    touch();
    return true;
  }

  // ---- departments ---------------------------------------------------------

  function createTaxonomy(parentId, name) {
    var file = Data.state.processes;
    var id = Data.makeId('tax_', name, takenIds(file.taxonomy));
    var siblings = file.taxonomy.filter(function (n) { return (n.parentId || null) === (parentId || null); });
    var order = siblings.reduce(function (m, n) { return Math.max(m, n.order || 0); }, 0) + 1;
    file.taxonomy.push({ id: id, name: name, parentId: parentId || null, order: order, collapsed: false });
    touch();
    return id;
  }

  /** Everything that points at a department, so it can only go when nothing does. */
  function taxonomyUsage(id) {
    var used = { children: 0, processes: 0, steps: 0, owned: 0 };
    Data.state.processes.taxonomy.forEach(function (n) { if (n.parentId === id) used.children++; });
    Data.state.processes.processes.forEach(function (p) {
      if (p.taxonomyId === id) used.processes++;
      p.steps.forEach(function (s) { if (s.departmentId === id) used.steps++; });
    });
    Data.state.library.factSheets.concat(Data.state.library.faqs, Data.state.variables.variables)
      .forEach(function (x) { if (x.ownerId === id) used.owned++; });
    used.total = used.children + used.processes + used.steps + used.owned;
    return used;
  }

  function deleteTaxonomy(id) {
    if (taxonomyUsage(id).total) return false;
    var file = Data.state.processes;
    file.taxonomy = file.taxonomy.filter(function (n) { return n.id !== id; });
    touch();
    return true;
  }

  /** Swap a department with its neighbour among its siblings. */
  function moveTaxonomy(id, direction) {
    var node = Data.state.index.taxonomy[id];
    if (!node) return;
    var siblings = (Data.state.index.children[node.parentId || '__root__'] || []).slice();
    var at = siblings.indexOf(node);
    var other = siblings[at + direction];
    if (!other) return;
    // Renumber first, in case the imported orders have gaps or repeats.
    siblings.forEach(function (n, i) { n.order = i + 1; });
    var o = node.order;
    node.order = other.order;
    other.order = o;
    touch();
  }

  /** Would making parentId the parent of id create a loop? */
  function wouldLoop(id, parentId) {
    var node = Data.state.index.taxonomy[parentId];
    var guard = 0;
    while (node && guard++ < 50) {
      if (node.id === id) return true;
      node = Data.state.index.taxonomy[node.parentId];
    }
    return false;
  }

  global.Edit = {
    init: init,
    field: field,
    get: get,
    set: set,
    save: save,
    touch: touch,
    commitActive: commit,
    unsaved: unsaved,
    dirtyCount: function () { return dirty; },
    resetDirty: function () { dirty = 0; },
    addStep: addStep,
    moveCard: moveCard,
    deleteStep: deleteStep,
    moveStep: moveStep,
    addConnection: addConnection,
    deleteConnection: deleteConnection,
    addCheck: addCheck,
    deleteCheck: deleteCheck,
    raiseIssue: raiseIssue,
    resolveIssue: resolveIssue,
    reopenIssue: reopenIssue,
    deleteIssue: deleteIssue,
    raiseGap: raiseGap,
    resolveGap: resolveGap,
    verifyVariable: verifyVariable,
    useSource: useSource,
    sourceSeen: sourceSeen,
    attach: attach,
    detach: detach,
    createProcess: createProcess,
    deleteProcess: deleteProcess,
    createFactSheet: createFactSheet,
    deleteFactSheet: deleteFactSheet,
    relateFaq: relateFaq,
    unrelateFaq: unrelateFaq,
    addSignoff: addSignoff,
    removeSignoff: removeSignoff,
    decideSignoff: decideSignoff,
    createFaq: createFaq,
    deleteFaq: deleteFaq,
    setAlsoAsked: setAlsoAsked,
    createVariable: createVariable,
    deleteVariable: deleteVariable,
    createTaxonomy: createTaxonomy,
    deleteTaxonomy: deleteTaxonomy,
    moveTaxonomy: moveTaxonomy,
    taxonomyUsage: taxonomyUsage,
    wouldLoop: wouldLoop
  };
}(window));
