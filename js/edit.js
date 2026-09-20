/* ===========================================================================
   edit.js — in-place editing.

   Fields are rendered read-only and become inputs when clicked. Each one
   carries a data-edit descriptor saying what it points at, so the binding
   survives a re-render without a registry to keep in step.

   Descriptor forms:
     process:<pid>:<key>
     step:<pid>:<sid>:<key>
     check:<pid>:<sid>:<cid>
     connection:<pid>:<cid>:<key>
     rule:<rid>:<key>  ·  rule:<rid>:match:<key>
     article:<aid>:<key>
     faq:<fid>:<key>
     variable:<vid>:<key>
   =========================================================================== */

(function (global) {
  'use strict';

  var dirty = 0;
  var saveTimer = null;
  var onChange = function () {};
  var onSaved = function () {};

  function init(options) {
    onChange = options.onChange || onChange;
    onSaved = options.onSaved || onSaved;
    document.addEventListener('click', handleClick);
  }

  // ---- resolving a descriptor to an object and key -------------------------

  function target(spec) {
    var parts = String(spec).split(':');
    var index = Data.state.index;
    var kind = parts[0];

    if (kind === 'process') {
      return { obj: index.processes[parts[1]], key: parts[2], process: index.processes[parts[1]] };
    }
    if (kind === 'step') {
      var p = index.processes[parts[1]];
      if (!p) return null;
      var step = p.steps.find(function (s) { return s.id === parts[2]; });
      return step ? { obj: step, key: parts[3], process: p } : null;
    }
    if (kind === 'check') {
      var proc = index.processes[parts[1]];
      if (!proc) return null;
      var owner = proc.steps.find(function (s) { return s.id === parts[2]; });
      if (!owner) return null;
      var check = (owner.checks || []).find(function (c) { return c.id === parts[3]; });
      return check ? { obj: check, key: 'text', process: proc } : null;
    }
    if (kind === 'connection') {
      var owner = index.processes[parts[1]];
      if (!owner) return null;
      var conn = (owner.connections || []).find(function (c) { return c.id === parts[2]; });
      return conn ? { obj: conn, key: parts[3], process: owner } : null;
    }
    if (kind === 'rule') {
      var rule = (Data.state.processes.rules || []).find(function (r) { return r.id === parts[1]; });
      if (!rule) return null;
      // rule:<id>:match:<key> reaches into the match object.
      if (parts[2] === 'match') {
        rule.match = rule.match || {};
        return { obj: rule.match, key: parts[3] };
      }
      return { obj: rule, key: parts[2] };
    }
    if (kind === 'article') return { obj: index.articles[parts[1]], key: parts[2] };
    if (kind === 'faq') return { obj: index.faqs[parts[1]], key: parts[2] };
    if (kind === 'variable') return { obj: index.variables[parts[1]], key: parts[2] };
    return null;
  }

  function get(spec) {
    var t = target(spec);
    return t && t.obj ? t.obj[t.key] : '';
  }

  function set(spec, value) {
    var t = target(spec);
    if (!t || !t.obj) return false;
    if (String(t.obj[t.key] == null ? '' : t.obj[t.key]) === String(value)) return false;
    t.obj[t.key] = value;
    if (t.process) {
      t.process.updated = new Date().toISOString().slice(0, 10);
    }
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

  function save() {
    var draft = {
      baseVersions: Storage.versionsOf({
        processes: Data.state.processes,
        library: Data.state.library,
        variables: Data.state.variables
      }),
      data: {
        processes: Data.state.processes,
        library: Data.state.library,
        variables: Data.state.variables
      },
      changeCount: dirty
    };
    return Storage.saveDraft(draft).then(function () {
      onSaved(dirty);
    }).catch(function (err) {
      console.error('Could not save the draft:', err);
      onSaved(dirty, err);
    });
  }

  // ---- rendering an editable field -----------------------------------------

  /**
   * opts.type  'text' (default) | 'multiline' | 'select' | 'html'
   * opts.options  [{value,label}] for a select
   * opts.placeholder  shown when the value is empty
   */
  function display(value, opts) {
    value = value == null ? '' : String(value);
    if (!value) return placeholder(opts);
    if (opts.type === 'html') return Data.resolveHtml(value);
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
        if (o.value === value) option.selected = true;
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
      if (e.key === 'Enter' && (type === 'text' || e.metaKey || e.ctrlKey)) {
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
        (type === 'text' ? 'Enter to save' : 'Ctrl+Enter to save') + ' · Esc to cancel</span>' +
        '<button class="btn small primary" data-act="save">Save</button>';
      bar.addEventListener('click', function (e) {
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

  // ---- structural edits ----------------------------------------------------

  function addStep(processId, afterStepId) {
    var p = Data.state.index.processes[processId];
    if (!p) return null;
    var id = 'step_' + Math.random().toString(36).slice(2, 9);
    var previous = p.steps.find(function (s) { return s.id === afterStepId; });
    var step = {
      id: id, type: 'action', x: 0, y: 80, title: 'New step',
      departmentId: previous ? previous.departmentId : (p.steps[0] || {}).departmentId || '',
      responsibleRole: '', escalationPoint: '', timeframe: '', sop: '',
      completionTrigger: '', script: '', checks: [], systems: [],
      articleRefs: [], faqRefs: [], custom: {}
    };
    var at = afterStepId ? p.steps.findIndex(function (s) { return s.id === afterStepId; }) + 1 : p.steps.length;
    p.steps.splice(at, 0, step);
    relayout(p, true);
    if (!step.x) { step.x = (previous ? previous.x + 320 : 80); step.y = previous ? previous.y : 80; }
    touch();
    return id;
  }

  function deleteStep(processId, stepId) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    p.steps = p.steps.filter(function (s) { return s.id !== stepId; });
    p.connections = (p.connections || []).filter(function (c) {
      return c.from !== stepId && c.to !== stepId;
    });
    relayout(p);
    touch();
  }

  function moveStep(processId, stepId, direction) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    var at = p.steps.findIndex(function (s) { return s.id === stepId; });
    var to = at + direction;
    if (at < 0 || to < 0 || to >= p.steps.length) return;
    p.steps.splice(to, 0, p.steps.splice(at, 1)[0]);
    relayout(p);
    touch();
  }

  /** Reposition and rewire after any structural change, so the two agree. */
  function relayout(p, keepPositions) {
    if (!keepPositions) {
      p.steps.forEach(function (s, i) { s.x = 80 + i * 320; s.y = 80; });
    }
    var kept = {};
    (p.connections || []).forEach(function (c) { kept[c.from + '>' + c.to] = c.condition || ''; });
    p.connections = [];
    p.steps.slice(0, -1).forEach(function (s, i) {
      var next = p.steps[i + 1];
      p.connections.push({
        id: 'conn_' + (i + 1), from: s.id, to: next.id,
        condition: kept[s.id + '>' + next.id] || ''
      });
    });
  }

  /** Record a card's new position after a drag, as one change rather than many. */
  function moveCard(processId, stepId, x, y) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    var step = p.steps.find(function (s) { return s.id === stepId; });
    if (!step) return;
    if (step.x === x && step.y === y) return;
    step.x = x;
    step.y = y;
    touch();
  }

  function addCheck(processId, stepId) {
    var t = target('step:' + processId + ':' + stepId + ':checks');
    if (!t || !t.obj) return;
    t.obj.checks = t.obj.checks || [];
    t.obj.checks.push({ id: 'chk_' + Math.random().toString(36).slice(2, 7), text: '' });
    touch();
  }

  function deleteCheck(processId, stepId, checkId) {
    var t = target('step:' + processId + ':' + stepId + ':checks');
    if (!t || !t.obj) return;
    t.obj.checks = (t.obj.checks || []).filter(function (c) { return c.id !== checkId; });
    touch();
  }

  function resolveIssue(processId, issueId) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    p.issues = (p.issues || []).filter(function (i) { return i.id !== issueId; });
    touch();
  }

  function verifyVariable(id, by) {
    var v = Data.variable(id);
    if (!v) return;
    v.status = 'current';
    v.lastVerified = new Date().toISOString().slice(0, 10);
    v.verifiedBy = by || '';
    touch();
  }

  global.Edit = {
    init: init,
    field: field,
    get: get,
    set: set,
    save: save,
    touch: touch,
    dirtyCount: function () { return dirty; },
    resetDirty: function () { dirty = 0; },
    addStep: addStep,
    moveCard: moveCard,
    deleteStep: deleteStep,
    moveStep: moveStep,
    addCheck: addCheck,
    deleteCheck: deleteCheck,
    resolveIssue: resolveIssue,
    verifyVariable: verifyVariable
  };
}(window));
