/* ===========================================================================
   rules.js — content rules.

   A rule is a standing check across the whole corpus. When the organisation
   changes — a system renamed, a form retired, a team restructured — you add a
   rule rather than hunt through 112 processes, and everything that is now
   wrong shows up in the issues register.

   Findings are computed on every load, never stored. Fix the content and the
   finding disappears by itself, which is the whole point: a recorded issue has
   to be ticked off by hand, a rule finding cannot lie about being fixed.

   Rule kinds:
     text     a phrase or pattern that should no longer appear
     empty    a field that ought to be filled in
     stale    a date that has not been touched for N months
     unused   library content nothing references

   Two options narrow what a rule looks at:
     match.caseSensitive / match.wholeWord  (text rules) — so "Merit" the
       retired system is caught but "sufficient merit" is not
     ignoreDraft  skip anything still in draft (or a variable still pending).
       Imported content is all draft, and "never reviewed" is true of every
       item of it — which buries the findings that actually need action.
   =========================================================================== */

(function (global) {
  'use strict';

  var SCOPES = ['process', 'step', 'article', 'faq', 'variable'];

  function rules() {
    return (Data.state.processes && Data.state.processes.rules) || [];
  }

  // ---- what a rule can look at ---------------------------------------------

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

    if (scope === 'article') {
      Data.state.library.articles.forEach(function (a) {
        out.push({
          kind: 'article', obj: a, id: a.id, label: a.title,
          where: 'Knowledge base', route: '#/article/' + a.id,
          text: [a.title, stripTags(a.body)].join('\n')
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

  // ---- evaluation ----------------------------------------------------------

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

  /** Options arrive from selects as strings as well as booleans. */
  function isOn(value) { return value === true || value === 'true'; }

  /** Still being drafted, so a "not reviewed" style finding says nothing new. */
  function isDraft(entity) {
    var obj = entity.kind === 'step' ? entity.process : entity.obj;
    return obj.status === 'draft' || obj.status === 'pending';
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function monthsSince(dateText) {
    if (!dateText) return Infinity;
    // Accepts YYYY-MM-DD, YYYY-MM, and the "August 2026" stamps in the
    // imported FAQ content.
    var parsed = Date.parse(/^\d{4}-\d{2}$/.test(dateText) ? dateText + '-01' : dateText);
    if (isNaN(parsed)) return Infinity;
    return (Date.now() - parsed) / (1000 * 60 * 60 * 24 * 30.44);
  }

  function evaluate(rule) {
    if (rule.enabled === false) return { rule: rule, findings: [], skipped: true };

    var findings = [];
    var scopes = (rule.scope && rule.scope.length ? rule.scope : SCOPES)
      .filter(function (s) { return SCOPES.indexOf(s) !== -1; });
    var skipDraft = isOn(rule.ignoreDraft);
    var skipped = 0;

    // Every entity in the rule's scopes, less any still in draft when the
    // rule says to leave those alone.
    function each(scope, fn) {
      entities(scope).forEach(function (entity) {
        if (skipDraft && isDraft(entity)) { skipped++; return; }
        fn(entity);
      });
    }

    if (rule.kind === 'text') {
      var matcher = buildMatcher(rule);
      if (!matcher) return { rule: rule, findings: [], error: 'No phrase or pattern set.' };
      if (matcher.invalid) {
        return { rule: rule, findings: [], error: 'Invalid pattern: ' + matcher.message };
      }
      scopes.forEach(function (scope) {
        each(scope, function (entity) {
          // Search what a reader would see, so a value held in a variable is
          // still caught.
          var seen = Data.freeze(entity.text);
          var hit = seen.match(matcher);
          if (hit) findings.push(finding(rule, entity, snippet(seen, hit.index, hit[0].length)));
        });
      });
    }

    if (rule.kind === 'empty') {
      scopes.forEach(function (scope) {
        each(scope, function (entity) {
          var value = entity.obj[rule.field];
          var blank = value == null || String(value).trim() === '' ||
            (Array.isArray(value) && !value.length);
          if (blank) findings.push(finding(rule, entity, ''));
        });
      });
    }

    if (rule.kind === 'stale') {
      var limit = Number(rule.months) || 12;
      scopes.forEach(function (scope) {
        each(scope, function (entity) {
          var age = monthsSince(entity.obj[rule.field]);
          if (age >= limit) {
            findings.push(finding(rule, entity,
              entity.obj[rule.field] ? 'last set ' + entity.obj[rule.field] : 'never set'));
          }
        });
      });
    }

    if (rule.kind === 'unused') {
      scopes.forEach(function (scope) {
        each(scope, function (entity) {
          var usage = Data.state.index.usage[entity.id];
          if (!usage || !usage.processes.length) findings.push(finding(rule, entity, ''));
        });
      });
    }

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

  /** Every enabled rule, evaluated, worst severity first. */
  function run() {
    if (cache.index === Data.state.index && cache.results) return cache.results;
    var weight = { high: 0, medium: 1, low: 2 };
    var results = rules().map(evaluate).sort(function (a, b) {
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

  // ---- managing rules ------------------------------------------------------

  function list() { return rules(); }

  function get(id) {
    return rules().find(function (r) { return r.id === id; }) || null;
  }

  function add(rule) {
    var file = Data.state.processes;
    if (!Array.isArray(file.rules)) file.rules = [];
    rule.id = rule.id || 'rule_' + Math.random().toString(36).slice(2, 9);
    rule.created = rule.created || new Date().toISOString().slice(0, 10);
    if (rule.enabled === undefined) rule.enabled = true;
    file.rules.push(rule);
    Edit.touch();
    return rule.id;
  }

  function remove(id) {
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

  /** A starting set, offered when a corpus has no rules yet. */
  function defaults() {
    return [
      {
        id: 'rule_retired_merit',
        name: 'Merit has been replaced by the CRM',
        kind: 'text',
        match: { mode: 'phrase', value: 'Merit', caseSensitive: true, wholeWord: true },
        scope: ['process', 'step', 'article', 'faq'],
        severity: 'high',
        message: 'Still refers to Merit. The CRM replaced it — the request ID now goes ' +
          'to the customer by SMS, so the wording needs rewriting, not just renaming.',
        enabled: true
      },
      {
        id: 'rule_no_owner',
        name: 'Process has no owner',
        kind: 'empty',
        field: 'owner',
        scope: ['process'],
        severity: 'low',
        message: 'No manager is recorded as accountable for this process.',
        enabled: true
      },
      {
        id: 'rule_unreviewed',
        name: 'Process not reviewed in 12 months',
        kind: 'stale',
        field: 'lastReviewed',
        months: 12,
        scope: ['process'],
        ignoreDraft: true,
        severity: 'medium',
        message: 'This process has not been reviewed within the last 12 months.',
        enabled: true
      },
      {
        id: 'rule_unverified_variable',
        name: 'Variable not verified in 12 months',
        kind: 'stale',
        field: 'lastVerified',
        months: 12,
        scope: ['variable'],
        ignoreDraft: true,
        severity: 'medium',
        message: 'This value has not been confirmed by its owning department ' +
          'within the last 12 months.',
        enabled: true
      },
      {
        id: 'rule_unused_article',
        name: 'Article nothing references',
        kind: 'unused',
        scope: ['article'],
        severity: 'low',
        message: 'No process or step links to this article, so nobody will find it.',
        enabled: true
      }
    ];
  }

  global.Rules = {
    SCOPES: SCOPES,
    list: list,
    get: get,
    add: add,
    remove: remove,
    toggle: toggle,
    run: run,
    evaluate: evaluate,
    totals: totals,
    byProcess: byProcess,
    isOn: isOn,
    defaults: defaults
  };
}(window));
