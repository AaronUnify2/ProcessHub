/* ===========================================================================
   rules.js — rules.

   Two sorts of rule share one list.

   Built-in rules are defined here, in code. Each is a quick way through the
   whole of the content (checks.js does the working out):

     Empty fields        every field in the app, and how many leave it empty
     Not touched         every date field older than 1, 3, 6 or 12 months
     Nothing uses it     variables, FAQ answers and fact sheets nothing uses
     Who does this?      instructions that hide who has to act  (writing.js)
     Long sentence       sentences over a set number of words   (writing.js)
     No next step        FAQ answers that never say what to do  (writing.js)

   They cannot be changed, copied or deleted — only switched off, and given
   the one or two settings each has (how many months, how many words, what
   never to flag). applyBuiltIns() puts any that are missing back, with their
   fixed settings, every time the content loads.

   Text rules are the one kind people add: text that should no longer
   appear — a system renamed, a form retired, a team that is now called
   something else. A text rule checks everything it applies to and lists
   what it finds in the issues register; where it applies to FAQ answers or
   fact sheets, the editors also flag it as you type.

   Findings are computed, never stored. Fix the content and the finding
   disappears by itself: a recorded issue has to be ticked off by hand, a
   rule finding cannot lie about being fixed.

   Text rule options:
     match.mode            'phrase' (exact wording) or 'regex' (a pattern)
     match.caseSensitive / match.wholeWord — so "Merit" the retired system is
                           caught but "sufficient merit" is not
     suggest               what to say instead, shown with the flag
     ignoreDraft           skip anything still in draft
   =========================================================================== */

(function (global) {
  'use strict';

  var SCOPES = ['process', 'step', 'factsheet', 'faq', 'variable'];

  function rules() {
    return (Data.state.processes && Data.state.processes.rules) || [];
  }

  // ---- built-in rules ------------------------------------------------------

  // The settings that are fixed. Anything else on a built-in rule — whether
  // it is switched on, its months, words or "never flag" list, when it was
  // added — stays with the content.
  var BUILT_IN = {
    rule_b_empty: {
      name: 'Empty fields',
      kind: 'empty',
      summary: 'Every field in Process Hub, and how many variables, FAQ answers, fact sheets, ' +
        'processes and steps leave it empty. Pick a field to see them.'
    },
    rule_b_stale: {
      name: 'Not touched',
      kind: 'stale',
      defaults: { months: 12 },
      summary: 'Every date that says when something was last reviewed, verified or edited, ' +
        'and how many are older than the period you choose. Anything with no date, or one ' +
        'that can\'t be read, counts as never touched.'
    },
    rule_b_unused: {
      name: 'Nothing uses it',
      kind: 'unused',
      summary: 'Variables no process, FAQ answer or fact sheet uses, and FAQ answers and fact ' +
        'sheets no process step attaches. Some are fine — an answer can stand on its own — ' +
        'but each is worth a look.'
    },
    rule_w_passive: {
      name: 'Who does this?',
      kind: 'passive',
      scope: ['faq', 'factsheet'],
      severity: 'low',
      defaults: { allow: '' },
      message: 'This says something must be done without saying who does it. If it is the ' +
        'reader, start with the action: “Complete the form…” rather than “The form must be completed…”.',
      summary: 'Finds instructions that say something must happen without saying who does it — ' +
        '“The form must be completed”. Is that the reader? Council? Their builder?'
    },
    rule_w_long: {
      name: 'Long sentence',
      kind: 'long',
      scope: ['faq', 'factsheet'],
      severity: 'low',
      defaults: { words: 25 },
      message: 'A long sentence. Can it be two sentences, or a list?',
      summary: 'Sentences in FAQ answers and fact sheets longer than the number of words you ' +
        'choose. Each list item, table cell and heading counts on its own.'
    },
    rule_w_nextstep: {
      name: 'No next step',
      kind: 'nextstep',
      scope: ['faq'],
      severity: 'medium',
      message: 'Every answer ends with what the reader does now — a link, a number to call ' +
        'and who to ask for, an email address, or another answer to read.',
      summary: 'FAQ answers that never tell the reader what to do next: no link, no phone ' +
        'number or email address, and no “see <another answer>”.'
    }
  };
  // Writing checks first: they are the ones worked through day to day.
  var BUILT_IN_ORDER = ['rule_w_passive', 'rule_w_long', 'rule_w_nextstep',
    'rule_b_empty', 'rule_b_stale', 'rule_b_unused'];
  var WRITING_KINDS = { passive: true, long: true, nextstep: true };
  var FIXED = ['name', 'kind', 'scope', 'severity', 'message'];

  function isBuiltIn(rule) { return !!(rule && BUILT_IN[rule.id]); }

  /** A built-in check on how FAQ answers and fact sheets are written, rather than on housekeeping. */
  function isWriting(rule) { return isBuiltIn(rule) && !!WRITING_KINDS[BUILT_IN[rule.id].kind]; }

  function builtInSummary(rule) { return (BUILT_IN[rule.id] || {}).summary || ''; }

  /**
   * Bring the content's rules into line, on every load:
   *  - each built-in rule is there, with its fixed settings;
   *  - "word or phrase to avoid" rules become text rules (they were the
   *    same thing);
   *  - rules of any other kind are dropped — the built-in checks replace
   *    them ("no owner", "not reviewed in 12 months" and the like).
   */
  function applyBuiltIns(file) {
    if (!file) return;
    if (!Array.isArray(file.rules)) file.rules = [];

    file.rules = file.rules.filter(function (r) {
      if (BUILT_IN[r.id]) return true;
      if (r.kind === 'avoid') r.kind = 'text';
      if (r.kind !== 'text') return false;
      delete r.live;
      return true;
    });

    BUILT_IN_ORDER.forEach(function (id) {
      var def = BUILT_IN[id];
      var rule = file.rules.find(function (r) { return r.id === id; });
      if (!rule) {
        rule = { id: id, enabled: true, created: new Date().toISOString().slice(0, 10) };
        file.rules.push(rule);
      }
      FIXED.forEach(function (key) {
        if (def[key] === undefined) { delete rule[key]; return; }
        rule[key] = Array.isArray(def[key]) ? def[key].slice() : def[key];
      });
      Object.keys(def.defaults || {}).forEach(function (key) {
        if (rule[key] === undefined) rule[key] = def.defaults[key];
      });
    });
  }

  // ---- what a text rule can look at -----------------------------------------

  /** Every entity a rule may be scoped to, with the text a reader would see. */
  function entities(scope) {
    var out = [];

    if (scope === 'process' || scope === 'step') {
      Data.state.processes.processes.forEach(function (p) {
        if (scope === 'process') {
          out.push({
            kind: 'process', obj: p, id: p.id, label: p.name,
            where: Data.taxonomyPath(p.taxonomyId),
            route: '#/process/' + p.id,
            text: [p.name, p.purpose, p.resolutionDefinition, p.entryPoint].join('\n')
          });
        } else {
          p.steps.forEach(function (s) {
            out.push({
              kind: 'step', obj: s, id: s.id, label: s.title,
              where: p.name, route: '#/process/' + p.id, process: p,
              text: [s.title, s.sop, s.script, s.completionTrigger]
                .concat((s.checks || []).map(function (c) { return c.text; })).join('\n')
            });
          });
        }
      });
    }

    if (scope === 'factsheet') {
      Data.state.library.factSheets.forEach(function (s) {
        out.push({
          kind: 'factsheet', obj: s, id: s.id, label: s.title,
          where: 'Fact sheet', route: '#/factsheet/' + s.id,
          text: [s.title, s.summary, stripTags(s.body)].join('\n')
        });
      });
    }

    if (scope === 'faq') {
      Data.state.library.faqs.forEach(function (f) {
        out.push({
          kind: 'faq', obj: f, id: f.id, label: f.q,
          where: 'FAQ · ' + ((f.publish && f.publish.tabId) || ''),
          route: '#/faq/' + f.id,
          text: [f.q, stripTags(f.a)].join('\n')
        });
      });
    }

    if (scope === 'variable') {
      Data.state.variables.variables.forEach(function (v) {
        out.push({
          kind: 'variable', obj: v, id: v.id, label: v.value,
          where: Data.taxonomyPath(v.ownerId), route: '#/variable/' + v.id,
          text: [v.value, v.question, v.note].join('\n')
        });
      });
    }

    return out;
  }

  function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  // ---- evaluating text rules ------------------------------------------------

  function buildMatcher(rule) {
    var match = rule.match || {};
    var value = String(match.value || '');
    if (!value) return null;
    try {
      var pattern = match.mode === 'regex' ? value : escapeRegex(value);
      if (isOn(match.wholeWord)) pattern = '\\b(?:' + pattern + ')\\b';
      return new RegExp(pattern, isOn(match.caseSensitive) ? '' : 'i');
    } catch (err) {
      return { invalid: true, message: err.message };
    }
  }

  /** The rule's text pattern as a RegExp, for the writing check too. */
  function matcherFor(rule) { return buildMatcher(rule); }

  /** Options arrive from selects as strings as well as booleans. */
  function isOn(value) { return value === true || value === 'true'; }

  /** Still being drafted. */
  function isDraft(entity) {
    var obj = entity.kind === 'step' ? entity.process : entity.obj;
    return obj.status === 'draft' || obj.status === 'pending';
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function evaluate(rule) {
    if (rule.enabled === false) return { rule: rule, findings: [], skipped: true };
    if (rule.kind !== 'text') return { rule: rule, findings: [] };

    var findings = [];
    var scopes = (rule.scope && rule.scope.length ? rule.scope : SCOPES)
      .filter(function (s) { return SCOPES.indexOf(s) !== -1; });
    var skipDraft = isOn(rule.ignoreDraft);
    var skipped = 0;

    var matcher = buildMatcher(rule);
    if (!matcher) return { rule: rule, findings: [], error: 'No phrase or pattern set.' };
    if (matcher.invalid) {
      return { rule: rule, findings: [], error: 'Invalid pattern: ' + matcher.message };
    }
    scopes.forEach(function (scope) {
      entities(scope).forEach(function (entity) {
        if (skipDraft && isDraft(entity)) { skipped++; return; }
        // Search what a reader would see, so a value held in a variable is
        // still caught.
        var seen = Data.freeze(entity.text);
        var hit = seen.match(matcher);
        if (hit) findings.push(finding(rule, entity, snippet(seen, hit.index, hit[0].length)));
      });
    });

    return { rule: rule, findings: findings, draftsSkipped: skipped };
  }

  function finding(rule, entity, detail) {
    return {
      ruleId: rule.id,
      severity: rule.severity || 'medium',
      message: rule.message || rule.name,
      kind: entity.kind,
      id: entity.id,
      label: entity.label || entity.id,
      where: entity.where,
      route: entity.route,
      detail: detail
    };
  }

  function snippet(text, index, length) {
    var start = Math.max(0, index - 45);
    var end = Math.min(text.length, index + length + 45);
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }

  // Results are kept until the content next changes. Every edit rebuilds
  // the index, so a new index object means the cache is stale.
  var cache = { index: null, results: null };

  /**
   * Every enabled text rule, evaluated, worst severity first. These are what
   * the issues register, the coverage report and the exports count — the
   * built-in rules have pages of their own on the Rules tab.
   */
  function run() {
    if (cache.index === Data.state.index && cache.results) return cache.results;
    var weight = { high: 0, medium: 1, low: 2 };
    var results = rules().filter(function (r) { return !isBuiltIn(r); }).map(evaluate)
      .sort(function (a, b) {
        return (weight[a.rule.severity] || 1) - (weight[b.rule.severity] || 1);
      });
    cache = { index: Data.state.index, results: results };
    return results;
  }

  /** Findings per process, for the coverage report and the tree. */
  function byProcess() {
    var out = {};
    run().forEach(function (result) {
      if (result.skipped) return;
      result.findings.forEach(function (f) {
        var m = /^#\/process\/(.+)$/.exec(f.route || '');
        if (m) out[m[1]] = (out[m[1]] || 0) + 1;
      });
    });
    return out;
  }

  function totals() {
    var out = { rules: 0, findings: 0, high: 0, medium: 0, low: 0 };
    run().forEach(function (result) {
      if (result.skipped) return;
      out.rules++;
      result.findings.forEach(function (f) {
        out.findings++;
        out[f.severity] = (out[f.severity] || 0) + 1;
      });
    });
    return out;
  }

  /** How many a rule finds at the moment, built in or not. */
  function count(rule) {
    if (rule.enabled === false) return 0;
    if (isBuiltIn(rule)) return global.Checks ? Checks.headline(rule).count : 0;
    var result = run().find(function (r) { return r.rule.id === rule.id; });
    return result ? result.findings.length : 0;
  }

  // ---- managing rules ------------------------------------------------------

  /** Built-in rules first, in their set order, then text rules as added. */
  function list() {
    var all = rules();
    var builtIn = BUILT_IN_ORDER.map(function (id) {
      return all.find(function (r) { return r.id === id; });
    }).filter(Boolean);
    return builtIn.concat(all.filter(function (r) { return !isBuiltIn(r); }));
  }

  function textRules() {
    return rules().filter(function (r) { return !isBuiltIn(r); });
  }

  function get(id) {
    return rules().find(function (r) { return r.id === id; }) || null;
  }

  /** A new text rule. */
  function add(rule) {
    var file = Data.state.processes;
    if (!Array.isArray(file.rules)) file.rules = [];
    rule.id = rule.id || 'rule_' + Math.random().toString(36).slice(2, 9);
    rule.kind = 'text';
    rule.created = rule.created || new Date().toISOString().slice(0, 10);
    if (rule.enabled === undefined) rule.enabled = true;
    file.rules.push(rule);
    Edit.touch();
    return rule.id;
  }

  function remove(id) {
    if (BUILT_IN[id]) return;
    var file = Data.state.processes;
    file.rules = (file.rules || []).filter(function (r) { return r.id !== id; });
    Edit.touch();
  }

  function toggle(id) {
    var rule = get(id);
    if (!rule) return;
    rule.enabled = rule.enabled === false;
    Edit.touch();
  }

  global.Rules = {
    SCOPES: SCOPES,
    list: list,
    isWriting: isWriting,
    textRules: textRules,
    get: get,
    add: add,
    remove: remove,
    toggle: toggle,
    run: run,
    evaluate: evaluate,
    totals: totals,
    count: count,
    byProcess: byProcess,
    isOn: isOn,
    matcherFor: matcherFor,
    isBuiltIn: isBuiltIn,
    builtInSummary: builtInSummary,
    applyBuiltIns: applyBuiltIns
  };
}(window));
