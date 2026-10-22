/* ===========================================================================
   factsheet-export.js — a fact sheet, and its review pack, leaving the app.

   Fact sheets are not published from Process Hub. They go out two ways:

     the fact sheet   to comms, who put the council's style guide on it —
                      so a Word document whose headings, lists and tables
                      are Word's own, ready to restyle
     the review pack  to the people who have to sign it off: the case for
                      replacing the current sheet, a link to that sheet, the
                      new sheet itself, the FAQ answers it expands on as they
                      read now, where every value comes from, and a sign-off
                      table

   Each comes as a Word file (.doc — HTML that Word opens as a document, so
   no library is needed) or as a printable page to save as PDF from the
   browser's print dialog.

   As with every other export, variables are frozen to their values. An
   internal value is never printed: it is replaced by a marker, and the fact
   sheet's own page warns that it is there.
   =========================================================================== */

(function (global) {
  'use strict';

  var PUBLIC_FAQ = 'https://aaronunify2.github.io/UnifyVersion1/FAQ.html';
  var WITHHELD = '[internal value withheld]';

  function e(text) { return Data.escapeHtml(text); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function sheetOf(id) { return Data.state.index.factSheets[id] || null; }

  function slug(text) {
    return String(text || 'fact-sheet').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'fact-sheet';
  }

  function statusLabel(sheet) {
    return Data.FACT_SHEET_STATUS_LABEL[sheet.status] || sheet.status || 'Draft';
  }

  // ---- the content, frozen -------------------------------------------------

  /** HTML in, HTML out: internal values withheld, every other value frozen. */
  function bake(html) {
    var holder = document.createElement('div');
    holder.innerHTML = String(html || '').replace(/\{\{(var_[a-z0-9_]+)\}\}/gi, function (whole, id) {
      var v = Data.variable(id);
      return v && v.internal === true ? WITHHELD : whole;
    });
    Array.prototype.forEach.call(holder.querySelectorAll('[data-var]'), function (node) {
      var v = Data.variable(node.getAttribute('data-var'));
      if (v && v.internal === true) node.replaceWith(document.createTextNode(WITHHELD));
    });
    Array.prototype.forEach.call(holder.querySelectorAll('[data-var-href]'), function (node) {
      var v = Data.variable(node.getAttribute('data-var-href'));
      if (v && v.internal === true) node.replaceWith(document.createTextNode(node.textContent));
    });
    return Data.freeze(holder.innerHTML);
  }

  /**
   * Inside the review pack the sheet sits under the pack's own headings, so
   * its headings drop a level: its sections read as parts of "The proposed
   * fact sheet" rather than as rivals to "Sign-off".
   */
  function demoteHeadings(html) {
    return String(html || '').replace(/<(\/?)h([1-5])(?=[\s>])/gi, function (_, close, n) {
      return '<' + close + 'h' + (Number(n) + 1);
    });
  }

  /**
   * Word ignores most CSS, but it does read inline styles and table
   * attributes. A checklist becomes a line per item with a box in front,
   * since Word has no way to draw the box from a stylesheet.
   */
  function forWord(html) {
    var holder = document.createElement('div');
    holder.innerHTML = html;

    Array.prototype.forEach.call(holder.querySelectorAll('ul.checklist'), function (list) {
      var lines = document.createDocumentFragment();
      Array.prototype.forEach.call(list.children, function (item) {
        var line = document.createElement('p');
        line.className = 'check';
        line.innerHTML = '☐&nbsp;&nbsp;' + item.innerHTML;
        lines.appendChild(line);
      });
      list.replaceWith(lines);
    });

    var BOXES = {
      note: 'border-left:3pt solid #2d2d7a;background:#f0f0f8;padding:4pt 8pt;margin:6pt 0',
      warn: 'border-left:3pt solid #e0a800;background:#fff8e6;padding:4pt 8pt;margin:6pt 0',
      term: 'border-left:3pt solid #3a7a3a;background:#eef4ee;padding:4pt 8pt;margin:6pt 0'
    };
    Object.keys(BOXES).forEach(function (kind) {
      Array.prototype.forEach.call(holder.querySelectorAll('div.' + kind), function (box) {
        box.setAttribute('style', BOXES[kind]);
      });
    });

    Array.prototype.forEach.call(holder.querySelectorAll('table'), function (table) {
      table.setAttribute('border', '1');
      table.setAttribute('cellspacing', '0');
      table.setAttribute('cellpadding', '6');
      table.setAttribute('style', 'border-collapse:collapse;width:100%');
    });
    return holder.innerHTML;
  }

  // ---- the two documents ---------------------------------------------------

  /** A line over a sheet that has not been approved, so a draft is never mistaken for the real thing. */
  function draftBanner(sheet) {
    if (sheet.status !== 'draft' && sheet.status !== 'signoff') return '';
    return '<p class="banner">' + e(statusLabel(sheet).toUpperCase()) +
      ' — not yet approved · ' + e(today()) + '</p>';
  }

  function sheetHtml(sheet) {
    return draftBanner(sheet) +
      '<h1>' + e(sheet.title) + '</h1>' +
      bake(sheet.body) +
      (sheet.lastReviewed ? '<p class="small">Last reviewed: ' + e(sheet.lastReviewed) + '</p>' : '');
  }

  function link(url, label) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return e(label || url);
    return '<a href="' + e(url) + '">' + e(label || url) + '</a>';
  }

  function packHtml(sheet) {
    var current = sheet.current || {};
    var replaces = String(current.title || current.url || '').trim();
    var owner = sheet.ownerId ? Data.taxonomyPath(sheet.ownerId) : '—';
    var people = sheet.signoffs || [];

    var html = '<p class="kicker">Review pack</p>' +
      '<h1>' + e(sheet.title) + '</h1>' +
      '<table class="facts"><tbody>' +
      '<tr><th>Status</th><td>' + e(statusLabel(sheet)) + '</td></tr>' +
      '<tr><th>Owner</th><td>' + e(owner) + '</td></tr>' +
      '<tr><th>Replaces</th><td>' + (replaces
        ? link(current.url, current.title || current.url) +
          (current.url && current.title ? '<br><span class="small">' + e(current.url) + '</span>' : '')
        : 'Nothing — this is a new fact sheet') + '</td></tr>' +
      '<tr><th>Prepared</th><td>' + e(today()) +
        (sheet.lastReviewed ? ' · last reviewed ' + e(sheet.lastReviewed) : '') + '</td></tr>' +
      '</tbody></table>';

    // Sign-off first: it is what the reader is being asked to do.
    html += '<h2>Sign-off</h2>' +
      '<p>Please read the proposed fact sheet below and record your decision: ' +
      '<strong>Approved</strong>, or <strong>Changes requested</strong> with what needs to change.</p>' +
      '<table class="signoff"><thead><tr><th>Name</th><th>Role</th><th>Decision</th>' +
      '<th>Date</th><th>Comments</th></tr></thead><tbody>' +
      people.map(function (x) {
        var decided = x.decision && x.decision !== 'pending';
        return '<tr><td>' + e(x.name) + '</td><td>' + e(x.role) + '</td>' +
          '<td>' + (decided ? e(Data.SIGNOFF_LABEL[x.decision] || x.decision) : '') + '</td>' +
          '<td>' + (decided ? e(x.date) : '') + '</td>' +
          '<td>' + e(x.note).replace(/\n/g, '<br>') + '</td></tr>';
      }).join('') +
      // Room to write in, for anyone added on paper.
      new Array(Math.max(2, 4 - people.length) + 1).join(
        '<tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>') +
      '</tbody></table>';

    html += '<h2>Why replace ' + (replaces ? 'the current fact sheet' : 'nothing — why this sheet is needed') + '</h2>' +
      (Data.plainText(sheet.rationale)
        ? bake(sheet.rationale)
        : '<p class="missing">No reason recorded yet.</p>') +
      (replaces ? '<p class="small">The current version: ' + link(current.url, current.title || current.url) + '</p>' : '');

    html += '<h2>The proposed fact sheet</h2>' +
      '<div class="proposed">' + draftBanner(sheet) +
      '<h2>' + e(sheet.title) + '</h2>' + demoteHeadings(bake(sheet.body)) + '</div>';

    var faqs = (sheet.faqRefs || []).map(function (id) { return Data.state.index.faqs[id]; })
      .filter(Boolean);
    html += '<h2>The FAQ answers it expands on, as they read now</h2>' +
      (faqs.length
        ? faqs.map(function (q) {
            var tabId = q.publish && q.publish.tabId;
            var tab = tabId ? Data.state.library.publishTabs.find(function (t) { return t.id === tabId; }) : null;
            return '<div class="faq">' +
              '<h3>' + e(Data.plainText(q.q)) + '</h3>' +
              '<p class="small">' + (tab
                ? 'FAQ page, ' + link(PUBLIC_FAQ + '#' + tabId, Data.plainText(tab.label) + ' tab')
                : 'Not on the public FAQ page') +
              ' · ' + e(q.status || 'no status') + '</p>' +
              bake(q.a) + '</div>';
          }).join('')
        : '<p class="missing">No related FAQ answers recorded.</p>');

    var vars = Data.variablesIn(sheet.body);
    html += '<h2>Where the values come from</h2>' +
      (vars.length
        ? '<p>Each fee, time, number and link in the proposed fact sheet, and the published document behind it.</p>' +
          '<table class="sources"><thead><tr><th>Value</th><th>What it is</th><th>Source</th>' +
          '<th>Verified</th></tr></thead><tbody>' +
          vars.map(function (v) {
            var src = v.source || {};
            var value = v.internal === true ? WITHHELD : v.value;
            var source;
            if (v.internal === true) source = '<span class="missing">Internal — must not be published</span>';
            else if (!Data.hasSource(v)) source = '<span class="missing">No source recorded</span>';
            else {
              source = link(src.url, src.title || src.url) +
                (src.excerpt ? '<br><span class="small">' + e(src.excerpt) + '</span>' : '');
            }
            return '<tr><td class="val">' + e(value) + '</td>' +
              '<td>' + e(v.question || '') + '</td><td>' + source + '</td>' +
              '<td>' + (v.status === 'current'
                ? 'Yes' + (v.lastVerified ? ', ' + e(v.lastVerified) : '') +
                  (v.verifiedBy ? ' (' + e(v.verifiedBy) + ')' : '')
                : '<span class="missing">' + e(v.status === 'stale' ? 'Stale' : 'Not yet') + '</span>') +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small">The fact sheet uses no stored values.</p>');

    return html + '<p class="small foot">Prepared in Process Hub on ' + e(today()) + '.</p>';
  }

  // ---- Word ----------------------------------------------------------------

  var WORD_CSS = [
    '@page Section1{size:595.3pt 841.9pt;margin:62pt 62pt 62pt 62pt}',
    'div.Section1{page:Section1}',
    'body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.35;color:#111}',
    'h1{font-size:20pt;margin:0 0 8pt}',
    'h2{font-size:15pt;margin:16pt 0 6pt}',
    'h3{font-size:12.5pt;margin:12pt 0 4pt}',
    'h4{font-size:11.5pt;margin:10pt 0 4pt}',
    'p{margin:0 0 6pt}',
    'p.check{margin:0 0 4pt 12pt}',
    'th{background:#eeeeee;text-align:left;vertical-align:top}',
    'td{vertical-align:top}',
    '.small{font-size:9pt;color:#555}',
    '.kicker{font-size:9pt;text-transform:uppercase;letter-spacing:1pt;color:#555}',
    '.banner{font-size:9pt;font-weight:bold;color:#8a5a00}',
    '.missing{color:#a33}',
    '.val{font-weight:bold}'
  ].join('\n');

  function wordDocument(title, body) {
    return '﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n' +
      '<head>\n<meta charset="utf-8">\n<title>' + e(title) + '</title>\n' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom>' +
      '<w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n' +
      '<style>\n' + WORD_CSS + '\n</style>\n</head>\n' +
      '<body>\n<div class="Section1">\n' + forWord(body) + '\n</div>\n</body>\n</html>\n';
  }

  function word(id) {
    var sheet = sheetOf(id);
    if (!sheet) return;
    Exporter.download(slug(sheet.title) + '.doc', wordDocument(sheet.title, sheetHtml(sheet)),
      'application/msword');
  }

  function packWord(id) {
    var sheet = sheetOf(id);
    if (!sheet) return;
    Exporter.download('review-pack-' + slug(sheet.title) + '.doc',
      wordDocument('Review pack — ' + sheet.title, packHtml(sheet)), 'application/msword');
  }

  // ---- print, or save as PDF -----------------------------------------------

  var PRINT_CSS = [
    '*,*::before,*::after{box-sizing:border-box}',
    'body{margin:0;background:#F5F7FA;font-family:Arial,Helvetica,sans-serif;font-size:15px;',
    'line-height:1.6;color:#1D1D1F}',
    '.bar{position:sticky;top:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px;',
    'padding:10px 16px;background:#fff;border-bottom:1px solid rgba(0,0,0,.1);font-size:13px;color:#6E6E73}',
    '.bar button{font:inherit;font-size:14px;font-weight:600;padding:6px 14px;border-radius:7px;',
    'border:1px solid #0A66C2;background:#0A66C2;color:#fff;cursor:pointer}',
    'main{max-width:780px;margin:24px auto 60px;background:#fff;padding:44px 52px;',
    'border:1px solid rgba(0,0,0,.08);border-radius:6px}',
    'h1{font-size:26px;line-height:1.25;margin:0 0 14px}',
    'h2{font-size:19px;margin:28px 0 8px}',
    'h3{font-size:16px;margin:20px 0 6px}',
    'h4{font-size:14.5px;margin:16px 0 6px}',
    'p{margin:0 0 10px}',
    'ul,ol{margin:6px 0 12px 22px;padding:0}',
    'li{margin-bottom:4px}',
    'a{color:#0A66C2}',
    'ul.checklist{list-style:none;margin-left:0}',
    'ul.checklist li{position:relative;padding-left:28px}',
    'ul.checklist li::before{content:"";position:absolute;left:2px;top:.28em;width:14px;height:14px;',
    'border:1.5px solid #555;border-radius:3px}',
    'table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13.5px}',
    'th,td{border:1px solid #C7C7D6;padding:7px 10px;text-align:left;vertical-align:top}',
    'th{background:#F0F0F8}',
    'table.facts th{width:22%}',
    'table.signoff tr.blank td{height:34px}',
    '.note{background:#f0f0f8;border-left:3px solid #2d2d7a;padding:8px 12px;margin:10px 0}',
    '.warn{background:#fff8e6;border-left:3px solid #e0a800;padding:8px 12px;margin:10px 0}',
    '.term{background:#eef4ee;border-left:3px solid #3a7a3a;padding:8px 12px;margin:10px 0}',
    '.small{font-size:12px;color:#6E6E73}',
    '.kicker{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6E6E73;font-weight:700;margin:0}',
    '.banner{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;color:#8A6314;',
    'background:#FBF0DC;border-radius:4px;padding:2px 8px}',
    '.missing{color:#B42318}',
    '.val{font-weight:700;width:24%;overflow-wrap:anywhere;word-break:break-word}',
    '.proposed{border:1px solid #C7C7D6;border-radius:6px;padding:18px 22px;margin:10px 0 18px}',
    '.faq{border-left:3px solid #C7C7D6;padding-left:14px;margin:14px 0}',
    '.foot{margin-top:28px}',
    '@media (max-width:700px){main{margin:0;padding:22px 16px;border:none;border-radius:0}',
    'table{font-size:12px}th,td{padding:5px 6px}}',
    '@media print{body{background:#fff}.bar{display:none}',
    'main{max-width:none;margin:0;padding:0;border:none}',
    'h2,h3{break-after:avoid}tr,.note,.warn,.term{break-inside:avoid}',
    '@page{size:A4;margin:18mm}}'
  ].join('');

  function printDocument(title, body) {
    return '<!DOCTYPE html>\n<html lang="en-AU">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>' + e(title) + '</title>\n<style>' + PRINT_CSS + '</style>\n</head>\n<body>\n' +
      '<div class="bar"><button type="button" onclick="window.print()">Print or save as PDF</button>' +
      '<span>To make a PDF, choose “Save as PDF” as the printer.</span></div>\n' +
      '<main>\n' + body + '\n</main>\n</body>\n</html>\n';
  }

  /**
   * A new tab with the page, ready to print. If the browser blocks the tab,
   * the same page downloads instead, to open and print from there.
   */
  function openPrintable(filename, title, body) {
    var html = printDocument(title, body);
    var tab = window.open('', '_blank');
    if (!tab) {
      Exporter.download(filename, html, 'text/html');
      return;
    }
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
  }

  function print(id) {
    var sheet = sheetOf(id);
    if (!sheet) return;
    openPrintable(slug(sheet.title) + '.html', sheet.title, sheetHtml(sheet));
  }

  function packPrint(id) {
    var sheet = sheetOf(id);
    if (!sheet) return;
    openPrintable('review-pack-' + slug(sheet.title) + '.html', 'Review pack — ' + sheet.title,
      packHtml(sheet));
  }

  global.FactSheetExport = {
    word: word,
    print: print,
    packWord: packWord,
    packPrint: packPrint,
    sheetHtml: sheetHtml,
    packHtml: packHtml
  };
}(window));
