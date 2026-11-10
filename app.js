/*
 * Page code: rendering, editing, saving, export/import, solver and settings UI.
 * All the math lives in calc.js (window.GradeCalc).
 */
(function () {
  'use strict';

  var GC = window.GradeCalc;
  var STORAGE_KEY = 'gradeCalculator.v1';
  var SHORT_PART = { term: 'Term', cpt: 'CPT', final: 'Final exam', attendance: 'Attendance' };
  var SOLVE_PHRASE = { term: 'the term', cpt: 'the CPT', final: 'the final exam', attendance: 'attendance & participation' };

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
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  var toastTimer;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2600);
  }

  // ------------------------------------------------------------ data model

  function blankMark() { return { score: '', outOf: '' }; }

  function newAssessment(cid, type) {
    var a = { id: uid(), name: '', type: type || 'test', weight: '', predicted: false, disabled: false };
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

  function typeExists(cid, settings, type) {
    if (Object.prototype.hasOwnProperty.call(GC.COURSES[cid].types, type)) return true;
    return (settings.customTypes || []).some(function (ct) { return ct.id === type; });
  }

  function normalizeAssessment(cid, raw, settings) {
    var def = GC.COURSES[cid];
    var a = newAssessment(cid);
    if (raw.id) a.id = String(raw.id);
    a.name = str(raw.name);
    a.type = typeExists(cid, settings, raw.type) ? raw.type : 'test';
    a.weight = str(raw.weight);
    a.predicted = !!raw.predicted;
    a.disabled = !!raw.disabled;
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

  function normalizeSettings(cid, raw) {
    var def = GC.COURSES[cid];
    var s = {};
    if (!isObj(raw)) return s;
    ['components', 'categories', 'types'].forEach(function (group) {
      if (!def[group] || !isObj(raw[group])) return;
      var g = {};
      Object.keys(def[group]).forEach(function (k) {
        if (raw[group][k] != null) g[k] = str(raw[group][k]);
      });
      s[group] = g;
    });
    if (Array.isArray(raw.customTypes)) {
      s.customTypes = raw.customTypes.filter(isObj).map(function (ct) {
        return { id: ct.id ? String(ct.id) : 'ct-' + uid(), label: str(ct.label), weight: str(ct.weight) };
      });
    }
    return s;
  }

  function normalizeCourse(cid, raw) {
    var c = blankCourse();
    if (!isObj(raw)) return c;
    c.settings = normalizeSettings(cid, raw.settings);
    if (Array.isArray(raw.assessments)) {
      c.assessments = raw.assessments.filter(isObj).map(function (a) { return normalizeAssessment(cid, a, c.settings); });
    }
    if (Array.isArray(raw.cpt)) {
      c.cpt = raw.cpt.filter(isObj).map(function (e) {
        return { id: e.id ? String(e.id) : uid(), name: str(e.name), score: str(e.score), outOf: str(e.outOf), predicted: !!e.predicted, disabled: !!e.disabled };
      });
    }
    ['final', 'attendance'].forEach(function (slot) {
      if (isObj(raw[slot])) {
        c[slot] = { score: str(raw[slot].score), outOf: str(raw[slot].outOf), predicted: !!raw[slot].predicted };
      }
    });
    if (Array.isArray(raw.seenDefaults)) c.seenDefaults = raw.seenDefaults.map(str);
    return c;
  }

  /*
   * Makes sure everyone has every default assessment (defaults.js), matched by
   * name. A missing one is put back in its place among the other defaults.
   * Defaults can't be deleted or renamed in the page, so this mostly adds new
   * ones, but it also brings back any removed before that rule existed.
   * Defaults people already have get their type and "out of" updated from
   * defaults.js, so a correction there reaches everyone. Scores are never touched.
   * seenDefaults records which defaults this person has had (used to tell
   * returning visitors apart from first-time ones).
   * If `added` is given, it's filled with how many were added per course.
   */
  function applyDefaults(s, added) {
    var changed = false;

    GC.COURSE_ORDER.forEach(function (cid) {
      var c = s.courses[cid];
      c.seenDefaults = c.seenDefaults || [];

      function merge(listName, prefix, make, sync) {
        var defs = courseDefaults(cid, listName);
        defs.forEach(function (d, di) {
          var k = nameKey(d.name);
          if (c.seenDefaults.indexOf(prefix + k) === -1) {
            c.seenDefaults.push(prefix + k);
            changed = true;
          }
          var have = c[listName];
          var existing = have.find(function (x) { return nameKey(x.name) === k; });
          if (existing) {
            if (sync(existing, d)) changed = true;
            return;
          }
          // Insert before the next default the person already has; otherwise at the end.
          var later = defs.slice(di + 1).map(function (x) { return nameKey(x.name); });
          var at = have.findIndex(function (x) { return later.indexOf(nameKey(x.name)) !== -1; });
          have.splice(at === -1 ? have.length : at, 0, make(d));
          changed = true;
          if (added) added[cid] = (added[cid] || 0) + 1;
        });
      }

      merge('assessments', 'a:',
        function (d) { return makeDefaultAssessment(cid, c.settings, d); },
        function (a, d) { return syncDefaultAssessment(cid, c.settings, a, d); });
      if (GC.COURSES[cid].parts.indexOf('cpt') !== -1) merge('cpt', 'c:', makeDefaultCpt, syncOutOf);
    });
    return changed;
  }

  function nameKey(name) { return str(name).trim().toLowerCase(); }

  function makeDefaultAssessment(cid, settings, d) {
    var a = newAssessment(cid);
    a.name = str(d.name).trim();
    if (d.weight != null) a.weight = str(d.weight);
    syncDefaultAssessment(cid, settings, a, d);
    return a;
  }

  /** Sets a default assessment's type and "out of" from defaults.js. Returns true if anything changed. */
  function syncDefaultAssessment(cid, settings, a, d) {
    var changed = false;
    var type = typeExists(cid, settings, d.type) ? d.type : 'test';
    if (a.type !== type) { a.type = type; changed = true; }
    if (GC.COURSES[cid].categories) {
      // A category the default leaves out isn't tested, so its "out of" is blank.
      GC.CATEGORY_ORDER.forEach(function (k) {
        var want = isObj(d.outOf) && d.outOf[k] != null ? str(d.outOf[k]) : '';
        if (a.marks[k].outOf !== want) { a.marks[k].outOf = want; changed = true; }
      });
      return changed;
    }
    return syncOutOf(a, d) || changed;
  }

  function syncOutOf(obj, d) {
    var want = str(d.outOf);
    if (obj.outOf === want) return false;
    obj.outOf = want;
    return true;
  }

  function makeDefaultCpt(d) {
    return { id: uid(), name: str(d.name).trim(), score: '', outOf: str(d.outOf), predicted: false, disabled: false };
  }

  function courseDefaults(cid, listName) {
    var defs = (window.COURSE_DEFAULTS || {})[cid];
    var list = isObj(defs) && Array.isArray(defs[listName]) ? defs[listName] : [];
    return list.filter(function (d) { return isObj(d) && nameKey(d.name); });
  }

  /**
   * True if this entry is a course default (can't be deleted or renamed).
   * If two entries share a default's name, only the first one counts.
   */
  function isDefaultEntry(cid, listName, obj) {
    var k = nameKey(obj.name);
    if (!k) return false;
    var isDef = courseDefaults(cid, listName).some(function (d) { return nameKey(d.name) === k; });
    if (!isDef) return false;
    var list = state.courses[cid][listName];
    for (var i = 0; i < list.length; i++) if (nameKey(list[i].name) === k) return list[i] === obj;
    return false;
  }

  function hasDefaults(cid) {
    return courseDefaults(cid, 'assessments').length + courseDefaults(cid, 'cpt').length > 0;
  }

  /**
   * Clears the course's assessments (and CPT marks) and replaces them with the
   * defaults from defaults.js, with blank scores. Final exam, attendance and
   * weights are left alone. Returns how many defaults were added.
   */
  function restoreDefaults(cid) {
    var c = state.courses[cid];
    var assessments = courseDefaults(cid, 'assessments');
    c.assessments = assessments.map(function (d) { return makeDefaultAssessment(cid, c.settings, d); });
    c.seenDefaults = assessments.map(function (d) { return 'a:' + nameKey(d.name); });
    var count = assessments.length;
    if (GC.COURSES[cid].parts.indexOf('cpt') !== -1) {
      var cpt = courseDefaults(cid, 'cpt');
      c.cpt = cpt.map(makeDefaultCpt);
      c.seenDefaults = c.seenDefaults.concat(cpt.map(function (d) { return 'c:' + nameKey(d.name); }));
      count += cpt.length;
    }
    return count;
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
        toast('Marks can\'t be saved on this device. Export a backup to keep them.');
      }
    }
  }

  function weightsFor(cid) { return GC.effectiveWeights(cid, state.courses[cid].settings); }
  function typesFor(cid) { return GC.typeList(cid, state.courses[cid].settings); }

  function hasPredicted(c) {
    return c.assessments.some(function (a) { return a.predicted && !a.disabled; }) ||
      c.cpt.some(function (e) { return e.predicted && !e.disabled; }) ||
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

  function findCustomType(cid, id) {
    var list = state.courses[cid].settings.customTypes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
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
    each(tabsEl.querySelectorAll('.tab'), function (t) {
      var on = t.getAttribute('data-tab') === cid;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    each(panelsEl.children, function (p) {
      p.hidden = p.getAttribute('data-course') !== cid;
    });
  }

  function panelShell(cid) {
    var def = GC.COURSES[cid];
    var html = '<section class="panel" id="panel-' + cid + '" role="tabpanel" aria-labelledby="course-title-' + cid + '" data-course="' + cid + '"' +
      (cid === state.active ? '' : ' hidden') + '>';
    html += '<div class="course-head"><h2 id="course-title-' + cid + '">' + esc(def.name) + '</h2></div>';
    html += '<div class="scorecard" data-region="results" aria-live="polite"></div>';

    html += '<section class="block"><h3>Assessments</h3>';
    if (def.categories) {
      html += '<p class="hint">Enter Knowledge (K), Thinking (T), Communication (C) and Application (A) separately. ' +
        'Leave a category blank if the assessment didn\'t test it.</p>';
    }
    html += '<div class="rows" data-region="assessments"></div><div class="list-actions">' +
      '<button type="button" class="add-btn" data-action="add-assessment">+ Add assessment</button>' +
      (hasDefaults(cid) ? '<button type="button" class="link-btn quiet" data-action="restore-defaults">Clear my marks</button>' : '') +
      '</div></section>';

    if (def.parts.indexOf('cpt') !== -1) {
      html += '<section class="block"><h3>CPT</h3>' +
        '<p class="hint">Add each CPT mark. Together they count as total score divided by total out of.</p>' +
        '<div class="rows" data-region="cpt"></div>' +
        '<button type="button" class="add-btn" data-action="add-cpt">+ Add CPT mark</button></section>';
    }

    html += '<section class="block"><h3>Final exam and attendance</h3>' +
      '<p class="hint">Leave these blank if you don\'t know the mark yet. They\'re left out until you fill them in.</p><div class="rows">' +
      singleHtml('final', 'Final exam') + singleHtml('attendance', 'Attendance & Participation') + '</div></section>';

    html += '<details class="block fold"><summary><span class="fold-title">Reverse solver</span>' +
      '<span class="fold-sub">Work out the mark you need on one part</span></summary><div data-region="solver"></div></details>';
    html += '<details class="block fold"><summary><span class="fold-title">Weights and assessment types</span>' +
      '<span class="fold-sub">Change weights or add your own types</span></summary><div data-region="settings"></div></details>';
    html += '</section>';
    return html;
  }

  function numInput(field, value, label, placeholder, extraClass, disabled) {
    return '<input type="text" inputmode="decimal" autocomplete="off" class="blank num' + (extraClass ? ' ' + extraClass : '') + '" data-field="' + field + '"' +
      ' value="' + esc(value) + '" placeholder="' + placeholder + '" aria-label="' + esc(label) + '"' + (disabled ? ' disabled' : '') + '>';
  }

  /**
   * Score / out of. `locked` (default assessments) fixes the "out of"; a locked
   * blank "out of" means the category isn't tested, so the score is off too.
   */
  function scoreHtml(prefix, m, label, locked) {
    var untested = locked && !str(m.outOf).trim();
    return '<span class="score">' +
      numInput(prefix + 'score', m.score, label + ' score', untested ? '—' : 'score', '', untested) +
      '<span class="slash" aria-hidden="true">/</span>' +
      numInput(prefix + 'outOf', m.outOf, label + ' out of', untested ? '—' : 'out of', '', locked) + '</span>';
  }

  /** Count checkbox + name input; unticking leaves the entry out of every mark. */
  function nameLine(obj, placeholder, label, context, locked) {
    return '<div class="name-line">' +
      '<input type="checkbox" class="count-check" data-field="counted"' + (obj.disabled ? '' : ' checked') +
      ' aria-label="Count ' + esc(context) + ' in my mark" title="Count this in my mark">' +
      '<input type="text" class="blank name' + (locked ? ' locked' : '') + '" data-field="name" value="' + esc(obj.name) + '" placeholder="' + placeholder + '"' +
      ' aria-label="' + label + '" autocomplete="off"' +
      (locked ? ' readonly title="Default assessment: everyone has the same one, so its name, type and out of are fixed"' : '') + '></div>';
  }

  function deleteBtn(context, locked) {
    return locked ? '' : '<button type="button" class="delete-btn" data-action="delete-entry" aria-label="Delete ' + esc(context) + '">Delete</button>';
  }

  function predictedToggle(on) {
    return '<label class="check"><input type="checkbox" data-field="predicted"' + (on ? ' checked' : '') + '> Predicted</label>';
  }

  function assessmentHtml(cid, a, index) {
    var def = GC.COURSES[cid];
    var w = weightsFor(cid);
    var context = a.name ? a.name : 'Assessment ' + (index + 1);
    var options = typesFor(cid).map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === a.type ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    }).join('');
    var typeWeight = w.types[a.type] != null ? plainNum(w.types[a.type]) : '0';
    var locked = isDefaultEntry(cid, 'assessments', a);

    var html = '<div class="entry' + (a.predicted ? ' is-predicted' : '') + (def.categories ? ' has-cats' : '') + '" data-kind="assessment" data-id="' + esc(a.id) + '">';
    html += '<div class="entry-main">' + nameLine(a, 'Untitled assessment', 'Assessment name', context, locked);
    if (def.categories) {
      html += '</div><div class="cats">' + GC.CATEGORY_ORDER.map(function (k) {
        return '<div class="cat-row"><span class="cat" title="' + GC.CATEGORY_LABELS[k] + '">' + k + '</span>' +
          scoreHtml(k + '.', a.marks[k], context + ' ' + GC.CATEGORY_LABELS[k], locked) +
          '<span class="pct" data-pct="' + k + '"></span></div>';
      }).join('') + '</div>';
    } else {
      html += scoreHtml('', a, context, locked) + '<span class="pct" data-pct=""></span></div>';
    }
    html += '<div class="entry-meta">' +
      '<select class="type-select" data-field="type" aria-label="' + esc(context) + ' type"' + (locked ? ' disabled' : '') + '>' + options + '</select>' +
      '<label class="weight-field">Weight ' +
      '<input type="text" inputmode="decimal" autocomplete="off" class="blank num small" data-field="weight" value="' + esc(a.weight) + '"' +
      ' placeholder="' + typeWeight + '" aria-label="' + esc(context) + ' weight (blank uses the type weight of ' + typeWeight + ')"></label>' +
      predictedToggle(a.predicted) + deleteBtn(context, locked) +
      '</div></div>';
    return html;
  }

  function cptHtml(cid, e, index) {
    var context = e.name ? e.name : 'CPT mark ' + (index + 1);
    var locked = isDefaultEntry(cid, 'cpt', e);
    return '<div class="entry' + (e.predicted ? ' is-predicted' : '') + '" data-kind="cpt" data-id="' + esc(e.id) + '">' +
      '<div class="entry-main">' + nameLine(e, 'Untitled CPT mark', 'CPT mark name', context, locked) +
      scoreHtml('', e, context, locked) + '<span class="pct" data-pct=""></span></div>' +
      '<div class="entry-meta">' + predictedToggle(e.predicted) + deleteBtn(context, locked) + '</div></div>';
  }

  function singleHtml(slot, title) {
    return '<div class="entry" data-kind="single" data-slot="' + slot + '">' +
      '<div class="entry-main"><span class="name static">' + esc(title) + '<span class="part-weight" data-weight="' + slot + '"></span></span>' +
      scoreHtml('', blankMark(), title) + '<span class="pct" data-pct=""></span></div>' +
      '<div class="entry-meta">' + predictedToggle(false) + '</div></div>';
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
      : '<p class="empty-list">No assessments yet. Add your first test or quiz.</p>';
    each(el.querySelectorAll('.entry'), function (e) { updateEntry(cid, e); });
  }

  function renderCpt(cid) {
    var el = region(cid, 'cpt');
    if (!el) return;
    var list = state.courses[cid].cpt;
    el.innerHTML = list.length
      ? list.map(function (e, i) { return cptHtml(cid, e, i); }).join('')
      : '<p class="empty-list">No CPT marks yet.</p>';
    each(el.querySelectorAll('.entry'), function (e) { updateEntry(cid, e); });
  }

  function markInvalid(input, bad) { if (input) input.classList.toggle('invalid', bad); }

  /** Updates an entry's percentages, predicted styling and invalid-input highlighting. */
  function updateEntry(cid, el) {
    var obj = findEntry(cid, el);
    if (!obj) return;
    el.classList.toggle('is-predicted', !!obj.predicted && !obj.disabled);
    el.classList.toggle('is-off', !!obj.disabled);
    each(el.querySelectorAll('.pct'), function (span) {
      var cat = span.getAttribute('data-pct');
      var m = cat ? obj.marks[cat] : obj;
      var p = GC.percent(m.score, m.outOf);
      span.textContent = p == null ? '' : GC.format2(p) + '%';

      var prefix = cat ? cat + '.' : '';
      var s = GC.toNumber(m.score), o = GC.toNumber(m.outOf);
      var scoreText = str(m.score).trim(), outText = str(m.outOf).trim();
      markInvalid(el.querySelector('[data-field="' + prefix + 'score"]'), scoreText !== '' && (s == null || s < 0));
      markInvalid(el.querySelector('[data-field="' + prefix + 'outOf"]'),
        (outText !== '' && (o == null || o <= 0)) || (outText === '' && scoreText !== ''));
    });
    var weightInput = el.querySelector('[data-field="weight"]');
    if (weightInput) {
      var wt = str(obj.weight).trim(), wn = GC.toNumber(wt);
      markInvalid(weightInput, wt !== '' && (wn == null || wn < 0));
    }
  }

  // --------------------------------------------------------------- results

  function renderResults(cid) {
    var def = GC.COURSES[cid];
    var c = state.courses[cid];
    var w = weightsFor(cid);
    var cur = GC.courseMark(cid, c, w, false);
    var anyPred = hasPredicted(c);
    var pred = anyPred ? GC.courseMark(cid, c, w, true) : null;
    var html = '';

    if (Math.abs(cur.totalWeight - 100) > 1e-9) {
      html += '<p class="weight-warning">The course weights add up to ' + plainNum(cur.totalWeight) +
        '%, not 100%. Fix them under Weights and assessment types.</p>';
    }

    if (cur.raw == null && !(pred && pred.raw != null)) {
      region(cid, 'results').innerHTML = html +
        '<p class="score-empty">Enter a mark below and your course mark appears here.</p>';
      return;
    }

    html += '<div class="score-top">';
    if (cur.raw != null) {
      html += '<div class="pen-mark" role="img" aria-label="Current mark ' + pct(cur.raw) + '">' +
        '<span class="pen-value">' + pct(cur.raw) + '</span></div>' +
        '<dl class="score-stats">' +
        (def.ap ? '<div class="boost"><dt>AP boosted</dt><dd>' + pct(cur.boosted) + '</dd></div>' : '') +
        '</dl>';
    } else {
      html += '<p class="score-empty">No real marks yet. Only predicted ones.</p>';
    }
    html += '</div>';
    html += '<p class="score-caption">Current mark from real marks only</p>';

    if (pred && pred.raw != null) {
      var delta = cur.raw != null ? pred.raw - cur.raw : null;
      var deltaText = delta == null ? '' : '<span class="delta">' + (delta >= 0 ? '+' : '−') + GC.format2(Math.abs(delta)) + '</span>';
      html += '<div class="what-if"><span class="what-if-label">With predicted marks</span>' +
        '<span class="what-if-value">' + pct(pred.raw) + '</span>' + deltaText +
        (def.ap ? '<span class="what-if-extra">AP boosted ' + pct(pred.boosted) + '</span>' : '') + '</div>';
    } else if (!anyPred) {
      html += '<p class="what-if-hint">Tick Predicted on any entry to see a what-if mark.</p>';
    }

    if (cur.raw != null) {
      html += '<table class="sheet"><thead><tr><th scope="col">Part</th><th scope="col">Mark</th><th scope="col">Weight</th></tr></thead><tbody>';
      def.parts.forEach(function (p) {
        html += sheetRow(SHORT_PART[p], cur.parts[p], w.components[p], false);
        if (p === 'term' && cur.categories) {
          GC.CATEGORY_ORDER.forEach(function (k) {
            html += sheetRow(GC.CATEGORY_LABELS[k], cur.categories[k], w.categories[k], true);
          });
        }
      });
      html += '</tbody></table>';
      if (cur.usedWeight < cur.totalWeight - 1e-9) {
        html += '<p class="basis">Only ' + plainNum(cur.usedWeight) + '% of the course has marks so far. ' +
          'Those parts are scaled up to count as the whole mark.</p>';
      }
    }
    region(cid, 'results').innerHTML = html;
  }

  function sheetRow(label, value, weight, sub) {
    return '<tr class="' + (sub ? 'sub' : '') + (value == null ? ' missing' : '') + '"><th scope="row">' + esc(label) + '</th>' +
      '<td>' + (value == null ? 'Not entered' : pct(value)) + '</td><td>' + plainNum(weight) + '%</td></tr>';
  }

  // ---------------------------------------------------------------- solver

  function renderSolver(cid) {
    var def = GC.COURSES[cid];
    var s = solverState[cid];
    var html = '<p class="hint">Enter a course mark, then pick the part to solve for. ' +
      'The other parts use your current real marks (shown in grey) unless you type over them. ' +
      'Parts with no mark yet, like a final exam you haven\'t written, are left out.</p>' +
      '<label class="field"><span class="field-label">Course mark you want (%)</span>' +
      '<input type="text" inputmode="decimal" autocomplete="off" class="blank num wide" data-solver="target" value="' + esc(s.target) + '" placeholder="e.g. 90"></label>';
    if (def.ap) {
      html += '<fieldset class="choice"><legend class="field-label">That mark is</legend>' +
        '<label><input type="radio" name="boost-' + cid + '" data-solver="boost" value="before"' + (s.afterBoost ? '' : ' checked') + '> Before the AP boost</label>' +
        '<label><input type="radio" name="boost-' + cid + '" data-solver="boost" value="after"' + (s.afterBoost ? ' checked' : '') + '> After the AP boost</label>' +
        '</fieldset>';
    }
    html += '<fieldset class="solver-parts"><legend class="field-label">Solve for</legend>';
    def.parts.forEach(function (p) {
      html += '<div class="solver-part"><label><input type="radio" name="solve-' + cid + '" data-solver="solveFor" value="' + p + '"' +
        (s.solveFor === p ? ' checked' : '') + '> ' + esc(GC.PART_LABELS[p]) + ' <span class="part-weight" data-solver-weight="' + p + '"></span></label>' +
        '<input type="text" inputmode="decimal" autocomplete="off" class="blank num" data-solver="value" data-part="' + p + '"' +
        ' value="' + esc(s.values[p] || '') + '" aria-label="' + esc(GC.PART_LABELS[p]) + ' mark (%)"></div>';
    });
    html += '</fieldset><div class="solver-result" data-region="solver-result" role="status"></div>';
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
      input.placeholder = solving ? '?' : (current.parts[p] == null ? 'left out' : GC.format2(current.parts[p]));
      var typed = str(s.values[p]).trim();
      input.classList.toggle('invalid', !solving && typed !== '' && GC.toNumber(typed) == null);
      box.querySelector('[data-solver-weight="' + p + '"]').textContent = plainNum(w.components[p]) + '%';
    });

    var out = box.querySelector('[data-region="solver-result"]');
    out.className = 'solver-result';
    if (str(s.target).trim() === '') { out.innerHTML = ''; return; }

    function fail(msg) { out.className = 'solver-result bad'; out.innerHTML = msg; }

    var invalid = [];
    var parts = def.parts.map(function (p) {
      var value = null;
      if (p !== s.solveFor) {
        var typed = str(s.values[p]).trim();
        if (typed !== '') {
          value = GC.toNumber(typed);
          if (value == null) invalid.push(GC.PART_LABELS[p]);
        } else {
          value = current.parts[p]; // null = no mark yet, so it's left out
        }
      }
      return { id: p, weight: w.components[p], value: value };
    });
    if (invalid.length) return fail('Enter a number for ' + esc(invalid.join(', ')) + '.');

    var r = GC.solve({ parts: parts, solveFor: s.solveFor, target: s.target, ap: def.ap, afterBoost: def.ap && s.afterBoost });
    if (!r.ok) {
      if (r.error === 'target-range' || r.error === 'no-target') return fail('Enter a course mark from 0 to 100.');
      if (r.error === 'zero-weight') return fail(esc(GC.PART_LABELS[s.solveFor]) + ' has a weight of 0%, so it can\'t change your mark.');
      return fail('Pick one part to solve for.');
    }

    var label = SOLVE_PHRASE[r.id];
    var targetText = GC.format2(GC.toNumber(s.target)) + '%' + (def.ap ? (s.afterBoost ? ' after the boost' : ' before the boost') : '');
    var leftOutNote = r.leftOut.length
      ? '<span class="solver-note">Left out because there\'s no mark yet: ' +
        esc(r.leftOut.map(function (p) { return GC.PART_LABELS[p]; }).join(', ')) + '.</span>'
      : '';

    if (r.status === 'too-high') {
      return fail('<strong>Not possible.</strong> You\'d need <span class="need">' + pct(r.required) + '</span> on ' + label +
        ', which is above 100%.' + leftOutNote);
    }
    if (r.status === 'too-low') {
      return fail('<strong>Not possible.</strong> You\'d need <span class="need">' + pct(r.required) + '</span> on ' + label +
        ', which is below 0%. Even 0% gets you more than ' + targetText + '.' + leftOutNote);
    }
    out.className = 'solver-result ok';
    if (r.status === 'any') {
      out.innerHTML = 'Any mark on ' + label + ' works. Your other marks already give you 100% after the boost.' + leftOutNote;
      return;
    }
    var html = 'You need ' + (r.atLeast ? 'at least ' : '') + '<span class="need">' + pct(r.required) + '</span> on ' + label +
      ' to get ' + targetText + '.';
    var entry = (r.id === 'final' || r.id === 'attendance') ? c[r.id] : null;
    var outOf = entry ? GC.toNumber(entry.outOf) : null;
    if (outOf != null && outOf > 0 && outOf !== 100) {
      html += ' That\'s ' + (r.atLeast ? 'at least ' : '') + GC.format2(r.required / 100 * outOf) + ' out of ' + plainNum(outOf) + '.';
    }
    if (def.ap && s.afterBoost) {
      html += r.atLeast
        ? '<span class="solver-note">Any mark of ' + pct(r.preTarget) + ' or more before the boost becomes 100%.</span>'
        : '<span class="solver-note">' + targetText + ' is ' + pct(r.preTarget) + ' before the boost.</span>';
    }
    out.innerHTML = html + leftOutNote;
  }

  // -------------------------------------------------------------- settings

  function settingInput(attrs, value, label, id) {
    return '<input type="text" inputmode="decimal" autocomplete="off" class="blank num" id="' + id + '" ' + attrs +
      ' value="' + esc(value) + '" aria-label="' + esc(label) + '">';
  }

  function renderSettings(cid) {
    var def = GC.COURSES[cid];
    var saved = state.courses[cid].settings;
    function row(group, key, label, unit) {
      var v = saved[group] && saved[group][key] != null ? saved[group][key] : plainNum(def[group][key]);
      var id = 'set-' + cid + '-' + group + '-' + key;
      return '<div class="setting-row"><label for="' + id + '">' + esc(label) + '</label>' +
        '<span class="unit-field">' + settingInput('data-setting="' + group + '" data-key="' + key + '"', v, label, id) +
        (unit ? '<span class="unit">' + unit + '</span>' : '') + '</span></div>';
    }

    var html = '<div class="settings-group"><h4>Course parts</h4>' +
      '<p class="hint">How much each part counts toward your course mark.</p>';
    def.parts.forEach(function (p) {
      if (p === 'term' && def.categories) {
        html += '<div class="setting-row"><span>Term <span class="part-weight">(Knowledge + Thinking + Communication + Application)</span></span>' +
          '<span class="unit-field"><span class="derived" data-derived="term"></span><span class="unit">%</span></span></div>';
      } else {
        html += row('components', p, GC.PART_LABELS[p], '%');
      }
    });
    html += '<p class="setting-total" data-region="weight-total"></p></div>';

    if (def.categories) {
      html += '<div class="settings-group"><h4>Term categories</h4>' +
        '<p class="hint">Each category\'s share of the whole course. Together they make up the term.</p>';
      GC.CATEGORY_ORDER.forEach(function (k) { html += row('categories', k, GC.CATEGORY_LABELS[k], '%'); });
      html += '</div>';
    }

    html += '<div class="settings-group"><h4>Assessment types</h4>' +
      '<p class="hint">How much each type counts compared with a test. A quiz at 0.5 counts half as much as a test. ' +
      'You can also give a single assessment its own weight in its row.</p>';
    Object.keys(def.types).forEach(function (t) { html += row('types', t, GC.TYPE_LABELS[t], '×'); });
    (saved.customTypes || []).forEach(function (ct) {
      var id = 'ct-' + cid + '-' + ct.id;
      html += '<div class="setting-row custom" data-ctype="' + esc(ct.id) + '">' +
        '<input type="text" class="blank name" data-ctype-field="label" value="' + esc(ct.label) + '" placeholder="Type name, e.g. Project" aria-label="Custom type name" autocomplete="off">' +
        '<span class="unit-field">' + settingInput('data-ctype-field="weight"', ct.weight, (ct.label || 'Custom type') + ' weight', id) +
        '<span class="unit">×</span></span>' +
        '<button type="button" class="delete-btn" data-action="delete-type" aria-label="Delete type ' + esc(ct.label || 'untitled') + '">Delete</button></div>';
    });
    html += '<button type="button" class="add-btn" data-action="add-type">+ Add assessment type</button></div>';
    html += '<button type="button" class="plain-btn" data-action="reset-settings">Reset weights to defaults</button>';
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
    totalEl.textContent = 'Total ' + plainNum(total) + '%' + (off ? '. These should add up to 100%.' : '');
    totalEl.classList.toggle('off', off);

    var derived = panel.querySelector('[data-derived="term"]');
    if (derived) derived.textContent = plainNum(w.components.term);

    each(panel.querySelectorAll('[data-setting], [data-ctype-field="weight"]'), function (input) {
      var v = str(input.value).trim();
      var n = GC.toNumber(v);
      var required = input.hasAttribute('data-ctype-field');
      input.classList.toggle('invalid', (required && v === '') || (v !== '' && (n == null || n < 0)));
    });

    ['final', 'attendance'].forEach(function (slot) {
      var el = panel.querySelector('[data-weight="' + slot + '"]');
      if (el) el.textContent = plainNum(w.components[slot]) + '% of course';
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
      if (group === 'types') renderAssessments(cid);
      refresh(cid);
      return;
    }

    var ctField = t.getAttribute('data-ctype-field');
    if (ctField) {
      var ct = findCustomType(cid, t.closest('[data-ctype]').getAttribute('data-ctype'));
      if (!ct) return;
      ct[ctField] = t.value;
      save();
      renderAssessments(cid);
      refresh(cid);
      return;
    }

    var entryEl = t.closest('[data-kind]');
    var field = t.getAttribute('data-field');
    if (!entryEl || !field) return;
    var obj = findEntry(cid, entryEl);
    if (!obj) return;
    if (field === 'counted') obj.disabled = !t.checked;
    else setField(obj, field, t.type === 'checkbox' ? t.checked : t.value);
    save();
    if (field === 'type') {
      // Show the new type's weight as the hint in the weight box.
      var wInput = entryEl.querySelector('[data-field="weight"]');
      var tw = weightsFor(cid).types[obj.type];
      if (wInput) wInput.placeholder = plainNum(tw || 0);
    }
    updateEntry(cid, entryEl);
    refresh(cid);
  }

  document.addEventListener('input', function (e) {
    if (e.target.matches('input[type="text"]')) onEdit(e.target);
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('input[type="checkbox"], input[type="radio"], select')) onEdit(e.target);
  });

  function focusNew(container) {
    var el = container && container.lastElementChild;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var first = el.querySelector('input[type="text"]');
    if (first) first.focus({ preventScroll: true });
  }

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

    if (action === 'add-assessment') {
      var last = c.assessments[c.assessments.length - 1];
      c.assessments.push(newAssessment(cid, last ? last.type : 'test'));
      save();
      renderAssessments(cid);
      refresh(cid);
      focusNew(region(cid, 'assessments'));
      return;
    }

    if (action === 'restore-defaults') {
      var hasCpt = GC.COURSES[cid].parts.indexOf('cpt') !== -1;
      if (!confirm('Clear your marks in ' + GC.COURSES[cid].name + '? Every assessment' + (hasCpt ? ' and CPT mark' : '') +
        ' score is erased and any assessments you added yourself are removed. ' +
        'Your final exam, attendance and weights stay.')) return;
      restoreDefaults(cid);
      save();
      renderAssessments(cid);
      renderCpt(cid);
      refresh(cid);
      toast('Marks cleared');
      return;
    }

    if (action === 'add-cpt') {
      c.cpt.push({ id: uid(), name: '', score: '', outOf: '', predicted: false, disabled: false });
      save();
      renderCpt(cid);
      refresh(cid);
      focusNew(region(cid, 'cpt'));
      return;
    }

    if (action === 'delete-entry') {
      var entryEl = btn.closest('[data-kind]');
      var kind = entryEl.getAttribute('data-kind');
      var obj = findEntry(cid, entryEl);
      if (!obj || isDefaultEntry(cid, kind === 'cpt' ? 'cpt' : 'assessments', obj)) return;
      var name = obj.name ? '"' + obj.name + '"' : 'this ' + (kind === 'cpt' ? 'CPT mark' : 'assessment');
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

    if (action === 'add-type') {
      c.settings.customTypes = c.settings.customTypes || [];
      c.settings.customTypes.push({ id: 'ct-' + uid(), label: '', weight: '1' });
      save();
      renderSettings(cid);
      renderAssessments(cid);
      refresh(cid);
      var rows = region(cid, 'settings').querySelectorAll('.setting-row.custom');
      var newest = rows[rows.length - 1];
      if (newest) newest.querySelector('input').focus();
      return;
    }

    if (action === 'delete-type') {
      var typeId = btn.closest('[data-ctype]').getAttribute('data-ctype');
      var ct = findCustomType(cid, typeId);
      var users = c.assessments.filter(function (a) { return a.type === typeId; });
      var typeName = ct && ct.label.trim() ? '"' + ct.label.trim() + '"' : 'this type';
      var msg = 'Delete ' + typeName + '?' +
        (users.length ? ' ' + users.length + ' assessment' + (users.length === 1 ? '' : 's') + ' using it will change to Test.' : '');
      if (!confirm(msg)) return;
      users.forEach(function (a) { a.type = 'test'; });
      c.settings.customTypes = c.settings.customTypes.filter(function (x) { return x.id !== typeId; });
      save();
      renderSettings(cid);
      renderAssessments(cid);
      refresh(cid);
      toast('Type deleted');
      return;
    }

    if (action === 'reset-settings') {
      if (!confirm('Reset the weights for ' + GC.COURSES[cid].name + ' to the defaults? Your own assessment types and per-assessment weights stay.')) return;
      c.settings = { customTypes: c.settings.customTypes || [] };
      save();
      renderSettings(cid);
      renderAssessments(cid);
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
    toast('Backup exported');
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
        toast('That file isn\'t a Grade Calculator backup.');
        return;
      }
      if (!confirm('Replace all marks on this device with the marks in this backup?')) return;
      state = normalizeState({ active: state.active, courses: parsed.courses });
      applyDefaults(state);
      save();
      renderAll();
      toast('Backup imported');
    };
    reader.onerror = function () { fileInput.value = ''; toast('That file couldn\'t be read.'); };
    reader.readAsText(file);
  });

  // ----------------------------------------------------------------- start

  function start() {
    // Returning visitors get told when new defaults show up; first-time visitors don't.
    var returning = GC.COURSE_ORDER.some(function (cid) {
      var c = state.courses[cid];
      return (c.seenDefaults && c.seenDefaults.length) || c.assessments.length;
    });
    var newDefaults = {};
    if (applyDefaults(state, newDefaults)) save();
    renderAll();

    if (returning) {
      var addedText = GC.COURSE_ORDER.filter(function (cid) { return newDefaults[cid]; }).map(function (cid) {
        return newDefaults[cid] + ' in ' + GC.COURSES[cid].shortName;
      });
      if (addedText.length) toast('New assessments added: ' + addedText.join(', ') + '. Your marks are unchanged.', 6000);
    }
  }

  // Load defaults.js with a unique URL so the browser never uses a stale cached
  // copy; new defaults then show up on a normal reload. If it fails to load
  // (e.g. offline), the page still starts with what the person already has.
  if (window.COURSE_DEFAULTS) {
    start();
  } else {
    var defaultsScript = document.createElement('script');
    defaultsScript.src = 'defaults.js?v=' + Date.now();
    defaultsScript.onload = defaultsScript.onerror = start;
    document.body.appendChild(defaultsScript);
  }
})();
