/*
 * Grade calculation logic, kept separate from the page code (app.js).
 * Exposed as window.GradeCalc in the browser (and module.exports in Node).
 *
 * Rules:
 *  - An assessment's percentage is score / outOf * 100.
 *  - Term mark = weighted average of assessment percentages, using type weights.
 *    An assessment can override its type's weight with its own weight.
 *    Users can add their own assessment types (settings.customTypes).
 *  - AP Physics: each K/T/C/A category is its own weighted average (blank marks
 *    are skipped for that category only); the term is the categories combined
 *    using their weights.
 *  - Parts with no marks are left out and the remaining weights are rescaled.
 *  - AP boost = min(mark * 1.05, 100).
 *  - Nothing is rounded here; rounding is only for display.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GradeCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOOST = 1.05;
  var EPS = 1e-9;

  var COURSES = {
    physics: {
      id: 'physics', name: 'AP Physics 12', shortName: 'AP Physics', ap: true,
      parts: ['term', 'final', 'attendance'],
      components: { term: 65, final: 25, attendance: 10 },
      categories: { K: 20, T: 25, C: 10, A: 10 },
      types: { test: 1, quiz: 0.5, lab: 5 / 6 }
    },
    calculus: {
      id: 'calculus', name: 'AP Calculus', shortName: 'AP Calc', ap: true,
      parts: ['term', 'final', 'attendance'],
      components: { term: 65, final: 25, attendance: 10 },
      types: { test: 1, quiz: 0.5 }
    },
    advfunctions: {
      id: 'advfunctions', name: 'Advanced Functions', shortName: 'Adv Functions', ap: false,
      parts: ['term', 'final', 'attendance'],
      components: { term: 65, final: 25, attendance: 10 },
      types: { test: 1, quiz: 0.5, group: 0.3 }
    },
    datamgmt: {
      id: 'datamgmt', name: 'Data Management', shortName: 'Data Mgmt', ap: false,
      parts: ['term', 'cpt', 'final', 'attendance'],
      components: { term: 50, cpt: 15, final: 25, attendance: 10 },
      types: { test: 1, quiz: 0.5, group: 0.3 }
    }
  };

  var COURSE_ORDER = ['physics', 'calculus', 'advfunctions', 'datamgmt'];

  var PART_LABELS = { term: 'Term', cpt: 'CPT', final: 'Final exam', attendance: 'Attendance & Participation' };
  var CATEGORY_LABELS = { K: 'Knowledge', T: 'Thinking', C: 'Communication', A: 'Application' };
  var CATEGORY_ORDER = ['K', 'T', 'C', 'A'];
  var TYPE_LABELS = { test: 'Test', quiz: 'Quiz', lab: 'Lab', group: 'Group Assignment' };

  /** Turns user input into a number, or null if blank/invalid. */
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).trim();
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /** score/outOf as a percentage, or null if either is missing or invalid. */
  function percent(score, outOf) {
    var s = toNumber(score), o = toNumber(outOf);
    if (s == null || o == null || o <= 0 || s < 0) return null;
    return (s / o) * 100;
  }

  /** Weighted average of [{value, weight}], skipping null values and zero weights. */
  function weightedAverage(items) {
    var sum = 0, total = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.value == null || !(it.weight > 0)) continue;
      sum += it.value * it.weight;
      total += it.weight;
    }
    return total > 0 ? sum / total : null;
  }

  /** Unticked ("disabled") entries never count; predicted ones count only with predictions on. */
  function isIncluded(entry, includePredicted) {
    return !!entry && !entry.disabled && (!entry.predicted || !!includePredicted);
  }

  /** Default weights for a course merged with the user's settings. */
  function effectiveWeights(courseId, settings) {
    var def = COURSES[courseId];
    settings = settings || {};
    function merge(group) {
      if (!def[group]) return undefined;
      var out = {}, saved = settings[group] || {};
      for (var k in def[group]) {
        var n = toNumber(saved[k]);
        out[k] = n != null && n >= 0 ? n : def[group][k];
      }
      return out;
    }
    var w = { components: merge('components'), types: merge('types') };
    // User-added assessment types, e.g. {id: 'ct-x', label: 'Project', weight: '2'}.
    customTypes(settings).forEach(function (ct) {
      var n = toNumber(ct.weight);
      w.types[ct.id] = n != null && n >= 0 ? n : 0;
    });
    if (def.categories) {
      w.categories = merge('categories');
      // Physics: the term weight is always the sum of its category weights.
      w.components.term = sumValues(w.categories);
    }
    return w;
  }

  function defaultWeights(courseId) {
    return effectiveWeights(courseId, {});
  }

  function customTypes(settings) {
    var list = settings && Array.isArray(settings.customTypes) ? settings.customTypes : [];
    return list.filter(function (ct) { return ct && ct.id; });
  }

  /** All assessment types for a course: built-in first, then the user's own. */
  function typeList(courseId, settings) {
    var w = effectiveWeights(courseId, settings);
    var list = Object.keys(COURSES[courseId].types).map(function (id) {
      return { id: id, label: TYPE_LABELS[id], weight: w.types[id], custom: false };
    });
    customTypes(settings).forEach(function (ct) {
      list.push({ id: ct.id, label: String(ct.label || '').trim() || 'Untitled type', weight: w.types[ct.id], custom: true });
    });
    return list;
  }

  /** An assessment's own weight if set, otherwise its type's weight. Unknown types count 0. */
  function assessmentWeight(a, weights) {
    var own = toNumber(a.weight);
    if (own != null && own >= 0) return own;
    return weights.types[a.type] || 0;
  }

  function sumValues(obj) {
    var t = 0;
    for (var k in obj) t += obj[k];
    return t;
  }

  /** Term mark for a list of assessments. Returns {value, categories}. */
  function termMark(courseId, assessments, weights, includePredicted) {
    var list = (assessments || []).filter(function (a) { return isIncluded(a, includePredicted); });
    if (!COURSES[courseId].categories) {
      var value = weightedAverage(list.map(function (a) {
        return { value: percent(a.score, a.outOf), weight: assessmentWeight(a, weights) };
      }));
      return { value: value, categories: null };
    }
    var categories = {};
    CATEGORY_ORDER.forEach(function (cat) {
      categories[cat] = weightedAverage(list.map(function (a) {
        var m = a.marks && a.marks[cat];
        return { value: m ? percent(m.score, m.outOf) : null, weight: assessmentWeight(a, weights) };
      }));
    });
    var term = weightedAverage(CATEGORY_ORDER.map(function (cat) {
      return { value: categories[cat], weight: weights.categories[cat] };
    }));
    return { value: term, categories: categories };
  }

  /** CPT mark: total score / total out-of across all entries. */
  function cptMark(entries, includePredicted) {
    var score = 0, outOf = 0, any = false;
    (entries || []).forEach(function (e) {
      if (!isIncluded(e, includePredicted) || percent(e.score, e.outOf) == null) return;
      score += toNumber(e.score);
      outOf += toNumber(e.outOf);
      any = true;
    });
    return any ? (score / outOf) * 100 : null;
  }

  function singleMark(entry, includePredicted) {
    return isIncluded(entry, includePredicted) ? percent(entry.score, entry.outOf) : null;
  }

  function applyBoost(mark) {
    return mark == null ? null : Math.min(mark * BOOST, 100);
  }

  /**
   * Full course mark.
   * data = {assessments, cpt, final, attendance}; weights from effectiveWeights().
   * Returns {parts, categories, raw, boosted, usedWeight, totalWeight}.
   */
  function courseMark(courseId, data, weights, includePredicted) {
    var def = COURSES[courseId];
    weights = weights || defaultWeights(courseId);
    data = data || {};
    var term = termMark(courseId, data.assessments, weights, includePredicted);
    var parts = {};
    def.parts.forEach(function (p) {
      if (p === 'term') parts.term = term.value;
      else if (p === 'cpt') parts.cpt = cptMark(data.cpt, includePredicted);
      else parts[p] = singleMark(data[p], includePredicted);
    });
    var usedWeight = 0, totalWeight = 0;
    var raw = weightedAverage(def.parts.map(function (p) {
      var w = weights.components[p];
      totalWeight += w;
      if (parts[p] != null && w > 0) usedWeight += w;
      return { value: parts[p], weight: w };
    }));
    return {
      parts: parts,
      categories: term.categories,
      raw: raw,
      boosted: def.ap ? applyBoost(raw) : null,
      usedWeight: usedWeight,
      totalWeight: totalWeight
    };
  }

  /**
   * Reverse solver.
   * opts = {parts: [{id, weight, value}], solveFor, target, ap, afterBoost}
   * The part named by solveFor is solved for. Any other part with value null
   * (no mark yet) is left out and the remaining weights are rescaled, the same
   * way the current mark is worked out.
   * Returns {ok:false, error} or
   *         {ok:true, id, required, atLeast, leftOut, status: 'ok'|'too-high'|'too-low'|'any'}.
   */
  function solve(opts) {
    var target = toNumber(opts.target);
    if (target == null) return { ok: false, error: 'no-target' };
    if (target < 0 || target > 100) return { ok: false, error: 'target-range' };

    var blank = null;
    opts.parts.forEach(function (p) { if (p.id === opts.solveFor) blank = p; });
    if (!blank) return { ok: false, error: 'no-solve-for' };
    if (!(blank.weight > 0)) return { ok: false, error: 'zero-weight' };
    var leftOut = opts.parts.filter(function (p) { return p !== blank && p.value == null; })
      .map(function (p) { return p.id; });
    var used = opts.parts.filter(function (p) { return p === blank || p.value != null; });

    var preTarget = target, atLeast = false;
    if (opts.ap && opts.afterBoost) {
      if (target >= 100 - EPS) {
        // Any mark of 100/1.05 or more boosts to 100, so this is a minimum.
        preTarget = 100 / BOOST;
        atLeast = true;
      } else {
        preTarget = target / BOOST;
      }
    }

    var totalWeight = 0, known = 0;
    used.forEach(function (p) {
      totalWeight += p.weight;
      if (p !== blank) known += p.value * p.weight;
    });
    var required = (preTarget * totalWeight - known) / blank.weight;

    var status = 'ok';
    if (required > 100 + EPS) status = 'too-high';
    else if (required < -EPS) status = atLeast ? 'any' : 'too-low';
    return { ok: true, id: blank.id, required: required, atLeast: atLeast, preTarget: preTarget, leftOut: leftOut, status: status };
  }

  /** Display helpers: the only places rounding happens. */
  function round2(x) {
    return Math.round((x + (x >= 0 ? EPS : -EPS)) * 100) / 100;
  }
  function format2(x) {
    return x == null ? '—' : round2(x).toFixed(2);
  }
  function roundWhole(x) {
    return x == null ? null : Math.round(x + EPS);
  }

  return {
    BOOST: BOOST,
    COURSES: COURSES,
    COURSE_ORDER: COURSE_ORDER,
    PART_LABELS: PART_LABELS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    CATEGORY_ORDER: CATEGORY_ORDER,
    TYPE_LABELS: TYPE_LABELS,
    toNumber: toNumber,
    percent: percent,
    weightedAverage: weightedAverage,
    effectiveWeights: effectiveWeights,
    defaultWeights: defaultWeights,
    typeList: typeList,
    assessmentWeight: assessmentWeight,
    termMark: termMark,
    cptMark: cptMark,
    singleMark: singleMark,
    applyBoost: applyBoost,
    courseMark: courseMark,
    solve: solve,
    round2: round2,
    format2: format2,
    roundWhole: roundWhole
  };
});
