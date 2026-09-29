/* ===========================================================================
   faq.js — the order of FAQ questions and their section headings.

   How the data holds it: each question carries publish.tabId (which tab it
   is published under), publish.order (its place in that tab) and
   publish.groupTitle (the section heading it sits under — every question in
   a section carries the heading, not just the first). The export writes a
   heading row wherever groupTitle changes.

   How the sidebar shows it: a flat list per tab of heading rows and question
   rows, exactly as the public page lays them out — which is also how the old
   FAQ Editor worked. A heading row is dragged like any other row.

   The two meet here. rows() turns the data into the list; apply() turns an
   edited list back into data: every question takes the nearest heading above
   it, and orders are renumbered 1, 2, 3… Rows in, rows out, so the published
   FAQ.json comes out exactly as the list reads.

   A heading with no question under it cannot be stored — headings live on
   questions — so a freshly added heading is held here, in memory, until a
   question is moved under it.
   =========================================================================== */

(function (global) {
  'use strict';

  var UNPUBLISHED = '';   // the "Not published" group's key
  var pending = {};       // tabId → [{ title, before }] headings with no question yet

  function lib() { return Data.state.library; }

  function publishOf(f) {
    f.publish = f.publish || { tabId: null, order: 0, groupTitle: null };
    return f.publish;
  }

  function tabKey(f) { return (f.publish && f.publish.tabId) || UNPUBLISHED; }

  /** The questions in one tab, in published order. */
  function questionsIn(tabId) {
    return lib().faqs.filter(function (f) { return tabKey(f) === (tabId || UNPUBLISHED); })
      .sort(function (a, b) {
        return (Number(publishOf(a).order) || 0) - (Number(publishOf(b).order) || 0);
      });
  }

  /**
   * The rows for one tab: { type: 'group', title } and { type: 'faq', faq }.
   * Mirrors the export exactly — a heading appears wherever the heading
   * changes to something that is not blank.
   */
  function rows(tabId) {
    var out = [];
    var current = null;
    questionsIn(tabId).forEach(function (f) {
      var title = publishOf(f).groupTitle || null;
      if (tabId && title && title !== current) out.push({ type: 'group', title: title });
      if (title) current = title;
      out.push({ type: 'faq', faq: f });
    });

    // Headings added but not yet holding a question, at the place they were
    // added (before a given question, or at the end).
    (pending[tabId || UNPUBLISHED] || []).forEach(function (p) {
      var at = p.before
        ? out.findIndex(function (r) { return r.type === 'faq' && r.faq.id === p.before; })
        : -1;
      var row = { type: 'group', title: p.title, pending: true };
      if (at === -1) { out.push(row); return; }
      // Above that question's own heading, if it has one directly above it.
      while (at > 0 && out[at - 1].type === 'group' && !out[at - 1].pending) at--;
      out.splice(at, 0, row);
    });
    return out;
  }

  /**
   * Write a tab's rows back into the data. Returns true if anything changed.
   * Headings left with no question below them are kept as pending.
   */
  function apply(tabId, list) {
    var changed = false;
    var heading = null;
    var order = 0;
    var keep = [];

    list.forEach(function (row, i) {
      if (row.type === 'group') {
        heading = row.title;
        // A heading with no question before the next heading (or the end)
        // has nothing to live on yet.
        var next = list[i + 1];
        if (!next || next.type === 'group') {
          var after = list.slice(i + 1).find(function (r) { return r.type === 'faq'; });
          keep.push({ title: row.title, before: after ? after.faq.id : null });
        }
        return;
      }
      var p = publishOf(row.faq);
      var tab = tabId || null;
      var group = tabId ? heading : null;
      order++;
      if (p.tabId !== tab) { p.tabId = tab; changed = true; }
      if (Number(p.order) !== order) { p.order = order; changed = true; }
      if ((p.groupTitle || null) !== group) { p.groupTitle = group; changed = true; }
    });

    pending[tabId || UNPUBLISHED] = tabId ? keep : [];
    return changed;
  }

  /**
   * Move a row. from and to are { tab, index }; to.index is the position the
   * row should end up at in the destination list (after removal, if the two
   * lists are the same). Returns true if the data changed.
   */
  function move(from, to) {
    var source = rows(from.tab);
    var row = source[from.index];
    if (!row) return false;

    // A heading cannot go to "Not published", which has no sections.
    if (row.type === 'group' && !to.tab) return false;

    source.splice(from.index, 1);
    var sameTab = (from.tab || UNPUBLISHED) === (to.tab || UNPUBLISHED);
    var target = sameTab ? source : rows(to.tab);
    var at = Math.max(0, Math.min(target.length, to.index));
    target.splice(at, 0, row);

    var changed = false;
    if (!sameTab) changed = apply(from.tab, source) || changed;
    changed = apply(to.tab, target) || changed;
    if (changed) Edit.touch();
    return changed;
  }

  /** Move a row one place up or down within its tab. */
  function nudge(tabId, index, direction) {
    return move({ tab: tabId, index: index }, { tab: tabId, index: index + direction });
  }

  /** The row index of a question within its tab. */
  function indexOf(faqId) {
    var f = lib().faqs.find(function (x) { return x.id === faqId; });
    if (!f) return null;
    var tab = tabKey(f);
    var list = rows(tab);
    return {
      tab: tab,
      index: list.findIndex(function (r) { return r.type === 'faq' && r.faq.id === faqId; })
    };
  }

  /** Put a question at the end of a tab (or "Not published", tabId ''). */
  function moveToTab(faqId, tabId) {
    var at = indexOf(faqId);
    if (!at || at.index === -1) return false;
    if ((at.tab || UNPUBLISHED) === (tabId || UNPUBLISHED)) return false;
    return move(at, { tab: tabId, index: rows(tabId).length });
  }

  /** A new heading at the end of a tab, held until a question sits under it. */
  function addHeading(tabId, title) {
    if (!tabId || !title) return;
    (pending[tabId] = pending[tabId] || []).push({ title: title, before: null });
  }

  /** Rename the heading at a row: every question in that section follows. */
  function renameHeading(tabId, index, title) {
    var list = rows(tabId);
    if (!list[index] || list[index].type !== 'group' || !title) return false;
    list[index] = { type: 'group', title: title };
    var changed = apply(tabId, list);
    if (changed) Edit.touch();
    return changed;
  }

  /** Remove a heading: its questions join the section above. */
  function deleteHeading(tabId, index) {
    var list = rows(tabId);
    if (!list[index] || list[index].type !== 'group') return false;
    list.splice(index, 1);
    var changed = apply(tabId, list);
    if (changed) Edit.touch();
    return true;
  }

  /** Add a question to a tab (or "Not published"), last in the list. */
  function addQuestion(tabId, question) {
    var id = Edit.createFaq(question);
    var f = lib().faqs.find(function (x) { return x.id === id; });
    var list = rows(tabId);
    publishOf(f).tabId = null;
    // createFaq put it in "Not published"; move it into place.
    var at = indexOf(id);
    move(at, { tab: tabId, index: list.length });
    return id;
  }

  // ---- publish tabs --------------------------------------------------------

  function tab(id) {
    return lib().publishTabs.find(function (t) { return t.id === id; }) || null;
  }

  function createTab(label) {
    var taken = {};
    lib().publishTabs.forEach(function (t) { taken[t.id] = true; });
    // Tab ids appear in public links (FAQ.html#water), so no prefix.
    var id = Data.makeId('', label, taken).replace(/_/g, '-');
    lib().publishTabs.push({
      id: id, label: label, 'new': false, intro: '', footer: '', lastReviewed: '',
      stepperFrom: null, stepper: []
    });
    Edit.touch();
    return id;
  }

  function moveTab(id, direction) {
    var list = lib().publishTabs;
    var at = list.findIndex(function (t) { return t.id === id; });
    var to = at + direction;
    if (at < 0 || to < 0 || to >= list.length) return false;
    list.splice(to, 0, list.splice(at, 1)[0]);
    Edit.touch();
    return true;
  }

  /** Delete a tab; its questions move to "Not published", nothing is lost. */
  function deleteTab(id) {
    var list = rows(id).filter(function (r) { return r.type === 'faq'; });
    var base = questionsIn(UNPUBLISHED).length;
    list.forEach(function (r, i) {
      var p = publishOf(r.faq);
      p.tabId = null;
      p.groupTitle = null;
      p.order = base + i + 1;
    });
    lib().publishTabs = lib().publishTabs.filter(function (t) { return t.id !== id; });
    delete pending[id];
    Edit.touch();
  }

  global.FaqOrder = {
    UNPUBLISHED: UNPUBLISHED,
    rows: rows,
    apply: apply,
    move: move,
    nudge: nudge,
    indexOf: indexOf,
    moveToTab: moveToTab,
    addHeading: addHeading,
    renameHeading: renameHeading,
    deleteHeading: deleteHeading,
    addQuestion: addQuestion,
    questionsIn: questionsIn,
    tab: tab,
    createTab: createTab,
    moveTab: moveTab,
    deleteTab: deleteTab
  };
}(window));
