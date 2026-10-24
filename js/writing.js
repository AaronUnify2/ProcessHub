/* ===========================================================================
   writing.js — the writing check.

   A few plain checks on public wording, run as you type in the FAQ and fact
   sheet editors, and across all the content on the Rules tab.

   Three are built in (rules.js) — switched on or off on the Rules tab, with
   one setting each, but not changed or deleted:
     passive   "Who does this?" — an instruction like "the form must be
               completed" that leaves the reader asking who has to do it
     long      a sentence longer than a set number of words
     nextstep  an FAQ answer that never tells the reader what to do next

   Every text rule (text that should no longer appear) that applies to FAQ
   answers or fact sheets is flagged here too, with what to say instead, so
   a retired name is caught while it is being typed, not after.

   Everything here only flags. Nothing changes the text.

   The checks read the text a reader sees, block by block — paragraphs, list
   items, table cells, headings — so a sentence never runs across a heading
   or a list. A variable counts as its value.
   =========================================================================== */

(function (global) {
  'use strict';

  var KINDS = ['passive', 'long', 'nextstep'];
  var SCOPES = ['faq', 'factsheet'];

  function isWriting(rule) { return KINDS.indexOf(rule && rule.kind) !== -1; }

  // ---- reading the text ----------------------------------------------------

  var BLOCK = /^(P|LI|H1|H2|H3|H4|H5|H6|TD|TH|DT|DD|BLOCKQUOTE|DIV|SECTION|ARTICLE|UL|OL|TABLE|TR)$/;

  /** The nearest block that holds a text node, inside root. */
  function blockOf(node, root) {
    var at = node.parentNode;
    while (at && at !== root) {
      if (at.nodeType === 1 && BLOCK.test(at.tagName)) return at;
      at = at.parentNode;
    }
    return root;
  }

  /**
   * The text of each block, with whitespace collapsed the way a reader sees
   * it, and a map from each character back to the text node it came from —
   * so a flag can be turned into a selection in the editor.
   */
  function blocksOf(root) {
    var blocks = [];
    var current = null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var textNode;
    while ((textNode = walker.nextNode())) {
      var block = blockOf(textNode, root);
      if (!current || current.el !== block) {
        current = { el: block, text: '', map: [] };
        blocks.push(current);
      }
      var value = textNode.nodeValue;
      for (var i = 0; i < value.length; i++) {
        var ch = value.charAt(i);
        var space = /\s/.test(ch);
        if (space && (!current.text || current.text.charAt(current.text.length - 1) === ' ')) continue;
        current.text += space ? ' ' : ch;
        current.map.push({ node: textNode, offset: i });
      }
    }
    return blocks.filter(function (b) { return b.text.trim(); });
  }

  // Full stops that do not end a sentence.
  var ABBREVIATIONS = /\b(e\.g|i\.e|etc|approx|incl|excl|no|st|dr|mt|vs|cf|ph)\.$/i;

  /** Sentences within a block, as [start, end) offsets into its text. */
  function sentencesOf(text) {
    var out = [];
    var start = 0;
    var pattern = /[.!?]+["”’')\]]*(?=\s|$)/g;
    var m;
    while ((m = pattern.exec(text))) {
      var end = m.index + m[0].length;
      if (m[0].charAt(0) === '.' && ABBREVIATIONS.test(text.slice(Math.max(0, m.index - 8), m.index + 1))) {
        continue;
      }
      push(start, end);
      start = end;
    }
    push(start, text.length);

    function push(from, to) {
      while (from < to && text.charAt(from) === ' ') from++;
      if (from < to && text.slice(from, to).trim()) out.push({ start: from, end: to });
    }
    return out;
  }

  // ---- the checks ----------------------------------------------------------

  // Who has to do it? These are the shapes that hide it.
  var MODAL = '(?:must|should|needs? to|has to|have to|is to|are to)';
  var BETWEEN = '(?:\\s+(?:not|also|then|only|still|first|always|then))?';
  var IRREGULAR = ['paid', 'sent', 'made', 'done', 'given', 'taken', 'kept', 'shown', 'held',
    'set', 'put', 'built', 'found', 'met', 'brought', 'bought', 'left', 'told', 'written',
    'seen', 'chosen', 'spent', 'drawn', 'laid', 'run', 'read', 'sold', 'shut', 'cut'];
  // Words ending in -ed that are not verbs. Rural land has a lot of sheds.
  var NOT_PARTICIPLES = ['need', 'shed', 'seed', 'weed', 'feed', 'speed', 'bed', 'red', 'hundred',
    'sacred', 'naked', 'wicked'];
  var PASSIVE = new RegExp('\\b' + MODAL + BETWEEN + '\\s+be\\s+([a-z]+ed|' + IRREGULAR.join('|') + ')\\b', 'gi');

  function words(text) { return (text.match(/\S+/g) || []).length; }

  function listOf(value) {
    return String(value || '').split(',').map(function (s) { return s.trim().toLowerCase(); })
      .filter(Boolean);
  }

  /** The flags one rule raises in one block, as [start, end) offsets. */
  function flagsIn(rule, block) {
    var out = [];
    var text = block.text;

    if (rule.kind === 'long') {
      var limit = Number(rule.words) || 25;
      sentencesOf(text).forEach(function (s) {
        var n = words(text.slice(s.start, s.end));
        if (n > limit) out.push({ start: s.start, end: s.end, sentence: s, note: n + ' words' });
      });
    }

    if (rule.kind === 'passive') {
      var allowed = listOf(rule.allow);
      sentencesOf(text).forEach(function (s) {
        var sentence = text.slice(s.start, s.end);
        var m;
        PASSIVE.lastIndex = 0;
        while ((m = PASSIVE.exec(sentence))) {
          var participle = m[1].toLowerCase();
          if (NOT_PARTICIPLES.indexOf(participle) !== -1) continue;
          if (allowed.indexOf(participle) !== -1 || allowed.indexOf(m[0].toLowerCase()) !== -1) continue;
          // "…must be approved by Council" already says who.
          if (/\bby\b/i.test(sentence.slice(m.index + m[0].length))) continue;
          out.push({ start: s.start + m.index, end: s.start + m.index + m[0].length, sentence: s });
        }
      });
    }

    if (rule.kind === 'text') {
      var matcher = global.Rules ? Rules.matcherFor(rule) : null;
      if (matcher && !matcher.invalid) {
        var re = new RegExp(matcher.source, matcher.flags.indexOf('g') === -1 ? matcher.flags + 'g' : matcher.flags);
        var hit;
        while ((hit = re.exec(text))) {
          if (!hit[0]) { re.lastIndex++; continue; }
          var within = sentencesOf(text).find(function (s) { return hit.index >= s.start && hit.index < s.end; });
          out.push({ start: hit.index, end: hit.index + hit[0].length, sentence: within || { start: 0, end: text.length } });
        }
      }
    }
    return out;
  }

  /**
   * An answer has a next step when it gives the reader somewhere to go:
   * a link, a phone number or email address, or another answer to read
   * ("see <em>…</em>").
   */
  function hasNextStep(root) {
    if (root.querySelector('a[href], [data-var-href], [data-var^="var_phone"], [data-var^="var_email"]')) {
      return true;
    }
    return Array.prototype.some.call(root.querySelectorAll('em'), function (em) {
      var before = em.previousSibling;
      return before && before.nodeType === 3 && /\bsee\s*$/i.test(before.nodeValue);
    });
  }

  /** The rules the editor checks for a scope: the writing rules, and text rules. */
  function rulesFor(scope) {
    if (!global.Rules) return [];
    return Rules.list().filter(function (rule) {
      if (rule.enabled === false) return false;
      if (!isWriting(rule) && rule.kind !== 'text') return false;
      // A text rule with no scope set applies everywhere.
      var scopes = rule.scope && rule.scope.length ? rule.scope
        : (rule.kind === 'text' ? Rules.SCOPES : SCOPES);
      return scopes.indexOf(scope) !== -1;
    });
  }

  /** Every flag for a piece of content, in reading order. */
  function check(root, scope, rules) {
    var flags = [];
    var blocks = blocksOf(root);
    rules.forEach(function (rule) {
      if (rule.kind === 'nextstep') {
        if (scope === 'faq' && blocks.length && !hasNextStep(root)) {
          flags.push({ rule: rule, block: null, start: 0, end: 0, order: Infinity,
            excerpt: 'The answer never says what to do next.', phrase: '' });
        }
        return;
      }
      blocks.forEach(function (block, b) {
        flagsIn(rule, block).forEach(function (hit) {
          flags.push({
            rule: rule, block: block, start: hit.start, end: hit.end,
            order: b * 100000 + hit.start,
            sentenceText: block.text.slice(hit.sentence.start, hit.sentence.end),
            before: block.text.slice(hit.sentence.start, hit.start),
            phrase: block.text.slice(hit.start, hit.end),
            after: block.text.slice(hit.end, hit.sentence.end),
            note: hit.note || ''
          });
        });
      });
    });
    return flags.sort(function (a, b) { return a.order - b.order; });
  }

  /** Parse stored markup into a detached element, variables shown as values. */
  function detached(html) {
    var holder = document.createElement('div');
    holder.innerHTML = Data.resolveHtml(html || '');
    return holder;
  }

  /**
   * For the Rules tab: what one writing rule finds in one item, or null.
   * Used by Rules.evaluate, so writing findings list and link like any other.
   */
  function findingFor(rule, scope, html) {
    var flags = check(detached(html), scope, [rule]);
    if (!flags.length) return null;
    var first = flags[0];
    var sample = first.block
      ? trim(first.sentenceText, 140)
      : first.excerpt;
    return { count: flags.length, detail: (flags.length > 1 ? flags.length + ' — ' : '') + sample };
  }

  function trim(text, max) {
    text = String(text || '').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  // ---- the panel under the editor -------------------------------------------

  // Dismissed flags, for this visit only: a rule decides what is flagged; a
  // dismissal just says "I've seen this one".
  var dismissed = {};

  function keyOf(flag) { return flag.rule.id + '|' + (flag.sentenceText || flag.excerpt); }

  function e(text) { return Data.escapeHtml(text); }

  /**
   * Attach a writing check under an editor.
   *   host      the element to put the panel in
   *   area      the editable element (selected into when a flag is clicked)
   *   source    returns the current markup, for when the HTML view is showing
   *   scope     'faq' or 'factsheet'
   */
  function panel(host, area, source, scope) {
    var box = document.createElement('div');
    box.className = 'wc';
    host.appendChild(box);
    var flags = [];
    var timer = null;

    function editing() { return area.offsetParent !== null; }

    function run() {
      var rules = rulesFor(scope);
      var root = editing() ? area : detached(source());
      flags = check(root, scope, rules).filter(function (f) { return !dismissed[keyOf(f)]; });
      draw(rules.length);
    }

    function draw(ruleCount) {
      var head = '<div class="wc-head"><span class="wc-title">Writing check</span>' +
        '<span class="wc-count' + (flags.length ? '' : ' clear') + '">' +
        (flags.length ? flags.length + ' to look at' : 'nothing flagged') +
        '</span><a class="wc-rules" href="#/rules">' + ruleCount + ' rule' +
        (ruleCount === 1 ? '' : 's') + ' checked →</a></div>';
      if (!ruleCount) {
        box.innerHTML = head + '<p class="wc-empty">No rules that check wording are switched on. ' +
          'Add them on the <a href="#/rules">Rules tab</a>.</p>';
        return;
      }
      box.innerHTML = head + flags.map(function (flag, i) {
        var rule = flag.rule;
        var text = flag.block
          ? e(trimStart(flag.before, 60)) + '<mark>' + e(flag.phrase) + '</mark>' +
            e(trimEnd(flag.after, 80))
          : e(flag.excerpt);
        var tip = rule.message || '';
        if (rule.kind === 'text' && rule.suggest) tip = 'Use “' + rule.suggest + '” instead. ' + tip;
        return '<div class="wc-row sev-' + e(rule.severity || 'low') + '">' +
          '<button type="button" class="wc-show" data-i="' + i + '"' + (flag.block ? '' : ' disabled') + '>' +
          '<span class="wc-rule">' + e(rule.name) + (flag.note ? ' · ' + e(flag.note) : '') + '</span>' +
          '<span class="wc-text">' + text + '</span>' +
          (tip ? '<span class="wc-tip">' + e(tip.trim()) + '</span>' : '') +
          '</button>' +
          '<button type="button" class="wc-dismiss" data-i="' + i + '" title="Dismiss for now">×</button>' +
          '</div>';
      }).join('');
    }

    function trimEnd(text, max) {
      return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    function trimStart(text, max) {
      return text.length > max ? '…' + text.slice(text.length - max + 1) : text;
    }

    box.addEventListener('mousedown', function (ev) {
      // Keep the editor's caret where it is when a button here is pressed.
      if (ev.target.closest('button')) ev.preventDefault();
    });
    box.addEventListener('click', function (ev) {
      var show = ev.target.closest('.wc-show');
      var drop = ev.target.closest('.wc-dismiss');
      if (drop) {
        dismissed[keyOf(flags[Number(drop.dataset.i)])] = true;
        run();
        return;
      }
      if (show && editing()) select(flags[Number(show.dataset.i)]);
    });

    /** Select the flagged words in the editor, and bring them into view. */
    function select(flag) {
      if (!flag || !flag.block) return;
      var map = flag.block.map;
      var from = map[flag.start];
      var to = map[Math.max(flag.start, flag.end - 1)];
      if (!from || !to || !area.contains(from.node) || !area.contains(to.node)) { run(); return; }
      var range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset + 1);
      area.focus();
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      var el = flag.block.el && flag.block.el.nodeType === 1 ? flag.block.el : area;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(run, 400);
    }

    run();
    return { refresh: refresh, run: run };
  }

  global.Writing = {
    KINDS: KINDS,
    SCOPES: SCOPES,
    isWriting: isWriting,
    check: check,
    findingFor: findingFor,
    panel: panel,
    // exposed for testing
    sentencesOf: sentencesOf,
    blocksOf: blocksOf
  };
}(window));
