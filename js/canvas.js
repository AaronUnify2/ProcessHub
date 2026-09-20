/* ===========================================================================
   canvas.js — the draggable process map.

   Cards are absolutely positioned HTML using each step's stored x and y, with
   the arrows drawn in an SVG layer underneath. Dragging moves the card live
   and writes the new position once on release, so a drag is one change rather
   than one per pixel.

   Pointer events are used throughout, so the same code handles mouse, trackpad
   and touch.
   =========================================================================== */

(function (global) {
  'use strict';

  var CARD_W = 260;
  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 2;

  var view = { processId: null, zoom: 1, panX: 40, panY: 40, detail: 'default' };
  var el = {};
  var drag = null;

  function e(text) { return Data.escapeHtml(text); }

  // ---- mounting ------------------------------------------------------------

  function mount(processId, host, prefs) {
    var p = Data.state.index.processes[processId];
    if (!p) return;

    view.processId = processId;
    view.detail = (prefs && prefs.cardDetail) || 'default';

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
      '<button class="btn small" data-canvas="zoom-out">−</button>' +
      '<span class="zoom-level" id="zoomLevel">100%</span>' +
      '<button class="btn small" data-canvas="zoom-in">+</button>' +
      '<button class="btn small" data-canvas="fit">Fit</button>' +
      '<button class="btn small primary" data-canvas="svg">⤓ SVG</button>' +
      '</div>' +
      '<div class="canvas-viewport" id="canvasViewport">' +
      '<div class="canvas-stage" id="canvasStage">' +
      '<svg class="canvas-wires" id="canvasWires"></svg>' +
      '<div class="canvas-cards" id="canvasCards"></div>' +
      '</div></div>';

    el.viewport = host.querySelector('#canvasViewport');
    el.stage = host.querySelector('#canvasStage');
    el.wires = host.querySelector('#canvasWires');
    el.cards = host.querySelector('#canvasCards');
    el.zoomLabel = host.querySelector('#zoomLevel');
    el.prefs = prefs;

    host.querySelector('.canvas-toolbar').addEventListener('click', onToolbar);
    el.viewport.addEventListener('pointerdown', onPointerDown);
    el.viewport.addEventListener('wheel', onWheel, { passive: false });

    draw();
    fit();
  }

  function onToolbar(event) {
    var detail = event.target.dataset.detail;
    if (detail) {
      view.detail = detail;
      if (el.prefs) { el.prefs.cardDetail = detail; Storage.savePrefs(el.prefs); }
      Array.prototype.forEach.call(event.currentTarget.querySelectorAll('.cdt'), function (b) {
        b.classList.toggle('on', b.dataset.detail === detail);
      });
      draw();
      return;
    }
    var action = event.target.dataset.canvas;
    if (action === 'zoom-in') setZoom(view.zoom * 1.2);
    if (action === 'zoom-out') setZoom(view.zoom / 1.2);
    if (action === 'fit') fit();
    if (action === 'tidy') { tidy(); draw(); fit(); }
    if (action === 'svg') Exporter.processSvg(view.processId, view.detail);
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
        location.hash = '#/process/' + p.id;
        var target = document.getElementById('step-' + node.dataset.open);
        if (target) target.scrollIntoView({ block: 'center' });
      });
    });

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
      body + '</div>';
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

  function wirePath(a, b) {
    var pt = anchors(a, b);
    var x1 = pt.from[0], y1 = pt.from[1], x2 = pt.to[0], y2 = pt.to[1];
    var bend = Math.max(40, Math.abs(pt.axis === 'x' ? x2 - x1 : y2 - y1) / 2);
    var c1 = pt.axis === 'x' ? [x1 + (x2 > x1 ? bend : -bend), y1] : [x1, y1 + (y2 > y1 ? bend : -bend)];
    var c2 = pt.axis === 'x' ? [x2 - (x2 > x1 ? bend : -bend), y2] : [x2, y2 - (y2 > y1 ? bend : -bend)];
    return {
      d: 'M ' + x1 + ' ' + y1 + ' C ' + c1[0] + ' ' + c1[1] + ', ' +
        c2[0] + ' ' + c2[1] + ', ' + x2 + ' ' + y2,
      mid: [(x1 + x2) / 2, (y1 + y2) / 2]
    };
  }

  function drawWires() {
    var p = process();
    var bounds = contentBounds();
    el.wires.setAttribute('width', bounds.width);
    el.wires.setAttribute('height', bounds.height);

    var byId = {};
    p.steps.forEach(function (s) { byId[s.id] = s; });

    var parts = ['<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
      'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8A93A0"/></marker></defs>'];

    (p.connections || []).forEach(function (conn) {
      var a = byId[conn.from], b = byId[conn.to];
      if (!a || !b) return;
      var wire = wirePath(a, b);
      var crosses = a.departmentId !== b.departmentId;
      parts.push('<path d="' + wire.d + '" fill="none" stroke="' +
        (crosses ? '#B45309' : '#8A93A0') + '" stroke-width="' + (crosses ? 2.2 : 1.6) +
        '" marker-end="url(#arrow)"' + (crosses ? ' stroke-dasharray="6 4"' : '') + '/>');
      if (conn.condition) {
        parts.push('<text x="' + wire.mid[0] + '" y="' + (wire.mid[1] - 6) +
          '" class="wire-label" text-anchor="middle">' + e(conn.condition) + '</text>');
      }
    });

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

  // ---- dragging ------------------------------------------------------------

  function onCardDown(event) {
    if (event.target.closest('.node-open')) return;
    event.stopPropagation();
    var node = event.currentTarget;
    var p = process();
    var step = p.steps.find(function (s) { return s.id === node.dataset.step; });
    if (!step) return;

    drag = {
      kind: 'card', node: node, step: step,
      startX: event.clientX, startY: event.clientY,
      originX: step.x || 0, originY: step.y || 0, moved: false
    };
    node.setPointerCapture(event.pointerId);
    node.classList.add('dragging');
    node.addEventListener('pointermove', onDragMove);
    node.addEventListener('pointerup', onDragEnd);
    node.addEventListener('pointercancel', onDragEnd);
  }

  function onPointerDown(event) {
    if (event.target.closest('.node')) return;
    drag = {
      kind: 'pan', startX: event.clientX, startY: event.clientY,
      originX: view.panX, originY: view.panY
    };
    el.viewport.setPointerCapture(event.pointerId);
    el.viewport.classList.add('panning');
    el.viewport.addEventListener('pointermove', onDragMove);
    el.viewport.addEventListener('pointerup', onDragEnd);
    el.viewport.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;

    if (drag.kind === 'pan') {
      view.panX = drag.originX + dx;
      view.panY = drag.originY + dy;
      applyTransform();
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
    drag = null;

    if (finished.kind === 'pan') {
      el.viewport.classList.remove('panning');
      el.viewport.releasePointerCapture(event.pointerId);
      el.viewport.removeEventListener('pointermove', onDragMove);
      el.viewport.removeEventListener('pointerup', onDragEnd);
      el.viewport.removeEventListener('pointercancel', onDragEnd);
      return;
    }

    finished.node.classList.remove('dragging');
    finished.node.releasePointerCapture(event.pointerId);
    finished.node.removeEventListener('pointermove', onDragMove);
    finished.node.removeEventListener('pointerup', onDragEnd);
    finished.node.removeEventListener('pointercancel', onDragEnd);

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

    var byId = {};
    p.steps.forEach(function (s) { byId[s.id] = s; });

    var outgoing = {};
    var hasIncoming = {};
    (p.connections || []).forEach(function (c) {
      (outgoing[c.from] = outgoing[c.from] || []).push(c.to);
      hasIncoming[c.to] = true;
    });

    var depth = {};
    var roots = p.steps.filter(function (s) { return !hasIncoming[s.id]; });
    if (!roots.length) roots = [p.steps[0]];

    var queue = roots.map(function (s) { return { id: s.id, d: 0 }; });
    var guard = 0;
    while (queue.length && guard++ < 5000) {
      var item = queue.shift();
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
