/* ===========================================================================
   checks.js — the built-in checks behind the Rules tab.

   Each built-in rule is a quick way through the whole of the content:

     empty     every field in the app, and how many items leave it empty
     stale     every date field, and how many are older than 1, 3, 6 or 12
               months (or have no date at all)
     unused    variables nothing uses, and FAQ answers and fact sheets no
               process attaches
     passive · long · nextstep
               the writing checks (writing.js), across every FAQ answer and
               fact sheet

   Everything is worked out from the content each time it is asked for and
   never stored, so fixing something makes it drop off the list by itself.

   Results come back as items — one variable, FAQ answer, fact sheet, process
   or step each — that the Rules tab lists by type (variables, FAQ answers,
   fact sheets, processes) and then by department.
   =========================================================================== */

(function (global) {
  'use strict';

  // The order results are listed in.
  var TYPES = [
    { value: 'variable', label: 'Variables', one: 'Variable' },
    { value: 'faq', label: 'FAQ answers', one: 'FAQ answer' },
    { value: 'factsheet', label: 'Fact sheets', one: 'Fact sheet' },
    { value: 'process', label: 'Processes', one: 'Process' }
  ];

  function typeLabel(type, one) {
    var found = TYPES.find(function (t) { return t.value === type; });
    return found ? (one ? found.one : found.label) : type;
  }

  function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** The top-level department a taxonomy id sits under, by name. */
  function department(taxonomyId) {
    var top = taxonomyId ? Data.topDepartment(taxonomyId) : null;
    return top ? { id: top.id, name: top.name } : { id: '', name: 'No department' };
  }

  // ---- the items -----------------------------------------------------------

  /** Everything the checks look at, as items with what a list needs. */
  function items() {
    var out = [];
    Data.state.variables.variables.forEach(function (v) {
      out.push({ type: 'variable', id: v.id, obj: v, label: v.value || v.id,
        sub: v.question || '', dept: department(v.ownerId), route: '#/variable/' + v.id });
    });
    Data.state.library.faqs.forEach(function (f) {
      out.push({ type: 'faq', id: f.id, obj: f, label: f.q || f.id,
        sub: (f.publish && f.publish.tabId) ? 'FAQ · ' + f.publish.tabId : 'FAQ · not published',
        dept: department(f.ownerId), route: '#/faq/' + f.id });
    });
    Data.state.library.factSheets.forEach(function (s) {
      out.push({ type: 'factsheet', id: s.id, obj: s, label: s.title || s.id,
        sub: 'Fact sheet · ' + (s.status || 'draft'), dept: department(s.ownerId),
        route: '#/factsheet/' + s.id });
    });
    Data.state.processes.processes.forEach(function (p) {
      out.push({ type: 'process', id: p.id, obj: p, label: p.name || p.id,
        sub: Data.taxonomyPath(p.taxonomyId), dept: department(p.taxonomyId),
        route: '#/process/' + p.id });
    });
    return out;
  }

  /** Every step, as an item listed with its process. */
  function steps() {
    var out = [];
    Data.state.processes.processes.forEach(function (p) {
      p.steps.forEach(function (s, i) {
        out.push({ type: 'process', step: true, id: s.id, obj: s, process: p,
          label: p.name + ' › ' + (i + 1) + '. ' + Data.freeze(s.title || 'Untitled step'),
          sub: 'Step · ' + (s.type || 'action'), dept: department(p.taxonomyId),
          route: '#/process/' + p.id });
      });
    });
    return out;
  }

  // ---- empty fields --------------------------------------------------------

  function blank(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return !value.length;
    return String(value).trim() === '';
  }

  /**
   * Every field worth filling in, by what it belongs to. `get` reads the
   * value; `applies` leaves out the items the field does not apply to.
   */
  var FIELDS = [
    { type: 'variable', key: 'question', label: 'Verification question' },
    { type: 'variable', key: 'ownerId', label: 'Owning department' },
    { type: 'variable', key: 'note', label: 'Note' },
    { type: 'variable', key: 'lastVerified', label: 'Last verified' },
    { type: 'variable', key: 'verifiedBy', label: 'Verified by' },
    { type: 'variable', key: 'source', label: 'Public source',
      applies: function (v) { return v.internal !== true; },
      empty: function (v) { return !Data.hasSource(v); } },

    { type: 'faq', key: 'a', label: 'Answer', empty: function (f) { return !stripTags(f.a); } },
    { type: 'faq', key: 'ownerId', label: 'Owning department' },
    { type: 'faq', key: 'lastReviewed', label: 'Last reviewed' },
    { type: 'faq', key: 'tab', label: 'Tab (not published)',
      empty: function (f) { return !(f.publish && f.publish.tabId); } },

    { type: 'factsheet', key: 'summary', label: 'Summary' },
    { type: 'factsheet', key: 'body', label: 'The fact sheet', empty: function (s) { return !stripTags(s.body); } },
    { type: 'factsheet', key: 'ownerId', label: 'Owning department' },
    { type: 'factsheet', key: 'lastReviewed', label: 'Last reviewed' },
    { type: 'factsheet', key: 'current', label: 'Current fact sheet link',
      empty: function (s) { return !(s.current && String(s.current.url || '').trim()); } },
    { type: 'factsheet', key: 'rationale', label: 'Why replace it', empty: function (s) { return !stripTags(s.rationale); } },
    { type: 'factsheet', key: 'faqRefs', label: 'Related FAQ answers' },
    { type: 'factsheet', key: 'signoffs', label: 'Sign-off' },

    { type: 'process', key: 'owner', label: 'Owner' },
    { type: 'process', key: 'purpose', label: 'Purpose' },
    { type: 'process', key: 'entryPoint', label: 'Entry point' },
    { type: 'process', key: 'resolutionDefinition', label: 'Resolved when' },
    { type: 'process', key: 'lastReviewed', label: 'Last reviewed' },

    { type: 'step', key: 'script', label: 'Say this' },
    { type: 'step', key: 'sop', label: 'Do this' },
    { type: 'step', key: 'completionTrigger', label: 'Done when' },
    { type: 'step', key: 'departmentId', label: 'Department' },
    { type: 'step', key: 'responsibleRole', label: 'Role' },
    { type: 'step', key: 'timeframe', label: 'Timeframe' },
    { type: 'step', key: 'escalationPoint', label: 'Escalation' }
  ];

  function fieldId(field) { return field.type + '.' + field.key; }

  /** One row per field: how many items leave it empty, out of how many. */
  function emptyFields() {
    return cached('empty', function () {
      var all = items();
      var allSteps = steps();
      return FIELDS.map(function (field) {
        var pool = (field.type === 'step' ? allSteps : all.filter(function (it) {
          return it.type === field.type;
        })).filter(function (it) { return !field.applies || field.applies(it.obj); });
        var found = pool.filter(function (it) {
          return field.empty ? field.empty(it.obj) : blank(it.obj[field.key]);
        });
        return {
          id: fieldId(field), field: field,
          type: field.type === 'step' ? 'process' : field.type,
          what: field.type === 'step' ? 'Process steps' : typeLabel(field.type),
          label: field.label, total: pool.length, items: found
        };
      });
    });
  }

  // ---- dates not touched ---------------------------------------------------

  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'];

  /**
   * A date as written in the content: 2026-10-24, 2026-10, or free text
   * that starts with a month and year ("October 2026 — draft").
   */
  function parseDate(text) {
    text = String(text || '').trim();
    if (!text) return null;
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(text);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
    m = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i.exec(text);
    if (m) return new Date(Number(m[2]), MONTHS.indexOf(m[1].toLowerCase()), 1);
    return null;
  }

  function monthsSince(date) {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  }

  var DATE_FIELDS = [
    { type: 'variable', key: 'lastVerified', label: 'Last verified' },
    { type: 'variable', key: 'source.checked', label: 'Source last checked',
      applies: function (v) { return Data.hasSource(v); },
      get: function (v) { return v.source && v.source.checked; } },
    { type: 'faq', key: 'lastReviewed', label: 'Last reviewed' },
    { type: 'factsheet', key: 'lastReviewed', label: 'Last reviewed' },
    { type: 'process', key: 'lastReviewed', label: 'Last reviewed' },
    { type: 'process', key: 'updated', label: 'Last edited' }
  ];

  var PERIODS = [1, 3, 6, 12];

  /**
   * One row per date field: the items older than `months`, counting those
   * with no date (or one that can't be read) as never touched.
   */
  function staleDates(months) {
    months = Number(months) || 12;
    return cached('stale:' + months, function () {
      var all = items();
      return DATE_FIELDS.map(function (field) {
        var pool = all.filter(function (it) {
          return it.type === field.type && (!field.applies || field.applies(it.obj));
        });
        var found = [];
        var undated = 0;
        pool.forEach(function (it) {
          var raw = field.get ? field.get(it.obj) : it.obj[field.key];
          var date = parseDate(raw);
          if (!date) {
            undated++;
            found.push(withDetail(it, raw ? 'can\'t read “' + raw + '”' : 'no date'));
          } else if (monthsSince(date) >= months) {
            found.push(withDetail(it, String(raw)));
          }
        });
        return {
          id: field.type + '.' + field.key, field: field, type: field.type,
          what: typeLabel(field.type), label: field.label,
          total: pool.length, items: found, undated: undated
        };
      });
    });
  }

  function withDetail(item, detail) {
    var copy = {};
    Object.keys(item).forEach(function (k) { copy[k] = item[k]; });
    copy.detail = detail;
    return copy;
  }

  // ---- nothing uses it -----------------------------------------------------

  /** Who relates a FAQ answer from a fact sheet, by FAQ id. */
  function relatedFromSheets() {
    var out = {};
    Data.state.library.factSheets.forEach(function (s) {
      (s.faqRefs || []).forEach(function (id) { (out[id] = out[id] || []).push(s.title); });
    });
    return out;
  }

  function unused() {
    return cached('unused', function () {
      var usage = Data.state.index.usage;
      var all = items();
      var related = relatedFromSheets();
      function of(type) { return all.filter(function (it) { return it.type === type; }); }
      return [
        {
          id: 'variable', type: 'variable', what: 'Variables',
          label: 'Not used in any process, FAQ answer or fact sheet',
          total: of('variable').length,
          items: of('variable').filter(function (it) { return !usage[it.id]; })
        },
        {
          id: 'faq', type: 'faq', what: 'FAQ answers', label: 'Not attached to any process',
          total: of('faq').length,
          items: of('faq').filter(function (it) {
            return !(usage[it.id] && usage[it.id].processes.length);
          }).map(function (it) {
            return related[it.id] ? withDetail(it, 'related to ' + related[it.id].join(', ')) : it;
          })
        },
        {
          id: 'factsheet', type: 'factsheet', what: 'Fact sheets', label: 'Not attached to any process',
          total: of('factsheet').length,
          items: of('factsheet').filter(function (it) {
            return !(usage[it.id] && usage[it.id].processes.length);
          })
        }
      ];
    });
  }

  // ---- the writing checks, across everything --------------------------------

  /** Every FAQ answer and fact sheet the writing rule flags. */
  function writing(rule) {
    var key = 'writing:' + rule.id + ':' + (rule.words || '') + ':' + (rule.allow || '');
    return cached(key, function () {
      var out = [];
      items().forEach(function (it) {
        if (it.type !== 'faq' && it.type !== 'factsheet') return;
        if (rule.kind === 'nextstep' && it.type !== 'faq') return;
        var html = it.type === 'faq' ? it.obj.a : it.obj.body;
        var found = Writing.findingFor(rule, it.type, html);
        if (found) {
          var copy = withDetail(it, found.detail);
          copy.count = found.count;
          out.push(copy);
        }
      });
      return out;
    });
  }

  // ---- for the Rules tab ---------------------------------------------------

  /** The one number a built-in rule is summed up by. */
  function headline(rule) {
    if (rule.kind === 'empty') {
      var rows = emptyFields();
      return { count: rows.reduce(function (n, r) { return n + r.items.length; }, 0),
        words: 'empty fields across ' + rows.length + ' fields' };
    }
    if (rule.kind === 'stale') {
      var seen = {};
      staleDates(rule.months).forEach(function (r) {
        r.items.forEach(function (it) { seen[it.type + ':' + it.id] = true; });
      });
      return { count: Object.keys(seen).length,
        words: 'items with a date older than ' + (Number(rule.months) || 12) + ' months, or none' };
    }
    if (rule.kind === 'unused') {
      return { count: unused().reduce(function (n, r) { return n + r.items.length; }, 0),
        words: 'variables, answers and fact sheets nothing uses' };
    }
    var list = writing(rule);
    var words = { passive: 'answers and sheets with an instruction that hides who acts',
      long: 'answers and sheets with a sentence over ' + (Number(rule.words) || 25) + ' words',
      nextstep: 'FAQ answers with no next step' };
    return { count: list.length, words: words[rule.kind] || '' };
  }

  /**
   * Items as groups for listing: by type in the standard order, then by
   * department (A–Z, "No department" last), each group sorted by name.
   */
  function group(list, filters) {
    filters = filters || {};
    var groups = [];
    TYPES.forEach(function (t) {
      if (filters.type && filters.type !== t.value) return;
      var ofType = list.filter(function (it) {
        return it.type === t.value && (!filters.dept || it.dept.id === filters.dept);
      });
      if (!ofType.length) return;
      var byDept = {};
      ofType.forEach(function (it) {
        var key = it.dept.id || '~';
        (byDept[key] = byDept[key] || { dept: it.dept, items: [] }).items.push(it);
      });
      var depts = Object.keys(byDept).map(function (k) { return byDept[k]; }).sort(function (a, b) {
        if (!a.dept.id) return 1;
        if (!b.dept.id) return -1;
        return a.dept.name.localeCompare(b.dept.name);
      });
      depts.forEach(function (d) {
        d.items.sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
      });
      groups.push({ type: t.value, label: t.label, count: ofType.length, depts: depts });
    });
    return groups;
  }

  /** The top-level departments, for a filter. */
  function departments() {
    return Data.state.processes.taxonomy.filter(function (t) { return !t.parentId; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name); });
  }

  // Worked out once per version of the content. Every edit rebuilds the
  // index, so a new index object means everything here is out of date.
  var cache = { index: null, values: {} };

  function cached(key, make) {
    if (cache.index !== Data.state.index) cache = { index: Data.state.index, values: {} };
    if (!(key in cache.values)) cache.values[key] = make();
    return cache.values[key];
  }

  global.Checks = {
    TYPES: TYPES,
    PERIODS: PERIODS,
    typeLabel: typeLabel,
    emptyFields: emptyFields,
    staleDates: staleDates,
    unused: unused,
    writing: writing,
    headline: headline,
    group: group,
    departments: departments,
    parseDate: parseDate
  };
}(window));
