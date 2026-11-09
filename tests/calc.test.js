/*
 * Tests for calc.js. Every expected answer below was worked out by hand
 * (the working is in the comments).
 *
 * Run in a terminal:  node tests/calc.test.js
 * Or open tests.html in a browser.
 */
(function () {
  var GC = typeof require === 'function' ? require('../calc.js') : window.GradeCalc;
  var results = [];

  function close(a, b) {
    if (a == null || b == null) return a === b;
    return Math.abs(a - b) < 1e-9;
  }
  function test(name, fn) {
    try {
      fn();
      results.push({ name: name, pass: true });
    } catch (err) {
      results.push({ name: name, pass: false, message: err.message });
    }
  }
  function eq(actual, expected, label) {
    var ok = typeof expected === 'number' || expected === null ? close(actual, expected) : actual === expected;
    if (!ok) throw new Error((label ? label + ': ' : '') + 'expected ' + expected + ', got ' + actual);
  }

  var DEF = {
    physics: GC.defaultWeights('physics'),
    calculus: GC.defaultWeights('calculus'),
    advfunctions: GC.defaultWeights('advfunctions'),
    datamgmt: GC.defaultWeights('datamgmt')
  };
  function a(type, score, outOf, predicted) {
    return { type: type, score: score, outOf: outOf, predicted: !!predicted };
  }
  function m(score, outOf) { return { score: score, outOf: outOf }; }

  // ---------- Basic pieces ----------

  test('percent: 8/10 = 80%', function () { eq(GC.percent('8', '10'), 80); });
  test('percent: blank, zero out-of and negative score are ignored', function () {
    eq(GC.percent('', '10'), null);
    eq(GC.percent('5', '0'), null);
    eq(GC.percent('-1', '10'), null);
    eq(GC.percent('abc', '10'), null);
  });
  test('percent: bonus marks above out-of are allowed (11/10 = 110%)', function () {
    eq(GC.percent('11', '10'), 110);
  });

  // ---------- Spec example 1: type weights ----------
  // Test 80% (weight 1) + Quiz 100% (weight 0.5): (80×1 + 100×0.5) / 1.5 = 130/1.5 = 86.666…
  test('Spec example: test 80% + quiz 100% = 86.67%', function () {
    var t = GC.termMark('calculus', [a('test', 80, 100), a('quiz', 10, 10)], DEF.calculus);
    eq(t.value, 130 / 1.5);
    eq(GC.format2(t.value), '86.67');
  });

  // Group assignment 0.3: test 60% + group 100%: (60 + 30) / 1.3 = 69.2307…
  test('Advanced Functions: test 60% + group 100% = 69.23%', function () {
    var t = GC.termMark('advfunctions', [a('test', 60, 100), a('group', 20, 20)], DEF.advfunctions);
    eq(t.value, 90 / 1.3);
    eq(GC.format2(t.value), '69.23');
  });

  // ---------- Spec example 2: rescaling ----------
  // Term 80 (65%) + Attendance 9/10 = 90 (10%), no final:
  // (80×65 + 90×10) / 75 = (5200 + 900) / 75 = 81.333…
  test('Spec example: only Term (65) and Attendance (10) → weights 65/75 and 10/75', function () {
    var r = GC.courseMark('calculus', {
      assessments: [a('test', 80, 100)],
      final: { score: '', outOf: 100 },
      attendance: { score: 9, outOf: 10 }
    }, DEF.calculus);
    eq(r.raw, 6100 / 75);
    eq(GC.format2(r.raw), '81.33');
    eq(r.usedWeight, 75);
    eq(r.totalWeight, 100);
  });

  test('Only a term mark entered → course mark equals the term mark', function () {
    var r = GC.courseMark('advfunctions', { assessments: [a('test', 73, 100)] }, DEF.advfunctions);
    eq(r.raw, 73);
  });

  test('No marks at all → no course mark', function () {
    var r = GC.courseMark('calculus', {}, DEF.calculus);
    eq(r.raw, null);
    eq(r.boosted, null);
  });

  // ---------- AP boost ----------
  test('AP boost: 90 → 94.5', function () { eq(GC.applyBoost(90), 94.5); });
  test('AP boost is capped: 96 × 1.05 = 100.8 → 100', function () { eq(GC.applyBoost(96), 100); });
  test('Non-AP course has no boosted mark', function () {
    var r = GC.courseMark('datamgmt', { assessments: [a('test', 9, 10)] }, DEF.datamgmt);
    eq(r.boosted, null);
  });

  // ---------- AP Physics categories ----------
  // Test:  K 8/10=80,  T 15/20=75, C blank,  A 9/10=90
  // Quiz:  K 10/10=100, T 18/20=90, C 4/5=80, A blank
  // Lab:   K blank,    T blank,    C 5/5=100, A 7/10=70
  // K = (80×1 + 100×0.5) / 1.5 = 130/1.5 = 86.666…
  // T = (75×1 + 90×0.5) / 1.5 = 120/1.5 = 80
  // C = (80×0.5 + 100×0.25) / 0.75 = 65/0.75 = 86.666…
  // A = (90×1 + 70×0.25) / 1.25 = 107.5/1.25 = 86
  // Term = (20×86.67 + 25×80 + 10×86.67 + 10×86) / 65 = (2600 + 2000 + 860) / 65 = 5460/65 = 84
  var physicsAssessments = [
    { type: 'test', marks: { K: m(8, 10), T: m(15, 20), C: m('', ''), A: m(9, 10) } },
    { type: 'quiz', marks: { K: m(10, 10), T: m(18, 20), C: m(4, 5), A: m('', '') } },
    { type: 'lab', marks: { K: m('', ''), T: m('', ''), C: m(5, 5), A: m(7, 10) } }
  ];
  test('Physics: each category skips blank marks and uses type weights', function () {
    var t = GC.termMark('physics', physicsAssessments, DEF.physics);
    eq(t.categories.K, 130 / 1.5, 'K');
    eq(t.categories.T, 80, 'T');
    eq(t.categories.C, 65 / 0.75, 'C');
    eq(t.categories.A, 86, 'A');
    eq(t.value, 84, 'term');
  });

  // Course: 84×0.65 + 70×0.25 + 90×0.10 = 54.6 + 17.5 + 9 = 81.1; boosted 81.1×1.05 = 85.155
  test('Physics: full course mark 81.10, boosted 85.155 (shows 85.16)', function () {
    var r = GC.courseMark('physics', {
      assessments: physicsAssessments,
      final: { score: 70, outOf: 100 },
      attendance: { score: 9, outOf: 10 }
    }, DEF.physics);
    eq(r.raw, 81.1);
    eq(r.boosted, 85.155);
    eq(GC.format2(r.boosted), '85.16');
  });

  // Only K and T have marks: term = (20×86.67 + 25×80) / 45 = (1733.33 + 2000) / 45 = 82.962…
  test('Physics: missing categories are rescaled within the term', function () {
    var t = GC.termMark('physics', [physicsAssessments[0], physicsAssessments[1]].map(function (x) {
      return { type: x.type, marks: { K: x.marks.K, T: x.marks.T } };
    }), DEF.physics);
    eq(t.value, (20 * (130 / 1.5) + 25 * 80) / 45);
    eq(GC.format2(t.value), '82.96');
    eq(t.categories.C, null);
  });

  test('Physics: term weight is the sum of the category weights', function () {
    eq(DEF.physics.components.term, 65);
    var w = GC.effectiveWeights('physics', { categories: { K: 30 } });
    eq(w.components.term, 75);
  });

  // ---------- CPT ----------
  // 18/20 and 45/50 → 63/70 = 90%
  test('CPT: several entries = total score / total out-of', function () {
    eq(GC.cptMark([{ score: 18, outOf: 20 }, { score: 45, outOf: 50 }]), 90);
  });
  test('CPT: a single entry works the same way (7/8 = 87.5%)', function () {
    eq(GC.cptMark([{ score: 7, outOf: 8 }]), 87.5);
  });
  // Term 80, CPT 90, Final 70, Attendance 100: 80×0.5 + 90×0.15 + 70×0.25 + 100×0.1 = 40 + 13.5 + 17.5 + 10 = 81
  test('Data Management: full course mark with CPT = 81', function () {
    var r = GC.courseMark('datamgmt', {
      assessments: [a('test', 80, 100)],
      cpt: [{ score: 9, outOf: 10 }],
      final: { score: 70, outOf: 100 },
      attendance: { score: 10, outOf: 10 }
    }, DEF.datamgmt);
    eq(r.raw, 81);
  });

  // ---------- Predicted entries ----------
  // Real: test 80. Predicted: quiz 100. Current = 80; with predictions = 86.666…
  test('Predicted entries count only in the "with predictions" mark', function () {
    var data = { assessments: [a('test', 80, 100), a('quiz', 10, 10, true)] };
    eq(GC.courseMark('calculus', data, DEF.calculus, false).raw, 80);
    eq(GC.courseMark('calculus', data, DEF.calculus, true).raw, 130 / 1.5);
  });
  test('A predicted final exam is left out of the current mark', function () {
    var data = { assessments: [a('test', 80, 100)], final: { score: 60, outOf: 100, predicted: true } };
    eq(GC.courseMark('calculus', data, DEF.calculus, false).raw, 80);
    // (80×65 + 60×25) / 90 = (5200 + 1500) / 90 = 74.444…
    eq(GC.courseMark('calculus', data, DEF.calculus, true).raw, 6700 / 90);
  });

  // ---------- Custom weights ----------
  test('Custom weights from settings are used; blank settings fall back to defaults', function () {
    var w = GC.effectiveWeights('calculus', { components: { final: '30', attendance: '' }, types: { quiz: 1 } });
    eq(w.components.final, 30);
    eq(w.components.attendance, 10);
    eq(w.types.quiz, 1);
    // test 80 + quiz 100 with equal weights = 90
    eq(GC.termMark('calculus', [a('test', 80, 100), a('quiz', 10, 10)], w).value, 90);
  });

  // ---------- Per-assessment weights ----------
  // Quiz given its own weight 1 instead of 0.5: (80×1 + 100×1) / 2 = 90
  test('Per-assessment weight overrides the type weight', function () {
    var quiz = a('quiz', 10, 10); quiz.weight = '1';
    eq(GC.termMark('calculus', [a('test', 80, 100), quiz], DEF.calculus).value, 90);
  });
  test('Blank per-assessment weight falls back to the type weight', function () {
    var quiz = a('quiz', 10, 10); quiz.weight = '';
    eq(GC.termMark('calculus', [a('test', 80, 100), quiz], DEF.calculus).value, 130 / 1.5);
  });
  // Weight 0 removes it: only the test (80) counts
  test('Per-assessment weight of 0 leaves that assessment out', function () {
    var quiz = a('quiz', 5, 10); quiz.weight = '0';
    eq(GC.termMark('calculus', [a('test', 80, 100), quiz], DEF.calculus).value, 80);
  });
  // Physics test with own weight 2, quiz default 0.5, K only: K = (80×2 + 100×0.5) / 2.5 = 210/2.5 = 84
  test('Per-assessment weight applies to every Physics category', function () {
    var t1 = { type: 'test', weight: '2', marks: { K: m(8, 10) } };
    var q1 = { type: 'quiz', marks: { K: m(10, 10) } };
    eq(GC.termMark('physics', [t1, q1], DEF.physics).categories.K, 84);
  });

  // ---------- Custom assessment types ----------
  // Project weight 2: test 70 + project 85 → (70×1 + 85×2) / 3 = 240/3 = 80
  test('Custom type uses its own weight', function () {
    var settings = { customTypes: [{ id: 'ct-1', label: 'Project', weight: '2' }] };
    var w = GC.effectiveWeights('advfunctions', settings);
    eq(w.types['ct-1'], 2);
    eq(GC.termMark('advfunctions', [a('test', 70, 100), a('ct-1', 85, 100)], w).value, 80);
  });
  test('Type list shows built-in types first, then custom ones', function () {
    var list = GC.typeList('calculus', { customTypes: [{ id: 'ct-1', label: ' Homework ', weight: '0.2' }, { id: 'ct-2', label: '', weight: 'x' }] });
    eq(list.map(function (t) { return t.label; }).join(','), 'Test,Quiz,Homework,Untitled type');
    eq(list[2].weight, 0.2);
    eq(list[3].weight, 0, 'invalid custom weight counts 0');
  });
  test('An assessment with an unknown type counts 0', function () {
    eq(GC.termMark('calculus', [a('test', 80, 100), a('gone', 0, 100)], DEF.calculus).value, 80);
  });

  // ---------- Reverse solver ----------
  function parts(term, final, attendance) {
    return [
      { id: 'term', weight: 65, value: term },
      { id: 'final', weight: 25, value: final },
      { id: 'attendance', weight: 10, value: attendance }
    ];
  }
  // (85×100 − 80×65 − 100×10) / 25 = (8500 − 5200 − 1000) / 25 = 92
  test('Solver: final exam needed for 85% = 92%', function () {
    var r = GC.solve({ parts: parts(80, null, 100), target: 85 });
    eq(r.ok, true); eq(r.id, 'final'); eq(r.required, 92); eq(r.status, 'ok');
  });
  // (82×100 − 80×65 − 90×25) / 10 = (8200 − 5200 − 2250) / 10 = 75
  test('Solver: attendance needed = 75%', function () {
    var r = GC.solve({ parts: parts(80, 90, null), target: 82 });
    eq(r.id, 'attendance'); eq(r.required, 75);
  });
  // (95×100 − 6200) / 25 = 132 → impossible
  test('Solver: above 100% is reported as impossible', function () {
    var r = GC.solve({ parts: parts(80, null, 100), target: 95 });
    eq(r.required, 132); eq(r.status, 'too-high');
  });
  // (50×100 − 6200) / 25 = −48 → impossible (already above target)
  test('Solver: below 0% is reported', function () {
    var r = GC.solve({ parts: parts(80, null, 100), target: 50 });
    eq(r.required, -48); eq(r.status, 'too-low');
  });
  // (87×100 − 6200) / 25 = 2500/25 = 100 → still possible
  test('Solver: exactly 100% needed is still possible', function () {
    var r = GC.solve({ parts: parts(80, null, 100), target: 87 });
    eq(r.required, 100); eq(r.status, 'ok');
  });
  // After boost 89.25 → before boost 89.25/1.05 = 85 → final 92 (as above)
  test('Solver (AP): mark entered after the boost is un-boosted first', function () {
    var r = GC.solve({ parts: parts(80, null, 100), target: 89.25, ap: true, afterBoost: true });
    eq(r.preTarget, 85); eq(r.required, 92); eq(r.atLeast, false);
  });
  test('Solver (AP): same number entered before the boost is used as-is', function () {
    // (89.25×100 − 6200) / 25 = 2725/25 = 109 → too high
    var r = GC.solve({ parts: parts(80, null, 100), target: 89.25, ap: true, afterBoost: false });
    eq(r.required, 109); eq(r.status, 'too-high');
  });
  // Boosted 100 means any raw ≥ 100/1.05 = 95.238… → minimum.
  // Term 100, Attendance 100: (95.238…×100 − 7500) / 25 = 80.952…
  test('Solver (AP): boosted 100% gives a minimum ("at least")', function () {
    var r = GC.solve({ parts: parts(100, null, 100), target: 100, ap: true, afterBoost: true });
    eq(r.atLeast, true);
    eq(r.required, (10000 / 1.05 - 7500) / 25);
    eq(GC.format2(r.required), '80.95');
  });
  test('Solver: needs exactly one blank part', function () {
    eq(GC.solve({ parts: parts(80, null, null), target: 85 }).error, 'blank-count');
    eq(GC.solve({ parts: parts(80, 90, 100), target: 85 }).error, 'blank-count');
  });
  test('Solver: target must be 0–100', function () {
    eq(GC.solve({ parts: parts(80, null, 100), target: 120 }).error, 'target-range');
    eq(GC.solve({ parts: parts(80, null, 100), target: '' }).error, 'no-target');
  });
  // DM: (81×100 − 80×50 − 70×25 − 100×10) / 15 = (8100 − 4000 − 1750 − 1000) / 15 = 1350/15 = 90
  test('Solver: CPT needed in Data Management = 90%', function () {
    var r = GC.solve({
      parts: [
        { id: 'term', weight: 50, value: 80 }, { id: 'cpt', weight: 15, value: null },
        { id: 'final', weight: 25, value: 70 }, { id: 'attendance', weight: 10, value: 100 }
      ],
      target: 81
    });
    eq(r.required, 90);
  });

  // ---------- Rounding (display only) ----------
  test('Display: 2 decimals and whole-number rounding', function () {
    eq(GC.format2(130 / 1.5), '86.67');
    eq(GC.format2(85.155), '85.16');
    eq(GC.roundWhole(86.5), 87);
    eq(GC.roundWhole(84.49), 84);
    eq(GC.roundWhole(130 / 1.5), 87);
  });
  // Rounding only at the end matters: K, C are 86.666… each; rounding them first to 86.67
  // would give (20×86.67 + 25×80 + 10×86.67 + 10×86)/65 = 84.00046…, not exactly 84.
  test('No intermediate rounding: physics term is exactly 84', function () {
    eq(GC.termMark('physics', physicsAssessments, DEF.physics).value, 84);
  });

  // ---------- Report ----------
  var passed = results.filter(function (r) { return r.pass; }).length;
  if (typeof module === 'object' && module.exports) {
    results.forEach(function (r) {
      console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.pass ? '' : '\n        ' + r.message));
    });
    console.log('\n' + passed + ' / ' + results.length + ' tests passed');
    if (passed !== results.length) process.exitCode = 1;
  } else {
    window.TEST_RESULTS = results;
  }
})();
