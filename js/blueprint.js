/* ===========================================================================
   blueprint.js — a process as a service blueprint.

   Every step sits on one side of the line of visibility:

     front   the customer journey: what the customer sees and does
     back    back of house: the work behind the scenes they never see

   A step that has not been sorted yet has no stage at all. Nothing guesses
   one: "Look up the property" can be either, depending on whether the
   customer is watching, so a person decides.

   This file holds the vocabulary and the layout. The map (canvas.js), the
   step list (ui-detail.js) and the exports (export.js) all draw from it, so
   the screen and the files agree.

   The layout runs left to right. A step's column is how far it is from the
   start, following the arrows, so steps that are alternatives to each other
   (the two answers to a decision) share a column, stacked. Its row is its
   stage: the customer journey above the line, back of house below it, and
   any step not sorted yet in a band underneath that disappears once every
   step has a side.
   =========================================================================== */

(function (global) {
  'use strict';

  var STAGES = ['front', 'back'];

  var LABEL = {
    front: 'Customer journey',
    back: 'Back of house',
    '': 'Not sorted yet'
  };

  var HINT = {
    front: 'What the customer sees and does',
    back: 'What we do behind the scenes',
    '': 'Drag each card above or below the line'
  };

  /** 'front', 'back', or '' for a step nobody has sorted yet. */
  function stageOf(step) {
    var stage = step && step.stage;
    return stage === 'front' || stage === 'back' ? stage : '';
  }

  /** How many steps sit on each side, and how many are still to sort. */
  function counts(p) {
    var out = { front: 0, back: 0, unsorted: 0 };
    ((p && p.steps) || []).forEach(function (s) {
      var stage = stageOf(s);
      if (stage) out[stage]++;
      else out.unsorted++;
    });
    return out;
  }

  /**
   * Does the stage filter show this step? 'both' shows everything. A step
   * not sorted yet always shows: hiding it would hide the work still to do.
   */
  function shows(filter, step) {
    if (!filter || filter === 'both') return true;
    var stage = stageOf(step);
    return !stage || stage === filter;
  }

  // ---- columns ---------------------------------------------------------------

  /**
   * Each step's column: the longest path to it from a starting step, along
   * the arrows. An arrow that loops back to an earlier step is left out of
   * the count, or a loop would push its steps off to the right for ever. A
   * step with no arrows in or out goes one column after the step before it
   * in the list.
   */
  function columns(p) {
    var steps = p.steps || [];
    var index = {};
    steps.forEach(function (s, i) { index[s.id] = i; });

    var outgoing = {};
    var incoming = {};
    (p.connections || []).forEach(function (c) {
      if (index[c.from] == null || index[c.to] == null || c.from === c.to) return;
      (outgoing[c.from] = outgoing[c.from] || []).push(c.to);
      incoming[c.to] = true;
    });

    // Depth-first from each start, in list order, to find the arrows that
    // close a loop and an order in which every arrow points forward.
    var state = {};
    var loopBack = {};
    var finished = [];

    function visit(id) {
      state[id] = 'open';
      (outgoing[id] || []).forEach(function (next) {
        if (state[next] === 'open') loopBack[id + '>' + next] = true;
        else if (!state[next]) visit(next);
      });
      state[id] = 'done';
      finished.push(id);
    }

    steps.forEach(function (s) { if (!incoming[s.id] && !state[s.id]) visit(s.id); });
    steps.forEach(function (s) { if (!state[s.id]) visit(s.id); });

    var column = {};
    finished.reverse().forEach(function (id) {
      if (column[id] == null) column[id] = 0;
      (outgoing[id] || []).forEach(function (next) {
        if (loopBack[id + '>' + next]) return;
        column[next] = Math.max(column[next] || 0, column[id] + 1);
      });
    });

    steps.forEach(function (s, i) {
      var connected = incoming[s.id] || (outgoing[s.id] || []).length;
      if (!connected && i > 0) column[s.id] = column[steps[i - 1].id] + 1;
    });
    return column;
  }

  // ---- layout ----------------------------------------------------------------

  var GUTTER = 190;     // the lane titles, left of the first column
  var COL_GAP = 70;     // between one column of cards and the next
  var LANE_PAD = 34;    // between a lane's edge and its cards
  var STACK_GAP = 22;   // between cards that share a column and a lane
  var LANE_MIN = 120;   // an empty lane still has room to drop a card into
  var BAND_GAP = 28;    // between back of house and the not-sorted band

  /**
   * Where everything goes.
   *
   * cardWidth   the width of a card
   * cardHeight  function (step) giving a card's height at the detail shown
   *
   * Returns
   *   pos     { stepId: { x, y, h, stage, column } }
   *   lanes   [{ stage, top, height, label, hint }] from top to bottom
   *   lineY   the line of visibility
   *   width, height of the whole drawing
   */
  function layout(p, cardWidth, cardHeight) {
    var steps = (p && p.steps) || [];
    var column = columns(p || {});

    // Cards grouped by lane, then by column, in list order.
    var groups = { front: {}, back: {}, '': {} };
    var maxColumn = -1;
    steps.forEach(function (s) {
      var c = column[s.id] || 0;
      maxColumn = Math.max(maxColumn, c);
      var lane = groups[stageOf(s)];
      (lane[c] = lane[c] || []).push(s);
    });

    function stackHeight(list) {
      return list.reduce(function (sum, s) { return sum + cardHeight(s); }, 0) +
        STACK_GAP * Math.max(0, list.length - 1);
    }

    function laneHeight(stage) {
      var tallest = 0;
      Object.keys(groups[stage]).forEach(function (c) {
        tallest = Math.max(tallest, stackHeight(groups[stage][c]));
      });
      return Math.max(LANE_MIN, tallest + LANE_PAD * 2);
    }

    var lanes = [];
    var y = 0;
    ['front', 'back'].forEach(function (stage) {
      var height = laneHeight(stage);
      lanes.push({ stage: stage, top: y, height: height, label: LABEL[stage], hint: HINT[stage] });
      y += height;
    });
    var lineY = lanes[0].height;
    var hasUnsorted = Object.keys(groups['']).length > 0;
    if (hasUnsorted) {
      y += BAND_GAP;
      var unsortedHeight = laneHeight('');
      lanes.push({ stage: '', top: y, height: unsortedHeight, label: LABEL[''], hint: HINT[''] });
      y += unsortedHeight;
    }

    var colWidth = cardWidth + COL_GAP;
    var pos = {};
    lanes.forEach(function (lane) {
      var group = groups[lane.stage];
      Object.keys(group).forEach(function (c) {
        var list = group[c];
        // The customer journey hugs the line from above and back of house
        // from below, so an arrow across the line is short.
        var cursor = lane.stage === 'front'
          ? lane.top + lane.height - LANE_PAD - stackHeight(list)
          : lane.top + LANE_PAD;
        list.forEach(function (s) {
          var h = cardHeight(s);
          pos[s.id] = {
            x: GUTTER + Number(c) * colWidth, y: cursor, h: h,
            stage: lane.stage, column: Number(c)
          };
          cursor += h + STACK_GAP;
        });
      });
    });

    return {
      pos: pos,
      lanes: lanes,
      lineY: lineY,
      gutter: GUTTER,
      width: GUTTER + Math.max(1, maxColumn + 1) * colWidth,
      height: y
    };
  }

  /** The lane a point falls in, as a stage ('front', 'back' or ''); null if none. */
  function laneAt(plan, y) {
    for (var i = 0; i < plan.lanes.length; i++) {
      var lane = plan.lanes[i];
      if (y >= lane.top && y < lane.top + lane.height) return lane.stage;
    }
    if (y < 0) return 'front';
    // Between back of house and the not-sorted band counts as back of house.
    var last = plan.lanes[plan.lanes.length - 1];
    return y >= last.top + last.height ? last.stage : 'back';
  }

  global.Blueprint = {
    STAGES: STAGES,
    LABEL: LABEL,
    HINT: HINT,
    stageOf: stageOf,
    counts: counts,
    shows: shows,
    columns: columns,
    layout: layout,
    laneAt: laneAt
  };
}(window));
