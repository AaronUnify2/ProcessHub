/* ===========================================================================
   merge.js — combining a local draft with published files that moved on.

   Works one item at a time: a process, an article, an FAQ question, a
   variable, a department, a rule or a publish tab. For each item there are up
   to three copies — yours, the published one, and the base both started from.

     changed only by you          yours is kept
     changed only in published    the published copy is taken
     changed on both sides        a conflict, and you choose

   Drafts saved by older versions of the app have no base, so every
   difference is shown as a conflict with yours chosen by default. Nothing is
   lost either way: it is simply less automatic.
   =========================================================================== */

(function (global) {
  'use strict';

  var COLLECTIONS = [
    { file: 'processes', key: 'processes', kind: 'Process', label: function (x) { return x.name; } },
    { file: 'processes', key: 'taxonomy', kind: 'Department', label: function (x) { return x.name; } },
    { file: 'processes', key: 'rules', kind: 'Rule', label: function (x) { return x.name; } },
    { file: 'library', key: 'articles', kind: 'Article', label: function (x) { return x.title; } },
    { file: 'library', key: 'faqs', kind: 'FAQ', label: function (x) { return x.q; } },
    { file: 'library', key: 'publishTabs', kind: 'Publish tab', label: function (x) { return x.label; } },
    { file: 'variables', key: 'variables', kind: 'Variable', label: function (x) { return x.value; } }
  ];

  /** JSON with keys sorted, so two copies compare equal whatever their key order. */
  function stable(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stable(value[k]);
    }).join(',') + '}';
  }

  function same(a, b) { return stable(a) === stable(b); }

  function byId(list) {
    var out = {};
    (list || []).forEach(function (item) { out[item.id] = item; });
    return out;
  }

  function listOf(data, c) {
    return (data && data[c.file] && data[c.file][c.key]) || [];
  }

  /** The top-level fields that differ between two copies of one item. */
  function differingFields(a, b) {
    if (!a || !b) return [];
    var keys = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = true; });
    return Object.keys(keys).filter(function (k) { return !same(a[k], b[k]); });
  }

  function describe(mine, live, base) {
    if (!mine && live) return base ? 'you deleted it; published changed it' : 'only in published';
    if (mine && !live) return base ? 'published deleted it; you changed it' : 'only in your draft';
    if (!base) return 'different on each side';
    return 'changed on both sides';
  }

  /**
   * Work out what a merge would do.
   * Returns { hasBase, clean: [...], conflicts: [...] }, where each entry is
   * { c, id, label, take: 'mine' | 'live', mine, live, base, fields, note }.
   */
  function plan(mine, live, base) {
    var out = { hasBase: !!base, clean: [], conflicts: [] };

    COLLECTIONS.forEach(function (c) {
      var m = byId(listOf(mine, c));
      var l = byId(listOf(live, c));
      var b = base ? byId(listOf(base, c)) : null;

      var ids = {};
      [m, l, b || {}].forEach(function (map) {
        Object.keys(map).forEach(function (id) { ids[id] = true; });
      });

      Object.keys(ids).forEach(function (id) {
        var mi = m[id], li = l[id], bi = b ? b[id] : undefined;
        if (same(mi, li)) return;

        var label = c.label(mi || li || bi) || id;
        var entry = {
          c: c, id: id, label: label, mine: mi, live: li, base: bi,
          fields: differingFields(mi, li)
        };

        if (b && same(mi, bi)) {
          entry.take = 'live';
          entry.note = !li ? 'deleted in published' : (!bi ? 'added in published' : 'updated in published');
          out.clean.push(entry);
        } else if (b && same(li, bi)) {
          entry.take = 'mine';
          entry.note = !mi ? 'you deleted it' : (!bi ? 'you added it' : 'you changed it');
          out.clean.push(entry);
        } else {
          entry.take = 'mine';
          entry.note = describe(mi, li, bi);
          out.conflicts.push(entry);
        }
      });
    });

    return out;
  }

  /**
   * Build the merged content. choices maps "<collection key>:<id>" to 'mine'
   * or 'live' for each conflict; clean entries follow their own decision.
   * Version numbers come from the published files, so the next export
   * numbers itself above them.
   */
  function apply(mine, live, result, choices) {
    var merged = Storage.clone(mine);
    var decisions = {};

    result.clean.concat(result.conflicts).forEach(function (entry) {
      var key = entry.c.key + ':' + entry.id;
      var take = (choices && choices[key]) || entry.take;
      (decisions[entry.c.key] = decisions[entry.c.key] || []).push({ entry: entry, take: take });
    });

    COLLECTIONS.forEach(function (c) {
      var list = decisions[c.key];
      if (!list) return;
      var target = merged[c.file][c.key] = merged[c.file][c.key] || [];

      list.forEach(function (d) {
        if (d.take !== 'live') return;
        var at = target.findIndex(function (item) { return item.id === d.entry.id; });
        var incoming = d.entry.live ? Storage.clone(d.entry.live) : null;
        if (at !== -1 && incoming) target[at] = incoming;
        else if (at !== -1) target.splice(at, 1);
        else if (incoming) target.push(incoming);
      });
    });

    return Storage.adoptVersions(merged, live);
  }

  global.Merge = {
    COLLECTIONS: COLLECTIONS,
    plan: plan,
    apply: apply,
    same: same
  };
}(window));
