/* ===========================================================================
   richtext.js — the prose editor for knowledge base articles and FAQ answers,
   carried over from the FAQ Editor.

   A toolbar over a contenteditable area, a raw HTML toggle for when the markup
   needs a hand, and a live preview underneath styled like the published page —
   because a public FAQ answer should be judged as it will appear, not as
   markup.

   Variables sit in the text as chips the caret cannot enter, so a reference
   can be deleted whole but never half-edited into nonsense.
   =========================================================================== */

(function (global) {
  'use strict';

  var active = null;

  function e(text) { return Data.escapeHtml(text); }

  function node(tag, className, html) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, '').trim();
  }

  /**
   * opts.html         starting markup
   * opts.onChange     called with the canonical markup, debounced
   * opts.headerHtml   shown above the preview body (the FAQ question)
   * opts.previewClass the published class the body renders under
   */
  function mount(host, opts) {
    opts = opts || {};
    var root = node('div', 'rt');
    var toolbar = node('div', 'rt-toolbar');

    var area = node('div', 'rt-area');
    area.contentEditable = 'true';
    area.spellcheck = true;
    area.innerHTML = Data.editableHtml(opts.html || '');

    var source = node('textarea', 'rt-source');
    source.value = Data.canonicalHtml(opts.html || '');

    // ---- toolbar ----------------------------------------------------------

    function button(label, title, handler, className) {
      var b = node('button', className || null, label);
      b.type = 'button';
      b.title = title;
      // mousedown default would move the caret out of the area before the
      // command runs, so the selection has to be preserved here.
      b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      b.addEventListener('click', function (ev) { ev.preventDefault(); handler(); });
      return b;
    }

    function separator() { return node('span', 'sep'); }

    // A toolbar click must not lose the caret, and execCommand reports failure
    // by returning false rather than throwing, so inserting is done through the
    // Range API where the outcome is visible.
    var savedRange = null;

    function rememberSelection() {
      var selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      var range = selection.getRangeAt(0);
      if (area.contains(range.commonAncestorContainer)) {
        savedRange = range.cloneRange();
      }
    }

    function restoreSelection() {
      area.focus();
      var selection = window.getSelection();
      selection.removeAllRanges();
      if (savedRange && area.contains(savedRange.commonAncestorContainer)) {
        selection.addRange(savedRange);
        return;
      }
      var atEnd = document.createRange();
      atEnd.selectNodeContents(area);
      atEnd.collapse(false);
      selection.addRange(atEnd);
    }

    area.addEventListener('keyup', rememberSelection);
    area.addEventListener('mouseup', rememberSelection);
    area.addEventListener('focus', rememberSelection);

    function exec(command, value) {
      restoreSelection();
      try { document.execCommand(command, false, value || null); } catch (err) { /* ignore */ }
      rememberSelection();
    }

    function insertHtml(html) {
      restoreSelection();
      var selection = window.getSelection();
      var range = selection.getRangeAt(0);
      range.deleteContents();

      var holder = document.createElement('div');
      holder.innerHTML = html;
      var fragment = document.createDocumentFragment();
      var last = null;
      while (holder.firstChild) { last = fragment.appendChild(holder.firstChild); }
      range.insertNode(fragment);

      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      rememberSelection();
      sync();
    }

    toolbar.appendChild(button('<b>B</b>', 'Bold', function () { exec('bold'); sync(); }));
    toolbar.appendChild(button('<i>I</i>', 'Italic', function () { exec('italic'); sync(); }));
    toolbar.appendChild(separator());
    toolbar.appendChild(button('¶', 'Paragraph', function () { exec('formatBlock', 'p'); sync(); }));
    toolbar.appendChild(button('• List', 'Bullet list', function () { exec('insertUnorderedList'); sync(); }));
    toolbar.appendChild(button('1. List', 'Numbered list', function () { exec('insertOrderedList'); sync(); }));
    toolbar.appendChild(separator());
    toolbar.appendChild(button('🔗 Link', 'Insert a link', function () {
      openLinkModal(selectionText(), insertHtml);
    }));
    toolbar.appendChild(button('＋Var', 'Insert a reusable value (fee, URL, phone…)', function () {
      openVariablePicker(function (v) {
        insertHtml('<span class="faq-var" data-var="' + e(v.id) +
          '" contenteditable="false">' + e(v.value) + '</span>&nbsp;');
      });
    }, 'var-btn'));
    toolbar.appendChild(separator());
    toolbar.appendChild(button('Note', 'Blue note box', function () {
      insertHtml('<div class="note">Note text…</div><p><br></p>');
    }));
    toolbar.appendChild(button('Warn', 'Amber warning box', function () {
      insertHtml('<div class="warn">Warning text…</div><p><br></p>');
    }));
    toolbar.appendChild(button('Term', 'Green definition box', function () {
      insertHtml('<div class="term"><strong>Term</strong> — definition…</div><p><br></p>');
    }));
    toolbar.appendChild(button('Table', 'Starter table', function () {
      insertHtml('<table class="facility-table"><thead><tr><th>Column 1</th>' +
        '<th>Column 2</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr>' +
        '<tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>');
    }));
    toolbar.appendChild(button('⨯ Clear', 'Remove formatting', function () {
      exec('removeFormat'); sync();
    }));

    toolbar.appendChild(node('span', 'spacer'));
    var srcToggle = node('button', 'src-toggle', '&lt;/&gt; HTML');
    srcToggle.type = 'button';
    srcToggle.title = 'Edit the raw HTML';
    srcToggle.addEventListener('click', function () {
      var showing = root.classList.toggle('show-source');
      srcToggle.classList.toggle('active', showing);
      if (showing) {
        source.value = Data.canonicalHtml(area.innerHTML);
        source.focus();
      } else {
        area.innerHTML = Data.editableHtml(source.value);
        sync();
      }
    });
    toolbar.appendChild(srcToggle);

    // ---- preview ----------------------------------------------------------

    var previewWrap = node('div', 'preview-wrap');
    previewWrap.appendChild(node('div', 'preview-label',
      'Live preview — how it looks on the page'));
    var previewBody = node('div', 'preview-body');
    var preview = node('div', 'faq-preview');
    var previewHeader = node('div', 'preview-q');
    var previewInner = node('div', opts.previewClass || 'faq-a-inner');
    preview.appendChild(previewHeader);
    preview.appendChild(previewInner);
    previewBody.appendChild(preview);
    previewWrap.appendChild(previewBody);

    function setHeader(html) {
      if (html && stripTags(html)) {
        previewHeader.innerHTML = '<div class="faq-q-text">' + html + '</div>';
        previewHeader.style.display = 'block';
      } else {
        previewHeader.innerHTML = '';
        previewHeader.style.display = 'none';
      }
    }
    setHeader(opts.headerHtml || '');

    // ---- syncing ----------------------------------------------------------

    var timer = null;

    function rawHtml() {
      return root.classList.contains('show-source') ? source.value : area.innerHTML;
    }

    function updatePreview() {
      previewInner.innerHTML = Data.resolveHtml(rawHtml());
    }

    /**
     * The preview updates on every keystroke, but the model does not: a commit
     * rebuilds every index, which is far too much work to do per character.
     */
    function sync() {
      updatePreview();
      clearTimeout(timer);
      timer = setTimeout(commit, 500);
    }

    function commit() {
      clearTimeout(timer);
      if (opts.onChange) opts.onChange(Data.canonicalHtml(rawHtml()));
    }

    area.addEventListener('input', sync);
    area.addEventListener('blur', commit);
    source.addEventListener('input', sync);
    source.addEventListener('blur', commit);

    root.appendChild(toolbar);
    root.appendChild(area);
    root.appendChild(source);
    host.appendChild(root);
    host.appendChild(previewWrap);
    updatePreview();

    active = { commit: commit, setHeader: setHeader };
    return active;
  }

  /** Flush any pending edit — call before navigating away. */
  function flush() {
    if (active) active.commit();
  }

  function selectionText() {
    var selection = window.getSelection();
    return selection ? selection.toString() : '';
  }

  // ---- variable picker -----------------------------------------------------

  function openVariablePicker(onPick) {
    var modal = document.getElementById('varPicker');
    var list = document.getElementById('varPickerList');
    var search = document.getElementById('varPickerSearch');

    function draw() {
      var q = search.value.trim().toLowerCase();
      var matches = Data.state.variables.variables.filter(function (v) {
        return !q || (v.value + ' ' + v.question).toLowerCase().indexOf(q) !== -1;
      }).slice(0, 60);

      list.innerHTML = matches.map(function (v) {
        return '<button class="pick-row" data-id="' + e(v.id) + '">' +
          '<span class="pick-value">' + e(v.value) + (v.internal ? ' 🔒' : '') + '</span>' +
          '<span class="pick-q">' + e(v.question) + '</span></button>';
      }).join('') || '<p class="empty">No variable matches.</p>';

      Array.prototype.forEach.call(list.querySelectorAll('.pick-row'), function (row) {
        row.addEventListener('click', function () {
          modal.hidden = true;
          onPick(Data.variable(row.dataset.id));
        });
      });
    }

    search.value = '';
    search.oninput = draw;
    draw();
    modal.hidden = false;
    search.focus();
  }

  // ---- link modal ----------------------------------------------------------

  function openLinkModal(selectedText, onInsert) {
    var modal = document.getElementById('linkModal');
    var text = document.getElementById('lmText');
    var url = document.getElementById('lmUrl');
    var picker = document.getElementById('lmVar');
    var modeInputs = modal.querySelectorAll('input[name="lmMode"]');

    text.value = selectedText || '';
    url.value = '';

    // Only URL variables make sense as a link address.
    picker.innerHTML = Data.state.variables.variables
      .filter(function (v) { return v.type === 'url'; })
      .map(function (v) {
        return '<option value="' + e(v.id) + '">' + e(v.question || v.value) + '</option>';
      }).join('');

    function applyMode() {
      var useVar = modal.querySelector('input[name="lmMode"]:checked').value === 'var';
      url.style.display = useVar ? 'none' : 'block';
      picker.style.display = useVar ? 'block' : 'none';
    }
    Array.prototype.forEach.call(modeInputs, function (input) {
      input.checked = input.value === 'url';
      input.onchange = applyMode;
    });
    applyMode();

    document.getElementById('lmInsert').onclick = function () {
      var label = text.value.trim() || 'link';
      var useVar = modal.querySelector('input[name="lmMode"]:checked').value === 'var';
      var html;
      if (useVar && picker.value) {
        var v = Data.variable(picker.value);
        html = '<a href="' + e(v ? v.value : '#') + '" target="_blank" data-var-href="' +
          e(picker.value) + '">' + e(label) + '</a>&nbsp;';
      } else {
        var address = url.value.trim();
        if (!address) return;
        html = '<a href="' + e(address) + '" target="_blank">' + e(label) + '</a>&nbsp;';
      }
      modal.hidden = true;
      onInsert(html);
    };

    document.getElementById('lmCancel').onclick = function () { modal.hidden = true; };
    modal.hidden = false;
    (text.value ? url : text).focus();
  }

  global.RichText = { mount: mount, flush: flush };
}(window));
