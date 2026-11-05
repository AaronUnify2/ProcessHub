/* ===========================================================================
   canvas.js — the process map, drawn as a service blueprint.

   The customer journey runs left to right above the line of visibility; the
   work behind the scenes runs below it. Where each card goes is worked out
   from the arrows and the step's stage (blueprint.js), not placed by hand,
   so every map reads the same way.

   On the map:
     - drag a card across the line to move it between the customer journey
       and back of house (or out of "Not sorted yet")
     - drag from the round handle on a card's right edge to another card to
       draw a route
     - click an arrow (or its label) to select it, then label or delete it in
       the bar above the map
     - the stage filter (above the map, shared with the step list) fades the
       side you are not looking at, so the flow still reads

   Pointer events are used throughout, so the same code handles mouse, trackpad
   and touch.
   =========================================================================== */

(function (global) {
  'use strict';

  var CARD_W = 260;
  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 2;

  var view = { processId: null, zoom: 1, panX: 40, panY: 40, detail: 'default', selected: null };
  var el = {};
  var drag = null;
  var callbacks = {};
  var plan = null;

  function e(text) { return Data.escapeHtml(text); }

  // ---- mounting ------------------------------------------------------------

  /**
   * options.onOpenStep(stepId)  called by a card's ✎ button, so the page can
   * switch to the step list and scroll to it.
   */
  function mount(processId, host, prefs, options) {
    var p = Data.state.index.processes[processId];
    if (!p) return;

    if (view.processId !== processId) { view.selected = null; view.fitted = null; }
    view.processId = processId;
    view.detail = (prefs && prefs.cardDetail) || 'default';
    callbacks = options || {};

    host.innerHTML =
      '<div class="canvas-toolbar">' +
      '<div class="detail-toggle">' +
      ['simple', 'default', 'context'].map(function (level) {
        return '<button class="cdt' + (level === view.detail ? ' on' : '') +
          '" data-detail="' + level + '">' +
          level.charAt(0).toUpperCase() + level.slice(1) + '</button>';
      }).join('') +
      '</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn small primary-soft" data-canvas="add-step">+ Step</button>' +
      '<button class="btn small" data-canvas="zoom-out" aria-label="Zoom out">−</button>' +
      '<span class="zoom-level" id="zoomLevel">100%</span>' +
      '<button class="btn small" data-canvas="zoom-in" aria-label="Zoom in">+</button>' +
      '<button class="btn small" data-canvas="fit">Fit</button>' +
      '<button class="btn small primary" data-canvas="svg">⤓ SVG</button>' +
      '</div>' +
      '<div class="canvas-selbar" id="canvasSel"></div>' +
      '<div class="canvas-viewport" id="canvasViewport">' +
      '<div class="canvas-stage" id="canvasStage">' +
      '<div class="canvas-lanes" id="canvasLanes"></div>' +
      '<svg class="canvas-wires" id="canvasWires"></svg>' +
      '<div class="canvas-cards" id="canvasCards"></div>' +
      '</div></div>';

    el.host = host;
    el.viewport = host.querySelector('#canvasViewport');
    el.stage = host.querySelector('#canvasStage');
    el.lanes = host.querySelector('#canvasLanes');
    el.wires = host.querySelector('#canvasWires');
    el.cards = host.querySelector('#canvasCards');
    el.sel = host.querySelector('#canvasSel');
    el.zoomLabel = host.querySelector('#zoomLevel');
    el.prefs = prefs;

    host.querySelector('.canvas-toolbar').addEventListener('click', onToolbar);
    el.sel.addEventListener('click', onSelbar);
    el.viewport.addEventListener('pointerdown', onPointerDown);
    el.viewport.addEventListener('wheel', onWheel, { passive: false });

    draw();
    sizeViewport();
    // Coming back to the same map (after an edit redraws the page, say)
    // keeps the zoom and pan; a different process starts at a size you can
    // read, at the start of the journey.
    if (view.fitted === processId) {
      applyTransform();
    } else {
      readable();
      view.fitted = processId;
    }
  }

  /**
   * A blueprint is wide and not very tall, so the map is only as tall as it
   * needs to be (up to the usual limit) rather than a big empty box.
   */
  function sizeViewport() {
    var limit = Math.min(window.innerHeight * 0.7, 620);
    el.viewport.style.height = Math.round(Math.max(260, Math.min(limit, contentBounds().height + 40))) + 'px';
  }

  /** Redraw the whole page after a change; the zoom and pan survive it. */
  function remount() {
    if (global.App) global.App.route();
  }

  function filter() {
    return (el.prefs && el.prefs.stageFilter) || 'both';
  }

  function onToolbar(event) {
    var button = event.target.closest('button');
    if (!button) return;
    var detail = button.dataset.detail;
    if (detail) {
      view.detail = detail;
      if (el.prefs) { el.prefs.cardDetail = detail; Storage.savePrefs(el.prefs); }
      Array.prototype.forEach.call(event.currentTarget.querySelectorAll('.cdt'), function (b) {
        b.classList.toggle('on', b.dataset.detail === detail);
      });
      draw();
      return;
    }
    var action = button.dataset.canvas;
    if (action === 'zoom-in') setZoom(view.zoom * 1.2);
    if (action === 'zoom-out') setZoom(view.zoom / 1.2);
    if (action === 'fit') fit();
    if (action === 'add-step') addStepAfter(null);
    if (action === 'svg') Exporter.processSvg(view.processId, view.detail);
  }

  // ---- adding a step --------------------------------------------------------

  /**
   * Add a step after a card (or, with no card, after the last step). It takes
   * over where that step led and starts on the same side of the line — the
   * same rules as adding a step in the Steps view.
   */
  function addStepAfter(stepId) {
    var name = prompt('What happens at the new step?', '');
    if (name === null) return;
    var id = Edit.addStep(view.processId, stepId || null);
    if (!id) return;
    if (name.trim()) Edit.set('step:' + view.processId + ':' + id + ':title', name.trim());
    view.justAdded = id;
    remount();
  }

  // ---- the selected route --------------------------------------------------

  function selectedConnection() {
    var p = process();
    if (!p || !view.selected) return null;
    return (p.connections || []).find(function (c) { return c.id === view.selected; }) || null;
  }

  function drawSelbar() {
    var p = process();
    var conn = selectedConnection();
    if (!conn) {
      el.sel.innerHTML = '<span class="selbar-hint">Drag a card across the line to move it ' +
        'between the customer journey and back of house. Drag from a card’s ● handle to ' +
        'another card to add a route; click an arrow to label or remove it.</span>';
      return;
    }
    var number = {};
    p.steps.forEach(function (s, i) { number[s.id] = i + 1; });
    el.sel.innerHTML =
      '<span class="selbar-what">Route ' + number[conn.from] + ' → ' + number[conn.to] + '</span>' +
      '<span class="selbar-field">' + Edit.field('connection:' + p.id + ':' + conn.id + ':condition',
        { placeholder: 'Label, e.g. Yes / Over $500' }) + '</span>' +
      '<button class="btn small danger" data-sel="delete">Remove route</button>' +
      '<button class="btn small" data-sel="close">Done</button>';
  }

  function onSelbar(event) {
    var button = event.target.closest('[data-sel]');
    if (!button) return;
    if (button.dataset.sel === 'delete' && view.selected) {
      Edit.deleteConnection(view.processId, view.selected);
      view.selected = null;
      remount();
      return;
    }
    if (button.dataset.sel === 'close') {
      Edit.commitActive();
      view.selected = null;
      drawSelbar();
      drawWires();
    }
  }

  function select(connId) {
    view.selected = connId;
    drawSelbar();
    drawWires();
  }

  // ---- geometry --------------------------------------------------------------

  function process() { return Data.state.index.processes[view.processId]; }

  /** A card's height at a detail level (the one on screen if none is given). */
  function cardHeight(step, detail) {
    detail = detail || view.detail;
    if (detail === 'simple') return 66;
    var height = 92;
    if (detail === 'context') {
      height += 18;
      if (step.sop) height += Math.min(5, step.sop.split('\n').length) * 15;
      if (step.completionTrigger) height += 26;
    }
    return height;
  }

  /** The blueprint layout of a process at a detail level. */
  function planFor(p, detail) {
    return Blueprint.layout(p, CARD_W, function (s) { return cardHeight(s, detail); });
  }

  /** Anchor on whichever edge faces the other card, so arrows never cross it. */
  function anchors(a, b) {
    var dx = (b.x + CARD_W / 2) - (a.x + CARD_W / 2);
    var dy = (b.y + b.h / 2) - (a.y + a.h / 2);

    if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
      return dx >= 0
        ? { from: [a.x + CARD_W, a.y + a.h / 2], to: [b.x, b.y + b.h / 2], axis: 'x' }
        : { from: [a.x, a.y + a.h / 2], to: [b.x + CARD_W, b.y + b.h / 2], axis: 'x' };
    }
    return dy >= 0
      ? { from: [a.x + CARD_W / 2, a.y + a.h], to: [b.x + CARD_W / 2, b.y], axis: 'y' }
      : { from: [a.x + CARD_W / 2, a.y], to: [b.x + CARD_W / 2, b.y + b.h], axis: 'y' };
  }

  function curve(x1, y1, x2, y2, axis) {
    var bend = Math.max(40, Math.abs(axis === 'x' ? x2 - x1 : y2 - y1) / 2);
    var c1 = axis === 'x' ? [x1 + (x2 > x1 ? bend : -bend), y1] : [x1, y1 + (y2 > y1 ? bend : -bend)];
    var c2 = axis === 'x' ? [x2 - (x2 > x1 ? bend : -bend), y2] : [x2, y2 - (y2 > y1 ? bend : -bend)];
    return 'M ' + x1 + ' ' + y1 + ' C ' + c1[0] + ' ' + c1[1] + ', ' +
      c2[0] + ' ' + c2[1] + ', ' + x2 + ' ' + y2;
  }

  /** An arrow between two placed cards ({ x, y, h }). */
  function wirePath(a, b) {
    var pt = anchors(a, b);
    return {
      d: curve(pt.from[0], pt.from[1], pt.to[0], pt.to[1], pt.axis),
      mid: [(pt.from[0] + pt.to[0]) / 2, (pt.from[1] + pt.to[1]) / 2]
    };
  }

  // ---- drawing -------------------------------------------------------------

  function draw() {
    var p = process();
    if (!p) return;
    plan = planFor(p);

    drawLanes();

    el.cards.innerHTML = p.steps.map(function (step, i) {
      return card(step, i);
    }).join('');

    Array.prototype.forEach.call(el.cards.querySelectorAll('.node'), function (node) {
      node.addEventListener('pointerdown', onCardDown);
    });
    Array.prototype.forEach.call(el.cards.querySelectorAll('[data-add-after]'), function (node) {
      node.addEventListener('click', function (event) {
        event.stopPropagation();
        addStepAfter(node.dataset.addAfter);
      });
    });
    Array.prototype.forEach.call(el.cards.querySelectorAll('[data-open]'), function (node) {
      node.addEventListener('click', function (event) {
        event.stopPropagation();
        if (callbacks.onOpenStep) callbacks.onOpenStep(node.dataset.open);
      });
    });

    drawSelbar();
    drawWires();
    applyTransform();

    if (view.justAdded) {
      view.justAdded = null;
      setTimeout(function () {
        var fresh = el.cards.querySelector('.just-added');
        if (fresh) fresh.classList.remove('just-added');
      }, 1600);
    }
  }

  /** The lanes, their titles and the line of visibility, behind everything. */
  function drawLanes() {
    var width = plan.width + 40;
    var showing = filter();
    var html = plan.lanes.map(function (lane) {
      var faded = showing !== 'both' && lane.stage && lane.stage !== showing;
      return '<div class="bp-lane bp-' + (lane.stage || 'unsorted') + (faded ? ' faded' : '') +
        '" data-lane="' + lane.stage + '" style="top:' + lane.top + 'px; height:' + lane.height +
        'px; width:' + width + 'px">' +
        '<div class="bp-lane-label" style="width:' + (plan.gutter - 30) + 'px">' +
        '<strong>' + e(lane.label) + '</strong><span>' + e(lane.hint) + '</span></div></div>';
    }).join('');
    html += '<div class="bp-line" style="top:' + plan.lineY + 'px; width:' + width + 'px">' +
      '<span>Line of visibility</span></div>';
    el.lanes.innerHTML = html;
  }

  function card(step, i) {
    var at = plan.pos[step.id];
    var body = '';

    if (view.detail !== 'simple') {
      body += '<div class="node-meta">' +
        '<span class="node-dept">' + e(Data.taxonomyName(step.departmentId)) + '</span>' +
        (step.timeframe ? '<span>' + e(Data.freeze(step.timeframe)) + '</span>' : '') +
        '</div>';
    }
    if (view.detail === 'context') {
      if (step.sop) {
        body += '<div class="node-sop">' +
          Data.resolveText(step.sop.split('\n').slice(0, 5).join('\n')).replace(/\n/g, '<br>') +
          '</div>';
      }
      if (step.completionTrigger) {
        body += '<div class="node-trigger">→ ' + Data.resolveText(step.completionTrigger) + '</div>';
      }
    }

    var stage = Blueprint.stageOf(step);
    var faded = !Blueprint.shows(filter(), step);
    var fresh = view.justAdded === step.id;
    return '<div class="node node-' + e(step.type) + ' stage-' + (stage || 'none') +
      (faded ? ' faded' : '') + (fresh ? ' just-added' : '') + '" data-step="' + e(step.id) + '"' +
      ' style="left:' + at.x + 'px; top:' + at.y + 'px;' +
      ' width:' + CARD_W + 'px; min-height:' + at.h + 'px">' +
      '<div class="node-head">' +
      '<span class="node-n" title="' + e(TYPE_LABEL[step.type] || '') + '">' + (i + 1) + '</span>' +
      '<span class="node-title">' + e(Data.freeze(step.title) || 'Untitled step') + '</span>' +
      '<button class="node-add" data-add-after="' + e(step.id) + '" title="Add a step after this one" ' +
      'aria-label="Add a step after this one">+</button>' +
      '<button class="node-open" data-open="' + e(step.id) + '" title="Edit this step">✎</button>' +
      '</div>' +
      (step.responsibleRole && view.detail !== 'simple'
        ? '<div class="node-role">' + e(step.responsibleRole) + '</div>' : '') +
      body +
      '<span class="node-port" title="Drag to another card to add a route" ' +
      'aria-label="Route handle"></span>' +
      '</div>';
  }

  var TYPE_LABEL = { entry: 'Start', action: 'Step', decision: 'Decision', resolution: 'End' };

  var MARKERS = '<defs>' +
    '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
    'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8A93A0"/></marker>' +
    '<marker id="arrowSel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
    'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#0A66C2"/></marker>' +
    '</defs>';

  /** Where a card is now: mid-drag, the dragged card is where the pointer has it. */
  function placed(step) {
    var at = plan.pos[step.id];
    if (drag && drag.kind === 'card' && drag.step === step) {
      return { x: drag.x, y: drag.y, h: at.h };
    }
    return at;
  }

  function drawWires(extra) {
    var p = process();
    var bounds = contentBounds();
    el.wires.setAttribute('width', bounds.width);
    el.wires.setAttribute('height', bounds.height);

    var byId = {};
    p.steps.forEach(function (s) { byId[s.id] = s; });
    var showing = filter();

    var parts = [MARKERS];

    (p.connections || []).forEach(function (conn) {
      var a = byId[conn.from], b = byId[conn.to];
      if (!a || !b || !plan.pos[a.id] || !plan.pos[b.id]) return;
      var wire = wirePath(placed(a), placed(b));
      var crosses = a.departmentId !== b.departmentId;
      var selected = conn.id === view.selected;
      var faded = !selected && (!Blueprint.shows(showing, a) || !Blueprint.shows(showing, b));
      var colour = selected ? '#0A66C2' : (crosses ? '#B45309' : '#8A93A0');
      var group = '<g' + (faded ? ' class="faded"' : '') + '>';
      // A wide invisible stroke underneath makes a thin arrow easy to hit,
      // on a phone as much as with a mouse.
      group += '<path class="wire-hit" data-conn="' + e(conn.id) + '" d="' + wire.d +
        '" fill="none" stroke="transparent" stroke-width="16"/>';
      group += '<path d="' + wire.d + '" fill="none" stroke="' + colour +
        '" stroke-width="' + (selected ? 2.8 : crosses ? 2.2 : 1.6) +
        '" marker-end="url(#' + (selected ? 'arrowSel' : 'arrow') + ')"' +
        (crosses && !selected ? ' stroke-dasharray="6 4"' : '') + ' pointer-events="none"/>';
      if (conn.condition) {
        group += '<text x="' + wire.mid[0] + '" y="' + (wire.mid[1] - 6) +
          '" class="wire-label' + (selected ? ' selected' : '') + '" data-conn="' + e(conn.id) +
          '" text-anchor="middle">' + e(Data.freeze(conn.condition)) + '</text>';
      }
      parts.push(group + '</g>');
    });

    if (extra) parts.push(extra);
    el.wires.innerHTML = parts.join('');
  }

  function contentBounds() {
    return { width: plan.width + 40, height: plan.height + 20 };
  }

  // ---- transform, pan and zoom --------------------------------------------

  function applyTransform() {
    el.stage.style.transform = 'translate(' + view.panX + 'px,' + view.panY + 'px) scale(' + view.zoom + ')';
    var bounds = contentBounds();
    el.stage.style.width = bounds.width + 'px';
    el.stage.style.height = bounds.height + 'px';
    if (el.zoomLabel) el.zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
  }

  function setZoom(next, originX, originY) {
    var clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (originX != null) {
      // Keep the point under the cursor fixed while zooming.
      var ratio = clamped / view.zoom;
      view.panX = originX - (originX - view.panX) * ratio;
      view.panY = originY - (originY - view.panY) * ratio;
    }
    view.zoom = clamped;
    applyTransform();
  }

  /**
   * Full height at up to full size, from the start of the journey. If the
   * whole width fits at that size it is centred; otherwise you pan along it.
   */
  function readable() {
    var bounds = contentBounds();
    var box = el.viewport.getBoundingClientRect();
    view.zoom = Math.max(0.5, Math.min(1, (box.height - 40) / bounds.height));
    var wide = bounds.width * view.zoom;
    view.panX = wide + 40 <= box.width ? (box.width - wide) / 2 : 20;
    view.panY = Math.max(20, (box.height - bounds.height * view.zoom) / 2);
    applyTransform();
  }

  /** The whole blueprint in view, however small that makes it. */
  function fit() {
    var bounds = contentBounds();
    var box = el.viewport.getBoundingClientRect();
    var scale = Math.min((box.width - 40) / bounds.width, (box.height - 40) / bounds.height, 1);
    view.zoom = Math.max(MIN_ZOOM, scale);
    view.panX = Math.max(20, (box.width - bounds.width * view.zoom) / 2);
    view.panY = Math.max(20, (box.height - bounds.height * view.zoom) / 2);
    applyTransform();
  }

  /**
   * Ctrl or Cmd with the wheel (or a pinch on a trackpad) zooms. A sideways
   * swipe, or Shift with the wheel, pans along the journey; an ordinary
   * scroll is left to the page.
   */
  function onWheel(event) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      var box = el.viewport.getBoundingClientRect();
      setZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
        event.clientX - box.left, event.clientY - box.top);
      return;
    }
    var sideways = event.shiftKey ? event.deltaY : event.deltaX;
    if (Math.abs(sideways) > Math.abs(event.shiftKey ? 0 : event.deltaY)) {
      event.preventDefault();
      view.panX -= sideways;
      applyTransform();
    }
  }

  /** A pointer position in map coordinates. */
  function toStage(event) {
    var box = el.viewport.getBoundingClientRect();
    return [
      (event.clientX - box.left - view.panX) / view.zoom,
      (event.clientY - box.top - view.panY) / view.zoom
    ];
  }

  // ---- dragging ------------------------------------------------------------

  function onCardDown(event) {
    if (event.target.closest('.node-open') || event.target.closest('.node-add')) return;
    event.stopPropagation();
    var node = event.currentTarget;
    var p = process();
    var step = p.steps.find(function (s) { return s.id === node.dataset.step; });
    if (!step) return;

    if (event.target.closest('.node-port')) {
      startLink(event, node, step);
      return;
    }

    var at = plan.pos[step.id];
    drag = {
      kind: 'card', node: node, step: step,
      startX: event.clientX, startY: event.clientY,
      originX: at.x, originY: at.y, x: at.x, y: at.y,
      lane: at.stage, moved: false
    };
    capture(node, event);
    node.classList.add('dragging');
  }

  /** Begin drawing a route from a card's handle. */
  function startLink(event, node, step) {
    drag = { kind: 'link', node: node, step: step, over: null };
    capture(node, event);
    node.classList.add('linking');
    el.viewport.classList.add('linking');
  }

  function onPointerDown(event) {
    if (event.target.closest('.node')) return;
    var wire = event.target.closest('[data-conn]');
    if (wire) {
      event.stopPropagation();
      select(wire.getAttribute('data-conn'));
      return;
    }
    drag = {
      kind: 'pan', startX: event.clientX, startY: event.clientY,
      originX: view.panX, originY: view.panY, moved: false
    };
    capture(el.viewport, event);
    el.viewport.classList.add('panning');
  }

  function capture(node, event) {
    drag.target = node;
    drag.pointerId = event.pointerId;
    node.setPointerCapture(event.pointerId);
    node.addEventListener('pointermove', onDragMove);
    node.addEventListener('pointerup', onDragEnd);
    node.addEventListener('pointercancel', onDragEnd);
  }

  function release() {
    var node = drag.target;
    try { node.releasePointerCapture(drag.pointerId); } catch (err) { /* already released */ }
    node.removeEventListener('pointermove', onDragMove);
    node.removeEventListener('pointerup', onDragEnd);
    node.removeEventListener('pointercancel', onDragEnd);
  }

  /** The card under a pointer, other than the one being dragged from. */
  function cardAt(event, except) {
    var hit = document.elementFromPoint(event.clientX, event.clientY);
    var node = hit && hit.closest ? hit.closest('.node') : null;
    return node && node !== except ? node : null;
  }

  /** Light up the lane a dragged card would land in. */
  function markLane(stage) {
    Array.prototype.forEach.call(el.lanes.querySelectorAll('.bp-lane'), function (lane) {
      lane.classList.toggle('drop-target', stage !== null && lane.dataset.lane === stage);
    });
  }

  function onDragMove(event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;

    if (drag.kind === 'pan') {
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      view.panX = drag.originX + dx;
      view.panY = drag.originY + dy;
      applyTransform();
      return;
    }

    if (drag.kind === 'link') {
      var over = cardAt(event, drag.node);
      if (drag.over && drag.over !== over) drag.over.classList.remove('link-target');
      if (over) over.classList.add('link-target');
      drag.over = over;
      var from = plan.pos[drag.step.id];
      var to = toStage(event);
      drawWires('<path d="' + curve(from.x + CARD_W, from.y + from.h / 2, to[0], to[1], 'x') +
        '" fill="none" stroke="#0A66C2" stroke-width="2" stroke-dasharray="4 3" ' +
        'marker-end="url(#arrowSel)" pointer-events="none"/>');
      return;
    }

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    drag.x = drag.originX + dx / view.zoom;
    drag.y = drag.originY + dy / view.zoom;
    drag.node.style.left = drag.x + 'px';
    drag.node.style.top = drag.y + 'px';
    drag.lane = Blueprint.laneAt(plan, drag.y + plan.pos[drag.step.id].h / 2);
    markLane(drag.lane);
    drawWires();
  }

  function onDragEnd(event) {
    if (!drag) return;
    var finished = drag;
    release();
    drag = null;

    if (finished.kind === 'pan') {
      el.viewport.classList.remove('panning');
      // A plain click on the background clears a selected route.
      if (!finished.moved && view.selected) {
        Edit.commitActive();
        select(null);
      }
      return;
    }

    if (finished.kind === 'link') {
      finished.node.classList.remove('linking');
      el.viewport.classList.remove('linking');
      if (finished.over) finished.over.classList.remove('link-target');
      var target = event.type === 'pointerup' ? cardAt(event, finished.node) : null;
      if (target) {
        var id = Edit.addConnection(view.processId, finished.step.id, target.dataset.step, '');
        if (id) view.selected = id;
        remount();
      } else {
        drawWires();
      }
      return;
    }

    finished.node.classList.remove('dragging');
    markLane(null);
    var was = Blueprint.stageOf(finished.step);
    var landed = event.type === 'pointerup' && finished.moved ? finished.lane : was;
    if (landed !== was) {
      // Dropped on the other side of the line: the step changes stage, and
      // the layout puts it in its column there.
      Edit.set('step:' + view.processId + ':' + finished.step.id + ':stage', landed);
      remount();
      return;
    }
    // Anywhere else on its own side: back to where the layout has it.
    finished.node.style.left = finished.originX + 'px';
    finished.node.style.top = finished.originY + 'px';
    drawWires();
  }

  global.Canvas = {
    mount: mount,
    CARD_W: CARD_W,
    cardHeight: cardHeight,
    plan: planFor,
    wirePath: wirePath
  };
}(window));
