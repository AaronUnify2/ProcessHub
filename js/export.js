/* ===========================================================================
   export.js — everything that leaves the app.

   Two rules hold throughout:
     - variables are frozen at export time, because nothing downstream can
       resolve them;
     - anything internal is withheld from a public export.

   Where a human could read the result, a self-contained HTML version is
   offered alongside the JSON.
   =========================================================================== */

(function (global) {
  'use strict';

  function e(text) { return Data.escapeHtml(text); }
  function today() { return new Date().toISOString().slice(0, 10); }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function json(value) { return JSON.stringify(value, null, 2) + '\n'; }

  // ---- the legacy FAQ projection -------------------------------------------
  // Mirrors tools/export-faq.py. The published FAQ.html consumes this shape
  // unchanged, so the ids go back to their unprefixed form.

  function stripPrefix(html) {
    return String(html || '')
      .replace(/(data-var=)"var_([^"]*)"/g, '$1"$2"')
      .replace(/(data-var-href=)"var_([^"]*)"/g, '$1"$2"');
  }

  function ownerName(id) {
    var node = Data.state.index.taxonomy[id];
    return node ? node.name : '';
  }

  function faqProjection() {
    var variables = Data.state.variables.variables
      .filter(function (v) { return !v.internal; })
      .map(function (v) {
        var item = {
          id: v.id.indexOf('var_') === 0 ? v.id.slice(4) : v.id,
          question: v.question || '',
          value: v.value || ''
        };
        if (v.ownerId) item.owner = ownerName(v.ownerId);
        if (v.type && v.type !== 'text') item.type = v.type;
        if (v.note) item.note = v.note;
        return item;
      });

    var byTab = {};
    Data.state.library.faqs.forEach(function (f) {
      if (f.internal) return;
      var tab = f.publish && f.publish.tabId;
      if (tab) (byTab[tab] = byTab[tab] || []).push(f);
    });

    var tabs = Data.state.library.publishTabs.map(function (tab) {
      var out = { id: tab.id, label: tab.label };
      if (tab['new']) out['new'] = true;
      if (tab.intro) out.intro = stripPrefix(tab.intro);

      var stepper = tab.stepper || [];
      if (tab.stepperFrom) stepper = stepperFromProcess(tab.stepperFrom) || stepper;
      if (stepper.length) {
        out.stepper = stepper.map(function (s) { return { label: s.label, text: s.text }; });
      }

      var items = [];
      var group = null;
      (byTab[tab.id] || []).slice().sort(function (a, b) {
        return (a.publish.order || 0) - (b.publish.order || 0);
      }).forEach(function (f) {
        if (f.publish.groupTitle && f.publish.groupTitle !== group) {
          group = f.publish.groupTitle;
          items.push({ type: 'group', title: group });
        }
        items.push({ type: 'faq', q: f.q, a: stripPrefix(f.a) });
      });
      out.items = items;

      if (tab.footer) out.footer = stripPrefix(tab.footer);
      if (tab.lastReviewed) out.lastReviewed = tab.lastReviewed;
      return out;
    });

    var departments = Data.state.processes.taxonomy
      .filter(function (n) { return !n.parentId; })
      .map(function (n) { return n.name; });

    return { variables: variables, tabs: tabs, departments: departments };
  }

  /** A public stepper generated from a process, so it never drifts from the map. */
  function stepperFromProcess(processId) {
    var p = Data.state.index.processes[processId];
    if (!p) return null;
    return p.steps.filter(function (s) { return s.type !== 'decision'; })
      .map(function (s, i) {
        return { label: 'STEP ' + (i + 1), text: Data.freeze(s.title) };
      });
  }

  // ---- export for GitHub ---------------------------------------------------

  function bumpVersions() {
    ['processes', 'library', 'variables'].forEach(function (name) {
      var file = Data.state[name];
      file.version = (file.version || 1) + 1;
      file.updated = today();
    });
  }

  /**
   * Download all four files, named as they sit in the repository. Versions are
   * bumped first so the next load compares cleanly against what you commit.
   */
  function exportForGitHub() {
    bumpVersions();
    download('processes.json', json(Data.state.processes));
    setTimeout(function () { download('library.json', json(Data.state.library)); }, 150);
    setTimeout(function () { download('variables.json', json(Data.state.variables)); }, 300);
    setTimeout(function () { download('FAQ.json', json(faqProjection())); }, 450);
    return Edit.save();
  }

  function exportFaqOnly() {
    download('FAQ.json', json(faqProjection()));
  }

  // ---- verification sheets -------------------------------------------------

  function variablesByOwner(ownerId) {
    return Data.state.variables.variables.filter(function (v) {
      return !ownerId || v.ownerId === ownerId;
    });
  }

  function verificationText(ownerId) {
    var list = variablesByOwner(ownerId);
    var who = ownerId ? ownerName(ownerId) : 'All departments';
    var lines = [];
    lines.push(who + ' — please confirm these details are still current (' +
      new Date().toLocaleDateString('en-AU') + '):');
    lines.push('');

    list.forEach(function (v, i) {
      var usage = Data.state.index.usage[v.id] || { processes: [] };
      lines.push((i + 1) + '. ' + (v.question || ('Value for ' + v.id)));
      lines.push('   We currently show: ' + (v.value || '(blank)') +
        (v.note ? '   [' + v.note + ']' : ''));
      if (usage.processes.length) {
        lines.push('   Appears in ' + usage.processes.length + ' place' +
          (usage.processes.length === 1 ? '' : 's') + ' across our processes, ' +
          'knowledge base and public FAQs.');
      }
      lines.push('   Correct value: ____________________');
      lines.push('');
    });

    lines.push('Thank you.');
    return lines.join('\n');
  }

  function verificationHtml(ownerId) {
    var list = variablesByOwner(ownerId);
    var who = ownerId ? ownerName(ownerId) : 'All departments';
    var rows = list.map(function (v, i) {
      var usage = Data.state.index.usage[v.id] || { processes: [] };
      return '<tr><td class="n">' + (i + 1) + '</td>' +
        '<td><div class="q">' + e(v.question || v.id) + '</div>' +
        (v.note ? '<div class="note">' + e(v.note) + '</div>' : '') +
        (usage.processes.length
          ? '<div class="uses">Appears in ' + usage.processes.length + ' place' +
            (usage.processes.length === 1 ? '' : 's') + '</div>'
          : '') +
        '</td><td class="val">' + e(v.value || '(blank)') + '</td>' +
        '<td class="fill"></td></tr>';
    }).join('');

    return page(who + ' — content verification',
      '<h1>' + e(who) + '</h1>' +
      '<p class="lede">Please confirm these details are still current, or write ' +
      'the correct value in the last column. Generated ' +
      e(new Date().toLocaleDateString('en-AU')) + '.</p>' +
      '<table><thead><tr><th></th><th>What we need to confirm</th>' +
      '<th>We currently show</th><th>Correct value</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>');
  }

  // ---- a single process ----------------------------------------------------

  function processJson(processId) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    download(safeName(p.name) + '.json', json({
      schema: 1, exported: today(), process: frozenProcess(p)
    }));
  }

  /** A copy with variables baked in, for anything read outside the app. */
  function frozenProcess(p) {
    var copy = JSON.parse(JSON.stringify(p));
    copy.steps.forEach(function (s) {
      ['sop', 'script', 'title', 'completionTrigger'].forEach(function (key) {
        if (s[key]) s[key] = Data.freeze(s[key]);
      });
      (s.checks || []).forEach(function (c) { c.text = Data.freeze(c.text); });
      s.department = Data.taxonomyName(s.departmentId);
    });
    delete copy.departments;
    return copy;
  }

  function processHtml(processId) {
    var p = Data.state.index.processes[processId];
    if (!p) return;

    var steps = p.steps.map(function (s, i) {
      var handoff = s.isHandoff
        ? '<div class="handoff">Handoff to ' + e(Data.taxonomyName(s.departmentId)) + '</div>'
        : '';
      return handoff + '<div class="step ' + e(s.type) + '">' +
        '<div class="step-head"><span class="n">' + (i + 1) + '</span>' +
        '<span class="type">' + e(s.type) + '</span>' +
        '<h3>' + e(Data.freeze(s.title)) + '</h3></div>' +
        '<div class="meta"><span class="dept">' + e(Data.taxonomyName(s.departmentId)) + '</span>' +
        (s.responsibleRole ? '<span>' + e(s.responsibleRole) + '</span>' : '') +
        (s.timeframe ? '<span>' + e(s.timeframe) + '</span>' : '') + '</div>' +
        (s.script ? '<blockquote>' + e(Data.freeze(s.script)) + '</blockquote>' : '') +
        (s.sop ? '<p>' + e(Data.freeze(s.sop)).replace(/\n/g, '<br>') + '</p>' : '') +
        ((s.checks || []).length
          ? '<ul class="checks">' + s.checks.map(function (c) {
              return '<li>' + e(Data.freeze(c.text)) + '</li>';
            }).join('') + '</ul>'
          : '') +
        (s.completionTrigger
          ? '<p class="trigger"><strong>Done when:</strong> ' +
            e(Data.freeze(s.completionTrigger)) + '</p>'
          : '') +
        '</div>';
    }).join('');

    var issues = (p.issues || []).length
      ? '<h2>Issues</h2>' + p.issues.map(function (i) {
          return '<div class="issue ' + e(i.severity) + '"><strong>' + e(i.severity) +
            '</strong> ' + e(i.note) + '</div>';
        }).join('')
      : '';

    download(safeName(p.name) + '.html', page(p.name,
      '<div class="crumbs">' + e(Data.taxonomyPath(p.taxonomyId)) + '</div>' +
      '<h1>' + e(p.name) + '</h1>' +
      '<p class="lede">' + e(Data.freeze(p.purpose || '')) + '</p>' +
      '<p class="stamp">' + p.steps.length + ' steps · ' + p.handoffs + ' handoff' +
      (p.handoffs === 1 ? '' : 's') + ' · status: ' + e(p.status) +
      ' · exported ' + e(today()) + '</p>' +
      steps + issues), 'text/html');
  }

  // ---- the process map as SVG ----------------------------------------------
  // Real vector output rather than a screenshot, so it scales and stays
  // readable when someone drops it into a report. Geometry is shared with the
  // canvas so the file matches what was on screen, and variables are frozen
  // because an SVG cannot resolve anything at view time.

  var HEADER_H = 86;

  /** Break text into lines that fit a width, estimating from the glyph size. */
  function wrapText(text, widthPx, fontPx) {
    var perChar = fontPx * 0.54;
    var max = Math.max(8, Math.floor(widthPx / perChar));
    var lines = [];
    String(text || '').split(/\n/).forEach(function (paragraph) {
      var line = '';
      paragraph.split(/\s+/).forEach(function (word) {
        if (!line.length) { line = word; return; }
        if ((line + ' ' + word).length <= max) { line += ' ' + word; return; }
        lines.push(line);
        line = word;
      });
      lines.push(line);
    });
    return lines.filter(function (l) { return l.length; });
  }

  var NODE_COLOUR = {
    entry: '#2E7D53', action: '#0A66C2', decision: '#B45309', resolution: '#5B3FA8'
  };

  function processSvg(processId, detail) {
    var p = Data.state.index.processes[processId];
    if (!p) return;
    detail = detail || 'default';

    var W = Canvas.CARD_W;
    var bounds = { width: 0, height: 0 };
    p.steps.forEach(function (s) {
      bounds.width = Math.max(bounds.width, (s.x || 0) + W);
      bounds.height = Math.max(bounds.height, (s.y || 0) + Canvas.cardHeight(s));
    });
    bounds.width += 80;
    bounds.height += 80;

    var parts = [];

    // wires first, so cards sit on top of them
    var byId = {};
    p.steps.forEach(function (s) { byId[s.id] = s; });
    (p.connections || []).forEach(function (conn) {
      var a = byId[conn.from], b = byId[conn.to];
      if (!a || !b) return;
      var wire = Canvas.wirePath(a, b);
      var crosses = a.departmentId !== b.departmentId;
      parts.push('<path d="' + wire.d + '" fill="none" stroke="' +
        (crosses ? '#B45309' : '#8A93A0') + '" stroke-width="' + (crosses ? 2.2 : 1.6) + '"' +
        (crosses ? ' stroke-dasharray="6 4"' : '') + ' marker-end="url(#arrow)"/>');
      if (conn.condition) {
        var label = Data.freeze(conn.condition);
        var boxW = label.length * 6.2 + 14;
        parts.push('<rect x="' + (wire.mid[0] - boxW / 2) + '" y="' + (wire.mid[1] - 20) +
          '" width="' + boxW + '" height="17" rx="8" fill="#FFFFFF" stroke="#D8DEE6"/>' +
          '<text x="' + wire.mid[0] + '" y="' + (wire.mid[1] - 8) +
          '" text-anchor="middle" font-size="10" fill="#4A5260">' + e(label) + '</text>');
      }
    });

    p.steps.forEach(function (step, i) {
      var x = step.x || 0, y = step.y || 0;
      var h = Canvas.cardHeight(step);
      var colour = NODE_COLOUR[step.type] || '#8A93A0';

      parts.push('<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + h +
        '" rx="9" fill="#FFFFFF" stroke="#DDE2E9"/>');
      parts.push('<path d="M ' + (x + 3) + ' ' + y + ' h -0 a 9 9 0 0 0 -3 9 v ' + (h - 18) +
        ' a 9 9 0 0 0 3 9 z" fill="' + colour + '"/>');
      parts.push('<rect x="' + x + '" y="' + y + '" width="3.5" height="' + h +
        '" fill="' + colour + '"/>');

      parts.push('<circle cx="' + (x + 24) + '" cy="' + (y + 20) + '" r="9" fill="#F0F3F7"/>' +
        '<text x="' + (x + 24) + '" y="' + (y + 23.5) + '" text-anchor="middle" font-size="10" ' +
        'font-weight="700" fill="#6E6E73">' + (i + 1) + '</text>');

      var titleLines = wrapText(Data.freeze(step.title), W - 56, 12.5).slice(0, 2);
      titleLines.forEach(function (line, n) {
        parts.push('<text x="' + (x + 40) + '" y="' + (y + 18 + n * 15) +
          '" font-size="12.5" font-weight="650" fill="#1D1D1F">' + e(line) + '</text>');
      });

      var cursor = y + 18 + titleLines.length * 15 + 6;

      if (detail !== 'simple') {
        var dept = Data.taxonomyName(step.departmentId);
        var pillW = dept.length * 5.6 + 14;
        parts.push('<rect x="' + (x + 14) + '" y="' + cursor + '" width="' + pillW +
          '" height="15" rx="7.5" fill="#EAF2FB"/>' +
          '<text x="' + (x + 21) + '" y="' + (cursor + 11) +
          '" font-size="9.5" font-weight="600" fill="#0A66C2">' + e(dept) + '</text>');
        if (step.responsibleRole) {
          parts.push('<text x="' + (x + 20 + pillW) + '" y="' + (cursor + 11) +
            '" font-size="9.5" fill="#6E6E73">' +
            e(wrapText(step.responsibleRole, W - pillW - 40, 9.5)[0] || '') + '</text>');
        }
        cursor += 22;
      }

      if (detail === 'context') {
        if (step.sop) {
          wrapText(Data.freeze(step.sop), W - 28, 10).slice(0, 5).forEach(function (line) {
            parts.push('<text x="' + (x + 14) + '" y="' + cursor +
              '" font-size="10" fill="#4A5260">' + e(line) + '</text>');
            cursor += 13;
          });
        }
        if (step.completionTrigger) {
          cursor += 4;
          wrapText('→ ' + Data.freeze(step.completionTrigger), W - 28, 9.5)
            .slice(0, 2).forEach(function (line) {
              parts.push('<text x="' + (x + 14) + '" y="' + cursor +
                '" font-size="9.5" fill="#6E6E73">' + e(line) + '</text>');
              cursor += 12;
            });
        }
      }
    });

    var departments = p.departments.map(Data.taxonomyName);
    var header =
      '<rect x="0" y="0" width="' + bounds.width + '" height="' + HEADER_H + '" fill="#FFFFFF"/>' +
      '<text x="36" y="34" font-size="19" font-weight="700" fill="#1D1D1F">' +
      e(p.name) + '</text>' +
      '<text x="36" y="54" font-size="11" fill="#6E6E73">' +
      e(Data.taxonomyPath(p.taxonomyId)) + '  ·  ' + p.steps.length + ' steps  ·  ' +
      p.handoffs + ' handoff' + (p.handoffs === 1 ? '' : 's') + '  ·  ' + e(p.status) + '</text>' +
      '<text x="36" y="71" font-size="10" fill="#8A93A0">' +
      e(departments.join('  →  ')) + '</text>' +
      '<text x="' + (bounds.width - 36) + '" y="34" text-anchor="end" font-size="10" ' +
      'fill="#8A93A0">Exported ' + e(today()) + '</text>' +
      (p.handoffs
        ? '<line x1="' + (bounds.width - 128) + '" y1="52" x2="' + (bounds.width - 100) +
          '" y2="52" stroke="#B45309" stroke-width="2.2" stroke-dasharray="6 4"/>' +
          '<text x="' + (bounds.width - 94) + '" y="55" font-size="10" fill="#B45309">' +
          'crosses departments</text>'
        : '') +
      '<line x1="0" y1="' + HEADER_H + '" x2="' + bounds.width + '" y2="' + HEADER_H +
      '" stroke="#E4E8EE"/>';

    var total = bounds.height + HEADER_H;
    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + bounds.width + '" height="' + total +
      '" viewBox="0 0 ' + bounds.width + ' ' + total + '" ' +
      'font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif">\n' +
      '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" ' +
      'markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8A93A0"/></marker></defs>\n' +
      '<rect width="100%" height="100%" fill="#F5F7FA"/>\n' + header + '\n' +
      '<g transform="translate(0,' + HEADER_H + ')">\n' + parts.join('\n') + '\n</g>\n</svg>\n';

    download(safeName(p.name) + '-map.svg', svg, 'image/svg+xml');
  }
  // ---- issues register -----------------------------------------------------

  function issuesHtml() {
    var all = Data.allIssues();

    // Rule findings first: they are computed now, so they are true now.
    var ruleBlocks = Rules.run().filter(function (r) {
      return !r.skipped && r.findings.length;
    }).map(function (result) {
      return '<h2>' + e(result.rule.name) + ' <span class="count">' +
        result.findings.length + '</span></h2>' +
        (result.rule.message ? '<p class="lede">' + e(result.rule.message) + '</p>' : '') +
        '<table><thead><tr><th>Severity</th><th>Where</th><th>Detail</th></tr></thead><tbody>' +
        result.findings.map(function (f) {
          return '<tr class="' + e(f.severity) + '"><td><span class="sev">' +
            e(f.severity) + '</span></td><td>' + e(f.label) +
            '<div class="note">' + e(f.where) + '</div></td>' +
            '<td>' + e(f.detail || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).join('');

    var rows = all.map(function (entry) {
      return '<tr class="' + e(entry.issue.severity) + '">' +
        '<td><span class="sev">' + e(entry.issue.severity) + '</span></td>' +
        '<td>' + e(entry.process.name) + '<div class="note">' +
        e(Data.taxonomyPath(entry.process.taxonomyId)) + '</div></td>' +
        '<td>' + e(entry.issue.note) + '</td>' +
        '<td>' + e(entry.issue.raised) + '</td></tr>';
    }).join('');

    var counts = { high: 0, medium: 0, low: 0 };
    all.forEach(function (x) { counts[x.issue.severity]++; });

    var ruleTotals = Rules.totals();
    download('process-issues.html', page('Process issues register',
      '<h1>Process issues register</h1>' +
      '<p class="lede">' + ruleTotals.findings + ' flagged by ' + ruleTotals.rules +
      ' content rules · ' + all.length + ' recorded by hand (' + counts.high +
      ' high, ' + counts.medium + ' medium, ' + counts.low + ' low). Generated ' +
      e(new Date().toLocaleDateString('en-AU')) + '.</p>' +
      ruleBlocks +
      '<h2>Recorded issues <span class="count">' + all.length + '</span></h2>' +
      '<table><thead><tr><th>Severity</th><th>Process</th><th>Issue</th>' +
      '<th>Raised</th></tr></thead><tbody>' + rows + '</tbody></table>'), 'text/html');
  }

  function issuesCsv() {
    var rows = [['source', 'severity', 'subject', 'where', 'issue', 'raised', 'raised_by']];

    Rules.run().forEach(function (result) {
      if (result.skipped) return;
      result.findings.forEach(function (f) {
        rows.push(['rule: ' + result.rule.name, f.severity, f.label, f.where,
          f.message + (f.detail ? ' (' + f.detail + ')' : ''), '', 'Content rule']);
      });
    });

    Data.allIssues().forEach(function (entry) {
      rows.push([
        'recorded',
        entry.issue.severity,
        entry.process.name,
        Data.taxonomyPath(entry.process.taxonomyId),
        entry.issue.note,
        entry.issue.raised,
        entry.issue.raisedBy || ''
      ]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');
    download('process-issues.csv', csv, 'text/csv');
  }

  // ---- shared HTML wrapper -------------------------------------------------

  function safeName(name) {
    return String(name || 'export').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
  }

  function page(title, body) {
    return '<!DOCTYPE html>\n<html lang="en-AU">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>' + e(title) + '</title>\n<style>\n' + PAGE_CSS + '\n</style>\n</head>\n' +
      '<body>\n<main>\n' + body + '\n</main>\n</body>\n</html>\n';
  }

  var PAGE_CSS = [
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#1D1D1F;background:#F5F7FA;padding:28px 18px 60px}',
    'main{max-width:840px;margin:0 auto}',
    'h1{font-size:1.7rem;letter-spacing:-.5px;margin-bottom:.3rem}',
    'h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#6E6E73;margin:1.8rem 0 .6rem}',
    'h3{font-size:1rem;flex:1}',
    '.crumbs{font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;color:#6E6E73;font-weight:600}',
    '.lede{color:#6E6E73;margin-bottom:.4rem}',
    '.stamp{font-size:.76rem;color:#6E6E73;margin-bottom:1.4rem}',
    '.step{background:#fff;border:1px solid rgba(0,0,0,.09);border-left:3px solid #0A66C2;',
    'border-radius:9px;padding:.8rem 1rem;margin-bottom:.5rem}',
    '.step.entry{border-left-color:#2E7D53}.step.resolution{border-left-color:#5B3FA8}',
    '.step.decision{border-left-color:#B45309}',
    '.step-head{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap}',
    '.n{font-size:.7rem;font-weight:700;background:#F5F7FA;border-radius:999px;padding:1px 7px;color:#6E6E73}',
    '.type{font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:#6E6E73;font-weight:700}',
    '.meta{display:flex;flex-wrap:wrap;gap:.3rem;margin:.45rem 0}',
    '.meta span{font-size:.7rem;background:#F5F7FA;color:#6E6E73;border-radius:999px;padding:1px 8px}',
    '.meta .dept{background:#EAF2FB;color:#0A66C2;font-weight:600}',
    'blockquote{border-left:3px solid #2E7D53;background:#F4FAF6;padding:.5rem .75rem;',
    'margin:.5rem 0;font-style:italic;font-size:.92rem;border-radius:0 7px 7px 0}',
    '.checks{list-style:none;margin:.5rem 0}',
    '.checks li{position:relative;padding-left:1.5rem;font-size:.9rem;margin-bottom:.22rem}',
    '.checks li::before{content:"";position:absolute;left:0;top:.32em;width:13px;height:13px;',
    'border:1.5px solid rgba(0,0,0,.28);border-radius:3px}',
    '.trigger{margin-top:.55rem;padding-top:.45rem;border-top:1px dashed rgba(0,0,0,.12);',
    'font-size:.84rem;color:#6E6E73}',
    '.handoff{display:inline-block;font-size:.7rem;font-weight:700;text-transform:uppercase;',
    'letter-spacing:.05em;color:#B45309;background:#FEF6E7;border-radius:999px;padding:2px 10px;margin:.4rem 0 .5rem .8rem}',
    '.issue{background:#fff;border:1px solid rgba(0,0,0,.09);border-radius:8px;padding:.55rem .75rem;',
    'margin-bottom:.35rem;font-size:.88rem}',
    '.issue strong{text-transform:uppercase;font-size:.65rem;letter-spacing:.04em;margin-right:.4rem}',
    '.issue.high strong{color:#C0392B}.issue.medium strong{color:#B45309}',
    'table{width:100%;border-collapse:collapse;background:#fff;font-size:.88rem;margin-top:1rem}',
    'th,td{border:1px solid rgba(0,0,0,.14);padding:8px 10px;text-align:left;vertical-align:top}',
    'th{background:#EAF2FB;color:#0A66C2;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}',
    'td.n{width:32px;color:#6E6E73}td.val{font-weight:600;white-space:nowrap}',
    'h2 .count{color:#8A93A0;font-weight:400}',
    'td.fill{width:30%;background:#FCFCFD}',
    '.q{font-weight:600}.note,.uses{font-size:.76rem;color:#6E6E73}',
    '.sev{font-size:.65rem;font-weight:700;text-transform:uppercase}',
    'tr.high .sev{color:#C0392B}tr.medium .sev{color:#B45309}',
    '@media print{body{background:#fff;padding:0}.step{break-inside:avoid}}'
  ].join('');

  global.Exporter = {
    exportForGitHub: exportForGitHub,
    exportFaqOnly: exportFaqOnly,
    faqProjection: faqProjection,
    processJson: processJson,
    processHtml: processHtml,
    processSvg: processSvg,
    wrapText: wrapText,
    issuesHtml: issuesHtml,
    issuesCsv: issuesCsv,
    verificationText: verificationText,
    verificationHtml: verificationHtml,
    download: download,
    page: page
  };
}(window));
