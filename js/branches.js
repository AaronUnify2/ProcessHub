/* ===========================================================================
   branches.js — a branching process as paths, for the step list.

   The arrows say what follows what. Where a step leads to more than one
   place, the steps after it fall into paths, one per route, until the paths
   meet again or end. This works that shape out so the Steps view can show
   the paths side by side instead of one long list in reading order.

   outline(p) gives a list of items, in the order they happen:

     { step: <step> }
     { fork: <step that branches>,
       paths: [{ conn: <its route>, items: [ …items… ] }],
       meet: <step where the paths meet again, or null if they never do> }

   A path's items can hold forks of their own. A route that goes straight
   to where the paths meet has an empty path.

   Only a shape that reads cleanly as paths is drawn that way. outline gives
   null, and the list stays in reading order, when:
     - nothing branches (the list already is the flow)
     - an arrow loops back to an earlier step
     - there is more than one place to start
     - a step is reached from two paths other than where they meet
     - any step is left out (it has no arrows to place it by)
   Nothing is stored: this is only a way of showing the arrows.

   numbering(p) numbers the steps by that shape, so the numbers read in
   order down the Steps view however the steps are stored:

     1. 2. 3a. 3b. 4. 5a. 6a. 5b. 6b. 5c. 7.

   Steps on the main line count up. Where the paths split, each path gets
   a letter and its steps carry on the count, so the first step on every
   path has the same number: 3a, 3b. A longer path runs on (5a, 6a) while a
   shorter one stops (5c), and the step where they meet takes the next
   number after the longest. A path inside a path adds a digit: 4b1, 4b2.
   Without a clean shape (outline gives null) the steps are numbered 1, 2,
   3 in the order they are stored.
   =========================================================================== */

(function (global) {
  'use strict';

  function outline(p) {
    var steps = (p && p.steps) || [];
    if (!steps.length) return null;

    var byId = {};
    steps.forEach(function (s) { byId[s.id] = s; });

    var outgoing = {};
    var incoming = {};
    var forks = false;
    (p.connections || []).forEach(function (c) {
      if (!byId[c.from] || !byId[c.to] || c.from === c.to) return;
      (outgoing[c.from] = outgoing[c.from] || []).push(c);
      incoming[c.to] = (incoming[c.to] || 0) + 1;
    });
    steps.forEach(function (s) { if ((outgoing[s.id] || []).length > 1) forks = true; });
    if (!forks) return null;

    var starts = steps.filter(function (s) { return !incoming[s.id]; });
    if (starts.length !== 1) return null;

    // An order in which every arrow points forward. If one cannot be found,
    // an arrow loops back.
    var order = {};
    var waiting = {};
    steps.forEach(function (s) { waiting[s.id] = incoming[s.id] || 0; });
    var ready = [starts[0].id];
    var n = 0;
    while (ready.length) {
      var id = ready.shift();
      order[id] = n++;
      (outgoing[id] || []).forEach(function (c) {
        if (--waiting[c.to] === 0) ready.push(c.to);
      });
    }
    if (n !== steps.length) return null;

    /** Every step reachable from a step, not going past `stop`. */
    function reachable(from, stop) {
      var seen = {};
      var queue = [from];
      while (queue.length) {
        var at = queue.shift();
        if (seen[at]) continue;
        seen[at] = true;
        if (at === stop) continue;
        (outgoing[at] || []).forEach(function (c) { queue.push(c.to); });
      }
      return seen;
    }

    /**
     * Where the routes out of a step meet again: the earliest step every
     * route reaches. Null if they never meet before `stop` (or the end).
     */
    function meetingPoint(routes, stop) {
      var sets = routes.map(function (c) { return reachable(c.to, stop); });
      var best = null;
      Object.keys(sets[0]).forEach(function (id) {
        var everywhere = sets.every(function (set) { return set[id]; });
        if (everywhere && (best === null || order[id] < order[best])) best = id;
      });
      return best;
    }

    var placed = {};
    var broken = false;

    /** The items from a step up to (not including) `stop`. */
    function walk(id, stop) {
      var items = [];
      while (id && id !== stop && !broken) {
        if (placed[id]) { broken = true; break; }
        placed[id] = true;
        items.push({ step: byId[id] });

        var routes = outgoing[id] || [];
        if (routes.length === 0) break;
        if (routes.length === 1) { id = routes[0].to; continue; }

        var meet = meetingPoint(routes, stop);
        var paths = routes.map(function (c) {
          return { conn: c, items: c.to === meet ? [] : walk(c.to, meet) };
        });
        items.push({ fork: byId[id], paths: paths, meet: meet ? byId[meet] : null });
        id = meet;
      }
      return items;
    }

    var items = walk(starts[0].id, null);
    if (broken) return null;
    if (steps.some(function (s) { return !placed[s.id]; })) return null;
    return items;
  }

  /**
   * { label: { stepId: '3a' }, order: [steps in the order they are numbered] }
   * label is always a string; order always holds every step once.
   */
  function numbering(p) {
    var steps = (p && p.steps) || [];
    var label = {};
    var order = [];
    var items = outline(p);

    if (!items) {
      steps.forEach(function (s, i) { label[s.id] = String(i + 1); order.push(s); });
      return { label: label, order: order };
    }

    var LETTERS = 'abcdefghijklmnopqrstuvwxyz';

    /** Numbers a list of items from `start`; gives how many numbers it used. */
    function count(list, start, suffix, depth) {
      var at = start;
      list.forEach(function (item) {
        if (item.step) {
          label[item.step.id] = at + suffix;
          order.push(item.step);
          at++;
          return;
        }
        // A fork: its paths all start at the same number. Paths at the top
        // level are lettered, paths inside them numbered, and so on.
        var longest = 0;
        item.paths.forEach(function (path, k) {
          var mark = depth % 2 === 0
            ? (LETTERS.charAt(k) || String(k + 1))
            : String(k + 1);
          var used = count(path.items, at, suffix + mark, depth + 1);
          if (used > longest) longest = used;
        });
        at += longest;
      });
      return at - start;
    }

    count(items, 1, '', 0);
    return { label: label, order: order };
  }

  global.Branches = { outline: outline, numbering: numbering };
}(window));
