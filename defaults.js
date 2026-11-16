/*
 * Starting assessments for each built-in course, with the scores left blank.
 * A first-time visitor's courses start with these; after that they're ordinary
 * assessments people can edit, move or delete. "Clear my marks" puts a course
 * back to this list. Changing this file doesn't affect anyone who has already
 * used the site.
 *
 * FIELDS
 *   name    What it's called.
 *   type    'test' or 'quiz' in every course
 *           'lab'   AP Physics only
 *           'group' Group Assignment (Advanced Functions and Data Management only)
 *   outOf   What it's marked out of.
 *           AP Physics: one per category, e.g. outOf: { K: 10, T: 20, C: 5, A: 10 }
 *           (leave out a category the assessment doesn't test).
 *   weight  Optional. Gives this one assessment its own weight instead of its type's.
 *
 * Data Management CPT marks go in `cpt` the same way: { name: 'Proposal', outOf: 20 }
 */
window.COURSE_DEFAULTS = {
  physics: {
    assessments: [
      { name: 'Unit 1 Quiz', type: 'quiz', outOf: { K: 15, T: 15 } },
      { name: 'Unit 1 Test', type: 'test', outOf: { K: 20, T: 20, C: 10, A: 10 } },
      { name: 'Unit 1 Lab', type: 'lab', outOf: { K: 5, T: 5, C: 5, A: 5 } },
    ]
  },

  calculus: {
    assessments: [
      { name: 'Chapter 1 Precalculus Assignment', type: 'quiz', outOf: 20 },
      { name: 'Chapter 2 Test', type: 'test', outOf: 38 },
      { name: 'Chapter 3 Quiz', type: 'quiz', outOf: 21 },
      { name: 'Chapter 3 Test', type: 'test', outOf: 40 },
      { name: 'Chapter 4 Test', type: 'test', outOf: 37 },
      { name: 'Chapter 5 Quiz', type: 'quiz', outOf: 20 },
    ]
  },

  advfunctions: {
    assessments: [
      { name: 'Unit 1 Quiz', type: 'quiz', outOf: 18 },
      { name: 'Unit 1 Test', type: 'test', outOf: 34 },
      { name: 'Unit 2 Quiz', type: 'quiz', outOf: 20 },
      { name: 'Unit 2 Test', type: 'test', outOf: 30 },
      { name: 'Unit 3 Quiz', type: 'quiz', outOf: 31 },
      { name: 'Unit 3 Test', type: 'test', outOf: 33 },
      { name: 'Unit 1-3 GC', type: 'quiz', outOf: 20 },
      { name: 'Unit 4 Quiz', type: 'quiz', outOf: 19 },
    ]
  },

  datamgmt: {
    assessments: [
      { name: 'Unit 1 Test', type: 'test', outOf: 33 },
      { name: 'Unit 2 Quiz', type: 'quiz', outOf: 18 },
      { name: 'Password Probability', type: 'group', outOf: 25 },
      { name: 'Unit 2 Test', type: 'test', outOf: 30 },
      { name: 'Unit 3 Quiz', type: 'quiz', outOf: 17 },
      { name: 'Unit 3 Test', type: 'test', outOf: 30 },
    ],
    cpt: [
    ]
  }
};
