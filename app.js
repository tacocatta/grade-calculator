/*
 * Page code: rendering, editing, saving, export/import, solver and settings UI.
 * All the math lives in calc.js (window.GradeCalc).
 */
(function () {
  'use strict';

  var GC = window.GradeCalc;
  var STORAGE_KEY = 'gradeCalculator.v1';
  var GROUP_LABELS = { components: 'Course parts', categories: 'Term categories', types: 'Assessment types' };

  var tabsEl = document.getElementById('tabs');
  var panelsEl = document.getElementById('panels');
  var fileInput = document.getElementById('import-file');
  var toastEl = document.getElementById('toast');

  var state = loadState();
  var solverState = {};
  GC.COURSE_ORDER.forEach(function (cid) {
    solverState[cid] = { target: '', afterBoost: false, solveFor: 'final', values: {} };
  });

  // ---------------------------------------------------------------- helpers

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function str(v) { return v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function pct(x) { return x == null ? '—' : GC.format2(x) + '%'; }
  function plainNum(x) { return String(Math.round(x * 10000) / 10000); }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  // ------------------------------------------------------------ data model

  function blankMark() { return { score: '', outOf: '' }; }

  function newAssessment(cid) {
    var a = { id: uid(), name: '', type: 'test', predicted: false };
    if (GC.COURSES[cid].categories) {
      a.marks = {};
      GC.CATEGORY_ORDER.forEach(function (k) { a.marks[k] = blankMark(); });
    } else {
      a.score = '';
      a.outOf = '';
    }
    return a;
  }

  function blankCourse() {
    return {
      assessments: [],
      cpt: [],
      final: { score: '', outOf: '100', predicted: false },
      attendance: { score: '', outOf: '10', predicted: false },
      settings: {}
    };
  }

  function normalizeAssessment(cid, raw) {
    var def = GC.COURSES[cid];
    var a = newAssessment(cid);
    if (raw.id) a.id = String(raw.id);
    a.name = str(raw.name);
    a.type = Object.prototype.hasOwnProperty.call(def.types, raw.type) ? raw.type : 'test';
    a.predicted = !!raw.predicted;
    if (def.categories) {
      GC.CATEGORY_ORDER.forEach(function (k) {
        var m = isObj(raw.marks) && isObj(raw.marks[k]) ? raw.marks[k] : {};
        a.marks[k] = { score: str(m.score), outOf: str(m.outOf) };
      });
    } else {
      a.score = str(raw.score);
      a.outOf = str(raw.outOf);
    }
    return a;
  }

  function normalizeCourse(cid, raw) {
    var def = GC.COURSES[cid];
    var c = blankCourse();
    if (!isObj(raw)) return c;
    if (Array.isArray(raw.assessments)) {
      c.assessments = raw.assessments.filter(isObj).map(function (a) { return normalizeAssessment(cid, a); });
    }
    if (Array.isArray(raw.cpt)) {
      c.cpt = raw.cpt.filter(isObj).map(function (e) {
        return { id: e.id ? String(e.id) : uid(), name: str(e.name), score: str(e.score), outOf: str(e.outOf), predicted: !!e.predicted };
      });
    }
    ['final', 'attendance'].forEach(function (slot) {
      if (isObj(raw[slot])) {
        c[slot] = { score: str(raw[slot].score), outOf: str(raw[slot].outOf), predicted: !!raw[slot].predicted };
      }
    });
    if (isObj(raw.settings)) {
      ['components', 'categories', 'types'].forEach(function (group) {
        if (!def[group] || !isObj(raw.settings[group])) return;
        var g = {};
        Object.keys(def[group]).forEach(function (k) {
          if (raw.settings[group][k] != null) g[k] = str(raw.settings[group][k]);
        });
        c.settings[group] = g;
      });
    }
    return c;
  }

  function normalizeState(raw) {
    var s = { version: 1, active: 'physics', courses: {} };
    if (isObj(raw) && GC.COURSES[raw.active]) s.active = raw.active;
    var courses = isObj(raw) && isObj(raw.courses) ? raw.courses : {};
    GC.COURSE_ORDER.forEach(function (cid) { s.courses[cid] = normalizeCourse(cid, courses[cid]); });
    return s;
  }

  function loadState() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { raw = null; }
    return normalizeState(raw);
  }

  var saveWarned = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      if (!saveWarned) {
        saveWarned = true;
        toast("Couldn't save on this device. Use Export to keep a copy.");
      }
    }
  }

  function weightsFor(cid) { return GC.effectiveWeights(cid, state.courses[cid].settings); }

  function hasPredicted(c) {
    return c.assessments.some(function (a) { return a.predicted; }) ||
      c.cpt.some(function (e) { return e.predicted; }) ||
      c.final.predicted || c.attendance.predicted;
  }

  function findEntry(cid, el) {
    var c = state.courses[cid];
    var kind = el.getAttribute('data-kind');
    if (kind === 'single') return c[el.getAttribute('data-slot')];
    var list = kind === 'cpt' ? c.cpt : c.assessments;
    var id = el.getAttribute('data-id');
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function setField(obj, field, value) {
    var parts = field.split('.');
    if (parts.length === 2) obj.marks[parts[0]][parts[1]] = value;
    else obj[field] = value;
  }

  // ---------------------------------------------------------------- render

  function renderTabs() {
    tabsEl.innerHTML = GC.COURSE_ORDER.map(function (cid) {
      var on = cid === state.active;
      return '<button type="button" class="tab" role="tab" id="tab-' + cid + '" data-tab="' + cid + '"' +
        ' aria-controls="panel-' + cid + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' +
        esc(GC.COURSES[cid].shortName) + '</button>';
    }).join('');
  }

  function setActive(cid, focus) {
    state.active = cid;
    save();
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.tab'), function (t) {
      var on = t.getAttribute('data-tab') === cid;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    Array.prototype.forEach.call(panelsEl.children, function (p) {
      p.hidden = p.getAttribute('data-course') !== cid;
    });
  }

  function panelShell(cid) {
    var def = GC.COURSES[cid];
    var html = '<section class="panel" id="panel-' + cid + '" role="tabpanel" aria-labelledby="tab-' + cid + '" data-course="' + cid + '"' +
      (cid === state.active ? '' : ' hidden') + '>';
    html += '<h2 class="visually-hidden">' + esc(def.name) + '</h2>';
    html += '<div class="results" data-region="results" aria-live="polite"></div>';

    html += '<section class="card"><div class="card-head"><h2>Term assessments</h2>' +
      '<span class="card-sub" data-region="typeinfo"></span></div>';
    if (def.categories) {
      html += '<p class="hint">Enter Knowledge (K), Thinking (T), Communication (C) and Application (A) marks separately. ' +
        'Leave a category blank if the assessment doesn\'t include it.</p>';
    }
    html += '<div class="entries" data-region="assessments"></div>' +
      '<button type="button" class="btn btn-add" data-action="add-assessment">+ Add assessment</button></section>';

    if (def.parts.indexOf('cpt') !== -1) {
      html += '<section class="card"><div class="card-head"><h2>CPT</h2><span class="card-sub">Total score ÷ total out-of</span></div>' +
        '<div class="entries" data-region="cpt"></div>' +
        '<button type="button" class="btn btn-add" data-action="add-cpt">+ Add CPT mark</button></section>';
    }

    html += '<section class="card"><div class="card-head"><h2>Final exam &amp; attendance</h2></div>' +
      singleHtml('final', 'Final exam') + singleHtml('attendance', 'Attendance & Participation') + '</section>';

    html += '<details class="card"><summary>Reverse solver</summary><div data-region="solver"></div></details>';
    html += '<details class="card"><summary>Weights</summary><div data-region="settings"></div></details>';
    html += '</section>';
    return html;
  }

  function numInput(field, value, label, placeholder) {
    return '<input type="text" inputmode="decimal" autocomplete="off" class="num-input" data-field="' + field + '"' +
      ' value="' + esc(value) + '" placeholder="' + placeholder + '" aria-label="' + esc(label) + '">';
  }

  function markRowHtml(cat, m, context) {
    var prefix = cat ? cat + '.' : '';
    var catName = cat ? GC.CATEGORY_LABELS[cat] + ' ' : '';
    return '<div class="mark-row' + (cat ? ' has-label' : '') + '">' +
      (cat ? '<span class="cat" title="' + GC.CATEGORY_LABELS[cat] + '">' + cat + '</span>' : '') +
      numInput(prefix + 'score', m.score, context + ' ' + catName + 'score', 'Score') +
      '<span class="slash" aria-hidden="true">/</span>' +
      numInput(prefix + 'outOf', m.outOf, context + ' ' + catName + 'out of', 'Out of') +
      '<span class="pct" data-pct="' + (cat || '') + '"></span></div>';
  }

  function predictedToggle(on) {
    return '<label class="toggle"><input type="checkbox" data-field="predicted"' + (on ? ' checked' : '') + '> Predicted</label>';
  }

  function assessmentHtml(cid, a, index) {
    var def = GC.COURSES[cid];
    var w = weightsFor(cid);
    var context = a.name ? a.name : 'Assessment ' + (index + 1);
    var options = Object.keys(def.types).map(function (t) {
      return '<option value="' + t + '"' + (t === a.type ? ' selected' : '') + '>' + typeOptionLabel(t, w) + '</option>';
    }).join('');
    var marks = def.categories
      ? GC.CATEGORY_ORDER.map(function (k) { return markRowHtml(k, a.marks[k], context); }).join('')
      : markRowHtml(null, a, context);
    return '<div class="entry' + (a.predicted ? ' is-predicted' : '') + '" data-kind="assessment" data-id="' + esc(a.id) + '">' +
      '<div class="entry-head">' +
      '<input type="text" class="name" data-field="name" value="' + esc(a.name) + '" placeholder="Name (optional)" aria-label="Assessment name" autocomplete="off">' +
      '<select data-field="type" aria-label="Assessment type">' + options + '</select></div>' +
      '<div class="marks">' + marks + '</div>' +
      '<div class="entry-foot">' + predictedToggle(a.predicted) +
      '<button type="button" class="btn btn-danger" data-action="delete-entry">Delete</button></div></div>';
  }

  function typeOptionLabel(t, w) {
    return esc(GC.TYPE_LABELS[t]) + ' (×' + plainNum(w.types[t]) + ')';
  }

  function cptHtml(e, index) {
    var context = e.name ? e.name : 'CPT mark ' + (index + 1);
    return '<div class="entry' + (e.predicted ? ' is-predicted' : '') + '" data-kind="cpt" data-id="' + esc(e.id) + '">' +
      '<div class="entry-head"><input type="text" class="name" data-field="name" value="' + esc(e.name) + '" placeholder="Name (optional)" aria-label="CPT mark name" autocomplete="off"></div>' +
      '<div class="marks">' + markRowHtml(null, e, context) + '</div>' +
      '<div class="entry-foot">' + predictedToggle(e.predicted) +
      '<button type="button" class="btn btn-danger" data-action="delete-entry">Delete</button></div></div>';
  }

  function singleHtml(slot, title) {
    return '<div class="single-entry entry" data-kind="single" data-slot="' + slot + '">' +
      '<h3>' + esc(title) + ' <span class="card-sub" data-weight="' + slot + '"></span></h3>' +
      '<div class="marks">' + markRowHtml(null, { score: '', outOf: '' }, title) + '</div>' +
      '<div class="entry-foot">' + predictedToggle(false) + '</div></div>';
  }

  function fillSingles(cid, panel) {
    var c = state.courses[cid];
    ['final', 'attendance'].forEach(function (slot) {
      var el = panel.querySelector('[data-slot="' + slot + '"]');
      el.querySelector('[data-field="score"]').value = c[slot].score;
      el.querySelector('[data-field="outOf"]').value = c[slot].outOf;
      el.querySelector('[data-field="predicted"]').checked = !!c[slot].predicted;
      updateEntry(cid, el);
    });
  }

  function region(cid, name) {
    return document.querySelector('#panel-' + cid + ' [data-region="' + name + '"]');
  }

  function renderAssessments(cid) {
    var list = state.courses[cid].assessments;
    var el = region(cid, 'assessments');
    el.innerHTML = list.length
      ? list.map(function (a, i) { return assessmentHtml(cid, a, i); }).join('')
      : '<p class="empty-list">No assessments yet.</p>';
    Array.prototype.forEach.call(el.querySelectorAll('.entry'), function (e) { updateEntry(cid, e); });
  }

  function renderCpt(cid) {
    var el = region(cid, 'cpt');
    if (!el) return;
    var list = state.courses[cid].cpt;
    el.innerHTML = list.length
      ? list.map(cptHtml).join('')
      : '<p class="empty-list">No CPT marks yet.</p>';
    Array.prototype.forEach.call(el.querySelectorAll('.entry'), function (e) { updateEntry(cid, e); });
  }

  /** Updates an entry's percentages, predicted styling and invalid-input highlighting. */
  function updateEntry(cid, el) {
    var obj = findEntry(cid, el);
    if (!obj) return;
    el.classList.toggle('is-predicted', !!obj.predicted);
    Array.prototype.forEach.call(el.querySelectorAll('.mark-row'), function (row) {
      var span = row.querySelector('.pct');
      var cat = span.getAttribute('data-pct');
      var m = cat ? obj.marks[cat] : obj;
      var p = GC.percent(m.score, m.outOf);
      span.textContent = p == null ? '—' : GC.format2(p) + '%';
      span.classList.toggle('has-value', p != null);

      var s = GC.toNumber(m.score), o = GC.toNumber(m.outOf);
      var scoreBad = str(m.score).trim() !== '' && (s == null || s < 0);
      var outBad = (str(m.outOf).trim() !== '' && (o == null || o <= 0)) ||
        (str(m.outOf).trim() === '' && str(m.score).trim() !== '');
      row.querySelector('[data-field$="score"]').classList.toggle('invalid', scoreBad);
      row.querySelector('[data-field$="outOf"]').classList.toggle('invalid', outBad);
    });
  }

  // --------------------------------------------------------------- results

  function resultBlock(cid, title, r, isPred) {
    var def = GC.COURSES[cid];
    var w = weightsFor(cid);
    var cls = 'result' + (isPred ? ' is-predicted' : '');
    if (r.raw == null) {
      return '<div class="' + cls + '"><h3>' + title + '</h3><p class="empty">No marks entered yet.</p></div>';
    }
    var html = '<div class="' + cls + '"><h3>' + title + '</h3><div class="numbers">' +
      '<div class="num main"><span class="label">Raw mark</span><span class="value">' + pct(r.raw) + '</span></div>' +
      '<div class="num"><span class="label">Rounded</span><span class="value">' + GC.roundWhole(r.raw) + '%</span></div>';
    if (def.ap) {
      html += '<div class="num boost"><span class="label">AP boosted</span><span class="value">' + pct(r.boosted) + '</span></div>';
    }
    html += '</div><ul class="breakdown">';
    def.parts.forEach(function (p) {
      var v = r.parts[p];
      html += '<li class="' + (v == null ? 'missing' : '') + '">' + esc(GC.PART_LABELS[p] === 'Attendance & Participation' ? 'Attendance' : GC.PART_LABELS[p]) +
        ' ' + pct(v) + ' <span class="card-sub">· ' + plainNum(w.components[p]) + '%</span></li>';
    });
    html += '</ul>';
    if (r.categories) {
      html += '<ul class="breakdown" style="margin-top:6px">';
      GC.CATEGORY_ORDER.forEach(function (k) {
        var v = r.categories[k];
        html += '<li class="' + (v == null ? 'missing' : '') + '" title="' + GC.CATEGORY_LABELS[k] + '">' + k + ' ' + pct(v) + '</li>';
      });
      html += '</ul>';
    }
    if (r.usedWeight < r.totalWeight - 1e-9) {
      html += '<p class="basis">Only ' + plainNum(r.usedWeight) + '% of the course has marks so far, so those parts are scaled up to count as 100%.</p>';
    }
    return html + '</div>';
  }

  function renderResults(cid) {
    var c = state.courses[cid];
    var w = weightsFor(cid);
    var current = GC.courseMark(cid, c, w, false);
    var html = '';
    if (Math.abs(current.totalWeight - 100) > 1e-9) {
      html += '<p class="warning">Your weights add up to ' + plainNum(current.totalWeight) + '%, not 100%. Check them under Weights.</p>';
    }
    html += resultBlock(cid, 'Current mark', current, false);
    if (hasPredicted(c)) {
      html += resultBlock(cid, 'With predictions', GC.courseMark(cid, c, w, true), true);
    } else {
      html += '<div class="result is-predicted"><h3>With predictions</h3>' +
        '<p class="empty">Turn on <b>Predicted</b> for any entry to see how it would change your mark.</p></div>';
    }
    region(cid, 'results').innerHTML = html;
  }

  // ---------------------------------------------------------------- solver

  function renderSolver(cid) {
    var def = GC.COURSES[cid];
    var s = solverState[cid];
    var html = '<p class="hint">Enter a final course mark and pick the part to solve for. ' +
      'Other parts use your current real marks (shown in grey) unless you type a different value.</p>' +
      '<label class="field"><span>Final course mark (%)</span>' +
      '<input type="text" inputmode="decimal" autocomplete="off" data-solver="target" value="' + esc(s.target) + '" placeholder="e.g. 90"></label>';
    if (def.ap) {
      html += '<fieldset class="segmented"><legend>The mark I entered is…</legend>' +
        '<label><input type="radio" name="boost-' + cid + '" data-solver="boost" value="before"' + (s.afterBoost ? '' : ' checked') + '> Before the AP boost</label>' +
        '<label><input type="radio" name="boost-' + cid + '" data-solver="boost" value="after"' + (s.afterBoost ? ' checked' : '') + '> After the AP boost</label>' +
        '</fieldset>';
    }
    html += '<div class="solver-head"><span>Solve for</span><span>Mark (%)</span></div><div class="solver-parts">';
    def.parts.forEach(function (p) {
      html += '<div class="solver-part"><label><input type="radio" name="solve-' + cid + '" data-solver="solveFor" value="' + p + '"' +
        (s.solveFor === p ? ' checked' : '') + '> ' + esc(GC.PART_LABELS[p]) + '</label>' +
        '<span class="w" data-solver-weight="' + p + '"></span>' +
        '<input type="text" inputmode="decimal" autocomplete="off" class="num-input" data-solver="value" data-part="' + p + '"' +
        ' value="' + esc(s.values[p] || '') + '" aria-label="' + esc(GC.PART_LABELS[p]) + ' mark (%)"></div>';
    });
    html += '</div><div class="solver-result" data-region="solver-result" role="status"></div>';
    region(cid, 'solver').innerHTML = html;
  }

  function updateSolver(cid) {
    var def = GC.COURSES[cid];
    var c = state.courses[cid];
    var s = solverState[cid];
    var w = weightsFor(cid);
    var current = GC.courseMark(cid, c, w, false);
    var box = region(cid, 'solver');

    def.parts.forEach(function (p) {
      var input = box.querySelector('[data-part="' + p + '"]');
      var solving = s.solveFor === p;
      input.disabled = solving;
      input.placeholder = solving ? '?' : (current.parts[p] == null ? 'enter %' : GC.format2(current.parts[p]));
      var typed = str(s.values[p]).trim();
      input.classList.toggle('invalid', !solving && typed !== '' && GC.toNumber(typed) == null);
      box.querySelector('[data-solver-weight="' + p + '"]').textContent = plainNum(w.components[p]) + '%';
    });

    var out = box.querySelector('[data-region="solver-result"]');
    out.className = 'solver-result';
    if (str(s.target).trim() === '') { out.innerHTML = ''; return; }

    function fail(msg) { out.className = 'solver-result bad'; out.innerHTML = msg; }

    var missing = [], invalid = [];
    var parts = def.parts.map(function (p) {
      var value = null;
      if (p !== s.solveFor) {
        var typed = str(s.values[p]).trim();
        if (typed !== '') {
          value = GC.toNumber(typed);
          if (value == null) invalid.push(GC.PART_LABELS[p]);
        } else {
          value = current.parts[p];
          if (value == null) missing.push(GC.PART_LABELS[p]);
        }
      }
      return { id: p, weight: w.components[p], value: value };
    });
    if (invalid.length) return fail('Enter a valid number for ' + esc(invalid.join(', ')) + '.');
    if (missing.length) {
      return fail('You don\'t have a mark for ' + esc(missing.join(', ')) + ' yet. Type a value for it, or pick it as the part to solve for. Only one part can be left blank.');
    }

    var r = GC.solve({ parts: parts, target: s.target, ap: def.ap, afterBoost: def.ap && s.afterBoost });
    if (!r.ok) {
      if (r.error === 'target-range' || r.error === 'no-target') return fail('Enter a final course mark between 0 and 100.');
      if (r.error === 'zero-weight') return fail(esc(GC.PART_LABELS[s.solveFor]) + ' has a weight of 0%, so it can\'t change your mark.');
      return fail('Leave exactly one part blank to solve for it.');
    }

    var label = { term: 'the term', cpt: 'the CPT', final: 'the final exam', attendance: 'attendance & participation' }[r.id];
    var targetText = GC.format2(GC.toNumber(s.target)) + '%' + (def.ap ? (s.afterBoost ? ' after the boost' : ' before the boost') : '');

    if (r.status === 'too-high') {
      return fail('<b>Not possible.</b> You\'d need <strong>' + pct(r.required) + '</strong> on ' + label +
        ', which is above 100%.');
    }
    if (r.status === 'too-low') {
      return fail('<b>Not possible.</b> You\'d need <strong>' + pct(r.required) + '</strong> on ' + label +
        ', which is below 0%. Even 0% would give you more than ' + targetText + '.');
    }
    out.className = 'solver-result ok';
    if (r.status === 'any') {
      out.innerHTML = 'Any mark on ' + label + ' works. Your other marks already give you 100% after the boost.';
      return;
    }
    var html = 'You need ' + (r.atLeast ? '<b>at least</b> ' : '') + '<strong>' + pct(r.required) + '</strong> on ' + label +
      ' to get ' + targetText + '.';
    var entry = (r.id === 'final' || r.id === 'attendance') ? c[r.id] : null;
    var outOf = entry ? GC.toNumber(entry.outOf) : null;
    if (outOf != null && outOf > 0 && outOf !== 100) {
      html += ' That\'s ' + (r.atLeast ? 'at least ' : '') + GC.format2(r.required / 100 * outOf) + ' / ' + plainNum(outOf) + '.';
    }
    if (def.ap && s.afterBoost) {
      html += r.atLeast
        ? '<br><span class="card-sub">Any mark of ' + pct(r.preTarget) + ' or more before the boost becomes 100%.</span>'
        : '<br><span class="card-sub">' + targetText + ' means ' + pct(r.preTarget) + ' before the boost.</span>';
    }
    out.innerHTML = html;
  }

  // -------------------------------------------------------------- settings

  function renderSettings(cid) {
    var def = GC.COURSES[cid];
    var saved = state.courses[cid].settings;
    function row(group, key, label) {
      var v = saved[group] && saved[group][key] != null ? saved[group][key] : String(def[group][key]);
      return '<div class="setting-row"><label for="set-' + cid + '-' + group + '-' + key + '">' + esc(label) + '</label>' +
        '<input type="text" inputmode="decimal" autocomplete="off" class="num-input" id="set-' + cid + '-' + group + '-' + key + '"' +
        ' data-setting="' + group + '" data-key="' + key + '" value="' + esc(v) + '"></div>';
    }
    var html = '<p class="hint">Change these if your teacher uses different weights. Changes save automatically.</p>';

    html += '<div class="settings-group"><h3>' + GROUP_LABELS.components + ' (%)</h3>';
    def.parts.forEach(function (p) {
      if (p === 'term' && def.categories) {
        html += '<div class="setting-row"><span>Term <span class="card-sub">(K + T + C + A)</span></span>' +
          '<span class="derived" data-derived="term"></span></div>';
      } else {
        html += row('components', p, GC.PART_LABELS[p]);
      }
    });
    html += '<p class="setting-total" data-region="weight-total"></p></div>';

    if (def.categories) {
      html += '<div class="settings-group"><h3>' + GROUP_LABELS.categories + ' (% of course)</h3>';
      GC.CATEGORY_ORDER.forEach(function (k) { html += row('categories', k, GC.CATEGORY_LABELS[k] + ' (' + k + ')'); });
      html += '</div>';
    }

    html += '<div class="settings-group"><h3>' + GROUP_LABELS.types + ' <span class="card-sub">(how much each counts; a test is 1)</span></h3>';
    Object.keys(def.types).forEach(function (t) { html += row('types', t, GC.TYPE_LABELS[t]); });
    html += '</div><button type="button" class="btn" data-action="reset-settings">Reset to defaults</button>';
    region(cid, 'settings').innerHTML = html;
  }

  function updateSettingsInfo(cid) {
    var def = GC.COURSES[cid];
    var w = weightsFor(cid);
    var panel = document.getElementById('panel-' + cid);

    var total = 0;
    def.parts.forEach(function (p) { total += w.components[p]; });
    var totalEl = region(cid, 'weight-total');
    var off = Math.abs(total - 100) > 1e-9;
    totalEl.textContent = 'Total: ' + plainNum(total) + '%' + (off ? ' (should add up to 100%)' : '');
    totalEl.classList.toggle('off', off);

    var derived = panel.querySelector('[data-derived="term"]');
    if (derived) derived.textContent = plainNum(w.components.term) + '%';

    Array.prototype.forEach.call(panel.querySelectorAll('[data-setting]'), function (input) {
      var v = str(input.value).trim();
      var n = GC.toNumber(v);
      input.classList.toggle('invalid', v !== '' && (n == null || n < 0));
    });

    region(cid, 'typeinfo').textContent = Object.keys(def.types).map(function (t) {
      return GC.TYPE_LABELS[t] + ' ×' + plainNum(w.types[t]);
    }).join(' · ');
    Array.prototype.forEach.call(panel.querySelectorAll('select[data-field="type"] option'), function (o) {
      o.textContent = GC.TYPE_LABELS[o.value] + ' (×' + plainNum(w.types[o.value]) + ')';
    });
    ['final', 'attendance'].forEach(function (slot) {
      var el = panel.querySelector('[data-weight="' + slot + '"]');
      if (el) el.textContent = '· ' + plainNum(w.components[slot]) + '% of course';
    });
  }

  // --------------------------------------------------------------- refresh

  function refresh(cid) {
    renderResults(cid);
    updateSettingsInfo(cid);
    updateSolver(cid);
  }

  function renderAll() {
    renderTabs();
    panelsEl.innerHTML = GC.COURSE_ORDER.map(panelShell).join('');
    GC.COURSE_ORDER.forEach(function (cid) {
      var panel = document.getElementById('panel-' + cid);
      renderAssessments(cid);
      renderCpt(cid);
      fillSingles(cid, panel);
      renderSolver(cid);
      renderSettings(cid);
      refresh(cid);
    });
  }

  // ---------------------------------------------------------------- events

  function courseOf(el) {
    var panel = el.closest('[data-course]');
    return panel ? panel.getAttribute('data-course') : null;
  }

  function onEdit(t) {
    var cid = courseOf(t);
    if (!cid) return;
    var c = state.courses[cid];
    var s = solverState[cid];

    var solverField = t.getAttribute('data-solver');
    if (solverField) {
      if (solverField === 'target') s.target = t.value;
      else if (solverField === 'value') s.values[t.getAttribute('data-part')] = t.value;
      else if (solverField === 'boost') s.afterBoost = t.value === 'after';
      else if (solverField === 'solveFor') s.solveFor = t.value;
      updateSolver(cid);
      return;
    }

    var group = t.getAttribute('data-setting');
    if (group) {
      c.settings[group] = c.settings[group] || {};
      c.settings[group][t.getAttribute('data-key')] = t.value;
      save();
      refresh(cid);
      return;
    }

    var entryEl = t.closest('[data-kind]');
    var field = t.getAttribute('data-field');
    if (!entryEl || !field) return;
    var obj = findEntry(cid, entryEl);
    if (!obj) return;
    setField(obj, field, t.type === 'checkbox' ? t.checked : t.value);
    save();
    updateEntry(cid, entryEl);
    refresh(cid);
  }

  document.addEventListener('input', function (e) {
    if (e.target.matches('input[type="text"]')) onEdit(e.target);
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('input[type="checkbox"], input[type="radio"], select')) onEdit(e.target);
  });

  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) { setActive(tab.getAttribute('data-tab')); return; }

    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');

    if (action === 'export') return exportData();
    if (action === 'import') { fileInput.click(); return; }

    var cid = courseOf(btn);
    if (!cid) return;
    var c = state.courses[cid];

    if (action === 'add-assessment' || action === 'add-cpt') {
      var isCpt = action === 'add-cpt';
      var item = isCpt ? { id: uid(), name: '', score: '', outOf: '', predicted: false } : newAssessment(cid);
      if (!isCpt && c.assessments.length) item.type = c.assessments[c.assessments.length - 1].type;
      (isCpt ? c.cpt : c.assessments).push(item);
      save();
      if (isCpt) renderCpt(cid); else renderAssessments(cid);
      refresh(cid);
      var el = region(cid, isCpt ? 'cpt' : 'assessments').lastElementChild;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var first = el.querySelector('.num-input');
        if (first) first.focus({ preventScroll: true });
      }
      return;
    }

    if (action === 'delete-entry') {
      var entryEl = btn.closest('[data-kind]');
      var kind = entryEl.getAttribute('data-kind');
      var obj = findEntry(cid, entryEl);
      var name = obj && obj.name ? '"' + obj.name + '"' : 'this ' + (kind === 'cpt' ? 'CPT mark' : 'assessment');
      if (!confirm('Delete ' + name + '?')) return;
      if (kind === 'cpt') {
        c.cpt = c.cpt.filter(function (x) { return x !== obj; });
        renderCpt(cid);
      } else {
        c.assessments = c.assessments.filter(function (x) { return x !== obj; });
        renderAssessments(cid);
      }
      save();
      refresh(cid);
      return;
    }

    if (action === 'reset-settings') {
      if (!confirm('Reset all weights for ' + GC.COURSES[cid].name + ' to the defaults?')) return;
      c.settings = {};
      save();
      renderSettings(cid);
      refresh(cid);
      toast('Weights reset to defaults');
    }
  });

  tabsEl.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = GC.COURSE_ORDER.indexOf(state.active);
    var n = GC.COURSE_ORDER.length;
    i = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    setActive(GC.COURSE_ORDER[i], true);
    e.preventDefault();
  });

  // --------------------------------------------------------- export/import

  function exportData() {
    var payload = { app: 'grade-calculator', version: 1, exportedAt: new Date().toISOString(), courses: state.courses };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'grade-calculator-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup downloaded');
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) { parsed = null; }
      fileInput.value = '';
      if (!isObj(parsed) || !isObj(parsed.courses)) {
        toast('That file isn\'t a grade calculator backup.');
        return;
      }
      if (!confirm('Replace all marks on this device with the marks in this backup?')) return;
      var active = state.active;
      state = normalizeState({ active: active, courses: parsed.courses });
      save();
      renderAll();
      toast('Backup imported');
    };
    reader.onerror = function () { fileInput.value = ''; toast('Couldn\'t read that file.'); };
    reader.readAsText(file);
  });

  renderAll();
})();
