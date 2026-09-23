/* ===========================================================================
   canvas.js — the draggable process map.

   Cards are absolutely positioned HTML using each step's stored x and y, with
   the arrows drawn in an SVG layer underneath. Dragging moves the card live
   and writes the new position once on release, so a drag is one change rather
   than one per pixel.

   Arrows are edited here too:
     - drag from the round handle on a card's right edge to another card to
       draw a route
     - click an arrow (or its label) to select it, then label or delete it in
       the bar above the map

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
      '<button class="btn small" data-canvas="tidy">Tidy layout</button>' +
      '<button class="btn small" data-canvas="zoom-out" aria-label="Zoom out">−</button>' +
      '<span class="zoom-level" id="zoomLevel">100%</span>' +
      '<button class="btn small" data-canvas="zoom-in" aria-label="Zoom in">+</button>' +
      '<button class="btn small" data-canvas="fit">Fit</button>' +
      '<button class="btn small primary" data-canvas="svg">⤓ SVG</button>' +
      '</div>' +
      '<div class="canvas-selbar" id="canvasSel"></div>' +
      '<div class="canvas-viewport" id="canvasViewport">' +
      '<div class="canvas-stage" id="canvasStage">' +
      '<svg class="canvas-wires" id="canvasWires"></svg>' +
      '<div class="canvas-cards" id="canvasCards"></div>' +
      '</div></div>';

    el.host = host;
    el.viewport = host.querySelector('#canvasViewport');
    el.stage = host.querySelector('#canvasStage');
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
    // Coming back to the same map (after an edit redraws the page, say)
    // keeps the zoom and pan; a different process starts fitted.
    if (view.fitted === processId) {
      applyTransform();
    } else {
      fit();
      view.fitted = processId;
    }
  }

  /** Redraw the whole page after a change; the zoom and pan survive it. */
  function remount() {
    if (global.App) global.App.route();
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
    if (action === 'tidy') { tidy(); draw(); fit(); }
    if (action === 'svg') Exporter.processSvg(view.processId, view.detail);
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
      el.sel.innerHTML = '<span class="selbar-hint">Drag from a card’s ● handle to another card ' +
        'to add a route. Click an arrow to label or remove it.</span>';
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

  // ---- drawing -------------------------------------------------------------

  function process() { return Data.state.index.processes[view.processId]; }

  function cardHeight(step) {
    if (view.detail === 'simple') return 66;
    var height = 92;
    if (view.detail === 'context') {
      height += 18;
      if (step.sop) height += Math.min(5, step.sop.split('\n').length) * 15;
      if (step.completionTrigger) height += 26;
    }
    return height;
  }

  function draw() {
    var p = process();
    if (!p) return;

    el.cards.innerHTML = p.steps.map(function (step, i) {
      return card(step, i, p);
    }).join('');

    Array.prototype.forEach.call(el.cards.querySelectorAll('.node'), function (node) {
      node.addEventListener('pointerdown', onCardDown);
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
  }

  function card(step, i, p) {
    var height = cardHeight(step);
    var body = '';

    if (view.detail !== 'simple') {
      body += '<div class="node-meta">' +
        '<span class="node-dept">' + e(Data.taxonomyName(step.departmentId)) + '</span>' +
        (step.timeframe ? '<span>' + e(step.timeframe) + '</span>' : '') +
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

    return '<div class="node node-' + e(step.type) + '" data-step="' + e(step.id) + '"' +
      ' style="left:' + (step.x || 0) + 'px; top:' + (step.y || 0) + 'px;' +
      ' width:' + CARD_W + 'px; min-height:' + height + 'px">' +
      '<div class="node-head">' +
      '<span class="node-n">' + (i + 1) + '</span>' +
      '<span class="node-title">' + e(Data.freeze(step.title) || 'Untitled step') + '</span>' +
      '<button class="node-open" data-open="' + e(step.id) + '" title="Edit this step">✎</button>' +
      '</div>' +
      (step.responsibleRole && view.detail !== 'simple'
        ? '<div class="node-role">' + e(step.responsibleRole) + '</div>' : '') +
      body +
      '<span class="node-port" title="Drag to another card to add a route" ' +
      'aria-label="Route handle"></span>' +
      '</div>';
  }

  /** Anchor on whichever edge faces the other card, so arrows never cross it. */
  function anchors(a, b) {
    var ah = cardHeight(a), bh = cardHeight(b);
    var ax = a.x || 0, ay = a.y || 0, bx = b.x || 0, by = b.y || 0;
    var dx = (bx + CARD_W / 2) - (ax + CARD_W / 2);
    var dy = (by + bh / 2) - (ay + ah / 2);

    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? { from: [ax + CARD_W, ay + ah / 2], to: [bx, by + bh / 2], axis: 'x' }
        : { from: [ax, ay + ah / 2], to: [bx + CARD_W, by + bh / 2], axis: 'x' };
    }
    return dy >= 0
      ? { from: [ax + CARD_W / 2, ay + ah], to: [bx + CARD_W / 2, by], axis: 'y' }
      : { from: [ax + CARD_W / 2, ay], to: [bx + CARD_W / 2, by + bh], axis: 'y' };
  }

  function curve(x1, y1, x2, y2, axis) {
    var bend = Math.max(40, Math.abs(axis === 'x' ? x2 - x1 : y2 - y1) / 2);
    var c1 = axis === 'x' ? [x1 + (x2 > x1 ? bend : -bend), y1] : [x1, y1 + (y2 > y1 ? bend : -bend)];
    var c2 = axis === 'x' ? [x2 - (x2 > x1 ? bend : -bend), y2] : [x2, y2 - (y2 > y1 ? bend : -bend)];
    return 'M ' + x1 + ' ' + y1 + ' C ' + c1[0] + ' ' + c1[1] + ', ' +
      c2[0] + ' ' + c2[1] + ', ' + x2 + ' ' + y2;
  }

  function wirePath(a, b) {
    var pt = anchors(a, b);
    return {
      d: curve(pt.from[0], pt.from[1], pt.to[0], pt.to[1], pt.axis),
      mid: [(pt.from[0] + pt.to[0]) / 2, (pt.from[1] + pt.to[1]) / 2]
    };
  }

  var MARKERS = '<defs>' +
    '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
    'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8A93A0"/></marker>' +
    '<marker id="arrowSel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
    'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#0A66C2"/></marker>' +
    '</defs>';

  function drawWires(extra) {
    var p = process();
    var bounds = contentBounds();
    el.wires.setAttribute('width', bounds.width);
    el.wires.setAttribute('height', bounds.height);

    var byId = {};
    p.steps.forEach(function (s) { byId[s.id] = s; });

    var parts = [MARKERS];

    (p.connections || []).forEach(function (conn) {
      var a = byId[conn.from], b = byId[conn.to];
      if (!a || !b) return;
      var wire = wirePath(a, b);
      var crosses = a.departmentId !== b.departmentId;
      var selected = conn.id === view.selected;
      var colour = selected ? '#0A66C2' : (crosses ? '#B45309' : '#8A93A0');
      // A wide invisible stroke underneath makes a thin arrow easy to hit,
      // on a phone as much as with a mouse.
      parts.push('<path class="wire-hit" data-conn="' + e(conn.id) + '" d="' + wire.d +
        '" fill="none" stroke="transparent" stroke-width="16"/>');
      parts.push('<path d="' + wire.d + '" fill="none" stroke="' + colour +
        '" stroke-width="' + (selected ? 2.8 : crosses ? 2.2 : 1.6) +
        '" marker-end="url(#' + (selected ? 'arrowSel' : 'arrow') + ')"' +
        (crosses && !selected ? ' stroke-dasharray="6 4"' : '') + ' pointer-events="none"/>');
      if (conn.condition) {
        parts.push('<text x="' + wire.mid[0] + '" y="' + (wire.mid[1] - 6) +
          '" class="wire-label' + (selected ? ' selected' : '') + '" data-conn="' + e(conn.id) +
          '" text-anchor="middle">' + e(Data.freeze(conn.condition)) + '</text>');
      }
    });

    if (extra) parts.push(extra);
    el.wires.innerHTML = parts.join('');
  }

  function contentBounds() {
    var p = process();
    var maxX = 0, maxY = 0;
    p.steps.forEach(function (s) {
      maxX = Math.max(maxX, (s.x || 0) + CARD_W);
      maxY = Math.max(maxY, (s.y || 0) + cardHeight(s));
    });
    return { width: maxX + 80, height: maxY + 80 };
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

  function fit() {
    var bounds = contentBounds();
    var box = el.viewport.getBoundingClientRect();
    var scale = Math.min((box.width - 40) / bounds.width, (box.height - 40) / bounds.height, 1);
    view.zoom = Math.max(MIN_ZOOM, scale);
    view.panX = Math.max(20, (box.width - bounds.width * view.zoom) / 2);
    view.panY = 20;
    applyTransform();
  }

  function onWheel(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    var box = el.viewport.getBoundingClientRect();
    setZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
      event.clientX - box.left, event.clientY - box.top);
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
    if (event.target.closest('.node-open')) return;
    event.stopPropagation();
    var node = event.currentTarget;
    var p = process();
    var step = p.steps.find(function (s) { return s.id === node.dataset.step; });
    if (!step) return;

    if (event.target.closest('.node-port')) {
      startLink(event, node, step);
      return;
    }

    drag = {
      kind: 'card', node: node, step: step,
      startX: event.clientX, startY: event.clientY,
      originX: step.x || 0, originY: step.y || 0, moved: false
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
      var s = drag.step;
      var from = [(s.x || 0) + CARD_W, (s.y || 0) + cardHeight(s) / 2];
      var to = toStage(event);
      drawWires('<path d="' + curve(from[0], from[1], to[0], to[1], 'x') +
        '" fill="none" stroke="#0A66C2" stroke-width="2" stroke-dasharray="4 3" ' +
        'marker-end="url(#arrowSel)" pointer-events="none"/>');
      return;
    }

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    // Snap to a 20px grid so hand-placed cards still line up.
    var x = Math.max(0, Math.round((drag.originX + dx / view.zoom) / 20) * 20);
    var y = Math.max(0, Math.round((drag.originY + dy / view.zoom) / 20) * 20);
    drag.step.x = x;
    drag.step.y = y;
    drag.node.style.left = x + 'px';
    drag.node.style.top = y + 'px';
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
    if (finished.moved) {
      // The live drag already moved the object; record it as one change.
      var x = finished.step.x, y = finished.step.y;
      finished.step.x = finished.originX;
      finished.step.y = finished.originY;
      Edit.moveCard(view.processId, finished.step.id, x, y);
      applyTransform();
    }
  }

  // ---- tidy layout ---------------------------------------------------------

  var MAX_COLUMNS = 5;

  /**
   * Lay the map out in columns by distance from the entry step, stacking
   * anything that shares a column and wrapping to a new band every few
   * columns. Without the wrap a ten step process is three and a half metres
   * wide and only readable at a quarter scale.
   */
  function tidy() {
    var p = process();
    if (!p || !p.steps.length) return;

    var outgoing = {};
    var hasIncoming = {};
    (p.connections || []).forEach(function (c) {
      (outgoing[c.from] = outgoing[c.from] || []).push(c.to);
      hasIncoming[c.to] = true;
    });

    // Longest path from an entry, capped so a loop cannot run forever. A
    // step reached two ways sits after the later of them.
    var depth = {};
    var roots = p.steps.filter(function (s) { return !hasIncoming[s.id]; });
    if (!roots.length) roots = [p.steps[0]];

    var queue = roots.map(function (s) { return { id: s.id, d: 0 }; });
    var guard = 0;
    var limit = p.steps.length;
    while (queue.length && guard++ < 5000) {
      var item = queue.shift();
      if (item.d > limit) continue;
      if (depth[item.id] != null && depth[item.id] >= item.d) continue;
      depth[item.id] = item.d;
      (outgoing[item.id] || []).forEach(function (next) {
        queue.push({ id: next, d: item.d + 1 });
      });
    }

    var columns = {};
    p.steps.forEach(function (s, i) {
      var column = depth[s.id] != null ? depth[s.id] : i;
      (columns[column] = columns[column] || []).push(s);
    });

    // How tall each band has to be: the deepest stack in any of its columns.
    var bandRows = {};
    Object.keys(columns).forEach(function (key) {
      var band = Math.floor(Number(key) / MAX_COLUMNS);
      bandRows[band] = Math.max(bandRows[band] || 1, columns[key].length);
    });

    var bandTop = {};
    var y = 80;
    Object.keys(bandRows).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (band) {
        bandTop[band] = y;
        y += bandRows[band] * 180 + 60;
      });

    Object.keys(columns).forEach(function (key) {
      var column = Number(key);
      var band = Math.floor(column / MAX_COLUMNS);
      var slot = column % MAX_COLUMNS;
      // Alternate bands run right to left, so the wrap between them is a short
      // hop down rather than a long line back across the whole map.
      if (band % 2) slot = MAX_COLUMNS - 1 - slot;
      columns[key].forEach(function (step, row) {
        step.x = 80 + slot * (CARD_W + 90);
        step.y = bandTop[band] + row * 180;
      });
    });

    Edit.touch();
  }

  global.Canvas = {
    mount: mount,
    CARD_W: CARD_W,
    cardHeight: cardHeight,
    wirePath: wirePath,
    contentBounds: function (processId) {
      var saved = view.processId;
      view.processId = processId;
      var bounds = contentBounds();
      view.processId = saved;
      return bounds;
    }
  };
}(window));
