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

  // ---- issues register -----------------------------------------------------

  function issuesHtml() {
    var all = Data.allIssues();
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

    download('process-issues.html', page('Process issues register',
      '<h1>Process issues register</h1>' +
      '<p class="lede">' + all.length + ' open · ' + counts.high + ' high, ' +
      counts.medium + ' medium, ' + counts.low + ' low. Generated ' +
      e(new Date().toLocaleDateString('en-AU')) + '.</p>' +
      '<table><thead><tr><th>Severity</th><th>Process</th><th>Issue</th>' +
      '<th>Raised</th></tr></thead><tbody>' + rows + '</tbody></table>'), 'text/html');
  }

  function issuesCsv() {
    var rows = [['severity', 'process', 'department', 'issue', 'raised', 'raised_by']];
    Data.allIssues().forEach(function (entry) {
      rows.push([
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
    issuesHtml: issuesHtml,
    issuesCsv: issuesCsv,
    verificationText: verificationText,
    verificationHtml: verificationHtml,
    download: download,
    page: page
  };
}(window));
