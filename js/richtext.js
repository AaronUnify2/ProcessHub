/* ===========================================================================
   richtext.js — the prose editor for fact sheets and FAQ answers, carried
   over from the FAQ Editor.

   A toolbar over a contenteditable area, a raw HTML toggle for when the markup
   needs a hand, and a live preview underneath styled like the published page —
   because a public FAQ answer should be judged as it will appear, not as
   markup.

   Variables sit in the text as chips the caret cannot enter, so a reference
   can be deleted whole but never half-edited into nonsense.
   =========================================================================== */

(function (global) {
  'use strict';

  // Every editor on the current page. A page can hold more than one (a tab's
  // intro and footer), and each must be flushed before the page is redrawn.
  var actives = [];

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
   * opts.previewFrame classes on the preview's outer box (default faq-preview)
   * opts.previewLabel the words over the preview
   * opts.preview      false leaves the preview out altogether
   * opts.document     true adds what a longer document needs: headings and
   *                   a checklist (a list ticked off item by item)
   * opts.check        'faq' or 'factsheet' puts the writing check under the
   *                   editor, run with the writing rules for that kind
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

    // Taken before focusing: when a dialog (the variable picker, the link
    // builder) had the focus, focusing the area fires its focus listener,
    // which would record wherever the browser put the caret — the start —
    // over the position saved before the dialog opened.
    function restoreSelection() {
      var range = savedRange;
      area.focus();
      var selection = window.getSelection();
      selection.removeAllRanges();
      if (range && area.contains(range.commonAncestorContainer)) {
        selection.addRange(range);
        savedRange = range;
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
    toolbar.appendChild(button('¶', 'Paragraph', function () { exec('formatBlock', '<p>'); sync(); }));
    if (opts.document) {
      toolbar.appendChild(button('H2', 'Section heading', function () { exec('formatBlock', '<h2>'); sync(); }));
      toolbar.appendChild(button('H3', 'Sub-heading', function () { exec('formatBlock', '<h3>'); sync(); }));
    }
    toolbar.appendChild(button('• List', 'Bullet list', function () { exec('insertUnorderedList'); sync(); }));
    toolbar.appendChild(button('1. List', 'Numbered list', function () { exec('insertOrderedList'); sync(); }));
    if (opts.document) {
      toolbar.appendChild(button('☐ List', 'Checklist — a box to tick beside each item', function () {
        toggleChecklist(); sync();
      }));
    }
    /**
     * A checklist is an ordinary bullet list with the class "checklist", so
     * it survives anything that understands lists — Word included — and
     * only the styling draws the boxes. Pressed inside a checklist it turns
     * back into plain bullets.
     */
    function listAtCaret() {
      var selection = window.getSelection();
      var at = selection && selection.anchorNode;
      while (at && at !== area) {
        if (at.nodeType === 1 && (at.tagName === 'UL' || at.tagName === 'OL')) return at;
        at = at.parentNode;
      }
      return null;
    }

    function toggleChecklist() {
      restoreSelection();
      var list = listAtCaret();
      if (list && list.tagName === 'UL') {
        list.classList.toggle('checklist');
        if (!list.className) list.removeAttribute('class');
      } else {
        try { document.execCommand('insertUnorderedList', false, null); } catch (err) { /* ignore */ }
        list = listAtCaret();
        if (list && list.tagName === 'UL') list.classList.add('checklist');
      }
      rememberSelection();
    }

    toolbar.appendChild(separator());
    // An email link already in the text is edited in the same box: click
    // into it, then press Link. The caret cannot rest inside a chip, so the
    // last link clicked counts as well as the one around the caret.
    var clickedLink = null;
    area.addEventListener('click', function (ev) {
      var link = ev.target.closest ? ev.target.closest('a') : null;
      clickedLink = link && area.contains(link) ? link : null;
    });
    area.addEventListener('keydown', function () { clickedLink = null; });

    function isEmailLink(at) {
      return at && at.nodeType === 1 && at.tagName === 'A' &&
        /^mailto:/i.test(at.getAttribute('href') || '');
    }

    function emailLinkAtCaret() {
      if (isEmailLink(clickedLink) && area.contains(clickedLink)) return clickedLink;
      var at = savedRange ? savedRange.startContainer : null;
      while (at && at !== area) {
        if (isEmailLink(at)) return at;
        at = at.parentNode;
      }
      return null;
    }

    /** Put new markup where an existing link was. */
    function replaceLink(link, html) {
      var holder = document.createElement('div');
      holder.innerHTML = html;
      var parent = link.parentNode;
      while (holder.firstChild) parent.insertBefore(holder.firstChild, link);
      parent.removeChild(link);
      clickedLink = null;
      savedRange = null;
      sync();
    }

    toolbar.appendChild(button('🔗 Link', 'Insert a link — or click into an email link first to edit it', function () {
      var link = emailLinkAtCaret();
      if (link) {
        openLinkModal('', null, {
          link: link,
          onReplace: function (html) { replaceLink(link, html); }
        });
      } else {
        openLinkModal(selectionText(), insertHtml);
      }
    }));
    toolbar.appendChild(button('＋Var', 'Insert a reusable value (fee, URL, phone…)', function () {
      openVariablePicker(function (v) {
        // Through editableHtml, so the new reference is a chip like the rest
        // from the moment it lands: highlighted, dotted while unverified,
        // and closed to the caret.
        insertHtml(Data.editableHtml('<span class="faq-var" data-var="' + e(v.id) + '">' +
          e(v.value) + '</span>') + '&nbsp;');
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
      if (writingCheck) writingCheck.refresh();
    });
    toolbar.appendChild(srcToggle);

    // ---- preview ----------------------------------------------------------

    var previewWrap = node('div', 'preview-wrap');
    previewWrap.appendChild(node('div', 'preview-label',
      e(opts.previewLabel || 'Live preview — how it looks on the page')));
    var previewBody = node('div', 'preview-body');
    var preview = node('div', opts.previewFrame || 'faq-preview');
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
    // Only a real edit is saved. Loading content into the editor tidies its
    // markup slightly; committing on every blur would record that tidying as
    // a change to something nobody touched, and publish it.
    var edited = false;

    var writingCheck = null;

    function sync() {
      edited = true;
      updatePreview();
      if (writingCheck) writingCheck.refresh();
      clearTimeout(timer);
      timer = setTimeout(commit, 500);
    }

    function commit() {
      clearTimeout(timer);
      if (!edited) return;
      edited = false;
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
    if (opts.check && global.Writing) {
      writingCheck = Writing.panel(host, area, rawHtml, opts.check);
    }
    if (opts.preview !== false) host.appendChild(previewWrap);
    updatePreview();

    var instance = { commit: commit, setHeader: setHeader };
    actives.push(instance);
    return instance;
  }

  /** Flush any pending edit — call before navigating away. */
  function flush() {
    var list = actives;
    actives = [];
    list.forEach(function (instance) { instance.commit(); });
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

  // Some email apps cut off a link much longer than this, losing the end of
  // the message.
  var LONG_MAILTO = 1800;

  /** Public email variables: an internal address must never reach the page. */
  function emailVariables() {
    return Data.state.variables.variables.filter(function (v) {
      return v.type === 'email' && !v.internal;
    });
  }

  /**
   * The email variable an existing link sends to: the one it is tied to, else
   * one whose value is its address, else the one shown as its text.
   */
  function emailVariableOf(link) {
    var tied = Data.variable(link.getAttribute('data-var-mailto'));
    if (tied) return tied;
    var address = Data.mailtoParts(link.getAttribute('href')).address.toLowerCase();
    var list = emailVariables();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].value).trim().toLowerCase() === address) return list[i];
    }
    var chip = link.querySelector('[data-var]');
    var shown = chip ? Data.variable(chip.getAttribute('data-var')) : null;
    return shown && shown.type === 'email' ? shown : null;
  }

  /** True when a link shows nothing but its own address, as a variable. */
  function showsOnlyAddress(link) {
    var chips = link.querySelectorAll('[data-var]');
    if (chips.length !== 1) return false;
    var v = Data.variable(chips[0].getAttribute('data-var'));
    return !!v && v.type === 'email' && link.textContent.trim() === chips[0].textContent.trim();
  }

  /**
   * selectedText  the text selected when the box opened, as the link text
   * onInsert      called with the new link's markup
   * editing       { link, onReplace } to edit an email link already in the text
   */
  function openLinkModal(selectedText, onInsert, editing) {
    var modal = document.getElementById('linkModal');
    var title = document.getElementById('lmTitle');
    var text = document.getElementById('lmText');
    var url = document.getElementById('lmUrl');
    var picker = document.getElementById('lmVar');
    var emailBox = document.getElementById('lmEmail');
    var emailPicker = document.getElementById('lmEmailVar');
    var subject = document.getElementById('lmSubject');
    var body = document.getElementById('lmBody');
    var hint = document.getElementById('lmEmailHint');
    var insert = document.getElementById('lmInsert');
    var modeInputs = modal.querySelectorAll('input[name="lmMode"]');

    text.value = selectedText || '';
    url.value = '';
    subject.value = '';
    body.value = '';

    // Only URL variables make sense as a link address.
    picker.innerHTML = Data.state.variables.variables
      .filter(function (v) { return v.type === 'url'; })
      .map(function (v) {
        return '<option value="' + e(v.id) + '">' + e(v.question || v.value) + '</option>';
      }).join('');

    var emails = emailVariables();
    emailPicker.innerHTML = emails.length
      ? emails.map(function (v) {
        return '<option value="' + e(v.id) + '">' + e(v.value) + '</option>';
      }).join('')
      : '<option value="">No public email variables yet</option>';

    var mode = 'url';
    if (editing) {
      var parts = Data.mailtoParts(editing.link.getAttribute('href'));
      var v = emailVariableOf(editing.link);
      if (v) emailPicker.value = v.id;
      subject.value = parts.subject;
      body.value = parts.body;
      text.value = showsOnlyAddress(editing.link) ? '' : editing.link.textContent.trim();
      mode = 'email';
    }
    title.textContent = editing ? 'Edit email link' : 'Insert link';
    insert.textContent = editing ? 'Update link' : 'Insert link';

    function currentMode() {
      return modal.querySelector('input[name="lmMode"]:checked').value;
    }

    function emailHref() {
      var v = Data.variable(emailPicker.value);
      if (!v) return '';
      return Data.mailtoHref(v.value, subject.value.trim(), body.value.replace(/\s+$/, ''));
    }

    function updateHint() {
      var href = emailHref();
      if (!href) {
        hint.className = 'lm-hint warn';
        hint.textContent = 'Add the address as an email variable first, so a change to it is one edit.';
        return;
      }
      var long = href.length > LONG_MAILTO;
      hint.className = 'lm-hint' + (long ? ' warn' : '');
      hint.innerHTML = (long
        ? 'This message is long. Some email apps cut off long links, so keep it shorter. '
        : 'Opens the reader’s email app with this subject and message, ready to fill in and send. ') +
        '<a href="' + e(href) + '">Try it</a>';
    }

    function applyMode() {
      mode = currentMode();
      url.style.display = mode === 'url' ? 'block' : 'none';
      picker.style.display = mode === 'var' ? 'block' : 'none';
      emailBox.hidden = mode !== 'email';
      text.placeholder = mode === 'email' ? 'Leave blank to show the email address' : 'Text to show';
      if (mode === 'email') updateHint();
    }
    Array.prototype.forEach.call(modeInputs, function (input) {
      input.checked = input.value === mode;
      // Editing changes an email link; it does not turn it into another kind.
      input.disabled = !!editing && input.value !== 'email';
      input.onchange = applyMode;
    });
    emailPicker.onchange = updateHint;
    subject.oninput = updateHint;
    body.oninput = updateHint;
    applyMode();

    insert.onclick = function () {
      var label = text.value.trim();
      var html;
      if (mode === 'email') {
        var v = Data.variable(emailPicker.value);
        if (!v) return;
        // With no link text the link shows the address itself, as a
        // variable, so the text and the address change together.
        var inner = label ? e(label)
          : '<span class="faq-var" data-var="' + e(v.id) + '">' + e(v.value) + '</span>';
        html = Data.editableHtml('<a href="' + e(emailHref()) + '" data-var-mailto="' +
          e(v.id) + '">' + inner + '</a>');
        modal.hidden = true;
        if (editing) editing.onReplace(html);
        else onInsert(html + '&nbsp;');
        return;
      }
      label = label || 'link';
      if (mode === 'var' && picker.value) {
        var target = Data.variable(picker.value);
        html = '<a href="' + e(target ? target.value : '#') + '" target="_blank" data-var-href="' +
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
    if (editing) subject.focus();
    else (text.value ? url : text).focus();
  }

  global.RichText = { mount: mount, flush: flush };
}(window));
